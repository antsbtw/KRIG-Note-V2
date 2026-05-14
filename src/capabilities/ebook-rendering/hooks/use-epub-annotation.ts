/**
 * useEpubAnnotation — EPUB 标注 hook (L5-C4)
 *
 * sub-phase 022 (decision 022 §4.1.4 + §7.3): annotation → thought block 真实接入.
 *
 * 数据流:
 *   EPUB 内 mouseup → renderer onTextSelected → Host onEpubTextSelected →
 *     view 调 hook 的 setSelection → 显 picker
 *   用户选色 → hook.createAnnotation(color) → lib.addReadingThoughtBlock
 *     (EPUB highlight: type='blockquote' + bookAnchor.cfi + textContent, 沿决议 §7.3)
 *     + host.addHighlight(cfi, color) → 重渲高亮
 *   EPUB 内 click 已有标注 → renderer onAnnotationClick → Host onEpubAnnotationClick →
 *     view 调 hook 的 handleAnnotationClick → lib.removeReadingThoughtBlock(createdAt)
 *     + host.removeHighlight(cfi) → 重渲
 *
 * 用法 (view 端):
 *   const ann = useEpubAnnotation(hostRef, bookIdRef);
 *   <Host onEpubTextSelected={ann.setSelection}
 *         onEpubSelectionDismiss={ann.dismiss}
 *         onEpubAnnotationClick={ann.handleAnnotationClick} />
 *   <EpubAnnotationPicker selection={ann.selection}
 *                          onColor={ann.createAnnotation}
 *                          onCancel={ann.dismiss} />
 *   ann.loadOnBookOpen(bookId)  // onBookOpened 时调, 加载已有 + 重绘高亮
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  EBookLibraryApi,
  BookAnchor,
} from '@capabilities/ebook-library/types';
import type { EBookHostHandle } from '../Host';

export interface EpubSelection {
  cfi: string;
  text: string;
  x: number;
  y: number;
}

/** view 端字面 EPUB annotation 投影 (从 BookAnchor 派生) */
interface EpubAnnotation {
  /** = createdAt 字符串 (Step 5.5 决策 3 字面 blockId) */
  id: string;
  cfi: string;
  color: string;
  textContent?: string;
}

function toEpubAnnotation(anchor: BookAnchor): EpubAnnotation | null {
  // EPUB 标注字面 type='highlight' + cfi 非空 (沿决议 §7.3 字面)
  if (anchor.type !== 'highlight') return null;
  if (!anchor.cfi) return null;
  return {
    id: String(anchor.createdAt),
    cfi: anchor.cfi,
    color: anchor.color,
    textContent: anchor.textContent,
  };
}

export function useEpubAnnotation(
  hostRef: React.RefObject<EBookHostHandle | null>,
  bookIdRef: React.RefObject<string | null>,
) {
  const [selection, setSelectionState] = useState<EpubSelection | null>(null);
  const [annotations, setAnnotations] = useState<EpubAnnotation[]>([]);
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

  /** EPUB 内点击已有标注: 删该标注 + 移除高亮 */
  const handleAnnotationClick = useCallback(
    async (cfi: string) => {
      const bookId = bookIdRef.current;
      const host = hostRef.current;
      if (!bookId || !host) return;
      const ann = annotationsRef.current.find((a) => a.cfi === cfi);
      if (!ann) return;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      await lib.removeReadingThoughtBlock(bookId, ann.id);
      host.removeHighlight(cfi);
      setAnnotations((prev) => prev.filter((a) => a.cfi !== cfi));
    },
    [bookIdRef, hostRef],
  );

  /** 用户选色 → 创建 EPUB highlight + 加 EPUB 高亮 */
  const createAnnotation = useCallback(
    async (color: string) => {
      const bookId = bookIdRef.current;
      const host = hostRef.current;
      if (!selection || !bookId || !host) return;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const createdAt = Date.now();
      const bookAnchor: BookAnchor = {
        pageNum: 0, // EPUB 占位 (沿决议 §1.3.1 字面)
        cfi: selection.cfi,
        textContent: selection.text,
        color,
        type: 'highlight',
        createdAt,
      };
      try {
        // EPUB highlight → blockquote block (沿决议 §7.3 字面)
        await lib.addReadingThoughtBlock(bookId, {
          type: 'blockquote',
          bookAnchor,
          textContent: selection.text,
        });
        await host.addHighlight(selection.cfi, color);
        setAnnotations((prev) => [
          ...prev,
          {
            id: String(createdAt),
            cfi: selection.cfi,
            color,
            textContent: selection.text,
          },
        ]);
        setSelectionState(null);
      } catch (err) {
        console.warn('[useEpubAnnotation] createAnnotation failed:', err);
      }
    },
    [selection, bookIdRef, hostRef],
  );

  /** 书加载后: 拿全部 EPUB annotation + 重绘高亮 (EPUB 重启场景关键) */
  const loadOnBookOpen = useCallback(
    async (bookId: string) => {
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const host = hostRef.current;
      const anchors = await lib.getReadingThoughtAnnotations(bookId);
      const list: EpubAnnotation[] = [];
      for (const a of anchors) {
        const ea = toEpubAnnotation(a);
        if (ea) list.push(ea);
      }
      setAnnotations(list);
      if (!host) return;
      // 等 EPUB renderer ready (host.getTOC 走 readyPromise, 迂回保证就绪)
      await host.getTOC();
      for (const ann of list) {
        await host.addHighlight(ann.cfi, ann.color);
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
