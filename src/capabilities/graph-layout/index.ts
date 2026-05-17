/**
 * graph-layout capability — ELK 单点屏障
 *
 * **本 capability 是 V2 唯一允许 import elkjs 和 @mermaid-js/layout-elk 的位置**
 * (对齐 canvas-rendering 的 Three.js 单点屏障 + code-editing 的 CM6 单点屏障)。
 *
 * 其他位置(view / driver / 其他 capability)0 import ELK,通过
 * `requireCapabilityApi<GraphLayoutApi>('graph-layout')` 拿 computeLayout +
 * getMermaidElkLoader API。
 *
 * ── 下游消费者(规划)──
 *
 * - drivers/text-editing-driver/blocks/code-block/mermaid-renderer.ts
 *   (Phase 2 切换;mermaid 通过 getMermaidElkLoader)
 * - 未来画板 graph canvas — computeLayout 算自动布局起点
 * - 未来 BPMN / Mind / 知识图谱 view — computeLayout 直接消费
 *
 * ── 设计文档 ──
 *
 * docs/tasks/cm6-elk-capability-refactor.md §Task B
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { GraphLayoutApi } from './types';
import { computeLayout } from './compute-layout';
import { getElk } from './elk-singleton';
import { getMermaidElkLoader } from './adapters/mermaid-elk-loader';

export type {
  GraphLayoutApi,
  LayoutInput,
  LayoutNodeInput,
  LayoutEdgeInput,
  LayoutOptions,
  LayoutAlgorithm,
  LayoutDirection,
  LayoutSpacing,
  LayoutResult,
  LayoutNodeResult,
  LayoutEdgeResult,
  LayoutEdgeSection,
  LayoutPoint,
} from './types';

// 算法 preset re-export(对齐 shape-library 模块级 export 模式 — driver/slot 可直 import 兜底)
export { layeredPreset } from './algorithms/layered';
export { mrtreePreset } from './algorithms/mrtree';
export { forcePreset } from './algorithms/force';
export { radialPreset } from './algorithms/radial';
export { stressPreset } from './algorithms/stress';

export { computeLayout };

// ── 自我诊断 ──
console.info('[graph-layout] alive | elk lazy-init, mermaid loader lazy-load');

// ── Registry 注册 ──
capabilityRegistry.register({
  id: 'graph-layout',
  api: {
    computeLayout,
    getElkInstance: () => getElk(),
    // adapters/mermaid-elk-loader 返回 Promise;types.ts 签名也是 unknown,
    // 消费方 await 拿到真 loader 再传给 mermaid.registerLayoutLoaders。
    getMermaidElkLoader: () => getMermaidElkLoader(),
  } satisfies GraphLayoutApi,
});
