# horizontalRule

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/horizontal-rule/spec.ts`

---

## 1. 语义边界

`horizontalRule` 是**水平分隔线**节点 —— 表达文档段落级的视觉/语义分隔，对应 HTML `<hr>`、Markdown `---`。

### 1.1 形态特征

- **叶子节点（atom）**：光标不能进入节点内部。
- **block 级**：占据完整一行，不能嵌入 inline 流。
- **selectable**：可以作为整体被选中（用于删除 / 移动）。

---

## 2. type 字段值

```ts
type: 'horizontalRule'
```

V2 实际 id 为驼峰 `horizontalRule`（不是 `horizontal-rule` 或 `horizontal_rule`），与 V2 其他 block id 命名风格一致。

---

## 3. attrs schema

### 3.1 节点级 attrs

无节点级 attrs（无须配置）。

### 3.2 框架级注入 attrs

按字段优先级规则（详 [主索引 §3.1](../../pm-note.md#31-字段优先级规则强制约定)），框架自动注入：

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `indent` | `number` | `0` | 整段缩进层级（block 通用，但 hr 通常不缩进） |

### 3.3 Mixin 引用

`horizontalRule` 不引用 TextFlowAttrs（无文本内容，不需要 textIndent / align）。

---

## 4. content 嵌套规则

```ts
content: undefined  // 叶子节点
atom: true          // 光标不可进入
```

`horizontalRule` 是叶子节点，**不接受任何子节点**。

### 4.1 嵌套约束

- 不能包含任何子节点（叶子）。
- 可以作为以下父容器的子节点：
  - `doc`（顶层）
  - `listItem` / `taskItem`
  - `blockquote`
  - `tableCell` / `tableHeader`
  - `callout`
  - `toggleList`

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{ type: 'horizontalRule', attrs: { indent: 0 } }
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [{ tag: 'hr' }]
toDOM() { return ['hr', { class: 'krig-horizontal-rule' }]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → horizontalRule | `---` / `***` / `___` → `horizontalRule` |
| horizontalRule → MD | `---\n\n` |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| horizontalRule ↔ PM doc | ✓ 完全无损 |
| horizontalRule → Markdown → horizontalRule | ✓ 无损（叶子无属性） |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `horizontalRule`（V1 AtomType 同名）—— 叶子节点，无 attrs。

### 6.2 V2 处置

直搬，无变更。V2 id 沿用 `horizontalRule`（驼峰）。

### 6.3 V1 数据迁移

无须迁移（叶子节点，无 attrs，跨 V1/V2 形态完全一致）。

---

## 7. Open Questions

无（语义边界清晰，无争议项）。

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/horizontal-rule/spec.ts`
- [`naming-conventions.md`](../../naming-conventions.md) §3.1（驼峰命名风格）
- HTML5 `<hr>` 标准 / CommonMark thematic break
