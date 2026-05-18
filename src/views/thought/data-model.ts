/**
 * ThoughtView per-workspace 工作位状态(对齐 views/note/data-model.ts 同模式)
 *
 * 持久化字段:activeThoughtId / expandedFolders
 * Transient 字段:selectedIds(关闭重启清空)
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';

const STORE_KEY = 'thought';

export interface ThoughtWorkspaceState {
  activeThoughtId: string | null;
  expandedFolders: Set<string>;
  selectedIds: Set<string>;
}

interface PersistedThoughtWsState {
  activeThoughtId: string | null;
  expandedFolders: string[];
}

const DEFAULT_WS_STATE: ThoughtWorkspaceState = {
  activeThoughtId: null,
  expandedFolders: new Set<string>(),
  selectedIds: new Set<string>(),
};
Object.freeze(DEFAULT_WS_STATE);
Object.freeze(DEFAULT_WS_STATE.expandedFolders);
Object.freeze(DEFAULT_WS_STATE.selectedIds);

const transientSelected: Map<string, Set<string>> = new Map();
const transientListeners: Set<() => void> = new Set();
let transientVersion = 0;
const hydratedCache: WeakMap<WorkspaceState, ThoughtWorkspaceState> = new WeakMap();

function hydrate(ws: WorkspaceState): ThoughtWorkspaceState {
  const cached = hydratedCache.get(ws);
  if (cached) {
    const sel = transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds;
    if (cached.selectedIds === sel) return cached;
    const fresh = { ...cached, selectedIds: sel };
    hydratedCache.set(ws, fresh);
    return fresh;
  }
  const raw = ws.pluginStates[STORE_KEY] as PersistedThoughtWsState | undefined;
  const result: ThoughtWorkspaceState = {
    activeThoughtId: raw?.activeThoughtId ?? null,
    expandedFolders: new Set(raw?.expandedFolders ?? []),
    selectedIds: transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds,
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
    expandedFolders: [],
  };
  const merged: PersistedThoughtWsState = { ...current, ...patch };
  workspaceManager.update(workspaceId, {
    pluginStates: { ...ws.pluginStates, [STORE_KEY]: merged },
  });
}

function writeTransientSelected(workspaceId: string, ids: Set<string>): void {
  transientSelected.set(workspaceId, ids);
  transientVersion++;
  const ws = workspaceManager.get(workspaceId);
  if (ws) hydratedCache.delete(ws);
  transientListeners.forEach((l) => l());
}

export function subscribeTransient(listener: () => void): () => void {
  transientListeners.add(listener);
  return () => {
    transientListeners.delete(listener);
  };
}

export function getTransientVersion(): number {
  return transientVersion;
}

export function setActiveThought(workspaceId: string, thoughtId: string | null): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const state = hydrate(ws);
  if (state.activeThoughtId === thoughtId) return;
  writePersistent(workspaceId, { activeThoughtId: thoughtId });
}

export function setFolderExpanded(workspaceId: string, folderId: string, expanded: boolean): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = hydrate(ws).expandedFolders;
  const next = new Set(cur);
  if (expanded) next.add(folderId);
  else next.delete(folderId);
  writePersistent(workspaceId, { expandedFolders: Array.from(next) });
}

export function setSelectedIds(workspaceId: string, ids: Set<string>): void {
  writeTransientSelected(workspaceId, ids);
}
