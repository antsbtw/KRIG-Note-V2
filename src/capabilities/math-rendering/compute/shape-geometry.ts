/**
 * compute/shape-geometry — 几何对象的纯几何计算(题意图 P1,2026-11-06)
 *
 * 不碰 React / Mafs,单测直接跑。
 */

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
