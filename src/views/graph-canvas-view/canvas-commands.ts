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
import { registerWsCommand } from '@slot/command-registry/register-ws-command';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { GraphLibraryStoreApi } from '@capabilities/graph-library-store/types';
import type { DiglotModelApi } from '@capabilities/diglot-model/types';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
import {
  getGraphCanvasWsState,
  setActiveGraphId,
  setFolderExpanded,
} from './data-model';

export function registerGraphCanvasCommands(wsId: string): void {
  // ── 创建画板 ──
  // 直接 library.create + 自动 setActiveGraphId(创建即打开)+ 进重命名态
  registerWsCommand('graph-canvas-view.create-canvas', () => wsId, async (ctx) => {
    const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
    const record = await library.create('Untitled Canvas', 'canvas', null);
    if (!record) return;
    setActiveGraphId(ctx.wsId, record.id);
    pendingCanvasCreatedTrigger?.(record.id);
  });

  // ── 创建思维导图(diglot mind v0)──
  // ⭐ 方案 B1(用户拍板 2026-09-10):导图存**独立表 mind_doc**,
  //    共用 graph 的文件夹与左侧树(🎨 与 🧠 混排)。
  // ⚠️ 曾走过方案 A(塞 graph_canvas 的 doc_content),真机实测**内容被静默丢弃** ——
  //    canvas-store 把 doc_content 拆成 instance 原子,两段纯文本没有容身处。
  // ⚠️ 仍非最终归属:规格方向是「mind 就是一篇 note」(01-mind-spec §3.4);
  //    迁移时两段纯文本可直接喂 note 导入,不会白写。见 03-projection-map §7。
  registerWsCommand('graph-canvas-view.create-mind', () => wsId, async (ctx) => {
    const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
    // ⚠️ 走间接路由取 capability(view 不直接 import 运行时值,W5 §5)
    const diglot = requireCapabilityApi<DiglotModelApi>('diglot-model');
    // ⭐ B1:走 mind 自己的表,一步到位带上初始内容
    //    (不再借 graph_canvas —— 那张表会把两段文本静默丢弃,真机实测过)
    const tpl = diglot.emptyMindFile() as { semantic: string; graphic: string };
    const record = await library.mindCreate('未命名导图', tpl.semantic, tpl.graphic, null);
    if (!record) return;
    setActiveGraphId(ctx.wsId, record.id);
    pendingCanvasCreatedTrigger?.(encodeTreeId('mind', record.id));
  });

  // ── ⭐「+ 新建」类型选择菜单(用户拍板 2026-09-10)──
  // 弹一个菜单选文件类型,而不是摆一排 button。
  // ⚠️ 菜单位置由命令发起处给:navSide 按钮没有 DOM 引用可拿,
  //    故用 window 尺寸估一个左上角锚点(NavSide 宽度固定)。
  commandRegistry.register('graph-canvas-view.show-create-menu', () => {
    pendingCreateMenuTrigger?.({ x: 96, y: 84 });
  });

  // ── 文件夹 CRUD ──

  commandRegistry.register('graph-canvas-view.create-folder', async () => {
    const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
    const folder = await library.folderCreate('新建文件夹', null);
    if (folder) pendingFolderCreatedTrigger?.(folder.id);
  });

  registerWsCommand(
    'graph-canvas-view.create-folder-in',
    () => wsId,
    async (ctx, parentId: unknown) => {
      if (typeof parentId !== 'string' || !parentId) return;
      const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
      const folder = await library.folderCreate('新建文件夹', parentId);
      if (folder) {
        setFolderExpanded(ctx.wsId, parentId, true);
        pendingFolderCreatedTrigger?.(folder.id);
      }
    },
  );

  // ── 打开画板(单击树项 / 双击 / 命令)──

  registerWsCommand(
    'graph-canvas-view.open-canvas',
    () => wsId,
    (ctx, graphId: unknown) => {
      if (typeof graphId !== 'string' || !graphId) return;
      setActiveGraphId(ctx.wsId, graphId);
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

  registerWsCommand(
    'graph-canvas-view.delete',
    () => wsId,
    async (ctx, treeId: unknown) => {
      if (typeof treeId !== 'string' || !treeId) return;
      const { type, id } = decodeTreeId(treeId);
      const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
      if (type === 'canvas') {
        await library.remove(id);
        const ws = workspaceManager.get(ctx.wsId);
        if (ws && getGraphCanvasWsState(ws).activeGraphId === id) {
          setActiveGraphId(ctx.wsId, null);
        }
      } else if (type === 'mind') {
        // ⭐ B1 分发:导图在另一张表
        await library.mindDelete(id);
        const ws = workspaceManager.get(ctx.wsId);
        if (ws && getGraphCanvasWsState(ws).activeGraphId === id) {
          setActiveGraphId(ctx.wsId, null);
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
    async (treeIdOrId: unknown) => {
      if (typeof treeIdOrId !== 'string' || !treeIdOrId) return;
      const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
      // ⭐ B1 分发:兼容裸 id(旧调用)与 treeId(带类型前缀)
      const { type, id } = treeIdOrId.includes(':')
        ? decodeTreeId(treeIdOrId)
        : { type: 'canvas' as const, id: treeIdOrId };
      if (type === 'mind') await library.mindMoveToFolder(id, null);
      else await library.moveToFolder(id, null);
    },
  );

  commandRegistry.register(
    'graph-canvas-view.duplicate',
    async (treeIdOrId: unknown) => {
      if (typeof treeIdOrId !== 'string' || !treeIdOrId) return;
      const library = requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store');
      const { type, id } = treeIdOrId.includes(':')
        ? decodeTreeId(treeIdOrId)
        : { type: 'canvas' as const, id: treeIdOrId };
      if (type === 'mind') {
        await library.mindDuplicate(id);
        return;
      }
      await library.duplicate(id);
    },
  );
}

// ── 桥接器(nav-side-content mount 时挂上,unmount 清掉)──

let pendingCreateMenuTrigger: ((pos: { x: number; y: number }) => void) | null = null;
export function setCreateMenuTrigger(
  fn: ((pos: { x: number; y: number }) => void) | null,
): void {
  pendingCreateMenuTrigger = fn;
}

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

/**
 * 树项 id 编码。
 *
 * ⭐ `mind` 是第三类(diglot mind v0,方案 B1):它存在**另一张表**,
 * 所有列表操作(重命名/删除/移动/打开)都要按此类型**分发到不同 store**。
 * ⚠️ 分发逻辑统一收在本文件的命令里,**不许散落到 UI** —— 漏一处就是静默出错。
 */
export type TreeItemType = 'canvas' | 'mind' | 'folder';

export function encodeTreeId(type: TreeItemType, id: string): string {
  const prefix = type === 'folder' ? 'f' : type === 'mind' ? 'm' : 'c';
  return `${prefix}:${id}`;
}

export function decodeTreeId(treeId: string): { type: TreeItemType; id: string } {
  const type: TreeItemType = treeId.startsWith('f:')
    ? 'folder'
    : treeId.startsWith('m:')
      ? 'mind'
      : 'canvas';
  return { type, id: treeId.slice(2) };
}
