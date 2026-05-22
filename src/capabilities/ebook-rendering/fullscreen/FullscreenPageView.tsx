/**
 * FullscreenPageView — 全屏翻页式 PDF 渲染(L2 overlay 专用)
 *
 * 与 FixedPageContent 的区别:
 * - FixedPageContent:滚动 + 虚拟化(view 主区,看大量页)
 * - FullscreenPageView:翻页(不滚动)+ 一次只 mount 1-2 个 canvas(沉浸阅读)
 *
 * 翻页动画策略(Preview / Books 同款):
 * - 命令式 DOM 操作 — React 只管 state,spread 节点由本组件直接 appendChild / remove
 * - 翻页时新建 spread DOM → renderer.renderPage 渲完 → 再启动 transition 动画
 *   ("先渲染再动画" 完全消灭旧实现的"白纸"问题)
 * - next(向后):新 spread 原地立刻出现 + 旧 spread translateX 滑出屏幕左侧
 * - prev(向前):新 spread 从屏外左侧 translateX 滑入 + 旧 spread 静止(被遮挡)
 *
 * 模型:
 * - layout='single':每次显示 1 页,翻页 currentPage ± 1
 * - layout='double':每次显示 2 页(spread = [n, n+1]),翻页 currentPage ± 2
 *   - page 1 起,spread 起点永远是奇数(1, 3, 5, ...)
 *
 * scale 计算:fit (clientHeight | clientWidth) 取更小一边铺满
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
  initialPage?: number | null;
  onPageChange: (page: number) => void;
  onScaleChange?: (scale: number) => void;
}

export interface FullscreenPageViewHandle {
  goToPage(page: number): void;
  nextPage(): void;
  prevPage(): void;
}

const GAP_HORIZONTAL = 24;
const PADDING = 32;
const SLIDE_MS = 1500;
// 翻页曲线 — easeOutQuint(Apple Books / iOS 翻页同款):
//   开头快速启动 + 末尾长尾衰减,符合"手推书页"的物理直觉
// 其他可选:
//   'cubic-bezier(0.4, 0, 0.2, 1)' — Material 标准(头尾对称,机械感强)
//   'cubic-bezier(0.25, 0.1, 0.25, 1)' — CSS 标准 ease(中庸)
//   'cubic-bezier(0.16, 1, 0.3, 1)'   — 强 ease-out(弹簧感)
const SLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function spreadStart(page: number, layout: FullscreenPagedLayout): number {
  if (layout === 'single') return page;
  return page % 2 === 0 ? page - 1 : page;
}

/** 创建一个 spread DOM 节点 — 永远 absolute 居中,不参与父 flex 布局 */
function createSpreadNode(
  pages: number[],
  pageW: number,
  pageH: number,
  gap: number,
): { node: HTMLDivElement; canvases: HTMLCanvasElement[]; textLayers: HTMLDivElement[] } {
  const node = document.createElement('div');
  node.className = 'krig-ebook-paged__spread';
  // absolute 居中 — 静止/动画 都用这套定位,从不切换
  node.style.position = 'absolute';
  node.style.left = '50%';
  node.style.top = '50%';
  node.style.transform = 'translate(-50%, -50%)';
  node.style.display = 'flex';
  node.style.flexDirection = 'row';
  node.style.alignItems = 'center';
  node.style.justifyContent = 'center';
  node.style.gap = `${gap}px`;
  const canvases: HTMLCanvasElement[] = [];
  const textLayers: HTMLDivElement[] = [];
  pages.forEach((p) => {
    const wrap = document.createElement('div');
    wrap.className = 'krig-ebook-paged__page-wrapper';
    wrap.style.width = `${pageW}px`;
    wrap.style.height = `${pageH}px`;
    wrap.dataset.page = String(p);
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    canvases.push(canvas);
    const tl = document.createElement('div');
    tl.className = 'textLayer';
    wrap.appendChild(tl);
    textLayers.push(tl);
    node.appendChild(wrap);
  });
  return { node, canvases, textLayers };
}

export const FullscreenPageView = forwardRef<
  FullscreenPageViewHandle,
  FullscreenPageViewProps
>(function FullscreenPageView(
  { renderer, layout, initialPage, onPageChange, onScaleChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 当前主 spread 节点(命令式管理)
  const currentNodeRef = useRef<HTMLDivElement | null>(null);
  // 翻页动画进行中标志 — 同时只允许一个动画
  const animatingRef = useRef(false);

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

  // 监听容器尺寸
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

  // 计算最佳 scale
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

  // 静态渲染当前 spread(无动画):mount 初次 / scale 变 / layout 变 / window resize
  // 动画进行中跳过 — 节点完全由 animateTransition 接管,避免双 source of truth
  useEffect(() => {
    const container = containerRef.current;
    if (!container || pageDims.length === 0 || scale <= 0) return;
    if (animatingRef.current) return;
    const pages = layout === 'single'
      ? [currentPage]
      : currentPage + 1 <= totalPages ? [currentPage, currentPage + 1] : [currentPage];
    const dim = pageDims[Math.min(currentPage - 1, pageDims.length - 1)];
    const pageW = Math.floor(dim.width * scale);
    const pageH = Math.floor(dim.height * scale);
    const expectedPages = pages.join(',');
    const existing = currentNodeRef.current;
    if (existing && existing.dataset.pages === expectedPages && existing.dataset.scale === String(scale)) {
      return; // 已是目标 spread,不动
    }
    // 清空 container 内所有节点(防御:不留任何残留)
    container.innerHTML = '';
    const { node, canvases, textLayers } = createSpreadNode(pages, pageW, pageH, layout === 'double' ? GAP_HORIZONTAL : 0);
    node.dataset.pages = expectedPages;
    node.dataset.scale = String(scale);
    container.appendChild(node);
    currentNodeRef.current = node;
    pages.forEach((p, idx) => {
      void renderer.renderPage(p, canvases[idx], scale);
      void renderer.renderTextLayer(p, textLayers[idx], scale);
    });
  }, [currentPage, layout, scale, totalPages, pageDims, renderer]);

  // unmount 清理:移除所有 spread 节点
  useEffect(() => {
    return () => {
      const container = containerRef.current;
      if (container) container.innerHTML = '';
      currentNodeRef.current = null;
    };
  }, []);

  // dominant page 推送给 panel
  useEffect(() => {
    onPageChange(currentPage);
  }, [currentPage, onPageChange]);

  // ──────────────────────────────────────────────────────
  // 翻书动画:next = 旧滑出/新原地 · prev = 新滑入/旧静止
  // ──────────────────────────────────────────────────────
  const animateTransition = useCallback(
    async (targetPage: number, direction: 'next' | 'prev'): Promise<void> => {
      const container = containerRef.current;
      const oldNode = currentNodeRef.current;
      if (!container || !oldNode || pageDims.length === 0 || scale <= 0) {
        setCurrentPage(targetPage);
        return;
      }
      if (animatingRef.current) {
        // 已有动画在跑:直接 short-circuit 跳到目标(避免堆积)
        setCurrentPage(targetPage);
        return;
      }
      animatingRef.current = true;

      // 1) 创建新 spread 节点 — createSpreadNode 默认已 absolute 居中(transform: -50%,-50%)
      const pages = layout === 'single'
        ? [targetPage]
        : targetPage + 1 <= totalPages ? [targetPage, targetPage + 1] : [targetPage];
      const dim = pageDims[Math.min(targetPage - 1, pageDims.length - 1)];
      const pageW = Math.floor(dim.width * scale);
      const pageH = Math.floor(dim.height * scale);
      const { node: newNode, canvases, textLayers } = createSpreadNode(
        pages, pageW, pageH, layout === 'double' ? GAP_HORIZONTAL : 0,
      );
      newNode.dataset.pages = pages.join(',');
      newNode.dataset.scale = String(scale);

      // 1.5) **先**确定层级 — 防止 newNode 在 oldNode 上方意外显形(根因:渲染期间用户看到闪屏)
      //   next:newNode 在底层(1),oldNode 在顶层(2)从上面滑走露出 newNode
      //   prev:oldNode 在底层(1),newNode 在顶层(2)从屏外滑入盖住 oldNode
      const offset = container.clientWidth + 100;
      if (direction === 'next') {
        oldNode.style.zIndex = '2';
        oldNode.style.willChange = 'transform';
        newNode.style.zIndex = '1';
        // newNode 在中央(默认 transform),被 oldNode 完全盖住 — 但先 visibility:hidden,
        // 直到渲染完成再 visible(canvas 在 hidden 期间仍可渲染像素,只是不显示)
        newNode.style.visibility = 'hidden';
      } else {
        oldNode.style.zIndex = '1';
        newNode.style.zIndex = '2';
        newNode.style.willChange = 'transform';
        // prev:newNode 起点在屏外左侧 — 本身就不可见,无需额外隐藏
        newNode.style.transform = `translate(calc(-50% - ${offset}px), -50%)`;
      }
      container.appendChild(newNode);

      // 2) 后台渲染新 spread 像素(newNode 当前要么被遮 要么在屏外,渲染期间不可见)
      await Promise.all(
        pages.map((p, idx) => renderer.renderPage(p, canvases[idx], scale)),
      );
      pages.forEach((p, idx) => {
        void renderer.renderTextLayer(p, textLayers[idx], scale);
      });

      // 2.5) next:像素就位,把 newNode 显出来 — 此时 oldNode 在上层挡住它,用户仍看到旧页面
      if (direction === 'next') {
        newNode.style.visibility = '';
      }

      // 4) 启动 transform 动画(下一帧才加 transition,避免初始 transform 也参与过渡)
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          if (direction === 'next') {
            oldNode.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASING}`;
            oldNode.style.transform = `translate(calc(-50% - ${offset}px), -50%)`;
          } else {
            newNode.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASING}`;
            newNode.style.transform = 'translate(-50%, -50%)';
          }
          setTimeout(resolve, SLIDE_MS + 30);
        });
      });

      // 5) 清理:移除旧 node + 重置 newNode 动画相关 inline style
      // (createSpreadNode 默认 transform/position 保留,只清动画期 zIndex / transition / willChange)
      if (oldNode.parentNode === container) container.removeChild(oldNode);
      newNode.style.transition = '';
      newNode.style.willChange = '';
      newNode.style.zIndex = '';
      currentNodeRef.current = newNode;
      animatingRef.current = false;

      // 6) 更新 React state — 静态 useEffect 看到 dataset 匹配会跳过重建
      setCurrentPage(targetPage);
    },
    [layout, totalPages, pageDims, scale, renderer],
  );

  // 命令式 API
  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(totalPages, page));
      const target = spreadStart(clamped, layout);
      if (target === currentPage) return;
      void animateTransition(target, target > currentPage ? 'next' : 'prev');
    },
    [layout, totalPages, currentPage, animateTransition],
  );
  const nextPage = useCallback(() => {
    const step = layout === 'double' ? 2 : 1;
    const target = Math.min(spreadStart(currentPage + step, layout), totalPages);
    if (target === currentPage) return;
    void animateTransition(target, 'next');
  }, [layout, totalPages, currentPage, animateTransition]);
  const prevPage = useCallback(() => {
    const step = layout === 'double' ? 2 : 1;
    const target = Math.max(spreadStart(currentPage - step, layout), 1);
    if (target === currentPage) return;
    void animateTransition(target, 'prev');
  }, [layout, currentPage, animateTransition]);

  useImperativeHandle(ref, () => ({ goToPage, nextPage, prevPage }), [
    goToPage,
    nextPage,
    prevPage,
  ]);

  // ←/→ 键翻页
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
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

  // trackpad 双指滑动翻页(横纵均接,同手势内只翻一屏)
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
      if (now - lastEventTime > GESTURE_GAP_MS) {
        firedInGesture = false;
        accDelta = 0;
      }
      lastEventTime = now;
      if (firedInGesture) return;
      const dx = e.deltaX;
      const dy = e.deltaY;
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      accDelta += delta;
      if (Math.abs(accDelta) < SWIPE_THRESHOLD) return;
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

  // JSX 只渲染 container — spread 节点由命令式 DOM 操作维护
  return <div className="krig-ebook-paged" ref={containerRef} />;
});
