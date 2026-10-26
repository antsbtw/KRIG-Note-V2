/**
 * ⭐⭐ 日常诊断日志 —— 宿主侧起停(终端日志 + 网页 DevTools 日志落盘)
 *
 * 格式见 `log-file.ts`;读法:`node scripts/logs.mjs --help`。
 *
 * ⚠️ 起得越早越好(要接住启动阶段的日志):`index.ts` 在拿到单实例锁之后立刻调,不等 whenReady。
 * ⚠️ 常驻 timer + app 级监听:`stopDiagnosticLogs()` **必须**在 before-quit 被调到
 *    (记忆 project-graceful-shutdown)。timer unref。console 接管与 fd 刻意留到进程退出(见 stop 的注释)。
 */

import { app, webContents, type WebContents } from 'electron';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DailyLogWriter, LOG_KEEP_DAYS, logsDir, sweepLogs } from './log-file';
import { tapMainConsole } from './main-console-tap';
import { tapPageConsole } from './page-console-tap';

const SWEEP_MS = 24 * 60 * 60 * 1000;

let mainWriter: DailyLogWriter | null = null;
let pageWriter: DailyLogWriter | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let onCreated: ((e: unknown, wc: WebContents) => void) | null = null;

/** 本次运行的 id —— 每条记录都带,区分「重启前 / 重启后」 */
export let logRun = '';

export function startDiagnosticLogs(opts: { resolvePageId: (wc: WebContents) => string | null }): void {
  if (mainWriter) return;
  const dir = logsDir(app.getPath('userData'));
  /** ⚠️ 落盘失败要用**未接管**的 console.error 报,否则「写日志失败」又去写日志 */
  const rawError = console.error.bind(console);
  logRun = `${new Date().toISOString().slice(0, 19)}_${randomBytes(3).toString('hex')}`;
  mainWriter = new DailyLogWriter(join(dir, 'main'), rawError);
  pageWriter = new DailyLogWriter(join(dir, 'page'), rawError);

  const swept = sweepLogs(dir, Date.now());
  sweepTimer = setInterval(() => {
    const n = sweepLogs(dir, Date.now());
    if (n > 0) console.log(`[logs] 老化:删除 ${n} 个超过 ${LOG_KEEP_DAYS} 天的分片`);
  }, SWEEP_MS);
  sweepTimer.unref?.();

  tapMainConsole(mainWriter, logRun);

  const deps = { writer: pageWriter, run: logRun, resolvePageId: opts.resolvePageId };
  for (const wc of webContents.getAllWebContents()) tapPageConsole(wc, deps);
  onCreated = (_e, wc) => { tapPageConsole(wc, deps); };
  app.on('web-contents-created', onCreated);

  console.log(`[logs] 诊断日志已启动 run=${logRun} pid=${process.pid}(终端 + 网页 DevTools,保留 ${LOG_KEEP_DAYS} 天${swept > 0 ? `,启动清掉 ${swept} 个过期分片` : ''})→ ${dir}`);
}

/**
 * ⭐ 停。**必须**在 before-quit 被调到。
 *
 * ⚠️ 只停 timer、摘 app 级监听,**不还原 console、不关 fd**:
 * 关库之后还有子进程退出的日志(实测 `[storage/surreal server] Goodbye!` 等 3 行在停止之后才来),
 * 那段也要进文件。`writeSync` 不经缓冲,没有要冲刷的东西;fd 随进程退出由系统关。
 */
export function stopDiagnosticLogs(): void {
  if (!sweepTimer && !onCreated) return;
  console.log(`[logs] 诊断日志停止巡检 run=${logRun}(终端日志继续落盘到进程退出)`);
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  if (onCreated) { app.off('web-contents-created', onCreated); onCreated = null; }
}

