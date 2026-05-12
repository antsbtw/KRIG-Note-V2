/**
 * folder capability — renderer 端薄包装 (decision 012 §3.4 方案 A)
 *
 * 实施位置:src/platform/main/folder/ (capability-impl + handlers)
 * 本文件:把 window.electronAPI.folderXxx 扁平驼峰 alias 成业务名 (createFolder / listFolders / ...)
 *
 * W5 严格态:Registry 注册 + api 字段(view 通过 requireCapabilityApi 间接路由)
 * W5 边界 A 临时允许项:同时保留模块级 export(driver/slot 内部消费可直 import)。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type {
  FolderCapabilityApi,
  FolderInfo,
  FolderDeleteResult,
} from './types';

export type { FolderCapabilityApi, FolderInfo, FolderDeleteResult } from './types';

async function createFolder(
  title: string,
  parentFolderId: string | null = null,
): Promise<FolderInfo | null> {
  return window.electronAPI.folderCreate(title, parentFolderId);
}
async function listFolders(): Promise<FolderInfo[]> {
  return window.electronAPI.folderList();
}
async function getFolder(id: string): Promise<FolderInfo | null> {
  return window.electronAPI.folderGet(id);
}
async function renameFolder(id: string, newTitle: string): Promise<FolderInfo | null> {
  return window.electronAPI.folderRename(id, newTitle);
}
async function moveFolder(folderId: string, newParentFolderId: string | null): Promise<void> {
  return window.electronAPI.folderMove(folderId, newParentFolderId);
}
/** Path Y:删 folder 递归删子 folder + 内含笔记 (decision 012 设计师批复) */
async function deleteFolder(id: string): Promise<FolderDeleteResult> {
  return window.electronAPI.folderDelete(id);
}
function onListChanged(callback: (list: FolderInfo[]) => void): () => void {
  return window.electronAPI.onFolderListChanged(callback);
}

export const folderCapability: FolderCapabilityApi = {
  createFolder,
  listFolders,
  getFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  onListChanged,
};

// W5 严格态:Registry 注册 — view 走 requireCapabilityApi<FolderCapabilityApi>('folder')
capabilityRegistry.register({
  id: 'folder',
  api: folderCapability,
});
