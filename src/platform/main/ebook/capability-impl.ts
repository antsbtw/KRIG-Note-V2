/**
 * ebook capability — main 端实施 (sub-phase 022, decision 022 §4.1.4 §4.3.1-L1)
 *
 * 4 层 atom 模型 (decision 022 §1.3.1):
 *   Layer 2 ebook atom         domain='ebook'         (书元数据)
 *   Layer 3 reading-state atom domain='reading-state' (1:1 跟 ebook, 进度+书签)
 *   Layer 4 pm atom            domain='pm'            (lazy create, hasReadingThought 边)
 *
 * 关键边 (decision 022 §4.1.2):
 *   user:krig:hasReadingState   ebook → reading-state  cardinality 1:1
 *   user:krig:hasReadingThought ebook → pm-as-thought  cardinality 0..1 (lazy create)
 *   user:krig:inFolder          ebook → folder         (folder atom viewType='ebook')
 *
 * L1 互斥校验主防 (decision 022 §4.3.1-L1):
 *   ensureReadingThought 创建 pm atom 后, putEdge hasReadingThought 前不需要校验 (新
 *   atom 字面 id 唯一不可能跟既有 hasNoteView 边冲突 — 沿 decision 016 §3.1 同型纪律).
 *   但保留 L1 主防字面: 若未来 caller 误传既有 pm atom id (例如把 note pm atom id 当
 *   thought 候选), listEdges hasNoteView filter by subjectAtomId 非空时 throw
 *   MarkerEdgeMutexViolation. 这条边界字面意义见决议 §4.3.1.
 *
 * 跟决议 line 730 + §10.B-2 字面口径:
 *   bookshelf-store.ts / annotation-store.ts 文件保留 (Step 5.7 migration 读旧 JSON
 *   需要), Step 5.10 整文件 git rm 一并清除. 本 capability-impl 字面 0 依赖旧 store
 *   class — 通过 storage atom CRUD + folder/note capability 同进程直调实现.
 *
 * 文件系统操作 (沿 V2 现状字面磁盘字面布局, 不动):
 *   {userData}/krig-data/ebook/library/{ebookAtomId}.{ext}   managed 模式文件副本
 */

import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { storage } from '@storage/index';
import type { AtomEntity } from '@semantic/types';
import type {
  EBookFileType,
  EBookInfo,
  EBookLoadedInfo,
  EBookStorageMode,
  ReadingPosition,
  ReadingStateInfo,
} from '@shared/ipc/ebook-types';
import type { BookAnchor } from '@drivers/text-editing-driver/blocks/_shared/book-anchor';
import type { NoteInfo } from '@shared/ipc/note-folder-types';
import { NOTE_DOC_ORIGIN } from '@shared/ipc/note-folder-types';
import {
  updateNote,
  wrapPmDoc,
  unwrapPmDoc,
  emptyNoteDoc,
  broadcastNoteListChanged,
  broadcastNoteDocContentChanged,
} from '@platform/main/note';

// ── predicate 常量 (沿 V2 现状分散模式 §10.D-3 + decision 022 §4.1.2) ──

const HAS_READING_THOUGHT_PREDICATE = 'user:krig:hasReadingThought';
const HAS_READING_STATE_PREDICATE = 'user:krig:hasReadingState';
const IN_FOLDER_PREDICATE = 'user:krig:inFolder';
const HAS_NOTE_VIEW_PREDICATE = 'user:krig:hasNoteView';

// ── atom domain 常量 ──

const EBOOK_DOMAIN = 'ebook' as const;
const READING_STATE_DOMAIN = 'reading-state' as const;
const PM_DOMAIN = 'pm' as const;

// ── 路径常量 ──

const EBOOK_DIR = path.join(app.getPath('userData'), 'krig-data', 'ebook');
const LIBRARY_DIR = path.join(EBOOK_DIR, 'library');

function ensureLibraryDir(): void {
  if (!existsSync(EBOOK_DIR)) mkdirSync(EBOOK_DIR, { recursive: true });
  if (!existsSync(LIBRARY_DIR)) mkdirSync(LIBRARY_DIR, { recursive: true });
}

// ── EBookPayload / ReadingStatePayload 内部窄化辅助 ──

interface EBookPayloadShape {
  fileType: EBookFileType;
  storage: EBookStorageMode;
  filePath: string;
  originalPath?: string;
  fileName: string;
  displayName: string;
  pageCount?: number;
  addedAt: number;
}

interface ReadingStatePayloadShape {
  lastOpenedAt: number;
  lastPosition: ReadingPosition;
  bookmarks: number[];
  cfiBookmarks: Array<{ cfi: string; label: string }>;
}

function emptyReadingState(): ReadingStatePayloadShape {
  return {
    lastOpenedAt: Date.now(),
    lastPosition: {},
    bookmarks: [],
    cfiBookmarks: [],
  };
}

// ── ebook atom + reading-state atom 投影 ──

async function getReadingStateForBook(
  bookId: string,
): Promise<{ atom: AtomEntity<'reading-state'>; edgeId: string } | null> {
  const edges = await storage.listEdges({
    predicate: HAS_READING_STATE_PREDICATE,
    subjectAtomId: bookId,
    limit: 1,
  });
  if (edges.length === 0) return null;
  const obj = edges[0].object;
  if (obj.kind !== 'atom') return null;
  const atom = (await storage.getAtom<'reading-state'>(
    obj.atomId,
  )) as AtomEntity<'reading-state'> | null;
  if (!atom) return null;
  return { atom, edgeId: edges[0].id };
}

async function getFolderIdForBook(bookId: string): Promise<string | null> {
  const edges = await storage.listEdges({
    predicate: IN_FOLDER_PREDICATE,
    subjectAtomId: bookId,
    limit: 1,
  });
  if (edges.length === 0) return null;
  const obj = edges[0].object;
  return obj.kind === 'atom' ? obj.atomId : null;
}

async function atomToEBookInfo(atom: AtomEntity<'ebook'>): Promise<EBookInfo> {
  const p = atom.payload.payload as EBookPayloadShape;
  const folderId = await getFolderIdForBook(atom.id);
  const rs = await getReadingStateForBook(atom.id);
  const rsPayload = rs?.atom.payload.payload as ReadingStatePayloadShape | undefined;
  return {
    id: atom.id,
    fileType: p.fileType,
    storage: p.storage,
    filePath: p.filePath,
    originalPath: p.originalPath,
    fileName: p.fileName,
    displayName: p.displayName,
    pageCount: p.pageCount,
    addedAt: p.addedAt,
    folderId,
    lastOpenedAt: rsPayload?.lastOpenedAt ?? 0,
    lastPosition: rsPayload?.lastPosition,
  };
}

// ── 创建 ebook + reading-state atom 对 (事务) ──

async function createEBookAtomPair(
  payload: EBookPayloadShape,
): Promise<AtomEntity<'ebook'>> {
  return storage.transaction(async (tx) => {
    const ebookAtom = await tx.putAtom<'ebook'>({
      payload: { domain: EBOOK_DOMAIN, payload: payload },
    });
    const rsAtom = await tx.putAtom<'reading-state'>({
      payload: { domain: READING_STATE_DOMAIN, payload: emptyReadingState() },
    });
    const now = Date.now();
    await tx.putEdge({
      predicate: HAS_READING_STATE_PREDICATE,
      subject: { kind: 'atom', atomId: ebookAtom.id },
      object: { kind: 'atom', atomId: rsAtom.id },
      attrs: { createdBy: 'user-default', createdAt: now },
    });
    return ebookAtom;
  });
}

// ── 19→20 保留 API: 书架 (10) ──

export async function list(): Promise<EBookInfo[]> {
  const atoms = (await storage.listAtoms({ domain: EBOOK_DOMAIN })) as AtomEntity<'ebook'>[];
  const infos = await Promise.all(atoms.map(atomToEBookInfo));
  // sub-phase 022 沿 V2 现状字面: 按 lastOpenedAt 倒序
  return infos.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function getBook(id: string): Promise<EBookInfo | null> {
  const atom = (await storage.getAtom<'ebook'>(id)) as AtomEntity<'ebook'> | null;
  if (!atom) return null;
  if (atom.payload.domain !== EBOOK_DOMAIN) return null;
  const info = atomToEBookInfo(atom);
  // 优先返 saveProgress pending 内存值 — 避免 100ms debounce 未触发时 getBook
  // 读到 storage 旧 lastPosition(用户全屏翻页后立即退出 → reopen 时序与
  // saveProgress debounce 竞态,导致 view 跳到上一次保存位置)
  const pending = saveProgressPending.get(id);
  if (pending) {
    return { ...info, lastPosition: pending };
  }
  return info;
}

/** managed 模式: copy 文件到 library/ + 创建 ebook+reading-state atom 对 */
export async function addManaged(
  srcPath: string,
  fileType: EBookFileType,
  pageCount?: number,
): Promise<EBookInfo> {
  ensureLibraryDir();
  // 用 randomUUID 占位算 dest 文件名, 但实际写文件后必须重命名为 atom.id;
  // 沿 V2 现状字面: dest 文件名 = atom.id. 由于 atom.id 字面是 putAtom 后返,
  // 需要先 putAtom 拿 id, 再 copy. 但若 copy 失败 atom 是孤儿 — 字面接受
  // (沿 V1 同型字面错误恢复粒度).
  const ext = path.extname(srcPath);
  const fileName = path.basename(srcPath);
  const displayName = path.basename(srcPath, ext);

  // 先创建 atom 拿 id, 然后 copy 文件 (filePath 字面字面占位先空, copy 完再 update)
  const placeholderPayload: EBookPayloadShape = {
    fileType,
    storage: 'managed',
    filePath: '', // 占位
    originalPath: srcPath,
    fileName,
    displayName,
    pageCount,
    addedAt: Date.now(),
  };
  const ebookAtom = await createEBookAtomPair(placeholderPayload);

  // 用 atom.id 字面做 dest 文件名 (沿 V2 现状字面: library/{id}{ext})
  const destPath = path.join(LIBRARY_DIR, `${ebookAtom.id}${ext}`);
  copyFileSync(srcPath, destPath);

  // 回填 filePath (full atom replace via putAtom — V2 storage 字面是 UPSERT 语义)
  const finalPayload: EBookPayloadShape = { ...placeholderPayload, filePath: destPath };
  await storage.putAtom<'ebook'>({
    id: ebookAtom.id,
    payload: { domain: EBOOK_DOMAIN, payload: finalPayload },
  });
  const updated = (await storage.getAtom<'ebook'>(ebookAtom.id)) as AtomEntity<'ebook'>;
  return atomToEBookInfo(updated);
}

/** link 模式: 仅记 srcPath, 不复制 */
export async function addLinked(
  srcPath: string,
  fileType: EBookFileType,
  pageCount?: number,
): Promise<EBookInfo> {
  const ext = path.extname(srcPath);
  const fileName = path.basename(srcPath);
  const displayName = path.basename(srcPath, ext);
  const payload: EBookPayloadShape = {
    fileType,
    storage: 'link',
    filePath: srcPath,
    fileName,
    displayName,
    pageCount,
    addedAt: Date.now(),
  };
  const ebookAtom = await createEBookAtomPair(payload);
  return atomToEBookInfo(ebookAtom);
}

export async function remove(id: string): Promise<void> {
  const atom = (await storage.getAtom<'ebook'>(id)) as AtomEntity<'ebook'> | null;
  if (!atom || atom.payload.domain !== EBOOK_DOMAIN) return;
  const p = atom.payload.payload as EBookPayloadShape;

  // managed 模式: 删磁盘文件
  if (p.storage === 'managed' && p.filePath && existsSync(p.filePath)) {
    try {
      unlinkSync(p.filePath);
    } catch {
      // 文件可能已被外部删除, 忽略
    }
  }

  // 级联删: reading-state atom + hasReadingState 边 + (可选) thought atom +
  //         hasReadingThought 边 + inFolder 边
  // 沿决议 §9.5 字面: storage.deleteAtom 字面应用层级联会删该 atom 的 out 边但不会
  // 递归删 object atom. 故需要手动级联.
  const rs = await getReadingStateForBook(id);
  const thoughtEdges = await storage.listEdges({
    predicate: HAS_READING_THOUGHT_PREDICATE,
    subjectAtomId: id,
  });
  await storage.transaction(async (tx) => {
    // 1. 删 reading-state atom + 它的边自动级联 (沿 storage.deleteAtom 字面应用层级联)
    if (rs) {
      await tx.deleteAtom(rs.atom.id);
    }
    // 2. 删 thought atom (pm domain)
    for (const e of thoughtEdges) {
      const obj = e.object;
      if (obj.kind === 'atom') {
        await tx.deleteAtom(obj.atomId);
      }
    }
    // 3. 删 ebook atom 本身 (out 边 inFolder/hasReadingState/hasReadingThought 自动级联)
    await tx.deleteAtom(id);
  });
}

export async function rename(id: string, displayName: string): Promise<void> {
  const atom = (await storage.getAtom<'ebook'>(id)) as AtomEntity<'ebook'> | null;
  if (!atom || atom.payload.domain !== EBOOK_DOMAIN) return;
  const p = atom.payload.payload as EBookPayloadShape;
  const updated: EBookPayloadShape = { ...p, displayName };
  await storage.putAtom<'ebook'>({
    id,
    payload: { domain: EBOOK_DOMAIN, payload: updated },
  });
}

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

export async function relocate(id: string, newPath: string): Promise<EBookInfo | null> {
  const atom = (await storage.getAtom<'ebook'>(id)) as AtomEntity<'ebook'> | null;
  if (!atom || atom.payload.domain !== EBOOK_DOMAIN) return null;
  const p = atom.payload.payload as EBookPayloadShape;
  const updated: EBookPayloadShape = {
    ...p,
    filePath: newPath,
    fileName: path.basename(newPath),
  };
  await storage.putAtom<'ebook'>({
    id,
    payload: { domain: EBOOK_DOMAIN, payload: updated },
  });
  const refreshed = (await storage.getAtom<'ebook'>(id)) as AtomEntity<'ebook'>;
  return atomToEBookInfo(refreshed);
}

export async function transferToManaged(id: string): Promise<EBookInfo | null> {
  const atom = (await storage.getAtom<'ebook'>(id)) as AtomEntity<'ebook'> | null;
  if (!atom || atom.payload.domain !== EBOOK_DOMAIN) return null;
  const p = atom.payload.payload as EBookPayloadShape;
  if (p.storage !== 'link') return null;
  ensureLibraryDir();
  const ext = path.extname(p.filePath);
  const destPath = path.join(LIBRARY_DIR, `${id}${ext}`);
  try {
    copyFileSync(p.filePath, destPath);
  } catch (err) {
    console.warn('[ebook/capability-impl] transferToManaged copy failed:', err);
    return null;
  }
  const updated: EBookPayloadShape = {
    ...p,
    originalPath: p.filePath,
    filePath: destPath,
    storage: 'managed',
  };
  await storage.putAtom<'ebook'>({
    id,
    payload: { domain: EBOOK_DOMAIN, payload: updated },
  });
  const refreshed = (await storage.getAtom<'ebook'>(id)) as AtomEntity<'ebook'>;
  return atomToEBookInfo(refreshed);
}

export async function checkFileExists(id: string): Promise<boolean> {
  const atom = (await storage.getAtom<'ebook'>(id)) as AtomEntity<'ebook'> | null;
  if (!atom || atom.payload.domain !== EBOOK_DOMAIN) return false;
  const p = atom.payload.payload as EBookPayloadShape;
  try {
    await stat(p.filePath);
    return true;
  } catch {
    return false;
  }
}

// ── 19→20 保留 API: 进度 + 书签 (reading-state atom CRUD) ──

async function getOrCreateReadingState(bookId: string): Promise<{
  rsAtomId: string;
  payload: ReadingStatePayloadShape;
}> {
  const rs = await getReadingStateForBook(bookId);
  if (rs) {
    return {
      rsAtomId: rs.atom.id,
      payload: rs.atom.payload.payload as ReadingStatePayloadShape,
    };
  }
  // 字面理论上 ebook atom 创建时已经字面伴随 reading-state — 这里 fallback create
  // 防御性 (例如 migration 中途失败留半成品).
  const newRs = await storage.transaction(async (tx) => {
    const rsAtom = await tx.putAtom<'reading-state'>({
      payload: { domain: READING_STATE_DOMAIN, payload: emptyReadingState() },
    });
    await tx.putEdge({
      predicate: HAS_READING_STATE_PREDICATE,
      subject: { kind: 'atom', atomId: bookId },
      object: { kind: 'atom', atomId: rsAtom.id },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });
    return rsAtom;
  });
  return {
    rsAtomId: newRs.id,
    payload: newRs.payload.payload as ReadingStatePayloadShape,
  };
}

async function updateReadingState(
  bookId: string,
  patch: Partial<ReadingStatePayloadShape>,
): Promise<ReadingStatePayloadShape> {
  const { rsAtomId, payload } = await getOrCreateReadingState(bookId);
  const updated: ReadingStatePayloadShape = { ...payload, ...patch };
  await storage.putAtom<'reading-state'>({
    id: rsAtomId,
    payload: { domain: READING_STATE_DOMAIN, payload: updated },
  });
  return updated;
}

// debounce 100ms for saveProgress (decision 022 §9.3 Q-022-reading-state-debounce)
const saveProgressTimers = new Map<string, NodeJS.Timeout>();
const saveProgressPending = new Map<string, ReadingPosition>();

export function saveProgress(bookId: string, position: ReadingPosition): void {
  // 累积最新 position; debounce 100ms 内多次调只触发末次写
  saveProgressPending.set(bookId, position);
  const existingTimer = saveProgressTimers.get(bookId);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    const pending = saveProgressPending.get(bookId);
    saveProgressTimers.delete(bookId);
    saveProgressPending.delete(bookId);
    if (!pending) return;
    void updateReadingState(bookId, {
      lastPosition: pending,
      lastOpenedAt: Date.now(),
    });
  }, 100);
  saveProgressTimers.set(bookId, timer);
}

export async function bookmarkToggle(bookId: string, page: number): Promise<number[]> {
  const { rsAtomId, payload } = await getOrCreateReadingState(bookId);
  const bookmarks = [...payload.bookmarks];
  const idx = bookmarks.indexOf(page);
  if (idx >= 0) {
    bookmarks.splice(idx, 1);
  } else {
    bookmarks.push(page);
    bookmarks.sort((a, b) => a - b);
  }
  const updated: ReadingStatePayloadShape = { ...payload, bookmarks };
  await storage.putAtom<'reading-state'>({
    id: rsAtomId,
    payload: { domain: READING_STATE_DOMAIN, payload: updated },
  });
  return bookmarks;
}

export async function bookmarkList(bookId: string): Promise<number[]> {
  const rs = await getReadingStateForBook(bookId);
  if (!rs) return [];
  return (rs.atom.payload.payload as ReadingStatePayloadShape).bookmarks ?? [];
}

export async function cfiBookmarkAdd(
  bookId: string,
  cfi: string,
  label: string,
): Promise<Array<{ cfi: string; label: string }>> {
  const { rsAtomId, payload } = await getOrCreateReadingState(bookId);
  if (payload.cfiBookmarks.some((b) => b.cfi === cfi)) return payload.cfiBookmarks;
  const cfiBookmarks = [...payload.cfiBookmarks, { cfi, label }];
  const updated: ReadingStatePayloadShape = { ...payload, cfiBookmarks };
  await storage.putAtom<'reading-state'>({
    id: rsAtomId,
    payload: { domain: READING_STATE_DOMAIN, payload: updated },
  });
  return cfiBookmarks;
}

export async function cfiBookmarkRemove(
  bookId: string,
  cfi: string,
): Promise<Array<{ cfi: string; label: string }>> {
  const rs = await getReadingStateForBook(bookId);
  if (!rs) return [];
  const payload = rs.atom.payload.payload as ReadingStatePayloadShape;
  const cfiBookmarks = payload.cfiBookmarks.filter((b) => b.cfi !== cfi);
  const updated: ReadingStatePayloadShape = { ...payload, cfiBookmarks };
  await storage.putAtom<'reading-state'>({
    id: rs.atom.id,
    payload: { domain: READING_STATE_DOMAIN, payload: updated },
  });
  return cfiBookmarks;
}

export async function cfiBookmarkList(
  bookId: string,
): Promise<Array<{ cfi: string; label: string }>> {
  const rs = await getReadingStateForBook(bookId);
  if (!rs) return [];
  return (rs.atom.payload.payload as ReadingStatePayloadShape).cfiBookmarks ?? [];
}

/** 更新 lastOpenedAt — open 流程入口字面调 */
export async function markOpened(bookId: string): Promise<ReadingStateInfo | null> {
  const rs = await getReadingStateForBook(bookId);
  if (!rs) {
    await getOrCreateReadingState(bookId); // 触发 lazy create
    return null;
  }
  const updated = await updateReadingState(bookId, { lastOpenedAt: Date.now() });
  return {
    bookId,
    lastOpenedAt: updated.lastOpenedAt,
    lastPosition: updated.lastPosition,
    bookmarks: updated.bookmarks,
    cfiBookmarks: updated.cfiBookmarks,
  };
}

// ── 5 新 API: thought block (decision 022 §4.1.3 §4.3.1-L1) ──

/**
 * getReadingThought — 取 ebook 关联的 thought atom (返 NoteInfo 信封)
 *
 * listEdges hasReadingThought filter by subjectAtomId=bookId → 取 object atomId
 * → note.getNote (复用 note capability 字面 hasNoteView marker filter 防御 —
 * 但 thought atom 字面**不**挂 hasNoteView 边, 会导致 note.getNote 返 null!
 * 故本函数字面**直接 storage.getAtom** + 包装 NoteInfo 信封, 绕开 note.getNote
 * 的 hasNoteView 防御性 filter.
 */
export async function getReadingThought(bookId: string): Promise<NoteInfo | null> {
  const edges = await storage.listEdges({
    predicate: HAS_READING_THOUGHT_PREDICATE,
    subjectAtomId: bookId,
    limit: 1,
  });
  if (edges.length === 0) return null;
  const obj = edges[0].object;
  if (obj.kind !== 'atom') return null;
  const atom = (await storage.getAtom<'pm'>(obj.atomId)) as AtomEntity<'pm'> | null;
  if (!atom) return null;
  if (atom.payload.domain !== PM_DOMAIN) return null;
  const pmDoc = atom.payload.payload;
  return {
    id: atom.id,
    title: '', // thought 字面无 title (沿决议字面 thought 字面是 ebook 内容聚合)
    doc: wrapPmDoc(pmDoc),
    folderId: null,
    createdAt: atom.createdAt,
    updatedAt: atom.updatedAt,
  };
}

/**
 * ensureReadingThought — lazy 幂等创建 thought atom + hasReadingThought 边
 *
 * §4.3.1-L1 互斥校验主防 (MarkerEdgeMutexViolation):
 *   新创 pm atom 字面 id 唯一, 不可能挂 hasNoteView 边 (沿 decision 016 §3.1
 *   "新 atom 天然单边"同型纪律). 但保留 L1 主防字面 — 若 storage.transaction 内
 *   putAtom 返新 id 后, 立即 listEdges hasNoteView filter by subjectAtomId 应
 *   返空数组. 若非空, 字面是数据库已坏 (例如某 pm atom 同时挂两条 marker 边),
 *   throw 阻断字面.
 */
export async function ensureReadingThought(bookId: string): Promise<NoteInfo> {
  // 1. 幂等检查: 既有 thought 字面直接返
  const existing = await getReadingThought(bookId);
  if (existing) return existing;

  // 2. lazy create: pm atom + hasReadingThought 边 (transaction)
  const created = await storage.transaction(async (tx) => {
    const pmAtom = await tx.putAtom<'pm'>({
      payload: { domain: PM_DOMAIN, payload: unwrapPmDoc(emptyNoteDoc()) },
    });
    await tx.putEdge({
      predicate: HAS_READING_THOUGHT_PREDICATE,
      subject: { kind: 'atom', atomId: bookId },
      object: { kind: 'atom', atomId: pmAtom.id },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });
    return pmAtom;
  });

  // 3. L1 互斥校验主防 (decision 022 §4.3.1-L1):
  //    新 pm atom 字面理论上字面不可能挂 hasNoteView 边, 但若数据库已坏导致 putAtom
  //    返既有 id (UPSERT 语义 + 未来 caller 误传 id), 字面 throw.
  const noteViewEdges = await storage.listEdges({
    predicate: HAS_NOTE_VIEW_PREDICATE,
    subjectAtomId: created.id,
    limit: 1,
  });
  if (noteViewEdges.length > 0) {
    throw new Error(
      `MarkerEdgeMutexViolation: pm atom ${created.id} 已挂 hasNoteView 边, ` +
        `不能挂 hasReadingThought 边 (decision 022 §4.3.1-L1)`,
    );
  }

  return {
    id: created.id,
    title: '',
    doc: wrapPmDoc(created.payload.payload),
    folderId: null,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

/**
 * BlockSpec for sub-phase 022 — view 端创建 thought block 的最小契约
 * 沿决议 §7.3 字面: rect/thumbnail → image; highlight/cfi+textContent → blockquote;
 *                 underline → paragraph
 */
export interface ThoughtBlockSpec {
  /** PM block type: 'image' / 'blockquote' / 'paragraph' 字面三选一 (沿 §7.3) */
  type: 'image' | 'blockquote' | 'paragraph';
  /** bookAnchor attrs 字面必填 (sub-phase 022 字面定位元数据) */
  bookAnchor: BookAnchor;
  /** 可选 image src (字面用 thumbnail base64) */
  src?: string;
  /** 可选 textContent (highlight 字面字段, 用作 blockquote 内 paragraph 子节点) */
  textContent?: string;
}

/**
 * addReadingThoughtBlock — 添加一个标注 block 到 thought PM doc
 *
 * 内部: ensureReadingThought → note.getNote → 改 PM doc content + 加 block →
 *      note.updateNote (全量替换, 沿决议 §4.1.3 字面)
 */
export async function addReadingThoughtBlock(
  bookId: string,
  spec: ThoughtBlockSpec,
): Promise<void> {
  const thought = await ensureReadingThought(bookId);
  const pmDoc = unwrapPmDoc(thought.doc);
  const content = Array.isArray(pmDoc.content) ? [...pmDoc.content] : [];

  let newBlock: import('@semantic/types').PmPayload;
  if (spec.type === 'image') {
    newBlock = {
      type: 'image',
      attrs: {
        src: spec.src ?? spec.bookAnchor.thumbnail ?? '',
        alt: '',
        bookAnchor: spec.bookAnchor,
      },
      content: [{ type: 'paragraph', attrs: { bookAnchor: null }, content: [] }],
    };
  } else if (spec.type === 'blockquote') {
    newBlock = {
      type: 'blockquote',
      attrs: { bookAnchor: spec.bookAnchor },
      content: [
        {
          type: 'paragraph',
          attrs: { bookAnchor: null },
          content: spec.textContent
            ? [{ type: 'text', text: spec.textContent }]
            : [],
        },
      ],
    };
  } else {
    newBlock = {
      type: 'paragraph',
      attrs: { bookAnchor: spec.bookAnchor },
      content: [],
    };
  }

  content.push(newBlock);
  const updatedDoc: import('@semantic/types').PmPayload = {
    ...pmDoc,
    content,
  };
  await updateNote(thought.id, wrapPmDoc(updatedDoc));
  // Latent bug 修:ebook 写 thought doc 后必须广播,否则同进程内打开的 NoteView
  // 看不到外部更新(P1#1 场景在双 channel 改造前实际从未工作)。
  // emitterId 不传 — main 内部触发, 所有 renderer 都该收到。
  const updated = await getReadingThought(bookId);
  if (updated) {
    broadcastNoteDocContentChanged({
      noteId: updated.id,
      doc: updated.doc,
      origin: NOTE_DOC_ORIGIN.EBOOK_READING_THOUGHT,
      updatedAt: updated.updatedAt,
    });
    await broadcastNoteListChanged();
  }
}

/**
 * removeReadingThoughtBlock — 通过 bookAnchor.createdAt 匹配字面删一个 block
 *
 * 字面 V2 现状 PM doc 无 block-level 稳定 id (PM block 字面不存 id), 用
 * bookAnchor.createdAt 字面做匹配 key (sub-phase 022 字面创建时字面 set).
 * Step 5.6 view caller 字面传入 createdAt as blockId, 匹配字面删 attrs.bookAnchor.
 * createdAt 相同的 block.
 */
export async function removeReadingThoughtBlock(
  bookId: string,
  blockId: string,
): Promise<void> {
  const thought = await getReadingThought(bookId);
  if (!thought) return;
  const pmDoc = unwrapPmDoc(thought.doc);
  const content = Array.isArray(pmDoc.content) ? pmDoc.content : [];
  const targetTs = Number(blockId);
  const filtered = content.filter((b) => {
    const anchor = (b.attrs as { bookAnchor?: BookAnchor } | undefined)?.bookAnchor;
    if (!anchor) return true; // 非标注 block 保留
    return anchor.createdAt !== targetTs;
  });
  const updatedDoc: import('@semantic/types').PmPayload = {
    ...pmDoc,
    content: filtered,
  };
  await updateNote(thought.id, wrapPmDoc(updatedDoc));
  // Latent bug 修:同 addReadingThoughtBlock,删 thought block 后也必须广播。
  const updated = await getReadingThought(bookId);
  if (updated) {
    broadcastNoteDocContentChanged({
      noteId: updated.id,
      doc: updated.doc,
      origin: NOTE_DOC_ORIGIN.EBOOK_READING_THOUGHT,
      updatedAt: updated.updatedAt,
    });
    await broadcastNoteListChanged();
  }
}

/**
 * getReadingThoughtAnnotations — 扫 thought PM doc, 返回所有 block.attrs.bookAnchor
 *
 * 沿决议 §4.1.3 字面: 扁平 BookAnchor[] (view 端 PDF 标注层 / EPUB 标注层各自字面
 * filter 自己需要的字面). Step 5.6 view caller 改造时字面调用.
 */
export async function getReadingThoughtAnnotations(bookId: string): Promise<BookAnchor[]> {
  const thought = await getReadingThought(bookId);
  if (!thought) return [];
  const pmDoc = unwrapPmDoc(thought.doc);
  const content = Array.isArray(pmDoc.content) ? pmDoc.content : [];
  const out: BookAnchor[] = [];
  for (const b of content) {
    const anchor = (b.attrs as { bookAnchor?: BookAnchor } | undefined)?.bookAnchor;
    if (anchor) out.push(anchor);
  }
  return out;
}

// ── 类型 re-export (给 handlers 字面用) ──

export type { EBookFileType, EBookInfo, EBookLoadedInfo, EBookStorageMode, ReadingPosition };
