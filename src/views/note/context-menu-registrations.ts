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

/** 重命名 hook — NavSide 组件挂载时设置,用于触发 inline rename */
let renameTrigger: ((treeId: string) => void) | null = null;

export function setRenameTrigger(fn: ((treeId: string) => void) | null): void {
  renameTrigger = fn;
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
