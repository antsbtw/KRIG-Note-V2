/**
 * V2 SurrealStorage — StorageAPI 的 SurrealDB Sidecar 实现
 *
 * 按 decision 008 §2 完整实现 StorageAPI 接口。
 *
 * 关键约束:
 * - 写入 edge 时校验 subject / object atomId 存在 (decision 008 §5.2)
 * - 业务层不传 createdBy,storage 层注入 ownerId (StorageOptions) 或 fallback 'user-default'
 * - id 在创建时由 storage 生成 ULID;更新时由调用方传
 * - querySubgraph 用应用层 BFS (surreal-schema.md §5.3 方案 A)
 */
import type {
  StorageAPI,
  StorageOptions,
  PutAtomInput,
  AtomFilter,
  PutEdgeInput,
  EdgeFilter,
  ListMarkerAtomsOpts,
  SubgraphQuery,
  SubgraphResult,
  StorageTransaction,
} from '../api';
import type {
  AtomEntity,
  EdgeEntity,
  AtomDomain,
} from '@semantic/types';
import { getDB, getMode } from './client';
import { generateUlid } from '../ulid';
import {
  DEFAULT_OWNER,
  atomRid,
  edgeRid,
  nowMs,
  normalizeAtomEntity,
  normalizeEdgeEntity,
} from './queries-common';
import {
  getAtomViaTx,
  putAtomViaTx,
  deleteAtomViaTx,
  getEdgeViaTx,
  putEdgeViaTx,
  deleteEdgeViaTx,
  bulkDeleteAtomsAndEdgesViaTx,
} from './transaction-helpers';

class SurrealStorage implements StorageAPI {
  // ── atom CRUD ─────────────────────────────────────────────

  async getAtom<D extends AtomDomain = AtomDomain>(
    id: string,
  ): Promise<AtomEntity<D> | null> {
    const db = getDB();
    // SurrealDB id 是 record id (atom:01K..) 而不是 string;
    // 用 RecordId 实例绑定 + SELECT FROM $rid 直读单条。
    const result = await db.query<[Array<Record<string, unknown>>]>(
      `SELECT * FROM $rid LIMIT 1`,
      { rid: atomRid(id) },
    );
    const row = result[0]?.[0];
    return row ? normalizeAtomEntity<D>(row) : null;
  }

  async putAtom<D extends AtomDomain = AtomDomain>(
    input: PutAtomInput<D>,
    options?: StorageOptions,
  ): Promise<AtomEntity<D>> {
    const db = getDB();
    const now = nowMs();
    const ownerId = options?.ownerId ?? DEFAULT_OWNER;

    if (input.id) {
      // UPSERT 语义 (decision 017 §2.1):
      // - view 端可能预先生成 client-side id 推过来 (graph instance 等场景)
      // - createdAt / createdBy 用 `field OR $now` 短路:已存在保留原值,不存在取 $now
      // - payload / updatedAt 总是覆盖
      // SurrealDB 3.0.4 已实测验证 OR 短路语义生效 (decision 017 §6.1)。
      const result = await db.query<[Array<Record<string, unknown>>]>(
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
    await db.query(
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

  async listAtoms(filter: AtomFilter): Promise<AtomEntity[]> {
    const db = getDB();

    // 空 array 短路（P0-2, 2026-05-29 data-layer-audit）
    if (filter.atomIds?.length === 0) return [];

    const where: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (filter.domain !== undefined) {
      where.push(`payload.domain = $domain`);
      bindings.domain = filter.domain;
    }
    if (filter.createdBy !== undefined) {
      where.push(`createdBy = $createdBy`);
      bindings.createdBy = filter.createdBy;
    }
    if (filter.createdAtRange?.from !== undefined) {
      where.push(`createdAt >= $createdAtFrom`);
      bindings.createdAtFrom = filter.createdAtRange.from;
    }
    if (filter.createdAtRange?.to !== undefined) {
      where.push(`createdAt <= $createdAtTo`);
      bindings.createdAtTo = filter.createdAtRange.to;
    }
    if (filter.updatedAtRange?.from !== undefined) {
      where.push(`updatedAt >= $updatedAtFrom`);
      bindings.updatedAtFrom = filter.updatedAtRange.from;
    }
    if (filter.updatedAtRange?.to !== undefined) {
      where.push(`updatedAt <= $updatedAtTo`);
      bindings.updatedAtTo = filter.updatedAtRange.to;
    }
    // 批量 atom id 过滤（P0-2）— atom.id 是 RecordId,需转 Thing[]
    if (filter.atomIds !== undefined) {
      where.push(`id INSIDE $atomRids`);
      bindings.atomRids = filter.atomIds.map((id) => atomRid(id));
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderBy = filter.orderBy ?? 'createdAt';
    const orderDir = (filter.orderDirection ?? 'desc').toUpperCase();
    const limitClause = filter.limit ? `LIMIT ${Math.max(1, Math.floor(filter.limit))}` : '';
    const offsetClause = filter.offset ? `START ${Math.max(0, Math.floor(filter.offset))}` : '';

    const sql = `SELECT * FROM atom ${whereClause} ORDER BY ${orderBy} ${orderDir} ${limitClause} ${offsetClause}`;
    const result = await db.query<[Array<Record<string, unknown>>]>(sql, bindings);
    return (result[0] ?? []).map((row) => normalizeAtomEntity(row));
  }

  /**
   * P1-1 (2026-05-29 data-layer-audit): 按 marker 边过滤的 atom 查询。
   *
   * 实施走 2 阶段 query(audit §6 风险 1 降级方案):
   *  1. 拉所有 marker edge 字面拿 subject.atomId 集合
   *  2. listAtoms({ domain, atomIds }) 一次取目标 atom
   *
   * 不走 1-step INSIDE subquery 的原因:atom.id 是 RecordId 而 subject.atomId 是 plain string,
   * SurrealDB 4.x 没有 type::thing 函数 (实测 V5 报 ValidationError "did you maybe mean type::record"),
   * 子查询返字符串集合与 atom.id INSIDE 类型不匹配. 2 阶段 query 多 1 次 round-trip,但比"拉全
   * pm domain 100k 行 + 内存 filter"反模式仍快 ~100×(SQL 真正按 marker 边过滤,不返 block atom).
   */
  async listMarkerAtoms<D extends AtomDomain = AtomDomain>(
    opts: ListMarkerAtomsOpts,
  ): Promise<AtomEntity<D>[]> {
    // 阶段 1:按 markerPredicate (+ markerObjectMatch) 拉所有 marker edge
    const edgeFilter: EdgeFilter = { predicate: opts.markerPredicate };
    if (opts.markerObjectMatch) {
      if (opts.markerObjectMatch.kind === 'literal') {
        edgeFilter.objectLiteral = {
          type: opts.markerObjectMatch.type,
          value: opts.markerObjectMatch.value,
        };
      } else {
        edgeFilter.objectAtomId = opts.markerObjectMatch.atomId;
      }
    }
    const markerEdges = await this.listEdges(edgeFilter);

    // 字面去重 subject.atomId (多条 marker 边指向同一 subject 时)
    const subjectIds = Array.from(new Set(markerEdges.map((e) => e.subject.atomId)));
    if (subjectIds.length === 0) return [];

    // 阶段 2:按 domain + atomIds 一次取目标 atom (P0-2 字面已 verify)
    const atoms = await this.listAtoms({
      domain: opts.domain,
      atomIds: subjectIds,
    });
    return atoms as AtomEntity<D>[];
  }

  async deleteAtom(id: string): Promise<{ deleted: boolean; cascadedEdges: number }> {
    const db = getDB();

    // 应用层级联删除关联 edges (EVENT 触发器留 sub-phase 2 EM6 后实施)
    // subject.atomId / object.atomId 字段存的是 plain string,不是 RecordId,所以用 $id (string) 绑定
    const edgeRes = await db.query<[Array<Record<string, unknown>>]>(
      `SELECT id FROM edge
        WHERE subject.atomId = $id
           OR (object.kind = 'atom' AND object.atomId = $id)`,
      { id },
    );
    const cascadedEdges = edgeRes[0]?.length ?? 0;
    if (cascadedEdges > 0) {
      await db.query(
        `DELETE edge
          WHERE subject.atomId = $id
             OR (object.kind = 'atom' AND object.atomId = $id)`,
        { id },
      );
    }

    const delRes = await db.query<[Array<unknown>]>(
      `DELETE $rid RETURN BEFORE`,
      { rid: atomRid(id) },
    );
    const deleted = (delRes[0]?.length ?? 0) > 0;
    return { deleted, cascadedEdges };
  }

  /**
   * SP-1 数据层可靠性地基:批量删一批 atom + 级联边。
   *
   * 比逐个 deleteAtom 少 round-trip(一批 = 2 条 DELETE)。集合成员用 `INSIDE`
   * (SurrealDB 数组成员检查;`IN` 是 graph traversal,见 feedback_surrealdb_inside_not_in)。
   * 边匹配两侧:subject.atomId ∈ ids 或 object(kind=atom).atomId ∈ ids。
   * RETURN BEFORE 拿到被删行数自校验。
   *
   * 注:本方法走 db.query(非事务版),供 deleteAtom-style 直接调用;事务内分批删由
   * transaction-helpers 的 viaTx 版承载(SP-2 接入时用)。空 ids 直接返回 0。
   */
  async bulkDeleteAtomsAndEdges(
    ids: string[],
  ): Promise<{ deletedAtoms: number; deletedEdges: number }> {
    if (ids.length === 0) return { deletedAtoms: 0, deletedEdges: 0 };
    const db = getDB();

    // 1. 删级联边(string atomId 字段,直接用 string 数组 INSIDE)
    const edgeRes = await db.query<[Array<unknown>]>(
      `DELETE edge
        WHERE subject.atomId INSIDE $ids
           OR (object.kind = 'atom' AND object.atomId INSIDE $ids)
        RETURN BEFORE`,
      { ids },
    );
    const deletedEdges = edgeRes[0]?.length ?? 0;

    // 2. 删 atom 本体(id 是 RecordId,转 atomRid 数组后 INSIDE)
    const rids = ids.map((id) => atomRid(id));
    const atomRes = await db.query<[Array<unknown>]>(
      `DELETE atom WHERE id INSIDE $rids RETURN BEFORE`,
      { rids },
    );
    const deletedAtoms = atomRes[0]?.length ?? 0;

    return { deletedAtoms, deletedEdges };
  }

  // ── edge CRUD ─────────────────────────────────────────────

  async getEdge(id: string): Promise<EdgeEntity | null> {
    const db = getDB();
    const result = await db.query<[Array<Record<string, unknown>>]>(
      `SELECT * FROM $rid LIMIT 1`,
      { rid: edgeRid(id) },
    );
    const row = result[0]?.[0];
    return row ? normalizeEdgeEntity(row) : null;
  }

  async putEdge(input: PutEdgeInput, options?: StorageOptions): Promise<EdgeEntity> {
    const db = getDB();
    const now = nowMs();
    const ownerId = options?.ownerId ?? DEFAULT_OWNER;

    // 校验 subject / object atomId 存在 (decision 008 §5.2)
    if (input.subject.kind !== 'atom') {
      throw new Error(`Edge subject must be AtomRef, got kind=${(input.subject as { kind: string }).kind}`);
    }
    await this.assertAtomExists(input.subject.atomId, 'subject');
    if (input.object.kind === 'atom') {
      await this.assertAtomExists(input.object.atomId, 'object');
    }

    const baseAttrs: Record<string, unknown> = { ...input.attrs };
    if (baseAttrs.createdBy === undefined || baseAttrs.createdBy === '') {
      baseAttrs.createdBy = ownerId;
    }
    if (baseAttrs.createdAt === undefined) {
      baseAttrs.createdAt = now;
    }

    if (input.id) {
      const result = await db.query<[Array<Record<string, unknown>>]>(
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
    await db.query(
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

  async listEdges(filter: EdgeFilter): Promise<EdgeEntity[]> {
    const db = getDB();

    // 互斥 sanity check（P0-1, 2026-05-29 data-layer-audit）
    if (filter.subjectAtomId !== undefined && filter.subjectAtomIds !== undefined) {
      throw new Error(
        '[storage.listEdges] subjectAtomId and subjectAtomIds are mutually exclusive',
      );
    }
    if (filter.objectAtomId !== undefined && filter.objectAtomIds !== undefined) {
      throw new Error(
        '[storage.listEdges] objectAtomId and objectAtomIds are mutually exclusive',
      );
    }

    // 空 array 短路（P0-1）— 不要降级为全扫
    if (filter.subjectAtomIds?.length === 0) return [];
    if (filter.objectAtomIds?.length === 0) return [];

    const where: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (filter.predicate !== undefined) {
      where.push(`predicate = $predicate`);
      bindings.predicate = filter.predicate;
    }
    if (filter.source !== undefined) {
      where.push(`string::starts_with(predicate, $sourcePrefix)`);
      bindings.sourcePrefix = `${filter.source}:`;
    }
    if (filter.vocabulary !== undefined) {
      where.push(`string::contains(predicate, $vocabSegment)`);
      bindings.vocabSegment = `:${filter.vocabulary}:`;
    }
    if (filter.subjectAtomId !== undefined) {
      where.push(`subject.atomId = $subjectAtomId`);
      bindings.subjectAtomId = filter.subjectAtomId;
    }
    if (filter.objectAtomId !== undefined) {
      where.push(`object.kind = 'atom' AND object.atomId = $objectAtomId`);
      bindings.objectAtomId = filter.objectAtomId;
    }
    // 批量 subject atom id 过滤（P0-1）— subject.atomId 是 plain string
    if (filter.subjectAtomIds !== undefined) {
      where.push(`subject.atomId INSIDE $subjectAtomIds`);
      bindings.subjectAtomIds = filter.subjectAtomIds;
    }
    // 批量 object atom id 过滤（P0-1）— object.atomId 是 plain string
    if (filter.objectAtomIds !== undefined) {
      where.push(`object.kind = 'atom' AND object.atomId INSIDE $objectAtomIds`);
      bindings.objectAtomIds = filter.objectAtomIds;
    }
    // literal object 过滤（P0-3）— 用于 listFolders(viewType)
    if (filter.objectLiteral !== undefined) {
      where.push(
        `object.kind = 'literal' AND object.type = $objLitType AND object.value = $objLitVal`,
      );
      bindings.objLitType = filter.objectLiteral.type;
      bindings.objLitVal = filter.objectLiteral.value;
    }
    if (filter.createdAtRange?.from !== undefined) {
      where.push(`createdAt >= $createdAtFrom`);
      bindings.createdAtFrom = filter.createdAtRange.from;
    }
    if (filter.createdAtRange?.to !== undefined) {
      where.push(`createdAt <= $createdAtTo`);
      bindings.createdAtTo = filter.createdAtRange.to;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderBy = filter.orderBy ?? 'createdAt';
    const orderDir = (filter.orderDirection ?? 'desc').toUpperCase();
    const limitClause = filter.limit ? `LIMIT ${Math.max(1, Math.floor(filter.limit))}` : '';
    const offsetClause = filter.offset ? `START ${Math.max(0, Math.floor(filter.offset))}` : '';

    const sql = `SELECT * FROM edge ${whereClause} ORDER BY ${orderBy} ${orderDir} ${limitClause} ${offsetClause}`;
    const result = await db.query<[Array<Record<string, unknown>>]>(sql, bindings);
    return (result[0] ?? []).map((row) => normalizeEdgeEntity(row));
  }

  async deleteEdge(id: string): Promise<{ deleted: boolean }> {
    const db = getDB();
    const result = await db.query<[Array<unknown>]>(
      `DELETE $rid RETURN BEFORE`,
      { rid: edgeRid(id) },
    );
    return { deleted: (result[0]?.length ?? 0) > 0 };
  }

  // ── 子图查询 ──────────────────────────────────────────────

  async querySubgraph(query: SubgraphQuery): Promise<SubgraphResult> {
    // 应用层 BFS,按 surreal-schema.md §5.3 方案 A
    const roots = query.rootAtomIds ?? [];
    const maxDepth = Math.max(0, query.depth ?? 1);
    const direction = query.direction ?? 'both';
    const visitedAtoms = new Set<string>();
    const atoms: AtomEntity[] = [];
    const edges: EdgeEntity[] = [];
    const seenEdgeIds = new Set<string>();

    // 加载根 atoms
    for (const id of roots) {
      const a = await this.getAtom(id);
      if (a && !visitedAtoms.has(a.id)) {
        visitedAtoms.add(a.id);
        atoms.push(a);
      }
    }

    let frontier = [...visitedAtoms];
    for (let depth = 0; depth < maxDepth; depth++) {
      const nextFrontier = new Set<string>();
      for (const atomId of frontier) {
        const adjacent = await this.adjacentEdges(atomId, direction, query);
        for (const e of adjacent) {
          if (seenEdgeIds.has(e.id)) continue;
          seenEdgeIds.add(e.id);
          edges.push(e);
          // 推 frontier
          const otherIds: string[] = [];
          if (e.subject.atomId !== atomId) otherIds.push(e.subject.atomId);
          if (e.object.kind === 'atom' && e.object.atomId !== atomId) otherIds.push(e.object.atomId);
          for (const oid of otherIds) {
            if (!visitedAtoms.has(oid)) {
              const a = await this.getAtom(oid);
              if (a && (!query.atomDomains || query.atomDomains.includes(a.payload.domain))) {
                visitedAtoms.add(a.id);
                atoms.push(a);
                nextFrontier.add(a.id);
              }
            }
          }
        }
      }
      frontier = [...nextFrontier];
      if (frontier.length === 0) break;
    }

    return { atoms, edges };
  }

  private async adjacentEdges(
    atomId: string,
    direction: 'outgoing' | 'incoming' | 'both',
    query: SubgraphQuery,
  ): Promise<EdgeEntity[]> {
    const db = getDB();
    const where: string[] = [];
    const bindings: Record<string, unknown> = { atomId };

    if (direction === 'outgoing') {
      where.push(`subject.atomId = $atomId`);
    } else if (direction === 'incoming') {
      where.push(`object.kind = 'atom' AND object.atomId = $atomId`);
    } else {
      where.push(`(subject.atomId = $atomId OR (object.kind = 'atom' AND object.atomId = $atomId))`);
    }

    if (query.edgePredicates && query.edgePredicates.length > 0) {
      where.push(`predicate INSIDE $predicates`);
      bindings.predicates = query.edgePredicates;
    }
    if (query.namespace?.source) {
      where.push(`string::starts_with(predicate, $sourcePrefix)`);
      bindings.sourcePrefix = `${query.namespace.source}:`;
    }
    if (query.namespace?.vocabulary) {
      where.push(`string::contains(predicate, $vocabSegment)`);
      bindings.vocabSegment = `:${query.namespace.vocabulary}:`;
    }

    const sql = `SELECT * FROM edge WHERE ${where.join(' AND ')}`;
    const result = await db.query<[Array<Record<string, unknown>>]>(sql, bindings);
    return (result[0] ?? []).map((row) => normalizeEdgeEntity(row));
  }

  // ── 事务 ──────────────────────────────────────────────────

  async transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    // sub-phase 3a-tx 启用真原子性 (decision 020):
    // SDK 2.x beginTransaction + commit / cancel 包整段。
    // OCC 冲突 (Transaction conflict) 不在本 sub-phase 处理 (decision 020 §9.4)。
    const db = getDB();
    const surrealTx = await db.beginTransaction();
    try {
      const tx: StorageTransaction = {
        getAtom: (id) => getAtomViaTx(surrealTx, id),
        putAtom: (input, options) => putAtomViaTx(surrealTx, input, options),
        deleteAtom: (id) => deleteAtomViaTx(surrealTx, id),
        getEdge: (id) => getEdgeViaTx(surrealTx, id),
        putEdge: (input, options) => putEdgeViaTx(surrealTx, input, options),
        deleteEdge: (id) => deleteEdgeViaTx(surrealTx, id),
        bulkDeleteAtomsAndEdges: (ids) => bulkDeleteAtomsAndEdgesViaTx(surrealTx, ids),
      };
      const result = await fn(tx);
      await surrealTx.commit();
      return result;
    } catch (err) {
      try {
        await surrealTx.cancel();
      } catch (cancelErr) {
        // cancel 失败不遮盖原 fn 错误 (decision 020 §4.1 / §9.5)
        console.error('[storage.transaction] cancel failed after fn error', cancelErr);
      }
      throw err;
    }
  }

  // ── 健康检查 ──────────────────────────────────────────────

  async health(): Promise<{ alive: boolean; backend: string; version?: string }> {
    try {
      const db = getDB();
      await db.query(`RETURN 1`);
      return { alive: true, backend: `surrealdb-${getMode()}` };
    } catch {
      return { alive: false, backend: `surrealdb-${getMode()}` };
    }
  }

  // ── 内部 helpers ──────────────────────────────────────────

  private async assertAtomExists(atomId: string, role: 'subject' | 'object'): Promise<void> {
    const db = getDB();
    const result = await db.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM $rid LIMIT 1`,
      { rid: atomRid(atomId) },
    );
    if (!result[0] || result[0].length === 0) {
      throw new Error(`Edge ${role} atom not found: ${atomId}`);
    }
  }
}

export const surrealStorage: StorageAPI = new SurrealStorage();
