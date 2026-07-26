/**
 * import-orchestrator 契约测试（阶段 C）
 *
 * 锁死唯一编排入口 importDraftsToNotes 的共性行为（三处 view 原本各自重复）：
 *  - 空 items 短路：不调 batch、不广播、不触发 onSaving。
 *  - notes → noteIds；failures → 归一（index→label 映射 + resolved label）。
 *  - broadcastMode / logTag 透传 createNotesBatch。
 *  - onSaving(count) 在非空写库前触发一次。
 *
 * 落库层（createNotesBatch）用 mock note capability 替身，不触真 storage。
 * requireCapabilityApi 本文件局部 mock（覆盖全局 setup 的 stub），只放行 'note'。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  CreateNoteBatchInput,
  CreateNoteBatchResult,
} from '@capabilities/note/types';
import type { CreateNoteBatchItem } from '@capabilities/import-orchestrator';

const batchSpy = vi.fn<(input: CreateNoteBatchInput) => Promise<CreateNoteBatchResult>>();

// 局部覆盖全局 setup：只放行 orchestrator 依赖的 'note' capability。
vi.mock('@slot/capability-registry/get-capability-api', () => ({
  getCapabilityApi: vi.fn(() => undefined),
  requireCapabilityApi: vi.fn((id: string) => {
    if (id === 'note') return { createNotesBatch: batchSpy };
    throw new Error(`[test] capability '${id}' not stubbed`);
  }),
}));

// 在 mock 生效后再导入被测模块（vi.mock 已 hoist，import 顺序安全）。
const { importDraftsToNotes } = await import('@capabilities/import-orchestrator');

const item = (folderId: string | null = null): CreateNoteBatchItem => ({
  atoms: [],
  folderId,
});

const note = (id: string) => ({ id } as never);

describe('importDraftsToNotes', () => {
  beforeEach(() => batchSpy.mockReset());

  it('空 items → 短路：不调 batch、不触发 onSaving、返回空结果', async () => {
    const onSaving = vi.fn();
    const r = await importDraftsToNotes([], { onSaving });
    expect(r).toEqual({ noteIds: [], failures: [], warnings: [] });
    expect(batchSpy).not.toHaveBeenCalled();
    expect(onSaving).not.toHaveBeenCalled();
  });

  it('notes → noteIds（顺序保持）', async () => {
    batchSpy.mockResolvedValue({ notes: [note('n1'), note('n2')], failures: [] });
    const r = await importDraftsToNotes([item(), item()]);
    expect(r.noteIds).toEqual(['n1', 'n2']);
    expect(r.failures).toEqual([]);
  });

  it('failures → 归一 + labels 映射', async () => {
    batchSpy.mockResolvedValue({
      notes: [],
      failures: [{ index: 1, error: 'boom', rolledBack: true }],
    });
    const r = await importDraftsToNotes([item(), item()], {
      labels: ['A.md', 'B.md'],
    });
    expect(r.failures).toEqual([
      { index: 1, error: 'boom', rolledBack: true, label: 'B.md' },
    ]);
  });

  it('failures 无 labels → label 回落 index=N；tx 级失败 → tx-failed', async () => {
    batchSpy.mockResolvedValue({
      notes: [],
      failures: [
        { index: 0, error: 'e0', rolledBack: true },
        { index: -1, error: 'tx', rolledBack: true },
      ],
    });
    const r = await importDraftsToNotes([item()]);
    expect(r.failures.map((f) => f.label)).toEqual(['index=0', 'tx-failed']);
  });

  it('broadcastMode / 默认 final 透传 createNotesBatch', async () => {
    batchSpy.mockResolvedValue({ notes: [note('n1')], failures: [] });
    await importDraftsToNotes([item()]);
    expect(batchSpy).toHaveBeenCalledWith({ items: [item()], broadcastMode: 'final' });

    await importDraftsToNotes([item()], { broadcastMode: 'progressive-throttle' });
    expect(batchSpy).toHaveBeenLastCalledWith({
      items: [item()],
      broadcastMode: 'progressive-throttle',
    });
  });

  it('onSaving(count) 在非空写库前触发一次', async () => {
    batchSpy.mockResolvedValue({ notes: [note('n1'), note('n2')], failures: [] });
    const onSaving = vi.fn();
    await importDraftsToNotes([item(), item()], { onSaving });
    expect(onSaving).toHaveBeenCalledTimes(1);
    expect(onSaving).toHaveBeenCalledWith(2);
  });

  it('warnings 恒为空数组（本期 createNotesBatch 无 warnings）', async () => {
    batchSpy.mockResolvedValue({ notes: [note('n1')], failures: [] });
    const r = await importDraftsToNotes([item()]);
    expect(r.warnings).toEqual([]);
  });
});
