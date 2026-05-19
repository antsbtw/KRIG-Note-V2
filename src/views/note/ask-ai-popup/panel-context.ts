/**
 * AskAIPanel — 模块级 pending context
 *
 * popupController.show(POPUP_ID, anchor) 只能传 anchor element,
 * 不能传业务 payload。本模块缓存"打开 panel 时的选区信息",panel mount 时读。
 *
 * 同时刻只允许一个 panel 实例(单例 popup),pending 写入即覆盖。
 */

import type { AIServiceId } from '@shared/types/ai-service-types';

export interface AskAIContext {
  /** 序列化后的选区 markdown(预览 + 拼 prompt) */
  selectionMarkdown: string;
  /** 默认 AI 服务(AIView per-ws state,panel 可让用户改) */
  defaultServiceId: AIServiceId;
}

let pending: AskAIContext | null = null;

export function setPendingAskAIContext(ctx: AskAIContext): void {
  pending = ctx;
}

export function consumePendingAskAIContext(): AskAIContext | null {
  const ctx = pending;
  pending = null;
  return ctx;
}

/** popup ID(popupRegistry 注册 + popupController.show 用) */
export const ASK_AI_POPUP_ID = 'note-view.popup.ask-ai';
