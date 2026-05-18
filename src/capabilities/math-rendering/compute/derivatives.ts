/**
 * compute/derivatives — 中心差分一阶/二阶导数
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/fullscreen/math-utils.ts`
 * 的 derivative + secondDerivative。
 *
 * 注:Phase 1A 已有 numericalDerivative(h=1e-6) 在 evaluator.ts;本文件提供
 * 与 V1 全屏一致的 derivative(h=1e-7) + secondDerivative(h=1e-5) — 主要差异
 * 是步长精度,V1 在全屏特征点检测内用更细的 h(1e-7)。两者并存,driver 按场景
 * 选择:inline 走 numericalDerivative,全屏特征/切线工具走 derivative。
 */

type EvalFn = (x: number) => number;

/** 中心差分求一阶导数(h=1e-7,特征点检测精度) */
export function derivative(fn: EvalFn, x: number, h = 1e-7): number {
  return (fn(x + h) - fn(x - h)) / (2 * h);
}

/** 中心差分求二阶导数(h=1e-5,拐点检测精度) */
export function secondDerivative(fn: EvalFn, x: number, h = 1e-5): number {
  return (fn(x + h) - 2 * fn(x) + fn(x - h)) / (h * h);
}
