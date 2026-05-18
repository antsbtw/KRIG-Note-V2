/**
 * thought doc 信封 wrap/unwrap(对齐 note/envelope.ts 同模式)
 *
 * 边界:
 * - view ↔ capability:NoteDocEnvelope 信封(本文件 wrap/unwrap)
 * - capability 内部 ↔ storage:裸 PmPayload(thought 的 doc 字段)
 *
 * thought 与 note 共享 PM doc 信封格式(同 format='pm-doc-json' / version='0.1'),
 * 因为 thought 编辑器复用 text-editing.Host(NoteEditor 同款)。
 */

import type { PmPayload } from '@semantic/types';
import type { NoteDocEnvelope } from '@shared/ipc/note-folder-types';

const ENVELOPE_FORMAT = 'pm-doc-json';
const ENVELOPE_VERSION = '0.1';

export function wrapThoughtDoc(payload: PmPayload): NoteDocEnvelope<PmPayload> {
  return {
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    payload,
  };
}

export function unwrapThoughtDoc(envelope: NoteDocEnvelope): PmPayload {
  if (envelope.format !== ENVELOPE_FORMAT) {
    console.warn(
      `[thought-capability] envelope format mismatch: expected ${ENVELOPE_FORMAT}, got ${envelope.format}`,
    );
  }
  return envelope.payload as PmPayload;
}

/**
 * 空 thought doc(thoughtCreate 不传 doc 时用,或 ebook 高亮场景全部信息在 anchor)。
 * 与 note emptyNoteDoc() 不同:thought 无 title 节点,空 doc 是 0-段落起步。
 */
export function emptyThoughtDoc(): NoteDocEnvelope<PmPayload> {
  const pmDoc: PmPayload = {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  };
  return wrapThoughtDoc(pmDoc);
}
