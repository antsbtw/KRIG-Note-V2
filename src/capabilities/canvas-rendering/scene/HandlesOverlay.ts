import * as THREE from 'three';
import type { SceneManager } from './SceneManager';
import type { RenderedNode } from './NodeRenderer';

/**
 * HandlesOverlay — 选中节点的 resize / rotation handles
 *
 * 视觉对齐 macOS Freeform / Figma:
 * - 8 个 resize handle:4 角(corner)+ 4 边中点(edge)
 * - 1 个 rotation handle:顶部上方 +20px,绿色圆
 * - handle 像素恒定(不随 zoom 缩放)
 *
 * 实现要点:
 * - 单一 Three.js Group 挂在 sceneManager.scene
 * - group.position = 节点 bbox 中心(世界坐标)
 * - group.rotation.z = 节点 rotation(让 handles 跟着节点转)
 * - group.scale = (1/zoom, 1/zoom, 1)
 *   关键:这让 mesh 顶点直接对应"屏幕像素"单位 — mesh 顶点 P 在屏幕显示
 *   P * zoom * (1/zoom) = P 像素,与 zoom 无关
 *   所以 handle 顶点构造用屏幕像素,bbox 半宽折算成屏幕像素 = (size.w/2 * zoom)
 *
 * v1 仅单选节点显示 handles;多选不显示(M1 范围)。
 */

export type HandleKind =
  | 'nw' | 'n' | 'ne'   // 上
  | 'w'        | 'e'    // 中
  | 'sw' | 's' | 'se'   // 下
  | 'rotate';

/**
 * 文字节点 handle 配置(L5-G6c:文字节点 = 带 doc 的 instance,不再特判 ref):
 * - Text(无 size_lock):4 handle (N/S/E/W) + rotate
 *   拉宽 → wrap;拉高 → 高度变 fixed(空白接受 / 内容滚动)
 * - Sticky(size_lock={w,h:true}):8 handle 全部 + rotate,任意拉伸固定大小
 * - 普通 shape:8 handle + rotate
 */
const TEXT_DEFAULT_HANDLES = new Set<HandleKind>(['n', 's', 'e', 'w', 'rotate']);
const ALL_HANDLES_SET = new Set<HandleKind>(
  ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'],
);

/**
 * @param getInstance 反查 inst.size_lock 用 — 由外部注入(避免 HandlesOverlay
 *   反向依赖 NodeRenderer 的全部接口)
 */
function allowedHandlesFor(
  node: RenderedNode,
  getInstance:
    | ((id: string) => { size_lock?: { w?: boolean; h?: boolean }; doc?: unknown } | undefined)
    | null,
): Set<HandleKind> {
  // 文字节点 = 带 doc 的 instance(L5-G6c 统一范式,不再 ref === 'krig.text.label')
  const inst = getInstance?.(node.instanceId);
  if (inst?.doc === undefined) return ALL_HANDLES_SET;
  // 文字节点:看 size_lock
  const hLock = !!inst?.size_lock?.h;
  const wLock = !!inst?.size_lock?.w;
  if (hLock && wLock) return ALL_HANDLES_SET;  // Sticky 全部 8 handle
  return TEXT_DEFAULT_HANDLES;  // Text 4 handle
}

const HANDLE_RADIUS = 3.3;        // 圆 handle 半径(像素)
const HANDLE_BORDER = 1;          // 边框宽度(像素)
const ROTATION_OFFSET = 24;       // rotation handle 距 top 的像素

const HANDLE_COLOR = 0xffffff;          // 内部白色
const HANDLE_BORDER_COLOR = 0x4A90E2;   // 边框蓝(选中色)
const ROTATION_COLOR = 0x4ade80;        // 旋转 handle 绿
const ROTATION_BORDER = 0x16a34a;
const Z_HANDLE = 0.05;            // 比选中边框 0.02 更上层

// param 拖点(L5-G6c B2,HV2:黄方点,区别 resize 白圆 / rotate 绿圆)
const PARAM_COLOR = 0xfacc15;           // 内部黄
const PARAM_BORDER_COLOR = 0x4A90E2;    // 边框蓝(同选中色,视觉成组)
const PARAM_HALF = 4;                   // 方点半边(像素)

/**
 * param 拖点位置(L5-G6c §3.5):由外部 provider 给出(shape-local px 坐标),
 * HandlesOverlay 只负责按节点 transform 画 + hitTest,不依赖 shape-library/公式
 * (W5:公式求值在 provider 侧,overlay 保持 shape 无关)。
 * Y 向下与几何 group 一致(NodeRenderer/path-to-three 同语境)。
 */
export interface ParamHandlePoint {
  /** shape.handles[] 的下标(拖动落地反查用) */
  index: number;
  /** shape-local 坐标(px,原点 = bbox 左上,Y 向下) */
  localX: number;
  localY: number;
}
export type ParamHandleProvider = (instanceId: string) => ParamHandlePoint[];

export class HandlesOverlay {
  private group: THREE.Group;
  private handles = new Map<HandleKind, THREE.Group>();  // handle 内含外圆 border + 内圆 fill
  private rotationLine: THREE.Line | null = null;        // rotation handle 到 top 的连线
  private currentNode: RenderedNode | null = null;
  private rafTick: number | null = null;
  private disposed = false;

  /** 反查 instance(给 allowedHandlesFor 判断 size_lock 用);由外部注入 */
  private getInstance: ((id: string) => { size_lock?: { w?: boolean; h?: boolean }; doc?: unknown } | undefined) | null = null;

  /** param 拖点 provider(由 Host 注入,内部走 shape-library 求值 handle 位置)*/
  private paramProvider: ParamHandleProvider | null = null;
  /** 动态 param 拖点 mesh 列表(数量随 shape.handles 变;每帧按当前节点 transform 重布)*/
  private paramHandles: THREE.Group[] = [];
  /** 当前节点的 param 拖点位置缓存(layout 求一次,hitTest 复用)*/
  private paramPoints: ParamHandlePoint[] = [];

  constructor(private sceneManager: SceneManager) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.renderOrder = 10;  // 高 renderOrder 确保在所有 mesh 之上
    sceneManager.scene.add(this.group);
    this.buildHandles();
    this.startSyncLoop();
  }

  /** 注入 getInstance 反查接口(由 CanvasView 设置) */
  setInstanceLookup(fn: ((id: string) => { size_lock?: { w?: boolean; h?: boolean }; doc?: unknown } | undefined) | null): void {
    this.getInstance = fn;
  }

  /** 注入 param 拖点 provider(L5-G6c B2;由 Host 走 shape-library 求值)*/
  setParamHandleProvider(fn: ParamHandleProvider | null): void {
    this.paramProvider = fn;
  }

  /** 显示某节点的 handles;传 null 隐藏 */
  setTarget(node: RenderedNode | null): void {
    this.currentNode = node;
    this.group.visible = node !== null;
    if (node) this.layout();
  }

  /** 当前 attach 的节点(给 InteractionController 命中 handle 时用) */
  getTarget(): RenderedNode | null {
    return this.currentNode;
  }

  /**
   * Hit-test:屏幕坐标 → handle kind(若命中)。
   * 返回 null = 没命中 handle(可能是普通节点 / 空白)
   *
   * 算法:把屏幕坐标转世界坐标,再转到 handle 局部坐标系(去 rotation),与
   * 8 个 handle + rotation handle 的目标位置比距离
   */
  hitTest(screenX: number, screenY: number): HandleKind | null {
    if (!this.currentNode) return null;
    const node = this.currentNode;
    const view = this.sceneManager.getView();
    const world = this.sceneManager.screenToWorld(screenX, screenY);

    // 转到 handle 局部坐标(group 是 bbox 中心 + rotation + scale=1/zoom)
    const cx = node.position.x + node.size.w / 2;
    const cy = node.position.y + node.size.h / 2;
    const dx = world.x - cx;
    const dy = world.y - cy;
    // 反 rotation
    const rad = -((node.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    // 局部坐标转屏幕像素(乘 zoom,因为 group scale=1/zoom 后顶点 = 屏幕像素)
    const px = lx * view.zoom;
    const py = ly * view.zoom;

    // bbox 半宽(屏幕像素)
    const halfW = node.size.w * view.zoom / 2;
    const halfH = node.size.h * view.zoom / 2;
    const positions = handlePositions(halfW, halfH);

    // HIT_RADIUS:handle 像素半径 + 8px 容忍区(V1 是 +4,实测体感偏小;参考 Figma 用 +8)
    const HIT_RADIUS = HANDLE_RADIUS + 8;
    const allowed = allowedHandlesFor(node, this.getInstance);
    let closest: { kind: HandleKind; dist: number } | null = null;
    for (const [kind, [hx, hy]] of Object.entries(positions) as [HandleKind, [number, number]][]) {
      if (!allowed.has(kind)) continue;
      const d = Math.hypot(px - hx, py - hy);
      if (d <= HIT_RADIUS && (!closest || d < closest.dist)) {
        closest = { kind, dist: d };
      }
    }
    return closest?.kind ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafTick !== null) cancelAnimationFrame(this.rafTick);
    this.sceneManager.scene.remove(this.group);
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) for (const x of m) x.dispose();
      else if (m) (m as THREE.Material).dispose();
    });
  }

  // ─────────────────────────────────────────────────────────
  // 内部
  // ─────────────────────────────────────────────────────────

  private buildHandles(): void {
    const kinds: HandleKind[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'];
    for (const k of kinds) {
      const isRotate = k === 'rotate';
      const handle = makeHandleMesh(
        isRotate ? ROTATION_COLOR : HANDLE_COLOR,
        isRotate ? ROTATION_BORDER : HANDLE_BORDER_COLOR,
      );
      this.handles.set(k, handle);
      this.group.add(handle);
    }
    // rotation 连线(从 top 中点连到 rotation handle)
    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, Z_HANDLE),
      new THREE.Vector3(0, -ROTATION_OFFSET, Z_HANDLE),
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: ROTATION_BORDER });
    this.rotationLine = new THREE.Line(lineGeom, lineMat);
    this.group.add(this.rotationLine);
  }

  /** 每帧同步 group transform + 内部 handle 位置(zoom 变 / 节点移动 / rotation 变) */
  private startSyncLoop(): void {
    const tick = () => {
      if (this.disposed) return;
      if (this.currentNode) this.layout();
      this.rafTick = requestAnimationFrame(tick);
    };
    this.rafTick = requestAnimationFrame(tick);
  }

  private layout(): void {
    const node = this.currentNode;
    if (!node) return;
    const view = this.sceneManager.getView();
    if (view.zoom <= 0) return;

    // outer group:bbox 中心 + rotation + scale=1/zoom
    const cx = node.position.x + node.size.w / 2;
    const cy = node.position.y + node.size.h / 2;
    this.group.position.set(cx, cy, 0);
    this.group.rotation.z = ((node.rotation ?? 0) * Math.PI) / 180;
    const inv = 1 / view.zoom;
    this.group.scale.set(inv, inv, 1);

    // 内部 handle 位置(屏幕像素单位):
    // 注意 group.scale=1/zoom 后,mesh 顶点 1 单位 = 屏幕 1 像素
    // bbox 在 mesh 单位中的半宽 = (size.w/2) * zoom
    const halfW = (node.size.w / 2) * view.zoom;
    const halfH = (node.size.h / 2) * view.zoom;
    const positions = handlePositions(halfW, halfH);
    const allowed = allowedHandlesFor(node, this.getInstance);
    for (const [kind, [hx, hy]] of Object.entries(positions) as [HandleKind, [number, number]][]) {
      const handle = this.handles.get(kind);
      if (!handle) continue;
      handle.position.set(hx, hy, Z_HANDLE);
      handle.visible = allowed.has(kind);
    }

    // rotation 连线:从 top 中点 (0, -halfH) 到 rotation handle (0, -halfH-ROTATION_OFFSET)
    if (this.rotationLine) {
      const positions2 = this.rotationLine.geometry.attributes.position;
      const arr = positions2.array as Float32Array;
      arr[0] = 0; arr[1] = -halfH; arr[2] = Z_HANDLE;
      arr[3] = 0; arr[4] = -halfH - ROTATION_OFFSET; arr[5] = Z_HANDLE;
      positions2.needsUpdate = true;
    }

    // param 拖点(L5-G6c B2):provider 给 shape-local px 点 → 转 bbox 中心相对屏幕像素。
    // localX/Y 原点 = bbox 左上、Y 向下;相对中心 = (local - size/2) * zoom。
    this.layoutParamHandles(node, view.zoom);
  }

  /** 重建/复用 param 拖点 mesh,布到 provider 给出的 shape-local 位置 */
  private layoutParamHandles(node: RenderedNode, zoom: number): void {
    this.paramPoints = this.paramProvider?.(node.instanceId) ?? [];
    // mesh 池按需扩容
    while (this.paramHandles.length < this.paramPoints.length) {
      const mesh = makeParamHandleMesh();
      this.paramHandles.push(mesh);
      this.group.add(mesh);
    }
    for (let i = 0; i < this.paramHandles.length; i++) {
      const mesh = this.paramHandles[i];
      const pt = this.paramPoints[i];
      if (!pt) { mesh.visible = false; continue; }
      const px = (pt.localX - node.size.w / 2) * zoom;
      const py = (pt.localY - node.size.h / 2) * zoom;
      mesh.position.set(px, py, Z_HANDLE);
      mesh.visible = true;
    }
  }

  /**
   * param 拖点 hit-test(L5-G6c B2):屏幕坐标 → 命中的 handle index。
   * 复用 hitTest 的坐标变换(转 handle 局部屏幕像素),与 paramPoints 比距离。
   */
  paramHitTest(screenX: number, screenY: number): { index: number } | null {
    if (!this.currentNode || this.paramPoints.length === 0) return null;
    const node = this.currentNode;
    const view = this.sceneManager.getView();
    const world = this.sceneManager.screenToWorld(screenX, screenY);
    const cx = node.position.x + node.size.w / 2;
    const cy = node.position.y + node.size.h / 2;
    const dx = world.x - cx;
    const dy = world.y - cy;
    const rad = -((node.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const lx = (dx * cos - dy * sin) * view.zoom;
    const ly = (dx * sin + dy * cos) * view.zoom;
    const HIT = PARAM_HALF + 8;
    let closest: { index: number; dist: number } | null = null;
    for (const pt of this.paramPoints) {
      const hx = (pt.localX - node.size.w / 2) * view.zoom;
      const hy = (pt.localY - node.size.h / 2) * view.zoom;
      const d = Math.hypot(lx - hx, ly - hy);
      if (d <= HIT && (!closest || d < closest.dist)) closest = { index: pt.index, dist: d };
    }
    return closest ? { index: closest.index } : null;
  }
}

/**
 * 给定 bbox 半宽半高(单位:屏幕像素),返回每个 handle 的位置
 * Y 向下 → north (n) y 是负的,south (s) y 是正的
 */
function handlePositions(halfW: number, halfH: number): Record<HandleKind, [number, number]> {
  return {
    nw: [-halfW, -halfH],
    n:  [0,      -halfH],
    ne: [halfW,  -halfH],
    e:  [halfW,  0],
    se: [halfW,  halfH],
    s:  [0,      halfH],
    sw: [-halfW, halfH],
    w:  [-halfW, 0],
    rotate: [0, -halfH - ROTATION_OFFSET],
  };
}

/** 单个 handle = 外圆 border ring + 内圆 fill,组合成圆形(带描边视觉) */
function makeHandleMesh(fillColor: number, borderColor: number): THREE.Group {
  const group = new THREE.Group();

  // 外圆(border)— DoubleSide 防 Y 翻转 frustum 下 face culling 把朝镜头的面剔掉
  const borderGeom = new THREE.CircleGeometry(HANDLE_RADIUS + HANDLE_BORDER, 24);
  const borderMat = new THREE.MeshBasicMaterial({ color: borderColor, side: THREE.DoubleSide });
  const borderMesh = new THREE.Mesh(borderGeom, borderMat);
  borderMesh.position.z = -0.001;  // 略低于 fill,确保 fill 显示在上
  group.add(borderMesh);

  // 内圆(fill)
  const fillGeom = new THREE.CircleGeometry(HANDLE_RADIUS, 24);
  const fillMat = new THREE.MeshBasicMaterial({ color: fillColor, side: THREE.DoubleSide });
  const fillMesh = new THREE.Mesh(fillGeom, fillMat);
  group.add(fillMesh);

  return group;
}

/** param 拖点 = 黄方块 + 蓝边(HV2:形状[方]+色相[黄] 双区别 resize 白圆 / rotate 绿圆)*/
function makeParamHandleMesh(): THREE.Group {
  const group = new THREE.Group();
  const side = (PARAM_HALF + HANDLE_BORDER) * 2;
  const borderGeom = new THREE.PlaneGeometry(side, side);
  const borderMat = new THREE.MeshBasicMaterial({ color: PARAM_BORDER_COLOR, side: THREE.DoubleSide });
  const borderMesh = new THREE.Mesh(borderGeom, borderMat);
  borderMesh.position.z = -0.001;
  group.add(borderMesh);

  const fillGeom = new THREE.PlaneGeometry(PARAM_HALF * 2, PARAM_HALF * 2);
  const fillMat = new THREE.MeshBasicMaterial({ color: PARAM_COLOR, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(fillGeom, fillMat));
  return group;
}
