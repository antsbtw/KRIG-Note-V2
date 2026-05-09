# V2 当前状态盘点(2026-05-06,L5-B3.4 merge 后)

> 用途:V2 重构进展全景视图,为后续阶段决策提供基线参考。
> 对比 [v1-block-migration-checklist.md](./v1-block-migration-checklist.md):本文件含全 view + 全能力维度,不只 block/mark。
> 维护:每完成一个 L 阶段或大 epic,在此追加状态变化。

---

## 1. 已 merge 进 main 的阶段(11 个)

| # | 阶段 | 内容 | merge commit | 日期 |
|---|---|---|---|---|
| 1 | L0 | 平台层启动 | (early) | — |
| 2 | L2 | Shell + Workspace + Tabs | (early) | — |
| 3 | L3 | Workspace State + Instance | (early) | — |
| 4 | L3.5 | Workspace Bus | (early) | — |
| 5 | L4 | Slot Registry | (early) | — |
| 6 | L5-A | NoteView PM 骨架 | (early) | — |
| 7 | L5-B1 | 文件夹树 | (early) | — |
| 8 | L5-B2 | Marks(4) + Undo | (early) | — |
| 9 | L5-B3.1 | 4 大交互(floating-toolbar / slash / handle / context menu) | (early) | — |
| 10 | L5-B3.2 | 6 个 block 类型(bullet/ordered/task/blockquote/codeBlock/hr)+ 修 8 bug | d8773ba | 2026-05-06 |
| 11 | L5-B3.3 | marks 扩展(underline/textStyle/highlight)+ 3 简单 block(hardBreak/callout/toggleList) | 70c039a | 2026-05-06 |
| 12 | L5-B3.4 | link mark 全栈 + popup 基础设施 + ColorPicker 完整 UI | 159548f | 2026-05-06 |
| 13 | L5-B4 | web view 基础形态(webviewTag + WebView + per-ws state + 简化右键菜单 + link 跨 view 路由) | 68cb7c3 | 2026-05-06 |
| 14 | L5-B4.2 | web 双屏同步翻译(slot-bus + sync driver 7 事件 + Google Translate 注入 + 中文翻译 OK,切语言留 L5-B4.2.2) | f79168c | 2026-05-06 |
| 14.1 | L5-B4.2.1 | URL 路径方案调研(Google translate.goog 替代 widget 注入) | 归档不 merge(`feature/L5B4.2.1-google-url-translate`) | 2026-05-07 |
| 15 | L5-B4.2.2 | 翻译目标语言 per-ws 持久化 + navigator.language 默认 + 切语言重启 banner + sync-driver 防 crash | 9fd1700 | 2026-05-07 |
| 16 | L5-B4.3.1 | AI ↔ Note 闭环前置基建:mediaStore + md-to-pm(V2 schema 适配)+ ai-service-types | 55a01a7 | 2026-05-07 |
| 17 | L5-B3.5 | NoteEditor schema Phase A #1:image block(三态 placeholder/普通图/SVG + Upload/Embed/Resize + SVG 安全清洗 + mediaStore 集成 + slash /image)| e9e1475 | 2026-05-07 |
| 18 | L5-B3.6 | NoteEditor schema Phase A #2:mathBlock + mathInline(KaTeX 渲染 + 共享 IntersectionObserver / 缓存优化 + 双态编辑 + 反向驱动 ✅)| 04ffc8c | 2026-05-07 |
| 19 | L5-B3.7 | NoteEditor schema Phase A #3 收官:table 4 节点(prosemirror-tables 库 + 简版 NodeView + 完整业务 commands + 反向驱动 ✅)— **B+ 路径**:UX 装饰留 sub-stage,扩展性 100% 保留 | 2e63d61 | 2026-05-07 |
| 20 | L5-B3.8 | NavSide divider 拖拽改宽 + per-ws 持久化;V1 → V2 NoteEditor 迁移盘点 + Phase B 优先级 | 7e30579 | 2026-05-07 |
| 21 | L5-B3.9 | handle / context menu 重组(Turn Into 移到 handle;context = Cut/Copy/Paste/Select All/Delete;按钮 + 菜单分组 + 分隔符) | 0035d20 | 2026-05-07 |
| 22 | L5-B3.10 | floating toolbar 顺序对齐 V1 + group 分隔符(B/I/U/S/code → ∑ → 🔗 → 颜色) | 6335e95 | 2026-05-07 |
| 23 | L5-B3.11 | note title(text-block.isTitle + title-guard plugin)+ 单 'A' 综合按钮 + handle 菜单 submenu(对齐 V1 11 项 Turn Into + 4 占位 submenu)+ visibleWhen | 77a9d5b | 2026-05-07 |
| 24 | L5-B3.12 | **Phase B1 KRIG 知识图谱基础**:noteLink 双链 `[[note-title]]`(inline atom + leafText / `[[` 触发 popup 搜索面板 / krig://note 协议路由 / mount-once title 同步 / 失效红色态)— V1 → V2 直迁 | 960298f | 2026-05-07 |
| 25 | L5-B3.13 | **Phase B2 paste-media**:剪贴板图片 → image block(同步 dataUrl 占位 + 异步 mediaPutBase64 落盘 → media://;HTML 让步规则 / `$from.depth` 嵌套定位 / isTitle 守卫)— V1 → V2 直迁 | 68f31cb | 2026-05-07 |
| 26 | L5-B3.14 | **Phase B4 file-blocks 三件套**:fileBlock / fileLink / externalRef(前两者字节进 mediaStore,externalRef 仅存 URL — KRIG Graph 外部引用关系)+ main 侧 IPC 补齐(mediaResolvePath / showItemInFolder / getFilePath)— V1 → V2 直迁 | e35f60f | 2026-05-07 |
| 27 | L5-B3.15 | **B4 收尾**:LinkPanel 加"📎 文件" Tab(import/link 双模式 — `media://` 自包含 / `file://` 不复制)+ link-click plugin 加 media:// 路由 + file:// URL 解码 bug 修复(含空格/中文文件名能打开)+ 右键移除链接(光标命中即可,不需先选中) | 5f2e80a | 2026-05-07 |
| 28 | L5-B3.16 | **Phase B5 媒体三兄弟收齐**:audioBlock(<audio> + 上传 + 下载)+ videoBlock(YouTube embed iframe / 直接 video,砍字幕系统留 D / 砍 Vimeo+generic 留 D);driver 抽 insertWithCaptionBlock 通用辅助 — image / audio / video 三个 insert API 共用 | 818c1bc | 2026-05-08 |
| 29 | L5-B3.17 | **yt-dlp 能力层归位**:V1 src/main/ytdlp/ 268 行直迁 → src/platform/main/ytdlp/(binary-manager + downloader + handlers)+ src/capabilities/ytdlp/(renderer 入口 + Registry 注册 + DESIGN.md);7 IPC(5 invoke + 2 progress 推送);install 防重入 + saveSubtitle 路径安全校验;youtube-transcript@^1.3 自动抓 YouTube 字幕;对齐 audit § 5.2 W5 严格态 A 边界;为 L5-B3.18 tweet-block / L5-B3.19 video 字幕系统提供基础设施 | ee62cb2 | 2026-05-08 |
| 30 | L5-B3.18 | **tweet-block 完整迁(方案 A 最小化)**:V1 src/plugins/note/blocks/tweet-block.ts 456 行 + V1 fetchTweetData 170 行 + EXTRACT_TWEET_JS 80 行直迁;tweetBlock(双 Tab Browse iframe + Data 离线缓存,Fetch 按钮抓元数据 + Download 按钮调 ytdlp,iframe postMessage 自适应高度);**tweet-fetcher 临时 capability**(BrowserWindow + DOM scraping,⚠️ DESIGN.md 标识临时 + 不扩展约束 + Phase D 吸收路径);view install 加 ytdlp/tweet-fetcher/media-storage;CSP frame-src 加 platform.twitter.com | 630e0f9 | 2026-05-08 |
| ~~31~~ | ~~L5-B3.19.1 video 字幕引擎~~ | ~~已 revert(对照 V1 截图发现 video-block 整体差距过大,改路线"先底座再上层")~~ | ~~3925633(revert)~~ | ~~2026-05-08~~ |
| 32 | L5-B3.20a | **KRIG learning 后端(vocab + dictionary + translate + TTS)**:V1 → V2 直迁(~920 LOC);main 侧 platform/main/learning/(vocab-store JSON 文件 atomic write / dictionary-service / macos-dictionary swift CLI / google-translate + TTS / handlers 8 IPC + broadcast)+ src/capabilities/learning/(扁平化 8 method API + Registry 注册 + DESIGN);P1 审计修正注册闭环(renderer/index.tsx 加 import + view install 加 'learning');用户拍板 Q-存储=B JSON 文件 / Q-拆段=2 段 / Q-顺序=先 learning 后 video;5 决策点全 A 默认;为 L5-B3.20b dictionary-panel + B3.19 video-block 提供完整学习能力底座 | 96d0e44 | 2026-05-08 |
| 33 | L5-B3.20b | **KRIG learning UI(vocab-highlight PM plugin + DictionaryPanel + 右键查词/翻译)**:V1 → V2 改写(~883 LOC 实现 + ~325 行 CSS);driver 层 build-vocab-highlight-plugin.ts(227 LOC,V1 直迁,PM Decoration.inline 高亮 + 自管 tooltip DOM 挂 body)+ api.setVocabWords 遍历 instanceRegistry.getAll() 推 decoration;view 层 DictionaryPanel.tsx(483 LOC React 改写,双模 lookup/translate × 双 Tab lookup/vocab,模块级 pendingMode/pendingText 走 setPanelInitial)+ learning-integration.ts(订阅 onVocabChanged 推流)+ 右键菜单 learning group 两项(📖 查词 / 🌐 翻译 — has-selection 触发);P1 审计修正:view 全程 requireCapabilityApi(LearningApi/TextEditingApi),W5-A 边界合规;P2 类型名统一 DictionaryLookupResult;dictionary popup 走 popup-registry(过渡形态,L4.1 迁 help-panel),tooltip 自管 DOM(避免 hover singleton 冲突);CSS:dictionary-panel.css 独立文件 + pm-host.css 加 .vocab-highlight/.vocab-tooltip;learning 能力底座完整收口,B3.20 段落完结 | a11e74e | 2026-05-08 |
| 34 | L4.1 | **Help Panel Registry 基础设施(L4 后置补丁,7 号 interaction-registry)**:用户审计指出 V1 用 help-panel 框架(LaTeX / Mermaid / Math-Visual / Bookmarks / Dictionary 共用)V2 还没有,L4 时漏掉;新建右栏定宽长侧栏框架(360px,顶到底),跟 popup-registry 同构(扁平 register/get + Map + 单例 controller + Binding + Frame)但独立互斥池;~374 LOC 框架 + dictionary 迁入(从 popup → help-panel,view 净瘦 -49 行 — anchor fake-div 逻辑去掉);P1 审计修正 Q8 选项语义自洽(全局单例对齐 popupController,per-workspace 隔离作单独 stage 全部 4 个 controller 一并迁);8 决策点全 A 默认;子面板(LaTeX / Mermaid 等)留功能阶段消费时再迁;实施途中实测发现冷启动 race(learning-integration setVocabWords 早于 PM mount → onVocabChanged 不变化不触发 → decoration 永远空),修法:plugin state.init 读 module-level currentVocabWords 快照,push + pull 双覆盖(详见 memory feedback_module_push_pull_both)| 03bd485 | 2026-05-08 |
| 35 | L5-B3.19.a | **video-block 字幕底座(B3.19 第 1/5 段)**:V2 video-block 280 行单文件 → 多模块 Tab 架构(~1140 LOC driver + ~254 CSS,11 个新文件 + 2 改写);helpers/(embed-detection 加 vimeo/generic 探测留 Phase D / subtitle-parser V1 直迁 / **time-tracker 单源 300ms 轮询多订阅 — 本段核心**:YouTube postMessage event:listening + infoDelivery / video.currentTime 双源 + 零订阅停轮询 + event.source 严格校验)+ tabs/(tab-bar 切换 + actionBar 挂点 / play-tab iframe 或 video 或占位 + overlayMount / data-tab 基础 title 编辑 / transcript-tab textarea + toolbarMount)+ components/(subtitle-overlay 浮层 setActiveCue)+ actions/(cc-button + dropdown 本段 transcript/OFF / fullscreen-button)+ node-view 重写为协调中心(360 行,placeholder 二态 + framework 组装 + Tab 切换 + 订阅链 + 节流写 attrs + destroy 全清);spec.ts 加 activeTab + **transcriptText**(P1 修正后真相源 — 原文持久化,subtitleCues 内存派生不持久化;parser 升级老笔记自动受益);P2 修正 findActiveCue 描述对齐 V1 线性扫描;7 决策点 Qa-1~Qa-7 全 A 默认;子段 b/c/d/e 待启 — b 先扩 ytdlp.fetchTranscript IPC,c Memory Mode,d Vocab Panel,e 下载+完整 Data Tab | 7f97298 | 2026-05-09 |
| 36 | L5-B3.19.b | **video-block 字幕产线(B3.19 第 2/5 段)**:transcript import + translate 多 Tab(~490 行新增 + 12 行重写);**先扩 ytdlp capability**(P1 修正:四方独立类型 — main/preload/electron-api/capability 零跨层 import,对齐 V2 既有 onYtdlpDownloadProgress 模式)加 fetchTranscript 独立 IPC + handler + capability method;driver 层 actions/transcript-button.ts(📝 仅 YouTube 启用,调 fetchTranscript)+ actions/translate-button.ts(🌐 batched 4500 字符调 learning.translate,batch 失败降级原文,对齐 V1);node-view 集成动态翻译 Tab(translations Map<lang, ref>,upsert 模式,readonly textarea Qb-1=A,自动切到新 Tab)+ cc dropdown 多语言同步;spec.ts 加 translationTexts JSON attr 持久化;update() 处理外部驱动(撤销/协作)整体重建翻译 Tab 集合;8 个 Qb 子决策全 A 默认;**新工作流**:本段不单独验收,a~e 全 merge 后统一验收清单 | 2651f9c | 2026-05-09 |

---

## 2. 当前 V2 能力清单

### 2.1 NoteView(已迁基本完成)

| 能力 | 状态 | 备注 |
|---|---|---|
| 8 个 mark | ✅ 全部 | bold/italic/underline/strike/code/textStyle/highlight/link |
| 12 个 block | ✅ 基本完成 | text-block / bullet/ordered/task list + listItem/taskItem / blockquote / codeBlock(基础)/ horizontalRule / hardBreak / callout / toggleList |
| 4 大交互 | ✅ | floating-toolbar / slash menu / handle menu / context menu |
| Turn Into | ✅ 11 种 | paragraph/h1/h2/h3/bullet/ordered/task/blockquote/code/hr/callout/toggle |
| popup 基础设施 | ✅ | LinkPanel / ColorPickerPanel(slot 维度,跨 view 复用) |
| link 5 协议路由 | ✅ | http/https/file/krig://note/krig://block + 同文档 anchor 滚动 |
| 笔记导航历史栈 | ⚠️ 仅 link 跳转 | NavSide 切笔记不进栈(降级,留后续) |
| Cmd+K LinkPanel | ✅ | 必须有选区 |
| Cmd+[/Cmd+] 历史 | ✅ | |
| 颜色 swatch UI | ✅ 10×2 | 完整 V1 ColorPicker UI |

### 2.2 NavSide

| 能力 | 状态 |
|---|---|
| 文件夹树 | ✅ |
| 笔记列表 | ✅ |
| 排序 | ✅ |
| 拖拽 | ⚠️ NavSide 内拖拽未验证(L5-B1 时落地) |
| 右键菜单 | ✅ |
| 多选 | ✅ |
| 复制粘贴 | ✅ |

### 2.3 5 大 capability

| capability | 状态 |
|---|---|
| selection | ✅ |
| clipboard | ✅(基础) |
| undo-redo | ✅ |
| drag-and-drop | ✅(基础,跨 view 留后续) |
| insertion | ✅ |

### 2.4 platform / IPC

| IPC | 状态 |
|---|---|
| health.* / diagnostics | ✅(L0-L5) |
| window.fullscreen-changed | ✅ |
| shell.open-external / open-path | ✅ L5-B3.4 新增 |
| **其他 viewAPI** | ❌ **完全缺失**(noteList / noteLoad / fileOpenDialog / mediaPutFile 等) |

---

## 3. V1 → V2 待迁移 epic 清单(本文件维护)

> 不在 v1-block-migration-checklist.md(那个只管 block/mark 维度)。

### 3.1 大 epic — 整 view(从无到有)

| epic | V1 代码量 | 优先级 | 依赖 | 备注 |
|---|---|---|---|---|
| **web view 基础形态**(WebView + WebToolbar + 简化右键菜单)| ~700 行迁(L5-B4)| ✅ 已迁(本批) | electron `<webview>` tag(已启) | link 跨 view 路由验证落地;书签/历史/翻译/AI 留 L5-B4.x |
| **web-bridge**(注入 + extraction + 协议)| ~7600 行(web-bridge/) | 中 | web view | 比 web view 更复杂,Note 内容提取 / AI 工作流依赖 |
| ebook view | 未统计 | 中 | PDF / EPUB 渲染 | KRIG 业务 |
| graph view(canvas) | 未统计 | 低-中 | three.js 等 | KRIG 知识图谱 view |
| thought view | 未统计 | 低 | NoteView variant | NoteView 变体,代码复用度高 |
| ai-note-bridge | 未统计 | 中 | NoteView + LLM API | AI 集成 |
| browser-capability | 未统计 | 中 | 跨 view 浏览器抽象 |  |

### 3.2 平台 / 基础设施 epic

| epic | 优先级 | 阻塞 | 备注 |
|---|---|---|---|
| **viewAPI IPC 阶段**(fileOpenDialog / mediaPutFile / pathInfo 等)| **中** | 解锁:audio/video/file-block 迁移 / LinkPanel 文件 Tab / ebook 导入 | 通用基础设施 |
| **ActiveResourceManager 抽象**(集中管理 activeNoteId / rightActiveNoteId / activeBookId)| 中 | 解锁:link 跨 ws + 真右栏 routing | V2 故意暂缺 |
| **storage 层迁移**(localStorage → SurrealDB) | 低-中 | 数据规模大时 | V1 用 SurrealDB |
| **学习系统**(learning) | 低 | KRIG 业务 | V1 有 |
| **ProseMirror codeBlock 全量(CodeMirror 6)** | ⏸️ 阻塞 | 等用户 CodeMirror 6 计划 | 占位分支 feature/L5B3.3-code-block-migration |

### 3.3 中小 epic — block/mark 维度的剩余

详见 [v1-block-migration-checklist.md](./v1-block-migration-checklist.md)。
关键剩余:image / note-link / external-ref / page-anchor / file-link / column-list /
audio / video / file-block / math-block / table 等。

---

## 4. 推荐下一步候选(按"价值 + 可行性"排序)

| 选项 | 内容 | 价值 | 工作量 | 阻塞? |
|---|---|---|---|---|
| **A. L5-B4 web view 迁移** | 整 view 落地,提供 link 跨 view 测试床 | ⭐⭐⭐⭐⭐ | 中-大(~3000 行核心 + ~2800 行选迁) | 无(electron `<webview>`) |
| B. ActiveResourceManager 抽象 | 解锁 link 跨 ws / 真右栏 routing | ⭐⭐⭐⭐ | 中 | 无 |
| C. viewAPI IPC 阶段 | 解锁 audio/video/file-block / LinkPanel 文件 Tab | ⭐⭐⭐ | 中-大 | 无 |
| D. 简单 block 第二批 | page-anchor / file-link / tweet-block / html-block / frame-block | ⭐⭐ | 中 | 无 |
| E. 中等 block 第一批 | image / note-link / external-ref | ⭐⭐⭐ | 中-大 | 部分依赖 viewAPI |

**当前用户选择(2026-05-06):A — L5-B4 web view 迁移**
理由:为 Note 与 web 内容交互的未来 epic 提供测试床;link 跨 view 路由可以借此真实验证

**已落地(2026-05-06):L5-B4 web view 基础形态**
- platform 启 webviewTag + 安全拦截
- WebView + WebToolbar + per-ws state(google.com 默认主页)
- link 跨 view 路由生效(NoteView 内点 https:// → 当前 ws 右栏 web view)
- 简化版右键菜单 4 项
- 7 commits ~700 行代码

---

## 5. 修订记录

| 日期 | 改动 |
|---|---|
| 2026-05-06 | 初稿;L5-B3.4 merge 后状态盘点;V1 → V2 epic 全景清单;下一步候选 A 拍板 |
| 2026-05-06 | L5-B4 web view 基础形态完成;link 跨 view 路由验证落地 |
| 2026-05-06 | L5-B4.2 web 双屏同步翻译完成;slot-bus(免 IPC)+ sync driver + Google Translate |
| 2026-05-07 | L5-B4.2.1 URL 路径方案归档(体验降级未 merge);L5-B4.2.2 切语言走"持久化 + 重启 banner"UX 兜底完成 |
| 2026-05-07 | L5-B4.3.1 前置基建完成:mediaStore(V1 直迁,DB 路径剥离)+ md-to-pm(V2 schema 适配 + 节点降级策略)+ ai-service-types(claude/chatgpt/gemini 直迁);L5-B4.3.2 web-bridge 直迁待启动 |
| 2026-05-07 | L5-B4.3 暂停推进 — note schema 不齐导致 AI 提取无法验证;改 Phase A 优先补 schema(L5-B3.5 image / L5-B3.6 math / L5-B3.7 table)。L5-B3.5 image block 完成(unknown → image 反向驱动证明) |
| 2026-05-07 | L5-B3.6 mathBlock + mathInline 完成(KaTeX 渲染,V1 性能优化全部直迁:渲染缓存 / 共享 IntersectionObserver / 共享 mousedown listener;砍 LaTeX 速查面板留 L5-B+ / 砍 thoughtMark 集成);反向驱动证明再次验证 |
| 2026-05-07 | L5-B3.7 table 4 节点完成(prosemirror-tables 库 + B+ 路径:schema + 完整业务 commands + 简版 NodeView + 必要插件;砍 hover 指示器 / 自建 DOM 菜单 / CellSelection 浮动 toolbar 留 L5-B3.7.1 接 V2 注册系统);Phase A 收官,反向驱动第三次证明 ✅ |
| 2026-05-07 | L5-B3.8 - 3.11 UX 对齐 V1 完成:NavSide divider / handle context 菜单重组 / floating toolbar 顺序对齐 / note title(isTitle + title-guard)+ handle submenu 框架 |
| 2026-05-07 | **L5-B3.12 noteLink 双链完成 — Phase B1 KRIG 知识图谱基础落地** ✅:V1 → V2 直迁(~500 LOC + 90 CSS)。inline atom + leafText 复制还原 / `[[` handleTextInput 触发 popup / `]]` 自动关 / krig://note 协议路由(复用 link-click handler 加 resolveNoteTitle)/ mount-once title 同步 / 删除目标显红色"未找到"态;5 决策点全 A 默认 |
| 2026-05-07 | **L5-B3.13 paste-media 完成 — Phase B2** ✅:V1 → V2 直迁(~122 LOC)。剪贴板图片 handlePaste 同步 dataUrl 占位 + 异步 mediaPutBase64 落盘 → media://(刷新不丢);HTML 让步规则(table/h1-6 → 让 PM 默认 / Phase E smart-paste 兼容);$from.depth 嵌套容器定位 + L5-B3.11 isTitle 守卫;5 决策点全 A 默认 |
| 2026-05-07 | **L5-B3.14 file-blocks 三件套完成 — Phase B4** ✅:V1 → V2 直迁(~770 LOC + 250 CSS)。fileBlock(block 卡片,字节进 mediaStore,placeholder ↔ card 双态)+ fileLink(inline atom 📎 chip,自绘 contextmenu)+ externalRef(block 引用卡,kind=file/url,失败友好提示);main 侧补 3 IPC(mediaResolvePath 安全白名单 / showItemInFolder / getFilePath via webUtils);driver 抽 insertAtomBlock 通用辅助;5 决策点全 A 默认(Q4 取 B 失败提示) |
| 2026-05-07 | **L5-B3.15 LinkPanel 文件 Tab 完成 — B4 收尾** ✅:V1 → V2 直迁(~206 LOC + 106 CSS)。LinkPanel 三 Tab(笔记/📎文件/🔗网页);文件 Tab 双模式(import → media:// 自包含;link → file:// 不复制)— B3.14 IPC 已补,无需新加 IPC,纯 renderer 走 `<input type="file">` + getFilePath / FileReader + mediaPutBase64;link-click plugin 补 media:// 协议路由 + file:// URL 解码 bug 修复(含空格/中文文件名能打开 — pre-existing bug 顺手修);失败 inline 红字提示(对齐 B3.14 模式);右键移除链接补丁(slot 框架扩展 has-link 条件 + driver removeLinkAtClientPoint,光标命中即可不需先选中) |
| 2026-05-08 | **L5-B3.16 audio + video 完成 — Phase B5 媒体三兄弟收齐** ✅:V1 → V2 直迁(~720 LOC + 247 CSS)。audioBlock(`<audio controls>` + upload via mediaPutBase64 + http(s) 源下载按钮 via mediaDownload + 内嵌 caption);videoBlock(YouTube embed iframe 16:9 / 直接 video 控件,砍 V1 988 行里 ~700 行字幕系统留 Phase D / 砍 Vimeo+generic embed 留 D);driver 抽 insertWithCaptionBlock 通用辅助 — image / audio / video 三个 insert API 共用 + 重构 image 复用同辅助;NodeView destroy 释放音视频(切笔记不残留声音);5 决策点全 A 默认 |
| 2026-05-08 | **L5-B3.17 yt-dlp 能力层归位完成** ✅:V1 src/main/ytdlp/ 268 行完整直迁 → src/platform/main/ytdlp/(binary-manager + downloader + handlers,~394 LOC)+ src/capabilities/ytdlp/(renderer 入口 + Registry 注册 + DESIGN.md,~274 LOC);7 IPC(5 invoke + 2 progress 推送 — webContents.send / ipcRenderer.on 模式对齐 onFullscreenChanged);install 防重入(installPromise 单例避免文件竞争)+ saveSubtitle 安全校验(isAbsolute + 不含 .. + langCode 正则约束防 ../ 注入文件名);ipc-bus 集中注册(对齐 V2 现有约定,不改 main/index.ts);npm install youtube-transcript@^1.3.0 内部 ytdlp 用,view 不可见;5 决策点全 A 默认(Q1=A 双导出 / Q2=B 多订阅 / Q3=A 防重入 / Q4=B 路径校验 / Q5=A 装 yt-transcript);设计 v0.2 用户审计修正(P1-1 W5 临时允许项标注 / P1-2 删 main 模块 index.ts 对齐平铺约定 / P2-3 youtube-transcript 层级约束) |
| 2026-05-08 | **L5-B3.18 tweet-block 完整迁完成 — 方案 A 最小化** ✅:V1 → V2 直迁(~1227 LOC + 200 CSS);tweetBlock 完整 NodeView(双 Tab Browse iframe + Data 离线卡片 / Fetch 按钮抓元数据 / Download 按钮调 ytdlp / iframe postMessage 自适应高度 / destroy 清 listener);**tweet-fetcher 临时 capability**(BrowserWindow + DOM scraping,⚠️ DESIGN.md 标识临时 + 不扩展约束 + Phase D 吸收路径 — 用户红线"避免临时能力长期化");view install 加 ytdlp/tweet-fetcher/media-storage(install-coverage 自检 capabilities 9 个);CSP frame-src 加 platform.twitter.com;driver 走 capability 模块级 import(W5 严格态 A 边界);设计 v0.2 用户审计修正(P1 capability 反向依赖白名单 + P2 driver/view 等价语义改弱) |
| 2026-05-08 | **L5-B3.19.1 字幕引擎 已 revert**(commit 3925633)— 用户对照 V1 截图发现 video-block 整体 UX 跟 V1 差距太大(toolbar / 多 Tab / Memory Playback / vocab panel 全缺);拆段路径(19.0 + 19.1)在错误起点上修补,继续会反复折腾。**决策**:撤回 19.1(revert merge commit);删 feature/L5B3.19.0 分支(未 merge,代码丢弃);改路线为"先底座再上层"—— 先 L5-B3.20 KRIG learning 模块完整迁(~1000 LOC,vocab/dictionary/translate/TTS),再 L5-B3.19 video-block 整体重做(基于 learning + 已有 ytdlp / tweet-fetcher 等)。撤回原则:Q1=A 删 19.0 / Q2=B 完全 revert 19.1 / Q3=A 先 learning 后 video |
| 2026-05-08 | **L5-B3.20a KRIG learning 后端完成** ✅:V1 → V2 直迁(~920 LOC);main 侧 src/platform/main/learning/(vocab-store JSON 文件 atomic write / dictionary-service / macos-dictionary swift CLI / google-translate + TTS / handlers 8 IPC + broadcast,~490 LOC)+ src/capabilities/learning/(扁平化 8 method API + Registry 注册 + DESIGN,~310 LOC);用户拍板 Q-存储=B JSON 文件 / Q-拆段=2 段 / Q-顺序=先 learning 后 video;5 决策点全 A 默认(Q1 atomic write / Q2 broadcast 遍历 BrowserWindow / Q3 tts ArrayBuffer / Q4 net.fetch 直用 / Q5 macOS 静默 fallback);设计 v0.2 用户审计 P1 修正(注册闭环 — renderer/index.tsx 加 `import '@capabilities/learning'`,view install 加 'learning';无 view 直接消费场景必须显式拉,对齐 V2 既有约定);capabilities 11 个;为 L5-B3.20b + B3.19 提供 learning 能力底座 |
| 2026-05-08 | **L5-B3.20b KRIG learning UI 完成** ✅:V1 → V2 改写(~883 LOC 实现 + ~325 行 CSS);driver 层 build-vocab-highlight-plugin.ts 227 行(V1 直迁,PM Decoration.inline 高亮 `.vocab-highlight` + plugin 自管 tooltip DOM 挂 body — 不走 popup-registry 避免 hover singleton 冲突)+ api.setVocabWords 通过 instanceRegistry.getAll() 遍历推 decoration tr;view 层 DictionaryPanel.tsx 483 行 React 改写(双模 lookup/translate × 双 Tab lookup/vocab,模块级 pendingMode/pendingText 走 setPanelInitial,popup-registry 注册 380x480)+ learning-integration.ts 83 行(订阅 onVocabChanged 推流 + showDictionaryPanel/showTranslationPanel 给 cm 命令调)+ 右键菜单 learning group 加 📖 查词/🌐 翻译(has-selection 触发,选区有锚则锚点定位)+ note-commands 接 cm-dictionary-lookup/cm-translate-text;P1/P2 审计修正:view 全程 requireCapabilityApi(LearningApi/TextEditingApi) 不直 import @drivers/* 或 @capabilities/learning 运行时函数(types 类型 only),W5-A 边界合规;LookupResult → DictionaryLookupResult 对齐 20a;CSS:dictionary-panel.css 独立文件 250 行 + pm-host.css 加 .vocab-highlight/.vocab-tooltip 75 行;learning 模块完整收口,B3.20 段落完结;capabilities 11 个不变;为 B3.19 video-block 整体重做提供 learning 上层 UI 基础设施 |
| 2026-05-08 | **L4.1 Help Panel Registry 基础设施完成** ✅:用户审计指出 V1 用 help-panel 框架(LaTeX / Mermaid / Math-Visual / Bookmarks / Dictionary 共用)V2 还没有,L4 时漏掉;新建右栏定宽长侧栏框架 ~374 LOC(types + registry + controller + Binding + CSS + Frame),跟 popup-registry 同构(扁平 register/get + Map + 单例 controller + Binding + Frame)但**独立互斥池** — popup vs help-panel 两套独立(Q7=A);dictionary 从 popup-registry 迁到 help-panel-registry(view 净瘦 -49 行 — anchor fake-div 逻辑去掉);用户审计 P1 修正 v0.1 Q8 选项语义自相矛盾(A/B 含义跟说明默认值不一致)→ v0.2 统一为"全局单例对齐 popupController,per-workspace 隔离作单独 stage 全部 4 个 controller 一并迁";8 决策点全 A 默认;子面板(LaTeX / Mermaid / Math-Visual / Bookmarks)留功能阶段消费时再迁(Q5=A);B3.20b dictionary popup 形态正式收口为右栏长侧栏(对齐 V1 体验) |
| 2026-05-09 | **L5-B3.19.a video-block 字幕底座完成** ✅(B3.19 第 1/5 段):V2 video-block 280 行单文件 → 多模块 Tab 架构(~1140 LOC driver + ~254 CSS);**关键抽象 time-tracker** 单源 300ms 轮询多订阅(YouTube postMessage event:listening + infoDelivery / video.currentTime 双源,零订阅停轮询,event.source 严格校验防 cross-iframe message 误中);Tab 框架(Video/Meta/EN)+ subtitle overlay(activeCue 渲染,文本不变不重渲)+ CC dropdown(本段 transcript/OFF,b 段加翻译语言)+ ⛶ 全屏;**transcriptText 单一真相源(P1 修正后)**:原文持久化到 attrs,subtitleCues 内存派生不持久化(parser 升级老笔记自动受益);P2 修正 findActiveCue 描述对齐 V1 线性扫描;Vimeo/generic 探测但显占位"暂不支持(Phase D)" — 总设计 Q4=A;node-view 重写为协调中心,destroy 全清防内存泄漏;7 个 Qa 子决策全 A 默认;3 commit 实施;后续 b/c/d/e 待启 |
| 2026-05-09 | **L5-B3.19.b video-block 字幕产线完成** ✅(B3.19 第 2/5 段):transcript import + translate 多 Tab(~490 行 + 12 行重写);**P1 修正落地** ytdlp capability 扩展四方独立类型(main 本地 FetchTranscriptOutput / preload Promise<unknown> / electron-api inline shape / capability FetchTranscriptResult,零跨层 import,对齐 V2 既有 onYtdlpDownloadProgress 模式);新增 ytdlpFetchTranscript IPC + handler + capability method,把 youtube-transcript 不下载视频独立暴露给 📝 按钮;driver 层 actions/transcript-button(YouTube 启用 + ytdlp.fetchTranscript + 状态机 + 自动切 transcript Tab)+ actions/translate-button(切分时间戳/纯文本 + batched 4500 + 重组 + batch 失败降级原文,对齐 V1);node-view 集成 translations Map<lang, ref> + upsert 模式 + readonly textarea(Qb-1=A)+ cc dropdown 多语言同步;spec.ts 加 translationTexts JSON 持久化;8 个 Qb 子决策全 A 默认;**新工作流**(用户拍板:连续 b/c/d/e 段不单独验收,e 段后统一验收) |
