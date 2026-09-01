# paragraph

> **Status**: V2 已实现 ✓（commit `c9ae4e4` / decision 005 D1）
> **Source**: `src/drivers/text-editing-driver/blocks/paragraph/spec.ts`

---

## 1. 语义边界

`paragraph` 是 PM 标准的**普通段落**节点。在 V2 中同时承载两种语义形态，由 `isTitle` attrs 区分：

| isTitle | 含义 | 渲染 |
|---|---|---|
| `false`（默认） | 普通段落 | `<p>` |
| `true` | 文档标题（noteTitle）—— 仅 doc 首块 | `<p data-is-title="true" class="krig-note-title">` |

### 1.1 paragraph vs heading

`paragraph` 与 [heading](./heading.md) 是**两个独立 PM 节点**（按 [decision 005](../../atom/decisions/005-block-schema-decomposition.md) 拆分），不再是 V1 合一的 text-block + level attrs。判定规则：

| 场景 | 节点 |
|---|---|
| 普通文字段落 | `paragraph` |
| 章节标题（任意 level 1-6） | `heading` |
| 文档标题（doc 首块大字号） | `paragraph` + `attrs.isTitle: true` |

### 1.2 noteTitle 不是 heading 的理由

按 decision 005 D1：

- HTML5 / Markdown 标准里 `<h1>` 表达**章节标题**，可有多个。
- noteTitle 表达**文档身份**（这篇笔记叫什么），只有一个。
- 用 `<p data-is-title>` 而非 `<h1>` 是为了**语义化区分**（文档标题 ≠ 章节标题）。
- 渲染样式（大字号）跟 h1 类似只是巧合，语义不同。

---

## 2. type 字段值

```ts
type: 'paragraph'
```

PM 标准命名（小写 / 单数）。`naming-conventions.md` §3.1 阶梯 1（PM/HTML 标准）。

---

## 3. attrs schema

### 3.1 节点级 attrs（V2 当前实现）

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `isTitle` | `boolean` | `false` | 是否为文档标题（仅 doc 首块允许 true） | KRIG 自定义（阶梯 3） |

### 3.2 框架级注入 attrs（schema-builder）

`schema-builder.ts:14-25` 对所有 `group: 'block'` 节点自动注入：

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `indent` | `number` | `0` | 整段缩进层级（CSS padding-left 风格） |

### 3.3 Phase 2c 待引入的 attrs（TextFlowAttrs Mixin）

按 [mixins/text-flow.md](../../../mixins/text-flow.md) 决议，paragraph 还应引用 TextFlowAttrs 三字段：

| 字段 | 类型 | 默认值 | 含义 | 状态 |
|---|---|---|---|---|
| `textIndent` | `boolean` | `false` | 段落首行缩进（CSS text-indent） | ⏳ Phase 2c 待引入 |
| `indent` | `number` | `0` | 整段缩进层级 | ✓ 已存在（框架级） |
| `align` | `'left'|'center'|'right'|'justify'` | `'left'` | 水平对齐 | ⏳ Phase 2c 待引入 |

→ 详 [main index §3 框架级 attrs](../../pm-note.md#3-框架级-attrs-schema-builder-注入)。

### 3.4 attrs 引用形式（Phase 2c 完成态）

```ts
import type { TextFlowAttrs } from '@/semantic/mixins/text-flow';

type ParagraphAttrs = TextFlowAttrs & {
  isTitle: boolean;
};
```

---

## 4. content 嵌套规则

```ts
content: 'inline*'
```

`paragraph` 可以包含 0 或多个 inline 节点：

| 允许的子节点 | 节点 type |
|---|---|
| 文本 | `text` |
| 行内数学 | `mathInline` |
| 笔记链接 | `noteLink` |
| 文件链接 | `fileLink` |
| 软换行 | `hard_break` |
| 行内 mark（在 text 上） | bold / italic / underline / strike / code / textStyle / highlight / link |

### 4.1 嵌套约束

- `paragraph` **不能**包含其他 block（如不能嵌套 paragraph / heading / list）。
- `paragraph` **可以**作为以下父容器的子节点：
  - `doc`（顶层）
  - `listItem` / `taskItem`
  - `blockquote`
  - `tableCell` / `tableHeader`
  - `callout`
  - `toggleList`
  - `image` content（image 节点内嵌一个 block 作 caption，常为 paragraph）

### 4.2 noteTitle 特殊约束

当 `isTitle: true` 时：

- title-guard plugin 禁止 paste 多行（取第一行）。
- title-guard plugin 禁止 Enter（光标跳到下一段）。
- 不允许 Slash / handle 命令 turnInto 任何类型。
- 默认应位于 `doc` 第一个子节点；若被删 / 改类型 → appendTransaction 自动补回空 isTitle paragraph。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
// 普通段落
{ type: 'paragraph', attrs: { isTitle: false, indent: 0 }, content: [...] }

// 文档标题
{ type: 'paragraph', attrs: { isTitle: true, indent: 0 }, content: [{ type: 'text', text: '我的笔记' }] }
```

### 5.2 parseDOM

```ts
parseDOM: [
  {
    tag: 'p',
    getAttrs(dom) {
      const el = dom as HTMLElement;
      return { isTitle: el.getAttribute('data-is-title') === 'true' };
    },
  },
]
```

**接受输入**：
- `<p>...</p>` → `isTitle: false`
- `<p data-is-title="true">...</p>` → `isTitle: true`

### 5.3 toDOM

```ts
toDOM(node) {
  const isTitle = node.attrs.isTitle as boolean;
  if (isTitle) return ['p', { 'data-is-title': 'true', class: 'krig-note-title' }, 0];
  return ['p', 0];
}
```

### 5.4 Markdown 互转（参考 prosemirror-markdown）

| 方向 | 转换 |
|---|---|
| MD → paragraph | 普通段落文字 `text\ntext` → `paragraph(text)` |
| MD → noteTitle | **无映射** —— Markdown 没有 noteTitle 概念，需要从 doc 上下文识别"第一段" |
| paragraph → MD | `text\n\n` |
| noteTitle → MD | 单行字符串 + 双换行（文档级别约定） |

→ noteTitle 的 Markdown 序列化策略待 Phase 3+ 决议（capability.text-editing 选择性导出）。

### 5.5 可逆性

| 路径 | 是否无损 |
|---|---|
| paragraph ↔ PM doc | ✓ 完全无损（5 字段全保留） |
| paragraph → Markdown → paragraph | ⚠ 部分有损：`isTitle` / `indent` / 未来 `textIndent` / `align` 不在 Markdown 标准中 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `text-block` 节点（已删除）：

```ts
{
  type: 'text-block',
  attrs: {
    level: null | 1 | 2 | 3,  // null = paragraph; 1/2/3 = heading
    isTitle: boolean,         // 文档标题标识
  },
  content: 'inline*'
}
```

### 6.2 V2 处置（已实施）

按 [decision 005](../../atom/decisions/005-block-schema-decomposition.md) D1 + 实施记录：

- V1 `text-block` + `level: null` + `isTitle: false` → V2 `paragraph` + `isTitle: false` ✓
- V1 `text-block` + `level: null` + `isTitle: true` → V2 `paragraph` + `isTitle: true` ✓
- V1 `text-block` + `level: 1/2/3` + `isTitle: false` → V2 `heading` + `level: 1/2/3` ✓（不是 paragraph）

### 6.3 V1 数据迁移

V2 当前无 V1 历史数据迁移需求（按 [decision 004 N7](../../atom/decisions/004-phase2b-resolutions.md#3-n7--v1-imagecaption-历史迁移)）。

未来如需要从 V1 真实数据迁移：

```ts
function migrateTextBlock(v1Node: V1TextBlock): V2Node {
  if (v1Node.attrs.level === null) {
    return {
      type: 'paragraph',
      attrs: { isTitle: v1Node.attrs.isTitle, indent: v1Node.attrs.indent ?? 0 },
      content: v1Node.content,
    };
  } else {
    return {
      type: 'heading',
      attrs: { level: v1Node.attrs.level, indent: v1Node.attrs.indent ?? 0 },
      content: v1Node.content,
    };
  }
}
```

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-PARA-1 | TextFlowAttrs 引入时，paragraph 的 `textIndent` / `align` 默认值是否就按 mixins/text-flow.md 写的 `false` / `'left'`？ | **是**（Mixin 文档定义即权威） | Phase 2c 实施时 |
| P-PARA-2 | noteTitle 是否允许带 mark（如 bold / italic）？V1 行为是允许，capability 渲染时强制大字号样式 | **允许带 mark**（不限制 schema 层），渲染层叠加 .krig-note-title 样式 | 实施时核验 V2 capability.text-editing |
| P-PARA-3 | paragraph.attrs.indent 由框架级注入 + Mixin 引用 —— 是否会产生 attrs 重复声明的 schema 错误？ | **不会**（框架级 inject 是合并，不是覆盖；spec.attrs 已有 indent 则保留 spec 的） | 实施时核验 schema-builder 实际合并行为 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/paragraph/spec.ts`
- [`atom/decisions/005-block-schema-decomposition.md`](../../atom/decisions/005-block-schema-decomposition.md) D1（noteTitle 处置）
- [`mixins/text-flow.md`](../../mixins/text-flow.md)（TextFlowAttrs 字段定义）
- [`naming-conventions.md`](../../naming-conventions.md) §2.4 段落/文本流字段表
- [main index pm-note.md](../../pm-note.md) §1 Note 整体结构
