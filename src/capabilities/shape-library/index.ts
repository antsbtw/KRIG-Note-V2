/**
 * shape-library capability — Shape + Substance 资源仓库(L5-G2)
 *
 * 职责:Shape 定义(22 个内置)+ Substance 定义(5 个内置)+ 通用参数化求值器
 * (evaluateShape)+ OOXML 17 操作符公式求值器,**对外只输出纯数据**
 * (EvaluatedPath),**0 import three**(P1-1 严格版屏障核心).
 *
 * ── 下游消费者(规划)──
 *
 * - L5-G3 capabilities/canvas-rendering/scene/NodeRenderer:消费 evaluate
 *   返回的 EvaluatedPath,内部 path-to-three.ts 转 THREE.Shape → Mesh
 * - L5-G4 capabilities/canvas-rendering/ui/library-picker:消费 list /
 *   listByCategory 显示缩略图
 * - 里程碑 H family-tree projection:消费 SubstanceRegistry + visual_rules
 *
 * ── W5 严格态 A 边界(audit 2026-05-08 § 5.2)──
 *
 * - View 侧(强制):走 requireCapabilityApi('shape-library').shapes.evaluate(...)
 *   间接路由
 * - Driver/slot 侧(允许):可直 import @capabilities/shape-library 单例兜底
 *   ↑ 临时允许项,后续 charter v0.5 升级时统一改造
 *
 * 模块级 export 同时挂(双导出),对齐 ebook-library / graph-library-store / learning.
 *
 * ── P1-1 严格版屏障落地点 ──
 *
 * 本 capability 内 **0 import three**;types.ts 的 EvaluatedPath 是纯数据
 * (d 字符串 + magnets + textBox);path-to-three.ts(V1 395 行 import three)
 * 不归本 capability,归 capabilities/canvas-rendering/scene/(G3 实施).
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type {
  ShapeLibraryApi,
  ShapeDef,
  ShapeCategory,
  SubstanceDef,
  EvaluateContext,
  EvaluateInput,
  EvaluatedPath,
} from './types';
import { ShapeRegistry } from './shapes/registry';
import { SubstanceRegistry } from './substances/registry';
import { bootstrapShapes } from './shapes/bootstrap';
import { bootstrapSubstances } from './substances/bootstrap';
import { evaluateShape } from './shapes/renderers';

export type {
  ShapeLibraryApi,
  ShapeDef,
  ShapeCategory,
  SubstanceDef,
  EvaluateContext,
  EvaluateInput,
  EvaluatedPath,
  RendererKind,
  AspectKind,
  ParamUnit,
  ShapeSource,
  SubstanceSource,
  FormulaOp,
  FormulaValue,
  PathCmd,
  MagnetPoint,
  ShapeHandle,
  TextBox,
  DashType,
  ArrowEndKind,
  FillStyle,
  LineStyle,
  ArrowStyle,
  DefaultStyle,
  ShapeParam,
  ShapeGuide,
  ComponentTransform,
  SubstanceLineEndpoint,
  SubstanceComponent,
  VisualRule,
  ShapePack,
  SubstancePack,
} from './types';

// 模块级 export(W5 边界 A 临时允许项 — driver/slot 内部可直 import)
export { ShapeRegistry, SubstanceRegistry };
export { evaluateShape } from './shapes/renderers';
export { evalFormula, buildEnv } from './shapes/renderers';
export type { EvalEnv } from './shapes/renderers';
export { runShapeSmoke, printSmoke } from './shapes/__smoke__/run';
export type { SmokeReport } from './shapes/__smoke__/run';

// ── side-effect import 立即 bootstrap(G2-8=B 决策)──
bootstrapShapes();
bootstrapSubstances();

// ── 自我诊断(charter § 5,独立行)──
const _shapeCount = ShapeRegistry.list().length;
const _substanceCount = SubstanceRegistry.list().length;
console.info(
  `[shape-library] alive | shapes: ${_shapeCount}, substances: ${_substanceCount}`,
);

// ── dev-only:启动时跑 smoke test + 暴露到 window.__krig.shapeLib(DevTools 自检用)──
// prod 模式 Vite dead-code eliminate 整段(import.meta.env.DEV === false)
if (import.meta.env.DEV) {
  // 启动跑一次 smoke,失败时输出 failures 表
  import('./shapes/__smoke__/run').then(({ runShapeSmoke, printSmoke }) => {
    const rep = runShapeSmoke();
    printSmoke(rep);
  });
  // DevTools 桥:`window.__krig.shapeLib.shapes.evaluate(...)` 等
  // (path alias `@capabilities/*` 在 DevTools 原生 import 不识别,这里挂全局桥)
  const krig = (window as unknown as { __krig?: Record<string, unknown> }).__krig ?? {};
  krig.shapeLib = {
    shapes: { Registry: ShapeRegistry },
    substances: { Registry: SubstanceRegistry },
  };
  (window as unknown as Record<string, unknown>).__krig = krig;
}

// ── api 路由(W5 严格态 Registry 注册)──

const shapesApi: ShapeLibraryApi['shapes'] = {
  register(def: ShapeDef): void {
    ShapeRegistry.register(def);
  },
  get(id: string): ShapeDef | null {
    return ShapeRegistry.get(id);
  },
  list(): ShapeDef[] {
    return ShapeRegistry.list();
  },
  listByCategory(category: ShapeCategory): ShapeDef[] {
    return ShapeRegistry.listByCategory(category);
  },
  evaluate(
    id: string,
    _props: EvaluateInput,
    ctx: EvaluateContext,
  ): EvaluatedPath | null {
    const shape = ShapeRegistry.get(id);
    if (!shape) return null;
    return evaluateShape(shape, ctx);
  },
};

const substancesApi: ShapeLibraryApi['substances'] = {
  register(def: SubstanceDef): void {
    SubstanceRegistry.register(def);
  },
  get(id: string): SubstanceDef | null {
    return SubstanceRegistry.get(id);
  },
  list(): SubstanceDef[] {
    return SubstanceRegistry.list();
  },
  listByCategory(category: string): SubstanceDef[] {
    return SubstanceRegistry.listByCategory(category);
  },
  // evaluate 留 v1.5+ 实施(G2-7=B,composer / visual-rules 留空壳)
};

capabilityRegistry.register({
  id: 'shape-library',
  api: {
    shapes: shapesApi,
    substances: substancesApi,
  } satisfies ShapeLibraryApi,
});
