# KRIG Note Schema Reference

> 本文档是 ProseMirror schema 的完整索引。所有 PM 通用操作（粘贴、回车、删除、拖拽、合并、分裂）的行为都由这些定义决定。修改任何 block 的 `content`、`group`、`isolating`、`defining` 时必须评估对通用操作的影响。
>
> 最后更新：2026-04-17

---

## 一、顶层结构

| 节点 | content | 说明 |
|------|---------|------|
| `doc` | `block+` | 文档根节点，至少一个 block |
| `text` | — | PM 内置文本节点，group: `inline` |

---

## 二、Block 节点

### 2.1 基础文本

| 节点 | content | group | defining | isolating | 说明 |
|------|---------|-------|----------|-----------|------|
| `textBlock` | `inline*` | `block` | ✓ | — | 段落/标题，level=0 为普通段落，1-3 为标题 |

### 2.2 列表容器

| 节点 | content | group | defining | isolating | 说明 |
|------|---------|-------|----------|-----------|------|
| `bulletList` | `block+` | `block` | ✓ | — | 无序列表 |
| `orderedList` | `block+` | `block` | ✓ | — | 有序列表 |
| `taskList` | `taskItem+` | `block` | — | — | 任务列表 |
| `taskItem` | `block+` | — | ✓ | — | 任务列表子项，不在 block group 中 |
| `toggleList` | `block+` | `block` | ✓ | — | 折叠列表 |

### 2.3 引用/容器

| 节点 | content | group | defining | isolating | 说明 |
|------|---------|-------|----------|-----------|------|
| `blockquote` | `block+` | `block` | ✓ | — | 引用块 |
| `callout` | `block+` | `block` | — | — | 提示块（emoji + 背景色）|
| `frameBlock` | `block+` | `block` | ✓ | — | 彩色边框容器 |

### 2.4 布局

| 节点 | content | group | defining | isolating | 说明 |
|------|---------|-------|----------|-----------|------|
| `columnList` | `column{2,3}` | `block` | — | ✓ | 多列布局容器 |
| `column` | `block+` | — | — | ✓ | 列容器，不在 block group 中 |

### 2.5 代码/数学

| 节点 | content | group | defining | isolating | 说明 |
|------|---------|-------|----------|-----------|------|
| `codeBlock` | `text*` | `block` | ✓ | — | 代码块 |
| `mathBlock` | `text*` | `block` | ✓ | — | 数学公式块（LaTeX）|

### 2.6 媒体（RenderBlock 子类）

| 节点 | content | group | defining | isolating | selectable | 说明 |
|------|---------|-------|----------|-----------|------------|------|
| `image` | `textBlock` | `block` | — | — | ✓ | 图片，caption 为恰好一个 textBlock |
| `videoBlock` | `textBlock` | `block` | — | — | ✓ | 视频，caption 为恰好一个 textBlock |
| `audioBlock` | `textBlock` | `block` | — | — | ✓ | 音频，caption 为恰好一个 textBlock |
| `tweetBlock` | `textBlock` | `block` | — | — | ✓ | 推文嵌入，caption 为恰好一个 textBlock |

### 2.7 文件/引用（RenderBlock 子类）

| 节点 | content | group | defining | isolating | selectable | 说明 |
|------|---------|-------|----------|-----------|------------|------|
| `fileBlock` | `text*` | `block` | — | — | ✓ | 文件附件 |
| `externalRef` | `text*` | `block` | — | — | ✓ | 外部链接引用 |

### 2.8 表格

| 节点 | content | group | defining | isolating | 说明 |
|------|---------|-------|----------|-----------|------|
| `table` | `tableRow+` | `block` | — | ✓ | 表格 |
| `tableRow` | `(tableCell \| tableHeader)+` | — | — | — | 表格行 |
| `tableCell` | `block+` | — | — | ✓ | 表格单元格 |
| `tableHeader` | `block+` | — | — | ✓ | 表格表头单元格 |

### 2.9 原子节点

| 节点 | content | group | atom | 说明 |
|------|---------|-------|------|------|
| `horizontalRule` | — | `block` | ✓ | 分割线 |
| `pageAnchor` | — | `block` | ✓ | 页面锚点 |

---

## 三、Inline 节点

| 节点 | group | atom | 说明 |
|------|-------|------|------|
| `text` | `inline` | — | 纯文本 |
| `hardBreak` | `inline` | — | 行内换行 |
| `mathInline` | `inline` | — | 行内数学公式 |
| `noteLink` | `inline` | — | 笔记间链接 |

---

## 四、Marks

| Mark | attrs | inclusive | 说明 |
|------|-------|-----------|------|
| `bold` | — | ✓ | 加粗 |
| `italic` | — | ✓ | 斜体 |
| `code` | — | ✓ | 行内代码 |
| `underline` | — | ✓ | 下划线 |
| `strike` | — | ✓ | 删除线 |
| `link` | `href`, `title?` | ✗ | 链接 |
| `textStyle` | `color?` | ✓ | 文字颜色 |
| `highlight` | `color` | ✓ | 背景高亮 |
| `thought` | `thoughtId`, `thoughtType` | ✗ | Thought 标注锚点 |

---

## 五、Schema 约束对 PM 通用操作的影响

### 5.1 content 表达式含义

| 表达式 | 含义 | 粘贴行为 | 回车行为 |
|--------|------|----------|----------|
| `inline*` | 零或多个 inline 节点 | 文字溶入 | 分裂为新 block |
| `text*` | 零或多个文本节点（无 inline atom）| 纯文本插入 | 取决于 keymap |
| `block+` | 一或多个 block 节点 | block 级粘贴 | 在容器内新建 block |
| `textBlock` | **恰好一个** textBlock | ⚠️ 见 5.2 | ⚠️ 见 5.2 |
| `column{2,3}` | 2-3 个 column 节点 | 受限 | 不分裂 |

### 5.2 `content: 'textBlock'` 的风险

当前 `image`、`videoBlock`、`audioBlock`、`tweetBlock` 使用 `content: 'textBlock'`（恰好一个子节点）。

这意味着 PM 认为这些节点**只能容纳一个 textBlock**：

- **粘贴**：如果粘贴内容无法溶入现有 textBlock（如粘贴多段、或 Slice 是 closed 的），PM 会向上提升替换范围，可能导致**父节点（image）被整体替换/删除**
- **回车**：在 caption 里按回车会尝试分裂 textBlock，但父节点不接受第二个 textBlock，PM 的行为不可预测
- **拖拽**：拖入 block 到 caption 位置会失败或提升

**是否应该改为 `textBlock+`？** 需要评估：如果 caption 语义上只允许一行文字，用 `textBlock` 是正确的，但需要接受上述约束；如果允许多行，应改为 `textBlock+`。这个决策影响所有通用操作的行为。

### 5.3 `defining: true` 的含义

当一个节点标记为 `defining`，PM 在该节点内执行分裂（回车）时会保留外层容器类型。例如在 `bulletList > textBlock` 内回车，新段落仍在 `bulletList` 内。

当前标记 `defining` 的节点：`textBlock`、`bulletList`、`orderedList`、`toggleList`、`blockquote`、`frameBlock`、`codeBlock`、`mathBlock`、`taskItem`。

### 5.4 `isolating: true` 的含义

当一个节点标记为 `isolating`，光标无法通过方向键/退格键跨出该节点。PM 的 `joinBackward` 等命令在该边界停止。

当前标记 `isolating` 的节点：`columnList`、`column`、`table`、`tableCell`、`tableHeader`。

---

## 六、通用 attrs（自动注入）

所有 `group: 'block'` 的节点由 `registry.buildSchema()` 自动注入：

| attr | default | 说明 |
|------|---------|------|
| `indent` | `0` | 视觉缩进级别 |
| `fromPage` | `null` | 来源页码（eBook ↔ Note 锚定）|

---

## 七、检查清单

修改 schema 时请逐项确认：

- [ ] `content` 表达式是否正确描述了该节点能容纳的子节点？
- [ ] 如果用了 `'textBlock'`（恰好一个），是否接受粘贴/回车/拖拽的限制？
- [ ] 如果用了 `'block+'`，是否允许任意 block 嵌套？
- [ ] `defining` 是否正确？（回车时是否应该保留容器？）
- [ ] `isolating` 是否正确？（光标是否应该被限制在容器内？）
- [ ] 新增节点是否在正确的 `group` 中？
- [ ] `selectable` / `draggable` / `atom` 是否符合交互预期？
