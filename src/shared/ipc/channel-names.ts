/**
 * IPC channel 名常量
 *
 * 跨进程共享类型(纯类型,0 npm 业务包 import)。
 *
 * 命名约定:
 * - 健康检查:`health.<层名>`(如 `health.L0` / `health.L1` / `health.platform`)
 * - 业务通信:`<层名>.<动作>`(如 `workspace.activate` / `view.create`)
 */

export const IPC_CHANNELS = {
  // 健康检查(各层暴露自己的 alive 状态)
  HEALTH_L0: 'health.L0',
  HEALTH_L1: 'health.L1',
  HEALTH_L2: 'health.L2',
  HEALTH_L3: 'health.L3',
  HEALTH_L3_5: 'health.L3.5',
  HEALTH_L4: 'health.L4',
  HEALTH_L5: 'health.L5',
  HEALTH_PLATFORM: 'health.platform',
  HEALTH_RENDERER: 'health.renderer',

  // 诊断上报(renderer → main,L2 阶段引入)
  DIAGNOSTICS_REPORT_ALIVE: 'diagnostics.report-alive',

  // 窗口状态变化(main → renderer,L2 阶段引入)
  WINDOW_FULLSCREEN_CHANGED: 'window.fullscreen-changed',

  // L5-B3.4:外部链接 / 文件打开(给 link-click plugin 用)
  SHELL_OPEN_EXTERNAL: 'shell.open-external',
  SHELL_OPEN_PATH: 'shell.open-path',
  // L5-B3.14:在 Finder 高亮显示文件(file-block / file-link / external-ref 用)
  SHELL_SHOW_ITEM_IN_FOLDER: 'shell.show-item-in-folder',

  // L5-B4.2:Google Translate element.js fetch(避 CSP block,main 进程取后注入)
  WEB_TRANSLATE_FETCH_ELEMENT_JS: 'web-translate.fetch-element-js',

  // L5-B4.2.2:重启 app(切翻译语言后让 widget 用新 lang 重 init)
  APP_RESTART: 'app.restart',

  // Phase 2:web view 原生右键菜单 — 查词/翻译项点击后 main → renderer 推回,
  // 由 learning capability 操作 dictionaryPanel(复制类在主进程 clipboard 直接做)
  WEB_CONTEXT_MENU_ACTION: 'web.context-menu-action', // main → renderer 推送

  // Phase 4 Commit 2:web view 快捷键整层 — webview 焦点下宿主 onKeyDown 失效,
  // 主进程 before-input-event 拦截这套 web 快捷键后 main → renderer 推回,由
  // WebView.tsx 分发到现有 handler(new-tab/close-tab/focus-url/find/reload/zoom/back/forward)
  WEB_VIEW_SHORTCUT: 'web.view-shortcut',           // main → renderer 推送
  // Phase 4 Commit 2:弹窗导流 — guest setWindowOpenHandler 截获 target=_blank,
  // main → renderer 推回让 web view 内新建 tab 打开(不再飞出独立 BrowserWindow)
  WEB_NEW_TAB: 'web.new-tab',                        // main → renderer 推送

  // Phase 3:web view 下载管理 — will-download 挂 persist:webview session 一次,
  // shouldHandle 排除 AI/翻译,不 setSavePath(Electron 自动弹保存框)。
  // 进度/完成 main → renderer 推送(下载条 UI);取消走 invoke。
  WEB_DOWNLOAD_EVENT: 'web.download-event',          // main → renderer 推送(started/progress/done)
  WEB_DOWNLOAD_ACTION: 'web.download-action',        // renderer → main invoke(cancel)

  // L5-B4.3.1:Media 存储(base64 / 远程下载 → media:// URL)
  MEDIA_PUT_BASE64: 'media.put-base64',
  MEDIA_DOWNLOAD: 'media.download',
  // L5-B3.14:media:// URL → 本地路径解析(file-block / file-link / external-ref 打开/Finder 显示用)
  MEDIA_RESOLVE_PATH: 'media.resolve-path',

  // L5-B3.17:yt-dlp 能力(checkStatus / install / download / getInfo / saveSubtitle)
  YTDLP_CHECK_STATUS: 'ytdlp.check-status',
  YTDLP_INSTALL: 'ytdlp.install',
  YTDLP_INSTALL_PROGRESS: 'ytdlp.install-progress',     // main → renderer 推送
  YTDLP_DOWNLOAD: 'ytdlp.download',
  YTDLP_DOWNLOAD_PROGRESS: 'ytdlp.download-progress',   // main → renderer 推送
  YTDLP_GET_INFO: 'ytdlp.get-info',
  YTDLP_SAVE_SUBTITLE: 'ytdlp.save-subtitle',
  YTDLP_FETCH_TRANSCRIPT: 'ytdlp.fetch-transcript',     // L5-B3.19.b:不下载视频抓 YouTube 字幕
  YTDLP_CHECK_YOUTUBE_COOKIES: 'ytdlp.check-youtube-cookies', // 检 webview partition 是否有 YouTube 登录 cookies

  // L5-B3.18:tweet-fetcher 临时能力(BrowserWindow + DOM scraping;Phase D 被吸收)
  TWEET_FETCH_DATA: 'tweet-fetcher.fetch-data',

  // L5-B3.20a:learning(vocab CRUD + dictionary + translate + TTS)
  LEARNING_VOCAB_ADD: 'learning.vocab-add',
  LEARNING_VOCAB_REMOVE: 'learning.vocab-remove',
  LEARNING_VOCAB_LIST: 'learning.vocab-list',
  LEARNING_VOCAB_HAS: 'learning.vocab-has',
  LEARNING_VOCAB_CHANGED: 'learning.vocab-changed',     // main → renderer 推送
  LEARNING_LOOKUP: 'learning.dictionary-lookup',
  LEARNING_TRANSLATE: 'learning.translate',
  LEARNING_TTS: 'learning.tts',

  // L5-C1:ebook 书架(sub-phase 022: 走 atom 体系 — ebook + reading-state + pm domain)
  EBOOK_BOOKSHELF_LIST: 'ebook.bookshelf-list',
  EBOOK_PICK_FILE: 'ebook.pick-file',
  EBOOK_BOOKSHELF_ADD: 'ebook.bookshelf-add',
  EBOOK_BOOKSHELF_OPEN: 'ebook.bookshelf-open',
  EBOOK_BOOKSHELF_REMOVE: 'ebook.bookshelf-remove',
  EBOOK_BOOKSHELF_RENAME: 'ebook.bookshelf-rename',
  EBOOK_BOOKSHELF_MOVE: 'ebook.bookshelf-move',
  EBOOK_BOOKSHELF_RELOCATE: 'ebook.bookshelf-relocate',         // D-5 文件不存在重新定位
  EBOOK_BOOKSHELF_TRANSFER: 'ebook.bookshelf-transfer-managed', // link → managed
  EBOOK_BOOKSHELF_CHANGED: 'ebook.bookshelf-changed',           // main → renderer 推送
  // 文件夹: sub-phase 022 删 5 channel (folderList/Create/Rename/Delete/Move) — 改走
  // folder capability + viewType='ebook' (决议 021 §4.3 兼容约束落地)
  // 数据传输
  EBOOK_GET_DATA: 'ebook.get-data',
  EBOOK_LOADED: 'ebook.loaded',                                 // main → renderer 推送
  EBOOK_CLOSE: 'ebook.close',
  // 进度 + 书签 (sub-phase 022: reading-state atom CRUD)
  EBOOK_SAVE_PROGRESS: 'ebook.save-progress',
  EBOOK_BOOKMARK_TOGGLE: 'ebook.bookmark-toggle',
  EBOOK_BOOKMARK_LIST: 'ebook.bookmark-list',
  EBOOK_CFI_BOOKMARK_ADD: 'ebook.cfi-bookmark-add',
  EBOOK_CFI_BOOKMARK_REMOVE: 'ebook.cfi-bookmark-remove',
  EBOOK_CFI_BOOKMARK_LIST: 'ebook.cfi-bookmark-list',
  // 标注: sub-phase 022 删 3 annotation channel — annotation 概念消亡,改走下面 5 个
  // thought block channel (pm atom + hasReadingThought 边 + PM block.attrs.bookAnchor)
  // ── L5-C1 / sub-phase 022:reading thought block (annotation → thought 转后接入) ──
  EBOOK_THOUGHT_GET: 'ebook.thought-get',                       // getReadingThought
  EBOOK_THOUGHT_ENSURE: 'ebook.thought-ensure',                 // ensureReadingThought (lazy create)
  EBOOK_THOUGHT_BLOCK_ADD: 'ebook.thought-block-add',           // addReadingThoughtBlock
  EBOOK_THOUGHT_BLOCK_REMOVE: 'ebook.thought-block-remove',     // removeReadingThoughtBlock
  EBOOK_THOUGHT_BLOCK_GET: 'ebook.thought-block-get',           // PR-α-3b getReadingThoughtBlock(单读)
  EBOOK_THOUGHT_BLOCK_UPDATE_COLOR: 'ebook.thought-block-update-color', // PR-α-3b updateReadingThoughtBlockColor
  EBOOK_THOUGHT_ANNOTATIONS: 'ebook.thought-annotations',       // getReadingThoughtAnnotations

  // L5-C6:PDF 提取 → Note(KRIG Knowledge Platform 集成)
  EXTRACTION_UPLOAD: 'extraction.upload',           // renderer → main:上传当前 PDF → 返 md5
  EXTRACTION_IMPORT: 'extraction.import',           // renderer → main:主动触发 import(备用入口)
  EXTRACTION_NOTE_CREATE: 'extraction.note-create', // main → renderer 推送:请 view 端创建 note

  // Markdown 文件 / 目录导入(File → Import Markdown...)
  MARKDOWN_IMPORT_RUN: 'markdown-import.run',       // main → renderer 推送:已扫好的 ScannedFile[]
  // import-cache 诊断落盘(renderer → main,fire-and-forget)— 2026-05-27 长文档乱码诊断
  IMPORT_CACHE_DUMP_CHUNK: 'import-cache.dump-chunk',
  IMPORT_CACHE_DUMP_PM_DOC: 'import-cache.dump-pm-doc',
  IMPORT_CACHE_RECORD_STAGE: 'import-cache.record-stage', // chunk/pm 阶段总结落 manifest

  // L7-sub2:note + folder capability (decision 012,SurrealDB Sidecar)
  // 业务粒度 IPC + LIST_CHANGED 广播,对齐 ebook / graph 模式
  NOTE_CREATE: 'note.create',
  // 5B Stage 7: 批量 import 入口 (PmAtomDraft[] → 单事务多 note)
  NOTE_CREATE_BATCH: 'note.create-batch',
  NOTE_LIST: 'note.list',
  // 2026-05-28 性能修复:轻量 list,只返 id/title/folderId,不 assemble doc
  NOTE_LIST_TITLES: 'note.list-titles',
  NOTE_GET: 'note.get',
  NOTE_UPDATE: 'note.update',
  NOTE_MOVE: 'note.move',
  NOTE_DELETE: 'note.delete',
  NOTE_LIST_CHANGED: 'note.list-changed',           // main → renderer 推送
  NOTE_DOC_CONTENT_CHANGED: 'note.doc-content-changed', // main → renderer 推送(单 note doc 变化,发起者除外)

  // thought capability(横切思考层 — thought-view-port.md v0.5 §5.3)
  // 9 channel-names = 8 invoke(对应 §5.3 API #1–#8) + 1 broadcast
  THOUGHT_CREATE: 'thought.create',
  THOUGHT_LIST: 'thought.list',
  THOUGHT_LIST_BY_SOURCE: 'thought.list-by-source',
  THOUGHT_GET: 'thought.get',
  THOUGHT_UPDATE: 'thought.update',
  THOUGHT_DELETE: 'thought.delete',
  THOUGHT_MOVE_TO_FOLDER: 'thought.move-to-folder',
  THOUGHT_UPDATE_ANCHOR: 'thought.update-anchor',
  THOUGHT_LIST_CHANGED: 'thought.list-changed',     // main → renderer 推送

  FOLDER_CREATE: 'folder.create',
  FOLDER_LIST: 'folder.list',
  FOLDER_GET: 'folder.get',
  FOLDER_RENAME: 'folder.rename',
  FOLDER_MOVE: 'folder.move',
  FOLDER_DELETE: 'folder.delete',
  FOLDER_PREVIEW_DELETE: 'folder.preview-delete',   // decision 021 §5.5 Q7 弱保护
  FOLDER_LIST_CHANGED: 'folder.list-changed',       // main → renderer 推送

  // L5-G1:graph 画板 + 文件夹(D-3=B JSON 实现,过渡至 W6 升 SurrealDB)
  GRAPH_LIST: 'graph.list',
  GRAPH_LOAD: 'graph.load',
  GRAPH_CREATE: 'graph.create',
  GRAPH_SAVE: 'graph.save',
  GRAPH_DELETE: 'graph.delete',
  GRAPH_RENAME: 'graph.rename',
  GRAPH_MOVE_TO_FOLDER: 'graph.move-to-folder',
  GRAPH_DUPLICATE: 'graph.duplicate',
  GRAPH_LIST_CHANGED: 'graph.list-changed',         // main → renderer 推送
  // 文件夹
  GRAPH_FOLDER_LIST: 'graph.folder-list',
  GRAPH_FOLDER_CREATE: 'graph.folder-create',
  GRAPH_FOLDER_RENAME: 'graph.folder-rename',
  GRAPH_FOLDER_DELETE: 'graph.folder-delete',
  GRAPH_FOLDER_MOVE: 'graph.folder-move',

  // L7-sub3a-1:pm-content capability (decision 014 §3.4,view-agnostic pm atom CRUD)
  PM_CONTENT_CREATE: 'pm-content.create',
  PM_CONTENT_GET: 'pm-content.get',
  PM_CONTENT_UPDATE: 'pm-content.update',

  // ai-extraction capability(V1 web-bridge AI 自动化 → V2 抽 capability 层;原 ai-conversation)
  // 4 invoke + 3 push = 7 channel-names
  AI_ASK: 'ai.ask',                                 // renderer → main:askAI(serviceId, prompt, opts?)
  AI_PASTE_AND_SEND: 'ai.paste-and-send',           // renderer → main:只 paste + send 不等回复(Phase 6 问 AI 路径)
  AI_GET_LATEST_RESPONSE: 'ai.get-latest-response', // renderer → main:取 SSE 缓存最新一次回复(提取按钮用)
  AI_EXTRACT_FULL: 'ai.extract-full',               // renderer → main:整页对话提取(多 turn + artifact + 图片)
  AI_OPEN_SESSION: 'ai.open-session',               // renderer → main:把后台 webview 转前台 (AI View Host 用,本期占位)
  AI_SERVICE_LIST: 'ai.service-list',               // renderer → main:取三服务清单(可直接读 ai-service-types,留作扩展)
  AI_SSE_STATUS: 'ai.sse-status',                   // renderer → main:debug 用
  AI_RESPONSE_STREAM: 'ai.response-stream',         // main → renderer 推送流式增量(本期仅 Claude)
  AI_RESPONSE_READY: 'ai.response-ready',           // main → renderer 推送完成
  AI_ERROR: 'ai.error',                             // main → renderer 推送错误

  // ai-sync feature(AI 回复 → 右槽 Note 末尾自动追加 ❓ Callout + 🔀 Toggle)
  // renderer 侧 ai-sync-integration 在"左 ai-view + 右 note-view"槽组合下 start;
  // main 端 ai-sync-orchestrator 轮询 SSECaptureManager 检测完成跃迁,emit turn。
  AI_SYNC_START: 'ai-sync.start',                   // renderer → main:启动 ai-sync(serviceId)
  AI_SYNC_STOP: 'ai-sync.stop',                     // renderer → main:停止 ai-sync(serviceId)
  AI_SYNC_APPEND_TURN: 'ai-sync.append-turn',       // main → renderer 推送一个新完成的 turn

  // Progress 反馈通道(backup-restore + 未来其他长耗时任务共用)
  PROGRESS_START: 'progress.start',                 // main → renderer:任务开始
  PROGRESS_UPDATE: 'progress.update',               // main → renderer:阶段/百分比更新
  PROGRESS_DONE: 'progress.done',                   // main → renderer:任务结束(success/error)
  // renderer → main:让 renderer 端长任务(import 解析/切割)也能驱动同一 overlay。
  // main 收到后原样回推 PROGRESS_START/UPDATE/DONE 到本窗口,复用 GlobalProgressOverlay。
  PROGRESS_DRIVE: 'progress.drive',                 // renderer → main:驱动进度事件
} as const;

export type IpcChannelName = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
