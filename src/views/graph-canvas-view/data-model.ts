/**
 * GraphCanvasView per-workspace 工作位状态(L5-G1)
 *
 * 全局数据(画板列表 / 文件夹)走 graph-library-store capability(IPC + main store)。
 * 本文件管理**当前 Workspace 的工作位状态**(看哪张画板 / 折哪些文件夹 / 选择)。
 *
 * 决策 D-2=A:全部业务字段走 pluginStates['graph-canvas-view'](charter 强制 + V2 既有
 * note-view / ebook-view 同模式)。WorkspaceState 框架字段不增加 graph 专属字段。
 *
 * **持久化字段**:activeGraphId / expandedFolders
 * **Transient 字段**:selectedIds(对齐 note-view / ebook-view Q8=B,关闭重启不残留)
 *
 * G1 不含 viewport / inspectorOpen / addModeKey 等画板内交互状态(留 G3 接
 * canvas-rendering Host 时加,届时 viewport 可挂 doc_content 也可挂这里 — 后续决策)。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';

const STORE_KEY = 'graph-canvas-view';

/** per-workspace 工作位状态(persistent + transient 合并视图)*/
export interface GraphCanvasWorkspaceState {
  activeGraphId: string | null;
  /** 文件夹展开状态 */
  expandedFolders: Set<string>;
  /** Transient — selectedIds 不持久化(对齐 note-view / ebook-view Q8=B)*/
  selectedIds: Set<string>;
}

/** 持久化形态(pluginStates['graph-canvas-view'] 真实存的格式)— Set 序列化为 string[] */
interface PersistedGraphCanvasWsState {
  activeGraphId: string | null;
  expandedFolders: string[];
}

const DEFAULT_WS_STATE: GraphCanvasWorkspaceState = {
  activeGraphId: null,
  expandedFolders: new Set<string>(),
  selectedIds: new Set<string>(),
};
Object.freeze(DEFAULT_WS_STATE);
Object.freeze(DEFAULT_WS_STATE.expandedFolders);
Object.freeze(DEFAULT_WS_STATE.selectedIds);

// ── transient selectedIds(对齐 note-view / ebook-view 的实现)──

const transientSelected: Map<string, Set<string>> = new Map();
const transientListeners: Set<() => void> = new Set();
let transientVersion = 0;

const hydratedCache: WeakMap<WorkspaceState, GraphCanvasWorkspaceState> =
  new WeakMap();

function hydrate(ws: WorkspaceState): GraphCanvasWorkspaceState {
  const cached = hydratedCache.get(ws);
  if (cached) {
    const sel = transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds;
    if (cached.selectedIds === sel) return cached;
    const fresh = { ...cached, selectedIds: sel };
    hydratedCache.set(ws, fresh);
    return fresh;
  }
  const raw = ws.pluginStates[STORE_KEY] as PersistedGraphCanvasWsState | undefined;
  const result: GraphCanvasWorkspaceState = {
    activeGraphId: raw?.activeGraphId ?? null,
    expandedFolders: new Set(raw?.expandedFolders ?? []),
    // selectedIds 兜底用 DEFAULT_WS_STATE.selectedIds(冻结引用),
    // 与 cached 分支用相同的兜底,getSnapshot 多次调用返回稳定引用,避免 React 19
    // dev mode "getSnapshot should be cached" 警告(memory feedback_use_sync_external_store_stable_ref)
    selectedIds: transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds,
  };
  hydratedCache.set(ws, result);
  return result;
}

export function getGraphCanvasWsState(ws: WorkspaceState): GraphCanvasWorkspaceState {
  return hydrate(ws);
}

function writePersistent(
  workspaceId: string,
  patch: Partial<PersistedGraphCanvasWsState>,
): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const current = (ws.pluginStates[STORE_KEY] as PersistedGraphCanvasWsState | undefined) ?? {
    activeGraphId: null,
    expandedFolders: [],
  };
  const merged: PersistedGraphCanvasWsState = { ...current, ...patch };
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

// ── 业务 setters ──

export function setActiveGraphId(workspaceId: string, graphId: string | null): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  if (hydrate(ws).activeGraphId === graphId) return;
  writePersistent(workspaceId, { activeGraphId: graphId });
}

export function setFolderExpanded(
  workspaceId: string,
  folderId: string,
  expanded: boolean,
): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = hydrate(ws).expandedFolders;
  const next = new Set(cur);
  if (expanded) next.add(folderId);
  else next.delete(folderId);
  writePersistent(workspaceId, { expandedFolders: Array.from(next) });
}

export function setExpandedFolders(workspaceId: string, ids: Set<string>): void {
  writePersistent(workspaceId, { expandedFolders: Array.from(ids) });
}

// ── transient selectedIds ──

export function setSelectedIds(workspaceId: string, ids: Set<string>): void {
  writeTransientSelected(workspaceId, ids);
}

export function getSelectedIds(workspaceId: string): Set<string> {
  return transientSelected.get(workspaceId) ?? new Set();
}
