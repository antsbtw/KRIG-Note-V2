# callout

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/callout/spec.ts`

---

## 1. 语义边界

`callout` 是**装饰容器节点** —— 显示 emoji + 背景框包裹的"提示框"（Notion / Obsidian 风格）。

KRIG 自定义节点（HTML / Markdown 标准均无 callout 概念）。

### 1.1 形态特征

- **block 容器**：`content: 'block+'`。
- **defining: true** —— PM 语义化容器。
- **attrs.emoji**：默认 `💡`，点击 emoji 循环切换（capability UI 提供 10 个表情）。

### 1.2 callout vs blockquote

| 场景 | 节点 |
|---|---|
| 引用他处内容（学术 / 文学风格） | `blockquote` |
| KRIG 自定义提示框（教学 / 强调） | `callout` |

详 [blockquote.md](./blockquote.md)。

---

## 2. type 字段值

```ts
type: 'callout'
```

V2 实际 id 驼峰 `callout`。

---

## 3. attrs schema

### 3.1 节点级 attrs

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `emoji` | `string` | `'💡'` | 头部 emoji | KRIG 自定义（阶梯 3） |

### 3.2 V1 → V2 字段差异

V1 `CalloutContent` 有 `calloutType: 'info'|'warning'|'tip'|'danger'|'note'` + `emoji?` + `title?` 三字段。V2 当前**仅保留 `emoji`**，calloutType / title 未实现。

→ V2 当前简化版（按 V1 直迁但只挑核心字段），未来按需补回 calloutType / title。

### 3.3 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

---

## 4. content 嵌套规则

```ts
content: 'block+'
defining: true
```

接受任意 block 子节点（与 blockquote 一致）。

### 4.1 嵌套约束

- 必须至少有一个 block 子节点。
- 父容器：`doc` / `listItem` / `taskItem` / `blockquote` / `callout`（自嵌套）/ `tableCell` / `toggleList`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'callout',
  attrs: { emoji: '💡', indent: 0 },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '提示内容' }] }]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'div.krig-callout',
    getAttrs(node) {
      return { emoji: (node as HTMLElement).getAttribute('data-emoji') || '💡' };
    },
  },
]
toDOM(node) {
  return ['div', { class: 'krig-callout', 'data-emoji': node.attrs.emoji }, 0];
}
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → callout | **无 Markdown 标准** —— callout 是 KRIG / Notion / Obsidian 扩展。可通过 `> [!note]` 等社区扩展识别（依赖具体 MD 处理器） |
| callout → MD | 降级为 blockquote 或专用扩展语法 |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| callout ↔ PM doc | ✓ 完全无损 |
| callout → Markdown → callout | ⚠ 通常有损：emoji 丢失或降级为 blockquote |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `callout` —— attrs: { calloutType, emoji, title }。

### 6.2 V2 处置

- id 沿用 `callout`。
- attrs **简化**：当前仅保留 `emoji`；`calloutType` / `title` 未实现（按 V1 → V2 直迁但裁剪未充分使用的字段）。

### 6.3 V1 数据迁移

```ts
// 简化伪代码
function migrateCallout(v1: V1Callout): V2Callout {
  return {
    type: 'callout',
    attrs: {
      emoji: v1.attrs.emoji ?? '💡',
      // calloutType / title 字段丢弃（V2 未实现）
    },
    content: v1.content,
  };
}
```

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-CO-1 | `calloutType` 是否补回？V1 用 `'info'/'warning'/'tip'/'danger'/'note'` 区分视觉风格 | **当前仅 emoji 表达类型**，calloutType 暂不补 | Phase 2c+ 视真实需求 |
| P-CO-2 | `title` 是否补回？V1 用于 callout 头部标题文字 | **当前无 title 字段**，标题用第一行 paragraph 表达 | 同 P-CO-1 |
| P-CO-3 | callout 是否走 Markdown GFM admonition 扩展 `> [!note]` 序列化？ | **暂不实施**（Markdown 互转有损是已知项） | Phase 2c+ 视导出需求 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/callout/spec.ts`
- Notion / Obsidian callout 设计参考
- GFM admonition 提案（社区扩展）
