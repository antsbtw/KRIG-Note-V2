/**
 * useEpubAnnotation — EPUB 标注 hook(PR-α-3b followup 重写)
 *
 * 2026-05-25 用户拍板:EPUB 标注操作全面对齐 PDF α-2/α-3b 注册式右键菜单。
 * 废除自动弹 picker;创建路径解耦(高亮 / 加思考分开);单击 no-op(右键菜单接管)。
 *
 * 新数据流:
 *   ① 用户拖选文字 → host onTextSelected fired,但 hook 不暴露 selection state
 *      也不弹 picker(EpubAnnotationPicker 废除)。用户必须**右键**才出菜单。
 *   ② 右键 → EBookView 端调 contextMenuController.show 'ebook-view' viewId
 *      (走 L4 注册的 epub-context-menu-content.ts items)。
 *   ③ 菜单项命令调本 hook 的:
 *        createHighlight(cfi, text, type)  → 只落 legacy block(无 thought atom)
 *        createThought(cfi, text, type)    → 落 legacy + thought atom + 召唤右槽
 *        removeAnnotation(cfi)             → 删 legacy + thought + 移除高亮
 *        findByCfi(cfi)                    → 命令 handler 查关联 thought 用
 *
 * 双轨读保留(loadOnBookOpen):
 *   新数据(thoughtListBySource)+ 老数据(getReadingThoughtAnnotations),
 *   按 cfi 去重,host.addHighlight 重绘所有。
 */

import { useCallback, useRef, useState, useEffect } from 'react';
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

/** view 端字面 EPUB annotation 投影(支持新/老双源)*/
export interface EpubAnnotation {
  /** 显示用 id(去重 + key) — legacy createdAt 字符串 / thoughtId */
  id: string;
  cfi: string;
  color: string;
  textContent?: string;
  /** legacy block.bookAnchor.createdAt(legacy 删除路径用) */
  createdAt: number;
  /** v0.5 §16.3 新路径独有,删除时走 thoughtCapability.deleteThought */
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
    createdAt: anchor.createdAt,
  };
}

function toEpubAnnotationFromThought(t: ThoughtInfo): EpubAnnotation | null {
  if (!t.anchor || t.anchor.source !== 'book') return null;
  const loc = t.anchor.locator as BookLocator;
  if (loc.markStyle !== 'highlight') return null;
  if (!loc.cfi) return null;
  return {
    id: t.id,
    cfi: loc.cfi,
    color: THOUGHT_TYPE_META[t.type].color,
    textContent: loc.textContent,
    createdAt: loc.createdAt,
    thoughtId: t.id,
  };
}

export function useEpubAnnotation(
  hostRef: React.RefObject<EBookHostHandle | null>,
  bookIdRef: React.RefObject<string | null>,
) {
  const [annotations, setAnnotations] = useState<EpubAnnotation[]>([]);
  const annotationsRef = useRef(annotations);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  /**
   * PR-α-3b followup:订阅 note onListChanged 广播 — legacy block 任何改动
   * (addReadingThoughtBlock / remove / updateReadingThoughtBlockColor)都触发,
   * → loadOnBookOpen 重拉数据 + host.addHighlight 重绘所有高亮。
   * 对齐 use-pdf-annotations 的回流模式。
   */
  useEffect(() => {
    if (!window.electronAPI?.onNoteListChanged) return;
    const unsub = window.electronAPI.onNoteListChanged(() => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      void loadOnBookOpenRef.current?.(bookId);
    });
    return unsub;
  }, [bookIdRef]);
  // loadOnBookOpen 闭包 ref(避免 deps 循环;实际函数在下面声明)
  const loadOnBookOpenRef = useRef<((bookId: string) => Promise<void>) | null>(null);

  /**
   * 高亮(只落 legacy block,不创建 thought atom)。
   * 对齐 PDF α-3b createHighlight 路径 — 用户主动右键 💭 加思考才升级 thought。
   */
  const createHighlight = useCallback(
    async (cfi: string, text: string, type: ThoughtType): Promise<{ id: string } | null> => {
      const bookId = bookIdRef.current;
      const host = hostRef.current;
      if (!bookId || !host) return null;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const color = THOUGHT_TYPE_META[type].color;
      const createdAt = Date.now();
      const bookAnchor: BookAnchor = {
        pageNum: 0,
        cfi,
        textContent: text,
        color,
        type: 'highlight',
        createdAt,
      };
      await lib.addReadingThoughtBlock(bookId, {
        type: 'blockquote',
        bookAnchor,
        textContent: text,
      });
      await host.addHighlight(cfi, color);
      setAnnotations((prev) => [
        ...prev,
        { id: String(createdAt), cfi, color, textContent: text, createdAt },
      ]);
      return { id: String(createdAt) };
    },
    [bookIdRef, hostRef],
  );

  /**
   * 加思考(落 legacy block + 创建 thought atom + 召唤右槽 + activate)。
   * 对齐 PDF α-3b ebook-view.add-thought-from-annotation 命令路径。
   *
   * - 在 EPUB 选区上加思考:bookAnchor.createdAt 由本调用生成,落 legacy + thought atom
   * - 在 EPUB 已有标注上加思考(升级):existingCreatedAt 传入 legacy id,thought.anchor 关联现有 anchor
   */
  const createThought = useCallback(
    async (
      cfi: string,
      text: string,
      type: ThoughtType,
      existingCreatedAt?: number,
    ): Promise<{ thoughtId: string } | null> => {
      const bookId = bookIdRef.current;
      const host = hostRef.current;
      if (!bookId || !host) return null;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
      const color = THOUGHT_TYPE_META[type].color;
      const createdAt = existingCreatedAt ?? Date.now();
      const bookLocator: BookLocator = {
        pageNum: 0,
        cfi,
        textContent: text,
        markStyle: 'highlight',
        createdAt,
      };
      // 无 existingCreatedAt → 新选区高亮升级,先落 legacy block + host 高亮
      if (existingCreatedAt === undefined) {
        const bookAnchor: BookAnchor = {
          pageNum: 0,
          cfi,
          textContent: text,
          color,
          type: 'highlight',
          createdAt,
        };
        await lib.addReadingThoughtBlock(bookId, {
          type: 'blockquote',
          bookAnchor,
          textContent: text,
        });
        await host.addHighlight(cfi, color);
        setAnnotations((prev) => [
          ...prev,
          {
            id: String(createdAt),
            cfi,
            color,
            textContent: text,
            createdAt,
            thoughtId: undefined,
          },
        ]);
      }
      // 创 thought atom + anchor 关联 BookLocator
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
                content: text ? [{ type: 'text', text }] : undefined,
              },
            ],
          },
        },
        folderId: null,
        anchor: { source: 'book', resourceId: bookId, locator: bookLocator },
      });
      // 更新对应 annotation.thoughtId(已升级)
      setAnnotations((prev) =>
        prev.map((a) =>
          a.cfi === cfi ? { ...a, thoughtId: t.id, id: t.id } : a,
        ),
      );
      return { thoughtId: t.id };
    },
    [bookIdRef, hostRef],
  );

  /** 删除标注:删 legacy(可能 + thought) + 移除高亮 */
  const removeAnnotation = useCallback(
    async (cfi: string): Promise<void> => {
      const bookId = bookIdRef.current;
      const host = hostRef.current;
      if (!bookId || !host) return;
      const ann = annotationsRef.current.find((a) => a.cfi === cfi);
      if (!ann) return;
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      // 总删 legacy block(highlight 视觉来源)
      await lib.removeReadingThoughtBlock(bookId, String(ann.createdAt));
      // 若有关联 thought atom,也删
      if (ann.thoughtId) {
        const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
        await thoughtApi.deleteThought(ann.thoughtId);
      }
      host.removeHighlight(cfi);
      setAnnotations((prev) => prev.filter((a) => a.cfi !== cfi));
    },
    [bookIdRef, hostRef],
  );

  /** PR-α-3b followup:右键菜单命令 handler 查 annotation 用(cfi 反查) */
  const findByCfi = useCallback((cfi: string): EpubAnnotation | null => {
    return annotationsRef.current.find((a) => a.cfi === cfi) ?? null;
  }, []);

  /**
   * 旧 handleAnnotationClick 改 no-op — EPUB 单击标注不再删除(用户拍板对齐 PDF)。
   * 删除走右键菜单 🗑 删除标注;view 端仍传此回调给 Host(签名兼容),内部空函数。
   */
  const handleAnnotationClick = useCallback((_cfi: string) => {
    // no-op:单击 EPUB 标注不再触发删除;改走 L4 右键菜单 🗑 删除标注
  }, []);

  /**
   * 书加载后 / 数据变化广播后:重拉数据 + diff 重绘高亮。
   *
   * 关键修复(2026-05-25):foliate addAnnotation 是状态化的,删数据后若仅 add
   * 不 remove,foliate 内部仍持有旧 annotation → 视觉残留。删标注后回流到这里
   * 必须 diff: lastDrawn - newList = 待 removeHighlight cfis。
   */
  const lastDrawnCfisRef = useRef<Set<string>>(new Set());
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

      for (const t of newThoughts) {
        const ann = toEpubAnnotationFromThought(t);
        if (!ann) continue;
        if (seenCfi.has(ann.cfi)) continue;
        seenCfi.add(ann.cfi);
        list.push(ann);
      }
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
      // diff:上次画过但本次不在 list 的 cfi → removeHighlight
      const newCfis = new Set(list.map((a) => a.cfi));
      for (const cfi of lastDrawnCfisRef.current) {
        if (!newCfis.has(cfi)) host.removeHighlight(cfi);
      }
      // 当前列表全 add(foliate addAnnotation 同 cfi 第二次调是覆盖,无害)
      for (const ann of list) {
        await host.addHighlight(ann.cfi, ann.color);
      }
      lastDrawnCfisRef.current = newCfis;
    },
    [hostRef],
  );

  // 保存 loadOnBookOpen 到 ref 供 onNoteListChanged 调用
  useEffect(() => {
    loadOnBookOpenRef.current = loadOnBookOpen;
  }, [loadOnBookOpen]);

  return {
    annotations,
    createHighlight,
    createThought,
    removeAnnotation,
    findByCfi,
    handleAnnotationClick, // 保留(no-op),Host onEpubAnnotationClick 仍需绑(签名兼容)
    loadOnBookOpen,
  };
}
