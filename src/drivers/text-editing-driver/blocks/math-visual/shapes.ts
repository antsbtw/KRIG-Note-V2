/**
 * math-visual 几何对象 —— 纯函数(题意图 P1,2026-11-06)
 *
 * 设计稿:docs/10-business-design/math/题意图-几何对象与分帧设计.md §3.1
 *
 * 不 import capability 实现(求值函数由调用方注入),单测直接跑。
 */

import type { ShapeSpec, ScalarResult, MathParameter } from '@capabilities/math-rendering/types';
import type { ShapeEntry, ShapeKind, CoordExpr } from './types';
import { FUNCTION_COLORS } from './types';

export type Vec2 = [number, number];

export const SHAPE_KINDS: Array<{ kind: ShapeKind; icon: string; label: string; clicks: 1 | 2; hint: string }> = [
  { kind: 'point',   icon: '•', label: '点',   clicks: 1, hint: '点一下放一个点' },
  { kind: 'segment', icon: '╱', label: '线段', clicks: 2, hint: '先点起点,再点终点' },
  { kind: 'arrow',   icon: '→', label: '箭头', clicks: 2, hint: '先点起点,再点箭头指向的位置' },
  { kind: 'circle',  icon: '○', label: '圆',   clicks: 2, hint: '先点圆心,再点圆上一点' },
  { kind: 'text',    icon: 'T', label: '文字', clicks: 1, hint: '点一下放文字,在右边改内容' },
];

export function shapeKindMeta(kind: ShapeKind) {
  const m = SHAPE_KINDS.find((k) => k.kind === kind);
  if (!m) throw new Error(`[math-visual] 未知几何对象类型: ${kind}`);
  return m;
}

/** 数字 → 坐标字符串(最多 3 位小数,去尾零) */
export function fmtNum(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** 可视跨度 → 点击吸附步长(1 / 2 / 5 × 10^k,约为跨度的 1/40) */
export function snapStep(span: number): number {
  if (!(span > 0)) return 1;
  const raw = span / 40;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const nice = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return nice * p;
}

export function snap(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/**
 * 新建几何对象。points 是点击得到的数据坐标(已吸附):
 * point/text 用 points[0];segment/arrow/circle 用 points[0], points[1]。
 */
export function createShape(kind: ShapeKind, points: Vec2[], index: number): ShapeEntry {
  const need = shapeKindMeta(kind).clicks;
  if (points.length < need) {
    throw new Error(`[math-visual] ${kind} 需要 ${need} 个点,只给了 ${points.length} 个`);
  }
  const c = (p: Vec2): CoordExpr => [fmtNum(p[0]), fmtNum(p[1])];
  const base: ShapeEntry = {
    id: `sh-${Date.now()}-${index}`,
    kind,
    color: FUNCTION_COLORS[index % FUNCTION_COLORS.length],
    style: 'solid',
    lineWidth: 2.5,
  };
  switch (kind) {
    case 'point':
      return { ...base, at: c(points[0]) };
    case 'text':
      return { ...base, at: c(points[0]), text: '文字' };
    case 'segment':
    case 'arrow':
      return { ...base, from: c(points[0]), to: c(points[1]) };
    case 'circle': {
      const r = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
      return { ...base, center: c(points[0]), radius: fmtNum(r) };
    }
  }
}

export type EvalScalar = (expression: string, params: MathParameter[]) => ScalarResult;

export interface CompiledShapes {
  specs: ShapeSpec[];
  /** shape.id → 出错原因;出错的对象不画,但必须在列表里看得见 */
  errors: Record<string, string>;
}

/** 刻度上限:与 capability 的 MAX_TICKS 一致(超过就报错,不画一团黑) */
const MAX_TICKS = 200;

/**
 * ShapeEntry[](表达式)→ ShapeSpec[](数字)。
 * 任何一个坐标算不出来 → 这个对象记一条错误、不进 specs;其他对象照常。
 */
export function compileShapes(
  shapes: ShapeEntry[],
  evalScalar: EvalScalar,
  params: MathParameter[],
): CompiledShapes {
  const specs: ShapeSpec[] = [];
  const errors: Record<string, string> = {};

  for (const s of shapes) {
    const problems: string[] = [];
    const num = (expr: string | undefined, name: string): number => {
      if (expr === undefined) { problems.push(`${name}:没有填`); return NaN; }
      const r = evalScalar(expr, params);
      if (r.value === null) { problems.push(`${name}:${r.error ?? '算不出来'}`); return NaN; }
      return r.value;
    };
    const vec = (c: CoordExpr | undefined, name: string): Vec2 =>
      [num(c?.[0], `${name} x`), num(c?.[1], `${name} y`)];

    const common = { id: s.id, color: s.color, opacity: s.opacity };
    let spec: ShapeSpec | null = null;

    switch (s.kind) {
      case 'point': {
        const at = vec(s.at, '位置');
        spec = { ...common, kind: 'point', at, label: s.text || undefined };
        break;
      }
      case 'text': {
        const at = vec(s.at, '位置');
        if (!s.text) problems.push('文字:内容是空的');
        spec = { ...common, kind: 'text', at, text: s.text ?? '' };
        break;
      }
      case 'segment':
      case 'arrow': {
        const from = vec(s.from, '起点');
        const to = vec(s.to, '终点');
        if (s.ticks) {
          const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
          if (!(s.ticks.step > 0)) problems.push('刻度间隔:要大于 0');
          else if (isFinite(len) && len / s.ticks.step > MAX_TICKS) {
            problems.push(`刻度间隔:太小了,会画出 ${Math.floor(len / s.ticks.step)} 道刻度`);
          }
        }
        spec = {
          ...common, kind: s.kind, from, to,
          style: s.style, lineWidth: s.lineWidth,
          label: s.text || undefined,
          ticks: s.ticks, struck: s.struck,
        };
        break;
      }
      case 'circle': {
        const center = vec(s.center, '圆心');
        const radius = num(s.radius, '半径');
        if (isFinite(radius) && radius <= 0) problems.push('半径:要大于 0');
        spec = {
          ...common, kind: 'circle', center, radius,
          style: s.style, lineWidth: s.lineWidth,
          label: s.text || undefined,
        };
        break;
      }
      default:
        problems.push(`未知类型:${String((s as { kind: unknown }).kind)}`);
    }

    if (problems.length > 0 || !spec) errors[s.id] = problems.join(';');
    else specs.push(spec);
  }
  return { specs, errors };
}

// ─── 视口换算 ─────────────────────────────────────────────

/** Mafs 在 viewBox 四周默认各留 0.5 个数据单位(mafs 0.21 `viewBox.padding ?? 0.5`) */
export const MAFS_VIEWBOX_PADDING = 0.5;

export interface View {
  x: [number, number];
  y: [number, number];
}

/**
 * 等比例:保证要看的范围全部可见,且 x、y 一个单位在屏幕上一样长。
 * 按画布宽高把较「窄」的那个方向放宽,中心不动。计算时把 Mafs 的边距算进去。
 */
export function fitEqualScale(view: View, widthPx: number, heightPx: number, pad = MAFS_VIEWBOX_PADDING): View {
  if (!(widthPx > 0) || !(heightPx > 0)) return view;
  const xSpan = view.x[1] - view.x[0] + 2 * pad;
  const ySpan = view.y[1] - view.y[0] + 2 * pad;
  const unit = Math.max(xSpan / widthPx, ySpan / heightPx); // 每像素多少数据单位
  const cx = (view.x[0] + view.x[1]) / 2;
  const cy = (view.y[0] + view.y[1]) / 2;
  const halfX = (unit * widthPx) / 2 - pad;
  const halfY = (unit * heightPx) / 2 - pad;
  return { x: [cx - halfX, cx + halfX], y: [cy - halfY, cy + halfY] };
}

/** 画布内相对位置(0~1,左上为原点)→ 数据坐标;算上 Mafs 的边距 */
export function relToData(relX: number, relY: number, view: View, pad = MAFS_VIEWBOX_PADDING): Vec2 {
  const x0 = view.x[0] - pad;
  const x1 = view.x[1] + pad;
  const y0 = view.y[0] - pad;
  const y1 = view.y[1] + pad;
  return [x0 + relX * (x1 - x0), y1 - relY * (y1 - y0)];
}

// ─── 缩放 / 平移 / 显示全部(2026-11-06:用户「应该有放大和缩小的功能」) ────────

/** 以 anchor(数据坐标)为中心缩放;factor > 1 = 看到更多(缩小),< 1 = 放大 */
export function zoomView(view: View, factor: number, anchor: Vec2): View {
  const f = Math.min(Math.max(factor, 0.05), 20);
  const scale = (lo: number, hi: number, a: number): [number, number] => [a + (lo - a) * f, a + (hi - a) * f];
  return { x: scale(view.x[0], view.x[1], anchor[0]), y: scale(view.y[0], view.y[1], anchor[1]) };
}

/** 平移 dx/dy 个数据单位 */
export function panView(view: View, dx: number, dy: number): View {
  return { x: [view.x[0] + dx, view.x[1] + dx], y: [view.y[0] + dy, view.y[1] + dy] };
}

/**
 * 把所有几何对象框进来,四周留 15% 余量。没有对象 → null(调用方决定回默认视图)。
 * 文字只按锚点算(不知道字宽),所以余量给大一点。
 */
export function boundsOfShapes(specs: ShapeSpec[]): View | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (p: Vec2) => { if (isFinite(p[0]) && isFinite(p[1])) { xs.push(p[0]); ys.push(p[1]); } };
  for (const s of specs) {
    switch (s.kind) {
      case 'point':
      case 'text': add(s.at); break;
      case 'segment':
      case 'arrow': add(s.from); add(s.to); break;
      case 'circle':
        add([s.center[0] - s.radius, s.center[1] - s.radius]);
        add([s.center[0] + s.radius, s.center[1] + s.radius]);
        break;
    }
  }
  if (xs.length === 0) return null;
  let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (x1 - x0 < 1) { x0 -= 1; x1 += 1; }
  if (y1 - y0 < 1) { y0 -= 1; y1 += 1; }
  const mx = (x1 - x0) * 0.15;
  const my = (y1 - y0) * 0.15;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x: [r(x0 - mx), r(x1 + mx)], y: [r(y0 - my), r(y1 + my)] };
}
