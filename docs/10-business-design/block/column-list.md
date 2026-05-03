# columnList + column — 多列布局

> **类型**：ContainerBlock（见 `base/container-block.md`）
> **位置**：文档中任意位置
> **状态**：已实现（基础骨架），待补全交互功能

---

## 一、定义

columnList 是多列布局容器——将内容并排显示为 2-3 列。每列是独立 Container，可包含任意 Block。

```
2 列（默认）：
┌──────────────────┬──────────────────┐
│ 左列内容          │ 右列内容          │
│ paragraph...     │ paragraph...     │
│ image...         │ codeBlock...     │
└──────────────────┴──────────────────┘

3 列：
┌─────────────┬─────────────┬─────────────┐
│ 第一列       │ 第二列       │ 第三列       │
│ ...         │ ...         │ ...         │
└─────────────┴─────────────┴─────────────┘
```

---

## 二、涉及的 Block

| Block | 类型 | content | 角色 |
|-------|------|---------|------|
| `columnList` | Container | `column{2,3}` | 列容器（2 或 3 列） |
| `column` | Container | `block+` | 单列（包含任意 Block） |

---

## 三、Schema

```typescript
// columnList
nodeSpec: {
  content: 'column{2,3}',
  group: 'block',
  isolating: true,
  attrs: {
    columns: { default: 2 },       // 列数：2 | 3
  },
}

// column
nodeSpec: {
  content: 'block+',
  isolating: true,
  attrs: {
    verticalAlign: { default: 'top' },   // 垂直对齐：'top' | 'center' | 'bottom'
    width: { default: null },             // 列宽百分比 | null（null = 等宽 flex: 1）
  },
}
```

### 属性说明

| 属性 | 所属 | 类型 | 说明 |
|------|------|------|------|
| `columns` | columnList | `2 \| 3` | 列数，与实际子节点数同步 |
| `verticalAlign` | column | `'top' \| 'center' \| 'bottom'` | 列内内容垂直对齐方式 |
| `width` | column | `number \| null` | 列宽占比（百分比数值），null 表示等宽 |

---

## 四、Capabilities

```typescript
// columnList
capabilities: {
  turnInto: ['textBlock'],     // 溶解为平铺段落
  canDelete: true,
  canDrag: true,
}

// column
capabilities: {}               // column 不独立操作，跟随 columnList
```

---

## 五、Container 规则

```typescript
// columnList
containerRule: {
  requiredFirstChildType: undefined,   // column 自动管理，无需限制
}

// column
containerRule: {
  requiredFirstChildType: undefined,   // 任意 block 均可
}
```

---

## 六、SlashMenu

```typescript
// 2 列（主入口，由 BlockDef.slashMenu 注册）
slashMenu: {
  label: '2 Columns',
  icon: '▥',
  group: 'layout',
  keywords: ['column', 'two', '两列'],
  order: 2,
}

// 3 列（额外 SlashMenu 项，由 registerSlashItem 注册）
{
  id: 'column3',
  blockName: 'columnList',
  label: '3 Columns',
  icon: '▥',
  group: 'layout',
  keywords: ['column', 'three', '三列'],
  order: 3,
  attrs: { columns: 3 },
}
```

### 创建行为

SlashMenu 选择后：
1. 替换当前 block（而非在其后插入）
2. 第一列**继承**当前段落内容（如果是 paragraph）
3. 其余列创建空 textBlock
4. 光标定位到第一列第一段
5. **嵌套防护**：如果当前位置已在 columnList 内部，不允许创建（防止嵌套）

---

## 七、NodeView

### 7.1 DOM 结构

```
┌─ div.column-list ─────────────────────────────────────┐
│                                                        │
│ ┌─ div.column-list__toolbar (contenteditable=false) ─┐ │
│ │ [+]  [−]  [⬆/⬍/⬇]                                │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ ┌─ div.column-list__wrapper (position: relative) ────┐ │
│ │                                                     │ │
│ │ ┌─ div.column-list__content (flex, gap: 16px) ───┐ │ │
│ │ │ ┌─ div.column ─┐  ┌─ div.column ─┐            │ │ │
│ │ │ │ .column__     │  │ .column__     │            │ │ │
│ │ │ │  content      │  │  content      │            │ │ │
│ │ │ │ (PM renders)  │  │ (PM renders)  │            │ │ │
│ │ │ └───────────────┘  └───────────────┘            │ │ │
│ │ └─────────────────────────────────────────────────┘ │ │
│ │                                                     │ │
│ │ ┌─ div.column-list__handles (absolute overlay) ──┐ │ │
│ │ │ ┌─ handle ─┐                                    │ │ │
│ │ │ │ ║ (drag) │    ← 列间拖拽条                    │ │ │
│ │ │ └──────────┘                                    │ │ │
│ │ └─────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 7.2 Toolbar（悬停显示）

| 按钮 | 图标 | 行为 | 可见条件 |
|------|------|------|----------|
| Add column | `+` | 在末尾添加一列（最多 3 列），重置所有列宽为 null（等宽） | 当前 < 3 列 |
| Remove column | `−` | 删除最后一列，重置所有列宽为 null | 当前 > 2 列 |
| Cycle align | `⬆/⬍/⬇` | 循环切换所有列的 verticalAlign：top → center → bottom → top | 始终可见 |

Toolbar 显示规则：鼠标 hover 到 `.column-list` 上时显示，默认隐藏。

### 7.3 Resize Handle（列宽拖拽）

列间拖拽调整宽度：

1. **Handle 定位**：绝对定位在相邻列的间隙处（16px gap），覆盖 wrapper
2. **拖拽过程**：
   - `mousedown` → 记录起始位置和左右列的初始百分比
   - `mousemove` → 计算 delta 百分比，实时更新 `flex` 值（视觉反馈），最小列宽 **20%**
   - `mouseup` → 将最终百分比写入 column 的 `width` attr（持久化）
3. **宽度计算**：`usableWidth = containerWidth - totalGaps`，百分比 = 列宽 / usableWidth × 100
4. **增删列时**：重置所有 column 的 `width` 为 null（回到等宽）

### 7.4 column NodeView

```typescript
// 宽度同步
if (width != null) {
  dom.style.flex = `${width} 0 0`;   // flex-grow 作为比例权重
} else {
  dom.style.flex = '1';               // 等宽
}

// 垂直对齐
dom.setAttribute('data-vertical-align', verticalAlign);
```

### 7.5 NodeView 方法

| 方法 | 行为 |
|------|------|
| `update()` | 同步 toolbar 状态（按钮可见性）+ 重建 handle 位置 |
| `ignoreMutation()` | toolbar / handle 容器内的 DOM 变动不触发 PM 更新 |
| `stopEvent()` | toolbar / handle 上的事件不冒泡到 PM |
| `destroy()` | 清理 drag 监听器和 RAF |

---

## 八、命令

### 8.1 insertColumnList

```typescript
insertColumnList(columnCount: 2 | 3 = 2): Command
```

| 步骤 | 说明 |
|------|------|
| 1. 前置检查 | 不允许在 columnList 内部嵌套 |
| 2. 定位当前 block | `findNearestBlock($from)` |
| 3. 第一列继承内容 | 如果当前 block 是 paragraph，复制其内容；否则创建空段落 |
| 4. 其余列空段落 | `column(null, [paragraph()])` |
| 5. 替换当前 block | `replaceWith(pos, pos + blockNode.nodeSize, columnList)` |
| 6. 光标定位 | 第一列第一段开头 |

---

## 九、CSS 布局

### 9.1 布局方案：Flexbox

使用 Flexbox（非 Grid），原因：列宽可独立调整，配合 `flex-grow` 按比例分配空间。

```css
.column-list__content {
  display: flex;
  gap: 16px;
  align-items: stretch;         /* 列等高 */
}

.column {
  flex: 1;                       /* 默认等宽 */
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 8px;
  transition: border-color 0.15s;
}

.column:hover {
  border-color: rgba(138, 180, 248, 0.15);
}

.column:focus-within {
  border-color: rgba(138, 180, 248, 0.3);
}
```

### 9.2 垂直对齐

```css
.column[data-vertical-align="center"] > .column__content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
}

.column[data-vertical-align="bottom"] > .column__content {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 100%;
}
```

### 9.3 Resize Handle

```css
.column-list__handles {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
}

.column-list__handle {
  position: absolute;
  top: 0; bottom: 0;
  cursor: col-resize;
  pointer-events: auto;
}

.column-list__handle::after {
  content: '';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: 8px; bottom: 8px;
  width: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  transition: background 0.15s;
}

.column-list__handle:hover::after    { background: #1976d2; }
.column-list__handle.dragging::after { background: #42a5f5; }
```

### 9.4 Toolbar

```css
.column-list__toolbar {
  position: absolute;
  top: -4px; right: 0;
  display: none;                /* 默认隐藏 */
  gap: 2px;
  z-index: 10;
}

.column-list:hover > .column-list__toolbar {
  display: flex;                /* hover 显示 */
}
```

---

## 十、交互行为

### 10.1 嵌套限制

columnList **不可嵌套**——如果光标已在某个 columnList 内部，insertColumnList 返回 false。

### 10.2 Block 操作

| 操作 | 行为 |
|------|------|
| Delete | 删除整个 columnList |
| Drag | 整体移动（columnList + 所有 column） |
| turnInto textBlock | 溶解为平铺——列内容按列顺序展开为 block 序列 |
| Block Selection (Esc) | 选中整个 columnList |

### 10.3 block-handle

columnList 列入 `SKIP_DRILL_TYPES`——手柄不钻入列内部，直接选中整个 columnList。

---

## 十一、BlockDef

```typescript
export const columnListBlock: BlockDef = {
  name: 'columnList',
  group: 'block',
  nodeSpec: {
    content: 'column{2,3}',
    group: 'block',
    isolating: true,
    attrs: { columns: { default: 2 } },
  },
  nodeView: columnListNodeView,
  capabilities: {
    turnInto: ['textBlock'],
    canDelete: true,
    canDrag: true,
  },
  containerRule: {},
  slashMenu: {
    label: '2 Columns',
    icon: '▥',
    group: 'layout',
    keywords: ['column', 'two', '两列'],
    order: 2,
  },
};

export const columnBlock: BlockDef = {
  name: 'column',
  group: '',
  nodeSpec: {
    content: 'block+',
    isolating: true,
    attrs: {
      verticalAlign: { default: 'top' },
      width: { default: null },
    },
  },
  nodeView: columnNodeView,
  capabilities: {},
  containerRule: {},
  slashMenu: null,
};
```

---

## 十二、设计原则

1. **2-3 列限制** — 超过 3 列阅读体验差，toolbar 强制上限
2. **列是 Container** — 每列可包含任意 Block，遵守 Block 能力不变量
3. **溶解为平铺** — turnInto textBlock 时列内容按顺序展开
4. **不可嵌套** — columnList 内不允许再创建 columnList
5. **Flex 布局** — 使用 flexbox 而非 grid，支持独立调整列宽
6. **宽度按比例** — width attr 存储百分比，null 表示等宽；增删列时重置为等宽
7. **整体移动** — 拖拽时 columnList + 所有 column 一起移动
8. **内容继承** — 从 SlashMenu 创建时，当前段落内容移入第一列，减少用户操作
