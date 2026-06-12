/**
 * window.electronAPI 类型声明(renderer 全局)
 *
 * 与 src/platform/main/preload/main-window-preload.ts 暴露的 API 对应。
 */

import type {
  DiagnosticsReportPayload,
  HealthCheckResponse,
} from './message-types';
import type {
  NoteInfo,
  FolderInfo,
  FolderViewType,
  NoteDocEnvelope,
  NoteDocContentChangedPayload,
} from './note-folder-types';
import type {
  CreateNoteBatchInput,
  CreateNoteBatchResult,
} from '@capabilities/note/types';
import type { PmAtomInfo, PmDocEnvelope } from './pm-content-types';
import type { ThoughtInfo, ThoughtAnchor, ThoughtSource } from './thought-types';
import type {
  AIAskOptions,
  AIAskResult,
  AIResponseReadyPayload,
  AIErrorPayload,
  AIStreamChunk,
  AISSEStatus,
  AISyncAppendTurnPayload,
} from './ai-types';
import type { AIServiceId } from '../types/ai-service-types';
import type { XServiceId } from '../types/x-service-types';
import type { ProxyNode, ProxyNodeType } from '../types/proxy-types';
import type { WebGlobalSettings } from '../types/web-settings-types';
import type {
  ProgressStartPayload,
  ProgressUpdatePayload,
  ProgressDonePayload,
  ProgressDrivePayload,
} from './backup-types';

declare global {
  /** Web 下载历史条目(主进程 download-store 落盘的终态记录)*/
  interface WebDownloadHistoryEntry {
    id: string;
    filename: string;
    url: string;
    savePath: string;
    total: number;
    completedAt: number;
    state: 'completed' | 'cancelled' | 'interrupted';
  }

  interface Window {
    electronAPI: {
      reportAlive(payload: DiagnosticsReportPayload): void;
      health(layer: 'L0' | 'L1' | 'L2' | 'L3' | 'L3.5' | 'L4' | 'L5' | 'platform'): Promise<HealthCheckResponse>;
      /** 订阅窗口全屏状态变化,返回取消订阅函数 */
      onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void;
      /** L5-B3.4:打开外部 URL(http/https/mailto)— shell.openExternal */
      openExternal(url: string): Promise<{ ok: boolean; reason?: string }>;
      /** L5-B3.4:打开文件路径(系统默认应用)— shell.openPath */
      openPath(filePath: string): Promise<{ ok: boolean; reason?: string }>;
      /** L5-B4.2:fetch Google Translate element.js(main 取后注入 webview,避 CSP)*/
      translateFetchElementJs(): Promise<string | null>;
      /** L5-B4.2.2:重启 app(切翻译语言后让 widget 用新 lang 重新初始化)*/
      restartApp(): void;
      /** L5-B4.3.1:base64 / data URL → media:// URL(SHA256 去重) */
      mediaPutBase64(
        input: string,
        explicitMime?: string,
        hintedFilename?: string,
      ): Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }>;
      /** L5-B4.3.1:从远程 URL 下载到 media store,返回 media:// URL */
      mediaDownload(
        url: string,
        type: 'audio' | 'image' | 'video',
      ): Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }>;
      /** L5-B3.14:media:// URL → 本地文件系统绝对路径(file-block / file-link / external-ref 用)*/
      mediaResolvePath(mediaUrl: string): Promise<{ success: boolean; path?: string }>;
      /** L5-B3.14:在 Finder 高亮显示文件 */
      showItemInFolder(filePath: string): Promise<{ ok: boolean; reason?: string }>;
      /** L5-B3.14:File → 绝对路径(同步;Electron 32+ webUtils.getPathForFile 包装)*/
      getFilePath(file: File): string;

      // ── L5-B3.17:yt-dlp capability ──
      /** 检查 yt-dlp 是否已安装 + 版本 */
      ytdlpCheckStatus(): Promise<{ installed: boolean; version?: string; path?: string }>;
      /** 下载并安装 yt-dlp 二进制(从 yt-dlp GitHub release latest)*/
      ytdlpInstall(): Promise<{ installed: boolean; version?: string; path?: string }>;
      /** 订阅 yt-dlp install 进度 — 返回取消订阅函数 */
      onYtdlpInstallProgress(
        callback: (progress: { percent: number; installed: boolean; version?: string; error?: string }) => void,
      ): () => void;
      /** 下载视频(走 spawn yt-dlp,自动抓 YouTube 字幕保存为 .en.srt)
       *  partition 可选 — 指定取 cookies 的 webview session(per-ws);兜底旧 persist:webview */
      ytdlpDownload(
        url: string,
        outputPath?: string,
        partition?: string,
      ): Promise<{
        url: string;
        status: 'downloading' | 'complete' | 'error';
        percent: number;
        filename?: string;
        subtitleFile?: string;
        subtitleText?: string;
        error?: string;
      }>;
      /** 订阅 yt-dlp download 进度 — 返回取消订阅函数 */
      onYtdlpDownloadProgress(
        callback: (progress: {
          url: string;
          status: 'downloading' | 'complete' | 'error';
          percent: number;
          filename?: string;
          error?: string;
        }) => void,
      ): () => void;
      /** 获取视频元数据(--dump-json,不下载)*/
      ytdlpGetInfo(url: string): Promise<Record<string, unknown> | null>;
      /** 保存翻译字幕为 .srt(对齐视频文件,用于字幕系统翻译导出)*/
      ytdlpSaveSubtitle(
        videoFilePath: string,
        langCode: string,
        timestampText: string,
      ): Promise<string | null>;
      /** L5-B3.19.b:不下载视频抓 YouTube 字幕([MM:SS] timestamp text 格式;失败时 transcriptText=null + error 详情)*/
      ytdlpFetchTranscript(url: string): Promise<{
        transcriptText: string | null;
        error: string | null;
      }>;
      /** L5-B3.19.e UX:检 webview partition 是否有 YouTube 登录 cookies
       *  partition 可选 — per-ws session;兜底旧 persist:webview */
      ytdlpCheckYoutubeCookies(partition?: string): Promise<{
        hasLogin: boolean;
        count: number;
        error?: string;
      }>;

      // ── L5-B3.18:tweet-fetcher 临时 capability(Phase D 被吸收)──
      /** 抓取推文元数据(BrowserWindow + DOM scraping)
       *  仅接受 https://twitter.com / https://x.com 域 */
      fetchTweetData(tweetUrl: string): Promise<{
        success: boolean;
        data?: {
          authorName?: string;
          authorHandle?: string;
          authorAvatar?: string;
          text?: string;
          createdAt?: string;
          lang?: string;
          media?: Array<{ type: 'image' | 'video'; url: string; thumbUrl?: string }>;
          metrics?: { replies?: number; retweets?: number; likes?: number; views?: number };
          quotedTweet?: string;
          inReplyTo?: string;
        };
        error?: string;
      }>;

      // ── L5-B3.20a:learning capability(vocab + dictionary + translate + TTS)──
      /** 添加生词;失败返 null */
      learningVocabAdd(
        word: string,
        definition: string,
        context?: string,
        phonetic?: string,
      ): Promise<{
        id: string;
        word: string;
        definition: string;
        context?: string;
        phonetic?: string;
        createdAt: number;
      } | null>;
      /** 删除生词(by id)*/
      learningVocabRemove(id: string): Promise<void>;
      /** 全量列表(按 createdAt 倒序)*/
      learningVocabList(): Promise<Array<{
        id: string;
        word: string;
        definition: string;
        context?: string;
        phonetic?: string;
        createdAt: number;
      }>>;
      /** 检查 word 是否已在生词本(case-insensitive)*/
      learningVocabHas(word: string): Promise<boolean>;
      /** 订阅 vocab 变化 — 返回 unsubscribe */
      onLearningVocabChanged(
        callback: (entries: Array<{
          id: string;
          word: string;
          definition: string;
          context?: string;
          phonetic?: string;
          createdAt: number;
        }>) => void,
      ): () => void;
      /** 词典查询(macOS 优先 / Google fallback)*/
      learningDictionaryLookup(word: string): Promise<{
        word: string;
        definition: string;
        phonetic?: string;
        source: string;
      } | null>;
      /** Google 翻译(targetLang 默认 'zh-CN')*/
      learningTranslate(
        text: string,
        targetLang?: string,
      ): Promise<{ text: string; sourceLang: string; targetLang: string } | null>;
      /** Google TTS — 返 MP3 ArrayBuffer,view 用 Blob 创建 audio URL */
      learningTts(text: string, lang: string): Promise<ArrayBuffer | null>;

      // ── L5-C1:ebook 书架 + 文件夹 + 标注(D-3=B JSON 起步)──
      /** 选文件 — 弹 dialog,返 { filePath, fileName, fileType } 或 null(取消)*/
      ebookPickFile(): Promise<unknown>;
      /** 全量书架(按 lastOpenedAt 倒序)*/
      ebookBookshelfList(): Promise<unknown>;
      /** 添加书 — managed=复制到 library;link=只记路径 */
      ebookBookshelfAdd(
        filePath: string,
        fileType: string,
        storage: 'managed' | 'link',
      ): Promise<unknown>;
      /** 打开书 — 加载到 main 内存 + 通知 EBOOK_LOADED */
      ebookBookshelfOpen(id: string): Promise<unknown>;
      ebookBookshelfRemove(id: string): Promise<void>;
      ebookBookshelfRename(id: string, displayName: string): Promise<void>;
      ebookBookshelfMove(id: string, folderId: string | null): Promise<void>;
      /** D-5:重新定位失效文件(弹 dialog 选新路径)*/
      ebookBookshelfRelocate(id: string): Promise<unknown>;
      /** link → managed:复制文件到 library + 更新元数据 */
      ebookBookshelfTransferToManaged(id: string): Promise<unknown>;
      /** 订阅书架变化 — 返回 unsubscribe(对齐 onLearningVocabChanged 模式)*/
      onEbookBookshelfChanged(callback: (list: unknown) => void): () => void;
      // 文件夹: sub-phase 022 删除 5 folder bridge — view caller 改走 folder capability
      // + viewType='ebook' (决议 021 §4.3 + 决议 022 Step 5.4 commit 2 已落地)
      // 数据传输
      ebookGetData(): Promise<unknown>;
      ebookClose(): Promise<void>;
      /** 推送:书已加载,view 收到后调 ebookGetData() 拿 ArrayBuffer */
      onEbookLoaded(callback: (info: unknown) => void): () => void;
      // 进度 + 书签 + 标注(C1 占位 channel,C2~C5 真消费)
      ebookSaveProgress(bookId: string, position: unknown): Promise<void>;
      ebookBookmarkToggle(bookId: string, page: number): Promise<number[]>;
      ebookBookmarkList(bookId: string): Promise<number[]>;
      ebookCfiBookmarkAdd(bookId: string, cfi: string, label: string): Promise<unknown>;
      ebookCfiBookmarkRemove(bookId: string, cfi: string): Promise<unknown>;
      ebookCfiBookmarkList(bookId: string): Promise<unknown>;
      // 标注: sub-phase 022 删 3 annotation bridge (annotation 概念消亡), 改走 5 个
      // thought block bridge (decision 022 §4.1.4 + §0.5)
      // ── sub-phase 022:reading thought block ──
      ebookThoughtGet(bookId: string): Promise<unknown>;
      ebookThoughtEnsure(bookId: string): Promise<unknown>;
      ebookThoughtBlockAdd(bookId: string, spec: unknown): Promise<void>;
      ebookThoughtBlockRemove(bookId: string, blockId: string): Promise<void>;
      ebookThoughtAnnotations(bookId: string): Promise<unknown>;
      // PR-α-3b:单读 block + 改单块颜色
      ebookThoughtBlockGet(bookId: string, createdAt: number): Promise<unknown>;
      ebookThoughtBlockUpdateColor(
        bookId: string,
        createdAt: number,
        color: string,
      ): Promise<void>;

      // ── web view 书签树(书签步骤1 数据层)──
      /** 全部书签(扁平,按 createdAt 倒序)*/
      bookmarkList(): Promise<unknown>;
      /** 添加书签 — 给 folderId 则挂到该 folder(viewType='web')*/
      bookmarkAdd(url: string, title: string, folderId: string | null): Promise<unknown>;
      bookmarkRename(id: string, title: string): Promise<void>;
      bookmarkRemove(id: string): Promise<void>;
      bookmarkMove(id: string, folderId: string | null): Promise<void>;
      /** 订阅书签列表变化 — 返回 unsubscribe(对齐 onEbookBookshelfChanged 模式)*/
      onBookmarkListChanged(callback: (list: unknown) => void): () => void;

      // ── L5-C6:PDF 提取 → Note(KRIG Knowledge Platform)──
      /** 上传当前打开的 PDF → 返 { uploaded, md5?, platformUrl?, alreadyExists?, reason? } */
      extractionUpload(): Promise<unknown>;
      /** 主动触发 import(备用)*/
      extractionImport(data: unknown): Promise<unknown>;
      /** 订阅 main 推送的拦截到的 atom JSON */
      onExtractionNoteCreate(callback: (data: unknown) => void): () => void;

      // ── Phase 2:web view 原生右键菜单 ──
      /** 订阅 main 推送的查词/翻译动作(view 端调 learning dictionaryPanel)*/
      onWebContextMenuAction(
        callback: (payload: { action: 'lookup' | 'translate'; text: string }) => void,
      ): () => void;

      // ── 网页剪藏(Defuddle → Note)──
      /** 订阅 main 推送的整页提取结果(FullPageResult | null);content-extraction 门面消费 */
      onWebClipResult(callback: (payload: unknown) => void): () => void;

      // ── Phase 4 Commit 2:web view 快捷键整层 + 弹窗导流 ──
      /** 订阅 main 推送的 web 快捷键(webview 焦点下 before-input-event 拦截后回推)*/
      onWebViewShortcut(callback: (payload: { action: string }) => void): () => void;
      /** 订阅 main 推送的弹窗导流(target=_blank → web view 内新建 tab)*/
      onWebNewTab(callback: (payload: { url: string }) => void): () => void;

      // ── Phase 3:web view 下载管理 ──
      /** 订阅 main 推送的下载事件(started/progress/done),下载条 UI 用 */
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
      ): () => void;
      /** web view 下载操作(取消)*/
      webDownloadAction(payload: { id: number; action: 'cancel' }): Promise<void>;
      /**
       * per-ws 代理阶段2:给某 ws 的 partition session 设代理出口。renderer 只传 proxyId,
       * 主进程查全局节点表解析 rules 后 setProxy。proxyId 空/undefined → 直连。
       */
      setWebProxy(args: { workspaceId: string; proxyId?: string }): Promise<void>;
      /** per-ws 代理阶段2:全量代理节点(按 createdAt 升序)*/
      listProxyNodes(): Promise<ProxyNode[]>;
      /** per-ws 代理阶段2:加代理节点(主进程生成 id + createdAt,返回新 node)*/
      addProxyNode(args: { name: string; type: ProxyNodeType; host: string }): Promise<ProxyNode>;
      /** per-ws 代理阶段2:删代理节点(by id)*/
      removeProxyNode(id: string): Promise<void>;
      /** per-ws 代理阶段3:取 Web 全局设置(搜索引擎模板 + 默认主页)*/
      getWebSettings(): Promise<WebGlobalSettings>;
      /** per-ws 代理阶段3:更新 Web 全局设置 — 合并 patch 后返回全量 */
      updateWebSettings(patch: Partial<WebGlobalSettings>): Promise<WebGlobalSettings>;
      /** per-ws 代理阶段3:清某 ws partition 的浏览数据(cookies/缓存/localStorage 等)*/
      clearWebStorageData(args: { workspaceId: string }): Promise<void>;
      /** 取下载历史全量(终态记录,按 completedAt 倒序)*/
      webDownloadList(): Promise<WebDownloadHistoryEntry[]>;
      /** 删一条下载历史记录(仅删 JSON 记录,不删磁盘文件,对齐 Chrome)*/
      webDownloadRemove(id: string): Promise<void>;
      /** 订阅 main 推送的下载历史变更(落盘/删记录后刷新),NavSide 下载段用 */
      onWebDownloadHistoryChanged(
        callback: (entries: WebDownloadHistoryEntry[]) => void,
      ): () => void;

      // ── Markdown 文件 / 目录导入 ──
      /** 订阅 main 推送的已扫好的 markdown 批(File → Import Markdown...)*/
      onMarkdownImportRun(callback: (data: unknown) => void): () => void;
      /** 诊断落盘(fire-and-forget),2026-05-27 长文档乱码诊断用 */
      importCacheDumpChunk(args: {
        fileIdx: number;
        chunkIdx: number;
        chunkTitle: string;
        content: string;
      }): void;
      importCacheDumpPmDoc(args: {
        fileIdx: number;
        chunkIdx: number;
        pmDoc: unknown;
      }): void;
      importCacheRecordStage(args: {
        fileIdx: number;
        stageId: '03-chunks' | '04-pm-docs';
        bytes: number;
        elapsedMs?: number;
        meta?: Record<string, unknown>;
      }): void;

      /** 驱动全屏进度 overlay(renderer 端长任务复用,fire-and-forget)*/
      driveProgress(payload: ProgressDrivePayload): void;

      // ── L5-G1:graph 画板 + 文件夹(D-3=B JSON 起步)──
      graphList(): Promise<unknown>;
      graphLoad(id: string): Promise<unknown>;
      graphCreate(
        title: string,
        variant: string,
        folderId: string | null,
      ): Promise<unknown>;
      graphSave(id: string, docContent: unknown, title: string): Promise<void>;
      graphDelete(id: string): Promise<void>;
      graphRename(id: string, title: string): Promise<void>;
      graphMoveToFolder(id: string, folderId: string | null): Promise<void>;
      graphDuplicate(id: string, targetFolderId?: string | null): Promise<unknown>;
      /** 推送:画板列表变更(create / save / rename / delete / move / duplicate / folder ops 全广播)*/
      onGraphListChanged(callback: (list: unknown) => void): () => void;
      // 文件夹
      graphFolderList(): Promise<unknown>;
      graphFolderCreate(title: string, parentId?: string | null): Promise<unknown>;
      graphFolderRename(id: string, title: string): Promise<void>;
      graphFolderDelete(id: string): Promise<void>;
      graphFolderMove(id: string, parentId: string | null): Promise<void>;

      // ── L7-sub2:note capability (decision 012,SurrealDB) ──
      noteList(): Promise<NoteInfo[]>;
      /** 轻量 list — 只返 id/title/folderId,不 assemble doc(2026-05-28 性能修复)*/
      noteListTitles(): Promise<Array<{ id: string; title: string; folderId: string | null }>>;
      noteGet(id: string): Promise<NoteInfo | null>;
      noteCreate(initialDoc: NoteDocEnvelope | null, folderId: string | null): Promise<NoteInfo>;
      /** 5B Stage 7: 批量创建 note (PmAtomDraft[] → 单事务多 note) */
      noteCreateBatch(input: CreateNoteBatchInput): Promise<CreateNoteBatchResult>;
      noteUpdate(id: string, doc: NoteDocEnvelope): Promise<NoteInfo | null>;
      noteMove(noteId: string, newFolderId: string | null): Promise<void>;
      noteDelete(id: string, opts?: { progressTaskId?: string }): Promise<void>;
      /** main → renderer 推送:笔记列表变更;返 unsubscribe */
      onNoteListChanged(callback: (list: NoteInfo[]) => void): () => void;
      /**
       * main → renderer 推送:单 note doc 变更;返 unsubscribe
       *
       * 区别于 onNoteListChanged:粒度更细 + 发起者(emitterId)被 main 侧排除,
       * 防 NoteView Host useEffect[doc] echo 回灌跳光标。
       */
      onNoteDocContentChanged(
        callback: (payload: NoteDocContentChangedPayload) => void,
      ): () => void;

      // ── thought capability (横切思考层 — thought-view-port.md v0.5 §5.3) ──
      // 8 invoke + 1 broadcast = 9 表面
      /** #1 原子操作:建 atom;若 info.anchor != null 同事务内建 thoughtOf 边(attrs.source/locator) */
      thoughtCreate(info: Omit<ThoughtInfo, 'id' | 'createdAt' | 'updatedAt'>): Promise<ThoughtInfo>;
      /** #2 全量列表(Thought View 主舞台) */
      thoughtList(): Promise<ThoughtInfo[]>;
      /** #3 某 source 资源的全部 thought(NoteView/EBookView 右槽用) */
      thoughtListBySource(source: ThoughtSource, resourceId: string): Promise<ThoughtInfo[]>;
      /** #4 单条查询 */
      thoughtGet(id: string): Promise<ThoughtInfo | null>;
      /** #5 改 payload 字段(doc/type/resolved/pinned/color/thumbnail/serviceId) */
      thoughtUpdate(
        id: string,
        updates: Partial<
          Pick<
            ThoughtInfo,
            'doc' | 'type' | 'resolved' | 'pinned' | 'color' | 'thumbnail' | 'serviceId'
          >
        >,
      ): Promise<ThoughtInfo | null>;
      /** #6 级联删 atom + 所有 thoughtOf 边 */
      thoughtDelete(id: string): Promise<void>;
      /** #7 NavSide Thought tab 拖拽用 */
      thoughtMoveToFolder(thoughtId: string, folderId: string | null): Promise<void>;
      /** #8 改/解 anchor(Note 撤销 mark / ebook 位置变 / 显式 unanchor)*/
      thoughtUpdateAnchor(thoughtId: string, anchor: ThoughtAnchor | null): Promise<void>;
      /** main → renderer 推送:thought 列表变更;返 unsubscribe */
      onThoughtListChanged(callback: (list: ThoughtInfo[]) => void): () => void;

      // ── L7-sub2:folder capability (decision 012,SurrealDB) ──
      // decision 021 §1.1: folderList / folderCreate 加 viewType 入参 (note + graph 隔离视图)
      folderList(viewType: FolderViewType): Promise<FolderInfo[]>;
      folderGet(id: string): Promise<FolderInfo | null>;
      folderCreate(
        title: string,
        parentFolderId: string | null,
        viewType: FolderViewType,
      ): Promise<FolderInfo | null>;
      folderRename(id: string, title: string): Promise<FolderInfo | null>;
      folderMove(folderId: string, newParentFolderId: string | null): Promise<void>;
      /**
       * Path Y:删 folder 递归删子 folder + 内含资源 (pm note + graph-canvas + future)。
       * decision 012 设计师批复 + decision 014 §6.2.6 cascade scope 扩展。
       */
      folderDelete(id: string, opts?: { progressTaskId?: string }): Promise<{
        deletedFolders: number;
        deletedResources: number;
        cascadedEdges: number;
      }>;
      /** decision 021 §5.5 + §10.B-3:Q7 弱保护 dry-run 计数 */
      folderPreviewDelete(id: string): Promise<{ folders: number; resources: number }>;
      /** main → renderer 推送:文件夹列表变更;返 unsubscribe */
      onFolderListChanged(callback: (list: FolderInfo[]) => void): () => void;

      // ── L7-sub3a-1:pm-content capability (decision 014 §3.4) ──
      pmContentCreate(doc: PmDocEnvelope): Promise<PmAtomInfo>;
      pmContentGet(id: string): Promise<PmAtomInfo | null>;
      pmContentUpdate(id: string, doc: PmDocEnvelope): Promise<PmAtomInfo>;

      // ── ai-extraction capability (V1 web-bridge AI 自动化 → V2 抽 capability;原 ai-conversation) ──
      // 4 invoke + 3 broadcast 订阅 = 7 表面
      /** 给 AI 服务发 prompt 等完整 Markdown 回复;5 分钟无请求后台 webview 自动销毁 */
      aiAsk(
        serviceId: AIServiceId,
        prompt: string,
        options?: AIAskOptions,
        /** 本活跃 ws 的 AI Host guest wc id(按 ws 定向注入,治多实例串扰)*/
        targetWcId?: number,
      ): Promise<AIAskResult>;
      /** 只 paste prompt + click send,不等回复(用户在 AI Web 实时看聊天) */
      aiPasteAndSend(
        serviceId: AIServiceId,
        prompt: string,
        /** 本活跃 ws 的 AI Host guest wc id(按 ws 定向注入,治多实例串扰)*/
        targetWcId?: number,
      ): Promise<{ success: boolean; error?: string }>;
      /** 从 SSE 缓存取最新一次 AI 完整回复 markdown(提取按钮用) */
      aiGetLatestResponse(): Promise<string | null>;
      /** Phase 10.B:整页对话提取(多 turn + artifact + 图片)*/
      aiExtractFull(serviceId: AIServiceId, targetWcId?: number): Promise<{
        success: boolean;
        markdown?: string;
        title?: string;
        model?: string;
        turnCount?: number;
        artifactCount?: number;
        error?: string;
      }>;
      /** 右键「提取此对话到笔记」:按 guest viewport 坐标定位 + 抽单条(本期仅 Claude)*/
      aiExtractTurn(
        serviceId: AIServiceId,
        x: number,
        y: number,
        /** 本活跃 ws 的 AI Host guest wc id(按 ws 定向抓取,治多实例串扰)*/
        targetWcId?: number,
      ): Promise<{
        success: boolean;
        userMessage?: string;
        markdown?: string;
        artifactCount?: number;
        error?: string;
      }>;
      /** main → renderer 推送:原生右键菜单点击,带 guest viewport 坐标;返 unsubscribe */
      onAIExtractTurnRequest(
        callback: (payload: { serviceId: AIServiceId; x: number; y: number }) => void,
      ): () => void;
      /** 把后台 webview 转前台 (AI View Host 用,本期占位返回 status) */
      aiOpenSession(
        serviceId: AIServiceId,
        targetWcId?: number,
      ): Promise<{ success: boolean; status?: string; serviceId?: AIServiceId | null; url?: string | null; error?: string }>;
      /** 取三服务清单(UI 下拉菜单用) */
      aiServiceList(): Promise<Array<{ id: AIServiceId; name: string; icon: string }>>;
      /** debug:SSE 拦截状态 */
      aiSSEStatus(): Promise<AISSEStatus>;
      /** main → renderer 推送:Claude 流式增量(本期仅 Claude);返 unsubscribe */
      onAIResponseStream(callback: (chunk: AIStreamChunk) => void): () => void;
      /** main → renderer 推送:AI 完整回复就绪;返 unsubscribe */
      onAIResponseReady(callback: (payload: AIResponseReadyPayload) => void): () => void;
      /** main → renderer 推送:AI 调用失败;返 unsubscribe */
      onAIError(callback: (payload: AIErrorPayload) => void): () => void;

      // ── ai-sync feature(AI 对话 → 右槽 Note 自动追加 ❓ Callout + 🔀 Toggle) ──
      /** 启动 ai-sync:让 main 端 orchestrator 开始轮询 SSE,turn 完成时 emit AI_SYNC_APPEND_TURN */
      aiSyncStart(serviceId: AIServiceId, targetWcId?: number): Promise<{ success: boolean; error?: string }>;
      /** 停止 ai-sync */
      aiSyncStop(serviceId: AIServiceId): Promise<{ success: boolean; error?: string }>;
      /** main → renderer 推送:某 turn 完成,view 端追加到当前右槽 Note;返 unsubscribe */
      onAISyncAppendTurn(callback: (payload: AISyncAppendTurnPayload) => void): () => void;

      // ── X(Twitter)集成(阶段 1:右键 X webview 提取推文 → tweetBlock 落 Note) ──
      /** 按 guest viewport 坐标定位 + 抽该条推文 */
      xExtractTweet(
        serviceId: XServiceId,
        x: number,
        y: number,
        targetWcId?: number,
      ): Promise<{
        success: boolean;
        data?: {
          authorName?: string;
          authorHandle?: string;
          authorAvatar?: string;
          text?: string;
          createdAt?: string;
          lang?: string;
          media?: Array<{ type: 'image' | 'video'; url: string; thumbUrl?: string }>;
          metrics?: { replies?: number; retweets?: number; likes?: number; views?: number };
          quotedTweet?: string;
          inReplyTo?: string;
          tweetUrl?: string;
          tweetId?: string;
        };
        error?: string;
      }>;
      /** main → renderer 推送:X webview 原生右键「提取此推文」点击,带 guest 坐标;返 unsubscribe */
      onXExtractTweetRequest(
        callback: (payload: { serviceId: XServiceId; x: number; y: number }) => void,
      ): () => void;
      /** main → renderer 推送:宿主 iframe(tweet 卡片)弹 x.com 链接 → 改在 X webview 打开;返 unsubscribe */
      onXOpenTweetRequest(callback: (payload: { url: string }) => void): () => void;

      // ── X 集成 阶段 2(写方向:发推 / 回复 — 填充内容,用户点发布,绝不程序自动发布) ──
      /** 发推:把纯文本填进 X compose 框(返 success / publishReady,不代表已发布)。
       *  mediaUrls(阶段 2.5-b):note 图 media:// 数组,main 侧解析路径后先喂图再填字;
       *  mediaWarning 非空 = 文字落地但图没带上(fail loud 降级提示)。 */
      xPasteTweet(
        serviceId: XServiceId,
        text: string,
        targetWcId?: number,
        mediaUrls?: string[],
      ): Promise<{ success: boolean; error?: string; publishReady?: boolean; mediaWarning?: string }>;
      /** 回复:导航到目标推 + 把纯文本填进 reply 框(返 success / publishReady,不代表已发布)。
       *  mediaUrls(阶段 2.5-b):同 xPasteTweet。 */
      xPasteReply(
        serviceId: XServiceId,
        tweetUrl: string,
        text: string,
        targetWcId?: number,
        mediaUrls?: string[],
      ): Promise<{ success: boolean; error?: string; publishReady?: boolean; mediaWarning?: string }>;
      /** 拖拽:note 拖起,往指定 X guest 装 mousemove 监听(记录最后坐标)*/
      xDragArm(targetWcId: number): Promise<{ ok: boolean }>;
      /** 拖拽:松手,读回最后坐标 + 解析落点(compose / tweet / other / none)*/
      xDragResolve(
        serviceId: XServiceId,
        targetWcId: number,
      ): Promise<
        | { kind: 'compose' }
        | { kind: 'tweet'; author: string | null; statusHref: string | null; hasReplyButton: boolean }
        | { kind: 'other' }
        | { kind: 'none' }
      >;
      /** 拖拽落推文:就地点该推回复按钮弹 reply 框(不跳详情页)*/
      xDragReplyHere(
        serviceId: XServiceId,
        targetWcId: number,
      ): Promise<{ ok: boolean; error?: string }>;

      // ── Progress 反馈订阅(backup-restore + 未来长耗时任务共用) ──
      /** 任务开始 — 显示全屏覆盖层;返 unsubscribe */
      onProgressStart(callback: (payload: ProgressStartPayload) => void): () => void;
      /** 任务进度更新;返 unsubscribe */
      onProgressUpdate(callback: (payload: ProgressUpdatePayload) => void): () => void;
      /** 任务完成(success/error);返 unsubscribe */
      onProgressDone(callback: (payload: ProgressDonePayload) => void): () => void;
    };
  }
}

export {};
