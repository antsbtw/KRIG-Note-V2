/**
 * compute/latex-converter — LaTeX → mathjs 表达式转换
 *
 * 使用 @cortex-js/compute-engine (MIT) 将 LaTeX 解析为 MathJSON AST,
 * 然后将 MathJSON 转换为 mathjs 可求值的字符串表达式。
 *
 * compute-engine 完整覆盖教科书 LaTeX:
 * - 分数 \frac、根号 \sqrt[n]、绝对值 |x|
 * - 三角函数 \sin^2(x)、对数 \ln、指数 e^x
 * - 分段函数 \begin{cases}
 * - 希腊字母、比较运算符等
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/latex-to-mathjs.ts`。
 * 本文件是 V2 中**唯一** import `@cortex-js/compute-engine` 的位置(单点屏障)。
 */

import { ComputeEngine } from '@cortex-js/compute-engine';
import * as math from 'mathjs';
import type { EndpointInfo, PiecewiseResult } from '../types';

// 全局单例(避免重复初始化,~200ms 开销)
let ceInstance: InstanceType<typeof ComputeEngine> | null = null;
function getCE(): InstanceType<typeof ComputeEngine> {
  if (!ceInstance) ceInstance = new ComputeEngine();
  return ceInstance;
}

/** MathJSON 类型 */
type MathJSON = number | string | (string | MathJSON)[];

/** 预处理 LaTeX:修复 compute-engine 的已知解析问题 */
function preprocessLatex(input: string): string {
  let result = input;

  // cases 环境中去掉值与条件之间的逗号
  // \begin{cases} -x, & x < 0 → \begin{cases} -x & x < 0
  // compute-engine 会把逗号解析为 Tuple
  if (result.includes('\\begin{cases}')) {
    result = result.replace(/,\s*&/g, ' &');
  }

  return result;
}

/**
 * 将 LaTeX 表达式转换为 mathjs 表达式字符串。
 * 返回 null 表示转换失败。
 */
export function latexToMathjs(latex: string): string | null {
  if (!latex || !latex.trim()) return null;

  let input = latex.trim();

  // 去掉显示模式标记
  input = input.replace(/^\$+|\$+$/g, '');
  input = input.replace(/^\\\[|\\\]$/g, '');
  input = input.replace(/^\\\(|\\\)$/g, '');

  // 处理 = 号右边(如 "y = x^2 + 1" → "x^2 + 1")
  // 但不要匹配 \begin{cases} 中的 \leq 等
  if (!input.includes('\\begin{cases}')) {
    const eqMatch = input.match(/^[a-zA-Z]\s*(?:\([^)]*\))?\s*=\s*(.+)$/);
    if (eqMatch) input = eqMatch[1];
  }

  // 预处理 LaTeX
  input = preprocessLatex(input);

  try {
    const ce = getCE();
    const expr = ce.parse(input);
    const json = expr.json as MathJSON;

    // MathJSON → mathjs 字符串
    const result = mathJsonToMathjs(json);
    if (!result || result === 'UNSUPPORTED') {
      console.warn('[latexToMathjs] 不支持的表达式:', input, json);
      return null;
    }

    // 验证 mathjs 可解析
    math.parse(result);
    return result;
  } catch (err) {
    console.warn('[latexToMathjs] 解析失败:', input, err);
    return null;
  }
}

/**
 * 将 LaTeX 解析为函数 + 端点信息(分段函数用)。
 * 返回 null 表示转换失败。
 */
export function latexToFunctionWithEndpoints(latex: string): PiecewiseResult | null {
  if (!latex || !latex.trim()) return null;

  let input = latex.trim();
  input = input.replace(/^\$+|\$+$/g, '');
  input = input.replace(/^\\\[|\\\]$/g, '');
  input = input.replace(/^\\\(|\\\)$/g, '');
  if (!input.includes('\\begin{cases}')) {
    const eqMatch = input.match(/^[a-zA-Z]\s*(?:\([^)]*\))?\s*=\s*(.+)$/);
    if (eqMatch) input = eqMatch[1];
  }
  input = preprocessLatex(input);

  try {
    const ce = getCE();
    const expr = ce.parse(input);
    const json = expr.json as MathJSON;

    if (Array.isArray(json) && json[0] === 'Which') {
      return buildPiecewiseFull(json as (string | MathJSON)[]);
    }
    return null; // 非分段函数
  } catch {
    return null;
  }
}

export function latexToFunction(latex: string): ((x: number) => number) | null {
  if (!latex || !latex.trim()) return null;

  let input = latex.trim();
  input = input.replace(/^\$+|\$+$/g, '');
  input = input.replace(/^\\\[|\\\]$/g, '');
  input = input.replace(/^\\\(|\\\)$/g, '');
  if (!input.includes('\\begin{cases}')) {
    const eqMatch = input.match(/^[a-zA-Z]\s*(?:\([^)]*\))?\s*=\s*(.+)$/);
    if (eqMatch) input = eqMatch[1];
  }

  input = preprocessLatex(input);

  try {
    const ce = getCE();
    const expr = ce.parse(input);
    const json = expr.json as MathJSON;

    // 检查是否是分段函数
    if (Array.isArray(json) && json[0] === 'Which') {
      return buildPiecewiseFunction(json as (string | MathJSON)[]);
    }

    // 普通表达式:先转 mathjs,再编译为函数
    const mathjsExpr = mathJsonToMathjs(json);
    if (!mathjsExpr) return null;
    const compiled = math.compile(mathjsExpr);
    return (x: number) => {
      try {
        const result = compiled.evaluate({ x });
        return typeof result === 'number' && isFinite(result) ? result : NaN;
      } catch { return NaN; }
    };
  } catch {
    return null;
  }
}

// ─── MathJSON → mathjs 字符串 ───────────────────────────

/** 符号映射 */
const SYMBOL_MAP: Record<string, string> = {
  'Pi': 'pi',
  'ExponentialE': 'e',
  'ImaginaryUnit': 'i',
};

/**
 * MathJSON 操作符 → mathjs 表达式的映射表。
 *
 * 将 compute-engine 输出的 MathJSON AST 操作符映射为 mathjs 可求值的函数名。
 * 集中维护,新增操作符只需在此表中添加一行。
 */
const MATHJSON_TO_MATHJS: Record<string, string> = {
  // 三角函数
  Sin: 'sin', Cos: 'cos', Tan: 'tan',
  Cot: 'cot', Sec: 'sec', Csc: 'csc',
  // 反三角
  Arcsin: 'asin', Arccos: 'acos', Arctan: 'atan',
  // 双曲
  Sinh: 'sinh', Cosh: 'cosh', Tanh: 'tanh',
  // 反双曲(compute-engine 用 Ar- 前缀)
  Arsinh: 'asinh', Arcosh: 'acosh', Artanh: 'atanh',
  // 对数/指数
  Ln: 'log', Exp: 'exp', Lb: 'log2',
  // 取整/符号
  Floor: 'floor', Ceil: 'ceil', Round: 'round', Sign: 'sign',
  // 绝对值
  Abs: 'abs',
  // 根号
  Sqrt: 'sqrt',
  // 最大/最小
  Max: 'max', Min: 'min',
  // 阶乘 / 组合 / 数论
  Factorial: 'factorial',
  Gamma: 'gamma',
  GCD: 'gcd', LCM: 'lcm',
  Mod: 'mod',
};

/** 不可绘图的操作符 — 返回 UNSUPPORTED 以触发 UI 提示 */
const UNSUPPORTED_OPS = new Set([
  'Which',                          // 分段函数(在 latexToFunction 中单独处理)
  'Sum', 'Product',                 // 求和/连乘
  'Integrate', 'Limit',            // 积分/极限
  'Derivative',                     // 符号求导
  'Matrix', 'List', 'Tuple',       // 矩阵/列表
  'Error', 'LatexString',          // 解析错误
  'Function', 'Block', 'Limits',   // 辅助结构
]);

/** MathJSON AST → mathjs 表达式字符串 */
function mathJsonToMathjs(json: MathJSON): string {
  // 数字
  if (typeof json === 'number') return String(json);

  // 符号/变量
  if (typeof json === 'string') {
    return SYMBOL_MAP[json] || json;
  }

  // 表达式数组 [operator, ...args]
  if (!Array.isArray(json) || json.length === 0) return '';

  const [op, ...args] = json;
  if (typeof op !== 'string') return '';

  const a = args.map((arg) => mathJsonToMathjs(arg as MathJSON));

  // 不可绘图的操作符
  if (UNSUPPORTED_OPS.has(op)) return 'UNSUPPORTED';

  switch (op) {
    // 算术
    case 'Add':       return '(' + a.join(' + ') + ')';
    case 'Subtract':  return '(' + a[0] + ' - ' + a[1] + ')';
    case 'Negate':    return '(-(' + a[0] + '))';
    case 'Multiply':  return '(' + a.join(' * ') + ')';
    case 'Divide':    return '((' + a[0] + ') / (' + a[1] + '))';
    case 'Power':     return '(' + a[0] + ')^(' + a[1] + ')';
    case 'Root':      return 'nthRoot(' + a[0] + ', ' + a[1] + ')';
    case 'Rational':  return '((' + a[0] + ') / (' + a[1] + '))';

    // Log 需要特殊处理(底数参数)
    case 'Log':       return a.length > 1 ? 'log(' + a[0] + ') / log(' + a[1] + ')' : 'log10(' + a[0] + ')';

    // 比较运算(用于分段函数条件)
    case 'Less':      return a[0] + ' < ' + a[1];
    case 'LessEqual': return a[0] + ' <= ' + a[1];
    case 'Greater':   return a[0] + ' > ' + a[1];
    case 'GreaterEqual': return a[0] + ' >= ' + a[1];
    case 'Equal':     return a[0] + ' == ' + a[1];
    case 'NotEqual':  return a[0] + ' != ' + a[1];

    // 逻辑
    case 'And':       return '(' + a.join(' and ') + ')';
    case 'Or':        return '(' + a.join(' or ') + ')';
    case 'Not':       return 'not(' + a[0] + ')';

    default: {
      // 查映射表
      const mathjsFn = MATHJSON_TO_MATHJS[op];
      if (mathjsFn) return mathjsFn + '(' + a.join(', ') + ')';

      // 最终 fallback:将操作符名转小写,尝试当作 mathjs 函数
      // 如果 mathjs 不认识,会在外层 math.parse() 验证时报错
      const fallback = op.toLowerCase() + '(' + a.join(', ') + ')';
      try {
        math.parse(fallback);
        return fallback;
      } catch {
        console.warn('[mathJsonToMathjs] 未知操作符:', op, '→ fallback 失败');
        return 'UNSUPPORTED';
      }
    }
  }
}

// ─── 分段函数 → JavaScript 函数 ─────────────────────────

/** 构建分段函数的 JavaScript 求值函数 + 提取边界端点 */
function buildPiecewiseFunction(json: (string | MathJSON)[]): ((x: number) => number) | null {
  const result = buildPiecewiseFull(json);
  return result ? result.evalFn : null;
}

/** 完整版:返回求值函数 + 端点信息 */
export function buildPiecewiseFull(json: (string | MathJSON)[]): PiecewiseResult | null {
  // MathJSON: ["Which", cond1, val1, cond2, val2, ...]
  const pairs: Array<{ cond: MathJSON; val: MathJSON }> = [];
  for (let i = 1; i < json.length; i += 2) {
    if (i + 1 < json.length) {
      pairs.push({ cond: json[i] as MathJSON, val: json[i + 1] as MathJSON });
    }
  }
  if (pairs.length === 0) return null;

  // 编译每个分支
  const branches = pairs.map(({ cond, val }) => ({
    condFn: buildConditionFn(cond),
    valExpr: mathJsonToMathjs(val),
    cond,
  }));

  // 编译值表达式
  const compiledVals = branches.map((b) => {
    try { return math.compile(b.valExpr); } catch { return null; }
  });

  // 提取端点信息
  const endpoints: EndpointInfo[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const extracted = extractEndpointsFromCondition(pairs[i].cond, i);
    endpoints.push(...extracted);
  }

  const evalFn = (x: number) => {
    for (let i = 0; i < branches.length; i++) {
      if (branches[i].condFn(x) && compiledVals[i]) {
        try {
          const result = compiledVals[i]!.evaluate({ x });
          return typeof result === 'number' && isFinite(result) ? result : NaN;
        } catch { return NaN; }
      }
    }
    return NaN;
  };

  return { evalFn, endpoints };
}

/**
 * 从 MathJSON 条件中提取边界端点。
 *
 * 示例:
 * ["Less", "x", 1]         → x < 1  → 端点 x=1, closed=false
 * ["LessEqual", 0, "x", 1] → 0 ≤ x ≤ 1 → 端点 x=0 closed=true, x=1 closed=true
 * ["Greater", "x", 2]      → x > 2  → 端点 x=2, closed=false
 * ["GreaterEqual", 1, "x"] → x ≥ 1  → 端点 x=1, closed=true
 */
function extractEndpointsFromCondition(cond: MathJSON, branchIndex: number): EndpointInfo[] {
  if (!Array.isArray(cond) || cond.length < 3) return [];

  const op = cond[0] as string;
  const operands = cond.slice(1) as MathJSON[];

  // 尝试求值每个操作数为常数
  const vals: Array<{ expr: string; value: number | null }> = operands.map((o) => {
    const expr = mathJsonToMathjs(o);
    // 检查是否是常数(不含 x)
    if (expr === 'x' || expr.includes('x')) return { expr, value: null };
    try {
      const v = math.evaluate(expr);
      return { expr, value: typeof v === 'number' && isFinite(v) ? v : null };
    } catch { return { expr, value: null }; }
  });

  const result: EndpointInfo[] = [];
  const isClosed = op === 'LessEqual' || op === 'GreaterEqual';

  // 对于每对相邻操作数 (a, b),非 x 的那个是边界值
  for (let i = 0; i < vals.length - 1; i++) {
    const left = vals[i];
    const right = vals[i + 1];

    // 常数 op x → 左边界
    if (left.value !== null && right.value === null) {
      result.push({ x: left.value, closed: isClosed, branchIndex });
    }
    // x op 常数 → 右边界
    if (left.value === null && right.value !== null) {
      result.push({ x: right.value, closed: isClosed, branchIndex });
    }
  }

  return result;
}

/** 比较两个值 */
function compare(op: string, a: number, b: number): boolean {
  switch (op) {
    case 'Less': return a < b;
    case 'LessEqual': return a <= b;
    case 'Greater': return a > b;
    case 'GreaterEqual': return a >= b;
    case 'Equal': return a === b;
    case 'NotEqual': return a !== b;
    default: return true;
  }
}

/** 构建条件判断函数 */
function buildConditionFn(cond: MathJSON): (x: number) => boolean {
  if (!Array.isArray(cond) || cond.length < 3) return () => true;

  const op = cond[0] as string;
  const operands = (cond.slice(1) as MathJSON[]).map((o) => mathJsonToMathjs(o));

  // 编译所有操作数
  let compiled: math.EvalFunction[];
  try {
    compiled = operands.map((expr) => math.compile(expr));
  } catch {
    return () => true;
  }

  return (x: number) => {
    try {
      const vals = compiled.map((c) => c.evaluate({ x }) as number);

      // 链式比较:["LessEqual", 0, "x", 1] → 0 ≤ x ≤ 1
      // 每对相邻值都满足 op 才为 true
      for (let i = 0; i < vals.length - 1; i++) {
        if (!compare(op, vals[i], vals[i + 1])) return false;
      }
      return true;
    } catch { return false; }
  };
}
