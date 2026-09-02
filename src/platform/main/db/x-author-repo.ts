/**
 * x_author 表 CRUD —— B 期「屏蔽名单」
 *
 * 调用边界:仅 main 进程调用,直接 import @storage/surreal/client。
 * ⚠️ 走 **X 库(krig_x)**,不是笔记库 —— 用 getXDB() 而非 getDB()。
 *
 * 设计依据:
 * - docs/10-business-design/x/persistent-tracking-and-profiling.md §4.1(4)
 * - docs/00-architecture/data-model-charter.md 原则 1(实体优先)
 *   屏蔽是**人工意志**,不可从任何数据重算 → 必须持久化在实体上,
 *   不能做成派生视图。
 *
 * ⚠️ 三条本表专属铁律:
 * 1. **handle 一律过 normalizeHandle()** —— 库里 x_tweet.author_handle 是
 *    '@Miekko22'(带 @、保留大小写),而 idx_author_handle 是 UNIQUE。
 *    不归一化则 Foo/foo 成两行,同一人屏蔽两次只生效一次;且与
 *    applyFilter 的比对对不上 → 屏蔽点了没反应**且不报错**。
 * 2. **清空 option 字段用语句内写死的 NONE**,不走参数绑定 ——
 *    SurrealDB 的 NONE ≠ NULL,option<T> 只认 NONE;绑定 null 会被拒。
 * 3. **绝不 DEFINE/写 id 字段** —— id 是内建 record 标识,声明成 string 会
 *    让 CREATE 后的 UPSERT 触发 readonly 校验 → 写入静默失败。
 *    本表 schema 已在 x-schema.ts 1.0.0 定好,本模块只读写业务字段。
 */

import { getXDB } from '@storage/surreal/client';
import { normalizeHandle } from '@shared/types/x-timeline-types';

/** 屏蔽名单条目(供 UI 展示) */
export interface BlockedAuthor {
  handle: string;
  displayName?: string;
  blockedAt?: string;
  blockedReason?: string;
}

interface AuthorRow {
  handle: string;
  display_name?: string | null;
  blocked?: boolean;
  blocked_at?: string | null;
  blocked_reason?: string | null;
}

function rowToBlocked(row: AuthorRow): BlockedAuthor {
  return {
    handle: row.handle,
    displayName: row.display_name ?? undefined,
    blockedAt: row.blocked_at != null ? String(row.blocked_at) : undefined,
    blockedReason: row.blocked_reason ?? undefined,
  };
}

/**
 * 屏蔽某作者。幂等:已屏蔽则刷新 blocked_at。
 *
 * 语义:**只约束未来采集,不抹除已抓的历史数据**(方案 §3.3 已拍板)。
 * 本函数因此绝不 DELETE 任何 x_tweet 行。
 *
 * @param handle 原始或归一化 handle 均可,内部统一归一化
 * @param reason 可选屏蔽理由;不传则写 NONE(B 期 UI 暂不采集理由)
 */
export async function blockAuthor(handle: string, reason?: string): Promise<void> {
  const h = normalizeHandle(handle);
  if (!h) throw new Error('[x-author-repo] blockAuthor: empty handle after normalize');

  const db = getXDB();
  // 先查是否已有行:x_author.handle 是 UNIQUE,不能盲目 CREATE。
  const existing = await db.query<[AuthorRow[]]>(
    `SELECT handle FROM x_author WHERE handle = $handle LIMIT 1`,
    { handle: h },
  );

  if ((existing[0] ?? []).length > 0) {
    // reason 有值才写,不传时保留原有理由(而非抹成 NONE)
    if (reason) {
      await db.query(
        `UPDATE x_author SET blocked = true, blocked_at = time::now(), blocked_reason = $reason
         WHERE handle = $handle`,
        { handle: h, reason },
      );
    } else {
      await db.query(
        `UPDATE x_author SET blocked = true, blocked_at = time::now() WHERE handle = $handle`,
        { handle: h },
      );
    }
    return;
  }

  // 新建行。⚠️ 不写 id,让 SurrealDB 生成 record id(铁律 3)。
  // blocked_reason 不传时**语句里写死 NONE**(铁律 2),绝不绑定 null。
  if (reason) {
    await db.query(
      `CREATE x_author SET handle = $handle, blocked = true,
        blocked_at = time::now(), blocked_reason = $reason`,
      { handle: h, reason },
    );
  } else {
    await db.query(
      `CREATE x_author SET handle = $handle, blocked = true,
        blocked_at = time::now(), blocked_reason = NONE`,
      { handle: h },
    );
  }
}

/**
 * 解除屏蔽。blocked_at / blocked_reason 一并清成 NONE。
 *
 * 保留行本身(不 DELETE):x_author 是「人」的唯一真源,将来 B' 期的
 * watched、C 期的画像都挂在同一行上,删行会连带丢掉其它意志。
 */
export async function unblockAuthor(handle: string): Promise<void> {
  const h = normalizeHandle(handle);
  if (!h) throw new Error('[x-author-repo] unblockAuthor: empty handle after normalize');

  const db = getXDB();
  // ⚠️ NONE 写死在语句里 —— 绑定 null 会写成 NULL,option<datetime> 拒收(铁律 2)
  await db.query(
    `UPDATE x_author SET blocked = false, blocked_at = NONE, blocked_reason = NONE
     WHERE handle = $handle`,
    { handle: h },
  );
}

/** 列出所有已屏蔽作者(走 idx_author_blocked) */
export async function listBlocked(): Promise<BlockedAuthor[]> {
  const db = getXDB();
  const res = await db.query<[AuthorRow[]]>(
    `SELECT handle, display_name, blocked_at, blocked_reason FROM x_author
     WHERE blocked = true ORDER BY blocked_at DESC`,
  );
  return (res[0] ?? []).map(rowToBlocked);
}

/** 单点判断某作者是否已屏蔽 */
export async function isBlocked(handle: string): Promise<boolean> {
  const h = normalizeHandle(handle);
  if (!h) return false;

  const db = getXDB();
  const res = await db.query<[Array<{ handle: string }>]>(
    `SELECT handle FROM x_author WHERE handle = $handle AND blocked = true LIMIT 1`,
    { handle: h },
  );
  return (res[0] ?? []).length > 0;
}

/**
 * 标记「这是我自己」—— 自己发的推不进收件箱面板。
 *
 * **单一自我**:置新的之前先把旧的 is_self 清掉,保证全表至多一行为 true。
 * 换账号登录时旧标记必须让位,否则两个 handle 都被当成自己、别人的推被误藏。
 *
 * ⚠️ 只有实机探测到确切 handle 才允许调用(见 x-self-account.probeSelfHandle);
 * 绝不拿猜测值写库 —— 写错会把无辜作者的推文永久藏起来,且现象是"推文莫名消失"。
 */
export async function setSelfAuthor(handle: string): Promise<void> {
  const h = normalizeHandle(handle);
  if (!h) throw new Error('[x-author-repo] setSelfAuthor: empty handle after normalize');

  const db = getXDB();
  // 先清旧的:至多一行 is_self = true
  await db.query(`UPDATE x_author SET is_self = false WHERE is_self = true AND handle != $handle`,
    { handle: h });

  const existing = await db.query<[AuthorRow[]]>(
    `SELECT handle FROM x_author WHERE handle = $handle LIMIT 1`, { handle: h },
  );
  if ((existing[0] ?? []).length > 0) {
    await db.query(`UPDATE x_author SET is_self = true WHERE handle = $handle`, { handle: h });
  } else {
    await db.query(`CREATE x_author SET handle = $handle, is_self = true`, { handle: h });
  }
}

/** 取当前标记为「我自己」的 handle(归一化形态);未标记则 null */
export async function getSelfHandle(): Promise<string | null> {
  const db = getXDB();
  const res = await db.query<[Array<{ handle: string }>]>(
    `SELECT handle FROM x_author WHERE is_self = true LIMIT 1`,
  );
  return res[0]?.[0]?.handle ?? null;
}

/** 账号基线计数(采自 UserByScreenName) */
export interface AuthorCounts {
  tweetCount?: number;
  mediaCount?: number;
  followersCount?: number;
  followingCount?: number;
  favouritesCount?: number;
  accountCreatedAt?: string;
}

/**
 * 存账号基线计数 —— **采集完整度的分母**。
 *
 * 用户 2026-09-02:「你有发现用户有 post 的总数的吗?这就是基线。」
 * tweet_count 让「抓够了没有」从猜变成算:已抓 N / 基线 M。
 *
 * ⚠️ 同时写 counts_at:没有观测时刻的计数判断不了新鲜度,
 *    也做不了「基线涨了多少 vs 库里涨了多少」的对账。
 */
export async function saveAuthorCounts(handle: string, counts: AuthorCounts): Promise<void> {
  const h = normalizeHandle(handle);
  if (!h) throw new Error('[x-author-repo] saveAuthorCounts: empty handle');

  const db = getXDB();
  const params = {
    handle: h,
    tc: counts.tweetCount ?? undefined,
    mc: counts.mediaCount ?? undefined,
    fc: counts.followersCount ?? undefined,
    gc: counts.followingCount ?? undefined,
    lc: counts.favouritesCount ?? undefined,
    ca: counts.accountCreatedAt ? new Date(counts.accountCreatedAt) : undefined,
  };
  const existing = await db.query<[AuthorRow[]]>(
    `SELECT handle FROM x_author WHERE handle = $handle LIMIT 1`, { handle: h },
  );
  const setClause = `tweet_count = $tc, media_count = $mc, followers_count = $fc,
    following_count = $gc, favourites_count = $lc, account_created_at = $ca,
    counts_at = time::now()`;
  if ((existing[0] ?? []).length > 0) {
    await db.query(`UPDATE x_author SET ${setClause} WHERE handle = $handle`, params);
  } else {
    await db.query(`CREATE x_author SET handle = $handle, ${setClause}`, params);
  }
}

/** 读账号基线 —— UI 显示「已抓 N / 基线 M」用 */
export async function getAuthorCounts(handle: string): Promise<AuthorCounts & { countsAt?: string }> {
  const h = normalizeHandle(handle);
  const db = getXDB();
  const res = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT tweet_count, media_count, followers_count, following_count,
       favourites_count, counts_at FROM x_author WHERE handle = $handle LIMIT 1`,
    { handle: h },
  );
  const r = res[0]?.[0];
  if (!r) return {};
  return {
    tweetCount: typeof r.tweet_count === 'number' ? r.tweet_count : undefined,
    mediaCount: typeof r.media_count === 'number' ? r.media_count : undefined,
    followersCount: typeof r.followers_count === 'number' ? r.followers_count : undefined,
    followingCount: typeof r.following_count === 'number' ? r.following_count : undefined,
    favouritesCount: typeof r.favourites_count === 'number' ? r.favourites_count : undefined,
    countsAt: r.counts_at ? String(r.counts_at) : undefined,
  };
}

/**
 * 取屏蔽 handle 列表,喂给 TimelineFilterConfig.accountBlacklist。
 *
 * 返回值是**已归一化**形态 —— 与 applyFilter 里的 normalizeHandle(tweet.authorHandle)
 * 同源同函数,这是两端能对上的唯一保证。
 *
 * ⚠️ **不缓存、每轮采集现取**:缓存会造成「明明屏蔽了还在爬」的假象,
 * 且与「过滤逻辑没生效」难以区分。743 行量级走索引,成本可忽略。
 *
 * ⚠️ **失败必须抛,绝不返回空数组兜底**(feedback-fail-loud-no-fallback):
 * 空黑名单与「查不到」是两件事,后者静默降级 = 屏蔽悄悄失效。
 */
export async function getBlockedHandleSet(): Promise<string[]> {
  const db = getXDB();
  const res = await db.query<[Array<{ handle: string }>]>(
    `SELECT handle FROM x_author WHERE blocked = true`,
  );
  return (res[0] ?? []).map((r) => r.handle);
}
