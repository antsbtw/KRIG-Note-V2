/**
 * ④ 框的纯计算(单测直接跑)
 *
 * 拖边改宽(用户 2026-11-06 选 A:改宽度、文字重排、高度随内容):
 * - 拖右边:左边不动,宽 = 起始宽 + dx
 * - 拖左边:右边不动,宽 = 起始宽 - dx,左边跟着挪
 */

export type FrameEdge = 'left' | 'right';

export const DEFAULT_MIN_WIDTH = 80;
export const DEFAULT_MAX_WIDTH = 800;

export function resizeFromEdge(
  startLeft: number,
  startWidth: number,
  dx: number,
  edge: FrameEdge,
  minWidth = DEFAULT_MIN_WIDTH,
  maxWidth = DEFAULT_MAX_WIDTH,
): { left: number; width: number } {
  const raw = edge === 'right' ? startWidth + dx : startWidth - dx;
  const width = Math.round(Math.min(Math.max(raw, minWidth), maxWidth));
  const left = edge === 'right' ? startLeft : startLeft + (startWidth - width);
  return { left, width };
}
