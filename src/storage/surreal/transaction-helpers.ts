/**
 * V2 SurrealStorage 事务内查询 helper
 *
 * decision 020 §4.1 / §5.2 拍板:
 * - `storage.transaction(fn)` 包整段 fn,内部传给 fn 的 `StorageTransaction`
 *   wrapper 通过这 6 个 ViaTx helper 调用 SurrealTransaction 实例上的 query
 * - 6 个 helper 的 SurrealQL 逻辑跟 `SurrealStorage` 同名方法字面一致,
 *   只把 `await db.query(sql, bindings)` 替换为 `await tx.query(sql, bindings)`
 *
 * 关键约束:
 * - 事务内读 uncommitted 写(getAtom 读 putAtom 中间态)已 binary verify(§3.5.bis 场景 4 PASS)
 * - 写入 edge 时校验 subject / object atomId 存在 — 校验也走 tx.query
 *   (保证事务内已 putAtom 的中间态对 putEdge 可见)
 */
import type { SurrealTransaction } from 'surrealdb';
import type {
  StorageOptions,
  PutAtomInput,
  PutEdgeInput,
} from '../api';
import type {
  AtomEntity,
  EdgeEntity,
  AtomDomain,
} from '@semantic/types';
import {
  DEFAULT_OWNER,
  atomRid,
  edgeRid,
  nowMs,
  normalizeAtomEntity,
  normalizeEdgeEntity,
} from './queries-common';
import { generateUlid } from '../ulid';

// ── atom ViaTx ─────────────────────────────────────────────

export async function getAtomViaTx<D extends AtomDomain = AtomDomain>(
  tx: SurrealTransaction,
  id: string,
): Promise<AtomEntity<D> | null> {
  const result = await tx.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM $rid LIMIT 1`,
    { rid: atomRid(id) },
  );
  const row = result[0]?.[0];
  return row ? normalizeAtomEntity<D>(row) : null;
}

export async function putAtomViaTx<D extends AtomDomain = AtomDomain>(
  tx: SurrealTransaction,
  input: PutAtomInput<D>,
  options?: StorageOptions,
): Promise<AtomEntity<D>> {
  const now = nowMs();
  const ownerId = options?.ownerId ?? DEFAULT_OWNER;

  if (input.id) {
    // UPSERT 语义(decision 017 §2.1 + storage.ts 同步)
    const result = await tx.query<[Array<Record<string, unknown>>]>(
      `UPSERT $rid SET
         createdAt = createdAt OR $now,
         updatedAt = $now,
         createdBy = createdBy OR $ownerId,
         payload = $payload
       RETURN AFTER`,
      { rid: atomRid(input.id), payload: input.payload, now, ownerId },
    );
    const row = result[0]?.[0];
    if (!row) throw new Error(`Atom ${input.id} upsert returned no row`);
    return normalizeAtomEntity<D>(row);
  }

  const id = generateUlid();
  await tx.query(
    `CREATE $rid SET createdAt = $now, updatedAt = $now,
                     createdBy = $ownerId, payload = $payload`,
    { rid: atomRid(id), now, ownerId, payload: input.payload },
  );
  return {
    id,
    createdAt: now,
    updatedAt: now,
    createdBy: ownerId,
    payload: input.payload,
  };
}

export async function deleteAtomViaTx(
  tx: SurrealTransaction,
  id: string,
): Promise<{ deleted: boolean; cascadedEdges: number }> {
  // 应用层级联删除关联 edges(storage.ts deleteAtom 同款)
  const edgeRes = await tx.query<[Array<Record<string, unknown>>]>(
    `SELECT id FROM edge
      WHERE subject.atomId = $id
         OR (object.kind = 'atom' AND object.atomId = $id)`,
    { id },
  );
  const cascadedEdges = edgeRes[0]?.length ?? 0;
  if (cascadedEdges > 0) {
    await tx.query(
      `DELETE edge
        WHERE subject.atomId = $id
           OR (object.kind = 'atom' AND object.atomId = $id)`,
      { id },
    );
  }

  const delRes = await tx.query<[Array<unknown>]>(
    `DELETE $rid RETURN BEFORE`,
    { rid: atomRid(id) },
  );
  const deleted = (delRes[0]?.length ?? 0) > 0;
  return { deleted, cascadedEdges };
}

/**
 * SP-1/SP-2:事务内批量删一批 atom + 级联边(storage.bulkDeleteAtomsAndEdges 的 viaTx 版)。
 * 供分批删除每批小事务调用("删这批 + 推进 intent 游标"同一 commit)。
 * INSIDE 数组成员(非 IN)。空 ids 返回 0。
 */
export async function bulkDeleteAtomsAndEdgesViaTx(
  tx: SurrealTransaction,
  ids: string[],
): Promise<{ deletedAtoms: number; deletedEdges: number }> {
  if (ids.length === 0) return { deletedAtoms: 0, deletedEdges: 0 };
  const edgeRes = await tx.query<[Array<unknown>]>(
    `DELETE edge
      WHERE subject.atomId INSIDE $ids
         OR (object.kind = 'atom' AND object.atomId INSIDE $ids)
      RETURN BEFORE`,
    { ids },
  );
  const deletedEdges = edgeRes[0]?.length ?? 0;
  const rids = ids.map((id) => atomRid(id));
  const atomRes = await tx.query<[Array<unknown>]>(
    `DELETE atom WHERE id INSIDE $rids RETURN BEFORE`,
    { rids },
  );
  const deletedAtoms = atomRes[0]?.length ?? 0;
  return { deletedAtoms, deletedEdges };
}

// ── edge ViaTx ─────────────────────────────────────────────

export async function getEdgeViaTx(
  tx: SurrealTransaction,
  id: string,
): Promise<EdgeEntity | null> {
  const result = await tx.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM $rid LIMIT 1`,
    { rid: edgeRid(id) },
  );
  const row = result[0]?.[0];
  return row ? normalizeEdgeEntity(row) : null;
}

export async function putEdgeViaTx(
  tx: SurrealTransaction,
  input: PutEdgeInput,
  options?: StorageOptions,
): Promise<EdgeEntity> {
  const now = nowMs();
  const ownerId = options?.ownerId ?? DEFAULT_OWNER;

  // subject 必须是 atom ref(纯 shape 校验,非 round-trip)
  if (input.subject.kind !== 'atom') {
    throw new Error(`Edge subject must be AtomRef, got kind=${(input.subject as { kind: string }).kind}`);
  }
  // 档 1 perf:删除原 subject/object 的 assertAtomExistsViaTx(每边 1-2 次 SELECT)。
  // 单事务内 subject/object 字面就是本事务刚 putAtom 出的 atom,assert 100% 命中(decision 020
  // §3.5.bis 场景 4 binary verify "事务内读 uncommitted 写" PASS 背书),纯浪费 round-trip。
  // 正确性契约:caller(受控 capability,如 createNotesBatch import 路径)在应用层构造
  // tmpToReal 映射并 throw if 悬空引用(capability-impl.ts createSingleNoteFromDrafts),
  // atomId 引用正确性已由应用层保证,不依赖 storage 层逐边 SELECT 校验。
  // 未来若新增非受控 caller 需校验,在 storage 层另加批量 tx.assertAtomsExist(ids[]) API,
  // 不恢复每边逐次 assert。

  const baseAttrs: Record<string, unknown> = { ...input.attrs };
  if (baseAttrs.createdBy === undefined || baseAttrs.createdBy === '') {
    baseAttrs.createdBy = ownerId;
  }
  if (baseAttrs.createdAt === undefined) {
    baseAttrs.createdAt = now;
  }

  if (input.id) {
    const result = await tx.query<[Array<Record<string, unknown>>]>(
      `UPDATE $rid SET predicate = $predicate, subject = $subject, object = $object,
                       attrs = $attrs, updatedAt = $now RETURN AFTER`,
      {
        rid: edgeRid(input.id),
        predicate: input.predicate,
        subject: input.subject,
        object: input.object,
        attrs: baseAttrs,
        now,
      },
    );
    const row = result[0]?.[0];
    if (!row) throw new Error(`Edge ${input.id} not found`);
    return normalizeEdgeEntity(row);
  }

  const id = generateUlid();
  await tx.query(
    `CREATE $rid SET createdAt = $now, updatedAt = $now,
                     predicate = $predicate, subject = $subject,
                     object = $object, attrs = $attrs`,
    {
      rid: edgeRid(id), now,
      predicate: input.predicate,
      subject: input.subject,
      object: input.object,
      attrs: baseAttrs,
    },
  );
  return {
    id,
    createdAt: now,
    updatedAt: now,
    predicate: input.predicate,
    subject: input.subject,
    object: input.object,
    attrs: baseAttrs as EdgeEntity['attrs'],
  };
}

export async function deleteEdgeViaTx(
  tx: SurrealTransaction,
  id: string,
): Promise<{ deleted: boolean }> {
  const result = await tx.query<[Array<unknown>]>(
    `DELETE $rid RETURN BEFORE`,
    { rid: edgeRid(id) },
  );
  return { deleted: (result[0]?.length ?? 0) > 0 };
}

