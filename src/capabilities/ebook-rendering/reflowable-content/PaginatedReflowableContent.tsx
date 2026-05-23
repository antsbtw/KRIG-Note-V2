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
 * Phase 2:next 翻页动画 — 真双实例,旧 view translateX 滑出屏幕左侧
 *   (1500ms easeOutQuint),新 view 原地呈现。
 * Phase 3 计划:prev 动画(新 view 从屏外左侧滑入) + 设置同步双 view。
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

  // ── 翻页动画(Phase 2:next;Phase 3:prev + goToCFI 动画化)──
  //
  // 翻页 lifecycle:
  //   1) 创建临时 incoming wrapper + B 实例(同构造函数 + 同 buffer)
  //   2) 同步设置(font/theme/appearance/maxColumnCount + setRestoreLocation 到 A 的 lastCFI)
  //   3) B.renderTo(incomingWrapper) → await B.waitReady()(view + 文件 init 完成)
  //   4) 用 view.addEventListener('relocate', once) 等 next() 触发的 relocate
  //      调 B.view.next()(B 翻到下一页;首次 init 时已对齐到 A 当前页)
  //   5) relocate 触发 → B 像素就位 → 揭示 B(visibility: visible)
  //   6) rAF → A 的 wrapper transition translateX → 屏外左侧
  //   7) SLIDE_MS 后销毁 A,B 升 current,触发 onRendererSwap

  /**
   * 创建 + 初始化第二实例 B,定位到 currentRenderer 当前位置 + 同步设置。
   * 完成后 B 已 mount 到 incoming wrapper,view 显示与 A 相同的页(下一步由
   * 调用方决定调 B.view.next() / .prev() / .goTo() 推到目标页)。
   */
  const buildIncoming = useCallback(async (): Promise<{
    renderer: IReflowableRenderer;
    wrapper: HTMLDivElement;
  } | null> => {
    const container = containerRef.current;
    if (!container) return null;
    const A = currentRendererRef.current;
    const buffer = A.getFileData();
    if (!buffer) {
      console.warn('[PaginatedReflowableContent] A.getFileData() returned null');
      return null;
    }
    const B = createRenderer();
    // 同步当前设置(必须在 B.renderTo 之前 — initView 内会 apply pending 值)
    B.setMaxColumnCount(A.getMaxColumnCount());
    B.setFontSize(A.getFontSize());
    B.setTheme(A.getTheme());
    B.setAppearance(A.getAppearance());
    const cfi = A.getLastCFI();
    if (cfi) B.setRestoreLocation(cfi);

    await B.load(buffer);
    const wrapper = createWrapper();
    container.appendChild(wrapper);
    B.renderTo(wrapper);
    await B.waitReady();
    return { renderer: B, wrapper };
  }, [createRenderer]);

  /**
   * 等 B 的下一次 relocate 事件触发(用于在 next/prev/goTo 后判断动画 cue 时机)。
   * 用 view.addEventListener once;超时兜底 800ms(EPUB 翻页一般 <100ms 足够)
   * — 兜底原因:某些边界(已是最后一页 / 第一页)next/prev 不触发 relocate,
   * 不能让动画永远卡住。
   */
  function waitNextRelocate(r: IReflowableRenderer): Promise<void> {
    const view = r.getView();
    if (!view) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const handler = (): void => {
        if (done) return;
        done = true;
        view.removeEventListener('relocate', handler);
        resolve();
      };
      view.addEventListener('relocate', handler);
      setTimeout(() => {
        if (done) return;
        done = true;
        view.removeEventListener('relocate', handler);
        resolve();
      }, 800);
    });
  }

  /**
   * 执行翻页动画。direction='next' = 旧 wrapper translateX 滑出左侧,新 wrapper 原地;
   * direction='prev' = 新 wrapper 从屏外左侧滑入,旧 wrapper 静止。
   * action 内做实际翻页(B.view.next() / .prev() / .goTo(cfi))。
   */
  const runAnimation = useCallback(
    async (
      direction: 'next' | 'prev',
      action: (B: IReflowableRenderer) => void,
    ): Promise<void> => {
      const container = containerRef.current;
      const oldWrapper = currentWrapperRef.current;
      const A = currentRendererRef.current;
      if (!container || !oldWrapper) return;
      if (animatingRef.current) {
        // short-circuit:跳到目标(直接对 current 操作,不走动画)
        action(A);
        return;
      }
      animatingRef.current = true;
      onPageChangeStart?.();
      try {
        const built = await buildIncoming();
        if (!built) {
          animatingRef.current = false;
          return;
        }
        const { renderer: B, wrapper: incomingWrapper } = built;
        incomingRendererRef.current = B;
        incomingWrapperRef.current = incomingWrapper;

        const offset = container.clientWidth + 100;

        // 层级 + 起点位置
        if (direction === 'next') {
          // 旧在上层即将滑出;新在底层 + 先隐藏,B 翻页就位后再揭示
          oldWrapper.style.zIndex = '2';
          oldWrapper.style.willChange = 'transform';
          incomingWrapper.style.zIndex = '1';
          incomingWrapper.style.visibility = 'hidden';
        } else {
          // 新在上层从屏外左侧滑入;旧在底层静止
          oldWrapper.style.zIndex = '1';
          incomingWrapper.style.zIndex = '2';
          incomingWrapper.style.willChange = 'transform';
          incomingWrapper.style.transform = `translateX(-${offset}px)`;
        }

        // 让 B 翻到目标页(等 relocate 触发即认为 B 像素就位)
        action(B);
        await waitNextRelocate(B);

        // next:B 像素就位 → 揭示(此时还被 A 在上层挡住)
        if (direction === 'next') {
          incomingWrapper.style.visibility = '';
        }

        // 下一帧加 transition + 推动 transform(初始 transform 不参与过渡)
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            if (direction === 'next') {
              oldWrapper.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASING}`;
              oldWrapper.style.transform = `translateX(-${offset}px)`;
            } else {
              incomingWrapper.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASING}`;
              incomingWrapper.style.transform = 'translateX(0)';
            }
            setTimeout(resolve, SLIDE_MS + 30);
          });
        });

        // 销毁 A,B 升 current
        if (oldWrapper.parentNode === container) container.removeChild(oldWrapper);
        A.destroy();
        // 重置 B 动画相关 inline style — 接班后参与正常容器布局
        incomingWrapper.style.transition = '';
        incomingWrapper.style.willChange = '';
        incomingWrapper.style.zIndex = '';
        incomingWrapper.style.transform = '';
        incomingWrapper.style.visibility = '';
        currentRendererRef.current = B;
        currentWrapperRef.current = incomingWrapper;
        incomingRendererRef.current = null;
        incomingWrapperRef.current = null;

        // 重新订阅 relocate + swipe 给新 current(EPUBRenderer.relocateCallbacks
        // 已随 A.destroy 清空,B 是全新实例需要重新挂)
        subscribeRelocate(B);
        subscribeSwipe(B);

        // 通知 Host 切 rendererRef
        onRendererSwap?.(B);
      } catch (err) {
        console.error('[PaginatedReflowableContent] animation failed:', err);
      } finally {
        animatingRef.current = false;
      }
    },
    [buildIncoming, onPageChangeStart, onRendererSwap, subscribeRelocate, subscribeSwipe],
  );

  const animateNext = useCallback(async (): Promise<void> => {
    await runAnimation('next', (B) => B.nextChapter());
  }, [runAnimation]);

  const animatePrev = useCallback(async (): Promise<void> => {
    await runAnimation('prev', (B) => B.prevChapter());
  }, [runAnimation]);

  const animateGoToCFI = useCallback(
    async (cfi: string): Promise<void> => {
      // 方向无法廉价判断(CFI 不可比较),统一走 next 视觉(旧滑出)
      // 后续可加 fraction 比较(由 progress.percentage 推算前后)
      await runAnimation('next', (B) => {
        B.goTo({ type: 'cfi', cfi });
      });
    },
    [runAnimation],
  );

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
