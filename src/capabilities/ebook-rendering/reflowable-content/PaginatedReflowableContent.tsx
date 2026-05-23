/**
 * PaginatedReflowableContent — EPUB 翻页式渲染容器(L2 全屏 paged 专用)
 *
 * 设计动机:
 * - 原 ReflowableContent 单 view + foliate-js 默认瞬切翻页,无过渡。
 * - PDF 全屏走 FullscreenPageView 自管翻页动画(easeOutQuint 1.5s)。
 * - EPUB 全屏需对齐同样视觉语言 → 在 panel 内同时持双 EPUBRenderer 实例,
 *   翻页时新实例加载目标页,旧实例 translateX 滑出 / 新实例滑入。
 *
 * 实现策略(对齐 FullscreenPageView):
 * - 命令式 DOM:组件持 wrapper 节点 + view 实例,React 只管 props 同步
 * - 翻页时新建第二 EPUBRenderer 实例 B,B 用同一 ArrayBuffer init,
 *   await ready + view.goTo / next / prev → wrapper transition translateX
 * - 动画完成销毁 A,B 升为 current(通知 Host 切 rendererRef)
 *
 * 设置同步(字号 / 主题 / 双页列数):
 * - props 变化时 effect 推到 current renderer
 * - 翻页期间 incoming 也接收同样 props(B init 后 apply)
 *
 * Phase 1:仅基础架构(B 路径占位,无动画),行为与 ReflowableContent 一致。
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { IReflowableRenderer } from '../types';

const SLIDE_MS = 1500;
const SLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface PaginatedReflowableContentProps {
  /** 初始 renderer(由 Host 创建并 load 完成,wrapper 上挂 view)*/
  renderer: IReflowableRenderer;
  /** 进度变化(panel 持久化 + indicator 用)*/
  onProgressChange?: (progress: {
    chapter: string;
    percentage: number;
    page: number;
    pages: number;
  }) => void;
  /**
   * 翻页动画完成后通知 Host 切 rendererRef.current —
   * 旧实例已 destroy,新实例已升为 current
   */
  onRendererSwap?: (newRenderer: IReflowableRenderer) => void;
  /**
   * 翻页**开始**(动画启动前)— panel 用于 indicator 即时反馈 +
   * 锁 wheel 期间设置同步动作
   */
  onPageChangeStart?: () => void;
  /** 创建新临时 EPUBRenderer 实例的工厂(panel 注入,避免本组件 import EPUBRenderer 类) */
  createRenderer: () => IReflowableRenderer;
}

export interface PaginatedReflowableContentHandle {
  /** 翻到下一页(带动画) */
  nextPage(): void;
  /** 翻到上一页(带动画) */
  prevPage(): void;
  /** 翻到任意 CFI(带动画 — 方向按 CFI 比较结果) */
  goToCFI(cfi: string): void;
  /**
   * 设置同步 — 把回调同时应用到 current + 任何 incoming 临时实例。
   * panel 改字号 / 主题 / appearance / maxColumnCount 时调此 API,
   * 避免动画中两 view 视觉不一致。
   */
  applyToAll(fn: (r: IReflowableRenderer) => void): void;
}

export const PaginatedReflowableContent = forwardRef<
  PaginatedReflowableContentHandle,
  PaginatedReflowableContentProps
>(function PaginatedReflowableContent(
  { renderer, onProgressChange, onRendererSwap, onPageChangeStart, createRenderer },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 当前 current renderer(随翻页动画完成切换)
  const currentRendererRef = useRef<IReflowableRenderer>(renderer);
  // current wrapper DOM(absolute 撑满容器)
  const currentWrapperRef = useRef<HTMLDivElement | null>(null);
  // 翻页中临时 incoming renderer + wrapper(动画期间双实例并存)
  const incomingRendererRef = useRef<IReflowableRenderer | null>(null);
  const incomingWrapperRef = useRef<HTMLDivElement | null>(null);
  // 动画锁
  const animatingRef = useRef(false);

  // ── 初始 mount: 把 renderer A 挂到 currentWrapper ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // 清空容器(防御:严格模式 / hot reload 残留)
    container.innerHTML = '';

    const wrapper = createWrapper();
    container.appendChild(wrapper);
    currentWrapperRef.current = wrapper;
    currentRendererRef.current = renderer;

    renderer.renderTo(wrapper);

    return () => {
      // unmount:不 destroy renderer — renderer 生命周期由 Host 管
      // 只移除 DOM 节点;incoming 若存在则一并销毁
      const inc = incomingRendererRef.current;
      if (inc) {
        inc.destroy();
        incomingRendererRef.current = null;
      }
      container.innerHTML = '';
      currentWrapperRef.current = null;
      incomingWrapperRef.current = null;
    };
    // renderer 是 panel 一次性 prop(同一本书生命周期内不变);故只 mount 一次
    // 翻页时 currentRendererRef 由 animateTransition 内部维护,不走此 effect
  }, []);

  // 容器 resize → current renderer 重排(incoming 在动画期间不需要 resize,
  // 因为它一开始就按目标尺寸 init;animation 完成后接班自动跟随容器尺寸)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      currentRendererRef.current.onResize();
      incomingRendererRef.current?.onResize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // 订阅 relocate 推流(current renderer)— current 切换时重新订阅
  // 注:foliate-js relocate 回调累积式,destroy 时统一清(EPUBRenderer.destroy 内已处理)
  const onProgressChangeRef = useRef(onProgressChange);
  useEffect(() => {
    onProgressChangeRef.current = onProgressChange;
  }, [onProgressChange]);
  const subscribeRelocate = useCallback((r: IReflowableRenderer) => {
    r.onRelocate((progress) => {
      onProgressChangeRef.current?.(progress);
    });
  }, []);
  useEffect(() => {
    subscribeRelocate(currentRendererRef.current);
  }, [subscribeRelocate]);

  // 订阅 swipe(current renderer)— current 切换时重新订阅
  // wheel listener 必须挂到本组件而非 renderer(后者绑 iframe doc;切换 renderer
  // 时新 view 内 iframe 还没 load,得等 attach 后才生效)— 不过 foliate-js
  // 给 EPUBRenderer 的实现是 iframe doc 内绑 wheel,我们沿用,只是把 callback
  // 切到 nextPage/prevPage(走动画路径)
  const subscribeSwipe = useCallback(
    (r: IReflowableRenderer) => {
      r.onHorizontalSwipe((direction) => {
        if (direction === 'next') void animateNext();
        else void animatePrev();
      });
    },
    // animateNext/animatePrev 引用稳定(useCallback)— 通过函数声明顺序保证
    // 在 mount 时挂一次即可,deps 留空
    [],
  );

  // ── 翻页动画 ──
  //
  // Phase 1:占位实现 — 直接调 current.view.next()/prev(),无动画。
  // Phase 2/3 在此扩展双实例 + transition translateX。

  const animateNext = useCallback(async (): Promise<void> => {
    if (animatingRef.current) {
      // 已有动画在跑 → short-circuit 直接调当前(动画完成后的)view.next()
      currentRendererRef.current.nextChapter();
      return;
    }
    onPageChangeStart?.();
    // Phase 1:直接 next,无动画
    currentRendererRef.current.nextChapter();
  }, [onPageChangeStart]);

  const animatePrev = useCallback(async (): Promise<void> => {
    if (animatingRef.current) {
      currentRendererRef.current.prevChapter();
      return;
    }
    onPageChangeStart?.();
    currentRendererRef.current.prevChapter();
  }, [onPageChangeStart]);

  const animateGoToCFI = useCallback(async (cfi: string): Promise<void> => {
    // Phase 1:无方向判断,直接 goTo
    onPageChangeStart?.();
    currentRendererRef.current.goTo({ type: 'cfi', cfi });
  }, [onPageChangeStart]);

  // mount 后挂 swipe(current)
  useEffect(() => {
    subscribeSwipe(currentRendererRef.current);
  }, [subscribeSwipe]);

  useImperativeHandle(
    ref,
    () => ({
      nextPage(): void {
        void animateNext();
      },
      prevPage(): void {
        void animatePrev();
      },
      goToCFI(cfi: string): void {
        void animateGoToCFI(cfi);
      },
      applyToAll(fn: (r: IReflowableRenderer) => void): void {
        fn(currentRendererRef.current);
        if (incomingRendererRef.current) {
          fn(incomingRendererRef.current);
        }
      },
    }),
    [animateNext, animatePrev, animateGoToCFI],
  );

  // 未使用变量提前消音(Phase 2/3 会真正用上)
  void createRenderer;
  void onRendererSwap;
  void subscribeRelocate;
  void SLIDE_MS;
  void SLIDE_EASING;

  return (
    <div
      className="krig-ebook-content krig-ebook-content--reflowable krig-ebook-content--paged"
      ref={containerRef}
    />
  );
});

/** 创建一个 wrapper 节点 — absolute 撑满容器,内部 EPUBRenderer.renderTo 会再
 *  appendChild foliate-view */
function createWrapper(): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'krig-ebook-paged-reflowable__wrapper';
  wrapper.style.position = 'absolute';
  wrapper.style.inset = '0';
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  return wrapper;
}
