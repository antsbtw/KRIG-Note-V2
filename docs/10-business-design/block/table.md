# table — 表格

> **类型**：ContainerBlock（见 `base/container-block.md`）
> **位置**：文档中任意位置
> **定位**：富文本里的表格（Markdown table + 单元格富内容）。**不追 Notion database**——结构化数据查询走 SurrealDB + 独立 `data-view` block（未实现），不在 table block 内模拟数据库。

---

## 一、定义

table 是表格容器——由行（tableRow）和单元格（tableCell / tableHeader）组成的二维结构。底层基于 `prosemirror-tables`。

```
     ┌──────────────┬──────────────┐    ┌───┐
     │ Header A     │ Header B     │    │ + │ ← +col 按钮
     ├──────────────┼──────────────┤    └───┘
     │ Cell 1       │ Cell 2       │
     ├──────────────┼──────────────┤
     │ Cell 3       │ Cell 4       │
     └──────────────┴──────────────┘
     ┌────────────────────────────┐
     │            +               │ ← +row 按钮
     └────────────────────────────┘
```

---

## 二、涉及的 Block 类型

| Block | 类型 | content | 角色 |
|-------|------|---------|------|
| `table` | Container | `tableRow+` | 表格容器 |
| `tableRow` | Container | `(tableCell \| tableHeader)+` | 表格行 |
| `tableCell` | Container | `block+` | 普通单元格 |
| `tableHeader` | Container | `block+` | 表头单元格 |

---

## 三、Schema

实现见 [table.ts](../../src/plugins/note/blocks/table.ts)。

```typescript
// table
nodeSpec: {
  content: 'tableRow+',
  group: 'block',
  tableRole: 'table',
  isolating: true,
}

// tableRow
nodeSpec: {
  content: '(tableCell | tableHeader)+',
  tableRole: 'row',
}

// tableCell / tableHeader
nodeSpec: {
  content: 'block+',
  attrs: {
    colspan:  { default: 1 },
    rowspan:  { default: 1 },
    colwidth: { default: null },    // 列宽数组（像素）
  },
  tableRole: 'cell' | 'header_cell',
  isolating: true,
}
```

**colwidth 持久化**：`prosemirror-tables` 的 `columnResizing` 管理。HTML 属性 `data-colwidth`，渲染时同步到 `<colgroup>` 的 `<col>` 元素。

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: [],        // 表格不能转为其他类型
  canDuplicate: true,  // 整表复制
  canDelete: true,
  canDrag: true,
}
```

（代码里未显式写 `canIndent: false`，但 table 不参与缩进体系——见 §七.1。）

---

## 五、Container 规则

### 5.1 table 自身

子节点由 content 表达式 `tableRow+` 严格约束。这与 `content: 'block+'` 的通用容器（callout / toggleList）不同，**子节点类型固定为 `tableRow`**。

### 5.2 tableCell / tableHeader

```typescript
containerRule: { requiredFirstChildType: undefined }
```

content 是 `block+`，可包含 textBlock / list / image / callout 等任意 Block。单元格是完整的富文本容器。

---

## 六、键盘交互

### 6.1 Enter

| 场景 | 行为 |
|------|------|
| 单元格内 TextBlock 有内容 | 在单元格内分裂 TextBlock（不退出单元格） |
| 单元格内空行 | 在单元格内创建新空行（不退出单元格） |

**关键区别**：table 和 cell 都是 `isolating: true`，Enter 永远不会退出单元格或表格。用户必须通过鼠标点击或方向键离开表格。

### 6.2 Tab / Shift+Tab

实现见 [table.ts:124](../../src/plugins/note/blocks/table.ts#L124)。

| 操作 | 行为 |
|------|------|
| `Tab` | 跳到下一个单元格；在最后一个单元格时自动新增一行 |
| `Shift-Tab` | 跳到上一个单元格 |

**关键区别**：Tab 在表格中用于**单元格间导航**，而非缩进。table 不参与缩进嵌套体系（见 §七.1）。

### 6.3 Backspace（行首）

| 场景 | 行为 |
|------|------|
| 单元格内首个 block 行首 | 无操作（`isolating: true` 阻止跨单元格合并） |
| 单元格内非首 block 行首 | 与上一个 block 合并（在单元格内部） |

---

## 七、不变量适用性

### 7.1 不变量 9（缩进即包含）的例外

table 是不变量 9 的**例外**。子节点组织方式是**二维网格**，包含关系由 Schema 的 content 表达式严格约束（`table > tableRow > tableCell/tableHeader`），而非视觉缩进层级。因此 Tab 用于单元格导航而非缩进操作。

### 7.2 其他不变量

| 不变量 | 适用情况 |
|--------|----------|
| 1. Block 能力不丢失 | ✅ 单元格 `block+`，任何 Block 放入能力保留 |
| 2. Container 能力不丢失 | ✅ table 放入其他 Container 操作保留 |
| 3. 整体移动 | ✅ `canDrag: true`，拖拽整表 |
| 4. 内容合法性 | ✅ 四层 content 表达式严格约束 |
| 5. 位置安全 | ✅ 单元格无必填首子 |
| 6. 格式化不变量 | ✅ 表格不参与格式化命令 |
| 9. 缩进即包含 | ❌ 不适用（见 7.1） |

---

## 八、功能状态（对照代码）

图例：✅ 已实现  🚧 部分/瘸腿  ❌ 未实现

### 8.1 创建

| 功能 | 状态 | 说明 |
|------|------|------|
| Slash `/table` 建表 | ✅ | [SlashMenu.tsx:218](../../src/plugins/note/components/SlashMenu.tsx#L218)；默认 3×3（1 header + 2 data） |
| HandleMenu turn-into table | ✅ | [HandleMenu.tsx:208](../../src/plugins/note/components/HandleMenu.tsx#L208) |
| `insertTable(rows, cols)` 命令 | ✅ | [table/commands.ts](../../src/plugins/note/blocks/table/commands.ts) |
| Markdown pipe 输入规则 `\|a\|b\|` | ❌ | 无 inputRule；Notion/Typora 都有 |
| CSV / TSV 粘贴建表 | ❌ | paste-media.ts 未处理表格剪贴板 |

### 8.2 结构操作

| 功能 | 状态 | 入口 | 说明 |
|------|------|------|------|
| +col 按钮（右侧加列） | ✅ | 悬浮按钮 | [table/view.ts:75](../../src/plugins/note/blocks/table/view.ts#L75) |
| +row 按钮（底部加行） | ✅ | 悬浮按钮 | [table/view.ts:94](../../src/plugins/note/blocks/table/view.ts#L94) |
| Tab 自动加行 + 单元格间导航 | ✅ | 键盘 | [table.ts:126](../../src/plugins/note/blocks/table.ts#L126) `tableKeymapPlugin` 由 `tableBlock.plugin` 注册；[indent.ts](../../src/plugins/note/plugins/indent.ts) 在 tableCell/tableHeader 内放行，让 Tab 继续传给 tableKeymap |
| 列指示器菜单（插/删/复制行列） | ✅ | hover 顶部指示器点击 | [view.ts:194-218](../../src/plugins/note/blocks/table/view.ts#L194) 调用 `addColumnBefore/After` / `deleteColumn` / `duplicateColumn` |
| 行指示器菜单（插/删/复制行列） | ✅ | hover 左侧指示器点击 | 同上，调用 `addRowBefore/After` / `deleteRow` / `duplicateRow` |
| 删除整表 | ✅ | HandleMenu | 通过 `canDelete: true` |
| 复制选中单元格 `duplicateSelectedCells` | ✅ | CellSelection 浮动工具条 | [toolbar.ts](../../src/plugins/note/blocks/table/toolbar.ts) |
| 合并单元格 `mergeCells` | ✅ | CellSelection 浮动工具条 | 同上 |
| 拆分单元格 `splitCell` | ✅ | 光标在已合并 cell 内的浮动工具条 | 同上 |
| 拖拽调换行/列顺序 | ❌ | —— | 需自研 |

### 8.3 列宽 / 行高

| 功能 | 状态 | 说明 |
|------|------|------|
| colwidth 属性 + colgroup 同步 | ✅ | [view.ts:72](../../src/plugins/note/blocks/table/view.ts#L72) |
| 列宽拖拽手柄 CSS | ✅ | [note.css:1351](../../src/plugins/note/note.css#L1351) `.column-resize-handle` |
| `columnResizing` 插件注册 | ✅ | 由 [NoteEditor.tsx:173](../../src/plugins/note/components/NoteEditor.tsx#L173) / [ThoughtEditor.tsx:76](../../src/plugins/thought/components/ThoughtEditor.tsx#L76) 统一注册（不在 `tableBlock.plugin` 里注册，否则会重复实例冲突） |
| 行高调整 | ❌ | —— |

### 8.4 单元格样式

| 功能 | 状态 | 说明 |
|------|------|------|
| 首列加粗 + 深色背景（样式约定） | ✅ CSS | [note.css:1257](../../src/plugins/note/note.css#L1257) |
| Header 行加粗 + 背景 | ✅ CSS | [note.css:1241](../../src/plugins/note/note.css#L1241) |
| 选中 cell 蓝色 overlay | ✅ CSS | `.selectedCell::after` |
| 单元格背景色（per-cell） | ❌ | attrs 无 `background` 字段 |
| 单元格文字色（per-cell） | ❌ | 只能通过文本 mark |
| 对齐方式（左/中/右/两端对齐） | ✅ | tableCell/tableHeader `attrs.align`，通过列/行指示器菜单或 CellSelection 浮动工具条设置；实现见 [table.ts](../../src/plugins/note/blocks/table.ts) + [commands.ts `setCellAlign`](../../src/plugins/note/blocks/table/commands.ts) |
| Header row / column toggle | ❌ | —— |
| 冻结首行 / 首列 | ❌ | 需 sticky CSS + scroll 协同 |

**对齐操作入口**（3 种）：
- **列指示器菜单** → 对齐项对**整列**所有 cell 批量设置
- **行指示器菜单** → 对齐项对**整行**所有 cell 批量设置
- **CellSelection 浮动工具条**（拖选多格或光标在已合并 cell 内）→ 对选区/cell 批量设置

Align 值：`left` / `center` / `right` / `justify` / `null`（清除 = 继承默认）。存储形态：
- Schema 层：`tableCell` / `tableHeader` 的 `attrs.align`
- DOM 层：`<td data-align="center" style="text-align: center">`（同时写 `data-align` 方便 CSS 选择器 + `style` 方便打印/复制）
- Atom 层：`TableCellContent.align`

### 8.5 导入导出

| 功能 | 状态 | 说明 |
|------|------|------|
| Atom ↔ PM 转换 | ✅ | [container-converters.ts:140](../../src/plugins/note/converters/container-converters.ts#L140) |
| HTML `<table>` paste → 表格 | ✅ | [html-to-markdown.ts:140](../../src/plugins/note/paste/html-to-markdown.ts#L140) |
| 选区导出 Markdown | ✅ | [selection-to-markdown.ts:101](../../src/plugins/note/commands/selection-to-markdown.ts#L101) |
| AI 提取表格 → Block | ✅ | [blocks-to-pm-nodes.ts:62](../../src/plugins/note/ai-workflow/blocks-to-pm-nodes.ts#L62) |

### 8.6 交互入口（文档曾规划、代码未落地）

| 功能 | 状态 | 说明 |
|------|------|------|
| 列指示器（table 顶部一列一个） | ❌ | 旧文档提过，代码无 |
| 行指示器（table 左侧一行一个） | ❌ | 同上 |
| 指示器上下文菜单（插/删/复制） | ❌ | 同上 |
| 右键菜单针对 table 的特殊项 | ❌ | [ContextMenu.tsx](../../src/plugins/note/components/ContextMenu.tsx) 无 table 分支 |

---

## 九、视图（NodeView）

实现见 [table/view.ts](../../src/plugins/note/blocks/table/view.ts)。

```
div.table-block-wrapper                ← 外层容器（dom）
├── div.table-block__scroll            ← 水平滚动容器
│   └── table.pm-table                 ← 表格元素
│       ├── colgroup                   ← 列宽定义
│       └── tbody ← contentDOM         ← ProseMirror 管理 tableRow
├── button.table-block__add-col-btn    ← +列（右侧，hover 显示）
└── button.table-block__add-row-btn    ← +行（底部，hover 显示）
```

### 9.1 NodeView 更新策略

- `update()`：节点类型不变时返回 true 接管更新，调用 `updateColumnsOnResize()` 同步 colgroup
- `ignoreMutation()`：忽略 tbody 外部（按钮等）的 DOM 变化

### 9.2 +行 / +列 按钮

- **+列**：点击后选中首行最后一个单元格，执行 `addColumnAfter`
- **+行**：点击后选中最后一行首个单元格，执行 `addRowAfter`
- 只能"之后"插入，不支持"之前"（需行/列指示器 UI，见 §十一.1）

---

## 十、Atom 存储

实际实现见 [container-converters.ts](../../src/plugins/note/converters/container-converters.ts)。

### 10.1 Atom 类型与 parentId 层级

```
type: 'table'        parentId: doc/container
type: 'tableRow'     parentId: table
type: 'tableCell'    parentId: tableRow
type: 'tableHeader'  parentId: tableRow
(cell 内的子 block, 如 textBlock / taskList / image)    parentId: tableCell 或 tableHeader
```

table / tableRow / tableCell / tableHeader **以及 cell 内的每个子 block** 各自是独立 Atom，通过 parentId 建立多层父子关系。

### 10.2 Content 结构

```typescript
interface TableContent {
  colCount: number;             // 从首行推断
  tiptapContent?: PMNodeJSON[]; // PDF 提取路径：整表 PM JSON 内嵌在 content
}

interface TableCellContent {
  colspan?: number;
  rowspan?: number;
  isHeader?: boolean;           // tableHeader 为 true

  /** @deprecated 历史旧数据兼容字段。早期实现把 cell 内 inline 流直接内嵌在此，
   *  导致非 textBlock 的子 block（taskList / image / mathBlock 等）持久化后丢失。
   *  现已改为"子 Atom + parentId"模式。读时若此字段仍有值，toPM 会兼容地吐出单个 textBlock；
   *  再次保存时 toAtom 会按新格式写回，自动升级。 */
  children?: InlineElement[];
}
```

### 10.3 存储模式说明

**当前模式（✅ 正确）**：cell 下的子 block（paragraph、list、image、mathBlock 等）各自作为独立 Atom，通过 parentId 指向 cell Atom。`tableCellConverter.toPM` 通过 `children?: Atom[]` 参数由运行器填充 content，不硬编码 content 形态。

**历史 bug**（见 commit `c8f528b2 fix(note): table cell 富内容持久化`）：旧实现的 `tableCellConverter.toAtom` 只取 cell 内第一个子 block 抽其 inline，`toPM` 硬编码吐出单个 textBlock，导致 taskList / image / bulletList / mathBlock / callout 等放入 cell 后，重启 app 打开文档即消失。现已迁移到"cell 下子 block 作为独立 Atom + parentId"，与 `tableConverter` 一直采用的模式同构。

**对比**：这与 TextBlock 的 `children: InlineElement[]`（inline 流内嵌）是不同的存储模式——TextBlock 内是 inline 级别所以直接内嵌；而 cell 的 content 是 `block+`，子节点是 Block 级别，必须走独立 Atom。

---

## 十一、路线图（按优先级）

### P0 — 必须补齐的富文本表格基本功能

这些是对标 Notion / Word / Google Docs 任何富文本编辑器都该有的操作。当前缺失后，表格只能增不能减、不能合并、不能精细编辑结构。

1. **行 / 列指示器 + 上下文菜单**
   - 表格顶部加一行列指示器、左侧加一列行指示器（hover 显示）
   - 点击指示器弹出菜单：← 左侧插入 / → 右侧插入 / ⧉ 复制 / 🗑 删除（红色）
   - 这是所有行列操作的 UI 入口

2. **接入已有命令**
   - `addRowBefore` / `addRowAfter` / `addColumnBefore` / `addColumnAfter` / `deleteRow` / `deleteColumn`（prosemirror-tables）
   - `duplicateRow` / `duplicateColumn` / `duplicateSelectedCells`（已有命令，只缺 UI）

3. **合并 / 拆分单元格**
   - CellSelection（拖选多格）存在时，上下文菜单显示"合并单元格"
   - 合并后的 cell 右键显示"拆分单元格"
   - 调用 `mergeCells` / `splitCell`（prosemirror-tables 自带）

### P1 — 体验增强

4. **Markdown pipe 输入规则**
   - 输入 `| a | b |` + Enter 自动建表
   - 参考 tiptap-markdown 或自定义 inputRule

5. **CSV / TSV 粘贴建表**
   - paste handler 识别 tab 分隔或 CSV 文本，转 table 节点

6. **单元格样式（per-cell attrs）**
   - `align` ✅ **已完成**（left / center / right / justify，见 §8.4）
   - `background` / `color` ❌ 未实现
   - 接入 HandleMenu 的颜色面板（当前颜色面板只作用在 block 级别，需扩展到 cell 级别）

7. **Header row / Header column toggle**
   - 上下文菜单加"设为表头行 / 表头列"
   - 实现：批量把一行的 tableCell 换成 tableHeader（或反之）

8. ~~**cell 内富内容持久化**~~ ✅ **已完成**（commit `c8f528b2`）
   - cell 的子 block 改为独立 Atom + parentId，见 §10.3

### P2 — 可缓

9. **拖拽调换行 / 列顺序**（指示器 drag handle）
10. **冻结首行 / 首列**（sticky CSS + scroll 协同）
11. **行高调整**（rowheight attr + 拖拽）
12. **排序**（点击 header 排序该列——注意不是 database 级排序，只是客户端一次性排序）

### 明确不做（架构边界）

以下 Notion database 能力**不**在 table block 内实现：

| 能力 | 理由 |
|------|------|
| 列类型系统（text / number / select / date / checkbox / URL / file） | 结构化数据走 SurrealDB |
| 公式列 / 聚合（sum / avg / count） | 同上 |
| 筛选 / 分组 / 多视图（Board / Gallery / Calendar / Timeline） | 同上 |
| 跨文档数据库同步 | 同上 |

**替代方案**：未来开独立的 `data-view` block——查询 SurrealDB、渲染结果为只读表格/看板/图表。它是"数据库查询结果的可视化 block"，和 table block（富文本表格）是两个正交的东西。

---

## 十二、插件注册

遵循**注册制原则**：table 的所有专有插件通过 `BlockDef.plugin` 注册，只有一个不得不手动注册的例外（`columnResizing` 的 PluginKey 约束）。

**(1) BlockDef.plugin** — [table.ts](../../src/plugins/note/blocks/table.ts)（主战场）：

```typescript
plugin: () => [tableEditing(), tableKeymapPlugin(), tableToolbarPlugin()]
// tableEditing         — 单元格选择 / 导航（prosemirror-tables 核心）
// tableKeymapPlugin    — Tab / Shift-Tab 单元格导航 + 末尾 Tab 自动加行
// tableToolbarPlugin   — CellSelection / 合并 cell 浮动工具条
```

NodeView：`nodeViews: { table: tableNodeView }`

**(2) 编辑器装配处的唯一例外** — [NoteEditor.tsx](../../src/plugins/note/components/NoteEditor.tsx) / [ThoughtEditor.tsx](../../src/plugins/thought/components/ThoughtEditor.tsx):

```typescript
columnResizing({ cellMinWidth: 80, View: null as any })
```

**Why columnResizing 必须在编辑器装配处**：它使用全局 `PluginKey('tableColumnResizing$')`，EditorState 中同一 key 只能有一个实例。如果放进 `tableBlock.plugin`，在需要同时支持 NoteEditor 和 ThoughtEditor 的场景下没问题，但一旦 `tableBlock.plugin` 被调用多次（例如重新 build schema），就会产生重复 key 崩溃。集中在编辑器装配处注册，既保证"每个 editor 实例只一个 columnResizing"的技术约束，也不破坏注册制的精神（因为它是 prosemirror-tables 的架构约束，不是业务逻辑）。

**Tab 路由链**（调试时参考）：

```
Tab 键按下
 → indentPlugin.handleKeyDown
     ↓ 检测到光标在 tableCell / tableHeader 内
     ↓ return false（放行，不 preventDefault）
 → blockPlugins（内含 tableKeymapPlugin）
     ↓ tableKeymapPlugin 匹配 Tab
     ↓ goToNextCell(1) / 末尾时 addRowAfter
```

---

## 十三、SlashMenu

```typescript
slashMenu: {
  label: 'Table',
  icon: '▦',
  group: 'basic',
  keywords: ['table', 'grid', '表格'],
  order: 12,
}
```

插入后光标定位到第一个 header cell。

---

## 十四、BlockDef（当前代码）

见 [table.ts](../../src/plugins/note/blocks/table.ts)。四个 BlockDef：`tableBlock` / `tableRowBlock` / `tableCellBlock` / `tableHeaderBlock`，其中只有 `tableBlock` 有 slashMenu，其余子节点 `slashMenu: null`。所有四个都声明了 `cascadeBoundary: true`（见 [types.ts](../../src/plugins/note/types.ts) 的 `BlockCapabilities`），表示 `deleteBlockAt` / `cascadeDeleteAtChild` 遇到这类结构骨架容器时停止向上级联，也拒绝把它们的唯一子删空。

---

## 十五、设计原则

1. **四个 Block 协同**——table / tableRow / tableCell / tableHeader 各自独立注册
2. **单元格是 Container**——`block+` content，可嵌任意 Block
3. **复用 prosemirror-tables**——不重复造轮子
4. **isolating 隔离**——table 和 cell 都是 `isolating: true`，键盘不会意外跨边界
5. **二维网格例外**——不参与缩进体系，Tab 用于单元格导航
6. **富文本定位**——表格就是表格，不模拟数据库；结构化数据走 SurrealDB + 独立 block
