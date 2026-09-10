/**
 * GraphCanvasView NavSide 内容(L5-G1)
 *
 * 形态对齐 ebook nav-side-content,但精简(决策 G1-1 / G1-12 + design § 7):
 * - 删 ImportModal + pickFile(graph 创建直接 library.create,无需选文件)
 * - 删 relocate / transferToManaged 右键项(graph 没文件丢失场景)
 * - 删 openFailed toast(graph 不会"加载失败")
 * - 加 duplicate 右键项
 * - rightHint 显示 updated_at(对齐 V1 GraphPanel 的"刚刚 / N 分钟前 / N 小时前 / 日期")
 *
 * 数据来源:
 * - 全局画板列表 + 文件夹 → graph-library-store capability(IPC + onGraphListChanged 推流)
 * - per-ws activeGraphId / expandedFolders / selectedIds → views/graph-canvas-view/data-model
 *
 * 不做(留 G3+):
 * - 画板缩略图(画板内容渲染走 G3 起 canvas-rendering)
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { navSideRegistry } from '@slot/nav-side-registry/nav-side-registry';
import { folderTreeContextMenuRegistry } from '@slot/nav-side-registry/folder-tree-context-menu-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import {
  FolderTree,
  type ItemNode,
  type TreeNode,
  type FolderNode,
  type KeyAction,
} from '@slot/shared-ui/FolderTree';
import { useWsId } from '@workspace/workspace-context/ws-id-context';
import { useWorkspace } from '@workspace/workspace-instance/use-workspace';
import type {
  GraphLibraryStoreApi,
  GraphCanvasListItem,
  MindDocListItem,
  GraphFolderRecord,
} from '@capabilities/graph-library-store/types';
import {
  getGraphCanvasWsState,
  setSelectedIds,
  setFolderExpanded,
} from './data-model';
import {
  encodeTreeId,
  decodeTreeId,
  setRenameTrigger,
  setFolderCreatedTrigger,
  setCanvasCreatedTrigger,
  setCreateMenuTrigger,
} from './canvas-commands';
import { relativeTime } from '@shared/date-utils';
import { ContextMenuPopover } from '@slot/shared-ui/ContextMenuPopover';

/** 树项载荷:画板与导图混排,用 kind 区分(B1)。 */
type TreeItemPayload =
  | { kind: 'canvas'; item: GraphCanvasListItem }
  | { kind: 'mind'; item: MindDocListItem };

function CanvasListPanel() {
  const wsId = useWsId();
  const ws = useWorkspace(wsId);

  const library = useMemo(
    () => requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store'),
    [],
  );

  // 订阅全局画板列表 + 文件夹(走 capability,IPC + onGraphListChanged 推流)
  const [canvases, setCanvases] = useState<GraphCanvasListItem[]>([]);
  /** ⭐ B1:导图在另一张表,单独一份 state,渲染时与画板合并成一棵树 */
  const [minds, setMinds] = useState<MindDocListItem[]>([]);
  const [folders, setFolders] = useState<GraphFolderRecord[]>([]);

  const refresh = useCallback(() => {
    void library.list().then(setCanvases).catch(() => {});
    void library.mindList().then(setMinds).catch(() => {});
    void library.folderList().then(setFolders).catch(() => {});
  }, [library]);

  useEffect(() => {
    refresh();
    // ⚠️ 两个推流都要订阅 —— 只订一个的话,另一类的增删改在树上不刷新
    //    (现象是"新建了但列表里没有",极易误判成没保存)
    const offGraph = library.onGraphListChanged(() => refresh());
    const offMind = library.onMindListChanged(() => refresh());
    return () => {
      offGraph();
      offMind();
    };
  }, [library, refresh]);

  /** ⭐「+ 新建」类型选择菜单(用户拍板:不摆一排 button) */
  const [createMenuAt, setCreateMenuAt] = useState<{ x: number; y: number } | null>(null);

  // 重命名局部 state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // 桥接 commands → rename / canvasCreated / folderCreated
  useEffect(() => {
    setRenameTrigger((treeId) => {
      const { type, id } = decodeTreeId(treeId);
      const cur =
        type === 'canvas'
          ? canvases.find((c) => c.id === id)?.title
          : type === 'mind'
            ? minds.find((m) => m.id === id)?.title
            : folders.find((f) => f.id === id)?.title;
      if (cur === undefined) return;
      setRenamingId(treeId);
      setRenameValue(cur);
    });
    setFolderCreatedTrigger((folderId) => {
      const cur = folders.find((f) => f.id === folderId);
      setRenamingId(encodeTreeId('folder', folderId));
      setRenameValue(cur?.title ?? '新建文件夹');
    });
    setCreateMenuTrigger((pos) => setCreateMenuAt(pos));
    setCanvasCreatedTrigger((treeIdOrId) => {
      // ⭐ create-mind 传的是 treeId(带 m: 前缀),create-canvas 传裸 id
      const isTree = treeIdOrId.includes(':');
      const { type, id } = isTree
        ? decodeTreeId(treeIdOrId)
        : { type: 'canvas' as const, id: treeIdOrId };
      const cur =
        type === 'mind'
          ? minds.find((m) => m.id === id)?.title
          : canvases.find((c) => c.id === id)?.title;
      setRenamingId(encodeTreeId(type, id));
      setRenameValue(cur ?? (type === 'mind' ? '未命名导图' : 'Untitled Canvas'));
    });
    return () => {
      setRenameTrigger(null);
      setFolderCreatedTrigger(null);
      setCanvasCreatedTrigger(null);
      setCreateMenuTrigger(null);
    };
  }, [canvases, minds, folders]);

  if (!wsId || !ws) return null;
  const wsState = getGraphCanvasWsState(ws);

  // ── TreeNode[] ──

  const buildChildren = (parentId: string | null): TreeNode[] => {
    const out: TreeNode[] = [];
    const subFolders = folders
      .filter((f) => f.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order);
    for (const f of subFolders) {
      const node: FolderNode = {
        kind: 'folder',
        id: encodeTreeId('folder', f.id),
        parentId: parentId ? encodeTreeId('folder', parentId) : null,
        title: f.title,
        expanded: wsState.expandedFolders.has(f.id),
        children: buildChildren(f.id),
      };
      out.push(node);
    }
    // ⭐ B1 混排:画板与导图来自两张表,按 updated_at 统一排序后混在同一层
    const items: { treeId: string; updated_at: number; payload: TreeItemPayload }[] = [
      ...canvases
        .filter((c) => (c.folder_id ?? null) === parentId)
        .map((c) => ({
          treeId: encodeTreeId('canvas', c.id),
          updated_at: c.updated_at,
          payload: { kind: 'canvas' as const, item: c },
        })),
      ...minds
        .filter((m) => (m.folder_id ?? null) === parentId)
        .map((m) => ({
          treeId: encodeTreeId('mind', m.id),
          updated_at: m.updated_at,
          payload: { kind: 'mind' as const, item: m },
        })),
    ].sort((a, b) => b.updated_at - a.updated_at);

    for (const it of items) {
      const node: ItemNode = {
        kind: 'item',
        id: it.treeId,
        parentId: parentId ? encodeTreeId('folder', parentId) : null,
        payload: it.payload,
      };
      out.push(node);
    }
    return out;
  };
  const nodes = buildChildren(null);

  // ── 重命名提交 ──

  const commitRename = (treeId: string): void => {
    const { type, id } = decodeTreeId(treeId);
    const trimmed = renameValue.trim();
    if (trimmed) {
      // ⭐ B1 分发:三类各归各的 store
      if (type === 'canvas') void library.rename(id, trimmed);
      else if (type === 'mind') void library.mindRename(id, trimmed);
      else void library.folderRename(id, trimmed);
    }
    setRenamingId(null);
  };

  // ── 拖拽 ──

  const isDescendantFolder = (parentId: string, childId: string): boolean => {
    let current: string | null = childId;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return false;
      visited.add(current);
      if (current === parentId) return true;
      const f = folders.find((x) => x.id === current);
      current = f?.parent_id ?? null;
    }
    return false;
  };

  const handleDrop = (
    draggedTreeIds: string[],
    targetTreeFolderId: string | null,
  ): void => {
    const targetFolderId = targetTreeFolderId
      ? decodeTreeId(targetTreeFolderId).id
      : null;
    let needExpand = false;
    for (const treeId of draggedTreeIds) {
      const { type, id } = decodeTreeId(treeId);
      if (type === 'canvas') {
        const c = canvases.find((x) => x.id === id);
        if (c && (c.folder_id ?? null) !== targetFolderId) {
          void library.moveToFolder(id, targetFolderId);
          if (targetFolderId) needExpand = true;
        }
      } else {
        const f = folders.find((x) => x.id === id);
        if (f && f.parent_id !== targetFolderId) {
          if (!targetFolderId || !isDescendantFolder(id, targetFolderId)) {
            void library.folderMove(id, targetFolderId);
            if (targetFolderId) needExpand = true;
          }
        }
      }
    }
    if (needExpand && targetFolderId && wsId) {
      setFolderExpanded(wsId, targetFolderId, true);
    }
  };

  // ── 键盘 ──

  const handleKeyAction = (action: KeyAction, target: TreeNode): void => {
    if (action === 'enter') {
      if (target.kind === 'item') {
        commandRegistry.execute(
          'graph-canvas-view.open-canvas',
          decodeTreeId(target.id).id,
        );
      }
    } else if (action === 'rename') {
      commandRegistry.execute('graph-canvas-view.rename', target.id);
    } else if (action === 'delete') {
      commandRegistry.execute('graph-canvas-view.delete', target.id);
    }
  };

  return (
    <>
    {createMenuAt && (
      <ContextMenuPopover
        x={createMenuAt.x}
        y={createMenuAt.y}
        items={[
          {
            id: 'new-canvas',
            label: '画板',
            icon: '🎨',
            command: 'graph-canvas-view.create-canvas',
          },
          {
            id: 'new-mind',
            label: '思维导图',
            icon: '🧠',
            command: 'graph-canvas-view.create-mind',
          },
          // ⚠️ 文件夹是**容器**不是文件类型,用分隔线隔开
          { id: 'sep', label: '', separator: true },
          {
            id: 'new-folder',
            label: '文件夹',
            icon: '📁',
            command: 'graph-canvas-view.create-folder',
          },
        ]}
        onClose={() => setCreateMenuAt(null)}
      />
    )}
    <FolderTree
      nodes={nodes}
      selectedIds={wsState.selectedIds}
      onSelectChange={(ids) => setSelectedIds(wsId, ids)}
      onFolderToggle={(treeFolderId, expanded) => {
        const { id } = decodeTreeId(treeFolderId);
        setFolderExpanded(wsId, id, expanded);
      }}
      itemMeta={(item: ItemNode) => {
        const p = item.payload as TreeItemPayload;
        // ⭐ 图标区分类型:画板 🎨 / 导图 🧠(用户定义:mind 是画板中的一种)
        return {
          icon: p.kind === 'mind' ? '🧠' : '🎨',
          title: p.item.title || (p.kind === 'mind' ? '未命名导图' : 'Untitled Canvas'),
          rightHint: relativeTime(p.item.updated_at),
        };
      }}
      onItemClick={(item) => {
        commandRegistry.execute(
          'graph-canvas-view.open-canvas',
          decodeTreeId(item.id).id,
        );
      }}
      onItemDoubleClick={(item) => {
        commandRegistry.execute('graph-canvas-view.rename', item.id);
      }}
      draggable
      onDrop={handleDrop}
      onKeyAction={handleKeyAction}
      renamingId={renamingId}
      renamingValue={renameValue}
      onRenamingChange={setRenameValue}
      onRenameCommit={commitRename}
      onRenameCancel={() => setRenamingId(null)}
      contextMenuScope="graph-canvas-view"
      contextMenuCtxExtra={() => ({
        activeGraphId: wsState.activeGraphId,
      })}
      emptyText="点击上方 + 新建 创建画板或思维导图"
    />
    </>
  );
}

// ── 注册 ──

/** 注册 NavSide 内容(view 级 — view active 时显示)*/
export function registerNavSide(): void {
  navSideRegistry.register({
    view: 'graph-canvas-view',
    title: '画板',
    actions: [
      {
        // ⭐ 用户拍板(2026-09-10):点 + 弹「文件类型选择」,不摆一排 button。
        //    定义:mind 是画板中的一种 —— 故同一个入口下选类型,
        //    将来加 bpmn / 知识图谱只是往菜单里加一行,不再长按钮。
        id: 'create-new',
        label: '+ 新建',
        command: 'graph-canvas-view.show-create-menu',
      },
    ],
    searchPlaceholder: '搜索画板...',
    onSearch: () => {
      // G1 不实施过滤(搜索留后续阶段统一做)
    },
    contentRenderer: () => <CanvasListPanel />,
  });
}

/** 注册 FolderTree 右键菜单(scope='graph-canvas-view')*/
export function registerFolderTreeContextMenu(): void {
  // ── 空白处右键 ──
  folderTreeContextMenuRegistry.register({
    id: 'graph-new-folder-blank',
    scope: 'graph-canvas-view',
    appliesTo: ['blank'],
    label: '新建文件夹',
    icon: '📁',
    command: 'graph-canvas-view.create-folder',
    order: 10,
  });
  folderTreeContextMenuRegistry.register({
    id: 'graph-blank-sep',
    scope: 'graph-canvas-view',
    appliesTo: ['blank'],
    label: '',
    separator: true,
    order: 20,
  });
  folderTreeContextMenuRegistry.register({
    id: 'graph-create-canvas-blank',
    scope: 'graph-canvas-view',
    appliesTo: ['blank'],
    label: '新建画板',
    icon: '🎨',
    command: 'graph-canvas-view.create-canvas',
    order: 30,
  });

  folderTreeContextMenuRegistry.register({
    id: 'graph-create-mind-blank',
    scope: 'graph-canvas-view',
    appliesTo: ['blank'],
    label: '新建思维导图',
    icon: '🧠',
    command: 'graph-canvas-view.create-mind',
    order: 31,
  });

  // ── 文件夹右键 — 在此新建子文件夹 ──
  folderTreeContextMenuRegistry.register({
    id: 'graph-new-folder-in',
    scope: 'graph-canvas-view',
    appliesTo: ['folder'],
    label: '在此新建文件夹',
    icon: '📁',
    command: 'graph-canvas-view.create-folder-in',
    commandArgFn: (ctx) =>
      ctx.targetId ? decodeTreeId(ctx.targetId).id : null,
    order: 10,
  });
  folderTreeContextMenuRegistry.register({
    id: 'graph-folder-sep1',
    scope: 'graph-canvas-view',
    appliesTo: ['folder'],
    label: '',
    separator: true,
    order: 20,
  });

  // ── 重命名 — folder + item 都有 ──
  folderTreeContextMenuRegistry.register({
    id: 'graph-rename',
    scope: 'graph-canvas-view',
    appliesTo: ['folder', 'item'],
    label: '重命名',
    icon: '✎',
    disabled: (ctx) => ctx.isMulti,
    command: 'graph-canvas-view.rename',
    commandArgFn: (ctx) => ctx.targetId,
    order: 30,
  });

  // ── 复制画板 ──
  folderTreeContextMenuRegistry.register({
    id: 'graph-duplicate',
    scope: 'graph-canvas-view',
    appliesTo: ['item'],
    label: '复制',
    icon: '📋',
    enabledWhen: (ctx) => !ctx.isMulti,
    command: 'graph-canvas-view.duplicate',
    commandArgFn: (ctx) =>
      ctx.targetId ? decodeTreeId(ctx.targetId).id : null,
    order: 35,
  });

  // ── 移出文件夹 — 仅 item ──
  folderTreeContextMenuRegistry.register({
    id: 'graph-move-out',
    scope: 'graph-canvas-view',
    appliesTo: ['item'],
    label: '移出文件夹',
    icon: '↗',
    enabledWhen: (ctx) => !ctx.isMulti && ctx.target === 'item',
    command: 'graph-canvas-view.move-out',
    commandArgFn: (ctx) =>
      ctx.targetId ? decodeTreeId(ctx.targetId).id : null,
    order: 40,
  });

  // ── 分隔符 + 删除 ──
  folderTreeContextMenuRegistry.register({
    id: 'graph-delete-sep',
    scope: 'graph-canvas-view',
    appliesTo: ['folder', 'item'],
    label: '',
    separator: true,
    order: 90,
  });
  folderTreeContextMenuRegistry.register({
    id: 'graph-delete',
    scope: 'graph-canvas-view',
    appliesTo: ['folder', 'item'],
    label: (ctx) =>
      ctx.isMulti ? `删除 ${ctx.selectedCount} 项` : '删除',
    icon: '🗑',
    command: 'graph-canvas-view.delete',
    commandArgFn: (ctx) => ctx.targetId,
    order: 100,
  });
}
