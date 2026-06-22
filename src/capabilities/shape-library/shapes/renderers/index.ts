/**
 * shape-library renderers barrel(L5-G2)
 *
 * 对外仅暴露 evaluateShape + formula-eval 工具,**0 暴露 path-to-three**.
 *
 * V1 同 barrel 含 `shapeToThree / pathToThree`(import three),V2 严格屏障
 * (P1-1)下不允许 — 这部分迁到 capabilities/canvas-rendering/scene/path-to-three.ts
 * (G3 段实施).
 */

export { evaluateShape } from './parametric';
export { evalFormula, buildEnv, scaleParam } from './formula-eval';
export type { EvalEnv } from './formula-eval';
