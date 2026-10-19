# 交接:Web 能力层 P1「日常诊断底座」(2026-10-19)

> 给新对话的开工说明。**先读设计文档**:`docs/10-business-design/web/capability-layer/04-site-manual-self-repair.md`
> (§5 日常诊断能力、§11 分期 P1、§13 已知现状)。本篇只补「从哪开始、注意什么」。

## 要做的事(一句话)

让 AI **自己读得到现场**:终端日志(主进程 console)和每个网页的 DevTools 日志都落盘,并提供按时间窗 / 页面 / 关键字读取的工具。
用户 2026-10-19 原话:「AI必须有能力执行日常的诊断方式-- terminal log/devtools log」。

## 验收判据(设计 §11 P1)

1. X 出一次问题时,**AI 不问用户要截图和日志**,自己从文件读出现场
2. 注入一条网页报错 → 能在文件里找到,且带 pageId / URL
3. 守卫要验证能真的失败(注入违规看它变红)

## 现状(10-19 查过)

| 项 | 现状 |
|---|---|
| 主进程日志 | 只打到启动 app 的终端;`src/platform/main/index.ts` 只处理了 stdout EPIPE,不落盘 |
| 网页 console | 只有剪藏 `src/platform/main/extraction/extraction-handler.ts` 监听 `console-message`(只认 `KRIG_IMPORT:` 前缀) |
| 可照抄的落盘做法 | `src/platform/main/web-capability/wiring/fs-trace-sink.ts`(按天分片 JSONL,与 `fs-raw-sink.ts` 同口径) |
| 已有的诊断数据 | `krig-data/web-trace/lifecycle/*.jsonl`(能力层留痕)、`krig-data/health/*.jsonl` + `scripts/health-report.mjs`(运行黑匣子) |
| 数据目录 | `~/Library/Application Support/KRIG Note V2/krig-data/` |

## 要先问用户的(设计 §12 #1)

- 日志保留多久、占多大 —— 我的提议:默认 30 天、可改,与 L-raw / trace 同口径。**问效果,别让用户在实现方案里二选一。**

## 注意(本仓的坑,动手前看记忆)

- 每个受管网页都要挂上 → 新的 did-attach 能力必须进 `setPerWindowWebviewHooks`(记忆 `project-per-window-webview-hooks`)
- 改 main 必须重启 app 才生效(记忆 `project-running-code-vs-source`)
- 常驻 timer / 写流要在 before-quit 停(记忆 `project-graceful-shutdown`)
- 不要静默兜底;落盘失败要响(记忆 `feedback-fail-loud-no-fallback`)
- 日志里可能有登录态信息:**只落本机、不外发**;别去读 X 的 cookie / 凭据(曾被权限拦)
- 每次提交前跑全量测试(已知 6 个环境失败:scenarios ×4、bookmark、create-notes-batch;x-bg-* / x-relation verify 并发时偶发,单跑能过)

## 分支

当前在 `feature/x-blue-mutual-m1m2`(蓝V互关,未合 main、未推送;设计文档也在这条分支上)。
P1 与蓝V互关代码无关 —— 建议从这条分支开新分支 `feature/web-diagnostics-p1`,开工前问用户一句是否要先合 main。

## 进度(2026-10-19 实施)

- ✅ 写入端 `src/platform/main/diagnostics/logs/`:`log-file.ts`(按天分片、fd 常开 writeSync、写失败翻转时才响并报丢了几条)·
  `main-console-tap.ts`(终端输出不变 + 落盘)· `page-console-tap.ts`(每个 wc;每分钟 600 条限流,丢弃数留痕)· `diagnostic-logs.ts`(起停、30 天老化)
- ✅ 接线 `index.ts`:拿到单实例锁立刻起(早于 whenReady);before-quit 最终分支只停 timer / 监听,console 接管留到进程退出
- ✅ 读取 `node scripts/logs.mjs`(`--since/--around/--from` · `--src` · `--level` · `--page/--wc/--url` · `--grep` · `--kind` · `--trace` · `--pages` · `--runs` · `--json`)
- ✅ 测试 `tests/platform/main/diagnostic-logs.test.ts` 18 条;15 处注入违规全部变红
- ✅ 本机真 app:CDP 往 X webview 注入未捕获异常 → `logs.mjs --grep` 读出,带 wc#3 / x.com/home;退出过程的日志逐行与终端一致
- ⚠️ 真 app 上这条报错**没带 pageId**:X 页面在能力层第一次操作它(采集 / web.dom)时才登记。没改登记时机(那是能力层语义);同一 wc# 前后两段能串起来
- 待办:X 后台采集实跑一天后报实际占用;验收①「X 出一次问题时 AI 自己读现场」等下次真出问题时兑现
