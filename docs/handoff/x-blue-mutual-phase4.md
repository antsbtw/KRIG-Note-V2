# 交接:蓝V互关 · 求关第 4 阶段「定期查回关 + 人的互动时间线」(2026-10-19)

> ✅ **已实施(10-19,分支 `feature/x-blue-mutual-phase4`,未推送)** —— 实施记录见设计文档 §10;下面是开工时的原文。

> 给新对话的开工说明。先读:
> - 记忆 `project-x-blue-mutual-module`(全过程,末尾是 10-17 求关三阶段)、`project-x-ask-reply-corpus`
> - 设计文档 `docs/10-business-design/x/blue-mutual-follow-design.md`
> - 诊断:`node scripts/logs.mjs --since 2h`(P1);说明书 / 对账:`node scripts/manual.mjs`(P2)

## 用户要的(10-17 原话)

> 「这些动作完毕后,要记录关注时间,定期检查对方是否回关,建立和对方互动的时间线。确保未来能够定期互动,最终把对方发展为我们的客户。」

已有:每次求关一行 `x_ask`(哪条推文 / 我留了什么 / 赞·留言·关注各自结果)、`x_action_log`(每个动作)、`x_relation` + `x_relation_change`(关系现状 + 变化史,按号)。
第 4 阶段 = 两件事:
1. **定期查回关**:求关过的人,隔一段时间看他回关没有,结果写进关系(变化表自动留一条「他关注了我」)
2. **人的互动时间线**:一个人一条线 —— 我求关(赞 / 留言 / 关注)→ 他回关 → 之后双方的回复 / 提及 / 点赞 …,在人卡或任务页能看到

## ⏰ 时间点

10-17 求关了十几个人(`SELECT * FROM x_ask`),回访默认 7 天(设置 `follow.revisit_days`)→ **10-24 是第一批的回访日**。到那天要能查回关。

## 第一步:先确认「我的 followers 名单采得全不全」

查回关最省的办法是增量采**我自己**的 followers(已有快速增量,记忆 `project-x-fast-incremental`)。
P2 报告提到「followers / following 第一页 70 人时 X 就发了名单结束信号」—— **但 10-19 我核对过,那份样本是别人的号**
(userId 1260553941714186241,不是 @antsBTW 1869246155197931520;followers / following 各约 71 人,可能就是他的真实规模)。
所以**并没有证据说明我的名单采不全**,但我自己的号这次也没测过。先用 dev 收件箱(`userList` 指令,P2 新增,带 `sample` 存载荷)采一次 @antsBTW 的 followers 几页,看:
- 能不能正常翻页(记忆 `project-x-followers-web-ui-cap`:以前跑通过 5050 人;`project-x-user-list-coverage`:Followers 约 50 次 / 15 分钟)
- 求关过的那些人在不在名单里

**按结果定方法**(效果层,用户不用选实现):
| 名单 | 查回关怎么做 |
|---|---|
| 采得全 | 定期增量采我的 followers 第一页起(新关注我的人在最前),碰到已知的就停 |
| 采不全 | 对求关过的人逐个去他主页看「关注了你」标记(几十人,量小;按节奏,异常即停) |

## 现有代码

| 文件 | 管什么 |
|---|---|
| `src/modules/x/x-task-blue-mutual.ts` `readFollowProgress` | 现在的「已回关 / 回访名单」—— **只读关系表**,没人去更新 follows_me,所以「已回关」恒 0 |
| `src/modules/x/XTaskFollow.tsx` | 第 2 件事的界面(进度行 / 候选 / 求关卡 / 回访列表) |
| `src/modules/x/x-ask-run.ts` · `x-ask-prepare.ts` · `XTaskAsk.tsx` | 求关三动作(已真机通过) |
| `src/modules/x/x-user-repo.ts` `writeRelations` | 写关系(按号;变了才追加变化表) |
| `src/modules/x/x-bg-runner.ts` | 后台采集调度(定期跑的现成底座) |
| `src/modules/x/x-ops-settings.ts` | 设置:`follow.revisit_days` 等 |

## 要先问用户的(给效果预览,别让用户选实现)

- 多久查一次回关(每天一次?打开任务页时?)
- 回访满 N 天还没回关之后做什么:只列出来 / 再互动一次 / 取关(取关已有,在「运营 → 人」)
- 时间线放哪看、显示哪些事件

## 注意

- 写方向保护(记忆 `project-x-write-redline-cancelled`):节奏 / 异常即停 / 留痕 / 执行后核对
- 「我是谁」只认 `accountForWrite`(按 ws 认号),关系按号存
- 改 main 必须重启 app;每次提交前跑全量测试(已知 6 个环境失败;x-bg-* / x-relation verify 并发偶发,单跑能过)
- X 采集已由 P2 通用引擎照 `src/modules/x/manual/x.manual.json` 清点 —— 改解析走说明书 + `manual.mjs` 记档,别改回代码

## 分支

当前 `feature/web-manual-p2`(含蓝V互关 + P1 + P2,比 main 多 23 个提交,均未推送)。建议从它开 `feature/x-blue-mutual-phase4`。
