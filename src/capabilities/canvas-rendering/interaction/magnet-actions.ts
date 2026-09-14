/**
 * Magnet actions —— 连接点操作点的**纯逻辑层**(几何 / 命中 / 落点解析)
 *
 * 机制:每个图元的连接点(magnet)可以声明成「操作点」——
 * **点它** → 触发回调(调用方决定语义);**拖它** → 拉出一条连接到别的节点。
 *
 * ⚠️ 本模块**不认识任何业务语义**(不知道什么叫「折叠」)。
 * 它只知道「某个 magnet 上有一个可点的圆」。折叠 / 加子节点等由调用方接回调实现。
 *
 * ⭐ 为什么单独一个文件而不是全塞进 overlay 类:
 * 本仓库纪律是**断言先于交互代码**,而 vitest 跑在 node 环境(无 DOM / WebGL),
 * 测试不能 import three。把几何 / 命中 / 落点判定抽成纯函数,单测才能真验红;
 * `scene/MagnetActionsOverlay.ts` 只剩「画 mesh」的薄壳。
 * (同款做法:shape-library 的求值器、node-toolbar 的 registry —— 都是纯层单测。)
 *
 * 坐标语境(与 HandlesOverlay / magnet-snap 同源):
 * - 世界坐标:画板自身坐标系,Y 向下
 * - 屏幕坐标:容器内 CSS 像素
 * - 「像素恒定」:操作点圆的半径以屏幕像素计,不随 zoom 缩放
 */

import type { WorldMagnet } from './magnet-snap';

// ─────────────────────────────────────────────────────────
// 契约
// ─────────────────────────────────────────────────────────

/** 操作点图标(⭐ 画几何,不走文字渲染 —— 打包字体不覆盖 `⊕` 这类符号,会渲染成空白)*/
export type MagnetActionIcon = 'plus' | 'minus' | 'dot';

/** Instance 上声明「这个连接点是操作点」(⭐ 复用既有 magnet id,不新造坐标语言)*/
export interface MagnetAction {
  /** 既有 magnet id(N/E/S/W/START/END/...) */
  magnet: string;
  icon: MagnetActionIcon;
  /**
   * ⭐ 圆内显示的数字(可选)—— 如「折叠了几个分支」。
   *
   * ⚠️ 走 **canvas fillText → CanvasTexture**(系统字体),
   * **不走打包字体的矢量文字层** —— 后者不覆盖 `⊕` 这类符号会渲染成空白(踩过),
   * 而 `fillText` 用系统字体,阿拉伯数字必然有字形。
   * (同款做法:callout 图标的 icon-raster。)
   *
   * ⚠️ 有 count 时圆会**自动放大**到能容纳数字(见 radiusFor),
   * 否则两位数会溢出圆外。
   */
  count?: number;
}

/** 操作点半径(屏幕像素;与 HandlesOverlay 的 HANDLE_RADIUS 同量级但略大 —— 它要被点)*/
export const MAGNET_ACTION_RADIUS_PX = 6;

/**
 * ⭐ 带数字时的圆半径 —— 按位数放大,保证数字装得下。
 *
 * ⚠️ 不放大的话:半径 6px 的圆里塞「12」必然溢出到圆外,看起来像脏点。
 * 一位数 9px、两位 11px、三位及以上 13px(再多就该显示 99+ 了,见 labelFor)。
 */
export function radiusFor(action: { count?: number }): number {
  if (action.count === undefined) return MAGNET_ACTION_RADIUS_PX;
  const digits = labelFor(action).length;
  return digits <= 1 ? 9 : digits === 2 ? 11 : 13;
}

/**
 * 圆内文字。⚠️ 超过 99 显示 `99+` —— 三位以上会把圆撑得比节点还显眼。
 * 返回空串 = 不画文字(没有 count)。
 */
export function labelFor(action: { count?: number }): string {
  if (action.count === undefined) return '';
  if (action.count > 99) return '99+';
  return String(action.count);
}

/**
 * 命中容忍(屏幕像素)。
 * 与 HandlesOverlay 同口径(半径 + 8px):实测纯半径命中体感偏小。
 */
export const MAGNET_ACTION_HIT_SLOP_PX = 8;

/** 一个已解析到世界坐标的操作点(overlay 画它 / hitTest 比它)*/
export interface ResolvedMagnetAction {
  instanceId: string;
  magnetId: string;
  icon: MagnetActionIcon;
  /** 圆内数字(见 MagnetAction.count);undefined = 不画数字 */
  count?: number;
  /** 世界坐标(已含节点 rotation)*/
  x: number;
  y: number;
}

/** 拖出的落点:命中某节点的 magnet,或落在空白处的世界坐标 */
export type MagnetDragOutTarget =
  | { kind: 'magnet'; instanceId: string; magnet: string }
  | { kind: 'world'; world: { x: number; y: number } };

// ─────────────────────────────────────────────────────────
// ① 声明才画 —— 解析出「该画哪些操作点」
// ─────────────────────────────────────────────────────────

/**
 * 把「instance 上声明的 actions」与「该 instance 的 magnet 世界坐标」对齐。
 *
 * ⚠️ **只有声明了 action 的 magnet 才产出**(没声明的 magnet 依旧只是吸附目标,
 * 不是操作点)。声明了但 shape 上根本没有这个 magnet id → **丢弃并 warn**,
 * 不静默兜底到别的 magnet(fail loud:拼错 id 要看得见)。
 *
 * @param actions instance.magnetActions
 * @param magnets 该 instance 的全部 magnet 世界坐标(listMagnets 的输出)
 */
export function resolveMagnetActions(
  instanceId: string,
  actions: readonly MagnetAction[] | undefined,
  magnets: readonly WorldMagnet[],
): ResolvedMagnetAction[] {
  if (!actions || actions.length === 0) return [];
  const out: ResolvedMagnetAction[] = [];
  for (const a of actions) {
    const m = magnets.find((mm) => mm.magnetId === a.magnet);
    if (!m) {
      console.warn(
        `[magnet-actions] instance '${instanceId}' 声明了操作点 magnet '${a.magnet}',` +
          `但该图元没有这个连接点(有的是:${magnets.map((x) => x.magnetId).join(',') || '(无)'})`,
      );
      continue;
    }
    out.push({ instanceId, magnetId: a.magnet, icon: a.icon, count: a.count, x: m.x, y: m.y });
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// ② 命中判定 —— 像素恒定的圆
// ─────────────────────────────────────────────────────────

/**
 * 屏幕坐标命中哪个操作点。
 *
 * ⭐ **命中半径按屏幕像素算**(与画出来的圆同口径):世界坐标下的容忍距离
 * = (半径 + slop) / zoom —— 缩得越小,世界容忍越大,视觉上始终是同一个圆。
 * 若按固定世界距离判,放大后会「点得中看不见的地方」,缩小后会「点不中画出来的圆」。
 *
 * @param world 鼠标的世界坐标
 * @param zoom 当前视口 zoom(>0)
 * @returns 命中的操作点;多个重叠时取最近的
 */
export function hitTestMagnetAction(
  world: { x: number; y: number },
  resolved: readonly ResolvedMagnetAction[],
  zoom: number,
): ResolvedMagnetAction | null {
  if (resolved.length === 0) return null;
  let best: { a: ResolvedMagnetAction; d: number } | null = null;
  for (const a of resolved) {
    // ⚠️ 半径**逐个算** —— 带数字的圆更大,统一用基准半径会「画得大、点不中边缘」
    const radiusWorld = magnetActionHitRadiusWorld(zoom, a);
    const d = Math.hypot(world.x - a.x, world.y - a.y);
    if (d > radiusWorld) continue;
    if (!best || d < best.d) best = { a, d };
  }
  return best?.a ?? null;
}

/**
 * 命中半径换算到世界距离(zoom 兜到 0.01 防除零 —— 与 snapRadiusWorld 同款)。
 * @param action 传了就按它的实际半径算(带数字的圆更大);不传按基准半径。
 */
export function magnetActionHitRadiusWorld(zoom: number, action?: { count?: number }): number {
  const r = action ? radiusFor(action) : MAGNET_ACTION_RADIUS_PX;
  return (r + MAGNET_ACTION_HIT_SLOP_PX) / Math.max(zoom, 0.01);
}

// ─────────────────────────────────────────────────────────
// ③ 拖出落点解析
// ─────────────────────────────────────────────────────────

/**
 * 拖出松手时的落点:吸附到最近的 magnet,否则给世界坐标。
 *
 * ⭐ 吸附**复用 findClosestMagnet**(调用方传进来的结果),本函数只做「有没有」的分流,
 * 不重写吸附几何。
 *
 * @param closest findClosestMagnet 的返回(null = 附近没有 magnet)
 * @param world 松手处世界坐标
 */
export function resolveMagnetDragOut(
  closest: { magnet: WorldMagnet } | null,
  world: { x: number; y: number },
): MagnetDragOutTarget {
  if (closest) {
    return {
      kind: 'magnet',
      instanceId: closest.magnet.instanceId,
      magnet: closest.magnet.magnetId,
    };
  }
  return { kind: 'world', world: { x: world.x, y: world.y } };
}
