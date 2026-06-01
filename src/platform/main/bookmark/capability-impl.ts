/**
 * bookmark capability — main 端实施 (web view 书签树, 书签步骤1 数据层)
 *
 * 数据模型 (照 ebook capability-impl 瘦身克隆, decision 022 §1.3.1 同型):
 *   bookmark atom   domain='bookmark'   payload { url, title, createdAt }
 *
 * 关键边:
 *   user:krig:inFolder   bookmark → folder   (folder atom viewType='web')
 *                        — 方向/建法照 ebook moveToFolder 抄,subject=bookmark, object=folder
 *
 * 边界:
 * - main 进程独占,直接 import @storage (合规:capability 层调 storage)
 * - renderer 通过 IPC 桥接到本文件 (src/capabilities/bookmark/index.ts 薄包装)
 *
 * SQL 形式 0 自创:全部走 storage.listAtoms / getAtom / putAtom / listEdges /
 * putEdge / deleteEdge / transaction / deleteAtom — 跟 ebook capability-impl 同款。
 */

import { storage } from '@storage/index';
import type { AtomEntity } from '@semantic/types';
import type { BookmarkInfo } from '@capabilities/bookmark/types';

// ── predicate 常量 (照 ebook capability-impl 抄) ──

const IN_FOLDER_PREDICATE = 'user:krig:inFolder';

// ── atom domain 常量 ──

const BOOKMARK_DOMAIN = 'bookmark' as const;

// ── bookmark atom payload 内部窄化辅助 ──

interface BookmarkPayloadShape {
  url: string;
  title: string;
  createdAt: number;
}

// ── 投影:atom → BookmarkInfo (照 ebook getFolderIdForBook + atomToEBookInfo) ──

async function getFolderIdForBookmark(bookmarkId: string): Promise<string | null> {
  const edges = await storage.listEdges({
    predicate: IN_FOLDER_PREDICATE,
    subjectAtomId: bookmarkId,
    limit: 1,
  });
  if (edges.length === 0) return null;
  const obj = edges[0].object;
  return obj.kind === 'atom' ? obj.atomId : null;
}

async function atomToBookmarkInfo(atom: AtomEntity<'bookmark'>): Promise<BookmarkInfo> {
  const p = atom.payload.payload as BookmarkPayloadShape;
  const folderId = await getFolderIdForBookmark(atom.id);
  return {
    id: atom.id,
    url: p.url,
    title: p.title,
    folderId,
    createdAt: p.createdAt,
  };
}

// ── CRUD ──

/** 添加书签 + (可选) inFolder 边挂 folder (照 ebook createEBookAtomPair + moveToFolder) */
export async function add(
  url: string,
  title: string,
  folderId?: string | null,
): Promise<BookmarkInfo> {
  const payload: BookmarkPayloadShape = {
    url,
    // title 可空兜底用 url (沿决议字面 url 必填)
    title: title || url,
    createdAt: Date.now(),
  };
  const atom = await storage.transaction(async (tx) => {
    const bookmarkAtom = await tx.putAtom<'bookmark'>({
      payload: { domain: BOOKMARK_DOMAIN, payload },
    });
    if (folderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: bookmarkAtom.id },
        object: { kind: 'atom', atomId: folderId },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
    return bookmarkAtom;
  });
  return atomToBookmarkInfo(atom);
}

/** 全部书签 (扁平),按 createdAt 倒序 (照 ebook list) */
export async function list(): Promise<BookmarkInfo[]> {
  const atoms = (await storage.listAtoms({
    domain: BOOKMARK_DOMAIN,
  })) as AtomEntity<'bookmark'>[];
  const infos = await Promise.all(atoms.map(atomToBookmarkInfo));
  return infos.sort((a, b) => b.createdAt - a.createdAt);
}

/** 改标题 (照 ebook rename) */
export async function rename(id: string, title: string): Promise<void> {
  const atom = (await storage.getAtom<'bookmark'>(id)) as AtomEntity<'bookmark'> | null;
  if (!atom || atom.payload.domain !== BOOKMARK_DOMAIN) return;
  const p = atom.payload.payload as BookmarkPayloadShape;
  const updated: BookmarkPayloadShape = { ...p, title: title || p.url };
  await storage.putAtom<'bookmark'>({
    id,
    payload: { domain: BOOKMARK_DOMAIN, payload: updated },
  });
}

/** 删书签 (out 边 inFolder 自动级联,照 ebook remove storage.deleteAtom 应用层级联) */
export async function remove(id: string): Promise<void> {
  const atom = (await storage.getAtom<'bookmark'>(id)) as AtomEntity<'bookmark'> | null;
  if (!atom || atom.payload.domain !== BOOKMARK_DOMAIN) return;
  await storage.deleteAtom(id);
}

/** 移动到 folder;folderId=null 移到根 (照 ebook moveToFolder 原样抄) */
export async function moveToFolder(id: string, folderId: string | null): Promise<void> {
  await storage.transaction(async (tx) => {
    const oldEdges = await storage.listEdges({
      predicate: IN_FOLDER_PREDICATE,
      subjectAtomId: id,
    });
    for (const e of oldEdges) {
      await tx.deleteEdge(e.id);
    }
    if (folderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: id },
        object: { kind: 'atom', atomId: folderId },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
  });
}
