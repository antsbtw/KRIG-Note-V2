/**
 * useExtractionImport — 订阅 main 推送的 atom batch JSON,转 PM,落 noteStore
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
import { importExtractionBatch } from './extraction-import';

export function useExtractionImport(): void {
  useEffect(() => {
    const unsub = window.electronAPI.onExtractionNoteCreate((data) => {
      void importExtractionBatch(data).then((result) => {
        console.log(
          `[extraction-import] folder=${result.folderId} created=${result.noteIds.length} skipped=${result.skippedTitles.length}`,
        );
      });
    });
    return unsub;
  }, []);
}
