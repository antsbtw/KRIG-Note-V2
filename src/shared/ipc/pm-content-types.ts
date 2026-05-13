/**
 * pm-content IPC 共享类型 (decision 014 §3.4)
 *
 * 边界:
 * - view ↔ capability:PmAtomInfo.doc = PmDocEnvelope (同 noteCapability 的 NoteDocEnvelope)
 * - capability 内部 ↔ storage:裸 PmPayload (envelope.ts wrap/unwrap)
 *
 * PmDocEnvelope 复用 NoteDocEnvelope 结构 (DriverSerialized 等价体);
 * 单独命名以表达 view-agnostic 语义 — pm-content 不绑定 note view 也不绑定 graph view,
 * 是底层 pm atom 通用 wrapper。
 */

import type { NoteDocEnvelope } from './note-folder-types';

export type PmDocEnvelope = NoteDocEnvelope;

/** pm atom 业务视图 (decision 014 §3.4) */
export interface PmAtomInfo {
  id: string;
  doc: PmDocEnvelope;
  /**
   * 单向 flag (decision 014 §3.7):
   * - 3a-1 单引用约束下恒 false (pm atom 只被 1 个 Instance 引用)
   * - 3a-shared-ref 阶段才会出现 true (被 2+ 个 Instance 引用)
   */
  hasBeenReferenced: boolean;
  createdAt: number;
  updatedAt: number;
}
