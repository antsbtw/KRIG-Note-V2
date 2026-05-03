# Block Action — Block 级操作层

> **类型**：NoteView 框架级模块
> **位置**：`src/plugins/note/block-ops/block-action.ts`
> **状态**：设计中

---

## 一、定义

Block Action 是 NoteView 框架的**操作层**——统一管理所有 Block 级操作。

它是菜单系统（Handle / ContextMenu）和底层 ProseMirror Transaction 之间的中间层：

```
菜单系统（UI 触发）
  │
  ├── Handle 点击 "Delete"     → blockAction.delete(view, pos)
  ├── Handle 点击 "Duplicate"  → blockAction.duplicate(view, pos)
  ├── Handle 点击 "Turn into"  → blockAction.turnInto(view, pos, targetType)
  ├── Handle 拖拽              → blockAction.move(view, fromPos, toPos)
  ├── ContextMenu "Cut"        → blockAction.cut(view)
  ├── ContextMenu "Copy"       → blockAction.copy(view)
  ├── 快捷键 Cmd+X             → blockAction.cut(view)
  ├── 快捷键 Delete            → blockAction.delete(view, selectedPositions)
  │
  ▼
Block Action（操作层）
  │
  ├── 检查 Block 的 capabilities（能不能做这个操作）
  ├── 构建 ProseMirror Transaction
  ├── 处理容器约束（ContainerRule）
  │
  ▼
ProseMirror（数据层）
  └── view.dispatch(tr)
```

**菜单组件不直接操作 ProseMirror。** 菜单只调用 `blockAction.xxx()`，操作逻辑集中在 Block Action 层。

---

## 二、API

```typescript
interface BlockActionAPI {
  // ── 选中 ──
  select(view: EditorView, pos: number): void;        // ESC / 双击触发
  selectMulti(view: EditorView, positions: number[]): void;  // Shift+↑/↓
  clearSelection(view: EditorView): void;
  getSelectedPositions(view: EditorView): number[];

  // ── 删除 ──
  delete(view: EditorView, pos: number): void;
  deleteSelected(view: EditorView): void;

  // ── 剪贴板（Block 级） ──
  cut(view: EditorView): void;           // 智能：有 Block 选中时操作 Block
  copy(view: EditorView): void;          // 智能：有 Block 选中时操作 Block
  paste(view: EditorView, pos: number): void;  // 智能：有 Block 剪贴板时粘贴 Block

  // ── 移动 ──
  move(view: EditorView, fromPos: number, toPos: number): void;  // Handle 拖拽

  // ── 类型转换 ──
  turnInto(view: EditorView, pos: number, targetType: string, attrs?: Record<string, unknown>): void;

  // ── 缩进 ──
  indent(view: EditorView, pos: number): void;    // Tab / 右键菜单
  outdent(view: EditorView, pos: number): void;   // Shift+Tab / 右键菜单
}
```

---

## 三、操作明细

### 3.1 select — 选中 Block

| 维度 | 说明 |
|------|------|
| 触发 | **ESC**（选中光标所在 Block）/ **双击**（选中双击所在 Block） |
| 行为 | 给 Block 添加选中样式（蓝色边框），隐藏文本光标 |
| 多选 | **Shift+↑/↓** 扩展选中到相邻 Block |
| 退出 | **单击编辑器任意位置** / **ESC**（已选中时）/ **输入字符** / **方向键** |

**选中状态由 Plugin 管理**（`blockSelectionPlugin`），不存储在 ProseMirror 文档中。

### 3.2 delete — 删除 Block

| 维度 | 说明 |
|------|------|
| 触发 | Handle 菜单 "Delete" / 选中后按 Delete/Backspace |
| 前置检查 | `capabilities.canDelete === true` |
| 行为 | `tr.delete(pos, pos + node.nodeSize)` |
| 特殊 | noteTitle 不可删除（canDelete=false） |

### 3.3 indent / outdent — 缩进

| 维度 | indent | outdent |
|------|--------|---------|
| 触发 | Tab / 右键菜单 "Indent" | Shift+Tab / 右键菜单 "Outdent" |
| 前置检查 | `capabilities.canIndent === true` | `capabilities.canIndent === true` |
| 行为 | 列表：嵌套为子列表 / 通用：增加 indent attr | 列表：提升层级 / 通用：减少 indent attr |

### 3.4 cut / copy / paste — Block 级剪贴板

| 操作 | 触发 | 行为 |
|------|------|------|
| cut | 选中 Block 后 Cmd+X | 复制 Block JSON 到内部剪贴板 + 删除 Block |
| copy | 选中 Block 后 Cmd+C | 复制 Block JSON 到内部剪贴板 |
| paste | Cmd+V（内部剪贴板有 Block 数据时） | 在光标位置插入 Block |

**内部剪贴板**：Block 级的剪贴板独立于系统剪贴板。存储 ProseMirror Node 的 JSON 表示。

```typescript
// 内部剪贴板
let blockClipboard: PMNodeJSON[] | null = null;
```

当系统剪贴板有纯文本时，走正常的文字粘贴。当内部剪贴板有 Block 数据时，优先粘贴 Block。

### 3.5 move — 移动 Block

| 维度 | 说明 |
|------|------|
| 触发 | Handle 拖拽 |
| 前置检查 | `capabilities.canDrag === true` |
| 行为 | 删除原位置 Block + 在目标位置插入 |
| Container | Container 整体移动（容器 + 所有子节点） |

### 3.6 turnInto — 类型转换

| 维度 | 说明 |
|------|------|
| 触发 | Handle 菜单 "Turn into xxx" / SlashMenu |
| 前置检查 | `capabilities.turnInto` 包含目标类型 |
| 行为 | 替换 Block 的类型，保留文本内容 |
| 容器约束 | 通过 ContainerRule 检查（applyBlockReplace） |

```
paragraph "Hello" → turnInto heading {level:1} → heading "Hello"
paragraph "Hello" → turnInto codeBlock → codeBlock "Hello"
```

---

## 四、Block Selection Plugin

Block 选中状态由一个框架级 Plugin 管理：

```typescript
// plugins/block-selection.ts
interface BlockSelectionState {
  selectedPositions: number[];   // 选中的 Block 位置列表
  active: boolean;               // 是否处于选中模式
}
```

### 选中模式的行为

| 按键 | 行为 |
|------|------|
| Delete / Backspace | 删除所有选中的 Block |
| Cmd+C | 复制选中的 Block |
| Cmd+X | 剪切选中的 Block |
| Escape | 取消选中 |
| 方向键 | 取消选中，光标移到对应位置 |
| 任意字符输入 | 取消选中，开始编辑 |

### 视觉

```css
/* 选中的 Block */
.block-selected {
  outline: 2px solid #4a9eff;
  outline-offset: 2px;
  border-radius: 4px;
}

/* 选中模式下隐藏文本光标 */
.block-selection-active .ProseMirror {
  caret-color: transparent;
}
.block-selection-active .ProseMirror ::selection {
  background: transparent;
}
```

---

## 五、与菜单系统的关系

| 菜单 | 调用的 Block Action |
|------|-------------------|
| **Handle 菜单** | delete / turnInto |
| **Handle 拖拽** | move |
| **ContextMenu** | 智能 cut/copy/paste（有 Block 选中 = Block 级，否则 = 文字级）+ delete / indent / outdent |
| **快捷键 ESC** | select（进入 Block 选中模式） |
| **快捷键 Shift+↑/↓** | selectMulti（多选） |
| **快捷键 Cmd+C/X** | copy / cut（选中模式下 = Block 级） |
| **SlashMenu** | 不经过 Block Action（直接创建新 Block） |

**智能菜单**：ContextMenu 根据是否有 Block 选中来决定操作对象。有 Block 选中 = Block 级操作 + 额外显示 Delete/Indent/Outdent。

---

## 六、与 Capabilities 的关系

每个 Block Action 执行前检查 capabilities：

```typescript
function deleteBlock(view: EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;

  const blockDef = blockRegistry.get(node.type.name);
  if (!blockDef?.capabilities.canDelete) return;  // 前置检查

  const tr = view.state.tr.delete(pos, pos + node.nodeSize);
  view.dispatch(tr);
}
```

**Block Action 不盲目执行——先问 Block "你能不能被这样操作"。**

---

## 七、文件结构

```
src/plugins/note/
├── block-ops/
│   ├── block-action.ts          ← Block Action API（本文件）
│   ├── block-selection.ts       ← Block Selection Plugin（选中状态管理）
│   └── turn-into.ts             ← turnInto 的具体实现（未来）
```

---

## 八、实施顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | `block-action.ts` — delete / duplicate | 无 |
| 2 | 改造 HandleMenu / ContextMenu 调用 block-action | 步骤 1 |
| 3 | `block-selection.ts` — 选中模式 Plugin | 步骤 1 |
| 4 | Block 级 cut / copy / paste | 步骤 3 |
| 5 | Handle 拖拽 move | 步骤 3 |
| 6 | turnInto 实现 | 步骤 1 |

---

## 九、设计原则

1. **菜单不碰 Transaction**：菜单组件只调用 `blockAction.xxx()`，不直接构建 ProseMirror Transaction
2. **Capabilities 守门**：每个操作执行前检查 Block 的 capabilities 声明
3. **Container 整体性**：delete / move / copy 等操作作用于 Container 时，整体处理（容器 + 全部子节点）
4. **选中与编辑互斥**：Block 选中模式下，文本编辑不可用；开始编辑时选中自动取消
5. **Block 剪贴板独立**：Block 级 cut/copy/paste 使用内部剪贴板，不干扰系统剪贴板
6. **操作可撤销**：所有 Block Action 产生的 Transaction 可通过 Cmd+Z 撤销
