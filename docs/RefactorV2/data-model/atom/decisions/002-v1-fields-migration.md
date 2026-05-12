# Decision 002 — V1 atom-types.ts 每个字段的 V2 归属判定

> **状态**：草拟中（待审阅）
> **日期**：2026-05-11
> **影响**：`atom/spec.md` + 未来的 `src/semantic/` 实施

---

## 背景

V1 `src/shared/types/atom-types.ts`（484 行）是 V2 Atom 建模的参考起点，但 V1 的 Atom 接口违反了 V2 三层架构的多条原则：

- V1 Atom 顶层有 `frame` 字段（color / style / groupId / thoughtId）—— **视图特性**，违反原则 1。
- V1 Atom 顶层有 `meta.nodeIds`（关联渲染节点）—— **渲染层引用**，违反原则 1。
- V1 用 `parentId + order` 平铺嵌套 —— V2 架构定义嵌套通过 `content` 字段（PM node JSON 风格）。
- V1 的 `AtomContent` 30+ 变体把"block 类型"塞进 atom 字段 —— 按 V2 charter.md §4，block 是 pm domain 内部的语义组合，**不是** atom 字段。

本决议按 V2 三层架构原则 + decision 003（走法 B），逐项判定 V1 每个字段在 V2 的归属。

---

## 判定分类

| 标签 | 含义 |
|---|---|
| **A. 保留** | 进入 V2 atom 数据（按 V2 形态适配） |
| **B. 实体元属性** | 移到 atom 实体壳（存储层包裹，不属于 atom 数据） |
| **C. 视图层** | 视图特性 / 渲染状态，剥离到对应视图索引 |
| **D. Block 概念** | 不是 atom 字段，是 block 类型清单（pm domain 内部） |
| **E. 跨 atom 关系** | 不在 atom 字段里，走 SurrealDB RELATE 边 |
| **F. 删除** | 违反原则 / 历史包袱，V2 不带过来 |

---

## V1 Atom 主接口字段判定

V1 [`atom-types.ts:14-33`](../../../../../../KRIG-Note/src/shared/types/atom-types.ts#L14-L33)：

```ts
export interface Atom {
  id: string;
  type: AtomType;
  content: AtomContent;
  parentId?: string;
  order?: number;
  links?: string[];
  from?: FromReference;
  frame?: { color, style, groupId, thoughtId };
  meta: AtomMeta;
}
```

| V1 字段 | V2 处置 | 标签 | 理由 |
|---|---|---|---|
| `id` | 移到 atom 实体壳 | **B** | id 是实体身份，不是数据形态。Atom 数据本身（PM node JSON）不持有自己的 id。 |
| `type` | 保留，作为 `PmPayload.type` | **A** | V2 pm domain 的 PM node JSON `type` 字段。 |
| `content` | **形态变化** —— V1 是 `AtomContent` 大杂烩，V2 是 `PmPayload.content?: PmPayload[]`（PM 嵌套） | **A**（部分） + **D**（部分） | V1 的 `AtomContent` 30+ 变体本质是 block 类型清单，应在 block 注册表登记。V2 pm atom 自身的 `content` 字段是嵌套子节点数组。 |
| `parentId` | 删 | **F** | V2 嵌套通过 PM `content` 字段实现（pm domain），不需要 parentId。 |
| `order` | 删 | **F** | 同上。同级顺序由数组下标隐含表达。 |
| `links` | 移到 SurrealDB 边 | **E** | 按 decision 003 走法 B，所有非本体属性走边。atom 间引用走 `user:linksTo` 边（约定俗成省略 vocabulary 段）。 |
| `from` | 移到 SurrealDB 边 | **E** | 按 decision 003 走法 B 拍板：来源追溯走 `prov:wasInformedBy` / `prov:wasDerivedFrom` 边，不在 atom 字段里。区分：git 风格用户主动派生用 `user:prov:wasDerivedFrom`，AI / 系统自动追溯用 `ai:prov:wasInformedBy` / `user:prov:wasInformedBy`。 |
| `frame` | 全部剥离 | **C** | color / style / groupId / thoughtId 全部是视图特性，违反原则 1。color/style 归视图局部状态或视图索引格式；thoughtId 归 Thought 系统（Phase 2 决议）。 |
| `meta` | 见下方 AtomMeta 拆解 | 各项分别处置 | — |

---

## V1 AtomMeta 字段判定

V1 [`atom-types.ts:35-40`](../../../../../../KRIG-Note/src/shared/types/atom-types.ts#L35-L40)：

```ts
export interface AtomMeta {
  createdAt: number;
  updatedAt: number;
  nodeIds?: string[];
  dirty: boolean;
}
```

| V1 字段 | V2 处置 | 标签 | 理由 |
|---|---|---|---|
| `createdAt` | 移到 atom 实体壳 | **B** | 实体元属性，由存储层负责。具体 schema 待 Phase 3 persistence 决议。 |
| `updatedAt` | 同上 | **B** | 同上。 |
| `nodeIds` | 删 | **F** | 渲染节点关联，**严重违反原则 1**（语义层不知道渲染层）。 |
| `dirty` | 删 | **F** | 同步/渲染状态，**违反原则 1**。视图自己持有 dirty 标记即可。 |

---

## V1 FromReference 字段判定

V1 [`atom-types.ts:46-84`](../../../../../../KRIG-Note/src/shared/types/atom-types.ts#L46-L84)：完整结构（extractionType + pdfBookId/pdfPage/url/conversationId/epubCfi/citation 等）。

**整体处置**：保留概念，**全部走边**（按 decision 003 走法 B 拍板）。

具体边：

| V1 字段 | V2 边形态（典型示例） |
|---|---|
| `extractionType: 'manual'` | 无对应边（用户手动输入 = 无来源边） |
| `extractionType: 'pdf'` + `pdfBookId` + `pdfPage` + `pdfBbox` | `user:prov:wasInformedBy` 或 `ai:prov:wasInformedBy` → ebook atom，attrs 含 pdfPage / pdfBbox |
| `extractionType: 'web'` + `url` + `pageTitle` | `*:prov:wasInformedBy` → web-resource atom，attrs 含 pageTitle |
| `extractionType: 'ai-conversation'` + `conversationId` + `messageIndex` | `ai:prov:wasInformedBy` → conversation atom，attrs 含 messageIndex |
| `extractionType: 'epub'` + `epubBookId` + `epubCfi` | `*:prov:wasInformedBy` → ebook atom，attrs 含 epubCfi |
| `extractionType: 'clipboard'` | 视场景决定（可省略，仅记录用户操作） |
| `citation { title, author, publisher, year, page, doi, accessedAt }` | citation 数据可挂边 attrs，或单独作为一个 atom（如 `rdf` domain 的引用记录） |

**关键改进**（相比 V1）：

1. 来源 atom（ebook / web-page / conversation）独立成实体，**多个 atom 共享同一来源**时不再冗余存储 pdfBookId。
2. 跨视图查询"哪些 atom 来自这本书" → SurrealDB 反向查 `*:prov:wasInformedBy` 入边，O(1)。
3. 用户 / AI 主动权区分：`user:` 段表示用户手动标注，`ai:` 段表示 AI 自动追溯（可被用户确认升级为 `user:`）。

→ 具体 schema 在 Phase 2 `relations/pm-source.md` 展开。

---

## V1 AtomType 枚举字段判定

V1 [`atom-types.ts:90-141`](../../../../../../KRIG-Note/src/shared/types/atom-types.ts#L90-L141)：四类枚举（TextAtomType / ContainerAtomType / RenderAtomType / SpecialAtomType），共 30+ 类型。

**整体处置**：**这是 block 类型清单，不是 atom 字段**。标签 **D**。

V2 处置：
- 全部移到 `block-registry`（由 `capability.text-editing` 等表征类能力提供）。
- 每种 block 在 registry 里注册：`{ type, attrs schema, allowed content }`。
- spec 在 `atom/spec.md §2.2` 给概念定义，**具体清单**在 `relations/pm-note.md`（Phase 2）展开。

V1 → V2 映射示例（不展开全部，仅举例）：

| V1 AtomType | V2 block type 名称 | V2 处置 | 状态 |
|---|---|---|---|
| `paragraph` | `paragraph` | 沿用 PM 标准命名（不再叫 textBlock） | **✅ 已实施**（decision 005）|
| `heading` | `heading` | 沿用 PM 标准命名，attrs 含 level（范围扩到 1-6） | **✅ 已实施**（decision 005 D2）|
| `noteTitle` | `paragraph.attrs.isTitle: true` | 不再是独立节点，归 paragraph 特殊形态 | **✅ 已实施**（decision 005 D1）|
| `bulletList` / `orderedList` | `bulletList` / `orderedList` | 直搬，camelCase 命名（V2 现状） | V2 已实现 |
| `listItem` | `listItem` | **删除 children 兼容字段**（V1 @deprecated），改用 PM 嵌套 | V2 已实现 |
| `taskList` / `taskItem` | `taskList` / `taskItem` | 同上 | V2 已实现 |
| `blockquote` / `callout` / `toggleList` / `toggleItem` | 同名 | 直搬 | V2 已实现 |
| `frameBlock` | **删除** | V2 用视图层 frame 实现（违反原则 1） | 提案 |
| `table` / `tableRow` / `tableCell` / `tableHeader` | 同名 | 直搬，删 tableCell.children 兼容字段 | V2 已实现 |
| `columnList` / `column` | 同名 | 直搬 | 提案 |
| `codeBlock` / `mathBlock` / `mathVisual` | 同名 | 直搬 | V2 已实现（含 mathVisual 占位）|
| `image` / `figure` / `video` / `audio` / `tweet` | 同名 | 直搬 | V2 已实现 |
| `fileBlock` / `externalRef` / `htmlBlock` | 同名 | 直搬 | V2 已实现（htmlBlock 待 Phase 2c 确认）|
| `horizontalRule` / `hardBreak` / `document` / `pageAnchor` | 同名 | 直搬 | V2 已实现 |

具体每个 block 的 attrs schema 在 `relations/pm-note.md`（Phase 2）展开。

---

## V1 AtomContent 字段判定

V1 [`atom-types.ts:147-390`](../../../../../../KRIG-Note/src/shared/types/atom-types.ts#L147-L390)：30+ 内容结构（ParagraphContent / HeadingContent / ListContent 等）。

**整体处置**：**这是 block 的 attrs schema，不是 atom 字段**。标签 **D**。

每个 V1 ContentInterface 拆为 V2 block 的：
- 顶层属性 → block 的 `attrs`（如 `HeadingContent.level` → `headingBlock.attrs.level`）。
- `children: InlineElement[]` → block 的 `content`（PM 嵌套）。

**逐项处置**（仅列重要项 + 全部 @deprecated 字段）：

| V1 Content 接口 | V2 处置 | 状态 |
|---|---|---|
| `ParagraphContent.{children, textIndent, indent, align}` | paragraph.attrs: 当前仅 `isTitle`；textIndent / indent / align 待 Phase 2c TextFlowAttrs Mixin 决议时引入 | ✅ paragraph 节点已实施（decision 005），TextFlowAttrs 待 Phase 2c |
| `HeadingContent.{level, children, ...}` | heading.attrs: `level: 1-6`（默认 1）；其他字段（textIndent/indent/align）同上 | ✅ heading 节点已实施（decision 005 D2），其余待 Phase 2c |
| `ListItemContent.children` | **删**（V1 @deprecated 兼容字段）。V2 listItem 子 block 走 content 嵌套。 | V2 已实现 |
| `ListItemContent.{checked, createdAt, completedAt, deadline}` | listItem.attrs（任务项专用字段保留） | 提案；deadline → due 待 Phase 2c |
| `TableCellContent.children` | **删**（V1 @deprecated 兼容字段）。V2 tableCell 子 block 走 content 嵌套。 | V2 已实现 |
| `TableCellContent.{colspan, rowspan, isHeader, align}` | tableCell.attrs | V2 已实现 |
| 其余 30+ 接口 | 按"V1 字段 → V2 attrs"机械迁移 | 部分已实施 |

---

## V1 InlineElement / Mark 判定

V1 [`atom-types.ts:396-454`](../../../../../../KRIG-Note/src/shared/types/atom-types.ts#L396-L454)：

| V1 类型 | V2 处置 | 标签 |
|---|---|---|
| `TextNode { type: 'text', text, marks? }` | 直搬到 PmPayload（type='text'）| **A** |
| `MathInline { type: 'math-inline', latex }` | V2 命名 `mathInline`，latex → attrs | **A**（命名调整） |
| `CodeInline { type: 'code-inline', code }` | V2 命名 `codeInline`，code → attrs | **A**（命名调整） |
| `LinkNode { type: 'link', href, title?, children }` | V2 改为 Mark（PM 风格，link 是 mark 不是 node）| **A**（结构调整） |
| `NoteLinkNode { type: 'note-link', noteId, title }` | V2 命名 `noteLink`，attrs={noteId, title}；可选改 Mark | **A**（命名调整） |
| `FileLinkNode { type: 'file-link', src, filename }` | V2 命名 `fileLink`，attrs={src, filename} | **A**（命名调整） |
| `MentionNode { type: 'mention', targetId, label }` | 直搬，attrs={targetId, label} | **A** |

Mark 类型：

| V1 Mark | V2 处置 |
|---|---|
| `bold / italic / underline / strike / code` | 直搬 |
| `highlight { color? }` | 改为 `highlight { attrs: { color? } }`（PM 风格） |
| `textStyle { color? }` | 改为 `textStyle { attrs: { color? } }` |
| `thought { thoughtId, thoughtType?, anchorType? }` | **待 Phase 2 决议**（V2 是否引入 Thought 系统） |

---

## V1 工具函数判定

V1 [`atom-types.ts:460-483`](../../../../../../KRIG-Note/src/shared/types/atom-types.ts#L460-L483)：

| V1 函数 | V2 处置 |
|---|---|
| `generateAtomId` | 移到 atom 实体壳（存储层负责），具体策略 Phase 3 决议（ULID / UUID v7 / 保留 V1 风格） |
| `createAtom` | V2 改为 `createPmAtom(payload: PmPayload): Atom<'pm'>` 等 domain-specific 工厂 |

---

## 影响清单

如本决议获批：

1. **V2 atom spec 形态** = Phase 1 完成的 `atom/spec.md` 已对齐本决议。
2. **V2 不复制 V1 兼容字段** —— `ListItemContent.children`、`TableCellContent.children` 不带过来。
3. **V2 atom 数据 = 纯 PM node JSON** —— 没有 `id / parentId / order / meta / frame` 顶层字段。
4. **V2 block 类型清单** = Phase 2 在 `relations/pm-note.md` 展开（含 attrs schema）。
5. **V2 atom 实体壳** = Phase 3 在 `persistence/` 决议（id / 时间戳 / dirty 等）。
6. **来源追溯 / atom 间引用** = Phase 2 在 `relations/` 决议（atom 字段 vs RELATE 边）。
7. **V2 当前代码对齐** —— `src/capabilities/text-editing/types.ts:65-72` 的 `AtomInput` 改名为 `Atom<'pm'>`，**实施留到 Phase 2 之后**。

---

## 待审阅人确认

- [ ] 标签分类（A/B/C/D/E/F）合理
- [ ] V1 主接口字段判定无异议
- [ ] V1 AtomMeta 完全剥离（nodeIds / dirty 删，时间戳移实体壳）无异议
- [ ] V1 AtomType / AtomContent 全部归为"block 类型"概念无异议
- [ ] Mark.thought 留待 Phase 2 决议
- [ ] FromReference 留待 Phase 2 决议（atom 字段 vs RELATE 边）
