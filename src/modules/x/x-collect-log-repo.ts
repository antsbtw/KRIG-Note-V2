/**
 * ⭐⭐ 落库账本 `x_collect_log` —— 读写都在这(仅 main 进程)
 *
 * 表在 schema 1.2.19。为什么要它、为什么不用 fetched_at 画曲线,见那里的注释:
 * fetched_at **每次重采都改成当天**,拿它画增长曲线是假的。
 *
 * ⚠️ 只追加,不改不删 —— 账本被改写,曲线和对账就都不可信了。
 */

import { getXDB } from '@storage/surreal/client';
import { buildOpsStatusQuery, parseOpsStatus, type OpsStatus } from './x-ops-status';

export type CollectLogEntry = {
  readonly kind: 'users' | 'tweets';
  /** 人:名单词;推文:来源页 */
  readonly source: string;
  readonly given: number;
  readonly inserted: number;
  readonly updated: number;
  readonly failed: number;
  readonly wsId?: string;
};

/**
 * ⭐ 每次落库后记一行。
 * ⚠️ 写账本失败**不许**让落库本身报失败(人已经进库了),
 * 但也**绝不静默**:抛给调用方去留痕;漏记会在「对账」里现形(账本合计 ≠ 表行数)。
 */
export async function appendCollectLog(e: CollectLogEntry): Promise<void> {
  await getXDB().query(
    `CREATE x_collect_log SET
       at = time::now(), kind = $kind, source = $source,
       given = $given, inserted = $inserted, updated = $updated, failed = $failed,
       ws_id = $ws_id, origin = 'live'`,
    {
      kind: e.kind, source: e.source,
      given: e.given, inserted: e.inserted, updated: e.updated, failed: e.failed,
      /** ⚠️ option 字段传 undefined(→ NONE),不传 null */
      ws_id: e.wsId === undefined || e.wsId === '' ? undefined : e.wsId,
    },
  );
}

/** ⭐⭐ 运营 → 状态 要的全部数字,一次查齐 */
export async function readOpsStatus(account: string): Promise<OpsStatus> {
  const q = buildOpsStatusQuery(account);
  return parseOpsStatus(await getXDB().query<unknown[]>(q.sql, q.vars));
}
