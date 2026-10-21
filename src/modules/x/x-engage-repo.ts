/**
 * ⭐ 已互关蓝V的互动情况 —— 读库(2026-10-22)。分组在 x-engage.ts(纯函数)。
 */
import { getXDB } from '@storage/surreal/client';
import { PEOPLE_WITH_RELATION } from './x-account';
import { ENGAGE_DAYS, countGroups, engageBases, engageCoverageDone, engageQueue, groupEngagement, type EngageCoverage, type EngageGroup, type EngageKey, type EngagePerson, type EngageTweet } from './x-engage';

export type EngageOverview = {
  readonly days: number;
  readonly mutualBlue: number;
  readonly groups: Record<EngageGroup, number>;
  /** 三条搜索各自:上次采的时间 / 已覆盖到哪天 / 覆盖满 90 天没有 */
  readonly lastCollected: ReadonlyArray<{ readonly key: string; readonly label: string; readonly at?: string; readonly oldest?: string; readonly newest?: string; readonly done: boolean }>;
  /** 队列前若干个(只有他对我在前) */
  readonly queue: ReadonlyArray<EngagePerson & { readonly handle: string; readonly name?: string; readonly followers?: number }>;
  readonly queueTotal: number;
};

export async function readEngageOverview(account: string, handle: string, queueLimit: number, now = new Date()): Promise<EngageOverview> {
  const db = getXDB();
  const since = new Date(now.getTime() - ENGAGE_DAYS * 86_400_000).toISOString();
  const [mutual, tweets] = await db.query<[
    Array<{ rest_id: string; handle: string; display_name?: string; followers_count?: number }>,
    EngageTweet[],
  ]>(
    `SELECT rest_id, handle, display_name, followers_count FROM ${PEOPLE_WITH_RELATION}
       WHERE i_follow = true AND follows_me = true AND is_blue_verified = true AND excluded != true;
     SELECT tweet_id, author_rest_id, (IF created_at != NONE THEN <string> created_at ELSE NONE END) AS created_at, text,
            in_reply_to_user_id, mention_ids
       FROM x_tweet
       WHERE created_at >= type::datetime($since)
         AND ((author_rest_id = $acct AND (in_reply_to_user_id != NONE OR array::len(mention_ids ?? []) > 0))
           OR (author_rest_id != $acct AND (in_reply_to_user_id = $acct OR $acct INSIDE mention_ids)));`,
    { acct: account, since },
  );
  const people = groupEngagement(account, (mutual ?? []).map((m) => m.rest_id), tweets ?? []);
  const info = new Map((mutual ?? []).map((m) => [m.rest_id, m]));
  const queue = engageQueue(people, new Map((mutual ?? []).map((m) => [m.rest_id, m.followers_count ?? 0])));
  const cov = await readEngageCoverage(handle);
  const lastCollected = engageBases(handle).map((b) => ({ key: b.key, label: b.label, ...cov[b.key], done: engageCoverageDone(cov[b.key], now) }));
  return {
    days: ENGAGE_DAYS,
    mutualBlue: people.length,
    groups: countGroups(people),
    lastCollected,
    queue: queue.slice(0, queueLimit).map((p) => ({ ...p, handle: info.get(p.restId)?.handle ?? p.restId, name: info.get(p.restId)?.display_name, followers: info.get(p.restId)?.followers_count })),
    queueTotal: queue.length,
  };
}

/**
 * ⭐ 三条搜索各自的连续覆盖边界(x_engage_cursor)+ 上次采的时间。
 * ⚠️ 不从库里「最早一条推文」推算(会把别的搜索留下的零散旧推文当成已覆盖,2026-10-22 真机);
 * ⚠️ 不用 time::max/min:空集合时库回 -262143-01-01 哨兵值。
 */
export async function readEngageCoverage(handle: string): Promise<EngageCoverage & Record<EngageKey, { at?: string }>> {
  const db = getXDB();
  const out = {} as Record<EngageKey, { oldest?: string; newest?: string; at?: string }>;
  for (const b of engageBases(handle)) {
    const [r] = await db.query<[Array<{ oldest?: string; newest?: string; at: string }>]>(
      `SELECT (IF oldest != NONE THEN <string> oldest ELSE NONE END) AS oldest, (IF newest != NONE THEN <string> newest ELSE NONE END) AS newest,
              <string> updated_at AS at FROM type::record('x_engage_cursor', $id)`,
      { id: `${handle}:${b.key}` },
    );
    const c = r?.[0];
    out[b.key] = { oldest: c?.oldest ?? undefined, newest: c?.newest ?? undefined, at: c?.at };
  }
  return out;
}

export async function writeEngageCursor(handle: string, key: EngageKey, c: { readonly oldest?: string; readonly newest?: string }): Promise<void> {
  const [rows] = await getXDB().query<[unknown[]]>(
    `UPSERT type::record('x_engage_cursor', $id) SET
       oldest = (IF $o = NONE THEN NONE ELSE type::datetime($o) END), newest = (IF $n = NONE THEN NONE ELSE type::datetime($n) END),
       updated_at = time::now()`,
    { id: `${handle}:${key}`, o: c.oldest, n: c.newest },
  );
  if (!rows || rows.length !== 1) throw new Error(`[x.engage] ${key} 覆盖边界没写上`);
}

/**
 * ⭐ 这一轮搜索真正命中的推文时间范围(2026-10-22 真机):
 * 不能用逐页账的每页时间 —— 那里含被引用的旧推文、回复的上文,会把边界拉到很早(真机 302 条回复记成 09-04 起)。
 * 只算符合这条搜索本义的:我发的回复 / 回复我的 / 别人提到我的,且是这一轮(search_recipe = 这次的查询)存的。
 */
export async function runRange(account: string, key: EngageKey, q: string): Promise<{ oldest?: string; newest?: string }> {
  const cond = key === 'mine' ? 'author_rest_id = $a AND in_reply_to_user_id != NONE'
    : key === 'toMe' ? 'in_reply_to_user_id = $a'
      : 'author_rest_id != $a AND $a INSIDE mention_ids';
  const where = `search_recipe = $q AND created_at != NONE AND ${cond}`;
  const [o, n] = await getXDB().query<[Array<{ t: string }>, Array<{ t: string }>]>(
    `SELECT <string> created_at AS t FROM x_tweet WHERE ${where} ORDER BY t ASC LIMIT 1;
     SELECT <string> created_at AS t FROM x_tweet WHERE ${where} ORDER BY t DESC LIMIT 1;`,
    { a: account, q },
  );
  return { oldest: o?.[0]?.t, newest: n?.[0]?.t };
}
