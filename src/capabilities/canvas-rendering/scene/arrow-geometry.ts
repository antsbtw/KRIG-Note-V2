/**
 * 箭头几何 —— **纯逻辑层**(切线 / 三角形顶点 / 画不画)
 *
 * ⚠️ 补的是实测缺口(`00 §9.1`):`ArrowStyle` 类型有、shape JSON 的 `default_style`
 * 里有、`Host.tsx` 会深合并 —— 但渲染层**零消费**,画板与导图都画不出箭头。
 * 规格原话:「⭐ 箭头这条最要紧:画不出箭头就画不了流程图」。
 *
 * ⭐⭐ 为什么单独一个文件而不是写进 LineRenderer:
 * 本仓库纪律是**断言先于交互代码**,而 vitest 跑 node 环境(无 DOM / WebGL),
 * 测试**不能 import three**。把几何抽成纯函数,单测才能真验红;
 * `LineRenderer` 只剩「拿这三个点画 mesh」的薄壳。
 * (同款先例:`interaction/magnet-actions.ts`、shape-library 求值器、node-toolbar registry。)
 *
 * ⚠️ 坐标语境:世界坐标,**Y 向下**(与 magnet-snap / HandlesOverlay 同源)。
 */

import type { ArrowEndKind } from '@capabilities/shape-library/types';

/** 箭头三角形的**轴向长度**(屏幕像素基准;与线宽无关,免得细线箭头看不见)。 */
export const ARROW_SIZE_PX = 12;

/** 两翼相对轴线的张开比例(半宽 / 轴长)。0.45 ≈ 48° 夹角,视觉接近常见流程图箭头。 */
const HALF_WIDTH_RATIO = 0.45;

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface ArrowHead {
  /** 尖端 —— ⭐ 就落在线的终点上 */
  readonly tip: Pt;
  readonly left: Pt;
  readonly right: Pt;
}

/**
 * ⭐ 由线的采样点算末端切线(**归一化**)。
 *
 * ⭐⭐ **三种几何一套逻辑**:straight 给两点、elbow 给四点、curved 给 25 点 ——
 * 末端方向永远是**最后两点的差向量**,不必按 ref 分支。
 *
 * ⚠️ 必须归一化:直接用差向量会让**箭头大小随线长变**(线越长箭头越大)。
 * ⚠️ 末两点重合 → 长度 0,除法得 NaN → three 的整个 mesh 会消失
 *   (静默失败:线还在、箭头没了、还不报错)。故退化时**返回 null**,不产出 NaN。
 */
export function arrowTangentOf(points: readonly Pt[]): Pt | null {
  if (points.length < 2) return null;
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  return { x: dx / len, y: dy / len };
}

/**
 * ⭐ 三角形三个顶点:尖端在 `tip`,两翼在**尖端后方**、关于轴线对称。
 *
 * ⚠️ `tangent` 为 null(退化线)→ 返回 null,**不画半个箭头**。
 */
export function arrowHeadPoints(tip: Pt, tangent: Pt | null, size: number): ArrowHead | null {
  if (!tangent) return null;
  // 沿轴线往回退 size,得到两翼所在的横截面中心
  const backX = tip.x - tangent.x * size;
  const backY = tip.y - tangent.y * size;
  // 法向量(轴向逆时针 90°)
  const nx = -tangent.y;
  const ny = tangent.x;
  const half = size * HALF_WIDTH_RATIO;
  return {
    tip: { x: tip.x, y: tip.y },
    left: { x: backX + nx * half, y: backY + ny * half },
    right: { x: backX - nx * half, y: backY - ny * half },
  };
}

/**
 * ⭐ 这个端点画不画箭头。
 *
 * ⚠️ v0 六种词表**统一画实心三角**(形状差异留后续)—— 但**都得画**:
 * 只认 `'arrow'` 会让 JSON 里写 `triangle` 的**静默不出箭头**,
 * 那是「配置写了没反应」的典型静默失败。
 */
export function shouldDrawArrow(kind: ArrowEndKind | undefined): boolean {
  return kind !== undefined && kind !== 'none';
}
