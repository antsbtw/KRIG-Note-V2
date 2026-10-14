# 交接:后台采集 UI 入口 + 全程真机(后台策略 第4步)

> 2026-10-13。X 运营「他的朋友圈」第二步的**第 4 步**(最后一步)。
> 用户要求:**回复一律用中文**;大改动**先讨论/出计划再写**;问用户只问「效果」不问实现方案;
> **验证交给独立对话**(本任务就是独立对话,上游设计已定,你执行+真机验收)。

---

## 一句话任务

后台采集的**引擎**已全部做完(3b runner 能跑、调度验过),但**没有入口让用户建后台任务**,
且**一次真机都没验过**。本步:① 接 UI 入口(建任务/进度/暂停取消)② 全程真机验收。

## 现状(已提交 main,未推送)

一条完整的链路已就位,只差 UI 和真机:
- `ad8ac31d` 403 根治(真机验过)
- `a4594703` 后台第1+2步:schema 1.2.26 `x_bg_job` + 纯逻辑 `x-bg-job.ts` + repo `x-bg-job-repo.ts` + 跑一段 `x-bg-segment.ts`
- `3134cc0a` 3a:采集引擎搬出 ipc-dom,`collectOnWebview`/`collectPersonTab` 落 X 模块(真机验过采帖子)
- `6dc54afd` 断点续采修复(推文页 resumeCursor 生效、上限停交得出 nextCursor、到头标 exhausted)
- `edfa792b` 3b runner:`x-bg-runner.ts`(节奏控制器)+ 接 X main.ts(自启动+自挂 before-quit)+ 节奏变量

⚠️ 这些**全绿但没接 UI、没真机**。x_bg_job 表没人写(没入口)、runner 空转(没任务可挑)。

## 第 4 步要接的点(都在手上)

### ① UI 入口(改人卡 `src/modules/x/XOpsPeople.tsx`)
- 范围选择框(约 784-793 行):现在「半年/一年/全部」都 `disabled`+「第二步:后台策略」。
  启用它们 → 点击**建后台任务**(调新 IPC `bgCreateJob`,传 restId/handle/wsId/range),
  **不走 collectTweets**(那是当场采 month)。建完提示「已排进后台,会慢慢采」。
  ⚠️ wsId 怎么来:当前登录号,人卡已有(看 collectTweets 怎么拿 wcId→ws)。
- 进度显示:人卡(或运营状态页)列出该人/该 ws 的后台任务,显示 `describeProgress(job)`
  (x-bg-job.ts 已导出,一句话:帖子采到X/回复.../转发... 共N页M条),带**暂停/恢复/取消**按钮。
- ⚠️ 没做的按钮一律 disabled +「还没做」,别挂空 onClick(守卫钉过)。

### ② 新增 IPC(x-data-ipc.ts,X 自带通道,别进 channel-names)
现在**完全没有**后台任务的 op。要加:
- `bgCreateJob`(restId/handle/wsId/range)→ `createJob`(x-bg-job-repo,已去重:同人同范围不重建)
- `bgListJobs`(可选 wsId)→ `listJobs`
- `bgJobProgress` / 或复用 listJobs 轮询 → renderer 每秒/几秒问一次(X 无推送通道,与 personCollectProgress 同套路)
- `bgPauseJob`(id)→ `setJobStatus(id,'paused')` / `bgResumeJob` → `setJobStatus(id,'queued')`
- `bgCancelJob`(id)→ `deleteJob`(断点是派生状态,删了无损真数据)
⚠️ repo 函数都在 `x-bg-job-repo.ts` 已导出,直接调;别重写。

## ⚠️⚠️ 真机验收清单(本步重头,只有真机验得出)

按风险从高到低:

1. **app 还能正常启动** —— ⭐最高风险。`startBgRunner()` 在**模块加载期**执行
   (main.ts 末尾 `registerXModule()`),比 app.whenReady 早。那里调了
   `app.on('before-quit', stopBgRunner)` + `setInterval`。加载期 `app.on` 通常没问题,
   但**没真机验过**,万一炸就是 app 起不来。先确认 app 正常起、控制台无相关报错。
2. **Ctrl+C 能退** —— before-quit 停了 timer(记忆 project-graceful-shutdown:
   常驻 timer 不停→吊住事件循环→Ctrl+C 不退)。真机 Ctrl+C 看能不能干净退出。
3. **建一个后台任务(半年)→ 后台真采了一段 → 存了断点**。看 trace 的 `x-bg-progress` 留痕 +
   x_bg_job 行的 total_pages/profile_cursor 有没有动。⚠️ runner 默认 120s 一 tick,别急。
4. **重启 app → 从断点接着采**(不从头)。看第二段的起始游标 = 第一段存的断点。
5. **后台跑时你手动操作该号(核对/取关)→ 让路暂停**(isDue 看 getXHostBusy)。
6. **暂停/取消有效**;三页全到底→任务 done。
7. ⚠️ 节奏默认保守(每段10页/间隔120s),活跃号采「全部」要很久——这是设计(用户:慢慢跑),不是卡住。

## 验收基线

- `npx tsc --noEmit -p .` 0 错
- `npx vitest run`(⚠️**后台跑**,约128s,foreground 会超时):真失败应为 0;
  失败文件 = 基线 6(scenario-6/7/9/11、create-notes-batch、parse-chrome-bookmarks)
  **+ 偶发** x-bg-job-repo.verify / x-bg-runner.verify(两个真库测试**并发撞端口**,
  单独跑各 10/10、7/7 过——已知测试基建噪音,不是 bug;可顺手治:让真库 verify 串行)。

## 设计出处 / 要读的记忆

- `project-x-ops-platform`(后台策略全设计 + 拍板)
- `project-x-paging-403-root-cause`(403 根治 + authFail 连带账)
- 纯逻辑契约在 `x-bg-job.ts`(BgJob/isDue/mergeSegment/describeProgress)、
  `x-bg-segment.ts`(RunOneResult/runSegment)、`x-bg-runner.ts`(tickOnce)

## ⚠️ 本仓铁律(照做)

- 改 main 要重启 app(forge 只在启动构建);先 `node scripts/x-build-fresh.mjs` 确认跑新构建。
- 日志打主进程侧(renderer console 只在那 webview 的 DevTools);跨进程失败 main 侧也打一行。
- 守卫测试注入违规看变红(zsh `for f in $FILES` 不拆分→用数组;注入完 grep 确认还原)。
- SurrealDB:option 传 undefined;datetime 用 type::datetime();UPSERT type::record()。
- X 可装卸:别让宿主 index.ts 认识 X 内部(撞 x-module-detachable);X 自己 import electron 正当。
- 调试用本机 Mac,Windows 是生产机不能停。
