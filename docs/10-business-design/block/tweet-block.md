# tweetBlock — 推文嵌入

> **类型**：RenderBlock（见 `base/render-block.md`）
> **位置**：文档中任意位置
> **状态**：已实现

---

## 一、定义

tweetBlock 是社交媒体内容嵌入——双 Tab 视图（Browse 官方渲染 / Data 结构化数据）+ 可选图说。

属于 **EmbedBlock 模式**（外部资源嵌入）——和 image、video、audio 是同一类：URL/ID + 元数据 + 预览。

```
[Browse] [Data]                    [Fetch]
┌──────────────────────────────────────┐
│                                      │
│   Twitter 官方嵌入 iframe             │  ← Browse Tab
│   或 结构化数据卡片                    │  ← Data Tab
│                                      │
├──────────────────────────────────────┤
│ caption 文字                         │
└──────────────────────────────────────┘
```

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'paragraph',          // caption
  group: 'block',
  draggable: true,
  selectable: true,
  attrs: {
    // 持久化
    atomId:        { default: null },
    sourcePages:   { default: null },
    thoughtId:     { default: null },

    // 核心标识
    tweetUrl:      { default: null },      // Tweet URL（twitter.com 或 x.com）
    tweetId:       { default: null },      // 从 URL 提取的 Tweet ID
    embedHtml:     { default: null },      // oEmbed HTML（备用）

    // 作者信息
    authorName:    { default: '' },        // 显示名
    authorHandle:  { default: '' },        // @handle
    authorAvatar:  { default: '' },        // 头像 URL

    // 内容
    text:          { default: '' },        // 推文正文
    richText:      { default: null },      // 富文本片段数组（mention/hashtag/link/cashtag）
    createdAt:     { default: '' },        // ISO 时间戳
    lang:          { default: '' },        // 语言代码

    // 媒体
    media:         { default: null },      // 媒体数组 [{ type, url, thumbUrl }]
    metrics:       { default: null },      // { likes, retweets, replies, views }

    // 关联
    quotedTweet:   { default: null },      // 引用推文 URL
    inReplyTo:     { default: null },      // 回复的推文 URL

    // 视图状态
    activeTab:     { default: 'browse' },  // 'browse' | 'data'
  },
}
```

### richText 结构

```typescript
type TweetRichTextSegment = {
  type: 'text' | 'mention' | 'hashtag' | 'link' | 'cashtag';
  text: string;
  url?: string;    // mention/hashtag/link 的链接
};
```

### media 结构

```typescript
type TweetMedia = {
  type: 'image' | 'video' | 'gif';
  url: string;
  thumbUrl?: string;
};
```

---

## 三、NodeView 两种状态

### 3.1 空状态（placeholder）

```
┌─────────────────────────────────┐
│  🐦  [输入 Tweet URL] [Embed]   │  ← 虚线边框
└─────────────────────────────────┘
```

- 支持 `twitter.com` 和 `x.com` 两种域名
- 正则提取 Tweet ID：`/(?:twitter\.com|x\.com)\/.+\/status\/(\d+)/`
- 提交后调用 `fetchTweetOEmbed()` 获取嵌入 HTML

### 3.2 双 Tab 视图

#### Browse Tab（官方嵌入）

- iframe 加载：`https://platform.twitter.com/embed/Tweet.html?id={id}&theme=dark`
- 监听 Twitter postMessage resize 事件，动态调整 iframe 高度
- 最大宽度 550px

#### Data Tab（结构化数据卡片）

```
┌──────────────────────────────────────┐
│ [头像] 作者名  @handle  · 2h ago     │
│ ↩ Reply to @xxx                      │  ← 可选
│                                      │
│ 推文正文                              │
│                                      │
│ ┌──────┐ ┌──────┐                    │
│ │ 图片1 │ │ 图片2 │                   │  ← 媒体网格（1-4 项）
│ └──────┘ └──────┘                    │
│                                      │
│ 💬 12  🔁 45  ❤ 1.2K  👁 5.3M       │  ← 互动数据
│                                      │
│ ┌─ 引用推文 ─────────┐               │  ← 可选
│ │ @quoted_user: ...   │               │
│ └─────────────────────┘               │
│                                      │
│ Open original ↗                      │  ← 在系统浏览器中打开
└──────────────────────────────────────┘
```

- 头像：40px 圆形
- 时间：`createdAt` 转为相对时间（2h ago, 3d ago）
- 媒体网格：响应式布局（1-4 项，16:9 宽高比）
  - 视频缩略图显示 ▶ 播放图标 + ⬇ 下载按钮（需 yt-dlp）
- 数字格式化：`formatCount()` → "1.2K", "5M"
- "Open original ↗" 在系统浏览器中打开原始推文

---

## 四、Fetch Data 功能

Tab 栏右侧 "Fetch" 按钮：

1. 调用 `window.noteAPI.fetchTweetData(tweetUrl)`
2. Main 进程创建隐藏 BrowserWindow (800x900)
3. 加载推文页面，等待 DOM 渲染（轮询 10s）
4. 执行 DOM 提取脚本（`EXTRACT_TWEET_JS`）
5. 返回结构化 `TweetData` → 写入 node attrs
6. 自动切换到 Data Tab

### DOM 提取脚本

基于 Twitter 的 `data-testid` 属性（比 CSS 类名稳定）：

| data-testid | 提取内容 |
|-------------|---------|
| `User-Name` | 作者名 + @handle |
| `Tweet-User-Avatar img` | 头像 URL |
| `tweetText` | 推文正文 |
| `time[datetime]` | 发布时间 |
| `tweetPhoto img` | 图片媒体 |
| `video[poster]` | 视频媒体 |
| `videoPlayer` | GIF 检测 |
| `[role="group"] [data-testid]` | 互动数据（replies/retweets/likes） |
| `a[href*="/analytics"]` | 浏览量 |
| `quoteTweet` | 引用推文链接 |
| `socialContext` | 回复上下文 |

每个字段独立 try-catch，单字段失败不影响整体。

---

## 五、yt-dlp 集成

视频类媒体支持通过 yt-dlp 下载：

- 检查 yt-dlp 安装状态（mount 时）
- 视频缩略图上显示 ⬇ 按钮
- 下载中显示进度条 + 百分比
- 完成显示 ✅ / 失败显示 ❌

---

## 六、浏览器提取入口

除 SlashMenu 外，还支持从浏览器视图直接提取：

1. Web Toolbar 上的 "Extract Tweet" 按钮
2. 调用 `extractTweet(leftView)` → 从当前网页 DOM 提取
3. 通过 IPC `NOTE_IPC.INSERT_TWEET` 发送到 Note 渲染器
4. NoteApp 接收后在文档末尾插入 tweetBlock

---

## 七、Capabilities

```typescript
capabilities: {
  canDelete: true,
  canDrag: true,
}
```

---

## 八、SlashMenu

```typescript
slashMenu: {
  label: 'Tweet',
  icon: '🐦',
  group: 'Media',
  keywords: ['tweet', 'twitter', 'x', 'social', 'post'],
  description: 'Embed a tweet (Twitter/X)',
}
```

---

## 九、Thought 锚定

tweetBlock 支持 Thought 锚定（通过 node attribute）：

- `thoughtId` attr 存储关联的 Thought ID

---

## 十、Atom 持久化

### AtomContent 类型

```typescript
interface TweetContent {
  tweetUrl: string;
  tweetId?: string;
  embedHtml?: string;
  author?: {
    name: string;
    handle: string;
    avatar?: string;
  };
  text?: string;
  richText?: TweetRichTextSegment[];
  createdAt?: string;
  media?: TweetMedia[];
  metrics?: {
    likes?: number;
    retweets?: number;
    replies?: number;
    views?: number;
  };
  quotedTweet?: string;
  inReplyTo?: string;
  lang?: string;
  caption?: string;
}
```

### Converter（双向转换）

- **atomToTiptap**：TweetContent → tweetBlock node
  - `author` 对象展开为 `authorName/authorHandle/authorAvatar` attrs
  - caption 创建为 paragraph
- **tiptapToAtom**：tweetBlock node → Atom
  - `authorName/authorHandle/authorAvatar` attrs 合并回 `author` 对象
  - 从 paragraph 提取 caption 文本

---

## 十一、Markdown 导出

```typescript
case 'tweetBlock':
  return `[Tweet: ${node.attrs.tweetUrl || ''}]`;
```

---

## 十二、IPC 通道

| 通道 | 方向 | 用途 |
|------|------|------|
| `note:insert-tweet` | main → noteView | 从浏览器提取后插入 |
| `note:fetch-tweet-oembed` | noteView ↔ main | 获取 oEmbed HTML |
| `note:fetch-tweet-data` | noteView ↔ main | 获取结构化元数据 |

---

## 十三、设计原则

1. **EmbedBlock 模式**——和 image/video/audio 同一模式（URL + 预览 + caption）
2. **caption 是 paragraph**——支持 inline 格式化
3. **双 Tab 视图**——Browse（官方 iframe）和 Data（结构化卡片）互补
4. **DOM 提取容错**——每个字段独立 try-catch，部分失败不阻塞
5. **data-testid 优先**——Twitter DOM 提取使用 data-testid 而非 CSS 类名，更稳定
6. **两个提取入口**——SlashMenu 手动输入 URL + 浏览器 Toolbar 自动提取
