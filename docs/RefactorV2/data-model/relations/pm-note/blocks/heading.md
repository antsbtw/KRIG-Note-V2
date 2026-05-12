# heading

> **Status**: V2 已实现 ✓（commit `c9ae4e4` / decision 005 D2）
> **Source**: `src/drivers/text-editing-driver/blocks/heading/spec.ts`

---

## 1. 语义边界

`heading` 是 PM 标准的**章节标题**节点。表达文档内部的"节标题 / 子节标题"语义，由 `level` attrs 区分级别（1-6）。

### 1.1 heading vs paragraph

按 [decision 005](../../atom/decisions/005-block-schema-decomposition.md) 拆分后，`heading` 和 [paragraph](./paragraph.md) 是两个独立 PM 节点。判定规则：

| 场景 | 节点 |
|---|---|
| 章节标题（任意 level 1-6） | `heading` |
| 普通文字段落 | `paragraph` |
| 文档标题（doc 首块大字号） | `paragraph` + `attrs.isTitle: true`（**不是** heading） |

### 1.2 heading 不承载 noteTitle 的理由

按 [decision 005 D1](../../atom/decisions/005-block-schema-decomposition.md#1-改造目标-what)：

- HTML5 / Markdown 标准里 `<h1>` 表达章节标题，可有多个。
- 文档标题（noteTitle）表达文档身份，只有一个 —— V2 用 `paragraph.attrs.isTitle: true` 承载。
- heading 仅承载章节标题语义，level 1-6 全部是"章节级别"，不混入 noteTitle 概念。

---

## 2. type 字段值

```ts
type: 'heading'
```

PM 标准命名。`naming-conventions.md` §3.1 阶梯 1（PM/HTML 标准）。

---

## 3. attrs schema

### 3.1 节点级 attrs（V2 当前实现）

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `level` | `1 \| 2 \| 3 \| 4 \| 5 \| 6` | `1` | 标题级别（CommonMark 标准范围 1-6） | 阶梯 1（CommonMark / PM 标准） |

### 3.2 框架级注入 attrs（schema-builder）

按字段优先级规则 `framework-injected > node-declared`（详 [主索引 §3.1](../../pm-note.md#31-字段优先级规则强制约定)），框架自动注入：

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `indent` | `number` | `0` | 整段缩进层级 |

### 3.3 Phase 2c 待引入的 attrs（TextFlowAttrs Mixin）

| 字段 | 类型 | 默认值 | 含义 | 状态 |
|---|---|---|---|---|
| `textIndent` | `boolean` | `false` | 首行缩进 | ⏳ Phase 2c |
| `indent` | `number` | `0` | 整段缩进 | ✓ 已存在（框架级） |
| `align` | `'left'\|'center'\|'right'\|'justify'` | `'left'` | 水平对齐 | ⏳ Phase 2c |

### 3.4 attrs 引用形式（Phase 2c 完成态）

```ts
import type { TextFlowAttrs } from '@/semantic/mixins/text-flow';

type HeadingAttrs = TextFlowAttrs & {
  level: 1 | 2 | 3 | 4 | 5 | 6;
};
```

### 3.5 level 取值范围扩展（D2）

V1 仅支持 `level: 1 | 2 | 3`，V2 schema 扩到 1-6（CommonMark 完整范围）。

- **schema 层面**：parseDOM 接受 `h1` - `h6` 全部 6 种标签；toDOM 输出对应 `h${level}`。
- **UI 渲染层面**：capability.text-editing 可选择只样式化 1-3（与 V1 行为一致），4-6 留扩展余地，将来按需启用。
- **快捷键**：`build-heading-keymap.ts` 仅绑定 Mod-Alt-1 / 2 / 3（与 V1 一致），4-6 暂不绑快捷键。

---

## 4. content 嵌套规则

```ts
content: 'inline*'
```

`heading` 可以包含 0 或多个 inline 节点（与 paragraph 同）：

| 允许的子节点 | 节点 type |
|---|---|
| 文本 | `text` |
| 行内数学 | `mathInline` |
| 笔记链接 | `noteLink` |
| 文件链接 | `fileLink` |
| 软换行 | `hardBreak` |
| 行内 mark | bold / italic / underline / strike / code / textStyle / highlight / link |

### 4.1 嵌套约束

- `heading` **不能**包含其他 block（如不能嵌套 paragraph / heading / list）。
- `heading` **可以**作为以下父容器的子节点：
  - `doc`（顶层）
  - `listItem` / `taskItem`
  - `blockquote`
  - `tableCell` / `tableHeader`
  - `callout`
  - `toggleList`
- `heading` 标记为 `defining: true` —— PM 的"语义化容器"属性，影响 Backspace / Enter 边界行为。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{ type: 'heading', attrs: { level: 2, indent: 0 }, content: [{ type: 'text', text: '章节标题' }] }
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  { tag: 'h1', attrs: { level: 1 } },
  { tag: 'h2', attrs: { level: 2 } },
  { tag: 'h3', attrs: { level: 3 } },
  { tag: 'h4', attrs: { level: 4 } },
  { tag: 'h5', attrs: { level: 5 } },
  { tag: 'h6', attrs: { level: 6 } },
]
toDOM(node) { return [`h${node.attrs.level}`, 0]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → heading | `# Title` → `heading(level=1)`，`## Sub` → `heading(level=2)`，依次到 `###### ` → `heading(level=6)` |
| heading → MD | `#` * level + ` ` + content |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| heading ↔ PM doc | ✓ 完全无损 |
| heading → Markdown → heading | ⚠ 部分有损：`indent` / 未来 `textIndent` / `align` 不在 Markdown 标准中 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 用合一 `text-block` + `level: 1/2/3`（非 null）表达 heading（已删除）。

### 6.2 V2 处置（已实施）

- V1 `text-block` + `level: 1/2/3` + `isTitle: false` → V2 `heading` + `level: 1/2/3` ✓
- V2 schema 扩到 `level: 1-6`（CommonMark 完整范围）
- 命名按 PM 标准（`heading`，不是 `headingBlock`）

### 6.3 V1 数据迁移

V2 当前无 V1 数据迁移需求（统一伪代码示例见 [paragraph.md §6.3](./paragraph.md#63-v1-数据迁移)）。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-HEAD-1 | UI 渲染层何时支持 H4-H6？影响 capability.text-editing 范围 | **schema 支持 1-6**，UI 当前样式化 1-3（与 V1 一致） | 视 NoteView 业务需求 |
| P-HEAD-2 | heading 内是否允许嵌套 mark `code`（行内代码）？语义合理但视觉怪 | **schema 不禁止**，由 UI 决定是否提供入口 | 实施时核验 capability.text-editing |
| P-HEAD-3 | Mod-Alt-4/5/6 快捷键是否绑定（与 H4-H6 渲染配套）？ | **暂不绑定**（与 V1 一致），未来按需 | 配合 P-HEAD-1 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/heading/spec.ts`
- [`atom/decisions/005-block-schema-decomposition.md`](../../atom/decisions/005-block-schema-decomposition.md) D2（level 范围扩到 1-6）
- [`mixins/text-flow.md`](../../mixins/text-flow.md)（TextFlowAttrs 字段定义）
- [`naming-conventions.md`](../../naming-conventions.md) §1.1 阶梯 1（Markdown `heading.level` 标准）
- [paragraph.md](./paragraph.md)（姊妹节点 —— 拆分的另一半）
