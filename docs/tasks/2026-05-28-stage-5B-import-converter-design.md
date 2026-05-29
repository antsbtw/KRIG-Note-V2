# 阶段 5B：markdown / web → atom 公共转换器设计

> 输入文档：`docs/tasks/2026-05-28-stage-5B-import-converter-design-prompt.md` · `docs/tasks/2026-05-28-stage-5A-decision-026-amendment-summary.md` · `docs/tasks/2026-05-28-import-system-survey.md` · `docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md` · 决议 026 修订版 · 关键源码（md-to-pm / atoms-to-pm / sanitize-atoms / markdown-import / extraction-import / extraction handlers / dissect-pm-doc / assemble-pm-doc / capability-impl）
> 产出：12 题答案（8 题 + 4Q）+ 架构图 + 路线图 + 新 open question + 与 5C 的接口
> 纪律：本期不写代码、不改决议、不动 src/、不连 DB；架构师产出仅设计文档

---

## 节 0：本期设计的边界

- 本设计**不实施代码**；产出是**设计文档**。代码实施留下游 sub-phase（`refactor/import-system-rebuild` 分支）。
- 本设计**回答 12 个具体问题**：节 1 八题（§7.1.1 / §7.1.2 / §7.1.3 / §7.3.1 / §7.3.2 / §7.5.1 / §7.5.2 / §7.5.3）+ 节 2 四 Q（Q1-Q4）。
- 本设计**必须与生产契约 PDF-Note-Atom-v2 兼容**（契约已在生产中运行 — 调研报告 §3.4 字面拍板）；契约不足处通过"建议扩展"明确登记，不允许悄悄绕过。
- 本设计**必须与 5A 拍板字面一致**：table 是 atom / `tableCell.attrs.rowIndex + colIndex` / 5 项 STRUCTURAL `{tableRow, bulletList, orderedList, taskList, columnList}` / 三处同步契约 / 决议层是契约源头。
- 本设计**严守"不引入 PM doc 作存储输入"反模式**（调研报告 §6.1 / §6.2 字面登记的 12 条反模式之首）。设计层选择必须能解释为什么不再走这条死路。

---

## 节 1：8 个必答题逐题答案

### §7.1.1 公共转换器输入格式：markdown 字符串 / PM 树 / 独立 AST？

**答案：多输入多目标 — 每个源走自己最自然的输入格式，统一收敛到目标格式"V2-Atom 中间表征"（基于 PDF-Note-Atom-v2 契约扩展）；不要求所有入口共享同一个输入格式。**

字面理由：

1. **markdown 字符串作输入**：md / word-mammoth / word-pandoc 三入口的源天然是 markdown（调研报告 §2.1 / §2.2 / §2.3）。强行换 AST = 自找事。代价：V2 callout / column / mathVisual / externalRef / fileBlock / video / audio / html / tweet 等节点字面**无 markdown 表达**——这部分必须靠"源到 Atom 直转"路径覆盖，不能强迫塞回 markdown。
2. **PM 树作输入禁用**：现状的"markdown → PM → dissect → atom"和"atoms → PM → createNote → dissect → atom"已被调研报告 §5 / §6.1 / §6.2 字面证明是**反模式根因**（md-to-pm 各 case 多数不带 attrs → dissect 静默 skip → block 丢失；atoms-to-pm 历史 bug 同根）。本设计**字面禁止**把 PM 树作为转换器的"目标"，转换器只生产 Atom 集合。PM 树是"view 渲染端从 Atom 拼装出来的派生表征"（详 §7.1.2）。
3. **独立 AST**：md-to-pm 当前是手写行级 parser，重写为独立 AST（remark / mdast 之类）反而引入新依赖 + 新 bug 面，不偿失。
4. **多输入合理**：
   - markdown 源（md / word-mammoth / word-pandoc）→ **`markdownToAtoms()`**（新转换器，本期设计 §7.1.3 / 节 3 详）
   - web 后台 KRIG_IMPORT JSON 源 → **`krigPlatformBatchToAtoms()`**（已基本对齐契约，本期统一签名）
   - PM doc 源（用户编辑 / paste / ebook 标注）→ 走 `dissectPmDoc`（**不在本转换器范围**，这是"用户编辑导致的 Atom 增量"，非"导入"）

**核心字面规则**：输入可以是 markdown 字符串 / KRIG_IMPORT JSON / 未来扩展的源；**输出必须是 V2-Atom 集合**（带 from / meta / 完整 attrs.id 占位）。不允许任何转换器在出口产出"裸 PM 树"。

依据：
- 调研报告 §2.1-§2.6 入口现状
- 调研报告 §6.1 反模式登记
- 5A 汇总 §6.2 "共享 inject 层规则集合"

---

### §7.1.2 atom 是否应与 PM doc 完全脱钩？

**答案：脱钩。Atom 是存储层规范一等公民；PM doc 是 view 端从 atom 拼装出来的派生表征。**

字面理由：

1. 决议 026 §3.4 / §6.3 字面拍板：容器型 block 的 `payload.content = []`；嵌套通过 `childOf` 边表达。这本身就是**脱钩规则**——PM doc 形态不能写回 atom payload。
2. 调研报告 §6.1 / §6.6 字面指出"PM 作中间表征"是当下所有 import bug 根因（attrs 缺失 → dissect 静默 skip）。脱钩后 import 路径不再要求 atom 集合"是合法 PM 树"，对齐"图模型存储 + 树模型渲染"哲学。
3. 决议 026 §6.5 graph-instance 已示范同模式：graph instance atom 不持有 graph-canvas 的"PM 渲染形态"，由 view 端按需要拼装。**block atom 应该字面对齐此模式**。
4. 现状是**伪脱钩**：atom payload 形态字面是 PmPayload（决议 §3.4），dissect/assemble 双向工作；但 import 路径错误地把 PM 树当成"通用导入中间格式"——是**入口违反脱钩契约**，不是契约本身错。
5. 脱钩后的代价：view 端 atom → PM 拼装变厚（多了 table 行/列重建 + list 容器重建 + callout/column 边重建）；但这是**已经在做的事**（assemble-pm-doc.ts 的 wrapChildren / wrapTableCells），变厚不变质。

**核心字面规则**：
- 存储层规范单位 = **Atom + Edge 图**
- 视图层规范单位 = **PM doc 树**
- import 路径只产 Atom，不产 PM doc
- view 端 `assemblePmDoc` 是唯一"图 → 树"翻译点

依据：
- 决议 026 §3.4 / §6.3 / §6.5
- 调研报告 §6.1 / §6.6 反模式 #1 #6

---

### §7.1.3 "markdown → atom 集合" 是否独立 capability？

**答案：独立 capability — 新建 `content-ingest` capability。**

字面理由：

1. 现状（调研报告 §2.1 / §2.2 / §2.3 / §2.6 / §2.8）：
   - markdown / word-mammoth / word-pandoc 三入口共用 view 端 `importMarkdownBatch`（→ `markdownToProseMirror` → 装 PM doc → `createNote`）
   - extraction（KRIG_IMPORT）→ `importExtractionBatch`（→ `atomsToProseMirror` → 装 PM doc → `createNote`）
   - paste → 直接 `JSON.parse(JSON.stringify(src.doc))` → `createNote`
   - ebook 标注 → 手工拼 PM block → `updateNote`
2. **共用 importMarkdownBatch 是局部成功的方向**，但它停留在"view 端编排层"，转换器 `markdownToProseMirror` 在 `capabilities/text-editing` 内部 — **转换器和入口编排耦合**。
3. 新 capability **`content-ingest`** 字面承担：
   - 输入：各源原生格式（markdown 字符串 / KRIG_IMPORT batch / 未来扩展）
   - 输出：归一化的"V2-Atom 集合 + folder 编排提示"
   - **不调 noteCap().createNote**（这是上层编排的事）
4. 现有 `capabilities/text-editing` **保留**（驱动 PM editor / 提供 `createEmptyDoc`），但**移除其 "import 转换器" 职责**——`md-to-pm.ts` / `atoms-to-pm.ts` / `sanitize-atoms.ts` 字面**迁移到 `content-ingest` capability**（具体路径见节 4 路线图）。
5. **命名候选**：
   - `markdown-import` — 太狭窄（不能覆盖 KRIG JSON 源）
   - `content-parser` — 暗示只 parse 不归一
   - **`content-ingest`**（本设计选）— 字面对齐"内容摄入"语义，与 storage layer "ingest pipeline" 同词族；扩展性好

**核心字面规则**：
- 新 capability `content-ingest` 提供 `markdownToAtoms` / `krigBatchToAtoms` 两个 API（不产 PM 树）
- view 端编排（`markdown-import.ts` / `extraction-import.ts`）改为：`content-ingest.markdownToAtoms() → noteCap().createNotesBatch()`（详 §7.5.2）
- `capabilities/text-editing` 不再持有 import 转换器

依据：
- 调研报告 §2.1-§2.8 入口现状
- 调研报告 §6.5 / §6.6 反模式登记"每入口自己实现一套" / "应有但缺失的抽象层"
- 5A 汇总 §6.2 共依赖点

---

### §7.3.1 三处 STRUCTURAL_CONTAINER_TYPES 是否收敛？收敛到哪一层？

**答案：选项 A — semantic 层 `@semantic/types` 单点 export，三处 import。**

字面理由：

1. 5A 汇总 §2.2 / §6.1 字面拍板"三处同步契约"为硬契约（5A §7.2 留 5B 决定怎么集中）。
2. 当前三处分散（调研报告 §6.3）：
   - `assemble-pm-doc.ts:381`（主源）
   - `build-auto-block-id-plugin.ts:54`（独立定义）
   - `atoms-to-pm.ts:557`（独立定义）
   - `dissect-pm-doc.ts:22` 已通过 import 复用主源 ✓
   - `capability-impl.ts:250-258` `injectIdsForCreate` 内 STRUCTURAL 也独立 hard-code
3. **选项 A** 收敛到 `@semantic/types/structural.ts`（新文件）：单一 `export const STRUCTURAL_CONTAINER_TYPES`；五个消费方走 import。
4. **为什么不选 B（编译期 invariant 校验三处等价）**：
   - B 字面前提是"允许三处独立定义" — 但这正是 bug 滋生地（独立定义 → 漏改 → 无人发现 → 静默漂移）
   - B 增加 type 工具复杂度（如 `as const satisfies SameSet`）但**不消除漂移可能性**，只增加发现概率
   - 解耦诉求弱（这五个消费方都属于"V2 block atom 体系"语义层，无独立演化需求）
5. **为什么不选 C（保持现状 + CI 测试断言）**：
   - C 字面退化到"运行时校验" — 5A 已字面拍板硬契约，应在编译期/源码期保证字面一致
   - 增加 CI 测试维护成本但**不阻止首次提交时的漂移**
6. **演化弹性**：未来加新结构性容器（如 grid / flexbox / layout — 决议 §13.8 字面前瞻）只需改 `@semantic/types/structural.ts` 一行；五处自动跟随；与决议 §13.8 "集中可扩展位置"字面一致。

**核心字面规则**：

```ts
// src/semantic/types/structural.ts （新文件，本期设计）
export const STRUCTURAL_CONTAINER_TYPES = new Set<string>([
  'tableRow',
  'bulletList',
  'orderedList',
  'taskList',
  'columnList',
]);
export type StructuralContainerType =
  | 'tableRow' | 'bulletList' | 'orderedList' | 'taskList' | 'columnList';
```

五处消费方：
1. `src/platform/main/note/assemble-pm-doc.ts:381`
2. `src/platform/main/note/dissect-pm-doc.ts:22`（已 import，改 import 源）
3. `src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts:54`
4. `src/capabilities/text-editing/converters/atoms-to-pm.ts:557`（迁移到 `content-ingest` 后路径变）
5. `src/platform/main/note/capability-impl.ts:250` `injectIdsForCreate` 内（删除独立定义，走 import）

依据：
- 5A 汇总 §2.2 / §6.1 / §7.2 "怎么集中留 5B"
- 调研报告 §6.3
- 决议 026 §3.1.2 修订附记 / §13.8

---

### §7.3.2 §13.8 的 STRUCTURAL_REBUILD_RULES 集中化常量应该长什么样？

**答案：可注册的 `STRUCTURAL_REBUILD_RULES: Map<containerType, RebuildRule>` 结构，与 5A §5 wrapTableCells 算法字面融合。**

字面理由：

1. 决议 §13.8 字面要求"集中可扩展位置";调研报告 §6.3 字面登记"实施未真集中（grep 全仓没此常量）"。
2. 当前是 `wrapChildren` 内 if-else 链（listItem / taskItem / column 三段重复 grouping 逻辑）+ `wrapTableCells` 独立函数。
3. **签名设计**：

```ts
// src/platform/main/note/structural-rebuild-rules.ts（新文件）

interface RebuildContext {
  /** 当前正在 rebuild 的 children 序列（已 stripAssemblyHints） */
  children: PmPayload[];
  /** 当前 index（rule 处理后调用方递增） */
  i: number;
}

interface RebuildResult {
  /** rebuild 出的 PM wrapper node（push 到外层 result） */
  wrapper: PmPayload | null;
  /** rule 消耗了多少个 children（i 推进多少） */
  consumed: number;
}

type RebuildRule = (ctx: RebuildContext) => RebuildResult | null;

export const STRUCTURAL_REBUILD_RULES: Array<{
  /** 触发条件：第一个 child 满足时 rule 处理本组 */
  triggerChildType: string;
  rule: RebuildRule;
}> = [
  { triggerChildType: 'listItem',  rule: rebuildList },     // 按 _assemblyHints.listType 包 bulletList/orderedList
  { triggerChildType: 'taskItem',  rule: rebuildTaskList }, // 包 taskList
  { triggerChildType: 'column',    rule: rebuildColumnList }, // 包 columnList
];
```

4. **与 5A §5 wrapTableCells 算法的融合**：

table 的拼装与上述 3 类**不同模式**——上述 3 类是**顶层连续段 grouping**（顶层 children 序列中连续 listItem 包成 bulletList）；table 是**反向**——assemble 在 wrapChildren 之前由 `assembleTableChildren`（专用路径）按 `attrs.rowIndex / colIndex` 重建 `table.content`，**不在 wrapChildren 路径**。

因此 `STRUCTURAL_REBUILD_RULES` 不收纳 table；**table 是单独的 `assembleTableChildren(tableAtomNode, cellsAtoms)` 函数**（实施位置：`src/platform/main/note/assemble-pm-doc.ts`），算法字面就是 5A §5.1 伪代码。**对外暴露为 `assembleTable(tableAtomNode, cellsAtoms): PmPayload`** 给 capability assemble 阶段调用。

5. **未来扩展（grid / flexbox / layout）**：新增结构性容器时，往 `STRUCTURAL_REBUILD_RULES` 数组 push 一项即可；若该容器形态像 table（cells 字面散在顶层 belongsToNote 直挂、用 childOf 边挂回根 atom），新增独立 `assembleX` 函数，由 capability assemble 阶段调度。

**核心字面规则**：
- `STRUCTURAL_REBUILD_RULES`：可注册数组，handle "顶层 children 连续段 grouping"模式（list / taskList / columnList）
- `assembleTable`：独立函数，handle "childOf 边重组 + rowIndex/colIndex 分组" 模式
- 二者各司其职，共享 `RebuildContext` / `stripAssemblyHints` 工具

依据：
- 决议 026 §13.8
- 5A 汇总 §5
- 调研报告 §6.3

---

### §7.5.1 PDF-Note-Atom 契约作统一 import 目标格式

**答案：是 — PDF-Note-Atom-v2 作为统一 import 目标格式；同时建议扩展契约 + 重命名 `tiptapContent` 字段。**

字面理由：

1. 契约**已在生产中运行**（调研报告 §3.4 字面拍板事实 / 用户 2026-05-28 澄清）。"另起炉灶"违反"决议层是契约源头"原则（5A 汇总 §1）。
2. 契约覆盖完整度：13 atom type + 5 InlineElement + `from`（pdfPage / extractedAt）+ `meta`（createdAt / updatedAt）已覆盖 V2 PM schema 主体（调研报告 §3.3）。
3. 已知不足及处理：

| 不足 | 处理 |
|---|---|
| `table.content.tiptapContent` 字段名是 V1 历史命名；项目纪律已废 Tiptap（调研报告 §3.4） | **建议修订契约 v2.1**：字段名改为 **`pmContent`**（generic ProseMirror content）；后端 / V2 双端同步改；过渡期 sanitizeAtoms 兼容 `tiptapContent ?? pmContent`（兜底 1 个版本） |
| `blockquote.content.tiptapContent` / `callout.content.tiptapContent` / `columnList.content.tiptapContent` 同 | 同上 |
| 媒体类节点未覆盖（fileBlock / audioBlock / videoBlock / htmlBlock / tweetBlock / mathVisual / externalRef）| **建议扩展契约 v2.2**：加 7 个 atom type；扩展前 V2 端 `unknown` 占位（沿当前 atoms-to-pm.ts default 路径） |
| 缺 V2 table cell 的 rowIndex / colIndex 字段 | 5A 拍板后 V2 内部模型需要，但契约 §4.7 的 tiptapContent 子树本身已有 row/cell 嵌套结构；**Q1 适配层负责扁平化 + 注入 rowIndex/colIndex** —— 契约**不动**（保留嵌套形态作为跨设备交换的"外部表征"），仅在 V2 内部 ingest 时扁平化 |

4. **统一 ingest pipeline 字面流程**（架构图节 3 详）：

```
[源 markdown] → markdownToAtoms()        ↘
[源 KRIG JSON] → sanitizeAtoms()          → V2-Atom[] → diff → writeBatch
[源 paste]    → pmDocToAtoms()           ↗   (统一 ingest)
[源 ebook 标注]→ thoughtBlockToAtoms()   ↗
```

**markdownToAtoms 字面算法**：先走当前 `markdownToProseMirror` 出 PMNode[] → 再走"PM → Atom"局部转换（对齐 dissect 但不写库）→ 给媒体类节点字面填 `from.extractionType: 'markdown'` 替代 `'pdf'`。

5. **不允许契约外节点悄悄落地**——若某入口产出契约外节点（如 markdown 出 fileBlock），必须走 `unknown` 占位 + console.warn + 显式 issue 提示"扩展契约"。这与 md-to-pm.ts 当前 PM_NODE_REGISTRY ✅/❌ 体系一致。

**核心字面规则**：
- 契约作目标 ✓
- 契约扩展两点：rename `tiptapContent → pmContent`；增加 7 个媒体 atom type
- V2 内部模型 vs 契约："扁平 cell + rowIndex" 是 V2 内部表征；"嵌套 pmContent 子树" 是契约外部表征；适配层负责双向转换（Q1）
- 契约外节点字面 `unknown` 占位（不偷偷降级）

依据：
- 调研报告 §3.4 / §4.7
- 契约 §4.7 / §4.8 / §4.12 / §4.13
- 5A 汇总 §1 决议层是契约源头

---

### §7.5.2 batched createNote API

**答案：新增 `createNotesBatch(docs: Doc[], folderId)` API，单 transaction + 末尾单次 broadcast。**

字面理由：

1. 现状（调研报告 §6.10 / §6.12）：每篇 1 次 `createNote` → 1 次 `storage.transaction` → 1 次 broadcast；1000 篇 = 1000 次 broadcast + 1000 次 NavSide list refresh。
2. **API 签名**：

```ts
export interface CreateNotesBatchInput {
  /** 每篇 = (doc, folderId)；folderId 各自独立（不同 chapter 可入不同 folder） */
  items: Array<{
    doc: NoteDocEnvelope;
    folderId: string | null;
    /** 可选：调用方提供的 idempotency token（重复 import 去重） */
    importToken?: string;
  }>;
  /** broadcast 策略 */
  broadcastMode?: 'final' | 'progressive-throttle';
  /** progressive 模式下 throttle 间隔（ms），默认 500ms */
  throttleMs?: number;
}

export interface CreateNotesBatchResult {
  /** 成功创建的 NoteInfo 列表 */
  notes: NoteInfo[];
  /** 失败项：行号 + 错误 + 是否回滚 */
  failures: Array<{ index: number; error: string; rolledBack: boolean }>;
}

createNotesBatch(input: CreateNotesBatchInput): Promise<CreateNotesBatchResult>;
```

3. **事务策略**：
   - 默认 **单 storage.transaction** 包所有 items（all-or-nothing）
   - 边界场景（item 数 > 500）拆 chunk，每 chunk 单 transaction（避免 SurrealDB 长事务超时；阈值留 storage 性能压测决定）
4. **broadcast 策略**：
   - `final` 模式（默认）：整批完成后**1 次** `NOTE_LIST_CHANGED` broadcast；NavSide 1 次 list refresh
   - `progressive-throttle` 模式：每 throttleMs（默认 500ms）broadcast 一次"已完成 X 篇"；导入大批量时给用户看进度
5. **与 5A 拍板的 verifyNotePersisted 兜底集成**：
   - 5A 汇总 §2.4 / 测试场景 6 字面要求"import 后 createNote 完成 → 拼回 PM doc → 期望恢复"
   - batch API 内部对每 item createNote 完成时**走原 createNote 单元路径**（cache.set + buildNoteInfo），end-of-batch 调一次 `verifyNotePersisted(allCreatedIds)`（新增辅助）：随机抽 N 篇 reload + 字面比对 dissect/assemble round-trip
   - verifyNotePersisted 失败 → throw 触发整批 rollback（all-or-nothing 模式下）；progressive 模式下登记 failure
6. **现有 `createNote` 单条 API 保留不动**（兼容 createEmptyDoc / paste / ebook 标注路径）；`createNotesBatch` 内部不能简单循环 `createNote`——必须走"统一 transaction"路径。
7. 与 §7.5.3 progressive 语义协调：默认 all-or-nothing；progressive 模式由调用方显式选。

依据：
- 调研报告 §6.10 / §6.12 反模式
- 5A 汇总 §6.3 测试场景 6

---

### §7.5.3 import 路径的 progressive vs all-or-nothing 语义

**答案：默认 all-or-nothing（事务原子）；markdown 目录批量 + extraction 多 chapter 入口提供"progressive + 用户确认"配置选项；fire-and-forget 静默 skip 路径**字面废弃**。**

字面理由：

1. 现状（调研报告 §6.5 / §6.10 / §6.12）：fire-and-forget；单篇失败 console.warn 跳过；不能 cancel；已写入 note 不回滚。
2. 不同 import 类型的语义差异：

| 入口 | 典型规模 | 推荐语义 | 字面理由 |
|---|---|---|---|
| markdown 单文件 | 1 篇 | all-or-nothing | 失败就该让用户知道 + 重试 |
| markdown 目录批量 | 10-2000 篇 | progressive + 末尾汇总 | 单篇失败不该回滚全部；但每篇 atomic（item 级 transaction）|
| word-mammoth / word-pandoc 单文件 | 1 篇 | all-or-nothing | 同 markdown 单文件 |
| word 批量 | 10-100 篇 | progressive + 末尾汇总 | 同 markdown 批量 |
| extraction 单 chapter | 1 篇 | all-or-nothing | OCR 单页失败就是失败 |
| extraction 多 chapter batch | 5-50 篇 | progressive + 末尾汇总 | 一书几十章节单章失败不该删整书 |
| paste 单 note | 1 篇 | all-or-nothing | 同 |
| ebook 标注 → 新 thought note | 1 篇 | all-or-nothing | 同 |

3. **progressive 模式的字面 cancel 支持**：

```ts
interface ImportSession {
  sessionId: string;
  /** 取消信号；abort 后已成 item 保留，未开始 item 跳过 */
  cancel(): Promise<{ cancelled: number; completed: number; failed: number }>;
}
```

   - markdown / extraction 批量入口字面返回 `ImportSession`；NavSide 上可挂 "Cancel Import" UI（本期不实施 UI，留 view 端 sub-phase）
4. **失败回滚语义**：
   - all-or-nothing：单 transaction 抛错自动回滚；用户看到 1 个 toast"import failed"
   - progressive item-atomic：单 item transaction 抛错 → 该 item 失败；其余继续；末尾汇总弹"X 成功 Y 失败"
   - **failure 不允许静默 console.warn**——必须经 `CreateNotesBatchResult.failures[]` 字面登记，由调用方决定如何呈现给用户
5. **用户配置选项**：UI 设置面板留"批量 import 失败策略"开关（all-or-nothing / progressive）——**本期不实施 UI**，但 API 字面预留 `broadcastMode` + `failureMode` 参数。

**核心字面规则**：
- 默认 atomic
- 批量入口（markdown 目录 / word 批量 / extraction 多 chapter）显式调 progressive 模式
- 失败必须返回结构化 result，不允许 console.warn 跳过

依据：
- 调研报告 §6.5 / §6.10 / §6.12 反模式
- 5A 汇总 §6.3 测试场景 1 / 7

---

## 节 2：4 个 5A 留 5B 拍板的 Open Question 答案

### Q1：契约 §4.7 `table.content.tiptapContent`（嵌套子树）与 V2 内部"扁平 cell + rowIndex"模型的适配层归属

**答案：适配层归属 `content-ingest` capability 的内部模块 `table-adapter`；atoms-to-pm 的 table case 改为"扁平 cell 生成 + rowIndex/colIndex 注入"；不需要反向 pm-to-tiptap 桥（本期）。**

字面理由：

1. **归属**：契约 → V2 内部的扁平化是 import 路径的事，应当在 `content-ingest` capability 内部完成。**理由**：
   - text-editing capability 应专注 PM editor 驱动 + atom ↔ PM 拼装（决议 §8）
   - 把扁平化逻辑塞 text-editing 等于让其知道"导入语义"，职责不清
   - 新独立 capability `content-ingest` 自然承担"源 → V2 Atom 归一化"，table adapter 是其中一个模块
2. **算法签名**：

```ts
// src/capabilities/content-ingest/internal/table-adapter.ts

interface TableAdapterInput {
  /** 契约 table.content.tiptapContent: PMNode[]，顶层 tableRow */
  tiptapContent: unknown[];
  /** 父 atom id（table 自身的 ULID，给 cell.parentId 用，可选） */
  tableAtomId?: string;
  /** 来源信息（透传到生成的 cell atoms） */
  from?: AtomFrom;
}

interface TableAdapterOutput {
  /** table atom 自身（content=[] + attrs.id 占位 null） */
  tableAtom: Atom;
  /** cell / header atoms（带 attrs.rowIndex / colIndex / id 占位 null） */
  cellAtoms: Atom[];
  /** 边集：cellAtom → tableAtom 的 childOf */
  childOfEdges: Array<{ subjectId: string; objectId: string }>;
}

function tableAdapter(input: TableAdapterInput): TableAdapterOutput;
```

3. **算法步骤**：
   - 遍历 tiptapContent 顶层 tableRow，rowIdx 从 0 起
   - 遍历每 tableRow 的 children（tableCell / tableHeader），colIdx 从 0 起
   - 字面生成 `cellAtom = { id: null (待 inject), type: 'tableCell'|'tableHeader', content: { pmContent: cell.content }, parentId: tableAtomId, from, attrs: { rowIndex, colIndex, colspan, rowspan, colwidth, align, id: null } }`
   - 生成 childOf 边
   - 不再生成 tableRow atom（5A 拍板 tableRow 不是 atom）
4. **反向 pm-to-tiptap 桥**：**不做**。理由：
   - V2 → 外部交换场景未启动（5C 也不涉及）
   - V2 内部 PM doc 已通过 assemble 阶段重组成正确的"嵌套 tableRow > cell" PM 形态（5A §5.1 wrapTableCells 算法）
   - 跨设备同步在决议 026 §10.4 字面"不在本 sub-phase 范围"；远期启动时再加
5. **与 §7.5.1 协调**：契约不动（保留 tiptapContent 嵌套形态）；适配层负责进出转换。若未来契约扩展支持扁平形态（`v3.0`），适配层可退化为透传——但本期**不动契约结构**，仅 rename 字段名（tiptapContent → pmContent）。

依据：
- 5A 汇总 §7.3 Q1
- 契约 §4.7
- 决议 026 §3.4 / §6.1 / §13.9

---

### Q2：tableCell.attrs.rowIndex 在 PM editor 内的实时维护策略

**答案：选项 B（dissect 期注入，PM tree 内字面不维护）。**

字面理由（事前验证，不留 "5B 实施时验证"）：

1. **B 的核心论证**：rowIndex / colIndex 是**派生信息**（可由 cell 在 PM tree 内的位置 100% 重算），不是用户输入的语义信息。把派生信息放 PM tree 内实时维护违反"single source of truth"。
2. **B 的字面"陈旧不出 bug" 证明**：
   - 用户编辑表格时（删行 / 插行 / 移列），PM tree 立即正确（prosemirror-tables 插件保证）
   - cell.attrs.rowIndex 此刻字面陈旧 — **但 PM editor 不消费 rowIndex 渲染**（rowIndex 只用于 dissect/assemble 持久化路径）
   - 用户编辑结果通过 onChange → updateNote → dissect 时**重新计算** rowIndex（位置 = cell 在 tableRow 内的 idx；rowIndex = tableRow 在 table 内的 idx）
   - 用户切到另一 view 再切回：cache hit → PM doc 仍是用户编辑结果（含正确的 PM 嵌套），rowIndex 仍陈旧但 PM editor 不消费 → **不出 bug**
3. **A 的代价（plugin appendTransaction 实时同步）**：
   - appendTransaction 每 tr 扫表格内所有 cells 重算 rowIndex → 大表（100 行 × 10 列 = 1000 cells）单字编辑也要扫 → 性能差
   - 与 buildAutoBlockIdPlugin 同模式（appendTransaction 写 attrs）会污染 undo history（必须 setMeta addToHistory:false，feedback memory 已字面登记）
   - **没有解决问题** — 用户编辑期间 PM doc 形态变化，appendTransaction 字面在每个 tr 后**重算并写回**，等同于一直在做 dissect 的工作；不如等到真要 dissect 时算一次
4. **C 的代价（仅在表格结构编辑时同步）**：
   - 需要识别"哪些 PM command 是结构编辑"（addRow / removeRow / addColumn / removeColumn / mergeCells / splitCell / etc）
   - 第三方 plugin 的 command 不一定 expose 此 hook，必须 wrap 所有 prosemirror-tables command
   - 维护成本高、覆盖不全
5. **B 的字面实施位置**：`src/platform/main/note/dissect-pm-doc.ts` 处理 tableRow 路径时（即 `processChildren` 见到 `isStructuralContainer(child)` 且 `child.type === 'tableRow'` 分支）：
   - 在跳层之前，先字面记录 `pmRowIdx`
   - 遍历 tableRow.content (cells)，记录 `pmColIdx`
   - 对每个 cell：在 push grandchildren 之前，**字面 inject** `cell.attrs.rowIndex = pmRowIdx`，`cell.attrs.colIndex = pmColIdx`
   - 这个 inject 不写回 PM doc（dissect 是纯函数 + 输出 atom）；写入到生成的 atom payload
6. **与 assemble 算法的对称性**：dissect 注入 rowIndex/colIndex → 写入 atom payload → assemble 期按 rowIndex 分组 / colIndex 排序重建 → tableRow PM wrapper 复原。**round-trip 字面闭环**。

依据：
- 5A 汇总 §7.3 Q2 推荐 B
- 决议 026 §6.1 新增段 / §13.9
- 5A §5.3 反向算法

---

### Q3：table NodeSpec 加 attrs.id 后对 prosemirror-tables 第三方 plugin 的影响

**答案：低风险 — prosemirror-tables 源码字面用 `{...attrs}` spread 保留所有 cell attrs；新 cell 走 schema default（id=null，靠 buildAutoBlockIdPlugin 兜底）；split cell 会复制 id 但 plugin 重复检测兜底；唯一需要注意的是新 cell 的 rowIndex/colIndex 默认 0 不准（但 dissect 期重算覆盖）。本期可加 attrs.id，不需要 plugin 包装层。**

字面证据（直接读 `node_modules/prosemirror-tables/dist/index.js` 源码，本期工作目录已 verify）：

| 命令 | 行 | 关键代码 | 结论 |
|---|---|---|---|
| `addColumn` 现有 cells | 1329 | `tr.setNodeMarkup(..., null, addColSpan(cell.attrs, ...))`；`addColSpan` line 477: `result = {...attrs, colspan: attrs.colspan + n}` | **保留 id / rowIndex / colIndex / bookAnchor 等所有 attrs** ✓ |
| `addColumn` 新 cell | 1334 | `type.createAndFill()` → schema default | id=null（靠 plugin 注入）；rowIndex=0 / colIndex=0（dissect 期重算） |
| `addRow` 现有 cells | 1427-1430 | `tr.setNodeMarkup(..., null, {...attrs, rowspan: attrs.rowspan + 1})` | **保留所有 attrs** ✓ |
| `addRow` 新 cells | 1435 | `type.createAndFill()` | 同 addColumn 新 cell |
| `removeColumn` | 1375 | `removeColSpan(attrs, ...)`；line 462: `result = {...attrs, colspan: attrs.colspan - n}` | **保留所有 attrs** ✓ |
| `removeRow` 跨 row cell | 1491-1494 | `cell.type.create({...attrs, rowspan: ...}, cell.content)` | **保留所有 attrs** ✓ |
| `mergeCells` | 1574-1577 | `tr.setNodeMarkup(mergedPos + ..., null, {...addColSpan(mergedCell.attrs, ...), rowspan: ...})` | **保留 mergedCell 的 id**（leader 模式）；删除的 cells id 字面丢失（与 5A 拍板 merge 上方保留 id 模式相符） |
| `splitCell` | 1624-1657 | `baseAttrs = cellNode.attrs; ...attrs.push(colwidth ? {...baseAttrs, colwidth: ...} : baseAttrs)` | **字面复制 id 给所有 split 子 cells → 重复 id**；但 buildAutoBlockIdPlugin descendants 重复检测会重生成（survey §4.5 line 94-142） |

**风险点**：
- **新 cell 字面 attrs.id = null + rowIndex = 0 + colIndex = 0**：
  - id null OK（buildAutoBlockIdPlugin appendTransaction 在下一个 tr cycle 注 ULID — 这是已存在机制）
  - rowIndex/colIndex 0 字面不准 — 但 Q2 选 B 后 dissect 期重算，**不出 bug**
- **split cell 复制 id**：
  - buildAutoBlockIdPlugin descendants 扫描重复字面兜底（5A §5.3 拍板"split 上半保留下半新生"，与 plugin 现有实施一致）
  - 复制的 id 在 dispatchTransaction 退出前被纠正
- **columnResizing 写 colwidth**：与 `id` 字段字面**完全无交互**（不修改其它 attrs），无风险
- **tableEditing isolating / selection 计算**：基于 `tableRole` / `isolating` flag（spec 已有），与 attrs.id 字面无交互
- **结论**：**本期可以直接给 tableNodeSpec / tableCellSpec / tableHeaderSpec 加 attrs.id，不需要 plugin 包装层兜底**

**剩余风险**（非阻塞，需写测试覆盖）：
- 用户表格内 paste 大块 PM JSON（含 cells with id）→ 第三方 plugin handlePaste 路径是否保留？字面源码 line 32 declare 但未细读 paste 路径——**留 Stage 1 测试**（场景 6 已覆盖：行删 / 列插 / 表格内拷贝），不在设计层阻塞

依据：
- 5A 汇总 §7.3 Q3
- prosemirror-tables 源码（V2 仓库 node_modules）

---

### Q4：tableHeader 单独的 rowIndex 字面规则

**答案：选项 A（与 tableCell 共享 rowIndex namespace，多行表头 rowIndex 走 0/1/2/...）。**

字面理由：

1. **PM schema 字面证据**：V2 `tableRowNodeSpec.content = '(tableCell | tableHeader)+'`（V2 仓库 `src/drivers/text-editing-driver/blocks/table/spec.ts:104`）。**字面允许**任何 tableRow 含任意 tableCell + tableHeader 混合，包括多个 tableRow 全 tableHeader（多行表头）。
2. **docx / markdown 导入产出多行 tableHeader 形态调研**：
   - markdown GFM 表格语法**字面只支持单行表头**（首行后跟 `|---|---|` 分隔符）— md-to-pm.ts:347 已字面实现 `isFirst` 单行表头逻辑
   - word-mammoth / word-pandoc 通过 turndown → markdown 路径，**多行表头会被压成单行表头 + 多行普通 cell**（GFM 不支持多行表头）
   - extraction 路径产出契约 §4.7 tiptapContent — 契约**不限制**多行 tableHeader（PM 允许就允许）
3. **选项 A 字面规则**：
   - rowIndex 在 table 内**全局 0-based**：rowIndex=0 是第 0 行（无论 cell 还是 header）
   - tableHeader 单行表头场景：rowIndex=0 字面对应表头行（与 5A §13.9 字面一致）
   - 多行表头场景（如 0/1 两行都是 tableHeader）：rowIndex=0/1 字面对应表头第 1/2 行
   - assemble 端按 rowIndex 升序重建 tableRow 时，**字面不区分 cell/header 类型，仅按位置重组**
4. **选项 B 的代价**：
   - tableHeader 独立 namespace（如 `attrs.headerRowIndex`）→ 需要新 schema 字段
   - assemble 端必须**先按 cell/header 分流再按各自 rowIndex 排序**，复杂度高
   - 序列化形态字面不对齐契约（契约 §4.7 不区分 cell/header 的 row 计数）
   - **不解决问题**：多行表头与多行普通 cell 的相对顺序仍需要某种"全局 row 位置"信号 — B 字面绕开但需要额外 invariant 保证 header 段总在 cell 段前面
5. **A 的字面简化**：用单一 rowIndex 表达 PM tree 内的物理位置；assemble 端按 rowIndex 重组时，PM schema 自然校验 `tableRow > (tableCell | tableHeader)+` 字面允许混合
6. **边缘场景边界**：用户在中间行插入 tableHeader（违反 "header always at top" 习惯）→ assemble 字面按 rowIndex 重建，PM 仍合法（schema 允许），但 UI 渲染可能反常 — 留 view 端 sub-phase 决策是否禁用此场景

**核心字面规则**：
- 单一 rowIndex namespace（0-based）
- tableHeader rowIndex=0 字面对应表头第 1 行
- 多行表头各行 rowIndex 字面顺序 0/1/2/...
- assemble 不分类，仅按 rowIndex 升序排序重组 tableRow

依据：
- 5A 汇总 §7.3 Q4 推荐 A
- 决议 026 §3.1.2 注 1
- PM schema `tableRow > (tableCell | tableHeader)+`

---

## 节 3：公共转换器架构总图

### 3.1 总图（ASCII art）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              输 入 层                                          │
│                                                                                │
│ markdown 字符串    Word docx      web 后台 KRIG_IMPORT    paste source doc    │
│   .md 文件         (mammoth)        JSON batch              (内存 PM doc)       │
│   目录扫描          (pandoc)        (console-message)                          │
│      ↓                ↓                 ↓                       ↓              │
│      └─ MARKDOWN_IMPORT_RUN IPC ─┘    EXTRACTION_NOTE_CREATE   pasteNote API   │
│                                                                                │
│  用户编辑(PM tr)        ebook 标注(addReadingThoughtBlock)                    │
│      ↓                       ↓                                                 │
│   PM dispatch              手工拼 PM block                                     │
└────────┬──────────────────────────────────────┬───────────────────────────────┘
         │                                       │
         ↓                                       ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│                  解析/转换层 (capability: content-ingest)                       │
│                                                                                │
│  markdownToAtoms(md: string)             krigBatchToAtoms(batch: KRIG_IMPORT) │
│    │                                       │                                   │
│    ├─ 内部走 markdownToProseMirror         ├─ sanitizeAtoms (8 条容错)         │
│    │  → PMNode[] (旧路径,不再装 doc)         (契约 §9)                           │
│    ├─ 局部 pmToAtoms (类 dissect 但不写库)  ├─ tableAdapter (Q1):              │
│    │  - 顶层每 block → atom                 │  tiptapContent → 扁平 cells       │
│    │  - 容器 block content=[]               │  + 注入 rowIndex/colIndex          │
│    │  - 注入 attrs.id: null                 │                                   │
│    │  - 注 from { extractionType:'md' }    │  (output: V2-Atom 集合)            │
│    │                                       │                                   │
│    └─ (output: V2-Atom 集合)              │                                   │
│                                                                                │
│        共用工具:                                                                │
│  ┌──────────────────────────────────────────────────────────────┐              │
│  │  ensureBlockAttrIdField     INLINE_TYPES                       │              │
│  │  STRUCTURAL_CONTAINER_TYPES (from @semantic/types/structural) │              │
│  │  tableAdapter (Q1)           ulid generator                    │              │
│  └──────────────────────────────────────────────────────────────┘              │
└────────┬───────────────────────────────────────────────────────────────────────┘
         │
         ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│      ingest pipeline (capability: note, main 进程)                              │
│                                                                                │
│  noteCap.createNotesBatch(items, mode)                                         │
│    │                                                                           │
│    ├─ 校验: V2-Atom 集合 schema 合法性 (atom type / from / meta 字段必填)        │
│    ├─ ULID inject: 走共享 injectIdsForCreate(atoms) — 与 PM plugin 共用规则     │
│    │  (不再两份 STRUCTURAL 定义)                                                │
│    ├─ diff: 单 transaction 内对每 item 调 fullCreateDiff                        │
│    │   ├─ container atom (cached title)                                        │
│    │   ├─ hasNoteView edge                                                     │
│    │   ├─ inFolder edge                                                        │
│    │   ├─ atom batch putAtom (含 table / cells / leaves)                        │
│    │   └─ edge batch putEdge (belongsToNote / nextSibling / childOf)            │
│    ├─ verifyNotePersisted(N 随机抽): assemble 回 PM doc + 比对 round-trip       │
│    │  失败 → throw 触发整批 rollback (all-or-nothing 模式)                       │
│    └─ broadcast strategy:                                                       │
│        - final: 末尾单次 NOTE_LIST_CHANGED                                      │
│        - progressive-throttle: 每 throttleMs 一次                                │
└────────┬───────────────────────────────────────────────────────────────────────┘
         │
         ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│           持久化层 (storage / SurrealDB)                                        │
│                                                                                │
│  storage.transaction (跨 N 篇 note 单事务 / 大批 N>500 chunk 分批)               │
│    ├─ atom 表 putAtom × M                                                       │
│    └─ edge 表 putEdge × K                                                       │
│  (索引 / cardinality check 复用现有机制,不动 storage)                            │
└──────────────────────────────────────────────────────────────────────────────┘

                              反 向 流

┌──────────────────────────────────────────────────────────────────────────────┐
│  DB → assemble PM doc                                                          │
│                                                                                │
│  noteCap.getNote(id) / listNotes                                               │
│    ↓                                                                           │
│  assemblePmDoc(containerId)                                                    │
│    │                                                                           │
│    ├─ listAtoms(belongsToNote=containerId) → blockIds                          │
│    ├─ listEdges(childOf) → hasChildOf set                                       │
│    ├─ topLevelIds = blockIds.filter(¬hasChildOf)                                │
│    ├─ wrapChildren(topNodes)                                                    │
│    │   走 STRUCTURAL_REBUILD_RULES (§7.3.2 新): list / taskList / columnList    │
│    │                                                                           │
│    └─ assembleTable(tableAtom, cellsAtoms) — 单独路径 (§7.3.2 / 5A §5):         │
│         按 rowIndex 分组 → 按 colIndex 排 → 重建 tableRow PM wrapper            │
│         字面消费 cell.attrs.rowIndex / colIndex (Q2 dissect 注入的)              │
│                                                                                │
│    ↓ PM doc (V2 schema 合法树)                                                  │
│  view 渲染 (PM editor / NavSide / TOC)                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 每条流的边界 / capability 归属 / 依赖

| 流 | 起点 | 终点 | capability | 依赖 |
|---|---|---|---|---|
| markdown 字符串 → V2-Atom | view (markdown-import.ts) | content-ingest.markdownToAtoms | content-ingest (new) | media-storage（base64 → media://） |
| KRIG_IMPORT JSON → V2-Atom | main extraction-handlers → view extraction-import.ts | content-ingest.krigBatchToAtoms | content-ingest (new) | media-storage |
| V2-Atom 集合 → DB | view → main createNotesBatch | storage.transaction | note (扩展 createNote → createNotesBatch) | storage / folder / semantic id ulid |
| DB → PM doc → 渲染 | main getNote → assemblePmDoc | view PM Host | note (assemble 改算法) | text-editing (schema) |
| 用户编辑 → atom 增量 | view PM dispatch → updateNote | dissect → diff → storage | note (dissect / diff / cache) | text-editing |
| paste / ebook 标注 | view tree-ops / main ebook-cap | createNote 单条 (不进 ingest pipeline) | note / ebook | text-editing |

### 3.3 转换器输入 / 输出契约（节 4 落地用）

```ts
// capability content-ingest 对外 API

interface ContentIngestApi {
  markdownToAtoms(md: string, options?: {
    /** 强制首块 isTitle paragraph (markdown-import.ts:492 当前逻辑迁入) */
    titleHint?: string;
    /** from 信息（不指定时 from.extractionType='markdown' + extractedAt=Date.now()） */
    from?: Partial<AtomFrom>;
  }): Promise<{ atoms: Atom[]; warnings: string[] }>;

  krigBatchToAtoms(batch: KrigImportBatch): Promise<{
    chapters: Array<{
      title: string;
      bookName: string;
      atoms: Atom[];
      warnings: string[];
    }>;
  }>;
}
```

**禁止**：本 capability 不允许导出 PM doc / PMNode[] / DriverSerialized 形态的 API（与 §7.1.2 脱钩规则一致）。

---

## 节 4：实施路线图

> 实施留 `refactor/import-system-rebuild` 分支做，本期不实施代码。
> 路线图覆盖 5A §6.1 全部 9 个改动点 + 本期 5B 新加。

### Stage 1：基础设施 — semantic 层 + schema attrs（依赖：无）

**改动**：
- **新建** `src/semantic/types/structural.ts`（§7.3.1 单点 export STRUCTURAL_CONTAINER_TYPES，5 项）
- `src/drivers/text-editing-driver/blocks/table/spec.ts:76-85` — tableNodeSpec 补 `attrs: { id: { default: null } }`（5A §6.1 #1）
- `src/drivers/text-editing-driver/blocks/table/spec.ts:122-137` — tableCellSpec.attrs 加 `rowIndex: { default: 0 }, colIndex: { default: 0 }`（5A §6.1 #2）
- `src/drivers/text-editing-driver/blocks/table/spec.ts:165-172` — tableHeaderSpec.attrs 同款（5A §6.1 #3）

**改动性质**：schema 改 + 新增模块（typescript 文件）

**验收**：
- typecheck 全绿
- 测试场景 1 / 2（5A §6.3）通过：新建表格 → 编辑 cell → 重启 → 内容保留 + rowIndex 字面不变
- 测试场景 6（Q3 调研）：行删 / 列插 / 表格内拷贝 — prosemirror-tables plugin 行为正常，attrs.id 不丢

### Stage 2：STRUCTURAL 集合三处同步 + capability inject 收敛（依赖：Stage 1 完成）

**改动**：
- `src/platform/main/note/assemble-pm-doc.ts:381` 删除独立定义，改 `import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural'`（5A §6.1 #4）
- `src/platform/main/note/dissect-pm-doc.ts:22` 改 import 源（从 assemble-pm-doc 改成 @semantic/types/structural）
- `src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts:54` 同步改（5A §6.1 #5）
- `src/capabilities/text-editing/converters/atoms-to-pm.ts:557` 同步改（5A §6.1 #6） — 注：此文件会在 Stage 6 迁移到 content-ingest，本 stage 先就地改
- `src/platform/main/note/capability-impl.ts:250-258` `injectIdsForCreate` 删除独立 STRUCTURAL 定义，走 import

**改动性质**：算法改（5 项集合 vs 6 项）+ refactor

**验收**：
- 三处+ 字面 1:1 一致；grep `STRUCTURAL_CONTAINER_TYPES` 仅在 `@semantic/types/structural.ts` 出现 new 关键字
- 测试场景 1（GFM 3×3 markdown 表格）通过：dissect 期 table 走 shouldGenerateAtom=true 路径（因 STRUCTURAL 已不含 'table'）→ 生成 1 table atom + 9 cell atoms + 9 childOf 边

### Stage 3：dissect 端 rowIndex/colIndex 注入（依赖：Stage 1 + 2）

**改动**：
- `src/platform/main/note/dissect-pm-doc.ts` 处理 tableRow 路径时（line ~101-118）：在跳层前字面给 cell.payload.attrs 注入 rowIndex / colIndex
- 字面算法：见 Q2 第 5 点 + 5A §5.3

**改动性质**：算法改（增加注入路径）

**验收**：
- 测试场景 1：dissect 后 cell atoms 字面带 attrs.rowIndex / colIndex（0/0, 0/1, 0/2, 1/0, ...）
- 测试场景 3（表格内删一行）→ 保存 → dissect → 下方 cells 字面 rowIndex 前移
- 测试场景 4（插入新行）→ 同款

### Stage 4：assemble 端 wrapTableCells 算法改 + STRUCTURAL_REBUILD_RULES 重构（依赖：Stage 3）

**改动**：
- **新建** `src/platform/main/note/structural-rebuild-rules.ts`（§7.3.2 集中化 + 注册式）
- **新建** `src/platform/main/note/assemble-table.ts`（5A §5.1 wrapTableCells 算法替换 v1 简化版）
- `src/platform/main/note/assemble-pm-doc.ts` 重构 `wrapChildren`：if-else 链改为遍历 STRUCTURAL_REBUILD_RULES
- `assemble-pm-doc.ts` 主流程加 `assembleTable` 调度（按 childOf 边找出 table atom 的 cells 集合 → 单独走 assembleTable）（5A §6.1 #7）

**改动性质**：算法改 + 新增模块

**验收**：
- 测试场景 1 round-trip：3 行 3 列表格 → dissect → assemble → 完全恢复
- 测试场景 3 / 4 round-trip
- 测试场景 5（拖动整表）— 本期不实施 UI，仅 verify table atom 字面可作单一拖动锚点

### Stage 5：新建 content-ingest capability 骨架（依赖：无 / 可与 Stage 1-4 并行）

**改动**：
- **新建** `src/capabilities/content-ingest/` 目录
  - `types.ts`（节 3.3 API 契约）
  - `index.ts`（capability 注册 + slot 名 `content-ingest`）
  - `internal/sanitize-atoms.ts`（从 text-editing 迁入，沿原逻辑）
  - `internal/table-adapter.ts`（Q1 新模块）
  - `internal/markdown-to-atoms.ts`（包含原 markdownToProseMirror 内部使用 + 新 pmToAtoms 局部转换）
  - `internal/krig-batch-to-atoms.ts`（包装 sanitizeAtoms + tableAdapter + atoms 归一化）

**改动性质**：新增 capability + 部分迁移

**验收**：
- typecheck 绿
- 单元测试：markdownToAtoms 字面对 GFM markdown 表格产出 1 table atom + 6 cell atoms（3 行 2 列）+ childOf 边
- 单元测试：krigBatchToAtoms 字面对契约 §4.7 table.content.tiptapContent 产出扁平 atoms + rowIndex/colIndex

### Stage 6：迁移 text-editing import 转换器 → content-ingest + capability 注销旧 API（依赖：Stage 5）

**改动**：
- 删除 `src/capabilities/text-editing/converters/md-to-pm.ts`、`atoms-to-pm.ts`、`sanitize-atoms.ts` 的 capability 公开导出
- 仅保留 text-editing 内部 `createEmptyDoc` 等真正属于 text-editing 的 API
- `src/views/note/markdown-import.ts:526` 改为：`content-ingest.markdownToAtoms()` → `noteCap.createNotesBatch()`（5A §6.1 #8/#9 配合）
- `src/views/note/extraction-import.ts:152` 改为：`content-ingest.krigBatchToAtoms()` → `noteCap.createNotesBatch()`
- `capabilities/text-editing/types.ts` 中 `TextEditingApi` 删除 `markdownToProseMirror` / `atomsToProseMirror` / `sanitizeAtoms` 字段

**改动性质**：重构（capability 边界调整）+ view 端切换

**验收**：
- typecheck 绿
- 测试场景 6（KRIG_IMPORT 入口 → 完整 round-trip）通过
- 测试场景 7（markdown GFM 表格入口 → 完整 round-trip）通过

### Stage 7：noteCap.createNotesBatch API 实施（依赖：Stage 1-6）

**改动**：
- `src/platform/main/note/capability-impl.ts` 新增 `createNotesBatch` 实施(§7.5.2 API 签名）
- 内部循环每 item 走原 createNote 单元算法 + 单 transaction 包裹
- 实施 `verifyNotePersisted(N 抽样)`：assemble → 字面比对原 doc.content 顶层 type 序列 + atom 数等基础不变量
- `handlers.ts` 加 NOTE_CREATE_BATCH IPC handler
- `capabilities/note/types.ts` 加 batch API 类型
- broadcast 策略实施（final / progressive-throttle）

**改动性质**：新增 API + 算法新增

**验收**：
- 1000 篇 import 字面单次 NOTE_LIST_CHANGED broadcast
- 大批量（>500 chunk）字面拆 transaction，整体仍 atomic
- 失败 item 走 failures[] 字面登记，不静默 console.warn

### Stage 8：契约扩展（rename tiptapContent → pmContent + 媒体 atom type）（依赖：Stage 5-7）

**改动**：
- **新建** `docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.1.md`（rename 字段名）
- 后端协议同步更新（**项目外协调**，本期仅设计登记）
- V2 端 `sanitizeAtoms` 字面兼容 `tiptapContent ?? pmContent`（兜底 1 个版本）
- 契约 v2.2 媒体扩展（fileBlock / audioBlock / 等 7 个 atom type）字面登记（**留独立 sub-phase**，本期仅写设计文档）

**改动性质**：契约改 + 兼容层

**验收**：
- 现有 KRIG_IMPORT 字面（tiptapContent）继续工作
- 新协议 KRIG_IMPORT（pmContent）字面工作
- 契约 v2.1 文档加版本历史 / 兼容性说明

### Stage 9：测试场景全覆盖 + 性能压测（依赖：Stage 1-8 完成）

**改动**：
- 5A §6.3 七测试场景 + 本期新加场景：
  - 场景 8：markdown 1000 篇目录批量 → progressive 模式 → 末尾汇总
  - 场景 9：KRIG_IMPORT 5 chapter batch → all-or-nothing 模式 → 某 chapter 出错回滚 → 其它 chapter 字面未写入
  - 场景 10：第三方 plugin 兼容性（Q3 调研）— 表格内 paste / split cell / merge cell / 全表格 cut & paste
- 性能压测：1000 篇 cold start listNotes + import 大批量

**改动性质**：测试 + 验收

**验收**：
- 全场景通过
- listNotes 冷启动性能 ≥ 当前基线
- import 1000 篇 ≤ 当前 5 倍时间（batch 优化收益）

### Stage 总览

| Stage | 内容 | 依赖 | 5A §6.1 #改动点 |
|---|---|---|---|
| Stage 1 | schema attrs 补齐 + semantic structural 新建 | — | #1 #2 #3 |
| Stage 2 | STRUCTURAL 三处同步 + injectIdsForCreate 收敛 | Stage 1 | #4 #5 #6 |
| Stage 3 | dissect rowIndex/colIndex 注入 | Stage 1+2 | （Q2 实施）|
| Stage 4 | assemble wrapTableCells + STRUCTURAL_REBUILD_RULES | Stage 3 | #7 + §7.3.2 |
| Stage 5 | 新 content-ingest capability 骨架 | — | （本期新加）|
| Stage 6 | 迁移 text-editing 导出 + view 端切换 | Stage 5 | #8 #9 |
| Stage 7 | createNotesBatch API | Stage 1-6 | §7.5.2 |
| Stage 8 | 契约扩展 tiptapContent → pmContent | Stage 5-7 | §7.5.1 |
| Stage 9 | 测试 + 性能压测 | Stage 1-8 | §7.5.3 / Q3 / 5A §6.3 |

---

## 节 5：本期未拍板的悬而未决问题

下列问题留下一 sub-phase 拍板，不允许 punt 到"实施时再说"：

### Q5：契约 v2.2 媒体 atom type 扩展的具体字段定义

**背景**：本设计 §7.5.1 拍板"扩展契约支持 fileBlock / audioBlock / videoBlock / htmlBlock / tweetBlock / mathVisual / externalRef 共 7 种"，但每种 atom.content 字段 schema 未定义。

**留下一 sub-phase 拍板**：与 KRIG Knowledge Platform 后端协调字段名 + 类型；本期 V2 端走 `unknown` 占位兼容（已在 atoms-to-pm 现有路径）。

### Q6：content-ingest capability 是 main 进程 vs renderer 进程？

**背景**：本设计节 3 架构图未明示。当前现状（调研报告 §2.6 / §2.3 / §2.1）：markdownToProseMirror / atomsToProseMirror 都跑在 renderer；mediaPutBase64 通过 IPC 走 main。

**论点 A（renderer 跑）**：与现有路径一致；media 转换 IPC 已经成熟；createNotesBatch 走 IPC 到 main 即可。

**论点 B（main 跑）**：避免 IPC 往返（content-ingest 直接调 noteCap）；batch 大数据传输只走 1 次 IPC（input → main）。

**留下一 sub-phase 拍板**：建议倾向 A（与现状一致 + media-storage 已是 renderer 适合），但 batch 大数据 IPC overhead 需性能压测。

### Q7：split cell 后的"id 上半保留下半新生"在 prosemirror-tables 第三方 plugin 路径的字面落地

**背景**：Q3 调研发现 prosemirror-tables `splitCell` 字面复制 attrs（id 重复），靠 buildAutoBlockIdPlugin descendant 重复检测兜底重生成。**但 plugin 现有重复检测字面只能"重生成新 id"，无法字面保证"上方 cell 保留原 id"**（决议 026 §5.3 split 字面"上半保留 / 下半新"）。

**论点**：第三方 plugin split cell 字面分裂位置可能不在"上方"——splitCell 算法（line 1606-1659）是按 selection rect 把 1 cell 拆 N×M 子 cells，"上半"语义不直接适用。

**留下一 sub-phase 拍板**：决定 split cell 的 id 保留规则（候选：左上角 cell 保留原 id / 全部新生 / 按 selection anchor 位置保留）。本期 5B 不阻塞，按"全部新生"兜底（与 plugin 现有行为一致）。

### Q8：sanitizeAtoms 8 条容错的"前向兼容期"长度

**背景**：契约 v2.1 rename 后，sanitizeAtoms 兼容 `tiptapContent ?? pmContent`。但兼容期持续多久？是否要加 deprecation warning log？

**留下一 sub-phase 拍板**：建议 1 个 V2 release（30-60 天）；过渡期后 sanitizeAtoms 删除 tiptapContent 兼容，老备份 restore 时直接报错。

---

## 节 6：与 5C 的接口

> 5C 范围：paste 跨 note id 共享 bug 修复（调研报告 §7.4 第 10 题 / §6.7）。

### 6.1 5B 与 5C 的关系

**结论：5C 可独立先行，但与 5B 共依赖一个集合定义。**

字面分析：

1. **5C 的核心**：`pasteNote` / `pasteFolderTree`（tree-operations.ts:183 / :236）字面 `JSON.parse(JSON.stringify(src.doc))` → `createNote`；源 doc 已含 ULID；createNote 内 `injectIdsForCreate` 字面 `if (!out.attrs.id)` 不触发重生成 → 新 note 与源 note 字面共享所有 block id（决议 §5.2 字面违反 — 调研报告 §6.7）。
2. **5C 修法（推荐）**：在 paste 路径加一个"force-regen"模式（capability-impl 加 `pasteAndCreateNote(srcDoc, folderId)` API，内部走 `regenerateIdsForPaste(srcDoc)` → `createNote`）。`regenerateIdsForPaste` 与 `buildAutoBlockIdPlugin` 的 paste 路径同模式（descendants 全扫，无条件重生 ULID）。
3. **5C 字面不依赖 5B 任何决策**：
   - 不依赖 5B 的 table atom 化（paste 路径不区分 table 是不是 atom，正反两种实施都需要"全部重生 id"）
   - 不依赖 5B 的 rowIndex/colIndex（paste 出的 cells 走 dissect 期重算）
   - 不依赖 5B 的 content-ingest（paste 路径不经 ingest pipeline，走原 createNote 单条）

### 6.2 共依赖点（字面定义层）

5B Stage 2 收敛后的 `@semantic/types/structural.ts` 的 STRUCTURAL_CONTAINER_TYPES 5 项集合 — **5C 实施 `regenerateIdsForPaste` 时字面需要这个集合**（判断哪些节点该有 id / 哪些不该）。

字面互动：
- **若 5C 先于 5B Stage 2 完成**：5C 字面自己 hardcode 5 项 STRUCTURAL（第 6 处独立定义）；5B Stage 2 完成后回头收敛
- **若 5B Stage 2 先完成**：5C 直接 import `@semantic/types/structural`

**推荐**：5B Stage 1-2（最小路径，~2 天）先做；之后 5C / 5B Stage 3+ 可并行。

### 6.3 5C 与本设计的字面影响

- 5C **不影响** 8 题答案的任何一题
- 5C 实施"capability 层 force-regen-ids paste"路径 → 调研报告 §6.4 "inject 层逻辑双轨"问题 5C 暂时**不解决**（5C 只解 paste 入口，不解一般性双轨）
- 一般性双轨问题字面留更远未来 sub-phase

---

*Stage 5B Design · 2026-05-28 · 设计文档 · 不改 src / 不 commit / 不连 DB / 不动决议*
