/**
 * FullscreenPageView — 全屏翻页式 PDF 渲染(EBookHost paged 分支)
 *
 * 与 FixedPageContent 的区别:
 * - FixedPageContent:滚动 + 虚拟化(view 主区,看大量页)
 * - FullscreenPageView:翻页(不滚动)+ 一次只 mount 1-2 个 canvas(沉浸阅读)
 *
 * 翻页动画策略(Preview / Books 同款,源自 commit 52ecc290):
 * - 双 spread 同时 mount 在 React 数组中(new + old),通过 transform translateX 滑动
 * - 翻页时先新建 spread DOM → renderer.renderPage 渲完 → 再启动 transition 动画
 *   ("先渲染再动画"消灭"白纸滑入"问题)
 * - next(向后):新 spread 原地立刻出现 + 旧 spread translateX 滑出屏幕左侧
 * - prev(向前):新 spread 从屏外左侧 translateX 滑入 + 旧 spread 静止(被遮挡)
 *
 * 关键不变量(干净的两状态):
 * - spread 节点永远 absolute 居中(transform: translate(-50%,-50%)),从不切定位
 * - 静止期容器内只 1 个 spread;动画期最多 2 个(old + new)
 *
 * 模型:
 * - layout='single':每次显示 1 页,翻页 currentPage ± 1
 * - layout='double':每次显示 2 页(spread = [n, n+1]),翻页 currentPage ± 2
 *   - page 1 起,spread 起点永远是奇数(1, 3, 5, ...)
 *
 * scale 计算:fit min(clientHeight / pageH, clientWidth / pageW) 取更小一边铺满
 *
 * V2 差异(对比 commit 52ecc290):
 * - 嵌 AnnotationLayer(命令式 DOM 路线不能嵌 React 子组件,改为 React state 驱动 spread)
 * - 透传 PDF 标注 4 个 prop(annotationMode / annotations / onCreate / onDelete)
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
import {
  AnnotationLayer,
  type PageAnnotation,
  type AnnotationDraft,
} from '../fixed-page-content/annotation-layer';

export type FullscreenPagedLayout = 'single' | 'double';

interface FullscreenPageViewProps {
  renderer: IFixedPageRenderer;
  layout: FullscreenPagedLayout;
  initialPage?: number | null;
  onPageChange: (page: number) => void;
  onScaleChange?: (scale: number) => void;
  /** 标注模式 — 同 FixedPageContent */
  annotationMode?: 'off' | 'rect' | 'underline';
  annotations?: PageAnnotation[];
  onAnnotationCreate?: (pageNum: number, annotation: AnnotationDraft) => void;
  onAnnotationDelete?: (id: string) => void;
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
const SLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function spreadStart(page: number, layout: FullscreenPagedLayout): number {
  if (layout === 'single') return page;
  return page % 2 === 0 ? page - 1 : page;
}

interface SpreadDescriptor {
  /** 唯一 key — 由 startPage + scale 拼成,React diff 用 */
  key: string;
  startPage: number;
  pages: number[];
  pageW: number;
  pageH: number;
}

function describeSpread(
  startPage: number,
  layout: FullscreenPagedLayout,
  totalPages: number,
  pageDims: PageDimension[],
  scale: number,
): SpreadDescriptor {
  const pages =
    layout === 'single'
      ? [startPage]
      : startPage + 1 <= totalPages
        ? [startPage, startPage + 1]
        : [startPage];
  const dim = pageDims[Math.min(startPage - 1, pageDims.length - 1)];
  const pageW = Math.floor(dim.width * scale);
  const pageH = Math.floor(dim.height * scale);
  return {
    key: `${pages.join('-')}@${scale.toFixed(4)}`,
    startPage,
    pages,
    pageW,
    pageH,
  };
}

/** 渲染单个 spread 的内部组件 — canvas / textLayer 命令式渲,标注层 React */
function Spread({
  descriptor,
  renderer,
  scale,
  annotationMode,
  annotations,
  onAnnotationCreate,
  onAnnotationDelete,
  onRendered,
  nodeRef,
}: {
  descriptor: SpreadDescriptor;
  renderer: IFixedPageRenderer;
  scale: number;
  annotationMode: 'off' | 'rect' | 'underline';
  annotations: PageAnnotation[];
  onAnnotationCreate?: (pageNum: number, annotation: AnnotationDraft) => void;
  onAnnotationDelete?: (id: string) => void;
  /** 像素就位时回调(给 animateTransition 用)*/
  onRendered?: () => void;
  /** 把 spread 根 DOM 暴露给父组件(动画期需要直接操作 transform)*/
  nodeRef: (el: HTMLDivElement | null) => void;
}) {
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const onRenderedRef = useRef(onRendered);
  useEffect(() => {
    onRenderedRef.current = onRendered;
  }, [onRendered]);

  useEffect(() => {
    let cancelled = false;
    const renderPromises = descriptor.pages.map((p) => {
      const canvas = canvasRefs.current.get(p);
      if (!canvas) return Promise.resolve();
      return renderer.renderPage(p, canvas, scale);
    });
    void Promise.all(renderPromises).then(() => {
      if (cancelled) return;
      // text layer 异步但不阻塞像素就位
      descriptor.pages.forEach((p) => {
        const tl = textLayerRefs.current.get(p);
        if (tl) void renderer.renderTextLayer(p, tl, scale);
      });
      onRenderedRef.current?.();
    });
    return () => {
      cancelled = true;
    };
  }, [descriptor.key, descriptor.pages, renderer, scale]);

  return (
    <div
      ref={nodeRef}
      className="krig-ebook-paged__spread"
      data-spread-key={descriptor.key}
    >
      {descriptor.pages.map((p) => {
        const dim = renderer.getPageDimensions()[p - 1];
        return (
          <div
            key={p}
            className="krig-ebook-paged__page-wrapper"
            data-page={p}
            style={{ width: descriptor.pageW, height: descriptor.pageH }}
          >
            <canvas
              ref={(el): void => {
                if (el) canvasRefs.current.set(p, el);
                else canvasRefs.current.delete(p);
              }}
            />
            <div
              className="textLayer"
              ref={(el): void => {
                if (el) textLayerRefs.current.set(p, el);
                else textLayerRefs.current.delete(p);
              }}
            />
            {dim && (
              <AnnotationLayer
                pageNum={p}
                scale={scale}
                pageWidth={dim.width}
                pageHeight={dim.height}
                mode={annotationMode}
                annotations={annotations.filter((a) => a.pageNum === p)}
                onAnnotationCreate={onAnnotationCreate ?? (() => {})}
                onAnnotationDelete={onAnnotationDelete ?? (() => {})}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export const FullscreenPageView = forwardRef<
  FullscreenPageViewHandle,
  FullscreenPageViewProps
>(function FullscreenPageView(
  {
    renderer,
    layout,
    initialPage,
    onPageChange,
    onScaleChange,
    annotationMode = 'off',
    annotations = [],
    onAnnotationCreate,
    onAnnotationDelete,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);

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

  // 动画进行中标志:静止 useEffect / state diff 在 animating 期跳过更新
  const animatingRef = useRef(false);

  /**
   * spreads 数组:
   * - 静止期长度 = 1(只 current)
   * - 动画期长度 = 2([old, new]) — old 留在底层/顶层做滑出/被遮,new 是目标
   * 动画结束后清回长度 1。
   */
  const [spreads, setSpreads] = useState<SpreadDescriptor[]>(() => {
    if (pageDims.length === 0) return [];
    return [describeSpread(spreadStart(currentPage, layout), layout, totalPages, pageDims, 1.0)];
  });

  // current spread 节点引用(动画结束清理 + transition 复位用)
  const spreadNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());

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

  // 计算最佳 scale(fit min(width, height))
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

  /**
   * 静止 useEffect:维护单 spread(currentPage + layout + scale 三元组)。
   * 动画期跳过(animatingRef.current)— animateTransition 接管节点生命周期。
   */
  useEffect(() => {
    if (animatingRef.current) return;
    if (pageDims.length === 0 || scale <= 0) return;
    const desc = describeSpread(
      spreadStart(currentPage, layout),
      layout,
      totalPages,
      pageDims,
      scale,
    );
    setSpreads((prev) => {
      if (prev.length === 1 && prev[0].key === desc.key) return prev;
      return [desc];
    });
  }, [currentPage, layout, scale, totalPages, pageDims]);

  // dominant page 推送给 host/view
  useEffect(() => {
    onPageChange(currentPage);
  }, [currentPage, onPageChange]);

  // ──────────────────────────────────────────────────────
  // 翻书动画:next = 旧滑出/新原地 · prev = 新滑入/旧静止
  // ──────────────────────────────────────────────────────
  const animateTransition = useCallback(
    (targetPage: number, direction: 'next' | 'prev'): void => {
      const container = containerRef.current;
      if (!container || pageDims.length === 0 || scale <= 0) {
        setCurrentPage(targetPage);
        return;
      }
      if (animatingRef.current) {
        // 已有动画在跑:短路到目标 — 简单可预测,避免堆积
        setCurrentPage(targetPage);
        return;
      }
      animatingRef.current = true;

      const newDesc = describeSpread(
        spreadStart(targetPage, layout),
        layout,
        totalPages,
        pageDims,
        scale,
      );

      // 1) spreads = [old, new] — React mount new spread,old 保留在 DOM 里做滑出
      setSpreads((prev) => {
        if (prev.length === 0) return [newDesc];
        const oldDesc = prev[prev.length - 1];
        if (oldDesc.key === newDesc.key) return prev;
        return [oldDesc, newDesc];
      });

      // 等下一帧 — 让 React mount new spread DOM 进 spreadNodesRef
      requestAnimationFrame(() => {
        const oldNode = spreadNodesRef.current.get(spreads[spreads.length - 1]?.key ?? '') ?? null;
        const newNode = spreadNodesRef.current.get(newDesc.key) ?? null;

        if (!newNode) {
          // mount 还没到 — 短路到目标(理论上 RAF 后已 mount,这里是防御)
          animatingRef.current = false;
          setCurrentPage(targetPage);
          setSpreads([newDesc]);
          return;
        }

        const offset = container.clientWidth + 100;

        // 1.5) 层级 + 起点
        if (direction === 'next') {
          if (oldNode) {
            oldNode.style.zIndex = '2';
            oldNode.style.willChange = 'transform';
          }
          newNode.style.zIndex = '1';
          // newNode 在中央(默认 transform translate(-50%,-50%)),被 oldNode 完全盖住,
          // 但先 visibility:hidden,渲染完成回 visible(canvas 像素在 hidden 期间仍渲)
          newNode.style.visibility = 'hidden';
        } else {
          if (oldNode) {
            oldNode.style.zIndex = '1';
          }
          newNode.style.zIndex = '2';
          newNode.style.willChange = 'transform';
          // prev:newNode 起点在屏外左侧 — 本身就不可见,无需额外隐藏
          newNode.style.transform = `translate(calc(-50% - ${offset}px), -50%)`;
        }

        // 2) 等像素就位再启动动画 — Spread.useEffect 渲完会调 onRendered
        const startSlide = (): void => {
          // next:像素就位,把 newNode 显出来 — oldNode 仍在上层挡住它
          if (direction === 'next') {
            newNode.style.visibility = '';
          }
          // 下一帧加 transition(避免初始 transform 也参与过渡)
          requestAnimationFrame(() => {
            if (direction === 'next') {
              if (oldNode) {
                oldNode.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASING}`;
                oldNode.style.transform = `translate(calc(-50% - ${offset}px), -50%)`;
              }
            } else {
              newNode.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASING}`;
              newNode.style.transform = 'translate(-50%, -50%)';
            }
            window.setTimeout(() => {
              // 清理:spreads 缩回单元素,清动画 inline style
              newNode.style.transition = '';
              newNode.style.willChange = '';
              newNode.style.zIndex = '';
              newNode.style.visibility = '';
              animatingRef.current = false;
              setSpreads([newDesc]);
              setCurrentPage(targetPage);
            }, SLIDE_MS + 30);
          });
        };

        // 像素就位检测:Spread 把 onRendered 设到 pendingRenderedRef
        // 简化路径:200ms 内 onRendered 触发即启动滑动;否则也启动(防 SDK 异常卡死)
        let started = false;
        const start = (): void => {
          if (started) return;
          started = true;
          startSlide();
        };
        pendingRenderedRef.current = start;
        window.setTimeout(start, 600); // 兜底:600ms 内必启动(单页渲一般 < 100ms)
      });
    },
    [layout, totalPages, pageDims, scale, spreads],
  );

  /** 新 spread Spread.useEffect 渲完会调这个 */
  const pendingRenderedRef = useRef<(() => void) | null>(null);
  const handleSpreadRendered = useCallback(() => {
    const cb = pendingRenderedRef.current;
    pendingRenderedRef.current = null;
    cb?.();
  }, []);

  // 命令式 API
  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(totalPages, page));
      const target = spreadStart(clamped, layout);
      if (target === currentPage) return;
      animateTransition(target, target > currentPage ? 'next' : 'prev');
    },
    [layout, totalPages, currentPage, animateTransition],
  );
  const nextPage = useCallback(() => {
    const step = layout === 'double' ? 2 : 1;
    const target = Math.min(spreadStart(currentPage + step, layout), totalPages);
    if (target === currentPage) return;
    animateTransition(target, 'next');
  }, [layout, totalPages, currentPage, animateTransition]);
  const prevPage = useCallback(() => {
    const step = layout === 'double' ? 2 : 1;
    const target = Math.max(spreadStart(currentPage - step, layout), 1);
    if (target === currentPage) return;
    animateTransition(target, 'prev');
  }, [layout, currentPage, animateTransition]);

  useImperativeHandle(ref, () => ({ goToPage, nextPage, prevPage }), [
    goToPage,
    nextPage,
    prevPage,
  ]);

  // ←/→ 键翻页
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // 焦点在输入框时让位
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
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

  return (
    <div className="krig-ebook-paged" ref={containerRef}>
      {spreads.map((desc, idx) => (
        <Spread
          key={desc.key}
          descriptor={desc}
          renderer={renderer}
          scale={scale}
          annotationMode={annotationMode}
          annotations={annotations}
          onAnnotationCreate={onAnnotationCreate}
          onAnnotationDelete={onAnnotationDelete}
          /* spreads[length-1] = 新 spread,渲完才触发动画启动 */
          onRendered={idx === spreads.length - 1 ? handleSpreadRendered : undefined}
          nodeRef={(el): void => {
            if (el) spreadNodesRef.current.set(desc.key, el);
            else spreadNodesRef.current.delete(desc.key);
          }}
        />
      ))}
    </div>
  );
});
