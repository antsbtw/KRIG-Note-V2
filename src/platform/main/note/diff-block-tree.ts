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
import { dissectPmDoc, type DissectResult } from './dissect-pm-doc';

export interface BlockDiff {
  /** newDoc 有 / oldDoc 没有 — putAtom(create with id) */
  added: Array<{ id: string; payload: PmPayload }>;
  /** 都有但 payload 字面变 — putAtom(update by id) */
  modified: Array<{ id: string; payload: PmPayload }>;
  /** oldDoc 有 / newDoc 没有 — deleteAtom(级联删边)*/
  removedIds: string[];
  /** newDoc 有的边集合(predicate / subjectId / objectId)— 字面待 putEdge */
  addedEdges: Array<{ predicate: string; subjectId: string; objectId: string }>;
  /** oldDoc 有 / newDoc 没有的边集合 — 字面待 deleteEdge */
  removedEdges: Array<{ predicate: string; subjectId: string; objectId: string }>;
}

const BELONGS_TO_NOTE_PREDICATE = 'user:krig:belongsToNote';
const NEXT_SIBLING_PREDICATE = 'user:krig:nextSibling';
const CHILD_OF_PREDICATE = 'user:krig:childOf';

interface EdgeRecord {
  predicate: string;
  subjectId: string;
  objectId: string;
}

function dissectToEdgeRecords(d: DissectResult): EdgeRecord[] {
  const records: EdgeRecord[] = [];
  for (const e of d.belongsEdges) {
    records.push({ predicate: BELONGS_TO_NOTE_PREDICATE, ...e });
  }
  for (const e of d.nextSiblingEdges) {
    records.push({ predicate: NEXT_SIBLING_PREDICATE, ...e });
  }
  for (const e of d.childOfEdges) {
    records.push({ predicate: CHILD_OF_PREDICATE, ...e });
  }
  return records;
}

function edgeKey(r: EdgeRecord): string {
  return `${r.predicate}|${r.subjectId}|${r.objectId}`;
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

  // edge diff(按规范化字符串 key 索引)
  const oldEdges = dissectToEdgeRecords(oldDis);
  const newEdges = dissectToEdgeRecords(newDis);
  const oldEdgeKeys = new Set(oldEdges.map(edgeKey));
  const newEdgeKeys = new Set(newEdges.map(edgeKey));

  const addedEdges: BlockDiff['addedEdges'] = [];
  const removedEdges: BlockDiff['removedEdges'] = [];

  for (const e of newEdges) {
    if (!oldEdgeKeys.has(edgeKey(e))) addedEdges.push(e);
  }
  for (const e of oldEdges) {
    if (!newEdgeKeys.has(edgeKey(e))) removedEdges.push(e);
  }

  // 字面优化:被 removed 的 atom 字面级联删所有相关边(storage.deleteAtom 字面已做),
  // 这里**剔除**已在 removedIds 内的 atom 的边记录,避免事务内冗余 deleteEdge → putEdge cycle
  const removedIdSet = new Set(removedIds);
  const filteredRemovedEdges = removedEdges.filter(
    (e) => !removedIdSet.has(e.subjectId) && !removedIdSet.has(e.objectId),
  );

  return {
    added,
    modified,
    removedIds,
    addedEdges,
    removedEdges: filteredRemovedEdges,
  };
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
  const edges = dissectToEdgeRecords(dis);
  return {
    added: dis.blocks,
    modified: [],
    removedIds: [],
    addedEdges: edges,
    removedEdges: [],
  };
}
