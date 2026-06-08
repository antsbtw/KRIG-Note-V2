/**
 * diff-block-tree — L7 block atomization Stage 2 Step 2.3
 *
 * 比较 oldDoc / newDoc(都是完整 PM doc),输出 atom + edge 的增量。
 *
 * 实施依据:
 * - decision 026 §5.6 undo 通过 diff 路径自然恢复(added 路径重建 atom)
 * - decision 026 §8.3 写时拆解 + diff 算法
 * - decision 026 §9.4 PM step 不直接映射 atom 写入,doc 终态差异 → atom diff
 *
 * 不变量:
 * - oldDoc / newDoc 都已通过 dissectPmDoc 拆解为 atom + edge 集合
 * - block id 是稳定 key(attrs.id 由 buildAutoBlockIdPlugin 注入或 migration 写入)
 * - diff 输出可直接喂 storage.transaction 字面拼装 putAtom / deleteAtom / putEdge / deleteEdge
 *
 * 边 diff 用规范字符串 key:`<predicate>|<subjectId>|<objectId>`。
 */

import type { PmPayload } from '@semantic/types';
import { dissectPmDoc } from './dissect-pm-doc';

export interface BlockDiff {
  /** newDoc 有 / oldDoc 没有 — putAtom(create with id) */
  added: Array<{ id: string; payload: PmPayload }>;
  /** 都有但 payload 字面变(含 028 结构属性 order/parentId 变化)— putAtom(update by id) */
  modified: Array<{ id: string; payload: PmPayload }>;
  /** oldDoc 有 / newDoc 没有 — deleteAtom */
  removedIds: string[];
}

/**
 * 稳定 JSON stringify 用于 payload 字面相等比较。
 *
 * JSON.stringify 字面对 object key 顺序敏感,递归字面排序 key 让相同语义的 payload
 * 产生相同 string。(性能足够 — block atom payload 字面深度浅,1000 block 数量级。)
 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) {
    return '[' + v.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

/**
 * 比较两个 dissect 结果,输出 atom + edge 的增量。
 *
 * @param oldDoc — 上一版 PM doc(若 cache miss 由 assemblePmDoc 拼装)
 * @param newDoc — 本次 update 写入的 PM doc(已通过 buildAutoBlockIdPlugin)
 * @param containerId — note container id(or reading-thought container,D-10)
 */
export function diffBlockTree(
  oldDoc: PmPayload,
  newDoc: PmPayload,
  containerId: string,
): BlockDiff {
  const oldDis = dissectPmDoc(containerId, oldDoc);
  const newDis = dissectPmDoc(containerId, newDoc);

  // atom diff(按 id 索引)
  const oldBlocks = new Map<string, PmPayload>();
  for (const b of oldDis.blocks) oldBlocks.set(b.id, b.payload);
  const newBlocks = new Map<string, PmPayload>();
  for (const b of newDis.blocks) newBlocks.set(b.id, b.payload);

  const added: BlockDiff['added'] = [];
  const modified: BlockDiff['modified'] = [];
  const removedIds: string[] = [];

  for (const [id, payload] of newBlocks) {
    const oldPayload = oldBlocks.get(id);
    if (!oldPayload) {
      added.push({ id, payload });
    } else if (stableStringify(payload) !== stableStringify(oldPayload)) {
      modified.push({ id, payload });
    }
  }
  for (const id of oldBlocks.keys()) {
    if (!newBlocks.has(id)) {
      removedIds.push(id);
    }
  }

  // Decision 028:零结构边。文档结构(order/parentId/noteId)由 dissect 写进 block atom
  // 的 attrs —— 位置/父级变化 = atom payload 变化 = 上方 modified 路径自然捕获(stableStringify 含 attrs)。
  return { added, modified, removedIds };
}

/**
 * 字面预生成空 diff(create / 空 oldDoc 场景下与 newDoc 单 dissect 等价)。
 *
 * 用法:createNote 字面没有 oldDoc 时,直接 dissect newDoc 全部当 added 写入。
 */
export function fullCreateDiff(
  newDoc: PmPayload,
  containerId: string,
): BlockDiff {
  const dis = dissectPmDoc(containerId, newDoc);
  // Decision 028:零结构边 —— block atom 自带 noteId/parentId/order 属性,
  // 结构完整自洽,createNote 只 putAtom(全 added)。
  return { added: dis.blocks, modified: [], removedIds: [] };
}
