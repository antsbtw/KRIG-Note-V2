# tableRow

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/table/spec.ts`（与 table / tableCell / tableHeader 共文件）

---

## 1. 语义边界

`tableRow` 是**表格行** PM 节点 —— 对应 HTML `<tr>`、GFM 表格的一行。

### 1.1 形态特征

- **不属于 group: 'block'** —— 只能作为 table 的子节点。
- **tableRole: 'row'**（prosemirror-tables 库识别）。
- **content**: 接受 tableCell / tableHeader 混合（PM content 表达式 `(tableCell | tableHeader)+`）。

---

## 2. type 字段值

```ts
type: 'tableRow'
```

V2 实际 id 驼峰 `tableRow`。

---

## 3. attrs schema

### 3.1 节点级 attrs

无。

### 3.2 框架级注入 attrs

⚠ `tableRow` 没有 `group: 'block'` 字段（只能作为 table 子节点），**不被框架级 indent 注入**。

---

## 4. content 嵌套规则

```ts
content: '(tableCell | tableHeader)+'
tableRole: 'row'
```

接受 tableCell + tableHeader 混合（允许同一行混用，常见场景：第一列是 header，其余是 data）。

### 4.1 嵌套约束

- 子节点必须是 tableCell 或 tableHeader（一个或多个，可混用）。
- 父容器**只能**是 `table`（PM schema 限制）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'tableRow',
  content: [
    { type: 'tableCell', attrs: { ... }, content: [{ type: 'paragraph', ... }] },
    { type: 'tableCell', attrs: { ... }, content: [...] }
  ]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [{ tag: 'tr' }]
toDOM() { return ['tr', 0]; }
```

### 5.3 Markdown 互转

tableRow 不独立映射 Markdown —— 它的 Markdown 形态由父 table 决定（pipe-separated 行）。

---

## 6. V1 → V2 处置

直搬，命名一致。

---

## 7. Open Questions

无。

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/table/spec.ts`
- [table.md](./table.md)（父节点） / [tableCell.md](./table-cell.md) / [tableHeader.md](./table-header.md)
- HTML5 `<tr>` 标准
