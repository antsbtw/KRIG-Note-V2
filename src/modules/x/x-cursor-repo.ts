/**
 * `x_collect_cursor` 读写 —— ⭐ **断点续采的游标存在这里**
 *
 * ⚠️⚠️ 为什么非要它(真机算过的账,2026-10-07):
 * `Followers` 端点约 **50 次/窗口**就 429(三跑都停在 48/49 轮)。
 * 而 X 每次都从**第 1 页**给游标 —— 直接再点一次的话:
 * 　翻 1-48 轮全是已入库的那 2442 人 → 第 49 轮又 429
 * 　→ **整个配额花在重采旧数据上,一个新人都拿不到**。
 * ⭐ 必须从上次停下的游标接着翻。
 *
 * ⚠️ 这张表 **1.0.3 就建好了、零消费者** —— 又一例「表建好没人用」,
 * 与 `requestHeaders`(生产端写了、消费端拿不到)同一种形态。
 *
 * 调用边界:仅 main 进程。放在 X 模块内不在 `platform/main/db/` ——
 * 理由同 `x-user-repo`(平台层不许依赖 X)。
 * ⚠️ 走 **X 库(krig_x)** —— `getXDB()`。
 *
 * ── ⭐ 这张表的性质 ──
 * schema 注释写明:游标是**可重算的派生状态**(丢了大不了重爬),
 * 与 `x_author`(真源)分开存,**清空不影响任何业务数据**。
 * ⭐ 所以这里**不做兜底**:读不到就从头采,那是正确行为不是降级。
 */

import { getXDB } from '@storage/surreal/client';

/**
 * ⭐ 采集范围键 —— `<handle>:<名单>`,如 `antsbtw:followers`。
 * ⚠️ 必须**按账号分开**:同一个 app 可能采多个账号的名单,
 * 混用一个 key 会让 A 账号的游标被 B 账号续采(而且数据里看不出来)。
 */
export function cursorScope(handle: string, listSource: string): string {
  return `${handle.trim().replace(/^@+/, '').toLowerCase()}:${listSource}`;
}

export type CollectCursor = {
  readonly scope: string;
  /** ⭐ 下次从这里接着翻;`undefined` = 从头开始 */
  readonly bottomCursor?: string;
  /** ⭐ X 说过「到头了」没有 —— 到头后下次该从头采(拿新增) */
  readonly exhausted: boolean;
  readonly lastRound?: number;
  readonly lastReason?: string;
  readonly totalSeen?: number;
  readonly updatedAt?: string;
};

/**
 * ⭐⭐ 读断点。
 * ⚠️ 读不到就回 `null` —— 调用方据此从头采,**这是正确行为不是降级**
 * (游标本来就是可重算的派生状态)。
 */
export async function readCursor(scope: string): Promise<CollectCursor | null> {
  const db = getXDB();
  const found = await db.query<[Array<{
    scope?: string; bottom_cursor?: string; exhausted?: boolean;
    last_round?: number; last_reason?: string; total_seen?: number; updated_at?: unknown;
  }>]>(
    'SELECT * FROM x_collect_cursor WHERE scope = $scope LIMIT 1',
    { scope },
  );
  const r = (found[0] ?? [])[0];
  if (r === undefined) return null;
  return {
    scope: r.scope ?? scope,
    bottomCursor: r.bottom_cursor === '' ? undefined : r.bottom_cursor,
    exhausted: r.exhausted === true,
    lastRound: r.last_round,
    lastReason: r.last_reason,
    totalSeen: r.total_seen,
    updatedAt: r.updated_at === undefined || r.updated_at === null
      ? undefined : String(r.updated_at),
  };
}

/**
 * ⭐⭐⭐ 存断点 —— **每跑结束都存**,不管是采完了还是被挡了。
 *
 * ⚠️⚠️ 「被 429 挡下」正是最需要存的那一次:
 * 不存的话下次从第 1 页开始,配额全浪费在重采上。
 * ⭐ 「X 说到头了」也要存(`exhausted=true`)——
 * 下次就知道该从头采拿新增,而不是拿一个已经到底的游标去续。
 */
export async function saveCursor(c: CollectCursor): Promise<void> {
  const db = getXDB();
  const now = new Date().toISOString();
  /**
   * ⭐⭐⭐ `UPSERT type::record(...)` 而不是 `UPSERT 表 ... WHERE`。
   * ⚠️⚠️ 带 WHERE 的 UPSERT 没匹配到就**什么都不写、也不报错**
   * (2026-10-05 真机:面板报「入库 44 条」而库里 0 行)。
   * ⭐ scope 天然唯一,直接当 record id。
   * ⚠️ `datetime` 字段必须 cast,直传 ISO 字符串会被库拒收。
   */
  await db.query(
    `UPSERT type::record('x_collect_cursor', $scope) SET
       scope = $scope,
       bottom_cursor = $bottom_cursor,
       exhausted = $exhausted,
       last_round = $last_round,
       last_reason = $last_reason,
       total_seen = $total_seen,
       updated_at = type::datetime($updated_at)`,
    {
      scope: c.scope,
      /** ⚠️ 空串当「没有」—— option<T> 要 undefined 不是 null 也不是 '' */
      bottom_cursor: c.bottomCursor === '' ? undefined : c.bottomCursor,
      exhausted: c.exhausted,
      last_round: c.lastRound,
      last_reason: c.lastReason,
      total_seen: c.totalSeen,
      updated_at: now,
    },
  );
  /**
   * ⭐⭐ **成功路径也要留痕** —— 不然「存了没有」只能去库里猜。
   */
  console.log(
    `[x.cursor] 存断点 ${c.scope}：第 ${c.lastRound ?? '?'} 轮`
    + `／${c.exhausted ? '已到头' : '可续采'}`
    + `／累计 ${c.totalSeen ?? '?'}`
    + `／${c.lastReason ?? ''}`,
  );
}

/**
 * ⭐ 清掉断点 —— 面板上「从头采」按钮用。
 * ⚠️ 删的是**派生状态**,`x_author` 里的人一个不少。
 */
export async function clearCursor(scope: string): Promise<void> {
  const db = getXDB();
  await db.query('DELETE FROM x_collect_cursor WHERE scope = $scope', { scope });
  console.log(`[x.cursor] 已清断点 ${scope} —— 下次从头采`);
}
