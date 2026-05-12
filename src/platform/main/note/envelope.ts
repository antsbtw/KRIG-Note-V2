/**
 * DriverSerialized 信封 wrap / unwrap (decision 012 路径 Y)
 *
 * 边界:
 * - view ↔ capability:DriverSerialized 信封 (本文件 wrap/unwrap)
 * - capability 内部 ↔ storage:裸 PmPayload
 *
 * 信封固定 format='pm-doc-json' / version='0.1',与 driver 层
 * src/drivers/text-editing-driver/index.ts:20-38 一致。
 *
 * 兼容性策略:
 * - unwrap 时如 format/version 不匹配,记录 warn 但仍解 payload
 *   (storage 层只见 PmPayload,driver 信封是 transport 元数据)
 * - wrap 时永远输出当前 format/version
 */

import type { PmPayload } from '@semantic/types';
import type { NoteDocEnvelope } from '@shared/ipc/note-folder-types';

const ENVELOPE_FORMAT = 'pm-doc-json';
const ENVELOPE_VERSION = '0.1';

export function wrapPmDoc(payload: PmPayload): NoteDocEnvelope<PmPayload> {
  return {
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    payload,
  };
}

export function unwrapPmDoc(envelope: NoteDocEnvelope): PmPayload {
  if (envelope.format !== ENVELOPE_FORMAT) {
    console.warn(
      `[note-capability] DriverSerialized format mismatch: expected ${ENVELOPE_FORMAT}, got ${envelope.format}`,
    );
  }
  return envelope.payload as PmPayload;
}

/** 空 doc (DriverSerialized 信封) — createNote 不传 initialDoc 时用 */
export function emptyNoteDoc(): NoteDocEnvelope<PmPayload> {
  // 与 driver 层 createEmptyDoc() 等价:首块带 isTitle:true paragraph (title-guard 约束)
  const pmDoc: PmPayload = {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { isTitle: true } },
    ],
  };
  return wrapPmDoc(pmDoc);
}
