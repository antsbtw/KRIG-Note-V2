# blockquote

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/blockquote/spec.ts`

---

## 1. 语义边界

`blockquote` 是 PM / HTML 标准的**引用块**节点 —— 表达"引用他处内容"的语义容器，对应 HTML `<blockquote>`、Markdown `> text`。

### 1.1 形态特征

- **block 容器**：`content: 'block+'` —— 至少含一个 block 子节点。
- **defining**：PM 语义化容器，影响 Backspace / Enter 边界行为。
- **可嵌套**：blockquote 内可再嵌 blockquote / paragraph / heading / list 等。

### 1.2 blockquote vs callout

| 场景 | 节点 |
|---|---|
| 引用他人 / 他处内容（学术 / 文学风格） | `blockquote` |
| KRIG 自定义提示框（emoji + 类型 info/warning/tip） | `callout` |

详 [callout.md](./callout.md)。

---

## 2. type 字段值

```ts
type: 'blockquote'
```

PM / HTML 标准命名（`naming-conventions.md` §1.1 阶梯 1）。

---

## 3. attrs schema

### 3.1 节点级 attrs

无节点级 attrs。

### 3.2 框架级注入 attrs

按字段优先级规则，框架自动注入：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进层级 |

### 3.3 Phase 2c 待引入的 attrs（TextFlowAttrs Mixin）

按 [mixins/text-flow.md](../../../mixins/text-flow.md) 决议，blockquote 应引用 TextFlowAttrs：

| 字段 | 状态 |
|---|---|
| `textIndent` | ⏳ Phase 2c 待引入 |
| `indent` | ✓ 已存在（框架级） |
| `align` | ⏳ Phase 2c 待引入 |

---

## 4. content 嵌套规则

```ts
content: 'block+'  // 至少含一个 block
defining: true
```

`blockquote` 接受任意 block 子节点（paragraph / heading / list / 嵌套 blockquote / 等）。

### 4.1 嵌套约束

- **必须**至少有一个 block 子节点（PM 强制约束）。
- 可作为以下父容器的子节点：`doc` / `listItem` / `taskItem` / `blockquote`（自嵌套）/ `tableCell` / `callout` / `toggleList`。
- **defining: true** —— 在 blockquote 末尾按 Backspace 会保留容器（与 PM 标准行为一致）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'blockquote',
  attrs: { indent: 0 },
  content: [
    { type: 'paragraph', attrs: { isTitle: false, indent: 0 }, content: [...] }
  ]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [{ tag: 'blockquote' }]
toDOM() { return ['blockquote', { class: 'krig-blockquote' }, 0]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → blockquote | `> text` 行（连续 `>` 多行合并为一个 blockquote）|
| blockquote → MD | 每行加 `> ` 前缀 |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| blockquote ↔ PM doc | ✓ 完全无损 |
| blockquote → Markdown → blockquote | ⚠ 部分有损：`indent` / 未来 `textIndent` / `align` 在 Markdown 中不表达 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `blockquote`（同名）—— content: 'block+'，content 形态一致。

### 6.2 V2 处置

直搬，无变更。

### 6.3 V1 数据迁移

无须迁移（V1/V2 形态一致）。统一伪代码示例见 [paragraph.md §6.3](./paragraph.md#63-v1-数据迁移)。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-BQ-1 | `citation?: string`（V1 BlockquoteContent 有此字段）—— V2 是否保留 | **暂不保留**（V1 字段是 atom 顶层，按走法 B 应走边 `prov:wasDerivedFrom` 表达来源） | Phase 2c+ relations/pm-source.md |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/blockquote/spec.ts`
- HTML5 `<blockquote>` 标准 / CommonMark block quote
- [decisions/002 §"V1 AtomType 枚举字段判定"](../../atom/decisions/002-v1-fields-migration.md)（V1 blockquote 处置）
