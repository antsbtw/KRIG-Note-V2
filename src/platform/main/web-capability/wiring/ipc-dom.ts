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

import { app, ipcMain } from 'electron';
import { mainBuildStamp } from './build-stamp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type {
  WebDomInvoke,
  WebDomReadyCriterion,
  WebDomResult,
  WebDomScrollStop,
} from '@shared/ipc/web-dom-types';
import {
  controlEngine, domRunner, scriptRegistry, listPageNames,
  identifySemanticPage, netBus, bodyProvider, traceRecorder,
} from './runtime';
import { HookSession } from '../hook/hook-session';
import { toHookHost } from './electron-hook-host';
import { startAcquire, peekAcquire, finishAcquire } from '../acquire/acquire';
import { toPageHost } from './electron-page-host';
import { wireWebRequestSideOn } from './webrequest-side';
import type { ReadyCriterion, ScrollStop } from '../page/control-types';
import type { AnchorName } from '../dom/types';
import type { ScriptId } from '../dom/types';
import {
  resolve, scrollCancelled, hooksByPageId,
  afterRoundResults, collectAfterRound, acquireStartedAt, sessionFor,
  makeAcquireDeps, gotoOnPage, harvestOnPage, runScriptOnPage,
} from './web-collect-engine';
import { traceGoto, traceHarvest } from './collect-trace';

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
            return toIpc(await runScriptOnPage(wc, pageId, p.scriptId, p.params));
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
            const r = await gotoOnPage(pageId, p.name, p.params, p.readyTimeoutMs);
            traceGoto(pageId, p.name, p.params, r);
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
            const rep = await harvestOnPage(wc, pageId, p.plan ?? {});
            traceHarvest(pageId, wc.getURL(), rep);
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
