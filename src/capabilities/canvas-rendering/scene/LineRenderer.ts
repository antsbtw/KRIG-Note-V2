import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { ArrowEndKind, ArrowStyle, LineStyle } from '@capabilities/shape-library/types';
import { dashParamsFor } from './path-to-three';
import {
  ARROW_SIZE_PX,
  arrowHeadPoints,
  arrowTangentOf,
  shouldDrawArrow,
  type Pt,
} from './arrow-geometry';

/**
 * LineRenderer — 端点驱动的 line 渲染
 *
 * 与 path-to-three.ts 的区别:
 * - path-to-three 渲染 ShapeDef.path 内部的固定几何(viewBox 0..w/h),适合 fill 类
 *   shape;line 实例若直接用 path-to-three,得不到"两端动态跟随 magnet"的效果
 * - LineRenderer 接受两端世界坐标,直接生成两端跟随的 line geometry
 *
 * 支持 3 种 line ref:
 * - krig.line.straight:直线
 * - krig.line.elbow:三段直角(横-竖-横,中点 50%;水平距离短于阈值时退化为竖-横-竖)
 * - krig.line.curved:三次贝塞尔(控制点在两端水平 1/3 处)
 *
 * 输出:THREE.Line(world coordinate),group.position 在 (0,0),不需要
 * 外层平移(顶点已是世界坐标)。
 */

const Z_LINE = 0.005;        // 比 fill(z=0)高,比 stroke(z=0.01)低,避免遮蔽
const SAMPLES = 24;          // 曲线段采样数

export interface LineRenderOptions {
  start: { x: number; y: number };
  end: { x: number; y: number };
  style?: LineStyle;
  /**
   * ⭐ 两端箭头。⚠️ 补的是「ArrowStyle 是死字段」那个缺口(00 §9.1)——
   * 此前类型有、JSON 有、Host 会合并,但渲染层零消费。
   */
  arrow?: ArrowStyle;
}

/**
 * 渲染一条 line(返回 THREE.Group 包一个 Line2)
 * 用 Line2(Fat Lines)而非 THREE.Line:THREE.LineBasicMaterial.linewidth 在
 * macOS WebGL 多数实现里被忽略(永远 1px),Line2 用 Shader 模拟宽度,任意线宽都能渲染
 */
export function renderLine(ref: string, opts: LineRenderOptions): THREE.Group {
  const { start, end, style } = opts;
  const group = new THREE.Group();
  const points = generatePoints(ref, start, end);
  const positions = pointsToFlatArray(points);
  const geom = new LineGeometry();
  geom.setPositions(positions);
  const lineWidth = style?.width ?? 1.5;
  // dashType → 虚线参数(复用 path-to-three 同一映射,line 节点与 shape 描边观感一致)
  const dash = dashParamsFor(style?.dashType ?? 'solid', lineWidth);
  const mat = new LineMaterial({
    color: new THREE.Color(style?.color ?? '#2E5C8A').getHex(),
    linewidth: lineWidth,                   // 屏幕像素
    worldUnits: false,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    transparent: false,
    depthTest: false,
    dashed: dash !== null,
    ...(dash ? { dashSize: dash.dashSize, gapSize: dash.gapSize } : {}),
  });
  const line = new Line2(geom, mat);
  line.computeLineDistances();
  line.position.z = Z_LINE;
  line.renderOrder = 1;
  group.add(line);

  // ⭐ 箭头与线**同一个 group**:选中高亮 / 删除 / 拖动都按 group 走,箭头自动跟着。
  // ⚠️ arrow 记在 userData —— updateLineGeometry 重算时要用(它拿不到原 opts)。
  group.userData.arrowStyle = style?.color
    ? { ...opts.arrow, __color: style.color }
    : opts.arrow;
  updateArrowHead(group, points);
  return group;
}

/**
 * ⭐⭐ **箭头的唯一更新入口** —— `renderLine`(初建)与 `updateLineGeometry`(拖动)
 * **共用这一个函数**。
 *
 * ⚠️⚠️ 这是本次最容易漏的一条:`updateLineGeometry` 只改顶点、不重建 group,
 * 全仓**5 个调用点**(NodeRenderer 重算端点 / 拖预览 ×2 / rewire / magnet 拖出)。
 * 箭头若只在 renderLine 里画一次,拖动时**线走了、箭头钉在原地**。
 *
 * ⚠️ 两处各写一份也不行 —— 那是「同一件事两处实现」,迟早漂移。故收口于此。
 */
function updateArrowHead(group: THREE.Group, points: readonly THREE.Vector3[]): void {
  // 先清掉上一轮的箭头(拖动时每帧重建;三角形只有 3 个顶点,重建成本可忽略)
  const stale = group.children.filter((c) => c.userData.isArrowHead === true);
  for (const c of stale) {
    group.remove(c);
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  }

  const raw = group.userData.arrowStyle as (ArrowStyle & { __color?: string }) | undefined;
  if (!raw) return;
  const color = raw.__color ?? '#2E5C8A';
  const plain: Pt[] = points.map((p) => ({ x: p.x, y: p.y }));

  // end 端:切线取末两点;begin 端:把点列反过来,同一套逻辑
  if (shouldDrawArrow(raw.end) && plain.length >= 2) {
    addHead(group, plain[plain.length - 1], arrowTangentOf(plain), color, raw.end!);
  }
  if (shouldDrawArrow(raw.begin) && plain.length >= 2) {
    const reversed = [...plain].reverse();
    addHead(group, reversed[reversed.length - 1], arrowTangentOf(reversed), color, raw.begin!);
  }
}

/**
 * 把一个端形 mesh 加进 group(几何来自纯逻辑层,这里只管画)。
 *
 * ⭐ 吃的是**通用多边形**(`points` + `triangles` 索引)—— 六种端形共用这一套:
 * triangle 1 个三角、diamond/stealth 2 个、arrow 4 个、oval 扇形 16 个。
 * ⚠️ 若这里按形状分支,就等于把几何知识又抄一份到 mesh 层(两处迟早漂移)。
 */
function addHead(
  group: THREE.Group,
  tip: Pt,
  tangent: Pt | null,
  color: string,
  kind: ArrowEndKind,
): void {
  const head = arrowHeadPoints(tip, tangent, ARROW_SIZE_PX, kind);
  if (!head) return; // ⚠️ 退化线(末两点重合)→ 不画,不产出 NaN mesh
  const flat: number[] = [];
  for (const i of head.triangles) {
    const p = head.points[i];
    flat.push(p.x, p.y, 0);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).getHex(),
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.z = Z_LINE;
  mesh.renderOrder = 2; // 压在线之上,免得线端从三角形里透出来
  mesh.userData.isArrowHead = true;
  group.add(mesh);
}

/**
 * 切换 line 视觉高亮(hover / selected 用)
 * 高亮:颜色变亮(0x4A90E2);非高亮:还原为初始颜色(读 userData.baseColor)
 */
export function setLineHighlight(group: THREE.Group, on: boolean): void {
  const line = group.children[0] as Line2 | undefined;
  if (!line) return;
  const mat = line.material as LineMaterial;
  // 首次 highlight:把当前颜色保存为 baseColor
  if (group.userData.baseColor === undefined) {
    group.userData.baseColor = mat.color.getHex();
  }
  if (on) {
    mat.color.set(0x4A90E2);
  } else {
    mat.color.setHex(group.userData.baseColor);
  }
}

/** 不重新建 mesh,只更新顶点缓冲(M1.3 拖动时高频调用,避免抖动) */
export function updateLineGeometry(
  group: THREE.Group,
  ref: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): void {
  const line = group.children[0] as Line2 | undefined;
  if (!line) return;
  const points = generatePoints(ref, start, end);
  const positions = pointsToFlatArray(points);
  (line.geometry as LineGeometry).setPositions(positions);
  line.computeLineDistances();
  // ⭐ 箭头跟着走 —— 走与 renderLine **同一个**入口(见 updateArrowHead 注释)
  updateArrowHead(group, points);
}

/** Vector3[] → 扁平 [x,y,z, x,y,z, ...] */
function pointsToFlatArray(points: THREE.Vector3[]): number[] {
  const arr: number[] = [];
  for (const p of points) {
    arr.push(p.x, p.y, p.z);
  }
  return arr;
}

// ─────────────────────────────────────────────────────────
// 顶点生成
// ─────────────────────────────────────────────────────────

export function generateLinePoints(
  ref: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Array<{ x: number; y: number }> {
  return generatePoints(ref, start, end).map((p) => ({ x: p.x, y: p.y }));
}

function generatePoints(
  ref: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): THREE.Vector3[] {
  switch (ref) {
    case 'krig.line.elbow':
      return generateElbow(start, end);
    case 'krig.line.curved':
      return generateCurved(start, end);
    case 'krig.line.straight':
    default:
      return [new THREE.Vector3(start.x, start.y, 0), new THREE.Vector3(end.x, end.y, 0)];
  }
}

/**
 * Elbow:三段直角折线
 * 默认 horizontal-first(横→竖→横),折点在水平中点
 * 当 |dx| < |dy| / 2 时切换为 vertical-first(竖→横→竖),避免退化为窄锯齿
 */
function generateElbow(
  start: { x: number; y: number },
  end: { x: number; y: number },
): THREE.Vector3[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const horizontalFirst = Math.abs(dx) >= Math.abs(dy) / 2;
  if (horizontalFirst) {
    const midX = start.x + dx / 2;
    return [
      new THREE.Vector3(start.x, start.y, 0),
      new THREE.Vector3(midX,    start.y, 0),
      new THREE.Vector3(midX,    end.y,   0),
      new THREE.Vector3(end.x,   end.y,   0),
    ];
  } else {
    const midY = start.y + dy / 2;
    return [
      new THREE.Vector3(start.x, start.y, 0),
      new THREE.Vector3(start.x, midY,    0),
      new THREE.Vector3(end.x,   midY,    0),
      new THREE.Vector3(end.x,   end.y,   0),
    ];
  }
}

/**
 * Curved:三次贝塞尔
 * 控制点放在两端 X 方向 1/3 处的 Y(让曲线"挂"在两端,符合 family-tree 习惯)
 */
function generateCurved(
  start: { x: number; y: number },
  end: { x: number; y: number },
): THREE.Vector3[] {
  const dx = end.x - start.x;
  const c1 = new THREE.Vector2(start.x + dx / 3, start.y);
  const c2 = new THREE.Vector2(end.x - dx / 3, end.y);
  const curve = new THREE.CubicBezierCurve(
    new THREE.Vector2(start.x, start.y),
    c1, c2,
    new THREE.Vector2(end.x, end.y),
  );
  const pts = curve.getPoints(SAMPLES);
  return pts.map((p) => new THREE.Vector3(p.x, p.y, 0));
}
