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
 *
 * ⭐⭐ **六种端形各画各的**(用户 2026-09-13 拍板:「基础图形的建设,应该现在画板构建」)。
 * ⚠️ 上一版打算「统一画实心三角、形状差异留后续」—— 那会让浮条上 6 个选项
 * **选了没区别**,是「配置写了没反应」的静默失败。故一次做齐。
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

/**
 * ⭐ 端形的几何产物 —— **顶点列 + 三角形索引**(而非固定三个点)。
 *
 * ⚠️ 为什么不是「三个点」:diamond 要 4 顶点 2 三角、oval 要扇形多三角。
 * 统一成 `{points, triangles}` 后,`LineRenderer` 只需**一套** mesh 代码吃所有形状。
 */
export interface ArrowHead {
  /** 尖端 —— ⭐ 就落在线的终点上(所有端形都以它为锚) */
  readonly tip: Pt;
  /** 多边形顶点(世界坐标) */
  readonly points: readonly Pt[];
  /** 三角形索引(每 3 个一组,指向 points 下标) */
  readonly triangles: readonly number[];
  /** ⭐ 线应当**缩短到**这一点,免得线尾从端形里穿出来(见 arrowInsetOf) */
  readonly inset: number;
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

/** oval 的扇形采样数(足够圆,又不至于顶点爆炸)。 */
const OVAL_SEGMENTS = 16;

/**
 * ⭐⭐ 按端形算几何 —— **六种各画各的**。
 *
 * 形状语义(本仓库首次定义;`ArrowEndKind` 此前只有类型没有几何):
 *
 * | kind | 形状 | 说明 |
 * |---|---|---|
 * | `none` | — | 不画(由 `shouldDrawArrow` 挡在前面) |
 * | `arrow` | 开口 V | ⭐ 两条短边,**不封口** —— 最轻,适合联系线 |
 * | `triangle` | 实心三角 | 经典流程图箭头 |
 * | `stealth` | 燕尾三角 | 尾部内凹,视觉更"锐" |
 * | `diamond` | 菱形 | UML 聚合;⚠️ 尖端在线端,**整体在线内侧** |
 * | `oval` | 圆点 | UML 常用端点标记 |
 *
 * ⚠️ `tangent` 为 null(退化线)→ 返回 null,**不画半个箭头**。
 */
export function arrowHeadPoints(
  tip: Pt,
  tangent: Pt | null,
  size: number,
  kind: ArrowEndKind = 'triangle',
): ArrowHead | null {
  if (!tangent) return null;
  if (!shouldDrawArrow(kind)) return null;

  // 轴向单位向量(指向尖端)与法向量(逆时针 90°)
  const ax = tangent.x;
  const ay = tangent.y;
  const nx = -tangent.y;
  const ny = tangent.x;
  const half = size * HALF_WIDTH_RATIO;
  /** 沿轴向后退 d、沿法向偏移 o 的点 */
  const at = (d: number, o: number): Pt => ({
    x: tip.x - ax * d + nx * o,
    y: tip.y - ay * d + ny * o,
  });

  switch (kind) {
    case 'oval': {
      // 圆心落在线端**内侧**半径处,使圆与线端相切
      const r = half;
      const c = at(r, 0);
      const pts: Pt[] = [c];
      for (let i = 0; i <= OVAL_SEGMENTS; i += 1) {
        const t = (i / OVAL_SEGMENTS) * Math.PI * 2;
        pts.push({ x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r });
      }
      const tris: number[] = [];
      for (let i = 1; i <= OVAL_SEGMENTS; i += 1) tris.push(0, i, i + 1);
      return { tip, points: pts, triangles: tris, inset: r * 2 };
    }
    case 'diamond': {
      // 尖端 → 两侧 → 尾尖;⭐ 长度取 size(与三角同轴长,视觉才协调)
      const pts: Pt[] = [tip, at(size / 2, half), at(size, 0), at(size / 2, -half)];
      return { tip, points: pts, triangles: [0, 1, 2, 0, 2, 3], inset: size };
    }
    case 'stealth': {
      // 燕尾:尾部中点向尖端内凹 0.35·size
      const pts: Pt[] = [tip, at(size, half), at(size * 0.65, 0), at(size, -half)];
      return { tip, points: pts, triangles: [0, 1, 2, 0, 2, 3], inset: size * 0.65 };
    }
    case 'arrow': {
      // ⭐ 开口 V:两条有厚度的短边,不封口。用 4 顶点 2 三角画出 "V" 的两臂
      const t = Math.max(1, size * 0.16); // 臂厚
      const l1 = at(size, half);
      const r1 = at(size, -half);
      const l2 = at(size - t * 1.6, half);
      const r2 = at(size - t * 1.6, -half);
      const tipIn = at(t * 1.6, 0);
      const pts: Pt[] = [tip, l1, l2, tipIn, r1, r2];
      return {
        tip,
        points: pts,
        // 左臂(tip,l1,l2 / tip,l2,tipIn)+ 右臂(tip,r2,r1 / tip,tipIn,r2)
        triangles: [0, 1, 2, 0, 2, 3, 0, 3, 5, 0, 5, 4],
        inset: 0, // 开口箭头不遮线尾,不缩线
      };
    }
    case 'triangle':
    default: {
      const pts: Pt[] = [tip, at(size, half), at(size, -half)];
      return { tip, points: pts, triangles: [0, 1, 2], inset: size };
    }
  }
}

/**
 * ⭐ 这个端点画不画箭头。
 *
 * ⚠️ 六种词表**各画各的形状**(见 `arrowHeadPoints`)——
 * 只认 `'arrow'` 会让 JSON 里写 `triangle` 的**静默不出箭头**,
 * 那是「配置写了没反应」的典型静默失败。
 */
export function shouldDrawArrow(kind: ArrowEndKind | undefined): boolean {
  return kind !== undefined && kind !== 'none';
}
