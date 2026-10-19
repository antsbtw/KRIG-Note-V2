/**
 * ⭐ 终端日志落盘 —— 接管主进程 `console.*`,**照常打到终端,同时写一行进文件**
 *
 * 以前主进程日志只在启动 app 的那个终端里,AI 看不到,只能请用户复制。
 *
 * ── 约束 ──
 * - 终端输出**一字不变**:先调原方法,再落盘
 * - 落盘失败只经 `report`(原始 console.error)响,不进文件 → 不递归
 * - 重入保护:落盘过程中若又有人打 console(不应该,但防万一),只走终端
 * - `stop()` 还原原方法(测试 / 退出用)
 */

import { format } from 'node:util';
import { clipMsg, type DailyLogWriter } from './log-file';

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type Method = (typeof METHODS)[number];

/** 级别名统一成 page 流那边 Chromium 的四种,方便一起筛 */
const LEVEL: Record<Method, 'info' | 'warning' | 'error' | 'debug'> = {
  log: 'info', info: 'info', warn: 'warning', error: 'error', debug: 'debug',
};

export type ConsoleTap = { stop(): void };

export function tapMainConsole(writer: DailyLogWriter, run: string, now: () => number = Date.now): ConsoleTap {
  const original = new Map<Method, (...args: unknown[]) => void>();
  let inTap = false;
  for (const m of METHODS) {
    const orig = console[m] as (...args: unknown[]) => void;
    original.set(m, orig);
    console[m] = (...args: unknown[]): void => {
      orig.apply(console, args);
      if (inTap) return;
      inTap = true;
      try {
        writer.write({ ts: now(), run, level: LEVEL[m], ...clipMsg(format(...args)) });
      } finally {
        inTap = false;
      }
    };
  }
  return {
    stop(): void {
      for (const [m, orig] of original) console[m] = orig;
      original.clear();
    },
  };
}
