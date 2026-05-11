/**
 * SVG path d 字符串 → Three.js mesh / line(L5-G3)
 *
 * V1 直迁:src/plugins/graph/library/shapes/renderers/path-to-three.ts(395 行).
 *
 * **V2 接口改造**(P1-1 严格版屏障核心 + G3-3=B):
 * - V1 接收 `PathCmd[] + EvalEnv`(shape-library 内部)
 * - V2 接收 `EvaluatedPath`(shape-library 公开 API 输出的纯数据 — `d: string`)
 *   + `FillStyle / LineStyle`(同 V1)
 * - 内部加一个最小 SVG d parser(支持 M / L / A / Q / C / Z),把 d 字符串
 *   解析成 THREE.ShapePath
 * - **不再 import shape-library 任何运行时**(只 type import EvaluatedPath / FillStyle / LineStyle)
 *
 * 输出:
 *   { fill?: THREE.Mesh, stroke?: Line2, group: THREE.Group }
 *
 * fill / stroke 由 style 决定是否出现(type === 'none' 不渲染).
 * group 是把两者打包的方便 holder,NodeRenderer 直接挂 group 到 scene.
 *
 * 坐标系:Y 向下(对齐 SVG / Canvas screen 习惯),Z=0 为画板平面;描边层 z=0.01
 * 防 z-fighting.
 *
 * SVG arc 命令需要按 W3C arc implementation notes 转换成圆心 + 起止角
 * (THREE.absarc 的形式);算法 V1 实证稳定,直迁.
 */

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type {
  EvaluatedPath,
  FillStyle,
  LineStyle,
} from '@capabilities/shape-library/types';

export interface PathToThreeOutput {
  /** 填充 mesh,fill.type === 'none' 时为 null */
  fill: THREE.Mesh | null;
  /** 描边 Line2(Fat Lines,真正可控线宽);line.type === 'none' 时为 null */
  stroke: Line2 | null;
  /** 把两者打包,Canvas 直接挂这个到 scene */
  group: THREE.Group;
}

export interface PathToThreeOptions {
  /** 样式 override(覆盖 ShapeDef.default_style;由 NodeRenderer 在调用前 merge) */
  fill?: FillStyle;
  stroke?: LineStyle;
}

const Z_FILL = 0;
const Z_STROKE = 0.01;

/**
 * EvaluatedPath → Three 对象;主入口.
 *
 * G3 主路径:NodeRenderer 通过 requireCapabilityApi('shape-library') 调
 * shapes.evaluate(id, props, ctx) 拿 EvaluatedPath,再调本函数转 mesh.
 */
export function pathToThree(
  evalPath: EvaluatedPath,
  opts: PathToThreeOptions,
): PathToThreeOutput {
  const commands = parseSvgPathD(evalPath.d);
  const shapePath = buildShapePath(commands);
  const group = new THREE.Group();
  let fill: THREE.Mesh | null = null;
  let stroke: Line2 | null = null;

  // ── Fill ──
  if (opts.fill && opts.fill.type === 'solid') {
    const shapes = shapePath.toShapes(false); // false = 不自动检测内外环(path 简单)
    if (shapes.length > 0) {
      const geom = new THREE.ShapeGeometry(shapes);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(opts.fill.color ?? '#4A90E2'),
        side: THREE.DoubleSide, // 防 CW/CCW 法线问题
        transparent: (opts.fill.transparency ?? 0) > 0,
        opacity: 1 - (opts.fill.transparency ?? 0),
      });
      fill = new THREE.Mesh(geom, mat);
      fill.position.z = Z_FILL;
      group.add(fill);
    }
  }

  // ── Stroke ──
  // 用 Line2(Fat Lines)而非 THREE.Line:
  // THREE.LineBasicMaterial.linewidth 在 macOS WebGL 多数实现里被忽略(永远 1px),
  // Line2 用 Shader 模拟宽度;linewidth 用屏幕像素单位(不随 zoom 缩放)
  if (opts.stroke && opts.stroke.type === 'solid') {
    const points = sampleStrokePoints(commands);
    if (points.length >= 2) {
      const positions: number[] = [];
      for (const p of points) {
        positions.push(p.x, p.y, p.z);
      }
      const geom = new LineGeometry();
      geom.setPositions(positions);
      const mat = new LineMaterial({
        color: new THREE.Color(opts.stroke.color ?? '#2E5C8A').getHex(),
        linewidth: opts.stroke.width ?? 1.5, // 屏幕像素
        worldUnits: false,
        // resolution 由 SceneManager 在 RAF 内每帧同步(走 LineMaterial.resolution.set)
        resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
        transparent: false,
        depthTest: false, // 在 z=0.01 上,不需要深度测试
      });
      stroke = new Line2(geom, mat);
      stroke.computeLineDistances();
      stroke.position.z = Z_STROKE;
      stroke.renderOrder = 1; // stroke 渲染在 fill 之上
      group.add(stroke);
    }
  }

  return { fill, stroke, group };
}

// ─────────────────────────────────────────────────────────
// SVG d 字符串 → 内部命令数组(最小 parser,支持 M / L / A / Q / C / Z)
// ─────────────────────────────────────────────────────────

type ParsedCmd =
  | { cmd: 'M' | 'L'; x: number; y: number }
  | {
      cmd: 'A';
      rx: number; ry: number;
      xAxisRot: number;
      largeArc: 0 | 1; sweep: 0 | 1;
      x: number; y: number;
    }
  | { cmd: 'Q'; x1: number; y1: number; x: number; y: number }
  | {
      cmd: 'C';
      x1: number; y1: number;
      x2: number; y2: number;
      x: number; y: number;
    }
  | { cmd: 'Z' };

/**
 * V1 parametric renderer 输出形如 `M 15 0 L 185 0 A 15 15 0 0 1 200 15 ...`
 * (4 位小数四舍五入,绝对坐标,空格分隔).本 parser 只支持大写命令.
 */
function parseSvgPathD(d: string): ParsedCmd[] {
  const tokens = d.trim().split(/\s+/);
  const out: ParsedCmd[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === 'M' || t === 'L') {
      out.push({ cmd: t, x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) });
      i += 3;
    } else if (t === 'A') {
      out.push({
        cmd: 'A',
        rx: Number(tokens[i + 1]),
        ry: Number(tokens[i + 2]),
        xAxisRot: Number(tokens[i + 3]),
        largeArc: (Number(tokens[i + 4]) === 1 ? 1 : 0) as 0 | 1,
        sweep: (Number(tokens[i + 5]) === 1 ? 1 : 0) as 0 | 1,
        x: Number(tokens[i + 6]),
        y: Number(tokens[i + 7]),
      });
      i += 8;
    } else if (t === 'Q') {
      out.push({
        cmd: 'Q',
        x1: Number(tokens[i + 1]), y1: Number(tokens[i + 2]),
        x: Number(tokens[i + 3]), y: Number(tokens[i + 4]),
      });
      i += 5;
    } else if (t === 'C') {
      out.push({
        cmd: 'C',
        x1: Number(tokens[i + 1]), y1: Number(tokens[i + 2]),
        x2: Number(tokens[i + 3]), y2: Number(tokens[i + 4]),
        x: Number(tokens[i + 5]), y: Number(tokens[i + 6]),
      });
      i += 7;
    } else if (t === 'Z') {
      out.push({ cmd: 'Z' });
      i += 1;
    } else {
      // 未知 token — 跳过避免死循环
      i += 1;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// ParsedCmd[] → THREE.ShapePath(fill 的 ShapeGeometry 用)
// ─────────────────────────────────────────────────────────

function buildShapePath(path: ParsedCmd[]): THREE.ShapePath {
  const sp = new THREE.ShapePath();
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;

  for (const cmd of path) {
    switch (cmd.cmd) {
      case 'M': {
        cx = cmd.x; cy = cmd.y;
        startX = cx; startY = cy;
        sp.moveTo(cx, cy);
        break;
      }
      case 'L': {
        cx = cmd.x; cy = cmd.y;
        sp.lineTo(cx, cy);
        break;
      }
      case 'A': {
        applySvgArc(sp, cx, cy, cmd.rx, cmd.ry, cmd.x, cmd.y, cmd.largeArc, cmd.sweep);
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'Q': {
        sp.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'C': {
        sp.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'Z': {
        // ShapePath 没显式 close,显式 lineTo 起点更稳
        sp.lineTo(startX, startY);
        cx = startX; cy = startY;
        break;
      }
    }
  }
  return sp;
}

/**
 * SVG 椭圆弧 → THREE.ShapePath.absarc
 *
 * SVG 弧:从 (x1,y1) 到 (x2,y2),椭圆半径 (rx,ry),x 轴旋转 0(我们不用斜椭圆),
 * 加 large-arc-flag 和 sweep-flag.
 *
 * 算法见 W3C SVG implementation notes(假设 x-axis-rotation = 0,V1 shape JSON
 * 全部如此).
 */
function applySvgArc(
  sp: THREE.ShapePath,
  x1: number, y1: number,
  rx: number, ry: number,
  x2: number, y2: number,
  largeArc: 0 | 1,
  sweep: 0 | 1,
): void {
  if (rx === 0 || ry === 0) {
    sp.lineTo(x2, y2);
    return;
  }
  let absRx = Math.abs(rx);
  let absRy = Math.abs(ry);

  // Step 1: 中点偏移(x-rotation = 0,简化为差值)
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;

  // Step 2: 校正过小半径(SVG 规范要求)
  const lambda = (dx * dx) / (absRx * absRx) + (dy * dy) / (absRy * absRy);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    absRx *= s;
    absRy *= s;
  }

  // Step 3: 圆心(局部坐标)
  const sign = largeArc === sweep ? -1 : 1;
  const numer = absRx * absRx * absRy * absRy
    - absRx * absRx * dy * dy
    - absRy * absRy * dx * dx;
  const denom = absRx * absRx * dy * dy + absRy * absRy * dx * dx;
  const sq = denom === 0 ? 0 : Math.max(0, numer / denom);
  const coef = sign * Math.sqrt(sq);
  const cxLocal = coef * (absRx * dy) / absRy;
  const cyLocal = coef * -(absRy * dx) / absRx;

  // Step 4: 圆心(全局)
  const cx0 = cxLocal + (x1 + x2) / 2;
  const cy0 = cyLocal + (y1 + y2) / 2;

  // Step 5: 起止角度
  const startAngle = Math.atan2((dy - cyLocal) / absRy, (dx - cxLocal) / absRx);
  const endAngle = Math.atan2((-dy - cyLocal) / absRy, (-dx - cxLocal) / absRx);

  // V1 实证模式:用 EllipseCurve 采样 + sp.lineTo 串入 ShapePath
  // (THREE.ShapePath 没有 absarc 方法,absarc 在 Path/Shape 上)
  // sweep=0 → CCW(在 SVG y-down 坐标系中实际是顺时针视觉)
  const curve = new THREE.EllipseCurve(
    cx0, cy0,
    absRx, absRy,
    startAngle, endAngle,
    sweep === 0, // THREE clockwise = SVG sweep === 0
    0,
  );
  const points = curve.getPoints(16);
  for (let i = 1; i < points.length; i++) {
    sp.lineTo(points[i].x, points[i].y);
  }
}

// ─────────────────────────────────────────────────────────
// 描边采样:把 ParsedCmd[] 转成 Line2 用的离散顶点数组
// ─────────────────────────────────────────────────────────

const ARC_SAMPLES = 24; // 每条 arc 采样段数
const BEZIER_SAMPLES = 20; // 每条贝塞尔曲线采样段数

function sampleStrokePoints(path: ParsedCmd[]): Array<{ x: number; y: number; z: number }> {
  const points: Array<{ x: number; y: number; z: number }> = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;

  const pushP = (x: number, y: number): void => {
    points.push({ x, y, z: 0 });
  };

  for (const cmd of path) {
    switch (cmd.cmd) {
      case 'M': {
        cx = cmd.x; cy = cmd.y;
        startX = cx; startY = cy;
        // 描边新段:若已有点,断开(实际 Line2 不支持多段;简化为连续 stroke)
        pushP(cx, cy);
        hasStart = true;
        break;
      }
      case 'L': {
        if (!hasStart) { pushP(cx, cy); hasStart = true; }
        cx = cmd.x; cy = cmd.y;
        pushP(cx, cy);
        break;
      }
      case 'A': {
        if (!hasStart) { pushP(cx, cy); hasStart = true; }
        // 直接用 EllipseCurve 采样(对齐 V1 sampleSvgArc 模式,不走 ShapePath)
        const seg = sampleSvgArc(cx, cy, cmd.rx, cmd.ry, cmd.x, cmd.y, cmd.largeArc, cmd.sweep, ARC_SAMPLES);
        for (let k = 1; k < seg.length; k++) pushP(seg[k].x, seg[k].y);
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'Q': {
        if (!hasStart) { pushP(cx, cy); hasStart = true; }
        const curve = new THREE.QuadraticBezierCurve(
          new THREE.Vector2(cx, cy),
          new THREE.Vector2(cmd.x1, cmd.y1),
          new THREE.Vector2(cmd.x, cmd.y),
        );
        const pts = curve.getPoints(BEZIER_SAMPLES);
        for (const p of pts) pushP(p.x, p.y);
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'C': {
        if (!hasStart) { pushP(cx, cy); hasStart = true; }
        const curve = new THREE.CubicBezierCurve(
          new THREE.Vector2(cx, cy),
          new THREE.Vector2(cmd.x1, cmd.y1),
          new THREE.Vector2(cmd.x2, cmd.y2),
          new THREE.Vector2(cmd.x, cmd.y),
        );
        const pts = curve.getPoints(BEZIER_SAMPLES);
        for (const p of pts) pushP(p.x, p.y);
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'Z': {
        pushP(startX, startY);
        cx = startX; cy = startY;
        break;
      }
    }
  }
  return points;
}

/** SVG 椭圆弧 → EllipseCurve 采样点(V1 sampleSvgArc 直迁简化) */
function sampleSvgArc(
  x1: number, y1: number,
  rx: number, ry: number,
  x2: number, y2: number,
  largeArc: 0 | 1,
  sweep: 0 | 1,
  samples: number,
): Array<{ x: number; y: number }> {
  if (rx === 0 || ry === 0) {
    return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  }
  let absRx = Math.abs(rx);
  let absRy = Math.abs(ry);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const lambda = (dx * dx) / (absRx * absRx) + (dy * dy) / (absRy * absRy);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    absRx *= s; absRy *= s;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const numer = absRx * absRx * absRy * absRy
    - absRx * absRx * dy * dy - absRy * absRy * dx * dx;
  const denom = absRx * absRx * dy * dy + absRy * absRy * dx * dx;
  const sq = denom === 0 ? 0 : Math.max(0, numer / denom);
  const coef = sign * Math.sqrt(sq);
  const cxL = coef * (absRx * dy) / absRy;
  const cyL = coef * -(absRy * dx) / absRx;
  const cx0 = cxL + (x1 + x2) / 2;
  const cy0 = cyL + (y1 + y2) / 2;
  const startAngle = Math.atan2((dy - cyL) / absRy, (dx - cxL) / absRx);
  const endAngle = Math.atan2((-dy - cyL) / absRy, (-dx - cxL) / absRx);
  const curve = new THREE.EllipseCurve(
    cx0, cy0, absRx, absRy,
    startAngle, endAngle,
    sweep === 0, // THREE clockwise = SVG sweep === 0
    0,
  );
  return curve.getPoints(samples);
}
