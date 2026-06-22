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
