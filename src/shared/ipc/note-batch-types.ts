import type { PmAtomDraft } from '@semantic/types';
import type { NoteInfo } from './note-folder-types';

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
