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

/** Phase 10.B:整页对话提取结果 */
export interface AIExtractFullResult {
  success: boolean;
  /** 多 turn 拼接后的完整 markdown(成功时)— view 层调 aiMarkdownToNoteDoc 转 PM doc */
  markdown?: string;
  title?: string;
  model?: string;
  turnCount?: number;
  artifactCount?: number;
  error?: string;
}

/** AI Host(嵌 claude.ai / chatgpt.com / gemini.google.com 的 webview)imperative API */
export interface AIHostHandle {
  /** 导航到指定服务的 newChatUrl(切服务用) */
  switchService(serviceId: AIServiceId): void;
  /** 重新加载当前页 */
  reload(): void;
  /** 取当前 URL */
  getURL(): string;
  /**
   * 把 prompt 粘贴到 AI 输入框并自动发送(走 main 进程 writer.ts pasteText + clickSend)。
   *
   * 用于 Note "🤖 问 AI" 把 selection markdown 自动送进 AI 对话框。
   *
   * 行为:
   * - 如 webview 未 dom-ready,Host 内部缓存,dom-ready 后自动 paste+send;
   *   多次调用以最后一次 prompt 为准。
   * - serviceId 不传时用当前显示的 serviceId(props 传入);若传则先切服务再发。
   *
   * 返 Promise,resolve 时表示 paste+send 已派发(不等 AI 回复完成)。
   */
  pasteAndSend(prompt: string, serviceId?: AIServiceId): Promise<void>;
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
  /** 取 SSE 缓存最新一次 AI 完整回复 markdown(供"提取整页对话"用) */
  getLatestResponse(): Promise<string | null>;
  /** Phase 10.B:整页对话提取(多 turn + artifact + 图片)— 提取按钮主路径 */
  extractFull(serviceId: AIServiceId): Promise<AIExtractFullResult>;
  // ── pending thought 路由(场景 A: Note Ask AI 用) ──
  /** 在 Note Ask AI 流程发送时调,把已创建的 ai-response thought atom id 暂存,
   *  供后续"提取整页对话"按钮取出 update 而非重复 createNew */
  setPendingAIThought(serviceId: AIServiceId, thoughtId: string): void;
  /** 消费 pending(取出 + 清):提取按钮 必调 */
  consumePendingAIThought(serviceId: AIServiceId): string | null;
  /** 仅取不删:cancel / 诊断用 */
  peekPendingAIThought(serviceId: AIServiceId): string | null;
  /** 清 pending(panel cancel 路径用,删 atom 后清掉 pending 防止下一轮误用) */
  clearPendingAIThought(serviceId: AIServiceId): void;
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
