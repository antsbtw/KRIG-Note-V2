/**
 * note capability — 对外类型 (L7-sub2)
 *
 * view 通过 requireCapabilityApi<NoteCapabilityApi>('note') 取 api;
 * driver/slot 内部消费可直 import 单例 export(对齐 W5 严格态 A 边界,
 * 跟 ebook-library / learning 同模式)。
 */

import type { NoteInfo, NoteDocEnvelope } from '@shared/ipc/note-folder-types';

export type { NoteInfo, NoteDocEnvelope };

export interface NoteCapabilityApi {
  /** 创建笔记;initialDoc=null 时用空 doc;folderId=null 时创建在根级 */
  createNote(
    initialDoc: NoteDocEnvelope | null,
    folderId: string | null,
  ): Promise<NoteInfo>;
  listNotes(): Promise<NoteInfo[]>;
  getNote(id: string): Promise<NoteInfo | null>;
  updateNote(id: string, doc: NoteDocEnvelope): Promise<NoteInfo | null>;
  moveNote(noteId: string, newFolderId: string | null): Promise<void>;
  deleteNote(id: string): Promise<void>;
  /** 订阅笔记列表变更 (IPC 广播);返 unsubscribe */
  onListChanged(callback: (list: NoteInfo[]) => void): () => void;
}
