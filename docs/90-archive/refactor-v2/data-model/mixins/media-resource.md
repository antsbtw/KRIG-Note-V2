# MediaResourceAttrs

> **决议来源**：`atom/decisions/004-phase2b-resolutions.md` §4
> **Mixin 类型**：atom payload mixin
> **状态**：已决议

---

## 1. 用途

承载**媒体资源**类节点共有的元信息字段（资源 URL / MIME 类型 / 字节大小 / 显示标题）。

媒体资源类节点都需要"指向某个外部 / 内部资源"的元数据，本 Mixin 统一这些通用字段。

---

## 2. 字段定义

```ts
interface MediaResourceAttrs {
  /**
   * 资源 URL
   *   - http:// / https://     远程 URL
   *   - data:                  内联 data URL
   *   - media://               KRIG media store 协议（详 capability.media-store）
   *   - file://                本地文件路径（仅 externalRef 用）
   *
   * 命名依据: Markdown ![alt](src) + HTML <img src> 标准
   */
  src: string;

  /**
   * MIME 类型
   *   - 'image/png' / 'image/jpeg' / 'image/svg+xml'
   *   - 'video/mp4' / 'audio/mpeg'
   *   - 'application/pdf'
   *   - 'text/plain'
   *
   * 命名依据: HTML type 属性 + RFC 6838 通用约定
   * 决议: V2 用 mimeType（非 HTML 的 type，避免与 atom domain type 概念冲突）
   */
  mimeType?: string;

  /**
   * 字节数
   *   单位: byte
   *
   * 命名依据: HTTP Content-Length 概念 / KRIG 自定义
   */
  size?: number;

  /**
   * 显示标题 / tooltip
   *   - image:    hover 标题
   *   - video / audio: 媒体标题（如歌曲名）
   *   - fileBlock: 文件显示名
   *
   * 命名依据: Markdown (... "title") + HTML title 属性
   */
  title?: string;
}
```

### 2.1 默认值约定

| 字段 | 默认值 | 含义 |
|---|---|---|
| `src` | 无默认（必填） | 资源 URL 是节点身份的一部分 |
| `mimeType` | `undefined` | 可选；可后期由 capability 补齐（推断或读取） |
| `size` | `undefined` | 可选；可后期由 capability 补齐 |
| `title` | `''`（空字符串） | 可选；默认空字符串，UI 渲染时显示其他字段 |

`src` 是 Mixin 中**唯一必填**字段。其他三个都是可选 —— 部分情况下（如外部 URL）这些信息要等运行时补齐。

---

## 3. 适用节点

V2 第一波引用 MediaResourceAttrs 的节点：

| 节点 type | 引用形式 | 节点专属字段（不在 Mixin） |
|---|---|---|
| `image` | `attrs: MediaResourceAttrs & { ... }` | `alt`, `width`, `height`, `alignment`, KRIG 挂钩字段（详 image 子文档） |
| `video` | `attrs: MediaResourceAttrs & { ... }` | `poster`, `duration` |
| `audio` | `attrs: MediaResourceAttrs & { ... }` | `duration` |
| `fileBlock` | `attrs: MediaResourceAttrs & { ... }` | `filename` |
| `externalRef` | `attrs: MediaResourceAttrs & { ... }` | `kind: 'file' \| 'url'` |
| `figure` | `attrs: MediaResourceAttrs & { ... }` | `figureType?` |

→ 6 个媒体类节点全部引用此 Mixin。

---

## 4. 不包含的字段（边界澄清）

下列字段**看起来**像媒体资源属性，但**不**进 MediaResourceAttrs：

| 字段 | 不抽进 Mixin 的理由 |
|---|---|
| `alt` | 仅 image 用；语义是"替代呈现"（屏幕阅读器 / 加载失败），跟其他媒体的 title 语义不同 |
| `caption` | image / figure / video / audio 各自的 **PM content 子节点**实现，不是 attrs 字段（详 `naming-conventions.md` §2.3.1） |
| `width` / `height` | 仅 image 用；video 用 `poster` 表达预览，没有显式宽高 attrs |
| `duration` | 仅 video / audio 用（时间媒体），其他媒体类型无意义 |
| `poster` | 仅 video 用（预览海报图） |
| `alignment` | image 当前实现独有；其他媒体节点对齐方式由父容器决定 |
| `filename` | 仅 fileBlock / externalRef 用；image / video / audio 的"标题"用 title 表达 |
| `mediaId` | KRIG 自定义字段，某些场景需要明确 media store 内部 id（与 src 解耦）；不全部节点都用，不进 Mixin |

---

## 5. PM schema 表示

V2 media 节点的 PM schema 实现示例（具体在 Phase 2c block 子文档展开）：

```ts
// image node spec（含 MediaResourceAttrs + 专属字段）
{
  content: 'block',                    // caption 子节点
  attrs: {
    // MediaResourceAttrs
    src: { default: null },
    mimeType: { default: '' },
    size: { default: null },
    title: { default: '' },
    // image 专属
    alt: { default: '' },
    width: { default: null },
    height: { default: null },
    alignment: { default: 'center' },
    // KRIG 挂钩（过渡）
    atomId: { default: null },
    sourcePages: { default: null },
    thoughtId: { default: null },
  },
  parseDOM: [{ ... }],
  toDOM: node => [ ... ],
}
```

具体 PM schema 写法由 `capability.text-editing` 提供，本 Mixin 文档不涉及实现细节。

---

## 6. 与 V2 现有实现的对齐

V2 现有 image 节点 spec（`src/drivers/text-editing-driver/blocks/image/spec.ts`）已包含 src / alt / title / width / height / alignment + KRIG 挂钩字段。**MediaResourceAttrs 抽出后**，V2 当前 image / video / audio / fileBlock / externalRef / figure 节点 spec 实施时按本 Mixin 重构：

- 抽出共有的 src / mimeType / size / title 到 MediaResourceAttrs。
- 各节点专属字段保留在节点 attrs 自己。
- 引用方式：`attrs: MediaResourceAttrs & { ... }`。

V2 当前实施细节（如 image 节点的 mimeType / size 是否已存在）由 Phase 2c block 子文档逐项核验。

---

## 7. 影响清单

### 7.1 Mixin 改动的影响

如未来修改 MediaResourceAttrs（如加 `checksum?: string` 完整性校验字段）：

- 影响所有引用节点（image / video / audio / fileBlock / externalRef / figure）。
- 必须**同时**更新本文件 §2 字段定义 + 所有引用节点的子文档。
- 必须更新 `naming-conventions.md` §2.3 媒体资源相关字段表。

### 7.2 Phase 2c 实施清单

1. 写 `relations/pm-note.md` 主索引时，6 个媒体节点子文档**必须**显式引用 MediaResourceAttrs（不再单独列重复字段）。
2. 子文档格式示例（image 节点）：

```markdown
## image

### attrs

引用 `MediaResourceAttrs`（详 `data-model/mixins/media-resource.md`）。

image 专属字段：
- `alt: string`（推荐必填，Markdown 标准）
- `width: number | null`
- `height: number | null`
- `alignment: 'left' | 'center' | 'right'`

KRIG 知识图谱挂钩（过渡字段，Phase 2c+ 改边）：
- `atomId / sourcePages / thoughtId`

### content

`block` — 单段 caption（通常是 textBlock）。详 §2.3.1 V2 image 完整结构。
```

3. **未来代码实施**：`src/semantic/mixins/media-resource.ts` 定义 ts interface；各媒体节点 spec 引用之。
