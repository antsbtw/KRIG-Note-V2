/**
 * tree-builder — 把 notes + folders + 排序/展开态 转成 FolderTree 节点
 *
 * 纯函数,无状态。
 */

import type { TreeNode, FolderNode, ItemNode } from '@slot/shared-ui/FolderTree';
import type { Note } from './note-store';
import type { Folder } from './folder-store';
import type { SortState } from './data-model';

interface BuildArgs {
  notes: Note[];
  folders: Folder[];
  expandedFolders: Set<string>;
  folderSortMap: Record<string, SortState>;
}

const collator = new Intl.Collator('zh-CN');

function sortFolders(folders: Folder[], sort: SortState): Folder[] {
  const out = [...folders];
  if (sort === 'title-asc') out.sort((a, b) => collator.compare(a.title, b.title));
  else if (sort === 'title-desc') out.sort((a, b) => collator.compare(b.title, a.title));
  else if (sort === 'date-asc') out.sort((a, b) => a.createdAt - b.createdAt);
  else if (sort === 'date-desc') out.sort((a, b) => b.createdAt - a.createdAt);
  else out.sort((a, b) => collator.compare(a.title, b.title)); // 默认 title-asc
  return out;
}

function sortNotes(notes: Note[], sort: SortState): Note[] {
  const out = [...notes];
  if (sort === 'title-asc') out.sort((a, b) => collator.compare(a.title, b.title));
  else if (sort === 'title-desc') out.sort((a, b) => collator.compare(b.title, a.title));
  else if (sort === 'date-asc') out.sort((a, b) => a.updatedAt - b.updatedAt);
  else if (sort === 'date-desc') out.sort((a, b) => b.updatedAt - a.updatedAt);
  else out.sort((a, b) => b.updatedAt - a.updatedAt); // 默认 date-desc(L5-A 沿用)
  return out;
}

export function buildTreeNodes(args: BuildArgs): TreeNode[] {
  const { notes, folders, expandedFolders, folderSortMap } = args;

  const buildChildren = (parentId: string | null): TreeNode[] => {
    const folderKey = parentId ?? '__root__';
    const sort = folderSortMap[folderKey] ?? null;

    const childFolders = sortFolders(
      folders.filter((f) => f.parentId === parentId),
      sort,
    );
    const childNotes = sortNotes(
      notes.filter((n) => n.folderId === parentId),
      sort,
    );

    const out: TreeNode[] = [];
    for (const f of childFolders) {
      const node: FolderNode = {
        kind: 'folder',
        id: encodeFolderId(f.id),
        parentId: parentId ? encodeFolderId(parentId) : null,
        title: f.title,
        expanded: expandedFolders.has(f.id),
        children: buildChildren(f.id),
      };
      out.push(node);
    }
    for (const n of childNotes) {
      const node: ItemNode = {
        kind: 'item',
        id: encodeNoteId(n.id),
        parentId: parentId ? encodeFolderId(parentId) : null,
        payload: n,
      };
      out.push(node);
    }
    return out;
  };

  return buildChildren(null);
}

// ── id 编/解码 ──

export function encodeFolderId(id: string): string {
  return `f:${id}`;
}

export function encodeNoteId(id: string): string {
  return `n:${id}`;
}

export function decodeTreeId(treeId: string): { type: 'note' | 'folder'; id: string } {
  return {
    type: treeId.startsWith('f:') ? 'folder' : 'note',
    id: treeId.slice(2),
  };
}

// ── 时间格式 ──

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '昨天' : `${days}天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}周前`;
  return new Date(ts).toLocaleDateString();
}
