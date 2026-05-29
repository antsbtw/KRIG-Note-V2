/**
 * assemble-pm-doc-helpers — assemble 路径共享小工具 (5B Stage 4 拆出)
 *
 * 抽出动机: stripAssemblyHints 与 BlockAtomPayload 同时被
 * assemble-pm-doc.ts / structural-rebuild-rules.ts / assemble-table.ts 三处消费,
 * 避免循环 import.
 */

import type { PmPayload } from '@semantic/types';

/** dissect 写入 / assemble 读取后剥除的非 PM schema 提示字段 */
export type AssemblyHints = {
  /** listItem 用 — 区分 bulletList vs orderedList (taskItem 字面是另一 NodeSpec, 无此歧义) */
  listType?: 'bullet' | 'ordered';
};

/** payload 顶层非 PM schema 字段的辅助提示 */
export interface BlockAtomPayload extends PmPayload {
  _assemblyHints?: AssemblyHints;
}

/**
 * 剥除非 PM schema 字段 (_assemblyHints). PM nodeFromJSON 字面也会 strip
 * 未声明字段, 这里显式做让输出 PmPayload 干净便于上层 diff / hash.
 */
export function stripAssemblyHints(node: PmPayload): PmPayload {
  const result: PmPayload = { type: node.type };
  if (node.attrs !== undefined) result.attrs = node.attrs;
  if (node.content !== undefined) result.content = node.content;
  if (node.marks !== undefined) result.marks = node.marks;
  if (node.text !== undefined) result.text = node.text;
  return result;
}
