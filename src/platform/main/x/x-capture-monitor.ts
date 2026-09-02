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
  /**
   * **当前屏幕上**的 id,按页面从上到下的顺序。
   * ⚠️ 不能拿 captured(Map 按「首次发现」排序)当展示顺序 ——
   * 那样右侧列的是「最近发现的」而不是「现在看到的」,与左侧完全对不上
   * (2026-09-02 实测:左边第一条在右边排到了最后)。
   */
  onScreen: string[];
  /** 最近一轮跳过的非推文元素数(广告) */
  lastSkipped: number;
  payloads: number;
  startedAt: number;
  domTimer: ReturnType<typeof setInterval> | null;
  onMessage: (e: unknown, method: string, params: any) => void;
  pending: Map<string, string>;
  attached: boolean;
}

let monitor: MonitorState | null = null;

/**
 * 扫当前 DOM:既取「滚过多少」(分母),也**顺带把内容抓下来**。
 *
 * ⚠️ 为什么不能只靠 CDP 拦截 GraphQL(2026-09-02 实测暴露):
 *   用户开始监视时页面**已经加载过**(scrollY=4884),那些推文是监视之前
 *   到达的 —— 不会再有新的 GraphQL 响应带它们。结果就是
 *   「滚过 14 / 采到 0 / 响应 0」,看着像彻底坏了,其实是时机问题。
 *   → DOM 兜底:屏幕上有什么就能抓什么,与何时开始监视无关。
 *   载荷仍是**首选**(字段全:conversation_id / favorited / 长推全文),
 *   DOM 只补 CDP 没覆盖到的那部分。
 */
const SCAN_DOM_IDS = `(function () {
  var out = [];
  var skipped = 0;
  var arts = document.querySelectorAll('article[data-testid="tweet"]');
  for (var i = 0; i < arts.length; i++) {
    var art = arts[i];
    var t = art.querySelector('time');
    var a = t && t.closest('a[href*="/status/"]');
    // ⚠️ 广告(Ad)没有 <time>、没有 status 链接 —— 它们**不是推文**,
    //    跳过是对的,但必须**计数报出来**,否则用户看到左边有、右边没有,
    //    会以为漏采了(2026-09-02 实测:HubSpot 广告就是这种情况)。
    if (!a) { skipped++; continue; }
    var m = (a.getAttribute('href') || '').match(/status\\/(\\d+)/);
    if (!m) { skipped++; continue; }

    var handle = '';
    try {
      var un = art.querySelector('[data-testid="User-Name"]');
      if (un) {
        var sp = un.querySelectorAll('span');
        for (var j = 0; j < sp.length; j++) {
          var s = (sp[j].textContent || '').trim();
          if (s.indexOf('@') === 0) { handle = s; break; }
        }
      }
    } catch (e) {}

    var text = '';
    try {
      var tt = art.querySelector('[data-testid="tweetText"]');
      text = tt ? (tt.textContent || '') : '';
    } catch (e) {}

    var likes = 0;
    try {
      var lb = art.querySelector('[data-testid="like"], [data-testid="unlike"]');
      if (lb) {
        var ls = lb.querySelector('span');
        var lt = ls ? (ls.textContent || '').replace(/,/g, '') : '';
        if (lt.indexOf('K') > -1) likes = Math.round(parseFloat(lt) * 1000);
        else likes = parseInt(lt) || 0;
      }
    } catch (e) {}

    out.push({ id: m[1], handle: handle, text: text.slice(0, 200),
      createdAt: t ? (t.getAttribute('datetime') || '') : '', likes: likes });
  }
  return { items: out, skipped: skipped, scrollY: window.scrollY,
    docH: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    url: location.href };
})()`;

export interface MonitorSnapshot {
  running: boolean;
  /** 此刻屏幕上有多少条(用于「屏幕 N 条,采到 M 条」的即时比对) */
  onScreenCount: number;
  /** 本轮跳过的非推文元素(广告等,无 time/status 链接)—— 不算漏采 */
  skippedAds: number;
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
    /** true = 从 DOM 兜底抓的(字段较少);false = 从 GraphQL 载荷抓的(字段全) */
    fromDom: boolean;
  }>;
}

function snapshot(extra?: { url?: string; scrollY?: number }): MonitorSnapshot {
  if (!monitor) {
    return { running: false, onScreenCount: 0, skippedAds: 0, seenInDom: 0, captured: 0, captureRate: 0,
      missing: [], payloads: 0, elapsedSec: 0, recent: [] };
  }
  // ⚠️ 分母只算「DOM 见过的」:GraphQL 可能返回更多(如被折叠的回复),
  //    那不算漏 —— 漏的定义是**屏幕上出现过却没采到**。
  const missing = [...monitor.seenInDom].filter((id) => !monitor!.captured.has(id));
  // ⭐ **按屏幕顺序列出**(用户 2026-09-02:「把采集到的推文显示在右侧,
  //    这样我一眼就可以比对到是否采集了」)。
  //    此前用 captured 的插入序 = 「最近发现的」,与左侧顺序完全不同,
  //    左边第一条会排到右边最后 —— 看着像"对不上",其实是排序错了。
  //    现在:先列当前屏幕上的(顺序一致),屏幕上没有的不列。
  const onScreenTweets = monitor.onScreen
    .map((id) => monitor!.captured.get(id))
    .filter((t): t is HarvestedTweet => !!t);
  const recent = onScreenTweets.map((t) => ({
    tweetId: t.tweetId,
    authorHandle: t.authorHandle,
    text: t.text.slice(0, 140),
    createdAt: t.createdAt,
    isReply: !!t.inReplyToStatusId,
    likes: t.metrics.likes,
    fromDom: (t as HarvestedTweet & { fromDom?: boolean }).fromDom === true,
  }));
  return {
    running: true,
    onScreenCount: monitor.onScreen.length,
    skippedAds: monitor.lastSkipped,
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
  // onScreen 每轮重建 —— 它反映「此刻屏幕上有什么」,不是累计
  const pending = new Map<string, string>();

  const state: MonitorState = {
    wcId: wc.id, captured, seenInDom, onScreen: [], lastSkipped: 0, payloads: 0,
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

  // ⚠️ 这里曾经 `catch {}` 吞掉一切 —— 实测后果:采到 0 / 响应 0,
  //    而界面上没有任何错误,典型的静默坍缩。必须把真实状态报出来。
  let attachNote = '';
  if (wc.debugger.isAttached()) {
    // 已被别处 attach(如 AI SSE 拦截器):可以共用消息流,但不能重复 attach
    state.attached = false;
    attachNote = '(debugger 已被其他模块 attach,共用消息流)';
  } else {
    try {
      wc.debugger.attach('1.3');
      state.attached = true;
    } catch (err) {
      return { error: `CDP attach 失败,无法采集:${String(err)}` };
    }
  }

  wc.debugger.on('message', state.onMessage);
  try {
    await wc.debugger.sendCommand('Network.enable');
  } catch (err) {
    wc.debugger.off('message', state.onMessage);
    if (state.attached) { try { wc.debugger.detach(); } catch { /* ignore */ } }
    return { error: `Network.enable 失败,抓不到任何响应:${String(err)}` };
  }
  console.log(`[x-capture-monitor] CDP 就绪 ${attachNote}`);

  // 每 1.5s 扫一次 DOM,累计「滚过的」并推送快照
  state.domTimer = setInterval(() => {
    if (wc.isDestroyed()) { stopCaptureMonitor(); return; }
    wc.executeJavaScript(SCAN_DOM_IDS)
      .then((r: {
        items: Array<{ id: string; handle: string; text: string; createdAt: string; likes: number }>;
        skipped: number; scrollY: number; docH: number; url: string;
      }) => {
        state.lastSkipped = r.skipped ?? 0;
        // 每轮重建:这是「此刻屏幕上的顺序」,与左侧页面一一对应
        state.onScreen = (r.items ?? []).map((it) => it.id);
        for (const it of r.items ?? []) {
          seenInDom.add(it.id);
          // DOM 兜底:载荷没覆盖到的,用屏幕上的内容补 —— 但**不覆盖**已有的,
          // 因为载荷字段更全(会话根/自身互动状态/长推全文)
          if (!captured.has(it.id)) {
            captured.set(it.id, {
              tweetId: it.id,
              authorHandle: it.handle.replace(/^@/, '') || undefined,
              text: it.text,
              createdAt: it.createdAt || undefined,
              isLongText: false,
              metrics: { likes: it.likes },
              self: {},
              fromDom: true,
            });
          }
        }
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
