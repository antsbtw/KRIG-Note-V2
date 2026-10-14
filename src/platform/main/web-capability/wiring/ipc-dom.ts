/**
 * `renderer → web.dom` 的 IPC 接线 —— **唯一**把 web.dom 暴露给 renderer 的地方
 *
 * ⭐ 为什么放在 `wiring/`:本目录是能力层**唯一允许碰 Electron** 的地方
 * (`page-boundary-guard` 钉着「除 wiring/ 外零处 Electron」)。
 * `ipcMain.handle` 放进 `dom/` 会当场撞守卫 —— 那是对的。
 *
 * ── 必要性(设计见 docs/handoff/web-dom-ipc-surface-design.md §〇)──
 *
 * renderer 侧 18 处裸注入的四个实测缺陷:26 处静默吞异常零日志 /
 * 对占位符做 regex 文本替换、把运行时值塞进脚本源码(已咬过一次) /
 * 9 处运行时值拼进脚本 / 零留痕。
 * ⭐ 而「社区论坛自动化」会让这四条**随每个新站点线性增长**。
 *
 * ── 三条设计红线 ──
 *
 * 1. ⚠️⚠️ **不暴露 `runDynamic`** —— 求值任意脚本的口子不对 renderer 开。
 *    `channel-names.ts` 里控制台时代那条注释写得很清楚:
 *    「刻意一能力一通道,不做求值任意脚本的万能通道:
 *    　那等于把 web.dom 费力关掉的注入口重新打开」。
 * 2. ⭐ **pageRef 由 renderer 给,main 侧绝不猜**(不用 activeWs /
 *    不用「最后 navigate 的那个」)—— `page-registry.ts:15` 的血泪。
 * 3. ⭐ **失败如实回三态**,不静默吞 —— 这正是本层要替换掉的那个病。
 */

import { app, ipcMain, webContents, type WebContents } from 'electron';
import { mainBuildStamp } from './build-stamp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type {
  WebDomInvoke,
  WebDomPageRef,
  WebDomReadyCriterion,
  WebDomResult,
  WebDomScrollStop,
} from '@shared/ipc/web-dom-types';
import {
  controlEngine, domRunner, pageRegistry, scriptRegistry, listPageNames,
  identifySemanticPage, netBus, bodyProvider, traceRecorder,
} from './runtime';
import { CaptureSession } from '../net/capture-session';
import { HookSession } from '../hook/hook-session';
import { toHookHost } from './electron-hook-host';
import { startAcquire, peekAcquire, finishAcquire } from '../acquire/acquire';
import { harvestPage } from '../harvest/harvest';
import type { HarvestDeps } from '../harvest/types';
import type { AcquireDeps, AcquiredItem } from '../acquire/types';
import { toPageHost } from './electron-page-host';
import { wireWebRequestSideOn, registerPageIdLookup } from './webrequest-side';
import type { ReadyCriterion, ScrollStop } from '../page/control-types';
import type { AnchorName } from '../dom/types';
import { bindPageHost } from './page-hosts';
import type { PageId } from '../page/types';
import type { ScriptId } from '../dom/types';
import { sameList, dedupKey, readPartition, type MergedItem } from './web-collect-engine';

/** wcId → pageId。⚠️ 同一个 wc 只登记一次,否则每次调用都新增一条页面记录 */
const pageIdByWcId = new Map<number, PageId>();

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
const sessionsByPageId = new Map<PageId, CaptureSession>();

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
const scrollCancelled = new Set<PageId>();

/**
 * ⭐⭐ **第二条腿**:页面内钩子会话(M4)—— 与 `sessionsByPageId`(CDP 腿)平级。
 *
 * 用户 2026-10-02:「要充分利用几种方法获取数据,而不是单独依赖 CDP」。
 * ⚠️ 两条腿**各记各的,绝不合并计数** —— 合并就失去了互证能力,
 * 而「没有第二个视角可以互证」正是那次七轮排查的根因。
 */
const hooksByPageId = new Map<PageId, HookSession>();
/**
 * ⭐ 每个 page 当前钩子用的噪音名单 —— 名单变了要重建 HookSession,
 * 否则「改了配置不生效」而且**一点症状都没有**。
 */
const hookNoisyByPageId = new Map<PageId, readonly string[]>();

/**
 * ⭐⭐ 每轮脚本的产出 —— 按 pageId 攒着,`acquireStop` 时一并回给调用方。
 *
 * ⚠️ 为什么要攒:滚动报告里塞不下(几十条推文的全文),
 * 而调用方真正要的是**最终那一份**。
 * ⚠️ 合并规则「**只许变长**」在业务侧做 —— 底座不知道什么叫「更全」。
 */
const afterRoundResults = new Map<PageId, unknown[]>();

/** 收一轮产出。⚠️ 非法形状直接丢 —— 脚本跑在页面上下文,返回值不可信 */
function collectAfterRound(pageId: PageId, value: unknown): void {
  if (value === null || value === undefined) return;
  const list = afterRoundResults.get(pageId) ?? [];
  list.push(value);
  // ⚠️ 封顶:滚 100 轮就是 100 份,不封顶内存会涨
  while (list.length > 200) list.shift();
  afterRoundResults.set(pageId, list);
}

/** 采集开始时刻 —— ⚠️ 只为算耗时,不影响任何判断 */
const acquireStartedAt = new Map<PageId, number>();

/**
 * ⭐⭐ 合并两条腿的结果。
 *
 * ⚠️ 合并的是**对外视图**,两条腿的内部计数仍各记各的 ——
 * 互证能力不能因为「界面上只给一份」而丢掉。
 */
function mergedItems(pageId: PageId, limit: number): MergedItem[] {
  const byKey = new Map<string, MergedItem>();

  // ① CDP 腿
  for (const x of sessionsByPageId.get(pageId)?.list(256) ?? []) {
    const k = dedupKey(x.url, x.status ?? 0, x.text);
    byKey.set(k, {
      url: x.url, method: x.method ?? 'GET', status: x.status ?? 0,
      text: x.text, byteLength: x.byteLength, at: x.at, from: 'cdp',
      /** ⭐ 请求头往上送 —— 游标翻页要原样重发(少了就是 403) */
      requestHeaders: x.requestHeaders,
    });
  }

  // ② 钩子腿 —— ⭐ 已存在的标成 `both`(**那是互证成功的证据**)
  for (const x of hooksByPageId.get(pageId)?.list(256) ?? []) {
    const k = dedupKey(x.url, x.status, x.text);
    const prev = byKey.get(k);
    if (prev) {
      byKey.set(k, { ...prev, from: 'both' });
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
function mergedStats(pageId: PageId): {
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
function makeAcquireDeps(wc: WebContents, _pageId: PageId): AcquireDeps {
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
function makeHarvestDeps(wc: WebContents, pid: PageId): HarvestDeps {
  const acq = makeAcquireDeps(wc, pid);
  return {
    startAcquire: (pageId, noisy) => startAcquire(acq, pageId, noisy),
    peekAcquire: (pageId) => mergedItems(pageId, Number.MAX_SAFE_INTEGER),
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

/** 取或建会话 —— ⚠️ 不自动 start,开始捕是人的显式动作 */
function sessionFor(pageId: PageId): CaptureSession {
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
 * 把 renderer 给的 `wcId` 解析成「真 webContents + 底座认识的 pageId」。
 *
 * ⚠️ 拿不到就**如实失败**,不兜底到别的页面 ——
 * 兜底会让「指认错了」表现成「操作没生效」,排查方向完全相反。
 */
function resolve(ref: WebDomPageRef): { wc: WebContents; pageId: PageId } | { error: string } {
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
 * ⭐ 失败一律**在主进程也打一行** —— 2026-10-01 加。
 *
 * ⚠️ 起因:步 2b 真机失败时,调用方的 `console.warn` 打在 **renderer 进程**,
 * 只存在于那个 webview 的 DevTools 里;而人看的是终端。
 * 于是「我加了日志」与「人能看到日志」是两回事 ——
 * 正是 `feedback-maintainability-over-feature-completion` 说的
 * 「**你不记录如何做验证**」的同一种形态:记了,但记在人看不到的地方。
 *
 * ⭐ 主进程这一行让真因直接出现在启动终端里,不必让人去翻 DevTools。
 */
function failed(reason: string): WebDomResult {
  console.warn('[web.dom ipc] ' + reason);
  return { status: 'failed', reason, retryable: false };
}

/**
 * IPC 判据 → 底座判据。
 *
 * ⚠️ 锚点名要铸造成 `AnchorName`(带 brand 的类型)——
 * 底座故意不收裸字符串,`dom/types.ts` 记着那次转义事故的理由。
 * ⭐ 用 `as AnchorName` 而**不是 `as never`** —— 后者是「让编译器闭嘴」,
 * 会连真正的类型错误一起吞掉。
 */
function toReadyCriterion(c: WebDomReadyCriterion): ReadyCriterion {
  if (c.kind === 'urlIncludes') return { kind: 'urlIncludes', fragment: c.fragment };
  return { kind: c.kind, anchor: c.anchor as AnchorName };
}

function toScrollStop(s: WebDomScrollStop): ScrollStop {
  if (s.kind === 'anchorAppears') return { kind: 'anchorAppears', anchor: s.anchor as AnchorName };
  return s;
}

/** 把能力层的 Result 原样转成 IPC 形状(两者同构,只是跨了分层边界) */
function toIpc(r: { status: string; [k: string]: unknown }): WebDomResult {
  if (r.status === 'ok') return { status: 'ok', value: r.value };
  if (r.status === 'degraded') {
    return { status: 'degraded', value: r.value, missing: (r.missing as string[]) ?? [] };
  }
  const reason = String(r.reason ?? '(未给原因)');
  // ⚠️ 这条路径此前**不出声** —— 能力层回的 Failed(如「未注册的脚本 id」)
  //    只回给 renderer,主进程终端一个字都没有。
  console.warn('[web.dom ipc] ' + reason);
  return { status: 'failed', reason, retryable: Boolean(r.retryable) };
}

/** 注册 IPC handler。由 `main/index.ts` 在启动时调一次 */
export function registerWebDomIpc(): void {
  /**
   * ⭐ 启动时报一次「登记了哪些脚本」—— 2026-10-01 加。
   *
   * ⚠️ 起因:步 2b 真机失败,我查了四轮静态证据(链路实跑通过、
   * handler 注册时机对、preload 暴露了、脚本进了 bundle)仍定不了因,
   * 卡在「拿不到那一行报错」上。
   *
   * ⭐ 而最可能的一种真因 ——「脚本没登记上」—— 本来**启动时就能看出来**,
   * 只是没人说。这一行让它变成启动自检:
   * 数量不对或名字不对,终端里直接能看见,不必等到用户点翻译。
   *
   * 这正是用户定的「成功路径也要留痕」:
   * 不是等出事才查,而是**平时就把判断依据摆出来**。
   */
  /**
   * ⭐ 一并报「谁注册了语义页面表」—— 2026-10-01 加。
   *
   * ⚠️ 起因:X 模块在**模块加载期**自注册并打日志,结果那行被埋在启动最开头、
   * `[storage] initialized` 之前,用户翻日志自然截不到 → 「没看到」。
   * ⭐⭐ 这是 feedback-log-where-the-human-looks 的**第二种形态**:
   * 上次是「打错了进程」,这次是「**打早了时机**」——
   * 判据同一条:**这行会出现在人看的那块屏幕上吗?** 位置对还不够,时机也要对。
   *
   * ⭐ 由**底座**报而不是让业务方报:底座本来就知道有哪些 owner,
   * 而让业务方报就得让宿主多调一个函数 —— 那会破坏
   * 「宿主只有一行 `import '@modules/x'`」的原则(守卫会红)。
   */
  const pageTables = listPageNames();
  if (pageTables.length > 0) {
    for (const t of pageTables) {
      console.log(`[web.page] 语义页面表 owner=${t.owner} —— ${t.names.length} 个: ${t.names.join(', ')}`);
    }
  } else {
    console.log('[web.page] ⚠️ 没有任何语义页面表注册 —— goto 语义名必然失败');
  }

  const ids = scriptRegistry.list().map((x) => x.id);
  const rendererIds = ids.filter((id) => String(id).startsWith('renderer.'));
  console.log(
    `[web.dom ipc] 已就绪 —— 脚本表共 ${ids.length} 个,其中 renderer.* ${rendererIds.length} 个: `
    + (rendererIds.join(', ') || '(⚠️ 一个都没有 —— renderer 侧调用必然全失败)'),
  );

  /**
   * ⭐ 列语义页面名 —— Console 的下拉靠它,**不许面板自己抄一份**。
   * ⚠️ 从 `listPageNames()` 真表读:抄一份就会漂,
   * 漂的表现是「面板上有这个名字、点下去说没登记」。
   */
  ipcMain.handle(IPC_CHANNELS.WEB_PAGE_LIST_NAMES, () => listPageNames());

  ipcMain.handle(
    IPC_CHANNELS.WEB_DOM_INVOKE,
    async (_e, payload: unknown): Promise<WebDomResult> => {
      const p = payload as WebDomInvoke | null;
      if (!p || typeof p !== 'object' || typeof p.op !== 'string') {
        return failed('[web.dom ipc] 入参非法:缺 op');
      }

      /**
       * ⭐⭐ `identify` 在 `resolve` **之前**分流 —— 它是全家唯一不收 pageRef 的 op。
       *
       * ⚠️ 不分流会怎样:`resolve()` 看到 `pageRef === undefined` 就报
       * 「pageRef.wcId 非法: undefined」—— 一句**诚实但完全误导**的错,
       * 人会去查 wcId 怎么没传,而真因是「这个 op 本来就不需要它」。
       *
       * ⭐ 而且 `resolve()` **有副作用**(register + bindPageHost):
       * 让纯查询走它,等于问一句话就注册一个页面。
       */
      if (p.op === 'identify') {
        if (typeof p.url !== 'string' || !p.url) {
          return failed('[web.page ipc] identify 缺 url');
        }
        /**
         * ⚠️ 认不出来回 `ok` + `null`,**不是 failed** ——
         * 「这页我不认识」是正常答案(人可能停在 x.com 的设置页)。
         * 报 failed 会让留痕里堆满红条,真故障被淹掉。
         */
        return { status: 'ok', value: identifySemanticPage(p.url) };
      }

      const got = resolve(p.pageRef);
      if ('error' in got) return failed(got.error);
      const { wc, pageId } = got;

      try {
        switch (p.op) {
          case 'run':
            if (!p.scriptId) return failed('[web.dom ipc] run 缺 scriptId');
            return toIpc(await domRunner.run(wc, pageId, p.scriptId as ScriptId, p.params));
          /**
           * ── 控制(`web.page`)—— 2026-10-01 为 X Console 开放 ──
           *
           * ⭐ `goto` 只收**语义页面名**不收 URL:
           * ① 站点改版时变的是页面表,调用方不动
           * ② 同时是一道闸 —— renderer 给不了任意 URL,
           *    就导航不到计划外的地方(旧实现「把首页当搜索结果」整批入库的成因)
           */
          case 'goto': {
            if (!p.name) return failed('[web.dom ipc] goto 缺语义页面名');
            const r = await controlEngine.goto(
              pageId,
              { kind: 'semantic', name: p.name, params: p.params },
              { readyTimeoutMs: p.readyTimeoutMs },
            );
            /**
             * ⭐⭐ 导航结果落盘 —— 2026-10-02 补。
             *
             * ⚠️ 起因:载荷捕到 0 条时,我**读不到人到底去了哪一页**,
             * 只能反过来问 —— 又回到「靠截图」(用户点破的那条)。
             * ⭐ `landedUrl` 尤其要紧:它与 `requestedUrl` 不同就说明
             * 站点自己接管了导航(X 常有),而那会改变后面该看什么。
             */
            traceRecorder.lifecycle({
              layer: 'web.page',
              event: r.status === 'ok' ? 'goto' : `goto-${r.status}`,
              pageId: String(pageId),
              detail: {
                name: p.name,
                params: p.params ?? {},
                landedUrl: (r as { value?: { landedUrl?: string } }).value?.landedUrl,
                reason: (r as { reason?: string }).reason,
              },
            });
            return toIpc(r);
          }
          case 'ready': {
            if (!p.criterion) return failed('[web.dom ipc] ready 缺判据');
            return toIpc(await controlEngine.ready(
              pageId,
              toReadyCriterion(p.criterion),
              p.timeoutMs,
            ));
          }
          /**
           * ── 输出(`web.net` 载荷捕获)—— 2026-10-02 ──
           *
           * ⭐ `captureStart` 兼管 attach:通道由底座单一持有,
           * 调用方**没有** detach 这个动作(X 旧实现那 8 处的血泪)。
           */
          case 'captureStart': {
            /**
             * ⭐⭐⭐ **webRequest 侧必须先接线** —— 2026-10-02 查出来的真缺口。
             *
             * ── ⚠️ 不接会怎样(整条链,守卫 net-webrequest-side-wired 记着)──
             *
             *   candidatesFor(pageId) 恒空
             *     → findClosestMatch 恒 null
             *       → attachProviderBody 恒「关联失败」
             *         → **不发 response-complete**
             *           → 订阅者一条载荷都收不到
             *
             * ⚠️⚠️ 而且是**静默**的:日志里只刷「关联失败」,
             * 调用方看到的是「捕获 0 条」—— 人会去查选择器或页面,方向完全相反。
             * 本仓 bio 采集 0/192、「未截获 @x 的账号载荷」都是这么来的。
             *
             * ⭐ 为什么挂在这里:`wireWebRequestSide` **自己幂等**(按 partition 去重),
             * 而这里是唯一知道「人要开始捕哪个页面」的地方。
             * ⚠️ Electron 每个 session **只能有一个** onBeforeRequest 监听器
             * (后挂的覆盖先挂的)—— 所以绝不能让业务方各挂一份,
             * 那会让这一侧又悄悄失效。全仓已确认只有这一处挂。
             */
            /**
             * ⚠️⚠️ 传**真 session 对象**,不传反推出来的 partition 名 ——
             * `readPartition` 是从 `storagePath` 取尾段猜的,而猜错时
             * `session.fromPartition()` 会**凭空建一个新 session**,
             * 监听挂到没人用的地方,且去重表还把这名字记下 →
             * 真 session 永远挂不上,**而日志照样打「已接线」**。
             * ⭐ 去重 label 用 storagePath(同一 session 必然相同、
             * 不同 session 必然不同),它不需要等于 partition 名。
             */
            wireWebRequestSideOn(netBus, wc.session, wc.session.storagePath ?? 'default');
            /**
             * ⭐ 接线这件事也落盘 —— 它是**最靠前**的线索:
             * 没接上的话后面三个数全是 0,而那时人分不清
             * 「没接上」与「页面没动」。两件事记下来才分得开。
             */
            traceRecorder.lifecycle({
              layer: 'web.net',
              event: 'webrequest-side-wired',
              pageId: String(pageId),
              detail: { partition: wc.session.storagePath ?? 'default' },
            });

            /**
             * ⚠️ `pageIdByWcId` 是在 `resolve()`(首次 IPC 调用)时才填的,
             * 而本次调用**已经**走过 resolve,所以此刻表里一定有这条 ——
             * 上面模块加载期注册的那个 lookup 从这一刻起就能查到了。
             * ⭐ 更早的请求(页面刚导航那一段)仍查不到,这是**已知边界**:
             * 人点「开始捕获」之前的请求本来就不在这一轮的范围里。
             */
            const session = sessionFor(pageId);
            session.start();
            /**
             * ⚠️ attach 失败**不静默** —— provider 会广播 channel-failed,
             * 上面的订阅者立刻收到,计数里也会出现。
             * ⭐ 但这里仍要如实回报:人点了「开始捕」要立刻知道成没成,
             * 不能等他滚了半天才发现一条都没有。
             */
            const attached = bodyProvider.attach(toPageHost(wc), pageId, {
              // ⚠️ 与 AI 侧同口径(interceptor.ts):X 的 GraphQL 走 fetch/xhr
              resourceTypes: ['fetch', 'document', 'xhr'],
            });
            /**
             * ⭐⭐ **结果落盘** —— 用户 2026-10-02:
             * 「你在底层有读取数据的能力，而不是靠我截图，否则效率会差很多。」
             *
             * ⚠️ 这正是 `feedback-maintainability-over-feature-completion`
             * 那条:X 采集面板的判断依据「只渲染一次关掉就没」,
             * 核对只能反过来要用户截图 —— 被点破「**你不记录如何做验证**」。
             * ⭐ 而那条还有后半句:**成功路径也要留痕**,不只失败。
             * 所以 attach 成功与否都写。
             */
            traceRecorder.lifecycle({
              layer: 'web.net',
              event: attached ? 'capture-start' : 'capture-attach-failed',
              pageId: String(pageId),
              detail: { url: wc.getURL(), partition: wc.session.storagePath ?? 'default' },
            });
            if (!attached) {
              return failed('[web.net ipc] CDP 通道 attach 失败 —— 载荷一条都收不到(DevTools 占着?)');
            }
            console.log(`[web.net] 载荷捕获已开始 pageId=${pageId}`);
            return { status: 'ok', value: session.stats() };
          }
          case 'captureStop': {
            /**
             * ⭐⭐ **「停」= 停止取数据 + 停止翻页**(用户 2026-10-02 定)。
             *
             * ⚠️ 原来只停了采集订阅,滚动循环照跑 ——
             * 实测人点停后滚动又跑了 18 秒,现象就是「停不下来」。
             * ⭐ 这里立起标记,滚动循环下一轮开头就会看见并退出。
             */
            scrollCancelled.add(pageId);
            const session = sessionFor(pageId);
            session.stop();
            const st = session.stats();
            /**
             * ⭐⭐ 停捕时把**三个数**落盘 —— 这是「这一轮到底捕到了什么」
             * 唯一能离开 renderer 的地方。
             * ⚠️ 不写的话这些数只活在 React state 里:
             * 人一关面板就没了,下次验证只能靠截图。
             */
            traceRecorder.lifecycle({
              layer: 'web.net',
              event: 'capture-stop',
              pageId: String(pageId),
              detail: {
                captured: st.captured,
                noBody: st.noBody,
                bodyLost: st.bodyLost,
                channelFailures: st.channelFailures,
                lastChannelFailure: st.lastChannelFailure,
                url: wc.getURL(),
                /**
                 * ⭐⭐ **捕到的是什么** —— 2026-10-02 补。
                 *
                 * ⚠️ 起因:实测捕到 37 条,但留痕里只有**失败**的 URL,
                 * 成功的一条 URL 都没有 → 我知道「捕到 37 条」
                 * 却**不知道捕到的是什么**(第一条还是广告视频分片)。
                 * ⭐ 又是「不量的字段永远 100%」的同族:
                 * 数字对了不等于采到了要的东西。
                 *
                 * ⚠️ 只记**路径尾段 + 大小**,不记完整 URL(带长 queryId、
                 * 可能含敏感参数)、更不记正文(几十 KB 会把留痕写爆)。
                 */
                payloads: session.list(40).map((x) => ({
                  tail: x.url.split('?')[0].split('/').filter(Boolean).pop() ?? '(无)',
                  kb: Math.round(x.byteLength / 102.4) / 10,
                })),
              },
            });
            console.log(
              `[web.net] 载荷捕获已停止 pageId=${pageId} —— `
              + `captured=${st.captured} noBody=${st.noBody} bodyLost=${st.bodyLost}`
              + ` channelFailures=${st.channelFailures}`,
            );
            return { status: 'ok', value: st };
          }
          /**
           * ⭐ 只停翻页 —— 人可能**只滚不捕**,那时 `captureStop` 用不上,
           * 但翻页照样要能停(用户 2026-10-02:「两个动作」)。
           */
          /**
           * ⭐ 重载当前页 —— 为了避开「attach 与首次请求」的竞态。
           * ⚠️ 用 `wc.reload()` 而不是 `loadURL(当前URL)`:
           * 后者会丢掉 SPA 的路由状态,而且在 X 上会被重定向回首页。
           */
          case 'reload': {
            const before = wc.getURL();
            wc.reload();
            traceRecorder.lifecycle({
              layer: 'web.page',
              event: 'reload-for-capture',
              pageId: String(pageId),
              detail: { url: before },
            });
            console.log(`[web.page] 已重载(捕获中)pageId=${pageId} ${before}`);
            return { status: 'ok', value: { reloaded: true, url: before } };
          }
          /**
           * ⭐⭐ 面板动作落盘 —— 让「人点了什么」能被读到。
           * ⚠️ 2026-10-02:连续两轮卡在同一步而我**读不到面板状态**,
           * 只能静态推断(查了四轮没结论)。
           * ⭐ 「人点了但没发出去」与「人没点」必须分得开。
           */
          /**
           * ⭐⭐ 把核对报告写成文件 —— 人和 AI 看**同一份**。
           * ⚠️ 底座只负责「写」,内容由业务模块渲染(它不认识 X 的字段)。
           */
          case 'writeAudit': {
            if (typeof p.text !== 'string' || p.text.length === 0) {
              return failed('[web ipc] writeAudit 缺内容');
            }
            try {
              const dir = join(app.getPath('userData'), 'krig-data', 'x-audit');
              mkdirSync(dir, { recursive: true });
              // ⚠️ 文件名带时间戳 —— **不覆盖历史**,两次采集要能对照
              const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
              const file = join(dir, `${p.name ?? 'audit'}-${stamp}.txt`);
              /**
               * ⭐⭐⭐ **main 进程的构建时刻写在最前面** —— 2026-10-06。
               *
               * 用户问:「为什么存在跑的不是你修改的代码这一个说法呢?」
               * ⚠️⚠️ 因为 `electron-forge start` **只在启动时构建**:
               * 改完 main 的代码不重启 app,跑的就还是上一份。而在此之前
               * 「跑着的 app 里有没有刚才那个修改」**无从得知** —— 只能靠人说
               * 「应该有了」,那是猜不是判据。真机代价:改完让用户再采一次,
               * 数据纹丝不动,两个人对着同一份输出纳闷了两轮。
               *
               * ⭐ 写在**这一层**(main)而不是 renderer:
               * 滚动/翻页/采集都在 main,它的构建戳才是「那个修复在不在」的答案;
               * 而且 renderer 在 dev 下不落盘,命令行根本查不到。
               */
              const head = `main 构建：${mainBuildStamp()}\n`;
              writeFileSync(file, head + p.text, 'utf-8');
              traceRecorder.lifecycle({
                layer: 'web.net', event: 'audit-written', pageId: String(pageId),
                detail: { file, bytes: p.text.length },
              });
              console.log(`[x.audit] 核对报告已写入 ${file}`);
              return { status: 'ok', value: { file } };
            } catch (e) {
              // ⚠️ 写失败要如实说 —— 静默会让人以为写了
              return failed(`[web ipc] 写核对报告失败: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          case 'uiTrace': {
            traceRecorder.lifecycle({
              layer: 'web.net',
              event: `ui:${p.action}`,
              pageId: String(pageId),
              detail: { ...(p.state ?? {}) },
            });
            return { status: 'ok', value: { recorded: true } };
          }

          /**
           * ⭐⭐⭐ **采这一页** —— 一次调用做完全部编排。
           * 用户 2026-10-03:「我自己选定一个页面,点击开始采集,就采集」。
           */
          case 'harvest': {
            afterRoundResults.delete(pageId);
            const rep = await harvestPage(makeHarvestDeps(wc, pageId), pageId, p.plan ?? {});
            traceRecorder.lifecycle({
              layer: 'web.net',
              event: rep.ok ? 'harvest-ok' : 'harvest-incomplete',
              pageId: String(pageId),
              detail: {
                url: wc.getURL(),
                total: rep.items.length,
                pages: rep.pages,
                rounds: rep.rounds,
                scrolledPx: Math.round(rep.scrolledPx),
                elapsedMs: rep.elapsedMs,
                stopReason: rep.stopReason,
                legs: rep.legs,
                problems: rep.problems,
                /**
                 * ⭐⭐ **收到的是什么** —— 2026-10-04 补。
                 *
                 * ⚠️ 起因:配方搜索滚了 60 轮 39983px,却只有 **1 条**时间线载荷,
                 * 而我**读不出那 40 条响应里都是些什么** —— 只能回头猜。
                 * ⭐ 这正是 2026-10-02 补过的那条(「我知道捕到 37 条,
                 * 却不知道捕到的是什么」),`harvest` 取代手动流程时**漏带了**。
                 *
                 * ⚠️ 只记**路径尾段 + 条数**,不记完整 URL(带长 queryId)、
                 * 更不记正文(几十 KB 会把留痕写爆)。
                 */
                endpoints: (() => {
                  const n = new Map<string, number>();
                  for (const it of rep.items) {
                    const tail = it.url.split('?')[0].split('/').filter(Boolean).pop() ?? '(无)';
                    n.set(tail, (n.get(tail) ?? 0) + 1);
                  }
                  return [...n.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20)
                    .map(([tail, count]) => `${count}× ${tail}`);
                })(),
                /** ⭐ 展开的产出摘要 —— 「跑没跑」要分得清 */
                expand: rep.afterRound.length > 0
                  ? {
                    轮数: rep.afterRound.length,
                    点开了: rep.afterRound.reduce<number>(
                      (n, x) => n + (((x as { expanded?: number }).expanded) ?? 0), 0,
                    ),
                  }
                  : '(未启用)',
                /** ⭐ 采到了什么 —— 全量按类型聚合,不截断 */
                byKind: (() => {
                  const g = new Map<string, number>();
                  for (const x of rep.items) {
                    const tail = x.url.split('?')[0].split('/').filter(Boolean).pop() ?? '(无)';
                    const key = /\.(m4s|mp4|m3u8|ts)$/.test(tail)
                      ? `(视频分片 *.${tail.split('.').pop()})` : tail;
                    g.set(key, (g.get(key) ?? 0) + 1);
                  }
                  return Object.fromEntries([...g.entries()].sort((a, b) => b[1] - a[1]));
                })(),
              },
            });
            console.log(
              `[web.harvest] ${rep.ok ? '✓' : '⚠'} pageId=${pageId} —— `
              + `${rep.pages} 页 / ${rep.items.length} 条 / ${rep.rounds} 轮 / ${rep.stopReason}`,
            );
            /** ⚠️ 不完整回 degraded **不是 failed** —— 采了一半也是真的 */
            if (!rep.ok) {
              return { status: 'degraded', value: rep, missing: [...rep.problems] };
            }
            return { status: 'ok', value: rep };
          }

          /**
           * ── ⭐⭐ 采集(输出栏)—— **只管收,不碰页面** ──
           * 用户 2026-10-02:「控制是控制,采集是采集…控制/输出是分开的。」
           */
          case 'acquireStart': {
            const r = await startAcquire(
              makeAcquireDeps(wc, pageId), pageId, p.noisyUrlSubstrings,
            );
            acquireStartedAt.set(pageId, Date.now());
            // ⚠️ 清掉上一轮的产出 —— 不清会把旧全文混进新一轮
            afterRoundResults.delete(pageId);
            traceRecorder.lifecycle({
              layer: 'web.net', event: 'acquire-start', pageId: String(pageId),
              detail: { url: wc.getURL(), ...r },
            });
            console.log(
              `[web.acquire] 开始收 pageId=${pageId} —— `
              + `CDP=${r.cdpAttached ? '✓' : '✗'} 钩子=${r.hookInstalled ? '✓' : '✗'}`,
            );
            /** ⚠️ **两条都没起来**才算失败 —— 少一条是降级 */
            if (!r.ok) return failed('[web.acquire] 两条腿都没起来 —— 什么也收不到');
            return { status: 'ok', value: r };
          }

          case 'acquirePeek':
            return {
              status: 'ok',
              value: peekAcquire(makeAcquireDeps(wc, pageId), pageId),
            };

          case 'acquireStop': {
            const report = finishAcquire(
              makeAcquireDeps(wc, pageId), pageId, acquireStartedAt.get(pageId),
            );
            acquireStartedAt.delete(pageId);
            /**
             * ⭐⭐ 把每轮脚本的产出一并回去(X 用它拿展开后的全文)。
             * ⚠️ 底座**不解释**这些值 —— 它不知道什么是「全文」,
             * 原样转给业务,由业务按自己的规则合并。
             */
            const rounds = afterRoundResults.get(pageId) ?? [];
            afterRoundResults.delete(pageId);
            traceRecorder.lifecycle({
              layer: 'web.net',
              event: report.ok ? 'acquire-ok' : 'acquire-incomplete',
              pageId: String(pageId),
              detail: {
                url: wc.getURL(),
                total: report.items.length,
                elapsedMs: report.elapsedMs,
                legs: report.legs,
                problems: report.problems,
                /**
                 * ⭐⭐ 采到了**什么** —— ⚠️ **全量按类型聚合**,不截断。
                 *
                 * ⚠️ 2026-10-02 实测踩到:原来 `slice(0, 40)` 取的是**最新 40 条**,
                 * 而滚到后面全是视频分片 —— `HomeTimeline` 在更早的 31 条里,
                 * **被截掉了**。于是留痕报「37 条视频分片、0 条 GraphQL」,
                 * 而真相是 GraphQL 就在被截掉的那半边。
                 * ⭐ 「不量的字段永远 100%」的变体:**不记的那半边永远不存在**。
                 */
                byKind: (() => {
                  const g = new Map<string, { n: number; min: number; max: number }>();
                  for (const x of report.items) {
                    const tail = x.url.split('?')[0].split('/').filter(Boolean).pop() ?? '(无)';
                    // ⭐ 视频分片名是随机串,按**后缀**归一,否则几十个各算一类
                    const key = /\.(m4s|mp4|m3u8|ts)$/.test(tail)
                      ? `(视频分片 *.${tail.split('.').pop()})` : tail;
                    const kb = Math.round(x.byteLength / 102.4) / 10;
                    const e = g.get(key) ?? { n: 0, min: kb, max: kb };
                    g.set(key, { n: e.n + 1, min: Math.min(e.min, kb), max: Math.max(e.max, kb) });
                  }
                  return Object.fromEntries(
                    [...g.entries()].sort((a, b) => b[1].max - a[1].max)
                      .map(([k, v]) => [k, `${v.n} 条 ${v.min}-${v.max}KB`]),
                  );
                })(),
                /** ⭐ 最大的 8 条 —— 正经数据都在这里 */
                biggest: [...report.items]
                  .sort((a, b) => b.byteLength - a.byteLength)
                  .slice(0, 8)
                  .map((x) => ({
                    tail: x.url.split('?')[0].split('/').filter(Boolean).pop() ?? '(无)',
                    kb: Math.round(x.byteLength / 102.4) / 10,
                    from: x.from,
                  })),
              },
            });
            console.log(
              `[web.acquire] ${report.ok ? '✓' : '⚠'} 停止 pageId=${pageId} —— `
              + `${report.items.length} 条`,
            );
            const withRounds = { ...report, afterRound: rounds };
            if (!report.ok) {
              return { status: 'degraded', value: withRounds, missing: [...report.problems] };
            }
            return { status: 'ok', value: withRounds };
          }

          // ── ⚠️ 下面是**单条腿**的入口 —— 调试用,正常路径走 `acquire` ──
          case 'hookStart': {
            let hook = hooksByPageId.get(pageId);
            if (!hook) {
              hook = new HookSession(toHookHost(wc), pageId, (r) => {
                traceRecorder.lifecycle({
                  layer: 'web.net',
                  event: 'hook-first-payload',
                  pageId: String(pageId),
                  detail: { via: r.via, url: r.url, byteLength: r.byteLength },
                });
                console.log(`[web.hook] ⭐ 首条(${r.via}) ${r.byteLength}B ${r.url}`);
              });
              hooksByPageId.set(pageId, hook);
            }
            await hook.start();
            traceRecorder.lifecycle({
              layer: 'web.net',
              event: 'hook-start',
              pageId: String(pageId),
              detail: { url: wc.getURL() },
            });
            console.log(`[web.hook] 页面内钩子已装 pageId=${pageId}`);
            return { status: 'ok', value: hook.stats() };
          }
          case 'hookStop': {
            const hook = hooksByPageId.get(pageId);
            if (!hook) return failed('[web.hook ipc] 这个页面没有钩子会话');
            hook.stop();
            const st = hook.stats();
            traceRecorder.lifecycle({
              layer: 'web.net',
              event: 'hook-stop',
              pageId: String(pageId),
              detail: {
                hooked: st.hooked,
                lost: st.lost,
                injected: st.injected,
                url: wc.getURL(),
                /** ⭐ 记下钩到了**什么** —— 只记路径尾段+KB,不记正文 */
                payloads: hook.list(40).map((x) => ({
                  via: x.via,
                  tail: x.url.split('?')[0].split('/').filter(Boolean).pop() ?? '(无)',
                  kb: Math.round(x.byteLength / 102.4) / 10,
                })),
              },
            });
            console.log(
              `[web.hook] 已停 pageId=${pageId} —— hooked=${st.hooked} lost=${st.lost}`,
            );
            return { status: 'ok', value: st };
          }
          case 'hookStats': {
            const hook = hooksByPageId.get(pageId);
            // ⚠️ 没会话时如实回「全 0 且未注入」,不报错 —— 面板要能轮询
            return {
              status: 'ok',
              value: hook?.stats()
                ?? { hooked: 0, lost: 0, held: 0, running: false, injected: false },
            };
          }
          case 'hookList':
            return { status: 'ok', value: hooksByPageId.get(pageId)?.list(p.limit) ?? [] };
          case 'hookClear': {
            const hook = hooksByPageId.get(pageId);
            hook?.clear();
            return { status: 'ok', value: hook?.stats() ?? null };
          }
          case 'scrollStop':
            scrollCancelled.add(pageId);
            console.log(`[web.page] 已请求停止翻页 pageId=${pageId}`);
            return { status: 'ok', value: { cancelled: true } };
          case 'captureStats':
            return { status: 'ok', value: sessionFor(pageId).stats() };
          case 'captureList':
            return { status: 'ok', value: sessionFor(pageId).list(p.limit) };
          case 'captureClear': {
            const session = sessionFor(pageId);
            session.clearPayloads();
            return { status: 'ok', value: session.stats() };
          }
          case 'scrollUntil': {
            if (!p.stop) return failed('[web.dom ipc] scrollUntil 缺停止判据');
            /**
             * ⚠️ 开跑前先清掉旧标记 —— 不清的话上一轮点过停,
             * 这一轮会「一轮都没滚就结束」,而现象是「点了没反应」。
             */
            scrollCancelled.delete(pageId);
            const r = await controlEngine.scrollUntil(
              pageId,
              toScrollStop(p.stop),
              {
                maxRounds: p.maxRounds,
                settleMs: p.settleMs,
                // ⭐ 每轮开头问一次 —— 这就是「停」能打断翻页的那根线
                shouldStop: () => scrollCancelled.has(pageId),
                /**
                 * ⭐⭐ 每轮滚完跑业务给的脚本(X 用它点开「Show more」)。
                 * ⚠️ 只认**预注册的 id**,收不了脚本文本 ——
                 * 那道闸是 `inject-template-escape` 换来的。
                 * ⚠️ 结果**攒起来**:业务要的是展开后的全文,
                 * 而滚动报告里塞不下 —— 由 `acquirePeek`/`acquireStop` 一并回。
                 */
                afterRound: p.afterRoundScriptId
                  ? async (round) => {
                    const rr = await domRunner.run(
                      wc, pageId, p.afterRoundScriptId as ScriptId,
                    );
                    if (rr.status === 'ok') {
                      collectAfterRound(pageId, rr.value);
                    } else {
                      /**
                       * ⚠️⚠️ 失败**必须留痕** —— 2026-10-03 实测踩到:
                       * 滚了 10 轮、流程全跑了,但我**读不到展开跑没跑**,
                       * 只能靠猜。而「脚本没注册」与「脚本跑了但没东西可展开」
                       * 症状完全一样(都是最长 169 字)。
                       */
                      traceRecorder.lifecycle({
                        layer: 'web.page',
                        event: 'after-round-failed',
                        pageId: String(pageId),
                        detail: {
                          round,
                          scriptId: String(p.afterRoundScriptId),
                          reason: (rr as { reason?: string }).reason,
                        },
                      });
                    }
                  }
                  : undefined,
              },
            );
            // ⚠️ 跑完即清,免得标记留到下一次(表现为「下次一开始就停」)
            scrollCancelled.delete(pageId);
            /**
             * ⭐⭐ 滚动结果落盘 —— 这是「载荷为什么是 0」的**头号判据**。
             *
             * ⚠️ `project-x-collect-needs-scroll`:采到 0 条有两种成因 ——
             * 链路坏 vs **页面太短滚不动**(实测 x.articles 跳转成功、
             * 屏幕有卡片却采 0 条,因为 scrollY 8 轮未变不触发载荷)。
             * ⭐ `scrolledPx` / `rounds` / `stopReason` 三个数一摆,
             * 这两种成因立刻分得开 —— 不记的话只能靠人回忆点没点过。
             */
            const v = (r as { value?: {
              rounds?: number; scrolledPx?: number;
              reachedBottom?: boolean; stopReason?: string; problems?: readonly string[];
            } }).value;
            traceRecorder.lifecycle({
              layer: 'web.page',
              event: r.status === 'ok' ? 'scroll' : `scroll-${r.status}`,
              pageId: String(pageId),
              detail: {
                rounds: v?.rounds,
                scrolledPx: v?.scrolledPx,
                /**
                 * ⭐⭐ 每轮脚本的产出摘要 —— 2026-10-03 加。
                 * ⚠️ 没有它就分不清「脚本没跑」与「跑了但没东西可展开」,
                 * 而两者的症状完全一样(正文还是截断版)。
                 */
                afterRound: p.afterRoundScriptId
                  ? (() => {
                    const got = afterRoundResults.get(pageId) ?? [];
                    const clicked = got.reduce<number>(
                      (n, x) => n + (((x as { expanded?: number }).expanded) ?? 0), 0,
                    );
                    const read = got.reduce<number>(
                      (n, x) => n + (((x as { tweets?: unknown[] }).tweets?.length) ?? 0), 0,
                    );
                    return { 轮数: got.length, 点开了: clicked, 回读: read };
                  })()
                  : '(未启用)',
                reachedBottom: v?.reachedBottom,
                stopReason: v?.stopReason,
                problems: v?.problems,
                reason: (r as { reason?: string }).reason,
              },
            });
            return toIpc(r);
          }
          /**
           * ⚠️ 没有 `read`/`query`/`text`/`selection` —— `WebDom` 接口里
           * 声明了但**全仓零实现**(只有 `ElectronDomRunner.run` 落地)。
           * ⭐ 开出去就是空头承诺:调了必然失败,而原因是「底座没实现」,
           * 会把排查方向完全带偏。等真实现了再加 op。
           */
          default:
            /**
             * ⚠️ 未知 op **如实报**,不静默当某个默认操作 ——
             * 静默会让「renderer 发错了」表现成「操作没效果」。
             * ⭐ 尤其:`runDynamic` 会走到这里被拒,这是刻意的。
             */
            return failed(`[web.dom ipc] 不支持的 op: ${String((p as { op: unknown }).op)}`);
        }
      } catch (err) {
        // ⚠️ 不静默 —— 这正是本层要替换掉的那个病(.catch(() => {}))
        return failed(`[web.dom ipc] ${p.op} 抛异常: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
