/**
 * ⭐⭐ 求关:选哪一条推文(2026-10-17)—— 纯函数,离线可测
 *
 * 用户 10-17:「我们应该采集这个人的前10条推文,分析完毕,选择一条和互关相关的,点赞、留言求关、关注。三个动作。」
 * 「如果没有求关,bio也没有求关,先放弃这个人。」
 * 规则:
 *  ① 求不求关:他最近 10 条**自己发的**推文(不算转发)里有和互关相关的,或 Bio / 名字里有求关 → 求;都没有 → 放弃(说清原因)
 *  ② 回哪条:**时间优先** —— 他最新的一条(用户 10-22:「建议回复推荐以时间顺序优先」;
 *     原来先挑和互关相关的,真机推了一条 4 小时前的,他 2 小时前刚发的置顶新帖没推)
 * ⚠️ 置顶也算(10-22 真机:他的置顶是 2 小时前刚发的);置顶的老帖按时间自然排在后面。
 */
import { detectMutualIntent } from './x-mutual-intent';
import type { TweetRecord } from './x-timeline-audit';

export const ASK_RECENT_N = 10;

export type AskTweet = { readonly id: string; readonly text: string; readonly createdAt?: string; readonly url?: string; readonly related: boolean; readonly evidence?: string };

export type AskPlan =
  | { readonly kind: 'tweet'; readonly tweet: AskTweet; readonly recent: readonly AskTweet[]; readonly why: string }
  | { readonly kind: 'bio-latest'; readonly tweet: AskTweet; readonly recent: readonly AskTweet[]; readonly why: string }
  /** 再互动(求关过、满 N 天没回关,人点「再互动」):他最新一条没留过言的推文 */
  | { readonly kind: 'other'; readonly tweet: AskTweet; readonly recent: readonly AskTweet[]; readonly why: string }
  | {
    readonly kind: 'skip'; readonly recent: readonly AskTweet[]; readonly why: string;
    /** ⭐ 不求关是因为 X 上刚看到关系已经是了(2026-10-21)—— 不算他没求关,不排除 */
    readonly alreadyRelated?: true;
  };

/** 他自己发的、不是转发,按时间新→旧,取前 N(置顶也算,按它真实的发帖时间排) */
export function recentOwn(records: readonly TweetRecord[], restId: string, n = ASK_RECENT_N): TweetRecord[] {
  const seen = new Set<string>();
  return records
    .filter((r) => r.authorRestId === restId && !r.retweetOfId && r.id !== '' && !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''))
    .slice(0, n);
}

export function pickAskTweet(
  records: readonly TweetRecord[], person: { readonly restId: string; readonly handle: string; readonly bio?: string; readonly name?: string },
  /**
   * ⭐ 再互动(2026-10-19,第 4 阶段):求关过的人再来一次 —— 跳过已经求关过的那几条推文;
   * 和互关相关的优先,没有就用最新一条(他已经被求关过,不再要求帖子 / Bio 里有求关字眼)。
   */
  revisit?: { readonly avoidIds: ReadonlySet<string> },
): AskPlan {
  const own = recentOwn(records, person.restId);
  const recent: AskTweet[] = own.map((r) => {
    const h = detectMutualIntent(undefined, [{ tweetId: r.id, text: r.text }]);
    return {
      id: r.id, text: r.text, createdAt: r.createdAt, url: r.tweetUrl || `https://x.com/${person.handle}/status/${r.id}`,
      related: h.hit, evidence: h.hit ? h.evidence : undefined,
    };
  });
  if (recent.length === 0) return { kind: 'skip', recent, why: '没采到他最近自己发的推文' };
  if (revisit) {
    const fresh = recent.filter((t) => !revisit.avoidIds.has(t.id));
    if (fresh.length === 0) return { kind: 'skip', recent, why: `最近 ${recent.length} 条都已经求关过 —— 等他发新帖再互动` };
    return { kind: fresh[0].related ? 'tweet' : 'other', tweet: fresh[0], recent, why: '再互动:他最新一条还没留过言的推文' };
  }
  /** ⭐ 时间优先:求关的依据(帖子 / Bio)决定求不求,回的是他最新一条 */
  const related = recent.find((t) => t.related);
  if (related) {
    const latest = recent[0];
    return { kind: 'tweet', tweet: latest, recent, why: latest.related ? `他最新一条就和互关相关:${latest.evidence ?? ''}` : `他求关(${related.evidence ?? ''})—— 回他最新一条` };
  }
  const bioHit = detectMutualIntent(person.bio, [], person.name);
  if (bioHit.hit) {
    return { kind: 'bio-latest', tweet: recent[0], recent, why: `推文里没有,但${bioHit.where === 'name' ? '名字' : 'Bio'}里求关(${bioHit.evidence})—— 回他最新一条` };
  }
  return { kind: 'skip', recent, why: `最近 ${recent.length} 条推文和 Bio 都没有求关 —— 先放弃这个人` };
}
