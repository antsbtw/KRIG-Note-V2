/**
 * NavSide 内容注册 + FolderTreePanel 组件
 *
 * L5-A 单层 NoteList → L5-B1 FolderTree 完整树状面板。
 * 见 docs/RefactorV2/stages/L5B1-folder-tree-design.md § 4.7。
 */

import { useState, useEffect, useSyncExternalStore } from 'react';
import { navSideRegistry } from '@slot/nav-side-registry/nav-side-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { FolderTree, type ItemNode, type TreeNode, type KeyAction } from '@slot/shared-ui/FolderTree';
import {
  useActiveWorkspaceId,
  useWorkspace,
} from '@workspace/workspace-instance/use-workspace';
import type { NoteInfo as Note } from '@capabilities/note/types';
import { useAllNotes, useAllFolders } from './use-notes-folders';
import {
  getNoteWsState,
  setSelectedIds,
  setFolderExpanded,
  subscribeTransient,
  getTransientVersion,
  renameFolder,
} from './data-model';
import { buildTreeNodes, decodeTreeId, relativeTime } from './tree-builder';
import { handleDrop } from './tree-operations';
import { setRenameTrigger } from './context-menu-registrations';

function FolderTreePanel() {
  const wsId = useActiveWorkspaceId();
  const ws = useWorkspace(wsId);

  // 订阅 noteCapability / folderCapability(IPC 广播)
  const allNotes = useAllNotes();
  const allFolders = useAllFolders('note');

  // 订阅 transient selectedIds(每 ws 独立,不持久化)— 版本号触发重渲
  useSyncExternalStore(
    (cb) => subscribeTransient(cb),
    () => getTransientVersion(),
  );

  // 重命名局部 state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // 把 setRenameTrigger 桥到右键菜单(mount 时挂上,unmount 时清掉)
  // L7-sub2:从本地缓存 (allNotes / allFolders) 查 title,避免 async 路径
  useEffect(() => {
    setRenameTrigger((treeId) => {
      const { type, id } = decodeTreeId(treeId);
      const item =
        type === 'note'
          ? allNotes.find((n) => n.id === id)
          : allFolders.find((f) => f.id === id);
      if (!item) return;
      setRenamingId(treeId);
      setRenameValue(item.title);
    });
    return () => setRenameTrigger(null);
  }, [allNotes, allFolders]);

  if (!wsId || !ws) return null;
  const wsState = getNoteWsState(ws);

  const nodes = buildTreeNodes({
    notes: allNotes,
    folders: allFolders,
    expandedFolders: wsState.expandedFolders,
    folderSortMap: wsState.folderSortMap,
  });

  const handleKeyAction = (action: KeyAction, target: TreeNode) => {
    if (action === 'enter') {
      if (target.kind === 'item') {
        const noteId = decodeTreeId(target.id).id;
        commandRegistry.execute('note-view.set-active', noteId);
      }
    } else if (action === 'rename') {
      const { type, id } = decodeTreeId(target.id);
      const item =
        type === 'note'
          ? allNotes.find((n) => n.id === id)
          : allFolders.find((f) => f.id === id);
      if (item) {
        setRenamingId(target.id);
        setRenameValue(item.title);
      }
    } else if (action === 'delete') {
      // 多选 → 批量;否则 → 删 target
      if (wsState.selectedIds.size > 1 && wsState.selectedIds.has(target.id)) {
        commandRegistry.execute('note-view.delete-active');
      } else {
        commandRegistry.execute('note-view.delete-by-tree-id', target.id);
      }
    }
  };

  const commitRename = (treeId: string) => {
    const { type, id } = decodeTreeId(treeId);
    const trimmed = renameValue.trim();
    if (trimmed) {
      // L7-sub2:
      // - folder:可直接 rename(title 是真实字段)
      // - note:title 派生自 doc.content[0],L5-A 兼容路径不支持纯改 title
      //   (改名要改 doc 首段文本,由 NoteView/编辑器路径承担);本处 fire-and-forget 忽略
      if (type === 'folder') void renameFolder(id, trimmed);
    }
    setRenamingId(null);
  };

  return (
    <FolderTree
      nodes={nodes}
      selectedIds={wsState.selectedIds}
      onSelectChange={(ids) => setSelectedIds(wsId, ids)}
      onFolderToggle={(treeFolderId, expanded) => {
        const { id } = decodeTreeId(treeFolderId);
        setFolderExpanded(wsId, id, expanded);
      }}
      itemMeta={(item: ItemNode) => {
        const note = item.payload as Note;
        return {
          icon: '📄',
          title: note.title || '未命名',
          rightHint: relativeTime(note.updatedAt),
        };
      }}
      onItemClick={(item) => {
        const noteId = decodeTreeId(item.id).id;
        commandRegistry.execute('note-view.set-active', noteId);
      }}
      onItemDoubleClick={(item) => {
        const noteId = decodeTreeId(item.id).id;
        const note = allNotes.find((n) => n.id === noteId);
        if (note) {
          setRenamingId(item.id);
          setRenameValue(note.title);
        }
      }}
      draggable
      onDrop={(ids, targetTreeFolderId) => {
        const targetFolderId = targetTreeFolderId ? decodeTreeId(targetTreeFolderId).id : null;
        void handleDrop(wsId, ids, targetFolderId);
      }}
      onKeyAction={handleKeyAction}
      renamingId={renamingId}
      renamingValue={renameValue}
      onRenamingChange={setRenameValue}
      onRenameCommit={commitRename}
      onRenameCancel={() => setRenamingId(null)}
      contextMenuScope="note-view"
      contextMenuCtxExtra={() => ({
        sortMap: wsState.folderSortMap,
        hasClipboard: !!wsState.clipboard,
      })}
      emptyText="暂无笔记 — 右键创建"
    />
  );
}

export function registerNavSide(): void {
  navSideRegistry.register({
    view: 'note-view',
    title: '笔记目录',
    actions: [
      { id: 'create-note', label: '+ 笔记', command: 'note-view.create-note' },
      { id: 'create-folder', label: '+ 文件夹', command: 'note-view.create-folder' },
    ],
    searchPlaceholder: '搜索笔记...',
    onSearch: () => {
      // L5-B1 不实施过滤(留 L5-B2+)
    },
    contentRenderer: () => <FolderTreePanel />,
  });
}
