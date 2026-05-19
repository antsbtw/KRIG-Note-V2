/**
 * ai-conversation capability — IPC 边界类型
 *
 * Renderer 与 main 之间传递的 askAI 入参 / 结果 / 流式增量。
 * AIServiceId / AIServiceProfile 等服务配置仍在 shared/types/ai-service-types.ts。
 */

import type { AIServiceId } from '@shared/types/ai-service-types';

export interface AIAskOptions {
  /** 默认 60s,服务端流可能耗时 */
  timeoutMs?: number;
}

export interface AIAskResult {
  success: boolean;
  /** AI 完整 Markdown 回复(success=true 时) */
  markdown?: string;
  /** 错误信息(success=false 时) */
  error?: string;
}

export interface AISSEStatus {
  count: number;
  latestStreaming: boolean;
  hooked: boolean;
}

/** main → renderer 推送的流式增量(本期仅 Claude 走真流式) */
export interface AIStreamChunk {
  requestId: string;
  serviceId: AIServiceId;
  /** 累积 Markdown(非增量),renderer 直接替换显示 */
  markdown: string;
  /** true=仍在流式,false=完成 */
  streaming: boolean;
}

/** main → renderer AI 完成 / 失败广播 */
export interface AIResponseReadyPayload {
  serviceId: AIServiceId;
  markdown: string;
}
export interface AIErrorPayload {
  serviceId: AIServiceId;
  error: string;
}

/** 跨槽 ViewMessage 协议(供 Note ↔ AI / Note ↔ Thought 等使用) */
export const AI_PROTOCOL = 'ai-conversation';
export const AI_ACTION = {
  ASK: 'ask',
  RESPONSE_READY: 'response-ready',
  ERROR: 'error',
} as const;

// ── ai-sync feature 类型(AI 对话 → 右槽 Note 自动追加) ──

/** 单个 turn 的 user / assistant 文本 */
export interface AISyncTurn {
  /** 用户提问原文(Claude 走 chat_conversations API 拿;ChatGPT/Gemini 暂为空字符串) */
  userMessage: string;
  /** AI 回复 markdown(SSE 抓到 / extractor 拿到的原始字符串) */
  markdown: string;
  /** main 端 emit 时间戳(ms) */
  timestamp: number;
}

/** ai-sync.append-turn broadcast payload(main → renderer) */
export interface AISyncAppendTurnPayload {
  serviceId: AIServiceId;
  turn: AISyncTurn;
}
