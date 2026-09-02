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
import { backfillRepliedFromRelations, saveReplyRelations, type ReplyRelation }
  from '../db/x-reply-relation-repo';

/** 递归找出响应里所有带回复字段的 legacy 对象 */
function extractRelations(node: unknown, out: ReplyRelation[]): void {
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) extractRelations(item, out);
    return;
  }

  const obj = node as Record<string, unknown>;
  const legacy = obj.legacy as Record<string, unknown> | undefined;
  if (legacy && typeof legacy === 'object') {
    const parent = legacy.in_reply_to_status_id_str;
    const self = legacy.id_str;
    if (typeof parent === 'string' && parent && typeof self === 'string' && self) {
      out.push({
        tweetId: self,
        inReplyToStatusId: parent,
        inReplyToScreenName: typeof legacy.in_reply_to_screen_name === 'string'
          ? normalizeHandle(legacy.in_reply_to_screen_name) : undefined,
        conversationId: typeof legacy.conversation_id_str === 'string'
          ? legacy.conversation_id_str : undefined,
      });
    }
  }

  for (const v of Object.values(obj)) extractRelations(v, out);
}

export interface ReplyCollectResult {
  /** 滚了几轮 */
  rounds: number;
  /** 捕获的 GraphQL 响应数 */
  payloads: number;
  /** 解出的回复关系条数(去重后) */
  relations: number;
  /** 写到「我的回复」那些推上的条数 */
  savedOnReplies: number;
  /** 回填战果 */
  backfill: { received: number; markedReplied: number; amongAccepted: number; parentNotInDb: number };
  /** 覆盖到的最旧回复距今天数 —— 如实反映抓了多深,不谎称全量 */
  oldestDays: number | null;
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
            extractRelations(parsed, found);
            for (const rel of found) relMap.set(rel.tweetId, rel);
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
  for (let i = 1; i <= maxRounds; i++) {
    rounds = i;
    if (times.length) {
      const oldest = times.reduce((a, b) => (new Date(a) < new Date(b) ? a : b));
      oldestDays = Math.round((Date.now() - new Date(oldest).getTime()) / 86_400_000 * 10) / 10;
      if (oldestDays >= targetDays) break;
    }
    await wc.executeJavaScript(`window.scrollBy(0, window.innerHeight * 0.9)`).catch(() => {});
    await new Promise((r) => setTimeout(r, 1800));
  }

  wc.debugger.off('message', onMessage);
  if (attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }

  const relations = [...relMap.values()];
  console.log(`[x-reply-collector] @${h}: ${rounds} 轮, ${payloads} 个响应, `
    + `解出 ${relations.length} 条回复关系, 覆盖 ${oldestDays ?? '?'} 天`);

  // 诊断落盘:采集是有成本的,结果留痕便于复核(不必再跑一次)
  let dumpPath: string | undefined;
  try {
    const dir = join(app.getPath('userData'), 'x-payload-survey');
    mkdirSync(dir, { recursive: true });
    dumpPath = join(dir, `replies-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(dumpPath, JSON.stringify({ handle: h, rounds, payloads, oldestDays, relations }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[x-reply-collector] 诊断落盘失败(不影响主流程):', err);
  }

  const savedOnReplies = await saveReplyRelations(relations);
  const backfill = await backfillRepliedFromRelations(relations);

  console.log(`[x-reply-collector] 落库: 我的回复 ${savedOnReplies} 条补了关系; `
    + `标记 replied ${backfill.markedReplied} 条(其中已采纳 ${backfill.amongAccepted});`
    + `父推不在库 ${backfill.parentNotInDb} 条`);

  return { rounds, payloads, relations: relations.length, savedOnReplies, backfill, oldestDays, dumpPath };
}
