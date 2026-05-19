/**
 * pending AI thought 路由 — per-serviceId 缓存
 *
 * 场景 A(Note Ask AI):
 *   - 用户在 Note 选区右键 → 创空 ai-response thought atom + addThoughtMark + anchor
 *     → AskAIPanel 弹起 → 用户发送 → panel handleSend 调 setPendingAIThought(serviceId, thoughtId)
 *   - AI Web 上 AI 在回复
 *   - 用户点 "提取整页对话" → ai-view.extract-conversation 调 consumePendingAIThought(serviceId)
 *     拿到 thoughtId → thoughtUpdate(thoughtId, { doc }) 不重复创 atom
 *
 * 场景 B(独立 AI 聊天,未来 Phase 10):
 *   - 用户直接在 AI Web 跟 AI 聊
 *   - 没有 setPendingAIThought 调用
 *   - 提取按钮 → consume 拿 null → createThought 新建独立(无 anchor)
 *
 * per-serviceId:三服务各自独立(用户可能在 Claude 问完不提取,转到 Gemini 又问,
 * 各自的 pending 互不干扰)。
 *
 * 模块级单例(放 capability 而非 view,因为 AI Toolbar extract 命令也要消费它,
 * 命令注册在 view 但实际逻辑跨 view 共享)。
 */

import type { AIServiceId } from '@shared/types/ai-service-types';

const pending = new Map<AIServiceId, string>();

export function setPendingAIThought(serviceId: AIServiceId, thoughtId: string): void {
  pending.set(serviceId, thoughtId);
}

/** 消费(取 + 删) — 提取按钮调一次即清,避免下次"独立聊天"也填到这个旧 thought */
export function consumePendingAIThought(serviceId: AIServiceId): string | null {
  const id = pending.get(serviceId) ?? null;
  pending.delete(serviceId);
  return id;
}

/** 仅取不删 — 诊断 / 取消路径用 */
export function peekPendingAIThought(serviceId: AIServiceId): string | null {
  return pending.get(serviceId) ?? null;
}

/** 清除指定 serviceId 的 pending(panel cancel 路径用) */
export function clearPendingAIThought(serviceId: AIServiceId): void {
  pending.delete(serviceId);
}
