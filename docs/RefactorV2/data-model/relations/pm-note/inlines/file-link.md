# fileLink

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/file-link/spec.ts`

---

## 1. 语义边界

`fileLink` 是**行内文件链接** inline atom 节点 —— 段落中引用附件 chip（📎 filename），点击用系统默认应用打开。

字节存储跟 fileBlock 一样走 mediaStore，但本节点是 inline atom，体积小，用于段落中"提到附件"场景。

### 1.1 形态特征

- **inline 节点**（`inline: true` + `group: 'inline'`），可嵌入 paragraph / heading 等 inline 容器。
- **atom**（`atom: true`）—— 光标不能进入节点内部。
- **不进 slash menu**（对齐 V1，仅 paste / drag / 未来 fileBlock 转 inline 路径产生）。
- **leafText**：`📎<filename>` —— 复制 / textBetween 还原源码（对齐 noteLink / mathInline 模式）。

### 1.2 fileLink vs fileBlock vs link mark vs noteLink

| 场景 | 类型 |
|---|---|
| 段落内提到附件（chip 形式） | `fileLink` 节点 |
| 块级附件卡片（图标 + 文件名 + 打开按钮） | `fileBlock` 节点（详 [file-block.md](../blocks/file-block.md)） |
| 普通超链接 `[text](url)` | `link` mark |
| 引用其他笔记 `[[Other Note]]` | `noteLink` 节点 |

---

## 2. type 字段值

```ts
type: 'fileLink'
```

V2 实际 id 驼峰 `fileLink`。

---

## 3. attrs schema

### 3.1 节点级 attrs

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `src` | `string` | `''` | media:// / file:// / 绝对路径 | 阶梯 1（Markdown / HTML） |
| `filename` | `string` | `''` | 显示文件名 | KRIG 自定义（HTTP Content-Disposition 概念） |

### 3.2 框架级注入 attrs

⚠ `fileLink` 是 inline 节点，**不**被框架级 `indent` 注入。

### 3.3 Mixin 引用

不引用 MediaResourceAttrs（fileLink 仅需 src + filename 两个字段，过于简洁，不需要 Mixin 抽取）。

---

## 4. content 嵌套规则

```ts
content: undefined  // atom 叶子
inline: true
group: 'inline'
atom: true
```

inline atom 叶子，**不接受任何子节点**。

可被嵌入所有 `inline*` content（paragraph / heading / listItem 内 paragraph / tableCell 内 paragraph / 等）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{ type: 'fileLink', attrs: { src: 'media://files/report.pdf', filename: 'report.pdf' } }
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'span.krig-file-link',
    getAttrs(node) {
      const el = node as HTMLElement;
      return {
        src: el.getAttribute('data-src') || '',
        filename: el.querySelector('.krig-file-link__name')?.textContent ?? '',
      };
    },
  },
]
toDOM(node) {
  return ['span', { class: 'krig-file-link', 'data-src': node.attrs.src },
    ['span', { class: 'krig-file-link__icon' }, '📎'],
    ['span', { class: 'krig-file-link__name' }, node.attrs.filename || 'file']
  ];
}
```

### 5.3 leafText

```ts
leafText: (node) => `📎${node.attrs.filename || 'file'}`
```

剪贴板 / 文本提取还原源码 `📎report.pdf`，对齐 noteLink / mathInline 设计。

### 5.4 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → fileLink | **无 CommonMark 标准** —— 通过 KRIG 扩展识别 |
| fileLink → MD | 降级为 link `[<filename>](<src>)` |

### 5.5 可逆性

| 路径 | 是否无损 |
|---|---|
| fileLink ↔ PM doc | ✓ 完全无损 |
| fileLink → Markdown → fileLink | ⚠ 部分有损：节点类型从 inline atom 退化为 link mark |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `fileLink`（同名）—— attrs: { src, filename }。

### 6.2 V2 处置

直搬，无变更。

### 6.3 V1 数据迁移

无须迁移。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-FL-1 | fileLink 是否走边表达？（按走法 B，跨 atom 引用应走边） | **保留 atom 实现** | Phase 2c+ |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/file-link/spec.ts`
- [file-block.md](../blocks/file-block.md)（对比节点）
- [note-link.md](./note-link.md)（同模式 inline atom）
