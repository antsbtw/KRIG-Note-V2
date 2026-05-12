# mathInline

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/math-inline/spec.ts`

---

## 1. 语义边界

`mathInline` 是**行内数学公式** inline atom 节点 —— 在段落文字流中嵌入 LaTeX 表达式，渲染为 KaTeX 行内公式。

### 1.1 形态特征

- **inline 节点**（`inline: true` + `group: 'inline'`），可嵌入 `paragraph` / `heading` 等 inline 容器。
- **atom**（`atom: true`）—— 光标不能进入节点内部，作为整体单元被选中 / 删除 / 复制。
- **承载 LaTeX**：单字符串存 attrs.latex，**不含分隔符 `$`**（分隔符在 leafText 序列化时附加）。
- **渲染**：双击 / 单击空 → 弹出绝对定位编辑弹窗（input + live preview）。

### 1.2 mathInline vs mathBlock

| 场景 | 节点 |
|---|---|
| 行内嵌入公式（`公式$x^2$后续文字`） | `mathInline` |
| 块级独立公式（占据完整一行） | `mathBlock` |

详 [mathBlock.md](../blocks/math-block.md)（批 2 待写）。

---

## 2. type 字段值

```ts
type: 'mathInline'
```

V2 实际 id 是驼峰 `mathInline`。

---

## 3. attrs schema

### 3.1 节点级 attrs

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `latex` | `string` | `''` | LaTeX 表达式源码（不含 `$` 分隔符） | KRIG 自定义（阶梯 3，Markdown / PM 都未规定 math inline） |

### 3.2 框架级注入 attrs

⚠ `mathInline` 是 **inline 节点**，**不**被框架级 `indent` 注入。

### 3.3 Mixin 引用

不引用任何 Mixin（公式语义专属字段无共性）。

---

## 4. content 嵌套规则

```ts
content: undefined  // atom 叶子
inline: true
group: 'inline'
atom: true
```

`mathInline` 是 inline atom 叶子，**不接受任何子节点**。

可被嵌入以下父容器的 `inline*` content：

- `paragraph`
- `heading`
- `listItem` 内部的 paragraph
- `tableCell` 内部的 paragraph
- 等所有接受 inline 节点的父级

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{ type: 'mathInline', attrs: { latex: 'x^2 + 1' } }
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'span.krig-math-inline',
    getAttrs(node) {
      return { latex: (node as HTMLElement).getAttribute('data-latex') || '' };
    },
  },
]
toDOM(node) {
  return ['span', { class: 'krig-math-inline', 'data-latex': node.attrs.latex }];
}
```

### 5.3 leafText（纯文本复制 / textBetween）

V2 实现：`leafText: $<latex>$` —— 复制 mathInline 到剪贴板时输出 `$x^2$` 形式，可被 Markdown / 其他工具识别。

### 5.4 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → mathInline | `$x^2$` → `mathInline({ latex: 'x^2' })`（依赖 markdown-it-katex 等扩展） |
| mathInline → MD | `$<latex>$` |

注：CommonMark 标准**不包含** math 语法，math inline 是社区扩展（katex / MathJax 风格）。

### 5.5 可逆性

| 路径 | 是否无损 |
|---|---|
| mathInline ↔ PM doc | ✓ 完全无损（latex 字符串保留） |
| mathInline → Markdown → mathInline | ✓ 无损（依赖支持 `$...$` 解析的 markdown 处理器） |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `mathInline`（同名）—— inline atom，attrs.latex 存 LaTeX。

V1 spec 额外集成 `thoughtMark`（思考标注 mark），V2 砍掉（V2 暂无 thought mark 系统，详 [decision 002](../../atom/decisions/002-v1-fields-migration.md)）。

### 6.2 V2 处置

直搬主体（id / latex attrs / inline atom 形态），砍 thoughtMark 集成。

### 6.3 V1 数据迁移

```ts
function migrateMathInline(v1: V1MathInline): V2MathInline {
  return {
    type: 'mathInline',
    attrs: { latex: v1.attrs.latex },
    // V1 的 thoughtMark 字段丢弃（V2 暂无对应系统）
  };
}
```

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-MI-1 | latex 字符串是否要 schema 层校验 LaTeX 语法？还是仅运行时由 KaTeX 渲染时反馈错误？ | **仅运行时**，schema 不校验 | 不阻塞 |
| P-MI-2 | latex 允许哪些 KaTeX 不支持的命令？是否要 sanitize？ | **不 sanitize**（用户负责），KaTeX 渲染失败时显示原始 LaTeX 源码 | 实施时核验 capability.text-editing 错误处理 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/math-inline/spec.ts`
- KaTeX 文档（行内公式渲染依赖）
- [decision 002 §"V1 InlineElement / Mark 判定"](../../atom/decisions/002-v1-fields-migration.md)（V1 → V2 命名映射）
