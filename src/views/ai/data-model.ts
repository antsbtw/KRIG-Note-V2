/**
 * AIView per-workspace 工作位状态
 *
 * 持久化字段(写 pluginStates['ai']):
 * - currentServiceId:最后选中的 AI 服务(Claude/ChatGPT/Gemini)
 * - activeLauncher:当前 navSide 服务切换器选中的 webview 入口
 *   = AIServiceId | 'x'(X 集成:X 当 AI navSide 里的一个快速导航入口,
 *     但走独立 x-extraction capability 渲染 + 独立提取/发布代码路径,铁律 3)。
 *
 * 不持久化字段:loading / currentUrl(transient,webview 事件实时驱动 UI)
 *
 * 注(铁律 3):activeLauncher 的 'x' 不进 AIServiceId / AIServiceProfile —— X 不是
 * 一个"AI 服务",只是借 AI view 的外壳做导航。currentServiceId 仍严格是三家 AI 之一。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { DEFAULT_AI_SERVICE, type AIServiceId } from '@shared/types/ai-service-types';

const STORE_KEY = 'ai';

/** AI navSide 服务切换器的入口 id:三家 AI + X(X 走独立 capability 渲染) */
export type LauncherId = AIServiceId | 'x';

export interface AIWorkspaceState {
  /** 最后选中的 AI 服务(切回 AI 时用;X 选中时这个不变) */
  currentServiceId: AIServiceId;
  /** 当前服务切换器选中的入口(AI 服务之一 或 'x') */
  activeLauncher: LauncherId;
}

interface PersistedAIWsState {
  currentServiceId?: AIServiceId;
  activeLauncher?: LauncherId;
}

function isServiceId(v: unknown): v is AIServiceId {
  return v === 'chatgpt' || v === 'claude' || v === 'gemini';
}

function isLauncherId(v: unknown): v is LauncherId {
  return isServiceId(v) || v === 'x';
}

/**
 * hydrate cache(避免 useSyncExternalStore 死循环 — 必须返回稳定引用)
 *
 * 见 src/views/web/data-model.ts 同款注释。
 */
const wsStateCache = new Map<string, AIWorkspaceState>();

/** hydrate:WorkspaceState.pluginStates['ai'] → AIWorkspaceState(稳定引用) */
export function getAIWsState(ws: WorkspaceState): AIWorkspaceState {
  const persisted = (ws.pluginStates?.[STORE_KEY] as Partial<PersistedAIWsState> | undefined) ?? {};
  const currentServiceId = isServiceId(persisted.currentServiceId)
    ? persisted.currentServiceId
    : DEFAULT_AI_SERVICE;
  const activeLauncher = isLauncherId(persisted.activeLauncher)
    ? persisted.activeLauncher
    : currentServiceId;
  const cached = wsStateCache.get(ws.id);
  if (
    cached &&
    cached.currentServiceId === currentServiceId &&
    cached.activeLauncher === activeLauncher
  ) {
    return cached;
  }
  const next: AIWorkspaceState = { currentServiceId, activeLauncher };
  wsStateCache.set(ws.id, next);
  return next;
}

/** 写 pluginStates(集中一处,保证 currentServiceId + activeLauncher 一致) */
function persist(workspaceId: string, state: AIWorkspaceState): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const nextPlugin = {
    ...(ws.pluginStates ?? {}),
    [STORE_KEY]: {
      currentServiceId: state.currentServiceId,
      activeLauncher: state.activeLauncher,
    } satisfies PersistedAIWsState,
  };
  workspaceManager.update(workspaceId, { pluginStates: nextPlugin });
}

/** 用户在服务切换器选了某个 AI 服务 → 切到该服务 + activeLauncher = 该服务 */
export function setAIServiceId(workspaceId: string, serviceId: AIServiceId): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = getAIWsState(ws);
  if (cur.currentServiceId === serviceId && cur.activeLauncher === serviceId) return;
  persist(workspaceId, { currentServiceId: serviceId, activeLauncher: serviceId });
}

/**
 * 用户在服务切换器选了入口(AI 服务 或 'x')。
 * - 选 AI 服务:currentServiceId 跟着切;activeLauncher = 该服务。
 * - 选 'x':currentServiceId 不变(保留最后 AI 服务,切回时用);activeLauncher = 'x'。
 */
export function setActiveLauncher(workspaceId: string, launcher: LauncherId): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = getAIWsState(ws);
  if (cur.activeLauncher === launcher) return;
  if (launcher === 'x') {
    persist(workspaceId, { currentServiceId: cur.currentServiceId, activeLauncher: 'x' });
  } else {
    persist(workspaceId, { currentServiceId: launcher, activeLauncher: launcher });
  }
}
