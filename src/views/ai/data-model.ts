/**
 * AIView per-workspace 工作位状态
 *
 * 持久化字段(写 pluginStates['ai']):
 * - currentServiceId:最后选中的 AI 服务(Claude/ChatGPT/Gemini)
 *
 * 不持久化字段:loading / currentUrl(transient,webview 事件实时驱动 UI)
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { DEFAULT_AI_SERVICE, type AIServiceId } from '@shared/types/ai-service-types';

const STORE_KEY = 'ai';

export interface AIWorkspaceState {
  currentServiceId: AIServiceId;
}

interface PersistedAIWsState {
  currentServiceId?: AIServiceId;
}

function isServiceId(v: unknown): v is AIServiceId {
  return v === 'chatgpt' || v === 'claude' || v === 'gemini';
}

/**
 * hydrate cache(避免 useSyncExternalStore 死循环 — 必须返回稳定引用)
 */
const wsStateCache = new Map<string, AIWorkspaceState>();

export function getAIWsState(ws: WorkspaceState): AIWorkspaceState {
  const persisted = (ws.pluginStates?.[STORE_KEY] as Partial<PersistedAIWsState> | undefined) ?? {};
  const currentServiceId = isServiceId(persisted.currentServiceId)
    ? persisted.currentServiceId
    : DEFAULT_AI_SERVICE;
  const cached = wsStateCache.get(ws.id);
  if (cached && cached.currentServiceId === currentServiceId) {
    return cached;
  }
  const next: AIWorkspaceState = { currentServiceId };
  wsStateCache.set(ws.id, next);
  return next;
}

function persist(workspaceId: string, state: AIWorkspaceState): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const nextPlugin = {
    ...(ws.pluginStates ?? {}),
    [STORE_KEY]: {
      currentServiceId: state.currentServiceId,
    } satisfies PersistedAIWsState,
  };
  workspaceManager.update(workspaceId, { pluginStates: nextPlugin });
}

export function setAIServiceId(workspaceId: string, serviceId: AIServiceId): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = getAIWsState(ws);
  if (cur.currentServiceId === serviceId) return;
  persist(workspaceId, { currentServiceId: serviceId });
}
