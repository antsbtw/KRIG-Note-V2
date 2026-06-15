/**
 * x-extraction capability — 对外类型(阶段 0/1)
 *
 * 铁律 3(profile 独立):与 ai-extraction 的 AIConversationApi 完全分开。X 的语义是
 * 「读推文(本阶段)/ 发推文(阶段 2)」,不复用 AI 的问答 API。
 *
 * view 通过 requireCapabilityApi<XExtractionApi>('x-extraction') 取 api。
 */

import type { ComponentType, CSSProperties, Ref } from 'react';
import type { XServiceId } from '@shared/types/x-service-types';
import type { RenderableBlock } from '@drivers/text-editing-driver/serializers/collect-renderable-blocks';
import type { ArticlePlan } from '@drivers/text-editing-driver/serializers/note-to-article-plan';
import type { RenderBlocksResult } from './render-blocks-to-media';

export type { XServiceId };
export type { RenderableBlock };
export type { ArticlePlan };
export type { RenderBlocksResult, RenderedBlockMedia, BlockRenderFailure } from './render-blocks-to-media';

/** 驱动 X 原生 Insert 发长文结果(终态,2026-06-13)。 */
export interface XDriveArticleResult {
  success: boolean;
  error?: string;
  /** 成功驱动的 step 数。 */
  drivenSteps?: number;
  /** 单 step 降级/失败汇总(非空 = 部分块没成功,用户需在 X 手动补;fail loud)。 */
  warnings?: string[];
}

/** 抓到的推文字段(与主进程 XTweetData / tweet-block schema attrs 对齐)*/
export interface XTweetData {
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
}

/** 右键提取推文结果 */
export interface XExtractTweetResult {
  success: boolean;
  data?: XTweetData;
  error?: string;
}

/** 原生右键菜单点击推送 payload(guest viewport 坐标)*/
export interface XExtractTweetRequest {
  serviceId: XServiceId;
  x: number;
  y: number;
}

/** 写方向注入结果(发推 / 回复)— 阶段 2 */
export interface XWriteResult {
  success: boolean;
  error?: string;
  /** 发布按钮是否已就位(辅助确认内容落进正确的框,不代表已发布)*/
  publishReady?: boolean;
  /**
   * 媒体降级提示(阶段 2.5-b):文字落地但喂图失败 / 部分图无法解析时附带。
   * 非空 = view 侧应明示「文字已填入,但图没带上,请手动拖图」(fail loud,不假装成功)。
   */
  mediaWarning?: string;
}


/** 拖拽落点解析结果(拖 note block 到 X 松手时,guest 内 elementFromPoint 定位)*/
export type XDropTarget =
  | { kind: 'compose' }
  | { kind: 'tweet'; author: string | null; statusHref: string | null; hasReplyButton: boolean }
  | { kind: 'other' }
  | { kind: 'none' };

/** X Host(嵌 x.com 的 webview)imperative API */
export interface XHostHandle {
  /** 导航到 homeUrl(刷新到主页) */
  goHome(): void;
  /** 导航到任意 X URL(tweet block「Open original」在 X webview 内打开原推用) */
  navigate(url: string): void;
  /** 重新加载当前页 */
  reload(): void;
  /** 取当前 URL */
  getURL(): string;
  /** 取 guest webContents id(注入按 ws 定向用);未 dom-ready / 取不到返 null */
  getWebContentsId(): number | null;
}

export interface XHostProps {
  workspaceId: string;
  /** X webview 容器 className */
  className?: string;
  /** webview 容器 inline style(AI/X 共存切显隐用 display) */
  style?: CSSProperties;
  /** 用户在 webview 内导航(SPA 路由)时回传 URL,view 决定是否显示 */
  onUrlChanged?: (url: string) => void;
  /** loading 状态推送(toolbar spinner 用) */
  onLoadingChanged?: (loading: boolean) => void;
}

export interface XExtractionApi {
  /**
   * 右键单条提取:按 guest viewport 坐标定位 + 抓全字段 → tweet 数据。
   * targetWcId:本活跃 ws 的 X Host guest wcId(命令侧经 getXHostWcId 取出后透传,
   * 按活跃 ws 定向,治多 X 实例串扰;收口 ②)。
   */
  extractTweet(
    serviceId: XServiceId,
    x: number,
    y: number,
    targetWcId?: number | null,
  ): Promise<XExtractTweetResult>;
  /** 订阅 X webview 原生右键菜单点击(main 推 guest 坐标);返 unsubscribe */
  onExtractTweetRequest(callback: (payload: XExtractTweetRequest) => void): () => void;
  // ── 写方向(阶段 2)— 填充内容,用户点发布 ──
  /**
   * 发推:把纯文本填进 X compose 框(用户随后手动点发布)。
   * @param targetWcId 指定注入目标 guest wc(本活跃 ws 的 X);省略 → main 回退全局 active。
   * @param mediaUrls 媒体 media:// URL 数组(阶段 2.5-b,路线 B);main 侧解析磁盘路径后
   *   先喂图(等缩略图)再填字。喂图失败 → result.mediaWarning(文字仍填,fail loud)。
   */
  pasteTweet(
    serviceId: XServiceId,
    text: string,
    targetWcId?: number | null,
    mediaUrls?: string[],
    /**
     * 视频源数组(阶段 2.5-b 视频,路线 B):media:// 或磁盘绝对路径(ytdlp localFilePath)。
     * main 侧解析后走**视频喂文件**(feedVideoToInput,转码 poll)。与 mediaUrls 互斥
     *(X 不许图视频混发,view 侧已收口为「有视频则不传图」)。喂失败 → result.mediaWarning。
     */
    videoUrls?: string[],
  ): Promise<XWriteResult>;
  /**
   * 回复:导航到目标推 + 把纯文本填进 reply 框(用户随后手动点回复)。
   * @param targetWcId 指定注入目标 guest wc(本活跃 ws 的 X);省略 → main 回退全局 active。
   * @param mediaUrls 同 pasteTweet(阶段 2.5-b)。
   * @param videoUrls 同 pasteTweet(阶段 2.5-b 视频)。
   */
  pasteReply(
    serviceId: XServiceId,
    tweetUrl: string,
    text: string,
    targetWcId?: number | null,
    mediaUrls?: string[],
    videoUrls?: string[],
  ): Promise<XWriteResult>;
  /**
   * 发长文:驱动 X 原生 Insert 菜单逐 block 插入(终态,2026-06-13)。
   * plan 由 note 侧 buildArticlePlan 产(title + 有序 steps)。
   * ⚠️ 写方向红线:只插内容,绝不程序点 Publish —— 用户在 X 编辑器看成品 + 手动发布。
   * warnings 非空 = 部分块降级/失败(fail loud,提示用户手动补)。
   */
  driveArticle(
    serviceId: XServiceId,
    plan: ArticlePlan,
    targetWcId?: number | null,
    /** 进度 overlay 的 taskId(传则 main 逐 step 推 PROGRESS_UPDATE)。 */
    taskId?: string,
  ): Promise<XDriveArticleResult>;
  // ── X Host wc 按 ws 登记(注入按活跃 ws 定向,治多实例串扰)──
  /** 登记某 ws 的 AI-view X Host guest wc id(AIView 调)*/
  registerXHostWcId(wsId: string, wcId: number): void;
  /** 清除某 ws 的登记(AIView 卸载调)*/
  clearXHostWcId(wsId: string): void;
  /** 取某 ws 的 X Host guest wc id(send-to-x 注入定向用);未登记返 null */
  getXHostWcId(wsId: string): number | null;
  // ── 拖拽落点(拖 note block 到 X)──
  /** note 拖起:往指定 X guest(targetWcId)装 mousemove 监听记录最后坐标 */
  dragArm(targetWcId: number): Promise<void>;
  /** 松手:读回最后坐标 + 解析落点(compose / tweet / other / none)*/
  dragResolve(serviceId: XServiceId, targetWcId: number): Promise<XDropTarget>;
  /** 落推文:就地点该推回复按钮弹 reply 框(不跳详情页),返就绪与否 */
  dragReplyHere(serviceId: XServiceId, targetWcId: number): Promise<{ ok: boolean; error?: string }>;
  // ── 不支持格式渲染成图(X 截图,2026-06):公式/代码/Mermaid → media:// 附件 ──
  /**
   * 把「纯文本装不下」的 block(公式/代码/Mermaid)渲染成图,存进 media store,
   * 返回 media:// URL(走 2.5-b 附件管道)。失败的记 failed(fail loud,正文退源码)。
   * 入参 blocks 由 textEditing.api.get*RenderableBlocks 取(与 markdown 同源)。
   */
  renderBlocksToMedia(blocks: RenderableBlock[]): Promise<RenderBlocksResult>;
  /**
   * X Host(嵌 x.com 的 webview)— forwardRef XHostHandle。
   * 封装 webview 生命周期 + per-ws partition + per-ws 代理接入。
   */
  Host: ComponentType<XHostProps & { ref?: Ref<XHostHandle> }>;
}
