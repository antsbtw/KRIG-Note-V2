# videoBlock

> **Status**: V2 已实现 ✓（L5-B3.16 基础 + L5-B3.19 字幕 / 翻译 / Memory Mode 扩展）
> **Source**: `src/drivers/text-editing-driver/blocks/video-block/spec.ts`

---

## 1. 语义边界

`videoBlock` 是**视频** block 节点 —— 支持多 embed 类型 + Tab 框架 + 字幕底座 + Memory Playback 模式 + yt-dlp 下载。

### 1.1 形态特征

- **block 节点**（`group: 'block'`），**非 atom**（有 content）。
- **content: 'block'**：单段 caption（对齐 image / audio / tweet 模式）。
- **embedType**：
  - `'youtube'`：`<iframe>` 16:9 + IFrame postMessage time tracking
  - `'direct'`：`<video controls preload=metadata>`（media:// / https:// 直链）
  - `'vimeo'` / `'generic'`：本期不渲染，fallback 占位

### 1.2 Tab 框架（L5-B3.19.a 引入）

视频节点 UI 内部有 Tab 切换：

| Tab | 含义 |
|---|---|
| `'play'`（默认） | 视频播放器 |
| `'data'` | yt-dlp 下载 / 元数据 |
| `'transcript'` | 字幕原文 + CC 浮层 |
| `<langCode>`（如 `'zh'`） | 翻译字幕 |

### 1.3 videoBlock vs audioBlock vs tweetBlock

| 场景 | 节点 |
|---|---|
| 音频文件 | `audioBlock` |
| 视频文件 / YouTube embed | `videoBlock` |
| Twitter / X 推文 | `tweetBlock` |

---

## 2. type 字段值

```ts
type: 'videoBlock'
```

V2 实际 id 驼峰 `videoBlock`。

---

## 3. attrs schema

### 3.1 基础字段

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `src` | `string \| null` | `null` | YouTube URL / mp4 URL / media:// |
| `embedType` | `string \| null` | `null` | `'youtube'` / `'direct'` / `'vimeo'` / `'generic'`（mount 时按 src 推断 + 持久化） |
| `title` | `string` | `'Video'` | 视频标题 |
| `mimeType` | `string \| null` | `null` | MIME 类型 |
| `duration` | `number \| null` | `null` | 时长（秒） |

### 3.2 KRIG 知识图谱挂钩字段

| 字段 | 类型 | 默认值 | 用途 |
|---|---|---|---|
| `atomId` | `string \| null` | `null` | Phase D 知识图谱接入占位 |

### 3.3 L5-B3.19.a 新增（字幕 / Tab 状态）

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `activeTab` | `string` | `'play'` | Tab 选择持久化 |
| `transcriptText` | `string \| null` | `null` | 字幕原文（真相源，cues 内存派生不持久化） |

### 3.4 L5-B3.19.b 新增（翻译）

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `translationTexts` | `string \| null` | `null` | `JSON.stringify(Record<langCode, transcriptText>)` —— 每语言独立持久化翻译原文 |

### 3.5 L5-B3.19.c 新增（Memory Playback Mode）

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `segmentDuration` | `number` | `60` | Memory Mode 段长（秒），用户从 30/60/90/120 选 |
| `memoryLastStep` | `number` | `0` | 上次 stepIndex（stop 时写；start 时跳到此 step） |

### 3.6 L5-B3.19.e 新增（Download）

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `localFilePath` | `string \| null` | `null` | ytdlp 下载完成后的本地路径（不切 src，仅记录） |

### 3.7 框架级注入 attrs

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indent` | `0` | 整段缩进 |

### 3.8 Mixin 引用（Phase 2c 待实施）

按 [mixins/media-resource.md](../../../mixins/media-resource.md)：

| Mixin 字段 | V2 当前状态 |
|---|---|
| `src` | ✓ 已存在 |
| `mimeType` | ✓ 已存在 |
| `size` | ❌ 待新增 |
| `title` | ✓ 已存在 |

→ Phase 2c 实施时新增 `size` 字段。

---

## 4. content 嵌套规则

```ts
content: 'block'
group: 'block'
draggable: true
selectable: true
```

单段 caption（对齐 audio / image / tweet）。

### 4.1 嵌套约束

- 恰好一个 block 子节点（caption）。
- 父容器：`doc` / `listItem` / `taskItem` / `blockquote` / `callout` / `toggleList` / `tableCell`。

---

## 5. 转换契约

### 5.1 PM 内部表示

```ts
{
  type: 'videoBlock',
  attrs: {
    src: 'https://youtube.com/watch?v=abc',
    embedType: 'youtube',
    title: 'Lecture',
    duration: 600,
    transcriptText: '...',
    translationTexts: '{"zh":"..."}',
    activeTab: 'play',
    segmentDuration: 60,
    memoryLastStep: 3,
    localFilePath: null,
    atomId: null, mimeType: null,
    indent: 0,
  },
  content: [{ type: 'paragraph', attrs: { isTitle: false }, content: [{ type: 'text', text: 'Caption' }] }]
}
```

### 5.2 parseDOM / toDOM 简要

含 `data-*` 全字段反解（含 transcript / translation / memory mode / download 等）；toDOM 包 `<div class="krig-video-block">` + 内嵌 iframe / video + caption contentDOM。完整代码详 spec.ts。

### 5.3 Markdown 互转

| 方向 | 转换 |
|---|---|
| MD → videoBlock | **无 CommonMark 标准** —— 可识别 HTML `<video>` / `<iframe>` 或 KRIG 扩展 |
| videoBlock → MD | 降级为 link 或 HTML `<video>` / `<iframe>` 块 |

### 5.4 可逆性

| 路径 | 是否无损 |
|---|---|
| videoBlock ↔ PM doc | ✓ 完全无损 |
| videoBlock → Markdown → videoBlock | ⚠ 严重有损：transcript / translation / memory mode / download path 全部丢失 |

---

## 6. V1 → V2 处置

### 6.1 V1 原状

V1 `video` / `videoBlock` —— 基础字段类似，**不**含 L5-B3.19 扩展字段（transcript / translation / memory / download 都是 V2 新增）。

### 6.2 V2 处置

- 基础字段直搬。
- **新增 L5-B3.19.a/b/c/e 字段**（V2 业务扩展）。
- 砍 V1 sourcePages / thoughtId（D 阶段再接入）。

### 6.3 V1 数据迁移

V1 旧 video atom 缺少 L5-B3.19 字段，按 default 填充：

```ts
function migrateVideoBlock(v1: V1VideoBlock): V2VideoBlock {
  return {
    type: 'videoBlock',
    attrs: {
      ...v1.attrs,
      // 新增字段按 default 填
      activeTab: 'play',
      transcriptText: null,
      translationTexts: null,
      segmentDuration: 60,
      memoryLastStep: 0,
      localFilePath: null,
      atomId: null,
    },
    content: v1.content,
  };
}
```

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| P-VB-1 | `transcriptText` / `translationTexts` 字段是否走边表达？（按走法 B，长文本走 atom + 边） | **暂走 attrs**（实施成熟度优先） | Phase 3+ |
| P-VB-2 | `memoryLastStep` 是否属于用户操作状态（应该走 view 状态而非持久化 attrs）？ | **保留 attrs**（用户红线：切回笔记保留 Memory Mode 位置） | 不调整 |
| P-VB-3 | `vimeo` / `generic` embedType 何时支持渲染？ | **本期不渲染**，fallback 占位 | Phase 2c+ 按需 |

---

## 8. 参考来源

- `src/drivers/text-editing-driver/blocks/video-block/spec.ts`（988 行）
- L5-B3.19.a/b/c/e 设计文档
- HTML5 `<video>` / YouTube IFrame API 文档
- [mixins/media-resource.md](../../../mixins/media-resource.md)
- [audio-block.md](./audio-block.md)（同模式姊妹节点）
