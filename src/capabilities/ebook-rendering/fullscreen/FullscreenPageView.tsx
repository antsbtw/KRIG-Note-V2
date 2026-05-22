/**
 * FullscreenPageView — 全屏翻页式 PDF 渲染(L2 overlay 专用)
 *
 * 与 FixedPageContent 的区别:
 * - FixedPageContent:滚动 + 虚拟化(view 主区,看大量页)
 * - FullscreenPageView:翻页(不滚动)+ 一次只 mount 1-2 个 canvas(沉浸阅读)
 *
 * 模型:
 * - layout='single':每次显示 1 页,翻页 currentPage ± 1
 * - layout='double':每次显示 2 页(spread = [n, n+1]),翻页 currentPage ± 2
 *   - 偶数页(2/4/6...)在左 + 奇数页(3/5...)在右;page 1 单独一对 [1, 2]
 *
 * scale 计算:
 * - single: fit (clientHeight | clientWidth) 取更小一边铺满
 * - double: (clientWidth - gap) / 2 算每页可用宽度;再和 clientHeight 取更小
 *
 * 标注 / 选区:v1 不挂 AnnotationLayer;v1.5 可在 page-wrapper 内字面挂回。
 *
 * DOM 数永远 ≤ 2,无虚拟化逻辑。
 */

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import type { IFixedPageRenderer, PageDimension } from '../types';

export type FullscreenPagedLayout = 'single' | 'double';

interface FullscreenPageViewProps {
  renderer: IFixedPageRenderer;
  layout: FullscreenPagedLayout;
  /** 初始页(由 panel 在 mount 后通过 ref.goToPage 触发 — props 仅用首次)*/
  initialPage?: number | null;
  /** 当前 dominant page 变化(双页时为 spread 起点) — panel 用作 toolbar 显示 */
  onPageChange: (page: number) => void;
  /** scale 变化(panel 用来 saveProgress) */
  onScaleChange?: (scale: number) => void;
}

/** 命令式 API — panel 通过 ref 翻页 / 直接跳页 */
export interface FullscreenPageViewHandle {
  goToPage(page: number): void;
  nextPage(): void;
  prevPage(): void;
}

const GAP_HORIZONTAL = 24; // 双页中缝
const PADDING = 32; // 容器留白(上下左右)

/** spread 起点页 — page 落到所在 spread 的首页;single 模式即页号本身 */
function spreadStart(page: number, layout: FullscreenPagedLayout): number {
  if (layout === 'single') return page;
  // [1,2], [3,4], [5,6], ... — page 为奇时即起点,偶时起点 = page - 1
  return page % 2 === 0 ? page - 1 : page;
}

export const FullscreenPageView = forwardRef<
  FullscreenPageViewHandle,
  FullscreenPageViewProps
>(function FullscreenPageView(
  { renderer, layout, initialPage, onPageChange, onScaleChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const leftTextRef = useRef<HTMLDivElement | null>(null);
  const rightTextRef = useRef<HTMLDivElement | null>(null);

  const totalPages = renderer.getTotalPages();
  const pageDims: PageDimension[] = useMemo(
    () => renderer.getPageDimensions(),
    [renderer],
  );

  const [currentPage, setCurrentPage] = useState<number>(() => {
    const p = initialPage && initialPage > 0 ? initialPage : 1;
    return spreadStart(Math.min(p, totalPages), layout);
  });
  const [scale, setScale] = useState(1.0);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // layout 切换时:把 currentPage 对齐到新 layout 的 spread 起点
  useEffect(() => {
    setCurrentPage((p) => spreadStart(p, layout));
  }, [layout]);

  // 监听容器尺寸(window resize + ResizeObserver,与 Host fit-width 同款)
  useEffect(() => {
    const handle = (): void => {
      const el = containerRef.current;
      if (!el) return;
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    };
    handle();
    window.addEventListener('resize', handle);
    let observer: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(handle);
      observer.observe(containerRef.current);
    }
    return () => {
      window.removeEventListener('resize', handle);
      observer?.disconnect();
    };
  }, []);

  // 计算最佳 scale(适应容器,两边都不超)
  useEffect(() => {
    if (pageDims.length === 0 || containerSize.w === 0 || containerSize.h === 0) return;
    const dim = pageDims[0];
    const availH = containerSize.h - PADDING * 2;
    let availW: number;
    if (layout === 'single') {
      availW = containerSize.w - PADDING * 2;
    } else {
      availW = (containerSize.w - PADDING * 2 - GAP_HORIZONTAL) / 2;
    }
    if (availW <= 0 || availH <= 0) return;
    const scaleW = availW / dim.width;
    const scaleH = availH / dim.height;
    const next = Math.min(scaleW, scaleH);
    if (!Number.isFinite(next) || next <= 0.1) return;
    if (Math.abs(next - scale) < 0.001) return;
    setScale(next);
    onScaleChange?.(next);
  }, [pageDims, containerSize, layout, scale, onScaleChange]);

  // 当前 spread 含哪两页(double)
  const visiblePages = useMemo(() => {
    const start = currentPage;
    if (layout === 'single') return [start];
    const second = start + 1;
    return second <= totalPages ? [start, second] : [start];
  }, [currentPage, layout, totalPages]);

  // 渲染当前 spread 页(scale / page 变化都重渲)
  useEffect(() => {
    if (scale <= 0 || pageDims.length === 0) return;
    visiblePages.forEach((p, idx) => {
      const canvas = idx === 0 ? leftCanvasRef.current : rightCanvasRef.current;
      const textEl = idx === 0 ? leftTextRef.current : rightTextRef.current;
      if (canvas) void renderer.renderPage(p, canvas, scale);
      if (textEl) void renderer.renderTextLayer(p, textEl, scale);
    });
  }, [visiblePages, scale, renderer, pageDims.length]);

  // dominant page 推送给 panel(spread 起点;single 即当前页)
  useEffect(() => {
    onPageChange(currentPage);
  }, [currentPage, onPageChange]);

  // 命令式 API — 翻页瞬切(对齐 Preview 真实行为,不做动画;
  // 动画方案见 git 历史,导致"内容消失→空白→淡入"闪烁体验差,回退)
  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(totalPages, page));
      setCurrentPage(spreadStart(clamped, layout));
    },
    [layout, totalPages],
  );
  const nextPage = useCallback(() => {
    const step = layout === 'double' ? 2 : 1;
    setCurrentPage((p) => Math.min(spreadStart(p + step, layout), totalPages));
  }, [layout, totalPages]);
  const prevPage = useCallback(() => {
    const step = layout === 'double' ? 2 : 1;
    setCurrentPage((p) => Math.max(spreadStart(p - step, layout), 1));
  }, [layout]);

  useImperativeHandle(ref, () => ({ goToPage, nextPage, prevPage }), [
    goToPage,
    nextPage,
    prevPage,
  ]);

  // ←/→ 键翻页(panel 内 keymap 也可接,这里挂底层兜底)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // 与 panel keymap 协调:reflowable EPUB 在 panel 里截了 ←/→,这里只对 fixed-page 生效
      // panel 在 PDF 路径不挂 ←/→,所以这里不会冲突
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevPage();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextPage();
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        prevPage();
      } else if (e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        nextPage();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prevPage, nextPage]);

  // 对齐 macOS Preview 翻页式模式:
  // - 双指横滑 / 纵滑 都翻"一屏"(spread):left/up → 下一屏;right/down → 上一屏
  // - 同一手势内只触发一次(trackpad 一次推动会发连续 wheel + 惯性事件,
  //   通过"事件间隔 > GESTURE_GAP_MS"判定新手势开始)
  // - preventDefault 阻止 Chromium 默认的 history back / overscroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let lastEventTime = 0;
    let firedInGesture = false;
    let accDelta = 0;
    const SWIPE_THRESHOLD = 30;
    const GESTURE_GAP_MS = 120;
    const handler = (e: WheelEvent): void => {
      e.preventDefault();
      const now = Date.now();
      // 新手势开始 — 间隔超阈值视为新手势
      if (now - lastEventTime > GESTURE_GAP_MS) {
        firedInGesture = false;
        accDelta = 0;
      }
      lastEventTime = now;
      if (firedInGesture) return; // 当前手势已触发,后续惯性事件全吞
      // 取主导轴:|deltaX| 与 |deltaY| 较大者为本次手势方向
      const dx = e.deltaX;
      const dy = e.deltaY;
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      accDelta += delta;
      if (Math.abs(accDelta) < SWIPE_THRESHOLD) return;
      // 正值(左滑 / 上滑)= 下一屏;负值(右滑 / 下滑)= 上一屏
      if (accDelta > 0) nextPage();
      else prevPage();
      firedInGesture = true;
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, [prevPage, nextPage]);

  if (pageDims.length === 0) {
    return <div className="krig-ebook-loading">Preparing pages...</div>;
  }

  const dim = pageDims[Math.min(currentPage - 1, pageDims.length - 1)];
  const pageW = Math.floor(dim.width * scale);
  const pageH = Math.floor(dim.height * scale);

  return (
    <div className="krig-ebook-paged" ref={containerRef}>
      <div
        className="krig-ebook-paged__spread"
        style={{ gap: layout === 'double' ? GAP_HORIZONTAL : 0 }}
      >
        {visiblePages.map((p, idx) => (
          <div
            key={p}
            className="krig-ebook-paged__page-wrapper"
            data-page={p}
            style={{ width: pageW, height: pageH }}
          >
            <canvas
              ref={(el): void => {
                if (idx === 0) leftCanvasRef.current = el;
                else rightCanvasRef.current = el;
              }}
            />
            <div
              className="textLayer"
              ref={(el): void => {
                if (idx === 0) leftTextRef.current = el;
                else rightTextRef.current = el;
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
