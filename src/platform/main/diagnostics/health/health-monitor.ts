/**
 * ⭐⭐ 运行健康「黑匣子」—— 主进程侧(体检 + 心跳 + 无响应/崩溃事件 + 探针登记)
 *
 * 用户 2026-10-16:app 跑久了会卡住(当时 CPU/内存都不高,原因不明),后台采集一跑几小时。
 * 「加一个持久的日志观察,在卡死后有记录…这样你就可以复盘哪里卡死了」「你自己记录,定期分析」。
 * → 只记录不弹窗。格式与复盘判定见 `health-log.ts`,看门狗线程见 `watchdog-source.ts`。
 *
 * ── 各模块怎么把自己的状态放进体检 ──
 * `registerHealthProbe(name, fn)`:模块**自己**登记(推模式)。宿主不认识任何模块内部 ——
 * 删掉一个模块,它的探针跟着消失,体检照跑(X 可装卸原则,x-module-detachable)。
 * 探针必须便宜、同步、不抛(抛了只记 error 字段)。
 *
 * ⚠️ 常驻 timer + worker 线程:`stopHealthMonitor()` **必须**在 before-quit 被调到
 * (记忆 project-graceful-shutdown:不停 → 吊住事件循环 → Ctrl+C 不退)。两个 timer 都 unref,worker 也 unref。
 */

import { app, webContents, type WebContents } from 'electron';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import {
  appendHealth, appendHealthSync, healthDir, judgePreviousSession, readRecentHealth, sweepHealth, type HealthEvent,
} from './health-log';
import { WATCHDOG_SOURCE } from './watchdog-source';

/** 体检间隔 / 心跳间隔 / 判卡住阈值 / 卡住期间每隔多久补一笔「还卡着」 */
export const SAMPLE_MS = 30_000;
export const BEAT_MS = 1_000;
export const HANG_MS = 10_000;
export const STILL_HUNG_MS = 60_000;

type Probe = () => Record<string, unknown>;
const probes = new Map<string, Probe>();

/** ⭐ 模块登记自己的状态探针(幂等:同名覆盖) */
export function registerHealthProbe(name: string, fn: Probe): void {
  probes.set(name, fn);
}

let session = '';
let dir = '';
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let beatTimer: ReturnType<typeof setInterval> | null = null;
let worker: Worker | null = null;
let loopDelay: IntervalHistogram | null = null;

function rec(e: Omit<HealthEvent, 'ts' | 'session'> & { ts?: number }): void {
  appendHealth(dir, { ts: Date.now(), session, ...e } as HealthEvent);
}

const MB = (n: number): number => Math.round(n / 1_048_576);

/** 一次体检 —— 导出给测试 / 手动触发 */
export function takeSample(): HealthEvent {
  const ld = loopDelay;
  const loop = ld
    ? { p50: Math.round(ld.percentile(50) / 1e6), p99: Math.round(ld.percentile(99) / 1e6), max: Math.round(ld.max / 1e6) }
    : undefined;
  ld?.reset();
  const mem = process.memoryUsage();
  let procs: unknown[] = [];
  try {
    procs = app.getAppMetrics().map((m) => ({
      pid: m.pid, type: m.type, name: m.name ?? m.serviceName,
      cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10, memMB: MB(m.memory.workingSetSize * 1024),
    }));
  } catch (e) {
    procs = [{ error: e instanceof Error ? e.message : String(e) }];
  }
  const probed: Record<string, unknown> = {};
  for (const [name, fn] of probes) {
    try { probed[name] = fn(); } catch (e) { probed[name] = { error: e instanceof Error ? e.message : String(e) }; }
  }
  return {
    event: 'sample', ts: Date.now(), session,
    uptimeSec: Math.round(process.uptime()),
    /** ⭐ 主进程事件循环延迟(ms)—— 「越跑越慢」最直接的指标 */
    loopDelayMs: loop,
    mainMemMB: { rss: MB(mem.rss), heapUsed: MB(mem.heapUsed), external: MB(mem.external), arrayBuffers: MB(mem.arrayBuffers) },
    procs,
    probes: probed,
  };
}

/** 窗口 / 网页无响应与恢复 —— 每个 webContents 建出来就挂上 */
function watchWebContents(wc: WebContents): void {
  const who = (): Record<string, unknown> => {
    let url = '';
    try { url = wc.getURL().slice(0, 120); } catch { /* 已销毁 */ }
    return { wcId: wc.id, type: wc.getType(), url };
  };
  let since = 0;
  wc.on('unresponsive', () => {
    since = Date.now();
    console.warn(`[health] ⚠️ wc#${wc.id} 无响应`);
    rec({ event: 'wc-unresponsive', ...who() });
  });
  wc.on('responsive', () => {
    rec({ event: 'wc-responsive', ...who(), unresponsiveMs: since ? Date.now() - since : undefined });
    since = 0;
  });
}

let started = false;

/** ⚠️ 幂等;在 app.whenReady 之后调 */
export function startHealthMonitor(): void {
  if (started) return;
  started = true;
  session = `${new Date().toISOString().slice(0, 19)}_${randomBytes(3).toString('hex')}`;
  dir = healthDir(app.getPath('userData'));

  sweepHealth(dir, Date.now());
  /** ⭐ 先判上一次运行怎么结束的,再写本次 start(否则会把本次当成上一次) */
  const prev = judgePreviousSession(readRecentHealth(dir), session);
  rec({ event: 'session-start', pid: process.pid, electron: process.versions.electron });
  /** ⚠️ 判定结果放 previous 里 —— 摊平的话 prev.session 会盖掉本次 session,这一行就记到上一次名下了 */
  rec({ event: 'previous-session', previous: prev });
  if (prev.kind === 'hung-then-killed') {
    console.warn(`[health] ⚠️ 上次运行(${prev.session})在 ${new Date(prev.hangAt).toLocaleString()} 卡住后没恢复就结束了 —— 记录在 ${dir}`);
  } else if (prev.kind === 'unclean') {
    console.warn(`[health] ⚠️ 上次运行(${prev.session})没有正常退出(最后记录 ${new Date(prev.lastSeenAt).toLocaleString()})—— 记录在 ${dir}`);
  }

  /** ⚠️ 读数里含采样粒度这么多的底子(空闲时 p50 ≈ resolution),看趋势别看绝对值 */
  loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();

  try {
    worker = new Worker(WATCHDOG_SOURCE, {
      eval: true,
      workerData: { dir, session, hangMs: HANG_MS, checkMs: BEAT_MS, stillMs: STILL_HUNG_MS },
    });
    worker.unref();
    worker.on('error', (e) => {
      console.warn('[health] 看门狗线程出错(主进程卡死将记不下来):', e.message);
      rec({ event: 'watchdog-error', message: e.message });
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.warn('[health] 看门狗线程起不来(主进程卡死将记不下来):', why);
    rec({ event: 'watchdog-error', message: why });
  }

  beatTimer = setInterval(() => worker?.postMessage({ type: 'beat' }), BEAT_MS);
  beatTimer.unref?.();
  sampleTimer = setInterval(() => {
    const s = takeSample();
    appendHealth(dir, s);
    /** 给看门狗一份摘要:卡住时随记录写出,看卡住前的样子 */
    worker?.postMessage({ type: 'sample', data: { ts: s.ts, uptimeSec: s.uptimeSec, loopDelayMs: s.loopDelayMs, mainMemMB: s.mainMemMB, probes: s.probes } });
  }, SAMPLE_MS);
  sampleTimer.unref?.();

  for (const wc of webContents.getAllWebContents()) watchWebContents(wc);
  app.on('web-contents-created', (_e, wc) => watchWebContents(wc));
  app.on('render-process-gone', (_e, wc, details) => {
    console.warn(`[health] ⚠️ 渲染进程退出 wc#${wc.id}:${details.reason}`);
    rec({ event: 'process-gone', kind: 'renderer', wcId: wc.id, reason: details.reason, exitCode: details.exitCode });
  });
  app.on('child-process-gone', (_e, details) => {
    console.warn(`[health] ⚠️ 子进程退出 ${details.type}:${details.reason}`);
    rec({ event: 'process-gone', kind: details.type, name: details.name, reason: details.reason, exitCode: details.exitCode });
  });

  console.log(`[health] 黑匣子已启动(体检 ${SAMPLE_MS / 1000}s / 看门狗 ${HANG_MS / 1000}s 判卡住)→ ${dir}`);
}

/** ⭐ 停。**必须**在 before-quit 被调到 */
export function stopHealthMonitor(): void {
  if (!started) return;
  started = false;
  if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
  if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
  loopDelay?.disable();
  /** ⚠️ 同步写:这是退出前最后一笔,异步写可能没落盘进程就没了 → 下次会误判「没正常退出」 */
  appendHealthSync(dir, { event: 'session-end', ts: Date.now(), session, uptimeSec: Math.round(process.uptime()) });
  void worker?.terminate();
  worker = null;
}
