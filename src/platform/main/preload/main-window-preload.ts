/**
 * 主窗口 preload 脚本
 *
 * L2 阶段引入:让 renderer 通过 window.electronAPI 调用 IPC。
 * 当前仅暴露:
 * - reportAlive(payload):诊断上报
 * - health(layer):健康检查查询
 *
 * 后续阶段按需扩展。
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type {
  DiagnosticsReportPayload,
  HealthCheckResponse,
} from '@shared/ipc/message-types';
import type {
  ProgressStartPayload,
  ProgressUpdatePayload,
  ProgressDonePayload,
  ProgressDrivePayload,
} from '@shared/ipc/backup-types';
import type { FolderViewType } from '@capabilities/folder/types';
import type { XPlanCacheEnvelope } from '@shared/ipc/x-types';
import type {
  AuthState,
  AuthSendCodeInput,
  AuthRegisterInput,
  AuthLoginInput,
  AuthActionResult,
} from '@shared/auth/auth-types';

contextBridge.exposeInMainWorld('electronAPI', {
  /** 诊断上报(renderer → main) */
  reportAlive(payload: DiagnosticsReportPayload): void {
    ipcRenderer.send(IPC_CHANNELS.DIAGNOSTICS_REPORT_ALIVE, payload);
  },

  /** 健康检查查询(renderer → main → 同步返回) */
  async health(
    layer: 'L0' | 'L1' | 'L2' | 'L3' | 'L3.5' | 'L4' | 'L5' | 'platform',
  ): Promise<HealthCheckResponse> {
    const channel = {
      L0: IPC_CHANNELS.HEALTH_L0,
      L1: IPC_CHANNELS.HEALTH_L1,
      L2: IPC_CHANNELS.HEALTH_L2,
      L3: IPC_CHANNELS.HEALTH_L3,
      'L3.5': IPC_CHANNELS.HEALTH_L3_5,
      L4: IPC_CHANNELS.HEALTH_L4,
      L5: IPC_CHANNELS.HEALTH_L5,
      platform: IPC_CHANNELS.HEALTH_PLATFORM,
    }[layer];
    return ipcRenderer.invoke(channel);
  },

  /** 订阅窗口全屏状态变化 — 返回取消订阅函数 */
  onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void {
    const handler = (_event: unknown, isFullscreen: boolean) => callback(isFullscreen);
    ipcRenderer.on(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, handler);
  },

  /** L5-B3.4:打开外部 URL(http/https/mailto)— 走 Electron shell.openExternal */
  async openExternal(url: string): Promise<{ ok: boolean; reason?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url);
  },

  /** L5-B3.4:打开文件路径(系统默认应用)— 走 Electron shell.openPath */
  async openPath(filePath: string): Promise<{ ok: boolean; reason?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_PATH, filePath);
  },

  /** L5-B4.2:fetch Google Translate element.js(main 进程取,避 CSP)*/
  async translateFetchElementJs(): Promise<string | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.WEB_TRANSLATE_FETCH_ELEMENT_JS);
  },

  /** L5-B4.2.2:重启 app(切翻译语言后让 widget 用新 lang 重新初始化)*/
  restartApp(): void {
    ipcRenderer.send(IPC_CHANNELS.APP_RESTART);
  },

  /** L5-B4.3.1:base64 → media:// URL */
  async mediaPutBase64(
    input: string,
    explicitMime?: string,
    hintedFilename?: string,
  ): Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }> {
    return ipcRenderer.invoke(
      IPC_CHANNELS.MEDIA_PUT_BASE64,
      input,
      explicitMime,
      hintedFilename,
    );
  },

  /** L5-B4.3.1:远程 URL → media:// URL */
  async mediaDownload(
    url: string,
    type: 'audio' | 'image' | 'video',
  ): Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.MEDIA_DOWNLOAD, url, type);
  },

  /** L5-B3.14:media:// URL → 本地文件系统绝对路径 */
  async mediaResolvePath(mediaUrl: string): Promise<{ success: boolean; path?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.MEDIA_RESOLVE_PATH, mediaUrl);
  },

  /** L5-G7.1:扫本机系统字体(可选字体清单,.ttc 已展开子字体) */
  async fontListSystem(): Promise<{
    success: boolean;
    error?: string;
    fonts: Array<{
      family: string;
      style: string;
      path: string;
      fontIndex: number;
      format: 'ttf' | 'otf' | 'ttc';
      supported: boolean;
    }>;
  }> {
    return ipcRenderer.invoke(IPC_CHANNELS.FONT_LIST_SYSTEM);
  },

  /** L5-B3.14:在 Finder 高亮显示文件 */
  async showItemInFolder(filePath: string): Promise<{ ok: boolean; reason?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER, filePath);
  },

  /**
   * L5-B3.14:File 对象 → 绝对路径(同步)
   *
   * Electron 32+ 不再暴露 File.path,必须经 webUtils.getPathForFile 取。
   * 仅 disk 来源 File 有路径(从浏览器 / Blob URL 拖入会返回空)。
   */
  getFilePath(file: File): string {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  // ── L5-B3.17:yt-dlp capability ──
  ytdlpCheckStatus(): Promise<{ installed: boolean; version?: string; path?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_CHECK_STATUS);
  },
  ytdlpInstall(): Promise<{ installed: boolean; version?: string; path?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_INSTALL);
  },
  /** 订阅 install progress — 返回取消订阅函数(对齐 onFullscreenChanged 模式)*/
  onYtdlpInstallProgress(callback: (progress: unknown) => void): () => void {
    const handler = (_event: unknown, progress: unknown): void => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.YTDLP_INSTALL_PROGRESS, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.YTDLP_INSTALL_PROGRESS, handler);
  },
  ytdlpDownload(url: string, outputPath?: string, partition?: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_DOWNLOAD, url, outputPath, partition);
  },
  onYtdlpDownloadProgress(callback: (progress: unknown) => void): () => void {
    const handler = (_event: unknown, progress: unknown): void => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.YTDLP_DOWNLOAD_PROGRESS, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.YTDLP_DOWNLOAD_PROGRESS, handler);
  },
  ytdlpGetInfo(url: string): Promise<Record<string, unknown> | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_GET_INFO, url);
  },
  ytdlpSaveSubtitle(
    videoFilePath: string,
    langCode: string,
    timestampText: string,
  ): Promise<string | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_SAVE_SUBTITLE, videoFilePath, langCode, timestampText);
  },
  // L5-B3.19.b:不下载视频抓 YouTube 字幕(沿用 V2 既有 unknown 模式 — 不反向 import capability)
  ytdlpFetchTranscript(url: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_FETCH_TRANSCRIPT, url);
  },
  // L5-B3.19.e UX:检 webview YouTube 登录 cookies(partition 可选,兜底旧 persist:webview)
  ytdlpCheckYoutubeCookies(partition?: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_CHECK_YOUTUBE_COOKIES, partition);
  },

  // ── L5-B3.18:tweet-fetcher 临时 capability ──
  fetchTweetData(tweetUrl: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.TWEET_FETCH_DATA, tweetUrl);
  },

  // ── L5-B3.20a:learning capability ──
  learningVocabAdd(
    word: string,
    definition: string,
    context?: string,
    phonetic?: string,
  ): Promise<unknown> {
    return ipcRenderer.invoke(
      IPC_CHANNELS.LEARNING_VOCAB_ADD,
      word,
      definition,
      context,
      phonetic,
    );
  },
  learningVocabRemove(id: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.LEARNING_VOCAB_REMOVE, id);
  },
  learningVocabList(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.LEARNING_VOCAB_LIST);
  },
  learningVocabHas(word: string): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.LEARNING_VOCAB_HAS, word);
  },
  /** 订阅 vocab changed — 多订阅模式,对齐 onFullscreenChanged / onYtdlpInstallProgress */
  onLearningVocabChanged(callback: (entries: unknown) => void): () => void {
    const handler = (_event: unknown, entries: unknown): void => callback(entries);
    ipcRenderer.on(IPC_CHANNELS.LEARNING_VOCAB_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.LEARNING_VOCAB_CHANGED, handler);
  },
  learningDictionaryLookup(word: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.LEARNING_LOOKUP, word);
  },
  learningTranslate(text: string, targetLang?: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.LEARNING_TRANSLATE, text, targetLang);
  },
  learningTts(text: string, lang: string): Promise<ArrayBuffer | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.LEARNING_TTS, text, lang);
  },

  // ── L5-C1:ebook 书架 + 文件夹 + 标注(D-3=B JSON 起步)──
  ebookPickFile(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_PICK_FILE);
  },
  ebookBookshelfList(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKSHELF_LIST);
  },
  ebookBookshelfAdd(
    filePath: string,
    fileType: string,
    storage: 'managed' | 'link',
  ): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKSHELF_ADD, filePath, fileType, storage);
  },
  ebookBookshelfOpen(id: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKSHELF_OPEN, id);
  },
  ebookBookshelfRemove(id: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKSHELF_REMOVE, id);
  },
  ebookBookshelfRename(id: string, displayName: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKSHELF_RENAME, id, displayName);
  },
  ebookBookshelfMove(id: string, folderId: string | null): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKSHELF_MOVE, id, folderId);
  },
  ebookBookshelfRelocate(id: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKSHELF_RELOCATE, id);
  },
  ebookBookshelfTransferToManaged(id: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKSHELF_TRANSFER, id);
  },
  /** 订阅 bookshelf changed — 多订阅模式,对齐 onLearningVocabChanged */
  onEbookBookshelfChanged(callback: (list: unknown) => void): () => void {
    const handler = (_event: unknown, list: unknown): void => callback(list);
    ipcRenderer.on(IPC_CHANNELS.EBOOK_BOOKSHELF_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.EBOOK_BOOKSHELF_CHANGED, handler);
  },
  // 文件夹: sub-phase 022 删除 5 channel bridge — view caller 改走 folder capability
  // + viewType='ebook' (决议 021 §4.3 + 决议 022 Step 5.4 commit 2 已落地)
  // 数据传输
  ebookGetData(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_GET_DATA);
  },
  ebookClose(): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_CLOSE);
  },
  /** main → renderer 推送:书已加载,view 收到后调 ebookGetData() 拿 ArrayBuffer */
  onEbookLoaded(callback: (info: unknown) => void): () => void {
    const handler = (_event: unknown, info: unknown): void => callback(info);
    ipcRenderer.on(IPC_CHANNELS.EBOOK_LOADED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.EBOOK_LOADED, handler);
  },
  // 进度 + 书签 + 标注(C1 占位,C2~C5 真消费)
  ebookSaveProgress(bookId: string, position: unknown): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_SAVE_PROGRESS, bookId, position);
  },
  ebookBookmarkToggle(bookId: string, page: number): Promise<number[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKMARK_TOGGLE, bookId, page);
  },
  ebookBookmarkList(bookId: string): Promise<number[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKMARK_LIST, bookId);
  },
  ebookCfiBookmarkAdd(bookId: string, cfi: string, label: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_CFI_BOOKMARK_ADD, bookId, cfi, label);
  },
  ebookCfiBookmarkRemove(bookId: string, cfi: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_CFI_BOOKMARK_REMOVE, bookId, cfi);
  },
  ebookCfiBookmarkList(bookId: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_CFI_BOOKMARK_LIST, bookId);
  },
  // 标注: sub-phase 022 删除 3 channel bridge — annotation 概念消亡, 改走下面 5 个
  // thought block bridge (decision 022 §4.1.4 + §0.5)

  // ── sub-phase 022:reading thought block (5 新 API bridge) ──
  ebookThoughtGet(bookId: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_THOUGHT_GET, bookId);
  },
  ebookThoughtEnsure(bookId: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_THOUGHT_ENSURE, bookId);
  },
  ebookThoughtBlockAdd(bookId: string, spec: unknown): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_THOUGHT_BLOCK_ADD, bookId, spec);
  },
  ebookThoughtBlockRemove(bookId: string, blockId: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_THOUGHT_BLOCK_REMOVE, bookId, blockId);
  },
  ebookThoughtAnnotations(bookId: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_THOUGHT_ANNOTATIONS, bookId);
  },
  // PR-α-3b:单读 block + 改单块颜色
  ebookThoughtBlockGet(bookId: string, createdAt: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EBOOK_THOUGHT_BLOCK_GET, bookId, createdAt);
  },
  ebookThoughtBlockUpdateColor(
    bookId: string,
    createdAt: number,
    color: string,
  ): Promise<void> {
    return ipcRenderer.invoke(
      IPC_CHANNELS.EBOOK_THOUGHT_BLOCK_UPDATE_COLOR,
      bookId,
      createdAt,
      color,
    );
  },

  // ── web view 书签树(书签步骤1 数据层)──
  bookmarkList(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_LIST);
  },
  bookmarkAdd(url: string, title: string, folderId: string | null): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_ADD, url, title, folderId);
  },
  bookmarkRename(id: string, title: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_RENAME, id, title);
  },
  bookmarkRemove(id: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_REMOVE, id);
  },
  bookmarkMove(id: string, folderId: string | null): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_MOVE, id, folderId);
  },
  /** 订阅书签列表变更 — 返回 unsubscribe(对齐 onEbookBookshelfChanged 模式)*/
  onBookmarkListChanged(callback: (list: unknown) => void): () => void {
    const handler = (_event: unknown, list: unknown): void => callback(list);
    ipcRenderer.on(IPC_CHANNELS.BOOKMARK_LIST_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.BOOKMARK_LIST_CHANGED, handler);
  },

  // ── L5-C6:PDF 提取 → Note ──
  /** 上传当前打开的 PDF 到 Platform → 返 md5 + platformUrl(view 拿后 bus.openRight)*/
  extractionUpload(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EXTRACTION_UPLOAD);
  },
  /** 主动触发 import(备用 / 测试入口);主路径走 console-message 监听 */
  extractionImport(data: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.EXTRACTION_IMPORT, data);
  },
  /** 订阅 main 推送 — 拦截到的 atom JSON,view 端接收后转 PM 创建 note */
  onExtractionNoteCreate(callback: (data: unknown) => void): () => void {
    const handler = (_event: unknown, data: unknown): void => callback(data);
    ipcRenderer.on(IPC_CHANNELS.EXTRACTION_NOTE_CREATE, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.EXTRACTION_NOTE_CREATE, handler);
  },

  /** 订阅 main 推送 — web view 原生右键菜单的查词/翻译项点击(view 端调 learning capability)*/
  onWebContextMenuAction(
    callback: (payload: { action: 'lookup' | 'translate'; text: string }) => void,
  ): () => void {
    const handler = (
      _event: unknown,
      payload: { action: 'lookup' | 'translate'; text: string },
    ): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.WEB_CONTEXT_MENU_ACTION, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.WEB_CONTEXT_MENU_ACTION, handler);
  },

  /** 订阅 main 推送 — 网页剪藏结果(右键「📥 提取到笔记」→ main 抓页后推回 FullPageResult)*/
  onWebClipResult(callback: (payload: unknown) => void): () => void {
    const handler = (_event: unknown, payload: unknown): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.WEB_CLIP_RESULT, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.WEB_CLIP_RESULT, handler);
  },

  /** 订阅 main 推送 — web view 快捷键(webview 焦点下主进程 before-input-event 拦截后回推）*/
  onWebViewShortcut(callback: (payload: { action: string }) => void): () => void {
    const handler = (_event: unknown, payload: { action: string }): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.WEB_VIEW_SHORTCUT, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.WEB_VIEW_SHORTCUT, handler);
  },

  /** 订阅 main 推送 — webview 内 target=_blank 弹窗导流(view 端在 web view 新建 tab 打开)*/
  onWebNewTab(callback: (payload: { url: string }) => void): () => void {
    const handler = (_event: unknown, payload: { url: string }): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.WEB_NEW_TAB, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.WEB_NEW_TAB, handler);
  },

  /** 订阅 main 推送 — web view 下载事件(started/progress/done),下载条 UI 用 */
  onWebDownloadEvent(
    callback: (payload: {
      type: 'started' | 'progress' | 'done';
      id: number;
      filename: string;
      url?: string;
      received?: number;
      total?: number;
      state?: string;
      savePath?: string;
    }) => void,
  ): () => void {
    const handler = (
      _event: unknown,
      payload: {
        type: 'started' | 'progress' | 'done';
        id: number;
        filename: string;
        url?: string;
        received?: number;
        total?: number;
        state?: string;
        savePath?: string;
      },
    ): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.WEB_DOWNLOAD_EVENT, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.WEB_DOWNLOAD_EVENT, handler);
  },

  /** web view 下载操作(取消)— renderer → main invoke */
  async webDownloadAction(payload: { id: number; action: 'cancel' }): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNELS.WEB_DOWNLOAD_ACTION, payload);
  },

  /**
   * per-ws 代理阶段2:给某 ws 的 partition session 设代理。renderer 只传 proxyId,
   * 主进程查全局节点表解析 rules 后 setProxy。proxyId 空/undefined → 直连。
   */
  async setWebProxy(args: { workspaceId: string; proxyId?: string }): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNELS.WEB_SET_PROXY, args);
  },

  // ── per-ws 代理阶段2:全局代理节点表 CRUD(阶段3 UI 复用)──
  /** 全量代理节点(按 createdAt 升序)*/
  listProxyNodes(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.WEB_PROXY_LIST);
  },
  /** 加代理节点 — 主进程生成 id + createdAt,返回新 node */
  addProxyNode(args: { name: string; type: 'socks5' | 'http' | 'direct'; host: string }): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.WEB_PROXY_ADD, args);
  },
  /** 删代理节点(by id)*/
  removeProxyNode(id: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.WEB_PROXY_REMOVE, { id });
  },

  // ── per-ws 代理阶段3:Web 全局设置(搜索/主页)+ 清浏览数据 ──
  /** 取全局设置(renderer 启动缓存初始化用)*/
  getWebSettings(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.WEB_SETTINGS_GET);
  },
  /** 更新全局设置 — 合并 patch 后返回全量 */
  updateWebSettings(patch: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.WEB_SETTINGS_UPDATE, patch);
  },
  /** 清某 ws partition 的浏览数据(cookies/缓存/localStorage 等)*/
  async clearWebStorageData(args: { workspaceId: string }): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNELS.WEB_CLEAR_STORAGE_DATA, args);
  },

  /** 取下载历史全量(终态记录)— renderer → main invoke */
  async webDownloadList(): Promise<WebDownloadHistoryEntry[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.WEB_DOWNLOAD_LIST);
  },

  /** 删一条下载历史记录(仅删 JSON 记录,不删磁盘文件)— renderer → main invoke */
  async webDownloadRemove(id: string): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNELS.WEB_DOWNLOAD_REMOVE, id);
  },

  /** 订阅 main 推送 — 下载历史变更(落盘/删记录后),NavSide 下载段刷新 */
  onWebDownloadHistoryChanged(
    callback: (entries: WebDownloadHistoryEntry[]) => void,
  ): () => void {
    const handler = (_event: unknown, entries: WebDownloadHistoryEntry[]): void =>
      callback(entries);
    ipcRenderer.on(IPC_CHANNELS.WEB_DOWNLOAD_HISTORY_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.WEB_DOWNLOAD_HISTORY_CHANGED, handler);
  },

  /** 订阅 main 推送 — 用户已选好且扫好的 markdown 文件批,view 端转 PM + 落 note */
  onMarkdownImportRun(callback: (data: unknown) => void): () => void {
    const handler = (_event: unknown, data: unknown): void => callback(data);
    ipcRenderer.on(IPC_CHANNELS.MARKDOWN_IMPORT_RUN, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.MARKDOWN_IMPORT_RUN, handler);
  },

  /** 诊断落盘(2026-05-27 长文档乱码诊断)— fire-and-forget,不阻塞业务 */
  importCacheDumpChunk(args: {
    fileIdx: number;
    chunkIdx: number;
    chunkTitle: string;
    content: string;
  }): void {
    ipcRenderer.send(IPC_CHANNELS.IMPORT_CACHE_DUMP_CHUNK, args);
  },
  importCacheDumpPmDoc(args: {
    fileIdx: number;
    chunkIdx: number;
    pmDoc: unknown;
  }): void {
    ipcRenderer.send(IPC_CHANNELS.IMPORT_CACHE_DUMP_PM_DOC, args);
  },
  importCacheRecordStage(args: {
    fileIdx: number;
    stageId: '03-chunks' | '04-pm-docs';
    bytes: number;
    elapsedMs?: number;
    meta?: Record<string, unknown>;
  }): void {
    ipcRenderer.send(IPC_CHANNELS.IMPORT_CACHE_RECORD_STAGE, args);
  },
  /** X 发布中间态(ArticlePlan + 渲图结果)落盘缓存,fire-and-forget,诊断用。 */
  xPlanCacheDump(env: XPlanCacheEnvelope): void {
    ipcRenderer.send(IPC_CHANNELS.X_PLAN_CACHE_DUMP, env);
  },

  /**
   * 驱动全屏进度 overlay(renderer → main → overlay)。
   * 供 renderer 端长任务(import 解析/切割)复用 GlobalProgressOverlay。
   * fire-and-forget;main 端 progress-bridge 原样回推对应事件到本窗口。
   */
  driveProgress(payload: ProgressDrivePayload): void {
    ipcRenderer.send(IPC_CHANNELS.PROGRESS_DRIVE, payload);
  },

  // ── L5-G1:graph 画板 + 文件夹(D-3=B JSON 起步)──
  graphList(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_LIST);
  },
  graphLoad(id: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_LOAD, id);
  },
  graphCreate(
    title: string,
    variant: string,
    folderId: string | null,
  ): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_CREATE, title, variant, folderId);
  },
  graphSave(id: string, docContent: unknown, title: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_SAVE, id, docContent, title);
  },
  graphDelete(id: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_DELETE, id);
  },
  graphRename(id: string, title: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_RENAME, id, title);
  },
  graphMoveToFolder(id: string, folderId: string | null): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_MOVE_TO_FOLDER, id, folderId);
  },
  graphDuplicate(id: string, targetFolderId?: string | null): Promise<unknown> {
    return ipcRenderer.invoke(
      IPC_CHANNELS.GRAPH_DUPLICATE,
      id,
      targetFolderId === undefined ? undefined : targetFolderId,
    );
  },
  /** main → renderer 推送:画板列表变更(create / save / rename / delete / move / duplicate / folder ops 全广播)*/
  onGraphListChanged(callback: (list: unknown) => void): () => void {
    const handler = (_event: unknown, list: unknown): void => callback(list);
    ipcRenderer.on(IPC_CHANNELS.GRAPH_LIST_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.GRAPH_LIST_CHANGED, handler);
  },
  // 文件夹
  graphFolderList(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_FOLDER_LIST);
  },
  graphFolderCreate(title: string, parentId?: string | null): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_FOLDER_CREATE, title, parentId ?? null);
  },
  graphFolderRename(id: string, title: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_FOLDER_RENAME, id, title);
  },
  graphFolderDelete(id: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_FOLDER_DELETE, id);
  },
  graphFolderMove(id: string, parentId: string | null): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.GRAPH_FOLDER_MOVE, id, parentId);
  },

  // ── L7-sub2:note capability (decision 012,SurrealDB) ──
  noteList(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_LIST);
  },
  noteListTitles(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_LIST_TITLES);
  },
  noteGet(id: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_GET, id);
  },
  noteCreate(initialDoc: unknown, folderId: string | null): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_CREATE, { initialDoc, folderId });
  },
  noteCreateBatch(input: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_CREATE_BATCH, input);
  },
  noteUpdate(id: string, doc: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_UPDATE, { id, doc });
  },
  noteMove(noteId: string, newFolderId: string | null): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_MOVE, { noteId, newFolderId });
  },
  noteDelete(id: string, opts?: { progressTaskId?: string }): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_DELETE, id, opts);
  },
  /** main → renderer 推送:笔记列表变更(create / update / move / delete 后广播)*/
  onNoteListChanged(callback: (list: unknown) => void): () => void {
    const handler = (_event: unknown, list: unknown): void => callback(list);
    ipcRenderer.on(IPC_CHANNELS.NOTE_LIST_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.NOTE_LIST_CHANGED, handler);
  },
  /**
   * main → renderer 推送:单 note doc 内容变更(NOTE_UPDATE 发起者不收;ebook 外部更新所有 renderer 都收)
   *
   * 区别于 onNoteListChanged:粒度更细 + 发起者排除(防 echo 触发 NoteView Host useEffect[doc] 回灌)
   */
  onNoteDocContentChanged(
    callback: (payload: unknown) => void,
  ): () => void {
    const handler = (_event: unknown, payload: unknown): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.NOTE_DOC_CONTENT_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.NOTE_DOC_CONTENT_CHANGED, handler);
  },

  // ── thought capability(横切思考层 — thought-view-port.md v0.5)──
  // 8 invoke + 1 broadcast 订阅 = 9 表面
  thoughtCreate(info: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.THOUGHT_CREATE, info);
  },
  thoughtList(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.THOUGHT_LIST);
  },
  thoughtListBySource(source: string, resourceId: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.THOUGHT_LIST_BY_SOURCE, { source, resourceId });
  },
  thoughtGet(id: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.THOUGHT_GET, id);
  },
  thoughtUpdate(id: string, updates: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.THOUGHT_UPDATE, { id, updates });
  },
  thoughtDelete(id: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.THOUGHT_DELETE, id);
  },
  thoughtMoveToFolder(thoughtId: string, folderId: string | null): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.THOUGHT_MOVE_TO_FOLDER, { thoughtId, folderId });
  },
  thoughtUpdateAnchor(thoughtId: string, anchor: unknown): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.THOUGHT_UPDATE_ANCHOR, { thoughtId, anchor });
  },
  /** main → renderer 推送:thought 列表变更 */
  onThoughtListChanged(callback: (list: unknown) => void): () => void {
    const handler = (_event: unknown, list: unknown): void => callback(list);
    ipcRenderer.on(IPC_CHANNELS.THOUGHT_LIST_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.THOUGHT_LIST_CHANGED, handler);
  },

  // ── L7-sub2:folder capability (decision 012,SurrealDB) ──
  // decision 021 §1.1: folderList / folderCreate 加 viewType 入参 (note + graph 隔离视图)
  folderList(viewType: FolderViewType): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_LIST, viewType);
  },
  folderGet(id: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_GET, id);
  },
  folderCreate(
    title: string,
    parentFolderId: string | null,
    viewType: FolderViewType,
  ): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_CREATE, { title, parentFolderId, viewType });
  },
  folderRename(id: string, title: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_RENAME, { id, title });
  },
  folderMove(folderId: string, newParentFolderId: string | null): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_MOVE, { folderId, newParentFolderId });
  },
  folderDelete(id: string, opts?: { progressTaskId?: string }): Promise<{ deletedFolders: number; deletedResources: number; cascadedEdges: number }> {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_DELETE, id, opts);
  },
  /** decision 021 §5.5 + §10.B-3:Q7 弱保护 dry-run 计数 */
  folderPreviewDelete(id: string): Promise<{ folders: number; resources: number }> {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_PREVIEW_DELETE, id);
  },
  onFolderListChanged(callback: (list: unknown) => void): () => void {
    const handler = (_event: unknown, list: unknown): void => callback(list);
    ipcRenderer.on(IPC_CHANNELS.FOLDER_LIST_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.FOLDER_LIST_CHANGED, handler);
  },

  // ── L7-sub3a-1:pm-content capability (decision 014 §3.4) ──
  pmContentCreate(doc: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.PM_CONTENT_CREATE, doc);
  },
  pmContentGet(id: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.PM_CONTENT_GET, id);
  },
  pmContentUpdate(id: string, doc: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.PM_CONTENT_UPDATE, id, doc);
  },

  // ── ai-extraction capability(V1 web-bridge AI 自动化 → V2 抽 capability)──
  // 4 invoke + 3 broadcast 订阅 = 7 表面
  // targetWcId:本活跃 ws 的 AI Host guest wc id(按 ws 定向注入/抓取,治多实例串扰)
  aiAsk(serviceId: string, prompt: string, options?: unknown, targetWcId?: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_ASK, { serviceId, prompt, options, targetWcId });
  },
  aiPasteAndSend(serviceId: string, prompt: string, targetWcId?: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_PASTE_AND_SEND, { serviceId, prompt, targetWcId });
  },
  aiGetLatestResponse(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_GET_LATEST_RESPONSE);
  },
  aiExtractFull(serviceId: string, targetWcId?: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_EXTRACT_FULL, { serviceId, targetWcId });
  },
  aiExtractTurn(serviceId: string, x: number, y: number, targetWcId?: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_EXTRACT_TURN, { serviceId, x, y, targetWcId });
  },
  onAIExtractTurnRequest(
    callback: (payload: { serviceId: string; x: number; y: number }) => void,
  ): () => void {
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as { serviceId: string; x: number; y: number });
    ipcRenderer.on(IPC_CHANNELS.AI_EXTRACT_TURN_REQUEST, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.AI_EXTRACT_TURN_REQUEST, handler);
  },
  aiOpenSession(serviceId: string, targetWcId?: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_OPEN_SESSION, { serviceId, targetWcId });
  },
  aiServiceList(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_SERVICE_LIST);
  },
  aiSSEStatus(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_SSE_STATUS);
  },
  onAIResponseStream(callback: (chunk: unknown) => void): () => void {
    const handler = (_event: unknown, chunk: unknown): void => callback(chunk);
    ipcRenderer.on(IPC_CHANNELS.AI_RESPONSE_STREAM, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.AI_RESPONSE_STREAM, handler);
  },
  onAIResponseReady(callback: (payload: unknown) => void): () => void {
    const handler = (_event: unknown, payload: unknown): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.AI_RESPONSE_READY, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.AI_RESPONSE_READY, handler);
  },
  onAIError(callback: (payload: unknown) => void): () => void {
    const handler = (_event: unknown, payload: unknown): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.AI_ERROR, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.AI_ERROR, handler);
  },

  // ── ai-sync feature(AI 对话 → 右槽 Note 自动追加 ❓ Callout + 🔀 Toggle) ──
  aiSyncStart(serviceId: string, targetWcId?: number): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_SYNC_START, { serviceId, targetWcId });
  },
  aiSyncStop(serviceId: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_SYNC_STOP, serviceId);
  },
  /** main → renderer 推送:某 turn 完成,view 端追加到当前右槽 Note;返 unsubscribe */
  onAISyncAppendTurn(callback: (payload: unknown) => void): () => void {
    const handler = (_event: unknown, payload: unknown): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.AI_SYNC_APPEND_TURN, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.AI_SYNC_APPEND_TURN, handler);
  },

  // ── X(Twitter)集成(阶段 1:右键 X webview 提取推文 → tweetBlock 落 Note) ──
  /** 按坐标定位 + 抽该条推文(返 { success, data?, error? });targetWcId 按活跃 ws 定向 */
  xExtractTweet(serviceId: string, x: number, y: number, targetWcId?: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.X_EXTRACT_TWEET, { serviceId, x, y, targetWcId });
  },
  /** 订阅 X webview 原生右键「提取此推文」点击(main 推 guest 坐标);返 unsubscribe */
  onXExtractTweetRequest(
    callback: (payload: { serviceId: string; x: number; y: number }) => void,
  ): () => void {
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as { serviceId: string; x: number; y: number });
    ipcRenderer.on(IPC_CHANNELS.X_EXTRACT_TWEET_REQUEST, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.X_EXTRACT_TWEET_REQUEST, handler);
  },
  /** 订阅:宿主页内 iframe(tweet block 嵌入卡片)弹 x.com 链接 → 改在 X webview 打开 */
  onXOpenTweetRequest(callback: (payload: { url: string }) => void): () => void {
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as { url: string });
    ipcRenderer.on(IPC_CHANNELS.X_OPEN_TWEET_REQUEST, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.X_OPEN_TWEET_REQUEST, handler);
  },

  // ── X 集成 阶段 2(写方向:发推 / 回复 — 填充内容,用户点发布) ──
  /** 发推:把纯文本填进 X compose 框(targetWcId:指定注入目标 guest wc,本活跃 ws 的 X)。
   *  mediaUrls(阶段 2.5-b,路线 B):note 图的 media:// 数组,main 侧解析磁盘路径后先喂图再填字。
   *  videoUrls(阶段 2.5-b 视频):note 视频源(media:// / 绝对路径),main 侧解析后走视频喂文件(转码 poll)。*/
  xPasteTweet(serviceId: string, text: string, targetWcId?: number, mediaUrls?: string[], videoUrls?: string[]): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.X_PASTE_TWEET, { serviceId, text, targetWcId, mediaUrls, videoUrls });
  },
  /** 回复:导航到目标推 + 把纯文本填进 reply 框(targetWcId:指定注入目标 guest wc)。
   *  mediaUrls / videoUrls(阶段 2.5-b):同 xPasteTweet。*/
  xPasteReply(serviceId: string, tweetUrl: string, text: string, targetWcId?: number, mediaUrls?: string[], videoUrls?: string[]): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.X_PASTE_REPLY, { serviceId, tweetUrl, text, targetWcId, mediaUrls, videoUrls });
  },
  /** 发长文:驱动 X 原生 Insert(终态,2026-06-13)。plan = renderer buildArticlePlan 产物。
   *  ⚠️ 写方向红线:只插内容,绝不程序点 Publish。 */
  xDriveArticle(serviceId: string, plan: unknown, targetWcId?: number, taskId?: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.X_DRIVE_ARTICLE, { serviceId, plan, targetWcId, taskId });
  },
  /** 逐块底层测试:独立驱动一个块 + 验证完整落定(dev 用)。 */
  xTestDriveStep(serviceId: string, step: unknown, targetWcId?: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.X_TEST_DRIVE_STEP, { serviceId, step, targetWcId });
  },
  /** 连续驱动多块(诊断块边界,如 media 后紧跟标题的重复/失格;dev 用)。 */
  xTestDriveSequence(serviceId: string, steps: unknown[], targetWcId?: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.X_TEST_DRIVE_STEP, { serviceId, steps, targetWcId });
  },
  /** 拖拽:note 拖起,往指定 X guest 装 mousemove 监听(记录最后坐标)*/
  xDragArm(targetWcId: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.X_DRAG_ARM, { targetWcId });
  },
  /** 拖拽:松手,读回最后坐标 + 解析落点 */
  xDragResolve(serviceId: string, targetWcId: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.X_DRAG_RESOLVE, { serviceId, targetWcId });
  },
  /** 拖拽落推文:就地点该推回复按钮弹 reply 框(不跳详情页)*/
  xDragReplyHere(serviceId: string, targetWcId: number): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.X_DRAG_REPLY_HERE, { serviceId, targetWcId });
  },
  // ── 账号登录 + 归因(本期不做授权) ──
  // renderer 永远只拿 public AuthState(不含 token);邮箱注册两步(先 authSendCode 拿码)。
  /** 取当前 public 授权态(不含 token) */
  authGetState(): Promise<AuthState> {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_STATE);
  },
  /** 发邮箱验证码(注册前置,purpose=register) */
  authSendCode(input: AuthSendCodeInput): Promise<AuthActionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTH_SEND_CODE, input);
  },
  /** 注册(email+password+6 位 code) */
  authRegister(input: AuthRegisterInput): Promise<AuthActionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTH_REGISTER, input);
  },
  /** 登录(老用户,email+password) */
  authLogin(input: AuthLoginInput): Promise<AuthActionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, input);
  },
  /** 登出 + 清本地 token,回 anonymous */
  authLogout(): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT);
  },
  /** 刷 token(轮换;启动 / 恢复前台时) */
  authRefresh(): Promise<AuthActionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTH_REFRESH);
  },
  /** main → renderer 推送:授权态变化;返 unsubscribe(多 ws 守卫由 renderer 侧加) */
  onAuthChanged(callback: (state: AuthState) => void): () => void {
    const handler = (_event: unknown, state: AuthState): void => callback(state);
    ipcRenderer.on(IPC_CHANNELS.AUTH_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.AUTH_CHANGED, handler);
  },

  // ── Progress 反馈订阅(backup-restore + 未来长耗时任务共用) ──
  /** 任务开始 — 显示全屏覆盖层 */
  onProgressStart(callback: (payload: ProgressStartPayload) => void): () => void {
    const handler = (_event: unknown, payload: ProgressStartPayload): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.PROGRESS_START, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.PROGRESS_START, handler);
  },
  /** 任务进度更新 */
  onProgressUpdate(callback: (payload: ProgressUpdatePayload) => void): () => void {
    const handler = (_event: unknown, payload: ProgressUpdatePayload): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.PROGRESS_UPDATE, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.PROGRESS_UPDATE, handler);
  },
  /** 任务完成(success/error) */
  onProgressDone(callback: (payload: ProgressDonePayload) => void): () => void {
    const handler = (_event: unknown, payload: ProgressDonePayload): void => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.PROGRESS_DONE, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.PROGRESS_DONE, handler);
  },
});
