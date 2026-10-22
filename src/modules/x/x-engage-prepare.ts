/**
 * ⭐⭐ 互动卡的准备 —— 主进程(2026-10-22,蓝V互关第 3 件事)
 *
 * 用户 10-22 选:从没互动的走「和求关卡一样」(点赞 + 回复,不关注);「只有他对我」排最前,回他找我的那一条。
 * 采他主页最新一页 → 按 X 现状核对还是不是互关(不是就不互动,关系写回库)→ 选一条:
 *  · 他找过我 → 回他找我的那一条(库里有它的正文)
 *  · 从没互动 → 他最近一条原创(不是回复别人、不是转发;置顶按真实时间算),避开以前互动过的
 * 返回形状与求关准备(AskPrepared)一致,互动卡和求关卡用同一个组件。
 */
import { getXDB } from '@storage/surreal/client';
import { getXHostBusy, getXHostState } from './x-host-registry';
import { bgRunningOn } from './x-bg-runner';
import { collectPersonTab } from './x-person-collect';
import { X_PAGE_NAME } from './x-pages';
import { readPerson } from './x-people-repo';
import { recentOwn, type AskTweet } from './x-ask-plan';
import { readSettings } from './x-ops-actions-repo';
import { accountForWrite } from './x-account-repo';
import { writeRelations } from './x-user-repo';
import type { AskPrepared } from './x-ask-prepare';
import type { TweetRecord } from './x-timeline-audit';
import { loadEngageThread } from './x-engage-thread';

/** 互动卡选哪条 —— 纯函数(导出给测试) */
export function pickEngageTweet(
  records: readonly TweetRecord[], person: { readonly restId: string; readonly handle: string },
  his: { readonly tweetId: string; readonly text: string; readonly createdAt?: string } | undefined,
  avoid: ReadonlySet<string>,
): { kind: 'tweet'; tweet: AskTweet; recent: AskTweet[]; why: string } | { kind: 'other'; tweet: AskTweet; recent: AskTweet[]; why: string } | { kind: 'skip'; recent: AskTweet[]; why: string } {
  const url = (id: string): string => `https://x.com/${person.handle}/status/${id}`;
  const own = recentOwn(records, person.restId);
  const recent: AskTweet[] = own.map((r) => ({ id: r.id, text: r.text, createdAt: r.createdAt, url: r.tweetUrl || url(r.id), related: false }));
  if (his && !avoid.has(his.tweetId)) {
    const t: AskTweet = { id: his.tweetId, text: his.text, createdAt: his.createdAt, url: url(his.tweetId), related: true };
    return { kind: 'tweet', tweet: t, recent: [t, ...recent.filter((x) => x.id !== t.id)], why: '他找过你(回复 / 提到你),你还没回 —— 回他这一条' };
  }
  const originals = own.filter((r) => !r.inReplyToUserId && !avoid.has(r.id));
  const pick = originals[0] ?? own.find((r) => !avoid.has(r.id));
  if (!pick) return { kind: 'skip', recent, why: recent.length === 0 ? '没采到他最近自己发的推文' : '他最近的推文都互动过了 —— 等他发新的' };
  const t = recent.find((x) => x.id === pick.id)!;
  return { kind: 'other', tweet: t, recent, why: originals[0] ? '他最近一条原创 —— 接住他说的事' : '他最近没有原创,用他最新的一条回复' };
}

export async function prepareEngage(
  wsId: string, account: string, restId: string, handle: string, hisTweetId?: string,
): Promise<AskPrepared> {
  const wcId = getXHostState(wsId)?.wcId;
  if (wcId === undefined) return { ok: false, why: 'X 网页没开' };
  const busy = getXHostBusy(wcId);
  if (busy !== null) return { ok: false, why: `X 网页正忙:${busy}` };
  if (bgRunningOn(wcId) !== null) return { ok: false, why: '后台正在采' };
  const { settings } = await readSettings();
  const r = await collectPersonTab({ wcId, page: X_PAGE_NAME.profile, handle, restId, pageCap: settings['ask.collect_pages'], attempt: 1 });
  if (!r.reached) return { ok: false, why: `去不到他的主页:${r.reason}` };
  const p = await readPerson(account, restId);
  const person = { restId, handle, name: p?.display_name, bio: p?.bio, followers: p?.followers_count, followsMe: p?.follows_me };

  /** ⭐ 动手前核对:还是不是互关(他自己推文里 X 给的关系),先写回库 */
  const mine = r.records.find((t) => t.authorRestId === restId && (t.following !== undefined || t.followedBy !== undefined));
  const live = mine ? { following: mine.following, followedBy: mine.followedBy } : undefined;
  if (live) {
    const acc = await accountForWrite(wcId);
    if (acc.kind === 'ok') {
      await writeRelations(acc, [{ person: restId, iFollow: live.following, followsMe: live.followedBy, observedAt: new Date().toISOString() }], 'engage-prepare')
        .catch((e) => console.warn(`[x.engage] @${handle} 关系没写回:${e instanceof Error ? e.message : String(e)}`));
    }
    if (live.following !== true || live.followedBy !== true) {
      const why = `已经不是互关了(X 上刚看到:${live.following ? '我关注他' : '我没关注他'} · ${live.followedBy ? '他关注我' : '他没关注我'})—— 先不互动`;
      return { ok: true, live, ledgerProblem: r.ledgerProblem, person, plan: { kind: 'skip', recent: [], why, alreadyRelated: true } };
    }
  }
  const db = getXDB();
  const [done, hisRows] = await db.query<[string[], Array<{ text?: string; created_at?: string }>]>(
    `SELECT VALUE tweet_id FROM x_engage WHERE account = $a AND person = $p;
     SELECT text, (IF created_at != NONE THEN <string> created_at ELSE NONE END) AS created_at FROM x_tweet WHERE tweet_id = $h AND author_rest_id = $p;`,
    { a: account, p: restId, h: hisTweetId ?? '' },
  );
  const his = hisTweetId && hisRows?.[0]?.text ? { tweetId: hisTweetId, text: hisRows[0].text, createdAt: hisRows[0].created_at ?? undefined } : undefined;
  const plan = pickEngageTweet(r.records, { restId, handle }, his, new Set(done ?? []));
  console.log(`[x.engage] @${handle}:${plan.kind === 'skip' ? `不互动 —— ${plan.why}` : `选推文 ${plan.tweet.id}(${plan.why})`}`);
  /** ⭐ 来龙去脉:找到这条互动所在对话的原帖(用户 10-22:「最好办法是找到这个互动帖子的原帖」) */
  const thread = plan.kind === 'skip' ? undefined : await loadEngageThread(wcId, account, restId, plan.tweet.id);
  return { ok: true, live, ledgerProblem: r.ledgerProblem, person, plan, thread };
}
