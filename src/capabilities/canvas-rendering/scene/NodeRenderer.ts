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
import { generateUlid } from '@shared/ulid';
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
import { TextRenderer } from './TextRenderer';
import type { Atom as SerializerAtom } from '../../../lib/atom-serializers/svg';

/** ref === 'krig.text.label' 时走 TextRenderer SVG → mesh 真渲染(G4.5 P4) */
const TEXT_REF = 'krig.text.label';

/**
 * canvas-text-node atom-bridge 注入(view 端 mount 时通过 NodeRenderer.setAtomBridge 设).
 * 不直 import canvas-text-node 模块,避免 capability 互相耦合;view 端走 capabilityRegistry
 * 拿 canvas-text-node.atomBridge 再注入(NodeRenderer 不知道 capability registry 存在).
 */
type AtomBridgeHook = (doc: unknown) => Promise<SerializerAtom[]>;

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

  /** 文字节点 SVG → Three.js mesh 渲染器(G4.5 P4) */
  private textRenderer = new TextRenderer();
  /** 文字节点异步 render token(同 instance 多次刷新时丢弃过期回调) */
  private textRenderTokens = new Map<string, number>();
  /** view 端注入的 canvas-text-node atomBridge.atomsToSvgInput(避免 capability 耦合) */
  private atomBridge: AtomBridgeHook | null = null;

  constructor(private sceneManager: SceneManager) {}

  /** view 端 mount 时注入 canvas-text-node atom-bridge */
  setAtomBridge(fn: AtomBridgeHook | null): void {
    this.atomBridge = fn;
  }

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
    this.textRenderTokens.clear();
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

  /**
   * 生成全局唯一 instance id (P0a-bis K1)。
   *
   * 历史:V1 用 `i-001` / `i-002` 等 per-NodeRenderer counter 短可读 id;
   * 但 NodeRenderer 是 per-canvas 实例 → counter 跨画板碰撞 → atom 表 putAtom
   * UPSERT 撞库(P0a-bis 根因)。
   *
   * 改用 monotonic ULID (decision 006):26 字符 Crockford Base32,跨 canvas /
   * 进程 / 设备天然唯一;前 10 字符是毫秒时间戳,日志肉眼可分组。
   */
  nextInstanceId(): string {
    return generateUlid();
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

    // G4.5 文字节点:走 TextRenderer + canvas-text-node.atomBridge 真渲染
    // (atomBridge 未注入时降级灰色占位)
    if (inst.ref === TEXT_REF) {
      return this.atomBridge
        ? this.renderTextInstance(inst)
        : this.renderPlaceholder(inst, shape, 'text');
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
   * 文字节点真渲染(V1 NodeRenderer:336-453 直迁简化):
   * - inner group 三层:bg(可选 sticky)+ hitArea(透明覆盖)+ contentSlot(SVG mesh 异步填入)
   * - 异步 textRenderer.render(atoms) → 填入 contentSlot
   * - token 防同 instance 多次刷新过期回调污染
   *
   * 砍掉(留 v1.1):adaptTextNodeSizeToContent / pickReadableTextColor 智能配色 /
   * size_lock + text_valign 高度自适应
   */
  private renderTextInstance(inst: Instance): RenderedNode | null {
    if (!this.atomBridge) return null;
    const { position, size } = ensurePositionSize(inst, null);
    const safeSize = { w: Math.max(1, size.w), h: Math.max(1, size.h) };

    const innerGroup = new THREE.Group();

    // 背景(Sticky):style_overrides.fill 实色背景
    const bgFill = inst.style_overrides?.fill;
    if (bgFill?.type === 'solid' && bgFill.color) {
      const bgGeo = new THREE.PlaneGeometry(safeSize.w, safeSize.h);
      const bgMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(bgFill.color),
        side: THREE.DoubleSide,
      });
      const bgMesh = new THREE.Mesh(bgGeo, bgMat);
      bgMesh.position.set(safeSize.w / 2, safeSize.h / 2, -0.01);
      bgMesh.renderOrder = -1;
      bgMesh.userData.isTextBackground = true;
      innerGroup.add(bgMesh);
    }

    // 透明 hit-area(覆盖整个 size,捕获 glyph 间空隙点击 + 双击进入编辑)
    const hitGeo = new THREE.PlaneGeometry(safeSize.w, safeSize.h);
    const hitMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.set(safeSize.w / 2, safeSize.h / 2, 0);
    hitMesh.userData.isTextHitArea = true;
    innerGroup.add(hitMesh);

    // content slot(SVG mesh 异步填入)
    const contentSlot = new THREE.Group();
    contentSlot.userData.isTextContentSlot = true;
    innerGroup.add(contentSlot);

    const outerGroup = wrapForRotation(innerGroup, position, safeSize, inst.rotation ?? 0);
    outerGroup.userData.instanceId = inst.id;
    outerGroup.userData.isTextNode = true;

    // 异步 SVG mesh
    const token = (this.textRenderTokens.get(inst.id) ?? 0) + 1;
    this.textRenderTokens.set(inst.id, token);

    void this.atomBridge(inst.doc).then(async (atoms) => {
      if (atoms.length === 0) return;
      if (this.textRenderTokens.get(inst.id) !== token) return;
      try {
        const svgGroup = await this.textRenderer.render(atoms, { width: safeSize.w });
        if (this.textRenderTokens.get(inst.id) !== token) {
          this.textRenderer.dispose(svgGroup);
          return;
        }
        const current = this.byId.get(inst.id);
        if (!current) {
          this.textRenderer.dispose(svgGroup);
          return;
        }

        // 1. 在 attach 之前测 SVG 本地 bbox(避开 matrixWorld 时序问题).
        //    svgGroup 局部坐标系就是 SVG path 自身,bbox.max.y 直接 = 内容高度.
        svgGroup.updateMatrixWorld(true);
        const localBbox = new THREE.Box3().setFromObject(svgGroup);
        const contentH = (Number.isFinite(localBbox.max.y) && Number.isFinite(localBbox.min.y))
          ? localBbox.max.y - localBbox.min.y
          : 0;

        // 2. 抵消 TextRenderer 内的 group.scale.y=-1(SceneManager frustum 已 Y 翻转)
        svgGroup.scale.y = 1;
        svgGroup.position.set(0, 0, 0.01);
        svgGroup.traverse((obj) => { obj.renderOrder = 1; });
        contentSlot.add(svgGroup);

        // 3. 内容溢出 → 自适应高度(V1 adaptTextNodeSizeToContent 直迁简化)
        //    bbox / hit-area / 渲染框三者尺寸一致,用户点 mesh 任意位置都能命中.
        if (contentH > 0) {
          this.adaptTextNodeSizeToContent(inst.id, current, contentH);
        }
      } catch (e) {
        console.warn(`[NodeRenderer] text render failed for ${inst.id}`, e);
      }
    }).catch((e) => {
      console.warn(`[NodeRenderer] atomBridge failed for ${inst.id}`, e);
    });

    return {
      instanceId: inst.id,
      kind: 'shape',
      group: outerGroup,
      shapeRef: inst.ref,
      position: { ...position },
      size: { ...safeSize },
      rotation: inst.rotation ?? 0,
    };
  }

  /**
   * 文字节点内容溢出 → 自适应高度(V1 NodeRenderer.adaptTextNodeSizeToContent
   * 直迁简化):
   * - bbox / hit-area / 渲染框 三者尺寸一致,用户点 mesh 任意位置都能命中
   * - 同步 RenderedNode.size + instance.size(让 serialize / overlay / hit-test 拿新尺寸)
   * - size_lock.h=true 时跳过(用户已固定高度,如 Sticky 或拖过 N/S handle)
   */
  private adaptTextNodeSizeToContent(
    instanceId: string,
    rendered: RenderedNode,
    contentH: number,
  ): void {
    const inst = this.instances.get(instanceId);
    if (inst?.size_lock?.h) return;

    const padding = 8;
    const newH = Math.ceil(contentH + padding);
    if (newH <= rendered.size.h + 1) return;

    // outer/inner 嵌套(wrapForRotation):
    // outer.position = (px + w/2, py + h/2);inner.position = (-w/2, -h/2)
    // 改 size.h 时两处同步(否则 bbox 中心算错,节点上下偏移)
    const outer = rendered.group;
    const inner = outer.children[0] as THREE.Group | undefined;
    if (!inner) return;
    const oldH = rendered.size.h;
    outer.position.y += (newH - oldH) / 2;
    inner.position.y = -newH / 2;

    // 重建 hit-area mesh(PlaneGeometry size 写死了无法 in-place 改)
    const oldHitMesh = inner.children.find(
      (c) => (c as THREE.Mesh).userData?.isTextHitArea,
    ) as THREE.Mesh | undefined;
    if (oldHitMesh) {
      oldHitMesh.geometry.dispose();
      oldHitMesh.geometry = new THREE.PlaneGeometry(rendered.size.w, newH);
      oldHitMesh.position.set(rendered.size.w / 2, newH / 2, 0);
    }

    // 同步 BG mesh(Sticky):同 hit-area,size 变了要重建
    const oldBgMesh = inner.children.find(
      (c) => (c as THREE.Mesh).userData?.isTextBackground,
    ) as THREE.Mesh | undefined;
    if (oldBgMesh) {
      oldBgMesh.geometry.dispose();
      oldBgMesh.geometry = new THREE.PlaneGeometry(rendered.size.w, newH);
      oldBgMesh.position.set(rendered.size.w / 2, newH / 2, -0.01);
    }

    // 更新 RenderedNode.size + instance.size(后者影响序列化 + overlay 边框)
    rendered.size.h = newH;
    if (inst?.size) inst.size.h = newH;

    // 引用此节点的 line 端点更新
    this.updateLinesFor(instanceId);
  }

  /**
   * G3-10 文字节点占位渲染:text label 用占位灰色 mesh + 边框(降级路径,
   * canvas-text-node.atomBridge 未注入时使用).
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

/**
 * Three.js 资源 dispose(防内存泄漏).
 *
 * **跳过 userData.sharedAsset = true 的 mesh**(TextRenderer L2 LRU 共享的 SVG
 * geom/mat;dispose 后其他 mesh 一起变空 — 由 LRU 淘汰时统一释放,见
 * TextRenderer.clearGeometryCache).
 */
function disposeGroup(group: THREE.Object3D): void {
  group.traverse((obj) => {
    if (obj.userData?.sharedAsset === true) return;
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
