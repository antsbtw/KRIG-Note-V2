# U4 (shared 纯 leaf) + U5 (logo 资产) — 独立小切口

> **性质**：不依赖窗口独立性，现在能干净做完。U4-a + U5 合一批；U4-b 暂缓（需设计）。
> **状态**：🔶 prompt 就绪待执行。

## U4 拆分（下沉面排查后，2026-07-21）

**用户拍板**：shared 是最底 leaf，**不得依赖 drivers 也不得依赖 capabilities**。

| 子项 | 违规 | 下沉难度 | 处理 |
|------|------|----------|------|
| **U4-a** | `shared/ipc/x-types.ts:9` import `@drivers/...ArticlePlan` | ✅ 干净——ArticlePlan 只引 ArticleInsertStep(8 个纯数据 Step，同文件)，不牵别的 | **本批做**：下沉 ArticlePlan + 8 Step 到 shared |
| **U4-b** | `shared/ipc/electron-api.d.ts:22` import `@capabilities/note/types` (CreateNoteBatch*) | ✅ **实为干净下沉**（2026-07-22 排查推翻昨天判断） | 见下 |

**U4-b 昨判暂缓 → 今排查推翻**：昨天以为「Result 引 NoteInfo，下沉拖一串进 shared」。**排查发现
NoteInfo 早已在 `shared/ipc/note-folder-types.ts`**！CreateNoteBatch* 的依赖全部已在 shared 可达：
- `NoteInfo` → 已在 shared ✅
- `PmAtomDraft`（CreateNoteBatchItem.atoms）→ `@semantic/types`
- 无一引 capabilities 内部。→ **和 ArticlePlan 同法干净下沉，不需要「IPC 最小契约」设计。**

**★边界决策（用户拍板 2026-07-22）：shared 可依赖 semantic。**
- 理由：semantic 是**纯类型 leaf（无运行时）**，与「不得引 drivers（逻辑层）」不矛盾；纵向架构
  semantic 是底层，被 shared 依赖天经地义；**semantic 零引 shared → 单向无循环**（已验证）；
  CreateNoteBatch 本质在传 semantic atom，该类型本就属 shared IPC 契约层。
- 对照：drivers（有运行时）shared 不得引；semantic（纯类型 leaf）shared 可引。**性质不同，区别对待。**

**U4-b 治法**：CreateNoteBatchInput/Result/Item/Failure 从 `capabilities/note/types.ts` 下沉到 shared
（如 `shared/ipc/note-batch-types.ts`）；shared 引 `@semantic/PmAtomDraft`（合法）+ 本层 NoteInfo；
capabilities/note/types.ts re-export 保 4 消费方（import-pipeline/markdown-import/extraction-import/
platform-handlers）不断；electron-api.d.ts:22 改引本层。**判据**：`grep @capabilities src/shared/` = 0。

## U5 logo（简单，一处引用）

`ViewSwitcherFrame.tsx:18` `import logoUrl from '@shell/assets/logo.jpeg'`（L3 抓 L2 资产）。
- `logo.jpeg` **仅此一处引用**，`shell/assets/` 里也只有这一个 logo。
- **治法**：logo.jpeg 移到 workspace 层自己的 assets（就近，零跨层），ViewSwitcherFrame 改引本层。

## 验收判据

- U4-a：`grep @drivers src/shared/` = 0（ArticlePlan 不再从 drivers 引）；ArticlePlan+Step 在 shared；
  drivers/x 消费方反过来从 shared 引；tsc。
- U5：`grep @shell src/workspace/` = 0；logo 在 workspace 层；ViewSwitcherFrame 渲染正常。
- U4-b（暂缓，不在本批）：留待 IPC 最小契约设计。
