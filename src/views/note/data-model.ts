/**
 * NoteView per-workspace 工作位状态管理
 *
 * 见 docs/RefactorV2/stages/L5B1-folder-tree-design.md § 2.3。
 *
 * 用户数据(笔记/文件夹)走全局 noteStore / folderStore;
 * 本文件管理 **当前 Workspace 的工作位状态**(看哪条笔记 / 折哪些文件夹 / 选了什么 / 排序 / 剪贴板)。
 *
 * **持久化字段**(写 pluginStates):activeNoteId / expandedFolders / folderSortMap / clipboard
 * **Transient 字段**(只内存,Q8=B):selectedIds — 关闭重启后清空,避免干扰新操作
 *
 * Set 字段持久化策略:Set ↔ string[] 编/解码在 hydrate/encode 内做,view 业务无感。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { noteStore } from './note-store';
import { folderStore } from './folder-store';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { DriverSerialized, TextEditingApi } from '@capabilities/text-editing/types';

export type SortState = 'title-asc' | 'title-desc' | 'date-asc' | 'date-desc' | null;

/** per-workspace 工作位状态(persistent + transient 合并视图)*/
export interface NoteWorkspaceState {
  activeNoteId: string | null;
  expandedFolders: Set<string>;
  folderSortMap: Record<string, SortState>;
  clipboard: { type: 'note' | 'folder'; id: string } | null;
  /** Transient — 不持久化(Q8=B)*/
  selectedIds: Set<string>;
}

const STORE_KEY = 'note';

/** 持久化的形态(pluginStates['note'] 真实存的格式)— Set 序列化为 string[] */
interface PersistedNoteWsState {
  activeNoteId: string | null;
  expandedFolders: string[];
  folderSortMap: Record<string, SortState>;
  clipboard: { type: 'note' | 'folder'; id: string } | null;
}

/** 冻结常量(避免 useSyncExternalStore 死循环)*/
const DEFAULT_WS_STATE: NoteWorkspaceState = {
  activeNoteId: null,
  expandedFolders: new Set<string>(),
  folderSortMap: {},
  clipboard: null,
  selectedIds: new Set<string>(),
};
Object.freeze(DEFAULT_WS_STATE);
Object.freeze(DEFAULT_WS_STATE.expandedFolders);
Object.freeze(DEFAULT_WS_STATE.folderSortMap);
Object.freeze(DEFAULT_WS_STATE.selectedIds);

/** Transient selectedIds(每 ws 独立)— 关闭重启后清空 */
const transientSelected: Map<string, Set<string>> = new Map();
const transientListeners: Set<() => void> = new Set();
let transientVersion = 0;

/** 缓存 hydrated state(避免 useSyncExternalStore 每次 ws 变化都新建对象 → 死循环)*/
const hydratedCache: WeakMap<WorkspaceState, NoteWorkspaceState> = new WeakMap();

function hydrate(ws: WorkspaceState): NoteWorkspaceState {
  const cached = hydratedCache.get(ws);
  if (cached) {
    // 但 selectedIds 是 transient,可能在缓存外变化 — 重新拉
    const sel = transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds;
    if (cached.selectedIds === sel) return cached;
    const fresh = { ...cached, selectedIds: sel };
    hydratedCache.set(ws, fresh);
    return fresh;
  }
  const raw = ws.pluginStates[STORE_KEY] as PersistedNoteWsState | undefined;
  const result: NoteWorkspaceState = {
    activeNoteId: raw?.activeNoteId ?? null,
    expandedFolders: new Set(raw?.expandedFolders ?? []),
    folderSortMap: raw?.folderSortMap ?? {},
    clipboard: raw?.clipboard ?? null,
    // selectedIds 兜底用 DEFAULT_WS_STATE.selectedIds(冻结引用),与 cached
    // 分支兜底一致 — useSyncExternalStore getSnapshot 多次调用返回稳定引用,
    // 避免 React 19 dev mode "getSnapshot should be cached" 警告(V2 既有 bug,
    // L5-G2 顺手修;memory feedback_use_sync_external_store_stable_ref)
    selectedIds: transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds,
  };
  hydratedCache.set(ws, result);
  return result;
}

export function getNoteWsState(ws: WorkspaceState): NoteWorkspaceState {
  return hydrate(ws);
}

/** 写持久化字段(activeNoteId / expandedFolders / folderSortMap / clipboard)*/
function writePersistent(workspaceId: string, patch: Partial<PersistedNoteWsState>): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const current = (ws.pluginStates[STORE_KEY] as PersistedNoteWsState | undefined) ?? {
    activeNoteId: null,
    expandedFolders: [],
    folderSortMap: {},
    clipboard: null,
  };
  const merged: PersistedNoteWsState = { ...current, ...patch };
  workspaceManager.update(workspaceId, {
    pluginStates: { ...ws.pluginStates, [STORE_KEY]: merged },
  });
}

/** 写 transient selectedIds + 触发本地监听器(useSyncExternalStore 用)*/
function writeTransientSelected(workspaceId: string, ids: Set<string>): void {
  transientSelected.set(workspaceId, ids);
  transientVersion++;
  // 同时让 hydratedCache 失效(下次 hydrate 拿新 selectedIds)
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

// ── 业务 API ──

export function deriveTitle(doc: DriverSerialized): string {
  const text = requireCapabilityApi<TextEditingApi>('text-editing').extractFirstParagraphText(doc);
  return text || '未命名';
}

/** 创建笔记(全局 store)+ 当前 ws activeNoteId */
export function createNote(workspaceId: string, folderId: string | null = null): string | null {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return null;
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const id = noteStore.create(textEditing.createEmptyDoc(), '未命名', folderId);
  writePersistent(workspaceId, { activeNoteId: id });
  // 创建到 folder 时自动展开它
  if (folderId) {
    const cur = hydrate(ws).expandedFolders;
    if (!cur.has(folderId)) {
      const next = new Set(cur);
      next.add(folderId);
      writePersistent(workspaceId, { expandedFolders: Array.from(next) });
    }
  }
  return id;
}

export function updateNote(
  noteId: string,
  patch: { doc?: DriverSerialized; title?: string; folderId?: string | null },
): void {
  noteStore.update(noteId, patch);
}

export function deleteNote(noteId: string): void {
  noteStore.delete(noteId);
}

export function setActiveNote(workspaceId: string, noteId: string | null): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const state = hydrate(ws);
  if (state.activeNoteId === noteId) return;
  writePersistent(workspaceId, { activeNoteId: noteId });
}

// ── 文件夹 ──

export function createFolder(workspaceId: string, parentId: string | null = null): string {
  const id = folderStore.create('新建文件夹', parentId);
  // 父文件夹自动展开
  if (parentId) {
    const ws = workspaceManager.get(workspaceId);
    if (ws) {
      const cur = hydrate(ws).expandedFolders;
      if (!cur.has(parentId)) {
        const next = new Set(cur);
        next.add(parentId);
        writePersistent(workspaceId, { expandedFolders: Array.from(next) });
      }
    }
  }
  return id;
}

/** 删 folder + 级联:子 folder 一起删,内含笔记 folderId → null */
export function deleteFolder(folderId: string): void {
  const deletedIds = folderStore.delete(folderId);
  if (deletedIds.length === 0) return;
  // 笔记 folderId 落根
  for (const note of noteStore.getAll()) {
    if (note.folderId && deletedIds.includes(note.folderId)) {
      noteStore.update(note.id, { folderId: null });
    }
  }
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

// ── 选中(transient)──

export function setSelectedIds(workspaceId: string, ids: Set<string>): void {
  writeTransientSelected(workspaceId, ids);
}

export function getSelectedIds(workspaceId: string): Set<string> {
  return transientSelected.get(workspaceId) ?? new Set();
}

// ── 排序 ──

export function setFolderSort(workspaceId: string, folderKey: string, sort: SortState): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = hydrate(ws).folderSortMap;
  writePersistent(workspaceId, {
    folderSortMap: { ...cur, [folderKey]: sort },
  });
}

export function cycleSortByTitle(workspaceId: string, folderKey: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = hydrate(ws).folderSortMap[folderKey];
  const next: SortState = cur === 'title-asc' ? 'title-desc' : 'title-asc';
  setFolderSort(workspaceId, folderKey, next);
}

export function cycleSortByDate(workspaceId: string, folderKey: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = hydrate(ws).folderSortMap[folderKey];
  const next: SortState = cur === 'date-asc' ? 'date-desc' : 'date-asc';
  setFolderSort(workspaceId, folderKey, next);
}

// ── 剪贴板 ──

export function setClipboard(workspaceId: string, clip: { type: 'note' | 'folder'; id: string } | null): void {
  writePersistent(workspaceId, { clipboard: clip });
}
