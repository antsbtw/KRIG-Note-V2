/**
 * useEpubAnnotation — EPUB 标注 hook(L5-C4)
 *
 * V1 → V2 改写:src/plugins/ebook/hooks/useEpubAnnotation.ts(95 行)。
 * 改动:接 host 命令式 API + ebook-library API,**不直接消费 renderer**。
 * EPUB 选区 / annotation 事件由 view 端 Host props 传入(onEpubTextSelected
 * / onEpubSelectionDismiss / onEpubAnnotationClick),hook 维护 selection /
 * annotations state,提供 createAnnotation + dismissSelection。
 *
 * 数据流:
 *   EPUB 内 mouseup → renderer onTextSelected → Host onEpubTextSelected →
 *     view 调 hook 的 setSelection → 显 picker
 *   用户选色 → hook.createAnnotation(color) → library.annotationAdd +
 *     host.addHighlight → 重渲高亮
 *   EPUB 内 click 已有标注 → renderer onAnnotationClick → Host
 *     onEpubAnnotationClick → view 调 hook 的 onAnnotationClick → 删除
 *
 * 用法(view 端):
 *   const ann = useEpubAnnotation(hostRef, bookIdRef);
 *   <Host onEpubTextSelected={ann.setSelection}
 *         onEpubSelectionDismiss={ann.dismiss}
 *         onEpubAnnotationClick={ann.handleAnnotationClick} />
 *   <EpubAnnotationPicker selection={ann.selection}
 *                          onColor={ann.createAnnotation}
 *                          onCancel={ann.dismiss} />
 *   ann.loadOnBookOpen(bookId)  // onBookOpened 时调,加载已有 + 重绘高亮
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi, StoredAnnotation } from '@capabilities/ebook-library/types';
import type { EBookHostHandle } from '../Host';

export interface EpubSelection {
  cfi: string;
  text: string;
  x: number;
  y: number;
}

export function useEpubAnnotation(
  hostRef: React.RefObject<EBookHostHandle | null>,
  bookIdRef: React.RefObject<string | null>,
) {
  const [selection, setSelectionState] = useState<EpubSelection | null>(null);
  const [annotations, setAnnotations] = useState<StoredAnnotation[]>([]);
  const annotationsRef = useRef(annotations);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  const setSelection = useCallback((info: EpubSelection) => {
    setSelectionState(info);
  }, []);

  const dismiss = useCallback(() => {
    setSelectionState(null);
  }, []);

  /** EPUB 内点击已有标注:删除该标注 + 移除高亮 */
  const handleAnnotationClick = useCallback(
    async (cfi: string) => {
      const bookId = bookIdRef.current;
      const host = hostRef.current;
      if (!bookId || !host) return;
      const ann = annotationsRef.current.find((a) => a.cfi === cfi);
      if (!ann) return;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      await lib.annotationRemove(bookId, ann.id);
      host.removeHighlight(cfi);
      setAnnotations((prev) => prev.filter((a) => a.cfi !== cfi));
    },
    [bookIdRef, hostRef],
  );

  /** 用户选色 → 创建 annotation + 加 EPUB 高亮 */
  const createAnnotation = useCallback(
    async (color: string) => {
      const bookId = bookIdRef.current;
      const host = hostRef.current;
      if (!selection || !bookId || !host) return;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      try {
        const stored = await lib.annotationAdd(bookId, {
          type: 'underline',
          color,
          pageNum: 0,
          rect: { x: 0, y: 0, w: 0, h: 0 },
          cfi: selection.cfi,
          textContent: selection.text,
        });
        if (!stored) return;
        await host.addHighlight(selection.cfi, color);
        setAnnotations((prev) => [...prev, stored]);
        setSelectionState(null);
      } catch (err) {
        console.warn('[useEpubAnnotation] createAnnotation failed:', err);
      }
    },
    [selection, bookIdRef, hostRef],
  );

  /** 书加载后:拿全部 annotation + 重绘高亮(EPUB 重启场景关键)*/
  const loadOnBookOpen = useCallback(
    async (bookId: string) => {
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const host = hostRef.current;
      const list = await lib.annotationList(bookId);
      setAnnotations(list);
      if (!host) return;
      // 等 EPUB renderer ready(host.getTOC 走 readyPromise,迂回保证就绪)
      await host.getTOC();
      for (const ann of list) {
        if (ann.cfi) {
          await host.addHighlight(ann.cfi, ann.color);
        }
      }
    },
    [hostRef],
  );

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
