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

---

## ✅ 第 4 步结果(2026-10-14 ~ 10-16,执行对话)

两个号「半年」全程真机跑完:
- **whyyoutouzhele**:567 页 / 新增 8958 条;帖子 9075 · 回复 748 · 转发 155(半年内),5–9 月每月 1441–1807 条无缺口
- **jam79922967**:116 页 / 新增 2760 条,**失败 0、重载 0**;三页停因都是「已采到 04-17 之前」

真机验收清单 1–7 全过(启动 / Ctrl+C / 采一段存断点 / 重启续采 / 让路 / 暂停恢复 / 到底 done)。

### 接的 UI / IPC
- 人卡范围框「半年/一年/全部」→ `bgCreateJob`(不走 collectTweets);人卡「后台采集」区(在「他的推文」上面)describeProgress + 暂停/恢复/取消,5s 轮询
- 运营顶栏 `BgIndicator`(XBgStatus.tsx):🟢 此刻在采谁·第几页 / 🟡 等待原因+倒计时 / ⚠️ X 网页没开 / 空闲。⚠️ 库里 status=running ≠ 此刻在跑,「此刻」只有 runner 知道(`bgStatus` op)
- 建任务 / 恢复后 3 秒内 `kickBgRunner()`,不干等 120s
- IPC:`syncHost/syncBusy/bgBusy/bgStatus/bgCreateJob/bgListJobs/bgPauseJob/bgResumeJob/bgCancelJob`(暂停/恢复先 readJob —— UPSERT 不存在的 id 会建残行)

### ⚠️⚠️ 真机抓到并修掉的(全是「全绿但活代码不对」)
1. **runner 永远看不见 X 网页**:x-host-registry 每进程一份,登记只在 renderer,runner 在主进程读到恒空 → 静默空转。runner 测试同进程 set,假绿。修:`x-host-sync.ts`(renderer 订阅登记表按 ws/wcId 差异同步给主进程)+ 主进程 webview destroyed 自清;人卡手动动作先问 `bgBusy`
2. **断点在中间两跳丢了**:runSegment 给了 resumeCursor,但 runner 的 runOne 没传、collectPersonTab 不收不转 → 每段从第一页重翻 10 页(30 页游标反而新了 1 小时)。3b 只在 collectOnWebview 一层测了。修 + 行为测试(mock 下一层看游标到没到)
3. **「采到」取了整段最新一条** → 永远显示今天。改为翻页前沿 = 最后一页他自己最新那条(`frontierAt`)
4. **置顶条目每页都回来**:帖子页每次翻页都带回 `TimelinePinEntry`,**连同置顶内嵌引用的推**(置顶 08-27 → 引用 05-13 → 引用 05-12)→「每页最新」永远是它们 → 按时间**永远停不下来**(半年=全部;人卡「一个月」帖子页也从没按时间停过 —— 10-12「61 页撞上限」就是它)。修:解析时标 `TweetRecord.pinned`(整个置顶条目子树,只在内存不落库),newestOwn 排除。⚠️ 第一版只排置顶本身、还写了「置顶引用的不算」,真机证否
5. **翻页种子偶发没鉴权头 = 两条腿赛跑**:「采够 1 页」不管哪条腿交的;钩子腿即时、CDP 要 loadingFinished→getResponseBody→配对,总慢一步;收尾 stopAll 一停,在路上的 CDP 那份就丢 → 只剩钩子那份(没头)。app 跑越久 CDP 越慢(余量 599→16→10ms),输掉就失败,重启恢复。修:`harvest` 收尾前等 `bodyProvider.inFlight(pageId)` 归零(上限 1.5s,CDP 空闲零等待),报告带 `cdpSettle`、留痕 `[web.harvest] 收尾等 CDP …`。**真机证实**:jam 转发页等了 55ms,CDP 种子在等待开始后约 31ms 入池 —— 不等就失败
6. 合并统计 bug:钩子重复两份被错标 both(「both 却 0 头」),腿计数虚高、指错排查方向。修:只有 prev 来自 cdp 才标 both
7. 后台也像人卡一样「第一轮没带头 → 重载重试一次」(用户 10-15 选 A),判据共用 `worthReloadRetry`

### 推翻的旧认知(记忆里要改)
- 10-13「403 根治」的 CDP 补头**对 SW/keepalive 请求不起作用**:CDP 的 body 要先配上 webRequest 记录才入池,而这类请求根本没有 webRequest 记录 → 补头那步轮不到它们
- 「置顶只在首页」是错的

### 没查完 / 待办
- ⚠️ **app 跑久了会卡住**(用户 10-16 报;CPU/内存不高),原因不明
- 每段都有 Cloudflare `cdn-cgi/challenge-platform/.../jsd/oneshot` 请求,成功段也有,目前无害
- 「CDP 连 loadingFinished 都没到,钩子就先交了」这种更早的输法,现在的等待盖不住;真机两个号没观察到,出现时看是否有「收尾等 CDP」那行判断
- 一次 app 启动窗口加载 `localhost:5173` 失败(ERR_FAILED),之后只恢复了一个窗口(ws-1 丢了)—— 与本步无关,偶发
