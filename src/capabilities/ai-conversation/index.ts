/**
 * ai-conversation capability — renderer 端薄包装
 *
 * 实施位置:src/platform/main/ai/(handlers + ask-orchestrator + interceptor + ...)
 * 本文件:把 window.electronAPI.aiXxx 扁平驼峰 alias 成业务方法 + 暴露 Host 组件
 *
 * 边界(对齐 thought capability v0.5 §7.1):
 * - view 业务路径走 requireCapabilityApi<AIConversationApi>('ai-conversation')(W5 严格态 A 硬约束)
 * - 模块级 export 同时保留(driver/slot 内部消费可直 import)
 *
 * 横切定位:同一能力对所有 install 它的 view 完全一致;
 * 所有 view(note / ai-view / thought / ...)通过 install 'ai-conversation' 获得相同 API。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type {
  AIConversationApi,
  AIServiceId,
  AIAskOptions,
  AIAskResult,
  AIResponseReadyPayload,
  AIErrorPayload,
  AISSEStatus,
  AIServiceListItem,
} from './types';
import { Host } from './Host';
import {
  setPendingAIThought,
  consumePendingAIThought,
  peekPendingAIThought,
  clearPendingAIThought,
} from './pending-thought';

export type {
  AIConversationApi,
  AIServiceId,
  AIAskOptions,
  AIAskResult,
  AIResponseReadyPayload,
  AIErrorPayload,
  AISSEStatus,
  AIServiceListItem,
  AIHostHandle,
  AIHostProps,
} from './types';

async function askAI(
  serviceId: AIServiceId,
  prompt: string,
  options?: AIAskOptions,
): Promise<AIAskResult> {
  return window.electronAPI.aiAsk(serviceId, prompt, options);
}

async function openSession(
  serviceId: AIServiceId,
): Promise<{ success: boolean; error?: string }> {
  const r = await window.electronAPI.aiOpenSession(serviceId);
  return { success: r.success, error: r.error };
}

async function getServiceList(): Promise<AIServiceListItem[]> {
  return window.electronAPI.aiServiceList();
}

async function getSSEStatus(): Promise<AISSEStatus> {
  return window.electronAPI.aiSSEStatus();
}

async function getLatestResponse(): Promise<string | null> {
  return window.electronAPI.aiGetLatestResponse();
}

function onResponseReady(
  callback: (payload: AIResponseReadyPayload) => void,
): () => void {
  return window.electronAPI.onAIResponseReady(callback);
}

function onError(callback: (payload: AIErrorPayload) => void): () => void {
  return window.electronAPI.onAIError(callback);
}

export const aiConversationCapability: AIConversationApi = {
  askAI,
  openSession,
  getServiceList,
  getSSEStatus,
  getLatestResponse,
  onResponseReady,
  onError,
  Host,
  setPendingAIThought,
  consumePendingAIThought,
  peekPendingAIThought,
  clearPendingAIThought,
};

// W5 严格态:Registry 注册 — view 通过 requireCapabilityApi<AIConversationApi>('ai-conversation')
capabilityRegistry.register({
  id: 'ai-conversation',
  api: aiConversationCapability,
});
