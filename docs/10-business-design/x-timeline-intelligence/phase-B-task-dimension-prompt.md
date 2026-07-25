# 实施 Prompt · 阶段 B — task_id 数据分类维度 + recipe/task 过滤 + 清 legacy 兜底

> 交给新对话/新窗口执行。范围**仅阶段 B**。背景见同目录 `multi-window-isolation-design.md`（§三.3.3 数据标签、§七 阶段B）。
> 前置：阶段 A（跨 ws 混批止血）已验收通过。
> 验收方式：**离线脚本自验 + tsc 零新增错误**，我（总指挥）按输出验收。

---

## 一、任务目标

给 X 时间线推文加一个**正交分类维度 `task_id`**（「为哪个处理任务爬的」），并让 Review Queue 能**按配方（recipe）和任务（task）切片查看**——解决「不同来源、不同任务的推文堆在一个池子里分不清」的问题。

**重要前提（别困惑 task 从哪来）：**
- `task` 的完整概念（工单/指挥者）是**阶段 C** 才建的（`x_tasks` 表、TaskTicket）。
- 阶段 B **只做占位维度**：`task_id` 字段落库 + 过滤链路打通，**insert 时恒填默认值 `'judge-value'`**（对齐设计文档 D3-A：初期只有一个判断动作）。
- 即：阶段 B 后，所有推文 `task_id='judge-value'`，UI 切片器暂时只有一个任务选项——但**维度和过滤链路已就位**，阶段 C 建工单时直接接上，无需再改 schema/repo/IPC。

---

## 二、改动清单（分层，含精确定位）

### Layer 0 · schema 迁移 1.8.5
文件 `src/storage/surreal/schema.ts`。**严格仿 1.8.4（translation）的 pattern**：
1. 新增 `const SCHEMA_VERSION_1_8_5 = ` 块：
   ```sql
   DEFINE FIELD IF NOT EXISTS task_id ON tweet_inbox TYPE option<string>;
   DEFINE INDEX IF NOT EXISTS idx_task ON tweet_inbox FIELDS task_id;
   ```
   （索引仿现有 `idx_status`/`idx_expires` 的 `DEFINE INDEX IF NOT EXISTS ... ON tweet_inbox FIELDS ...` 写法，约 schema.ts:445-468）
2. 新增 `export async function migration_1_8_5(db)`：跑 SQL + UPSERT `schema_version:1.8.5`（description 如 `'Add task_id dimension to tweet_inbox'`）。
3. **把 migration_1_8_5 注册进迁移执行序列**（找到 1.8.4 在哪被注册/调用的地方，照样加一行——别只定义不注册，那样迁移不会跑）。

> ⚠️ 自己 grep `migration_1_8_4` 全部出现处，确认注册点，别漏。

### Layer 1 · 类型
- `src/shared/types/x-timeline-types.ts`：`TweetInboxRecord`（:61-82）加 `task_id?: string; // 处理任务维度，阶段B恒 'judge-value'，阶段C 起为工单 task`
- 定义一个默认常量便于全局引用，如 `export const DEFAULT_TASK_ID = 'judge-value';`（放该文件，避免魔法字符串散落）

### Layer 2 · repo
文件 `src/platform/main/db/tweet-inbox-repo.ts`：
- **`upsertTweet`（:10-59）**：INSERT 语句加 `task_id: $task_id`，参数 `task_id: record.task_id ?? DEFAULT_TASK_ID`（缺省恒填默认，保证老爬取路径也有值）。
- **`queryInbox`（:120-145）**：opts 加 `searchRecipe?: string; taskId?: string`；conditions 仿现有加：
  ```
  if (opts.searchRecipe) conditions.push('search_recipe = $searchRecipe');
  if (opts.taskId)       conditions.push('task_id = $taskId');
  ```
  绑定参数同步加 `searchRecipe: opts.searchRecipe ?? null, taskId: opts.taskId ?? null`。

### Layer 3 · IPC
- `src/platform/main/x/x-timeline-handlers.ts` X_INBOX_QUERY（:86-102）：payload 解构 + 提取加 `searchRecipe` / `taskId`（`typeof p?.x === 'string' ? p.x : undefined`），透传给 queryInbox。
- `src/shared/ipc/electron-api.d.ts` `xTimeline.queryInbox`（:725）：opts 类型加 `searchRecipe?: string; taskId?: string`。

### Layer 4 · UI 切片器（**只改主面板 XInboxView，见 §三**）
文件 `src/views/x-inbox/XInboxView.tsx`：
- 左侧筛选栏（现有 语言 :678 / 状态 :700 / 配方选择器 :721）**新增一个「任务」切片器**。阶段 B 只有 `judge-value` 一个选项，做成和「配方选择器」一致的 `<select>`（或单项列表），选中值进 query。
- **注意现状**：那个「配方选择器」（`selectedRecipeId` :721）目前**只是选中了 UI 状态，但 loadPage（:483-520）的 queryInbox 调用并没把 recipe 传进去**（自己核实：loadPage 只传了 status/statuses/lang/limit/offset，没传 searchRecipe）。阶段 B 要**把 recipe 和 task 都真正接进 query**：loadPage 的 queryInbox 调用加 `searchRecipe: selectedRecipeId || undefined`（注意「全部」语义怎么表达——若配方选择器无「全部」项需补一个）+ `taskId: selectedTask || undefined`。
- 切片器切换要触发重新 loadPage（进 useCallback 依赖数组，仿现有 currentStatus/currentLang）。

---

## 三、范围边界与一个需你核实后决定的点

### 3.1 UI 只改 XInboxView（主面板）
侦察确认：`x-inbox-protocol/index.ts`（inline HTML）和 `assets/index.html` 这两个面板是 **legacy 死路**——全仓没有任何地方构造 `x-inbox://...?wsId=` URL 去导航，主链路只用 `XInboxView` React 组件（`bus.slot.openRight('x-inbox-view')`）。
→ **UI 切片器只加 XInboxView**，不在死面板上堆功能。

### 3.2 legacy 面板 + `'unknown'` 兜底：先核实，再决定删不删（不要我替你拍）
这两个死面板里有阶段 A 留观的 `'unknown'` wsId 兜底（`index.ts:138`、`assets/index.html:135`）。
**你的任务**（对齐 [[grep-shared-edge-before-delete]]）：
1. 全仓 grep 确认这两个面板**真的**无任何导航入口（搜 `x-inbox://`、协议注册处、`assets/index.html` 被谁引用）。
2. 若确认是死代码 → **在交付说明里报告**「这两个面板可整体删除」，但**本次先不删**（删 legacy 是独立动作，避免和阶段 B 功能改动混在一个 diff 里难验收）。列出来，我单独拍。
3. 若发现**竟然还有活的入口** → 那 `'unknown'` 兜底改成 fail-loud（缺 wsId 时 `console.error` + 面板显式报错，不静默查空池），并在交付里说明入口是谁。

> 即：`'unknown'` 兜底的处置**取决于面板死活**，你先查清楚，别默认删也别默认留。

---

## 四、硬约束（铁律）

- **fail loud，不静默兜底**（[[fail-loud-no-fallback]] / [[project-reliability-charter]]）。
- **改共用点前先 grep**（[[grep-shared-edge-before-delete]]）：`queryInbox`、`upsertTweet`、`TweetInboxRecord`、`migration_1_8_4` 注册点，改前全仓 grep 所有消费者，确认没漏。
- **迁移必须幂等**：`DEFINE FIELD/INDEX IF NOT EXISTS`，重复跑不炸。
- **向后兼容**：老推文没 task_id → 查询/展示不能崩（option 字段 + 默认值兜住）。
- **不扩大范围**：**不建** `x_tasks` 表、**不做**指挥者/工单/调度、**不删** legacy 面板（只报告）。那些是阶段 C。

---

## 五、验收：离线脚本自验（交付必须附）

对齐 [[dont-guess-look-at-real-data]]：**写离线脚本证明维度与过滤生效**。

脚本要求（放 scratchpad 或项目临时目录，验后删；仿阶段 A 用独立 in-memory surreal 不碰真库）：
1. 跑迁移 1.8.5，断言 `task_id` 字段 + `idx_task` 索引已建（查 schema_version 表有 1.8.5 记录）。
2. 造数据：插入推文覆盖 `(search_recipe, task_id)` 组合，例如：
   - recipe=`R1`, task=`judge-value` × 3
   - recipe=`R2`, task=`judge-value` × 2
   - 一条老数据 task_id 缺省 → 断言 upsertTweet 自动填了 `'judge-value'`
3. 断言 queryInbox 过滤：
   - `{ searchRecipe:'R1' }` → 只 3 条且全 R1
   - `{ taskId:'judge-value' }` → 全部
   - `{ searchRecipe:'R2', taskId:'judge-value' }` → 只 2 条
   - `{}`（无过滤）→ 全部（向后兼容）
   - 已有的 wsId/lang/status 过滤仍工作（回归，别破阶段A）
4. 清理测试数据，别污染真库。

**外加**：`tsc --noEmit` 跑一遍，报告**新增类型错误数必须为 0**（阶段 A 基线是 1 个预存的 WebkitAppRegion 无关错误，允许仍是那 1 个，不许新增）。

交付贴脚本**真实运行输出**（真跑出来的断言，不是「应该」）。

---

## 六、交付清单

1. 改动文件 diff（schema 迁移+注册 / 类型 / repo / IPC / electron-api.d.ts / XInboxView）。
2. grep 出的 `queryInbox` / `upsertTweet` / `TweetInboxRecord` / `migration_1_8_4` 注册点全部调用点，逐个说明改没改。
3. 离线脚本 + 真实输出 + tsc 新增错误数（须 0）。
4. §3.2 的核实结论：两个 legacy 面板死活判定 + `'unknown'` 处置建议（删/改 fail-loud），**列给我单独拍，本次别删**。
5. 顺手发现但没改的东西。

---

## 七、完成后
报「阶段 B 完成」+ 交付清单。我会逐个核 diff（不采信自述）、核离线脚本输出、核 tsc、核你对 legacy 面板的判定，通过则进阶段 C（指挥者骨架）。
