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

export type { XServiceId };

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
  /** 右键单条提取:按 guest viewport 坐标定位 + 抓全字段 → tweet 数据 */
  extractTweet(serviceId: XServiceId, x: number, y: number): Promise<XExtractTweetResult>;
  /** 订阅 X webview 原生右键菜单点击(main 推 guest 坐标);返 unsubscribe */
  onExtractTweetRequest(callback: (payload: XExtractTweetRequest) => void): () => void;
  // ── 写方向(阶段 2)— 填充内容,用户点发布 ──
  /**
   * 发推:把纯文本填进 X compose 框(用户随后手动点发布)。
   * @param targetWcId 指定注入目标 guest wc(本活跃 ws 的 X);省略 → main 回退全局 active。
   */
  pasteTweet(serviceId: XServiceId, text: string, targetWcId?: number | null): Promise<XWriteResult>;
  /**
   * 回复:导航到目标推 + 把纯文本填进 reply 框(用户随后手动点回复)。
   * @param targetWcId 指定注入目标 guest wc(本活跃 ws 的 X);省略 → main 回退全局 active。
   */
  pasteReply(
    serviceId: XServiceId,
    tweetUrl: string,
    text: string,
    targetWcId?: number | null,
  ): Promise<XWriteResult>;
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
  /**
   * X Host(嵌 x.com 的 webview)— forwardRef XHostHandle。
   * 封装 webview 生命周期 + per-ws partition + per-ws 代理接入。
   */
  Host: ComponentType<XHostProps & { ref?: Ref<XHostHandle> }>;
}
