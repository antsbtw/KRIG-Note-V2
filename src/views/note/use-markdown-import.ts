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
import { commandRegistry } from '@slot/command-registry/command-registry';
import {
  importMarkdownBatch,
  type MarkdownImportPayload,
  type SplitDecisionResolver,
} from './markdown-import';

const resolveSplit: SplitDecisionResolver = async (count) => {
  const ok = window.confirm(
    `Found ${count} large markdown file(s) with many headings.\n\n` +
      `Split each into multiple notes (one note per top-level section)?\n\n` +
      `OK = Split all\nCancel = Keep as single notes`,
  );
  return ok ? 'all' : 'none';
};

export function useMarkdownImport(): void {
  useEffect(() => {
    console.log('[markdown-import] hook mounted, subscribing to onMarkdownImportRun');
    const unsub = window.electronAPI.onMarkdownImportRun((data) => {
      const payload = data as MarkdownImportPayload;
      console.log(
        `[markdown-import] received batch: files=${payload?.files?.length ?? 0}`,
      );
      void importMarkdownBatch(payload, resolveSplit)
        .then((result) => {
          console.log(
            `[markdown-import] done — notes=${result.createdNoteIds.length} folders=${result.createdFolderIds.length} skipped=${result.skipped.length} splitMode=${result.splitMode}`,
          );
          // 导入完成后,把最后一个创建的 note 设为活跃(让用户直接看到结果)
          const lastId = result.createdNoteIds.at(-1);
          if (lastId) {
            commandRegistry.execute('note-view.set-active-in-right', lastId);
          }
        })
        .catch((err) => {
          console.error('[markdown-import] failed:', err);
        });
    });
    return unsub;
  }, []);
}
