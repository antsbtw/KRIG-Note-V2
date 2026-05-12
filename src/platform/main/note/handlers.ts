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
import {
  createNote,
  listNotes,
  getNote,
  updateNote,
  moveNote,
  deleteNote,
} from './capability-impl';
import { broadcastNoteListChanged } from './broadcast';

function isDocEnvelope(v: unknown): v is NoteDocEnvelope {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.format === 'string' && typeof o.version === 'string' && 'payload' in o;
}

export function registerNoteHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.NOTE_LIST, async () => listNotes());

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

  ipcMain.handle(IPC_CHANNELS.NOTE_UPDATE, async (_e, payload: unknown) => {
    const p = payload as { id?: unknown; doc?: unknown } | null;
    if (!p || typeof p.id !== 'string' || !p.id) return null;
    if (!isDocEnvelope(p.doc)) return null;
    const note = await updateNote(p.id, p.doc);
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

  ipcMain.handle(IPC_CHANNELS.NOTE_DELETE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    await deleteNote(id);
    await broadcastNoteListChanged();
  });
}
