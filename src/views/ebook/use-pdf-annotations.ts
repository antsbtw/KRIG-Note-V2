/**
 * usePdfAnnotations — PDF 空间标注 view 端协调 hook (L5-C5)
 *
 * sub-phase 022 (decision 022 §4.1.4 + §7.3): annotation → thought block 真实接入.
 *
 * 数据流:
 *   onBookOpened → loadOnBookOpen(bookId) → lib.getReadingThoughtAnnotations →
 *     筛 PDF 空间标注 (pageNum > 0 + type ∈ {rect, underline}) → PageAnnotation[]
 *   用户框选 / 划线 → create(pageNum, ann) → lib.addReadingThoughtBlock
 *     (rect + thumbnail → image block / underline → paragraph block, 沿决议 §7.3)
 *   用户删标注 → remove(id) → lib.removeReadingThoughtBlock (id = bookAnchor.createdAt 字符串,
 *     沿 Step 5.5 决策 3)
 *
 * 不和 use-epub-annotation 合并 — PDF 空间锚点 (rect/underline) vs EPUB CFI 锚点
 * 创建路径完全不同.
 */

import { useState, useCallback } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  EBookLibraryApi,
  BookAnchor,
} from '@capabilities/ebook-library/types';
import type { PageAnnotation } from '@capabilities/ebook-rendering/types';

export type AnnotationMode = 'off' | 'rect' | 'underline';

/** BookAnchor → PageAnnotation (UI 投影) */
function toPageAnnotation(anchor: BookAnchor): PageAnnotation | null {
  // 只 PDF 空间标注 (pageNum > 0 + rect 非空 + type 字面 rect/underline)
  if (anchor.pageNum <= 0) return null;
  if (!anchor.rect) return null;
  if (anchor.type !== 'rect' && anchor.type !== 'underline') return null;
  return {
    id: String(anchor.createdAt), // 沿 Step 5.5 决策 3: createdAt 作 blockId
    type: anchor.type,
    color: anchor.color,
    pageNum: anchor.pageNum,
    rect: anchor.rect,
  };
}

export function usePdfAnnotations(
  bookIdRef: React.RefObject<string | null>,
) {
  const [annotations, setAnnotations] = useState<PageAnnotation[]>([]);
  const [mode, setMode] = useState<AnnotationMode>('off');

  const loadOnBookOpen = useCallback(async (bookId: string) => {
    const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    const anchors = await lib.getReadingThoughtAnnotations(bookId);
    const pdfList: PageAnnotation[] = [];
    for (const a of anchors) {
      const pa = toPageAnnotation(a);
      if (pa) pdfList.push(pa);
    }
    setAnnotations(pdfList);
  }, []);

  const create = useCallback(
    async (pageNum: number, ann: Omit<PageAnnotation, 'id' | 'pageNum'>) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const createdAt = Date.now();
      const bookAnchor: BookAnchor = {
        pageNum,
        rect: ann.rect,
        color: ann.color,
        type: ann.type, // 'rect' | 'underline'
        createdAt,
      };
      // 沿决议 §7.3 字面映射:
      //   PDF rect + thumbnail → image block (含 thumbnail src);
      //   PDF underline → paragraph block (anchor 字面已含 pageNum + rect + color)
      // 字面注: thumbnail 字面截图当前 view 端字面尚无生成路径, 留 decision 023+
      // 字面字面接入. 字面当前 rect 字面也走 paragraph block (没 thumbnail → 跳过 image
      // block 分支), 沿 §7.3 字面字面 "rect + thumbnail 非空 → image" 字面前置条件.
      await lib.addReadingThoughtBlock(bookId, {
        type: 'paragraph',
        bookAnchor,
      });
      // 更新 state — 字面直接 push (避 reload 全量字面延迟; 跟 server 状态字面字面字面
      // 字面字面 onBookshelfChanged 推流字面同步 — 但 thought block 字面字面无 push,
      // 字面 state 字面 optimistic update)
      setAnnotations((prev) => [
        ...prev,
        {
          id: String(createdAt),
          type: ann.type,
          color: ann.color,
          pageNum,
          rect: ann.rect,
        },
      ]);
    },
    [bookIdRef],
  );

  const remove = useCallback(
    async (id: string) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      // id 字面已经是 createdAt 字符串 (沿 Step 5.5 决策 3)
      await lib.removeReadingThoughtBlock(bookId, id);
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
