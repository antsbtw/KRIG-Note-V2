/**
 * ⭐ 已互关蓝V的互动情况 —— 读库(2026-10-22)。分组在 x-engage.ts(纯函数 buildRecentView)。
 */
import { getXDB } from '@storage/surreal/client';
import { PEOPLE_WITH_RELATION } from './x-account';
import { RECENT_DAYS, buildRecentView, engageBases, engageCoverageDone, recentCoverageGaps, touchesFromTweets, type EngageCoverage, type EngageKey, type EngageTweet, type MutualRow, type RecentPerson, type Touch } from './x-engage';

export type EngageOverview = {
  readonly days: number;
  readonly mutualBlue: number;
  /** 三条搜索各自:上次采的时间 / 已覆盖到哪天 / 覆盖满 90 天没有 */
  readonly lastCollected: ReadonlyArray<{ readonly key: string; readonly label: string; readonly at?: string; readonly oldest?: string; readonly newest?: string; readonly done: boolean }>;
  /** 最近 7 天没采全的(空 = 「一周没互动」这张补集可信) */
  readonly recentGaps: ReadonlyArray<{ readonly label: string; readonly why: string }>;
  readonly newTouched: readonly RecentPerson[];
  readonly newUntouched: readonly RecentPerson[];
  /** 一周没互动:前 quietLimit 个 + 总数 */
  readonly quiet: readonly RecentPerson[];
  readonly quietTotal: number;
  readonly touchedCount: number;
};

export async function readEngageOverview(account: string, handle: string, quietLimit: number, now = new Date()): Promise<EngageOverview> {
  const db = getXDB();
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString();
  /** 他最近自己发的:多看一周(7 天里没发的,上一周发的也比没有强) */
  const postSince = new Date(now.getTime() - 2 * RECENT_DAYS * 86_400_000).toISOString();
  const [mutual, tweets, rel, eng, ask] = await db.query<[
    Array<{ rest_id: string; handle: string; display_name?: string; followers_count?: number }>,
    EngageTweet[],
    Array<{ person: string; at: string; first_seen: boolean }>,
    Array<{ person: string; at: string; tweet_id: string }>,
    Array<{ person: string; at: string }>,
  ]>(
    `SELECT rest_id, handle, display_name, followers_count FROM ${PEOPLE_WITH_RELATION}
       WHERE i_follow = true AND follows_me = true AND is_blue_verified = true AND excluded != true;
     SELECT tweet_id, author_rest_id, (IF created_at != NONE THEN <string> created_at ELSE NONE END) AS created_at, text,
            in_reply_to_user_id, mention_ids
       FROM x_tweet
       WHERE created_at >= type::datetime($since)
         AND ((author_rest_id = $acct AND (in_reply_to_user_id != NONE OR array::len(mention_ids ?? []) > 0))
           OR (author_rest_id != $acct AND (in_reply_to_user_id = $acct OR $acct INSIDE mention_ids)));
     SELECT person, <string> observed_at AS at, (from_i_follow = NONE OR from_follows_me = NONE) AS first_seen FROM x_relation_change
       WHERE account = $acct AND observed_at >= type::datetime($since) AND to_i_follow = true AND to_follows_me = true
         AND (from_i_follow != true OR from_follows_me != true)
         -- ⚠️ 2026-10-16 关系改按号存时搬家写了 1736 条(source = migration),不是谁成了互关(10-22 真机:不排除「刚互关」冒出 1864 人)
         AND source != 'migration';
     SELECT person, <string> at AS at, tweet_id FROM x_engage WHERE account = $acct AND at >= type::datetime($since) AND (replied = 'ok' OR liked = 'ok');
     SELECT person, <string> at AS at FROM x_ask WHERE account = $acct AND at >= type::datetime($since) AND (replied = 'ok' OR liked = 'ok' OR followed = 'ok');`,
    { acct: account, since },
  );
  const ids = (mutual ?? []).map((m) => m.rest_id);
  const [posts] = await db.query<[Array<{ author_rest_id: string; tweet_id: string; text?: string; at: string }>]>(
    `SELECT author_rest_id, tweet_id, text, <string> created_at AS at FROM x_tweet
       WHERE created_at >= type::datetime($since) AND author_rest_id IN $ids AND in_reply_to_user_id = NONE AND retweet_of_id = NONE
       ORDER BY at DESC`,
    { since: postSince, ids },
  );
  const latest = new Map<string, { id: string; text?: string; at: string }>();
  for (const p of posts ?? []) if (!latest.has(p.author_rest_id)) latest.set(p.author_rest_id, { id: p.tweet_id, text: p.text, at: p.at });
  /** 成为互关:同一人多条取最近一条 */
  const since2 = new Map<string, { at: string; firstSeen: boolean }>();
  for (const r of rel ?? []) {
    const cur = since2.get(r.person);
    if (!cur || Date.parse(r.at) > Date.parse(cur.at)) since2.set(r.person, { at: r.at, firstSeen: r.first_seen === true });
  }
  const rows: MutualRow[] = (mutual ?? []).map((m) => ({ restId: m.rest_id, handle: m.handle, name: m.display_name, followers: m.followers_count, mutualSince: since2.get(m.rest_id) }));
  const set = new Set(ids);
  const touches: Touch[] = [
    ...touchesFromTweets(account, set, tweets ?? []),
    ...[...(eng ?? []), ...(ask ?? [])].filter((e) => set.has(e.person)).map((e) => ({ person: e.person, who: 'me' as const, at: e.at })),
  ];
  const view = buildRecentView(rows, touches, latest, now);
  const cov = await readEngageCoverage(handle);
  const bases = engageBases(handle);
  const lastCollected = bases.map((b) => ({ key: b.key, label: b.label, ...cov[b.key], done: engageCoverageDone(cov[b.key], now) }));
  const recentGaps = recentCoverageGaps(cov, now).map((g) => ({ label: bases.find((b) => b.key === g.key)!.label, why: g.why }));
  return {
    days: RECENT_DAYS,
    mutualBlue: rows.length,
    lastCollected,
    recentGaps,
    newTouched: view.newTouched,
    newUntouched: view.newUntouched,
    quiet: view.quiet.slice(0, quietLimit),
    quietTotal: view.quiet.length,
    touchedCount: view.touchedCount,
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
