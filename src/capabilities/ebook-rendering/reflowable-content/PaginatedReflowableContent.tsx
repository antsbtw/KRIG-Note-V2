/**
 * PaginatedReflowableContent — EPUB 翻页式渲染容器(L2 全屏 paged 专用)
 *
 * 对齐 macOS Books 翻页动画风格:横向滑动(1500ms easeOutQuint)。
 *
 * 设计:单 A renderer + capturePage ghost
 * - 历史路线 1(双 EPUBRenderer 实例)失败原因:foliate-paginator 的
 *   #scrollToAnchor 内 `Math.round(anchor * (textPages-1))` 量化损失,新实例
 *   上 view.next/prev/goToFraction 无法稳定跳到任意目标页(连续翻页停滞)。
 * - 当前方案:只有一个 EPUBRenderer A(已 init 在 mount 时),翻页就走
 *   A.view.next/prev(原 ReflowableContent 验证过 work)。视觉上"两页同框"
 *   通过 Electron webContents.capturePage 截取翻页前 wrapper 当前像素为 PNG
 *   dataURL,放进 ghost div 作为旧页镜像;A wrapper 内容已 next 到新页,
 *   ghost 与 A wrapper 之间走 transform translateX 动画。
 *
 * 翻页 lifecycle:
 *   next:
 *     1) 截图 wrapper 当前 rect → dataURL
 *     2) 创建 ghostDiv (z:2, 覆盖 wrapper),background-image = dataURL
 *     3) await A.view.next() — A wrapper 内容立即变新页(被 ghost 挡住)
 *     4) rAF → ghostDiv transition translateX(-offset),1500ms easeOutQuint
 *     5) 动画完成移除 ghostDiv
 *   prev:
 *     1) 截图 wrapper 当前 rect → dataURL
 *     2) 创建 ghostDiv (z:1, 同位置),background-image = dataURL
 *     3) await A.view.prev() — A wrapper 内容立即变新页
 *     4) 把 A wrapper 起点 translateX(-offset),z:2(在 ghost 之上滑入)
 *     5) rAF → A wrapper transition translateX(0),1500ms
 *     6) 动画完成移除 ghostDiv,清 wrapper transform
 *
 * 设置同步:无需 — 单 view,所有 set 直接生效。applyToAll 接口为兼容保留。
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
  /** 单 renderer(由 Host 创建并 load 完成,wrapper 挂 view)*/
  renderer: IReflowableRenderer;
  /** 进度变化(panel 持久化 + indicator 用)*/
  onProgressChange?: (progress: {
    chapter: string;
    percentage: number;
    page: number;
    pages: number;
  }) => void;
  /** 翻页**开始**(动画启动前)— panel 用于 indicator 即时反馈 */
  onPageChangeStart?: () => void;
}

export interface PaginatedReflowableContentHandle {
  /** 翻到下一页(带 slide 动画) */
  nextPage(): void;
  /** 翻到上一页(带 slide 动画) */
  prevPage(): void;
  /** 翻到任意 CFI(带 slide 动画) */
  goToCFI(cfi: string): void;
  /** 设置同步 — 单 view 直接 apply current,接口兼容 Host 保留 */
  applyToAll(fn: (r: IReflowableRenderer) => void): void;
}

export const PaginatedReflowableContent = forwardRef<
  PaginatedReflowableContentHandle,
  PaginatedReflowableContentProps
>(function PaginatedReflowableContent(
  { renderer, onProgressChange, onPageChangeStart },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const animatingRef = useRef(false);

  // ── mount: 挂 renderer 到 wrapper ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    const wrapper = createWrapper();
    container.appendChild(wrapper);
    wrapperRef.current = wrapper;
    renderer.renderTo(wrapper);
    return () => {
      container.innerHTML = '';
      wrapperRef.current = null;
    };
    // 单 view:renderer 生命周期由 Host 管,mount 只挂一次
  }, []);

  // 容器 resize → renderer 重排
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      renderer.onResize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [renderer]);

  // relocate 转推
  const onProgressChangeRef = useRef(onProgressChange);
  useEffect(() => {
    onProgressChangeRef.current = onProgressChange;
  }, [onProgressChange]);
  useEffect(() => {
    renderer.onRelocate((progress) => {
      onProgressChangeRef.current?.(progress);
    });
  }, [renderer]);

  // 截图 ghost 工具 — 调主进程 webContents.capturePage 拿当前 wrapper 像素
  // 注:wrapper 在 viewport 中的位置 = getBoundingClientRect()(viewport 坐标系)
  // capturePage 接 BrowserWindow viewport 内 rect,正好对齐
  const captureWrapperGhost = useCallback(async (): Promise<HTMLDivElement | null> => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    let dataURL: string | null = null;
    try {
      dataURL = await window.electronAPI.ebookCaptureRegion({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    } catch (err) {
      console.warn('[paged-epub] capture failed:', err);
      return null;
    }
    if (!dataURL) return null;
    const ghost = document.createElement('div');
    ghost.className = 'krig-ebook-paged-reflowable__ghost';
    ghost.style.position = 'absolute';
    ghost.style.inset = '0';
    ghost.style.width = '100%';
    ghost.style.height = '100%';
    ghost.style.backgroundImage = `url(${dataURL})`;
    ghost.style.backgroundSize = '100% 100%';
    ghost.style.backgroundRepeat = 'no-repeat';
    ghost.style.willChange = 'transform';
    return ghost;
  }, []);

  // 翻页动画
  const runAnimation = useCallback(
    async (
      direction: 'next' | 'prev',
      action: (r: IReflowableRenderer) => Promise<void>,
    ): Promise<void> => {
      const container = containerRef.current;
      const wrapper = wrapperRef.current;
      if (!container || !wrapper) return;
      if (animatingRef.current) {
        // short-circuit:动画中再触发 → 直接对 A 做真翻页(不堆动画)
        await action(renderer);
        return;
      }
      animatingRef.current = true;
      onPageChangeStart?.();
      const offset = container.clientWidth + 100;
      try {
        // 1) 截图当前页作 ghost,并在 append 之前明确层级 + 起点 transform —
        //    避免 await action 期间 ghost 处于 default stacking 导致 paint 不一致
        const ghost = await captureWrapperGhost();
        if (!ghost) {
          console.warn('[paged-epub] capture failed → fallback no-animation');
          await action(renderer);
          return;
        }
        if (direction === 'next') {
          // next:ghost(旧页)在上层显示并随后滑出;wrapper(下面挂的 A view,
          // await action 后立即变新页)在底层不动
          ghost.style.zIndex = '2';
          ghost.style.transform = 'translateX(0)';
          wrapper.style.zIndex = '1';
        } else {
          // prev:ghost(旧页)留原位不动在底层;wrapper(新页)起点 -offset 从左滑入
          ghost.style.zIndex = '1';
          ghost.style.transform = 'translateX(0)';
          wrapper.style.zIndex = '2';
          wrapper.style.willChange = 'transform';
          wrapper.style.transform = `translateX(-${offset}px)`;
        }
        container.appendChild(ghost);
        // 等 ghost 图层 paint 完一帧(decode dataURL + layout)再开始真翻页,
        // 避免 ghost 还没 paint 就翻页 → wrapper 变新页时 ghost 还没盖住 → 瞬切感
        await new Promise<void>((r) => requestAnimationFrame(() => r()));

        // 2) 真翻页 — A wrapper 内容立即变新页(被 ghost 挡住,用户看不到瞬切)
        await action(renderer);

        // 3) 下一帧加 transition + 推动 transform(初始 transform 不参与过渡)
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            if (direction === 'next') {
              ghost.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASING}`;
              ghost.style.transform = `translateX(-${offset}px)`;
            } else {
              wrapper.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASING}`;
              wrapper.style.transform = 'translateX(0)';
            }
            setTimeout(resolve, SLIDE_MS + 30);
          });
        });

        // 5) 清理 — 移除 ghost,重置 wrapper inline 动画样式
        if (ghost.parentNode === container) container.removeChild(ghost);
        wrapper.style.transition = '';
        wrapper.style.transform = '';
        wrapper.style.willChange = '';
        wrapper.style.zIndex = '';
      } catch (err) {
        console.error('[paged-epub] runAnimation failed:', err);
      } finally {
        animatingRef.current = false;
      }
    },
    [renderer, captureWrapperGhost, onPageChangeStart],
  );

  // foliate-paginator 的 view.next/prev 每次只跳一列(单 page,paginator.page+1);
  // 但 paginator.feet[0]/[1] 分别显示 page X / X+1(spread),所以 +1 只前进半个
  // spread → 用户感觉"只翻一页"。spread mode 下要翻完整一个 spread 需 step=2。
  const stepPagesForSpread = useCallback((r: IReflowableRenderer): number => {
    return r.getMaxColumnCount() === 2 ? 2 : 1;
  }, []);

  const animateNext = useCallback(async (): Promise<void> => {
    await runAnimation('next', async (r) => {
      const steps = stepPagesForSpread(r);
      for (let i = 0; i < steps; i++) await r.nextChapter();
    });
  }, [runAnimation, stepPagesForSpread]);

  const animatePrev = useCallback(async (): Promise<void> => {
    await runAnimation('prev', async (r) => {
      const steps = stepPagesForSpread(r);
      for (let i = 0; i < steps; i++) await r.prevChapter();
    });
  }, [runAnimation, stepPagesForSpread]);

  const animateGoToCFI = useCallback(
    async (cfi: string): Promise<void> => {
      await runAnimation('next', async (r) => {
        await (r.goTo({ type: 'cfi', cfi }) as Promise<void> | undefined);
      });
    },
    [runAnimation],
  );

  // swipe 订阅(单 view,只挂一次)
  useEffect(() => {
    renderer.onHorizontalSwipe((direction) => {
      if (direction === 'next') void animateNext();
      else void animatePrev();
    });
  }, [renderer, animateNext, animatePrev]);

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
        fn(renderer);
      },
    }),
    [renderer, animateNext, animatePrev, animateGoToCFI],
  );

  return (
    <div
      className="krig-ebook-content krig-ebook-content--reflowable krig-ebook-content--paged"
      ref={containerRef}
    />
  );
});

/** 创建 wrapper 节点 — absolute 撑满容器,内部 EPUBRenderer.renderTo 挂 foliate-view */
function createWrapper(): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'krig-ebook-paged-reflowable__wrapper';
  wrapper.style.position = 'absolute';
  wrapper.style.inset = '0';
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  return wrapper;
}
