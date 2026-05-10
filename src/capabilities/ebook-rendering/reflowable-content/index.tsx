/**
 * ReflowableContent — 可重排格式的渲染容器(L5-C3,EPUB)
 *
 * V1 → V2 直迁:src/plugins/ebook/components/ReflowableContent.tsx(50 行)。
 *
 * 通过 IReflowableRenderer 接口渲染内容,渲染引擎(foliate-js)将自定义元素
 * `<foliate-view>` 注入到容器 DOM 中。容器 ResizeObserver 触发 renderer.onResize。
 *
 * 与 FixedPageContent 的核心差异:
 * - 没有固定页面尺寸,内容根据容器宽度重排
 * - 缩放 = 字号调整(不是整页缩放)
 * - 位置 = CFI(不是页码 + 坐标)
 * - 支持分页 / 滚动模式切换(V1 setDisplayMode,C3 toolbar 不暴露,留 C5 后)
 */

import { useRef, useEffect } from 'react';
import type { IReflowableRenderer } from '../types';

interface ReflowableContentProps {
  renderer: IReflowableRenderer;
  /** 进度变化回调(view 用作持久化触发)*/
  onProgressChange?: (progress: { chapter: string; percentage: number }) => void;
}

export function ReflowableContent({
  renderer,
  onProgressChange,
}: ReflowableContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 挂载渲染引擎到容器
  useEffect(() => {
    if (!containerRef.current) return;
    renderer.renderTo(containerRef.current);
  }, [renderer]);

  // 容器 resize → renderer 重排
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      renderer.onResize();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [renderer]);

  // 订阅 relocate 推流(view 持久化用)
  useEffect(() => {
    if (!onProgressChange) return;
    renderer.onRelocate(onProgressChange);
    // foliate-js View 注册 relocate 是 push 链式累积,destroy 时统一清
    // (renderer.destroy() 内 relocateCallbacks=[] 会清空)
  }, [renderer, onProgressChange]);

  return (
    <div
      className="krig-ebook-content krig-ebook-content--reflowable"
      ref={containerRef}
    />
  );
}
