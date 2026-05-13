/**
 * folder capability — 对外类型 (L7-sub2)
 *
 * view 通过 requireCapabilityApi<FolderCapabilityApi>('folder') 取 api。
 */

import type { FolderInfo } from '@shared/ipc/note-folder-types';

export type { FolderInfo };

/**
 * 视图归属标记 (decision 021 §4.1).
 *
 * folder atom 通过 user:krig:folderForView 边表达 view 归属:
 * - 'note'  → object literal '__view__/note'
 * - 'graph' → object literal '__view__/graph'
 * - future sub-phase 022 加 | 'ebook' (现状 ebook 走独立 JSON 树,不接 atom)
 */
export type FolderViewType = 'note' | 'graph';

export interface FolderDeleteResult {
  deletedFolders: number;
  /**
   * sub-phase 3a-1 (decision 014 §6.2.6 + 5.6.bis) 扩展:
   * cascade scope 从仅 'pm' (note) 扩展到 ['pm', 'graph-canvas',future 'ebook' 等],
   * 字段命名 deletedNotes → deletedResources 反映 scope 扩展。
   * (无 caller 真实消费旧字段名,grep 仅声明位置)
   */
  deletedResources: number;
  cascadedEdges: number;
}

export interface FolderCapabilityApi {
  /**
   * decision 021 §4.1: viewType 必传,写 folder atom + folderForView 边 + (可选) inFolder 边.
   */
  createFolder(
    title: string,
    parentFolderId: string | null,
    viewType: FolderViewType,
  ): Promise<FolderInfo | null>;
  /**
   * decision 021 §4.1: viewType 必传,过滤当前 view 的 folder atom.
   * 无 folderForView 边的 folder atom (孤儿) 不返.
   */
  listFolders(viewType: FolderViewType): Promise<FolderInfo[]>;
  getFolder(id: string): Promise<FolderInfo | null>;
  renameFolder(id: string, newTitle: string): Promise<FolderInfo | null>;
  moveFolder(folderId: string, newParentFolderId: string | null): Promise<void>;
  /**
   * Path Y:递归删 folder + 子 folder + 内含资源 (pm note + graph-canvas + future)。
   * decision 012 设计师批复 + decision 014 §6.2.6 cascade scope 扩展。
   */
  deleteFolder(id: string): Promise<FolderDeleteResult>;
  /** 订阅文件夹列表变更 (IPC 广播);返 unsubscribe */
  onListChanged(callback: (list: FolderInfo[]) => void): () => void;
}
