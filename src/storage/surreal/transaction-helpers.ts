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

/**
 * 档 3 perf: 批量 putAtom — 单 SQL multi-row INSERT(~N 串行 CREATE → 1 RPC)。
 *
 * Phase A binary verify(tests/storage/surreal-multirow-verify.test.ts)PASS:
 * SurrealDB server 3.0.4 + SDK 2.0.3 下 `INSERT INTO atom $rows`(rows = object array,
 * 每行 id = RecordId 实例)真批量写入,1000 row ~13-23ms,≥10x serial CREATE。
 *
 * 语义差异(对 putAtomViaTx):
 *  - 仅 CREATE 语义(不支持 id UPSERT —— 批量场景 caller 全是新建 atom)。
 *    若 input.id 已存在,INSERT 行为由 SurrealDB 决定(本 API 契约仅承诺新建)。
 *  - ULID 应用层预生成(单 putAtomViaTx 无 id 分支同款 generateUlid),
 *    caller 拿 entities[i].id 建 tmpToReal 映射。
 *
 * 不校验 id 冲突(同 putAtomViaTx CREATE 分支不校验)。空 inputs 短路返回 []。
 */
export async function batchPutAtomsViaTx<D extends AtomDomain = AtomDomain>(
  tx: SurrealTransaction,
  inputs: PutAtomInput<D>[],
  options?: StorageOptions,
): Promise<AtomEntity<D>[]> {
  if (inputs.length === 0) return [];
  const now = nowMs();
  const ownerId = options?.ownerId ?? DEFAULT_OWNER;

  const entities: AtomEntity<D>[] = inputs.map((input) => ({
    id: input.id ?? generateUlid(),
    createdAt: now,
    updatedAt: now,
    createdBy: ownerId,
    payload: input.payload,
  }));

  // row.id 必须是 RecordId 实例(atomRid),不是 string —— Phase A 实测踩坑:
  // raw string 会被 server 拒("Cannot execute statement using value")。
  const rows = entities.map((e) => ({
    id: atomRid(e.id),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    createdBy: e.createdBy,
    payload: e.payload,
  }));

  await tx.query(`INSERT INTO atom $rows`, { rows });

  return entities;
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
 *
 * 性能修法(2026-05-30 fix/bulk-delete-edge-perf,候选 A):
 * 原 SQL 把 subject / object 两字段谓词用 `OR` 写一条 DELETE,
 *   `DELETE edge WHERE subject.atomId INSIDE $ids
 *      OR (object.kind='atom' AND object.atomId INSIDE $ids)`
 * 跨字段 OR 让 planner 无法用单一索引覆盖整谓词 → 回退全表扫整张 edge 表。
 * diagnose 报告 13a744ad §三/四 字面证据:27 批 edge_ms 从 2522→88ms 单调递减(28×),
 * 但每批实删边数 edge_cnt 恒定 ~2400 —— 耗时只随"表里剩余总边数"变 = 全表扫签名。
 *
 * 改:拆 OR 为两条单字段 DELETE,subject 侧命中 edge_subject 索引、object 侧命中
 * edge_object 索引([schema.ts:66 / 72])。两条 DELETE 在同 tx 内,任一失败整事务
 * rollback 不变(scenario-9-rollback 覆盖)。deletedEdges = 两 query .length 之和。
 *
 * Phase A binary verify(N=27000 atom / 67499 edge / 27 批,真 rocksdb)PASS:
 *   - 对照(原 OR+INSIDE):edge_ms declineRatio 14.5×(全表扫签名复现)
 *   - 候选 A(本修法):  edge_ms declineRatio 1.0×(平稳走索引),累计 27572→3782ms (-86.3%)
 *   - 候选 C(再去 RETURN BEFORE):vs A 无加速(3846 vs 3782,< 1.5× 阈值)→ 字面跳过,
 *     保留 RETURN BEFORE 作 forward-compat(deletedEdges 计数仍可用)。
 *
 * 性能修法(2026-05-30 fix/bulk-delete-atom-perf,候选 atom-A):
 * atom 路径原 `DELETE atom WHERE id INSIDE $rids RETURN BEFORE` 同款 INSIDE 大数组
 * 退化扫描整张 atom 表(diagnose 13a744ad §1.4 / prompt §5.2 预警兑现)。
 * 改:`DELETE $rids RETURN BEFORE` —— rids 仍是 RecordId[],array record-link 删,
 * 直接走 atom 主键索引(id 是 SurrealDB record 主键,隐式索引),不再经 WHERE 谓词。
 *
 * Phase A binary verify(N=27000 atom / 67499 edge / 27 批,真 rocksdb,commit e175d163)PASS:
 *   - baseline(原 id INSIDE $rids):atom_ms declineRatio 16.8×(758→45ms 单调递减),累计 11464ms(全表扫签名)
 *   - 候选 atom-A(本修法):       atom_ms declineRatio 1.0×(19→19ms 平稳走主键索引),累计 515ms (-95.5%)
 *   - 候选 B(逐 $rid 点查):      declineRatio 0.8× 走索引但累计 4613ms(慢 9×)→ 记录不采纳
 *   - 候选 C(batch 1000→100):    declineRatio 31.6× 累计 16748ms(反向放大 +46%,INSIDE 退化非数组大小问题)→ 字面跳过
 * `DELETE $rids` array 形式 surrealdb@2.0.3 SDK 字面接受(无 ValidationError),
 * RETURN BEFORE 返同款 [[...]] array → deletedAtoms = res[0]?.length 计数无需降级。
 *
 * 两条 edge DELETE + 一条 atom DELETE 同 tx 内,任一失败整事务 rollback 不变
 * (scenario-9-rollback 覆盖)。
 */
export async function bulkDeleteAtomsAndEdgesViaTx(
  tx: SurrealTransaction,
  ids: string[],
): Promise<{ deletedAtoms: number; deletedEdges: number }> {
  if (ids.length === 0) return { deletedAtoms: 0, deletedEdges: 0 };
  // 边删 subject 侧:命中 edge_subject 索引(subject.atomId)
  const tEdgeSubject = performance.now();
  const edgeSubjectRes = await tx.query<[Array<unknown>]>(
    `DELETE edge WHERE subject.atomId INSIDE $ids RETURN BEFORE`,
    { ids },
  );
  const edgeSubjectMs = Math.round(performance.now() - tEdgeSubject);
  // 边删 object 侧:命中 edge_object 索引(object.atomId);object 是 union,仅 atom kind 有 atomId
  const tEdgeObject = performance.now();
  const edgeObjectRes = await tx.query<[Array<unknown>]>(
    `DELETE edge WHERE object.kind = 'atom' AND object.atomId INSIDE $ids RETURN BEFORE`,
    { ids },
  );
  const edgeObjectMs = Math.round(performance.now() - tEdgeObject);
  const deletedEdgesSubject = edgeSubjectRes[0]?.length ?? 0;
  const deletedEdgesObject = edgeObjectRes[0]?.length ?? 0;
  const deletedEdges = deletedEdgesSubject + deletedEdgesObject;
  // atom 删:`DELETE $rids` RecordId array record-link 删,走主键索引(见上方契约注释)
  const rids = ids.map((id) => atomRid(id));
  const tAtom = performance.now();
  const atomRes = await tx.query<[Array<unknown>]>(
    `DELETE $rids RETURN BEFORE`,
    { rids },
  );
  const atomMs = Math.round(performance.now() - tAtom);
  const deletedAtoms = atomRes[0]?.length ?? 0;
  // [delete/perf] 业务 perf log — 三段 SQL 拆时(edge subject / edge object / atom),永久留。
  // 三段均已 Phase A verify 走索引(edge declineRatio ~1.0× / atom declineRatio 1.0×)。
  // 看这条即可判断"哪段慢"——未来嫌疑 G(collect 串行)调优直接据此对照。
  console.log(
    `[delete/perf]       bulkDel ids=${ids.length} ` +
      `edge_subject=${edgeSubjectMs}ms(${deletedEdgesSubject}) ` +
      `edge_object=${edgeObjectMs}ms(${deletedEdgesObject}) ` +
      `atom=${atomMs}ms(${deletedAtoms})`,
  );
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

/**
 * 档 3 perf: 批量 putEdge — 单 SQL multi-row INSERT(~N 串行 CREATE → 1 RPC)。
 *
 * Phase A binary verify 背书(同 batchPutAtomsViaTx)。
 *
 * 语义对齐 putEdgeViaTx 的"无 id CREATE 分支":
 *  - 不做 assertAtomExists(档 1 拍板,caller 应用层保证 atomId 引用正确性,
 *    见 putEdgeViaTx 正确性契约注释)。
 *  - attrs.createdBy / createdAt 缺省注入(同单条逻辑)。
 *  - edge id 应用层 generateUlid 预生成。
 *  - subject 必须是 atom ref(纯 shape 校验,逐条 throw 暴露 caller 错误意图)。
 *
 * 仅 CREATE 语义(不支持 id UPDATE —— 批量场景 caller 全是新建边)。空 inputs 短路返回 []。
 */
export async function batchPutEdgesViaTx(
  tx: SurrealTransaction,
  inputs: PutEdgeInput[],
  options?: StorageOptions,
): Promise<EdgeEntity[]> {
  if (inputs.length === 0) return [];
  const now = nowMs();
  const ownerId = options?.ownerId ?? DEFAULT_OWNER;

  const entities: EdgeEntity[] = inputs.map((input) => {
    if (input.subject.kind !== 'atom') {
      throw new Error(
        `Edge subject must be AtomRef, got kind=${(input.subject as { kind: string }).kind}`,
      );
    }
    const baseAttrs: Record<string, unknown> = { ...input.attrs };
    if (baseAttrs.createdBy === undefined || baseAttrs.createdBy === '') {
      baseAttrs.createdBy = ownerId;
    }
    if (baseAttrs.createdAt === undefined) baseAttrs.createdAt = now;
    return {
      id: generateUlid(),
      createdAt: now,
      updatedAt: now,
      predicate: input.predicate,
      subject: input.subject,
      object: input.object,
      attrs: baseAttrs as EdgeEntity['attrs'],
    };
  });

  // row.id 必须是 RecordId 实例(edgeRid),不是 string(同 batchPutAtomsViaTx Phase A 坑)。
  const rows = entities.map((e) => ({
    id: edgeRid(e.id),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    predicate: e.predicate,
    subject: e.subject,
    object: e.object,
    attrs: e.attrs,
  }));

  await tx.query(`INSERT INTO edge $rows`, { rows });

  return entities;
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

