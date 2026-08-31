# 执行 Prompt · U4-a + U5 · shared 纯 leaf(ArticlePlan) + logo 移位

> 复制给新对话执行。自包含。两个独立小任务，合一批。

---

## 背景

架构治理：`shared/` 应是最底 leaf（不 import 任何上层：drivers/capabilities/shell）；
资产不跨层 import。本任务修两处越界。**只做下面两件，别扩大。**

---

## 任务 A（U4-a）：ArticlePlan 类型从 drivers 下沉到 shared

**问题**：`shared/ipc/x-types.ts:9` 和 `shared/ipc/electron-api.d.ts:37` import
`@drivers/text-editing-driver/serializers/note-to-article-plan` 的 `ArticlePlan`/`ArticleInsertStep`
→ shared 反依赖 drivers（违规）。

**这些是纯数据类型**（`ArticleInsertKind` / `BaseStep` / 8 个 Step 接口 / `ArticleInsertStep` /
`ArticlePlan`，定义在 note-to-article-plan.ts 约 L45–L134），只互相引用，不牵别的上层类型。

**步骤**：
1. **新建** `src/shared/ipc/article-plan-types.ts`，把上述纯类型块（`ArticleInsertKind`、`BaseStep`、
   `HtmlStep`…`MediaStep`、`ArticleInsertStep`、`ArticlePlan`）**移动**过去（原封搬，注释一起带）。
   > 不要搬 `BuildArticlePlanOptions`、`buildArticlePlan()` 等**运行时逻辑/函数**——它们留在 drivers。
   > 只搬纯类型。
2. **原文件** `note-to-article-plan.ts`：删掉已搬走的类型定义，改为从 shared **re-export**：
   `export type { ArticlePlan, ArticleInsertStep, HtmlStep, ... } from '@shared/ipc/article-plan-types';`
   （这样 drivers 内部用这些类型、以及现有 8 个消费方从 drivers 引的，都不断。）
3. **shared 的两处**（x-types.ts:9、electron-api.d.ts:37）：改为从 `./article-plan-types` 引（本层内），
   不再从 @drivers 引。
4. 其余消费方（capabilities/x-extraction、platform/main/x、views/x）**可不动**（它们从 drivers 引，
   drivers 已 re-export），或按需改引 shared——**优先不动，减小改动面**。

**验收 A**：
- `grep -rn "@drivers" src/shared/` → **0**（shared 不再依赖 drivers）。
- ArticlePlan 等类型在 `shared/ipc/article-plan-types.ts`；drivers 原文件 re-export 之。
- tsc 通过；所有原消费方仍能拿到类型（不报缺失）。

---

## 任务 B（U5）：logo 资产移出 shell

**问题**：`src/workspace/workspace-instance/view-switcher-frame/ViewSwitcherFrame.tsx:18`
`import logoUrl from '@shell/assets/logo.jpeg'` → L3(workspace) 抓 L2(shell) 资产。仅此一处引用。

**步骤**：
1. 把 `src/shell/assets/logo.jpeg` **移动**到 workspace 层（如
   `src/workspace/workspace-instance/view-switcher-frame/assets/logo.jpeg` 或 `src/workspace/assets/`）。
2. ViewSwitcherFrame.tsx:18 改 import 为新路径（相对/本层别名），`<img src={logoUrl}>` 逻辑不变。
3. 确认 `src/shell/assets/` 若已空，可留空目录（不强求删）。

**验收 B**：
- `grep -rn "@shell" src/workspace/` → **0**。
- logo 在 workspace 层；ViewSwitcherFrame 引本层 logo；渲染正常（logo 显示）。

---

## 严格边界（不要做）

- ❌ 不碰 `CreateNoteBatchInput/Result`（那是 U4-b，暂缓——会拖 NoteInfo，需另设计）。
- ❌ 不搬 ArticlePlan 的**运行时函数**（buildArticlePlan 等），只搬纯类型。
- ❌ 不改 8 个消费方的业务逻辑，只在必要时调整 import 路径。

## 完成后

回报「U4-a + U5 完成」+ 两个 grep 结果（`@drivers in shared`、`@shell in workspace` 均应为 0）+
tsc 结果 + git diff --stat。
