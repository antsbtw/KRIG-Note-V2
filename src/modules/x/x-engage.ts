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
/**
 * ⭐⭐ 采互动的策略(2026-10-22 重做)
 *
 * 用户 10-22(一次采 45 页撞了限流):「要有策略吧,这是一个常规行为,经常要采集自己的每天互动的哦。」
 * 事实:搜索约 50 页 / 15 分钟,配方搜索 / 操作台共用(x-search-budget.ts);我一天回复 100+ 条 ≈ 5~8 页。
 * 策略(数字是我定的,不是用户定的):
 *  · 小段多次:一段最多 SEGMENT_PAGES 页,且不超过账本里剩的额度(给你自己搜留 15 页)
 *  · 先后:先补新的(接着上次最新那一秒,一般一两页就接上)→ 再补齐最近 7 天 → 有余量才往 90 天前补
 *  · 撞了限流(429 或悄悄限流)→ 记账本,15 分钟后自动接着采,不等到明天
 *  · 多久一段:最近 7 天没采全 → 每 15 分钟一段;采全了 → 每 3 小时补一次新的
 */
export const SEGMENT_PAGES = 25;
/** 补新的每条最多翻几页 —— 结果到头就自己停,一般用不满 */
const NEW_CAP = 15;
export const RETRY_GAP_MS = 15 * 60_000;
export const ROUTINE_GAP_MS = 3 * 3600_000;

export type EngageRun = { readonly key: EngageKey; readonly label: string; readonly q: string; readonly pages: number; readonly kind: 'fresh' | 'new' | 'back'; readonly goal: 'recent' | 'deep' };

/**
 * ⭐⭐ 这一段的下一条搜索 —— 纯函数。一条跑完扣掉**实际**用的页数、更新边界后再问下一条
 * (补新的给 NEW_CAP 只是上限,一般一两页就到头;按上限预先分配会把补齐 7 天的页数全占掉)。
 * @param left  这一段还剩几页(账本额度,上限 SEGMENT_PAGES)
 * @param done  这一段已经跑过的「key:kind」
 * ⚠️ 接着上次的边界续采精确到秒(since_time / until_time,unix 秒,各重叠 1 秒不漏)——
 *   按天的 since: / until: 会把边界那一整天重读一遍(2026-10-22 真机:我 10-18 一天回了 151 条,
 *   「往更早翻」10 页全耗在 10-18 上,边界一步没动)。until_time 真机验过:最新一条正好停在边界那一秒。
 */
export function nextEngageRun(handle: string, coverage: EngageCoverage, now: Date, left: number, done: ReadonlySet<string>): EngageRun | null {
  const since = day(new Date(now.getTime() - ENGAGE_DAYS * 86_400_000).toISOString());
  const since7 = day(new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString());
  const sec = (iso: string, d: number): number => Math.floor(Date.parse(iso) / 1000) + d;
  const news: Array<Omit<EngageRun, 'pages'>> = [];
  const mid: Array<Omit<EngageRun, 'pages'>> = [];
  const deep: Array<Omit<EngageRun, 'pages'>> = [];
  for (const b of engageBases(handle)) {
    const c = coverage[b.key];
    if (!c.newest || !c.oldest) { mid.push({ ...b, q: `${b.base} since:${since}`, kind: 'fresh', goal: 'recent' }); continue; }
    news.push({ ...b, q: `${b.base} since_time:${sec(c.newest, -1)}`, kind: 'new', goal: 'recent' });
    if (day(c.oldest) > since) {
      const back = { ...b, q: `${b.base} since:${since} until_time:${sec(c.oldest, 1)}`, kind: 'back' as const };
      if (day(c.oldest) > since7) mid.push({ ...back, goal: 'recent' }); else deep.push({ ...back, goal: 'deep' });
    }
  }
  const todo = (l: Array<Omit<EngageRun, 'pages'>>): Array<Omit<EngageRun, 'pages'>> => l.filter((r) => !done.has(`${r.key}:${r.kind}`));
  const n = todo(news)[0];
  if (n) return left >= 1 ? { ...n, pages: Math.min(NEW_CAP, left) } : null;
  /** 从头采 / 补齐 7 天:剩下的平分 */
  const m = todo(mid);
  if (m.length > 0) { const p = Math.ceil(left / m.length); return p >= 2 ? { ...m[0], pages: p } : null; }
  /** 7 天都齐了(这一段里也没有要补齐的)才往 90 天前补 */
  if (mid.length > 0) return null;
  const d = todo(deep);
  if (d.length > 0) { const p = Math.ceil(left / d.length); return p >= 3 ? { ...d[0], pages: p } : null; }
  return null;
}

/** 某条搜索已覆盖到 90 天前了吗 */
export function engageCoverageDone(c: { readonly oldest?: string }, now: Date): boolean {
  if (!c.oldest) return false;
  return day(c.oldest) <= day(new Date(now.getTime() - ENGAGE_DAYS * 86_400_000).toISOString());
}

/**
 * ⭐ 定时器该不该现在采一段:撞过限流没过 15 分钟 / 额度不够一段 → 不采;
 * 最近 7 天没采全 → 距上次尝试满 15 分钟就采;采全了 → 满 3 小时补一次新的。
 */
export function engageCollectDue(
  cov: Readonly<Record<EngageKey, { readonly oldest?: string; readonly newest?: string; readonly at?: string }>>,
  now: number, budget: { readonly freePages: number; readonly waitUntil?: number },
): boolean {
  if (budget.waitUntil !== undefined && budget.waitUntil > now) return false;
  if (budget.freePages < 5) return false;
  const tries = (Object.values(cov) as Array<{ at?: string }>).map((c) => Date.parse(c.at ?? '') || 0);
  const last = Math.max(...tries);
  if (tries.some((t) => t === 0)) return true;
  const gap = recentCoverageGaps(cov, new Date(now)).some((g) => g.why !== '超过 24 小时没补新的') ? RETRY_GAP_MS : ROUTINE_GAP_MS;
  return now - last >= gap;
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
export function advanceCursor(cur: EngageCursor, run: { readonly kind: 'fresh' | 'new' | 'back'; readonly oldest?: string; readonly newest?: string; readonly failed: boolean; readonly exhausted?: boolean }, now: Date): EngageCursor {
  const since = new Date(now.getTime() - ENGAGE_DAYS * 86_400_000).toISOString();
  const earlier = (a?: string, b?: string): boolean => a !== undefined && (b === undefined || Date.parse(a) < Date.parse(b));
  if (run.kind === 'fresh') {
    if (!run.oldest || !run.newest) return run.failed ? cur : { oldest: since, newest: now.toISOString() };
    return { oldest: run.oldest, newest: run.newest };
  }
  if (run.kind === 'back') {
    if (!run.oldest) return run.failed ? cur : { ...cur, oldest: since };
    /** 翻到头了(没出错、没限流,结果自己结束)→ 窗口里没有更早的了 */
    if (run.exhausted && !run.failed) return { ...cur, oldest: since };
    return earlier(run.oldest, cur.oldest) ? { ...cur, oldest: run.oldest } : cur;
  }
  if (!run.newest || !run.oldest) return cur;
  /** 补新的翻到头了(从上次那一秒起的全看完了)→ 不管接没接上那一条,最新都推到这次最新 */
  if (run.exhausted && !run.failed) return cur.newest === undefined || Date.parse(run.newest) > Date.parse(cur.newest) ? { ...cur, newest: run.newest } : cur;
  return cur.newest !== undefined && Date.parse(run.oldest) <= Date.parse(cur.newest) && Date.parse(run.newest) > Date.parse(cur.newest)
    ? { ...cur, newest: run.newest } : cur;
}
