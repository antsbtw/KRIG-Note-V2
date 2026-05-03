# codeBlock — 代码块

> **类型**：RenderBlock（见 `base/render-block.md`）
> **位置**：文档中任意位置
> **状态**：基础实现完成

---

## 一、定义

codeBlock 是用于展示代码的 Block。等宽字体、保留空格和换行、支持语言标识。

```
┌──────────────────────────┐
│ function hello() {       │
│   console.log('world');  │
│ }                        │
└──────────────────────────┘
```

---

## 二、当前能力

| 能力 | 状态 | 说明 |
|------|------|------|
| 代码输入 | ✅ | 等宽字体，保留空格和换行 |
| 语言标识 | ✅ | `language` attr（如 'javascript', 'python'） |
| Handle | ✅ | 拖拽手柄 |
| turnInto | ✅ | 可转为 paragraph |
| 复制 / 删除 / 拖拽 | ✅ | |

---

## 三、Schema

```typescript
nodeSpec: {
  content: 'text*',            // 纯文本，不支持 inline node
  group: 'block',
  code: true,                  // ProseMirror 标记为代码节点
  defining: true,
  marks: '',                   // 不支持任何 Mark（代码不需要加粗/斜体）
  attrs: {
    language: { default: '' }, // 编程语言标识
  },
}
```

### content 说明

`text*` 而非 `inline*`——代码块只接受纯文本，不支持 inline node（mathInline 等在代码块中无意义）。`marks: ''` 禁止所有 Mark。

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: ['paragraph'],      // 转为 paragraph（代码变为纯文本）
  marks: [],                    // 代码块内不支持 Mark
  canDuplicate: true,
  canDelete: true,
  canDrag: true,
}
```

---

## 五、SlashMenu

```typescript
slashMenu: {
  label: 'Code Block',
  icon: '< >',
  group: 'code',
  keywords: ['code', 'pre', 'program', 'snippet'],
  order: 0,
}
```

### Markdown 快捷输入

输入 ` ``` ` + Enter → 创建 codeBlock。

---

## 六、交互行为

### 6.1 进入代码块

- SlashMenu 选择 "Code Block"
- Markdown 输入 ` ``` `
- paragraph turnInto codeBlock

### 6.2 退出代码块

- 在代码块最后一行末尾按 Enter 两次 → 退出到下方新 paragraph
- 方向键 ↓ 在最后一行 → 跳出代码块到下方
- turnInto paragraph → 退出（代码变纯文本）

### 6.3 Tab 行为

- Tab → 插入缩进（2 或 4 空格，不是 HTML Tab）
- 不触发列表缩进

---

## 七、未来升级路径

### 7.1 语法高亮 — 近期

根据 `language` attr 高亮代码。可选方案：
- highlight.js（轻量）
- Prism（丰富）
- Shiki（VS Code 同款）

### 7.2 语言选择器 — 近期

代码块右上角显示语言选择下拉菜单，点击切换语言。

### 7.3 Tab Container 升级 — 中期

codeBlock 升级为多面板：

```
[Code] [Output] [Explain]
┌──────────────────────────┐
│ console.log('hello');    │  ← Code 面板
│                          │
│ → hello                  │  ← Output 面板（运行结果）
│                          │
│ 这段代码输出字符串...     │  ← Explain 面板（AI 解释）
└──────────────────────────┘
```

### 7.4 Mermaid / 图表渲染 — 中期

当 `language` 为 'mermaid' 时，自动渲染为图表预览。

### 7.5 行号 — 近期

可选显示行号。

---

## 八、BlockDef

```typescript
export const codeBlockBlock: BlockDef = {
  name: 'codeBlock',
  group: 'block',
  nodeSpec: {
    content: 'text*',
    group: 'block',
    code: true,
    defining: true,
    marks: '',
    attrs: { language: { default: '' } },
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM(node) { return ['pre', { 'data-language': node.attrs.language }, ['code', 0]]; },
  },
  capabilities: {
    turnInto: ['paragraph'],
    marks: [],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },
  slashMenu: {
    label: 'Code Block',
    icon: '< >',
    group: 'code',
    keywords: ['code', 'pre', 'program', 'snippet'],
    order: 0,
  },
};
```

---

## 九、设计原则

1. **纯文本**：代码块只接受文本，不支持 Mark 和 inline node
2. **语言标识**：`language` attr 为语法高亮和 Mermaid 渲染提供基础
3. **Tab 是缩进**：在代码块中 Tab 插入空格，不是列表缩进或焦点移动
4. **升级路径丰富**：语法高亮 → 运行输出 → AI 解释 → Mermaid 渲染，全部走 Tab Container
