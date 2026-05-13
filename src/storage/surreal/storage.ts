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
  SubgraphQuery,
  SubgraphResult,
  StorageTransaction,
} from '../api';
import type {
  AtomEntity,
  EdgeEntity,
  AtomDomain,
  AtomRef,
  EdgeEndpoint,
} from '@semantic/types';
import { RecordId } from 'surrealdb';
import { getDB, getMode } from './client';
import { generateUlid } from '../ulid';

const DEFAULT_OWNER = 'user-default';
const ATOM_TBL = 'atom';
const EDGE_TBL = 'edge';

function nowMs(): number {
  return Date.now();
}

/** 把 storage 层 plain string id 包成 SurrealDB RecordId(表前缀分离) */
function atomRid(id: string): RecordId {
  return new RecordId(ATOM_TBL, id);
}
function edgeRid(id: string): RecordId {
  return new RecordId(EDGE_TBL, id);
}

/**
 * SurrealDB 返回的 id 是 RecordId 实例(toString = 'atom:01KRE...')。
 * 业务层契约 id 是 plain string(纯 ULID,不含表前缀),从 RecordId 实例剥出 .id 段。
 */
function stripRecordPrefix(raw: unknown): string {
  if (raw instanceof RecordId) {
    return String(raw.id);
  }
  if (typeof raw !== 'string') return String(raw);
  const idx = raw.indexOf(':');
  return idx === -1 ? raw : raw.slice(idx + 1);
}

function normalizeAtomEntity<D extends AtomDomain = AtomDomain>(
  row: Record<string, unknown>,
): AtomEntity<D> {
  return {
    id: stripRecordPrefix(row.id),
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    createdBy: row.createdBy as string,
    payload: row.payload as AtomEntity<D>['payload'],
    // decision 014 §3.7:单向 flag,SurrealDB DEFAULT false 兜底;旧 row 无字段时用 false
    hasBeenReferenced: (row.hasBeenReferenced as boolean | undefined) ?? false,
  };
}

function normalizeEdgeEntity(row: Record<string, unknown>): EdgeEntity {
  return {
    id: stripRecordPrefix(row.id),
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    predicate: row.predicate as EdgeEntity['predicate'],
    subject: row.subject as AtomRef,
    object: row.object as EdgeEndpoint,
    attrs: row.attrs as EdgeEntity['attrs'],
  };
}

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
      const result = await db.query<[Array<Record<string, unknown>>]>(
        `UPDATE $rid SET payload = $payload, updatedAt = $now RETURN AFTER`,
        { rid: atomRid(input.id), payload: input.payload, now },
      );
      const row = result[0]?.[0];
      if (!row) throw new Error(`Atom ${input.id} not found`);
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

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderBy = filter.orderBy ?? 'createdAt';
    const orderDir = (filter.orderDirection ?? 'desc').toUpperCase();
    const limitClause = filter.limit ? `LIMIT ${Math.max(1, Math.floor(filter.limit))}` : '';
    const offsetClause = filter.offset ? `START ${Math.max(0, Math.floor(filter.offset))}` : '';

    const sql = `SELECT * FROM atom ${whereClause} ORDER BY ${orderBy} ${orderDir} ${limitClause} ${offsetClause}`;
    const result = await db.query<[Array<Record<string, unknown>>]>(sql, bindings);
    return (result[0] ?? []).map((row) => normalizeAtomEntity(row));
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
    // ⚠ SurrealDB Sidecar WebSocket 协议不支持跨 db.query() 调用的真事务:
    // BEGIN/COMMIT 必须聚合在单段 SQL 文本内,但 fn 是用户 async 回调,
    // 内部 db.query 多次发送 → BEGIN 后立即被隐式提交,导致后续 COMMIT
    // 报 "Cannot COMMIT without starting a transaction"。
    //
    // 当前退化:直接调 fn 不开真事务,无原子性。
    // 单机单用户场景并发概率极低,业务可接受(参 decision 008 §X)。
    //
    // Open Question(留 sub-phase 3+ 单独评估):
    // - SDK 原生 transaction API?(surrealdb-js 3.x 待查)
    // - 应用层补偿模式?(记录已做操作 → 失败时反向)
    // 见 decision 011 §4.2 binary 验证风险条 + decision 012 §8 Q-tx
    const tx: StorageTransaction = {
      getAtom: (id) => this.getAtom(id),
      putAtom: (input, options) => this.putAtom(input, options),
      deleteAtom: (id) => this.deleteAtom(id),
      getEdge: (id) => this.getEdge(id),
      putEdge: (input, options) => this.putEdge(input, options),
      deleteEdge: (id) => this.deleteEdge(id),
    };
    return fn(tx);
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
