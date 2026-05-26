/**
 * compute/evaluator — 表达式 → 求值函数 + 参数提取 + 数值微分
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/utils.ts`(求值/参数/微分部分)。
 * 间断检测与连续段拆到 ./discontinuity.ts;plotType 启发式拆到 ./plot-detect.ts。
 */

import * as math from 'mathjs';
import type { EvalResult, MathParameter } from '../types';
import {
  latexToFunction,
  latexToFunctionWithEndpoints,
} from './latex-converter';

// ─── 求值 ─────────────────────────────────────────────────

/**
 * 表达式 → 求值函数。
 *
 * 三段式 fallback:
 * 1. mathjs 编译(覆盖 95% 教科书表达式)
 * 2. LaTeX 分段函数(\begin{cases} ...)
 * 3. LaTeX 普通表达式
 * 4. sourceLatex(拖入 mathBlock 时保留的原始 LaTeX)
 */
export function createEvalFn(
  expression: string,
  params: MathParameter[],
  sourceLatex?: string,
): EvalResult {
  if (!expression.trim()) return { fn: null, error: null, endpoints: [] };

  // 1. mathjs 编译
  try {
    const compiled = math.compile(expression);
    return {
      fn: (x: number) => {
        const scope: Record<string, number> = { x };
        for (const p of params) scope[p.name] = p.value;
        try {
          const result = compiled.evaluate(scope);
          return typeof result === 'number' && isFinite(result) ? result : NaN;
        } catch {
          return NaN;
        }
      },
      error: null,
      endpoints: [],
    };
  } catch { /* mathjs 编译失败 */ }

  // 2. LaTeX 解析(分段函数优先)
  const piecewise = latexToFunctionWithEndpoints(expression);
  if (piecewise) return { fn: piecewise.evalFn, error: null, endpoints: piecewise.endpoints };

  const fnFromExpr = latexToFunction(expression);
  if (fnFromExpr) return { fn: fnFromExpr, error: null, endpoints: [] };

  // 3. sourceLatex
  if (sourceLatex) {
    const pw = latexToFunctionWithEndpoints(sourceLatex);
    if (pw) return { fn: pw.evalFn, error: null, endpoints: pw.endpoints };

    const fnFromLatex = latexToFunction(sourceLatex);
    if (fnFromLatex) return { fn: fnFromLatex, error: null, endpoints: [] };
  }

  return { fn: null, error: '无法解析此表达式', endpoints: [] };
}

// ─── 参数提取 ─────────────────────────────────────────────

const BUILTIN_NAMES = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sqrt', 'abs', 'log', 'log2', 'log10', 'exp', 'pow',
  'floor', 'ceil', 'round', 'sign', 'min', 'max',
  'pi', 'e', 'PI', 'E', 'i',
  'sinh', 'cosh', 'tanh',
]);

/**
 * 从表达式中提取 free symbols(用户参数名)。
 * 排除独立变量(x/t/theta)与 mathjs 内置函数 / 常量。
 */
export function extractParameters(expression: string): string[] {
  const independentVars = new Set(['x', 'y', 't', 'theta']);
  try {
    const parts = expression.includes(';') ? expression.split(';') : [expression];
    const vars = new Set<string>();
    for (const part of parts) {
      const node = math.parse(part.trim());
      node.traverse((n) => {
        if (n.type === 'SymbolNode') {
          const name = (n as math.SymbolNode).name;
          if (!independentVars.has(name) && !BUILTIN_NAMES.has(name)) vars.add(name);
        }
      });
    }
    return Array.from(vars).sort();
  } catch {
    return [];
  }
}

// ─── 数值微分 ─────────────────────────────────────────────

/** 数值微分(中心差分,h=1e-6) */
export function numericalDerivative(fn: (x: number) => number): (x: number) => number {
  const h = 1e-6;
  return (x: number) => (fn(x + h) - fn(x - h)) / (2 * h);
}

// ─── 工厂 API:parametric / polar / vertical-line ────────────

/**
 * 参数方程 "x(t);y(t)" → (t) => [x, y] | null。
 * 内部按分号拆两段,分别 mathjs 编译;失败返 null(整个曲线不渲染)。
 *
 * 接 V1 MathVisualComponent.tsx:298-318 的 parametric 分支逻辑,把 mathjs 调用
 * 收敛到 capability 内,driver 不直 import mathjs。
 */
export function makeParametricFn(
  expression: string,
  params: MathParameter[],
): ((t: number) => [number, number]) | null {
  const parts = expression.split(';').map((s) => s.trim());
  if (parts.length !== 2) return null;
  try {
    const compiledX = math.compile(parts[0]);
    const compiledY = math.compile(parts[1]);
    return (t: number) => {
      try {
        const scope: Record<string, number> = { t };
        for (const p of params) scope[p.name] = p.value;
        return [compiledX.evaluate(scope) as number, compiledY.evaluate(scope) as number];
      } catch {
        return [NaN, NaN];
      }
    };
  } catch {
    return null;
  }
}

/**
 * 极坐标 r(theta) → (theta) => r。
 * driver 拿到 r(theta) 后,可直接构造 `{ kind: 'polar', r, thetaDomain }`
 * (MathHost 内部转 [r·cos θ, r·sin θ]),也可调 makeParametricFn 自己拼。
 *
 * 接 V1 MathVisualComponent.tsx:321-337 的 polar 分支(分号语法独立 polar 不用)。
 */
export function makePolarFn(
  expression: string,
  params: MathParameter[],
): ((theta: number) => number) | null {
  try {
    const compiled = math.compile(expression);
    return (theta: number) => {
      try {
        // V1 同时支持 theta 和 t(用于"以 t 命名极坐标变量")
        const scope: Record<string, number> = { theta, t: theta };
        for (const p of params) scope[p.name] = p.value;
        const r = compiled.evaluate(scope) as number;
        return typeof r === 'number' && isFinite(r) ? r : NaN;
      } catch {
        return NaN;
      }
    };
  } catch {
    return null;
  }
}

/**
 * "x = <常数>" 表达式(由 detectPlotType 归一化后已经是纯数字字符串)→ 数值。
 * 失败(非有限数)返 null,driver 应当跳过该曲线。
 *
 * driver 拿到值 c 后构造 `{ kind: 'verticalLine', x: c }`。
 */
export function makeVerticalLineX(expression: string): number | null {
  const v = Number(expression);
  return isFinite(v) ? v : null;
}

/**
 * 隐式方程 F(x,y) → (x, y) => F | null。
 * expression 由 detectPlotType 归一化为 "left - (right)" 形式(F(x,y)=0 的左边);
 * mathjs 单次编译,scope 每次注入 x/y/参数。失败返 null。
 *
 * driver 拿到 fn 后构造 `{ kind: 'implicit', fn, resolution }`,
 * MathHost 内部 marching squares 算等值线。
 */
export function makeImplicitFn(
  expression: string,
  params: MathParameter[],
): ((x: number, y: number) => number) | null {
  try {
    const compiled = math.compile(expression);
    return (x: number, y: number) => {
      try {
        const scope: Record<string, number> = { x, y };
        for (const p of params) scope[p.name] = p.value;
        const v = compiled.evaluate(scope) as number;
        return typeof v === 'number' && isFinite(v) ? v : NaN;
      } catch {
        return NaN;
      }
    };
  } catch {
    return null;
  }
}

/**
 * mathjs 表达式 → LaTeX 字符串(供 KaTeX 渲染用)。失败返 null。
 *
 * V1 KaTexHelpers.tsx 内 exprToLatex 同等效用,driver 不再 import mathjs。
 * Fallback 策略:mathjs 不识别 + 表达式含 \\/^/_ 时按 LaTeX 字面直返(用户可能粘 LaTeX)。
 */
export function exprToLatex(expression: string): string | null {
  if (!expression.trim()) return null;
  try {
    return math.parse(expression).toTex();
  } catch { /* not mathjs syntax */ }
  if (expression.includes('\\') || expression.includes('^') || expression.includes('_')) {
    return expression;
  }
  return null;
}
