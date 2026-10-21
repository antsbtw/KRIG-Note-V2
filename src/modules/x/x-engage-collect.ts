/**
 * ⭐ 采互动 —— 三条搜索(我回复过谁 / 谁回复过我 / 谁提到过我,最近 90 天),主进程(2026-10-22)
 *
 * 走已验证可靠的滚动截获(collectSearchByScroll:每页逐页账、存库回读)。一条一条跑,前一条失败 / 撞限流就停,不硬撞。
 * 推文入库后分组靠 x_tweet 的 in_reply_to_user_id / mention_ids(按数字 id,不按 handle)。
 */
import { collectSearchByScroll } from './x-search-scroll';
import { readWsAccount } from './x-account-repo';
import { advanceCursor, planEngageRuns, type EngageCursor, type EngageKey } from './x-engage';
import { readEngageCoverage, runRange, writeEngageCursor } from './x-engage-repo';

export type EngageCollectResult =
  | { readonly ok: false; readonly why: string }
  | { readonly ok: true; readonly runs: ReadonlyArray<{ readonly label: string; readonly pages: number; readonly tweets: number; readonly problem?: string }> };

export async function collectEngagement(wsId: string): Promise<EngageCollectResult> {
  const acc = await readWsAccount(wsId);
  if (!acc?.handle || !acc.restId) return { ok: false, why: `${wsId} 还没认出登录的号` };
  const runs: Array<{ label: string; pages: number; tweets: number; problem?: string }> = [];
  /** ⭐ 跨次续采:先补新的,再从已覆盖的最早那天往更早翻;三条合计 ≤45 页(x-engage.ts planEngageRuns) */
  const cov = await readEngageCoverage(acc.handle);
  const cursor: Record<EngageKey, EngageCursor> = { mine: cov.mine, toMe: cov.toMe, mentionMe: cov.mentionMe };
  const plan = planEngageRuns(acc.handle, cov, new Date());
  const done: Array<{ q: (typeof plan)[number]; problem?: string; pages: number }> = [];
  for (const q of plan) {
    const r = await collectSearchByScroll({ wsId, q: q.q, f: 'latest', wantPages: q.pages, maxMs: 6 * 60_000 });
    const problem = !r.ok ? r.why : r.rateLimited ? '撞了限流,先停在这里' : (r.totals?.badPages ?? 0) > 0 ? `${r.totals?.badPages} 页账没对上` : undefined;
    const pages = r.totals?.pages ?? 0;
    done.push({ q, problem, pages });
    runs.push({ label: `${q.label}${q.kind === 'new' ? '(补新的)' : q.kind === 'back' ? '(往更早翻)' : ''}`, pages, tweets: r.totals?.uniqueTweets ?? 0, problem });
    console.log(`[x.engage] ${q.label}「${q.q}」:${pages} 页 ${r.totals?.uniqueTweets ?? 0} 条${problem ? ` —— ${problem}` : ''}`);
    if (problem && (!r.ok || r.rateLimited)) break;
  }
  /**
   * ⚠️ 悄悄限流(2026-10-22 真机):翻完 45 页 14 分钟后再采,三条都只给第一页、显示「滚到底了」,没有 429。
   * 这一轮没有任何一条翻过 1 页 → 当成被限流:空结果不算「窗口里没有更早的了」(否则往更早翻会被误标成覆盖满 90 天)。
   */
  const throttled = done.length > 0 && done.every((d) => d.pages <= 1) && done.some((d) => d.q.pages > 1);
  if (throttled) console.warn('[x.engage] 这一轮每条都只给 1 页 —— 疑似悄悄限流,空结果不推进边界');
  for (const d of done) {
    /** ⭐ 推进连续覆盖边界 —— 只看这一轮真正命中这条搜索的推文(不含被引用 / 上文,见 runRange) */
    const range = await runRange(acc.restId, d.q.key, d.q.q);
    const next = advanceCursor(cursor[d.q.key], { kind: d.q.kind, oldest: range.oldest, newest: range.newest, failed: d.problem !== undefined || throttled }, new Date());
    /** ⚠️ 没推进也写(记下这次尝试的时间)—— 否则撞限流后每天的定时器 10 分钟就再撞一次 */
    cursor[d.q.key] = next;
    await writeEngageCursor(acc.handle, d.q.key, next);
  }
  return { ok: true, runs };
}
