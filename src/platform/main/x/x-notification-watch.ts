/**
 * 通知实时监听 —— **给人看的**,不是给程序算的。
 *
 * 用户 2026-09-03:「这里变成一个主动监听 x 页面变化的方法,显示在监听,
 *   什么时候进来了一条 notification,是什么内容,元数据是什么,统计情况如何?
 *   这样我才能够在测试中发现是否漏东西。
 *   按照你给出的方法,作为人类是无法通过肉眼来识别你给出的结果是否正确。」
 *
 * → 说得对。我给的是**我算出来的结论**(「点赞 2 条」),
 *   而人要核对的是**过程**:什么时候来了什么、原始文案是什么、
 *   我把它解成了什么、为什么算(或不算)这篇文章的。
 *   结论对不对,只有能看见过程才判断得了。
 *
 * 做法:CDP 常驻挂在 X 的 webContents 上,**不导航、不滚动**
 * (X 自己 ~10s 刷新通知页,被动收即可),每捕获一个通知载荷就:
 *   ① 逐条解析
 *   ② 与已见过的比对,标出**本次新增**的
 *   ③ 连同原始文案、目标推、归属判定一起推给界面
 */

import { webContents as allWebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { resolveAnyXWebContents } from './x-webcontents';
import { extractInteractions, isRealInteraction, type Interaction } from './x-notifications';

/** 一条被观察到的通知事件 —— 字段全部面向「人工核对」 */
export interface NotifEvent {
  /** 观察到的时刻(本地) */
  seenAt: string;
  /** X 给的通知时间 */
  notifiedAt?: string;
  kind: string;
  /** 原始文案 —— 人核对的第一依据 */
  message?: string;
  actorHandle?: string;
  actorUid: string;
  targetId: string;
  targetText?: string;
  targetConversationId?: string;
  targetQuotedStatusId?: string;
  targetHasMedia?: boolean;
  /** 是否算作互动(推荐/社群公告不算)—— 让「为什么没进名单」可见 */
  isInteraction: boolean;
  /** 归属判定:属于配置的那篇文章吗?为什么? */
  belongsToArticle: boolean;
  belongsWhy: string;
}

export interface WatchSnapshot {
  running: boolean;
  articleId?: string;
  startedAt?: string;
  /** 收到过几个通知载荷 */
  payloads: number;
  /** 累计观察到的事件(去重后) */
  total: number;
  /** 按类型计数 */
  byKind: Record<string, number>;
  /** 属于目标文章的条数 */
  belongs: number;
  /** 最近的事件,最新在前 —— 人眼核对用 */
  recent: NotifEvent[];
  /** 上次收到载荷距今多少秒 —— 能看出「是不是还在收」 */
  secondsSinceLastPayload?: number;
}

interface WatchState {
  wcId: number;
  articleId?: string;
  seen: Map<string, NotifEvent>;
  events: NotifEvent[];
  payloads: number;
  startedAt: number;
  lastPayloadAt?: number;
  onMessage: (e: unknown, method: string, params: any) => void;
  pending: Map<string, string>;
  attached: boolean;
}

let watch: WatchState | null = null;

function judgeBelongs(i: Interaction, articleId?: string): { yes: boolean; why: string } {
  if (!articleId) return { yes: false, why: '未配置文章' };
  if (i.targetId === articleId) return { yes: true, why: '直接对文章' };
  if (i.targetQuotedStatusId === articleId) return { yes: true, why: '引用转发' };
  if (i.targetConversationId === articleId) return { yes: true, why: '会话内回复' };
  return { yes: false, why: `针对别的推(${i.targetId || '无目标'})` };
}

function snapshot(): WatchSnapshot {
  if (!watch) {
    return { running: false, payloads: 0, total: 0, byKind: {}, belongs: 0, recent: [] };
  }
  const byKind: Record<string, number> = {};
  for (const e of watch.events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  return {
    running: true,
    articleId: watch.articleId,
    startedAt: new Date(watch.startedAt).toISOString(),
    payloads: watch.payloads,
    total: watch.events.length,
    byKind,
    belongs: watch.events.filter((e) => e.belongsToArticle).length,
    recent: [...watch.events].reverse().slice(0, 40),
    secondsSinceLastPayload: watch.lastPayloadAt
      ? Math.round((Date.now() - watch.lastPayloadAt) / 1000) : undefined,
  };
}

function broadcast(): void {
  const snap = snapshot();
  for (const wc of allWebContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    try { wc.send(IPC_CHANNELS.X_NOTIF_WATCH_UPDATE, snap); } catch { /* 已销毁 */ }
  }
}

/**
 * 开始监听。**不导航、不滚动** —— 用户可以自由使用 X 页面,
 * 我们只是搭个耳朵在网络层听 X 自己的刷新。
 */
export async function startNotifWatch(
  articleId?: string, targetWcId?: number,
): Promise<{ ok: true } | { error: string }> {
  if (watch) return { ok: true };

  const resolved = resolveAnyXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const state: WatchState = {
    wcId: wc.id, articleId,
    seen: new Map(), events: [], payloads: 0,
    startedAt: Date.now(), pending: new Map(), attached: false,
    onMessage: (_e, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        const u: string = params?.request?.url ?? '';
        if (u.includes('/i/api/graphql/')) state.pending.set(params.requestId, u);
        return;
      }
      if (method === 'Network.loadingFinished') {
        const u = state.pending.get(params.requestId);
        if (!u) return;
        state.pending.delete(params.requestId);
        if (!u.includes('Notifications')) return;
        wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
          .then((r: any) => {
            if (!r?.body) return;
            state.payloads++;
            state.lastPayloadAt = Date.now();
            let parsed: unknown;
            try { parsed = JSON.parse(r.body); } catch { return; }

            const found: Interaction[] = [];
            extractInteractions(parsed, found);
            for (const i of found) {
              const key = `${i.kind}|${i.actorUid}|${i.targetId}`;
              if (state.seen.has(key)) continue;      // 只报**新**的
              const b = judgeBelongs(i, state.articleId);
              const ev: NotifEvent = {
                seenAt: new Date().toISOString(),
                notifiedAt: i.notifiedAt,
                kind: i.kind,
                message: i.message,
                actorHandle: i.actorHandle,
                actorUid: i.actorUid,
                targetId: i.targetId,
                targetText: i.targetText,
                targetConversationId: i.targetConversationId,
                targetQuotedStatusId: i.targetQuotedStatusId,
                targetHasMedia: i.targetHasMedia,
                isInteraction: isRealInteraction(undefined, i.message),
                belongsToArticle: b.yes,
                belongsWhy: b.why,
              };
              state.seen.set(key, ev);
              state.events.push(ev);
              console.log(`[notif-watch] 新通知 [${ev.kind}] @${ev.actorHandle} `
                + `→ 推 ${ev.targetId} · ${ev.belongsWhy} | ${ev.message ?? ''}`);
            }
            broadcast();
          })
          .catch(() => { /* 响应体可能已丢弃 */ });
      }
    },
  };

  try { wc.debugger.attach('1.3'); state.attached = true; }
  catch { /* 已被 attach,共用 */ }
  wc.debugger.on('message', state.onMessage);
  await wc.debugger.sendCommand('Network.enable').catch(() => {});

  watch = state;
  console.log('[notif-watch] 开始监听通知(不导航、不滚动,收 X 自己的刷新)');
  broadcast();
  return { ok: true };
}

export function stopNotifWatch(): WatchSnapshot {
  if (!watch) return snapshot();
  const final = snapshot();
  const wc = allWebContents.fromId(watch.wcId);
  if (wc && !wc.isDestroyed()) {
    wc.debugger.off('message', watch.onMessage);
    if (watch.attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }
  }
  console.log(`[notif-watch] 停止 —— 共 ${final.total} 条事件 / ${final.payloads} 个载荷`);
  watch = null;
  broadcast();
  return final;
}

export function notifWatchSnapshot(): WatchSnapshot { return snapshot(); }
