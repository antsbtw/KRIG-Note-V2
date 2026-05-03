# horizontalRule — 分割线

> **类型**：Block（装饰性，不可编辑）
> **位置**：文档中任意位置
> **状态**：基础实现完成

---

## 一、定义

horizontalRule 是视觉分割线，用于分隔文档的不同部分。没有内容，没有交互，纯装饰性 Block。

```
段落内容...
─────────────────────
另一个部分的内容...
```

---

## 二、当前能力

| 能力 | 状态 | 说明 |
|------|------|------|
| 渲染 | ✅ | 水平线 |
| Handle | ✅ | 拖拽手柄 |
| 删除 | ✅ | Block 级删除 |
| 拖拽 | ✅ | 拖拽到其他位置 |

---

## 三、Schema

```typescript
nodeSpec: {
  group: 'block',
  parseDOM: [{ tag: 'hr' }],
  toDOM() { return ['hr']; },
}
```

### 说明

- 没有 `content`——horizontalRule 是叶子节点（atom），没有子内容
- 没有 `attrs`——没有可配置属性

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: [],                 // 不能转换为其他类型
  marks: [],
  canDelete: true,
  canDrag: true,
}
```

horizontalRule 不能转换为 paragraph 或其他 Block——它没有文本内容，转换没有意义。

---

## 五、SlashMenu

```typescript
slashMenu: {
  label: 'Divider',
  icon: '—',
  group: 'basic',
  keywords: ['hr', 'divider', 'separator', 'line', 'rule'],
  order: 20,
}
```

### Markdown 快捷输入

输入 `---` + Enter → 创建 horizontalRule。

---

## 六、交互行为

### 6.1 选中

horizontalRule 不可编辑。选中时显示蓝色边框或高亮。光标不能进入 horizontalRule 内部——只能在它前后。

### 6.2 删除

- 选中后按 Delete 或 Backspace → 删除
- 光标在紧跟 horizontalRule 后的空 paragraph 开头按 Backspace → 删除 horizontalRule

### 6.3 不可做

- 不能输入文字
- 不能转换类型
- 不能复制（复制整个 Block 可以，但没有内容级复制）
- 不能缩进

---

## 七、不可升级为 Tab Container

horizontalRule 是唯一**不可升级**的 Block——它是纯装饰性的分割线，没有内容，不存在"多视角"需求。

---

## 八、BlockDef

```typescript
export const horizontalRuleBlock: BlockDef = {
  name: 'horizontalRule',
  group: 'block',
  nodeSpec: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM() { return ['hr']; },
  },
  capabilities: {
    canDelete: true,
    canDrag: true,
  },
  slashMenu: {
    label: 'Divider',
    icon: '—',
    group: 'basic',
    keywords: ['hr', 'divider', 'separator', 'line', 'rule'],
    order: 20,
  },
};
```

---

## 九、设计原则

1. **纯装饰**：没有内容、没有配置、没有交互，只是视觉分割
2. **不可转换**：没有文本内容，转换无意义
3. **不可升级**：唯一不支持 Tab Container 升级的 Block
4. **简单至上**：最简单的 Block，验证注册制的"最小 BlockDef"
