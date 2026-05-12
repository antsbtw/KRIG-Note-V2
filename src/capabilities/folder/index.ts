/**
 * folder capability — renderer 端薄包装 (decision 012 §3.4 方案 A)
 *
 * 实施位置:src/platform/main/folder/ (capability-impl + handlers)
 * 本文件:把 window.electronAPI.folderXxx 扁平驼峰 alias 成业务名 (createFolder / listFolders / ...)
 *
 * 设计师批复 P1:V2 扁平驼峰惯例,renderer 端 capability 包装层吸收命名差异。
 *
 * 边界:
 * - view 层 import { folderCapability } from '@capabilities/folder',零感知 IPC
 */

import type { FolderInfo } from '@shared/ipc/note-folder-types';

export type { FolderInfo } from '@shared/ipc/note-folder-types';

export const folderCapability = {
  async createFolder(
    title: string,
    parentFolderId: string | null = null,
  ): Promise<FolderInfo | null> {
    return window.electronAPI.folderCreate(title, parentFolderId);
  },
  async listFolders(): Promise<FolderInfo[]> {
    return window.electronAPI.folderList();
  },
  async getFolder(id: string): Promise<FolderInfo | null> {
    return window.electronAPI.folderGet(id);
  },
  async renameFolder(id: string, newTitle: string): Promise<FolderInfo | null> {
    return window.electronAPI.folderRename(id, newTitle);
  },
  async moveFolder(folderId: string, newParentFolderId: string | null): Promise<void> {
    return window.electronAPI.folderMove(folderId, newParentFolderId);
  },
  async deleteFolder(id: string): Promise<void> {
    return window.electronAPI.folderDelete(id);
  },
  /** 订阅文件夹列表变更;返 unsubscribe */
  onListChanged(callback: (list: FolderInfo[]) => void): () => void {
    return window.electronAPI.onFolderListChanged(callback);
  },
};
