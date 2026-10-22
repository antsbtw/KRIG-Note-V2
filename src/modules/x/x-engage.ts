/**
 * ⭐⭐ 蓝V互关第 3 件事:已互关的蓝V看互动情况 —— 纯函数(2026-10-22)
 *
 * 设计文档流程 B(用户 10-16「正确」):采互动 → 分组 → 挑他最近一条帖子回复 → 下轮复查。
 * 用户 10-22 选:互动 = 回复和提及(点赞 X 不给名单,不算);互动走「和求关卡一样」(点赞 + 回复,不关注)。
 * 10-22 重做:不再自动排队列,改成「刚互关 / 一周没互动」两张名单由人挑(见 buildRecentView)。
 */

export const ENGAGE_DAYS = 90;

export type EngageTweet = {
  readonly tweet_id: string;
  readonly author_rest_id: string;
  readonly created_at?: string;
  readonly text?: string;
  readonly in_reply_to_user_id?: string;
  readonly mention_ids?: readonly string[];
};

/**
 * ⭐⭐ 「最近一周」的互动视图(2026-10-22 重做)
 *
 * 用户 10-22:「互动有一个误区,就是找我最近互动的人再次互动,没有我选择的空间:
 *  1、刚添加的好友 —— 互动过、没有互动过进行分类;
 *  2、很久没有互动的好友 —— 找出来它最新的帖子,我要阅读并看看如何互动;
 *  目的就是和蓝友们熟悉起来,并建立信任关系,为推广我们的产品做铺垫。」
 * 同日:「至少采自己的一周互动结果,然后做补集,这样就只能找到那些互关的蓝V没有互动了。」
 *
 * 互动 = 这 7 天里:回复 / 提及(两个方向,x_tweet)+ 我在互动卡 / 求关卡动过手的(x_engage / x_ask)。
 * 「刚互关」= 7 天内成为互关(x_relation_change)—— 天数是我定的,跟「一周」对齐。
 */
export const RECENT_DAYS = 7;

/** 一次互动:谁对谁、什么时候;他对我的带推文(没回的话互动卡就回它) */
export type Touch = {
  readonly person: string;
  readonly who: 'me' | 'him';
  readonly at: string;
  readonly tweetId?: string;
  readonly text?: string;
};

/** 这条推文是不是「from 对 to」的互动:回复给他,或提到了他 */
const touches = (t: EngageTweet, to: string): boolean => t.in_reply_to_user_id === to || (t.mention_ids ?? []).includes(to);

/** 回复 / 提及 → 互动(只留互关蓝V的) */
export function touchesFromTweets(me: string, mutual: ReadonlySet<string>, tweets: readonly EngageTweet[]): Touch[] {
  const out: Touch[] = [];
  for (const t of tweets) {
    if (!t.created_at) continue;
    if (t.author_rest_id === me) {
      for (const to of new Set([t.in_reply_to_user_id, ...(t.mention_ids ?? [])])) {
        if (to && to !== me && mutual.has(to)) out.push({ person: to, who: 'me', at: t.created_at });
      }
    } else if (mutual.has(t.author_rest_id) && touches(t, me)) {
      out.push({ person: t.author_rest_id, who: 'him', at: t.created_at, tweetId: t.tweet_id, text: t.text });
    }
  }
  return out;
}

export type MutualRow = {
  readonly restId: string; readonly handle: string; readonly name?: string; readonly followers?: number;
  /**
   * 什么时候成为互关(7 天内的才有)。firstSeen = 第一次采到他时就已经是互关(之前库里没他)——
   * 可能更早就互关了,只是那天才采到;界面要说清,不能说成「那天互关的」
   */
  readonly mutualSince?: { readonly at: string; readonly firstSeen: boolean };
};

export type RecentPerson = MutualRow & {
  /** 7 天内最近一次互动 */
  readonly lastTouch?: Touch;
  /** 他找过我、我之后还没回 —— 互动卡就回这一条 */
  readonly unanswered?: { readonly tweetId: string; readonly text?: string; readonly at: string };
  /** 库里他最近一条自己发的(不是回复 / 转发);库里没有就空 —— 点开互动卡会去他主页现采 */
  readonly latestPost?: { readonly id: string; readonly text?: string; readonly at: string };
};

export type RecentView = {
  /** 刚互关(7 天内):互动过 / 还没互动 */
  readonly newTouched: RecentPerson[];
  readonly newUntouched: RecentPerson[];
  /** 不是刚互关、这 7 天没互动(补集):库里有最近帖子的在前(新的在前),其余粉丝多的在前 */
  readonly quiet: RecentPerson[];
  /** 不是刚互关、这 7 天互动过的人数(不列出,只计数) */
  readonly touchedCount: number;
};

const ms = (iso?: string): number => Date.parse(iso ?? '') || 0;

/** ⭐⭐ 分组 —— 纯函数 */
export function buildRecentView(
  rows: readonly MutualRow[], allTouches: readonly Touch[],
  latest: ReadonlyMap<string, { id: string; text?: string; at: string }>, now: Date,
): RecentView {
  const since = now.getTime() - RECENT_DAYS * 86_400_000;
  const byPerson = new Map<string, Touch[]>();
  for (const t of allTouches) {
    if (ms(t.at) < since) continue;
    const l = byPerson.get(t.person) ?? [];
    l.push(t);
    byPerson.set(t.person, l);
  }
  const newTouched: RecentPerson[] = [];
  const newUntouched: RecentPerson[] = [];
  const quiet: RecentPerson[] = [];
  let touchedCount = 0;
  for (const r of rows) {
    const ts = (byPerson.get(r.restId) ?? []).sort((a, b) => ms(b.at) - ms(a.at));
    const lastMine = ts.find((t) => t.who === 'me');
    const lastHis = ts.find((t) => t.who === 'him' && t.tweetId);
    const unanswered = lastHis && (!lastMine || ms(lastHis.at) > ms(lastMine.at)) ? { tweetId: lastHis.tweetId!, text: lastHis.text, at: lastHis.at } : undefined;
    const p: RecentPerson = { ...r, lastTouch: ts[0], unanswered, latestPost: latest.get(r.restId) };
    const isNew = r.mutualSince !== undefined && ms(r.mutualSince.at) >= since;
    if (isNew) (ts.length > 0 ? newTouched : newUntouched).push(p);
    else if (ts.length === 0) quiet.push(p);
    else touchedCount += 1;
  }
  const newest = (a: RecentPerson, b: RecentPerson): number => ms(b.mutualSince?.at) - ms(a.mutualSince?.at);
  newTouched.sort(newest);
  newUntouched.sort(newest);
  quiet.sort((a, b) => (ms(b.latestPost?.at) - ms(a.latestPost?.at)) || ((b.followers ?? 0) - (a.followers ?? 0)));
  return { newTouched, newUntouched, quiet, touchedCount };
}

/**
 * ⭐ 最近 7 天采全了没有 —— 「补集」只有在三条搜索都覆盖到 7 天前、且最近 24 小时采过时才可信
 * (用户 10-22:「至少采自己的一周互动结果,然后做补集」)。没采全的列出来,界面要明说「没互动」会偏多。
 */
export function recentCoverageGaps(
  cov: Readonly<Record<EngageKey, { readonly oldest?: string; readonly newest?: string; readonly at?: string }>>, now: Date,
): Array<{ readonly key: EngageKey; readonly why: string }> {
  const since = day(new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString());
  const out: Array<{ key: EngageKey; why: string }> = [];
  for (const k of Object.keys(cov) as EngageKey[]) {
    const c = cov[k];
    if (!c.oldest || !c.newest) out.push({ key: k, why: '还没采' });
    else if (day(c.oldest) > since) out.push({ key: k, why: `只采到 ${day(c.oldest).slice(5)},还差 ${since.slice(5)} ~ ${day(c.oldest).slice(5)}` });
    else if (!c.at || now.getTime() - Date.parse(c.at) > 24 * 3600_000) out.push({ key: k, why: '超过 24 小时没补新的' });
  }
  return out;
}

export type EngageKey = 'mine' | 'toMe' | 'mentionMe';
export type EngageCoverage = Readonly<Record<EngageKey, { readonly oldest?: string; readonly newest?: string }>>;

/** 三条搜索的本体(不带时间);from: 带回复要用 filter:replies(记忆 project-x-search-reply-syntax) */
export function engageBases(handle: string): Array<{ readonly key: EngageKey; readonly label: string; readonly base: string }> {
  return [
    { key: 'mine', label: '我回复过谁', base: `from:${handle} filter:replies` },
    { key: 'toMe', label: '谁回复过我', base: `to:${handle}` },
    { key: 'mentionMe', label: '谁提到过我', base: `@${handle} -from:${handle}` },
  ];
}

const day = (iso: string): string => iso.slice(0, 10);
/** 一次采互动最多翻几页(三条合计)—— 搜索接口约 50 次 / 15 分钟(2026-10-22 真机第 50 页撞 429),留余量 */
export const ENGAGE_PAGE_BUDGET = 45;

/**
 * ⭐⭐ 这一次采哪些、各翻几页 —— 跨次续采(2026-10-22 真机:一次 20 页只覆盖到 11 天前,离 90 天差得远)。
 * · 没采过 → 从今天往回翻(since:90 天前)
 * · 采过 → 先补「上次之后新出的」(since:最新那天,页数少);还没覆盖到 90 天前 → 再从「最早那天」往更早翻(until:)
 * 三条合计不超过 ENGAGE_PAGE_BUDGET 页。
 */
export function planEngageRuns(handle: string, coverage: EngageCoverage, now: Date): Array<{ readonly key: EngageKey; readonly label: string; readonly q: string; readonly pages: number; readonly kind: 'fresh' | 'new' | 'back' }> {
  const since = day(new Date(now.getTime() - ENGAGE_DAYS * 86_400_000).toISOString());
  const runs: Array<{ key: EngageKey; label: string; q: string; pages: number; kind: 'fresh' | 'new' | 'back' }> = [];
  for (const b of engageBases(handle)) {
    const c = coverage[b.key];
    if (!c.newest || !c.oldest) { runs.push({ ...b, q: `${b.base} since:${since}`, pages: 0, kind: 'fresh' }); continue; }
    /**
     * ⚠️⚠️ 接着上次的边界续采要精确到秒(since_time / until_time,unix 秒,各重叠 1 秒不漏)——
     * 原来用按天的 since: / until: 边界那天 +1,会把边界那一整天重读一遍(2026-10-22 真机:我 10-18 一天回了 151 条,
     * 「往更早翻」10 页全耗在 10-18 上,边界一步没动,每天都卡在同一天)。until_time 真机验过:最新一条正好停在边界那一秒。
     */
    const sec = (iso: string, d: number): number => Math.floor(Date.parse(iso) / 1000) + d;
    runs.push({ ...b, q: `${b.base} since_time:${sec(c.newest, -1)}`, pages: 0, kind: 'new' });
    if (day(c.oldest) > since) runs.push({ ...b, q: `${b.base} since:${since} until_time:${sec(c.oldest, 1)}`, pages: 0, kind: 'back' });
  }
  /** 预算:补新的每条 5 页(真机:我一天约 40 条回复 ≈ 2 页);其余平分给「从头采」和「往更早翻」 */
  const fresh = runs.filter((r) => r.kind === 'new');
  fresh.forEach((r) => { r.pages = 5; });
  const deep = runs.filter((r) => r.kind !== 'new');
  const left = ENGAGE_PAGE_BUDGET - fresh.length * 5;
  deep.forEach((r) => { r.pages = Math.max(2, Math.floor(left / Math.max(deep.length, 1))); });
  return runs;
}

/** 某条搜索已覆盖到 90 天前了吗 */
export function engageCoverageDone(c: { readonly oldest?: string }, now: Date): boolean {
  if (!c.oldest) return false;
  return day(c.oldest) <= day(new Date(now.getTime() - ENGAGE_DAYS * 86_400_000).toISOString());
}

/** ⭐ 每天自动采互动该不该跑:任何一条没采过,或上次采距今满 24 小时(2026-10-22) */
export function engageCollectDue(cov: Readonly<Record<EngageKey, { readonly at?: string }>>, now: number): boolean {
  return (Object.values(cov) as Array<{ at?: string }>).some((c) => !c.at || now - Date.parse(c.at) >= 24 * 3600_000);
}

export type EngageCursor = { readonly oldest?: string; readonly newest?: string };

/**
 * ⭐⭐ 一次搜索跑完,连续覆盖边界怎么推进 —— 纯函数(2026-10-22)。
 * 搜索结果按时间从新到旧,一次跑下来覆盖的是 [这次最旧, 这次最新] 连续的一段。
 * · fresh(从今天往回):整段就是覆盖
 * · back(往更早翻):这次最旧比边界早 → 推进;一条没有且没出错 → 窗口里已没有更早的,边界直接到 90 天前
 * · new(补新的):这次最旧接上了旧的最新(≤)才推进最新;没接上(页数不够 / 撞限流)→ 不动,下次再补(不留空档)
 * @param failed 这次出错 / 撞限流(一条没有不能当「没有更早的了」)
 */
export function advanceCursor(cur: EngageCursor, run: { readonly kind: 'fresh' | 'new' | 'back'; readonly oldest?: string; readonly newest?: string; readonly failed: boolean }, now: Date): EngageCursor {
  const since = new Date(now.getTime() - ENGAGE_DAYS * 86_400_000).toISOString();
  const earlier = (a?: string, b?: string): boolean => a !== undefined && (b === undefined || Date.parse(a) < Date.parse(b));
  if (run.kind === 'fresh') {
    if (!run.oldest || !run.newest) return run.failed ? cur : { oldest: since, newest: now.toISOString() };
    return { oldest: run.oldest, newest: run.newest };
  }
  if (run.kind === 'back') {
    if (!run.oldest) return run.failed ? cur : { ...cur, oldest: since };
    return earlier(run.oldest, cur.oldest) ? { ...cur, oldest: run.oldest } : cur;
  }
  if (!run.newest || !run.oldest) return cur;
  return cur.newest !== undefined && Date.parse(run.oldest) <= Date.parse(cur.newest) && Date.parse(run.newest) > Date.parse(cur.newest)
    ? { ...cur, newest: run.newest } : cur;
}
