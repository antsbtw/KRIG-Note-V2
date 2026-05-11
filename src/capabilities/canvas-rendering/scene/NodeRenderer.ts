/**
 * NodeRenderer — Canvas instance JSON → Three.js mesh 渲染管线(L5-G4.1)
 *
 * V1 直迁:src/plugins/graph/canvas/scene/NodeRenderer.ts(818 行).
 *
 * G3 减量(已落):
 * - 走 G3-2=A:requireCapabilityApi('shape-library') 拿 shapes/substances API
 * - 走 G3-3=B:shapes.evaluate → EvaluatedPath 纯数据 → pathToThree 转 mesh
 *
 * **G4.1 还原**(本段):
 * - ✅ line 渲染:接 LineRenderer + magnet-snap.resolveLineEndpoints(V1 295-324 行 renderLineShape 对齐)
 * - ✅ lineRefs 反向索引:line 引用 instance 时登记;被引用 instance 拖动 → updateLinesFor 触发 line 重渲染
 * - ✅ orphan line 自动清理:被引用 instance 删除时,引用它的 line 一并删(避免悬空 line)
 * - ✅ setPosition 后自动 updateLinesFor(让 line 端点跟随节点拖动)
 * - ✅ setInstances 顺序:非 line 先,line 后(端点解析需要其他 instance 已就位)
 *
 * G4 后续(仍留):
 * - text label 真渲染(G4.5 canvas-text-node 接入 TextRenderer + atom-bridge);本段仍占位灰矩形
 * - substance 内 line/text 子组件(G4.5 一起;line 子组件 G4.3 addMode 真消费时再回看)
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
import { renderLine, updateLineGeometry } from './LineRenderer';
import { resolveLineEndpoints } from '../interaction/magnet-snap';

/** ref === 'krig.text.label' 时走 G3-10 占位;G4.5 接 TextRenderer + atom-bridge 真渲染 */
const TEXT_REF = 'krig.text.label';

/** 判断 instance 是否为 line 类(需要 shape-library 查 category;调用方先确保 instance.type === 'shape')*/
function isLineInstance(inst: Instance, api: ShapeLibraryApi): boolean {
  if (inst.type !== 'shape') return false;
  const shape = api.shapes.get(inst.ref);
  return shape?.category === 'line';
}

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
  /**
   * 反向索引(V1 NodeRenderer.lineRefs 直迁):
   * 被引用的 instance id → 引用它的 line instance id 集合.
   * 用途:被引用 instance 拖动 / 删除时,自动 updateLinesFor / remove orphan line.
   */
  private lineRefs = new Map<string, Set<string>>();

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

  /**
   * 全量替换:清掉现有节点,渲染新的 instances 列表.
   * 顺序:**非 line 先,line 后**(端点解析需要其他 instance 已就位;V1 NodeRenderer:54-65 直迁).
   */
  setInstances(instances: Instance[]): void {
    this.clear();
    const api = this.getShapeApi();
    const lines: Instance[] = [];
    for (const inst of instances) {
      if (isLineInstance(inst, api)) lines.push(inst);
      else this.add(inst);
    }
    for (const inst of lines) this.add(inst);
  }

  /** 增量添加单个 instance(V1 NodeRenderer:67-91 直迁) */
  add(inst: Instance): void {
    if (this.byId.has(inst.id)) {
      console.warn(`[canvas-rendering/NodeRenderer] instance ${inst.id} already rendered, replacing`);
      this.remove(inst.id);
    }
    const rendered = this.renderInstance(inst);
    if (!rendered) return;
    this.sceneManager.scene.add(rendered.group);
    this.byId.set(inst.id, rendered);
    this.instances.set(inst.id, inst);

    // line 实例通过 endpoints 引用其他 instance:登记反向索引(V1:79-86 直迁)
    const api = this.getShapeApi();
    if (isLineInstance(inst, api) && inst.endpoints) {
      for (const ep of inst.endpoints) {
        let set = this.lineRefs.get(ep.instance);
        if (!set) {
          set = new Set();
          this.lineRefs.set(ep.instance, set);
        }
        set.add(inst.id);
      }
    }
  }

  /** 更新单个 instance(目前实现:remove + add;V1 同) */
  update(updated: Instance): void {
    this.remove(updated.id);
    this.add(updated);
  }

  /**
   * 删除某个 instance(V1:120-140 直迁).
   * 引用本 instance 的 line 自动清理(避免悬空 line).
   */
  remove(id: string): void {
    const rn = this.byId.get(id);
    if (!rn) return;
    this.sceneManager.scene.remove(rn.group);
    disposeGroup(rn.group);
    this.byId.delete(id);
    this.instances.delete(id);

    // 找出引用这个 instance 的所有 line(被删时这些 line 失去端点 → 一并删除避免悬空)
    // ⚠️ 必须先抓 orphans 再清 lineRefs[id],否则 delete 后查不到了
    const orphans = Array.from(this.lineRefs.get(id) ?? []);

    // 1. 这个 instance 被哪些 line 引用,反向索引清掉
    this.lineRefs.delete(id);
    // 2. 这个 instance 自己若是 line,从所有"被它引用的 instance 的反向集合"里移除
    for (const set of this.lineRefs.values()) set.delete(id);

    // 3. 递归删除悬空的 line
    for (const orphanId of orphans) this.remove(orphanId);
  }

  /** 清空所有节点(V1:178-184 直迁) */
  clear(): void {
    for (const id of Array.from(this.byId.keys())) this.remove(id);
    this.lineRefs.clear();
    this.instances.clear();
  }

  /**
   * 拖动时直接改 position(避免 remove + add 重建 mesh)
   * 自动 updateLinesFor 让引用本 instance 的 line 端点跟随更新(V1 拖动模式).
   */
  setPosition(id: string, position: { x: number; y: number }): void {
    const rn = this.byId.get(id);
    if (!rn) return;
    rn.position = { ...position };
    rn.group.position.x = position.x + rn.size.w / 2;
    rn.group.position.y = position.y + rn.size.h / 2;
    const inst = this.instances.get(id);
    if (inst) inst.position = { ...position };
    this.updateLinesFor(id);
  }

  /**
   * 通知:某个 instance 的 position/size 变了,重新计算所有引用它的 line 的端点几何
   * (V1 NodeRenderer.updateLinesFor:142-176 直迁;拖动时高频调用).
   */
  updateLinesFor(instanceId: string): void {
    const lineIds = this.lineRefs.get(instanceId);
    if (!lineIds) return;
    for (const lineId of lineIds) {
      const lineInst = this.instances.get(lineId);
      const lineNode = this.byId.get(lineId);
      if (!lineInst || !lineNode) continue;
      const ep = resolveLineEndpoints(lineInst, (id) => {
        const n = this.byId.get(id);
        const i = this.instances.get(id);
        return n && i ? { node: n, instance: i } : null;
      });
      if (!ep) continue;
      updateLineGeometry(lineNode.group, lineInst.ref, ep.start, ep.end);
      // 同步更新 line node 的 position/size(bbox,用于选中边框等)
      lineNode.position = {
        x: Math.min(ep.start.x, ep.end.x),
        y: Math.min(ep.start.y, ep.end.y),
      };
      lineNode.size = {
        w: Math.abs(ep.end.x - ep.start.x),
        h: Math.abs(ep.end.y - ep.start.y),
      };
    }
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

    // G3-10 文字节点仍占位(text label,G4.5 接 canvas-text-node 真渲染)
    if (inst.ref === TEXT_REF) {
      return this.renderPlaceholder(inst, shape, 'text');
    }

    // G4.1 line 类 shape:真渲染(端点驱动,经 magnet-snap.resolveLineEndpoints)
    if (shape.category === 'line') {
      return this.renderLineShape(inst, shape);
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
   * line shape 实例:解析两端世界坐标 → LineRenderer(V1 NodeRenderer:296-324 直迁)
   *
   * V1 LineRenderer 输出 group(line 顶点已是世界坐标,无需 wrapForRotation).
   * position/size 用 bbox 表达(M1.3a 选中态 / 删除可能用).
   */
  private renderLineShape(inst: Instance, shape: ShapeDef): RenderedNode | null {
    const ep = resolveLineEndpoints(inst, (id) => {
      const n = this.byId.get(id);
      const i = this.instances.get(id);
      return n && i ? { node: n, instance: i } : null;
    });
    if (!ep) {
      console.warn(`[canvas-rendering/NodeRenderer] line ${inst.id} cannot resolve endpoints`);
      return null;
    }
    const group = renderLine(inst.ref, {
      start: ep.start,
      end: ep.end,
      style: mergeLine(shape.default_style?.line, inst.style_overrides?.line),
    });
    group.userData.instanceId = inst.id;
    return {
      instanceId: inst.id,
      kind: 'shape',
      group,
      shapeRef: inst.ref,
      position: { x: Math.min(ep.start.x, ep.end.x), y: Math.min(ep.start.y, ep.end.y) },
      size: {
        w: Math.abs(ep.end.x - ep.start.x),
        h: Math.abs(ep.end.y - ep.start.y),
      },
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
   * G3-10 文字节点占位渲染:text label 用占位灰色 mesh + 边框,让用户视觉上能看到
   * 节点位置;**G4.5 接 canvas-text-node + TextRenderer + atom-bridge 真渲染**.
   *
   * G4.1 已删除 line 占位分支 — line 类 shape 走 renderLineShape 真渲染.
   */
  private renderPlaceholder(
    inst: Instance,
    shape: ShapeDef,
    kind: 'text',
  ): RenderedNode {
    const { position, size } = ensurePositionSize(inst, shape);
    const w = Math.max(8, size.w);
    const h = Math.max(8, size.h);

    const innerGroup = new THREE.Group();
    const geom = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4a4a4a,
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
