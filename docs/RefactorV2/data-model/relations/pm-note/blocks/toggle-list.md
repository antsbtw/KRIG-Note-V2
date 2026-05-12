# toggleList

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/toggle-list/spec.ts`

---

## 1. 语义边界

`toggleList` 是**折叠容器节点** —— 首行作为"折叠标题"，子内容可折叠 / 展开（Notion / Obsidian 风格）。

KRIG 自定义节点（HTML 有 `<details>` / `<summary>` 大致对应，Markdown 标准无）。

### 1.1 形态特征

- **block 容器**：`content: 'block+'`。
- **defining: true**。
- **attrs.open**：默认 `true`（展开），折叠箭头 UI 切换状态。

### 1.2 toggleList vs HTML `<details>`

| 维度 | HTML `<details>` | V2 `toggleList` |
|---|---|---|
| 折叠标题 | `<summary>` 子元素 | content 的第一个子 block（约定俗成） |
| 状态 | `open` 属性 | `open` attrs（同名） |
| 嵌套 | 支持 | 支持 |

---

## 2. type 字段值

```ts
type: 'toggleList'
```

V2 实际 id 驼峰 `toggleList`。

---

## 3. attrs schema

### 3.1 节点级 attrs

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `open` | `boolean` | `true` | 是否展开 | HTML `<details open>` 标准（阶梯 2） |

### 3.2 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

### 3.3 V1 → V2 字段差异

V1 `ToggleListContent` 含 `open: boolean` + `title: string` 两个 attrs。V2 当前**仅保留 `open`**，title 不作为 attrs —— 而是用 content 的第一个 block 作为折叠标题（更符合 PM 嵌套哲学）。

---

## 4. content 嵌套规则

```ts
content: 'block+'
defining: true
```

接受任意 block 子节点。**约定 content 第一个 block 为折叠标题**（capability UI 渲染时识别）。

### 4.1 嵌套约束

- 必须至少有一个 block 子节点（约定第一个为标题）。
- 父容器：`doc` / `listItem` / `taskItem` / `blockquote` / `callout` / `toggleList`（自嵌套）/ `tableCell`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'toggleList',
  attrs: { open: true, indent: 0 },
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '折叠标题' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '折叠内容' }] }
  ]
}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'div.krig-toggle-list',
    getAttrs(node) {
      return { open: (node as HTMLElement).getAttribute('data-open') !== 'false' };
    },
  },
]
toDOM(node) {
  const open = node.attrs.open !== false;
  return [
    'div',
    { class: open ? 'krig-toggle-list' : 'krig-toggle-list closed', 'data-open': String(open) },
    0,
  ];
}
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → toggleList | **无 Markdown 标准** —— 可通过 HTML `<details>` 块识别 |
| toggleList → MD | 降级为 HTML `<details>` 块或 blockquote |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| toggleList ↔ PM doc | ✓ 完全无损 |
| toggleList → Markdown → toggleList | ⚠ 通常有损：折叠状态 / 嵌套结构在 Markdown 中难表达 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `toggleList` —— attrs: { open, title }。

### 6.2 V2 处置

- id 沿用 `toggleList`。
- **删除 `title` attrs** —— 改用 content 第一个 block 作为折叠标题。

### 6.3 V1 数据迁移

```ts
// 简化伪代码
function migrateToggleList(v1: V1ToggleList): V2ToggleList {
  // V1 title 字段 → V2 包成 paragraph 作为 content 第一个 block
  const titleBlock = v1.attrs.title
    ? [{ type: 'paragraph', content: [{ type: 'text', text: v1.attrs.title }] }]
    : [];
  return {
    type: 'toggleList',
    attrs: { open: v1.attrs.open },
    content: [...titleBlock, ...v1.content],
  };
}
```

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-TG-1 | "折叠标题"是否需要独立节点类型（如 `toggleListSummary`）保证语义化？还是约定 content[0]？ | **当前约定 content[0]**（与 V2 现有实现一致），未来视真实场景升级 | Phase 2c+ |
| P-TG-2 | `toggleItem` 节点（V1 ENABLED_BLOCKS 含）—— V2 当前未启用？还是已并入 toggleList？ | **V2 当前未独立启用** `toggleItem`，toggleList 直接含任意 block | 实施时核验 ENABLED_BLOCKS |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/toggle-list/spec.ts`
- HTML5 `<details>` / `<summary>` 标准（语义参考）
- Notion / Obsidian toggle 设计参考
