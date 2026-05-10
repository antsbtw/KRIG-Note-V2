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

  // L5-C1:ebook 书架 + 文件夹(D-3=B JSON 实现,过渡至 W6 升 SurrealDB)
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
  // 文件夹
  EBOOK_FOLDER_LIST: 'ebook.folder-list',
  EBOOK_FOLDER_CREATE: 'ebook.folder-create',
  EBOOK_FOLDER_RENAME: 'ebook.folder-rename',
  EBOOK_FOLDER_DELETE: 'ebook.folder-delete',
  EBOOK_FOLDER_MOVE: 'ebook.folder-move',
  // 数据传输
  EBOOK_GET_DATA: 'ebook.get-data',
  EBOOK_LOADED: 'ebook.loaded',                                 // main → renderer 推送
  EBOOK_CLOSE: 'ebook.close',
  // 进度 + 书签 + 标注(C1 仅占位 channel,C2~C5 各段消费)
  EBOOK_SAVE_PROGRESS: 'ebook.save-progress',
  EBOOK_BOOKMARK_TOGGLE: 'ebook.bookmark-toggle',
  EBOOK_BOOKMARK_LIST: 'ebook.bookmark-list',
  EBOOK_CFI_BOOKMARK_ADD: 'ebook.cfi-bookmark-add',
  EBOOK_CFI_BOOKMARK_REMOVE: 'ebook.cfi-bookmark-remove',
  EBOOK_CFI_BOOKMARK_LIST: 'ebook.cfi-bookmark-list',
  EBOOK_ANNOTATION_LIST: 'ebook.annotation-list',
  EBOOK_ANNOTATION_ADD: 'ebook.annotation-add',
  EBOOK_ANNOTATION_REMOVE: 'ebook.annotation-remove',

  // L5-C6:PDF 提取 → Note(KRIG Knowledge Platform 集成)
  EXTRACTION_UPLOAD: 'extraction.upload',           // renderer → main:上传当前 PDF → 返 md5
  EXTRACTION_IMPORT: 'extraction.import',           // renderer → main:主动触发 import(备用入口)
  EXTRACTION_NOTE_CREATE: 'extraction.note-create', // main → renderer 推送:请 view 端创建 note

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
} as const;

export type IpcChannelName = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
