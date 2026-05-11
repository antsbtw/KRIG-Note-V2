/**
 * Combine to Substance — 把多个 selected 实例打包成一个 SubstanceDef
 *
 * V1 直迁(src/plugins/graph/canvas/combine.ts:182 行),V2 改动:
 * - ShapeRegistry / SubstanceRegistry 直接 import → 走 requireCapabilityApi
 * - 不引入 NodeRenderer 类型(避免跨方向耦合,通过 nr 参数注入接口)
 *
 * 算法(Canvas.md §3.5):
 * 1. 取所有 selected shape 实例(substance 实例 v1 不嵌套,留 v1.1)
 * 2. line 实例两端必须都在 selected 内才一并打包(否则跳过)
 * 3. 计算 shape bbox(line 不参与 bbox)
 * 4. 以 bbox 左上角为新 substance 局部原点
 * 5. 第一个 shape component 标 binding='frame'
 * 6. line components endpoints 重映射到 substance 内部 'comp:N'
 * 7. register substance(运行时) + 删原 instances + 添加新 substance 实例
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  ShapeLibraryApi,
  SubstanceComponent,
  SubstanceDef,
} from '@capabilities/shape-library/types';
import type { Instance } from './types';
import type { NodeRenderer } from './scene/NodeRenderer';

export interface CombineParams {
  selectedIds: string[];
  name: string;
  category: string;
  description: string;
}

export interface CombineResult {
  substanceId: string;
  newInstanceId: string;
  /** 组合时被吃掉的原 instance id 列表(已从画板上删除) */
  consumedIds: string[];
}

let _shapeApi: ShapeLibraryApi | null = null;
function getShapeApi(): ShapeLibraryApi {
  if (!_shapeApi) {
    _shapeApi = requireCapabilityApi<ShapeLibraryApi>('shape-library');
  }
  return _shapeApi;
}

export function combineSelectedToSubstance(
  nr: NodeRenderer,
  params: CombineParams,
): CombineResult | null {
  const api = getShapeApi();

  // 1. 分两批:shape 必备 + line(两端都在 selected 内)
  const shapeInsts: Instance[] = [];
  const lineInsts: Instance[] = [];
  const selectedSet = new Set(params.selectedIds);

  for (const id of params.selectedIds) {
    const inst = nr.getInstance(id);
    if (!inst) continue;
    if (inst.type !== 'shape') continue;          // substance 实例不嵌套(留 v1.1)
    const shape = api.shapes.get(inst.ref);
    if (!shape) continue;
    if (shape.category === 'line') {
      if (!inst.endpoints) continue;
      const [a, b] = inst.endpoints;
      if (!selectedSet.has(a.instance) || !selectedSet.has(b.instance)) continue;
      lineInsts.push(inst);
    } else {
      if (!inst.position || !inst.size) continue;
      shapeInsts.push(inst);
    }
  }
  if (shapeInsts.length < 2) {
    console.warn('[combine] need at least 2 shape instances(line 端点必须都在 selected 里才一并打包)');
    return null;
  }

  // 2. 计算 bbox(只看 shape)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const inst of shapeInsts) {
    const x1 = inst.position!.x;
    const y1 = inst.position!.y;
    const x2 = x1 + inst.size!.w;
    const y2 = y1 + inst.size!.h;
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  }
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  // 3a. 构造 shape components(相对 bbox 左上)
  const components: SubstanceComponent[] = shapeInsts.map((inst, i) => ({
    type: 'shape',
    ref: inst.ref,
    transform: {
      x: inst.position!.x - minX,
      y: inst.position!.y - minY,
      w: inst.size!.w,
      h: inst.size!.h,
    },
    style_overrides: inst.style_overrides as Record<string, unknown> | undefined,
    binding: i === 0 ? 'frame' : undefined,
  }));

  // 3b. line components — endpoints 重映射到 'comp:N'
  const instanceIdToCompIdx = new Map<string, number>();
  shapeInsts.forEach((inst, i) => instanceIdToCompIdx.set(inst.id, i));

  for (const lineInst of lineInsts) {
    const [a, b] = lineInst.endpoints!;
    const aIdx = instanceIdToCompIdx.get(a.instance);
    const bIdx = instanceIdToCompIdx.get(b.instance);
    if (aIdx === undefined || bIdx === undefined) continue;
    components.push({
      type: 'shape',
      ref: lineInst.ref,
      transform: { x: 0, y: 0 },                  // line 端点驱动,transform 占位
      style_overrides: lineInst.style_overrides as Record<string, unknown> | undefined,
      endpoints: [
        { component: `comp:${aIdx}`, magnet: a.magnet },
        { component: `comp:${bIdx}`, magnet: b.magnet },
      ],
    });
  }

  // 4. 创建 SubstanceDef
  const substanceId = makeSubstanceId(params.name);
  const def: SubstanceDef = {
    id: substanceId,
    category: params.category,
    name: params.name,
    description: params.description || undefined,
    components,
    source: 'user',
    created_at: Date.now(),
  };
  api.substances.register(def);

  // 5. 删原 instances + 添加新 substance 实例
  const consumedIds = [...shapeInsts.map((i) => i.id), ...lineInsts.map((i) => i.id)];
  for (const id of consumedIds) {
    nr.remove(id);
  }
  const newInstanceId = nr.nextInstanceId();
  nr.add({
    id: newInstanceId,
    type: 'substance',
    ref: substanceId,
    position: { x: minX, y: minY },
    size: { w: bboxW, h: bboxH },
  });

  return { substanceId, newInstanceId, consumedIds };
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

function makeSubstanceId(name: string): string {
  const api = getShapeApi();
  const slug = slugify(name) || 'custom';
  const rand = Math.random().toString(36).slice(2, 8);
  let id = `user.${slug}.${rand}`;
  while (api.substances.get(id) !== null) {
    id = `user.${slug}.${Math.random().toString(36).slice(2, 8)}`;
  }
  return id;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
