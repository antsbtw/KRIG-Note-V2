# codeBlock

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/code-block/spec.ts`

---

## 1. 语义边界

`codeBlock` 是**块级代码**节点 —— 对应 HTML `<pre><code>`、Markdown 围栏代码块 ```` ``` ```` / 缩进代码块。

### 1.1 形态特征

- **code 容器**：`content: 'text*'` + `code: true` + `marks: ''` —— 内部只接受纯 text 节点，无 inline mark / 嵌套 block。
- **defining: true** —— PM 语义化容器。
- **cascadeBoundary: true** —— light dirty 区不向 codeBlock 内级联（保留代码原样格式）。

### 1.2 codeBlock vs code mark vs mathBlock

| 场景 | 类型 |
|---|---|
| 块级代码块（独立段落） | `codeBlock` 节点 |
| 行内代码（在段落内的小段代码） | `code` mark（详 [marks/basic-marks.md](../marks/basic-marks.md)） |
| 块级数学公式 | `mathBlock` 节点（详 [math-block.md](./math-block.md)） |

---

## 2. type 字段值

```ts
type: 'codeBlock'
```

V2 实际 id 驼峰 `codeBlock`。

---

## 3. attrs schema

### 3.1 节点级 attrs（V2 当前实现）

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `language` | `string` | `''` | 代码语言（如 `'typescript'` / `'python'` / `''`=无语法高亮） | KRIG 自定义（阶梯 3） |

### 3.2 命名争议（RFC vs 实现）

按 [naming-conventions.md §2.1](../../naming-conventions.md)：

- **Markdown 标准**：`info`（CommonMark fenced code block info string）
- **V2 当前实际**：仍叫 `language`（V1 直迁）

→ V2 当前 `language` attrs 仍是 V1 命名，**未按 RFC 提议改 `info`**。

**处置选项**（标 Open Q P-CB-1，待决议）：
1. 保持 V2 `language`
2. 改 V2 `language` → `info`（CommonMark 标准）

### 3.3 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

---

## 4. content 嵌套规则

```ts
content: 'text*'
marks: ''         // 不允许任何 inline mark
code: true        // PM 代码节点标识
defining: true
```

只允许纯 `text` 子节点，不允许 mark / 嵌套 block / inline 节点。

### 4.1 嵌套约束

- 子节点只能是 `text`（纯字符串）。
- 父容器：`doc` / `listItem` / `taskItem` / `blockquote` / `callout` / `toggleList` / `tableCell`。
- `code: true` —— PM 框架级标识，影响 backspace / Enter / 复制粘贴行为（光标在 codeBlock 内 Enter 默认不分块，输出真实换行符）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'codeBlock',
  attrs: { language: 'typescript', indent: 0 },
  content: [
    { type: 'text', text: 'const x = 1;\nconst y = 2;' }
  ]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'pre',
    preserveWhitespace: 'full',
    getAttrs(node) {
      const codeEl = (node as HTMLElement).querySelector('code');
      const langClass = codeEl?.className.match(/language-(\S+)/);
      return { language: langClass ? langClass[1] : '' };
    },
  },
]
toDOM(node) {
  const lang = node.attrs.language as string;
  return [
    'pre',
    { class: 'krig-code-block' },
    ['code', lang ? { class: `language-${lang}` } : {}, 0],
  ];
}
```

注：`preserveWhitespace: 'full'` 保留代码内的换行 / 缩进 / 空白。

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → codeBlock | ```` ```typescript\ncode\n``` ```` → `codeBlock({ language: 'typescript' })`；缩进 4 空格代码块 → `codeBlock({ language: '' })` |
| codeBlock → MD | 围栏式 ```` ```<language>\n<content>\n``` ```` |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| codeBlock ↔ PM doc | ✓ 完全无损 |
| codeBlock → Markdown → codeBlock | ✓ 大部分无损（language + content 都保留）|

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `codeBlock` —— attrs: { code: string, language: string, title?: string }。

注意 V1 把代码内容存在 `attrs.code` 字段里，**不**走 content。这是 V1 设计选择 ——  V2 已经按 PM 标准改为 `content: 'text*'`。

### 6.2 V2 处置

- id 沿用 `codeBlock`。
- **代码内容从 attrs.code 改到 content**（PM 标准）。
- **删除 attrs.title** —— V1 用于代码块顶部标题（如 ChatGPT Canvas），V2 当前不实现（视真实需求 Phase 2c+ 补回）。
- attrs.language 沿用（详 §3.2 命名争议）。

### 6.3 V1 数据迁移

```ts
function migrateCodeBlock(v1: V1CodeBlock): V2CodeBlock {
  return {
    type: 'codeBlock',
    attrs: { language: v1.attrs.language },
    content: [{ type: 'text', text: v1.attrs.code }],
    // V1 attrs.title 丢弃
  };
}
```

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-CB-1 | `language` 字段是否按 RFC 改 `info`（Markdown 标准）？V2 当前实现 + V1 数据都用 `language` | **暂保留 `language`**，改名需配套 capability 改造 | Phase 2c+ 视真实需求决议 |
| P-CB-2 | V1 `title?` 是否补回？某些场景（ChatGPT Canvas 风格）有用 | **暂不补**（V2 现状），视真实场景 | Phase 2c+ |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/code-block/spec.ts`
- HTML5 `<pre><code>` 标准 / CommonMark fenced code block
- [naming-conventions.md §2.1](../../naming-conventions.md)（language vs info 命名）
- prosemirror-schema-basic `code_block`（语义参考）
