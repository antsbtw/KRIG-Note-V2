/**
 * ⭐⭐ 一批推文的统计:推文数 / 发推的用户数 / 用户特征(2026-10-16,蓝V互关 M1)—— 纯函数
 *
 * 用户 10-16:「我们需要统计的是采集到的推文数,发推文的用户数,以及用户特征」
 * 起因:页面上看得到 100 多人,库里只进了 20 条 / 10 人 —— 漏没漏采,要每批都有数可对。
 *
 * ⚠️ 关系用**这批载荷自己带的**(following / followedBy)—— 那是采集那一刻、采集网页登录的号看到的,
 *    不去库里查(库里可能是别的时候、别的号的观察)。
 * ⚠️ 倾向用同一个判断函数(x-mutual-intent),只算不写 —— 写库是「扫描」的事(人 > AI > 算法)。
 */
import { detectMutualIntent, type IntentTweet } from './x-mutual-intent';

/** 统计要用到的推文字段 —— TweetRecord 的子集 */
export type BatchTweet = {
  readonly id: string;
  readonly text?: string;
  readonly authorRestId?: string;
  readonly authorName?: string;
  readonly authorBio?: string;
  readonly isBlueVerified?: boolean;
  readonly following?: boolean;
  readonly followedBy?: boolean;
  readonly retweetOfId?: string;
};

export type BatchStats = {
  readonly tweets: number;
  /** 发推的用户数(按数字 id 去重;没 id 的不算人,单独数) */
  readonly authors: number;
  readonly noAuthorId: number;
  readonly blue: number;
  readonly withBio: number;
  /** 判为有互关倾向的人数(Bio / 名字 / 这批里他自己的推文) */
  readonly intent: number;
  readonly relation: { readonly mutual: number; readonly iWait: number; readonly theyWait: number; readonly none: number; readonly unknown: number };
};

export function summarizeBatch(rows: readonly BatchTweet[]): BatchStats {
  const byAuthor = new Map<string, { last: BatchTweet; own: IntentTweet[] }>();
  let noAuthorId = 0;
  for (const t of rows) {
    const id = t.authorRestId ?? '';
    if (id === '') { noAuthorId += 1; continue; }
    const a = byAuthor.get(id) ?? { last: t, own: [] };
    a.last = t;
    /** 转发的是别人的话,不算他的倾向 */
    if (!t.retweetOfId && t.text) a.own.push({ tweetId: t.id, text: t.text });
    byAuthor.set(id, a);
  }
  const rel = { mutual: 0, iWait: 0, theyWait: 0, none: 0, unknown: 0 };
  let blue = 0; let withBio = 0; let intent = 0;
  for (const { last, own } of byAuthor.values()) {
    if (last.isBlueVerified === true) blue += 1;
    if (last.authorBio && last.authorBio.trim() !== '') withBio += 1;
    if (detectMutualIntent(last.authorBio, own, last.authorName).hit) intent += 1;
    const i = last.following; const f = last.followedBy;
    if (i === undefined || f === undefined) rel.unknown += 1;
    else if (i && f) rel.mutual += 1;
    else if (i) rel.iWait += 1;
    else if (f) rel.theyWait += 1;
    else rel.none += 1;
  }
  return { tweets: rows.length, authors: byAuthor.size, noAuthorId, blue, withBio, intent, relation: rel };
}

/** 给人看的一行 */
export function statsLine(s: BatchStats): string {
  const r = s.relation;
  return `推文 ${s.tweets} 条 · 发推的人 ${s.authors} 个${s.noAuthorId > 0 ? `(另 ${s.noAuthorId} 条没作者 id)` : ''}`
    + ` · 蓝V ${s.blue} · 有 Bio ${s.withBio} · 有互关倾向 ${s.intent}`
    + ` · 关系:互关 ${r.mutual} / 我关注没回 ${r.iWait} / 他关注没回 ${r.theyWait} / 互不关注 ${r.none}${r.unknown > 0 ? ` / 不明 ${r.unknown}` : ''}`;
}
