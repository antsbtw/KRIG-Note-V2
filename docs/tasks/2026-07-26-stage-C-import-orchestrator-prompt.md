# 阶段 C — 统一批量落库编排入口（新建 import-orchestrator）

> 指挥交接 prompt。完成后由指挥（另一对话）验收。**风险中。落点已由指挥拍板 = 新建 import-orchestrator capability。**

## 背景（必读设计文档）

- `docs/00-architecture/import-to-note-convergence.md`（**重点第 6 节 + 阶段 C**）

**核心事实（已调研确认）**：`createNotesBatch`（`src/platform/main/note/capability-impl.ts:959`）是所有 batch 导入路径（Markdown/Word/剪藏/PDF）的**唯一落库汇聚点**，落库层不变量（单标题/id/tmpId映射/属性注入/事务/广播）已在 `createSingleNoteFromDrafts` 单点收口。**落库层内部不用动。**

**问题**：`createNotesBatch` 在 **3 处**被各自调用，且各自重复「调 batch + broadcastMode + 进度 overlay + failures 归一」的编排代码：
- `src/views/note/markdown-import.ts:771`（多篇跨 folder，有 splitMode 切分）
- `src/views/note/extraction-import.ts:134`（多篇同 folder，有同名章节去重）
- `src/capabilities/content-extraction/internal/import-pipeline.ts:406`（单篇根级）

## 目标

新建 **import-orchestrator capability**，提供唯一编排函数 `importDraftsToNotes`，把「拿到标准 `CreateNoteBatchItem[]` 之后的统一动作」（调 batch、broadcastMode、进度上报、failures→结果归一）收进一处。三处 view 改调它，删各自重复的编排代码。

## 落点（指挥已拍板）

- **新建** `src/capabilities/import-orchestrator/`（`index.ts` + `types.ts` + `internal/`）。
- **不放进 content-ingest**（那层有铁律「只转换、不落库、不导 PM 形态、不调 noteCap」，见 `content-ingest/types.ts:7-9`）。
- **不放进 note capability**（保持 note 纯 CRUD）。

## 建议接口（可微调，需在实现说明里解释）

```ts
interface ImportOptions {
  broadcastMode?: 'final' | 'progressive-throttle';
  progressTaskId?: string;      // 复用现有 runRendererProgress overlay
  dedupeByTitle?: boolean;      // 覆盖 extraction-import 的同名去重（若决定编排层做）
}
interface ImportResult { noteIds: string[]; failures: BatchFailure[]; warnings: string[]; }
async function importDraftsToNotes(items: CreateNoteBatchItem[], opts?: ImportOptions): Promise<ImportResult>
```

## 边界（什么进编排层、什么留 view）——违反即验收不过

**留在各 view（不要搬进编排层）**：
- splitMode 切分决策（markdown-import 独有）
- 同名 folder/note 去重规则、folder 树建立（markdown-import / extraction-import 的业务）
- folder 归属决策
- 各来源「怎么把源组装成 `CreateNoteBatchItem[]`」的前处理

**进编排层（统一）**：
- 拿到标准 `CreateNoteBatchItem[]` 后：调 `createNotesBatch`、broadcastMode、进度上报、failures→`ImportResult` 归一。

> 判断原则：**「怎么组装 items」是 view 业务，留 view；「items 之后的落库编排」是共性，进编排层。**

## 实施步骤

1. 建 `import-orchestrator` capability，实现 `importDraftsToNotes`（先照搬 markdown-import 现有编排逻辑作基线）。
2. `markdown-import.ts` 改调（splitMode 切分仍在 view，产出 items 后交编排层）→ **回归**：单文件导入、splitMode='all' 切分导入。
3. `extraction-import.ts` 改调（去重仍在 view，传标准 items）→ **回归**：PDF 章节导入、同名章节去重。
4. `import-pipeline.ts` 改调（单篇）→ **回归**：网页剪藏。
5. Word 导入走 markdown-import 链路，随步骤 2 覆盖 → **回归**：docx 导入。
6. （可选，若顺手）把阶段 D 的表格 warnings 通过 `ImportResult.warnings` 暴露到导入结果——但**不强求**，D 的轻版 warn 已够；若做要说明。

## 验收标准（交给指挥核对）

- [ ] `import-orchestrator` capability 存在，`importDraftsToNotes` 是唯一编排入口。
- [ ] 3 处 view（markdown-import / extraction-import / import-pipeline）都改调它，**各自重复的「调 batch + 归一结果」编排代码已删**（`git diff` 应见净删减）。
- [ ] **落库层（capability-impl 的 createNotesBatch/createSingleNoteFromDrafts）未改**。
- [ ] view 专属逻辑（splitMode/去重/folder 树）**仍在 view**，没被搬进编排层。
- [ ] content-ingest 铁律未破（编排层不在 content-ingest 内）。
- [ ] **四条导入路径全回归**：Markdown 文件（含 splitMode 切分）/ Word / 网页剪藏 / PDF 章节（含同名去重）——每条验「内容完整 + folder 正确 + 进度显示 + 失败提示」。给出手验步骤 + 相关自动测试结果。
- [ ] `npx tsc --noEmit` 干净；提交信息规范 + Co-Authored-By；分支从 `feat/multi-window-step2` 拉 `feat/import-orchestrator-c`；**不要 push**。

## 给指挥的验收自检点

- 编排层有没有混进 view 专属逻辑（splitMode/去重/folder 树塞进去就错了）。
- 落库层内部有没有被误改。
- 四条路径的**进度 overlay / broadcastMode / 去重**这些细节有没有在改调后丢失（最容易回归的地方）。
- `git diff` 是否真的净删减了重复编排（而不是加了一层壳、旧代码还在）。
