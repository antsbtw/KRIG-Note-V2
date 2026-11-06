/**
 * math-visual 几何对象 —— 纯函数(题意图 P1,2026-11-06)
 *
 * 设计稿:docs/10-business-design/math/题意图-几何对象与分帧设计.md §3.1
 *
 * 不 import capability 实现(求值函数由调用方注入),单测直接跑。
 */

import type { ShapeSpec, ScalarResult, MathParameter } from '@capabilities/math-rendering/types';
import type { ShapeEntry, ShapeKind, CoordExpr, NoteDoc, NoteNode } from './types';
import { FUNCTION_COLORS } from './types';

export type Vec2 = [number, number];

/** clicks:'many' = 面,逐个点顶点,点回第一个点或按回车结束 */
export const SHAPE_KINDS: Array<{ kind: ShapeKind; icon: string; label: string; clicks: 1 | 2 | 'many'; hint: string }> = [
  { kind: 'point',   icon: '•', label: '点',   clicks: 1, hint: '点一下放一个点' },
  { kind: 'segment', icon: '╱', label: '线段', clicks: 2, hint: '先点起点,再点终点' },
  { kind: 'arrow',   icon: '→', label: '箭头', clicks: 2, hint: '先点起点,再点箭头指向的位置' },
  { kind: 'circle',  icon: '○', label: '圆',   clicks: 2, hint: '先点圆心,再点圆上一点' },
  { kind: 'text',    icon: 'T', label: '文字', clicks: 1, hint: '点一下放文字,在右边改内容' },
  { kind: 'polygon', icon: '▱', label: '面',   clicks: 'many', hint: '逐个点顶点,点回第一个点或按回车结束' },
];

/** 面至少几个顶点 */
export const POLYGON_MIN_POINTS = 3;

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
  const clicks = shapeKindMeta(kind).clicks;
  const need = clicks === 'many' ? POLYGON_MIN_POINTS : clicks;
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
    case 'polygon':
      return { ...base, points: points.map(c) };
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

    const noteAtoms = noteContent(s.note);
    const common = {
      id: s.id, color: s.color, opacity: s.opacity, labelOffset: s.labelOffset,
      ...(noteAtoms ? { note: noteAtoms, noteWidth: s.noteWidth } : {}),
    };
    let spec: ShapeSpec | null = null;

    switch (s.kind) {
      case 'point': {
        const at = vec(s.at, '位置');
        spec = { ...common, kind: 'point', at, label: s.text || undefined };
        break;
      }
      case 'text': {
        const at = vec(s.at, '位置');
        if (!s.text && !noteAtoms) problems.push('文字:内容是空的');
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
      case 'polygon': {
        const pts = (s.points ?? []).map((p, i) => vec(p, `顶点${i + 1}`));
        if (pts.length < POLYGON_MIN_POINTS) problems.push(`顶点:至少 ${POLYGON_MIN_POINTS} 个,现在 ${pts.length} 个`);
        spec = {
          ...common, kind: 'polygon', points: pts,
          style: s.style, lineWidth: s.lineWidth,
          fillOpacity: s.fill === false ? 0 : 0.15,
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
      case 'polygon':
        s.points.forEach(add);
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

// ─── 画布上选中 / 拖动 / 手柄(2026-11-06 用户:「还有选定对象和操作的能力吧?」) ───────

/** 手柄名:'at' | 'from' | 'to' | 'center' | 'radius' | 'v0'、'v1'… | 'label'(拖标签) */
export type HandlePart = string;

/** 选中对象显示的手柄(数据坐标) */
export function shapeHandles(spec: ShapeSpec): Array<{ part: HandlePart; at: Vec2 }> {
  switch (spec.kind) {
    case 'point':
    case 'text': return [{ part: 'at', at: spec.at }];
    case 'segment':
    case 'arrow': return [{ part: 'from', at: spec.from }, { part: 'to', at: spec.to }];
    case 'circle': return [
      { part: 'center', at: spec.center },
      { part: 'radius', at: [spec.center[0] + spec.radius, spec.center[1]] },
    ];
    case 'polygon': return spec.points.map((p, i) => ({ part: `v${i}`, at: p }));
  }
}

/** 画布像素换算(与 relToData 互逆;原点左上) */
export interface PxFrame { view: View; width: number; height: number; pad?: number }

export function dataToPx(p: Vec2, f: PxFrame): Vec2 {
  const pad = f.pad ?? MAFS_VIEWBOX_PADDING;
  const x0 = f.view.x[0] - pad;
  const x1 = f.view.x[1] + pad;
  const y0 = f.view.y[0] - pad;
  const y1 = f.view.y[1] + pad;
  return [((p[0] - x0) / (x1 - x0)) * f.width, ((y1 - p[1]) / (y1 - y0)) * f.height];
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function insidePolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 文字的大致命中框半宽(px):中日文按一个字号宽,其他按 0.6 个字号 */
function textHalfWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += /[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(ch) ? size : size * 0.6;
  return w / 2;
}

const HANDLE_HIT_PX = 9;
const POINT_HIT_PX = 12;
const LINE_HIT_PX = 6;

/**
 * 鼠标(像素,画布左上为原点)命中哪个对象。
 * 先看选中对象的手柄(part 非 null),再按「后画的在上面」从后往前看对象本体(part = null)。
 */
/** 标签屏幕框(由 capability 的 shapeLabelBox 提供,与渲染同一套布局) */
export type LabelBoxFn = (spec: ShapeSpec, toPx: (p: Vec2) => Vec2) => { x0: number; y0: number; x1: number; y1: number } | null;

export function hitTest(
  specs: ShapeSpec[],
  mousePx: Vec2,
  frame: PxFrame,
  selectedId: string | null,
  labelBox?: LabelBoxFn,
): { id: string; part: HandlePart | null } | null {
  const px = (p: Vec2) => dataToPx(p, frame);
  const d = (p: Vec2) => Math.hypot(mousePx[0] - p[0], mousePx[1] - p[1]);

  const sel = selectedId ? specs.find((s) => s.id === selectedId) : undefined;
  if (sel) {
    for (const h of shapeHandles(sel)) {
      if (d(px(h.at)) <= HANDLE_HIT_PX) return { id: sel.id, part: h.part };
    }
  }

  for (let i = specs.length - 1; i >= 0; i--) {
    const s = specs[i];
    // 标签:part = 'label'(拖它只挪标签,不挪对象)
    const box = labelBox?.(s, px);
    if (box && mousePx[0] >= box.x0 && mousePx[0] <= box.x1 && mousePx[1] >= box.y0 && mousePx[1] <= box.y1) {
      // 文字对象的卡片就是它本体:拖它 = 移动对象,不是挪标签
      return { id: s.id, part: s.kind === 'text' ? null : 'label' };
    }
    let hit = false;
    switch (s.kind) {
      case 'point':
        hit = d(px(s.at)) <= POINT_HIT_PX;
        break;
      case 'text': {
        const c = px(s.at);
        const size = s.size ?? 16;
        hit = Math.abs(mousePx[0] - c[0]) <= textHalfWidth(s.text, size) + 4
          && Math.abs(mousePx[1] - c[1]) <= size / 2 + 4;
        break;
      }
      case 'segment':
      case 'arrow':
        hit = distToSegment(mousePx, px(s.from), px(s.to)) <= LINE_HIT_PX;
        break;
      case 'circle': {
        const c = px(s.center);
        const e = px([s.center[0] + s.radius, s.center[1]]);
        const rPx = Math.abs(e[0] - c[0]);
        hit = Math.abs(d(c) - rPx) <= LINE_HIT_PX;
        break;
      }
      case 'polygon': {
        const poly = s.points.map(px);
        hit = poly.some((p, k) => distToSegment(mousePx, p, poly[(k + 1) % poly.length]) <= LINE_HIT_PX)
          || ((s.fillOpacity ?? 0) > 0 && insidePolygon(mousePx, poly));
        break;
      }
    }
    if (hit) return { id: s.id, part: null };
  }
  return null;
}

const NUMERIC_RE = /^\s*-?(\d+\.?\d*|\.\d+)\s*$/;

/** 坐标是不是纯数字(纯数字才能被拖动改;算式不动) */
export function isPlainNumber(expr: string | undefined): boolean {
  return expr !== undefined && NUMERIC_RE.test(expr);
}

function shiftCoord(c: CoordExpr | undefined, dx: number, dy: number): CoordExpr | undefined {
  if (!c) return c;
  return [
    isPlainNumber(c[0]) ? fmtNum(Number(c[0]) + dx) : c[0],
    isPlainNumber(c[1]) ? fmtNum(Number(c[1]) + dy) : c[1],
  ];
}

/** 整体平移;写成算式的坐标保持不动(它跟着参数走,不该被拖改) */
export function translateShape(s: ShapeEntry, dx: number, dy: number): ShapeEntry {
  return {
    ...s,
    at: shiftCoord(s.at, dx, dy),
    from: shiftCoord(s.from, dx, dy),
    to: shiftCoord(s.to, dx, dy),
    center: shiftCoord(s.center, dx, dy),
    points: s.points?.map((p) => shiftCoord(p, dx, dy) as CoordExpr),
  };
}

/** 拖某个手柄到 p(数据坐标)。拖手柄是明确的「改这一处」,会把那里的算式换成数字。 */
export function setHandle(s: ShapeEntry, spec: ShapeSpec, part: HandlePart, p: Vec2): ShapeEntry {
  const c: CoordExpr = [fmtNum(p[0]), fmtNum(p[1])];
  if (part === 'radius') {
    if (spec.kind !== 'circle') return s;
    const r = Math.hypot(p[0] - spec.center[0], p[1] - spec.center[1]);
    return r > 0 ? { ...s, radius: fmtNum(r) } : s;
  }
  if (part.startsWith('v')) {
    const i = Number(part.slice(1));
    if (!s.points || !(i >= 0 && i < s.points.length)) return s;
    return { ...s, points: s.points.map((q, k) => (k === i ? c : q)) };
  }
  if (part === 'at' || part === 'from' || part === 'to' || part === 'center') return { ...s, [part]: c };
  throw new Error(`[math-visual] 未知手柄: ${part}`);
}

/** 复制一份:新 id,往右下偏一点 */
export function duplicateShape(s: ShapeEntry, offset: Vec2, index: number): ShapeEntry {
  return { ...translateShape(s, offset[0], offset[1]), id: `sh-${Date.now()}-${index}` };
}

// ─── 框选(2026-11-06 用户:「框选应该是选定元素进行操作吧」) ─────────────

/** 对象在数据坐标里占的范围(不加余量);文字只按锚点算 */
export function specExtent(s: ShapeSpec): View {
  const pts: Vec2[] = (() => {
    switch (s.kind) {
      case 'point':
      case 'text': return [s.at];
      case 'segment':
      case 'arrow': return [s.from, s.to];
      case 'circle': return [
        [s.center[0] - s.radius, s.center[1] - s.radius],
        [s.center[0] + s.radius, s.center[1] + s.radius],
      ];
      case 'polygon': return s.points;
    }
  })();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
}

/**
 * 被方框**完全框住**的对象 id(按画的顺序)。
 * 用「完全框住」而不是「碰到就算」:Mathville 点和两条箭头都从原点出发,
 * 碰到就算的话框点会把箭头一起带上。
 */
export function shapesInRect(specs: ShapeSpec[], rect: View): string[] {
  const [x0, x1] = [Math.min(...rect.x), Math.max(...rect.x)];
  const [y0, y1] = [Math.min(...rect.y), Math.max(...rect.y)];
  return specs
    .filter((s) => {
      const e = specExtent(s);
      return e.x[0] >= x0 && e.x[1] <= x1 && e.y[0] >= y0 && e.y[1] <= y1;
    })
    .map((s) => s.id);
}

// ─── 图层上下关系(2026-11-06 用户:「还有一个图层的上下层关系没有」) ─────────
// 数组顺序 = 画的顺序:越靠后越在上面。

export type LayerOp = 'front' | 'forward' | 'backward' | 'back';

/**
 * 把 ids 这些对象(可多选)整体置顶 / 上移一层 / 下移一层 / 置底,其他对象相对顺序不变。
 * 上移 / 下移:选中的每个对象和它上(下)方第一个未选中的对象交换;已经到头的不动。
 */
export function reorderShapes<T extends { id: string }>(list: T[], ids: string[], op: LayerOp): T[] {
  const sel = new Set(ids);
  if (sel.size === 0) return list;
  const picked = list.filter((s) => sel.has(s.id));
  const rest = list.filter((s) => !sel.has(s.id));
  if (op === 'front') return [...rest, ...picked];
  if (op === 'back') return [...picked, ...rest];

  const out = [...list];
  if (op === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) {
      if (sel.has(out[i].id) && !sel.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]];
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (sel.has(out[i].id) && !sel.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]];
    }
  }
  return out;
}

// ─── 说明卡片:纯文字 ↔ note doc(2026-11-06 用户:「标签应该允许多行,最好能表达 note 中的各种 block」) ───

/** 卡片内容;空 doc(只有一个空段落)视为没有卡片 → 退回单行文字显示 */
export function noteContent(doc: NoteDoc | undefined): NoteNode[] | null {
  const content = doc?.payload?.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const empty = content.length === 1 && content[0].type === 'paragraph' && !(content[0].content?.length);
  return empty ? null : content;
}

/** 纯文字 → note doc:一行一段;首段 isTitle:false(这里不是 note,没有标题) */
export function noteDocFromText(text: string | undefined): NoteDoc {
  const lines = (text ?? '').split('\n');
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: {
      type: 'doc',
      content: lines.map((line) => ({
        type: 'paragraph',
        attrs: { isTitle: false },
        content: line ? [{ type: 'text', text: line }] : [],
      })),
    },
  };
}

/** note doc → 纯文字(块之间换行;公式取 LaTeX 源码) */
export function plainTextOfNote(doc: NoteDoc | undefined): string {
  const lines: string[] = [];
  const inline = (n: NoteNode): string => {
    if (n.type === 'text') return n.text ?? '';
    if (n.type === 'mathInline' || n.type === 'mathBlock') {
      const latex = (n.attrs?.latex as string | undefined) ?? (n.content ?? []).map(inline).join('');
      return latex;
    }
    return (n.content ?? []).map(inline).join('');
  };
  const walk = (n: NoteNode) => {
    const kids = n.content ?? [];
    const isLeafBlock = kids.length === 0 || kids.every((k) => k.type === 'text' || k.type === 'mathInline' || k.type === 'hardBreak');
    if (isLeafBlock) lines.push(inline(n));
    else kids.forEach(walk);
  };
  (doc?.payload?.content ?? []).forEach(walk);
  return lines.join('\n').trim();
}

// ─── 列表摘要 ─────────────────────────────────────────

/** 列表里一行的摘要(左栏列表 / 右栏多选列表共用) */
export function shapeSummary(s: ShapeEntry): string {
  const p = (c?: [string, string]) => (c ? `(${c[0]}, ${c[1]})` : '(?)');
  switch (s.kind) {
    case 'point': return `${s.text ? s.text + ' ' : ''}${p(s.at)}`;
    case 'text': return `「${s.text ?? ''}」${p(s.at)}`;
    case 'segment':
    case 'arrow': return `${s.text ? s.text + ' ' : ''}${p(s.from)} → ${p(s.to)}`;
    case 'circle': return `${s.text ? s.text + ' ' : ''}圆心 ${p(s.center)} r=${s.radius ?? '?'}`;
    case 'polygon': return `${s.text ? s.text + ' ' : ''}${s.points?.length ?? 0} 个顶点`;
  }
}

