/**
 * note IPC handlers (decision 012 §3.4 方案 A)
 *
 * 模板对齐 src/platform/main/folder/handlers.ts 和 ebook/library-handlers.ts:
 * - 入参 typeof 严格校验
 * - 每个写入后调 broadcastNoteListChanged()
 * - 广播走 BrowserWindow.getAllWindows() webContents.send
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts.initIpcBus()
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { NoteDocEnvelope } from '@shared/ipc/note-folder-types';
import { NOTE_DOC_ORIGIN } from '@shared/ipc/note-folder-types';
import {
  createNote,
  createNotesBatch,
  listNotes,
  listNoteTitles,
  getNote,
  updateNote,
  moveNote,
  deleteNote,
} from './capability-impl';
import type { CreateNoteBatchInput } from '@capabilities/note/types';
import { broadcastNoteListChanged, broadcastNoteDocContentChanged } from './broadcast';

function isDocEnvelope(v: unknown): v is NoteDocEnvelope {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.format === 'string' && typeof o.version === 'string' && 'payload' in o;
}

export function registerNoteHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.NOTE_LIST, async () => listNotes());
  ipcMain.handle(IPC_CHANNELS.NOTE_LIST_TITLES, async () => listNoteTitles());

  ipcMain.handle(IPC_CHANNELS.NOTE_GET, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return null;
    return getNote(id);
  });

  ipcMain.handle(
    IPC_CHANNELS.NOTE_CREATE,
    async (_e, payload: unknown) => {
      const p = payload as { initialDoc?: unknown; folderId?: unknown } | null;
      const initialDoc =
        p && isDocEnvelope(p.initialDoc) ? p.initialDoc : null;
      const folderId =
        p && typeof p.folderId === 'string' && p.folderId ? p.folderId : null;
      const note = await createNote(initialDoc, folderId);
      await broadcastNoteListChanged();
      return note;
    },
  );

  // 5B Stage 7: 批量创建 note (PmAtomDraft[] → 单事务多 note)
  // broadcastMode='final' 默认:由 createNotesBatch 内部 1 次广播,handler 不重复.
  ipcMain.handle(
    IPC_CHANNELS.NOTE_CREATE_BATCH,
    async (_e, payload: unknown) => {
      // 字面入参校验 (容错宽松,详细字段校验下沉到 createNotesBatch 内 createSingleNoteFromDrafts)
      const p = payload as CreateNoteBatchInput | null;
      if (!p || !Array.isArray(p.items)) {
        return { notes: [], failures: [{ index: -1, error: 'invalid input', rolledBack: true }] };
      }
      return createNotesBatch(p);
    },
  );

  ipcMain.handle(IPC_CHANNELS.NOTE_UPDATE, async (e, payload: unknown) => {
    const p = payload as { id?: unknown; doc?: unknown } | null;
    if (!p || typeof p.id !== 'string' || !p.id) return null;
    if (!isDocEnvelope(p.doc)) return null;
    const note = await updateNote(p.id, p.doc);
    if (note) {
      // 新 channel:发起者(e.sender.id)不收;NavSide / TOC 等仍走老 channel
      // 顺序:先 DOC_CONTENT_CHANGED (内容), 后 LIST_CHANGED (元数据派生)
      broadcastNoteDocContentChanged({
        noteId: note.id,
        doc: note.doc,
        origin: NOTE_DOC_ORIGIN.NOTE_EDITOR,
        updatedAt: note.updatedAt,
        emitterId: e.sender.id,
      });
    }
    await broadcastNoteListChanged();
    return note;
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_MOVE, async (_e, payload: unknown) => {
    const p = payload as { noteId?: unknown; newFolderId?: unknown } | null;
    if (!p || typeof p.noteId !== 'string' || !p.noteId) return;
    const newFolderId =
      typeof p.newFolderId === 'string' && p.newFolderId ? p.newFolderId : null;
    await moveNote(p.noteId, newFolderId);
    await broadcastNoteListChanged();
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_DELETE, async (_e, id: unknown, opts: unknown) => {
    if (typeof id !== 'string' || !id) return;
    const progressTaskId =
      opts && typeof opts === 'object' && typeof (opts as { progressTaskId?: unknown }).progressTaskId === 'string'
        ? (opts as { progressTaskId: string }).progressTaskId
        : undefined;
    await deleteNote(id, { progressTaskId });
    await broadcastNoteListChanged();
  });
}
