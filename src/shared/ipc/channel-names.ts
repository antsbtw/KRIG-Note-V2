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
  // 多窗口:主进程在窗口就绪后 push 本窗口绑定的 wsId(main → renderer,一次性)
  WINDOW_WS_ID:         'window.ws-id',          // main → renderer push（deprecated path）
  WINDOW_GET_WS_ID:     'window.get-ws-id',       // renderer → main invoke → returns wsId

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

  // 网页剪藏(Defuddle → Note):右键「📥 提取到笔记」→ main 跑 captureFullPage →
  // FullPageResult 推回 renderer,由 content-extraction 门面订阅后跑 import-pipeline。
  WEB_CLIP_RESULT: 'web.clip-result',                 // main → renderer 推送

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
  // 下载持久化(收尾):done 终态落盘 JSON,NavSide 下载段显历史。
  WEB_DOWNLOAD_LIST: 'web.download-list',            // renderer → main invoke(取全量历史)
  WEB_DOWNLOAD_REMOVE: 'web.download-remove',        // renderer → main invoke(删一条记录,不删磁盘文件)
  WEB_DOWNLOAD_HISTORY_CHANGED: 'web.download-history-changed', // main → renderer 推送(历史变更广播)

  // per-ws 代理:给某 ws 的 partition(persist:webview-${wsId})session 设代理出口。
  // 阶段2 升级:入参改 { workspaceId, proxyId };主进程查节点表 resolveRules 后 setProxy。
  WEB_SET_PROXY: 'web.set-proxy',                    // renderer → main invoke({ workspaceId, proxyId })
  // per-ws 代理阶段2:全局代理节点表 CRUD(阶段3 UI 复用;阶段2 console 塞测试节点)。
  WEB_PROXY_LIST: 'web.proxy-list',                  // renderer → main invoke → ProxyNode[]
  WEB_PROXY_ADD: 'web.proxy-add',                    // renderer → main invoke({ name, type, host }) → ProxyNode
  WEB_PROXY_REMOVE: 'web.proxy-remove',              // renderer → main invoke({ id })
  // per-ws 代理阶段3:Web 全局设置(搜索引擎 / 默认主页)+ 清浏览数据。
  WEB_SETTINGS_GET: 'web.settings-get',              // renderer → main invoke → WebGlobalSettings
  WEB_SETTINGS_UPDATE: 'web.settings-update',        // renderer → main invoke(Partial<WebGlobalSettings>) → WebGlobalSettings
  WEB_CLEAR_STORAGE_DATA: 'web.clear-storage-data',  // renderer → main invoke({ workspaceId })

  // L5-B4.3.1:Media 存储(base64 / 远程下载 → media:// URL)
  MEDIA_PUT_BASE64: 'media.put-base64',
  MEDIA_DOWNLOAD: 'media.download',
  // L5-B3.14:media:// URL → 本地路径解析(file-block / file-link / external-ref 打开/Finder 显示用)
  MEDIA_RESOLVE_PATH: 'media.resolve-path',

  // L5-G7b:系统字体记名方案(只记 family 名,本机渲染 / 导出按名实时读 buffer,不嵌入)
  FONT_LIST_SYSTEM: 'font.list-system',   // renderer → main invoke → SystemFontEntry[](扫本机系统字体)
  FONT_READ_BY_NAME: 'font.read-by-name', // renderer → main invoke(family) → ArrayBuffer | null(按名读字体,没装回 null → 渲染层回退打包)

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

  // web view 书签(书签步骤1 数据层:bookmark atom + inFolder 边挂 folder viewType='web')
  BOOKMARK_LIST: 'bookmark.list',
  BOOKMARK_ADD: 'bookmark.add',
  BOOKMARK_RENAME: 'bookmark.rename',
  BOOKMARK_REMOVE: 'bookmark.remove',
  BOOKMARK_MOVE: 'bookmark.move',
  BOOKMARK_LIST_CHANGED: 'bookmark.list-changed',               // main → renderer 推送

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
  // Phase 1 多窗口 merge:轻量版本查询(renderer 保存前拉取当前 docVersion/docHash/blockHashes)
  NOTE_GET_VERSION_INFO: 'note.get-version-info',   // renderer → main invoke → { docVersion, docHash, blockHashes } | null
  // Phase 1 多窗口 merge:写成功后广播新 blockHashes 给其他窗口更新基线
  NOTE_BASE_SNAPSHOT_UPDATED: 'note.base-snapshot-updated', // main → renderer 推送

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
  // ── diglot mind(方案 B1:独立表/独立 store,共用 graph 文件夹)──
  MIND_LIST: 'mind.list',
  MIND_LOAD: 'mind.load',
  MIND_CREATE: 'mind.create',
  MIND_SAVE: 'mind.save',
  MIND_DELETE: 'mind.delete',
  MIND_RENAME: 'mind.rename',
  MIND_MOVE_TO_FOLDER: 'mind.move-to-folder',
  MIND_DUPLICATE: 'mind.duplicate',
  MIND_LIST_CHANGED: 'mind.list-changed',           // main → renderer 推送

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
  AI_EXTRACT_TURN: 'ai.extract-turn',               // renderer → main:按坐标定位 + 抽单条对话(右键提取,本期仅 Claude)
  AI_EXTRACT_TURN_REQUEST: 'ai.extract-turn-request', // main → renderer 推送:原生右键菜单点击,带 guest viewport 坐标 {x,y}
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

  // X(Twitter)集成(阶段 0/1)— X = AI view「左 note / 右 slot」模式里的一个新服务,
  // 复用 web-service-base 底座,走独立 X 代码路径(铁律 1/3)。
  X_EXTRACT_TWEET: 'x.extract-tweet',               // renderer → main:按坐标定位 + 抽该条推文(返 tweet 字段)
  X_EXTRACT_TWEET_REQUEST: 'x.extract-tweet-request', // main → renderer 推送:X webview 原生右键点击,带 guest 坐标 {x,y}
  X_OPEN_TWEET_REQUEST: 'x.open-tweet-request',      // main → renderer 推送:宿主页内 iframe(tweet block 嵌入)弹 x.com 链接,改在 X webview 打开
  // X 集成 阶段 2(写方向)— 注入「填充内容,用户点发布」(绝不程序点发布)
  X_PASTE_TWEET: 'x.paste-tweet',                   // renderer → main:把纯文本填进 X compose 框(发推)
  X_PASTE_REPLY: 'x.paste-reply',                   // renderer → main:导航到目标推 + 把纯文本填进 reply 框(回复)
  X_DRIVE_ARTICLE: 'x.drive-article',               // renderer → main:驱动 X 原生 Insert 发长文(终态,2026-06-13;只插内容绝不点 Publish)
  X_PLAN_CACHE_DUMP: 'x-plan-cache.dump',           // renderer → main:发布中间态(ArticlePlan+渲图结果)落盘缓存,fire-and-forget,诊断用
  X_TEST_DRIVE_STEP: 'x.test-drive-step',           // renderer → main:逐块底层测试(独立驱动一个块 + 验证完整落定),dev 用
  // 拖拽落点(拖 note block 到 X)— renderer → main
  X_DRAG_ARM: 'x.drag-arm',                          // note 拖起:往 X guest 装 mousemove 监听记录最后坐标
  X_DRAG_RESOLVE: 'x.drag-resolve',                  // 松手:读回最后坐标 + 解析落点(compose/tweet/...)
  X_DRAG_REPLY_HERE: 'x.drag-reply-here',            // 落推文:就地点该推回复按钮弹 reply 框(不跳详情页)

  // 邮箱模块(阶段 0:webview 薄壳)— 内嵌网页版邮箱 + 右键提取单封邮件到 note。
  // 数据层(IMAP/SMTP → SurrealDB)是阶段 1,不走这些通道。
  // 见 docs/10-business-design/mail/module-design.md
  MAIL_EXTRACT: 'mail.extract',                     // renderer → main:按坐标定位 + 抽该封邮件(返主题/正文/发件人)
  MAIL_EXTRACT_REQUEST: 'mail.extract-request',     // main → renderer 推送:邮箱 webview 原生右键点击,带 guest 坐标 {x,y}
  // 邮箱 阶段 1(IMAP 只读同步)— 账号配置 + 拉信落库
  MAIL_ACCOUNT_LIST: 'mail.account-list',           // renderer → main:列出本 ws 的账号
  MAIL_ACCOUNT_CREATE: 'mail.account-create',       // renderer → main:新建账号(密码走 safeStorage,不入 DB)
  MAIL_ACCOUNT_DELETE: 'mail.account-delete',       // renderer → main:删账号(连带清密码/邮件/游标)
  MAIL_ACCOUNT_TEST: 'mail.account-test',           // renderer → main:测试连接 + 列 mailbox
  MAIL_ACCOUNT_SET_PASSWORD: 'mail.account-set-password', // renderer → main:改密码(safeStorage 覆写,不动 DB)
  MAIL_SYNC: 'mail.sync',                           // renderer → main:同步一个 mailbox(增量)
  MAIL_LIST: 'mail.list',                           // renderer → main:列邮件(按日期倒序,分页)
  MAIL_GET: 'mail.get',                             // renderer → main:取单封全文

  // Progress 反馈通道(backup-restore + 未来其他长耗时任务共用)
  PROGRESS_START: 'progress.start',                 // main → renderer:任务开始
  PROGRESS_UPDATE: 'progress.update',               // main → renderer:阶段/百分比更新
  PROGRESS_DONE: 'progress.done',                   // main → renderer:任务结束(success/error)
  // renderer → main:让 renderer 端长任务(import 解析/切割)也能驱动同一 overlay。
  // main 收到后原样回推 PROGRESS_START/UPDATE/DONE 到本窗口,复用 GlobalProgressOverlay。
  PROGRESS_DRIVE: 'progress.drive',                 // renderer → main:驱动进度事件

  // 账号登录 + 归因(本期不做授权)— authorization-management-design.md
  // 邮箱注册两步:先 AUTH_SEND_CODE 拿 6 位码,再 AUTH_REGISTER 带 code。
  // device 嵌套对象 + app_source 顶层由主进程补;token 只在主进程,renderer 拿 public state。
  AUTH_GET_STATE: 'auth.get-state',                 // renderer → main:拿当前 public 状态(不含 token)
  AUTH_SEND_CODE: 'auth.send-code',                 // renderer → main:发邮箱验证码(POST /auth/code,purpose=register)
  AUTH_REGISTER: 'auth.register',                   // renderer → main:注册(email+password+code)
  AUTH_LOGIN: 'auth.login',                         // renderer → main:登录(老用户,email+password)
  AUTH_LOGOUT: 'auth.logout',                       // renderer → main:登出 + 清本地 token
  AUTH_REFRESH: 'auth.refresh',                     // renderer → main:刷 token(轮换;启动/恢复前台)
  AUTH_CHANGED: 'auth.changed',                     // main → renderer 广播:登录态变化(多 ws 扇出守卫)

  // ── Window Profile IPC ──
  // renderer → main invoke
  PROFILE_LIST:   'profile.list',    // → Profile[]
  PROFILE_GET:    'profile.get',     // (id) → Profile | null
  PROFILE_CREATE: 'profile.create',  // (input) → Profile
  PROFILE_UPDATE: 'profile.update',  // (id, patch) → Profile | null
  PROFILE_DELETE: 'profile.delete',  // (id) → void
  // main → renderer 广播（create/update/delete 后）
  PROFILE_LIST_CHANGED: 'profile.list-changed',

  // X 时间线智能筛选（Phase 1 + Phase 2）— 搜索配方驱动采集 + AI 判断 + Review Queue
  X_RUN_RECIPE:      'x:run-recipe',       // renderer → main invoke：手动触发指定配方（recipeId + wsId）
  X_SCAN_PAUSE:      'x:scan-pause',       // renderer → main invoke：暂停指定 ws 扫描（Phase 2: 改为 invoke + wsId）
  X_AI_JUDGE_BATCH:  'x:ai-judge-batch',  // renderer → main invoke / main 内部触发批判断
  X_INBOX_QUERY:     'x:inbox-query',      // renderer → main invoke：查询 tweet_inbox（支持 wsId 过滤）
  X_INBOX_COUNTS:    'x:inbox-counts',     // renderer → main invoke：批量数各视图条数（侧栏徽章，只回整数不回行）
  X_LIST_RECIPES:    'x:list-recipes',     // renderer → main invoke：取所有配方
  X_REPLY_TWEET:     'x:reply-tweet',      // renderer → main invoke：导航 X webview 到目标推文（wsId + tweetUrl）
  X_PLAN_REPLIES:    'x:plan-replies',     // renderer → main invoke：给一批推文规划回复草稿（只产草稿，不发布）
  X_REPLAY_REPLIES:  'x:replay-replies',   // renderer → main invoke：拿历史标注样本回放规划器（只算不发，不写库）
  X_REPLY_FEEDBACK:  'x:reply-feedback',   // renderer → main invoke：记学习期反馈（AI 原文 vs 用户改成什么）
  X_REPLY_READINESS: 'x:reply-readiness',  // renderer → main invoke：分语言原样通过率（放手自动的判据）
  X_WATCHLIST:       'x:watchlist',        // renderer → main invoke：追踪名单增删查（≠ X 的关注）
  X_PREFETCH_CONTEXT: 'x:prefetch-context',   // renderer → main invoke：给建议名单批量预抓上文
  X_PREFETCH_PROFILES: 'x:prefetch-profiles', // renderer → main invoke：给建议名单批量预采画像
  // ⭐ 产品事实清单 —— 用户要能随时改口径(2026-09-26)
  X_GET_PRODUCT_FACTS: 'x:get-product-facts',   // renderer → main invoke：读当前口径
  X_SAVE_PRODUCT_FACTS: 'x:save-product-facts', // renderer → main invoke：存新口径
  // ⭐ 回看草稿并点评 —— 已发送的也能回头改（用户 2026-09-26 的「迭代」）
  X_LIST_DRAFTS: 'x:list-drafts',     // renderer → main invoke：回看草稿（含已处置的）
  X_REVIEW_DRAFT: 'x:review-draft',   // renderer → main invoke：补/改点评
  X_PLAN_ONE_REPLY:  'x:plan-one-reply',   // renderer → main invoke：为单条推文现写回复（卡片弹窗用）
  X_GET_ACTIVE_WC:   'x:get-active-wc',   // renderer → main invoke：取指定 ws 当前活跃 wcId
  X_INVALIDATE_WC:   'x:invalidate-wc',   // renderer → main：强制 guest 全量重绘(见 x-timeline-handlers)
  X_SUBMIT_FEEDBACK: 'x:submit-feedback', // renderer → main invoke：写入人工 verdict
  X_QUERY_FEEDBACK:  'x:query-feedback',  // renderer → main invoke：查询 feedback 样本（Phase 3b 用）
  X_UPSERT_RECIPE:   'x:upsert-recipe',   // renderer → main invoke：新建或更新配方
  X_DELETE_RECIPE:   'x:delete-recipe',   // renderer → main invoke：删除配方
  X_GET_RECIPE_STATS:'x:get-recipe-stats',// renderer → main invoke：查配方采纳率统计
  X_FEEDBACK_STATS:  'x:feedback-stats',  // renderer → main invoke：近7天 Gemma建议采纳率/捞回漏判数
  X_MARK_REPLIED:    'x:mark-replied',    // renderer → main invoke：标记推文已回复（已确认视图清场）
  // 屏蔽名单（B 期）—— 屏蔽只约束未来采集，不抹除已抓的历史数据
  X_BLOCK_AUTHOR:    'x:block-author',    // renderer → main invoke：屏蔽某作者（handle）
  X_UNBLOCK_AUTHOR:  'x:unblock-author',  // renderer → main invoke：解除屏蔽（handle）
  X_LIST_BLOCKED:    'x:list-blocked',    // renderer → main invoke：取屏蔽名单
  // per-ws 角色配置（活动契约）—— 用户自己在 UI 里设定，不由代码写死
  X_GET_WS_ROLES:    'x:get-ws-roles',    // renderer → main invoke：列出所有 ws 角色
  X_SET_WS_ROLE:     'x:set-ws-role',     // renderer → main invoke：设定某 ws 的角色/文章/触发口
  X_LIST_ARTICLES:   'x:list-articles',   // renderer → main invoke：探测本账号的 Article 供下拉选
  X_FETCH_ARTICLE_REPLIES: 'x:fetch-article-replies', // renderer → main invoke：试抓一篇文章的回复
  X_HARVEST_NOTIFICATIONS: 'x:harvest-notifications', // renderer → main invoke：抓通知页(谁赞/转/回了我)
  X_CAMPAIGN_STATUS:       'x:campaign-status',       // renderer → main invoke：契约配置与服务状态
  X_DETECT_SELF:     'x:detect-self',     // renderer → main invoke：探测当前登录的 X 账号并标记 is_self
  X_GET_SELF:        'x:get-self',        // renderer → main invoke：取已标记的「我自己」handle
  X_WATCHLIST_SPIKE: 'x:watchlist-spike', // renderer → main invoke：B' 期一次性诊断（搜索语法/回复判定实机对照）
  X_PAYLOAD_SURVEY:  'x:payload-survey', // renderer → main invoke：勘查 X GraphQL 原始载荷字段（能力边界的真实依据）
  X_COLLECT_REPLIES: 'x:collect-replies', // renderer → main invoke：采集回复关系并回填 replied
  X_HARVEST:         'x:harvest',        // renderer → main invoke：通用时间线采集（滚到底 + 自校验）
  X_CAPTURE_START:   'x:capture-start',  // renderer → main invoke：开始被动监视采集
  X_CAPTURE_STOP:    'x:capture-stop',   // renderer → main invoke：停止监视并取最终统计
  X_CAPTURE_UPDATE:  'x:capture-update', // main → renderer 广播：实时采集快照
  X_FETCH_PROFILE:   'x:fetch-profile',  // renderer → main invoke：抓单个账号画像（盯人面板的 bio 卡片）

  // ── Web 能力层控制台(dev-only)—— 逐个原子能力单独跑、看原样返回值 ──
  // ⚠️ 刻意**一能力一通道**,不做「求值任意脚本」的万能通道:
  //    那等于把 web.dom 费力关掉的注入口重新打开。
  WEBC_READY:        'webc:ready',         // 控制:等页面到位
  WEBC_SCROLL_UNTIL: 'webc:scroll-until',  // 控制:滚动直到判据
  WEBC_TAP:          'webc:tap',           // 控制:点一个锚点
  WEBC_PRESS:        'webc:press',         // 控制:按一个键
  WEBC_HOVER:        'webc:hover',         // 控制:悬停
  WEBC_TYPE:         'webc:type',          // 输入:往锚点填文本(含落地确认)
  WEBC_PAGES:        'webc:pages',         // 输出:页面清单(对照屏幕数行数)
  WEBC_ANCHORS:      'webc:anchors',       // 输出:已注册锚点表
  WEBC_READ_TABBAR:  'webc:read-tabbar',   // 输出:真页面上读 X 左栏 tab 的 testid
  WEBC_TRACE:        'webc:trace',         // 输出:读回诊断留痕(内存 + 磁盘两份,对不上说明落盘坏了)
  WEBC_GOTO:         'webc:goto',          // 控制:语义导航(名字 → URL → 导航 → 等到位)
  WEBC_PAGE_NAMES:   'webc:page-names',    // 输出:已注册的语义页面名(下拉用真表,不抄一份)
  // ── 执行:第四类能力(对象=模型,不是页面)──
  // ⚠️ 执行者**不写库**,所以面板上跑它是安全的 —— 这正是它与 judgeWithOllama 的分界:
  //    后者一跑就改你的数据,前者只算不存,落库是编排的事。
  WEBC_EXECUTE:      'webc:execute',       // 执行:跑一次判断(判据/素材/执行者都由面板给)
  WEBC_INVENTORY:    'webc:inventory',     // 执行:卷宗盘点(附件实际能取到多少 —— 只读不写)
  WEBC_READ_VERIFIED:'webc:read-verified', // 输出:真页面上量蓝V徽章的 DOM 结构(不猜 selector)
  WEBC_PROBE_MEMORY: 'webc:probe-memory',  // 输出:探 X 页面内存里的 user 数据在哪个全局变量下
  WEBC_AUTO_COLLECT: 'webc:auto-collect',  // 执行:无人工采集(导航+滚动+载荷解析+入库,不用人点)
  // 执行:停止正在跑的采集(协作式 —— 循环到下一个检查点自己退出,已采到的照常入库+留痕)
  WEBC_STOP_COLLECT: 'webc:stop-collect',
  // 执行:跑一份编排档(四步串起来,每步落 flow_step_run)
  /** ⚠️ WEBC_RUN_FLOW 已随「跑编排」一并摘掉(2026-09-29)——
   * 通道声明了却没 handler = 点下去必 reject,守卫盯着这条。 */
  // main → renderer 广播:编排每一步的实时状态(⚠️ 带 wsId,接收方必须核对)
  WEBC_FLOW_PROGRESS: 'webc:flow-progress',
  WEBC_WHERE_AM_I:   'webc:where-am-i',    // 输出:当前页面是哪个语义页面 + 参数(右边自动填充用)
  // 通知实时监听（给人核对用：来了什么、解成了什么、算不算这篇文章的）
  X_NOTIF_WATCH_START:  'x:notif-watch-start',
  X_NOTIF_WATCH_STOP:   'x:notif-watch-stop',
  X_NOTIF_WATCH_UPDATE: 'x:notif-watch-update', // main → renderer 广播
  X_HARVEST_PROGRESS:'x:harvest-progress',// main → renderer 广播：全量采集进度（长任务不能是黑箱）

  // 系统主题（nativeTheme）— main → renderer 广播
  NATIVE_THEME_CHANGED: 'native-theme.changed',  // main → renderer: { dark: boolean }
  NATIVE_THEME_GET: 'native-theme.get',           // renderer → main invoke: returns { dark: boolean }

  // ── Workspace 楼长 IPC（S3-a，多窗口）──
  // renderer → main（invoke，请求-响应）
  WORKSPACE_CREATE:        'workspace.create',
  WORKSPACE_CLOSE:         'workspace.close',
  WORKSPACE_REMOVE:        'workspace.remove',
  WORKSPACE_OPEN:          'workspace.open',
  WORKSPACE_RENAME:        'workspace.rename',
  WORKSPACE_SET_ACTIVE:    'workspace.set-active',
  WORKSPACE_GET_STATE:     'workspace.get-state',
  WORKSPACE_SET_CONFIG:    'workspace.set-config',   // renderer → main invoke(wsId, config)
  WORKSPACE_PERSIST_STATE: 'workspace.persist-state', // renderer → main send(wsId, patch) 回写布局+pluginStates
  // main → renderer（on，广播）
  WORKSPACE_STATE_CHANGED: 'workspace.state-changed',
} as const;

export type IpcChannelName = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
