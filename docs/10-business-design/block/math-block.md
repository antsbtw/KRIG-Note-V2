# mathBlock — 行间数学公式

> **类型**：独立 Block（不走 RenderBlock 基类，与 codeBlock 同级）
> **位置**：文档中任意位置
> **状态**：已实现

---

## 一、定义

mathBlock 是行间数学公式——LaTeX 输入，KaTeX 渲染。独占一行，居中显示。

```
$$
E = mc^2
$$
```

### 为什么不走 RenderBlock

mathBlock 使用 `content: 'text*'` + `contentDOM`，ProseMirror 直接管理 LaTeX 文本内容，支持光标编辑、选区、撤销重做。这与 RenderBlock 的 `atom` + `attrs` 模式不同。与 codeBlock 同属 `content: 'text*'` 的独立 NodeView。

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'text*',
  group: 'block',
  code: true,                  // 代码模式（等宽字体，不支持 Mark）
  defining: true,
  marks: '',                   // 不支持 Mark
}
```

**注意**：没有 `attrs.latex`。LaTeX 源码存储在节点的 text content 中，由 ProseMirror 管理。

---

## 三、NodeView

### 3.1 DOM 结构

```
div.math-block-wrapper
  ├── div.math-block__rendered       ← 渲染视图（默认显示）
  └── div.math-block__editor         ← 编辑区域（默认隐藏）
        ├── div.math-block__header   ← 标题栏（∑ Block equation）
        ├── pre > code               ← contentDOM（ProseMirror 管理）
        └── div.math-block__preview  ← 实时 KaTeX 预览
```

### 3.2 双模式交互

| 模式 | 显示 | 触发 |
|------|------|------|
| **预览模式**（默认） | KaTeX 渲染结果，居中 | 退出编辑时 |
| **编辑模式** | header + LaTeX 输入 + 实时预览 | 点击预览 / 新建空节点 |

- 点击 rendered → 进入编辑模式，光标定位到末尾
- Escape → 退出编辑模式
- 点击外部 → 退出编辑模式
- 空内容创建时自动进入编辑模式

### 3.3 性能优化

- **IntersectionObserver 懒渲染**：首次 KaTeX 渲染延迟到节点进入视口
- **MutationObserver + 防抖**：编辑时 200ms 防抖更新实时预览

---

## 四、Capabilities

```typescript
capabilities: {
  canDelete: true,
  canDrag: true,
}
```

---

## 五、SlashMenu

```typescript
slashMenu: {
  label: 'Math Block',
  icon: '∑',
  group: 'basic',
  keywords: ['math', 'latex', 'equation', '公式'],
  order: 10,
}
```

---

## 六、未来升级路径

### Tab Container 升级

```
[公式] [推导] [可视化]
  E = mc²  /  推导过程...  /  函数图像
```

---

## 七、BlockDef

```typescript
export const mathBlockBlock: BlockDef = {
  name: 'mathBlock',
  group: 'block',
  nodeSpec: {
    content: 'text*',
    group: 'block',
    code: true,
    defining: true,
    marks: '',
    parseDOM: [{ tag: 'div.math-block-wrapper', preserveWhitespace: 'full' }],
    toDOM() { return ['div', { class: 'math-block-wrapper' }, ['pre', ['code', 0]]]; },
  },
  nodeView: mathBlockNodeView,
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: {
    label: 'Math Block',
    icon: '∑',
    group: 'basic',
    keywords: ['math', 'latex', 'equation', '公式'],
    order: 10,
  },
};
```

---

## 八、与 codeBlock 的关系

| | mathBlock | codeBlock |
|---|---|---|
| **content** | `text*` | `text*` |
| **code** | `true` | `true` |
| **NodeView** | 独立 | 独立 |
| **编辑** | contentDOM + 双模式切换 | contentDOM + 始终可见 |
| **渲染** | KaTeX | 语法高亮（未来） |
| **基类** | 无（独立 Block） | 无（独立 Block） |

两者都是 `content: 'text*'` 的独立 NodeView，不走 RenderBlock 基类。
