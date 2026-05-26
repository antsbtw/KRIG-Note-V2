/**
 * math-rendering capability — Mafs + mathjs + compute-engine 单点屏障
 *
 * **本 capability 是 V2 唯一允许 import `mafs` / `mathjs` /
 * `@cortex-js/compute-engine` 的位置**(对齐 code-editing 的 CM6 单点屏障 +
 * canvas-rendering 的 Three.js 单点屏障模式)。
 *
 * 其他位置(view / driver / 其他 capability / shell / workspace / slot)0 import,
 * 通过 `requireCapabilityApi<MathRenderingApi>('math-rendering')` 拿 MathHost +
 * 计算 API。
 *
 * ── 下游消费者 ──
 *
 * - drivers/text-editing-driver/blocks/math-visual/(Phase 1B+,inline + 全屏)
 * - 未来其他需要"函数曲线画布"的业务(canvas / graph 变种等)
 *
 * ── 设计文档 ──
 *
 * docs/tasks/math-visual-migration-prompt.md §D1
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { MathRenderingApi } from './types';
import { MathHost } from './host/MathHost';
import {
  createEvalFn,
  extractParameters,
  numericalDerivative,
  makeParametricFn,
  makePolarFn,
  makeVerticalLineX,
  makeImplicitFn,
  exprToLatex,
} from './compute/evaluator';
import { detectDiscontinuities, buildSegments } from './compute/discontinuity';
import { detectPlotType } from './compute/plot-detect';
import {
  latexToMathjs,
  latexToFunction,
  latexToFunctionWithEndpoints,
} from './compute/latex-converter';
import { derivative, secondDerivative } from './compute/derivatives';
import { integrate } from './compute/integrate';
import { detectFeaturePoints } from './compute/features';

export type {
  MathRenderingApi,
  MathHostProps,
  ViewBox,
  ViewportState,
  AxisDisplayConfig,
  Curve,
  FnOfXCurve,
  ParametricCurve,
  PolarCurve,
  VerticalLineCurve,
  ImplicitCurve,
  UnsupportedCurve,
  CurveStyle,
  MathAnnotation,
  MathEndpoint,
  MathParameter,
  EvalResult,
  EndpointInfo,
  PiecewiseResult,
  ContSeg,
  PlotType,
  // Phase 2 overlay 类型
  OverlaysConfig,
  OverlayCallbacks,
  TangentSpec,
  NormalSpec,
  IntegralSpec,
  FeaturePointSpec,
  AnnotationSpec,
  RiemannSpec,
} from './types';

// 模块级 export(对齐 code-editing / canvas-rendering 双导出模式 — driver/slot
// 内部可直 import 兜底;view 侧仍走 requireCapabilityApi)
export { MathHost };
export { createEvalFn, extractParameters, numericalDerivative };
export { makeParametricFn, makePolarFn, makeVerticalLineX, makeImplicitFn, exprToLatex };
export { detectDiscontinuities, buildSegments };
export { detectPlotType };
export { latexToMathjs, latexToFunction, latexToFunctionWithEndpoints };
// Phase 2:全屏专用计算
export { derivative, secondDerivative, integrate, detectFeaturePoints };

// ── 自我诊断 ──
console.info('[math-rendering] alive | sdk: mafs + mathjs + compute-engine');

// ── Registry 注册 ──
capabilityRegistry.register({
  id: 'math-rendering',
  api: {
    Host: MathHost,
    createEvalFn,
    extractParameters,
    numericalDerivative,
    detectDiscontinuities,
    buildSegments,
    detectPlotType,
    latexToMathjs,
    latexToFunction,
    latexToFunctionWithEndpoints,
    makeParametricFn,
    makePolarFn,
    makeVerticalLineX,
    makeImplicitFn,
    exprToLatex,
    derivative,
    secondDerivative,
    integrate,
    detectFeaturePoints,
  } satisfies MathRenderingApi,
});
