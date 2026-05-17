/**
 * computeLayout — 把通用 LayoutInput + LayoutOptions 转 elkjs 格式 → 调 elk.layout() → 平铺回 LayoutResult
 *
 * 设计:输入 / 输出都是与 SDK 无关的纯数据,业务方无需 import elkjs。
 *
 * ELK options key 是字符串(如 `elk.algorithm`, `elk.direction`),value 也是字符串。
 * direction 'UP'/'DOWN'/'LEFT'/'RIGHT' 对应 ELK 的 `elk.direction` 同名值。
 * spacing 三个常用 key 对齐 ELK 文档:
 *   - elk.spacing.nodeNode
 *   - elk.layered.spacing.nodeNodeBetweenLayers
 *   - elk.spacing.edgeEdge
 * extra options 透传(允许业务方定制 elk.* 任意 key)。
 */

import { getElk } from './elk-singleton';
import type {
  LayoutInput,
  LayoutOptions,
  LayoutResult,
  LayoutNodeResult,
  LayoutEdgeResult,
} from './types';

interface ElkOptionsBag {
  [key: string]: string;
}

function buildElkOptions(opts: LayoutOptions): ElkOptionsBag {
  const out: ElkOptionsBag = {
    'elk.algorithm': opts.algorithm,
  };
  if (opts.direction) out['elk.direction'] = opts.direction;
  if (opts.spacing?.node !== undefined) {
    out['elk.spacing.nodeNode'] = String(opts.spacing.node);
  }
  if (opts.spacing?.layer !== undefined) {
    out['elk.layered.spacing.nodeNodeBetweenLayers'] = String(opts.spacing.layer);
  }
  if (opts.spacing?.edge !== undefined) {
    out['elk.spacing.edgeEdge'] = String(opts.spacing.edge);
  }
  if (opts.extra) Object.assign(out, opts.extra);
  return out;
}

export async function computeLayout(
  input: LayoutInput,
  options: LayoutOptions,
): Promise<LayoutResult> {
  const elk = getElk();

  const graph = {
    id: 'root',
    layoutOptions: buildElkOptions(options),
    children: input.nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
    })),
    edges: input.edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  // elk.layout 类型用 unknown 兜底:elkjs types 用 generics 推导子节点,
  // 但运行时只需读 x/y/width/height/sections 字段。
  const laidOut = (await elk.layout(graph)) as unknown as {
    width?: number;
    height?: number;
    children?: Array<{ id: string; x?: number; y?: number; width?: number; height?: number }>;
    edges?: Array<{
      id: string;
      sections?: Array<{
        startPoint: { x: number; y: number };
        endPoint: { x: number; y: number };
        bendPoints?: Array<{ x: number; y: number }>;
      }>;
    }>;
  };

  const nodes: LayoutNodeResult[] = (laidOut.children ?? []).map((c) => ({
    id: c.id,
    x: c.x ?? 0,
    y: c.y ?? 0,
    width: c.width ?? 0,
    height: c.height ?? 0,
  }));

  const edges: LayoutEdgeResult[] = (laidOut.edges ?? []).map((e) => ({
    id: e.id,
    sections: (e.sections ?? []).map((s) => ({
      startPoint: { x: s.startPoint.x, y: s.startPoint.y },
      endPoint: { x: s.endPoint.x, y: s.endPoint.y },
      bendPoints: s.bendPoints?.map((p) => ({ x: p.x, y: p.y })),
    })),
  }));

  return {
    nodes,
    edges,
    width: laidOut.width ?? 0,
    height: laidOut.height ?? 0,
  };
}
