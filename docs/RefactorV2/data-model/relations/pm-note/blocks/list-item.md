# listItem

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/list-item/spec.ts`

---

## 1. 语义边界

`listItem` 是 `bulletList` / `orderedList` 内部的**列表项**节点 —— 对应 HTML `<li>`、Markdown 列表行。

### 1.1 形态特征

- **block 容器**：`content: 'block+'` —— 接受任意 block 子节点（paragraph / heading / 嵌套 list / blockquote / 等）。
- **defining: true** —— PM 语义化容器。
- **不属于 ENABLED_BLOCKS 的 group: 'block'** —— listItem 没有 group 字段，只能作为 bulletList / orderedList 的子节点（PM schema 强制）。

### 1.2 listItem vs taskItem

| 场景 | 节点 | 父容器 |
|---|---|---|
| 普通列表项（无勾选状态） | `listItem` | `bulletList` / `orderedList` |
| 任务项（带 checked） | `taskItem` | `taskList` |

详 [task-item.md](./task-item.md)。

---

## 2. type 字段值

```ts
type: 'listItem'
```

V2 实际 id 是驼峰 `listItem`。**id 必须是驼峰**（PM content 表达式不支持节点 name 含短横线，按 [feedback_pm_schema_naming](../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_pm_schema_naming.md)）。

---

## 3. attrs schema

### 3.1 节点级 attrs

| 字段 | 默认值 | 含义 |
|------|-------|------|
| `indent` | `0` | 块级缩进层级（0–8，每级 24px margin-left，整项右移）。2026-06-07 新增。 |

### 3.2 框架级注入 attrs

`listItem` 没有 `group: 'block'` 字段（只能作为 list 子节点），**不被框架级 indent 注入** ——
故在 **spec 节点级显式声明 `indent` attr**（见 §3.1），并由 `spec.toDOM` 出 `margin-left` 渲染。

> 2026-06-07 契约变更：列表项 Tab = **整项右移（indent attr）**，不是 sink 嵌套子列表。
> 缩进随 dissect/assemble 原样持久化。详见 [`block/indent-system.md`](../../../../../10-business-design/block/indent-system.md)。

### 3.3 V1 兼容字段（已删除）

V1 `ListItemContent.children: InlineElement[]`（`@deprecated` 兼容字段）—— V2 **已删除**（[decision 002 §"V1 AtomContent 字段判定"](../../atom/decisions/002-v1-fields-migration.md)）。

V2 listItem 内容走 PM 嵌套（content: 'block+'），不再用 children 兼容字段。

---

## 4. content 嵌套规则

```ts
content: 'block+'
defining: true
```

`listItem` 接受任意 block 子节点：

- `paragraph`（最常见）
- `heading`（列表项内嵌标题）
- `bulletList` / `orderedList` / `taskList`（嵌套列表）
- `blockquote` / `callout` / `toggleList`
- `image` / 等其他媒体 block

### 4.1 嵌套约束

- **必须**至少有一个 block 子节点（PM 强制）。
- 父容器**只能**是 `bulletList` / `orderedList`（PM schema 限制）。
- 不能直接作为 `doc` 的子节点（必须被 list 包裹）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'listItem',
  content: [
    { type: 'paragraph', attrs: { isTitle: false, indent: 0 }, content: [...] }
  ]
}
```

嵌套 list 示例：

```ts
{
  type: 'listItem',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '父项' }] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '子项' }] }] }
    ]}
  ]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [{ tag: 'li' }]
toDOM() { return ['li', 0]; }
```

### 5.3 Markdown 互转

listItem 不独立映射 Markdown —— 它的 Markdown 形态由父 list 决定（`- ` / `1. `）。

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `listItem` —— 含 `children: InlineElement[]` 兼容字段（`@deprecated`）。

### 6.2 V2 处置

- id 沿用 `listItem`。
- **删除 `children` 兼容字段** —— 完全走 PM 嵌套（content: 'block+'）。

### 6.3 V1 数据迁移

V1 旧数据若 children 字段非空（兼容路径），迁移时需展平为 textBlock 子节点：

```ts
// 仅在迁移 V1 旧数据时用
if (v1.children && v1.children.length > 0) {
  // V1 把 inline 抽到 children 字段 → V2 包成 paragraph 子节点
  return {
    type: 'listItem',
    content: [{ type: 'paragraph', content: v1.children }],
  };
}
```

V2 当前无 V1 历史数据，此迁移代码仅作未来参考。

---

## 7. Open Questions

无。

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/list-item/spec.ts`
- HTML5 `<li>` 标准
- [decisions/002 §"V1 AtomContent 字段判定"](../../atom/decisions/002-v1-fields-migration.md)（children 兼容字段删除）
