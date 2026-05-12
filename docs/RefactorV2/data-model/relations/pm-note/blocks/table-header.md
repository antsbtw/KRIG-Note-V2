# tableHeader

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/table/spec.ts`（与 table / tableRow / tableCell 共文件）

---

## 1. 语义边界

`tableHeader` 是**表头单元格** PM 节点 —— 对应 HTML `<th>`、GFM 表格的标题行单元格。

### 1.1 形态特征

- **不属于 group: 'block'** —— 只能作为 tableRow 子节点。
- **tableRole: 'header_cell'**（prosemirror-tables 库识别）。
- **isolating: true** —— 光标 / selection 不跨 cell 边界。
- **content: 'block+'** —— 与 tableCell 完全一致。

### 1.2 tableHeader vs tableCell

V2 用**独立 PM 节点 type** 表达 header（不是 tableCell.attrs.isHeader）—— 按 [decision 004 §4 字段冗余判定准则](../../atom/decisions/004-phase2b-resolutions.md)：

> 两种"类别"是**完全不同的节点**（HTML 标签不同 / 语义不同）→ 拆为**不同的 node type**

→ tableHeader 跟 tableCell 在 HTML 中是不同元素（`<th>` vs `<td>`），语义不同（标题 vs 数据），V2 用独立节点表达。

---

## 2. type 字段值

```ts
type: 'tableHeader'
```

V2 实际 id 驼峰 `tableHeader`。

---

## 3. attrs schema

### 3.1 节点级 attrs

跟 tableCell **完全一致**：

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `colspan` | `number` | `1` | 列合并跨度 |
| `rowspan` | `number` | `1` | 行合并跨度 |
| `colwidth` | `number[] \| null` | `null` | 列宽数组 |
| `align` | `'left'\|'center'\|'right'\|'justify'\|null` | `null` | 文字对齐 |

### 3.2 关于 Mixin 抽取

按 [decision 004 §4 Mixin 列表决议](../../atom/decisions/004-phase2b-resolutions.md)，**TableCellAttrs Mixin 被砍掉** —— 理由：仅 tableCell + tableHeader 两次重复，Mixin 抽取成本 > 收益。

→ tableCell / tableHeader 各自维护字段定义（接受冗余），未来如出现第三个用户再考虑抽 Mixin。

### 3.3 框架级注入 attrs

⚠ `tableHeader` 没有 `group: 'block'` 字段，**不被框架级 indent 注入**。

---

## 4. content 嵌套规则

跟 tableCell 完全一致：

```ts
content: 'block+'
tableRole: 'header_cell'
isolating: true
```

### 4.1 嵌套约束

- 必须至少有一个 block 子节点。
- 父容器**只能**是 `tableRow`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'tableHeader',
  attrs: { colspan: 1, rowspan: 1, colwidth: [120], align: 'center' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Header' }] }]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [{ tag: 'th', getAttrs(dom) { /* 同 tableCell 反解 */ } }]
toDOM(node) { return ['th', { ... colspan / rowspan / data-colwidth / style }, 0]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → tableHeader | GFM 表格首行（pipe 分隔，下面有 `---` 分隔线）→ tableHeader |
| tableHeader → MD | 与 tableCell 同模式，仅区别于"位于首行"约定 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `tableHeader` —— 同名，attrs 类似（但 V1 cell 用 isHeader attrs 区分 header；V1 也有独立 tableHeader 节点）。

### 6.2 V2 处置

- id 沿用 `tableHeader`。
- 同 tableCell：**删除 children 兼容字段** + 新增 colwidth。

### 6.3 V1 数据迁移

详 [tableCell.md §6.3](./table-cell.md#63-v1-数据迁移)（按 V1 isHeader 分派到 V2 tableHeader 或 tableCell）。

---

## 7. Open Questions

无。

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/table/spec.ts`
- [tableCell.md](./table-cell.md)（姊妹节点，字段完全相同）
- HTML5 `<th>` 标准 / GFM 表格
- [decision 004 §4](../../atom/decisions/004-phase2b-resolutions.md)（字段冗余判定准则 / TableCellAttrs Mixin 砍掉理由）
