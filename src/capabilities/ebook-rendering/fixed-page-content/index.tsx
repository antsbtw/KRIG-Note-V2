/**
 * FixedPageContent — 固定页面格式的连续滚动渲染器(L5-C2 + C5 标注层)
 *
 * V1 → V2 改写:src/plugins/ebook/components/FixedPageContent.tsx(317 行)。
 * 保留:DOM 虚拟化 + Canvas 渲染 + Text Layer + Cmd+/-/0 缩放 + 滚轮缩放。
 * C5 加:每页挂 AnnotationLayer(rect/underline 标注)。
 *
 * DOM 虚拟化:只创建可见区域 ± DOM_BUFFER 页的 DOM 元素,其余用 spacer div 占位。
 * 大幅减少 DOM 节点数量(几百页 PDF 也只挂载十几个 DOM 节点)。
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { IFixedPageRenderer, PageDimension } from '../types';
import {
  AnnotationLayer,
  type PageAnnotation,
  type AnnotationDraft,
} from './annotation-layer';

interface FixedPageContentProps {
  renderer: IFixedPageRenderer;
  scale: number;
  initialPage?: number | null;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  /** 注册跳转回调,view 端通过此回调命令式跳转到指定页 */
  onRegisterGotoPage: (fn: (page: number) => void) => void;
  /** 标注模式(C5):'off' / 'rect' — 2026-05-24 删 underline */
  annotationMode?: 'off' | 'rect';
  /** scroll-to-source 跳转后短暂高亮的标注 id(透传给每个 AnnotationLayer) */
  flashAnnotationId?: string | null;
  /** 已有标注(按页过滤后整体传入,内部按 pageNum 分发)*/
  annotations?: PageAnnotation[];
  /** 创建标注:layer 仅传草稿(type/color/rect),pageNum 由 layer 注入,id 由 main 生成 */
  onAnnotationCreate?: (pageNum: number, annotation: AnnotationDraft) => void;
  /** 删除标注 */
  onAnnotationDelete?: (id: string) => void;
}

const PAGE_GAP = 8;
const PADDING_TOP = 16;
const DOM_BUFFER = 5;

export function FixedPageContent({
  renderer,
  scale,
  initialPage,
  onPageChange,
  onScaleChange,
  onRegisterGotoPage,
  annotationMode = 'off',
  annotations = [],
  flashAnnotationId = null,
  onAnnotationCreate,
  onAnnotationDelete,
}: FixedPageContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefsRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const [pageDimensions, setPageDimensions] = useState<PageDimension[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  // 每次 domRange 变化导致 DOM 重建时递增,强制触发渲染 effect
  const [domGeneration, setDomGeneration] = useState(0);
  const totalPages = renderer.getTotalPages();

  // 加载页面尺寸
  useEffect(() => {
    setPageDimensions(renderer.getPageDimensions());
  }, [renderer]);

  // 预计算每页的 Y 偏移(scale=1 下,乘以 scale 即可得到实际偏移)
  const pageOffsets = useMemo(() => {
    const offsets: number[] = [];
    let y = PADDING_TOP;
    for (const dim of pageDimensions) {
      offsets.push(y);
      y += dim.height + PAGE_GAP;
    }
    return offsets;
  }, [pageDimensions]);

  // 总高度
  const totalHeight = useMemo(() => {
    if (pageDimensions.length === 0) return 0;
    const last = pageOffsets[pageOffsets.length - 1];
    const lastH = pageDimensions[pageDimensions.length - 1].height;
    return (last + lastH + PADDING_TOP) * scale;
  }, [pageDimensions, pageOffsets, scale]);

  // 根据 scrollTop 计算当前可见页范围(二分查找首页 + 线性扫到底)
  const getVisibleRange = useCallback(() => {
    const container = containerRef.current;
    if (!container || pageDimensions.length === 0) return { first: 1, last: 1 };

    const scrollTop = container.scrollTop / scale;
    const viewHeight = container.clientHeight / scale;
    const scrollBottom = scrollTop + viewHeight;

    let first = 1;
    let last = 1;

    let lo = 0;
    let hi = pageDimensions.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const pageBottom = pageOffsets[mid] + pageDimensions[mid].height;
      if (pageBottom < scrollTop) lo = mid + 1;
      else hi = mid - 1;
    }
    first = lo + 1;

    for (let i = lo; i < pageDimensions.length; i++) {
      if (pageOffsets[i] > scrollBottom) break;
      last = i + 1;
    }

    return { first: Math.max(1, first), last: Math.min(totalPages, last) };
  }, [pageDimensions, pageOffsets, scale, totalPages]);

  // 滚动 → 当前页(取占可视区域最多的页面,而非第一个可见页)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || pageDimensions.length === 0) return;

    let rafId = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const { first, last } = getVisibleRange();
        let dominant = first;
        if (last > first && pageDimensions.length > 0) {
          const viewTop = container.scrollTop / scale;
          const viewBottom = viewTop + container.clientHeight / scale;
          let maxVisible = 0;
          for (let p = first; p <= last; p++) {
            const idx = p - 1;
            if (idx < 0 || idx >= pageOffsets.length) continue;
            const pTop = pageOffsets[idx];
            const pBottom = pTop + pageDimensions[idx].height;
            const visibleTop = Math.max(pTop, viewTop);
            const visibleBottom = Math.min(pBottom, viewBottom);
            const visible = Math.max(0, visibleBottom - visibleTop);
            if (visible > maxVisible) {
              maxVisible = visible;
              dominant = p;
            }
          }
        }
        setCurrentPage(dominant);
        onPageChange(dominant);
      });
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // 初始触发

    return () => {
      container.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  }, [pageDimensions, getVisibleRange, onPageChange, scale, pageOffsets]);

  // DOM 渲染范围(可见页 ± DOM_BUFFER)
  const domRange = useMemo(() => {
    const first = Math.max(1, currentPage - DOM_BUFFER);
    const screenPageCount =
      pageDimensions[0]?.height && scale
        ? Math.ceil(
            (containerRef.current?.clientHeight ?? 800) / (pageDimensions[0].height * scale),
          )
        : 1;
    const last = Math.min(totalPages, currentPage + DOM_BUFFER + screenPageCount);
    return { first, last };
  }, [currentPage, totalPages, pageDimensions, scale]);

  // domRange 变化 → 递增 generation,触发渲染 effect 重新跑
  const prevDomRangeRef = useRef({ first: 0, last: 0 });
  useEffect(() => {
    const prev = prevDomRangeRef.current;
    if (prev.first !== domRange.first || prev.last !== domRange.last) {
      prevDomRangeRef.current = domRange;
      setDomGeneration((g) => g + 1);
    }
  }, [domRange]);

  // 渲染可见页面的 canvas + text layer
  useEffect(() => {
    if (pageDimensions.length === 0) return;

    const { first, last } = getVisibleRange();
    const renderFirst = Math.max(1, first - 1);
    const renderLast = Math.min(totalPages, last + 1);

    for (let pageNum = renderFirst; pageNum <= renderLast; pageNum++) {
      const canvas = pageRefsRef.current.get(pageNum);
      if (canvas) {
        void renderer.renderPage(pageNum, canvas, scale);
      }
      const textDiv = textLayerRefsRef.current.get(pageNum);
      if (textDiv) {
        void renderer.renderTextLayer(pageNum, textDiv, scale);
      }
    }
  }, [
    currentPage,
    scale,
    pageDimensions,
    totalPages,
    renderer,
    getVisibleRange,
    domGeneration,
  ]);

  /**
   * 滚动到指定页 — 返回 boolean 报告是否真的执行了 scroll。
   * 失败原因(容器未挂载 / pageOffsets 还没算)→ 上层 retry。
   *
   * 2026-05-24 修跳源 bug:scroll-to-source 触发 ebookCap.open,EBookView 重新
   * load PDF → FixedPageContent 重 mount → containerRef 在新 mount 周期内
   * 短暂 null;上层 tryScroll 只看 hostRef.current 不够,必须看 scrollToPage 是否
   * 真正执行(boolean 反馈)。
   */
  const scrollToPage = useCallback(
    (pageNum: number): boolean => {
      const container = containerRef.current;
      if (!container || pageOffsets.length === 0) return false;
      const idx = Math.max(0, Math.min(pageNum - 1, pageOffsets.length - 1));
      container.scrollTo({ top: pageOffsets[idx] * scale });
      return true;
    },
    [pageOffsets, scale],
  );

  // 注册跳转回调
  useEffect(() => {
    onRegisterGotoPage(scrollToPage);
  }, [scrollToPage, onRegisterGotoPage]);

  // 首次加载恢复阅读位置
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !initialPage || pageDimensions.length === 0) return;
    restoredRef.current = true;
    requestAnimationFrame(() => scrollToPage(initialPage));
  }, [initialPage, pageDimensions, scrollToPage]);

  // 键盘缩放(Cmd+= / Cmd+- / Cmd+0)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        onScaleChange(Math.min(scale + 0.25, 3.0));
      } else if (e.key === '-') {
        e.preventDefault();
        onScaleChange(Math.max(scale - 0.25, 0.25));
      } else if (e.key === '0') {
        e.preventDefault();
        onScaleChange(1.0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [scale, onScaleChange]);

  // Ctrl/Cmd + 滚轮缩放
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: WheelEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const next = Math.max(0.25, Math.min(3.0, scale + delta));
      onScaleChange(Math.round(next * 100) / 100);
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, [scale, onScaleChange]);

  if (pageDimensions.length === 0) {
    return <div className="krig-ebook-loading">Preparing pages...</div>;
  }

  // 计算 spacer 高度
  const topSpacerHeight =
    domRange.first > 1 ? pageOffsets[domRange.first - 1] * scale : 0;

  // L5-C6 修:domRange.last 是 1-based 页码,pageDimensions 是 0-indexed 数组,
  // 用 [last] 实际是访问 last+1 页的元素 — 当 PDF 加载未完成 / 边界场景下越界 undefined,
  // 访问 .height 整树崩(无 ErrorBoundary 直接白屏)。加 guard 防御。
  const lastPageIdx = domRange.last; // 注:domRange.last 是已渲染最后页的 1-based 编号,这里取下一页索引
  const lastDim = pageDimensions[lastPageIdx];
  const bottomSpacerStart =
    domRange.last < totalPages && lastDim
      ? (pageOffsets[lastPageIdx] + lastDim.height) * scale + PAGE_GAP
      : totalHeight;

  return (
    <div className="krig-ebook-content" ref={containerRef}>
      <div className="krig-ebook-content__pages" style={{ minHeight: totalHeight }}>
        {/* 顶部占位 */}
        {topSpacerHeight > 0 && (
          <div style={{ height: topSpacerHeight, flexShrink: 0 }} />
        )}

        {/* 只渲染 domRange 范围内的页面 */}
        {pageDimensions.slice(domRange.first - 1, domRange.last).map((dim, idx) => {
          const pageNum = domRange.first + idx;
          const w = Math.floor(dim.width * scale);
          const h = Math.floor(dim.height * scale);

          return (
            <div
              key={pageNum}
              className="krig-ebook-content__page-wrapper"
              data-page={pageNum}
              style={{ width: w, height: h }}
            >
              <canvas
                ref={(el): void => {
                  if (el) pageRefsRef.current.set(pageNum, el);
                  else pageRefsRef.current.delete(pageNum);
                }}
              />
              <div
                className="textLayer"
                ref={(el): void => {
                  if (el) textLayerRefsRef.current.set(pageNum, el);
                  else textLayerRefsRef.current.delete(pageNum);
                }}
              />
              {/* C5:空间标注覆盖层 */}
              <AnnotationLayer
                pageNum={pageNum}
                scale={scale}
                pageWidth={dim.width}
                pageHeight={dim.height}
                mode={annotationMode}
                annotations={annotations.filter((a) => a.pageNum === pageNum)}
                flashAnnotationId={flashAnnotationId}
                onAnnotationCreate={onAnnotationCreate ?? (() => {})}
                onAnnotationDelete={onAnnotationDelete ?? (() => {})}
              />
            </div>
          );
        })}

        {/* 底部占位 */}
        {bottomSpacerStart < totalHeight && (
          <div style={{ height: totalHeight - bottomSpacerStart, flexShrink: 0 }} />
        )}
      </div>
    </div>
  );
}
