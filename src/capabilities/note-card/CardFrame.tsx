/**
 * ④ 框:选中框 + 拖动 + 拖左右边改宽 + 双击进编辑 + 右键
 *
 * 设计稿:docs/10-business-design/note/note-card-公共组件设计.md §三 ④
 *
 * 只用屏幕像素(position:fixed),不碰坐标系 —— 画板(three.js 世界坐标)、math-visual
 * (Mafs 数据坐标)、以后的 PDF(页面坐标)各自把回调里的像素量换成自己的坐标。
 *
 * - 拖动 / 改宽过程中 phase='move'(宿主只改临时状态),松手 phase='end'(宿主写库,一步撤销)
 * - 改宽时框只画新宽度的轮廓;卡片内容等宿主在 'end' 后按新宽度重新渲染(文字转路径较重,不逐帧)
 */

import { useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { resizeFromEdge, DEFAULT_MIN_WIDTH, DEFAULT_MAX_WIDTH, type FrameEdge } from './frame-math';

export interface CardFrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CardFrameProps {
  /** 卡片在屏幕上的位置(clientX/Y 坐标系) */
  rect: CardFrameRect;
  color?: string;
  minWidth?: number;
  maxWidth?: number;
  /** 按住拖动:dx/dy = 相对按下时的累计像素 */
  onMove(dx: number, dy: number, phase: 'move' | 'end'): void;
  /** 拖边改宽:新宽度 + 拖的是哪一边(宿主据此决定哪边不动) */
  onResizeWidth(width: number, edge: FrameEdge, phase: 'move' | 'end'): void;
  onEnterEdit(): void;
  /** Shift+点击等(加选 / 去掉),可选 */
  onClick?(e: { shiftKey: boolean }): void;
  onContextMenu?(x: number, y: number): void;
}

const MOVE_THRESHOLD = 3;

export function CardFrame({
  rect, color = '#4a90e2', minWidth = DEFAULT_MIN_WIDTH, maxWidth = DEFAULT_MAX_WIDTH,
  onMove, onResizeWidth, onEnterEdit, onClick, onContextMenu,
}: CardFrameProps): ReactElement {
  // 改宽过程中的轮廓(松手后清掉,回到宿主给的 rect)
  const [preview, setPreview] = useState<{ left: number; width: number } | null>(null);
  const dragRef = useRef(false);

  const startMove = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const shiftKey = e.shiftKey;
    let moved = false;
    const onMoveEv = (ev: MouseEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < MOVE_THRESHOLD) return;
      moved = true;
      dragRef.current = true;
      onMove(dx, dy, 'move');
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMoveEv);
      window.removeEventListener('mouseup', onUp);
      if (moved) onMove(ev.clientX - sx, ev.clientY - sy, 'end');
      else onClick?.({ shiftKey });
      setTimeout(() => { dragRef.current = false; }, 0);
    };
    window.addEventListener('mousemove', onMoveEv);
    window.addEventListener('mouseup', onUp);
  };

  const startResize = (edge: FrameEdge) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const start = { left: rect.left, width: rect.width };
    let last = start;
    const onMoveEv = (ev: MouseEvent) => {
      last = resizeFromEdge(start.left, start.width, ev.clientX - sx, edge, minWidth, maxWidth);
      setPreview(last);
      onResizeWidth(last.width, edge, 'move');
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMoveEv);
      window.removeEventListener('mouseup', onUp);
      setPreview(null);
      if (last.width !== start.width) onResizeWidth(last.width, edge, 'end');
    };
    window.addEventListener('mousemove', onMoveEv);
    window.addEventListener('mouseup', onUp);
  };

  const left = preview?.left ?? rect.left;
  const width = preview?.width ?? rect.width;
  const box: CSSProperties = {
    position: 'fixed', left: left - 4, top: rect.top - 4, width: width + 8, height: rect.height + 8,
    boxSizing: 'border-box', border: `1px dashed ${color}`, borderRadius: 4,
    background: preview ? `${color}14` : 'transparent', cursor: 'move', zIndex: 5,
  };
  const handle = (side: FrameEdge): CSSProperties => ({
    position: 'absolute', top: '50%', [side]: -5, width: 8, height: 22, marginTop: -11,
    background: '#ffffff', border: `1px solid ${color}`, borderRadius: 3, cursor: 'ew-resize',
  });

  return (
    <div
      data-note-card-frame
      style={box}
      onMouseDown={startMove}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); if (!dragRef.current) onEnterEdit(); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(e.clientX, e.clientY); }}
      title="拖动移动;拖左右小柄改宽度;双击编辑"
    >
      <div style={handle('left')} onMouseDown={startResize('left')} />
      <div style={handle('right')} onMouseDown={startResize('right')} />
    </div>
  );
}
