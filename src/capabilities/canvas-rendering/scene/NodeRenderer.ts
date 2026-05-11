/**
 * NodeRenderer — Canvas instance JSON → Three.js mesh 渲染管线(L5-G3 减量版)
 *
 * V1 直迁:src/plugins/graph/canvas/scene/NodeRenderer.ts(818 行).
 * V2 G3 减量(对齐 design v0.3 § 1.2):
 * - **砍 line 渲染**(V1 `renderLineShape` + LineRenderer + magnet-snap → 留 G4 灰线占位)
 * - **砍 text 渲染**(V1 `renderTextInstance` + TextRenderer + atom-bridge → 留 G4 灰矩形占位)
 * - **砍 substance 内 line/text 子组件**(V1 `renderLineComponent` / 同 → G3-5 静默 skip)
 * - **走 G3-2=A**:通过 `requireCapabilityApi<ShapeLibraryApi>('shape-library')` 拿
 *   shapes / substances API(对齐 V2 既有 ebook-rendering Host.tsx 模式)
 * - **走 G3-3=B**:`shapes.evaluate(id, props, ctx)` 返 `EvaluatedPath` 纯数据 →
 *   `pathToThree(evalPath, opts)` 转 mesh(path-to-three 是本 capability 内部模块)
 *
 * G4 接续:line 渲染 + line endpoints 驱动 + text label + substance line/text 子组件 + canvas-text-node 接入.
 */

import * as THREE from 'three';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  ShapeLibraryApi,
  ShapeDef,
  SubstanceDef,
  SubstanceComponent,
  FillStyle,
  LineStyle,
  EvaluatedPath,
} from '@capabilities/shape-library/types';
import type { Instance } from '../types';
import type { SceneManager } from './SceneManager';
import { pathToThree } from './path-to-three';

/**
 * **G3-10 文字节点占位**:遇 ref === 'krig.text.label' 渲染半透明灰矩形 + 标签
 * **G3-5 line 占位**:遇 shape.category === 'line' 渲染灰色线段(端点用 inst.endpoints 解析,
 * line 端点 magnet 跟随留 G4 真实施;G3 若 endpoints 缺失,渲染占位矩形)
 */
const TEXT_REF = 'krig.text.label';

export interface RenderedNode {
  instanceId: string;
  kind: 'shape' | 'substance';
  /** 渲染产物根节点(挂到 scene)*/
  group: THREE.Group;
  /** instance 引用的 shape/substance id */
  shapeRef: string;
  /** 简化的当前位置(交互模块用) */
  position: { x: number; y: number };
  size: { w: number; h: number };
  rotation?: number;
}

export class NodeRenderer {
  /** instanceId → 渲染产物 */
  private byId = new Map<string, RenderedNode>();
  /** 原始 Instance 数据(给 view 端 serialize 用) */
  private instances = new Map<string, Instance>();

  /** lazy shape-library api;首次 mount 时拿一次 */
  private shapeApi: ShapeLibraryApi | null = null;

  constructor(private sceneManager: SceneManager) {}

  private getShapeApi(): ShapeLibraryApi {
    if (!this.shapeApi) {
      this.shapeApi = requireCapabilityApi<ShapeLibraryApi>('shape-library');
    }
    return this.shapeApi;
  }

  // ─────────────────────────────────────────────────────────
  // 增量 / 全量 API(对齐 V1)
  // ─────────────────────────────────────────────────────────

  /** 全量替换:清掉现有节点,渲染新的 instances 列表 */
  setInstances(instances: Instance[]): void {
    this.clear();
    for (const inst of instances) {
      this.add(inst);
    }
  }

  /** 增量添加单个 instance */
  add(inst: Instance): void {
    const rendered = this.renderInstance(inst);
    if (rendered) {
      this.sceneManager.scene.add(rendered.group);
      this.byId.set(inst.id, rendered);
      this.instances.set(inst.id, inst);
    }
  }

  /** 更新单个 instance(目前实现:remove + add;V1 同) */
  update(updated: Instance): void {
    this.remove(updated.id);
    this.add(updated);
  }

  /** 删除某个 instance */
  remove(id: string): void {
    const rn = this.byId.get(id);
    if (!rn) return;
    disposeGroup(rn.group);
    this.sceneManager.scene.remove(rn.group);
    this.byId.delete(id);
    this.instances.delete(id);
  }

  /** 清空所有节点 */
  clear(): void {
    for (const rn of this.byId.values()) {
      disposeGroup(rn.group);
      this.sceneManager.scene.remove(rn.group);
    }
    this.byId.clear();
    this.instances.clear();
  }

  /** 拖动时直接改 position(避免 remove + add 重建 mesh) */
  setPosition(id: string, position: { x: number; y: number }): void {
    const rn = this.byId.get(id);
    if (!rn) return;
    rn.position = { ...position };
    rn.group.position.x = position.x + rn.size.w / 2;
    rn.group.position.y = position.y + rn.size.h / 2;
    const inst = this.instances.get(id);
    if (inst) inst.position = { ...position };
  }

  /** 查询 instance 的渲染产物 */
  get(id: string): RenderedNode | undefined {
    return this.byId.get(id);
  }

  /** 查询原始 Instance */
  getInstance(id: string): Instance | undefined {
    return this.instances.get(id);
  }

  /** 列出所有 instance(原始数据)*/
  listInstances(): Instance[] {
    return Array.from(this.instances.values());
  }

  /** 当前所有已渲染的 instance id */
  ids(): string[] {
    return Array.from(this.byId.keys());
  }

  /** 生成不冲突的 instance id */
  nextInstanceId(prefix = 'i'): string {
    let n = this.byId.size + 1;
    while (this.byId.has(`${prefix}-${pad(n)}`)) n++;
    return `${prefix}-${pad(n)}`;
  }

  /** fit camera 到所有节点 */
  fitAll(padding = 0.1): boolean {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const rn of this.byId.values()) {
      const { position, size } = rn;
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + size.w);
      maxY = Math.max(maxY, position.y + size.h);
    }
    if (!Number.isFinite(minX)) return false;
    return this.sceneManager.fitToBox({ minX, minY, maxX, maxY }, padding);
  }

  // ─────────────────────────────────────────────────────────
  // 渲染细节
  // ─────────────────────────────────────────────────────────

  private renderInstance(inst: Instance): RenderedNode | null {
    if (inst.type === 'shape') {
      return this.renderShapeInstance(inst);
    } else {
      return this.renderSubstanceInstance(inst);
    }
  }

  /** 单个 shape 实例 */
  private renderShapeInstance(inst: Instance): RenderedNode | null {
    const api = this.getShapeApi();
    const shape = api.shapes.get(inst.ref);
    if (!shape) {
      console.warn(`[canvas-rendering/NodeRenderer] shape not found: ${inst.ref} (instance ${inst.id})`);
      return null;
    }

    // G3-10 文字节点占位
    if (inst.ref === TEXT_REF) {
      return this.renderPlaceholder(inst, shape, 'text');
    }

    // G3-5 line 类 shape:占位(灰线段,line 端点驱动留 G4)
    if (shape.category === 'line') {
      return this.renderPlaceholder(inst, shape, 'line');
    }

    // 正常 shape:走 evaluate → path-to-three
    const { position, size } = ensurePositionSize(inst, shape);
    const evalPath = api.shapes.evaluate(
      inst.ref,
      {},
      { width: size.w, height: size.h, params: inst.params },
    );
    if (!evalPath) {
      console.warn(`[canvas-rendering/NodeRenderer] shape ${inst.ref} evaluate returned null`);
      return null;
    }
    const out = pathToThree(evalPath, {
      fill: mergeFill(shape.default_style?.fill, inst.style_overrides?.fill),
      stroke: mergeLine(shape.default_style?.line, inst.style_overrides?.line),
    });
    // outer/inner 嵌套实现 bbox 中心旋转
    const outerGroup = wrapForRotation(out.group, position, size, inst.rotation ?? 0);
    outerGroup.userData.instanceId = inst.id;
    return {
      instanceId: inst.id,
      kind: 'shape',
      group: outerGroup,
      shapeRef: inst.ref,
      position: { ...position },
      size: { ...size },
      rotation: inst.rotation ?? 0,
    };
  }

  /**
   * substance 实例 — 减量版(G3-5):
   * 展开 components,只渲染 type='shape' 且**不是 line / text**的子组件;
   * 其他子组件静默跳过(留 G4 真实施).
   */
  private renderSubstanceInstance(inst: Instance): RenderedNode | null {
    const api = this.getShapeApi();
    const def = api.substances.get(inst.ref);
    if (!def) {
      console.warn(`[canvas-rendering/NodeRenderer] substance not found: ${inst.ref} (instance ${inst.id})`);
      return null;
    }

    // 估算 substance 原始 bbox(component 的 transform.x/y + w/h 取 max)
    const bbox = estimateSubstanceBbox(def, api);
    const { position, size } = ensurePositionSize(inst, null, bbox);
    const scale = {
      x: bbox.w > 0 ? size.w / bbox.w : 1,
      y: bbox.h > 0 ? size.h / bbox.h : 1,
    };

    const innerGroup = new THREE.Group();
    for (const comp of def.components) {
      // G3-5 静默 skip 不支持的 component(line / 嵌套 substance / text 子组件)
      if (comp.type !== 'shape') continue;
      const compShape = api.shapes.get(comp.ref);
      if (!compShape) continue;
      // line / text 子组件 G4 实施,G3 跳过
      if (compShape.category === 'line') continue;
      if (comp.ref === TEXT_REF) continue;

      const compGroup = renderComponent(comp, compShape, scale, api);
      if (compGroup) innerGroup.add(compGroup);
    }

    const outerGroup = wrapForRotation(innerGroup, position, size, inst.rotation ?? 0);
    outerGroup.userData.instanceId = inst.id;
    return {
      instanceId: inst.id,
      kind: 'substance',
      group: outerGroup,
      shapeRef: inst.ref,
      position: { ...position },
      size: { ...size },
      rotation: inst.rotation ?? 0,
    };
  }

  /**
   * G3-5 / G3-10 占位渲染:line / text label 类型用占位灰色 mesh + 标签覆盖,
   * 让用户视觉上能看到节点位置;G4 接 LineRenderer / TextRenderer / canvas-text-node 真渲染.
   */
  private renderPlaceholder(
    inst: Instance,
    shape: ShapeDef,
    kind: 'line' | 'text',
  ): RenderedNode {
    const { position, size } = ensurePositionSize(inst, shape);
    const w = Math.max(8, size.w);
    const h = Math.max(8, size.h);

    const innerGroup = new THREE.Group();
    // 半透明灰矩形(line 占位用更扁的矩形)
    const geom = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: kind === 'line' ? 0x666666 : 0x4a4a4a,
      transparent: true,
      opacity: 0.35,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(w / 2, h / 2, 0);
    innerGroup.add(mesh);

    // 浅虚线边框(LineLoop)
    const borderGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0.01),
      new THREE.Vector3(w, 0, 0.01),
      new THREE.Vector3(w, h, 0.01),
      new THREE.Vector3(0, h, 0.01),
    ]);
    const borderMat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.6 });
    const border = new THREE.LineLoop(borderGeom, borderMat);
    innerGroup.add(border);

    const outerGroup = wrapForRotation(innerGroup, position, size, inst.rotation ?? 0);
    outerGroup.userData.instanceId = inst.id;
    outerGroup.userData.placeholder = kind;
    return {
      instanceId: inst.id,
      kind: 'shape',
      group: outerGroup,
      shapeRef: inst.ref,
      position: { ...position },
      size: { ...size },
      rotation: inst.rotation ?? 0,
    };
  }
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

function pad(n: number): string {
  return n.toString().padStart(3, '0');
}

function ensurePositionSize(
  inst: Instance,
  shape: ShapeDef | null,
  fallbackBbox?: { w: number; h: number },
): { position: { x: number; y: number }; size: { w: number; h: number } } {
  const position = inst.position ?? { x: 0, y: 0 };
  const fallbackW = shape?.viewBox.w ?? fallbackBbox?.w ?? 100;
  const fallbackH = shape?.viewBox.h ?? fallbackBbox?.h ?? 100;
  const size = inst.size ?? { w: fallbackW, h: fallbackH };
  return { position, size };
}

/** outer/inner 嵌套实现 bbox 中心旋转(V1 模式) */
function wrapForRotation(
  innerGroup: THREE.Group,
  position: { x: number; y: number },
  size: { w: number; h: number },
  rotationDeg: number,
): THREE.Group {
  const outer = new THREE.Group();
  outer.position.set(position.x + size.w / 2, position.y + size.h / 2, 0);
  outer.rotation.z = (rotationDeg * Math.PI) / 180;
  innerGroup.position.set(-size.w / 2, -size.h / 2, 0);
  outer.add(innerGroup);
  return outer;
}

function mergeFill(
  base?: FillStyle,
  override?: Partial<FillStyle>,
): FillStyle | undefined {
  if (!base && !override) return undefined;
  if (!base) return override as FillStyle;
  if (!override) return base;
  return { ...base, ...override };
}

function mergeLine(
  base?: LineStyle,
  override?: Partial<LineStyle>,
): LineStyle | undefined {
  if (!base && !override) return undefined;
  if (!base) return override as LineStyle;
  if (!override) return base;
  return { ...base, ...override };
}

function renderComponent(
  comp: SubstanceComponent,
  compShape: ShapeDef,
  scale: { x: number; y: number },
  api: ShapeLibraryApi,
): THREE.Group | null {
  const baseW = comp.transform.w ?? compShape.viewBox.w;
  const baseH = comp.transform.h ?? compShape.viewBox.h;
  const w = baseW * scale.x;
  const h = baseH * scale.y;
  const evalPath: EvaluatedPath | null = api.shapes.evaluate(
    comp.ref,
    {},
    { width: w, height: h },
  );
  if (!evalPath) return null;
  const fillOverride = (comp.style_overrides as { fill?: Partial<FillStyle> } | undefined)?.fill;
  const lineOverride = (comp.style_overrides as { line?: Partial<LineStyle> } | undefined)?.line;
  const out = pathToThree(evalPath, {
    fill: mergeFill(compShape.default_style?.fill, fillOverride),
    stroke: mergeLine(compShape.default_style?.line, lineOverride),
  });
  const px = comp.transform.x * scale.x;
  const py = comp.transform.y * scale.y;
  if (comp.transform.anchor === 'center') {
    out.group.position.set(px - w / 2, py - h / 2, 0);
  } else {
    out.group.position.set(px, py, 0);
  }
  return out.group;
}

/** 估算 substance 原始 bbox(取 components transform x+w / y+h 的 max) */
function estimateSubstanceBbox(def: SubstanceDef, api: ShapeLibraryApi): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const comp of def.components) {
    if (comp.type !== 'shape') continue;
    const shape = api.shapes.get(comp.ref);
    if (!shape) continue;
    const cw = comp.transform.w ?? shape.viewBox.w;
    const ch = comp.transform.h ?? shape.viewBox.h;
    w = Math.max(w, comp.transform.x + cw);
    h = Math.max(h, comp.transform.y + ch);
  }
  return { w: w || 100, h: h || 100 };
}

/** Three.js 资源 dispose(防内存泄漏) */
function disposeGroup(group: THREE.Object3D): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineLoop) {
      const m = obj as THREE.Mesh | THREE.Line;
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) {
        mat.forEach((mm) => mm.dispose?.());
      } else {
        mat?.dispose?.();
      }
    }
  });
}
