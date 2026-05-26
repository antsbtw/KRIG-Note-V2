/**
 * FullscreenPageView — 全屏翻页式 PDF 渲染(EBookHost paged 分支)
 *
 * 字面对齐 commit 52ecc290 实现 — 命令式 DOM 管理 spread 节点。
 * 与原 commit 唯一差异:AnnotationLayer 通过 React createRoot 挂到 page-wrapper
 * (V2 sub-phase 022 后 PDF 路径多了空间标注层,需要嵌 React 组件)。
 *
 * 翻页动画策略(Preview / Books 同款):
 * - 命令式 DOM 操作 — React 只管 state,spread 节点由本组件直接 appendChild / remove
 * - 翻页时新建 spread DOM → renderer.renderPage 渲完 → 再启动 transition 动画
 *   ("先渲染再动画" 完全消灭旧实现的"白纸"问题)
 * - next(向后):新 spread 原地立刻出现 + 旧 spread translateX 滑出屏幕左侧
 * - prev(向前):新 spread 从屏外左侧 translateX 滑入 + 旧 spread 静止(被遮挡)
 *
 * 关键不变量(干净的两状态):
 * - spread 节点永远 absolute 居中(transform: translate(-50%,-50%)),
 *   从不切 position/left/top — 静止/动画期间均同一定位语义
 * - 容器内同时最多 2 个子节点(old + new),静止时只 1 个
 * - 静态 useEffect 在 animatingRef.current 期间完全 noop,避免双 source of truth
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
  createElement,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { IFixedPageRenderer, PageDimension } from '../types';
import {
  AnnotationLayer,
  type PageAnnotation,
  type AnnotationDraft,
} from '../annotation-layer';
import { usePdfTextSelection } from '../hooks/use-pdf-text-selection';

export type FullscreenPagedLayout = 'single' | 'double';

interface FullscreenPageViewProps {
  renderer: IFixedPageRenderer;
  layout: FullscreenPagedLayout;
  initialPage?: number | null;
  onPageChange: (page: number) => void;
  onScaleChange?: (scale: number) => void;
  /** 标注 props — V2 sub-phase 022 后 PDF 全屏期保留标注;2026-05-24 删 underline */
  annotationMode?: 'off' | 'rect';
  annotations?: PageAnnotation[];
  onAnnotationCreate?: (pageNum: number, annotation: AnnotationDraft) => void;
  /** PR-α-3:textLayer 选区触发 — view 端弹 picker */
  onTextSelected?: (
    ev: import('../hooks/use-pdf-text-selection').PdfTextSelectionEvent,
  ) => void;
  /**
   * textLayer 异步渲染完成回调(pdf-vocab-highlight 2026-05-25 加)。
   * 主区 + 全屏共用契约;view 端用于扫 textLayer span 给 vocab 命中词画高亮。
   */
  onTextLayerRendered?: (pageNum: number, textLayer: HTMLElement) => void;
}

export interface FullscreenPageViewHandle {
  goToPage(page: number): void;
  nextPage(): void;
  prevPage(): void;
}

const GAP_HORIZONTAL = 24;
const PADDING = 32;
const SLIDE_MS = 1000;
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

interface SpreadHandle {
  node: HTMLDivElement;
  canvases: HTMLCanvasElement[];
  textLayers: HTMLDivElement[];
  /** spread 内对应的页号(与 textLayers 同顺序;PR-α-3 textLayer Map 同步用)*/
  pages: number[];
  /** 每页一个 React root,挂 AnnotationLayer;destroy 时 unmount */
  annotationRoots: Array<{ root: Root; pageNum: number }>;
}

/**
 * 创建一个 spread DOM 节点 — 永远 absolute 居中,不参与父 flex 布局。
 * 每个 page-wrapper 内额外用 createRoot 挂 AnnotationLayer(V2 额外加,
 * 原 52ecc290 没这层)。
 */
function createSpreadNode(
  pages: number[],
  _pageW: number,
  _pageH: number,
  gap: number,
  pageDims: PageDimension[],
  scale: number,
  annotationMode: 'off' | 'rect',
  annotations: PageAnnotation[],
  onAnnotationCreate: ((pageNum: number, ann: AnnotationDraft) => void) | undefined,
): SpreadHandle {
  // 注:pageW / pageH 参数已废弃(2026-05-25 修双页 spread 各页 dim 不同的错位 bug);
  // 每个 page wrap 字面按自己页的 dim 算 width/height,canvas / textLayer / wrap 三者
  // 同 dim 派生,sub-pixel 对齐(不会 page 1 高 page 2 矮 → wrap 强拉高一致 → textLayer
  // span y 错位的问题)。保留参数签名供 caller 不动,实际不消费。
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
  const annotationRoots: Array<{ root: Root; pageNum: number }> = [];
  pages.forEach((p) => {
    // 关键修复:每页字面按自己的 dim 算 wrap 尺寸,不再共用 page 1 的 dim
    // 2026-05-25 修选区偏移 bug:wrap 不 floor,与 viewport.width(dim.width * scale,
    // 浮点)精确一致 — textLayer 内 span 按 viewport 浮点 x 坐标排版,wrap floor 到整数
    // 时 span 累积误差会向右偏(scale 越大累积越明显;选区视觉跟字形错位)。
    const pageDim = pageDims[p - 1];
    if (!pageDim) return;
    const pageWidth = pageDim.width * scale;
    const pageHeight = pageDim.height * scale;
    const wrap = document.createElement('div');
    wrap.className = 'krig-ebook-paged__page-wrapper';
    wrap.style.position = 'relative';
    wrap.style.width = `${pageWidth}px`;
    wrap.style.height = `${pageHeight}px`;
    wrap.dataset.page = String(p);
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    canvases.push(canvas);
    const tl = document.createElement('div');
    tl.className = 'textLayer';
    wrap.appendChild(tl);
    textLayers.push(tl);
    // AnnotationLayer 挂载点
    const annHost = document.createElement('div');
    annHost.className = 'krig-ebook-paged__annotation-host';
    wrap.appendChild(annHost);
    const root = createRoot(annHost);
    root.render(
      createElement(AnnotationLayer, {
        pageNum: p,
        scale,
        pageWidth: pageDim.width,
        pageHeight: pageDim.height,
        mode: annotationMode,
        annotations: annotations.filter((a) => a.pageNum === p),
        onAnnotationCreate: onAnnotationCreate ?? ((): void => {}),
      }),
    );
    annotationRoots.push({ root, pageNum: p });
    node.appendChild(wrap);
  });
  return { node, canvases, textLayers, pages: pages.slice(), annotationRoots };
}

/**
 * PR-α-3:用 spread handle 重建 textLayer Map(pageNum → textLayer DOM)
 *
 * 在 currentSpreadRef 切换后调,让 usePdfTextSelection hook 能定位选区命中的 pageNum。
 * 调时一次性 clear 再填,旧 spread 的 textLayer DOM 已被 destroySpread 移除。
 */
function syncTextLayerMap(
  map: Map<number, HTMLElement>,
  handle: SpreadHandle | null,
): void {
  map.clear();
  if (!handle) return;
  handle.pages.forEach((p, idx) => {
    const tl = handle.textLayers[idx];
    if (tl) map.set(p, tl);
  });
}

/** 销毁 spread — unmount 所有 annotation root,然后从 DOM 移除节点 */
function destroySpread(handle: SpreadHandle): void {
  handle.annotationRoots.forEach(({ root }) => {
    // 异步 unmount 避免 "synchronously unmount during render" 警告
    queueMicrotask(() => root.unmount());
  });
  if (handle.node.parentNode) {
    handle.node.parentNode.removeChild(handle.node);
  }
}

/** 重渲 spread 的 AnnotationLayer(annotations / mode / scale 变化时调) */
function updateSpreadAnnotations(
  handle: SpreadHandle,
  pageDims: PageDimension[],
  scale: number,
  annotationMode: 'off' | 'rect',
  annotations: PageAnnotation[],
  onAnnotationCreate: ((pageNum: number, ann: AnnotationDraft) => void) | undefined,
): void {
  handle.annotationRoots.forEach(({ root, pageNum }) => {
    const dim = pageDims[pageNum - 1];
    if (!dim) return;
    root.render(
      createElement(AnnotationLayer, {
        pageNum,
        scale,
        pageWidth: dim.width,
        pageHeight: dim.height,
        mode: annotationMode,
        annotations: annotations.filter((a) => a.pageNum === pageNum),
        onAnnotationCreate: onAnnotationCreate ?? ((): void => {}),
      }),
    );
  });
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
    onTextSelected,
    onTextLayerRendered,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 当前主 spread 节点(命令式管理)
  const currentSpreadRef = useRef<SpreadHandle | null>(null);
  // PR-α-3:textLayer DOM Map(pageNum → DOM)— spread 创建/销毁时同步,
  // usePdfTextSelection hook 读此 ref 探测选区命中页
  const textLayerByPageRef = useRef<Map<number, HTMLElement>>(new Map());
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

  // PR-α-3:textLayer 选区监听(走 textLayerByPageRef 反查 pageNum)
  usePdfTextSelection(textLayerByPageRef, scale, onTextSelected);

  // 标注相关 props 走 ref — createSpreadNode 闭包内拿最新值,避免静态 useEffect
  // 把整个 spread 重建一遍
  const annotationModeRef = useRef(annotationMode);
  const annotationsRef = useRef(annotations);
  const onAnnotationCreateRef = useRef(onAnnotationCreate);
  useEffect(() => {
    annotationModeRef.current = annotationMode;
    annotationsRef.current = annotations;
    onAnnotationCreateRef.current = onAnnotationCreate;
    // 标注 props 变化 → 重渲当前 spread 的 AnnotationLayer(不重建 spread)
    const cur = currentSpreadRef.current;
    if (cur) {
      updateSpreadAnnotations(
        cur,
        pageDims,
        scale,
        annotationMode,
        annotations,
        onAnnotationCreate,
      );
    }
  }, [annotationMode, annotations, onAnnotationCreate, pageDims, scale]);

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
    const existing = currentSpreadRef.current;
    if (
      existing &&
      existing.node.dataset.pages === expectedPages &&
      existing.node.dataset.scale === String(scale)
    ) {
      return; // 已是目标 spread,不动
    }
    // 销毁旧 spread(含 React root unmount)
    if (existing) destroySpread(existing);
    // 清空 container 内任何残留(防御:理论上 destroySpread 已移除节点)
    container.innerHTML = '';
    const handle = createSpreadNode(
      pages,
      pageW,
      pageH,
      layout === 'double' ? GAP_HORIZONTAL : 0,
      pageDims,
      scale,
      annotationModeRef.current,
      annotationsRef.current,
      onAnnotationCreateRef.current,
    );
    handle.node.dataset.pages = expectedPages;
    handle.node.dataset.scale = String(scale);
    container.appendChild(handle.node);
    currentSpreadRef.current = handle;
    syncTextLayerMap(textLayerByPageRef.current, handle);
    pages.forEach((p, idx) => {
      void renderer.renderPage(p, handle.canvases[idx], scale);
      const tl = handle.textLayers[idx];
      void renderer.renderTextLayer(p, tl, scale).then(() => {
        // 防御:spread 已被切走 / unmount 后回调
        if (currentSpreadRef.current?.textLayers[idx] === tl) {
          onTextLayerRendered?.(p, tl);
        }
      });
    });
  }, [currentPage, layout, scale, totalPages, pageDims, renderer, onTextLayerRendered]);

  // unmount 清理:移除所有 spread 节点 + unmount React root
  useEffect(() => {
    return () => {
      const cur = currentSpreadRef.current;
      if (cur) destroySpread(cur);
      currentSpreadRef.current = null;
      syncTextLayerMap(textLayerByPageRef.current, null);
      const container = containerRef.current;
      if (container) container.innerHTML = '';
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
      const oldHandle = currentSpreadRef.current;
      if (!container || !oldHandle || pageDims.length === 0 || scale <= 0) {
        setCurrentPage(targetPage);
        return;
      }
      if (animatingRef.current) {
        // 已有动画在跑:直接 short-circuit 跳到目标(避免堆积)
        setCurrentPage(targetPage);
        return;
      }
      animatingRef.current = true;

      const oldNode = oldHandle.node;

      // 1) 创建新 spread 节点 — createSpreadNode 默认已 absolute 居中(transform: -50%,-50%)
      const pages = layout === 'single'
        ? [targetPage]
        : targetPage + 1 <= totalPages ? [targetPage, targetPage + 1] : [targetPage];
      const dim = pageDims[Math.min(targetPage - 1, pageDims.length - 1)];
      const pageW = Math.floor(dim.width * scale);
      const pageH = Math.floor(dim.height * scale);
      const newHandle = createSpreadNode(
        pages,
        pageW,
        pageH,
        layout === 'double' ? GAP_HORIZONTAL : 0,
        pageDims,
        scale,
        annotationModeRef.current,
        annotationsRef.current,
        onAnnotationCreateRef.current,
      );
      const newNode = newHandle.node;
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
        pages.map((p, idx) => renderer.renderPage(p, newHandle.canvases[idx], scale)),
      );
      pages.forEach((p, idx) => {
        const tl = newHandle.textLayers[idx];
        void renderer.renderTextLayer(p, tl, scale).then(() => {
          // 翻页动画期间 spread 切换:用 newHandle 引用判定,不是 currentSpreadRef
          // (动画结束才赋值 currentSpreadRef = newHandle)
          if (newHandle.textLayers[idx] === tl) {
            onTextLayerRendered?.(p, tl);
          }
        });
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

      // 5) 清理:销毁旧 handle(unmount React root + remove DOM)+ 重置 newNode 动画相关 inline style
      destroySpread(oldHandle);
      newNode.style.transition = '';
      newNode.style.willChange = '';
      newNode.style.zIndex = '';
      currentSpreadRef.current = newHandle;
      syncTextLayerMap(textLayerByPageRef.current, newHandle);
      animatingRef.current = false;

      // 6) 更新 React state — 静态 useEffect 看到 dataset 匹配会跳过重建
      setCurrentPage(targetPage);
    },
    [layout, totalPages, pageDims, scale, renderer, onTextLayerRendered],
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

  // prevPage / nextPage 走 ref — listener 只挂一次,业务函数变化不重挂
  // (重挂会丢 firedInGesture / accDelta 局部 state,导致一次 swipe 翻多页;
  // memory: [[event-listener-must-use-ref-for-business-fn]])
  const prevPageRef = useRef(prevPage);
  const nextPageRef = useRef(nextPage);
  useEffect(() => {
    prevPageRef.current = prevPage;
    nextPageRef.current = nextPage;
  }, [prevPage, nextPage]);

  // ←/→ 键翻页
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // 焦点在输入框时让位
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevPageRef.current();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextPageRef.current();
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        prevPageRef.current();
      } else if (e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        nextPageRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // trackpad 双指滑动翻页:
  // - 同一手势(连续 wheel 事件,gap < GESTURE_GAP_MS)内只翻一屏
  // - 动画期内 wheel 一律拒绝(firedInGesture 锁死),但**不刷新 lastEventTime** —
  //   惯性末尾的 wheel 不应被算作"还在手势中",否则用户停手后还要再等 GAP_MS 才能翻页
  // - listener 只挂一次(空 deps)避免重挂清掉 firedInGesture
  // - GESTURE_GAP_MS 只需覆盖 trackpad 惯性末尾(~150ms)— 动画期由 animatingRef 守门,
  //   不需要 GAP_MS 自己扛动画时长
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let lastEventTime = 0;
    let firedInGesture = false;
    let accDelta = 0;
    const SWIPE_THRESHOLD = 30;
    const GESTURE_GAP_MS = 150;
    const handler = (e: WheelEvent): void => {
      e.preventDefault();
      if (animatingRef.current) {
        // 动画期内只锁 firedInGesture,不刷新 lastEventTime —
        // 让 GAP 从用户真正停手的时刻起算(不是从动画结束起算)
        firedInGesture = true;
        accDelta = 0;
        return;
      }
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
      if (accDelta > 0) nextPageRef.current();
      else prevPageRef.current();
      firedInGesture = true;
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, []);

  if (pageDims.length === 0) {
    return <div className="krig-ebook-loading">Preparing pages...</div>;
  }

  // JSX 只渲染 container — spread 节点由命令式 DOM 操作维护
  return <div className="krig-ebook-paged" ref={containerRef} />;
});
