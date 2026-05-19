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
import type { FolderViewType } from '@capabilities/folder/types';

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
  ytdlpDownload(url: string, outputPath?: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_DOWNLOAD, url, outputPath);
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
  // L5-B3.19.e UX:检 webview YouTube 登录 cookies
  ytdlpCheckYoutubeCookies(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_CHECK_YOUTUBE_COOKIES);
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
  noteGet(id: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_GET, id);
  },
  noteCreate(initialDoc: unknown, folderId: string | null): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_CREATE, { initialDoc, folderId });
  },
  noteUpdate(id: string, doc: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_UPDATE, { id, doc });
  },
  noteMove(noteId: string, newFolderId: string | null): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_MOVE, { noteId, newFolderId });
  },
  noteDelete(id: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.NOTE_DELETE, id);
  },
  /** main → renderer 推送:笔记列表变更(create / update / move / delete 后广播)*/
  onNoteListChanged(callback: (list: unknown) => void): () => void {
    const handler = (_event: unknown, list: unknown): void => callback(list);
    ipcRenderer.on(IPC_CHANNELS.NOTE_LIST_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.NOTE_LIST_CHANGED, handler);
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
  folderDelete(id: string): Promise<{ deletedFolders: number; deletedResources: number; cascadedEdges: number }> {
    return ipcRenderer.invoke(IPC_CHANNELS.FOLDER_DELETE, id);
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

  // ── ai-conversation capability(V1 web-bridge AI 自动化 → V2 抽 capability)──
  // 4 invoke + 3 broadcast 订阅 = 7 表面
  aiAsk(serviceId: string, prompt: string, options?: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_ASK, { serviceId, prompt, options });
  },
  aiPasteAndSend(serviceId: string, prompt: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_PASTE_AND_SEND, { serviceId, prompt });
  },
  aiGetLatestResponse(): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_GET_LATEST_RESPONSE);
  },
  aiExtractFull(serviceId: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_EXTRACT_FULL, serviceId);
  },
  aiOpenSession(serviceId: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_OPEN_SESSION, serviceId);
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
  aiSyncStart(serviceId: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_SYNC_START, serviceId);
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
});
