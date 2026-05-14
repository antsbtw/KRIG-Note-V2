/**
 * NoteView per-workspace 工作位状态管理
 *
 * 见 docs/RefactorV2/stages/L5B1-folder-tree-design.md § 2.3。
 *
 * 用户数据(笔记/文件夹)走 noteCapability / folderCapability (L7-sub2:SurrealDB);
 * 本文件管理 **当前 Workspace 的工作位状态**(看哪条笔记 / 折哪些文件夹 / 选了什么 / 排序 / 剪贴板)。
 *
 * **持久化字段**(写 pluginStates):activeNoteId / expandedFolders / folderSortMap / clipboard
 * **Transient 字段**(只内存,Q8=B):selectedIds — 关闭重启后清空,避免干扰新操作
 *
 * Set 字段持久化策略:Set ↔ string[] 编/解码在 hydrate/encode 内做,view 业务无感。
 *
 * L7-sub2 改造 (decision 012):
 * - 写 API (create/update/delete) 转 async;caller 需 await
 * - 读笔记/文件夹列表交给 view 层 hook (useAllNotes / useAllFolders)
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCapabilityApi } from '@capabilities/note/types';
import type { FolderCapabilityApi, FolderDeleteResult } from '@capabilities/folder/types';
import type { DriverSerialized, TextEditingApi } from '@capabilities/text-editing/types';

function noteCap(): NoteCapabilityApi {
  return requireCapabilityApi<NoteCapabilityApi>('note');
}
function folderCap(): FolderCapabilityApi {
  return requireCapabilityApi<FolderCapabilityApi>('folder');
}

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

/**
 * 创建笔记(noteCapability)+ 当前 ws activeNoteId
 * L7-sub2:async (IPC roundtrip);caller 需 await
 */
export async function createNote(
  workspaceId: string,
  folderId: string | null = null,
): Promise<string | null> {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return null;
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const note = await noteCap().createNote(textEditing.createEmptyDoc(), folderId);
  writePersistent(workspaceId, { activeNoteId: note.id });
  // 创建到 folder 时自动展开它
  if (folderId) {
    const cur = hydrate(ws).expandedFolders;
    if (!cur.has(folderId)) {
      const next = new Set(cur);
      next.add(folderId);
      writePersistent(workspaceId, { expandedFolders: Array.from(next) });
    }
  }
  return note.id;
}

/**
 * 更新笔记 doc (+ 可选 folderId 移动)
 * L7-sub2:async;title 字段已不存(派生),patch.title 忽略。
 * patch.folderId 与 patch.doc 同时存在时:先 update doc,再 move 到新 folder。
 */
export async function updateNote(
  noteId: string,
  patch: { doc?: DriverSerialized; title?: string; folderId?: string | null },
): Promise<void> {
  if (patch.doc !== undefined) {
    await noteCap().updateNote(noteId, patch.doc);
  }
  if (patch.folderId !== undefined) {
    await noteCap().moveNote(noteId, patch.folderId);
  }
  // patch.title 在 L7-sub2 已不可写 (派生自 doc.content[0]),忽略
}

export async function deleteNote(noteId: string): Promise<void> {
  await noteCap().deleteNote(noteId);
}

/**
 * 重命名 note(L7-sub2:title 派生自 doc.content[0],改名 = 反写首段 text)
 *
 * 写入策略(Q1/Q2 决议):
 * - 首段 block 自身 type/attrs 保留(原 paragraph/heading/isTitle 不变)
 * - 首段 content 全部 inline 合并为单一 text 节点 = newTitle
 * - 保留首个原 text 节点的 marks(若有)
 *
 * NoteView Host 收到 doc 广播会 swap PM doc(setMeta addToHistory:false)。
 */
export async function renameNote(noteId: string, newTitle: string): Promise<void> {
  const note = await noteCap().getNote(noteId);
  if (!note) return;
  const docCopy = JSON.parse(JSON.stringify(note.doc)) as { payload?: unknown };
  const root = docCopy.payload as { content?: Array<Record<string, unknown>> } | undefined;
  const firstBlock = root?.content?.[0];
  if (!firstBlock) return;
  // 保留首个 text 的 marks(Q1:保留 mark)
  const existingMarks = pluckFirstTextMarks(firstBlock);
  const newInline: Record<string, unknown> = { type: 'text', text: newTitle };
  if (existingMarks && existingMarks.length > 0) newInline.marks = existingMarks;
  // Q2:合并所有 inline 为单一 text 节点
  (firstBlock as { content?: unknown[] }).content = [newInline];
  await noteCap().updateNote(noteId, docCopy as DriverSerialized);
}

function pluckFirstTextMarks(node: Record<string, unknown>): unknown[] | null {
  if (node.type === 'text') return (node.marks as unknown[] | undefined) ?? null;
  const children = node.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(children)) return null;
  for (const c of children) {
    const r = pluckFirstTextMarks(c);
    if (r !== null) return r;
  }
  return null;
}

export function setActiveNote(workspaceId: string, noteId: string | null): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const state = hydrate(ws);
  if (state.activeNoteId === noteId) return;
  writePersistent(workspaceId, { activeNoteId: noteId });
}

// ── 文件夹 ──

export async function createFolder(
  workspaceId: string,
  parentId: string | null = null,
): Promise<{ id: string; title: string } | null> {
  // 同父级同名 → 取最小可用序号("新建文件夹" → "新建文件夹 2" → "新建文件夹 3" ...)
  const all = await folderCap().listFolders('note');
  const siblings = all.filter((f) => f.parentId === parentId);
  const title = nextAvailableFolderName('新建文件夹', siblings.map((s) => s.title));

  const folder = await folderCap().createFolder(title, parentId, 'note');
  if (!folder) return null;
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
  return { id: folder.id, title: folder.title };
}

/** 同父级同名兜底:base 未占用直接用,否则取最小可用 "base N" (N>=2) */
function nextAvailableFolderName(base: string, existingTitles: string[]): string {
  const taken = new Set(existingTitles);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/**
 * 删 folder (Path Y:递归删子 folder + 内含资源,对齐 macOS Finder)
 * 业务契约变更见 decision 012 设计师批复 + decision 014 §6.2.6 (cascade scope 扩展)
 * 返回删除统计(deletedFolders + deletedResources + cascadedEdges),caller 可记账。
 */
export async function deleteFolder(folderId: string): Promise<FolderDeleteResult> {
  return folderCap().deleteFolder(folderId);
}

/** 重命名 folder (L7-sub2:title 写 atom.payload.title) */
export async function renameFolder(folderId: string, newTitle: string): Promise<void> {
  await folderCap().renameFolder(folderId, newTitle);
}

/** 移动 folder (改 parentId,内部走 user:krig:inFolder 边重写) */
export async function moveFolder(
  folderId: string,
  newParentId: string | null,
): Promise<void> {
  await folderCap().moveFolder(folderId, newParentId);
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
