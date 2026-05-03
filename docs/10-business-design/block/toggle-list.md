# toggleList — 折叠段落

> **类型**：ContainerBlock（见 `base/container-block.md`）
> **位置**：文档中任意位置
> **状态**：已实现

---

## 一、核心概念

toggleList 本质是一个**特殊的段落**——它的标题行就是普通段落，只是多了折叠箭头，可以把下方的子 block 隐藏起来。

```
展开状态：
▾ 这是折叠段落的标题行          ← 普通段落 + 折叠箭头
    详细内容段落...              ← 子 block（折叠时隐藏）
    代码示例...

折叠状态：
▸ 这是折叠段落的标题行          ← 标题行始终可见，子内容隐藏
```

### 两个身份

toggleList 同时具备两个身份：

| 身份 | 说明 |
|------|------|
| **段落** | 标题行继承段落的所有操作（编辑、格式、Turn Into 等） |
| **容器** | 管理子 block 的折叠/展开，收起时作为整体操作 |

### 子 block 独立性

子 block 属于 toggleList 的子叶，但**每个子 block 都是独立的操作单元**：
- 每个子 block 有自己的手柄（+ ⠿）
- 每个子 block 可以独立删除、拖拽、Turn Into
- 不会因为是 toggleList 的子叶就失去自身的功能

---

## 二、操作规则

### 2.1 状态决定操作粒度

| 状态 | 操作 | 行为 |
|------|------|------|
| **收起** | ESC 选中 | 选中整个 toggleList（包括所有隐藏的子 block） |
| **收起** | 删除 / 剪切 | 整体操作（标题行 + 所有子 block 一起删除） |
| **收起** | 拖拽 | 整体移动 |
| **展开** | 删除 tog 标题行 | 只删除 toggleList 壳，子 block 回退一级缩进 |
| **展开** | 子 block 操作 | 每个子 block 独立操作，不影响 toggleList |

### 2.2 ESC 与 ↑/↓ 导航

| 场景 | 行为 |
|------|------|
| 光标在标题行，按 ESC | 选中标题行所在的子 block |
| 光标在子 block，按 ESC | 选中该子 block |
| 选中后按 ↑/↓ | 在所有 block（含 toggleList 子 block）间导航 |

### 2.3 折叠/展开

- 点击 ▸/▾ 图标切换
- 折叠时子内容隐藏（标题行后面的所有 block）

### 2.4 删除逻辑

```
收起的 toggleList → Delete：
  整体删除（标题行 + 所有子 block）

展开的 toggleList → Delete 标题行：
  ▾ 标题行      ← 删除这一行
      子段落 A   ← 提升到上一级
      子段落 B   ← 提升到上一级
  
  结果：
  子段落 A
  子段落 B
```

---

## 三、Schema

```typescript
nodeSpec: {
  content: 'block+',           // 任意 block（无必填首子）
  group: 'block',
  attrs: {
    open: { default: true },    // 折叠状态
  },
}
```

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: ['textBlock'],
  canDelete: true,
  canDrag: true,
}
```

---

## 五、Container 规则

```typescript
containerRule: {}
```

---

## 六、SlashMenu

```typescript
slashMenu: {
  label: 'Toggle List',
  icon: '▶',
  group: 'basic',
  keywords: ['toggle', 'fold', 'collapse', '折叠'],
  order: 9,
}
```

---

## 七、NodeView

```
┌─ toggleList ─────────────────────────┐
│ ▾ 标题行 textBlock（始终可见）       │  ← 段落 + 折叠箭头
│ ┌─ 折叠区域 ─────────────────────┐  │
│ │ textBlock...                    │  │  ← 独立子 block，各有手柄
│ │ codeBlock...                    │  │
│ └─────────────────────────────────┘  │
└──────────────────────────────────────┘
```

---

## 八、BlockDef

```typescript
export const toggleListBlock: BlockDef = {
  name: 'toggleList',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    attrs: { open: { default: true } },
    parseDOM: [{ tag: 'div.toggle-list' }],
    toDOM() { return ['div', { class: 'toggle-list' }, 0]; },
  },
  nodeView: toggleListNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: {},
  slashMenu: {
    label: 'Toggle List',
    icon: '▶',
    group: 'basic',
    keywords: ['toggle', 'fold', 'collapse', '折叠'],
    order: 9,
  },
};
```

---

## 九、设计原则

1. **段落优先**：toggleList 的标题行就是普通段落，继承段落的所有能力
2. **子 block 独立**：每个子 block 保留完整功能，不因嵌套而降级
3. **状态决定粒度**：收起 = 整体操作，展开 = 各自独立
4. **删除即解散**：展开时删除容器，子 block 回退缩进，不丢失内容
5. **整体移动**：拖拽时所有子内容一起移动
