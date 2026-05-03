# audioBlock — 音频

> **类型**：RenderBlock（见 `base/render-block.md`）
> **位置**：文档中任意位置
> **状态**：已实现

---

## 一、定义

audioBlock 是音频播放器 Block——嵌入音频文件 + 可选的图说。

```
┌──────────────────────────────────────┐
│ Audio Title                      [⬇] │  ← 标题 + 下载按钮（hover 显示）
│ [▶ ━━━━━━━━━━━━━━━━━━ 03:45]         │  ← HTML5 audio controls
├──────────────────────────────────────┤
│ 图说文字                              │  ← caption
└──────────────────────────────────────┘
```

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'paragraph',         // caption
  group: 'block',
  draggable: true,
  selectable: true,
  attrs: {
    atomId:       { default: null },    // Atom 持久化 ID
    sourcePages:  { default: null },    // 来源页码
    thoughtId:    { default: null },    // Thought 锚定 ID
    src:          { default: '' },      // 音频 URL（https:// 或 media://）
    title:        { default: 'Audio' }, // 显示标题
    mimeType:     { default: null },    // MIME 类型（audio/mpeg, audio/ogg 等）
    duration:     { default: null },    // 时长（秒）
  },
}
```

---

## 三、NodeView 两种状态

### 3.1 空状态（placeholder）

```
┌─────────────────────────────────┐
│  🎵  [输入音频 URL] [Embed]     │  ← 虚线边框
└─────────────────────────────────┘
```

- URL 输入框接受 .mp3, .ogg, .wav 等音频链接
- Enter 或点击 Embed 提交

### 3.2 播放状态

```
┌─ audioBlock NodeView ───────────────┐
│ [标题文字]                      [⬇]  │
│ [<audio controls>]                   │
│ contentDOM → paragraph（caption）     │
└─────────────────────────────────────┘
```

- 标题：显示 `title` attr
- HTML5 `<audio controls>` 原生播放器（100% 宽度，36px 高度）
- **下载按钮**：hover 时在右上角显示 ⬇ 按钮
  - 仅对 `https://` URL 显示（`media://` 本地文件不显示）
  - 点击调用 `window.noteAPI.downloadMedia(url, 'audio')` → 转换为 `media://` 本地路径
  - 下载中显示 spinner 动画
- caption 是 ProseMirror 管理的 paragraph
- 选中时蓝色边框

---

## 四、Media Download

通过 MediaStore 下载远程音频到本地：

| 限制 | 值 |
|------|-----|
| 单文件大小上限 | 50MB |
| 存储位置 | `{userData}/mirro-data/media/audio/` |
| 文件命名 | `audio-{sha256}.{ext}` |
| URL 协议 | `media://audio/audio-{hash}.{ext}` |
| 去重 | SHA256 hash 去重，相同文件不重复下载 |

支持格式：

| MIME Type | 扩展名 |
|-----------|--------|
| audio/mpeg | .mp3 |
| audio/ogg | .ogg |
| audio/wav | .wav |
| audio/webm | .webm |
| audio/aac | .aac |
| audio/flac | .flac |
| audio/mp4 | .m4a |

---

## 五、Capabilities

```typescript
capabilities: {
  canDelete: true,
  canDrag: true,
}
```

---

## 六、SlashMenu

```typescript
slashMenu: {
  label: 'Audio',
  icon: '🎵',
  group: 'Media',
  keywords: ['audio', 'music', 'sound', 'mp3', 'podcast'],
  description: 'Embed an audio file (.mp3, .ogg)',
}
```

---

## 七、Thought 锚定

audioBlock 支持 Thought 锚定（通过 node attribute）：

- 包含在 `NODE_THOUGHT_TYPES` 集合中
- `thoughtId` attr 存储关联的 Thought ID
- Thought 标签：`[Audio] {caption 或 URL}`

---

## 八、Atom 持久化

### AtomContent 类型

```typescript
interface AudioContent {
  src: string;                    // URL（https:// 或 media://）
  title?: string;                 // 显示标题
  mimeType?: string;              // MIME 类型
  duration?: number;              // 时长（秒）
  caption?: string;               // 从 paragraph 提取的纯文本
}
```

### Converter（双向转换）

- **atomToTiptap**：AudioContent → audioBlock node（含 caption paragraph）
- **tiptapToAtom**：audioBlock node → Atom（从 paragraph 提取 caption）

---

## 九、Markdown 导出

```typescript
case 'audioBlock':
  return `[Audio: ${node.attrs.src || ''}]`;
```

---

## 十、未来升级路径

Tab Container 升级：
```
[播放器] [字幕] [笔记]
```

---

## 十一、设计原则

1. **caption 是 paragraph**——支持 inline 格式化
2. **下载即本地化**——https URL 可一键下载为 media:// 本地文件，离线可用
3. **原生 audio 控件**——使用 HTML5 `<audio controls>`，不自建播放器 UI
4. **Thought 通过 node attr**——RenderBlock 类节点使用 attr 而非 Mark 做 Thought 锚定
