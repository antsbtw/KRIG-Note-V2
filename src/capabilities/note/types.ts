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
import type { PmAtomDraft } from '@semantic/types';

export type { NoteInfo, NoteDocEnvelope, NoteDocContentChangedPayload, NoteDocOrigin };

/**
 * createNotesBatch 单个 item — 一个 PmAtomDraft[] → 一个 note (5B Stage 7 重做).
 *
 * - atoms: import-pipeline 产物 (markdownToAtoms / krigBatchToAtoms 等)
 * - folderId: 目标 folder (null = 根级)
 * - titleHint: 若 atoms[0].payload.payload.attrs.isTitle === true 字面忽略本字段
 * - importToken: 字面 reserved, 本期不实施去重
 */
export interface CreateNoteBatchItem {
  atoms: PmAtomDraft[];
  folderId: string | null;
  titleHint?: string;
  importToken?: string;
}

export interface CreateNoteBatchInput {
  items: CreateNoteBatchItem[];
  broadcastMode?: 'final' | 'progressive-throttle';
  throttleMs?: number;
}

export interface CreateNoteBatchFailure {
  index: number;
  error: string;
  rolledBack: boolean;
}

/**
 * createNotesBatch 返回值 (5B Stage 7).
 *
 * ⚠ **NoteInfo.doc 字段为空 container payload**(不含真正 blocks)— Stage 7 直写
 * storage 路径不重建完整 PM doc,blocks 字面在 storage 内,调用方需要 doc 内容时
 * 走 `noteCap.getNote(id)` (内部 assemblePmDoc 从 storage 重建).
 *
 * 已知调用方(markdown-import / extraction-import)字面只读 notes.length + failures,
 * 不读 doc,不受影响.未来新调用方若依赖 doc,需走 getNote.
 */
export interface CreateNoteBatchResult {
  notes: NoteInfo[];
  failures: CreateNoteBatchFailure[];
}

export interface NoteCapabilityApi {
  /** 创建笔记;initialDoc=null 时用空 doc;folderId=null 时创建在根级 */
  createNote(
    initialDoc: NoteDocEnvelope | null,
    folderId: string | null,
  ): Promise<NoteInfo>;
  /**
   * 批量创建笔记 (5B Stage 7 — 规范字面对齐).
   *
   * 字面消费 PmAtomDraft[] (import-pipeline 产物),storage 层分配 ULID 后
   * 拼 belongsToNote / childOf / nextSibling 三类边.单事务,失败整体回滚.
   *
   * - broadcastMode='final' 默认:所有 items 写完后 1 次 NOTE_LIST_CHANGED 广播
   * - broadcastMode='progressive-throttle':本期不实施 (字面留接口)
   */
  createNotesBatch(input: CreateNoteBatchInput): Promise<CreateNoteBatchResult>;
  /**
   * 列出所有 note。
   *
   * ⚠ **NoteInfo.doc 为空 container payload**(metadata-only,decision 027)。
   * listNotes 不再 assemble 全文(冷启动 66s → ~200ms);需要 doc 内容的调用方
   * 必须走 getNote(id) 单点拉。与 createNotesBatch 的 NoteInfo.doc 约定一致。
   */
  listNotes(): Promise<NoteInfo[]>;
  /**
   * 轻量 list — 只返 id/title/folderId(listNotes 的子集出参)。
   * 用于只读 title 去重的场景(markdown-import / extraction-import / NoteLinkSearch 等)。
   * decision 027 后与 listNotes 性能等价,保留仅为出参更窄。
   */
  listNoteTitles(): Promise<Array<{ id: string; title: string; folderId: string | null }>>;
  getNote(id: string): Promise<NoteInfo | null>;
  updateNote(id: string, doc: NoteDocEnvelope): Promise<NoteInfo | null>;
  moveNote(noteId: string, newFolderId: string | null): Promise<void>;
  deleteNote(id: string, opts?: { progressTaskId?: string }): Promise<void>;
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
