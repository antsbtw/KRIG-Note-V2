/**
 * usePdfAnnotations — PDF 空间标注 view 端协调 hook
 *
 * thought-view-port.md v0.5 §16.3 双轨实施(Phase 4):
 *   - **新建走 thought capability**:
 *     rect → thought.type='rect-frame'(thumbnail 后续支持)
 *     underline → thought.type='underline'
 *   - **加载读双源**:新数据(thoughtListBySource)+ 老 lib.getReadingThoughtAnnotations
 *     按 createdAt 去重(同 ts 跳过老 path 优先新 path)
 *   - 删除按 thoughtId 字段分支(有 → thoughtDelete;否则老 path)
 *
 * 不和 use-epub-annotation 合并 — PDF 空间锚点 vs EPUB CFI 锚点结构不同。
 */

import { useState, useCallback } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  EBookLibraryApi,
  BookAnchor,
} from '@capabilities/ebook-library/types';
import type {
  ThoughtCapabilityApi,
  ThoughtInfo,
  BookLocator,
} from '@capabilities/thought/types';
import type { PageAnnotation } from '@capabilities/ebook-rendering/types';

export type AnnotationMode = 'off' | 'rect' | 'underline';

/** 内部 PageAnnotation 扩展(承担 thoughtId 区分新/老路径) */
interface PdfAnnotationItem extends PageAnnotation {
  /** v0.5 §16.3 新路径独有,删除时走 thoughtCapability.deleteThought */
  thoughtId?: string;
}

function toPageAnnotationFromLegacy(anchor: BookAnchor): PdfAnnotationItem | null {
  if (anchor.pageNum <= 0) return null;
  if (!anchor.rect) return null;
  if (anchor.type !== 'rect' && anchor.type !== 'underline') return null;
  return {
    id: String(anchor.createdAt),
    type: anchor.type,
    color: anchor.color,
    pageNum: anchor.pageNum,
    rect: anchor.rect,
  };
}

function toPageAnnotationFromThought(t: ThoughtInfo): PdfAnnotationItem | null {
  if (t.type !== 'rect-frame' && t.type !== 'underline') return null;
  if (!t.anchor || t.anchor.source !== 'book') return null;
  const loc = t.anchor.locator as BookLocator;
  if (loc.pageNum <= 0 || !loc.rect) return null;
  // thought.type='rect-frame' / 'underline' → PageAnnotation.type='rect' / 'underline'
  const pageType: 'rect' | 'underline' = t.type === 'rect-frame' ? 'rect' : 'underline';
  return {
    id: t.id,
    type: pageType,
    color: t.color ?? loc.color,
    pageNum: loc.pageNum,
    rect: loc.rect,
    thoughtId: t.id,
  };
}

export function usePdfAnnotations(
  bookIdRef: React.RefObject<string | null>,
) {
  const [annotations, setAnnotations] = useState<PdfAnnotationItem[]>([]);
  const [mode, setMode] = useState<AnnotationMode>('off');

  const loadOnBookOpen = useCallback(async (bookId: string) => {
    const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
    const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');

    const [newThoughts, legacyAnchors] = await Promise.all([
      thoughtApi.listThoughtsBySource('book', bookId),
      lib.getReadingThoughtAnnotations(bookId),
    ]);

    const list: PdfAnnotationItem[] = [];
    // 新数据优先(按 createdAt 去重 — 主要场景是 Phase 6 迁移后会有重叠)
    const seenCreatedAt = new Set<number>();
    for (const t of newThoughts) {
      const item = toPageAnnotationFromThought(t);
      if (!item) continue;
      if (t.anchor?.source === 'book') {
        const loc = t.anchor.locator as BookLocator;
        seenCreatedAt.add(loc.createdAt);
      }
      list.push(item);
    }
    for (const a of legacyAnchors) {
      if (seenCreatedAt.has(a.createdAt)) continue;
      const item = toPageAnnotationFromLegacy(a);
      if (item) list.push(item);
    }
    setAnnotations(list);
  }, []);

  const create = useCallback(
    async (pageNum: number, ann: Omit<PageAnnotation, 'id' | 'pageNum'>) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
      const createdAt = Date.now();
      const bookLocator: BookLocator = {
        pageNum,
        rect: ann.rect,
        color: ann.color,
        type: ann.type,
        createdAt,
      };
      // v0.5 §16.2 字面 mapping:rect → rect-frame thought / underline → underline thought
      const thoughtType: 'rect-frame' | 'underline' =
        ann.type === 'rect' ? 'rect-frame' : 'underline';
      const t = await thoughtApi.createThought({
        type: thoughtType,
        resolved: false,
        pinned: false,
        color: ann.color,
        doc: {
          format: 'pm-doc-json',
          version: '0.1',
          payload: { type: 'doc', content: [{ type: 'paragraph' }] },
        },
        folderId: null,
        anchor: { source: 'book', resourceId: bookId, locator: bookLocator },
      });
      setAnnotations((prev) => [
        ...prev,
        {
          id: t.id,
          type: ann.type,
          color: ann.color,
          pageNum,
          rect: ann.rect,
          thoughtId: t.id,
        },
      ]);
    },
    [bookIdRef],
  );

  const remove = useCallback(
    async (id: string) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      const target = annotations.find((a) => a.id === id);
      if (target?.thoughtId) {
        const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
        await thoughtApi.deleteThought(target.thoughtId);
      } else {
        const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
        await lib.removeReadingThoughtBlock(bookId, id);
      }
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    },
    [bookIdRef, annotations],
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
