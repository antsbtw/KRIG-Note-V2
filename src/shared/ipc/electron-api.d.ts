/**
 * window.electronAPI 类型声明(renderer 全局)
 *
 * 与 src/platform/main/preload/main-window-preload.ts 暴露的 API 对应。
 */

import type {
  DiagnosticsReportPayload,
  HealthCheckResponse,
  SystemFontEntryDTO,
} from './message-types';
import type { Profile, ProfileColor } from '../types/profile-types';
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
} from './note-batch-types';
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
import type { MailServiceId } from '../types/mail-service-types';
import type { MailAccount, MailRecord, MailSyncResult, MailTestResult } from '../types/mail-types';
import type { ArticlePlan, ArticleInsertStep } from './article-plan-types';
import type { ProxyNode, ProxyNodeType } from '../types/proxy-types';
import type { WebGlobalSettings } from '../types/web-settings-types';
import type {
  ProgressStartPayload,
  ProgressUpdatePayload,
  ProgressDonePayload,
  ProgressDrivePayload,
} from './backup-types';
import type {
  AuthState,
  AuthSendCodeInput,
  AuthRegisterInput,
  AuthLoginInput,
  AuthActionResult,
} from '../auth/auth-types';

interface XCaptureSnapshot {
  running: boolean;
  /** 此刻屏幕上的条数 */
  onScreenCount: number;
  /** 本轮跳过的广告等非推文元素 */
  skippedAds: number;
  /** 屏幕上滚过的条数(分母) */
  seenInDom: number;
  /** 实际采到的条数(分子) */
  captured: number;
  captureRate: number;
  /** DOM 见过但没采到的 —— 漏网名单 */
  missing: string[];
  payloads: number;
  elapsedSec: number;
  currentUrl?: string;
  scrollY?: number;
  /**
   * ⚠️ 2026-09-15 补全:此前只有 7 个字段,载荷里的
   * `inReplyToStatusId` / 完整 metrics / `self` 全被裁掉 —— 采到了却传不出来。
   * 契约两端必须同步改(main 的 MonitorSnapshot ↔ 这里 ↔ view 的 CaptureSnap)。
   */
  recent: Array<{
    tweetId: string;
    authorHandle?: string;
    authorRestId?: string;
    text: string;
    createdAt?: string;
    lang?: string;
    isReply: boolean;
    /** 回复的是哪一条(权威字段) */
    inReplyToStatusId?: string;
    inReplyToScreenName?: string;
    conversationId?: string;
    quotedStatusId?: string;
    hasMedia: boolean;
    mediaTypes?: string[];
    isLongText: boolean;
    metrics: {
      likes?: number; retweets?: number; replies?: number;
      quotes?: number; bookmarks?: number; views?: number;
    };
    self: { favorited?: boolean; retweeted?: boolean; bookmarked?: boolean };
    fromDom: boolean;
  }>;
}

interface NotifEvent {
  seenAt: string; notifiedAt?: string; kind: string; message?: string;
  actorHandle?: string; actorUid: string; targetId: string; targetText?: string;
  targetConversationId?: string; targetQuotedStatusId?: string; targetHasMedia?: boolean;
  isInteraction: boolean; belongsToArticle: boolean; belongsWhy: string;
}
interface NotifWatchSnapshot {
  running: boolean; articleId?: string; startedAt?: string;
  payloads: number; total: number; byKind: Record<string, number>;
  belongs: number; recent: NotifEvent[]; secondsSinceLastPayload?: number;
}

interface VerifyRow {
  uid: string; handle?: string; targetId: string;
  hasMedia?: boolean; why: string; text?: string;
}

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
      /**
       * ⭐ Web 能力层控制台(dev-only)—— 逐个原子能力单独跑,看**原样返回值**。
       *
       * ⚠️ 全部返回 `{ channelOk, result }`(channelOk=通道通不通,result.status=能力成不成),其中 `result` 是底座的**三态 Result**
       * (`ok` / `failed` / `degraded`)——**不要在 UI 里把它压成成功/失败两态**:
       * `degraded`(做了但不完整)当成功是「滚了个寂寞却报成功」,
       * 当失败会丢掉已滚出的进度。
       *
       * ⚠️ 生产构建下主侧不注册这些通道(`app.isPackaged` 时直接 return)。
       */
      webConsole?: {
        // ── 控制 ──
        ready(wcId: number | undefined, criterion: unknown, timeoutMs?: number): Promise<{
          channelOk: boolean; error?: string; pageId?: string; result?: unknown;
        }>;
        scrollUntil(wcId: number | undefined, stop: unknown, options?: unknown): Promise<{
          channelOk: boolean; error?: string; pageId?: string; result?: unknown;
        }>;
        tap(wcId: number | undefined, anchor: string, settle?: unknown): Promise<{
          channelOk: boolean; error?: string; pageId?: string; result?: unknown;
        }>;
        press(wcId: number | undefined, key: string): Promise<{
          channelOk: boolean; error?: string; pageId?: string; result?: unknown;
        }>;
        hover(wcId: number | undefined, anchor: string): Promise<{
          channelOk: boolean; error?: string; pageId?: string; result?: unknown;
        }>;
        // ── 输入 ──
        type(wcId: number | undefined, anchor: string, text: string, check?: unknown): Promise<{
          channelOk: boolean; error?: string; pageId?: string; result?: unknown;
        }>;
        /**
         * ⭐ 语义导航:传**页面名 + 参数**,不传 URL(URL 是 adapter 的知识)。
         * 站点改版时改 `x-pages.ts`,面板一个字不用动。
         */
        goto(wcId: number | undefined, name: string, params?: Record<string, string>, timeoutMs?: number): Promise<{
          channelOk: boolean; error?: string; pageId?: string; result?: unknown;
        }>;
        // ── 输出 ──
        pages(): Promise<{ channelOk: boolean; pages?: Array<{ pageId: string; alive: boolean }> }>;
        /** 已注册的语义页面名 —— 下拉读真表,不抄一份 */
        pageNames(): Promise<{
          channelOk: boolean; tables?: Array<{ owner: string; names: string[] }>;
          /** ⭐ 每页要哪些参数 —— 面板据此渲染输入框,不在面板里写死清单 */
          paramsOf?: Record<string, readonly string[]>;
          /** ⭐ 人话页名 —— 下拉显示「单条推文详情(含回复)」而不是 `x.status` */
          labelsOf?: Record<string, string>;
          /**
           * ⭐ 哪些页面是**采人**的(followers/following 那几页)。
           * 面板据此决定「快速增量」露不露 —— 它靠「上次采过的人」判早停,
           * 在不采人的页面上会静默退回全量(按钮像个选择,其实没变)。
           */
          peoplePages?: readonly string[];
        }>;
        anchors(): Promise<{
          channelOk: boolean; owners?: string[];
          tables?: Array<{ owner: string; names: string[] }>;
        }>;
        // ── 执行(第四类:对象=模型,不是页面)──
        /**
         * ⭐ 跑一次执行者。判据(instruction)与素材(content)都由**调用方给** ——
         * 主侧不内置任何业务判据,「该不该回」与「该不该点赞」走同一个执行者。
         * ⚠️ 没有 wcId:执行者不碰浏览器,也**不写库**(所以面板上随便跑都安全)。
         */
        execute(args: {
          model: string; instruction: string;
          /** 卷宗主体 —— 判的就是它(如推文正文)。空主体是 Failed,不是「缺附件」 */
          content: string;
          /** 卷宗附件:键=附件名(推主概况/上下文/会话串…),值=已取到的内容 */
          attachments?: Record<string, unknown>;
          /**
           * ⭐ 没取到的附件名单 —— 执行者据此返回 `degraded`:「判了,但没看全」。
           * ⚠️ 由**编排**从各取数执行者的失败汇总,不是判断执行者自己去查。
           */
          missing?: string[];
          structured?: boolean; timeoutMs?: number; endpoint?: string;
        }): Promise<{ channelOk: boolean; error?: string; result?: unknown }>;
        /**
         * ⭐ 卷宗盘点 —— 「附件实际能取到多少」用真数字回答(只读不写)。
         * 用它回答「卷宗能有多厚」,而不是靠读代码推断。
         */
        inventory(): Promise<{
          channelOk: boolean; error?: string;
          inventory?: {
            tweets: number; authorsSeen: number; authorRows: number; at: string;
            attachments: Array<{ name: string; have: number; total: number; rate: number; note: string }>;
          };
        }>;
        /** ⭐ 真页面上量蓝V徽章的 DOM 结构 —— 实测过才写进提取代码,不猜 */
        readVerified(wcId?: number): Promise<{
          channelOk: boolean; error?: string;
          rows?: Array<{ handle?: string; userNameHtml?: string; marks?: unknown[] }>;
        }>;
        /**
         * ⭐⭐ 无人工采集 —— 导航 + 滚动 + 解析载荷 + 入库,一次跑完。
         * 关系/蓝V 在载荷里就有,但**要有新请求**才截得到,所以必须主动导航。
         */
        /**
         * ⭐ 当前页面是哪个语义页面 + 参数 —— 让右边跟着左边走。
         * 认不出来时 page 为 null(可能在设置页之类),不猜。
         */
        whereAmI(wcId?: number): Promise<{
          channelOk: boolean; error?: string; url?: string;
          page?: { name: string; params: Record<string, string> } | null;
        }>;
        /**
         * ⭐⭐ **停止正在跑的采集** —— 协作式:置标志,循环到下一个检查点自己退出。
         * 已采到的**照常入库+落留痕**,报告里写明「是人停的,不是采完了」。
         */
        stopCollect(args: { wsId?: string }): Promise<{
          channelOk: boolean; error?: string; stopping?: boolean;
        }>;
        /**
         * ⭐⭐ **跑一份编排档** —— 四步串起来,每步落一条 flow_step_run。
         * ⚠️ 不传 recipe = 用默认的四步档(搜索→采集→判断→拟回复)。
         */
        /**
         * ⭐ 订阅编排进度 —— 每步**开始**和**结束**各回调一次。
         * ⚠️⚠️ 回调里必须核对 `wsId`:广播发给所有 renderer,
         * 不核对会「A 窗口的进度显示在 B 窗口」。
         * @returns 取消订阅的函数
         */
        onFlowProgress(cb: (p: {
          runId: string; wsId?: string; flowName: string;
          seq: number; total: number; stepId: string; label: string;
          status: 'running' | 'ok' | 'failed' | 'skipped';
          produced?: number; note?: string; error?: string; elapsedMs?: number;
        }) => void): () => void;
        runFlow(args: { wsId?: string; wcId?: number; recipe?: unknown }): Promise<{
          channelOk: boolean; error?: string;
          report?: {
            runId: string; flowName: string; ok: boolean;
            /** 哪一步断的 —— 空 = 全跑完了 */
            failedAt?: string; elapsedMs: number;
            steps: Array<{
              id: string; kind: string; label: string;
              /** ⚠️ skipped 要看 note 才知道是「前面断了」「人停的」还是「档里关掉」 */
              status: 'ok' | 'failed' | 'skipped';
              /** ⭐ 与 status 分开:产出 0 不等于失败 */
              produced: number;
              error?: string; note?: string; elapsedMs: number;
            }>;
          };
        }>;
        autoCollect(args: {
          /**
           * ⚠️ 传**语义页面名**(如 x.home),不传 URL —— URL 是 adapter 的知识。
           * ⭐ 采当前页时可省略(配 current:true)。
           */
          page?: string;
          /** ⭐ 采**当前页面**,不导航 —— 人已经点到那个人页面上了 */
          current?: boolean;
          params?: Record<string, string>;
          wcId?: number; maxRounds?: number;
          /** 时间预算(ms)。⚠️ 调轮数必须一起调它,否则预算先到点,轮数用不完 */
          budgetMs?: number;
          /**
           * ⭐ 游标翻页上限(默认 40)。**采人的页面**用 ——
           * 滚动只用来抄 X 自己的请求,之后直接换游标重放,快几十倍。
           */
          pageBudget?: number;
          wsId?: string;
          /**
           * ⭐⭐ **快速增量** —— 只翻到「遇见上次全量采过的人」为止。
           * 17 分钟 → 十几秒。依据是 2026-09-19 实测的排序证据
           * (followers 严格按关注时间倒序,新人只在最前面)。
           * ⚠️ 它**看不见取关**,且**不写快照**(基线只由全量维护)。
           */
          fastIncremental?: boolean;
        }): Promise<{
          channelOk: boolean; error?: string;
          report?: {
            url: string; tweets: number; fromPayload: number; saved: number;
            authorsWithRelation: number; authorsWithBio: number;
            /** ⭐ 「采人」产出:关注者/关注中页面采到的人 */
            people: number; peopleWithBio: number; peopleWithRelation: number;
            payloads: number; problems: string[]; stopReason: string; elapsedMs: number;
            /** ⭐ 事实性说明(如「这一页没有推文」)—— 与 problems(链路坏了)分开 */
            notes: string[];
            /** ⭐ 解不出推文的载荷样本 —— 给「量结构」用(写新解析器前先看真实结构) */
            unparsedSamples: Array<{ op: string; bytes: number; body: string }>;
            /** ⭐ 见过的全部 GraphQL 操作(名 + 大小) */
            seenOps: Array<{ op: string; bytes: number }>;
            /** 实际滚了几轮 —— 事实 */
            rounds: number;
            /** ⭐ 游标翻了几页 —— 0 表示只靠滚动(不是采人页,或抄不到请求) */
            pagedRounds?: number;
            /** ⭐ 没翻页的话是哪一条入口条件不成立 —— 四种断法必须分得开 */
            pagingSkipped?: string;
            failedUrl?: string;
            capturedUrl?: string;
            /** ⭐ 采完了没有 —— X 说的(游标耗尽),不是「滚不动了」 */
            paging: { hasMore: boolean; cursor?: string };
            /** ⭐ 基准对账:采到的 vs X 报的总数 */
            reconcile?: { baseline?: number; got: number; rate?: number; note: string };
            /**
             * ⭐⭐ 快速增量的成果与边界。
             * ⚠️ `caughtUp=false` = **没追上**,新人可能没翻完,
             * 这时 `newcomers` 不能当成「这段时间的全部新增」。
             */
            fast?: {
              knownBaseline: number; caughtUp: boolean; newcomers: string[];
              lastFullRunAt?: string; daysSinceFullRun?: number;
            };
            /** ⭐ 日期跨度与空洞 —— **事实**,采集层不解释成「漏采」(首页是算法混排) */
            dateSpan: { oldest?: string; newest?: string; days: number; gaps: string[] };
            /** ⭐ 字段级覆盖率 —— 「每一条数据都是完整的吗」靠它回答,不是靠总数 */
            coverage: Array<{ field: string; have: number; total: number; rate: number }>;
            /** ⭐ 逐条明细(前 40 条)—— 人要能逐条检查 */
            sample: Array<{ tweetId: string; handle?: string; missing: string[]; fromDom: boolean }>;
          };
        }>;
        /** ⭐ 探 X 页面内存里的 user 数据在哪个全局变量下(只探不取) */
        probeMemory(wcId?: number): Promise<{
          channelOk: boolean; error?: string; probe?: unknown;
        }>;
        readTabBar(wcId?: number): Promise<{
          channelOk: boolean; error?: string;
          tabs?: Array<{ testid: string | null; href: string | null; label: string }>;
        }>;
        /**
         * ⭐ 读回诊断留痕。`sinceMs` = 往前多少毫秒(不传则全部)。
         * ⚠️ 同时给内存与磁盘两份计数 —— 对不上就说明落盘坏了。
         */
        trace(sinceMs?: number): Promise<{
          channelOk: boolean;
          memory?: {
            degradations: unknown[]; recoveries: unknown[];
            dropped: Record<string, number>;
            formatDriftByCapability: Record<string, number>;
          };
          disk?: {
            degradationCount: number; badLines: number;
            shards: Record<string, number>;
          };
        }>;
      };
      reportAlive(payload: DiagnosticsReportPayload): void;
      health(layer: 'L0' | 'L1' | 'L2' | 'L3' | 'L3.5' | 'L4' | 'L5' | 'platform'): Promise<HealthCheckResponse>;
      /** 系统主题变化订阅，返回取消订阅函数 */
      onNativeThemeChanged(callback: (payload: { dark: boolean }) => void): () => void;
      /** 主动查询当前系统主题（来自主进程 nativeTheme.shouldUseDarkColors，权威值） */
      getNativeTheme(): Promise<{ dark: boolean }>;
      /** 订阅窗口全屏状态变化,返回取消订阅函数 */
      onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void;
      /** 多窗口：renderer 主动拉取自己绑定的 wsId（push 方式竞态时的补偿路径）*/
      onWindowWsId(callback: (wsId: string) => void): () => void;
      /** 多窗口：renderer 主动 invoke 获取自己的 wsId（最可靠路径）*/
      getWindowWsId(): Promise<string | null>;
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

      /** L5-G7.1:扫本机系统字体(可选字体清单;.ttc 已展开为 per-subfont 条目) */
      fontListSystem(): Promise<{
        success: boolean;
        error?: string;
        fonts: SystemFontEntryDTO[];
      }>;
      /** L5-G7b:按 family 名读字体二进制(记名方案;没装该字体 → null,渲染层回退打包字体) */
      fontReadByName(family: string, bold?: boolean): Promise<ArrayBuffer | null>;
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
        /** { wsId, slot } — 导入即打开时,EBOOK_LOADED 按它定向到发起的那一栏 */
        requester?: unknown,
      ): Promise<unknown>;
      /** 打开书 — 加载到 main 内存 + 通知 EBOOK_LOADED(按 requester 定向)*/
      ebookBookshelfOpen(id: string, requester?: unknown): Promise<unknown>;
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
      // ── diglot mind v0(方案 B1:独立表,共用 graph 文件夹)──
      mindList(): Promise<unknown>;
      mindLoad(id: string): Promise<unknown>;
      mindCreate(
        title: string,
        semantic: string,
        graphic: string,
        folderId: string | null,
      ): Promise<unknown>;
      mindSave(id: string, semantic: string, graphic: string, title: string): Promise<void>;
      mindDelete(id: string): Promise<void>;
      mindRename(id: string, title: string): Promise<void>;
      mindMoveToFolder(id: string, folderId: string | null): Promise<void>;
      mindDuplicate(id: string): Promise<unknown>;
      onMindListChanged(callback: (list: unknown) => void): () => void;

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
      noteUpdate(id: string, doc: NoteDocEnvelope, clientId?: string, wsId?: string, expectedVersion?: number): Promise<NoteInfo | null>;
      noteMove(noteId: string, newFolderId: string | null): Promise<void>;
      noteDelete(id: string, opts?: { progressTaskId?: string }): Promise<void>;
      /** Phase 1 多窗口 merge:保存前拉取数据库当前版本快照(轻量,不 assemble 全文) */
      noteGetVersionInfo(id: string): Promise<{ docVersion: number; docHash: string; blockHashes: Record<string, string> } | null>;
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
      /**
       * Phase 1 多窗口 merge:其他窗口写成功后广播的 blockHashes 基线更新;返 unsubscribe。
       * 收到后更新本窗口的 baseSnapshot（不覆盖本地编辑，只更新基线）。
       */
      onNoteBaseSnapshotUpdated(
        callback: (payload: { noteId: string; docVersion: number; docHash: string; blockHashes: Record<string, string>; fromSession: string }) => void,
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

      /** main → renderer 推送:宿主 iframe(tweet 卡片)弹 x.com 链接 → 改在 X webview 打开;返 unsubscribe */
      onXOpenTweetRequest(callback: (payload: { url: string }) => void): () => void;

      // ── 邮箱模块(阶段 0:右键邮箱 webview 提取单封邮件 → note) ──
      /** 按 guest viewport 坐标定位 + 抽该封邮件(主题/正文/发件人,纯文本) */
      /**
       * ⭐ renderer → web.dom:跑一段**预注册脚本**。
       * ⚠️ 第二参是 scriptId **不是脚本文本** —— 拼不出坏脚本。
       * ⚠️⚠️ 没有 runDynamic(求值任意脚本不对 renderer 开放)。
       */
      /** ⭐ 调底座的一个原子能力(控制 / DOM)。goto 只收语义页面名不收 URL */
      webDomInvoke(
        payload: import('./web-dom-types').WebDomInvoke,
      ): Promise<import('./web-dom-types').WebDomResult>;
      /** ⭐ 列已注册的语义页面名(Console 下拉用,从真表读) */
      webPageListNames(): Promise<Array<{ owner: string; names: string[] }>>;
      webDomRun(
        pageRef: { wcId: number },
        scriptId: string,
        params?: Readonly<Record<string, string | number | boolean>>,
      ): Promise<import('./web-dom-types').WebDomResult>;
      mailExtract(
        serviceId: MailServiceId,
        x: number,
        y: number,
        targetWcId?: number,
      ): Promise<{
        success: boolean;
        data?: {
          subject?: string;
          bodyText?: string;
          from?: string;
          date?: string;
          sourceUrl?: string;
        };
        error?: string;
      }>;
      /** main → renderer 推送:邮箱 webview 原生右键「提取此邮件」点击,带 guest 坐标;返 unsubscribe */
      onMailExtractRequest(
        callback: (payload: { serviceId: MailServiceId; x: number; y: number }) => void,
      ): () => void;

      // ── 邮箱 阶段 1(IMAP 只读同步) ──
      /** 列出本 ws 的邮箱账号(不含密码) */
      mailAccountList(wsId: string): Promise<MailAccount[]>;
      /** 新建账号。password 明文入参,main 侧 safeStorage 加密,不入 DB */
      mailAccountCreate(payload: {
        wsId: string;
        serviceId: MailServiceId;
        email: string;
        imapHost: string;
        imapPort: number;
        imapSecure: boolean;
        password: string;
        smtpHost?: string;
        smtpPort?: number;
      }): Promise<{ success: boolean; account?: MailAccount; error?: string }>;
      /** 删账号(连带清密码/邮件/游标) */
      mailAccountDelete(accountId: string): Promise<{ success: boolean; error?: string }>;
      /** 改密码(safeStorage 覆写,不动 DB;内部去空白) */
      mailAccountSetPassword(
        accountId: string,
        password: string,
      ): Promise<{ success: boolean; error?: string }>;
      /** 测试连接 + 列 mailbox */
      mailAccountTest(accountId: string): Promise<MailTestResult>;
      /** 增量同步一个 mailbox */
      mailSync(accountId: string, mailbox?: string): Promise<MailSyncResult>;
      /** 列邮件(日期倒序,分页) */
      mailList(accountId: string, mailbox?: string, limit?: number, offset?: number): Promise<MailRecord[]>;
      /** 取单封全文 */
      mailGet(mailId: string): Promise<MailRecord | null>;

      /** 发推:把纯文本填进 X compose 框(返 success / publishReady,不代表已发布)。
       *  mediaUrls(阶段 2.5-b):note 图 media:// 数组,main 侧解析路径后先喂图再填字;
       *  mediaWarning 非空 = 文字落地但图没带上(fail loud 降级提示)。 */
      /** 回复:导航到目标推 + 把纯文本填进 reply 框(返 success / publishReady,不代表已发布)。
       *  mediaUrls / videoUrls(阶段 2.5-b):同 xPasteTweet。 */
      /** 发长文:驱动 X 原生 Insert(终态,2026-06-13)。plan = renderer buildArticlePlan 产物。
       *  ⚠️ 只插内容,绝不程序点 Publish。warnings 非空 = 部分块降级/失败(fail loud,用户手动补)。 */

      // ── 账号登录 + 归因(本期不做授权) ──
      // renderer 永远只拿 public AuthState(不含 token);邮箱注册两步(先 authSendCode 拿码)。
      /** 取当前 public 登录态(不含 token)*/
      authGetState(): Promise<AuthState>;
      /** 发邮箱验证码(注册前置步骤,purpose=register)*/
      authSendCode(input: AuthSendCodeInput): Promise<AuthActionResult>;
      /** 注册(email+password+6 位 code);成功后 result.state 为最新登录态 */
      authRegister(input: AuthRegisterInput): Promise<AuthActionResult>;
      /** 登录(老用户,email+password);成功后 result.state 为最新登录态 */
      authLogin(input: AuthLoginInput): Promise<AuthActionResult>;
      /** 登出 + 清本地 token,回 anonymous */
      authLogout(): Promise<void>;
      /** 刷 token(轮换;启动 / 恢复前台时)*/
      authRefresh(): Promise<AuthActionResult>;
      /** main → renderer 推送:登录态变化(登录/登出/刷新);返 unsubscribe */
      onAuthChanged(callback: (state: AuthState) => void): () => void;

      // ── Progress 反馈订阅(backup-restore + 未来长耗时任务共用) ──
      /** 任务开始 — 显示全屏覆盖层;返 unsubscribe */
      onProgressStart(callback: (payload: ProgressStartPayload) => void): () => void;
      /** 任务进度更新;返 unsubscribe */
      onProgressUpdate(callback: (payload: ProgressUpdatePayload) => void): () => void;
      /** 任务完成(success/error);返 unsubscribe */
      onProgressDone(callback: (payload: ProgressDonePayload) => void): () => void;

      // ── Window Profile ──
      profileList(): Promise<Profile[]>;
      profileGet(id: string): Promise<Profile | null>;
      profileCreate(input: { name: string; color: ProfileColor; proxyId?: string; userAgent?: string }): Promise<Profile>;
      profileUpdate(id: string, patch: Partial<{ name: string; color: ProfileColor; proxyId: string; userAgent: string }>): Promise<Profile | null>;
      profileDelete(id: string): Promise<void>;
      onProfileListChanged(callback: (list: Profile[]) => void): () => void;

      // ── Workspace 楼长 IPC（S3-a）──
      workspaceCreate(label?: string): Promise<unknown>;
      workspaceClose(id: string): Promise<void>;
      workspaceRemove(id: string): Promise<void>;
      workspaceOpen(id: string): Promise<void>;
      workspaceRename(id: string, label: string): Promise<void>;
      workspaceSetActive(id: string): Promise<void>;
      workspaceGetState(): Promise<unknown>;
      workspaceSetConfig(wsId: string, config: { color?: string; proxyId?: string | null; userAgent?: string | null }): Promise<void>;
      workspacePersistState(wsId: string, patch: Record<string, unknown>): void;
      /** main → renderer 广播：ws 状态变化；返 unsubscribe */
      onWorkspaceStateChanged(callback: (state: unknown) => void): () => void;

    };
  }
}

export {};
