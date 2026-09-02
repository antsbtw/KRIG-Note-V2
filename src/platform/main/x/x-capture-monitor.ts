/**
 * 采集监视器 —— **被动**观察:你在左边浏览 X,我在右边实时显示抓到了什么。
 *
 * 用户 2026-09-02 定的验证方式:
 * 「建议增加一个采集验证页,左边是原推文页,右边是采集显示页,我在左边操作,
 *   你在右边显示抓取的 item 内容,如果我切换任何页面,都能保证抓取这些内容,
 *   这个函数就算大概过关。理论上应该加上统计,共滚动过多少个推文,
 *   成功采集了多少条才算。」
 *
 * 为什么这比我原来的「跑一遍然后报 ✅」强:
 *  · 我那个是**自己给自己打分** —— 校验逻辑和采集逻辑同源,一起错就一起瞎
 *  · 这个是**人眼对照**:屏幕上有什么、右边抓到什么,一眼看得出差异
 *  · 换任何页面都要能抓 —— 顺带证明它不是只对某一个页面调好的
 *
 * ⭐ 关键指标是**分母**:
 *   「滚过多少条」(DOM 里出现过的 article,按 tweetId 去重)
 *   vs「采到多少条」(从 GraphQL 载荷解析出来的)
 *   只有采集率接近 100% 才算过关。没有分母时,「抓到 81 条」根本说明不了问题
 *   —— 用户正是拿官网 433 次点击当分母,才发现我漏了 80%。
 */

import { webContents as allWebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { resolveXWebContents } from './x-webcontents';
import { extractTweetsFrom, type HarvestedTweet } from './x-timeline-harvester';

interface MonitorState {
  wcId: number;
  /** 从 GraphQL 载荷采到的(权威数据) */
  captured: Map<string, HarvestedTweet>;
  /** DOM 里出现过的 tweetId —— **分母**:屏幕上滚过的 */
  seenInDom: Set<string>;
  payloads: number;
  startedAt: number;
  domTimer: ReturnType<typeof setInterval> | null;
  onMessage: (e: unknown, method: string, params: any) => void;
  pending: Map<string, string>;
  attached: boolean;
}

let monitor: MonitorState | null = null;

/** 扫当前 DOM 里可见的推文 id —— 这是「滚过多少」的来源 */
const SCAN_DOM_IDS = `(function () {
  var out = [];
  var arts = document.querySelectorAll('article[data-testid="tweet"]');
  for (var i = 0; i < arts.length; i++) {
    var t = arts[i].querySelector('time');
    var a = t && t.closest('a[href*="/status/"]');
    if (a) {
      var m = (a.getAttribute('href') || '').match(/status\\/(\\d+)/);
      if (m) out.push(m[1]);
    }
  }
  return { ids: out, scrollY: window.scrollY,
    docH: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    url: location.href };
})()`;

export interface MonitorSnapshot {
  running: boolean;
  /** 屏幕上滚过的条数(去重)—— 分母 */
  seenInDom: number;
  /** 实际采到的条数 —— 分子 */
  captured: number;
  /** 采集率 = 分子/分母 */
  captureRate: number;
  /** DOM 里见过但**没采到**的 —— 这些就是漏网的,逐个列出便于定位 */
  missing: string[];
  payloads: number;
  elapsedSec: number;
  currentUrl?: string;
  scrollY?: number;
  /** 最近采到的几条,供人眼与左边页面对照 */
  recent: Array<{
    tweetId: string; authorHandle?: string; text: string;
    createdAt?: string; isReply: boolean; likes?: number;
  }>;
}

function snapshot(extra?: { url?: string; scrollY?: number }): MonitorSnapshot {
  if (!monitor) {
    return { running: false, seenInDom: 0, captured: 0, captureRate: 0,
      missing: [], payloads: 0, elapsedSec: 0, recent: [] };
  }
  // ⚠️ 分母只算「DOM 见过的」:GraphQL 可能返回更多(如被折叠的回复),
  //    那不算漏 —— 漏的定义是**屏幕上出现过却没采到**。
  const missing = [...monitor.seenInDom].filter((id) => !monitor!.captured.has(id));
  const recent = [...monitor.captured.values()].slice(-8).reverse().map((t) => ({
    tweetId: t.tweetId,
    authorHandle: t.authorHandle,
    text: t.text.slice(0, 90),
    createdAt: t.createdAt,
    isReply: !!t.inReplyToStatusId,
    likes: t.metrics.likes,
  }));
  return {
    running: true,
    seenInDom: monitor.seenInDom.size,
    captured: monitor.captured.size,
    captureRate: monitor.seenInDom.size
      ? Math.round((monitor.seenInDom.size - missing.length) * 1000 / monitor.seenInDom.size) / 10
      : 0,
    missing: missing.slice(0, 20),
    payloads: monitor.payloads,
    elapsedSec: Math.round((Date.now() - monitor.startedAt) / 1000),
    currentUrl: extra?.url,
    scrollY: extra?.scrollY,
    recent,
  };
}

/** 把快照推给所有 renderer(右侧面板实时刷新) */
function broadcast(snap: MonitorSnapshot): void {
  for (const wc of allWebContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    try { wc.send(IPC_CHANNELS.X_CAPTURE_UPDATE, snap); } catch { /* 忽略已销毁 */ }
  }
}

/**
 * 开始监视 —— **不主动滚动**,只观察用户的操作。
 * 用户换页、滚动、点开任何菜单,都应该照样采到。
 */
export async function startCaptureMonitor(
  targetWcId?: number,
): Promise<{ ok: true } | { error: string }> {
  if (monitor) return { ok: true };

  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const captured = new Map<string, HarvestedTweet>();
  const seenInDom = new Set<string>();
  const pending = new Map<string, string>();

  const state: MonitorState = {
    wcId: wc.id, captured, seenInDom, payloads: 0,
    startedAt: Date.now(), domTimer: null, pending, attached: false,
    onMessage: (_e, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        const u: string = params?.request?.url ?? '';
        if (u.includes('/i/api/graphql/')) pending.set(params.requestId, u);
        return;
      }
      if (method === 'Network.loadingFinished') {
        if (!pending.has(params.requestId)) return;
        pending.delete(params.requestId);
        wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
          .then((r: any) => {
            if (!r?.body) return;
            state.payloads++;
            try { extractTweetsFrom(JSON.parse(r.body), captured); } catch { /* 非 JSON */ }
          })
          .catch(() => { /* 响应体可能已丢弃 */ });
      }
    },
  };

  try { wc.debugger.attach('1.3'); state.attached = true; }
  catch { /* 已 attach,共用 */ }
  wc.debugger.on('message', state.onMessage);
  await wc.debugger.sendCommand('Network.enable').catch(() => {});

  // 每 1.5s 扫一次 DOM,累计「滚过的」并推送快照
  state.domTimer = setInterval(() => {
    if (wc.isDestroyed()) { stopCaptureMonitor(); return; }
    wc.executeJavaScript(SCAN_DOM_IDS)
      .then((r: { ids: string[]; scrollY: number; docH: number; url: string }) => {
        for (const id of r.ids ?? []) seenInDom.add(id);
        broadcast(snapshot({ url: r.url, scrollY: r.scrollY }));
      })
      .catch(() => { /* 页面切换中,下轮再来 */ });
  }, 1500);

  monitor = state;
  console.log('[x-capture-monitor] 开始监视 —— 请在左侧自由浏览/滚动/换页');
  return { ok: true };
}

export function stopCaptureMonitor(): MonitorSnapshot {
  if (!monitor) return snapshot();
  const final = snapshot();
  if (monitor.domTimer) clearInterval(monitor.domTimer);
  const wc = allWebContents.fromId(monitor.wcId);
  if (wc && !wc.isDestroyed()) {
    wc.debugger.off('message', monitor.onMessage);
    if (monitor.attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }
  }
  console.log(`[x-capture-monitor] 停止 —— 滚过 ${final.seenInDom} 条, `
    + `采到 ${final.captured} 条, 采集率 ${final.captureRate}%`);
  monitor = null;
  return final;
}

export function getCaptureSnapshot(): MonitorSnapshot {
  return snapshot();
}
