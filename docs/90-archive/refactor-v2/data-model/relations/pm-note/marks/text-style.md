# textStyle mark

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/marks/text-style.ts`

---

## 1. 语义边界

`textStyle` 是**文字颜色** mark —— 承载 `color` attrs 表达文字颜色。

跟 basic-marks（bold / italic / underline / strike / code）平行，但**带 attrs**。

### 1.1 形态特征

- **inline mark**，可叠加在 text 上。
- **attrs.color**：CSS 色值字符串（如 `'red'` / `'#ff0000'` / `'rgb(255,0,0)'`）；`null` 时降级为无样式。
- **渲染**：`<span style="color: ...">...</span>`
- **反解**：任意带 `style="color: ..."` 的元素

### 1.2 textStyle vs highlight

| 场景 | mark |
|---|---|
| 文字前景色 | `textStyle.color` |
| 背景高亮 | `highlight.color` |

---

## 2. type 字段值

```ts
mark.type: 'textStyle'
```

V2 实际命名 `textStyle`（驼峰，与 ProseMirror 社区 textStyle 插件命名一致）。

---

## 3. attrs schema

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `color` | `string \| null` | `null` | CSS 色值字符串 | 阶梯 2（CSS color 属性） |

---

## 4. 互斥规则

无（不与其他 mark 互斥）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{ type: 'text', text: 'red text', marks: [{ type: 'textStyle', attrs: { color: 'red' } }] }
```

叠加其他 mark：

```ts
{ type: 'text', text: 'bold red', marks: [
  { type: 'bold' },
  { type: 'textStyle', attrs: { color: 'red' } }
]}
```

### 5.2 parseDOM / toDOM

```ts
parseDOM: [
  {
    style: 'color',
    getAttrs: (value) => ({ color: typeof value === 'string' ? value : null }),
  },
]
toDOM(mark) {
  const color = mark.attrs.color as string | null;
  return color ? ['span', { style: `color: ${color}` }, 0] : ['span', 0];
}
```

注：`color: null` 时 toDOM 输出 `<span>` 不带 style，等价于"无 mark 应用"。

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → textStyle | **无 CommonMark 标准** —— 通过 HTML `<span style="color">` 或扩展识别 |
| textStyle → MD | 降级为 HTML `<span style="color: ...">` |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| textStyle ↔ PM doc | ✓ 完全无损 |
| textStyle → Markdown → textStyle | ⚠ 通常有损：取决于 Markdown 处理器是否保留内联 HTML |

---

## 6. V1 → V2 处置

V1 `textStyle` —— 同名 mark + color attrs。V2 直搬。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-TS-1 | color 取值是否限定（如 KRIG 调色板）？还是任意 CSS 色值？ | **任意 CSS 色值**（schema 不限制），UI 可提供选色板 | 不调整 |
| P-TS-2 | textStyle 是否承载其他文字样式（fontSize / fontFamily 等）？ | **仅 color**（V2 当前），其他样式不在 schema 范围 | Phase 2c+ 按需 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/marks/text-style.ts`
- CSS `color` 属性标准
- prosemirror-schema-basic 社区 textStyle 插件
- [highlight.md](./highlight.md)（姊妹 mark，背景色版本）
