# fileBlock

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/file-block/spec.ts`

---

## 1. 语义边界

`fileBlock` 是**通用附件 block 卡片** —— 字节进 mediaStore，自包含跟着 note 走。

### 1.1 形态特征

- **block atom 节点**（`group: 'block'` + `atom: true`），叶子节点不接受子节点。
- **draggable / selectable**：可拖动 / 整体选中。
- **两态**：placeholder（无 src，file picker + URL embed）/ card（有 src，icon + 文件名 + 打开按钮）。

### 1.2 fileBlock vs image vs externalRef

| 场景 | 节点 |
|---|---|
| 嵌入图片 | `image`（HTML5 figure 风格） |
| 通用附件（PDF / docx / etc，字节进 mediaStore） | `fileBlock` |
| 外部资源引用（仅存 URL，不拷字节） | `externalRef`（详 [external-ref.md](./external-ref.md)） |

### 1.3 典型场景

- AI 生成 PDF / Code Interpreter 文件 / 用户上传附件。

---

## 2. type 字段值

```ts
type: 'fileBlock'
```

V2 实际 id 驼峰 `fileBlock`。

---

## 3. attrs schema

### 3.1 节点级 attrs（V2 当前实现）

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `src` | `string` | `''` | media:// URL（主要）/ file:// / 绝对路径（兼容） | 阶梯 1（Markdown / HTML） |
| `mediaId` | `string` | `''` | mediaStore 内部 ID（去重 hash） | KRIG 自定义（阶梯 3） |
| `filename` | `string` | `''` | 文件名（带扩展名） | KRIG 自定义（HTTP Content-Disposition 概念） |
| `mimeType` | `string` | `''` | MIME 类型 | 阶梯 2（HTTP / 通用） |
| `size` | `number \| null` | `null` | 字节数 | KRIG 自定义（HTTP Content-Length 概念） |
| `source` | `string \| null` | `null` | 来源标记（`'user-uploaded'` / `'ai-generated'` 等） | KRIG 自定义 |

### 3.2 Mixin 引用（Phase 2c 待实施）

按 [mixins/media-resource.md](../../../mixins/media-resource.md)：

| Mixin 字段 | V2 当前状态 |
|---|---|
| `src` | ✓ 已存在 |
| `mimeType` | ✓ 已存在 |
| `size` | ✓ 已存在 |
| `title` | ❌ 待新增（fileBlock 用 `filename` 代替 title） |

→ Phase 2c 引入 MediaResourceAttrs 时：fileBlock 因 `filename` 已承担显示标识，可选不引入 `title`。

### 3.3 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

### 3.4 source 字段的走法 B 讨论

`source: 'ai-generated' / 'user-uploaded'` 表达"附件由谁产生"，按 [decision 003 走法 B](../../atom/decisions/003-naming-conventions.md) 应走 `prov:wasGeneratedBy` 边。

→ 标 Open Q P-FB-1（待 Phase 2c+ 决议是否迁边）。

---

## 4. content 嵌套规则

```ts
content: undefined  // atom 叶子
group: 'block'
atom: true
```

`fileBlock` 是 block atom 叶子，**不接受任何子节点**（与 image 的"内嵌 caption"不同）。

### 4.1 嵌套约束

- 不能包含任何子节点。
- 父容器：`doc` / `listItem` / `taskItem` / `blockquote` / `callout` / `toggleList` / `tableCell`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'fileBlock',
  attrs: {
    src: 'media://files/report.pdf',
    mediaId: 'sha256:abc...',
    filename: 'report.pdf',
    mimeType: 'application/pdf',
    size: 1024000,
    source: 'user-uploaded',
    indent: 0,
  }
}
```

### 5.2 parseDOM / toDOM 简要

```ts
parseDOM: [{ tag: 'div.krig-file-block', getAttrs(node) { /* 从 data-* 反解 */ } }]
toDOM(node) { return ['div', { class: 'krig-file-block', 'data-src': ..., 'data-filename': ..., ... }]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → fileBlock | **无 CommonMark 标准** —— 通过 KRIG 扩展语法识别或降级为 link |
| fileBlock → MD | 降级为 `[filename](src)` link |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| fileBlock ↔ PM doc | ✓ 完全无损 |
| fileBlock → Markdown → fileBlock | ⚠ 部分有损：mediaId / mimeType / size / source 在 Markdown 中无表达 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `fileBlock` —— 同名，attrs 基本相同。

### 6.2 V2 处置

直搬。V2 改造点：viewAPI(IPC) → V2 直接调 electronAPI（单 React tree，无 viewAPI 层）。

### 6.3 V1 数据迁移

无须迁移（字段命名一致）。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-FB-1 | `source` attrs（`'user-uploaded'` / `'ai-generated'`）是否按走法 B 改 `prov:wasGeneratedBy` 边？ | **暂保留 attrs**（V2 现状） | Phase 2c+ 视真实场景 |
| P-FB-2 | `mediaId` 走 attrs 还是 `krig:storedIn` 边？mediaId 是跨 atom 的"指向 mediaStore 记录" | **暂保留 attrs**（mediaStore 是独立存储层，未来若 mediaStore 升 atom 再改） | Phase 3+ |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/file-block/spec.ts`
- [mixins/media-resource.md](../../../mixins/media-resource.md)
- HTTP Content-Length / Content-Type / Content-Disposition 标准
