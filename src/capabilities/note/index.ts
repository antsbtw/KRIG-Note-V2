/**
 * note capability — renderer 端薄包装 (decision 012 §3.4 方案 A)
 *
 * 实施位置:src/platform/main/note/ (capability-impl + handlers)
 * 本文件:把 window.electronAPI.noteXxx 扁平驼峰 alias 成业务名 (createNote / listNotes / ...)
 *
 * 设计师批复 P1:V2 扁平驼峰惯例,renderer 端 capability 包装层吸收命名差异。
 *
 * 边界:
 * - view 层 import { noteCapability } from '@capabilities/note',零感知 IPC
 * - 拿到 NoteInfo.doc 仍是 DriverSerialized 信封 (路径 Y 决议)
 *
 * 副作用:模块加载时触发 clearLegacyLocalStorage (idempotent,L5-alive 已先调一次)
 */

import { clearLegacyLocalStorage } from './migration';
import type { NoteInfo, NoteDocEnvelope } from '@shared/ipc/note-folder-types';

export type { NoteInfo, NoteDocEnvelope } from '@shared/ipc/note-folder-types';
export { clearLegacyLocalStorage };

// 模块加载时清一次 V1 残留 (idempotent + 防御性,即便 L5-alive 路径未跑也兜底)
clearLegacyLocalStorage();

export const noteCapability = {
  async createNote(
    initialDoc: NoteDocEnvelope | null = null,
    folderId: string | null = null,
  ): Promise<NoteInfo> {
    return window.electronAPI.noteCreate(initialDoc, folderId);
  },
  async listNotes(): Promise<NoteInfo[]> {
    return window.electronAPI.noteList();
  },
  async getNote(id: string): Promise<NoteInfo | null> {
    return window.electronAPI.noteGet(id);
  },
  async updateNote(id: string, doc: NoteDocEnvelope): Promise<NoteInfo | null> {
    return window.electronAPI.noteUpdate(id, doc);
  },
  async moveNote(noteId: string, newFolderId: string | null): Promise<void> {
    return window.electronAPI.noteMove(noteId, newFolderId);
  },
  async deleteNote(id: string): Promise<void> {
    return window.electronAPI.noteDelete(id);
  },
  /** 订阅笔记列表变更;返 unsubscribe */
  onListChanged(callback: (list: NoteInfo[]) => void): () => void {
    return window.electronAPI.onNoteListChanged(callback);
  },
};
