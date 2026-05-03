# videoPlaceholder — 视频（Tab Container）

> **类型**：RenderBlock / Tab Container（见 `base/render-block.md`）
> **位置**：文档中任意位置
> **状态**：已实现

---

## 一、定义

videoPlaceholder 是视频播放 Block——天然的 Tab Container，包含多个面板。

```
[Play] [Data] [EN]  [ZH-CN]…   CC 🧠 📝 🌐 ⬇️ 📖 ⛶
┌──────────────────────────────────────┐
│                                      │
│          视频播放器 (16:9)            │  ← 渲染型面板
│    [字幕浮层 overlay]                 │
│                                      │
│                         [词汇面板]    │  ← 右侧半透明
├──────────────────────────────────────┤
│ [记忆进度条 A B C D …]               │  ← Memory Mode 时显示
├──────────────────────────────────────┤
│ caption 文字                         │  ← 编辑型面板（始终可见）
└──────────────────────────────────────┘
```

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'tabPane tabPane tabPane*',  // caption + transcript + translation tabs
  group: 'block',
  draggable: true,
  selectable: true,
  attrs: {
    atomId:           { default: null },      // Atom 持久化 ID
    sourcePages:      { default: null },      // 来源页码
    thoughtId:        { default: null },      // Thought 锚定 ID
    src:              { default: null },      // 视频 URL
    title:            { default: '' },        // 视频标题
    poster:           { default: null },      // 封面图 URL
    embedType:        { default: '' },        // 'youtube' | 'vimeo' | 'direct' | 'embed'
    metadata:         { default: '{}' },      // yt-dlp 元数据 JSON（VideoMetadata）
    activeTab:        { default: 'play' },    // 当前激活 Tab
    memoryMode:       { default: false },     // Memory 播放模式开关
    segmentDuration:  { default: 60 },        // Memory 分段时长（秒）
    memoryLastStep:   { default: null },      // Memory 上次暂停步骤（恢复用）
  },
}
```

---

## 三、Tab 面板

| Tab | 类型 | 内容 |
|-----|------|------|
| Play | 渲染型 | 视频播放器 + 字幕浮层 + 词汇面板 |
| Data | 渲染型 | 元数据卡片（标题、描述、频道、时长、统计） |
| EN (Transcript) | 编辑型 (tabPane) | 原始字幕（可编辑，`[MM:SS] text` 格式） |
| 翻译 Tabs | 编辑型 (tabPane) | 动态添加的翻译字幕（ZH-CN 等） |
| caption | 编辑型 (tabPane) | 图说（始终可见，CSS `order: 999`） |

---

## 四、NodeView 两种状态

### 4.1 空状态（placeholder）

```
┌─────────────────────────────────┐
│  🎬  [输入视频 URL] [Embed]     │  ← 虚线边框
└─────────────────────────────────┘
```

- 支持 YouTube、Vimeo URL 和直接视频文件 URL
- Enter 或点击 Embed 提交

### 4.2 加载状态

Tab 栏 + 渲染面板 + Action 按钮栏 + caption

---

## 五、Embed 平台检测

```typescript
function detectEmbedType(url: string): 'youtube' | 'vimeo' | 'direct' | 'embed'
```

| 平台 | URL 模式 | 播放方式 |
|------|---------|---------|
| YouTube | youtube.com/watch, youtu.be/* | iframe + YouTube IFrame API |
| Vimeo | vimeo.com/* | iframe embed |
| 直接文件 | .mp4, .webm, .ogg, .m3u8, .mpd | HTML5 `<video>` |
| blob/media | blob:, media: | HTML5 `<video>` |

- YouTube：通过 postMessage 监听 `currentTime`，支持 `seekTo()`、`pauseVideo()`、`playVideo()`
- 自动从 YouTube URL 提取封面图（`img.youtube.com/vi/{id}/maxresdefault.jpg`）

---

## 六、Action 按钮

Tab 栏右侧 9 个 Action 按钮：

| 按钮 | 图标 | 功能 |
|------|------|------|
| Toggle CC | CC✓/CC | 切换字幕浮层显示，下拉选择语言（EN / 翻译语言 / OFF） |
| Memory Prev | ⏮ | Memory Mode：回退到上一分段 |
| Memory Mode | 🧠 | 开启/关闭 Memory 播放模式，下拉选择分段时长（30/60/90/120s） |
| Memory Skip | ⏭ | Memory Mode：跳过当前重复，进入下一分段 |
| Translate | 🌐 | 翻译字幕（Google Translate + AI 两种方式） |
| Import Transcript | 📝 | 从 YouTube 下载字幕（youtube-transcript InnerTube API） |
| Save/Download | ⬇️/📄 | 通过 yt-dlp 下载视频 / 下载完成后在 Finder 中打开 |
| Vocab Panel | 📖 | 词汇滚动面板（语言学习用） |
| Fullscreen | ⛶ | 全屏播放 |

---

## 七、Memory Playback Mode（艾宾浩斯间隔重复）

基于视频分段的间隔重复学习模式。

### 7.1 分段与序列

```typescript
function* memoryPlaybackSequence(totalSegments: number): Generator<MemoryStep>
```

将视频按 `segmentDuration`（默认 60s）分段，生成播放序列：
- Step 1: [A]
- Step 2: [A, B]（重复 A + 新 B）
- Step 3: [B, C]
- Step 4: [C, D]
- ...

每个分段用字母标记（A, B, C, ... Z, AA, AB, ...）。

### 7.2 状态机

| 状态 | 说明 |
|------|------|
| `memoryMode` | 总开关 |
| `segmentDuration` | 分段时长（30/60/90/120s） |
| `memoryLastStep` | 上次暂停步骤（持久化到 attrs，下次恢复） |
| `memoryPaused` | 播放中暂停 |

### 7.3 核心操作

- `startMemoryMode()`：从 `memoryLastStep` 或当前播放位置初始化
- `stopMemoryMode()`：保存 `memoryLastStep` 到 attrs
- `advanceMemoryStep()`：播完当前 step → 自动进入下一 step，seek 到分段起点
- `checkSegmentBoundary()`：每 300ms 检测，距分段结束 0.3s 时自动切换
- `prevSegment()`：回退 generator 到上一 step
- `skipRepeat()`：跳过重复阶段，直接进入下一新分段

### 7.4 进度条

底部显示分段进度条，字母标记每个分段位置，当前分段高亮。

---

## 八、字幕系统

### 8.1 字幕解析

从 transcript tabPane 的 paragraph 内容中解析时间戳格式：

```
[MM:SS] subtitle text
[HH:MM:SS] subtitle text
```

→ `SubtitleCue { startTime: number; text: string }`

### 8.2 字幕浮层（CC Overlay）

- 播放时每 300ms 轮询 `currentTime`，匹配当前 cue
- 浮层显示在视频画面底部（半透明背景）
- CC 下拉菜单选择显示语言（原文 / 翻译 / OFF）

### 8.3 YouTube Transcript Import

- 使用 `youtube-transcript` 库（InnerTube API，绕过 429 限流）
- 解析 segments → SRT 格式 + 时间戳段落
- 创建 transcript tabPane，按 `[MM:SS] text` 格式写入

### 8.4 字幕翻译

- **Google Translate**：按 4500 字符批次翻译，创建/追加翻译 Tab
- **AI 翻译**：通过 `noteAPI.aiRequestWithFile`，Markdown 格式传入
- 动态同步翻译 Tab：`syncTranslationTabs()` 自动增删 Tab 按钮

---

## 九、词汇时间轴（Vocab Panel）

语言学习辅助功能，将词汇表与字幕时间轴关联。

```typescript
buildVocabTimeline(cues: SubtitleCue[], vocabWords: string[]): VocabTimelineEntry[]
getVocabWindow(timeline, currentTime, windowSize = 5): VocabTimelineEntry[]
```

- 右侧半透明滚动面板
- 显示当前播放位置前后 ±5 个词汇
- 随播放时间自动滚动

---

## 十、Data Tab（元数据面板）

渲染 `VideoMetadata` JSON 为卡片：

```typescript
interface VideoMetadata {
  title?: string;
  description?: string;
  duration?: number;           // 秒
  publishedAt?: string;        // ISO 日期
  author?: string;
  authorUrl?: string;          // 可点击链接
  domain?: string;
  sourceUrl?: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  tags?: string[];
  category?: string;
  resolution?: string;         // "1920x1080"
  format?: string;             // "mp4"
}
```

显示内容：标题、domain/时长/日期、作者（可点击）、播放/点赞/评论数、标签、分辨率/格式、描述。

数字格式化：`formatCount(n)` → "1.2M" / "45.3K"

---

## 十一、yt-dlp 集成

### 11.1 元数据获取

```
fetchAndApplyMetadata(src) → ytdlpGetInfo → 解析 JSON → 写入 metadata attr
```

### 11.2 视频下载

- 触发 yt-dlp 下载（best mp4 格式）
- 底部 overlay 显示进度条 + 百分比
- 下载目标：`~/Downloads/`
- 下载完成后按钮变为"在 Finder 中打开"（📄）

---

## 十二、网络错误处理

- 监听 `window.online/offline` 事件
- 离线时显示 overlay：⚠ + "Click to retry"
- 点击后自动重载播放器

---

## 十三、全屏模式

- 填满屏幕，播放器绝对定位
- hover 时显示控制栏（退出按钮）
- 词汇面板 z-index 调整到 30

---

## 十四、Capabilities

```typescript
capabilities: {
  canDelete: true,
  canDrag: true,
}
```

Container policy：`videoPlaceholder: { requiredFirstChildType: null }`

---

## 十五、SlashMenu

```typescript
slashMenu: {
  label: 'Video',
  icon: '🎬',
  group: 'Media',
  keywords: ['video', 'youtube', 'vimeo', 'mp4', 'movie', 'embed'],
  description: 'Embed a video (YouTube, Vimeo, .mp4)',
}
```

---

## 十六、Thought 锚定

videoPlaceholder 支持 Thought 锚定（通过 node attribute）：

- 包含在 `NODE_THOUGHT_TYPES` 集合中
- `thoughtId` attr 存储关联的 Thought ID

---

## 十七、Atom 持久化

### AtomContent 类型

```typescript
interface VideoContent {
  src: string;
  title?: string;
  poster?: string;
  embedType?: string;
  caption?: string;                          // legacy
  metadata?: VideoMetadata;
  transcript?: unknown[];                    // Tiptap block JSON
  translations?: Record<string, unknown[]>;  // 语言代码 → blocks
  segmentDuration?: number;
  memoryLastStep?: number;
}
```

### Converter（双向转换）

- **atomToTiptap**：VideoContent → videoPlaceholder node（caption + transcript + translation tabPanes）
- **tiptapToAtom**：按 tabPane role 分类（caption / transcript / 语言代码）→ VideoContent
- 兼容旧格式：旧 paragraph caption → tabPane 迁移

---

## 十八、Markdown 导出

```typescript
case 'videoPlaceholder':
  return `[Video: ${node.attrs.src || ''}]`;
```

---

## 十九、设计原则

1. **Tab Container 典型用例**——验证 tabs 声明 + tabPane 共享基础设施
2. **caption 始终可见**——通过 CSS `order: 999` 固定在底部
3. **渲染型 vs 编辑型 Tab**——Play/Data 由 NodeView 渲染，Transcript/Translation 是 ProseMirror 可编辑 tabPane
4. **Memory Mode 可恢复**——`memoryLastStep` 持久化到 attrs，跨 session 恢复
5. **翻译 Tab 动态同步**——tabPane 增删时自动同步 Tab 栏按钮
6. **Thought 通过 node attr**——RenderBlock 类节点使用 attr 而非 Mark 做 Thought 锚定
