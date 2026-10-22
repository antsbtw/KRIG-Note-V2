/**
 * ⭐ 采互动 —— 三条搜索(我回复过谁 / 谁回复过我 / 谁提到过我,最近 90 天),主进程(2026-10-22)
 *
 * 走已验证可靠的滚动截获(collectSearchByScroll:每页逐页账、存库回读)。一条一条跑,前一条失败 / 撞限流就停,不硬撞。
 * ⭐ 策略见 x-engage.ts nextEngageRun(小段多次、先新后旧、按额度账本、撞限流 15 分钟后自动接着采)。
 * 推文入库后分组靠 x_tweet 的 in_reply_to_user_id / mention_ids(按数字 id,不按 handle)。
 */
import { collectSearchByScroll } from './x-search-scroll';
import { readWsAccount } from './x-account-repo';
import { SEGMENT_PAGES, advanceCursor, nextEngageRun, type EngageCursor, type EngageKey } from './x-engage';
import { recordSearch, searchBudget } from './x-search-budget';
import { readEngageCoverage, runRange, writeEngageCursor } from './x-engage-repo';

export type EngageCollectResult =
  | { readonly ok: false; readonly why: string }
  | { readonly ok: true; readonly runs: ReadonlyArray<{ readonly label: string; readonly pages: number; readonly tweets: number; readonly problem?: string }>; readonly note?: string };

/** 一页满 20 条;第一页就「到头」却是满的 —— 多半是悄悄限流(后面明明还有) */
const FULL_PAGE = 18;

export async function collectEngagement(wsId: string): Promise<EngageCollectResult> {
  const acc = await readWsAccount(wsId);
  if (!acc?.handle || !acc.restId) return { ok: false, why: `${wsId} 还没认出登录的号` };
  /** ⭐ 先看额度账本:撞过限流没过 15 分钟 / 最近 15 分钟搜得太多 → 不硬撞,说清什么时候能接着采 */
  const budget = searchBudget();
  if (budget.waitUntil !== undefined) {
    return { ok: true, runs: [], note: `刚撞过限流,${new Date(budget.waitUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 后自动接着采` };
  }
  if (budget.freePages < 5) return { ok: true, runs: [], note: `最近 15 分钟已经搜了 ${budget.usedPages} 页,额度留给你自己用 —— 过一会儿自动接着采` };
  const runs: Array<{ label: string; pages: number; tweets: number; problem?: string }> = [];
  const cov = await readEngageCoverage(acc.handle);
  const cursor: Record<EngageKey, EngageCursor> = { mine: cov.mine, toMe: cov.toMe, mentionMe: cov.mentionMe };
  let left = Math.min(budget.freePages, SEGMENT_PAGES);
  const done = new Set<string>();
  let stopped: string | undefined;
  for (let q = nextEngageRun(acc.handle, cursor, new Date(), left, done); q; q = nextEngageRun(acc.handle, cursor, new Date(), left, done)) {
    done.add(`${q.key}:${q.kind}`);
    /** 从头采已经覆盖了这条的新和旧 —— 这一段里别再补新的 / 往回翻 */
    if (q.kind === 'fresh') { done.add(`${q.key}:new`); done.add(`${q.key}:back`); }
    const r = await collectSearchByScroll({ wsId, q: q.q, f: 'latest', wantPages: q.pages, maxMs: 6 * 60_000 });
    const pages = r.totals?.pages ?? 0;
    const reachedBottom = (r.harvest as { reachedBottom?: boolean } | undefined)?.reachedBottom === true;
    /**
     * ⚠️ 悄悄限流(2026-10-22 真机):只给第一页、显示「滚到底了」,没有 429。
     * 判据:想要不止 1 页,第一页是满的(≥18 条)却到头了 —— 后面明明还有。
     */
    const throttled = r.ok && !r.rateLimited && reachedBottom && pages <= 1 && q.pages > 1 && (r.totals?.xTweets ?? 0) >= FULL_PAGE;
    if (throttled) recordSearch(0, true);
    const failed = !r.ok || r.rateLimited || throttled;
    /** 结果自己到头了(不是被限流掐断、也不是页数用完)—— 这条在这个时间段里没有更多了 */
    const exhausted = !failed && reachedBottom && pages < q.pages;
    const problem = !r.ok ? r.why : r.rateLimited ? '撞了限流' : throttled ? '疑似悄悄限流' : (r.totals?.badPages ?? 0) > 0 ? `${r.totals?.badPages} 页账没对上` : undefined;
    runs.push({ label: `${q.label}${q.kind === 'new' ? '(补新的)' : q.kind === 'back' ? (q.goal === 'recent' ? '(补齐 7 天)' : '(往 90 天前补)') : ''}`, pages, tweets: r.totals?.uniqueTweets ?? 0, problem });
    console.log(`[x.engage] ${q.label}「${q.q}」:${pages}/${q.pages} 页 ${r.totals?.uniqueTweets ?? 0} 条${exhausted ? ' · 到头' : ''}${problem ? ` —— ${problem}` : ''}`);
    /** ⭐ 推进连续覆盖边界 —— 只看这一轮真正命中这条搜索的推文(不含被引用 / 上文,见 runRange) */
    const range = await runRange(acc.restId, q.key, q.q);
    const next = advanceCursor(cursor[q.key], { kind: q.kind, oldest: range.oldest, newest: range.newest, failed, exhausted }, new Date());
    /** ⚠️ 没推进也写(记下这次尝试的时间)—— 定时器按它决定多久再来 */
    cursor[q.key] = next;
    await writeEngageCursor(acc.handle, q.key, next);
    left -= Math.max(pages, 1);
    if (failed) { stopped = problem; break; }
  }
  if (runs.length === 0) return { ok: true, runs, note: '额度不够这一段,过一会儿自动接着采' };
  const note = stopped ? `${stopped} —— 已停在这里,15 分钟后自动接着采(进度不会丢)` : undefined;
  return { ok: true, runs, note };
}
