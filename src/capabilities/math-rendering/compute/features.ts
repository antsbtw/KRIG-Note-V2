/**
 * compute/features — 特征点检测(零点 / 极值 / 拐点)
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/fullscreen/math-utils.ts`
 * 的 detectFeaturePoints + bisect。
 */

import { derivative, secondDerivative } from './derivatives';

type EvalFn = (x: number) => number;

/** 特征点类型 — 与 driver types 同构 */
export type FeaturePointType = 'maximum' | 'minimum' | 'zero' | 'inflection';

/** 特征点 — 与 driver types 同构(冗余 export,供 capability 用户独立使用) */
export interface FeaturePoint {
  id: string;
  functionId: string;
  x: number;
  y: number;
  type: FeaturePointType;
  auto: boolean;
}

interface DetectOptions {
  types?: Set<FeaturePointType>;
}

/** 二分法精化零点 */
function bisect(fn: EvalFn, a: number, b: number, tol = 1e-10, maxIter = 50): number {
  let fa = fn(a);
  for (let i = 0; i < maxIter; i++) {
    const mid = (a + b) / 2;
    const fm = fn(mid);
    if (Math.abs(fm) < tol || (b - a) / 2 < tol) return mid;
    if (fa * fm < 0) {
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

/**
 * 扫描函数在 [xMin, xMax] 范围内的特征点(零点 / 极值 / 拐点)。
 *
 * 算法:均匀采样 500 点,检测三类符号变化:
 * - 零点:f(x) 符号变化 → bisect 精化
 * - 极值:f'(x) 符号变化 → bisect((t)=>f'(t)) 精化(再据导数前后判断 max/min)
 * - 拐点:f''(x) 符号变化 → bisect((t)=>f''(t)) 精化
 */
export function detectFeaturePoints(
  fn: EvalFn,
  functionId: string,
  xMin: number,
  xMax: number,
  opts: DetectOptions = {},
): FeaturePoint[] {
  const types = opts.types || new Set<FeaturePointType>(['zero', 'maximum', 'minimum', 'inflection']);
  const points: FeaturePoint[] = [];
  const samples = 500;
  const h = (xMax - xMin) / samples;

  let prevY = fn(xMin);
  let prevDy = derivative(fn, xMin);
  let prevD2y = secondDerivative(fn, xMin);

  for (let i = 1; i <= samples; i++) {
    const x = xMin + i * h;
    const y = fn(x);
    const dy = derivative(fn, x);
    const d2y = secondDerivative(fn, x);

    if (!isFinite(y) || !isFinite(prevY)) {
      prevY = y; prevDy = dy; prevD2y = d2y;
      continue;
    }

    // 零点:f(x) 符号变化
    if (types.has('zero') && isFinite(prevY) && prevY * y < 0) {
      const xZero = bisect(fn, x - h, x);
      const yZero = fn(xZero);
      if (isFinite(yZero) && Math.abs(yZero) < 0.01) {
        points.push({
          id: `feat-${functionId}-zero-${points.length}`,
          functionId, x: xZero, y: yZero, type: 'zero', auto: true,
        });
      }
    }

    // 极值:f'(x) 符号变化
    if (isFinite(prevDy) && isFinite(dy) && prevDy * dy < 0) {
      const xCrit = bisect((t) => derivative(fn, t), x - h, x);
      const yCrit = fn(xCrit);
      if (isFinite(yCrit)) {
        if (types.has('maximum') && prevDy > 0 && dy < 0) {
          points.push({
            id: `feat-${functionId}-max-${points.length}`,
            functionId, x: xCrit, y: yCrit, type: 'maximum', auto: true,
          });
        } else if (types.has('minimum') && prevDy < 0 && dy > 0) {
          points.push({
            id: `feat-${functionId}-min-${points.length}`,
            functionId, x: xCrit, y: yCrit, type: 'minimum', auto: true,
          });
        }
      }
    }

    // 拐点:f''(x) 符号变化
    if (types.has('inflection') && isFinite(prevD2y) && isFinite(d2y) && prevD2y * d2y < 0) {
      const xInflect = bisect((t) => secondDerivative(fn, t), x - h, x);
      const yInflect = fn(xInflect);
      if (isFinite(yInflect)) {
        points.push({
          id: `feat-${functionId}-infl-${points.length}`,
          functionId, x: xInflect, y: yInflect, type: 'inflection', auto: true,
        });
      }
    }

    prevY = y; prevDy = dy; prevD2y = d2y;
  }

  return points;
}
