/**
 * ai-conversation capability — 对外类型
 *
 * view 通过 requireCapabilityApi<AIConversationApi>('ai-conversation') 取 api;
 * driver/slot 内部消费可直 import 模块级 export(对齐 thought/note 同模式)。
 *
 * 横切定位:任何 view (note / ai-view / thought / ...) 都能 install 'ai-conversation'
 * 获得相同的"问 AI / 监听回复 / 错误"能力,与 thought capability 同性质。
 */

import type { ComponentType, Ref } from 'react';
import type { AIServiceId } from '@shared/types/ai-service-types';
import type {
  AIAskOptions,
  AIAskResult,
  AIResponseReadyPayload,
  AIErrorPayload,
  AISSEStatus,
} from '@shared/ipc/ai-types';

export type {
  AIServiceId,
  AIAskOptions,
  AIAskResult,
  AIResponseReadyPayload,
  AIErrorPayload,
  AISSEStatus,
};

export interface AIServiceListItem {
  id: AIServiceId;
  name: string;
  icon: string;
}

/** AI Host(嵌 claude.ai / chatgpt.com / gemini.google.com 的 webview)imperative API */
export interface AIHostHandle {
  /** 导航到指定服务的 newChatUrl(切服务用) */
  switchService(serviceId: AIServiceId): void;
  /** 重新加载当前页 */
  reload(): void;
  /** 取当前 URL */
  getURL(): string;
}

export interface AIHostProps {
  workspaceId: string;
  /** 当前显示的 AI 服务(controlled,view 从 per-ws state 取传入) */
  serviceId: AIServiceId;
  /** webview 容器 className */
  className?: string;
  /** 用户在 webview 内导航(SPA 路由切换)时回传 URL,view 决定是否持久化 */
  onUrlChanged?: (url: string) => void;
  /** loading 状态推送(view 显 spinner / toolbar 状态) */
  onLoadingChanged?: (loading: boolean) => void;
}

export interface AIConversationApi {
  // ── 业务方法 ──
  /** 给 AI 服务发 prompt 等完整 Markdown 回复 */
  askAI(serviceId: AIServiceId, prompt: string, options?: AIAskOptions): Promise<AIAskResult>;
  /** 把后台 webview 转前台 (AI View Host 用,本期占位) */
  openSession(serviceId: AIServiceId): Promise<{ success: boolean; error?: string }>;
  /** 取三服务清单 */
  getServiceList(): Promise<AIServiceListItem[]>;
  /** debug:SSE 拦截状态 */
  getSSEStatus(): Promise<AISSEStatus>;
  // ── 订阅 ──
  /** 订阅 AI 回复就绪(任意 askAI 完成时触发);返 unsubscribe */
  onResponseReady(callback: (payload: AIResponseReadyPayload) => void): () => void;
  /** 订阅 AI 调用失败;返 unsubscribe */
  onError(callback: (payload: AIErrorPayload) => void): () => void;
  // ── UI 组件 ──
  /**
   * AI Host(嵌三大 AI 服务网站的 webview)— forwardRef AIHostHandle
   *
   * 与 web-rendering Host 一样,封装 webview 生命周期 + 服务切换。
   * view 通过 ref imperative API 控制(switchService / reload / getURL)。
   */
  Host: ComponentType<AIHostProps & { ref?: Ref<AIHostHandle> }>;
}
