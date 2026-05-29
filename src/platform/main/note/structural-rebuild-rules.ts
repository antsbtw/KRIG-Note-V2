/**
 * structural-rebuild-rules — 顶层 children grouping 规则注册表 (5B §7.3.2)
 *
 * 决议依据:
 * - decision 026 §13.8 集中可扩展位置
 * - 5B §7.3.2 拍板: list / taskList / columnList 走"连续段 grouping"模式;
 *   table 走"childOf 边重组"独立路径 (assemble-table.ts)
 *
 * 算法形态:
 * - 输入: 已按 nextSibling 排序的顶层 children 序列 (含被剥过 _assemblyHints 的)
 * - 输出: PM doc.content 数组 (中间 wrapper 已重建)
 * - 每条 rule 按 triggerChildType 识别本组首 child, 字面消耗连续段, 输出单 wrapper
 *
 * 扩展方式 (未来 grid / flexbox / layout): push 新 RebuildRule 到 STRUCTURAL_REBUILD_RULES
 * + 同步 src/semantic/types/structural.ts STRUCTURAL_CONTAINER_TYPES (5B §7.3.1).
 */

import type { PmPayload } from '@semantic/types';
import { stripAssemblyHints, type BlockAtomPayload } from './assemble-pm-doc-helpers';

interface RebuildContext {
  /** 当前正在 rebuild 的 children 序列 (尚未 stripAssemblyHints) */
  children: PmPayload[];
  /** 当前游标 index */
  i: number;
}

interface RebuildResult {
  /** rebuild 出的 PM wrapper node */
  wrapper: PmPayload;
  /** rule 消耗了多少 children (调用方 i += consumed) */
  consumed: number;
}

type RebuildRule = (ctx: RebuildContext) => RebuildResult | null;

/**
 * listItem 连续段 → bulletList / orderedList (按首项 _assemblyHints.listType 决定)
 */
function rebuildList(ctx: RebuildContext): RebuildResult | null {
  if (ctx.children[ctx.i].type !== 'listItem') return null;
  const group: PmPayload[] = [];
  let listType: 'bullet' | 'ordered' = 'bullet';
  let j = ctx.i;
  while (j < ctx.children.length && ctx.children[j].type === 'listItem') {
    const hint = (ctx.children[j] as BlockAtomPayload)._assemblyHints?.listType;
    if (hint === 'ordered') listType = 'ordered';
    group.push(stripAssemblyHints(ctx.children[j]));
    j++;
  }
  const wrapType = listType === 'ordered' ? 'orderedList' : 'bulletList';
  return {
    wrapper: { type: wrapType, content: group },
    consumed: j - ctx.i,
  };
}

/**
 * taskItem 连续段 → taskList (无歧义)
 */
function rebuildTaskList(ctx: RebuildContext): RebuildResult | null {
  if (ctx.children[ctx.i].type !== 'taskItem') return null;
  const group: PmPayload[] = [];
  let j = ctx.i;
  while (j < ctx.children.length && ctx.children[j].type === 'taskItem') {
    group.push(stripAssemblyHints(ctx.children[j]));
    j++;
  }
  return {
    wrapper: { type: 'taskList', content: group },
    consumed: j - ctx.i,
  };
}

/**
 * column 连续段 → columnList (无歧义)
 */
function rebuildColumnList(ctx: RebuildContext): RebuildResult | null {
  if (ctx.children[ctx.i].type !== 'column') return null;
  const group: PmPayload[] = [];
  let j = ctx.i;
  while (j < ctx.children.length && ctx.children[j].type === 'column') {
    group.push(stripAssemblyHints(ctx.children[j]));
    j++;
  }
  return {
    wrapper: { type: 'columnList', content: group },
    consumed: j - ctx.i,
  };
}

export const STRUCTURAL_REBUILD_RULES: ReadonlyArray<{
  triggerChildType: string;
  rule: RebuildRule;
}> = [
  { triggerChildType: 'listItem', rule: rebuildList },
  { triggerChildType: 'taskItem', rule: rebuildTaskList },
  { triggerChildType: 'column', rule: rebuildColumnList },
];

/**
 * 应用注册表: 遍历 children, 命中 rule 时消耗连续段; 否则原样放入 result.
 *
 * **table 字面不走本规则** (table 是 atom, 其 cells 在 storage 中通过 childOf 边
 * 挂回 table atom; assemble-pm-doc 主流程对 table atom 调 assembleTable 单独处理).
 */
export function applyRebuildRules(children: PmPayload[]): PmPayload[] {
  const result: PmPayload[] = [];
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    let matched: RebuildResult | null = null;
    for (const { triggerChildType, rule } of STRUCTURAL_REBUILD_RULES) {
      if (child.type === triggerChildType) {
        matched = rule({ children, i });
        if (matched) break;
      }
    }
    if (matched) {
      result.push(matched.wrapper);
      i += matched.consumed;
      continue;
    }
    // tableCell / tableHeader 不会出现在顶层 child 序列 (它们 childOf 挂到 table atom,
    // 由 assemble-table.ts 单独处理). 其它叶子/叶子级容器原样保留.
    result.push(stripAssemblyHints(child));
    i++;
  }
  return result;
}
