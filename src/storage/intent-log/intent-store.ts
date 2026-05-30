/**
 * intent-store — intent 表 CRUD(SP-3 数据层可靠性)
 *
 * 提供 intent 的增 / 改游标 / 删 / 查 pending,含 viaTx 变体(供"数据写 + 游标推进
 * 同一小事务"的不变式,详 design §3.2)。
 *
 * 不属于 StorageAPI 主接口(intent 是运维层,非业务知识层),独立小模块。
 */

import { RecordId } from 'surrealdb';
import type { SurrealTransaction } from 'surrealdb';
import { getDB } from '../surreal/client';
import { stripRecordPrefix, nowMs } from '../surreal/queries-common';
import { generateUlid } from '../ulid';
import type { CreateIntentInput, IntentEntity, IntentOp, IntentStatus } from './types';

const INTENT_TBL = 'intent';

function intentRid(id: string): RecordId {
  return new RecordId(INTENT_TBL, id);
}

function normalizeIntent(row: Record<string, unknown>): IntentEntity {
  return {
    id: stripRecordPrefix(row.id),
    op: row.op as IntentOp,
    targetId: (row.targetId as string | null | undefined) ?? null,
    status: row.status as IntentStatus,
    cursor: (row.cursor as Record<string, unknown> | undefined) ?? {},
    payload: row.payload as Record<string, unknown> | undefined,
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
  };
}

// ── 非事务版(单条快写,createIntent 的标记步 / sweeper 查询) ──

/** 新建 pending intent,返回 intent id */
export async function createIntent(input: CreateIntentInput): Promise<string> {
  const db = getDB();
  const id = generateUlid();
  const now = nowMs();
  // option 字段(targetId/payload):无值时**不写该字段**(留 NONE),不能写 NULL
  // (SurrealDB option<T> 拒绝 NULL,只接受 NONE | T)。
  const clauses = buildOptionClauses(input);
  await db.query(
    `CREATE $rid SET
      op = $op, status = 'pending',
      cursor = $cursor, createdAt = $now, updatedAt = $now${clauses.sql}`,
    {
      rid: intentRid(id),
      op: input.op,
      cursor: input.cursor ?? {},
      now,
      ...clauses.bindings,
    },
  );
  return id;
}

/** 构造 option 字段(targetId/payload)的 SET 片段 + 绑定 — 有值才写,留 NONE 不写 NULL */
function buildOptionClauses(input: CreateIntentInput): {
  sql: string;
  bindings: Record<string, unknown>;
} {
  let sql = '';
  const bindings: Record<string, unknown> = {};
  if (input.targetId != null) {
    sql += ', targetId = $targetId';
    bindings.targetId = input.targetId;
  }
  if (input.payload !== undefined) {
    sql += ', payload = $payload';
    bindings.payload = input.payload;
  }
  return { sql, bindings };
}

/** 删 intent(= 标记 done:done 后即删行,留幂等窗口靠"再删已删返 0") */
export async function deleteIntent(id: string): Promise<void> {
  const db = getDB();
  await db.query(`DELETE $rid`, { rid: intentRid(id) });
}

/** 查所有未完成 intent(走 intent_status 索引) */
export async function listPendingIntents(): Promise<IntentEntity[]> {
  const db = getDB();
  const res = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM intent WHERE status = 'pending'`,
  );
  return (res[0] ?? []).map(normalizeIntent);
}

// ── 事务版(viaTx):游标推进必须与那一批数据写同一 commit ──

/** 事务内新建 intent(与首批数据写同事务) */
export async function createIntentViaTx(
  tx: SurrealTransaction,
  id: string,
  input: CreateIntentInput,
): Promise<void> {
  const now = nowMs();
  const clauses = buildOptionClauses(input);
  await tx.query(
    `CREATE $rid SET
      op = $op, status = 'pending',
      cursor = $cursor, createdAt = $now, updatedAt = $now${clauses.sql}`,
    {
      rid: intentRid(id),
      op: input.op,
      cursor: input.cursor ?? {},
      now,
      ...clauses.bindings,
    },
  );
}

/** 事务内推进游标(与那一批数据写同 commit — 保证 cursor 必反映已落库进度) */
export async function advanceIntentCursorViaTx(
  tx: SurrealTransaction,
  id: string,
  cursor: Record<string, unknown>,
): Promise<void> {
  await tx.query(`UPDATE $rid SET cursor = $cursor, updatedAt = $now`, {
    rid: intentRid(id),
    cursor,
    now: nowMs(),
  });
}

/** 事务内删 intent(操作完成的收尾,与末批同 commit) */
export async function deleteIntentViaTx(
  tx: SurrealTransaction,
  id: string,
): Promise<void> {
  await tx.query(`DELETE $rid`, { rid: intentRid(id) });
}
