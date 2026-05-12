# hardBreak

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/hard-break/spec.ts`
>
> **Note**: V2 实际 id 是驼峰 `hardBreak`，目录名 `hard-break` 与 V2 文件命名风格（kebab-case）一致。

---

## 1. 语义边界

`hardBreak` 是**行内软换行**节点 —— 在段落内插入"强制换行"，对应 HTML `<br>`、Markdown 行尾两个空格或 `\`。

### 1.1 形态特征

- **inline 节点**（`inline: true` + `group: 'inline'`），不是 block。
- **叶子节点**（无 content）。
- **不可选中**（`selectable: false`）—— 光标可越过但不能"停留在 br 上"选中它。
- **触发方式**：Shift-Enter（与 V1 一致）。

### 1.2 hardBreak vs 段落分隔

| 场景 | 节点 |
|---|---|
| 同一段落内强制换行 | `hardBreak`（Shift-Enter） |
| 切到下一段（新 paragraph） | Enter，产生新 `paragraph` 节点 |

---

## 2. type 字段值

```ts
type: 'hardBreak'
```

V2 实际 id 是驼峰 `hardBreak`（不是 `hard_break` 或 `hard-break`）。

---

## 3. attrs schema

### 3.1 节点级 attrs

无 attrs（叶子节点，无须配置）。

### 3.2 框架级注入 attrs

⚠ 注意：`hardBreak` 是 **inline 节点**（`group: 'inline'`），**不**被框架级 `indent` 注入（框架仅注入 `group: 'block'` 节点，详 [schema-builder.ts:14-25](../../../../../../src/drivers/text-editing-driver/schema-builder.ts)）。

---

## 4. content 嵌套规则

```ts
content: undefined  // 叶子节点
inline: true
group: 'inline'
```

`hardBreak` 是 inline 叶子，**不接受任何子节点**，可被嵌入以下父容器的 `inline*` content：

- `paragraph`
- `heading`
- `listItem` 内部的 paragraph
- `tableCell` 内部的 paragraph
- 等所有接受 inline 节点的父级

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{ type: 'hardBreak' }
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [{ tag: 'br' }]
toDOM() { return ['br']; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → hardBreak | 行尾两个空格 `  \n` → `hardBreak` 或反斜杠 `\\\n` → `hardBreak` |
| hardBreak → MD | `  \n`（两个空格 + 换行，CommonMark 推荐写法） |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| hardBreak ↔ PM doc | ✓ 完全无损 |
| hardBreak → Markdown → hardBreak | ✓ 无损 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `hardBreak`（同名）—— inline 叶子节点。

### 6.2 V2 处置

直搬，无变更。V2 id `hardBreak` 沿用 V1。

### 6.3 V1 数据迁移

无须迁移（叶子节点，无 attrs，跨 V1/V2 形态完全一致）。

---

## 7. Open Questions

无（语义边界清晰，无争议项）。

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/hard-break/spec.ts`
- HTML5 `<br>` 标准 / CommonMark hard line break
- [paragraph.md §4](../blocks/paragraph.md#4-content-嵌套规则)（描述 paragraph 允许 hardBreak 子节点）
