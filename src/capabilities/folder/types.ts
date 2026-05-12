/**
 * folder capability — 对外类型 (L7-sub2)
 *
 * view 通过 requireCapabilityApi<FolderCapabilityApi>('folder') 取 api。
 */

import type { FolderInfo } from '@shared/ipc/note-folder-types';

export type { FolderInfo };

export interface FolderDeleteResult {
  deletedFolders: number;
  deletedNotes: number;
  cascadedEdges: number;
}

export interface FolderCapabilityApi {
  createFolder(title: string, parentFolderId: string | null): Promise<FolderInfo | null>;
  listFolders(): Promise<FolderInfo[]>;
  getFolder(id: string): Promise<FolderInfo | null>;
  renameFolder(id: string, newTitle: string): Promise<FolderInfo | null>;
  moveFolder(folderId: string, newParentFolderId: string | null): Promise<void>;
  /** Path Y:递归删 folder + 子 folder + 内含笔记 (decision 012 设计师批复) */
  deleteFolder(id: string): Promise<FolderDeleteResult>;
  /** 订阅文件夹列表变更 (IPC 广播);返 unsubscribe */
  onListChanged(callback: (list: FolderInfo[]) => void): () => void;
}
