# taskItem

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/task-list/spec.ts`（与 taskList 共文件）

---

## 1. 语义边界

`taskItem` 是 `taskList` 内部的**任务项**节点 —— 跟 [listItem](./list-item.md) 平行，但带 `checked` attrs 表达完成状态 + 时间生命周期字段（createdAt / completedAt / deadline）。

对应 GFM `- [ ]` / `- [x]` 任务项语法、HTML `<li data-type="task-item" data-checked="...">`。

---

## 2. type 字段值

```ts
type: 'taskItem'
```

V2 实际 id 是驼峰 `taskItem`。

---

## 3. attrs schema

### 3.1 节点级 attrs（V2 当前实现）

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `checked` | `boolean` | `false` | 任务是否完成（GFM `- [x]` 标准） | 阶梯 2（HTML `<input type=checkbox checked>` / GFM） |
| `createdAt` | `string \| null` | `null` | 创建时间（ISO 字符串） | 阶梯 3（数据库通用约定） |
| `completedAt` | `string \| null` | `null` | 完成时间（ISO 字符串） | 阶梯 3 |
| `deadline` | `string \| null` | `null` | 截止时间（ISO 字符串） | KRIG 自定义 |

### 3.2 命名争议（RFC vs 实现）

按 [naming-conventions.md §2.6](../../naming-conventions.md)：

- **RFC 提议**：V1 `deadline` 改名 `due`（GTD 通用术语）
- **V2 当前实际**：仍叫 `deadline`（V1 直迁）

→ V2 当前 `deadline` attrs 仍是 V1 命名，**未按 RFC 提议改 `due`**。

**处置选项**（标 Open Q P-TI-1，待决议）：
1. 保持 V2 `deadline`
2. 改 V2 `deadline` → `due`（GTD 通用，更短）

### 3.3 框架级注入 attrs

⚠ `taskItem` 没有 `group: 'block'` 字段（只能作为 taskList 子节点），**不被框架级 indent 注入**。

### 3.4 V1 兼容字段（已删除）

V1 `ListItemContent.children: InlineElement[]`（`@deprecated`）—— V2 已删除（同 listItem 处置）。

---

## 4. content 嵌套规则

```ts
content: 'block+'
defining: true
```

跟 listItem 一样接受任意 block 子节点。

### 4.1 嵌套约束

- 必须至少有一个 block 子节点（PM 强制）。
- 父容器**只能**是 `taskList`（PM schema 限制）。
- 可在内嵌任意 list（包括嵌套 taskList）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'taskItem',
  attrs: {
    checked: false,
    createdAt: '2026-05-11T10:00:00Z',
    completedAt: null,
    deadline: '2026-05-15T00:00:00Z',
  },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '任务内容' }] }]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'li[data-type="task-item"]',
    getAttrs(node) {
      const el = node as HTMLElement;
      return {
        checked: el.getAttribute('data-checked') === 'true',
        createdAt: el.getAttribute('data-created-at') || null,
        completedAt: el.getAttribute('data-completed-at') || null,
        deadline: el.getAttribute('data-deadline') || null,
      };
    },
  },
]
toDOM(node) {
  // ... 含 4 个 data-* 属性 + checkbox UI
}
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → taskItem | GFM `- [ ] item` → `taskItem({ checked: false })`；`- [x] item` → `checked: true`。createdAt / completedAt / deadline 在 GFM 中**无标准表达**。 |
| taskItem → MD | `- [<x|space>] <content>`，时间字段丢失。 |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| taskItem ↔ PM doc | ✓ 完全无损 |
| taskItem → Markdown → taskItem | ⚠ 部分有损：时间字段（createdAt / completedAt / deadline）丢失 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `taskItem` —— attrs: { checked, createdAt, completedAt, deadline } + `children` 兼容字段。

### 6.2 V2 处置

- id 沿用 `taskItem`。
- attrs 字段全部直搬（含 `deadline` 当前未改名）。
- **删除 `children` 兼容字段**（按 listItem 同等处置）。

### 6.3 V1 数据迁移

无须迁移（除 children 字段删除外，attrs 形态一致）。统一伪代码示例见 [list-item.md §6.3](./list-item.md#63-v1-数据迁移)。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-TI-1 | `deadline` 字段是否按 RFC 改 `due`？ | **暂保留 `deadline`**（V2 现状），改名需配套数据迁移 + UI 改造 | Phase 2c+ 视真实需求决议 |
| P-TI-2 | 时间字段（createdAt / completedAt / deadline）走 attrs 还是边？按 [decision 003 走法 B](../../atom/decisions/003-naming-conventions.md)，属性应走边 | **暂走 attrs**（V2 现状，迁边代价大） | Phase 3+ 视 SurrealDB 启用时机 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/task-list/spec.ts`
- GFM task list 标准
- [naming-conventions.md §2.6](../../naming-conventions.md)（deadline vs due 命名）
- [decisions/002 §"V1 AtomContent 字段判定"](../../atom/decisions/002-v1-fields-migration.md)
