/**
 * V2 StorageAPI 接口
 * 详 docs/RefactorV2/data-model/persistence/decisions/008-storage-layer-interface.md §2
 *
 * 调用边界 (§4.0):
 * - View 层禁止 import @storage
 * - Capability / Platform 层可 import
 * - 业务层通过 capability API 间接访问
 */
import type {
  AtomEntity,
  EdgeEntity,
  AtomDomain,
  Atom,
  EdgePredicate,
  AtomRef,
  EdgeEndpoint,
  EdgeAttrs,
} from '@semantic/types';

export interface StorageAPI {
  // ── atom CRUD ──────────────────────────────────────
  getAtom<D extends AtomDomain = AtomDomain>(
    id: string,
    options?: StorageOptions,
  ): Promise<AtomEntity<D> | null>;

  putAtom<D extends AtomDomain = AtomDomain>(
    atom: PutAtomInput<D>,
    options?: StorageOptions,
  ): Promise<AtomEntity<D>>;

  listAtoms(filter: AtomFilter, options?: StorageOptions): Promise<AtomEntity[]>;

  /**
   * 按 marker 边过滤的 atom 查询（P1-1, 2026-05-29 data-layer-audit）
   *
   * 语义:拉出所有同时满足以下条件的 atom:
   *  - atom.payload.domain === domain
   *  - 存在一条 edge: subject = atom.id, predicate = markerPredicate
   *  - (可选) edge.object 匹配 markerObjectMatch
   *
   * 比 "listAtoms({domain}) + listEdges({predicate}) + Set.has filter" 快得多 —
   * SQL 走 INSIDE subquery，只返回需要的 atom，不返 N × M 个 block atom。
   *
   * 用例:
   *  - listNotes:  marker = 'user:krig:hasNoteView', object = literal true
   *  - listFolders(viewType): marker = 'user:krig:folderForView',
   *    object = literal '__view__/note' (等)
   */
  listMarkerAtoms<D extends AtomDomain = AtomDomain>(
    opts: ListMarkerAtomsOpts,
    options?: StorageOptions,
  ): Promise<AtomEntity<D>[]>;

  deleteAtom(
    id: string,
    options?: StorageOptions,
  ): Promise<{ deleted: boolean; cascadedEdges: number }>;

  // ── edge CRUD ──────────────────────────────────────
  getEdge(id: string, options?: StorageOptions): Promise<EdgeEntity | null>;
  putEdge(edge: PutEdgeInput, options?: StorageOptions): Promise<EdgeEntity>;
  listEdges(filter: EdgeFilter, options?: StorageOptions): Promise<EdgeEntity[]>;
  deleteEdge(id: string, options?: StorageOptions): Promise<{ deleted: boolean }>;

  // ── 子图查询 ───────────────────────────────────────
  querySubgraph(
    query: SubgraphQuery,
    options?: StorageOptions,
  ): Promise<SubgraphResult>;

  // ── 事务 ───────────────────────────────────────────
  transaction<T>(
    fn: (tx: StorageTransaction) => Promise<T>,
    options?: StorageOptions,
  ): Promise<T>;

  // ── 健康检查 ───────────────────────────────────────
  health(): Promise<{ alive: boolean; backend: string; version?: string }>;
}

export interface StorageOptions {
  /** 路径 B 最小预留 (decision 010);本 sub-phase 不消费 */
  ownerId?: string;
  timeoutMs?: number;
}

export interface PutAtomInput<D extends AtomDomain = AtomDomain> {
  /** 创建时不传 (storage 层生成 ULID);更新时传 */
  id?: string;
  payload: Atom<D>;
  // 业务层不传 createdBy (storage 层注入)
}

/** 受控 override — 仅 src/storage/migrations/ 内部使用,业务层禁止调用 */
export interface PutAtomInputUnsafe<D extends AtomDomain = AtomDomain>
  extends PutAtomInput<D> {
  unsafeOverride?: {
    createdAt?: number;
    createdBy?: string;
  };
}

export interface AtomFilter {
  domain?: AtomDomain;
  createdBy?: string;
  createdAtRange?: { from?: number; to?: number };
  updatedAtRange?: { from?: number; to?: number };
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  orderDirection?: 'asc' | 'desc';

  /**
   * 批量 atom id 过滤（SQL IN）
   * 新增（P0-2, 2026-05-29 data-layer-audit）:
   * 替代 `Promise.all(ids.map(id => storage.getAtom(id)))` 雪崩。
   * 空 array 短路返回 []。
   */
  atomIds?: string[];
}

export interface PutEdgeInput {
  id?: string;
  predicate: EdgePredicate;
  subject: AtomRef;
  object: EdgeEndpoint;
  attrs: EdgeAttrs;
}

export interface EdgeFilter {
  predicate?: EdgePredicate;
  source?: 'user' | 'ai' | 'sys';
  vocabulary?: string;
  subjectAtomId?: string;
  objectAtomId?: string;
  createdAtRange?: { from?: number; to?: number };
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  orderDirection?: 'asc' | 'desc';

  /**
   * 批量 subject atom id 过滤（SQL IN）
   * 新增（P0-1, 2026-05-29 data-layer-audit）:
   * 与 `subjectAtomId` 互斥（同时传 throw）；空 array 短路返回 []。
   */
  subjectAtomIds?: string[];

  /**
   * 批量 object atom id 过滤（SQL IN）
   * 新增（P0-1, 2026-05-29 data-layer-audit）:
   * 与 `objectAtomId` 互斥（同时传 throw）；空 array 短路返回 []。
   */
  objectAtomIds?: string[];

  /**
   * literal object 过滤（SQL `object.kind='literal' AND object.type=? AND object.value=?`）
   * 新增（P0-3, 2026-05-29 data-layer-audit）:
   * 用于 folder.listFolders(viewType)：object 是 string literal "note" / "ebook" 等。
   */
  objectLiteral?: { type: string; value: unknown };
}

/**
 * listMarkerAtoms 入参（P1-1, 2026-05-29 data-layer-audit）
 *
 * markerObjectMatch 字面两种形态:
 *  - literal: 匹配 edge.object.kind === 'literal' AND object.type/value
 *  - atomId:  匹配 edge.object.kind === 'atom' AND object.atomId
 *
 * 不传 markerObjectMatch 时:只要存在 (subject=atomId, predicate=markerPredicate) 的边即算命中
 * (object 任意).
 */
export interface ListMarkerAtomsOpts {
  domain: AtomDomain;
  markerPredicate: EdgePredicate;
  markerObjectMatch?:
    | { kind: 'literal'; type: string; value: unknown }
    | { kind: 'atom'; atomId: string };
}

export interface SubgraphQuery {
  rootAtomIds?: string[];
  namespace?: { source?: string; vocabulary?: string };
  depth?: number;
  direction?: 'outgoing' | 'incoming' | 'both';
  edgePredicates?: EdgePredicate[];
  atomDomains?: AtomDomain[];
}

export interface SubgraphResult {
  atoms: AtomEntity[];
  edges: EdgeEntity[];
}

export interface StorageTransaction {
  getAtom: StorageAPI['getAtom'];
  putAtom: StorageAPI['putAtom'];
  deleteAtom: StorageAPI['deleteAtom'];
  getEdge: StorageAPI['getEdge'];
  putEdge: StorageAPI['putEdge'];
  deleteEdge: StorageAPI['deleteEdge'];
}
