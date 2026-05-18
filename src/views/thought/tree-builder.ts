/**
 * tree-builder — 把 thoughts + folders 转成 FolderTree 节点(对齐 views/note/tree-builder.ts)
 *
 * 排序:pinned 置顶,然后按 updatedAt 倒序(主舞台:新近思考在上)。
 */

import type { TreeNode, FolderNode, ItemNode } from '@slot/shared-ui/FolderTree';
import type { ThoughtInfo } from '@capabilities/thought/types';
import type { FolderInfo as Folder } from '@capabilities/folder/types';

interface BuildArgs {
  thoughts: ThoughtInfo[];
  folders: Folder[];
  expandedFolders: Set<string>;
}

const collator = new Intl.Collator('zh-CN');

function sortFolders(folders: Folder[]): Folder[] {
  return [...folders].sort((a, b) => collator.compare(a.title, b.title));
}

function sortThoughts(thoughts: ThoughtInfo[]): ThoughtInfo[] {
  return [...thoughts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export function buildTreeNodes(args: BuildArgs): TreeNode[] {
  const { thoughts, folders, expandedFolders } = args;

  const buildChildren = (parentId: string | null): TreeNode[] => {
    const childFolders = sortFolders(folders.filter((f) => f.parentId === parentId));
    const childThoughts = sortThoughts(thoughts.filter((t) => t.folderId === parentId));

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
    for (const t of childThoughts) {
      const node: ItemNode = {
        kind: 'item',
        id: encodeThoughtId(t.id),
        parentId: parentId ? encodeFolderId(parentId) : null,
        payload: t,
      };
      out.push(node);
    }
    return out;
  };

  return buildChildren(null);
}

export function encodeFolderId(id: string): string {
  return `f:${id}`;
}

export function encodeThoughtId(id: string): string {
  return `t:${id}`;
}

export function decodeTreeId(treeId: string): { type: 'thought' | 'folder'; id: string } {
  return {
    type: treeId.startsWith('f:') ? 'folder' : 'thought',
    id: treeId.slice(2),
  };
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '昨天' : `${days}天前`;
  return new Date(ts).toLocaleDateString();
}

/** 从 thought.doc 派生卡片标题(首段文本,空时按 type 兜底) */
export function deriveThoughtTitle(t: ThoughtInfo): string {
  const root = t.doc.payload as { content?: Array<Record<string, unknown>> } | undefined;
  const firstBlock = root?.content?.[0];
  if (firstBlock) {
    const text = extractText(firstBlock);
    if (text.trim()) return text.trim().slice(0, 60);
  }
  // 空 thought 按 anchor.text 兜底(高亮/划线场景内容在 anchor 上)
  if (t.anchor) {
    const locator = t.anchor.locator as { text?: string; textContent?: string };
    const anchorText = locator.text ?? locator.textContent;
    if (anchorText) return anchorText.slice(0, 60);
  }
  return '未命名思考';
}

function extractText(node: Record<string, unknown>): string {
  if (node.type === 'text') return (node.text as string) ?? '';
  const children = node.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(children)) return '';
  return children.map(extractText).join('');
}
