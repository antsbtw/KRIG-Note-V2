# tableCell

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/table/spec.ts`（与 table / tableRow / tableHeader 共文件）

---

## 1. 语义边界

`tableCell` 是**表格单元格** PM 节点 —— 对应 HTML `<td>`、GFM 表格的数据单元格。

### 1.1 形态特征

- **不属于 group: 'block'** —— 只能作为 tableRow 子节点。
- **tableRole: 'cell'**（prosemirror-tables 库识别）。
- **isolating: true** —— 光标 / selection 不跨 cell 边界。
- **content: 'block+'** —— 接受任意 block 子节点（paragraph / heading / 嵌套 list 等）。

### 1.2 tableCell vs tableHeader

| 节点 | 对应 HTML | tableRole | 用途 |
|---|---|---|---|
| `tableCell` | `<td>` | `'cell'` | 数据单元格 |
| `tableHeader` | `<th>` | `'header_cell'` | 表头单元格 |

详 [tableHeader.md](./table-header.md)。

---

## 2. type 字段值

```ts
type: 'tableCell'
```

V2 实际 id 驼峰 `tableCell`。

---

## 3. attrs schema

### 3.1 节点级 attrs

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `colspan` | `number` | `1` | 列合并跨度 | 阶梯 2（HTML `<td colspan>`） |
| `rowspan` | `number` | `1` | 行合并跨度 | 阶梯 2（HTML `<td rowspan>`） |
| `colwidth` | `number[] \| null` | `null` | 列宽数组（prosemirror-tables columnResizing 写入） | KRIG 自定义（PM-tables 约定） |
| `align` | `'left'\|'center'\|'right'\|'justify'\|null` | `null` | 单元格文字对齐（null = 继承默认） | 阶梯 1（GFM `:---`/`---:`） |

### 3.2 V1 兼容字段（已删除）

V1 `TableCellContent.children: InlineElement[]`（`@deprecated`）—— V2 已删除（详 [decision 002 §"V1 AtomContent 字段判定"](../../atom/decisions/002-v1-fields-migration.md)）。

V2 tableCell 内容走 PM 嵌套（content: 'block+'），不再用 children 兼容字段。

### 3.3 框架级注入 attrs

⚠ `tableCell` 没有 `group: 'block'` 字段（只能作为 tableRow 子节点），**不被框架级 indent 注入**。

---

## 4. content 嵌套规则

```ts
content: 'block+'
tableRole: 'cell'
isolating: true
```

接受任意 block 子节点（paragraph / heading / list / 嵌套 blockquote / 等），**不**接受嵌套 table（PM-tables 限制）。

### 4.1 嵌套约束

- 必须至少有一个 block 子节点（PM 强制）。
- 父容器**只能**是 `tableRow`（PM schema 限制）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: [120], align: 'center' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [{ tag: 'td', getAttrs(dom) { /* colspan / rowspan / colwidth / align 反解 */ } }]
toDOM(node) { return ['td', { ... colspan / rowspan / data-colwidth / style }, 0]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → tableCell | GFM 表格 cell（pipe 分隔）→ tableCell + 内嵌 paragraph |
| tableCell → MD | 单元格文本（pipe 包围）；colspan / rowspan / colwidth 在 GFM 中**无标准** |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| tableCell ↔ PM doc | ✓ 完全无损 |
| tableCell → Markdown → tableCell | ⚠ 部分有损：colspan / rowspan / colwidth 丢失 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `tableCell` —— attrs: { colspan, rowspan, isHeader, align } + `children` 兼容字段。

### 6.2 V2 处置

- id 沿用 `tableCell`。
- **删除 children 兼容字段**（按 [decision 002](../../atom/decisions/002-v1-fields-migration.md) D2）。
- **删除 `isHeader` attrs** —— V2 用独立的 `tableHeader` 节点（不同 type）表达 header，避免 type/attrs 冗余（按 [decision 004 §4 字段冗余判定准则](../../atom/decisions/004-phase2b-resolutions.md)）。
- 新增 `colwidth: number[] | null`（V2 引入，配合 prosemirror-tables columnResizing）。

### 6.3 V1 数据迁移

```ts
function migrateTableCell(v1: V1TableCell): V2TableCell | V2TableHeader {
  // 按 V1 isHeader 分派到 V2 不同 type
  if (v1.attrs.isHeader) {
    return {
      type: 'tableHeader',
      attrs: { colspan: v1.attrs.colspan ?? 1, rowspan: v1.attrs.rowspan ?? 1, colwidth: null, align: v1.attrs.align ?? null },
      content: v1.children
        ? [{ type: 'paragraph', content: v1.children }]
        : v1.content,
    };
  }
  return {
    type: 'tableCell',
    attrs: { colspan: v1.attrs.colspan ?? 1, rowspan: v1.attrs.rowspan ?? 1, colwidth: null, align: v1.attrs.align ?? null },
    content: v1.children
      ? [{ type: 'paragraph', content: v1.children }]
      : v1.content,
  };
}
```

---

## 7. Open Questions

无。

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/table/spec.ts`
- prosemirror-tables 库文档
- HTML5 `<td>` 标准 / GFM 表格 align 语法
- [decisions/002](../../atom/decisions/002-v1-fields-migration.md) / [decisions/004 §4](../../atom/decisions/004-phase2b-resolutions.md)（字段冗余判定）
