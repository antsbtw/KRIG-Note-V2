/**
 * NoteView FolderTree 右键菜单注册
 *
 * scope: 'note-view' — 在 folderTreeContextMenuRegistry 注册菜单项。
 *
 * 三套菜单(对标 V1 useNoteOperations.buildContextMenu):
 * - 空白处右键 → 新建笔记 / 新建文件夹 / 排序
 * - folder 右键 → 在此新建 + 通用项(重命名 / 复制 / 粘贴 / 删除)
 * - item 右键 → 通用项(重命名 / 复制 / 删除)
 */

import { folderTreeContextMenuRegistry } from '@slot/nav-side-registry/folder-tree-context-menu-registry';
import { decodeTreeId } from './tree-builder';

const SCOPE = 'note-view';

/** 重命名 hook — NavSide 组件挂载时设置,用于触发 inline rename
 *  fallbackTitle: 创建场景传入,避开 allFolders 广播尚未到达的 race */
let renameTrigger: ((treeId: string, fallbackTitle?: string) => void) | null = null;

export function setRenameTrigger(
  fn: ((treeId: string, fallbackTitle?: string) => void) | null,
): void {
  renameTrigger = fn;
}

/** 外部触发 inline rename(右键菜单 / 命令处理器 / 新建后自动进入)*/
export function triggerRename(treeId: string, fallbackTitle?: string): void {
  renameTrigger?.(treeId, fallbackTitle);
}

function formatSortLabel(base: string, sortMap: unknown, key: string, kind: 'title' | 'date'): string {
  const sm = sortMap as Record<string, string | null> | undefined;
  const cur = sm?.[key];
  if (!cur || !cur.startsWith(kind)) return base;
  return cur.endsWith('-asc') ? `${base} ↑` : `${base} ↓`;
}

export function registerContextMenuItems(): void {
  // ── 空白处右键(blank)──

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-blank.new-note',
    scope: SCOPE,
    appliesTo: ['blank'],
    label: '新建笔记',
    icon: '📄',
    command: 'note-view.create-note',
    order: 10,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-blank.new-folder',
    scope: SCOPE,
    appliesTo: ['blank'],
    label: '新建文件夹',
    icon: '📁',
    command: 'note-view.create-folder',
    order: 20,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-blank.paste',
    scope: SCOPE,
    appliesTo: ['blank'],
    label: '粘贴',
    icon: '📌',
    enabledWhen: (ctx) => ctx.hasClipboard,
    command: 'note-view.paste',
    commandArgFn: () => null,
    order: 25,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-blank.sep1',
    scope: SCOPE,
    appliesTo: ['blank'],
    separator: true,
    label: '',
    order: 30,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-blank.sort-title',
    scope: SCOPE,
    appliesTo: ['blank'],
    label: (ctx) => formatSortLabel('按标题排序', ctx.extra?.sortMap, '__root__', 'title'),
    command: 'note-view.sort-cycle-title',
    commandArgFn: () => '__root__',
    order: 40,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-blank.sort-date',
    scope: SCOPE,
    appliesTo: ['blank'],
    label: (ctx) => formatSortLabel('按日期排序', ctx.extra?.sortMap, '__root__', 'date'),
    command: 'note-view.sort-cycle-date',
    commandArgFn: () => '__root__',
    order: 50,
  });

  // ── folder 右键 — folder 专属 ──

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-folder.new-note-in',
    scope: SCOPE,
    appliesTo: ['folder'],
    label: '新建笔记',
    icon: '📄',
    command: 'note-view.create-note',
    commandArgFn: (ctx) => (ctx.targetId ? decodeTreeId(ctx.targetId).id : null),
    order: 10,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-folder.new-folder-in',
    scope: SCOPE,
    appliesTo: ['folder'],
    label: '新建文件夹',
    icon: '📁',
    command: 'note-view.create-folder',
    commandArgFn: (ctx) => (ctx.targetId ? decodeTreeId(ctx.targetId).id : null),
    order: 20,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-folder.sort-title',
    scope: SCOPE,
    appliesTo: ['folder'],
    label: (ctx) => {
      const folderId = ctx.targetId ? decodeTreeId(ctx.targetId).id : '__root__';
      return formatSortLabel('按标题排序', ctx.extra?.sortMap, folderId, 'title');
    },
    command: 'note-view.sort-cycle-title',
    commandArgFn: (ctx) => (ctx.targetId ? decodeTreeId(ctx.targetId).id : '__root__'),
    order: 22,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-folder.sort-date',
    scope: SCOPE,
    appliesTo: ['folder'],
    label: (ctx) => {
      const folderId = ctx.targetId ? decodeTreeId(ctx.targetId).id : '__root__';
      return formatSortLabel('按日期排序', ctx.extra?.sortMap, folderId, 'date');
    },
    command: 'note-view.sort-cycle-date',
    commandArgFn: (ctx) => (ctx.targetId ? decodeTreeId(ctx.targetId).id : '__root__'),
    order: 24,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-folder.sep1',
    scope: SCOPE,
    appliesTo: ['folder'],
    separator: true,
    label: '',
    order: 30,
  });

  // ── item(笔记)专属 ──

  /**
   * 在另一栏打开(feat/slot-navside-follow-active;前身是 674b4b9a 的「在右栏打开」)
   *
   * 改「右栏」为「另一栏」的理由:同期左键点击已改为跟随活跃槽,焦点在右栏时
   * 「在右栏打开」与左键完全同义,成了一个多余项。「另一栏」= 活跃槽对侧,
   * 在任何焦点下都表达同一个真实意图:**送到我没在看的那一栏,开个对照**。
   *
   * 只对 'item'(笔记)注册:文件夹没有"在某栏打开"的语义。
   */
  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-note.open-in-other',
    scope: SCOPE,
    appliesTo: ['item'],
    label: '在另一栏打开',
    icon: '⫿',
    disabled: (ctx) => ctx.isMulti,
    command: 'note-view.open-in-other-slot',
    commandArgFn: (ctx) => (ctx.targetId ? decodeTreeId(ctx.targetId).id : null),
    order: 90,
  });

  // ── item / folder 通用项 ──

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl.rename',
    scope: SCOPE,
    appliesTo: ['item', 'folder'],
    label: '重命名',
    icon: '✎',
    disabled: (ctx) => ctx.isMulti,
    onSelect: (ctx) => {
      if (ctx.targetId && renameTrigger) renameTrigger(ctx.targetId);
    },
    order: 100,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl.copy',
    scope: SCOPE,
    appliesTo: ['item', 'folder'],
    label: '复制',
    icon: '📋',
    disabled: (ctx) => ctx.isMulti,
    command: 'note-view.copy-by-tree-id',
    commandArgFn: (ctx) => ctx.targetId,
    order: 110,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl-folder.paste',
    scope: SCOPE,
    appliesTo: ['folder'],
    label: '粘贴',
    icon: '📌',
    enabledWhen: (ctx) => ctx.hasClipboard,
    command: 'note-view.paste',
    commandArgFn: (ctx) => (ctx.targetId ? decodeTreeId(ctx.targetId).id : null),
    order: 120,
  });

  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl.sep2',
    scope: SCOPE,
    appliesTo: ['item', 'folder'],
    separator: true,
    label: '',
    order: 200,
  });

  // 单选删除(按 treeId 精确)
  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl.delete',
    scope: SCOPE,
    appliesTo: ['item', 'folder'],
    label: '删除',
    icon: '🗑',
    command: 'note-view.delete-by-tree-id',
    commandArgFn: (ctx) => ctx.targetId,
    enabledWhen: (ctx) => !ctx.isMulti,
    order: 210,
  });

  // 多选删除(走 delete-active 批量路径,读 selectedIds)
  folderTreeContextMenuRegistry.register({
    id: 'note-view.fl.delete-multi',
    scope: SCOPE,
    appliesTo: ['item', 'folder'],
    label: (ctx) => `删除 ${ctx.selectedCount} 项`,
    icon: '🗑',
    command: 'note-view.delete-active',
    enabledWhen: (ctx) => ctx.isMulti,
    order: 211,
  });
}
