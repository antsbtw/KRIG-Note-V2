# highlight mark

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/marks/highlight.ts`

---

## 1. 语义边界

`highlight` 是**背景高亮** mark —— 承载 `color` attrs 表达文字背景色。

跟 textStyle 平行（textStyle 是前景色，highlight 是背景色）。

### 1.1 形态特征

- **inline mark**，可叠加在 text 上。
- **attrs.color**：CSS 色值字符串，默认 `'yellow'`（V1 同款）。
- **渲染**：`<mark data-color="..." style="background-color: ...">...</mark>`
- **反解**：`<mark>` 标签 + `data-color` attr

### 1.2 highlight vs textStyle vs HTML5 `<mark>`

| 场景 | mark |
|---|---|
| 文字前景色 | `textStyle` |
| 文字背景高亮 | `highlight`（V2） |
| HTML5 语义化标记 | `<mark>` 元素（V2 highlight 复用此 HTML 元素） |

---

## 2. type 字段值

```ts
mark.type: 'highlight'
```

---

## 3. attrs schema

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `color` | `string` | `'yellow'` | CSS 色值字符串 | 阶梯 2（CSS background-color） |

注：与 textStyle.color 不同（textStyle 默认 `null` = 无样式），highlight.color 默认有值 `'yellow'`。

---

## 4. 互斥规则

无。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{ type: 'text', text: 'highlighted', marks: [{ type: 'highlight', attrs: { color: 'yellow' } }] }
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    tag: 'mark',
    getAttrs(node) {
      const el = node as HTMLElement;
      return { color: el.getAttribute('data-color') || 'yellow' };
    },
  },
]
toDOM(mark) {
  const color = mark.attrs.color as string;
  return [
    'mark',
    { 'data-color': color, style: `background-color: ${color}` },
    0,
  ];
}
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → highlight | **无 CommonMark 标准** —— 通过 HTML `<mark>` 元素识别 |
| highlight → MD | 降级为 HTML `<mark>` 元素或 `==text==`（部分扩展支持） |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| highlight ↔ PM doc | ✓ 完全无损 |
| highlight → Markdown → highlight | ⚠ 取决于 Markdown 处理器是否支持 HTML `<mark>` 或扩展语法 |

---

## 6. V1 → V2 处置

V1 `highlight` —— 同名 mark + color attrs。V2 直搬。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-HL-1 | color 取值是否限定（KRIG 调色板）？ | **任意 CSS 色值**（schema 不限制） | 不调整 |
| P-HL-2 | 默认 `'yellow'` 是否合适？跨主题（dark / light）可能视觉不一致 | **保留 V1 'yellow'**（用户红线：与 V1 行为一致） | 不调整 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/marks/highlight.ts`
- HTML5 `<mark>` 标准
- CSS `background-color` 属性
- [text-style.md](./text-style.md)（姊妹 mark，前景色版本）
