/**
 * useExtractionImport — 订阅 main 推送的 atom batch JSON,转 PM,落 noteCapability
 *
 * 见 extraction-import.ts 的导入流程。本 hook 只做"挂订阅 + 调导入"。
 *
 * **去重**:相同文件夹下相同 title 的章节会跳过(extraction-import 内部处理),
 * 不会重复创建。
 *
 * **挂载位置**:EBookView mount 一次即够;main → renderer 是广播,所有挂了
 * onExtractionNoteCreate 的 view 都会收到,但导入逻辑天然幂等(去重),即使多次
 * 触发也只会创建一份。
 */

import { useEffect } from 'react';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { importExtractionBatch } from './extraction-import';

export function useExtractionImport(workspaceId: string): void {
  useEffect(() => {
    console.log('[extraction-import] hook mounted, subscribing to onExtractionNoteCreate');
    const unsub = window.electronAPI.onExtractionNoteCreate((data) => {
      // onExtractionNoteCreate 是宿主 webContents 广播,每个并存 NoteView 实例(每 ws
      // 一个,非活跃 display:none 但未卸载)都会收到。只让活跃 ws 处理,否则 N 个 ws
      // 各跑一遍导入 → 并发写库抢锁。(去重只防"重跑同章",不防"两批并发"。)
      if (workspaceManager.getActiveId() !== workspaceId) return;
      console.log('[extraction-import] received data from main:', data);
      void importExtractionBatch(data)
        .then((result) => {
          console.log(
            `[extraction-import] done — folder=${result.folderId} created=${result.noteIds.length} skipped=${result.skippedTitles.length}`,
          );
          // L5-C6 UX:导入完成后右栏切到 NoteView 显示最后一章
          // - **不动 left slot**(用户在 EBookView 看 PDF,left 是主上下文,
          //   按"left 不被系统自动关"约定,系统不能擅自替换)
          // - 关掉 right slot 当前装的 web-view(Platform UI),换成 NoteView
          // - 走 set-active-in-right 命令(slotBinding.right = 'note-view',
          //   原 web-view 实例被替换;NoteView 通过 setActiveNote 显新章节)
          const lastId = result.noteIds.at(-1);
          if (lastId) {
            commandRegistry.execute('note-view.set-active-in-right', lastId);
          }
        })
        .catch((err) => {
          console.error('[extraction-import] failed:', err);
        });
    });
    return unsub;
  }, [workspaceId]);
}
