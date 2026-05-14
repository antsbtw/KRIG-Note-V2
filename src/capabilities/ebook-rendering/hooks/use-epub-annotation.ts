/**
 * useEpubAnnotation — EPUB 标注 hook (L5-C4)
 *
 * sub-phase 022 (decision 022 §0.5 + §4.1.4): annotation 概念消亡, view caller
 * 改走 thought block. 本 hook 字面 stub 化, 留 Step 5.6 (view caller 改造) 字面
 * 真实接入 ebook capability 新 5 API:
 *   - lib.getReadingThoughtAnnotations(bookId): Promise<BookAnchor[]>  (替代 annotationList)
 *   - lib.addReadingThoughtBlock(bookId, blockSpec): Promise<void>     (替代 annotationAdd)
 *   - lib.removeReadingThoughtBlock(bookId, blockId): Promise<void>    (替代 annotationRemove)
 *
 * 当前 Step 5.4 commit 2 阶段: 接口签名保留, 实现返回空 (typecheck 全绿).
 *
 * 用法(view 端, Step 5.6 后):
 *   const ann = useEpubAnnotation(hostRef, bookIdRef);
 *   <Host onEpubTextSelected={ann.setSelection}
 *         onEpubSelectionDismiss={ann.dismiss}
 *         onEpubAnnotationClick={ann.handleAnnotationClick} />
 *   <EpubAnnotationPicker selection={ann.selection}
 *                          onColor={ann.createAnnotation}
 *                          onCancel={ann.dismiss} />
 *   ann.loadOnBookOpen(bookId)  // onBookOpened 时调,加载已有 + 重绘高亮
 */

import { useState, useCallback } from 'react';
import type { EBookHostHandle } from '../Host';

export interface EpubSelection {
  cfi: string;
  text: string;
  x: number;
  y: number;
}

/** 临时占位类型 (Step 5.6 替换为 BookAnchor[] 投影) */
interface EpubAnnotationStub {
  id: string;
  cfi: string;
  color: string;
  textContent?: string;
}

export function useEpubAnnotation(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _hostRef: React.RefObject<EBookHostHandle | null>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _bookIdRef: React.RefObject<string | null>,
) {
  const [selection, setSelectionState] = useState<EpubSelection | null>(null);
  const [annotations] = useState<EpubAnnotationStub[]>([]);

  const setSelection = useCallback((info: EpubSelection) => {
    setSelectionState(info);
  }, []);

  const dismiss = useCallback(() => {
    setSelectionState(null);
  }, []);

  // TODO Step 5.6: 接入 lib.removeReadingThoughtBlock(bookId, blockId) +
  //                host.removeHighlight(cfi)
  const handleAnnotationClick = useCallback(async (_cfi: string) => {
    // stub
  }, []);

  // TODO Step 5.6: 接入 lib.addReadingThoughtBlock(bookId, { type: 'blockquote',
  //                  attrs: { bookAnchor: { pageNum: 0, cfi, textContent, color,
  //                                          type: 'highlight', createdAt } },
  //                  content: [{ type: 'paragraph', content: [{ type: 'text',
  //                              text: selection.text }] }] }) + host.addHighlight
  const createAnnotation = useCallback(async (_color: string) => {
    // stub: 留 Step 5.6 接入 thought block API
    setSelectionState(null);
  }, []);

  // TODO Step 5.6: 接入 lib.getReadingThoughtAnnotations(bookId) → 筛 cfi 非空的
  //                BookAnchor → 重绘 host.addHighlight
  const loadOnBookOpen = useCallback(async (_bookId: string) => {
    // stub
  }, []);

  return {
    selection,
    annotations,
    setSelection,
    dismiss,
    handleAnnotationClick,
    createAnnotation,
    loadOnBookOpen,
  };
}
