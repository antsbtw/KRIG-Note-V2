/**
 * graph-library-store capability — renderer 侧 KRIG graph 数据能力封装(L5-G1)
 *
 * 职责:把 main 进程的 graph 持久化能力(画板 + 文件夹)暴露给 view / 后续
 * canvas-rendering capability。view 不直触 storage(audit § R5)。
 *
 * 实现位置:src/platform/main/graph/(canvas-store + library-handlers,合计 ~480 行,
 * D-3=B JSON 起步;模板对齐 ebook-library / learning)。
 *
 * ── 下游消费者(规划)──
 *
 * - L5-G1 views/graph-canvas-view/nav-side-content:画板列表 UI + 文件夹树
 * - L5-G3 capabilities/canvas-rendering/Host:启动恢复(load → CanvasHost.loadDocument)+
 *   防抖保存(onInstancesChange → save)
 * - 里程碑 H family-tree variant:复用同一 store,frontmatter.variant 区分
 *
 * ── W5 严格态 A 边界(audit 2026-05-08 § 5.2)──
 *
 * - View 侧(强制):走 requireCapabilityApi('graph-library-store').list(...) 间接路由
 * - Driver/slot 侧(允许):可直 import @capabilities/graph-library-store 单例兜底
 *   ↑ 临时允许项,非全局严格态(B/C)达成态;后续 charter v0.5 升级时统一改造
 *
 * 模块级 export 同时挂(双导出),对齐 ebook-library / learning / ytdlp 现有写法。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type {
  GraphLibraryStoreApi,
  GraphCanvasRecord,
  GraphCanvasListItem,
  GraphFolderRecord,
  GraphVariant,
  CanvasDocumentJson,
} from './types';

export type {
  GraphLibraryStoreApi,
  GraphCanvasRecord,
  GraphCanvasListItem,
  GraphFolderRecord,
  GraphVariant,
  CanvasDocumentJson,
} from './types';

// ── 画板 CRUD ──

export async function list(): Promise<GraphCanvasListItem[]> {
  if (!window.electronAPI?.graphList) return [];
  const r = await window.electronAPI.graphList();
  return Array.isArray(r) ? (r as GraphCanvasListItem[]) : [];
}

export async function load(id: string): Promise<GraphCanvasRecord | null> {
  if (!window.electronAPI?.graphLoad) return null;
  const r = await window.electronAPI.graphLoad(id);
  return (r as GraphCanvasRecord | null) ?? null;
}

export async function create(
  title: string,
  variant: GraphVariant,
  folderId?: string | null,
): Promise<GraphCanvasRecord | null> {
  if (!window.electronAPI?.graphCreate) return null;
  const r = await window.electronAPI.graphCreate(title, variant, folderId ?? null);
  return (r as GraphCanvasRecord | null) ?? null;
}

export async function save(
  id: string,
  docContent: CanvasDocumentJson,
  title: string,
): Promise<void> {
  if (!window.electronAPI?.graphSave) return;
  return window.electronAPI.graphSave(id, docContent, title);
}

export async function remove(id: string): Promise<void> {
  if (!window.electronAPI?.graphDelete) return;
  return window.electronAPI.graphDelete(id);
}

export async function rename(id: string, title: string): Promise<void> {
  if (!window.electronAPI?.graphRename) return;
  return window.electronAPI.graphRename(id, title);
}

export async function moveToFolder(
  id: string,
  folderId: string | null,
): Promise<void> {
  if (!window.electronAPI?.graphMoveToFolder) return;
  return window.electronAPI.graphMoveToFolder(id, folderId);
}

export async function duplicate(
  id: string,
  targetFolderId?: string | null,
): Promise<GraphCanvasRecord | null> {
  if (!window.electronAPI?.graphDuplicate) return null;
  const r = await window.electronAPI.graphDuplicate(id, targetFolderId);
  return (r as GraphCanvasRecord | null) ?? null;
}

// ── 文件夹 CRUD ──

export async function folderList(): Promise<GraphFolderRecord[]> {
  if (!window.electronAPI?.graphFolderList) return [];
  const r = await window.electronAPI.graphFolderList();
  return Array.isArray(r) ? (r as GraphFolderRecord[]) : [];
}

export async function folderCreate(
  title: string,
  parentId?: string | null,
): Promise<GraphFolderRecord | null> {
  if (!window.electronAPI?.graphFolderCreate) return null;
  const r = await window.electronAPI.graphFolderCreate(title, parentId ?? null);
  return (r as GraphFolderRecord | null) ?? null;
}

export async function folderRename(id: string, title: string): Promise<void> {
  if (!window.electronAPI?.graphFolderRename) return;
  return window.electronAPI.graphFolderRename(id, title);
}

export async function folderDelete(id: string): Promise<void> {
  if (!window.electronAPI?.graphFolderDelete) return;
  return window.electronAPI.graphFolderDelete(id);
}

export async function folderMove(
  id: string,
  parentId: string | null,
): Promise<void> {
  if (!window.electronAPI?.graphFolderMove) return;
  return window.electronAPI.graphFolderMove(id, parentId);
}

// ── 推送订阅 ──

export function onGraphListChanged(
  callback: (list: GraphCanvasListItem[]) => void,
): () => void {
  if (!window.electronAPI?.onGraphListChanged) return () => {};
  return window.electronAPI.onGraphListChanged((raw) => {
    callback(Array.isArray(raw) ? (raw as GraphCanvasListItem[]) : []);
  });
}

// W5 严格态:Registry 注册 + api 字段(view 通过 requireCapabilityApi 间接路由)
// W5 边界 A 临时允许项:同时保留模块级 export(driver/slot 内部消费可直 import)
capabilityRegistry.register({
  id: 'graph-library-store',
  api: {
    list,
    load,
    create,
    save,
    remove,
    rename,
    moveToFolder,
    duplicate,
    folderList,
    folderCreate,
    folderRename,
    folderDelete,
    folderMove,
    onGraphListChanged,
  } satisfies GraphLibraryStoreApi,
});
