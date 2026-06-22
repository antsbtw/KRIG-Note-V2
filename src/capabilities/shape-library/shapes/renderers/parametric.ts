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
  EvaluatedHandle,
  EvaluatedPath,
  PathCmd,
  ShapeDef,
} from '../../types';
import { buildEnv, evalFormula, type EvalEnv } from './formula-eval';

/**
 * 求值 shape 的 param 拖点位置(L5-G6c §3.5 B2.1)。
 *
 * 每个 handle 的 `from` 公式求值出沿 axis 的坐标;cross-axis 取 shape 中心
 * (axis='x' → y=vc;axis='y' → x=hc),便于看见与拖动。
 * 无 handles / 非 parametric(svg/text 无 param)→ 返空数组。
 */
export function evaluateHandles(shape: ShapeDef, ctx: EvaluateContext): EvaluatedHandle[] {
  if (shape.geometry.kind !== 'parametric' || !shape.handles?.length) return [];
  const env = buildEnv(shape, ctx.width, ctx.height, ctx.params);
  const out: EvaluatedHandle[] = [];
  shape.handles.forEach((h, index) => {
    let pos: number;
    try {
      pos = evalFormula(h.from, env);
    } catch (e) {
      console.warn(`[shape-library] handle[${index}] from 求值失败 (${shape.id}):`, e);
      return;
    }
    const x = h.axis === 'x' ? pos : ctx.width / 2;
    const y = h.axis === 'y' ? pos : ctx.height / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    out.push({ index, param: h.param, axis: h.axis, unit: h.unit, x, y });
  });
  return out;
}

/**
 * 求值入口.
 * - id 不存在 / shape.geometry.kind !== 'parametric' / shape.path 缺失 → 返 null
 *   (调用方需要 fallback 渲染 — 如 svg 走 path-to-three、text 走文字层)
 */
export function evaluateShape(
  shape: ShapeDef,
  ctx: EvaluateContext,
): EvaluatedPath | null {
  // svg kind(L5-G6c B1.2):svgPath 已是归一化绝对 d(在 viewBox 空间),
  // 按 target/viewBox 缩放到节点尺寸 → EvaluatedPath(复用 pathToThree 渲染)。
  if (shape.geometry.kind === 'svg') return evaluateSvg(shape, ctx);

  if (shape.geometry.kind !== 'parametric') return null;
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

/**
 * 拖动反算 param(L5-G6c §3.5 B2.2)。
 *
 * handle 沿 axis 的位置 = `from(param)`(任意单调公式)。拖动给出沿 axis 的
 * shape-local 位移 `axisDelta`(px)。用**数值灵敏度** `dPos/dParam`(在起始 param
 * 处 ±ε 求导)把位移换算回 param 增量,夹 min/max:
 *   newParam = startParam + axisDelta / sensitivity
 *
 * 这样无需符号反演,px(sensitivity≈±1)/ ratio(sensitivity≈±w/h)自然各归各:
 * px 拖 1px → param 变 1;ratio 拖 1px → param 变 1/refDim。灵敏度≈0(from 与该
 * param 无关)→ 返 startParam 不动(fail safe)。
 *
 * @param startParams 拖动起始时的完整 params(应用 default + override 后)
 * @param handleIdx   shape.handles[] 下标
 * @param axisDelta   沿 handle.axis 的 shape-local 位移(px)
 */
export function reverseParamFromDrag(
  shape: ShapeDef,
  ctx: EvaluateContext,
  handleIdx: number,
  axisDelta: number,
  startParams: Record<string, number>,
): { param: string; value: number } | null {
  const h = shape.handles?.[handleIdx];
  if (!h || !shape.params?.[h.param]) return null;
  const def = shape.params[h.param];
  const p0 = startParams[h.param] ?? def.default;

  const posAt = (pv: number): number => {
    const env = buildEnv(shape, ctx.width, ctx.height, { ...startParams, [h.param]: pv });
    return evalFormula(h.from, env);
  };
  const eps = 0.001;
  const sensitivity = (posAt(p0 + eps) - posAt(p0 - eps)) / (2 * eps);
  if (!Number.isFinite(sensitivity) || Math.abs(sensitivity) < 1e-6) {
    return { param: h.param, value: p0 }; // from 与该 param 无关 → 不动(fail safe)
  }
  let value = p0 + axisDelta / sensitivity;
  if (def.min !== undefined) value = Math.max(def.min, value);
  if (def.max !== undefined) value = Math.min(def.max, value);
  return { param: h.param, value };
}

/** 4 位小数 */
function num(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * svg kind 求值(L5-G6c B1.2):svgPath(viewBox 空间的归一化绝对 d)→
 * 缩放到 ctx.width × ctx.height 的 EvaluatedPath。
 *
 * 不走公式;magnets 归一化 × 尺寸(同 parametric);textBox 缺省整框(默认 undefined,
 * NodeRenderer 兜底 {0,0,w,h};def 显式给 textBox 时透传缩放后值)。
 */
function evaluateSvg(shape: ShapeDef, ctx: EvaluateContext): EvaluatedPath | null {
  const svgPath = shape.geometry.svgPath;
  if (!svgPath) return null;
  const vb = shape.geometry.viewBox ?? shape.viewBox;
  if (!vb || vb.w <= 0 || vb.h <= 0) return null;
  const sx = ctx.width / vb.w;
  const sy = ctx.height / vb.h;
  const d = scaleSvgPathD(svgPath, sx, sy);
  const magnets = (shape.magnets ?? []).map((m) => ({
    id: m.id,
    x: m.x * ctx.width,
    y: m.y * ctx.height,
  }));
  // textBox:svg def 一般缺省整框(undefined);若 def 给了归一化/公式 textBox 则当 viewBox 比例缩放
  const textBox = shape.textBox
    ? {
        l: evalFormula(shape.textBox.l, buildEnv(shape, ctx.width, ctx.height, ctx.params)),
        t: evalFormula(shape.textBox.t, buildEnv(shape, ctx.width, ctx.height, ctx.params)),
        r: evalFormula(shape.textBox.r, buildEnv(shape, ctx.width, ctx.height, ctx.params)),
        b: evalFormula(shape.textBox.b, buildEnv(shape, ctx.width, ctx.height, ctx.params)),
      }
    : undefined;
  return { d, width: ctx.width, height: ctx.height, magnets, textBox };
}

/**
 * 缩放空格分隔绝对 d 的坐标(svg kind 从 viewBox 空间映到节点尺寸)。
 * 命令是归一化子集 M/L/A/Q/C/Z(svg-to-shapedef 已保证):
 * - M/L:x*sx y*sy
 * - Q:x1*sx y1*sy x*sx y*sy
 * - C:x1 y1 x2 y2 x y(各乘对应轴)
 * - A:rx*sx ry*sy rot large sweep x*sx y*sy(rot/flags 不缩放)
 * - Z:原样
 */
function scaleSvgPathD(d: string, sx: number, sy: number): string {
  const tokens = d.trim().split(/\s+/);
  const out: string[] = [];
  let i = 0;
  const take = (n: number): number[] => {
    const r = tokens.slice(i + 1, i + 1 + n).map(Number);
    i += 1 + n;
    return r;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    switch (t) {
      case 'M': case 'L': {
        const [x, y] = take(2);
        out.push(`${t} ${num(x * sx)} ${num(y * sy)}`);
        break;
      }
      case 'Q': {
        const [x1, y1, x, y] = take(4);
        out.push(`Q ${num(x1 * sx)} ${num(y1 * sy)} ${num(x * sx)} ${num(y * sy)}`);
        break;
      }
      case 'C': {
        const [x1, y1, x2, y2, x, y] = take(6);
        out.push(`C ${num(x1 * sx)} ${num(y1 * sy)} ${num(x2 * sx)} ${num(y2 * sy)} ${num(x * sx)} ${num(y * sy)}`);
        break;
      }
      case 'A': {
        const a = take(7); // rx ry rot large sweep x y
        out.push(`A ${num(a[0] * sx)} ${num(a[1] * sy)} ${num(a[2])} ${a[3] ? 1 : 0} ${a[4] ? 1 : 0} ${num(a[5] * sx)} ${num(a[6] * sy)}`);
        break;
      }
      case 'Z':
        out.push('Z');
        i += 1;
        break;
      default:
        i += 1; // 跳过未知 token(防死循环)
        break;
    }
  }
  return out.join(' ');
}
