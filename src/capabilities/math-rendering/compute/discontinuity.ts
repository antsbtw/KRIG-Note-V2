/**
 * compute/discontinuity — 不连续检测 + 连续段构建
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/utils.ts`(detectDiscontinuities + buildSegments)。
 * 用于分段函数绘图:在间断点处把曲线拆成多段连续段,避免画"跳跃"直线。
 */

import type { ContSeg } from '../types';

/**
 * 在 [xMin, xMax] 区间内采样 2000 点,以"相邻 y 差超阈值"启发式判定不连续。
 *
 * 阈值取 max(0.3, |h|*100):h 为步长。命中后做 40 步二分逼近精确位置。
 * 整数附近 0.01 内自动 snap 到整数(避免 0.99999... vs 1.00001 的浮点噪声)。
 */
export function detectDiscontinuities(
  fn: (x: number) => number,
  xMin: number,
  xMax: number,
): number[] {
  const jumps: number[] = [];
  const samples = 2000;
  const h = (xMax - xMin) / samples;
  let prevY = fn(xMin);
  for (let i = 1; i <= samples; i++) {
    const x = xMin + i * h;
    const y = fn(x);
    if (!isFinite(y) || !isFinite(prevY)) { prevY = y; continue; }
    const dy = Math.abs(y - prevY);
    if (dy > Math.max(0.3, Math.abs(h) * 100)) {
      let lo = x - h;
      let hi = x;
      for (let j = 0; j < 40; j++) {
        const mid = (lo + hi) / 2;
        if (Math.abs(fn(mid) - fn(lo)) > dy * 0.3) hi = mid;
        else lo = mid;
      }
      let jumpX = (lo + hi) / 2;
      const nearest = Math.round(jumpX);
      if (Math.abs(jumpX - nearest) < 0.01) jumpX = nearest;
      jumps.push(jumpX);
    }
    prevY = y;
  }
  return jumps;
}

/**
 * 把 [xMin, xMax] 按 discontinuities 切成多段连续区间。
 *
 * 每段两端给出端点信息(closed/open),用于绘制 ●/○ 标记。
 * 端点 closed=true 当 fn(边界) 与 fn(边界 ± eps) 几乎相等(差 < 0.01),
 * 表示边界处函数有定义且连续。
 */
export function buildSegments(
  fn: (x: number) => number,
  discs: number[],
  xMin: number,
  xMax: number,
): ContSeg[] {
  if (discs.length === 0) return [];
  const sorted = [...discs].sort((a, b) => a - b);
  const eps = 1e-9;
  const domEps = 1e-4;
  const boundaries = [xMin, ...sorted, xMax];
  const segs: ContSeg[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i];
    const b = boundaries[i + 1];
    if (b - a < domEps * 2) continue;
    const domA = i === 0 ? a : a + domEps;
    const domB = i === boundaries.length - 2 ? b : b - domEps;
    const yL = fn(a + eps);
    const yR = fn(b - eps);
    if (!isFinite(yL) || !isFinite(yR)) continue;
    const fA = fn(a);
    const fB = fn(b);
    segs.push({
      domain: [domA, domB],
      leftEndpoint: { x: a, y: yL, closed: isFinite(fA) && Math.abs(fA - yL) < 0.01 },
      rightEndpoint: { x: b, y: yR, closed: isFinite(fB) && Math.abs(fB - yR) < 0.01 },
    });
  }
  return segs;
}
