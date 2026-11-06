/**
 * compute/shape-geometry — 几何对象的纯几何计算(题意图 P1,2026-11-06)
 *
 * 不碰 React / Mafs,单测直接跑。
 */

import type { ShapeSpec } from '../types';

export type Vec2 = [number, number];
export type Cardinal = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const CARDINALS: Cardinal[] = ['e', 'ne', 'n', 'nw', 'w', 'sw', 's', 'se'];

/** 方向向量 → 八方位(数学坐标,y 向上)。零向量返回 'ne'。 */
export function cardinalOf(dx: number, dy: number): Cardinal {
  if (dx === 0 && dy === 0) return 'ne';
  const angle = Math.atan2(dy, dx); // -π ~ π
  const idx = Math.round(angle / (Math.PI / 4));
  return CARDINALS[((idx % 8) + 8) % 8];
}

/** 刻度最多这么多道;超过说明 step 填得太小,调用方应报错而不是画一团黑 */
export const MAX_TICKS = 200;

/**
 * 沿 from→to 每 step 一道刻度(不含起点;终点恰好落在刻度上时含终点)。
 * step ≤ 0、线段长度为 0 → 空数组。超过 MAX_TICKS → null(调用方报错)。
 */
export function tickPositions(from: Vec2, to: Vec2, step: number): Vec2[] | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (!(step > 0) || len === 0) return [];
  const count = Math.floor(len / step + 1e-9);
  if (count > MAX_TICKS) return null;
  const ux = dx / len;
  const uy = dy / len;
  const out: Vec2[] = [];
  for (let k = 1; k <= count; k++) {
    out.push([from[0] + ux * step * k, from[1] + uy * step * k]);
  }
  return out;
}

/** 线段左侧单位法向(逆时针转 90°);零长度返回 [0, 1] */
export function leftNormal(from: Vec2, to: Vec2): Vec2 {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return [0, 1];
  return [-dy / len, dx / len];
}

/** 刻度数值文字:整数原样,否则最多两位小数 */
export function formatTickValue(v: number): string {
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return String(Math.round(v * 100) / 100);
}

// ─── 标签布局(渲染与命中共用,2026-11-06) ──────────────────────
// 背景:Mafs <Text attach> 的上下偏移是反的(源码 attach 含 "n" 时 yOffset=+1,而 SVG y 向下
// → 「标在北边」实际往下偏),箭头朝北时标签正好压在箭头上。所以偏移我们自己算,
// 只借 attach 做对齐(textAnchor / dominantBaseline),attachDistance 一律 0。

export interface LabelLayout {
  /** 锚点(数据坐标) */
  at: Vec2;
  /** 相对锚点的方位;null = 居中 */
  dir: Cardinal | null;
  /** 沿方位离锚点多少像素 */
  distance: number;
  size: number;
  text: string;
}

export const LABEL_SIZE = 15;

/** 各类对象的标签默认放哪(没有标签返回 null) */
export function labelLayout(s: ShapeSpec): LabelLayout | null {
  if (s.kind === 'text' || !s.label) return null;
  switch (s.kind) {
    case 'point':
      return { at: s.at, dir: 'ne', distance: 12, size: LABEL_SIZE, text: s.label };
    case 'arrow':
      return { at: s.to, dir: cardinalOf(s.to[0] - s.from[0], s.to[1] - s.from[1]), distance: 16, size: LABEL_SIZE, text: s.label };
    case 'segment': {
      const [nx, ny] = leftNormal(s.from, s.to);
      return { at: [(s.from[0] + s.to[0]) / 2, (s.from[1] + s.to[1]) / 2], dir: cardinalOf(-nx, -ny), distance: 10, size: LABEL_SIZE, text: s.label };
    }
    case 'circle': {
      const d = s.radius / Math.SQRT2;
      return { at: [s.center[0] + d, s.center[1] + d], dir: 'ne', distance: 6, size: LABEL_SIZE, text: s.label };
    }
    case 'polygon': {
      const n = s.points.length;
      const cx = s.points.reduce((a, p) => a + p[0], 0) / n;
      const cy = s.points.reduce((a, p) => a + p[1], 0) / n;
      return { at: [cx, cy], dir: null, distance: 0, size: LABEL_SIZE, text: s.label };
    }
  }
}

/** 方位 → 屏幕像素方向单位向量(y 向下) */
export function screenUnit(dir: Cardinal | null): Vec2 {
  if (!dir) return [0, 0];
  const x = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0;
  const y = dir.includes('n') ? -1 : dir.includes('s') ? 1 : 0;
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
}

/** 标签文字相对锚点像素的总偏移 = 方位 × 距离 + 用户拖动的偏移 */
export function labelShiftPx(layout: LabelLayout, userOffset?: Vec2): Vec2 {
  const [ux, uy] = screenUnit(layout.dir);
  return [ux * layout.distance + (userOffset?.[0] ?? 0), uy * layout.distance + (userOffset?.[1] ?? 0)];
}

/** 文字大致宽度(px):中日文按一个字号,其他按 0.6 个字号 */
export function estimateTextWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += /[⺀-鿿＀-￯]/.test(ch) ? size : size * 0.6;
  return w;
}

export interface PxBox { x0: number; y0: number; x1: number; y1: number }

/**
 * 标签在屏幕上的大致框(命中测试用)。toPx 把数据坐标换成画布像素。
 * 对齐规则与 Mafs Text 一致:e → 左对齐、w → 右对齐、否则居中;n → 基线、s → 顶线、否则垂直居中。
 */
export function shapeLabelBox(s: ShapeSpec, toPx: (p: Vec2) => Vec2): PxBox | null {
  const layout = labelLayout(s);
  if (!layout) return null;
  const a = toPx(layout.at);
  const [sx, sy] = labelShiftPx(layout, s.labelOffset);
  const x = a[0] + sx;
  const y = a[1] + sy;
  const w = estimateTextWidth(layout.text, layout.size);
  const h = layout.size;
  const dir = layout.dir ?? '';
  const x0 = dir.includes('e') ? x : dir.includes('w') ? x - w : x - w / 2;
  const y0 = dir.includes('n') ? y - h : dir.includes('s') ? y : y - h / 2;
  return { x0: x0 - 3, y0: y0 - 3, x1: x0 + w + 3, y1: y0 + h + 3 };
}
