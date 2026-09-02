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
import { resolveXWebContents } from './x-webcontents';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import { backfillRepliedFromRelations, saveReplyRelations, saveOwnReplies,
  type ReplyRelation, type OwnReply } from '../db/x-reply-relation-repo';

/** 取字符串字段(载荷里缺字段是常态,不能假设存在) */
function str(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === 'string' && v ? v : undefined;
}
function num(o: Record<string, unknown>, k: string): number | undefined {
  const v = o[k];
  return typeof v === 'number' ? v : undefined;
}

/**
 * 递归找出响应里所有带回复字段的 legacy 对象。
 *
 * 同时产出两样东西 —— 它们服务不同目的,别合并:
 *  - relations:轻量关系,用于**标记被回复的线索**为「我回复过了」
 *  - ownReplies:我自己发的回复全量字段,用于**入库**(会话链/话术复盘/促转发)
 *
 * ⚠️ 长推 full_text 会被截断,真全文在 note_tweet(能力勘查 §4.6)。
 */
function extractRelations(
  node: unknown,
  out: ReplyRelation[],
  own: OwnReply[],
  selfHandle: string,
): void {
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) extractRelations(item, out, own, selfHandle);
    return;
  }

  const obj = node as Record<string, unknown>;
  const legacy = obj.legacy as Record<string, unknown> | undefined;
  if (legacy && typeof legacy === 'object') {
    const parent = str(legacy, 'in_reply_to_status_id_str');
    const self = str(legacy, 'id_str');
    if (parent && self) {
      const replyTo = str(legacy, 'in_reply_to_screen_name');
      const conv = str(legacy, 'conversation_id_str');
      out.push({
        tweetId: self,
        inReplyToStatusId: parent,
        inReplyToScreenName: replyTo ? normalizeHandle(replyTo) : undefined,
        conversationId: conv,
      });

      // 作者是不是我 —— 载荷里作者在 core.user_results,回落到 screen_name 字段
      const core = obj.core as Record<string, unknown> | undefined;
      const ur = core?.user_results as Record<string, unknown> | undefined;
      const urr = ur?.result as Record<string, unknown> | undefined;
      const ucore = urr?.core as Record<string, unknown> | undefined;
      const authorHandle = ucore ? str(ucore, 'screen_name') : undefined;

      if (authorHandle && normalizeHandle(authorHandle) === selfHandle) {
        // 长推优先取 note_tweet 全文(full_text 会被截断)
        const note = obj.note_tweet as Record<string, unknown> | undefined;
        const nres = (note?.note_tweet_results as Record<string, unknown> | undefined)
          ?.result as Record<string, unknown> | undefined;
        const fullText = (nres && str(nres, 'text')) ?? str(legacy, 'full_text') ?? '';

        own.push({
          tweetId: self,
          text: fullText,
          authorHandle: normalizeHandle(authorHandle),
          createdAt: str(legacy, 'created_at'),
          lang: str(legacy, 'lang'),
          inReplyToStatusId: parent,
          inReplyToScreenName: replyTo ? normalizeHandle(replyTo) : undefined,
          conversationId: conv,
          metrics: {
            likes: num(legacy, 'favorite_count'),
            retweets: num(legacy, 'retweet_count'),
            replies: num(legacy, 'reply_count'),
            quotes: num(legacy, 'quote_count'),
            bookmarks: num(legacy, 'bookmark_count'),
          },
        });
      }
    }
  }

  for (const v of Object.values(obj)) extractRelations(v, out, own, selfHandle);
}

export interface ReplyCollectResult {
  /** 滚了几轮 */
  rounds: number;
  /** 捕获的 GraphQL 响应数 */
  payloads: number;
  /** 解出的回复关系条数(去重后) */
  relations: number;
  /** 其中我自己发的回复条数 */
  ownReplies: number;
  /** 自己的回复入库结果 */
  ownSaved: { inserted: number; skipped: number };
  /** 写到「我的回复」那些推上的条数 */
  savedOnReplies: number;
  /** 回填战果 */
  backfill: { received: number; markedReplied: number; amongAccepted: number; parentNotInDb: number };
  /** 覆盖到的最旧回复距今天数 —— 如实反映抓了多深,不谎称全量 */
  oldestDays: number | null;
  /** 为什么停 —— 区分「到底了」与「封顶了」,不含糊 */
  stopReason: string;
  /** 诊断落盘路径 */
  dumpPath?: string;
}

/**
 * 采集指定账号的回复关系。
 *
 * @param handle     目标账号(通常是自己)
 * @param maxRounds  滚动轮次上限
 * @param targetDays 回溯窗口(天)—— 达到即停。用户拍板:一般 7 天够判行为特征
 *
 * ⚠️ **边界如实汇报**:X 用虚拟列表 + 懒加载,B′ 诊断实测滚 60 轮只覆盖 3.2 天。
 *    本函数返回 oldestDays,调用方**不得声称"全量"** —— 抓到多少说多少。
 */
export async function collectReplyRelations(
  handle: string,
  targetWcId?: number,
  maxRounds = 40,
  targetDays = 7,
): Promise<ReplyCollectResult | { error: string }> {
  const h = normalizeHandle(handle);
  if (!h) return { error: 'empty handle' };

  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  let attached = false;
  try { wc.debugger.attach('1.3'); attached = true; }
  catch (err) { console.warn('[x-reply-collector] attach 失败(可能已 attach):', err); }

  const relMap = new Map<string, ReplyRelation>();
  const ownMap = new Map<string, OwnReply>();
  const times: string[] = [];
  const pending = new Map<string, string>();
  let payloads = 0;

  const onMessage = (_e: unknown, method: string, params: any): void => {
    if (method === 'Network.requestWillBeSent') {
      const url: string = params?.request?.url ?? '';
      if (url.includes('/i/api/graphql/')) pending.set(params.requestId, url);
      return;
    }
    if (method === 'Network.loadingFinished') {
      const url = pending.get(params.requestId);
      if (!url) return;
      pending.delete(params.requestId);
      wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
        .then((r: any) => {
          if (!r?.body) return;
          payloads++;
          try {
            const parsed = JSON.parse(r.body);
            const found: ReplyRelation[] = [];
            const foundOwn: OwnReply[] = [];
            extractRelations(parsed, found, foundOwn, h);
            for (const rel of found) relMap.set(rel.tweetId, rel);
            for (const o of foundOwn) ownMap.set(o.tweetId, o);
            // 记录时间戳以计算覆盖深度
            const collectTimes = (n: unknown): void => {
              if (n === null || typeof n !== 'object') return;
              if (Array.isArray(n)) { n.forEach(collectTimes); return; }
              const o = n as Record<string, unknown>;
              const lg = o.legacy as Record<string, unknown> | undefined;
              if (lg && typeof lg.created_at === 'string') times.push(lg.created_at);
              Object.values(o).forEach(collectTimes);
            };
            collectTimes(parsed);
          } catch { /* 非 JSON 跳过 */ }
        })
        .catch(() => { /* 响应体可能已丢弃 */ });
    }
  };

  wc.debugger.on('message', onMessage);
  await wc.debugger.sendCommand('Network.enable').catch(() => {});

  wc.loadURL(`https://x.com/${h}/with_replies`);
  await new Promise((r) => setTimeout(r, 4000));

  let rounds = 0;
  let oldestDays: number | null = null;
  let stopReason = `达到轮次上限 ${maxRounds}`;
  let noProgress = 0;
  let lastRelCount = 0;

  for (let i = 1; i <= maxRounds; i++) {
    rounds = i;
    if (times.length) {
      const oldest = times.reduce((a, b) => (new Date(a) < new Date(b) ? a : b));
      oldestDays = Math.round((Date.now() - new Date(oldest).getTime()) / 86_400_000 * 10) / 10;
      if (oldestDays >= targetDays) { stopReason = `已覆盖目标 ${targetDays} 天`; break; }
    }

    // ⚠️ window.scrollBy 对 X 的虚拟列表**常常无效** —— 实测 40 轮只触发 12 个
    // 请求,大部分滚动没让页面去取下一页(两次运行都恰好停在 2.6 天)。
    // 原因:真正滚动的是内部容器,不是 window;且 X 只在「接近底部」时才拉下一页。
    // 改为:直接把页面滚到文档底部,并回报**是否真的动了**(fail loud 的前提是能观测)。
    const moved = await wc.executeJavaScript(`(function () {
      var before = window.scrollY;
      var docH = Math.max(
        document.body.scrollHeight, document.documentElement.scrollHeight);
      window.scrollTo(0, docH);
      // 兜底:若 window 没动,找真正可滚的容器推一把
      if (window.scrollY === before) {
        var all = document.querySelectorAll('div');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (el.scrollHeight > el.clientHeight + 200) { el.scrollTop = el.scrollHeight; break; }
        }
      }
      return { before: before, after: window.scrollY, docH: docH };
    })()`).catch(() => null) as { before: number; after: number; docH: number } | null;

    await new Promise((r) => setTimeout(r, 2200));

    // 进度以**新解出的关系**为准,不以滚动位移为准:
    // 位移了但没新数据 = 到底了或懒加载封顶,两者都该停
    if (relMap.size === lastRelCount) {
      noProgress++;
      if (noProgress >= 6) {
        stopReason = `连续 6 轮无新数据(scrollY=${moved?.after ?? '?'}/${moved?.docH ?? '?'})`
          + ` —— 到底了或 X 懒加载封顶`;
        break;
      }
    } else {
      noProgress = 0;
      lastRelCount = relMap.size;
    }
  }

  wc.debugger.off('message', onMessage);
  if (attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }

  const relations = [...relMap.values()];
  const ownReplies = [...ownMap.values()];
  console.log(`[x-reply-collector] @${h}: ${rounds} 轮, ${payloads} 个响应, `
    + `解出 ${relations.length} 条回复关系(其中我自己发的 ${ownReplies.length} 条), `
    + `覆盖 ${oldestDays ?? '?'} 天`);

  // 诊断落盘:采集是有成本的,结果留痕便于复核(不必再跑一次)
  let dumpPath: string | undefined;
  try {
    const dir = join(app.getPath('userData'), 'x-payload-survey');
    mkdirSync(dir, { recursive: true });
    dumpPath = join(dir, `replies-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(dumpPath, JSON.stringify(
      { handle: h, rounds, payloads, oldestDays, stopReason, relations, ownReplies }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[x-reply-collector] 诊断落盘失败(不影响主流程):', err);
  }

  // 顺序要紧:先把自己的回复插进去,再补关系 —— 否则新插的行拿不到关系更新
  const ownSaved = await saveOwnReplies(ownReplies);
  const savedOnReplies = await saveReplyRelations(relations);
  const backfill = await backfillRepliedFromRelations(relations);

  console.log(`[x-reply-collector] 落库: 自己的回复入库 ${ownSaved.inserted} 条`
    + `(已存在 ${ownSaved.skipped} 条); 补关系 ${savedOnReplies} 条; `
    + `标记 replied ${backfill.markedReplied} 条(其中已采纳 ${backfill.amongAccepted});`
    + `父推不在库 ${backfill.parentNotInDb} 条`);

  return { rounds, payloads, relations: relations.length, ownReplies: ownReplies.length,
    ownSaved, savedOnReplies, backfill, oldestDays, stopReason, dumpPath };
}
