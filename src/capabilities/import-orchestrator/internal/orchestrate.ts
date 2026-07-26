/**
 * importDraftsToNotes — 唯一批量落库编排（阶段 C 基线，照搬三处 view 原有编排逻辑合一）。
 *
 * 三处旧编排的共性（markdown-import:768 / extraction-import:132 / import-pipeline:404）：
 *   1. 非空 items 才写库（+ view 侧 reportIndeterminate「正在保存 N …」）。
 *   2. 调 noteCap.createNotesBatch({ items, broadcastMode })。
 *   3. notes → noteIds、failures → 按 index 映射 label + console.warn 归一。
 * 本函数把 2/3 收进来；1 的**文案**留 view（经 onSaving 回调触发）。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCapabilityApi } from '@capabilities/note/types';
import type {
  CreateNoteBatchItem,
  ImportOptions,
  ImportResult,
  ImportFailure,
} from '../types';

function noteCap(): NoteCapabilityApi {
  return requireCapabilityApi<NoteCapabilityApi>('note');
}

/** failures[i].index → 可读 label（对齐三处 view 原有的 `batchLabels[f.index] ?? index=N` 逻辑） */
function resolveLabel(index: number, labels?: string[]): string {
  if (index < 0) return 'tx-failed';
  return labels?.[index] ?? `index=${index}`;
}

export async function importDraftsToNotes(
  items: CreateNoteBatchItem[],
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const { broadcastMode = 'final', labels, onSaving, logTag = 'import-orchestrator' } = opts;

  if (items.length === 0) {
    return { noteIds: [], failures: [], warnings: [] };
  }

  // view 侧上报「正在保存 N …」的 indeterminate 进度（文案 view 决定）。
  onSaving?.(items.length);

  const batchStart = performance.now();
  const result = await noteCap().createNotesBatch({ items, broadcastMode });
  const elapsed = Math.round(performance.now() - batchStart);
  console.log(
    `[${logTag}] createNotesBatch: items=${items.length} notes=${result.notes.length} ` +
      `failures=${result.failures.length} (${elapsed}ms)`,
  );

  const noteIds = result.notes.map((n) => n.id);

  const failures: ImportFailure[] = result.failures.map((f) => {
    const label = resolveLabel(f.index, labels);
    console.warn(`[${logTag}] BATCH failure ${label}: ${f.error}`);
    return { ...f, label };
  });

  return { noteIds, failures, warnings: [] };
}
