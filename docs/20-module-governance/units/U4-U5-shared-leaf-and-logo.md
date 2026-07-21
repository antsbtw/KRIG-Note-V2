# U4 (shared 纯 leaf) + U5 (logo 资产) — 独立小切口

> **性质**：不依赖窗口独立性，现在能干净做完。U4-a + U5 合一批；U4-b 暂缓（需设计）。
> **状态**：🔶 prompt 就绪待执行。

## U4 拆分（下沉面排查后，2026-07-21）

**用户拍板**：shared 是最底 leaf，**不得依赖 drivers 也不得依赖 capabilities**。

| 子项 | 违规 | 下沉难度 | 处理 |
|------|------|----------|------|
| **U4-a** | `shared/ipc/x-types.ts:9` import `@drivers/...ArticlePlan` | ✅ 干净——ArticlePlan 只引 ArticleInsertStep(8 个纯数据 Step，同文件)，不牵别的 | **本批做**：下沉 ArticlePlan + 8 Step 到 shared |
| **U4-b** | `shared/ipc/electron-api.d.ts:22` import `@capabilities/note/types` (CreateNoteBatchInput/Result) | ⚠️ 复杂——Result 引 `NoteInfo`（note 核心业务类型，会拖一串进 shared） | **暂缓**：不能简单下沉，需设计「IPC 最小契约」（内联边界真正传的字段，不复用 NoteInfo）——是设计活非机械活 |

**U4-b 暂缓理由**：正解不是「把 CreateNoteBatch 下沉」（污染 shared），而是让 shared 的 IPC 声明用
**结构内联的最小契约**（同 x-types.ts 注释里「内联 BlockRenderFailure 避免跨层 import」手法）。
需判断「IPC 边界真正传什么」，留后续专门设计。

## U5 logo（简单，一处引用）

`ViewSwitcherFrame.tsx:18` `import logoUrl from '@shell/assets/logo.jpeg'`（L3 抓 L2 资产）。
- `logo.jpeg` **仅此一处引用**，`shell/assets/` 里也只有这一个 logo。
- **治法**：logo.jpeg 移到 workspace 层自己的 assets（就近，零跨层），ViewSwitcherFrame 改引本层。

## 验收判据

- U4-a：`grep @drivers src/shared/` = 0（ArticlePlan 不再从 drivers 引）；ArticlePlan+Step 在 shared；
  drivers/x 消费方反过来从 shared 引；tsc。
- U5：`grep @shell src/workspace/` = 0；logo 在 workspace 层；ViewSwitcherFrame 渲染正常。
- U4-b（暂缓，不在本批）：留待 IPC 最小契约设计。
