/**
 * ⭐⭐ 求关:选哪一条推文(2026-10-17)—— 纯函数,离线可测
 *
 * 用户 10-17:「我们应该采集这个人的前10条推文,分析完毕,选择一条和互关相关的,点赞、留言求关、关注。三个动作。」
 * 「如果没有求关,bio也没有求关,先放弃这个人。」
 * 规则:
 *  ① 他最近 10 条**自己发的**推文(不算转发、不算置顶)里,最新一条和互关相关的 → 用它
 *  ② 推文里没有、但 Bio / 名字里有求关 → 用他最新一条原创推文
 *  ③ 都没有 → 放弃这个人(说清原因)
 */
import { detectMutualIntent } from './x-mutual-intent';
import type { TweetRecord } from './x-timeline-audit';

export const ASK_RECENT_N = 10;

export type AskTweet = { readonly id: string; readonly text: string; readonly createdAt?: string; readonly url?: string; readonly related: boolean; readonly evidence?: string };

export type AskPlan =
  | { readonly kind: 'tweet'; readonly tweet: AskTweet; readonly recent: readonly AskTweet[]; readonly why: string }
  | { readonly kind: 'bio-latest'; readonly tweet: AskTweet; readonly recent: readonly AskTweet[]; readonly why: string }
  | { readonly kind: 'skip'; readonly recent: readonly AskTweet[]; readonly why: string };

/** 他自己发的、不是转发、不是置顶,按时间新→旧,取前 N */
export function recentOwn(records: readonly TweetRecord[], restId: string, n = ASK_RECENT_N): TweetRecord[] {
  const seen = new Set<string>();
  return records
    .filter((r) => r.authorRestId === restId && !r.retweetOfId && r.pinned !== true && r.id !== '' && !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''))
    .slice(0, n);
}

export function pickAskTweet(
  records: readonly TweetRecord[], person: { readonly restId: string; readonly handle: string; readonly bio?: string; readonly name?: string },
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
  const related = recent.find((t) => t.related);
  if (related) return { kind: 'tweet', tweet: related, recent, why: `他最近和互关相关的推文:${related.evidence ?? ''}` };
  const bioHit = detectMutualIntent(person.bio, [], person.name);
  if (bioHit.hit) {
    return { kind: 'bio-latest', tweet: recent[0], recent, why: `推文里没有,但${bioHit.where === 'name' ? '名字' : 'Bio'}里求关(${bioHit.evidence})—— 用他最新一条原创推文` };
  }
  return { kind: 'skip', recent, why: `最近 ${recent.length} 条推文和 Bio 都没有求关 —— 先放弃这个人` };
}
