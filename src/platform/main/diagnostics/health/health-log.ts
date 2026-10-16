/**
 * ⭐⭐ 运行健康「黑匣子」—— 落盘格式与复盘判定(纯逻辑 + 少量 fs)
 *
 * 用户 2026-10-16:「我建议你加一个持久的日志观察,在卡死后有记录和提示。这样你就可以复盘哪里卡死了。」
 * 「如果有看门狗,就不用这个了(系统通知),你自己记录,定期分析不好吗?」
 * → **只记录,不弹任何东西**。人不看屏幕也能事后复盘。
 *
 * 文件:`userData/krig-data/health/YYYY-MM-DD.jsonl`(UTC 日期,与 web-trace 同口径),一行一个事件:
 *   session-start / session-end         —— 一次运行的首尾(有头没尾 = 被强杀或崩溃)
 *   sample                              —— 每 30s 体检(事件循环延迟 / 内存 / 各进程 / 各模块探针)
 *   main-hang / main-recovered          —— 看门狗线程写的:主进程多久没报平安、卡了多久
 *   wc-unresponsive / wc-responsive     —— 窗口或网页无响应 / 恢复
 *   process-gone                        —— 渲染进程 / 子进程退出(崩溃、被杀、OOM)
 *   previous-session                    —— 启动时对上次运行的判定(见 judgePreviousSession)
 */

import { appendFile, appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export type HealthEvent = {
  readonly event: string;
  /** 毫秒时间戳 */
  readonly ts: number;
  readonly session?: string;
  readonly [k: string]: unknown;
};

/** 保留天数 —— 卡死往往隔几天才被注意到,留两周 */
export const HEALTH_KEEP_DAYS = 14;

export function healthDir(userData: string): string {
  return join(userData, 'krig-data', 'health');
}

export function healthFile(dir: string, ts: number): string {
  return join(dir, `${new Date(ts).toISOString().slice(0, 10)}.jsonl`);
}

/** 主进程侧写一行(异步;⚠️ 写失败只打一行,不许拖垮主进程) */
export function appendHealth(dir: string, e: HealthEvent): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch { /* 下面 appendFile 会报 */ }
  appendFile(healthFile(dir, e.ts), `${JSON.stringify(e)}\n`, (err) => {
    if (err) console.warn('[health] 写黑匣子失败:', err.message);
  });
}

/** 同步写一行 —— 只给退出前最后一笔用(异步可能来不及落盘) */
export function appendHealthSync(dir: string, e: HealthEvent): void {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(healthFile(dir, e.ts), `${JSON.stringify(e)}\n`);
  } catch (err) {
    console.warn('[health] 写黑匣子失败:', err instanceof Error ? err.message : String(err));
  }
}

/** 删掉超过保留天数的文件(按文件名日期) */
export function sweepHealth(dir: string, now: number, keepDays = HEALTH_KEEP_DAYS): number {
  let removed = 0;
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return 0; }
  const cutoff = new Date(now - keepDays * 86_400_000).toISOString().slice(0, 10);
  for (const n of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(n);
    if (m && m[1] < cutoff) {
      try { rmSync(join(dir, n)); removed += 1; } catch { /* 删不掉下次再删 */ }
    }
  }
  return removed;
}

/** 读最近的事件(最新两个文件,够判上一次运行) */
export function readRecentHealth(dir: string): HealthEvent[] {
  let names: string[] = [];
  try { names = readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort(); } catch { return []; }
  const out: HealthEvent[] = [];
  for (const n of names.slice(-2)) {
    for (const line of readFileSync(join(dir, n), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as HealthEvent); } catch { /* 半行(被强杀时写了一半)跳过 */ }
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export type PreviousSession =
  | { readonly kind: 'none' }
  | { readonly kind: 'clean'; readonly session: string; readonly endedAt: number }
  /** 卡住了、没恢复就结束了(多半是人强杀的)—— 复盘重点 */
  | { readonly kind: 'hung-then-killed'; readonly session: string; readonly hangAt: number; readonly lastSampleAt?: number }
  /** 没有正常结束、也没记到卡住(崩溃 / 断电 / 卡住不到阈值就被杀) */
  | { readonly kind: 'unclean'; readonly session: string; readonly lastSeenAt: number };

/**
 * ⭐⭐ 判定上一次运行是怎么结束的(纯函数)。
 * @param events 按时间排好的事件;@param currentSession 本次运行的 id(排除掉)
 */
export function judgePreviousSession(events: readonly HealthEvent[], currentSession: string): PreviousSession {
  const prev = events.filter((e) => e.session !== undefined && e.session !== currentSession);
  const starts = prev.filter((e) => e.event === 'session-start');
  const last = starts[starts.length - 1];
  if (!last) return { kind: 'none' };
  const sid = last.session!;
  const mine = prev.filter((e) => e.session === sid);
  const end = mine.find((e) => e.event === 'session-end');
  if (end) return { kind: 'clean', session: sid, endedAt: end.ts };
  const hangs = mine.filter((e) => e.event === 'main-hang');
  const lastHang = hangs[hangs.length - 1];
  if (lastHang && !mine.some((e) => e.event === 'main-recovered' && e.ts > lastHang.ts)) {
    const samples = mine.filter((e) => e.event === 'sample');
    return { kind: 'hung-then-killed', session: sid, hangAt: lastHang.ts, lastSampleAt: samples[samples.length - 1]?.ts };
  }
  return { kind: 'unclean', session: sid, lastSeenAt: mine[mine.length - 1].ts };
}
