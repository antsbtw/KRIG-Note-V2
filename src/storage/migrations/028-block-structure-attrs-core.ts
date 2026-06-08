/**
 * Migration 028 core — 纯逻辑(无 electron / 无 flag 文件),可单测。
 *
 * 把每篇 note 的结构边迁移成 block atom 属性 + 删结构边。算法详见
 * 028-block-structure-attrs.ts 的文件头(electron wrapper)。
 */

import { storage } from '@storage/index';
import type { PmPayload } from '@semantic/types';
import { assemblePmDoc } from '@platform/main/note/assemble-pm-doc';
import { dissectPmDoc } from '@platform/main/note/dissect-pm-doc';

const NOTE_DOMAIN = 'pm';
const HAS_NOTE_VIEW_PREDICATE = 'user:krig:hasNoteView';

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
  // 1. 读正确序(旧边路径去重 / 新属性路径)
  const pre = await assemblePmDoc(noteId);
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
  const noteAtoms = await storage.listMarkerAtoms<'pm'>({
    domain: NOTE_DOMAIN,
    markerPredicate: HAS_NOTE_VIEW_PREDICATE,
    markerObjectMatch: { kind: 'literal', type: 'boolean', value: true },
  });

  const summary: Migrate028Summary = {
    total: noteAtoms.length,
    migrated: 0,
    skipped: 0,
    empty: 0,
    failed: 0,
  };
  if (noteAtoms.length === 0) return summary;

  console.log(`[migration/028] migrating ${noteAtoms.length} notes (serial)`);
  const t0 = Date.now();
  for (const atom of noteAtoms) {
    try {
      const r = await migrateNote(atom.id);
      summary[r]++;
    } catch (err) {
      summary.failed++;
      console.warn(`[migration/028] failed for note ${atom.id}:`, err);
    }
    const done = summary.migrated + summary.skipped + summary.empty + summary.failed;
    if (done % 10 === 0) console.log(`[migration/028] progress: ${done}/${noteAtoms.length}`);
  }
  const elapsed = Date.now() - t0;
  console.log(
    `[migration/028] done — migrated=${summary.migrated} skipped(mismatch)=${summary.skipped} ` +
      `empty=${summary.empty} failed=${summary.failed} total=${summary.total} elapsed=${elapsed}ms`,
  );
  return summary;
}
