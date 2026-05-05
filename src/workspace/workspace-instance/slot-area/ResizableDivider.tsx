/**
 * ResizableDivider — 可拖拽分隔线
 *
 * 拖拽改变 dividerRatio(WorkspaceState 字段),Slot Area 重新分配 Left/Right 比例。
 *
 * 实现:mouseDown → mouseMove(全屏监听)→ 计算 ratio → 调 onChange → mouseUp 取消监听。
 */

import { useCallback, useRef } from 'react';
import { DIVIDER_RATIO_MIN, DIVIDER_RATIO_MAX } from '../../workspace-state/default-state';

interface ResizableDividerProps {
  /** 当前比例(0~1)*/
  ratio: number;
  /** 拖拽时回调(实时更新 WorkspaceState.dividerRatio)*/
  onRatioChange: (ratio: number) => void;
  /** Slot Area 总宽度参考(用于计算 ratio)— 不传则取父元素宽度 */
  containerRef?: React.RefObject<HTMLElement | null>;
}

export function ResizableDivider({ ratio, onRatioChange, containerRef }: ResizableDividerProps) {
  const dividerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startRatio = ratio;
    const container = containerRef?.current ?? dividerRef.current?.parentElement;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;

    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dRatio = dx / containerWidth;
      const newRatio = Math.max(DIVIDER_RATIO_MIN, Math.min(DIVIDER_RATIO_MAX, startRatio + dRatio));
      onRatioChange(newRatio);
    };

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [ratio, onRatioChange, containerRef]);

  return (
    <div
      ref={dividerRef}
      className="krig-divider"
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(ratio * 100)}
    />
  );
}
