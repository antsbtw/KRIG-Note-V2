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
} from './note-folder-types';
import type { PmAtomInfo, PmDocEnvelope } from './pm-content-types';
import type { ThoughtInfo, ThoughtAnchor, ThoughtSource } from './thought-types';
import type {
  AIAskOptions,
  AIAskResult,
  AIResponseReadyPayload,
  AIErrorPayload,
  AIStreamChunk,
  AISSEStatus,
} from './ai-types';
import type { AIServiceId } from '../types/ai-service-types';

declare global {
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
      /** 下载视频(走 spawn yt-dlp,自动抓 YouTube 字幕保存为 .en.srt)*/
      ytdlpDownload(
        url: string,
        outputPath?: string,
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
      /** L5-B3.19.e UX:检 webview partition 是否有 YouTube 登录 cookies */
      ytdlpCheckYoutubeCookies(): Promise<{
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

      // ── L5-C6:PDF 提取 → Note(KRIG Knowledge Platform)──
      /** 上传当前打开的 PDF → 返 { uploaded, md5?, platformUrl?, alreadyExists?, reason? } */
      extractionUpload(): Promise<unknown>;
      /** 主动触发 import(备用)*/
      extractionImport(data: unknown): Promise<unknown>;
      /** 订阅 main 推送的拦截到的 atom JSON */
      onExtractionNoteCreate(callback: (data: unknown) => void): () => void;

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
      noteGet(id: string): Promise<NoteInfo | null>;
      noteCreate(initialDoc: NoteDocEnvelope | null, folderId: string | null): Promise<NoteInfo>;
      noteUpdate(id: string, doc: NoteDocEnvelope): Promise<NoteInfo | null>;
      noteMove(noteId: string, newFolderId: string | null): Promise<void>;
      noteDelete(id: string): Promise<void>;
      /** main → renderer 推送:笔记列表变更;返 unsubscribe */
      onNoteListChanged(callback: (list: NoteInfo[]) => void): () => void;

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
      folderDelete(id: string): Promise<{
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

      // ── ai-conversation capability (V1 web-bridge AI 自动化 → V2 抽 capability) ──
      // 4 invoke + 3 broadcast 订阅 = 7 表面
      /** 给 AI 服务发 prompt 等完整 Markdown 回复;5 分钟无请求后台 webview 自动销毁 */
      aiAsk(
        serviceId: AIServiceId,
        prompt: string,
        options?: AIAskOptions,
      ): Promise<AIAskResult>;
      /** 把后台 webview 转前台 (AI View Host 用,本期占位返回 status) */
      aiOpenSession(
        serviceId: AIServiceId,
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
    };
  }
}

export {};
