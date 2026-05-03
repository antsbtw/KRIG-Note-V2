# mathInline — 行内数学公式

> **类型**：Inline 节点（atom）
> **位置**：任何接受 inline 内容的 Block 内部
> **状态**：已实现

---

## 一、定义

mathInline 是行内数学公式——在文字中嵌入小公式，不独占一行。

```
根据公式 $E = mc^2$，质量和能量可以互换。
```

---

## 二、Schema

```typescript
nodeSpec: {
  inline: true,
  group: 'inline',
  atom: true,
  attrs: {
    latex: { default: '' },
  },
}
```

---

## 三、NodeView

### 3.1 渲染

- KaTeX 行内渲染（`displayMode: false`）
- 空公式显示灰色斜体 "New equation"
- hover 时轻微高亮背景

### 3.2 编辑交互

- **双击** → 打开编辑弹窗
- **单击空公式** → 打开编辑弹窗

### 3.3 编辑弹窗（math-inline-editor）

弹出在行内元素下方，包含：

| 区域 | 说明 |
|------|------|
| **input** | 等宽字体输入框，placeholder: `LaTeX: e.g. x^2 + y^2 = z^2` |
| **preview** | 实时 KaTeX 预览（displayMode: true，放大 1.3em） |

关闭方式：
- Enter → 保存并关闭
- Escape → 取消并关闭
- 点击外部 → 保存并关闭

### 3.4 FloatingToolbar 入口

选中文字后 FloatingToolbar 显示 ∑ 按钮，点击将选中文字转为 mathInline 节点（选中文字作为初始 LaTeX）。

---

## 四、SlashMenu

```typescript
slashMenu: {
  label: 'Inline Math',
  icon: '∑',
  group: 'basic',
  keywords: ['math', 'inline', 'formula', '公式'],
  order: 14,
}
```

---

## 五、BlockDef

```typescript
export const mathInlineBlock: BlockDef = {
  name: 'mathInline',
  group: 'inline',
  nodeSpec: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { latex: { default: '' } },
    parseDOM: [{ tag: 'span.math-inline' }],
    toDOM() { return ['span', { class: 'math-inline' }]; },
  },
  nodeView: mathInlineNodeView,
  capabilities: {},
  slashMenu: {
    label: 'Inline Math',
    icon: '∑',
    group: 'basic',
    keywords: ['math', 'inline', 'formula', '公式'],
    order: 14,
  },
};
```
