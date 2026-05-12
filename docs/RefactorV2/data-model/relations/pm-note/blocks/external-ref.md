# externalRef

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/external-ref/spec.ts`

---

## 1. 语义边界

`externalRef` 是**外部资源引用** block atom 节点 —— **只存 URL**，不拷贝字节。

### 1.1 形态特征

- **block atom 节点**（`group: 'block'` + `atom: true`），叶子节点不接受子节点。
- **draggable / selectable**：可拖动 / 整体选中。
- **不渲染 caption**（与 fileBlock 同为叶子 atom）。

### 1.2 externalRef vs fileBlock

| 维度 | `fileBlock` | `externalRef` |
|---|---|---|
| 字节存储 | 进 mediaStore，跟着 note 走 | **只存 URL**（file:// 或 https://） |
| 移动 / 删除文件 | 不影响（字节在 KRIG 内） | 文件移动 / 删除 → 断链 |
| 价值 | 自包含附件 | **KRIG Graph 的"外部知识引用关系"**（note → file → folder → ...） |

### 1.3 kind 区分

- `kind: 'file'`：href 是 `file:///absolute/path`（本地文件）
- `kind: 'url'`：href 是 `https://...`（网络资源）

---

## 2. type 字段值

```ts
type: 'externalRef'
```

V2 实际 id 驼峰 `externalRef`。

注：此节点**曾被误归类为 inline 节点**（pm-note.md §2.7），实际是 **block 节点**（`group: 'block'` + `atom: true`），归 §2.4 媒体 block 类别。

---

## 3. attrs schema

### 3.1 节点级 attrs

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `kind` | `'file' \| 'url'` | `'url'` | 资源类型 | KRIG 自定义（阶梯 3） |
| `href` | `string` | `''` | 资源 URL（file:/// 或 https://） | 阶梯 1（Markdown / HTML 链接标准） |
| `title` | `string` | `''` | 显示标题 | 阶梯 1 |
| `mimeType` | `string` | `''` | MIME 类型 | 阶梯 2 |
| `size` | `number \| null` | `null` | 字节数（适用于 file kind） | KRIG 自定义 |
| `modifiedAt` | `string \| null` | `null` | 修改时间（适用于 file kind，ISO 字符串） | KRIG 自定义 |

### 3.2 命名特殊点：href vs src

externalRef **使用 `href`**（不是 `src`），与 link mark 一致：
- `href` 表达 "**指向**外部资源" 的语义（链接）
- `src` 表达 "**嵌入**资源字节"（媒体）

→ externalRef 是"指向"，所以用 `href`；fileBlock 是"嵌入字节"，所以用 `src`。

### 3.3 Mixin 引用

⚠ externalRef **不**引用 MediaResourceAttrs（按 [mixins/media-resource.md](../../../mixins/media-resource.md)）—— 因为 externalRef 用 `href` 不是 `src`，**字段命名差异破坏 Mixin 抽取的"字段集合一致"前提**。

→ externalRef 走自己的 attrs 定义，不强行套 MediaResourceAttrs。

### 3.4 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

---

## 4. content 嵌套规则

```ts
content: undefined  // atom 叶子
group: 'block'
atom: true
```

block atom 叶子，不接受任何子节点。

### 4.1 嵌套约束

- 不能包含任何子节点。
- 父容器：`doc` / `listItem` / `taskItem` / `blockquote` / `callout` / `toggleList` / `tableCell`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'externalRef',
  attrs: {
    kind: 'file',
    href: 'file:///Users/wenwu/Documents/report.pdf',
    title: 'Report.pdf',
    mimeType: 'application/pdf',
    size: 1024000,
    modifiedAt: '2026-05-11T10:00:00Z',
    indent: 0,
  }
}
```

### 5.2 parseDOM / toDOM 简要

```ts
parseDOM: [{ tag: 'div.krig-external-ref', getAttrs(node) { /* 从 data-* 反解 */ } }]
toDOM(node) { return ['div', { class: 'krig-external-ref', 'data-kind': ..., 'data-href': ..., ... }]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → externalRef | **无 CommonMark 标准** —— 通过 KRIG 扩展识别（自动判断 file:// vs https://）|
| externalRef → MD | 降级为 link `[<title>](<href>)` |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| externalRef ↔ PM doc | ✓ 完全无损 |
| externalRef → Markdown → externalRef | ⚠ 部分有损：kind / mimeType / size / modifiedAt 在 Markdown 中难表达 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `externalRef` —— 同名，attrs 基本一致。

### 6.2 V2 处置

直搬，无变更。

### 6.3 V1 数据迁移

无须迁移（字段命名一致）。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-ER-1 | externalRef 是否按走法 B 改为边？（externalRef 本质表达"note 引用外部资源"，应该是关系） | **保留 atom 实现**（V2 现状，引用对象不是 atom 时仍需 atom 表达） | Phase 3+ 视真实场景 |
| P-ER-2 | `kind: 'file'` 的 href 写本地绝对路径，跨机器 / 跨用户不兼容 —— 是否需要 portable 表达？ | **保留绝对路径**（V2 现状，跨机器迁移由用户负责） | 不阻塞 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/external-ref/spec.ts`
- [file-block.md](./file-block.md)（对比节点）
- HTML5 `<a href>` 标准 / `file://` URL scheme
- Electron `shell.openPath` / `shell.openExternal` API
