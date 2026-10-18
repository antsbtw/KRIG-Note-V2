/**
 * usePdfAnnotations — PDF 空间标注 view 端协调 hook
 *
 * 2026-05-25 拍板架构(handoff §α-3b 修订):
 *   - **高亮 = 纯视觉标记**:框选 ▢ / 文字流 ✎(highlight/strikethrough)都走
 *     legacy reading-thought-block 路径(`lib.addReadingThoughtBlock`),
 *     **不创建独立的用户 thought atom**
 *   - 用户右键 💭 加思考 才创建 thought atom + anchor 关联到 highlight(legacy 路径)
 *   - 颜色由 BookAnchor.color 字段反查 5 色 picker(legacy 已含 color 字段)
 *   - markStyle 字面区分视觉:rect / underline / highlight / strikethrough
 *
 * 数据源(只读 legacy,不读 thought atoms — 用户拍板"老 thought atom 数据当空"):
 *   refreshForBook → lib.getReadingThoughtAnnotations → BookAnchor[] → PageAnnotation[]
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
  PageAnnotation,
  EBookHostHandle,
  PdfTextSelectionEvent,
} from '@capabilities/ebook-rendering/types';
import {
  THOUGHT_TYPE_META,
  thoughtTypeByColor,
  type ThoughtType,
} from '@shared/ipc/thought-types';

export type AnnotationMode = 'off' | 'rect';

/** ThoughtType 反查 color(默认 'thought' 蓝)— legacy BookAnchor.color 字段映射 */
function colorOf(type: ThoughtType): string {
  return THOUGHT_TYPE_META[type].color;
}

/** color 反查 ThoughtType(legacy 数据反序列化用)— 找不到回退 'thought'(仅影响方框显示色) */
function thoughtTypeOf(color: string): ThoughtType {
  return thoughtTypeByColor(color) ?? 'thought';
}

function toPageAnnotationFromLegacy(anchor: BookAnchor): PageAnnotation | null {
  if (anchor.pageNum <= 0) return null;
  // 4 种 markStyle 都支持:rect/underline 必须有 rect;
  // highlight/strikethrough 至少 rect 或 textRects 之一
  const hasRect = !!anchor.rect;
  const hasTextRects = !!anchor.textRects && anchor.textRects.length > 0;
  if (!hasRect && !hasTextRects) return null;
  return {
    id: String(anchor.createdAt),
    markStyle: anchor.type,
    thoughtType: thoughtTypeOf(anchor.color),
    pageNum: anchor.pageNum,
    rect: anchor.rect ?? { x: 0, y: 0, w: 0, h: 0 },
    textRects: anchor.textRects,
  };
}

export function usePdfAnnotations(
  bookIdRef: React.RefObject<string | null>,
  hostRef: React.RefObject<EBookHostHandle | null>,
) {
  const [annotations, setAnnotations] = useState<PageAnnotation[]>([]);
  const [mode, setMode] = useState<AnnotationMode>('off');
  /**
   * scroll-to-source 跳转后短暂高亮的标注 id(= bookAnchor.createdAt 字符串)。
   * CSS 动画 ~1.5s 后清空。
   */
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const flash = useCallback((id: string) => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    setFlashId(id);
    flashTimerRef.current = window.setTimeout(() => {
      setFlashId(null);
      flashTimerRef.current = null;
    }, 1600);
  }, []);

  /**
   * 按当前书 bookId 重新拉数据(只读 legacy reading-thought-block 路径)。
   * loadOnBookOpen 与 onNoteListChanged 广播(reading thought atom 内容变)都走此函数。
   */
  const refreshForBook = useCallback(async (bookId: string) => {
    const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    const legacyAnchors = await lib.getReadingThoughtAnnotations(bookId);
    const list: PageAnnotation[] = [];
    for (const a of legacyAnchors) {
      const item = toPageAnnotationFromLegacy(a);
      if (item) list.push(item);
    }
    setAnnotations(list);
  }, []);

  const loadOnBookOpen = refreshForBook;

  /**
   * 订阅 note onListChanged 广播 — legacy addReadingThoughtBlock / remove / updateColor
   * 都会触发 broadcastNoteListChanged → refreshForBook 拉最新数据(类型改 / 删 / 加都同步)。
   * 本地乐观 setAnnotations 立刻反馈;广播 ~tens ms 后到达再次刷新(幂等覆盖)。
   */
  useEffect(() => {
    if (!window.electronAPI?.onNoteListChanged) return;
    const unsub = window.electronAPI.onNoteListChanged(() => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      void refreshForBook(bookId);
    });
    return unsub;
  }, [bookIdRef, refreshForBook]);

  /**
   * 创建框选 PDF 标注(▢ 模式 / rect 类型)→ 截图(2x DPR 高清)→
   *   落 legacy reading-thought-block(image attrs.bookAnchor)。
   *
   * 关键:**不创建独立 thought atom**(handoff §α-3b 拍板),只落 reading thought PM block。
   */
  const create = useCallback(
    async (
      pageNum: number,
      ann: Omit<PageAnnotation, 'id' | 'pageNum'>,
    ): Promise<{ id: string } | null> => {
      const bookId = bookIdRef.current;
      if (!bookId) return null;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');

      // 先画方框、后截图落库(2026-10-17 用户:框选后 1s 以上才响应)。
      // 原先「整页 2x 渲染截图 → JPEG 编码 → IPC 落库」串行跑完才 setAnnotations,
      // 用户松手后要干等全程。现在乐观先显示,后台补;落库失败撤掉方框并报错(不静默)。
      const createdAt = Date.now();
      const id = String(createdAt);
      setAnnotations((prev) => [
        ...prev,
        {
          id,
          markStyle: ann.markStyle,
          thoughtType: ann.thoughtType,
          pageNum,
          rect: ann.rect,
          textRects: ann.textRects,
        },
      ]);

      // 让出一帧再截图:整页 2x 渲染在主线程同步跑几百 ms,不让它把方框那一帧堵在后面
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

      // 截屏(失败仍允许创建,thumbnail 留空)
      let thumbnail: string | undefined;
      try {
        thumbnail = await hostRef.current?.capturePageRect(pageNum, ann.rect);
      } catch (err) {
        console.warn('[pdf-annotations] capturePageRect failed:', err);
      }

      const bookAnchor: BookAnchor = {
        pageNum,
        rect: ann.rect,
        textRects: ann.textRects,
        thumbnail,
        color: colorOf(ann.thoughtType),
        type: ann.markStyle,
        createdAt,
      };
      try {
        await lib.addReadingThoughtBlock(bookId, {
          type: 'image',
          bookAnchor,
          src: thumbnail,
        });
      } catch (err) {
        console.error('[pdf-annotations] 标注落库失败,撤掉方框:', err);
        setAnnotations((prev) => prev.filter((a) => a.id !== id));
        return null;
      }
      return { id: String(createdAt) };
    },
    [bookIdRef, hostRef],
  );

  /**
   * 文字流标注(✎ highlight / strikethrough)→ 落 legacy blockquote block + textRects。
   * 同 create:不创建 thought atom;无截图(文字流不需要)。
   */
  const createFromTextSelection = useCallback(
    async (
      ev: PdfTextSelectionEvent,
      thoughtType: ThoughtType,
      markStyle: 'highlight' | 'strikethrough',
    ): Promise<{ id: string } | null> => {
      const bookId = bookIdRef.current;
      if (!bookId) return null;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');

      const createdAt = Date.now();
      const bookAnchor: BookAnchor = {
        pageNum: ev.pageNum,
        rect: ev.boundingRect,
        textRects: ev.textRects,
        textContent: ev.textContent,
        color: colorOf(thoughtType),
        type: markStyle,
        createdAt,
      };
      await lib.addReadingThoughtBlock(bookId, {
        type: 'blockquote',
        bookAnchor,
        textContent: ev.textContent,
      });
      setAnnotations((prev) => [
        ...prev,
        {
          id: String(createdAt),
          markStyle,
          thoughtType,
          pageNum: ev.pageNum,
          rect: ev.boundingRect,
          textRects: ev.textRects,
        },
      ]);
      return { id: String(createdAt) };
    },
    [bookIdRef],
  );

  const remove = useCallback(
    async (id: string) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      // 先去掉方框、后台落库(同 create:写库 ≈1.7s,不让用户干等)。
      // 失败不静默:报错 + 按库里真实数据重拉,方框会回来。
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      try {
        // id = bookAnchor.createdAt 字面串(legacy 删除 key)
        await lib.removeReadingThoughtBlock(bookId, id);
      } catch (err) {
        console.error('[pdf-annotations] 删除标注落库失败,按库重拉:', err);
        void refreshForBook(bookId);
      }
    },
    [bookIdRef, refreshForBook],
  );

  return {
    annotations,
    mode,
    setMode,
    loadOnBookOpen,
    create,
    createFromTextSelection,
    remove,
    flashId,
    flash,
  };
}
