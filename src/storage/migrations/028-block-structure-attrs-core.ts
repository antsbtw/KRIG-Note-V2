/**
 * Migration 028 core — 纯逻辑(无 electron / 无 flag 文件),可单测。
 *
 * 把每篇 note 的结构边迁移成 block atom 属性 + 删结构边。算法详见
 * 028-block-structure-attrs.ts 的文件头(electron wrapper)。
 */

import { storage } from '@storage/index';
import type { AtomEntity, EdgeEntity, PmPayload } from '@semantic/types';
import { assemblePmDoc, buildPmNode } from '@platform/main/note/assemble-pm-doc';
import { dissectPmDoc } from '@platform/main/note/dissect-pm-doc';
import { applyRebuildRules } from '@platform/main/note/structural-rebuild-rules';

const NOTE_DOMAIN = 'pm';
const HAS_NOTE_VIEW_PREDICATE = 'user:krig:hasNoteView';
const HAS_READING_THOUGHT_PREDICATE = 'user:krig:hasReadingThought';
const BELONGS_TO_NOTE_PREDICATE = 'user:krig:belongsToNote';
const NEXT_SIBLING_PREDICATE = 'user:krig:nextSibling';
const CHILD_OF_PREDICATE = 'user:krig:childOf';

/**
 * legacy 边路径拓扑排序(从旧 assemble-pm-doc 迁移来,migration 028 专用 —— 生产 assemble
 * Phase 4 已删此路径)。在 sibling 集合内按 nextSibling 链排序,链断裂 fallback 字典序。
 */
function topologicalSortSiblings(atomIds: string[], nextSiblingEdges: EdgeEntity[]): string[] {
  if (atomIds.length === 0) return [];
  const idSet = new Set(atomIds);
  const nextMap = new Map<string, string>();
  const hasIncoming = new Set<string>();
  for (const e of nextSiblingEdges) {
    const subjId = e.subject.atomId;
    if (e.object.kind !== 'atom') continue;
    const objId = e.object.atomId;
    if (!idSet.has(subjId) || !idSet.has(objId)) continue;
    if (nextMap.has(subjId)) continue; // cardinality ≤1:取首条(重复边在此被去重 = keep-latest 思路)
    nextMap.set(subjId, objId);
    hasIncoming.add(objId);
  }
  const heads = atomIds.filter((id) => !hasIncoming.has(id));
  if (heads.length === 0) return [...atomIds].sort(); // 全环(坏数据)→ 字典序兜底
  heads.sort();
  const visited = new Set<string>();
  const result: string[] = [];
  for (const head of heads) {
    let cursor: string | undefined = head;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      result.push(cursor);
      cursor = nextMap.get(cursor);
    }
  }
  if (visited.size < atomIds.length) {
    result.push(...atomIds.filter((id) => !visited.has(id)).sort());
  }
  return result;
}

/**
 * legacy 边路径 assemble(migration 028 专用):读 belongsToNote/childOf/nextSibling 边
 * 拼出正确顺序的 PM doc。带 keep-latest 去重(topologicalSortSiblings 取首条出边)→
 * 修复重复边导致的乱序。复用 buildPmNode + applyRebuildRules(与属性路径同一重建逻辑)。
 */
async function assembleViaEdges(containerId: string): Promise<PmPayload> {
  const belongsEdges = await storage.listEdges({
    predicate: BELONGS_TO_NOTE_PREDICATE,
    objectAtomId: containerId,
  });
  const blockIds = belongsEdges.map((e) => e.subject.atomId);
  if (blockIds.length === 0) return { type: 'doc', content: [] };

  const blockAtomsRaw = await storage.listAtoms({ domain: NOTE_DOMAIN, atomIds: blockIds });
  const blocksById = new Map<string, AtomEntity<'pm'>>();
  for (const a of blockAtomsRaw) blocksById.set(a.id, a as AtomEntity<'pm'>);

  const [nextSiblingRaw, childOfRaw] = await Promise.all([
    storage.listEdges({ predicate: NEXT_SIBLING_PREDICATE, subjectAtomIds: blockIds }),
    storage.listEdges({ predicate: CHILD_OF_PREDICATE, subjectAtomIds: blockIds }),
  ]);
  const blockIdSet = new Set(blockIds);
  const nextSiblingEdges = nextSiblingRaw.filter(
    (e) => e.object.kind === 'atom' && blockIdSet.has(e.object.atomId),
  );
  const childOfEdges = childOfRaw.filter(
    (e) => e.object.kind === 'atom' && (e.object.atomId === containerId || blockIdSet.has(e.object.atomId)),
  );

  const childrenByParent = new Map<string, string[]>();
  const hasChildOf = new Set<string>();
  for (const e of childOfEdges) {
    if (e.object.kind !== 'atom') continue;
    const parent = e.object.atomId;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent)!.push(e.subject.atomId);
    hasChildOf.add(e.subject.atomId);
  }
  const topLevelIds = blockIds.filter((id) => !hasChildOf.has(id));
  const sortByEdges = (ids: string[]): string[] => topologicalSortSiblings(ids, nextSiblingEdges);

  const topNodes: PmPayload[] = [];
  for (const id of sortByEdges(topLevelIds)) {
    const node = buildPmNode(id, blocksById, childrenByParent, sortByEdges);
    if (node) topNodes.push(node);
  }
  return { type: 'doc', content: applyRebuildRules(topNodes) };
}

/**
 * 读迁移前的正确 doc:
 *  - 仍有 belongsToNote 边(老边数据)→ 走 legacy 边路径(带去重修复)
 *  - 无边(已迁移 / 新建的属性数据)→ 走生产属性路径 assemblePmDoc
 */
async function readPreMigration(noteId: string): Promise<PmPayload | null> {
  const belongs = await storage.listEdges({
    predicate: BELONGS_TO_NOTE_PREDICATE,
    objectAtomId: noteId,
    limit: 1,
  });
  if (belongs.length > 0) return assembleViaEdges(noteId);
  return assemblePmDoc(noteId);
}

export type MigrateNoteResult = 'migrated' | 'skipped' | 'empty';

export interface Migrate028Summary {
  total: number;
  migrated: number;
  skipped: number;
  empty: number;
  failed: number;
}

/**
 * 稳定序列化(key 排序)+ 剥除 028 内部属性(noteId/parentId/order),
 * 用于 pre(边路径,无内部属性)vs post(属性路径,有内部属性)的等价比对。
 */
export function structuralHash(node: PmPayload): string {
  return stableStringify(stripInternal(node));
}

function stripInternal(node: PmPayload): PmPayload {
  const out: PmPayload = { type: node.type };
  if (node.attrs !== undefined) {
    const a: Record<string, unknown> = { ...node.attrs };
    delete a.noteId;
    delete a.parentId;
    delete a.order;
    out.attrs = a;
  }
  if (node.text !== undefined) out.text = node.text;
  if (node.marks !== undefined) out.marks = node.marks;
  if (Array.isArray(node.content)) out.content = node.content.map(stripInternal);
  return out;
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

/** 删除一篇 note 的所有结构边(belongsToNote/childOf/nextSibling)。返回删除条数。 */
async function deleteStructuralEdges(noteId: string, blockIds: string[]): Promise<number> {
  let deleted = 0;
  await storage.transaction(async (tx) => {
    const belongs = await storage.listEdges({
      predicate: 'user:krig:belongsToNote',
      objectAtomId: noteId,
    });
    for (const e of belongs) {
      await tx.deleteEdge(e.id);
      deleted++;
    }
    if (blockIds.length > 0) {
      for (const predicate of ['user:krig:childOf', 'user:krig:nextSibling'] as const) {
        const edges = await storage.listEdges({ predicate, subjectAtomIds: blockIds });
        for (const e of edges) {
          await tx.deleteEdge(e.id);
          deleted++;
        }
      }
    }
  });
  return deleted;
}

/**
 * 迁移单篇 note:
 *  - 'migrated':写属性 + round-trip 一致 + 删边成功
 *  - 'skipped' :已写属性但 round-trip 不一致 → 保留边(保守)
 *  - 'empty'   :空 note(无块)
 */
export async function migrateNote(noteId: string): Promise<MigrateNoteResult> {
  // 1. 读正确序(老边数据走 legacy 边路径去重修复 / 已迁移走属性路径)
  const pre = await readPreMigration(noteId);
  if (!pre || !Array.isArray(pre.content) || pre.content.length === 0) {
    await deleteStructuralEdges(noteId, []); // 清残留边(防御)
    return 'empty';
  }
  const preHash = structuralHash(pre);

  // 2. 重新 dissect 成属性形态
  const dis = dissectPmDoc(noteId, pre);

  // 3. 批量写 block atom(UPSERT 幂等)
  await storage.transaction(async (tx) => {
    for (const b of dis.blocks) {
      await tx.putAtom<'pm'>({ id: b.id, payload: { domain: NOTE_DOMAIN, payload: b.payload } });
    }
  });

  // 4. round-trip 校验:重读(全带属性 → 属性路径)与 pre 比对
  const post = await assemblePmDoc(noteId);
  if (!post || structuralHash(post) !== preHash) {
    console.warn(
      `[migration/028] round-trip MISMATCH on note ${noteId}; ` +
        `属性已写但**保留结构边**(保守,留人工排查 / 下次重试)`,
    );
    return 'skipped';
  }

  // 5. 一致 → 删该 note 所有结构边
  const blockIds = dis.blocks.map((b) => b.id);
  const deleted = await deleteStructuralEdges(noteId, blockIds);
  console.log(
    `[migration/028] note ${noteId} migrated: ${dis.blocks.length} blocks, deleted ${deleted} structural edges`,
  );
  return 'migrated';
}

/**
 * 迁移所有 note(串行)。返回汇总。不写 flag —— flag 由 electron wrapper 据汇总判定。
 */
export async function migrateAllNotes(): Promise<Migrate028Summary> {
  // 1. 普通 note container(hasNoteView marker)
  const noteAtoms = await storage.listMarkerAtoms<'pm'>({
    domain: NOTE_DOMAIN,
    markerPredicate: HAS_NOTE_VIEW_PREDICATE,
    markerObjectMatch: { kind: 'literal', type: 'boolean', value: true },
  });

  // 2. reading-thought container(hasReadingThought 边的 object = thought pm atom id)。
  // D-10:reading-thought 走同一 assemble/dissect 结构路径,也必须迁移(否则 Phase 4
  // 删边 fallback 后旧 thought doc 不可读)。去重(可能与 note 集合不重叠,但保险起见)。
  const rtEdges = await storage.listEdges({ predicate: HAS_READING_THOUGHT_PREDICATE });
  const containerIds = new Set<string>(noteAtoms.map((a) => a.id));
  for (const e of rtEdges) {
    if (e.object.kind === 'atom') containerIds.add(e.object.atomId);
  }
  const allIds = [...containerIds];

  const summary: Migrate028Summary = {
    total: allIds.length,
    migrated: 0,
    skipped: 0,
    empty: 0,
    failed: 0,
  };
  if (allIds.length === 0) return summary;

  console.log(
    `[migration/028] migrating ${allIds.length} containers ` +
      `(${noteAtoms.length} notes + ${allIds.length - noteAtoms.length} reading-thoughts) (serial)`,
  );
  const t0 = Date.now();
  for (const id of allIds) {
    try {
      const r = await migrateNote(id);
      summary[r]++;
    } catch (err) {
      summary.failed++;
      console.warn(`[migration/028] failed for container ${id}:`, err);
    }
    const done = summary.migrated + summary.skipped + summary.empty + summary.failed;
    if (done % 10 === 0) console.log(`[migration/028] progress: ${done}/${allIds.length}`);
  }
  const elapsed = Date.now() - t0;
  console.log(
    `[migration/028] done — migrated=${summary.migrated} skipped(mismatch)=${summary.skipped} ` +
      `empty=${summary.empty} failed=${summary.failed} total=${summary.total} elapsed=${elapsed}ms`,
  );
  return summary;
}
