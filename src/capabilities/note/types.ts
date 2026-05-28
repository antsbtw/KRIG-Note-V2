/**
 * note capability — 对外类型 (L7-sub2)
 *
 * view 通过 requireCapabilityApi<NoteCapabilityApi>('note') 取 api;
 * driver/slot 内部消费可直 import 单例 export(对齐 W5 严格态 A 边界,
 * 跟 ebook-library / learning 同模式)。
 */

import type {
  NoteInfo,
  NoteDocEnvelope,
  NoteDocContentChangedPayload,
  NoteDocOrigin,
} from '@shared/ipc/note-folder-types';

export type { NoteInfo, NoteDocEnvelope, NoteDocContentChangedPayload, NoteDocOrigin };

export interface NoteCapabilityApi {
  /** 创建笔记;initialDoc=null 时用空 doc;folderId=null 时创建在根级 */
  createNote(
    initialDoc: NoteDocEnvelope | null,
    folderId: string | null,
  ): Promise<NoteInfo>;
  listNotes(): Promise<NoteInfo[]>;
  /**
   * 轻量 list — 只返 id/title/folderId,不 assemble doc。
   * 用于只读 title 去重的场景(markdown-import / extraction-import / NoteLinkSearch 等)。
   * 2026-05-28 性能修复:listNotes 全文 assemble 在大批 import 后冷启动卡 30s+。
   */
  listNoteTitles(): Promise<Array<{ id: string; title: string; folderId: string | null }>>;
  getNote(id: string): Promise<NoteInfo | null>;
  updateNote(id: string, doc: NoteDocEnvelope): Promise<NoteInfo | null>;
  moveNote(noteId: string, newFolderId: string | null): Promise<void>;
  deleteNote(id: string): Promise<void>;
  /** 订阅笔记列表变更 (IPC 广播);返 unsubscribe */
  onListChanged(callback: (list: NoteInfo[]) => void): () => void;
  /**
   * 订阅单 note doc 变化 (W5 严格态:view 层 hook 走此 API,不直接订阅 IPC)。
   *
   * 与 onListChanged 互补:
   * - onListChanged:整 list 元数据派生(title/folderId/updatedAt)更新所有订阅者
   * - onDocContentChanged:单 note doc 内容更新,**发起 renderer 不收**
   *   (防 NoteView Host 受控 useEffect[doc] echo 回灌跳光标)
   *
   * 返 unsubscribe。
   */
  onDocContentChanged(
    callback: (payload: NoteDocContentChangedPayload) => void,
  ): () => void;
}
