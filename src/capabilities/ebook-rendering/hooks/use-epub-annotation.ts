/**
 * useEpubAnnotation — EPUB 标注 hook
 *
 * thought-view-port.md v0.5 §16.3 双轨实施(Phase 4):
 *   - **新建走 thought capability**(source='book', locator=BookAnchor)
 *   - **加载读双源**:新数据(thoughtListBySource('book',bookId))+ 老数据
 *     (ebook-library.getReadingThoughtAnnotations,legacy block)
 *   - 删除按 internal anchor 来源分支(有 thoughtId → thoughtDelete;否则老 path)
 *
 * 数据流(改造后):
 *   用户选色 → hook.createAnnotation(color) → thoughtCapability.createThought
 *     (type='highlight', color, anchor={source:'book', resourceId:bookId, locator:bookAnchor})
 *     + host.addHighlight(cfi, color) → 重渲高亮
 *   EPUB 内 click 已有标注 → hook.handleAnnotationClick(cfi) →
 *     - 若内部记录有 thoughtId → thoughtCapability.deleteThought(thoughtId)
 *     - 否则(legacy) → ebookLibrary.removeReadingThoughtBlock(bookId, legacyId)
 *     + host.removeHighlight(cfi)
 *
 * v0.5 §16.4 老数据迁移留独立 Phase 6,本 hook 期间保持兼容读。
 */

import { useState, useCallback, useRef, useEffect } from 'react';
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
import { THOUGHT_TYPE_META, type ThoughtType } from '@shared/ipc/thought-types';
import type { EBookHostHandle } from '../Host';

export interface EpubSelection {
  cfi: string;
  text: string;
  x: number;
  y: number;
}

/** view 端字面 EPUB annotation 投影(支持新/老双源)*/
interface EpubAnnotation {
  /** 显示用 id(去重 + key) — 老路径用 legacy createdAt 字符串,新路径用 thoughtId */
  id: string;
  cfi: string;
  color: string;
  textContent?: string;
  /** v0.5 §16.3 双轨:新路径独有,删除时走 thoughtCapability.deleteThought */
  thoughtId?: string;
}

function toEpubAnnotationFromLegacy(anchor: BookAnchor): EpubAnnotation | null {
  if (anchor.type !== 'highlight') return null;
  if (!anchor.cfi) return null;
  return {
    id: String(anchor.createdAt),
    cfi: anchor.cfi,
    color: anchor.color,
    textContent: anchor.textContent,
  };
}

function toEpubAnnotationFromThought(t: ThoughtInfo): EpubAnnotation | null {
  // 2026-05-24 拍板:type 不再含 'highlight';EPUB 选区高亮按 anchor.locator
  // markStyle='highlight' 识别(任意 ThoughtType 都可挂 EPUB 锚点)。
  if (!t.anchor || t.anchor.source !== 'book') return null;
  const loc = t.anchor.locator as BookLocator;
  if (loc.markStyle !== 'highlight') return null;
  if (!loc.cfi) return null;
  return {
    id: t.id,
    cfi: loc.cfi,
    color: THOUGHT_TYPE_META[t.type].color,
    textContent: loc.textContent,
    thoughtId: t.id,
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

  /** EPUB 内点击已有标注:删该标注 + 移除高亮 */
  const handleAnnotationClick = useCallback(
    async (cfi: string) => {
      const bookId = bookIdRef.current;
      const host = hostRef.current;
      if (!bookId || !host) return;
      const ann = annotationsRef.current.find((a) => a.cfi === cfi);
      if (!ann) return;
      if (ann.thoughtId) {
        // v0.5 §16.3 新路径
        const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
        await thoughtApi.deleteThought(ann.thoughtId);
      } else {
        // 老路径(legacy block)
        const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
        await lib.removeReadingThoughtBlock(bookId, ann.id);
      }
      host.removeHighlight(cfi);
      setAnnotations((prev) => prev.filter((a) => a.cfi !== cfi));
    },
    [bookIdRef, hostRef],
  );

  /**
   * 用户从 picker 选 type → 创建 EPUB 高亮(2026-05-24 拍板:5 type = 5 色)。
   * 颜色由 type 反查 META.color,EPUB host.addHighlight 字面用 META 色。
   */
  const createAnnotation = useCallback(
    async (type: ThoughtType) => {
      const bookId = bookIdRef.current;
      const host = hostRef.current;
      if (!selection || !bookId || !host) return;
      const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
      const color = THOUGHT_TYPE_META[type].color;
      const createdAt = Date.now();
      const bookLocator: BookLocator = {
        pageNum: 0,
        cfi: selection.cfi,
        textContent: selection.text,
        markStyle: 'highlight',
        createdAt,
      };
      try {
        const t = await thoughtApi.createThought({
          type,
          resolved: false,
          pinned: false,
          doc: {
            format: 'pm-doc-json',
            version: '0.1',
            payload: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: selection.text
                    ? [{ type: 'text', text: selection.text }]
                    : undefined,
                },
              ],
            },
          },
          folderId: null,
          anchor: { source: 'book', resourceId: bookId, locator: bookLocator },
        });
        await host.addHighlight(selection.cfi, color);
        setAnnotations((prev) => [
          ...prev,
          {
            id: t.id,
            cfi: selection.cfi,
            color,
            textContent: selection.text,
            thoughtId: t.id,
          },
        ]);
        setSelectionState(null);
      } catch (err) {
        console.warn('[useEpubAnnotation] createAnnotation failed:', err);
      }
    },
    [selection, bookIdRef, hostRef],
  );

  /**
   * 书加载后:拿全部 EPUB annotation(新 + 老双源,按 cfi 去重)+ 重绘高亮。
   * v0.5 §16.3 双轨:新数据优先(同 cfi 时不再渲老高亮覆盖)。
   */
  const loadOnBookOpen = useCallback(
    async (bookId: string) => {
      const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const host = hostRef.current;

      const [newThoughts, legacyAnchors] = await Promise.all([
        thoughtApi.listThoughtsBySource('book', bookId),
        lib.getReadingThoughtAnnotations(bookId),
      ]);

      const list: EpubAnnotation[] = [];
      const seenCfi = new Set<string>();

      // 新数据(优先 — discriminated union 收窄:必 anchor.source='book' + locator.cfi 非空)
      for (const t of newThoughts) {
        const ann = toEpubAnnotationFromThought(t);
        if (!ann) continue;
        if (seenCfi.has(ann.cfi)) continue;
        seenCfi.add(ann.cfi);
        list.push(ann);
      }
      // 老数据(同 cfi 跳过 — 新建路径已迁,Phase 6 迁移后老 path 清空)
      for (const a of legacyAnchors) {
        const ann = toEpubAnnotationFromLegacy(a);
        if (!ann) continue;
        if (seenCfi.has(ann.cfi)) continue;
        seenCfi.add(ann.cfi);
        list.push(ann);
      }
      setAnnotations(list);

      if (!host) return;
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
