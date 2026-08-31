# orderedList

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/ordered-list/spec.ts`

---

## 1. 语义边界

`orderedList` 是 PM / HTML 标准的**有序列表**节点 —— 对应 HTML `<ol>`、Markdown `1. `。

跟 [bulletList](./bullet-list.md) / [taskList](./task-list.md) 平行（不同 list 类型用不同节点 type 区分）。

---

## 2. type 字段值

```ts
type: 'orderedList'
```

V2 实际 id 是驼峰 `orderedList`。

---

## 3. attrs schema

### 3.1 节点级 attrs（V2 当前实现）

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `start` | `number` | `1` | 起始编号（HTML `<ol start>` 标准） | 阶梯 2（HTML） |

### 3.2 命名争议（RFC vs 实现）

按 [naming-conventions.md §1.2 / §2.6](../../naming-conventions.md)：

- **HTML 标准**：`start` (HTML `<ol start>`)
- **PM 标准**：`order` (prosemirror-schema-list `ordered_list.attrs.order`)
- **阶梯 2 冲突解决规则**：PM 优先 → V2 应改 `order`
- **V2 当前实际**：仍叫 `start`（V1 直迁）

→ V2 当前 `start` attrs 仍是 V1 命名，**未按 RFC 提议改为 `order`**。

**处置选项**（标 Open Q P-OL-1，待决议）：
1. 保持 V2 `start`（与 HTML 标准对齐）+ 在 RFC §1.2.1 例外清单登记
2. 改 V2 `start` → `order`（与 PM 标准对齐，遵循阶梯 2 PM 优先规则）

### 3.3 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 块级缩进层级（0–8，每级 24px margin-left 右移） |

---

## 4. content 嵌套规则

```ts
content: 'listItem+'
```

仅接受 `listItem` 子节点（与 bulletList 一致）。

### 4.1 嵌套约束

- 子节点必须是 `listItem`（一个或多个）。
- 可作为以下父容器的子节点：`doc` / `listItem` / `taskItem`（嵌套 list）/ `blockquote` / `callout` / `toggleList` / `tableCell`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'orderedList',
  attrs: { start: 1, indent: 0 },
  content: [
    { type: 'listItem', content: [...] }
  ]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'ol',
    getAttrs(node) {
      const start = (node as HTMLElement).getAttribute('start');
      return { start: start ? parseInt(start, 10) : 1 };
    },
  },
]
toDOM(node) {
  const start = node.attrs.start as number;
  if (start === 1) return ['ol', { class: 'krig-ordered-list' }, 0];
  return [
    'ol',
    {
      class: 'krig-ordered-list',
      start: String(start),
      style: `counter-reset: ordered-item ${start - 1}`,
    },
    0,
  ];
}
```

注：start ≠ 1 时通过 `counter-reset` inline style 让 CSS counter 从指定数字开始显示。

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → orderedList | `1. item\n2. item` → `orderedList(start=1, listItem...)` |
| orderedList → MD | 按 `start` 起始编号递增（CommonMark 也支持任意起始数）|

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| orderedList ↔ PM doc | ✓ 完全无损 |
| orderedList → Markdown → orderedList | ✓ 大部分无损（CommonMark 标准支持 start）|

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `orderedList`（同名）—— attrs `start: number`。

### 6.2 V2 处置

直搬节点 + 字段。命名 `start` 暂保留 V1（详 §3.2 命名争议）。

### 6.3 V1 数据迁移

无须迁移（V2 当前 start 字段与 V1 一致）。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-OL-1 | `start` 字段是否按 RFC §1.2 阶梯 2 PM 优先规则改名 `order`？V2 当前实现 + V1 数据都用 `start` | **暂保留 `start`**（HTML 标准命名 + V2 现状），改名需配套 capability 改造 | Phase 2c+ 视真实需求决议 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/ordered-list/spec.ts`
- HTML5 `<ol start>` 标准
- prosemirror-schema-list `ordered_list.attrs.order`
- [naming-conventions.md §2.6](../../naming-conventions.md)（start vs order 命名表）
