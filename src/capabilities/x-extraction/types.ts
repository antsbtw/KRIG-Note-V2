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
  /**
   * X Host(嵌 x.com 的 webview)— forwardRef XHostHandle。
   * 封装 webview 生命周期 + per-ws partition + per-ws 代理接入。
   */
  Host: ComponentType<XHostProps & { ref?: Ref<XHostHandle> }>;
}
