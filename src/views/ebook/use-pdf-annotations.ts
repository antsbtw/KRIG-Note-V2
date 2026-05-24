/**
 * usePdfAnnotations — PDF 空间标注 view 端协调 hook
 *
 * 2026-05-24 拍板架构:
 *   - 5 色 picker 字面 = 5 种 ThoughtType(thought/important/question/todo/analysis)
 *   - 颜色由 type 反查 THOUGHT_TYPE_META.color(单一真相源,不再有 ann.color 字段)
 *   - markStyle (rect|underline) 字面区分 PDF 视觉形态,非 thought 语义类型
 *   - 创建时走 capturePageRect 截图存 BookLocator.thumbnail(2x DPR 高清,JPEG)
 *   - 双向同步:type 改 → annotation div 颜色随 onListChanged 回流自动跟变
 *
 * 加载读双源(v0.5 §16.3 旧逻辑保留):新数据(thoughtListBySource)+ 老
 *   lib.getReadingThoughtAnnotations,按 createdAt 去重(同 ts 跳过老 path)。
 *
 * 不和 use-epub-annotation 合并 — PDF 空间锚点 vs EPUB CFI 锚点结构不同。
 */

import { useState, useCallback, useEffect, useRef } from 'react';
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
import type {
  PageAnnotation,
  EBookHostHandle,
} from '@capabilities/ebook-rendering/types';

export type AnnotationMode = 'off' | 'rect';

/** 内部 PageAnnotation 扩展(承担 thoughtId 区分新/老路径) */
interface PdfAnnotationItem extends PageAnnotation {
  /** v0.5 §16.3 新路径独有,删除时走 thoughtCapability.deleteThought */
  thoughtId?: string;
}

function toPageAnnotationFromLegacy(anchor: BookAnchor): PdfAnnotationItem | null {
  if (anchor.pageNum <= 0) return null;
  if (!anchor.rect) return null;
  if (anchor.type !== 'rect' && anchor.type !== 'underline') return null;
  // 老数据无 thoughtType 概念,字面退化映射到默认 'thought'(蓝)。
  // D-11 后这条 path 仅向后兼容存量,不主动新建。
  return {
    id: String(anchor.createdAt),
    markStyle: anchor.type,
    thoughtType: 'thought',
    pageNum: anchor.pageNum,
    rect: anchor.rect,
  };
}

function toPageAnnotationFromThought(t: ThoughtInfo): PdfAnnotationItem | null {
  if (!t.anchor || t.anchor.source !== 'book') return null;
  const loc = t.anchor.locator as BookLocator;
  if (loc.markStyle !== 'rect' && loc.markStyle !== 'underline') return null;
  if (loc.pageNum <= 0 || !loc.rect) return null;
  return {
    id: t.id,
    markStyle: loc.markStyle,
    thoughtType: t.type,
    pageNum: loc.pageNum,
    rect: loc.rect,
    thoughtId: t.id,
  };
}

export function usePdfAnnotations(
  bookIdRef: React.RefObject<string | null>,
  hostRef: React.RefObject<EBookHostHandle | null>,
) {
  const [annotations, setAnnotations] = useState<PdfAnnotationItem[]>([]);
  const [mode, setMode] = useState<AnnotationMode>('off');
  /**
   * scroll-to-source 跳转后短暂高亮的标注 id(annotation id == thoughtId,
   * 走 PdfAnnotationItem.thoughtId 字段查)。CSS 动画 ~1.5s 后清空。
   */
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const flash = useCallback((thoughtId: string) => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    setFlashId(thoughtId);
    flashTimerRef.current = window.setTimeout(() => {
      setFlashId(null);
      flashTimerRef.current = null;
    }, 1600);
  }, []);

  /**
   * 按当前书 bookId 重新拉数据 + 刷新 annotations(新源 thought 优先 + 老 legacy 兜底)。
   * loadOnBookOpen 与 onListChanged 回流都走这个函数。
   */
  const refreshForBook = useCallback(async (bookId: string) => {
    const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
    const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');

    const [newThoughts, legacyAnchors] = await Promise.all([
      thoughtApi.listThoughtsBySource('book', bookId),
      lib.getReadingThoughtAnnotations(bookId),
    ]);

    const list: PdfAnnotationItem[] = [];
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

  const loadOnBookOpen = refreshForBook;

  /**
   * 双向同步:订阅 thought capability onListChanged 广播 → 重拉本书 thought →
   *   - type 改:list 重建后 div 颜色随 thoughtType 反查 META 自动跟变
   *   - thought 删:从 ThoughtView 卡片 🗑 / 从 PDF 标注右键 都触发广播 → list 重建去掉
   *   - 其他 view 新增本书 thought:同步显示(场景少,顺手覆盖)
   *
   * 注意:用户在本 hook 内通过 create/remove 触发的本地 setAnnotations 乐观更新
   * 仍保留(用户瞬时反馈),onListChanged 广播 ~tens ms 后到达再次刷新(幂等覆盖)。
   */
  useEffect(() => {
    const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
    const unsub = thoughtApi.onListChanged(() => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      void refreshForBook(bookId);
    });
    return unsub;
  }, [bookIdRef, refreshForBook]);

  /**
   * 创建 PDF 标注 → 截图(2x DPR 高清)→ 落 thought atom + thoughtOf 边 + 回流 view state。
   *
   * 流程:
   *   1. ebook-rendering.capturePageRect(pageNum, rect) → JPEG dataUrl
   *   2. thoughtApi.createThought({ type, anchor.locator.thumbnail })
   *   3. setAnnotations 本地乐观更新(用户立刻看到色块)
   *
   * 返回 `{ thoughtId }` 给调用方触发后续 UI(开右槽 ThoughtView / 弹浮卡)。
   */
  const create = useCallback(
    async (
      pageNum: number,
      ann: Omit<PageAnnotation, 'id' | 'pageNum'>,
    ): Promise<{ thoughtId: string } | null> => {
      const bookId = bookIdRef.current;
      if (!bookId) return null;
      const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');

      // 截屏(失败仍允许创建,thumbnail 留空)
      let thumbnail: string | undefined;
      try {
        thumbnail = await hostRef.current?.capturePageRect(pageNum, ann.rect);
      } catch (err) {
        console.warn('[pdf-annotations] capturePageRect failed:', err);
      }

      const createdAt = Date.now();
      const bookLocator: BookLocator = {
        pageNum,
        rect: ann.rect,
        markStyle: ann.markStyle,
        thumbnail,
        createdAt,
      };
      const t = await thoughtApi.createThought({
        type: ann.thoughtType,
        resolved: false,
        pinned: false,
        thumbnail,
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
          markStyle: ann.markStyle,
          thoughtType: ann.thoughtType,
          pageNum,
          rect: ann.rect,
          thoughtId: t.id,
        },
      ]);
      return { thoughtId: t.id };
    },
    [bookIdRef, hostRef],
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
    flashId,
    flash,
  };
}
