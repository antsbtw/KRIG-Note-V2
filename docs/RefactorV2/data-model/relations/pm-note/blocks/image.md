# image

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/image/spec.ts`

---

## 1. 语义边界

`image` 是**图片** block 节点 —— 对应 Markdown `![alt](src)`、HTML `<img>` + `<figure>`。

V2 image 节点采用 HTML5 `<figure>` 模式：图片本身 + 内嵌 caption 子节点（PM `content: 'block'`），对齐 [decision 004 §3 N7](../../atom/decisions/004-phase2b-resolutions.md) —— caption 不是 attrs，是 content 子节点。

### 1.1 形态特征

- **block 节点**（`group: 'block'`），可独立成段。
- **content: 'block'**：单段 caption（通常是 paragraph）。
- **三态渲染**（NodeView 接管）：
  - `placeholder`（无 src）：显示 🖼 + Upload 按钮 + URL embed 输入
  - 普通图（有 src，非 SVG）：走 `<img>`
  - SVG 图：走 `<div>` + innerHTML

### 1.2 image vs figure vs fileBlock

| 场景 | 节点 |
|---|---|
| 嵌入图片（PNG / JPEG / SVG / 等） | `image` |
| 通用附件（PDF / docx / 任意文件） | `fileBlock`（详 [file-block.md](./file-block.md)） |

---

## 2. type 字段值

```ts
type: 'image'
```

PM / HTML 标准命名（阶梯 1）。

---

## 3. attrs schema

### 3.1 节点级 attrs（V2 当前实现）

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `src` | `string \| null` | `null` | 图片 URL（http / https / data: / media://） | 阶梯 1（Markdown / HTML 标准） |
| `alt` | `string` | `''` | 替代文本（无障碍 + Markdown 来源） | 阶梯 1（Markdown / HTML 标准） |
| `title` | `string` | `''` | hover 标题（可空） | 阶梯 1（Markdown / HTML 标准） |
| `width` | `number \| null` | `null` | 像素宽度（resize 后写）；null = auto | 阶梯 2（HTML） |
| `height` | `number \| null` | `null` | 像素高度；null = auto | 阶梯 2（HTML） |
| `alignment` | `'left'\|'center'\|'right'` | `'center'` | 水平对齐 | KRIG 自定义（阶梯 3） |

### 3.2 KRIG 知识图谱挂钩字段（过渡 attrs）

按 [decision 003 走法 B](../../atom/decisions/003-naming-conventions.md)，跨 atom 引用应走边。V2 image 当前保留以下**过渡 attrs**（Phase 2c+ 切换为边）：

| 字段 | 类型 | 默认值 | 过渡用途 | 目标态 |
|---|---|---|---|---|
| `atomId` | `string \| null` | `null` | 该 image atom 的知识图谱 id | 删除（节点本身就是 atom） |
| `sourcePages` | `unknown \| null` | `null` | PDF 提取来源页码 | 走 `*:prov:wasInformedBy` 边 attrs |
| `thoughtId` | `string \| null` | `null` | thought 系统关联 | 走 thought 系统（Phase 2c+ 决议） |

### 3.3 Mixin 引用（Phase 2c 待实施）

按 [mixins/media-resource.md](../../../mixins/media-resource.md)，image 应引用 MediaResourceAttrs 共有字段：

| Mixin 字段 | V2 当前状态 |
|---|---|
| `src` | ✓ 已存在 |
| `mimeType` | ❌ 待新增 |
| `size` | ❌ 待新增 |
| `title` | ✓ 已存在 |

→ Phase 2c 引入 MediaResourceAttrs 时新增 `mimeType` / `size` 到 image attrs。

### 3.4 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

---

## 4. content 嵌套规则

```ts
content: 'block'   // 单段 caption (通常是 paragraph)
group: 'block'
draggable: true
selectable: true
```

`image` 内嵌**一个** block 子节点作为 caption（对齐 HTML5 `<figure><figcaption>` 模式）。

### 4.1 嵌套约束

- 必须**恰好一个** block 子节点（通常是 paragraph，可空段）。
- 父容器：`doc` / `listItem` / `taskItem` / `blockquote` / `callout` / `toggleList` / `tableCell`。
- caption 内可嵌任意 inline 元素（text / mathInline / noteLink / 等）。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'image',
  attrs: {
    src: 'media://files/photo.png',
    alt: 'A photo',
    title: '',
    width: 800, height: 600,
    alignment: 'center',
    atomId: null, sourcePages: null, thoughtId: null,
    indent: 0,
  },
  content: [
    { type: 'paragraph', attrs: { isTitle: false, indent: 0 }, content: [{ type: 'text', text: 'Photo caption' }] }
  ]
}
```

### 5.2 parseDOM / toDOM 简要

```ts
parseDOM: [{ tag: 'div.krig-image-block', getAttrs(node) { /* 从 data-* 反解 */ } }]
toDOM(node) { return ['div', { class: 'krig-image-block', ... }, ['img', { src, alt, title }], ['figcaption', { class: 'krig-image-block__caption' }, 0]]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → image | `![alt](src "title")` → `image({ alt, src, title })`（无 caption 时 content 为空 paragraph） |
| image → MD | `![<alt>](<src> "<title>")` + 单独行 caption（CommonMark 不含 figcaption，降级为 image 下方 paragraph） |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| image ↔ PM doc | ✓ 完全无损 |
| image → Markdown → image | ⚠ 部分有损：width / height / alignment / caption 的语义关联在 Markdown 中弱化 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `image` —— `caption` 是 **attrs 字段**（语义混乱：既被当 alt 又被当 caption）。

### 6.2 V2 处置

按 [decision 004 §3 N7](../../atom/decisions/004-phase2b-resolutions.md)：

- **caption 从 attrs 改为 content 子节点**（PM 嵌套 + HTML5 figure 模式）
- **新增 attrs.alt**（按 Markdown 标准）
- alt / caption / title **三字段并存**，语义不同

### 6.3 V1 数据迁移

```ts
function migrateImage(v1: V1Image): V2Image {
  return {
    type: 'image',
    attrs: {
      src: v1.attrs.src,
      alt: '',                        // 旧数据 alt 留空，渲染前由 capability 引导补齐
      title: v1.attrs.title ?? '',
      width: v1.attrs.width ?? null,
      height: v1.attrs.height ?? null,
      alignment: 'center',
      atomId: null, sourcePages: null, thoughtId: null,
    },
    content: [
      // V1 caption 字段 → V2 content 子节点（包成 paragraph）
      { type: 'paragraph', attrs: { isTitle: false }, content: [{ type: 'text', text: v1.attrs.caption ?? '' }] }
    ],
  };
}
```

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-IMG-1 | KRIG 挂钩字段（atomId / sourcePages / thoughtId）何时改为边？ | **暂保留过渡 attrs**，Phase 2c+ 决议 | Phase 2c+ relations/atom-graph.md |
| P-IMG-2 | MediaResourceAttrs 引入时（mimeType / size 新增到 image attrs）—— 与 alt / title 三字段是否合理共存？ | **共存**（按 mixins/media-resource.md §4 不包含字段说明，alt 仅 image 专属） | Phase 2c 实施时 |
| P-IMG-3 | `originalSrc`（V1 字段）—— V2 未实现，未来如何表达"图片原始 URL（下载到 media 之前的 URL）"？ | **走 `*:prov:wasInformedBy` 边表达**（按 走法 B） | Phase 2c+ |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/image/spec.ts`
- [decision 004 §3 N7](../../atom/decisions/004-phase2b-resolutions.md#3-n7--v1-imagecaption-历史迁移)（caption 拆分决议）
- [mixins/media-resource.md](../../../mixins/media-resource.md)（MediaResourceAttrs）
- HTML5 `<figure>` / `<figcaption>` 标准 + Markdown `![alt](src)` 标准
