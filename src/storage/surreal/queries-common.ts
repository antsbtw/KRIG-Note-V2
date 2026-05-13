/**
 * V2 SurrealStorage 共用查询构建 + normalizer
 *
 * 提取自 storage.ts(decision 020 §5.2 实施期):storage.ts 和
 * transaction-helpers.ts 共用 RecordId 包装 / row → entity 归一 /
 * 时间戳 / 常量,集中放此模块避免重复。
 */
import { RecordId } from 'surrealdb';
import type {
  AtomEntity,
  EdgeEntity,
  AtomDomain,
  AtomRef,
  EdgeEndpoint,
} from '@semantic/types';

export const DEFAULT_OWNER = 'user-default';
export const ATOM_TBL = 'atom';
export const EDGE_TBL = 'edge';

export function nowMs(): number {
  return Date.now();
}

/** 把 storage 层 plain string id 包成 SurrealDB RecordId(表前缀分离) */
export function atomRid(id: string): RecordId {
  return new RecordId(ATOM_TBL, id);
}
export function edgeRid(id: string): RecordId {
  return new RecordId(EDGE_TBL, id);
}

/**
 * SurrealDB 返回的 id 是 RecordId 实例(toString = 'atom:01KRE...')。
 * 业务层契约 id 是 plain string(纯 ULID,不含表前缀),从 RecordId 实例剥出 .id 段。
 */
export function stripRecordPrefix(raw: unknown): string {
  if (raw instanceof RecordId) {
    return String(raw.id);
  }
  if (typeof raw !== 'string') return String(raw);
  const idx = raw.indexOf(':');
  return idx === -1 ? raw : raw.slice(idx + 1);
}

export function normalizeAtomEntity<D extends AtomDomain = AtomDomain>(
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

export function normalizeEdgeEntity(row: Record<string, unknown>): EdgeEntity {
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

// 重导出 AtomRef / EdgeEndpoint 类型方便消费者(transaction-helpers.ts)
export type { AtomRef, EdgeEndpoint };
