# audioBlock

> **Status**: V2 已实现 ✓
> **Source**: `src/drivers/text-editing-driver/blocks/audio-block/spec.ts`

---

## 1. 语义边界

`audioBlock` 是**音频** block 节点 —— 对应 HTML5 `<audio controls>`，含播放器 + 标题 + 可选下载 + caption。

### 1.1 形态特征

- **block 节点**（`group: 'block'`），**非 atom**（有 content）。
- **content: 'block'**：单段 caption（对齐 image / video / tweet 模式）。
- **两态**：placeholder（无 src，🎵 + Choose file + URL embed）/ player（有 src，标题 + audio controls + 下载按钮）。

### 1.2 audioBlock vs videoBlock

| 场景 | 节点 |
|---|---|
| 音频文件（mp3 / wav / 等） | `audioBlock` |
| 视频文件（mp4 / YouTube / 等） | `videoBlock`（详 [video-block.md](./video-block.md)） |

---

## 2. type 字段值

```ts
type: 'audioBlock'
```

V2 实际 id 驼峰 `audioBlock`。

---

## 3. attrs schema

### 3.1 节点级 attrs（V2 当前实现）

| 字段 | 类型 | 默认值 | 含义 | 命名依据 |
|---|---|---|---|---|
| `src` | `string \| null` | `null` | media:// / https:// / data: URL | 阶梯 1（HTML） |
| `title` | `string` | `'Audio'` | 媒体标题 | 阶梯 1（HTML / Markdown） |
| `mimeType` | `string \| null` | `null` | MIME 类型 | 阶梯 2 |
| `duration` | `number \| null` | `null` | 时长（秒） | 阶梯 2（HTML media duration） |

### 3.2 KRIG 知识图谱挂钩字段（过渡 attrs）

| 字段 | 类型 | 默认值 | 过渡用途 |
|---|---|---|---|
| `atomId` | `string \| null` | `null` | 该 audio atom 的知识图谱 id（Phase D 接入，目标态：删除） |

### 3.3 Mixin 引用（Phase 2c 待实施）

按 [mixins/media-resource.md](../../../mixins/media-resource.md)：

| Mixin 字段 | V2 当前状态 |
|---|---|
| `src` | ✓ 已存在 |
| `mimeType` | ✓ 已存在 |
| `size` | ❌ 待新增 |
| `title` | ✓ 已存在 |

→ Phase 2c 实施时新增 `size` 到 audio attrs。

### 3.4 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

---

## 4. content 嵌套规则

```ts
content: 'block'
group: 'block'
draggable: true
selectable: true
```

单段 caption（通常是 paragraph）。与 image / video / tweet 同模式。

### 4.1 嵌套约束

- 必须恰好一个 block 子节点（caption）。
- 父容器：`doc` / `listItem` / `taskItem` / `blockquote` / `callout` / `toggleList` / `tableCell`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'audioBlock',
  attrs: {
    src: 'media://files/song.mp3',
    title: 'Song Name',
    mimeType: 'audio/mpeg',
    duration: 180,
    atomId: null,
    indent: 0,
  },
  content: [{ type: 'paragraph', attrs: { isTitle: false }, content: [{ type: 'text', text: 'Audio caption' }] }]
}
```

### 5.2 parseDOM / toDOM 简要

```ts
parseDOM: [{ tag: 'div.krig-audio-block', getAttrs(node) { /* data-* 反解 */ } }]
toDOM(node) { return ['div', { class: 'krig-audio-block', 'data-src': ..., 'data-title': ..., ... }, ['audio', { src }], 0]; }
```

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → audioBlock | **无 CommonMark 标准** —— 可识别 HTML `<audio>` 块或扩展语法 |
| audioBlock → MD | 降级为 link `[<title>](<src>)` 或 HTML `<audio>` 块 |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| audioBlock ↔ PM doc | ✓ 完全无损 |
| audioBlock → Markdown → audioBlock | ⚠ 大部分有损：duration / atomId 不表达 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `audio`（V1 命名）或 `audioBlock`（V1 内部命名）—— attrs 类似。

### 6.2 V2 处置

- id 沿用 `audioBlock`。
- **砍 V1 sourcePages / thoughtId 字段**（KRIG 知识图谱挂钩留 D 阶段，仅保留 atomId 占位）。
- viewAPI.downloadMedia → V2 直接 mediaDownload。

### 6.3 V1 数据迁移

无须迁移（字段命名一致，仅删 sourcePages / thoughtId）。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-AB-1 | `atomId` 何时改边？（按走法 B，节点本身就是 atom，不需要自引用） | **保留过渡 attrs** | Phase 2c+ |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/audio-block/spec.ts`
- HTML5 `<audio>` 标准
- [mixins/media-resource.md](../../../mixins/media-resource.md)
- [video-block.md](./video-block.md) / [image.md](./image.md)（同模式姊妹节点）
