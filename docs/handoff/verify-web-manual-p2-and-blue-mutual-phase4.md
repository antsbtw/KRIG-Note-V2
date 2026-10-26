# 请独立复核:Web 能力层 P2 + 蓝V互关第 4 阶段及后续(2026-10-22)

> 给验证对话(regression-testing-nj)。分支 `feature/x-blue-mutual-phase4`(含 `feature/web-diagnostics-p1` 全部提交),比 main 多 44 个提交。
> 写代码和写测试的是同一个我 —— 请**独立注入验证**:按下面每条故意改坏代码,看对应测试是否真红;改坏后还绿 = 假保证,请指出。
> 那台机器跑不了 Electron / 点不了界面;真机部分我已在本机跑过(结果写在每条后面),请只核单测、注入、离线可查的部分。

## 已知不相干的失败(请别算进来)
全量 `npx vitest run`:scenarios ×4、bookmark、create-notes-batch 共 6 个环境失败;`x-bg-*.verify` / `x-relation.verify` 并发偶发,单跑能过。

---

## A. P2 说明书引擎(设计 `docs/10-business-design/web/capability-layer/04-site-manual-self-repair.md` §4.4)

| # | 我声称 | 建议注入 | 应该红的测试 |
|---|---|---|---|
| A1 | 新引擎清点与旧 `censusPage` 逐字段一致(手造 + 随机 1 万份) | `src/modules/x/manual/x.manual.json` 删 tweet 规则的 `hidden`;或把 cursor `directions` 的 top/bottom 对调 | `tests/modules/x-manual-parity.test.ts` |
| A2 | 说明书写错加载时当场报出哪一段哪一条 | 改 `check.ts` 让某类问题不报(如去掉 `[*]` 检查) | `tests/web-capability/manual-engine.test.ts` 自检那组 |
| A3 | 引擎零 eval / new Function / Node / Electron;不认识任何站点 | 往 `web-capability/manual/order.ts` 加 `eval('1')` 或字符串 `'HomeTimeline'` | `manual-engine.test.ts`、`capability-site-agnostic.test.ts` |
| A4 | 修改档案:改说明书不记档 / 手改对比 / 版本跳号 → 红 | 改 `x.manual.json` 任意一处不升版本 | `tests/modules/x-manual-archive.test.ts` |
| A5 | `ledgerFor` 记「说明书 down 游标 vs 翻页实际所用」,只记不判 | 让 `manualDiff` 不写 / 写了却触发重采 | `x-manual-parity.test.ts`「并跑接线」 |

## B. 名单翻页(10-19 根因)

| B1 | `TimelineTerminateTimeline` 只认 `direction: Bottom` 才算到头(我的 followers 第一页带 Top 就判到头的 bug) | `x-user-audit.ts` 改回「见 terminate 就到头」 | `x-user-audit.test.ts` 三条 + `x-collect-run.test.ts`「每页都带 Top…」 |

## C. 查回关 / 时间线(设计 `docs/10-business-design/x/blue-mutual-follow-design.md` §10)

| C1 | 连续 N 个老关注者才算追上;追上后不再计数 | `x-follow-back.ts` 让 caughtUp 永不成立 / 追上后照样计数 | `x-follow-back.test.ts` |
| C2 | 满 N 天但没有「追上了」的查回关在求关之后 → 只能「未确认」 | `classifyAsks` 去掉 confirmed 判断 | 同上 |
| C3 | 每天自动:先查回关、再我自己的关系采集,一轮一件;人暂停的不重开 | `relationDailyDue` 去掉 paused | `x-daily-upkeep.test.ts` |
| C4 | `mainBusy`:renderer 跳转 / 取关前问得到主进程的忙 | `x-unfollow-run.ts` `xPageBusy` 去掉 mainBusy | `x-bg-ui.test.ts` |
| C5 | 取关核心只有一份(人卡 + 任务页共用) | `unfollowOnce` 去掉让路检查 | `x-unfollow.test.ts`、`x-bg-ui.test.ts` |

## D. 关系采集 + 节奏自调(§12)

| D1 | 策略:库空采全 / 差一截增量 / 库多出一截全量 / X 0 人跳过 | 改 `planTab` 阈值 | `x-relation-task.test.ts` |
| D2 | 增量追上后复核仍差 → 自动改全量、断点清空 | `escalateAfterCatchUp` 恒 undefined;或 runSegment 不清断点 | `x-relation-task.test.ts`、`x-bg-lists.test.ts` |
| D3 | 全量对账只在「到底 + ≥98%」时标走了的;够数用库里真实人数 | `canReconcile` 放宽到 90% | `x-relation-task.test.ts` |
| D4 | 撞限流不判失败、保住断点;失败停因总带 HTTP 状态码 | `x-person-list-collect.ts` 把 limited 算 failure | `x-bg-lists.test.ts`「撞限流」 |
| D5 | 节奏:限流翻倍 / 减半,3 段顺利且一小时没撞才加快,最慢还撞才举手 | 改 `adjustPace` | `x-relation-task.test.ts` 节奏组 |
| D6 | 名单任务「第一轮没带鉴权头 → 重载再试一次」 | runner 名单分支去掉重试 | `x-bg-lists-retry.test.ts` |
| D7 | 自己的号写关系(listSource=名单名)、别人的记 x_list_member(listSource 固定 person-list);号对不上就停 | 把 person-list 改成 followers | `x-bg-lists.test.ts` |
| D8 | 真库:策略 / 统计 JSON 往返、节奏落库、名单任务与推文任务去重分开 | (真 SurrealDB)| `x-bg-job-repo.verify.test.ts` |
| D9 | ⚠️ SurrealDB 参数名 `$self` 被静默吞掉(已改名 `$target_self`) | 改回 `$self` | `x-bg-job-repo.verify.test.ts` 关系采集那条 |

## E. 求关卡(§13,用户 10-21 验收通过)

| E1 | Gemma 草拟走原生 /api/chat、`think: false`、Gemma 4 12B | `x-ask-draft.ts` 改 think: true | `x-ask-draft-call.test.ts` |
| E2 | 草稿校验(空 / 超长 / @ / 链接 / 话题 / 非中文)不填;一字没改记 ai、改过记 human | 放宽 `cleanAskDraft` / `replySourceOf` | `x-ask-draft.test.ts` |
| E3 | 准备时按 X 现状核对:第一次求关已关注 → 不求关;再互动他已回关 → 停 | 去掉 `stopWhy` 判断 | `x-ask-prepare-live.test.ts` |
| E4 | 「人 + 我的关系」视图排除当前号(自己曾是求关候选 / 关系不明) | `PEOPLE_WITH_RELATION` 去掉 `rest_id != $acct` | `x-relation.verify.test.ts`(真库) |
| E5 | 跳过此人 = 人排除带原因,取消排除清原因 | `SET_EXCLUDED_SQL` 不写原因 | `x-relation.verify.test.ts` |
| E6 | 任务页点候选读到已关注就从候选里拿掉 | (源码守卫)| `x-task-view.test.ts` |

## 真机已跑过的(本机,供参考,无法在那边复现)
- 我的 followers:修 Top-terminate 后 4 页 199 人正常翻;查回关 8 页 397 人 6 秒追上
- 关系采集:关注者全量 140 页,找回 229 个从没记过的关注者,对账标走 174 人,库 6867 / X 6904;节奏自动加快两次、撞限流放慢一次、冷却后再加快
- Gemma 草拟 6 条全过,每条约 5 秒

## 请回给我
「属实的 / 假绿的(改坏仍绿)/ 另有问题」三类,照之前的口径就好。
