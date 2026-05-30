/**
 * intent-log 类型 — SP-3 数据层可靠性 intent-log 体系
 *
 * intent 记录一个"多步/分批写操作"的进度,让中断后 sweeper 能续完/回滚。
 * 详 docs/tasks/2026-05-30-data-layer-reliability-design.md §3。
 */

/** intent 操作类型(随 SP-2/4/5 逐步启用) */
export type IntentOp =
  | 'delete-note'
  | 'delete-folder'
  | 'delete-batch'
  | 'import-batch';

export type IntentStatus = 'pending' | 'done';

/** intent 记录(storage 层实体) */
export interface IntentEntity {
  id: string;
  op: IntentOp;
  /** 主目标 id(note id / folder root id);batch 类可空,清单在 payload */
  targetId: string | null;
  status: IntentStatus;
  /** 分批游标,按 op 不同(如 delete-note: { deleted: number }) */
  cursor: Record<string, unknown>;
  /** op 特定数据(可选;如 batch 的 id 清单) */
  payload?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** 新建 intent 的输入 */
export interface CreateIntentInput {
  op: IntentOp;
  targetId?: string | null;
  cursor?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}
