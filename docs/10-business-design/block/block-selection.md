# Block Selection — Block 级选中系统

> **类型**：框架级 Plugin
> **位置**：`src/plugins/note/plugins/block-selection.ts`
> **状态**：已实现
> **依赖**：`block-action.md`（操作层）、`base/base-classes.md`（基类共享能力）

---

## 一、定义

Block Selection 是编辑器的 **Block 级选中模式**——选中一个或多个 Block 进行批量操作（删除、复制、剪切、拖拽移动）。

它与文本选区（TextSelection）互斥：进入 Block 选中模式时，文本光标隐藏、文本选区清除；开始编辑时自动退出 Block 选中模式。

```
文本编辑模式（默认）
  │
  │ ESC
  ▼
Block 选中模式
  │
  │ Enter / 任意字符 / 单击
  ▼
文本编辑模式
```

---

## 二、状态模型

```typescript
interface BlockSelectionState {
  active: boolean;               // 是否处于选中模式
  selectedPositions: number[];   // 选中的 Block 的文档位置列表
  anchorPos: number | null;      // Shift+Arrow 范围选择的锚点
}
```

- `selectedPositions` 存储顶层 block 的起始位置（`doc.forEach` 遍历的 offset）
- `anchorPos` 用于 Shift+↑/↓ 的范围扩展：固定锚点，移动另一端
- 状态通过 Plugin metadata（`tr.setMeta`）更新，不存储在文档中

### 位置重映射

文档变化时（undo/redo、外部更新），通过 `tr.mapping.map(pos)` 重映射所有 `selectedPositions` 和 `anchorPos`，确保选中状态不因文档变化而失效。

---

## 三、进入与退出

### 3.1 进入 Block 选中

| 触发方式 | 行为 |
|----------|------|
| **ESC** | 选中光标所在的 Block |
| **ESC**（在 Container 内） | 选中光标所在的**顶层** Block（Container 整体） |

进入时：
1. 找到光标所在的顶层 Block 位置
2. 设置 `{ active: true, selectedPositions: [pos], anchorPos: pos }`
3. 给 `view.dom` 添加 `block-selection-active` class
4. 给选中 Block 添加 `Decoration.node` → `.block-selected` class

### 3.2 退出 Block 选中

| 触发方式 | 行为 |
|----------|------|
| **←** | 退出选中，光标定位到第一个选中 Block 开头 |
| **→** | 退出选中，光标定位到最后一个选中 Block 末尾 |
| **Enter** | 退出选中，光标进入第一个选中 Block |
| **任意可打印字符** | 退出选中，光标进入第一个选中 Block 并输入该字符 |
| **单击编辑器** | 退出选中，光标跳到点击位置 |
| **ESC**（已选中时） | 退出选中 |

退出时：
1. 设置 `{ active: false, selectedPositions: [], anchorPos: null }`
2. 移除 `view.dom` 的 `block-selection-active` class

---

## 四、键盘交互

### 4.1 导航

| 按键 | 前提 | 行为 |
|------|------|------|
| **↑** | Block 选中模式 | 选中上一个相邻 Block（单选，重置 anchor） |
| **↓** | Block 选中模式 | 选中下一个相邻 Block（单选，重置 anchor） |
| **Shift+↑** | Block 选中模式 | 从 anchorPos 向上扩展范围选中 |
| **Shift+↓** | Block 选中模式 | 从 anchorPos 向下扩展范围选中 |

### 4.2 范围选择原理

```
Blocks: A  B  C  D  E

1. ESC 选中 C       → selectedPositions: [C],    anchorPos: C
2. Shift+↓          → selectedPositions: [C, D],  anchorPos: C
3. Shift+↓          → selectedPositions: [C, D, E], anchorPos: C
4. Shift+↑          → selectedPositions: [C, D],  anchorPos: C
5. ↑ (无 Shift)     → selectedPositions: [B],    anchorPos: B
```

实现：`getBlockRange(anchorPos, targetPos)` 返回两个位置之间所有 block 的位置列表。

### 4.3 操作

| 按键 | 行为 |
|------|------|
| **Delete / Backspace** | 删除所有选中 Block |
| **Cmd+C** | 复制选中 Block（JSON + HTML + 纯文本） |
| **Cmd+X** | 剪切选中 Block |

### 4.4 相邻 Block 查找

`getAdjacentBlockPos(doc, currentPos, direction)` — 在同级 block 列表中找上/下一个 block。

```typescript
function getAdjacentBlockPos(
  doc: PMNode,
  currentPos: number,
  direction: 'up' | 'down',
): number | null;
```

遍历 `doc.forEach` 获取所有顶层 block 位置列表，找到 currentPos 的 index，返回 index±1 的位置。

---

## 五、视觉样式

### 5.1 选中高亮

```css
/* 选中的 Block — Decoration.node 添加 */
.block-selected {
  background: rgba(138, 180, 248, 0.15);
  border-radius: 3px;
  outline: 2px solid rgba(138, 180, 248, 0.3);
  outline-offset: 2px;
}
```

### 5.2 隐藏文本光标

```css
/* 选中模式下隐藏文本光标和文本选区 */
.ProseMirror.block-selection-active {
  caret-color: transparent;
}
.ProseMirror.block-selection-active ::selection {
  background: transparent;
}
```

**不用 `view.dom.blur()`**——blur 会导致 ProseMirror 的 handleKeyDown 停止接收事件。通过 CSS 隐藏光标视觉效果，保持编辑器 focus。

---

## 六、剪贴板

### 6.1 写入

选中 Block 后 Cmd+C / Cmd+X 时，写入三种格式：

| MIME 类型 | 内容 | 用途 |
|-----------|------|------|
| `application/krig-blocks` | Block 的 ProseMirror JSON 数组 | 内部粘贴，无损还原 |
| `text/html` | Block 序列化为 HTML | 外部粘贴 |
| `text/plain` | Block 的纯文本 | 兜底 |

### 6.2 读取

Cmd+V 时检查 `clipboardData` 是否包含 `application/krig-blocks`：
- **有**：解析 JSON → 在光标位置插入 Block 节点
- **无**：走 ProseMirror 默认粘贴（文字级）

---

## 七、与其他系统的集成

### 7.1 与 Block Handle 拖拽

选中多个 block 后，按住**任意一个选中 block 的手柄**即可整体拖拽：

```
dragstart 时检查：
  Block Selection active + 多个 selectedPositions + currentPos 在选中列表中？
    → YES → dataTransfer 写入 'application/krig-multi-block'（JSON 数组）
    → NO  → dataTransfer 写入 'application/krig-block-pos'（单个位置）

handleDrop 时检查：
  有 'application/krig-multi-block'？
    → YES → relocateBlocks(positions, targetPos) 整体移动
    → NO  → relocateBlock(fromPos, targetPos) 单块移动
```

### 7.2 与 FloatingToolbar

Block 选中模式下 FloatingToolbar 不显示（没有文本选区）。

### 7.3 与 HandleMenu

HandleMenu 的操作（Delete、Turn Into 等）调用 `blockAction.xxx()`，不直接操作 Block Selection 状态。如果操作的 block 被选中，操作完成后清除选中状态。

---

## 八、Plugin 注册

### 8.1 优先级

Block Selection Plugin **必须在所有 keymap 之前注册**，确保 ESC、Arrow、Delete 等键被优先拦截：

```typescript
const plugins = [
  blockSelectionPlugin(),   // ← 最高优先级
  keymap(noteKeymap),
  keymap(baseKeymap),
  // ...其他插件
];
```

### 8.2 Plugin 接口

```typescript
export function blockSelectionPlugin(): Plugin {
  return new Plugin({
    key: blockSelectionKey,

    state: {
      init(): BlockSelectionState,
      apply(tr, prev): BlockSelectionState,   // 处理 metadata + 位置重映射
    },

    props: {
      handleKeyDown(view, event): boolean,    // ESC / Arrow / Delete / Enter
      handleClick(view, pos, event): boolean, // 点击退出选中
      decorations(state): DecorationSet,      // .block-selected 装饰
    },
  });
}
```

### 8.3 handleKeyDown 分发

```
event.key === 'Escape' && !active  → 进入选中
event.key === 'Escape' && active   → 退出选中
event.key === 'ArrowUp/Down'       → 导航 / Shift 多选
event.key === 'Backspace/Delete'   → 删除选中 Block
event.key === 'Enter'              → 退出选中，进入编辑
其他可打印字符                       → 退出选中，开始输入
```

---

## 九、辅助函数

| 函数 | 位置 | 职责 |
|------|------|------|
| `findTopBlockPos(doc, pos)` | block-handle.ts（已有） | 从任意 pos 找到顶层 block 起始位置 |
| `getAdjacentBlockPos(doc, pos, dir)` | block-selection.ts | 找上/下相邻 block |
| `getBlockRange(doc, fromPos, toPos)` | block-selection.ts | 返回两个位置之间所有 block 位置 |
| `relocateBlock(view, from, to)` | block-handle.ts（已有） | 移动 block 到目标位置 |

---

## 十、实施检查清单

- [ ] `plugins/block-selection.ts` — Plugin 实现（状态、键盘、装饰）
- [ ] `note.css` — `.block-selected` + `.block-selection-active` 样式
- [ ] `NoteEditor.tsx` — 注册插件（放在所有 keymap **之前**）
- [ ] 剪贴板 — `copy` / `cut` / `paste` handler
- [ ] `block-handle.ts` — 拖拽时检查多选状态
- [ ] 验证：ESC 进入 → ↑/↓ 导航 → Shift+↑/↓ 多选 → Delete 删除 → Enter 退出
- [ ] 验证：Container 整体选中（不选中内部子节点）
- [ ] 验证：文档变化后位置重映射

---

## 十一、设计原则

1. **选中与编辑互斥**：Block 选中时隐藏光标、禁止文字输入；开始编辑时自动退出选中
2. **Container 整体性**：ESC 选中 Container 时选中整个容器，不选中内部子节点
3. **位置不存储**：选中状态在 Plugin state 中，不污染文档数据
4. **不用 blur**：通过 CSS 隐藏光标，保持 ProseMirror focus 不中断键盘事件
5. **Plugin 优先级**：必须第一个注册，拦截键盘事件后其他 Plugin 不再处理
6. **操作走 blockAction**：选中后的操作（删除、复制等）通过 Block Action 层执行，不直接构建 Transaction
