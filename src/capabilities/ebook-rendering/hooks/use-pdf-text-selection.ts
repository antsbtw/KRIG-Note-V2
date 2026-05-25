/**
 * usePdfTextSelection — PDF textLayer 选区 → emit { pageNum, textRects, textContent }
 *
 * PR-α-3 文字流高亮基础:
 * - 监听 window mouseup(textLayer 内拖完鼠标 → window.getSelection() 拿 Range)
 * - 找 Range 命中的 textLayer DOM(commonAncestorContainer 向上查 closest('.textLayer'))
 * - 算 textRects(range.getClientRects 减 textLayer container BCR,除 scale)
 * - 限单页:Range 跨多个 textLayer 时不 emit(picker 弹不下)
 * - 选区为空 / collapsed → 不 emit
 *
 * 架构定位(handoff §α-3 路径偏移说明):
 * - 选区监听是浏览器 DOM 事件(window mouseup + window.getSelection),
 *   不需要 PDFRenderer 的 PDF 知识 — 走 view 层 hook 而非 renderer 内部
 * - rendering capability 跨 FixedPageContent / FullscreenPageView 复用
 *
 * 不监听 EPUB selectionchange / mousedown — 仅在 PDF textLayer 内的 mouseup 才有意义。
 */

import { useEffect } from 'react';

export interface PdfTextSelectionEvent {
  /** 选区命中的页码(1-based)*/
  pageNum: number;
  /** 选区文本(用于查词/翻译 + 存 BookLocator.textContent)*/
  textContent: string;
  /** 每行一个 rect(scale=1 坐标,逻辑像素)*/
  textRects: Array<{ x: number; y: number; w: number; h: number }>;
  /** 选区 boundingRect(scale=1)— AnnotationLayer 兜底渲染 */
  boundingRect: { x: number; y: number; w: number; h: number };
  /**
   * picker 定位锚点(屏幕坐标 viewport-relative,px)— 已含 scale 与 layer offset,
   * view 端直接用 position: fixed 渲染。指向选区下边缘中点。
   */
  screenAnchor: { x: number; y: number };
}

/**
 * 给一组 textLayer container(per page)挂 mouseup 监听,选区命中后 emit。
 *
 * @param textLayerByPage  pageNum → textLayer container DOM(同 FixedPageContent
 *   的 textLayerRefsRef.current Map)。读时取 .current 的 Map snapshot。
 * @param scale            当前 PDF render scale(用于把 DOM px 还原到 scale=1 坐标)
 * @param onSelected       选区命中回调
 */
export function usePdfTextSelection(
  textLayerByPage: React.RefObject<Map<number, HTMLElement>>,
  scale: number,
  onSelected: ((ev: PdfTextSelectionEvent) => void) | undefined,
): void {
  useEffect(() => {
    if (!onSelected) return;
    const handler = (e: MouseEvent): void => {
      // 仅左键拖完触发(右键 / 中键忽略)
      if (e.button !== 0) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const text = range.toString().trim();
      if (!text) return;

      // 找命中的 textLayer container(若 commonAncestor 不在任何 textLayer 内 → 不是 PDF 选区)
      const ancestor =
        range.commonAncestorContainer.nodeType === 3
          ? range.commonAncestorContainer.parentElement
          : (range.commonAncestorContainer as Element | null);
      const layer = ancestor?.closest('.textLayer') as HTMLElement | null;
      if (!layer) return;

      // 反查 pageNum:layer 与 ref Map 比对
      const map = textLayerByPage.current;
      if (!map) return;
      let pageNum: number | null = null;
      for (const [pn, el] of map) {
        if (el === layer) {
          pageNum = pn;
          break;
        }
      }
      if (pageNum == null) return;

      // 限单页:Range 端点都必须在同一 textLayer 内,否则不 emit(picker 弹不下)
      const startLayer = (
        range.startContainer.nodeType === 3
          ? range.startContainer.parentElement
          : (range.startContainer as Element | null)
      )?.closest('.textLayer');
      const endLayer = (
        range.endContainer.nodeType === 3
          ? range.endContainer.parentElement
          : (range.endContainer as Element | null)
      )?.closest('.textLayer');
      if (startLayer !== layer || endLayer !== layer) return;

      // 算 textRects + boundingRect — 减 layer.getBoundingClientRect 偏移,除 scale
      const layerBounds = layer.getBoundingClientRect();
      const domRects = Array.from(range.getClientRects());
      const textRects = domRects
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({
          x: (r.left - layerBounds.left) / scale,
          y: (r.top - layerBounds.top) / scale,
          w: r.width / scale,
          h: r.height / scale,
        }));
      if (textRects.length === 0) return;

      const bRange = range.getBoundingClientRect();
      const boundingRect = {
        x: (bRange.left - layerBounds.left) / scale,
        y: (bRange.top - layerBounds.top) / scale,
        w: bRange.width / scale,
        h: bRange.height / scale,
      };

      // picker 屏幕锚点(viewport 坐标,选区底部居中)
      const screenAnchor = {
        x: bRange.left + bRange.width / 2,
        y: bRange.bottom,
      };

      onSelected({
        pageNum,
        textContent: text,
        textRects,
        boundingRect,
        screenAnchor,
      });
    };

    window.addEventListener('mouseup', handler);
    return () => window.removeEventListener('mouseup', handler);
  }, [textLayerByPage, scale, onSelected]);
}
