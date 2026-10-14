# 交接:把采集引擎从 ipc-dom 搬出成独立模块(后台策略 3a)

> 2026-10-13。X 运营「他的朋友圈」第二步(后台采集策略)的 **3a 步**。
> **这是一次高风险重构 —— 从一个每天在用的 1325 行活文件里搬采集引擎,要全程盯真机。**
> 用户要求:**回复一律用中文**;大改动**先讨论/出计划再写**;问用户只问「效果」不问实现方案;
> **验证交给独立对话**(本任务就是独立验证对话,上游设计已定,你执行+真机验收)。

---

## 一句话任务

把 `src/platform/main/web-capability/wiring/ipc-dom.ts`(1325 行)里的**采集引擎零件**
搬进一个新模块 `web-collect-engine.ts`,并在新模块里新增 `collectOnWebview()`。
**ipc-dom 瘦身成纯 IPC 接线**,其各 case 改成调新模块。
目标:**采帖子行为一字不变**(这步纯搬家 + 新增一个函数,不接 runner、不碰后台 UI)。

为什么要搬:后台 runner(3b,在主进程)也要跑采集,但采集编排现在锁在 renderer 的
`XOpsPeople.tsx::collectTweets` 里(runCollect 循环在 renderer 跑,每轮经 webDomInvoke
转发到 main)。runner 没有 renderer。所以要把「对一个 webview 跑一次 runCollect」抽成
**main 侧共享函数**,renderer 人卡和 runner 都调它,不复制、不漂移。
用户拍板:**路 A(main 侧直接驱动 webview,真后台)+ 一步到位(人卡也改调它)**。

## ⭐⭐ 用户定的原则(本任务的宪法)

- **坚持分层分块**。原来构建不合理就调整它 —— ipc-dom 既接 IPC 又揣采集引擎,就是不合理,所以搬。
- **行为一字不改**:纯搬家。引擎零件逻辑原样,只换文件位置 + 改 ipc-dom 各 case 调新模块。
- **逐块搬,每块编译 + 跑测试**。先搬依赖最少的纯函数,再搬有状态的。绝不一口气改完。
- **搬完真机验采帖子不变**(右键采一个活跃号,跟现在一模一样)。
- 这步**完全不接 runner、不碰后台**。collectOnWebview 写好但只给人卡用(3b 才接 runner)。

## 边界图(已与用户确认,按这个搬)

```
┌─ 采集引擎(搬去新模块 web-collect-engine.ts)——「对一个 webview 跑采集」,不认识 IPC ─┐
│  per-webview 会话状态(模块级 Map,连状态一起搬):                              │
│    pageIdByWcId · sessionsByPageId · hooksByPageId · hookNoisyByPageId        │
│    afterRoundResults · acquireStartedAt · scrollCancelled                     │
│  采集原语:                                                                    │
│    resolve · makeAcquireDeps · makeHarvestDeps · sessionFor                   │
│    collectAfterRound · mergedItems · mergedStats · readPartition · sameList   │
│    dedupKey                                                                    │
│  ⭐ 新增 collectOnWebview(wcId, {page,handle,resumeCursor,start,pageCap})       │
│     = goto → runCollect 循环(harvest/runScript 接上) → 返回 RunOneResult        │
└──────────────────────────────────────────────────────────────────────────┘
        ↑ 被调用
┌───────┴────────────────────┐
│ ipc-dom.ts(瘦身=纯接线)      │  registerWebDomIpc 各 case 改成调引擎
│   registerWebDomIpc          │  failed / toIpc / toReadyCriterion / toScrollStop 留下
└─────────────────────────────┘
```

### ⚠️ 搬迁中几个要当心的点(都在 ipc-dom.ts 里看过)

1. **模块加载期副作用**:`registerPageIdLookup((wcId)=>…)`(约 95-120 行)在 ipc-dom
   **加载时就跑**。它依赖 `pageIdByWcId`(要搬走的)。搬动顺序:先把 Map 搬进新模块并导出,
   再决定这段 lookup 注册放哪(建议跟 pageIdByWcId 一起进新模块,ipc-dom 不再碰)。
2. **`resolve` 里有 `wc.once('destroyed')` 清理**(约 517 行):清 pageIdByWcId + 停 session。
   搬走时这套生命周期一起搬,别断。
3. **harvest/run/acquire/capture 各 case 的厚重留痕**(byKind/endpoints 聚合)——
   用户拍板**留在 ipc-dom 的 case 里**,不进引擎。引擎只采+返回数据,留痕由调用方打。
   ⚠️ 所以 renderer 人卡改调 collectOnWebview 后,原来在 ipc-dom case 里的那些留痕要确认
   **不丢**(collectOnWebview 要么自己打关键留痕,要么调用方补)。这是本步最容易漏的地方。
4. **两条腿**:`sessionsByPageId`(CDP 腿)+ `hooksByPageId`(页面钩子腿),各记各的绝不合并计数。
5. 引擎依赖的 import(都在 ipc-dom 顶部 26-55 行):controlEngine/domRunner/pageRegistry/
   netBus/bodyProvider/CaptureSession/HookSession/startAcquire/peekAcquire/finishAcquire/
   harvestPage/bindPageHost/registerPageIdLookup/toHookHost/toPageHost/wireWebRequestSideOn/
   identifySemanticPage/scriptRegistry/listPageNames —— 搬零件时对应 import 一起带走。

## collectOnWebview 要复刻的东西(renderer 现状)

现在采帖子在 `src/modules/x/XOpsPeople.tsx::collectTweets`(约 233-327 行):
- 外层 `for (const tab of PERSON_TABS)` 三个标签页;内层 `for attempt 1..2`(第一轮 403 重载重试)
- 每个 attempt:`webDomInvoke goto` → `runCollect({harvest, runScript, stopPaging, cancelled, onProgress, wait}, {wantPages:1, depth:'expand-only', seedPages:1, maxRounds:20, maxMs:60_000})`
  - harvest 注入 = webDomInvoke `harvest` → main `harvestPage(makeHarvestDeps(wc,pid), pid, plan)`
  - runScript 注入 = webDomInvoke `run` → main `domRunner.run(wc, pid, id, params)`
  - stopPaging = `timeWindowStop(restId, start, live_page_cap)`
  - 结果:saveTweets(经 xDataCall) + logPersonCollect 留痕
- collectOnWebview 要把「goto + runCollect 循环」这段搬到 main 侧,harvest/runScript 直接调
  main 原语(不再经 IPC 往返)。saveTweets / 留痕 / UI 状态 / 重载重试 **留在调用方**
  (人卡保留 attempt 重试和 setCollect;runner 用 x-bg-segment 的 runSegment 包它)。
- ⚠️ collectOnWebview 的返回**正好对上 `x-bg-segment.ts` 的 `RunOneResult`**
  (pages/saved/nextCursor/exhausted/stopReason/oldestAt/failure)—— 看那个类型定义,对齐它。
  (saved 由调用方存库后回填,还是引擎内存?建议:引擎只采+返回 records,存库由调用方做,
   这样引擎不碰 x_tweet、保持「只采」。跟用户确认这点。)

## 已完成的上游(你在此基础上做)

- 403 根治已提交 `ad8ac31d`(翻页种子请求头来源查清 + CDP 补头 + 去必死兜底)。
- 后台策略第 1+2 步已提交 `a4594703`:
  - schema 1.2.26 `x_bg_job`(已内存库验证)
  - `x-bg-job.ts`(纯逻辑,类型+状态流转)+ 20 测
  - `x-bg-job-repo.ts`(表读写)+ 真 SurrealDB 10 测(`x-bg-job-repo.verify.test.ts`)
  - `x-bg-segment.ts`(跑一段编排,`RunOneResult`/`runSegment` 契约在这)+ 12 测
  - `client.ts` 加 `__setXDBForTest`
- ⚠️ 这些**都没接线**:x_bg_job 表没人写、runner 没写、collectOnWebview 没写。3a 做 collectOnWebview
  + 改人卡调它;3b 做 runner + 接 index.ts。**你这次只做 3a。**

## 验收标准(用户验收 / 你自证)

1. `npx tsc --noEmit -p .` 0 错
2. `npx vitest run` —— 基线 2587 + 42(第1+2步)全过;6 个加载失败是基线已知
   (scenario-6/7/9/11、create-notes-batch、parse-chrome-bookmarks),不是你引入的
3. ⭐⭐ **真机验采帖子不变**:重启 app(改了 main 要重启;先 `node scripts/x-build-fresh.mjs` 确认跑新构建),
   右键一个活跃号采帖子 —— 行为、留痕、入库条数跟 3a 之前一模一样。
4. 搬迁每一块都 git 可回退(逐块 commit 或至少逐块 tsc+测试)。

## ⚠️⚠️ 本仓踩过的坑(照做)

- 改 main 进程代码要**重启 app**(forge 只在启动时构建);`.vite/build/index.js` 是 160 字节 stub,
  真包是 `index-<hash>.js` —— 别 grep 错文件。
- 守卫测试要**注入违规看它变红**(zsh 里 `for f in $FILES` 不拆分 → 用数组;注入完 grep 确认已还原)。
- SurrealDB:option 传 undefined 不传 null;datetime 用 type::datetime();写记录 UPSERT type::record()。
- **别拿一个指标否定它没测的能力**;**别猜、看真实数据**(加诊断/读真实数据定根因)。
- 真机日志要打在**主进程**那侧(renderer 的 console 只在那个 webview 的 DevTools)。
- 调试用本机 Mac;Windows 那台是生产机不能停。

## 基线命令

`npx tsc --noEmit -p .` / `npx vitest run`(约 128s,可后台跑)。
真 SurrealDB 验证测试会起本机 `/opt/homebrew/bin/surreal`(3.0.4),没有则 skip。
