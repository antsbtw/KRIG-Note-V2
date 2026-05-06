/**
 * FolderTree 数据契约
 *
 * 1:1 沿用 V1 src/renderer/navside/components/FolderTree/types.ts。
 * V2 改造:contextMenu callback 改为 contextMenuScope + registry(Q7=方案 2)。
 */

import type { ReactNode } from 'react';

export type TreeNode = FolderNode | ItemNode;

export interface FolderNode {
  kind: 'folder';
  id: string;
  parentId: string | null;
  title: string;
  expanded: boolean;
  children: TreeNode[];
}

export interface ItemNode {
  kind: 'item';
  id: string;
  parentId: string | null;
  payload: unknown;
  sortKey?: number | string;
}

export interface ItemMeta {
  icon: string | ReactNode;
  title: string;
  rightHint?: string;
}

/** 菜单项(给 ContextMenuPopover 渲染用) */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  separator?: boolean;
  disabled?: boolean;
  command?: string;
  commandArg?: unknown;
  onClick?: () => void;
}

/** 菜单上下文(传给 registry 的 enabledWhen / 动态 label / commandArg 函数) */
export interface FolderTreeContextInfo {
  scope: string;
  target: 'item' | 'folder' | 'blank';
  targetId: string | null;
  isMulti: boolean;
  selectedCount: number;
  hasClipboard: boolean;
  extra?: Record<string, unknown>;
}

export type KeyAction = 'delete' | 'rename' | 'enter';

export interface FolderTreeProps {
  nodes: TreeNode[];
  selectedIds: Set<string>;
  onSelectChange: (ids: Set<string>) => void;
  onFolderToggle: (folderId: string, expanded: boolean) => void;
  itemMeta: (item: ItemNode) => ItemMeta;
  onItemClick?: (item: ItemNode, e: React.MouseEvent) => void;
  onItemDoubleClick?: (item: ItemNode) => void;
  draggable?: boolean;
  onDrop?: (draggedIds: string[], targetFolderId: string | null) => void;
  onKeyAction?: (action: KeyAction, target: TreeNode) => void;

  /** inline rename 受控 */
  renamingId?: string | null;
  renamingValue?: string;
  onRenamingChange?: (value: string) => void;
  onRenameCommit?: (id: string) => void;
  onRenameCancel?: () => void;

  /** 右键菜单 scope(走 folderTreeContextMenuRegistry) */
  contextMenuScope?: string;
  /** 业务向 registry 提供 ctx 的 extra 字段(动态值) */
  contextMenuCtxExtra?: () => Record<string, unknown>;

  emptyText?: string;
}
