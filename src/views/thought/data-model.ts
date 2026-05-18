/**
 * ThoughtView per-workspace 工作位状态
 *
 * V1 形态对齐:thought 不进 folder,无树状选中 — 卡片自身管 expand/collapse 局部 state。
 * V2 per-ws 仅持久化:activeThoughtId(跨槽召唤后激活哪张卡片)。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';

const STORE_KEY = 'thought';

export interface ThoughtWorkspaceState {
  activeThoughtId: string | null;
}

interface PersistedThoughtWsState {
  activeThoughtId: string | null;
}

const DEFAULT_WS_STATE: ThoughtWorkspaceState = {
  activeThoughtId: null,
};
Object.freeze(DEFAULT_WS_STATE);

const hydratedCache: WeakMap<WorkspaceState, ThoughtWorkspaceState> = new WeakMap();

function hydrate(ws: WorkspaceState): ThoughtWorkspaceState {
  const cached = hydratedCache.get(ws);
  if (cached) return cached;
  const raw = ws.pluginStates[STORE_KEY] as PersistedThoughtWsState | undefined;
  const result: ThoughtWorkspaceState = {
    activeThoughtId: raw?.activeThoughtId ?? null,
  };
  hydratedCache.set(ws, result);
  return result;
}

export function getThoughtWsState(ws: WorkspaceState): ThoughtWorkspaceState {
  return hydrate(ws);
}

function writePersistent(workspaceId: string, patch: Partial<PersistedThoughtWsState>): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const current = (ws.pluginStates[STORE_KEY] as PersistedThoughtWsState | undefined) ?? {
    activeThoughtId: null,
  };
  const merged: PersistedThoughtWsState = { ...current, ...patch };
  hydratedCache.delete(ws);
  workspaceManager.update(workspaceId, {
    pluginStates: { ...ws.pluginStates, [STORE_KEY]: merged },
  });
}

export function setActiveThought(workspaceId: string, thoughtId: string | null): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const state = hydrate(ws);
  if (state.activeThoughtId === thoughtId) return;
  writePersistent(workspaceId, { activeThoughtId: thoughtId });
}
