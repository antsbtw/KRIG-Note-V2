/**
 * ⭐⭐ 蓝V互关第 3 件事:已互关的蓝V看互动情况 —— 纯函数(2026-10-22)
 *
 * 设计文档流程 B(用户 10-16「正确」):采互动 → 四组 → 「从没互动」进互动队列 → 挑他最近一条帖子回复 → 下轮复查。
 * 用户 10-22 选:互动 = 回复和提及(点赞 X 不给名单,不算);从没互动的走「和求关卡一样」(点赞 + 回复,不关注);
 *   「只有他对我」(他找过我、我没回)排在队列最前。
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

export type EngageGroup = 'both' | 'onlyMe' | 'onlyHim' | 'none';

export type EngagePerson = {
  readonly restId: string;
  readonly group: EngageGroup;
  /** 我最近一次回复 / 提到他 */
  readonly lastMine?: string;
  /** 他最近一次回复 / 提到我(onlyHim 时互动卡就回这一条) */
  readonly lastHis?: { readonly tweetId: string; readonly at?: string; readonly text?: string };
};

/** 这条推文是不是「from 对 to」的互动:回复给他,或提到了他 */
const touches = (t: EngageTweet, to: string): boolean => t.in_reply_to_user_id === to || (t.mention_ids ?? []).includes(to);

/**
 * ⭐ 把互关蓝V分四组。
 * @param mutual   互关蓝V的数字 id(我关注他 ∧ 他关注我 ∧ 蓝V ∧ 没排除)
 * @param tweets   时间窗内:我发的、回复 / 提到别人的;以及别人发的、回复 / 提到我的
 */
export function groupEngagement(me: string, mutual: readonly string[], tweets: readonly EngageTweet[]): EngagePerson[] {
  const mine = new Map<string, string>();
  const his = new Map<string, { tweetId: string; at?: string; text?: string }>();
  const later = (a?: string, b?: string): boolean => Date.parse(a ?? '') > Date.parse(b ?? '');
  const set = new Set(mutual);
  for (const t of tweets) {
    if (t.author_rest_id === me) {
      for (const to of [t.in_reply_to_user_id, ...(t.mention_ids ?? [])]) {
        if (!to || to === me || !set.has(to)) continue;
        if (!mine.has(to) || later(t.created_at, mine.get(to))) mine.set(to, t.created_at ?? '');
      }
    } else if (set.has(t.author_rest_id) && touches(t, me)) {
      const cur = his.get(t.author_rest_id);
      if (!cur || later(t.created_at, cur.at)) his.set(t.author_rest_id, { tweetId: t.tweet_id, at: t.created_at, text: t.text });
    }
  }
  return mutual.map((id) => {
    const m = mine.get(id);
    const h = his.get(id);
    const group: EngageGroup = m !== undefined && h ? 'both' : m !== undefined ? 'onlyMe' : h ? 'onlyHim' : 'none';
    return { restId: id, group, lastMine: m || undefined, lastHis: h };
  });
}

export function countGroups(people: readonly EngagePerson[]): Record<EngageGroup, number> {
  const c: Record<EngageGroup, number> = { both: 0, onlyMe: 0, onlyHim: 0, none: 0 };
  for (const p of people) c[p.group] += 1;
  return c;
}

/**
 * ⭐ 互动队列:「只有他对我」最前(他最近找我的在前),然后「从没互动」(粉丝多的在前)。
 * 已经双向 / 我找过他的不进队列(下轮复查他回没回应)。
 */
export function engageQueue(people: readonly EngagePerson[], followers: ReadonlyMap<string, number>): EngagePerson[] {
  const him = people.filter((p) => p.group === 'onlyHim')
    .sort((a, b) => Date.parse(b.lastHis?.at ?? '') - Date.parse(a.lastHis?.at ?? ''));
  const none = people.filter((p) => p.group === 'none')
    .sort((a, b) => (followers.get(b.restId) ?? 0) - (followers.get(a.restId) ?? 0));
  return [...him, ...none];
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
    runs.push({ ...b, q: `${b.base} since:${day(c.newest)}`, pages: 0, kind: 'new' });
    /** ⚠️ until: 不含当天 → 用「最早那天 + 1」,与已覆盖的重叠一点,不漏那一天 */
    if (day(c.oldest) > since) runs.push({ ...b, q: `${b.base} since:${since} until:${day(new Date(Date.parse(c.oldest) + 86_400_000).toISOString())}`, pages: 0, kind: 'back' });
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
