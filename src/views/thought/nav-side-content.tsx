/**
 * Thought NavSide 内容注册 + FolderTreePanel(对齐 views/note/nav-side-content.tsx)
 */

import { useSyncExternalStore } from 'react';
import { navSideRegistry } from '@slot/nav-side-registry/nav-side-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';
import {
  FolderTree,
  type ItemNode,
  type TreeNode,
  type KeyAction,
} from '@slot/shared-ui/FolderTree';
import {
  useActiveWorkspaceId,
  useWorkspace,
} from '@workspace/workspace-instance/use-workspace';
import type { ThoughtInfo } from '@capabilities/thought/types';
import { useAllThoughts, useAllThoughtFolders } from './use-thoughts-folders';
import {
  getThoughtWsState,
  setSelectedIds,
  setFolderExpanded,
  subscribeTransient,
  getTransientVersion,
} from './data-model';
import {
  buildTreeNodes,
  decodeTreeId,
  relativeTime,
  deriveThoughtTitle,
} from './tree-builder';
import { THOUGHT_TYPE_META } from '@shared/ipc/thought-types';

function FolderTreePanel() {
  const wsId = useActiveWorkspaceId();
  const ws = useWorkspace(wsId);

  const allThoughts = useAllThoughts();
  const allFolders = useAllThoughtFolders();

  useSyncExternalStore(
    (cb) => subscribeTransient(cb),
    () => getTransientVersion(),
  );

  if (!wsId || !ws) return null;
  const wsState = getThoughtWsState(ws);

  const nodes = buildTreeNodes({
    thoughts: allThoughts,
    folders: allFolders,
    expandedFolders: wsState.expandedFolders,
  });

  const handleKeyAction = (action: KeyAction, target: TreeNode) => {
    if (action === 'enter' && target.kind === 'item') {
      const id = decodeTreeId(target.id).id;
      commandRegistry.execute('thought-view.set-active', id);
    } else if (action === 'delete') {
      commandRegistry.execute('thought-view.delete-by-tree-id', target.id);
    }
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
        const t = item.payload as ThoughtInfo;
        const meta = THOUGHT_TYPE_META[t.type];
        return {
          icon: meta.icon,
          title: deriveThoughtTitle(t),
          rightHint: relativeTime(t.updatedAt),
        };
      }}
      onItemClick={(item) => {
        const id = decodeTreeId(item.id).id;
        commandRegistry.execute('thought-view.set-active', id);
      }}
      onKeyAction={handleKeyAction}
      contextMenuScope="thought-view"
      emptyText="暂无思考 — 上方 +Thought 新建"
    />
  );
}

export function registerNavSide(): void {
  navSideRegistry.register({
    view: 'thought-view',
    title: '思考',
    actions: [
      { id: 'create-thought', label: '+ Thought', command: 'thought-view.create-thought' },
      { id: 'create-folder', label: '+ 文件夹', command: 'thought-view.create-folder' },
    ],
    searchPlaceholder: '搜索思考...',
    onSearch: () => {
      // Phase 2 不实施过滤
    },
    contentRenderer: () => <FolderTreePanel />,
  });
}
