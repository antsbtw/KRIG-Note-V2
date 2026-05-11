/**
 * Parametric shape 求值器(L5-G2)
 *
 * V1 直迁:src/plugins/graph/library/shapes/renderers/parametric.ts(103 行).
 * V2 改动(决策 G2-3 / G2-4):
 * - 函数名 `renderParametric` → `evaluateShape`(语义"求值",对齐 ShapeLibraryApi.evaluate)
 * - 返回类型 `RenderOutput`(含 `kind: 'svg-path' | 'three-mesh' | ...` 联合)
 *   → 直接返回 `EvaluatedPath`(纯数据,**0 含 THREE.* 字面量**,P1-1 屏障核心)
 *
 * 输出 EvaluatedPath:
 *   { d: "M 0 0 L 100 0 ...", width, height, magnets, textBox? }
 *
 * 路径数值用 4 位小数四舍五入(避免浮点漂移产生过长字符串).
 *
 * canvas-rendering 内部把 d 字符串喂给 path-to-three 工具,转 THREE.Shape → Mesh
 * (G3 实现;本 capability 0 知道 three).
 */

import type {
  EvaluateContext,
  EvaluatedPath,
  PathCmd,
  ShapeDef,
} from '../../types';
import { buildEnv, evalFormula, type EvalEnv } from './formula-eval';

/**
 * 求值入口.
 * - id 不存在 / shape.renderer !== 'parametric' / shape.path 缺失 → 返 null
 *   (调用方需要 fallback 渲染 — 如 text label 走 static-svg / custom)
 */
export function evaluateShape(
  shape: ShapeDef,
  ctx: EvaluateContext,
): EvaluatedPath | null {
  if (shape.renderer !== 'parametric') return null;
  if (!shape.path) return null;

  const env = buildEnv(shape, ctx.width, ctx.height, ctx.params);
  const d = pathToSvg(shape.path, env);
  const magnets = (shape.magnets ?? []).map((m) => ({
    id: m.id,
    x: m.x * ctx.width,
    y: m.y * ctx.height,
  }));
  const textBox = shape.textBox
    ? {
        l: evalFormula(shape.textBox.l, env),
        t: evalFormula(shape.textBox.t, env),
        r: evalFormula(shape.textBox.r, env),
        b: evalFormula(shape.textBox.b, env),
      }
    : undefined;

  return {
    d,
    width: ctx.width,
    height: ctx.height,
    magnets,
    textBox,
  };
}

/** 把 PathCmd[] 串成 SVG d 字符串 */
function pathToSvg(path: PathCmd[], env: EvalEnv): string {
  const parts: string[] = [];
  for (const cmd of path) {
    switch (cmd.cmd) {
      case 'M':
      case 'L':
        parts.push(
          `${cmd.cmd} ${num(evalFormula(cmd.x, env))} ${num(evalFormula(cmd.y, env))}`,
        );
        break;
      case 'A': {
        const rx = num(evalFormula(cmd.rx, env));
        const ry = num(evalFormula(cmd.ry, env));
        const x = num(evalFormula(cmd.x, env));
        const y = num(evalFormula(cmd.y, env));
        const large = cmd['large-arc-flag'] ?? 0;
        const sweep = cmd['sweep-flag'] ?? 1;
        // SVG arc:rx ry x-axis-rotation large-arc-flag sweep-flag x y
        parts.push(`A ${rx} ${ry} 0 ${large} ${sweep} ${x} ${y}`);
        break;
      }
      case 'Q':
        parts.push(
          `Q ${num(evalFormula(cmd.x1, env))} ${num(evalFormula(cmd.y1, env))} ` +
            `${num(evalFormula(cmd.x, env))} ${num(evalFormula(cmd.y, env))}`,
        );
        break;
      case 'C':
        parts.push(
          `C ${num(evalFormula(cmd.x1, env))} ${num(evalFormula(cmd.y1, env))} ` +
            `${num(evalFormula(cmd.x2, env))} ${num(evalFormula(cmd.y2, env))} ` +
            `${num(evalFormula(cmd.x, env))} ${num(evalFormula(cmd.y, env))}`,
        );
        break;
      case 'Z':
        parts.push('Z');
        break;
    }
  }
  return parts.join(' ');
}

/** 4 位小数 */
function num(v: number): number {
  return Math.round(v * 10000) / 10000;
}
