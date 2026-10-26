# 交接:Web 能力层 P2「通用对账 + 说明书格式」(2026-10-19)

> 给新对话的开工说明。**先读设计文档**:`docs/10-business-design/web/capability-layer/04-site-manual-self-repair.md`
> (§4 说明书、§9 修改档案、§11 分期 P2、§12 待定)。本篇只补「从哪开始、注意什么」。
> 用户 2026-10-19:「先完成基础的构建,再继续蓝V互关第 4 阶段」—— P2 做完才回蓝V互关。

## 要做的事(一句话)

把 X 的逐页对账从「X 专用代码」变成「通用引擎 + X 的第一份说明书(数据段)」;再加说明书的**修改档案**(设计 §9)。
**X 采集行为一点都不能变** —— 蓝V互关(搜索找人、求关准备采主页、将来查回关采名单)全靠它。

## 现在的 X 对账在哪(要抽的东西)

| 文件 | 管什么 |
|---|---|
| `src/modules/x/x-page-ledger.ts` | `censusPage`(清点 X 列的推文 / 广告 / 墓碑 / 人 / 游标 / 不认识的类型)· `pageProblem`(解析层 / 落库层 / 方向反)· `directionWrong` · `ledgerLine` |
| `src/modules/x/x-collect-run.ts` | 每页:清点 → 逐条核对解出 → `savePage` 存并按 id 回读 → 判方向(只对按时间排的页:`isChronological`)→ 对不上同游标重采一次,还不对停在这页;`ledgerFor` / `pageTimes` |
| `src/modules/x/x-timeline-audit.ts` | 载荷 → `TweetRecord`;**下一页游标怎么挑**(先认明确 bottom,无标记才退回 DAAD 且排除 top —— 10-16 真根因修在这) |
| `src/modules/x/x-pages.ts` | 语义页面表、`X_NOISY_URLS` 噪音表 |
| `src/modules/x/x-search-scroll.ts` · `x-save-page.ts` · `x-person-collect.ts` · `x-bg-runner.ts` | 三条采集路径(搜索滚动截获 / 人卡 / 后台)都走上面这套 |
| `src/platform/main/web-capability/harvest/harvest.ts` | apiSeen 双向核对(浏览器收到 ↔ 采到)—— **已与站点无关,已在底座**,照用 |

说明书「数据」段要能表达的(从上面推出来):接口匹配 · 条目在哪 / id 字段 / 条目种类(推文、人、广告、墓碑、模块里的子项)· 游标在哪、哪个是往下 · 哪些页按时间排(判方向用)· 噪音接口。

## ⚠️ 验收基线要先造(10-19 更正设计 §11)

原定「拿 `x-audit/x-scroll-*.txt` 重跑」**做不到** —— 那些报告只有每页汇总,没存原始载荷。所以:

1. **先存基线**:真机跑几次,把每页原始载荷存成测试样本(搜索 Latest 若干页 · 某人主页帖子若干页 · followers 名单若干页;含广告 / 墓碑 / 推荐的人那种页)。
   入口可以用 dev 收件箱(`x-dev-inbox.ts`,仅未打包时;`searchScroll` / `personTab` 已有)。
   ⚠️ 载荷里有登录态下的内容 —— 样本只放本机测试目录,别进 git(或先问用户)。
2. **新旧并跑**:同一批载荷,旧 `censusPage` 与新引擎的账逐页逐条比,必须一致。
3. **真机再比一轮**:新引擎上线前,一次真采集里两套账同时算、写进报告比对。

> L-raw(设计 §7,原始响应落盘)是 P3 的事;P2 只需要够当基线的那几份样本,别顺手把 L-raw 整个接了。

## 要先问用户的

- 说明书的**格式细节**(设计 §12 #2:路径表达式用哪种)—— 这是实现选择,**按记忆 `feedback-give-effect-not-implementation-choices` 别让用户二选一**:自己定,讲清效果(「AI 改的时候能读懂、能自检」)就行
- 修改档案**多久归档一次**(§12 #3)—— 这个问用户,给效果预览

## 注意

- **先跑诊断工具**:`node scripts/logs.mjs --since 2h`(P1 已做,终端 + 每个网页的 DevTools 日志都在 `krig-data/logs/`)—— 出问题先自己读现场,别先问用户要截图
- 说明书**只有声明、没有可执行代码**(设计 §4.2 铁律 1)—— 这是将来让 AI 自己改它的安全前提,P2 定格式时就要守住
- 改 main 必须重启 app 才生效;每次提交前跑全量测试(已知 6 个环境失败:scenarios ×4、bookmark、create-notes-batch;x-bg-* / x-relation verify 并发偶发,单跑能过)
- 守卫要能真的失败(注入违规看它变红);源码扫描看不见会不会执行 —— 引擎要行为测试
- 10-16 那几刀(游标拿反 / 去重只比前 256 字 / 钩子池没清 / 池子被头像请求挤爆)的测试都在 `tests/modules/x-search-cursor.test.ts`、`x-page-ledger.test.ts`、`tests/web-capability/*` —— 抽引擎后这些必须照样过

## 分支

`feature/web-diagnostics-p1`(P1,含蓝V互关全部提交,比 main 多 21 个,均未推送)。建议从它开 `feature/web-manual-p2`。
