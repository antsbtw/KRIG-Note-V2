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
  const independentVars = new Set(['x', 't', 'theta']);
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
