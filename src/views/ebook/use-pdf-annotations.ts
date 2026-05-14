/**
 * usePdfAnnotations — PDF 空间标注 view 端协调 hook (L5-C5)
 *
 * sub-phase 022 (decision 022 §0.5 + §4.1.4): annotation 概念消亡, view caller
 * 改走 thought block. 本 hook 字面 stub 化, 留 Step 5.6 (view caller 改造) 字面
 * 真实接入 ebook capability 新 5 API:
 *   - lib.getReadingThoughtAnnotations(bookId): Promise<BookAnchor[]>  (替代 annotationList)
 *   - lib.addReadingThoughtBlock(bookId, blockSpec): Promise<void>     (替代 annotationAdd)
 *   - lib.removeReadingThoughtBlock(bookId, blockId): Promise<void>    (替代 annotationRemove)
 *
 * 当前 Step 5.4 commit 2 阶段: 接口签名保留, 实现返回空 (typecheck 全绿).
 */

import { useState, useCallback } from 'react';
import type { PageAnnotation } from '@capabilities/ebook-rendering/types';

export type AnnotationMode = 'off' | 'rect' | 'underline';

export function usePdfAnnotations(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _bookIdRef: React.RefObject<string | null>,
) {
  const [annotations, setAnnotations] = useState<PageAnnotation[]>([]);
  const [mode, setMode] = useState<AnnotationMode>('off');

  // TODO Step 5.6: 接入 lib.getReadingThoughtAnnotations(bookId) 字面拉 BookAnchor[]
  //                并转成 PageAnnotation[] (只筛 PDF 空间标注: pageNum > 0 + type ∈ {rect, underline})
  const loadOnBookOpen = useCallback(async (_bookId: string) => {
    // stub: annotation 概念消亡, 留 Step 5.6 接入 thought block API
    setAnnotations([]);
  }, []);

  // TODO Step 5.6: 接入 lib.addReadingThoughtBlock(bookId, { type: 'image' | 'paragraph',
  //                  attrs: { bookAnchor: { pageNum, rect, color, type, createdAt } } })
  const create = useCallback(
    async (_pageNum: number, _ann: Omit<PageAnnotation, 'id' | 'pageNum'>) => {
      // stub: 留 Step 5.6 接入 thought block API
    },
    [],
  );

  // TODO Step 5.6: 接入 lib.removeReadingThoughtBlock(bookId, blockId)
  const remove = useCallback(async (id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return {
    annotations,
    mode,
    setMode,
    loadOnBookOpen,
    create,
    remove,
  };
}
