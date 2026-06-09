/**
 * useMarkdownImport — 订阅 main 推送的 markdown 批,转 PM,落 noteCapability
 *
 * 见 markdown-import.ts 的导入流程。本 hook 只做"挂订阅 + 调导入 + 决策弹窗"。
 *
 * **挂载位置**:NoteView mount 一次即够,main → renderer 是广播,所有挂订阅
 * 的 view 都会收到,但导入逻辑(uniqueName 同名后缀)幂等。
 *
 * 决策弹窗:用浏览器原生 window.confirm —— oversized 场景用户少,正路径无打断,
 * 引入 modal 体系开销不值。需要更细粒度 UI 时换成 ai-sync 用的那套 toast/dialog。
 */

import { useEffect } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { setActiveNote } from './data-model';
import {
  importMarkdownBatch,
  type MarkdownImportPayload,
  type SplitDecisionResolver,
} from './markdown-import';

const resolveSplit: SplitDecisionResolver = async (count) => {
  const ok = window.confirm(
    `Found ${count} large markdown file(s) (long + many top-level sections).\n\n` +
      `Split each into multiple notes (one per top-level section)?\n\n` +
      `OK = Split all\nCancel = Keep as single notes`,
  );
  return ok ? 'all' : 'none';
};

export function useMarkdownImport(workspaceId: string): void {
  useEffect(() => {
    console.log('[markdown-import] hook mounted, subscribing to onMarkdownImportRun');
    const unsub = window.electronAPI.onMarkdownImportRun((data) => {
      // onMarkdownImportRun 是宿主 webContents 广播,每个并存的 NoteView 实例(每 ws
      // 一个,非活跃 display:none 但未卸载)都会收到。若不认领,N 个 ws 各跑一遍完整
      // 导入 → 两批并发写库抢锁(撞 SurrealDB 乐观锁 → 卡住/重复建)。只让活跃 ws 处理。
      if (workspaceManager.getActiveId() !== workspaceId) return;
      const payload = data as MarkdownImportPayload;
      console.log(
        `[markdown-import] received batch: files=${payload?.files?.length ?? 0}`,
      );
      const batchStart = performance.now();
      void importMarkdownBatch(payload, resolveSplit)
        .then((result) => {
          const elapsedMs = Math.round(performance.now() - batchStart);
          console.log(
            `[markdown-import] done — notes=${result.createdNoteIds.length} folders=${result.createdFolderIds.length} skipped=${result.skipped.length} splitMode=${result.splitMode} elapsed=${elapsedMs}ms`,
          );

          // 失败强制可见(2026-05-27 反馈:长 docx Split All 部分 chunk 静默
          //   失败 → 重启 cache 清空后 NoteView 拼出半截。修法:不再吞 skipped)
          // 2026-05-29 import UX sub-phase: progress overlay 已显示 success/fail toast.
          // 字面仅保留 console.warn 详细失败清单 (开发者诊断用),删 window.alert (重复 UI).
          if (result.skipped.length > 0) {
            console.warn(
              `[markdown-import] SKIPPED ${result.skipped.length} item(s):\n${result.skipped
                .map((s) => `  - ${s.relPath}: ${s.reason}`)
                .join('\n')}`,
            );
          }

          // 导入完成后,把最后一个创建的 note 设为当前 NoteView 的 active
          // (不动 slot 状态 — 跟"点 NavSide 里的 note"行为一致)
          const lastId = result.createdNoteIds.at(-1);
          if (lastId) {
            setActiveNote(workspaceId, lastId);
          }
        })
        .catch((err) => {
          // 2026-05-29 import UX sub-phase: progress overlay 字面已显示 catastrophic 失败.
          // 字面仅 console.error 留 stack trace (开发者诊断用), 删 window.alert.
          console.error('[markdown-import] BATCH FATAL:', err);
        });
    });
    return unsub;
  }, [workspaceId]);
}
