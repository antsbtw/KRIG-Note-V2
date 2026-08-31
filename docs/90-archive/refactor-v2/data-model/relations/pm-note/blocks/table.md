# table

> **Status**: V2 已实现 ✓（L5-B3.7，基于 prosemirror-tables）
> **Source**: `src/drivers/text-editing-driver/blocks/table/spec.ts`（与 tableRow / tableCell / tableHeader 共文件）

---

## 1. 语义边界

`table` 是**表格容器** block 节点 —— 对应 HTML `<table>`、Markdown GFM 表格。

V2 表格系列由 4 个独立 PM 节点构成：

```
table          content='tableRow+'                  tableRole='table'      isolating
  └── tableRow    content='(tableCell|tableHeader)+'  tableRole='row'
        ├── tableCell    content='block+'   tableRole='cell'        isolating
        └── tableHeader  content='block+'   tableRole='header_cell' isolating
```

注：V2 PM content 表达式不允许节点 name 含短横线（详 [feedback_pm_schema_naming](../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_pm_schema_naming.md)），所以 4 个节点 id 全部驼峰命名。

### 1.1 形态特征

- **block 节点**（`group: 'block'`），**isolating: true**（光标 / selection 不跨 table 边界）。
- **plugin 三件套**：
  - `tableEditing()` —— prosemirror-tables 内置，处理 selection / keymap / 删除保护
  - `columnResizing()` —— 拖 cell 边界改 colwidth + 同步 colgroup
  - `tableKeymapPlugin` —— Tab / Shift-Tab 自定义（末 cell Tab 加新行）

---

## 2. type 字段值

```ts
type: 'table'
```

PM / HTML 标准命名（阶梯 1）。

---

## 3. attrs schema

### 3.1 节点级 attrs

无（表格 attrs 全部下沉到 tableCell / tableHeader）。

### 3.2 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

---

## 4. content 嵌套规则

```ts
content: 'tableRow+'
group: 'block'
tableRole: 'table'
isolating: true
```

仅接受 tableRow 子节点。

### 4.1 嵌套约束

- 子节点必须是 `tableRow`（一个或多个）。
- 父容器：`doc` / `listItem` / `taskItem` / `blockquote` / `callout` / `toggleList` —— **不**能在 `tableCell` 内嵌套（PM-tables 行为，避免无限嵌套）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'table',
  attrs: { indent: 0 },
  content: [
    { type: 'tableRow', content: [
      { type: 'tableHeader', attrs: { ... }, content: [{ type: 'paragraph', ... }] },
      { type: 'tableHeader', attrs: { ... }, content: [...] }
    ]},
    { type: 'tableRow', content: [
      { type: 'tableCell', attrs: { ... }, content: [{ type: 'paragraph', ... }] },
      ...
    ]}
  ]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [{ tag: 'table' }]
toDOM() { return ['table', { class: 'krig-pm-table' }, ['tbody', 0]]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → table | GFM 表格（pipe-separated）→ table + tableRow + tableHeader/tableCell |
| table → MD | GFM 表格语法（仅当所有 cell 都是简单 inline 内容时无损） |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| table ↔ PM doc | ✓ 完全无损 |
| table → Markdown → table | ⚠ 部分有损：colspan / rowspan / colwidth / align 在 GFM 中不完全支持 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `table` / `tableRow` / `tableCell` / `tableHeader`（4 个节点）—— attrs 类似。

### 6.2 V2 处置

- 4 个节点 id 沿用 V1 命名（驼峰，对齐 V1 + 满足 PM content 表达式约束）。
- 沿用 prosemirror-tables 库（V1 / V2 同库）。

### 6.3 V1 数据迁移

无须迁移（字段命名一致）。

---

## 7. Open Questions

无。

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/table/spec.ts`
- [tableRow](./table-row.md) / [tableCell](./table-cell.md) / [tableHeader](./table-header.md)
- prosemirror-tables 库文档
- HTML5 `<table>` / GFM 表格标准
