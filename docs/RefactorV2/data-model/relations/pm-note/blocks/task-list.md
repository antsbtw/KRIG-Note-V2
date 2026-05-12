# taskList

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/task-list/spec.ts`

---

## 1. 语义边界

`taskList` 是**任务列表**容器节点 —— 跟 bulletList / orderedList 平行，但子节点是 `taskItem`（带 checked attrs）。

对应 GFM `- [ ]` / `- [x]` 任务列表语法、HTML `<ul data-type="task-list">`。

### 1.1 形态特征

- **block 容器**：`content: 'taskItem+'` —— 仅接受 taskItem 子节点。
- 跟 `bulletList` / `orderedList` 平行节点（同为 list 容器，子节点类型不同）。

---

## 2. type 字段值

```ts
type: 'taskList'
```

V2 实际 id 是驼峰 `taskList`。

---

## 3. attrs schema

### 3.1 节点级 attrs

无。

### 3.2 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

---

## 4. content 嵌套规则

```ts
content: 'taskItem+'
```

仅接受 `taskItem` 子节点（与 bulletList/orderedList 接受 listItem 平行）。

### 4.1 嵌套约束

- 子节点必须是 `taskItem`（一个或多个）。
- 可作为以下父容器的子节点：`doc` / `listItem` / `taskItem`（嵌套）/ `blockquote` / `callout` / `toggleList` / `tableCell`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'taskList',
  attrs: { indent: 0 },
  content: [
    { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', ... }] },
    { type: 'taskItem', attrs: { checked: true }, content: [...] }
  ]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [{ tag: 'ul[data-type="task-list"]' }]
toDOM() { return ['ul', { 'data-type': 'task-list', class: 'krig-task-list' }, 0]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → taskList | GFM `- [ ] item\n- [x] item` → `taskList(taskItem...)` |
| taskList → MD | `- [<x|space>] ` 前缀 + 内容 |

CommonMark 标准不含 task list，依赖 GFM 扩展。

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| taskList ↔ PM doc | ✓ 完全无损 |
| taskList → Markdown → taskList | ⚠ 部分有损：`taskItem.createdAt` / `completedAt` / `deadline` 在 GFM 标准中不表达 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `taskList`（同名）—— V1 ListContent 含 `listType: 'task'` attrs。

### 6.2 V2 处置

- id 沿用 `taskList`。
- **删除 `listType` attrs**（同 bulletList / orderedList 的处置，详 [decision 004 §4 字段冗余判定准则](../../atom/decisions/004-phase2b-resolutions.md)）。

### 6.3 V1 数据迁移

无须迁移（除 listType 字段删除外，节点形态一致）。

---

## 7. Open Questions

无。

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/task-list/spec.ts`（spec 与 taskItem 共文件）
- GFM task list 标准
- [task-item.md](./task-item.md)（子节点）
