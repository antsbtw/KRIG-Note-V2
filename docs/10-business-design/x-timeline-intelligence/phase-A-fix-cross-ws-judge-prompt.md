# 实施 Prompt · 阶段 A — 修复 AI 判断跨 ws 混批（B1）

> 交给新对话/新窗口执行。范围**仅阶段 A**（止血），独立可上、零架构风险。
> 完整背景见同目录 `multi-window-isolation-design.md`（§二.B1、§七 阶段A）。
> 验收方式：**离线脚本自验**（见文末），我（总指挥）按脚本输出验收。

---

## 一、任务目标（一句话）

X 时间线的 AI 判断（Gemma）目前会把**不同 workspace（ws）的 pending 推文混在同一批**里判断。
本任务让 AI 判断**按 ws 隔离**：每个 ws 只判自己的 pending 推文，批量累计计数器也 per-ws。
**数据不会串**（写回靠 tweet_id 各归各），但判断上下文被污染 —— 这是正确性 bug，本任务修它。

---

## 二、根因（已定位，三处调用点，别漏）

### 2.1 破口本体
`src/platform/main/db/tweet-inbox-repo.ts` 的 `queryPending`（约 :87）：
```sql
SELECT * FROM tweet_inbox WHERE status = 'pending' ORDER BY fetched_at ASC LIMIT $limit
```
**无 ws 过滤** → 拉全部 ws 的 pending。

### 2.2 全局计数器
`src/platform/main/x/x-search-scheduler.ts`：
- `let pendingAccumulated = 0`（约 :33）是**全局单变量**，ws-A 爬 5 条 + ws-B 爬 6 条 → 累计 11 触发一次批判断，混判两个 ws。
- 触发点在 `runEnabledRecipes` 内（约 :71-93），含「满 batchSize」和「maxWaitMinutes 超时」两处触发。

### 2.3 `runJudgeBatch` 的三个调用点（全部不带 wsId，全部要改）
1. `x-search-scheduler.ts:74` — 满 batchSize 触发
2. `x-search-scheduler.ts:90` — 超时触发
3. `x-timeline-handlers.ts:50` — `X_RUN_RECIPE` 手动跑配方后触发
4. `x-timeline-handlers.ts:72` — `X_AI_JUDGE_BATCH` 手动批判断

`runJudgeBatch` 定义在 `x-ai-judge.ts`（约 :149），内部 `queryPending(config.batchSize)`。

> ⚠️ 只改调度器会漏掉手动触发那两条（handlers 里 :50 / :72）。四处都要覆盖。

---

## 三、要达成的行为（给你自由度，不锁实现细节）

1. **`queryPending` 支持按 wsId 过滤**：传 wsId 时 `AND ws_id = $wsId`；不传时保持原全局行为（向后兼容，别破坏无参调用）。
2. **`runJudgeBatch` 支持按 ws 判断**：能只判某个 ws 的 pending。签名怎么加你定（加可选 wsId 参数 / 或拆一个 per-ws 版都行），但**四个调用点的语义必须变成「判触发它的那个 ws」**：
   - 调度器满/超时触发 → 判「当前遍历到的那个 wsId」（`activeXWcMap` 遍历里本来就有 wsId）
   - `X_RUN_RECIPE` 后触发 → 判 `p.wsId`（handler 里已有）
   - `X_AI_JUDGE_BATCH` → 这个通道当前无 wsId 入参；**你决定**：给它加 wsId 入参（推荐，面板本来就知道自己 ws），或让它遍历所有活跃 ws 各判各的。别让它退回全局混判。
3. **计数器 per-ws**：`pendingAccumulated` 从单变量改成 `Map<wsId, number>`，各 ws 各自累计、各自达阈值触发、各自清零。超时触发同理逐 ws 处理。
4. **`markAiJudging` / `updateVerdict` 不用动**（它们按 tweet_id 操作，天然不串）。

---

## 四、硬约束（铁律，必须遵守）

- **fail loud，不静默兜底**（[[fail-loud-no-fallback]]）：查不到 ws、wsId 缺失等异常要 `console.error` 留痕，不要静默吞或塞默认值假装成功。对齐 [[project-reliability-charter]]（故障留痕/可对账）。
- **改共用点前先 grep**（[[grep-shared-edge-before-delete]]）：`queryPending`、`runJudgeBatch`、`pendingAccumulated` 改签名/语义前，全仓 grep 所有调用点，确认没漏（本文档 §二列的四处是我核过的，但你要自己 grep 复核，可能有我没覆盖的测试/脚本）。
- **向后兼容**：`queryPending` 无参调用必须仍能工作（有别处依赖它的全局语义就别破）。
- **不扩大范围**：本任务**不新增** `task_id` 字段、**不建** `x_tasks` 表、**不碰**配方全局问题、**不做**指挥者/调度架构——那些是阶段 B/C，别提前动。若你发现顺手能带的小清理，先在交付说明里列出来问，别自作主张改。

---

## 五、验收：离线脚本自验（交付必须附）

对齐总指挥一贯做法（[[dont-guess-look-at-real-data]]）：**写一个离线脚本证明隔离生效，别靠读代码脑补**。

脚本要求（放 `scratchpad` 或项目临时目录，验收后删）：
1. 连本地 SurrealDB（复用项目现有 DB 连接方式，参考 `src/storage/surreal/client.ts` 或现有离线脚本的连法）。
2. 造数据：往 `tweet_inbox` 插入两个 ws 的 pending 推文，例如 ws=`test-ws-A` 3 条、ws=`test-ws-B` 4 条（tweet_id 用可辨识前缀便于断言，fetched_at 交错以验证排序不串）。
3. 断言：
   - `queryPending(50, 'test-ws-A')` → **只返回 3 条且全部 ws_id=test-ws-A**
   - `queryPending(50, 'test-ws-B')` → **只返回 4 条且全部 ws_id=test-ws-B**
   - `queryPending(50)`（无参）→ 返回全部 7 条（向后兼容未破）
4. （计数器隔离）用单测或小脚本验证：模拟 ws-A saved=3、ws-B saved=4，batchSize=5 时，**A 不触发、B 不触发**（各自 <5）；再给 A saved+3（累计 6）→ **只触发 A 的判断**，且触发时传入的 wsId=test-ws-A。计数器逻辑若难脱离 Electron 主进程，可把 per-ws 累计逻辑抽成纯函数再单测。
5. 跑完**清理测试数据**（删 test-ws-* 的插入），别污染真库。

交付时贴出脚本**实际运行输出**（不是「应该会」，是真跑出来的断言结果）。

---

## 六、交付清单

1. 改动的文件 diff（`queryPending` / `runJudgeBatch` / 调度器计数器 / 四个调用点 / 可能的 IPC 入参）。
2. 你 grep 出的 `queryPending`/`runJudgeBatch`/`pendingAccumulated` **全部调用点**列表，逐个说明改没改、为什么。
3. 离线验证脚本 + 其真实运行输出。
4. `X_AI_JUDGE_BATCH` 你选了哪种处理（加 wsId 入参 / 遍历所有 ws）及理由。
5. 顺手发现但**没改**的东西（留给我判断要不要进阶段 B/C）。

---

## 七、完成后

告诉我「阶段 A 完成」+ 贴交付清单。我会：
- 核 diff（逐个调用点，不采信自述 —— 对齐 [[grep-shared-edge-before-delete]] 验收习惯）
- 核离线脚本输出是否真证明了隔离
- 通过则合，进阶段 B（数据分类维度）
