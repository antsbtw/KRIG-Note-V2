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
  for (const q of planEngageRuns(acc.handle, cov, new Date())) {
    const r = await collectSearchByScroll({ wsId, q: q.q, f: 'latest', wantPages: q.pages, maxMs: 6 * 60_000 });
    const problem = !r.ok ? r.why : r.rateLimited ? '撞了限流,先停在这里' : (r.totals?.badPages ?? 0) > 0 ? `${r.totals?.badPages} 页账没对上` : undefined;
    /** ⭐ 推进连续覆盖边界 —— 只看这一轮真正命中这条搜索的推文(不含被引用 / 上文,见 runRange) */
    const range = await runRange(acc.restId ?? '', q.key, q.q);
    const next = advanceCursor(cursor[q.key], { kind: q.kind, oldest: range.oldest, newest: range.newest, failed: problem !== undefined }, new Date());
    /** ⚠️ 没推进也写(记下这次尝试的时间)—— 否则撞限流后每天的定时器 10 分钟就再撞一次 */
    cursor[q.key] = next;
    await writeEngageCursor(acc.handle, q.key, next);
    runs.push({ label: `${q.label}${q.kind === 'new' ? '(补新的)' : q.kind === 'back' ? '(往更早翻)' : ''}`, pages: r.totals?.pages ?? 0, tweets: r.totals?.uniqueTweets ?? 0, problem });
    console.log(`[x.engage] ${q.label}「${q.q}」:${r.totals?.pages ?? 0} 页 ${r.totals?.uniqueTweets ?? 0} 条${problem ? ` —— ${problem}` : ''}`);
    if (problem && (!r.ok || r.rateLimited)) break;
  }
  return { ok: true, runs };
}
