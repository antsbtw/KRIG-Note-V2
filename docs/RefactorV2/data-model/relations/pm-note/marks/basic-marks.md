# basic-marks（bold / italic / underline / strike / code 五合一）

> **Status**: V2 已实现 ✓（5 个 mark 全部已注册）
> **Source**: `src/drivers/text-editing-driver/marks/{bold,italic,underline,strike,code}.ts`

---

## 1. 语义边界

本文档定义 V2 **5 个基础 mark**（行内文字修饰）：

| Mark type | 视觉效果 | HTML 渲染 | 用户意图 |
|---|---|---|---|
| `bold` | 粗体 | `<strong>` | 视觉粗体（**非**语义强调） |
| `italic` | 斜体 | `<em>` | 视觉斜体（**非**语义强调） |
| `underline` | 下划线 | `<u>` | 装饰 |
| `strike` | 删除线 | `<s>` | 删除标记 |
| `code` | 行内代码 | `<code>` | 代码片段标识 |

### 1.1 命名争议：bold/italic vs strong/em

按 [decision 004 §1](../../atom/decisions/004-phase2b-resolutions.md#1-n6--mark-命名保留-v1-bold--italic) + [naming-conventions.md §1.2.1 PM 优先例外清单](../../naming-conventions.md)：

- Markdown / PM 标准用 `strong` / `em`（语义强调）。
- V2 选 `bold` / `italic`（样式意图）—— 登记为 PM 优先规则的例外。
- 理由：用户编辑场景 99% 是视觉粗体 / 斜体意图，非"强调"语义；命名风格与其他 mark（underline / strike / highlight）统一；V2 代码 60+ 处使用，零迁移成本。

### 1.2 code mark 不是 codeInline 节点

V2 行内代码通过给 text 节点叠加 `code` mark 实现，**不**通过独立 inline 节点。

`naming-conventions.md` §2.1 提到 codeInline 是 V1 概念，V2 实际只有 `code` mark + `codeBlock` 节点。

---

## 2. type 字段值

```ts
// PM Mark 注册 (src/drivers/text-editing-driver/marks/index.ts)
export const MARKS: Record<string, MarkSpec> = {
  bold: boldMark,
  italic: italicMark,
  underline: underlineMark,
  strike: strikeMark,
  code: codeMark,
  // ...
};
```

5 个 mark type 字面量：`'bold'` / `'italic'` / `'underline'` / `'strike'` / `'code'`。

---

## 3. attrs schema

所有 5 个 basic mark **无 attrs**（叶子 mark，仅表达"打开 / 关闭"状态）。

```ts
// 示例：bold mark spec
export const boldMark: MarkSpec = {
  parseDOM: [
    { tag: 'strong' },
    { tag: 'b' },
    { style: 'font-weight=bold' },
  ],
  toDOM() { return ['strong', 0]; },
};
```

注：本节描述的 5 个 mark 均无 attrs。带 attrs 的 mark（`textStyle.color` / `highlight.color` / `link.href`）见各自子文档（批 3 待写）。

---

## 4. 互斥规则（excludes）

| Mark | 互斥 |
|---|---|
| `bold` | 无 |
| `italic` | 无 |
| `underline` | 无 |
| `strike` | 无 |
| `code` | **`excludes: '_'`** —— code 与任何其他 inline mark 互斥（PM 惯例：行内代码不与粗体 / 斜体 / 高亮等共存） |

V2 实现：

```ts
// marks/code.ts
export const codeMark: MarkSpec = {
  excludes: '_',  // 排他
  parseDOM: [{ tag: 'code' }],
  toDOM() { return ['code', 0]; },
};
```

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
// 普通粗体
{ type: 'text', text: 'hello', marks: [{ type: 'bold' }] }

// 粗体 + 斜体（多 mark 叠加）
{ type: 'text', text: 'hello', marks: [{ type: 'bold' }, { type: 'italic' }] }

// 行内代码（与其他 mark 互斥）
{ type: 'text', text: 'code', marks: [{ type: 'code' }] }
```

### 5.2 parseDOM 覆盖

每个 mark 接受多种 HTML 输入：

| Mark | 接受标签 / 样式 |
|---|---|
| `bold` | `<strong>` / `<b>` / `style=font-weight:bold` |
| `italic` | `<em>` / `<i>` / `style=font-style:italic` |
| `underline` | `<u>` / `style=text-decoration:underline` |
| `strike` | `<s>` / `<del>` / `<strike>` / `style=text-decoration:line-through` |
| `code` | `<code>` |

### 5.3 toDOM 标签

输出选择**语义化 HTML 标签**（PM 默认惯例）：

| Mark | 输出标签 |
|---|---|
| `bold` | `<strong>` |
| `italic` | `<em>` |
| `underline` | `<u>` |
| `strike` | `<s>` |
| `code` | `<code>` |

→ V2 内部 mark type 是 `bold`，渲染 DOM 是 `<strong>`。这种"内部名 vs 输出名"分离是 PM 互操作的标准做法，对齐 [decision 004 §1](../../atom/decisions/004-phase2b-resolutions.md#1-n6--mark-命名保留-v1-bold--italic) "PM 互操作通过转换层处理"原则。

### 5.4 Markdown 互转

| Mark | Markdown 语法 |
|---|---|
| `bold` | `**bold**` 或 `__bold__` |
| `italic` | `*italic*` 或 `_italic_` |
| `code` | `` `code` `` |
| `strike` | `~~strike~~`（GFM） |
| `underline` | **无 Markdown 标准**（仅 V2 / HTML 概念，序列化时输出 `<u>`） |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 5 个 mark 命名与 V2 完全相同（bold / italic / underline / strike / code），attrs 形态也相同（全部无 attrs）。

### 6.2 V2 处置

**直搬，零变更**。V2 5 个 basic mark spec 跟 V1 行为一致。

### 6.3 V1 数据迁移

无须迁移（mark type 字符串完全一致，attrs 形态一致）。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-BM-1 | underline 在 HTML5 中语义不推荐（"非语义化"），V2 是否考虑改为 `ins` mark（插入）？ | **保留 underline**（用户视觉意图明确） | 不调整 |
| P-BM-2 | code mark 是否考虑加 `language?` attrs 标识语法（与 codeBlock.info 类比）？ | **暂不加**（行内代码通常无语法高亮需求） | 视真实场景 |
| P-BM-3 | underline / strike 同时启用时视觉冲突，capability 是否提供互斥逻辑？ | **schema 不互斥**（允许并存），UI 视觉处理由 capability 决定 | 实施时核验 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/marks/bold.ts`
- `src/drivers/text-editing-driver/marks/italic.ts`
- `src/drivers/text-editing-driver/marks/underline.ts`
- `src/drivers/text-editing-driver/marks/strike.ts`
- `src/drivers/text-editing-driver/marks/code.ts`
- [decision 004 §1 N6 决议](../../atom/decisions/004-phase2b-resolutions.md#1-n6--mark-命名保留-v1-bold--italic)（bold/italic 命名例外）
- [naming-conventions.md §2.12](../../naming-conventions.md)（Mark 类型命名表）
- CommonMark / GFM mark 标准（strong / em / strike）
