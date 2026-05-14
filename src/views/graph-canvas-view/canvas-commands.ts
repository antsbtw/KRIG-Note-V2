/**
 * GraphCanvasView 命令注册(L5-G1)
 *
 * 命令 id 命名空间 `graph-canvas-view.*`(对齐 note-view.* / ebook-view.* /
 * web-view.*)。navSide actions / context-menu / keymap 都通过字符串引用走
 * commandRegistry。
 *
 * 简化(对齐 G1 design § 7):
 * - 砍 ebook 的 import / pickFile 路径(graph 创建直接 library.create,无需选文件)
 * - 砍 relocate / transferToManaged(graph 没文件丢失场景)
 * - 砍 open-failed trigger(graph 不会"加载失败")
 *
 * 桥接器模式对齐 ebook(rename / folderCreated / setActiveGraphId)。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { GraphLibraryStoreApi } from '@capabilities/graph-library-store/types';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
import {
  getGraphCanvasWsState,
  setActiveGraphId,
  setFolderExpanded,
} from './data-model';

/** 拿当前活跃 workspace id(commands 由用户在某 ws 触发,默认作用于活跃 ws)*/
function getActiveWorkspaceId(): string | null {
  return workspaceManager.getActiveId();
}

export function registerGraphCanvasCommands(): void {
  // ── 创建画板 ──
  // 直接 library.create + 自动 setActiveGraphId(创建即打开)+ 进重命名态
  commandRegistry.register('graph-canvas-view.create-canvas', async () => {
    const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
    const record = await library.create('Untitled Canvas', 'canvas', null);
    if (!record) return;
    const wsId = getActiveWorkspaceId();
    if (wsId) setActiveGraphId(wsId, record.id);
    pendingCanvasCreatedTrigger?.(record.id);
  });

  // ── 文件夹 CRUD ──

  commandRegistry.register('graph-canvas-view.create-folder', async () => {
    const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
    const folder = await library.folderCreate('新建文件夹', null);
    if (folder) pendingFolderCreatedTrigger?.(folder.id);
  });

  commandRegistry.register(
    'graph-canvas-view.create-folder-in',
    async (parentId: unknown) => {
      if (typeof parentId !== 'string' || !parentId) return;
      const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
      const folder = await library.folderCreate('新建文件夹', parentId);
      if (folder) {
        const wsId = getActiveWorkspaceId();
        if (wsId) setFolderExpanded(wsId, parentId, true);
        pendingFolderCreatedTrigger?.(folder.id);
      }
    },
  );

  // ── 打开画板(单击树项 / 双击 / 命令)──

  commandRegistry.register(
    'graph-canvas-view.open-canvas',
    (graphId: unknown) => {
      if (typeof graphId !== 'string' || !graphId) return;
      const wsId = getActiveWorkspaceId();
      if (wsId) setActiveGraphId(wsId, graphId);
    },
  );

  // ── 重命名 / 删除 / 移动 / 复制 ──

  commandRegistry.register(
    'graph-canvas-view.rename',
    (treeId: unknown) => {
      if (typeof treeId !== 'string' || !treeId) return;
      pendingRenameTrigger?.(treeId);
    },
  );

  commandRegistry.register(
    'graph-canvas-view.delete',
    async (treeId: unknown) => {
      if (typeof treeId !== 'string' || !treeId) return;
      const { type, id } = decodeTreeId(treeId);
      const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
      if (type === 'canvas') {
        await library.remove(id);
        const wsId = getActiveWorkspaceId();
        if (wsId) {
          const ws = workspaceManager.get(wsId);
          if (ws && getGraphCanvasWsState(ws).activeGraphId === id) {
            setActiveGraphId(wsId, null);
          }
        }
      } else {
        // decision 021 §5.5 Q7 弱保护 (R3 字面各自实施):含资源 folder 删除前 confirm
        // canvas-commands 是 view 层,跨 capability 调用允许(graph-library-store 不动 + folder capability 单独调)
        const folderCap = requireCapabilityApi<FolderCapabilityApi>('folder');
        const [preview, info] = await Promise.all([
          folderCap.previewDeleteFolder(id),
          folderCap.getFolder(id),
        ]);
        if (preview.resources > 0 || preview.folders > 0) {
          const folderTitle = info?.title ?? '(未命名)';
          const message =
            preview.resources > 0
              ? `删除文件夹「${folderTitle}」?包含 ${preview.folders} 个子文件夹 + ${preview.resources} 个文件,操作不可撤销(回收站功能未实施)`
              : `删除文件夹「${folderTitle}」?包含 ${preview.folders} 个子文件夹,操作不可撤销(回收站功能未实施)`;
          if (!window.confirm(message)) return;
        }
        await library.folderDelete(id);
      }
    },
  );

  commandRegistry.register(
    'graph-canvas-view.move-out',
    async (graphId: unknown) => {
      if (typeof graphId !== 'string' || !graphId) return;
      const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
      await library.moveToFolder(graphId, null);
    },
  );

  commandRegistry.register(
    'graph-canvas-view.duplicate',
    async (graphId: unknown) => {
      if (typeof graphId !== 'string' || !graphId) return;
      const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
      await library.duplicate(graphId);
    },
  );
}

// ── 桥接器(nav-side-content mount 时挂上,unmount 清掉)──

let pendingRenameTrigger: ((treeId: string) => void) | null = null;
let pendingFolderCreatedTrigger: ((folderId: string) => void) | null = null;
let pendingCanvasCreatedTrigger: ((graphId: string) => void) | null = null;

export function setRenameTrigger(cb: ((treeId: string) => void) | null): void {
  pendingRenameTrigger = cb;
}

export function setFolderCreatedTrigger(
  cb: ((folderId: string) => void) | null,
): void {
  pendingFolderCreatedTrigger = cb;
}

export function setCanvasCreatedTrigger(
  cb: ((graphId: string) => void) | null,
): void {
  pendingCanvasCreatedTrigger = cb;
}

// ── tree id 编码(canvas / folder)──

export function encodeTreeId(type: 'canvas' | 'folder', id: string): string {
  return `${type === 'folder' ? 'f' : 'c'}:${id}`;
}

export function decodeTreeId(
  treeId: string,
): { type: 'canvas' | 'folder'; id: string } {
  return {
    type: treeId.startsWith('f:') ? 'folder' : 'canvas',
    id: treeId.slice(2),
  };
}
