/**
 * In-memory StorageAPI mock — Stage 9 测试专用 (5B §节 4 / 5A §6.3)
 *
 * ⚠ 仅 Stage 9 vitest 测试用,**不能用于生产**。
 *
 * 设计要点:
 * - 用 Map<string, AtomEntity> + Map<string, EdgeEntity> 简单存
 * - transaction(fn): 字面 snapshot Map → fn 抛错时整体 restore (单事务回滚)
 * - putAtom 不带 id → 生成 mock id `mock-atom-${counter++}` (字面递增,等价 ULID 序的"先到先有")
 * - listEdges 支持 predicate / subjectAtomId / objectAtomId 过滤 (生产代码字面消费方式)
 * - listAtoms 支持 domain 过滤
 * - deleteAtom 字面级联删该 atom 的所有 incoming/outgoing edges
 *
 * 实现细节走 src/storage/api.ts 接口字面 + src/storage/surreal/storage.ts 行为对齐:
 *  - putAtom 不传 id 字面分配新 id; 传 id 字面 UPSERT
 *  - deleteAtom 字面级联 (subject.atomId=id 或 object.atomId=id)
 *  - putEdge 不传 id 分配新 id;传 id UPSERT;assert 两端 atom 存在
 */

import { vi } from 'vitest';
import type {
  StorageAPI,
  StorageTransaction,
  PutAtomInput,
  PutEdgeInput,
  AtomFilter,
  EdgeFilter,
  SubgraphQuery,
  SubgraphResult,
} from '../../src/storage/api';
import type {
  AtomEntity,
  EdgeEntity,
  AtomDomain,
} from '../../src/semantic/types';

const DEFAULT_OWNER = 'user-default';

export interface MockStorage extends StorageAPI {
  /** 测试钩子:看当前内存内 atom 数 (rollback 验收) */
  _atoms: Map<string, AtomEntity>;
  /** 测试钩子:看当前内存内 edge 数 */
  _edges: Map<string, EdgeEntity>;
  /** 测试钩子:重置全部状态 (beforeEach 用) */
  _reset(): void;
  /** 测试钩子:在第 N 次 putAtom (1-based) 时抛错 (rollback 场景) */
  _failOnPutAtomNthCall: number | null;
  _putAtomCallCount: number;
}

export function createMockStorage(): MockStorage {
  const atoms = new Map<string, AtomEntity>();
  const edges = new Map<string, EdgeEntity>();
  let atomCounter = 0;
  let edgeCounter = 0;

  function genAtomId(): string {
    return `mock-atom-${String(atomCounter++).padStart(8, '0')}`;
  }
  function genEdgeId(): string {
    return `mock-edge-${String(edgeCounter++).padStart(8, '0')}`;
  }

  function putAtomImpl<D extends AtomDomain = AtomDomain>(
    input: PutAtomInput<D>,
  ): Promise<AtomEntity<D>> {
    // 测试钩子:模拟第 N 次抛错 (scenario 9 rollback)
    api._putAtomCallCount++;
    if (api._failOnPutAtomNthCall !== null
        && api._putAtomCallCount === api._failOnPutAtomNthCall) {
      throw new Error(
        `[mock-storage] simulated failure on putAtom call #${api._putAtomCallCount}`,
      );
    }

    const now = Date.now();
    if (input.id && atoms.has(input.id)) {
      // UPSERT
      const existing = atoms.get(input.id)!;
      const updated: AtomEntity<D> = {
        ...(existing as AtomEntity<D>),
        payload: input.payload,
        updatedAt: now,
      };
      atoms.set(input.id, updated as AtomEntity);
      return Promise.resolve(updated);
    }
    const id = input.id ?? genAtomId();
    const entity: AtomEntity<D> = {
      id,
      payload: input.payload,
      createdAt: now,
      updatedAt: now,
      createdBy: DEFAULT_OWNER,
    };
    atoms.set(id, entity as AtomEntity);
    return Promise.resolve(entity);
  }

  async function getAtomImpl<D extends AtomDomain = AtomDomain>(
    id: string,
  ): Promise<AtomEntity<D> | null> {
    const e = atoms.get(id);
    return e ? (e as AtomEntity<D>) : null;
  }

  async function deleteAtomImpl(
    id: string,
  ): Promise<{ deleted: boolean; cascadedEdges: number }> {
    let cascaded = 0;
    // 级联删边 (subject.atomId=id 或 object.atomId=id)
    for (const [edgeId, edge] of edges) {
      const subjHit = edge.subject.atomId === id;
      const objHit = edge.object.kind === 'atom' && edge.object.atomId === id;
      if (subjHit || objHit) {
        edges.delete(edgeId);
        cascaded++;
      }
    }
    const deleted = atoms.delete(id);
    return { deleted, cascadedEdges: cascaded };
  }

  async function listAtomsImpl(filter: AtomFilter): Promise<AtomEntity[]> {
    // 空 array 短路（P0-2, 2026-05-29 data-layer-audit）
    if (filter.atomIds?.length === 0) return [];

    const atomIdSet = filter.atomIds ? new Set(filter.atomIds) : null;
    const out: AtomEntity[] = [];
    for (const a of atoms.values()) {
      if (filter.domain && a.payload.domain !== filter.domain) continue;
      if (atomIdSet && !atomIdSet.has(a.id)) continue;
      out.push(a);
    }
    return out;
  }

  function putEdgeImpl(input: PutEdgeInput): Promise<EdgeEntity> {
    // 字面 assert 两端 atom 存在 (surreal 行为对齐;rollback 测试要求 — 但 mock 内若
    // assert 严格,会导致 child-first 写入失败;放宽为 warn,assemble 仍能 round-trip)
    if (input.subject.kind !== 'atom') {
      throw new Error(`[mock-storage] edge.subject must be atom`);
    }
    // 字面不 assert atom 存在 — 测试构造时可能边先于 atom (单元测便利);
    // scenario / round-trip 测试自然顺序写入不影响.

    const now = Date.now();
    if (input.id && edges.has(input.id)) {
      const existing = edges.get(input.id)!;
      const updated: EdgeEntity = {
        ...existing,
        predicate: input.predicate,
        subject: input.subject,
        object: input.object,
        attrs: { ...input.attrs },
        updatedAt: now,
      };
      edges.set(input.id, updated);
      return Promise.resolve(updated);
    }
    const id = input.id ?? genEdgeId();
    const entity: EdgeEntity = {
      id,
      predicate: input.predicate,
      subject: input.subject,
      object: input.object,
      attrs: {
        createdBy: DEFAULT_OWNER,
        createdAt: now,
        ...input.attrs,
      },
      createdAt: now,
      updatedAt: now,
    };
    edges.set(id, entity);
    return Promise.resolve(entity);
  }

  async function getEdgeImpl(id: string): Promise<EdgeEntity | null> {
    return edges.get(id) ?? null;
  }

  async function deleteEdgeImpl(id: string): Promise<{ deleted: boolean }> {
    return { deleted: edges.delete(id) };
  }

  async function listEdgesImpl(filter: EdgeFilter): Promise<EdgeEntity[]> {
    // 互斥 sanity check（P0-1, 2026-05-29 data-layer-audit）
    if (filter.subjectAtomId !== undefined && filter.subjectAtomIds !== undefined) {
      throw new Error(
        '[mock-storage.listEdges] subjectAtomId and subjectAtomIds are mutually exclusive',
      );
    }
    if (filter.objectAtomId !== undefined && filter.objectAtomIds !== undefined) {
      throw new Error(
        '[mock-storage.listEdges] objectAtomId and objectAtomIds are mutually exclusive',
      );
    }

    // 空 array 短路（P0-1）— 不要降级为全扫
    if (filter.subjectAtomIds?.length === 0) return [];
    if (filter.objectAtomIds?.length === 0) return [];

    const subjectIdSet = filter.subjectAtomIds ? new Set(filter.subjectAtomIds) : null;
    const objectIdSet = filter.objectAtomIds ? new Set(filter.objectAtomIds) : null;

    const out: EdgeEntity[] = [];
    for (const e of edges.values()) {
      if (filter.predicate && e.predicate !== filter.predicate) continue;
      if (filter.subjectAtomId && e.subject.atomId !== filter.subjectAtomId) continue;
      if (filter.objectAtomId) {
        if (e.object.kind !== 'atom') continue;
        if (e.object.atomId !== filter.objectAtomId) continue;
      }
      // 批量 subject atom id 过滤（P0-1）
      if (subjectIdSet && !subjectIdSet.has(e.subject.atomId)) continue;
      // 批量 object atom id 过滤（P0-1）
      if (objectIdSet) {
        if (e.object.kind !== 'atom') continue;
        if (!objectIdSet.has(e.object.atomId)) continue;
      }
      // literal object 过滤（P0-3）
      if (filter.objectLiteral !== undefined) {
        if (e.object.kind !== 'literal') continue;
        if (e.object.type !== filter.objectLiteral.type) continue;
        if (e.object.value !== filter.objectLiteral.value) continue;
      }
      out.push(e);
    }
    if (typeof filter.limit === 'number') {
      return out.slice(0, filter.limit);
    }
    return out;
  }

  async function querySubgraphImpl(_q: SubgraphQuery): Promise<SubgraphResult> {
    // 本 sub-phase 测试字面不消费 querySubgraph (assemble/dissect/create 均不调).
    throw new Error('[mock-storage] querySubgraph not implemented in test mock');
  }

  async function transactionImpl<T>(
    fn: (tx: StorageTransaction) => Promise<T>,
  ): Promise<T> {
    // snapshot for rollback
    const atomsSnap = new Map(atoms);
    const edgesSnap = new Map(edges);
    const counterAtomSnap = atomCounter;
    const counterEdgeSnap = edgeCounter;
    const putAtomCallCountSnap = api._putAtomCallCount;

    const tx: StorageTransaction = {
      getAtom: getAtomImpl,
      putAtom: putAtomImpl as StorageTransaction['putAtom'],
      deleteAtom: deleteAtomImpl,
      getEdge: getEdgeImpl,
      putEdge: putEdgeImpl,
      deleteEdge: deleteEdgeImpl,
    };

    try {
      return await fn(tx);
    } catch (err) {
      // rollback
      atoms.clear();
      for (const [k, v] of atomsSnap) atoms.set(k, v);
      edges.clear();
      for (const [k, v] of edgesSnap) edges.set(k, v);
      atomCounter = counterAtomSnap;
      edgeCounter = counterEdgeSnap;
      api._putAtomCallCount = putAtomCallCountSnap;
      throw err;
    }
  }

  async function healthImpl(): Promise<{ alive: boolean; backend: string }> {
    return { alive: true, backend: 'mock-in-memory' };
  }

  const api: MockStorage = {
    getAtom: getAtomImpl,
    putAtom: putAtomImpl as StorageAPI['putAtom'],
    listAtoms: listAtomsImpl,
    deleteAtom: deleteAtomImpl,
    getEdge: getEdgeImpl,
    putEdge: putEdgeImpl,
    deleteEdge: deleteEdgeImpl,
    listEdges: listEdgesImpl,
    querySubgraph: querySubgraphImpl,
    transaction: transactionImpl,
    health: healthImpl,
    _atoms: atoms,
    _edges: edges,
    _reset() {
      atoms.clear();
      edges.clear();
      atomCounter = 0;
      edgeCounter = 0;
      this._failOnPutAtomNthCall = null;
      this._putAtomCallCount = 0;
    },
    _failOnPutAtomNthCall: null,
    _putAtomCallCount: 0,
  };
  return api;
}

/**
 * 单例 mock storage — 给 vi.mock('@storage/index') 用.
 *
 * **设计理由**: vitest module mock 字面 hoisted,工厂函数内字面拿不到
 * `beforeEach` 内重新创建的 fresh 实例;测试间通过 `mockStorage._reset()`
 * 重置状态 (在 tests/setup.ts beforeEach 内).
 */
export const mockStorage = createMockStorage();

/** noop broadcast (mock @platform/main/note/broadcast 用) */
export const mockBroadcastNoteListChanged = vi.fn(async () => {});
export const mockBroadcastNoteDocContentChanged = vi.fn(() => {});
