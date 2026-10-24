/**
 * 守卫共用:renderer 发得出的 op,IPC 有没有人接(2026-10-24,Module5-04 第 3 步)
 * 「有人接」两种:switch 里的 case,或 op → 能力对照表(CAP_OF_OP)里的一行 —— 迁到能力层的 op 走后者。
 * ⚠️ 契约有、handler 没有 = 点了回「不认识的 op」,静默失败。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');

export const IPC_SRC = (): string => read('src/modules/x/x-data-ipc.ts');

/** op 迁到了哪个能力(对照表里没有 = undefined) */
export function capOfOp(ipc: string, op: string): string | undefined {
  const a = ipc.indexOf('const CAP_OF_OP');
  if (a < 0) return undefined;
  const table = ipc.slice(a, ipc.indexOf('};', a));
  return new RegExp(`\\b${op}: '([\\w.]+)'`).exec(table)?.[1];
}

export function ipcHandles(ipc: string, op: string): boolean {
  return ipc.includes(`case '${op}':`) || capOfOp(ipc, op) !== undefined;
}

/** 读库能力的登记块(x-capabilities-read.ts 里 `read({ id: '<id>', … })` 那一段) */
export function readCapBlock(id: string): string {
  const src = read('src/modules/x/x-capabilities-read.ts');
  const i = src.indexOf(`id: '${id}'`);
  if (i < 0) return '';
  const j = src.indexOf('\n  read({', i);
  return src.slice(i, j < 0 ? undefined : j);
}
