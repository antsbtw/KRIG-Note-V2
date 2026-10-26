/**
 * ⭐⭐ 日常诊断日志 —— 落盘格式(终端日志 + 网页 DevTools 日志)
 *
 * 用户 2026-10-19:「AI必须有能力执行日常的诊断方式-- terminal log/devtools log」
 * 设计:`docs/10-business-design/web/capability-layer/04-site-manual-self-repair.md` §5.1 / §11 P1。
 *
 * 以前诊断全靠用户当传声筒(截图、复制终端输出、开 guest DevTools)。
 * 这里把两样现场落盘,AI 用 `node scripts/logs.mjs` 自己读。
 *
 * 文件:`userData/krig-data/logs/<stream>/YYYY-MM-DD.jsonl`(UTC 日期,与 web-trace / health 同口径),一行一条:
 *   main/  —— 主进程 console.*(就是启动 app 的那个终端里看到的)
 *   page/  —— 每个 webContents 的 console-message / 加载失败 / preload 报错 / 渲染进程退出
 *
 * 保留 30 天(用户 2026-10-19 选「30 天」),超期按天整份删。
 *
 * ── 为什么同步写、fd 常开 ──
 * 最值钱的是**崩溃 / 被强杀前的最后几行**。异步流的缓冲在进程死时会丢;
 * `writeSync` 写进 OS 后进程死了也在。fd 常开(按天换)省掉每行 open/close。
 *
 * ── ⚠️ 写失败 ──
 * 不抛(诊断不许成为故障源),但**必须响**:通过 `report` 打一行(调用方传进来的是
 * 未被接管的原始 console.error,免得「写日志失败」再进日志形成递归)。
 * 只在「好 → 坏」「坏 → 好」翻转时响,不刷屏;坏的期间丢了几条,恢复时一并报出。
 *
 * ⚠️ 日志里可能有登录态相关信息:**只落本机,不外发**。
 */

import { closeSync, mkdirSync, openSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export type LogStream = 'main' | 'page';

export type LogRecord = {
  /** 毫秒时间戳 */
  readonly ts: number;
  readonly [k: string]: unknown;
};

/** 用户 2026-10-19 选定 */
export const LOG_KEEP_DAYS = 30;

/** 单条消息上限。超了截断,并在 `truncated` 里记原长 —— 截了多少必须说得出来 */
export const MAX_MSG_CHARS = 8_000;

export function logsDir(userData: string): string {
  return join(userData, 'krig-data', 'logs');
}

export function dayOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** 截断过长消息;返回要并进记录的字段(`msg` + 可能的 `truncated`) */
export function clipMsg(msg: string): { msg: string; truncated?: number } {
  if (msg.length <= MAX_MSG_CHARS) return { msg };
  return { msg: msg.slice(0, MAX_MSG_CHARS), truncated: msg.length };
}

/**
 * 一条流的按天写入器。
 *
 * ⚠️ 调用方**必须**在 before-quit 调 `close()`(记忆 project-graceful-shutdown;fd 不关不会吊住进程,
 * 但退出前最后一笔要确定写完)。
 */
export class DailyLogWriter {
  private fd: number | null = null;
  private day = '';
  private failing = false;
  private lostWhileFailing = 0;
  private closed = false;

  constructor(
    private readonly dir: string,
    /** 写失败 / 恢复时打一行。⚠️ 传原始 console.error,不能传被接管过的 */
    private readonly report: (line: string) => void,
  ) {}

  write(rec: LogRecord): void {
    if (this.closed) return;
    try {
      const d = dayOf(rec.ts);
      if (this.fd === null || d !== this.day) {
        this.closeFd();
        mkdirSync(this.dir, { recursive: true });
        this.fd = openSync(join(this.dir, `${d}.jsonl`), 'a');
        this.day = d;
      }
      writeSync(this.fd, `${JSON.stringify(rec)}\n`);
      if (this.failing) {
        this.failing = false;
        this.report(`[logs] ✅ 落盘恢复(${this.dir});失败期间丢了 ${this.lostWhileFailing} 条`);
        this.lostWhileFailing = 0;
      }
    } catch (err) {
      // 下次重新 open(可能是目录被删、磁盘满后又有空间)
      this.closeFd();
      this.lostWhileFailing += 1;
      if (!this.failing) {
        this.failing = true;
        this.report(`[logs] ⚠️ 落盘失败(${this.dir}):${err instanceof Error ? err.message : String(err)} —— 之后的日志只在终端,恢复时报丢了几条`);
      }
    }
  }

  close(): void {
    this.closeFd();
    this.closed = true;
  }

  private closeFd(): void {
    if (this.fd === null) return;
    try { closeSync(this.fd); } catch { /* 已关 / 已失效:没有可补救的 */ }
    this.fd = null;
  }
}

/** 删掉超过保留天数的分片(按文件名日期,字典序即时间序)。返回删了几个 */
export function sweepLogs(dir: string, now: number, keepDays = LOG_KEEP_DAYS): number {
  const cutoff = dayOf(now - keepDays * 86_400_000);
  let removed = 0;
  for (const stream of ['main', 'page'] as const) {
    let names: string[] = [];
    try { names = readdirSync(join(dir, stream)); } catch { continue; }
    for (const n of names) {
      const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(n);
      if (m && m[1] < cutoff) {
        rmSync(join(dir, stream, n), { force: true });
        removed += 1;
      }
    }
  }
  return removed;
}
