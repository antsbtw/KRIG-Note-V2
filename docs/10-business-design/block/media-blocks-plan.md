# 推进计划：四个媒体 Block 完善

> **目标**：将 image / video / audio / tweet 四个媒体 Block 从骨架实现补齐到与 mirro-desktop 对齐
> **策略**：自底向上，分三层推进——先补基础设施，再补 Block 本体，最后补跨 Block 集成
> **日期**：2026-04-05

---

## Phase 1：基础设施层（所有 Block 共同依赖）

| # | 任务 | 说明 | 产出文件 |
|---|------|------|---------|
| 1.1 | RenderBlockBase 增强 | selectNode/deselectNode 视觉反馈 + destroy 生命周期 + 通用 placeholder 模式（Upload + Embed link 双按钮） | `render-block-base.ts` |
| 1.2 | Schema attrs 补齐 | 四个 Block 的 schema 全部对齐设计文档（atomId/sourcePages/thoughtId + 各自特有 attrs） | 各 block .ts |
| 1.3 | CSS 补齐 | 目前只有 image 有基础 CSS，video/audio/tweet 完全没有。补齐所有媒体 Block 样式 | `note.css` |
| 1.4 | Preload API 扩展 | 在 view.ts preload 中暴露媒体操作 API：downloadMedia()、fetchTweetData()、fetchTweetOEmbed()、openExternal() | `preload/view.ts` |
| 1.5 | IPC handlers 扩展 | main 进程注册对应的 IPC handler 骨架（先 stub，后面按 Block 逐个实现） | `ipc/handlers.ts` |

---

## Phase 2：Block 本体（按复杂度从低到高）

### P2a：Image Block（无外部依赖）

| # | 任务 | 说明 |
|---|------|------|
| 2a.1 | Embed link 入口 | placeholder 增加 URL 输入模式（Upload / Embed link 切换） |
| 2a.2 | alignment attr + 工具栏 | 三按钮工具栏（left/center/right），hover 显示 |
| 2a.3 | Resize handles | 左右拖拽手柄，按比例缩放，更新 width attr |
| 2a.4 | 图片尺寸自动检测 | img onload 捕获 naturalWidth/naturalHeight |

### P2b：Audio Block（需要 MediaStore）

| # | 任务 | 说明 |
|---|------|------|
| 2b.1 | Schema 补齐 | title、mimeType、duration attrs |
| 2b.2 | 标题显示 + 播放器 UI | audio 上方显示 title，下方 caption |
| 2b.3 | 下载按钮 | hover 显示 ⬇，调用 downloadMedia() |
| 2b.4 | MediaStore 实现 | main 进程：下载远程音频 → 本地存储 → media:// 协议注册 |
| 2b.5 | destroy 清理 | pause + 清空 src |

### P2c：Tweet Block（需要 IPC + DOM 提取）

| # | 任务 | 说明 |
|---|------|------|
| 2c.1 | Schema 补齐 | 全部 19 个 attrs |
| 2c.2 | Tweet ID 提取 | URL 正则（twitter.com + x.com） |
| 2c.3 | Browse Tab | iframe embed（platform.twitter.com/embed/Tweet.html）+ postMessage resize |
| 2c.4 | Data Tab 卡片 | 结构化渲染（头像、正文、媒体网格、metrics） |
| 2c.5 | Tab 切换 | Browse / Data 双 Tab + activeTab 持久化 |
| 2c.6 | fetchTweetOEmbed IPC | main 进程调用 Twitter oEmbed API |
| 2c.7 | fetchTweetData IPC | main 进程隐藏 BrowserWindow + DOM 提取脚本 |
| 2c.8 | Fetch 按钮 | Tab 栏右侧，触发 fetchTweetData → 填充 attrs |

### P2d：Video Block（最复杂，分三个子阶段）

**P2d-1：基础播放**

| # | 任务 | 说明 |
|---|------|------|
| 2d.1 | Schema 补齐 | 全部 12 个 attrs |
| 2d.2 | Embed 平台检测 | YouTube/Vimeo/直接文件/blob 四种模式 |
| 2d.3 | YouTube iframe | YouTube IFrame API + postMessage 时间同步 |
| 2d.4 | Tab 框架 | Play / Data / Transcript 三 Tab + caption |
| 2d.5 | Data Tab | VideoMetadata 卡片渲染 |

**P2d-2：字幕与翻译**

| # | 任务 | 说明 |
|---|------|------|
| 2d.6 | 字幕 cue 解析 | [MM:SS] text 格式解析 |
| 2d.7 | CC 浮层 | 300ms 轮询 + 字幕显示/隐藏/语言选择 |
| 2d.8 | YouTube transcript import | youtube-transcript InnerTube API |
| 2d.9 | 翻译 Tab | Google Translate 批量翻译 + 动态 Tab 同步 |

**P2d-3：学习功能与下载**

| # | 任务 | 说明 |
|---|------|------|
| 2d.10 | Memory Playback Mode | 间隔重复序列生成 + 状态机 + 进度条 |
| 2d.11 | Vocab Panel | 词汇时间轴 + 滚动面板 |
| 2d.12 | yt-dlp 集成 | main 进程：getInfo + download + 进度回调 |
| 2d.13 | 全屏模式 | fullscreen API + 控制栏 |

---

## Phase 3：跨 Block 集成

| # | 任务 | 说明 |
|---|------|------|
| 3.1 | Thought 锚定 | 统一 NODE_THOUGHT_TYPES + thought-plugin + thought-commands |
| 3.2 | Atom Converter | 四个 Block 的双向 Atom 转换器 |
| 3.3 | Markdown 导出 | block-to-markdown 四种格式 |
| 3.4 | Paste plugin | 图片粘贴检测 + 智能插入 |

---

## 依赖关系

```
Phase 1（基础设施）
  ├── 1.1 RenderBlockBase ──┬── P2a Image
  ├── 1.2 Schema attrs ─────┤── P2b Audio
  ├── 1.3 CSS ──────────────┤── P2c Tweet
  ├── 1.4 Preload API ──────┤── P2d Video
  └── 1.5 IPC handlers ─────┘
                              │
                    P2b.4 MediaStore ← Audio 下载依赖
                    P2c.6-7 Tweet IPC ← Tweet fetch 依赖
                    P2d.12 yt-dlp ← Video 下载依赖
                              │
                         Phase 3（集成）
```

---

## 推进顺序

```
Phase 1 全部 → P2a Image → P2b Audio → P2c Tweet → P2d-1 → P2d-2 → P2d-3 → Phase 3
```

- **Image 最先**：零外部依赖，纯前端，快速验证 RenderBlockBase 增强是否到位
- **Audio 第二**：引入 MediaStore（Preload/IPC 的第一个真实用户），但 NodeView 逻辑简单
- **Tweet 第三**：引入 IPC 双向通信 + DOM 提取，复杂度中等
- **Video 最后**：功能最多，依赖 yt-dlp + transcript + 学习系统，拆三个子阶段逐步交付
