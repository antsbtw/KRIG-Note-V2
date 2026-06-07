# bulletList

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/bullet-list/spec.ts`

---

## 1. 语义边界

`bulletList` 是 PM / HTML 标准的**无序列表**节点 —— 对应 HTML `<ul>`、Markdown `- ` / `* ` / `+ `。

### 1.1 形态特征

- **block 容器**：`content: 'listItem+'` —— 仅接受 listItem 子节点。
- 跟 `orderedList` / `taskList` 是平行节点（不同 list 类型用不同节点 type 区分，按 [decision 004 §4.2 字段冗余判定准则](../../atom/decisions/004-phase2b-resolutions.md)）。

### 1.2 bulletList vs orderedList vs taskList

| 场景 | 节点 | 子节点 type |
|---|---|---|
| 无序列表（圆点） | `bulletList` | `listItem` |
| 有序列表（数字） | `orderedList` | `listItem` |
| 任务列表（复选框） | `taskList` | `taskItem` |

---

## 2. type 字段值

```ts
type: 'bulletList'
```

V2 实际 id 是驼峰 `bulletList`。

---

## 3. attrs schema

### 3.1 节点级 attrs

无。

### 3.2 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 块级缩进层级（0–8，每级 24px margin-left 右移；与嵌套深度无关） |

---

## 4. content 嵌套规则

```ts
content: 'listItem+'
```

仅接受 `listItem` 子节点（PM schema 强制约束），不能直接装其他 block。

### 4.1 嵌套约束

- 子节点必须是 `listItem`（一个或多个）。
- 可作为以下父容器的子节点：`doc` / `listItem` / `taskItem`（嵌套 list）/ `blockquote` / `callout` / `toggleList` / `tableCell`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'bulletList',
  attrs: { indent: 0 },
  content: [
    { type: 'listItem', content: [{ type: 'paragraph', ... }] },
    { type: 'listItem', content: [{ type: 'paragraph', ... }] }
  ]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [{ tag: 'ul' }]
toDOM() { return ['ul', { class: 'krig-bullet-list' }, 0]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → bulletList | `- item\n- item` / `* item` / `+ item` → `bulletList(listItem...)` |
| bulletList → MD | 每行 `- ` 前缀（首选 CommonMark `-`） |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| bulletList ↔ PM doc | ✓ 完全无损 |
| bulletList → Markdown → bulletList | ✓ 无损（无属性） |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `bulletList`（同名）—— V1 ListContent 含 `listType: 'bullet'` attrs。

### 6.2 V2 处置

- id 沿用 `bulletList`。
- **删除 `listType` attrs** —— V2 通过节点 type 区分（bulletList / orderedList / taskList），不需要冗余 attrs（[decision 004 §4 字段冗余判定准则](../../atom/decisions/004-phase2b-resolutions.md)）。

### 6.3 V1 数据迁移

```ts
// 简化伪代码（统一示例见 paragraph.md §6.3）
v1.listType === 'bullet' → v2.type === 'bulletList'
v1.listType === 'ordered' → v2.type === 'orderedList'
v1.listType === 'task' → v2.type === 'taskList'
```

---

## 7. Open Questions

无。

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/bullet-list/spec.ts`
- HTML5 `<ul>` 标准 / CommonMark bullet list
- [decisions/004 §4 字段冗余判定准则](../../atom/decisions/004-phase2b-resolutions.md)（listType 删除理由）
