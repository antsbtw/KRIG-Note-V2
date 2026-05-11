/**
 * EBookView per-workspace 工作位状态(L5-C1)
 *
 * 全局数据(书架 / 文件夹 / 标注)走 ebook-library capability(IPC + main store)。
 * 本文件管理**当前 Workspace 的工作位状态**(看哪本书 / 折哪些书架文件夹 / 选择 / 阅读位置等)。
 *
 * 决策 D-2=A:全部业务字段走 pluginStates['ebook-view'](charter 强制 + V2 既有
 * note-view / web-view 同模式)。WorkspaceState 框架字段不增加 ebook 专属字段。
 *
 * **持久化字段**:activeBookId / expandedFolders / readingState
 * **Transient 字段**:selectedIds(对齐 note-view Q8=B,关闭重启不残留)
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import type { ReadingPosition } from '@capabilities/ebook-library/types';

const STORE_KEY = 'ebook-view';

/** 阅读状态(per-ws,跟书 entry.lastPosition 互补 — entry 是"全局最后一次",ws 是"本 ws 上次")*/
export interface EBookReadingState {
  position: ReadingPosition;
  /** 缩放(冗余存,fitWidth=true 时用 entry.lastPosition.scale 兜底)*/
  scale?: number;
  /** 适应宽度 */
  fitWidth?: boolean;
}

/** per-workspace 工作位状态(persistent + transient 合并视图)*/
export interface EBookWorkspaceState {
  activeBookId: string | null;
  /** 书架文件夹展开状态 */
  expandedFolders: Set<string>;
  /** 阅读状态(C2~C5 真消费,C1 占位)*/
  readingState: EBookReadingState | null;
  /** Transient — selectedIds 不持久化(对齐 note-view Q8=B)*/
  selectedIds: Set<string>;
}

/** 持久化形态(pluginStates['ebook-view'] 真实存的格式)— Set 序列化为 string[] */
interface PersistedEBookWsState {
  activeBookId: string | null;
  expandedFolders: string[];
  readingState: EBookReadingState | null;
}

const DEFAULT_WS_STATE: EBookWorkspaceState = {
  activeBookId: null,
  expandedFolders: new Set<string>(),
  readingState: null,
  selectedIds: new Set<string>(),
};
Object.freeze(DEFAULT_WS_STATE);
Object.freeze(DEFAULT_WS_STATE.expandedFolders);
Object.freeze(DEFAULT_WS_STATE.selectedIds);

// ── transient selectedIds(对齐 note-view 的实现)──

const transientSelected: Map<string, Set<string>> = new Map();
const transientListeners: Set<() => void> = new Set();
let transientVersion = 0;

const hydratedCache: WeakMap<WorkspaceState, EBookWorkspaceState> = new WeakMap();

function hydrate(ws: WorkspaceState): EBookWorkspaceState {
  const cached = hydratedCache.get(ws);
  if (cached) {
    const sel = transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds;
    if (cached.selectedIds === sel) return cached;
    const fresh = { ...cached, selectedIds: sel };
    hydratedCache.set(ws, fresh);
    return fresh;
  }
  const raw = ws.pluginStates[STORE_KEY] as PersistedEBookWsState | undefined;
  const result: EBookWorkspaceState = {
    activeBookId: raw?.activeBookId ?? null,
    expandedFolders: new Set(raw?.expandedFolders ?? []),
    readingState: raw?.readingState ?? null,
    // selectedIds 兜底用 DEFAULT_WS_STATE.selectedIds(冻结引用),与 cached
    // 分支兜底一致 — useSyncExternalStore getSnapshot 多次调用返回稳定引用,
    // 避免 React 19 dev mode "getSnapshot should be cached" 警告(V2 既有 bug,
    // L5-G2 顺手修;memory feedback_use_sync_external_store_stable_ref)
    selectedIds: transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds,
  };
  hydratedCache.set(ws, result);
  return result;
}

export function getEBookWsState(ws: WorkspaceState): EBookWorkspaceState {
  return hydrate(ws);
}

function writePersistent(workspaceId: string, patch: Partial<PersistedEBookWsState>): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const current = (ws.pluginStates[STORE_KEY] as PersistedEBookWsState | undefined) ?? {
    activeBookId: null,
    expandedFolders: [],
    readingState: null,
  };
  const merged: PersistedEBookWsState = { ...current, ...patch };
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

export function setActiveBookId(workspaceId: string, bookId: string | null): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  if (hydrate(ws).activeBookId === bookId) return;
  writePersistent(workspaceId, { activeBookId: bookId });
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

export function setReadingState(workspaceId: string, state: EBookReadingState | null): void {
  writePersistent(workspaceId, { readingState: state });
}

// ── transient selectedIds ──

export function setSelectedIds(workspaceId: string, ids: Set<string>): void {
  writeTransientSelected(workspaceId, ids);
}

export function getSelectedIds(workspaceId: string): Set<string> {
  return transientSelected.get(workspaceId) ?? new Set();
}
