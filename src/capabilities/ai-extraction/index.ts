/**
 * ai-extraction capability — renderer 端薄包装
 *
 * 职责:从 Claude / ChatGPT / Gemini 三大 AI 网页"抓取整页对话"的统一能力
 *   1. askAI / extractFull — 抓取(主路径)
 *   2. Host 组件 — 嵌入 AI 网页 webview 的载体
 *   3. pending-thought 路由 — 抓取结果由调用方决定写入哪个 thought(本 capability 不写库)
 *
 * 实施位置:src/platform/main/ai/(handlers + ask-orchestrator + interceptor + extractors/*)
 * 本文件:把 window.electronAPI.aiXxx 扁平驼峰 alias 成业务方法 + 暴露 Host 组件
 *
 * 边界(对齐 thought capability v0.5 §7.1):
 * - view 业务路径走 requireCapabilityApi<AIConversationApi>('ai-extraction')(W5 严格态 A 硬约束)
 * - 模块级 export 同时保留(driver/slot 内部消费可直 import)
 *
 * 横切定位:同一能力对所有 install 它的 view 完全一致;
 * 所有 view(note / ai-view / thought / ...)通过 install 'ai-extraction' 获得相同 API。
 *
 * 改名历史:原名 ai-conversation(2026-05-19 改为 ai-extraction,更贴合"抓取"职责)
 * 注:IPC 协议头 AI_PROTOCOL='ai-conversation' 和 SurrealDB extractionType:'ai-conversation'
 *     字面量保留(零数据迁移)— 见 docs/00-architecture/ai-extraction-flow.md。
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
  AISyncAppendTurnPayload,
  AIExtractTurnRequest,
} from './types';
import { Host } from './Host';
import {
  setPendingAIThought,
  consumePendingAIThought,
  peekPendingAIThought,
  clearPendingAIThought,
} from './pending-thought';
import { getAIHostWcId, clearAIHostWcId } from './ai-host-registry';

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
  AISyncAppendTurnPayload,
  AISyncTurn,
  AIExtractFullResult,
  AIExtractTurnResult,
  AIExtractTurnRequest,
} from './types';

async function askAI(
  serviceId: AIServiceId,
  prompt: string,
  options?: AIAskOptions,
  targetWcId?: number | null,
): Promise<AIAskResult> {
  return window.electronAPI.aiAsk(serviceId, prompt, options, targetWcId ?? undefined);
}

async function openSession(
  serviceId: AIServiceId,
  targetWcId?: number | null,
): Promise<{ success: boolean; error?: string }> {
  const r = await window.electronAPI.aiOpenSession(serviceId, targetWcId ?? undefined);
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

async function extractFull(serviceId: AIServiceId, targetWcId?: number | null) {
  return window.electronAPI.aiExtractFull(serviceId, targetWcId ?? undefined);
}

async function extractTurn(serviceId: AIServiceId, x: number, y: number, targetWcId?: number | null) {
  return window.electronAPI.aiExtractTurn(serviceId, x, y, targetWcId ?? undefined);
}

function onExtractTurnRequest(
  callback: (payload: AIExtractTurnRequest) => void,
): () => void {
  return window.electronAPI.onAIExtractTurnRequest(callback);
}

function onResponseReady(
  callback: (payload: AIResponseReadyPayload) => void,
): () => void {
  return window.electronAPI.onAIResponseReady(callback);
}

function onError(callback: (payload: AIErrorPayload) => void): () => void {
  return window.electronAPI.onAIError(callback);
}

async function startAISync(
  serviceId: AIServiceId,
  targetWcId?: number | null,
): Promise<{ success: boolean; error?: string }> {
  return window.electronAPI.aiSyncStart(serviceId, targetWcId ?? undefined);
}

async function stopAISync(
  serviceId: AIServiceId,
): Promise<{ success: boolean; error?: string }> {
  return window.electronAPI.aiSyncStop(serviceId);
}

function onAppendTurn(
  callback: (payload: AISyncAppendTurnPayload) => void,
): () => void {
  return window.electronAPI.onAISyncAppendTurn(callback);
}

export const aiExtractionCapability: AIConversationApi = {
  askAI,
  openSession,
  getServiceList,
  getSSEStatus,
  getLatestResponse,
  extractFull,
  extractTurn,
  onExtractTurnRequest,
  onResponseReady,
  onError,
  Host,
  setPendingAIThought,
  consumePendingAIThought,
  peekPendingAIThought,
  clearPendingAIThought,
  startAISync,
  stopAISync,
  onAppendTurn,
  getAIHostWcId,
  clearAIHostWcId,
};

// W5 严格态:Registry 注册 — view 通过 requireCapabilityApi<AIConversationApi>('ai-extraction')
capabilityRegistry.register({
  id: 'ai-extraction',
  api: aiExtractionCapability,
});
