# mathBlock

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/math-block/spec.ts`

---

## 1. 语义边界

`mathBlock` 是**块级数学公式**节点 —— 独立段落显示 LaTeX 公式，对应 LaTeX `\[ ... \]` / Markdown ```` ```math ```` 扩展、HTML `<div class="krig-math-block">`。

### 1.1 形态特征

- **text 容器**：`content: 'text*'` + `code: true` + `marks: ''` —— 跟 codeBlock 类似，承载 LaTeX 源码（不解析 inline mark）。
- **defining: true**。
- **NodeView 控制双态**：rendered（KaTeX displayMode 显示）/ edit（LaTeX 源码 + 实时预览）—— 由 capability 接管。

### 1.2 mathBlock vs mathInline vs codeBlock

| 场景 | 类型 |
|---|---|
| 块级独立数学公式（占完整一行） | `mathBlock` 节点 |
| 行内数学公式（嵌入段落） | `mathInline` 节点（详 [inlines/math-inline.md](../inlines/math-inline.md)） |
| 块级代码（程序代码） | `codeBlock` 节点（详 [code-block.md](./code-block.md)） |

---

## 2. type 字段值

```ts
type: 'mathBlock'
```

V2 实际 id 驼峰 `mathBlock`。

---

## 3. attrs schema

### 3.1 节点级 attrs（V2 当前实现）

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `color` | `string \| null` | `null` | KaTeX 文本色（覆盖默认） | KRIG 自定义（阶梯 3） |
| `bgColor` | `string \| null` | `null` | 整块背景色 | KRIG 自定义（V1 命名）|

### 3.2 命名争议（RFC vs 实现）

按 [decision 004 §2](../../atom/decisions/004-phase2b-resolutions.md#2-n4--mathblock-视觉属性)：

- **RFC 提议**：V1 `bgColor` 改名 `backgroundColor`（与 CSS 标准对齐）
- **V2 当前实际**：仍叫 `bgColor`（V1 直迁，**改造未做**）

→ V2 当前 `bgColor` attrs 仍是 V1 命名，**未按 decision 004 §2 改 `backgroundColor`**。

**处置**（标 Open Q P-MB-1，待决议执行时机）：保留 `bgColor` 直到下一波 mathBlock 改造（与其他 schema 改动一并做）。

### 3.3 color / bgColor 的语义合理性

按 decision 004 §2，数学公式中颜色承载**语义意图**（教学强调 / 错误标注 / 重要项目高亮），类比 LaTeX `\textcolor{red}{...}` 是公式语义一部分，**不**视为视觉装饰违反原则 1。

→ 这是 mathBlock 独有的特殊性，**不**类比 paragraph / heading 的"视觉色彩剥离"原则。

### 3.4 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

### 3.5 V1 → V2 字段差异

V1 `MathBlockContent` 含 `latex: string` + `color?: string` + `bgColor?: string`。V2 当前**把 latex 改到 content**（与 codeBlock 同等处置，参考 PM 标准）：

```ts
// V1: { type: 'mathBlock', attrs: { latex: 'E=mc^2', color, bgColor } }
// V2: { type: 'mathBlock', attrs: { color, bgColor }, content: [{ type: 'text', text: 'E=mc^2' }] }
```

---

## 4. content 嵌套规则

```ts
content: 'text*'
marks: ''         // 不允许 inline mark
code: true
defining: true
```

只允许纯 `text` 子节点（LaTeX 源码）。

### 4.1 嵌套约束

- 子节点只能是 `text`。
- 父容器：`doc` / `listItem` / `taskItem` / `blockquote` / `callout` / `toggleList` / `tableCell`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'mathBlock',
  attrs: { color: null, bgColor: null, indent: 0 },
  content: [{ type: 'text', text: 'E = mc^2' }]
}
```

带颜色：

```ts
{
  type: 'mathBlock',
  attrs: { color: '#ff0000', bgColor: '#ffffcc' },
  content: [{ type: 'text', text: '\\textcolor{red}{x}^2 + 2x + 1' }]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'div.krig-math-block',
    preserveWhitespace: 'full',
    getAttrs(node) {
      const el = node as HTMLElement;
      return {
        color: el.getAttribute('data-color') || null,
        bgColor: el.getAttribute('data-bg-color') || null,
      };
    },
  },
]
toDOM(node) {
  const attrs: Record<string, string> = { class: 'krig-math-block' };
  if (node.attrs.color) attrs['data-color'] = node.attrs.color;
  if (node.attrs.bgColor) attrs['data-bg-color'] = node.attrs.bgColor;
  return ['div', attrs, ['pre', { class: 'krig-math-block__code' }, 0]];
}
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → mathBlock | **无 CommonMark 标准** —— ```` ```math ```` / `\[ ... \]` 等是社区扩展（依赖 markdown-it-katex 等） |
| mathBlock → MD | ```` ```math\n<latex>\n``` ```` 或 `\[ <latex> \]` |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| mathBlock ↔ PM doc | ✓ 完全无损 |
| mathBlock → Markdown → mathBlock | ⚠ 部分有损：`color` / `bgColor` 在 Markdown 中难表达 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `mathBlock` —— attrs: { latex: string, color?, bgColor? }。LaTeX 源码存在 attrs 里。

### 6.2 V2 处置

- id 沿用 `mathBlock`。
- **LaTeX 源码从 attrs.latex 改到 content**（PM 标准化，与 codeBlock 同等处置）。
- attrs.color / bgColor 沿用 V1 命名（待按 [decision 004 §2](../../atom/decisions/004-phase2b-resolutions.md) 改 `backgroundColor`）。

### 6.3 V1 数据迁移

```ts
function migrateMathBlock(v1: V1MathBlock): V2MathBlock {
  return {
    type: 'mathBlock',
    attrs: { color: v1.attrs.color ?? null, bgColor: v1.attrs.bgColor ?? null },
    content: [{ type: 'text', text: v1.attrs.latex }],
  };
}
```

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-MB-1 | `bgColor` 是否按 [decision 004 §2](../../atom/decisions/004-phase2b-resolutions.md) 改 `backgroundColor`？ | **暂保留 `bgColor`**（V2 现状），改名需配套 schema 改造 + 数据迁移 | Phase 2c+ 下一波 mathBlock 改造时一并做 |
| P-MB-2 | `mathVisual` 节点（V1 有，V2 ENABLED_BLOCKS 暂未启用）—— 何时补？ | **暂不补**（V2 现状），视真实需求 | Phase 2c+ |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/math-block/spec.ts`
- [decision 004 §2 N4](../../atom/decisions/004-phase2b-resolutions.md#2-n4--mathblock-视觉属性)（color / bgColor 保留 + 改名决议）
- KaTeX displayMode 文档
- [math-inline.md](../inlines/math-inline.md)（姊妹节点，行内版本）
