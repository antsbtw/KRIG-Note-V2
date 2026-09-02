/**
 * 回复关系采集 —— 拦截 X 的 GraphQL 响应,取出权威回复字段。
 *
 * 业务定位(用户 2026-09-02):主线是「找到需要买 VPN 的人 → **回复他们**
 * → 跟踪点击 → 按买/没买分流画像」。回复关系是这条主线的第一环。
 *
 * 为什么走 CDP 而不是 DOM:
 *   X 在 `/with_replies` 页面**不渲染**「Replying to」文本(用视觉连接线表示),
 *   而 GraphQL 响应的 legacy 对象里带着完整权威字段。实测证据见
 *   docs/10-business-design/x/data-acquisition-capability-survey.md §2.4。
 *   → 从 DOM 猜是舍近求远,且必然有损。
 *
 * ⚠️ 本模块**只采回复关系**,不替换主采集链路(用户已拍板:CDP 全面换轨单独排期)。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import { harvestTimeline, type HarvestedTweet } from './x-timeline-harvester';
import { backfillRepliedFromRelations, saveReplyRelations, saveOwnReplies,
  getOwnReplyCoverage, type ReplyRelation, type OwnPost } from '../db/x-reply-relation-repo';

/*
 * ── 已删除的本地实现(2026-09-02)────────────────────────────────
 * 此处曾有:extractBottomCursor / extractAuthorCounts / extractRelations
 * 以及一整套自己的滚动循环。它们与 x-timeline-harvester 重复,
 * 而重复正是漏数据的根源 —— 同一个 bug 修三遍,每次都以为修好了,
 * 实测代价:验证页看到 597 条,旧采集器只入库 101 条(漏 83%)。
 * 现在滚动与字段抽取**只有 harvester 一处实现**,这里只管落库。
 */

export interface ReplyCollectResult {
  rounds: number;
  payloads: number;
  /** 解出的回复关系条数(去重后) */
  relations: number;
  /** 其中我自己发的推(原创+回复) */
  ownReplies: number;
  /** 自己的推入库结果 */
  ownSaved: { inserted: number; skipped: number };
  /** 写到「我的回复」那些推上的条数 */
  savedOnReplies: number;
  backfill: { received: number; markedReplied: number; amongAccepted: number; parentNotInDb: number };
  /** 覆盖到的最旧一条距今天数 —— 如实反映抓了多深,不谎称全量 */
  oldestDays: number | null;
  /** 为什么停 */
  stopReason: string;
  /** 采集底座的自校验结果:非空即有问题,不粉饰 */
  problems: string[];
  dumpPath?: string;
}

/**
 * 采集某账号的发言(原创 + 回复)并落库。
 *
 * ⭐ **滚动交给 harvestTimeline** —— 用户 2026-09-02 在采集验证页人眼验过那套:
 *    「我滚动到了 8月25日,获取到的回复大概 597 条,通过这个你就可以看出
 *      前面漏了多少数据。」
 *    实测对比:验证页看到 597 条,而旧采集器只入库 101 条 = **漏了 83%**。
 *    根因是滚动逻辑此前散在三个文件里各修各的,同一个 bug 修三遍还都没修对。
 *    现在只保留一处滚动实现(harvester),这里只负责**落库**。
 *
 * 两条流都采:/with_replies(回复)+ /<handle>(原创)——
 * AI 要学说话方式,主动表达与应答是两种语料,缺一半学不全。
 */
export async function collectReplyRelations(
  handle: string,
  targetWcId?: number,
): Promise<ReplyCollectResult | { error: string }> {
  const h = normalizeHandle(handle);
  if (!h) return { error: 'empty handle' };

  const streams = [
    `https://x.com/${h}/with_replies`,
    `https://x.com/${h}`,
  ];

  const all = new Map<string, HarvestedTweet>();
  const problems: string[] = [];
  let rounds = 0;
  let payloads = 0;
  let stopReason = '';

  for (const url of streams) {
    const r = await harvestTimeline(url, targetWcId);
    if ('error' in r) {
      problems.push(`${url}: ${r.error}`);
      continue;
    }
    for (const t of r.tweets) if (!all.has(t.tweetId)) all.set(t.tweetId, t);
    rounds += r.rounds;
    payloads += r.payloads;
    stopReason = stopReason ? `${stopReason};${r.stopReason}` : r.stopReason;
    // 底座的自校验结果如实带出 —— 有问题就该看见,不埋掉
    for (const p of r.problems) problems.push(`${url}: ${p}`);
  }

  const list = [...all.values()];

  // 关系:任何带父推的推(不限本人)—— 用于标记「被回复的线索」
  const relations: ReplyRelation[] = list
    .filter((t) => t.inReplyToStatusId)
    .map((t) => ({
      tweetId: t.tweetId,
      inReplyToStatusId: t.inReplyToStatusId!,
      inReplyToScreenName: t.inReplyToScreenName
        ? normalizeHandle(t.inReplyToScreenName) : undefined,
      conversationId: t.conversationId,
    }));

  // 我自己发的推(原创 + 回复)—— AI 语料
  const ownPosts: OwnPost[] = list
    .filter((t) => t.authorHandle && normalizeHandle(t.authorHandle) === h)
    .map((t) => ({
      tweetId: t.tweetId,
      text: t.text,
      authorHandle: h,
      createdAt: t.createdAt,
      lang: t.lang,
      inReplyToStatusId: t.inReplyToStatusId,
      inReplyToScreenName: t.inReplyToScreenName
        ? normalizeHandle(t.inReplyToScreenName) : undefined,
      conversationId: t.conversationId,
      metrics: t.metrics,
    }));

  const times = list.map((t) => t.createdAt).filter(Boolean) as string[];
  const oldestDays = times.length
    ? Math.round((Date.now() - Math.min(...times.map((t) => new Date(t).getTime())))
        / 86_400_000 * 10) / 10
    : null;

  // 诊断落盘:采集有成本,结果留痕便于复核
  let dumpPath: string | undefined;
  try {
    const dir = join(app.getPath('userData'), 'x-payload-survey');
    mkdirSync(dir, { recursive: true });
    dumpPath = join(dir, `replies-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(dumpPath, JSON.stringify(
      { handle: h, rounds, payloads, oldestDays, stopReason, problems,
        relations, ownReplies: ownPosts }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[x-reply-collector] 诊断落盘失败(不影响主流程):', err);
  }

  // 顺序要紧:先插自己的推,再补关系 —— 否则新插的行拿不到关系更新
  const ownSaved = await saveOwnReplies(ownPosts);
  const savedOnReplies = await saveReplyRelations(relations);
  const backfill = await backfillRepliedFromRelations(relations);

  const cov = await getOwnReplyCoverage();
  console.log(`[x-reply-collector] @${h}: ${rounds} 轮 / ${payloads} 响应 → `
    + `抓到 ${list.length} 条(我的 ${ownPosts.length}),入库 ${ownSaved.inserted} 条新的;`
    + `标记 replied ${backfill.markedReplied}(已采纳 ${backfill.amongAccepted});`
    + `库存合计 ${cov.count} 条`);
  if (problems.length) console.warn('[x-reply-collector] 校验问题:', problems);

  return {
    rounds, payloads,
    relations: relations.length,
    ownReplies: ownPosts.length,
    ownSaved, savedOnReplies, backfill,
    oldestDays, stopReason, problems, dumpPath,
  };
}
