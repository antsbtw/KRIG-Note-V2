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
  EBOOK_THOUGHT_ANNOTATIONS: 'ebook.thought-annotations',       // getReadingThoughtAnnotations

  // L5-C6:PDF 提取 → Note(KRIG Knowledge Platform 集成)
  EXTRACTION_UPLOAD: 'extraction.upload',           // renderer → main:上传当前 PDF → 返 md5
  EXTRACTION_IMPORT: 'extraction.import',           // renderer → main:主动触发 import(备用入口)
  EXTRACTION_NOTE_CREATE: 'extraction.note-create', // main → renderer 推送:请 view 端创建 note

  // L7-sub2:note + folder capability (decision 012,SurrealDB Sidecar)
  // 业务粒度 IPC + LIST_CHANGED 广播,对齐 ebook / graph 模式
  NOTE_CREATE: 'note.create',
  NOTE_LIST: 'note.list',
  NOTE_GET: 'note.get',
  NOTE_UPDATE: 'note.update',
  NOTE_MOVE: 'note.move',
  NOTE_DELETE: 'note.delete',
  NOTE_LIST_CHANGED: 'note.list-changed',           // main → renderer 推送

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
} as const;

export type IpcChannelName = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
