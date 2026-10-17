/**
 * ⭐⭐ 采集引擎 ——「对一个 webview 跑采集」的零件 + 每个页面的会话状态
 *
 * 2026-10-13 从 `ipc-dom.ts` **原样搬出**(后台采集策略 3a,交接见
 * `docs/handoff/x-collect-engine-extraction-3a.md`)。逻辑一字未改,只换了文件位置。
 *
 * ── 为什么要搬 ──
 *
 * `ipc-dom.ts` 原来既接 IPC、又揣着采集引擎(会话表、两条腿、harvest/acquire 依赖)。
 * 后台 runner 跑在主进程、**没有 renderer**,却也要跑采集 —— 引擎锁在 IPC 接线文件里,
 * 它就只能绕一圈 IPC 或者复制一份(复制必漂)。
 * ⭐ 拆开后:本文件只管「对一个 webview 采」,**不认识 IPC**;
 * `ipc-dom.ts` 只管把 renderer 的请求接到这里。
 *
 * ⚠️ 本文件仍在 `wiring/`(能力层唯一允许碰 Electron 的地方),
 * 且**不认识任何站点**(`capability-site-agnostic` 守卫钉着)——
 * X 的编排(runCollect 等)住在 `src/modules/x/`,只往下调这里。
 *
 * ⚠️ 留痕分工(用户 2026-10-13 拍板):harvest/acquire 的厚重留痕
 * (byKind / endpoints 聚合)**留在调用方**(ipc-dom 的各 case),本文件只采 + 返回数据。
 */

import { webContents, type WebContents } from 'electron';
import { createHash } from 'node:crypto';
import { controlEngine, domRunner, pageRegistry, netBus, bodyProvider, traceRecorder } from './runtime';
import { CaptureSession } from '../net/capture-session';
import { HookSession } from '../hook/hook-session';
import { toHookHost } from './electron-hook-host';
import { startAcquire, finishAcquire } from '../acquire/acquire';
import { harvestPage } from '../harvest/harvest';
import type { HarvestDeps, HarvestPlan, HarvestReport } from '../harvest/types';
import type { AcquireDeps } from '../acquire/types';
import { toPageHost } from './electron-page-host';
import { registerPageIdLookup, wireWebRequestSideOn } from './webrequest-side';
import type { PageId } from '../page/types';
import type { ScriptId } from '../dom/types';
import { bindPageHost } from './page-hosts';

/**
 * ⭐ 指认一个页面 —— 与 IPC 的 `WebDomPageRef` 同构,但本文件**不认识 IPC**,所以自己声明。
 * ⭐ 后台 runner(主进程,没有 renderer)也用它指认 webview。
 */
export type PageRef = { readonly wcId: number };

/** ⭐ 两份名单是不是同一份(顺序也算)—— 判「要不要重建钩子」 */
export function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * ⭐⭐⭐ 一条**合并后**的采集结果 —— 对外只有这一种形状。
 *
 * 用户 2026-10-02:「我需要的是**完整的数据**,而不是分这么多类别」。
 * ⚠️ `from` 不是给人选的,是**证据**:它说明这条是从哪条腿来的,
 * 出问题时才查得动(两条腿都有 → 可互相对账)。
 */
export type MergedItem = {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly text: string;
  readonly byteLength: number;
  readonly at: string;
  /** 'cdp' | 'hook' | 'both' —— ⭐ 证据,不是选项 */
  readonly from: 'cdp' | 'hook' | 'both';
  /**
   * ⭐⭐ X 发这条请求时用的请求头 —— 游标翻页要原样重发。
   * ⚠️ 只有 CDP 腿拿得到(钩子腿在页面里,看不见真实请求头)。
   */
  readonly requestHeaders?: Readonly<Record<string, string>>;
};

/**
 * ⭐⭐ 去重键。
 *
 * ⚠️ 两条腿会拿到**同一条响应**(这正是互证的前提),
 * 不去重的话人看到的条数**虚高一倍**。
 *
 * ⚠️ 为什么用 `url + status + byteLength` 而不是只用 url:
 * 同一个 URL 在一次采集里会被请求多次(翻页、轮询),
 * 只按 url 去重会把**不同轮次的数据**当成重复丢掉 —— 那是真丢数据。
 * ⭐ 加上 `byteLength` 后,内容不同的就留得住。
 */
export function dedupKey(url: string, status: number, text: string): string {
  /**
   * ⚠️⚠️ **不能用 `byteLength`** —— 2026-10-02 真机实测:
   * 同一个 `HomeTimeline` 响应,CDP 报 **267.2KB**、页面钩子报 **248.4KB**
   * (CDP 数的是**原始字节**,钩子数的是 **UTF-8 解码后的字符**)。
   * 进了去重键就**永远配不上** → 同一条被算两次 → `both` 该有的互证也没了。
   *
   * ⭐ 用**内容**:同一条响应两条腿拿到的文本是一样的,而同一 URL 的不同轮次(翻页/轮询)内容不同。
   *
   * ⚠️⚠️ 2026-10-16 改:原来只取**前 256 字符** —— X 搜索页浏览器收到 49 页 SearchTimeline,
   * 合并后只剩 2 页(池子没满、取正文没失败,数据进来了却在这里被当成重复吞掉;对账当场报出)。
   * 「JSON 前 256 字符已含游标/首条 id」这个假设对 SearchTimeline 不成立。
   * ⭐ 改成**整段内容的指纹**(sha1);每条只算一次(按对象缓存),不随每轮重算。
   */
  return `${url.split('?')[0]}|${status}|${text.length}|${createHash('sha1').update(text).digest('hex')}`;
}

/** 每条只算一次指纹 —— mergedItems 每轮滚动都会被调,几百 KB 的载荷不能每轮重算 */
const keyCache = new WeakMap<object, string>();
function keyOf(x: { url: string; status?: number; text: string }): string {
  const hit = keyCache.get(x);
  if (hit !== undefined) return hit;
  const k = dedupKey(x.url, x.status ?? 0, x.text);
  keyCache.set(x, k);
  return k;
}

/**
 * 读 partition —— 与 `ai/interceptor.ts:350` 同款。
 * ⚠️ `PageFacts.partition` 必填且底座**不猜**(`prepare` 要挂 webRequest)。
 */
export function readPartition(wc: WebContents): string {
  try {
    const p = wc.session.storagePath;
    return p ? `persist:${p.split('/').pop()}` : 'persist:webview';
  } catch {
    return 'persist:webview';
  }
}

/** wcId → pageId。⚠️ 同一个 wc 只登记一次,否则每次调用都新增一条页面记录 */
export const pageIdByWcId = new Map<number, PageId>();

/**
 * pageId → 捕获会话。
 *
 * ⚠️ 按 **pageId** 分而不是按 wcId:同一个 wc 重载后 pageId 不变
 * (`resolve` 里缓存着),会话应当延续 —— 人点了「开始捕」,
 * 页面刷新一下就悄悄停了会很难察觉。
 *
 * ⚠️ wc 销毁时要清(见 `resolve` 里的 `destroyed` 回调)——
 * 不清的话会话会一直订阅一个死页面,而症状是**内存只涨不降**。
 */
export const sessionsByPageId = new Map<PageId, CaptureSession>();

/**
 * ⭐⭐⭐ **wcId → pageId 的反查** —— 2026-10-02 真机实测查出的第三层缺口。
 *
 * ── 完整链条(每修一层就露出下一层)──
 *
 *   `wireWebRequestSide` 零调用        ← 上一轮修了
 *     → 接上了,`onBeforeRequest` 也触发了
 *       → 但 `pageOf(wcId)` 里 **`lookup` 是 null** → 返回 null
 *         → `recordStart` 直接 return,**一条记录都不写**
 *           → `candidatesFor` 恒空 → 每条 CDP 载荷都 `correlate-failed`
 *
 * ⚠️⚠️ 真机症状:接线 ✅ attach ✅ 滚动 ✅(5 轮 3321px)、
 * CDP 什么都抓到了(GraphQL / timeline.json / 视频流),
 * 但**每一条都关联失败**,最终 `captured=0`。
 *
 * ⭐ `webrequest-side.ts` 的注释早就警告过这个后果:
 * 「静默不记会让**关联失败看起来像 CDP 侧的问题**,排查方向完全相反」——
 * 而我差点就去查 CDP 了(还把 correlate-failed 归类成了 systemic)。
 *
 * ⚠️ 注册放在**模块加载期**而不是 `captureStart` 里:
 * webRequest 的回调可能早于人点「开始捕获」就在跑
 * (页面一导航就有请求),晚注册会丢掉那一段的记录。
 */
registerPageIdLookup((wcId) => {
  const hit = pageIdByWcId.get(wcId) ?? null;
  /**
   * ⚠️ 诊断(2026-10-02,定位后删):第三层修完仍然每条 correlate-failed,
   * 而 `lookup` 确实注册了 —— 那就是 **wcId 对不上**。
   * ⭐ 只在**查不到**时打,且节流:查得到就不吵。
   */
  if (!hit && !loggedMiss.has(wcId)) {
    loggedMiss.add(wcId);
    const known = Array.from(pageIdByWcId.keys());
    const msg = `webRequest 的 wcId=${wcId} 不在表里;表里有 [${known.join(', ') || '(空)'}]`;
    console.warn(`[web.net 诊断] ${msg}`);
    /**
     * ⭐⭐ **落盘**,不只 console.warn —— 主进程终端用户看不到、
     * 也不会转给我(`feedback-maintainability-over-feature-completion`)。
     * ⚠️ 每个 wcId 只记一次(`loggedMiss` 去重),否则 X 每秒几十个请求会刷爆。
     */
    traceRecorder.lifecycle({
      layer: 'web.net',
      event: 'pageid-lookup-miss',
      detail: { wcId, knownWcIds: known, knownCount: known.length },
    });
  }
  return hit;
});

/** ⚠️ 诊断用,定位后与上面那段一起删 */
const loggedMiss = new Set<number>();

/**
 * ⭐⭐ **正在滚动的页面 + 取消标记** —— 2026-10-02。
 *
 * ── 用户:「还在翻页?**停应该包含两个动作 —— 停止翻页/停止取数据**吧?」──
 *
 * ⚠️ 真机实测:`capture-stop` 在 06:58:50,`scroll-degraded` 在 06:59:08
 * —— **人点停之后滚动又跑了 18 秒**。因为「停」只退了采集订阅。
 *
 * ⭐ 标记放在**主进程**而不是 renderer:滚动循环跑在主进程,
 * renderer 发一次 IPC 把标记立起来,循环下一轮开头就看见。
 * ⚠️ 必须按 pageId 分 —— 不分的话在 A 窗口点停会把 B 窗口的滚动也停掉
 * (`project-host-broadcast-multi-ws-fanout` 的同族)。
 */
export const scrollCancelled = new Set<PageId>();

/**
 * ⭐⭐ **第二条腿**:页面内钩子会话(M4)—— 与 `sessionsByPageId`(CDP 腿)平级。
 *
 * 用户 2026-10-02:「要充分利用几种方法获取数据,而不是单独依赖 CDP」。
 * ⚠️ 两条腿**各记各的,绝不合并计数** —— 合并就失去了互证能力,
 * 而「没有第二个视角可以互证」正是那次七轮排查的根因。
 */
export const hooksByPageId = new Map<PageId, HookSession>();

/**
 * ⭐ 每个 page 当前钩子用的噪音名单 —— 名单变了要重建 HookSession,
 * 否则「改了配置不生效」而且**一点症状都没有**。
 */
export const hookNoisyByPageId = new Map<PageId, readonly string[]>();

/**
 * ⭐⭐ 每轮脚本的产出 —— 按 pageId 攒着,`acquireStop` 时一并回给调用方。
 *
 * ⚠️ 为什么要攒:滚动报告里塞不下(几十条推文的全文),
 * 而调用方真正要的是**最终那一份**。
 * ⚠️ 合并规则「**只许变长**」在业务侧做 —— 底座不知道什么叫「更全」。
 */
export const afterRoundResults = new Map<PageId, unknown[]>();

/** 收一轮产出。⚠️ 非法形状直接丢 —— 脚本跑在页面上下文,返回值不可信 */
export function collectAfterRound(pageId: PageId, value: unknown): void {
  if (value === null || value === undefined) return;
  const list = afterRoundResults.get(pageId) ?? [];
  list.push(value);
  // ⚠️ 封顶:滚 100 轮就是 100 份,不封顶内存会涨
  while (list.length > 200) list.shift();
  afterRoundResults.set(pageId, list);
}

/** 采集开始时刻 —— ⚠️ 只为算耗时,不影响任何判断 */
export const acquireStartedAt = new Map<PageId, number>();

/**
 * ⭐⭐ 合并两条腿的结果。
 *
 * ⚠️ 合并的是**对外视图**,两条腿的内部计数仍各记各的 ——
 * 互证能力不能因为「界面上只给一份」而丢掉。
 */
export function mergedItems(pageId: PageId, limit: number): MergedItem[] {
  const byKey = new Map<string, MergedItem>();

  // ① CDP 腿
  for (const x of sessionsByPageId.get(pageId)?.list(256) ?? []) {
    const k = keyOf(x);
    byKey.set(k, {
      url: x.url, method: x.method ?? 'GET', status: x.status ?? 0,
      text: x.text, byteLength: x.byteLength, at: x.at, from: 'cdp',
      /** ⭐ 请求头往上送 —— 游标翻页要原样重发(少了就是 403) */
      requestHeaders: x.requestHeaders,
    });
  }

  // ② 钩子腿 —— ⭐ 已存在的标成 `both`(**那是互证成功的证据**)
  for (const x of hooksByPageId.get(pageId)?.list(256) ?? []) {
    const k = keyOf(x);
    const prev = byKey.get(k);
    if (prev) {
      /**
       * ⚠️ 只有之前那份**来自 CDP** 才算互证 —— 2026-10-16 真机:钩子把同一条收到两次时,
       * 第二次撞上第一次(hook)被错标成 both,于是出现「both 却 0 个头」,腿计数也虚高。
       */
      if (prev.from === 'cdp') byKey.set(k, { ...prev, from: 'both' });
      continue;
    }
    byKey.set(k, {
      url: x.url, method: x.method, status: x.status,
      text: x.text, byteLength: x.byteLength, at: x.at, from: 'hook',
    });
  }

  // ⚠️ 按时间**倒序**(最新在前)—— 人要看的是刚采到的
  return [...byKey.values()]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, Math.max(0, limit));
}

/** 合并后的计数 —— ⭐ `viaBoth` 是互证健康度的直接指标 */
export function mergedStats(pageId: PageId): {
  total: number; viaCdp: number; viaHook: number; viaBoth: number;
  running: boolean; cdpRunning: boolean; hookRunning: boolean; hookInjected: boolean;
} {
  const items = mergedItems(pageId, Number.MAX_SAFE_INTEGER);
  const cap = sessionsByPageId.get(pageId)?.stats();
  const hk = hooksByPageId.get(pageId)?.stats();
  return {
    total: items.length,
    viaCdp: items.filter((x) => x.from === 'cdp').length,
    viaHook: items.filter((x) => x.from === 'hook').length,
    viaBoth: items.filter((x) => x.from === 'both').length,
    // ⭐ 任一条腿在跑就算「采集中」—— 少一条腿是降级不是停止
    running: Boolean(cap?.running) || Boolean(hk?.running),
    cdpRunning: Boolean(cap?.running),
    hookRunning: Boolean(hk?.running),
    hookInjected: Boolean(hk?.injected),
  };
}

/** 取或建会话 —— ⚠️ 不自动 start,开始捕是人的显式动作 */
export function sessionFor(pageId: PageId): CaptureSession {
  const existing = sessionsByPageId.get(pageId);
  if (existing) return existing;
  /**
   * ⭐⭐ 首次捕到载荷时**落盘一次** —— 用户 2026-10-02:
   * 「你在底层有读取数据的能力，而不是靠我截图」。
   * ⚠️ 只在停捕时写是不够的:**人可能忘了点停**,那样这一轮
   * 一个字都不会留下。这一条保证「链路活了」这个事实一定留痕。
   */
  const fresh = new CaptureSession(netBus, pageId, (url, byteLength) => {
    traceRecorder.lifecycle({
      layer: 'web.net',
      event: 'capture-first-payload',
      pageId: String(pageId),
      detail: { url, byteLength },
    });
    console.log(`[web.net] ⭐ 首条载荷到手 pageId=${pageId} ${byteLength}B ${url}`);
  });
  sessionsByPageId.set(pageId, fresh);
  return fresh;
}

/**
 * ⭐⭐ 把**所有获取方法**接给 `acquireContent`。
 *
 * 用户 2026-10-02:「底层能够可以做最小化的抽象函数,
 * 但**上层只关注某个具体的目标**呀。」
 *
 * ⭐ 这个函数就是那条分界线:
 * 下面是机制(CDP / 页面钩子 / 滚动),上面只有「取全这一页」。
 * ⚠️ `acquireContent` 本身零 Electron、零站点知识 —— 全靠这里注入。
 */
export function makeAcquireDeps(wc: WebContents, _pageId: PageId): AcquireDeps {
  return {
    async startAll(pageId, noisy) {
      // ① webRequest 侧 —— CDP 的 body 要靠它配对
      wireWebRequestSideOn(netBus, wc.session, wc.session.storagePath ?? 'default');

      // ② CDP 腿
      const cap = sessionFor(pageId);
      /**
       * ⭐⭐⭐ **开始收之前先清空** —— 2026-10-04 真机逼出来的。
       *
       * ⚠️⚠️ `start()` 只负责订阅,**从不清掉上一轮攒的内容**。
       * 于是逐篇补长文时(一轮 38 次 start/finish 共用同一个 session):
       * 每一篇都把**前面那些页的载荷**当成自己的收获。
       *
       * 真机症状:单篇长文页报「解出 **42 条**推文但都没正文」——
       * 一篇文章不可能有 42 条推文,那是列表页的量。
       * 而且池子有上限(MAX_HELD),列表页那批被挤掉 →
       * **同一个账号两次跑,推文从 97 条掉到 40 条**。
       *
       * ⭐ `clearPayloads()` 本来就有,只是**只有手动 `captureClear` 会调** ——
       * 自动流程里一次都没调过。「开始收」理应从干净的池子开始。
       * ⚠️ 只清内容**不清计数**(`clearPayloads` 的契约):
       * 人要知道这一轮总共来过多少。
       */
      cap.clearPayloads();
      cap.start();
      const cdpAttached = bodyProvider.attach(toPageHost(wc), pageId, {
        resourceTypes: ['fetch', 'document', 'xhr'],
        /**
         * ⭐ 噪音名单**由调用方给** —— 底座一条都不内置
         * (`body-provider` 的注释:「V1 在 session-capture.ts:31 硬编码了
         * s-cdn.anthropic.com/images/ —— 那是 Claude 的站点适配漏进了底层,
         * 本层不重蹈」)。
         */
        noisyUrlSubstrings: noisy,
      });

      // ③ 页面内钩子腿
      let hook = hooksByPageId.get(pageId);
      /**
       * ⚠️⚠️ 噪音名单**两条腿都要给**(2026-10-04)。
       * 此前只给了 CDP 腿,钩子腿照单全收 → 搜索页 47 条响应里
       * 19 条 `.m3u8` 把池子挤爆,真正的 SearchTimeline 只剩 1 条。
       * ⭐ 名单变了要重建 —— 否则改了配置也不生效。
       */
      if (!hook || !sameList(hookNoisyByPageId.get(pageId), noisy)) {
        hook?.stop();
        hook = new HookSession(toHookHost(wc), pageId, undefined, noisy ?? []);
        hooksByPageId.set(pageId, hook);
        hookNoisyByPageId.set(pageId, noisy ?? []);
      }
      /**
       * ⚠️ 钩子装失败**不中止** —— CDP 那条腿还活着,少一条腿是**降级不是失败**。
       * ⭐ 这正是「多条腿」的意义:单点故障不再是全局故障。
       */
      let hookInstalled = true;
      try {
        await hook.start();
      } catch (e) {
        hookInstalled = false;
        console.warn('[web.acquire] 页面钩子装不上(CDP 腿仍在):', e);
      }
      return { cdpAttached, hookInstalled };
    },

    stopAll(pageId) {
      sessionsByPageId.get(pageId)?.stop();
      hooksByPageId.get(pageId)?.stop();
    },

    snapshot(pageId) {
      return mergedItems(pageId, Number.MAX_SAFE_INTEGER);
    },

    legStats(pageId) {
      return { hookInjected: Boolean(hooksByPageId.get(pageId)?.stats().injected) };
    },

    now: () => Date.now(),
  };
}

/**
 * ⭐⭐ 把**控制**与**采集**接给 `harvestPage`。
 *
 * 用户 2026-10-03:「我自己选定一个页面,点击开始采集,就采集」。
 * ⭐ 这个函数是那条分界线:下面是两层机制,上面只有「采这一页」。
 * ⚠️ `harvestPage` 本身零 Electron、零站点知识 —— 全靠这里注入。
 */
export function makeHarvestDeps(wc: WebContents, pid: PageId): HarvestDeps {
  const acq = makeAcquireDeps(wc, pid);
  return {
    startAcquire: (pageId, noisy) => startAcquire(acq, pageId, noisy),
    peekAcquire: (pageId) => mergedItems(pageId, Number.MAX_SAFE_INTEGER),
    cdpInFlight: (pageId) => bodyProvider.inFlight(pageId),
    apiSeen: (pageId) => bodyProvider.apiSeen(pageId),
    rawHeld: (pageId) => ({
      cdp: sessionsByPageId.get(pageId)?.stats().held ?? 0,
      hook: hooksByPageId.get(pageId)?.stats().held ?? 0,
    }),
    finishAcquire: (pageId, startedAt) => finishAcquire(acq, pageId, startedAt),

    reload: () => { wc.reload(); },

    /**
     * ⭐⭐ 去**语义页** —— 与 `reload` 占同一个位置(装腿之后)。
     * ⚠️ 只收页面名,URL 由业务页表翻译 —— 那道闸不能绕
     * (旧实现 2026-09-07「把首页时间线当搜索结果」整批入库,
     * 　就是因为没有这道闸)。
     * ⭐ 回 false 让编排**别在原页上接着采**(那会静默串页)。
     */
    async goto(pageId, name, params) {
      const r = await controlEngine.goto(
        pageId,
        { kind: 'semantic', name, params },
      );
      traceRecorder.lifecycle({
        layer: 'web.page',
        event: r.status === 'ok' ? 'harvest-goto' : `harvest-goto-${r.status}`,
        pageId: String(pageId),
        detail: { name, params },
      });
      /** ⚠️ `degraded` 也算去到了 —— 它是「到了但有保留」,不是「没到」 */
      return r.status === 'ok' || r.status === 'degraded';
    },

    async scroll(pageId, opts) {
      /** ⚠️ 开跑前清旧的取消标记 —— 不清会「一轮都没滚就结束」 */
      scrollCancelled.delete(pageId);
      const r = await controlEngine.scrollUntil(pageId, { kind: 'atBottom' }, {
        maxRounds: opts.maxRounds,
        /** ⭐ 滚不动时换位置 —— 由业务提供动作,底座只管什么时候问 */
        onStuck: opts.onStuck,
        afterRound: opts.afterRound,
        // ⭐ 两个停止源:人点「停翻页」 或 编排说够了
        shouldStop: () => scrollCancelled.has(pageId) || Boolean(opts.shouldStop?.()),
      });
      scrollCancelled.delete(pageId);
      const v = (r as { value?: {
        rounds?: number; scrolledPx?: number; reachedBottom?: boolean; stopReason?: string;
      } }).value;
      return {
        rounds: v?.rounds ?? 0,
        scrolledPx: v?.scrolledPx ?? 0,
        reachedBottom: Boolean(v?.reachedBottom),
        stopReason: v?.stopReason ?? '(未知)',
      };
    },

    async runScript(pageId, scriptId) {
      const r = await domRunner.run(wc, pageId, scriptId as ScriptId);
      // ⚠️ 失败如实抛 —— 编排那边兜住,但不能静默当成「跑了没产出」
      if (r.status !== 'ok') {
        throw new Error(`脚本 ${scriptId} 失败: ${(r as { reason?: string }).reason ?? ''}`);
      }
      return r.value;
    },

    wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    now: () => Date.now(),
  };
}

/**
 * 把 renderer 给的 `wcId` 解析成「真 webContents + 底座认识的 pageId」。
 *
 * ⚠️ 拿不到就**如实失败**,不兜底到别的页面 ——
 * 兜底会让「指认错了」表现成「操作没生效」,排查方向完全相反。
 */
export function resolve(ref: PageRef): { wc: WebContents; pageId: PageId } | { error: string } {
  if (!ref || typeof ref.wcId !== 'number' || !Number.isInteger(ref.wcId)) {
    return { error: `[web.dom ipc] pageRef.wcId 非法: ${String(ref?.wcId)}` };
  }
  const wc = webContents.fromId(ref.wcId);
  if (!wc || wc.isDestroyed()) {
    return { error: `[web.dom ipc] wc#${ref.wcId} 不存在或已销毁(页面关了?)` };
  }

  const cached = pageIdByWcId.get(ref.wcId);
  if (cached) return { wc, pageId: cached };

  /**
   * ⭐ `register` 与 `bindPageHost` **必须成对** —— 只登记不绑定的话,
   * 引擎拿不到 wc,会回一个诚实但误导的 Failed「没有对应的渲染目标(已关闭?)」,
   * 看起来像页面关了,实际是没接线(见 `page-hosts.ts` 的告诫)。
   */
  const facts = pageRegistry.register({
    window: 'main',
    ws: 'renderer-dom',
    slot: 'left',
    partition: readPartition(wc),
    owner: 'renderer-dom',
    url: wc.getURL(),
    state: 'complete',
  });
  bindPageHost(facts.pageId, wc);
  pageIdByWcId.set(ref.wcId, facts.pageId);
  wc.once('destroyed', () => {
    pageIdByWcId.delete(ref.wcId);
    /**
     * ⚠️ 会话必须跟着清 —— 不清的话它会一直订阅一个死页面,
     * 而症状是**内存只涨不降**,没有任何报错指向这里。
     */
    sessionsByPageId.get(facts.pageId)?.stop();
    sessionsByPageId.delete(facts.pageId);
    // ⚠️ 第二条腿也要清 —— 同样的理由:不清会一直持有死页面的引用
    hooksByPageId.get(facts.pageId)?.stop();
    hooksByPageId.delete(facts.pageId);
  });
  return { wc, pageId: facts.pageId };
}

/**
 * ⭐⭐ 三个对外入口(2026-10-13,3a)—— renderer 经 IPC(`ipc-dom.ts`)与主进程直接调用
 * (X 的人卡采集 / 后台 runner)**走同一条路**,不各写一份。
 *
 * ⚠️ 都**不打留痕**(用户拍板:留痕由调用方打,见 `collect-trace.ts`);
 * ⚠️ 都**不吞失败** —— 原样回 Result / 抛出,由调用方如实转述。
 */

/** 去语义页 —— ⚠️ 只收页面名,URL 由业务页表翻译(那道闸不能绕) */
export function gotoOnPage(
  pageId: PageId,
  name: string,
  params: Record<string, string> | undefined,
  readyTimeoutMs?: number,
): ReturnType<typeof controlEngine.goto> {
  return controlEngine.goto(
    pageId,
    { kind: 'semantic', name, params },
    { readyTimeoutMs },
  );
}

/** 采这一页 —— ⚠️ 先清上一轮的每轮产出,否则旧全文会混进这一轮 */
export function harvestOnPage(wc: WebContents, pageId: PageId, plan: HarvestPlan): Promise<HarvestReport> {
  afterRoundResults.delete(pageId);
  return harvestPage(makeHarvestDeps(wc, pageId), pageId, plan);
}

/** 跑一个预注册脚本(翻页 / 展开)—— ⚠️ 只认 id,收不了脚本文本 */
export function runScriptOnPage(
  wc: WebContents,
  pageId: PageId,
  scriptId: string,
  params?: Parameters<typeof domRunner.run>[3],
): ReturnType<typeof domRunner.run> {
  return domRunner.run(wc, pageId, scriptId as ScriptId, params);
}
