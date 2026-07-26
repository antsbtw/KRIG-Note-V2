/**
 * import-orchestrator capability 对外类型契约（阶段 C）
 *
 * 职责：把「拿到标准 CreateNoteBatchItem[] 之后的统一落库编排动作」收进一处 ——
 *   调 createNotesBatch → 收集 noteIds → 归一 failures → 返回 ImportResult。
 *
 * **边界纪律**（对接 [[import-to-note-convergence]] 阶段 C）：
 *  - 只做「items 之后的落库编排」，**不做**「怎么组装 items」的 view 业务
 *    （splitMode 切分 / 同名去重 / folder 树 / folder 归属 —— 一律留 view）。
 *  - 不改落库层内部（createNotesBatch / createSingleNoteFromDrafts）。
 *  - 经 requireCapabilityApi('note') 调 note capability，不直 import 落库 impl。
 *  - 进度 overlay 的**文案**是 view 业务（"篇笔记"/"章节"/单篇各异），留 view；
 *    编排层只在拿到 items 后可选回调 onSaving 让 view 上报「正在保存 N …」。
 */

import type {
  CreateNoteBatchItem,
  CreateNoteBatchFailure,
} from '@capabilities/note/types';

export type { CreateNoteBatchItem, CreateNoteBatchFailure } from '@capabilities/note/types';

export interface ImportOptions {
  /** 广播模式，透传 createNotesBatch（默认 'final'：全写完 1 次广播） */
  broadcastMode?: 'final' | 'progressive-throttle';
  /**
   * 各 item 的可读标签（与 items 同序，用于把 failures 的 index 映射回业务名）。
   * 不传则 failures.label 回落为 `index=N` / `tx-failed`。
   */
  labels?: string[];
  /**
   * 拿到非空 items、即将写库前的回调（count = 待写篇数）。view 用它上报
   * 「正在保存 N …」的 indeterminate 进度（文案由 view 决定，编排层不持 overlay）。
   */
  onSaving?: (count: number) => void;
  /** 透传给下游诊断的日志前缀（区分 markdown / extraction / clip 三源） */
  logTag?: string;
}

/** 归一后的失败项：在 CreateNoteBatchFailure 基础上补 resolved label（诊断友好） */
export interface ImportFailure extends CreateNoteBatchFailure {
  /** labels[index]（若提供）；tx 级失败为 'tx-failed'；否则 `index=N` */
  label: string;
}

export interface ImportResult {
  /** 成功创建的 note id（顺序同 createNotesBatch.notes） */
  noteIds: string[];
  /** 归一后的失败项（含 resolved label） */
  failures: ImportFailure[];
  /** 预留：来自解析/编排的 warnings（本期 createNotesBatch 无 warnings，恒空数组） */
  warnings: string[];
}

export interface ImportOrchestratorApi {
  /**
   * 唯一编排入口：标准 items → createNotesBatch → 归一结果。
   * items 为空时直接返回空结果（不调 batch、不广播、不触发 onSaving）。
   */
  importDraftsToNotes(
    items: CreateNoteBatchItem[],
    opts?: ImportOptions,
  ): Promise<ImportResult>;
}
