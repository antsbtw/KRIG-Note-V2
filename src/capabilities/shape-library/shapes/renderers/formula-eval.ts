import type { FormulaOp, FormulaValue, ShapeDef } from '../../types';

/**
 * Formula evaluator — 实现 OOXML 17 个操作符 + 内置标识符(L5-G2)
 *
 * V1 直迁:src/plugins/graph/library/shapes/renderers/formula-eval.ts(203 行).
 * 纯数学,**0 三方依赖,0 import three**(P1-1 屏障安全).
 *
 * 详见 docs/10-business-design/graph/library/Library.md §2.2
 *
 * 求值环境:
 * - w, h:节点宽 / 高(由调用者注入)
 * - ss:short side = min(w, h)
 * - wd2..wd32 / hd2..hd32:w / h 除以 N
 * - cd2, cd4, cd8:OOXML 圆周分度(180°/90°/45°,用度数)
 * - t/l/r/b/hc/vc:0/0/w/h/w/2/h/2
 * - 用户 params(经过 default + 覆盖)
 * - 用户 guides(在 path 求值前已展开成数字)
 *
 * 备注:
 * - 字符串可以是单个标识符("w"/"rad"),也可以是简单加减表达式("w - rad"
 *   "h - rad"等),后者来自 Library.md spec 示例。简单表达式用一个轻量 tokenizer
 *   处理,只支持 + 和 - 二元中缀,不支持嵌套括号(进一步复杂的请用 op 形式)。
 */

export interface EvalEnv {
  /** 节点尺寸 */
  w: number;
  h: number;
  /** 用户 params 值(已应用 default + override) */
  params: Record<string, number>;
  /** 已求值的 guides */
  guides: Record<string, number>;
}

const DEG = Math.PI / 180;

/** 内置标识符(只读,根据 w/h 动态计算) */
function builtinIdent(name: string, env: EvalEnv): number | undefined {
  const { w, h } = env;
  switch (name) {
    case 'w': return w;
    case 'h': return h;
    case 'ss': return Math.min(w, h);
    case 't': return 0;
    case 'l': return 0;
    case 'r': return w;
    case 'b': return h;
    case 'hc': return w / 2;
    case 'vc': return h / 2;
    // OOXML 圆周分度(度数)
    case 'cd2': return 180;
    case 'cd4': return 90;
    case 'cd8': return 45;
  }
  // wd2..wd32 / hd2..hd32
  const m = /^([wh])d(\d+)$/.exec(name);
  if (m) {
    const base = m[1] === 'w' ? w : h;
    const div = Number(m[2]);
    if (div > 0) return base / div;
  }
  return undefined;
}

/** 解析单个标识符或字面值字符串 */
function resolveIdent(name: string, env: EvalEnv): number {
  const trimmed = name.trim();
  // 数字字面量
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  // params.X 形式(handle from 字段会用)
  const paramMatch = /^params\.(\w+)$/.exec(trimmed);
  if (paramMatch) {
    const v = env.params[paramMatch[1]];
    if (v === undefined) {
      throw new Error(`[formula-eval] unknown param: ${paramMatch[1]}`);
    }
    return v;
  }
  // params 直接引用(裸名)— 优先于 builtin,允许 shape 用 'r' 等
  // 名字作为 param 而不被 builtin('r' = w)抢走
  if (trimmed in env.params) return env.params[trimmed];
  // guides — 同理优先于 builtin
  if (trimmed in env.guides) return env.guides[trimmed];
  // 内置(最后兜底)
  const built = builtinIdent(trimmed, env);
  if (built !== undefined) return built;
  throw new Error(`[formula-eval] unknown identifier: ${trimmed}`);
}

/** 简单加减表达式(只支持 + 和 - 二元中缀,不嵌套括号)*/
function evalSimpleExpr(expr: string, env: EvalEnv): number {
  // 拆 token:数字 / 标识符(可含点)/ 操作符
  const tokens: Array<{ kind: 'num' | 'op'; value: string }> = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch === '+' || ch === '-') {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    // 标识符或数字字面量
    let j = i;
    while (j < expr.length && expr[j] !== '+' && expr[j] !== '-' && expr[j] !== ' ' && expr[j] !== '\t') {
      j++;
    }
    tokens.push({ kind: 'num', value: expr.slice(i, j) });
    i = j;
  }
  if (tokens.length === 0) throw new Error(`[formula-eval] empty expression`);
  if (tokens[0].kind !== 'num') throw new Error(`[formula-eval] expression must start with a value: "${expr}"`);
  let acc = resolveIdent(tokens[0].value, env);
  for (let k = 1; k < tokens.length; k += 2) {
    const op = tokens[k];
    const rhs = tokens[k + 1];
    if (op?.kind !== 'op' || rhs?.kind !== 'num') {
      throw new Error(`[formula-eval] malformed expression: "${expr}"`);
    }
    const v = resolveIdent(rhs.value, env);
    acc = op.value === '+' ? acc + v : acc - v;
  }
  return acc;
}

/** 字符串求值入口(单标识符 / 数字 / 简单加减表达式) */
function evalString(s: string, env: EvalEnv): number {
  const trimmed = s.trim();
  if (trimmed.includes('+') || trimmed.includes('-')) {
    // 排除负号字面量(如 "-5")— 第一个字符是 - 且其后没有运算符,视作字面值
    const isNegLit = trimmed[0] === '-' && !/[\+\-]/.test(trimmed.slice(1));
    if (isNegLit) return Number(trimmed);
    return evalSimpleExpr(trimmed, env);
  }
  return resolveIdent(trimmed, env);
}

/** 主求值入口 */
export function evalFormula(v: FormulaValue, env: EvalEnv): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return evalString(v, env);
  return evalOp(v, env);
}

function evalOp(node: FormulaOp, env: EvalEnv): number {
  const args = node.args.map((a) => evalFormula(a, env));
  switch (node.op) {
    case '*/':  return (args[0] * args[1]) / args[2];
    case '+-':  return (args[0] + args[1]) - args[2];
    case '+/':  return (args[0] + args[1]) / args[2];
    case 'abs': return Math.abs(args[0]);
    case 'sqrt':return Math.sqrt(args[0]);
    case 'mod': return Math.sqrt(args[0] * args[0] + args[1] * args[1] + args[2] * args[2]);
    case 'pin': return Math.max(args[0], Math.min(args[1], args[2]));
    case 'max': return Math.max(args[0], args[1]);
    case 'min': return Math.min(args[0], args[1]);
    case 'val': return args[0];
    case 'sin': return args[0] * Math.sin(args[1] * DEG);
    case 'cos': return args[0] * Math.cos(args[1] * DEG);
    case 'tan': return args[0] * Math.tan(args[1] * DEG);
    case 'at2': return Math.atan2(args[1], args[0]) / DEG;          // 返回度数
    case 'cat2':return args[0] * Math.cos(Math.atan2(args[2], args[1]));
    case 'sat2':return args[0] * Math.sin(Math.atan2(args[2], args[1]));
    case '?:':  return args[0] > 0 ? args[1] : args[2];
  }
  throw new Error(`[formula-eval] unknown op: ${(node as { op: string }).op}`);
}

/**
 * 给定 ShapeDef + 用户 param overrides + 节点尺寸,生成完整的 EvalEnv
 * (params 应用 default,guides 按声明顺序求值,允许后置 guide 引用前置)
 */
export function buildEnv(
  shape: ShapeDef,
  width: number,
  height: number,
  paramOverrides?: Record<string, number>,
): EvalEnv {
  const params: Record<string, number> = {};
  if (shape.params) {
    for (const name in shape.params) {
      const def = shape.params[name];
      const val = paramOverrides?.[name];
      params[name] = clamp(
        val !== undefined ? val : def.default,
        def.min,
        def.max,
      );
    }
  }
  const guides: Record<string, number> = {};
  const env: EvalEnv = { w: width, h: height, params, guides };
  if (shape.guides) {
    for (const g of shape.guides) {
      // guide 体本身就是一个 op(只是字段名拆开存):重组成 FormulaOp 求值
      guides[g.name] = evalOp({ op: g.op, args: g.args }, env);
    }
  }
  return env;
}

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}
