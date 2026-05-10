/**
 * usePdfAnnotations — PDF 空间标注 view 端协调 hook(L5-C5)
 *
 * 职责:
 * - 维护 annotations[] state(view 端镜像 library 持久化数据)
 * - 维护 annotationMode(off/rect/underline,UI 状态)
 * - loadOnBookOpen(bookId):onBookOpened 推流时拉全量
 * - create(pageNum, ann):调 library.annotationAdd → 写 file → 更新 state
 * - remove(id):调 library.annotationRemove → 删 file → 更新 state
 *
 * 不在 EBookView.tsx 内闭环是为了控制主组件 LOC(C4 末已 315 行)。
 *
 * 不和 use-epub-annotation 合并 — PDF 标注是 spatial 锚点,EPUB 标注是 CFI
 * 锚点,创建路径(pageNum + rect vs cfi + textContent)+ 数据流(host 推流
 * 选区 vs 用户 layer 拖拽)完全不同。
 */

import { useState, useCallback } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  EBookLibraryApi,
  StoredAnnotation,
} from '@capabilities/ebook-library/types';
import type { PageAnnotation } from '@capabilities/ebook-rendering/types';

export type AnnotationMode = 'off' | 'rect' | 'underline';

/** library StoredAnnotation 转 PageAnnotation(UI 用) */
function toPageAnnotation(s: StoredAnnotation): PageAnnotation {
  return {
    id: s.id,
    type: s.type,
    color: s.color,
    pageNum: s.pageNum,
    rect: s.rect,
  };
}

export function usePdfAnnotations(
  bookIdRef: React.RefObject<string | null>,
) {
  const [annotations, setAnnotations] = useState<PageAnnotation[]>([]);
  const [mode, setMode] = useState<AnnotationMode>('off');

  const loadOnBookOpen = useCallback(async (bookId: string) => {
    const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    const list = await lib.annotationList(bookId);
    // 仅 PDF 空间标注(rect / underline 含 pageNum > 0,过滤 EPUB 的 cfi 标注)
    const pdfList = list.filter((a) => a.pageNum > 0 && (a.type === 'rect' || a.type === 'underline')).map(toPageAnnotation);
    setAnnotations(pdfList);
  }, []);

  const create = useCallback(
    async (pageNum: number, ann: Omit<PageAnnotation, 'id' | 'pageNum'>) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const stored = await lib.annotationAdd(bookId, {
        type: ann.type,
        color: ann.color,
        pageNum,
        rect: ann.rect,
      });
      if (!stored) return;
      setAnnotations((prev) => [...prev, toPageAnnotation(stored)]);
    },
    [bookIdRef],
  );

  const remove = useCallback(
    async (id: string) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      await lib.annotationRemove(bookId, id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    },
    [bookIdRef],
  );

  return {
    annotations,
    mode,
    setMode,
    loadOnBookOpen,
    create,
    remove,
  };
}
