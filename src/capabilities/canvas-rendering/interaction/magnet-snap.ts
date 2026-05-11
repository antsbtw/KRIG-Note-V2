/**
 * Magnet 吸附 — 几何计算 + 端点解析(L5-G4.1)
 *
 * V1 直迁:src/plugins/graph/canvas/interaction/magnet-snap.ts(182 行).
 * V2 改动(对齐 L5G4 design G4-10=A 严格按 V1 直迁 + 整段砍):
 * - import 路径:V1 ../../library/{shapes,substances,types} → V2 经
 *   `@capabilities/shape-library/types`(类型)+ `requireCapabilityApi('shape-library')`(运行时)
 * - 模块级 lazy cache shapeApi 以避免每次函数调用都查 registry
 *
 * 职责:
 * - 给定 RenderedNode + magnet id,返回 magnet 在画板世界坐标系中的 (x, y)
 * - 给定 instance + endpoints,解析两端世界坐标
 * - 给定屏幕点 + 候选 nodes,找最近的 magnet(M1.3 创建 line 时吸附用)
 *
 * shape 实例:从 ShapeDef.magnets 取归一化坐标,乘 size + 加 position
 * substance 实例:取 binding='frame' 的 component 的 shape 的 magnets,
 *   叠加 component.transform 偏移
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  MagnetPoint,
  ShapeLibraryApi,
} from '@capabilities/shape-library/types';
import type { Instance } from '../types';
import type { RenderedNode } from '../scene/NodeRenderer';

export interface WorldMagnet {
  /** 所属 instance id */
  instanceId: string;
  /** magnet id(如 "N" / "S" / "START" / "END") */
  magnetId: string;
  /** 世界坐标 */
  x: number;
  y: number;
}

/** 吸附阈值(屏幕像素;转世界坐标时由调用方乘 view-zoom 比例) */
export const MAGNET_SNAP_RADIUS_PX = 16;

// ── 模块级 lazy shapeApi(对齐 NodeRenderer 模式) ──

let _shapeApi: ShapeLibraryApi | null = null;
function getShapeApi(): ShapeLibraryApi {
  if (!_shapeApi) {
    _shapeApi = requireCapabilityApi<ShapeLibraryApi>('shape-library');
  }
  return _shapeApi;
}

// ─────────────────────────────────────────────────────────
// magnet 世界坐标解析
// ─────────────────────────────────────────────────────────

/** 列出 instance 的所有 magnet 世界坐标 */
export function listMagnets(node: RenderedNode, instance: Instance): WorldMagnet[] {
  const magnets = magnetsForInstance(instance);
  if (!magnets) return [];
  return magnets.map((m) => {
    const { x, y } = magnetToWorld(node, m.x, m.y);
    return { instanceId: instance.id, magnetId: m.id, x, y };
  });
}

/** 解析单个 magnet 的世界坐标;失败返回 null */
export function resolveMagnet(
  node: RenderedNode,
  instance: Instance,
  magnetId: string,
): { x: number; y: number } | null {
  const magnets = magnetsForInstance(instance);
  if (!magnets) return null;
  const m = magnets.find((mm) => mm.id === magnetId);
  if (!m) return null;
  return magnetToWorld(node, m.x, m.y);
}

/**
 * 把本地归一化 magnet 坐标(0..1)转世界坐标,考虑节点 rotation
 * 算法:本地相对 bbox 中心 → 旋转 → 平移到 bbox 中心(世界)
 */
function magnetToWorld(
  node: RenderedNode,
  mxNorm: number,
  myNorm: number,
): { x: number; y: number } {
  const { x: px, y: py } = node.position;
  const { w, h } = node.size;
  const cx = px + w / 2;
  const cy = py + h / 2;
  // magnet 在 bbox 内的本地坐标(中心为原点)
  const lx = (mxNorm - 0.5) * w;
  const ly = (myNorm - 0.5) * h;
  const rad = ((node.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  };
}

/** 取 instance 的 magnet 列表(shape 直接看 ShapeDef.magnets;substance 看 frame component) */
function magnetsForInstance(instance: Instance): MagnetPoint[] | null {
  const api = getShapeApi();
  if (instance.type === 'shape') {
    const shape = api.shapes.get(instance.ref);
    return shape?.magnets ?? null;
  }
  // substance:找 binding='frame' 的 shape component(若无,fallback 第一个 shape component)
  const def = api.substances.get(instance.ref);
  if (!def) return null;
  const frame =
    def.components.find((c) => c.type === 'shape' && c.binding === 'frame') ??
    def.components.find((c) => c.type === 'shape');
  if (!frame) return null;
  const shape = api.shapes.get(frame.ref);
  return shape?.magnets ?? null;
}

// ─────────────────────────────────────────────────────────
// 最近 magnet 查找(M1.3 创建 line 时用)
// ─────────────────────────────────────────────────────────

export interface ClosestMagnetResult {
  magnet: WorldMagnet;
  /** 世界坐标距离 */
  distance: number;
}

/**
 * 在候选 instances 中找离 (worldX, worldY) 最近的 magnet
 * @param maxDistance 世界坐标距离阈值,超过返回 null(调用方按 view zoom 换算)
 * @param exclude 跳过这些 instance(避免吸附到 line 自身的源端 instance)
 */
export function findClosestMagnet(
  worldX: number, worldY: number,
  candidates: Array<{ node: RenderedNode; instance: Instance }>,
  maxDistance: number,
  exclude?: Set<string>,
): ClosestMagnetResult | null {
  let best: ClosestMagnetResult | null = null;
  for (const { node, instance } of candidates) {
    if (exclude?.has(instance.id)) continue;
    const magnets = listMagnets(node, instance);
    for (const m of magnets) {
      const dx = m.x - worldX;
      const dy = m.y - worldY;
      const d = Math.hypot(dx, dy);
      if (d > maxDistance) continue;
      if (!best || d < best.distance) {
        best = { magnet: m, distance: d };
      }
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────
// line 端点解析(M1.2c 主用途)
// ─────────────────────────────────────────────────────────

export interface LineEndpoints {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * 解析 line 实例的两端世界坐标
 * - 若 instance.endpoints 存在,走 magnet 解析
 * - 若没 endpoints 但有 position+size,走"内部归一化"解析(用 line 的 START/END magnet)
 * - 否则返回 null(无法绘制)
 *
 * 调用方需要传一个解析器,把 endpoints[i].instance 转回 (RenderedNode, Instance)
 * 因为 magnet-snap 不持有 NodeRenderer 引用(避免循环依赖)。
 */
export function resolveLineEndpoints(
  instance: Instance,
  resolveOther: (id: string) => { node: RenderedNode; instance: Instance } | null,
): LineEndpoints | null {
  if (instance.endpoints) {
    const [a, b] = instance.endpoints;
    const aPair = resolveOther(a.instance);
    const bPair = resolveOther(b.instance);
    if (!aPair || !bPair) return null;
    const aPos = resolveMagnet(aPair.node, aPair.instance, a.magnet);
    const bPos = resolveMagnet(bPair.node, bPair.instance, b.magnet);
    if (!aPos || !bPos) return null;
    return { start: aPos, end: bPos };
  }
  // 无 endpoints:line 用 position + size,START 在 (0,0),END 在 (w, h)
  if (instance.position && instance.size) {
    return {
      start: { x: instance.position.x, y: instance.position.y },
      end: {
        x: instance.position.x + instance.size.w,
        y: instance.position.y + instance.size.h,
      },
    };
  }
  return null;
}
