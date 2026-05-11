/// <reference types="vite/client" />
/**
 * InteractionController — 画板鼠标 / 键盘交互(L5-G3 减量版)
 *
 * 范围(对齐 design v0.3 § 1.1 + G3-6=A 砍到极简):
 * - 单选(click 节点)
 * - 拖动选中节点(mousedown + mousemove + mouseup)
 * - 删除选中(Delete / Backspace)
 * - **pan**(空白处拖动平移视口)
 * - **zoom-to-cursor**(滚轮缩放,以光标位置为中心)
 * - 选中态:单层 LineLoop 矩形线框 overlay
 *
 * 砍掉(留 G4 / G5):
 * - 多选(Shift/Cmd-click)/ marquee 框选
 * - resize 8 方向 / rotation handle / HandlesOverlay
 * - 画 line(press-drag-release 创建)/ line rewire / magnet 吸附
 * - addMode(添加模式,Picker 触发后点击画布实例化)
 * - 文字节点双击进入编辑(canvas-text-node)
 * - Cmd+C/V / Cmd+Z(view-scoped 自管,G5)
 * - 右键菜单(G5 走 contextMenuRegistry)
 * - link 路由(独立阶段)
 *
 * 形态来源:V1 src/plugins/graph/canvas/interaction/InteractionController.ts(1975 行)— G3 从零按 V1 模式重写极简版.
 */

import * as THREE from 'three';
import type { SceneManager } from '../scene/SceneManager';
import type { NodeRenderer, RenderedNode } from '../scene/NodeRenderer';

/** V1 wheel zoom 灵敏度 / 上下限(InteractionController.ts:155-160 直迁) */
const WHEEL_ZOOM_SENSITIVITY = 0.005;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 20;

export interface InteractionControllerOpts {
  container: HTMLElement;
  sceneManager: SceneManager;
  nodeRenderer: NodeRenderer;
  /** 选中变化回调(view 端 toolbar 用) */
  onSelectionChange?: (ids: string[]) => void;
  /** 节点状态变化(拖动结束 / 删除后 view 端防抖保存) */
  onInstancesChange?: () => void;
  /** 视口变化(pan / zoom 时推 view 持久化) */
  onViewportChange?: () => void;
}

export class InteractionController {
  private container: HTMLElement;
  private sceneManager: SceneManager;
  private nodeRenderer: NodeRenderer;
  private onSelectionChange?: (ids: string[]) => void;
  private onInstancesChange?: () => void;
  private onViewportChange?: () => void;

  /** 当前选中(G3 单选,Set 最多 1 项;用 Set 是为 G4 多选预留接口形态) */
  private selected = new Set<string>();
  /** instanceId → 选中边框 LineLoop overlay */
  private overlays = new Map<string, THREE.LineLoop>();

  /** 拖动节点状态 */
  private dragging: {
    startWorld: { x: number; y: number };
    snapshots: Map<string, { x: number; y: number }>;
  } | null = null;

  /** 拖动期间是否真正发生位移(用于 mouseup 时判断 click 还是 drag end) */
  private dragMoved = false;

  // [G4 砍] marquee 框选状态(V1 InteractionController.ts:55-64)— 接续时补回:
  //   private marquee: { startWorld, currentWorld, overlayGroup, additive } | null = null;
  // [G4 砍] resize 状态(V1:67-77)
  // [G4 砍] rotate 状态(V1:79-87)
  // [G4 砍] drawingLine 状态 / magnetHints / hoveredLineId / lineEndpointHandles /
  //         rewiring 状态(V1:89-131)
  // [G4 砍] addMode + onAddModeChange / onNodeDoubleClick / onContextMenu(V1:133-141)
  // [G4 砍] undo/redo stack(V1:158-160)— D-13=B 留 V1 自管,本段不接

  /** 事件解绑函数 */
  private unsubscribers: Array<() => void> = [];

  /** raycast 暂存对象 */
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  constructor(opts: InteractionControllerOpts) {
    this.container = opts.container;
    this.sceneManager = opts.sceneManager;
    this.nodeRenderer = opts.nodeRenderer;
    this.onSelectionChange = opts.onSelectionChange;
    this.onInstancesChange = opts.onInstancesChange;
    this.onViewportChange = opts.onViewportChange;
    this.attachListeners();
  }

  // ─────────────────────────────────────────────────────────
  // 公开 API(给 Host 调)
  // ─────────────────────────────────────────────────────────

  getSelection(): string[] {
    return Array.from(this.selected);
  }

  setSelection(ids: string[]): void {
    const next = new Set(ids);
    if (sameSet(next, this.selected)) return;
    this.selected = next;
    this.refreshOverlays();
    this.notifySelection();
  }

  clearSelection(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.refreshOverlays();
    this.notifySelection();
  }

  deleteSelected(): void {
    if (this.selected.size === 0) return;
    for (const id of this.selected) {
      this.removeOverlay(id);
      this.nodeRenderer.remove(id);
    }
    this.selected.clear();
    this.notifySelection();
    this.onInstancesChange?.();
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    for (const overlay of this.overlays.values()) {
      this.sceneManager.scene.remove(overlay);
      overlay.geometry.dispose();
      (overlay.material as THREE.LineBasicMaterial).dispose();
    }
    this.overlays.clear();
    this.selected.clear();
    this.dragging = null;
  }

  // ─────────────────────────────────────────────────────────
  // 事件接线
  // ─────────────────────────────────────────────────────────

  private attachListeners(): void {
    const el = this.container;
    const onMouseDown = (e: MouseEvent): void => this.handleMouseDown(e);
    const onMouseMove = (e: MouseEvent): void => this.handleMouseMove(e);
    const onMouseUp = (e: MouseEvent): void => this.handleMouseUp(e);
    const onWheel = (e: WheelEvent): void => this.handleWheel(e);
    const onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    this.unsubscribers.push(
      () => el.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => el.removeEventListener('wheel', onWheel),
      () => window.removeEventListener('keydown', onKeyDown),
    );
  }

  // ─────────────────────────────────────────────────────────
  // mouse: down / move / up(V1 模式对齐;G3 砍 G4 部分)
  // ─────────────────────────────────────────────────────────

  /** V1 helper:event 坐标 → 容器内坐标(全 mouse / wheel handler 共用) */
  private toContainerCoords(e: MouseEvent | WheelEvent): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // 只处理左键
    this.container.focus(); // V1:抢键盘焦点(Delete / Escape 用)

    const screen = this.toContainerCoords(e);
    const world = this.sceneManager.screenToWorld(screen.x, screen.y);

    // [G4 砍] addMode:placeInstance / tryStartDrawingLine
    // [G4 砍] HandlesOverlay.hitTest → startResize / startRotate
    // [G4 砍] line endpoint handle → startRewire
    // [G4 砍] raycastLinkHref → dispatchLinkHref

    const hit = this.hitTest(screen.x, screen.y);
    const additive = e.shiftKey || e.metaKey;
    if (hit) {
      // V1 模式:additive 时 toggle;非 additive 时若未选则替换为单选
      if (additive) {
        if (this.selected.has(hit.instanceId)) {
          this.selected.delete(hit.instanceId);
        } else {
          this.selected.add(hit.instanceId);
        }
        this.refreshOverlays();
        this.notifySelection();
      } else {
        if (!this.selected.has(hit.instanceId)) {
          this.selected.clear();
          this.selected.add(hit.instanceId);
          this.refreshOverlays();
          this.notifySelection();
        }
        // 已选中且非 additive:不变(下面进入拖动)
      }
      this.startDragNodes(world);
    } else {
      // 空白处:非 additive 清选区
      // [G4 砍] startMarquee(框选)— G4 接续时把空白分支改成 startMarquee(world, additive)
      if (!additive) this.clearSelection();
    }
  }

  /** V1 startDrag:记录所有选中节点的起始位置快照,move 时 + delta */
  private startDragNodes(startWorld: { x: number; y: number }): void {
    const snapshots = new Map<string, { x: number; y: number }>();
    for (const id of this.selected) {
      const inst = this.nodeRenderer.getInstance(id);
      if (inst?.position) snapshots.set(id, { ...inst.position });
    }
    this.dragging = { startWorld, snapshots };
    this.dragMoved = false;
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragging) return;
    const screen = this.toContainerCoords(e);
    const cur = this.sceneManager.screenToWorld(screen.x, screen.y);
    const dx = cur.x - this.dragging.startWorld.x;
    const dy = cur.y - this.dragging.startWorld.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) this.dragMoved = true;
    for (const [id, snap] of this.dragging.snapshots) {
      this.nodeRenderer.setPosition(id, { x: snap.x + dx, y: snap.y + dy });
      this.updateOverlay(id);
    }
  }

  private handleMouseUp(_e: MouseEvent): void {
    if (this.dragging) {
      if (this.dragMoved) this.onInstancesChange?.();
      this.dragging = null;
    }
    this.dragMoved = false;
  }

  /**
   * V1 wheel — pan(双指拖动)+ zoom-to-cursor(pinch / 鼠标滚轮)
   *
   * macOS 手势规约(V1 InteractionController.ts:616):
   * - 双指 pinch  → wheel + ctrlKey=true  → zoom-to-cursor
   * - 双指拖动    → wheel + ctrlKey=false → pan
   * - 鼠标滚轮    → wheel + ctrlKey=false 但 deltaMode=DOM_DELTA_LINE
   *   (双指拖动是 DOM_DELTA_PIXEL),用 deltaMode 兼容物理鼠标 zoom
   */
  private handleWheel(e: WheelEvent): void {
    e.preventDefault(); // 阻止 macOS 双指 history navigation
    const view = this.sceneManager.getView();
    if (view.zoom <= 0) return;

    const isPinchZoom = e.ctrlKey;
    const isMouseWheel = e.deltaMode !== 0; // 0 = DOM_DELTA_PIXEL(trackpad)

    if (isPinchZoom || isMouseWheel) {
      // ── Zoom-to-cursor ──
      const sensitivity = isPinchZoom ? WHEEL_ZOOM_SENSITIVITY * 5 : WHEEL_ZOOM_SENSITIVITY;
      const factor = Math.exp(-e.deltaY * sensitivity);
      const newZoom = view.zoom * factor;
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      if (clamped === view.zoom) return;

      const screen = this.toContainerCoords(e);
      const cursor = this.sceneManager.screenToWorld(screen.x, screen.y);
      const ratio = view.zoom / clamped;
      const newCenterX = cursor.x - (cursor.x - view.centerX) * ratio;
      const newCenterY = cursor.y - (cursor.y - view.centerY) * ratio;
      this.sceneManager.setView(newCenterX, newCenterY, clamped);
    } else {
      // ── Pan(trackpad 双指拖动)──
      const dxWorld = e.deltaX / view.zoom;
      const dyWorld = e.deltaY / view.zoom;
      this.sceneManager.setView(
        view.centerX + dxWorld,
        view.centerY + dyWorld,
        view.zoom,
      );
    }
    this.onViewportChange?.();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // 避免在 input / contenteditable 内拦截
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selected.size > 0) {
        e.preventDefault();
        this.deleteSelected();
      }
    } else if (e.key === 'Escape') {
      if (this.selected.size > 0) this.clearSelection();
    }
  }

  // ─────────────────────────────────────────────────────────
  // hit-test — Three.js Raycaster(对齐 V1 src/plugins/graph/canvas/interaction/
  // InteractionController.ts L754;与渲染共享投影矩阵,用户视觉看到哪里就能
  // 命中哪里;支持旋转节点;不依赖坐标系符号约定)
  // ─────────────────────────────────────────────────────────

  private hitTest(screenX: number, screenY: number): RenderedNode | null {
    if (!this.sceneManager.screenToNDC(screenX, screenY, this.ndc)) return null;
    this.raycaster.setFromCamera(this.ndc, this.sceneManager.camera);
    const hits = this.raycaster.intersectObjects(
      this.sceneManager.scene.children,
      true,
    );
    // 沿 parent 链找 outer.group(带 userData.instanceId),取最小 area 优先
    // (小元素优先,避免大背景遮挡选小元素)
    let best: { node: RenderedNode; area: number } | null = null;
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      let instanceId: string | null = null;
      while (obj) {
        const id = (obj.userData as { instanceId?: string })?.instanceId;
        if (typeof id === 'string') {
          instanceId = id;
          break;
        }
        obj = obj.parent;
      }
      if (!instanceId) continue;
      const node = this.nodeRenderer.get(instanceId);
      if (!node) continue;
      const area = node.size.w * node.size.h;
      if (!best || area < best.area) best = { node, area };
    }
    return best?.node ?? null;
  }


  // ─────────────────────────────────────────────────────────
  // 选中边框 overlay
  // ─────────────────────────────────────────────────────────

  private refreshOverlays(): void {
    // 清不在 selected 集合的 overlay
    for (const id of this.overlays.keys()) {
      if (!this.selected.has(id)) this.removeOverlay(id);
    }
    // 加新选中的 overlay
    for (const id of this.selected) {
      if (!this.overlays.has(id)) this.createOverlay(id);
    }
  }

  private createOverlay(id: string): void {
    const rn = this.nodeRenderer.get(id);
    if (!rn) return;
    const { position, size } = rn;
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(position.x, position.y, 0.1),
      new THREE.Vector3(position.x + size.w, position.y, 0.1),
      new THREE.Vector3(position.x + size.w, position.y + size.h, 0.1),
      new THREE.Vector3(position.x, position.y + size.h, 0.1),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0x3b82f6 });
    const loop = new THREE.LineLoop(geom, mat);
    loop.renderOrder = 10;
    this.sceneManager.scene.add(loop);
    this.overlays.set(id, loop);
  }

  private updateOverlay(id: string): void {
    const overlay = this.overlays.get(id);
    if (!overlay) return;
    const rn = this.nodeRenderer.get(id);
    if (!rn) return;
    const { position, size } = rn;
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(position.x, position.y, 0.1),
      new THREE.Vector3(position.x + size.w, position.y, 0.1),
      new THREE.Vector3(position.x + size.w, position.y + size.h, 0.1),
      new THREE.Vector3(position.x, position.y + size.h, 0.1),
    ]);
    overlay.geometry.dispose();
    overlay.geometry = geom;
  }

  private removeOverlay(id: string): void {
    const overlay = this.overlays.get(id);
    if (!overlay) return;
    this.sceneManager.scene.remove(overlay);
    overlay.geometry.dispose();
    (overlay.material as THREE.LineBasicMaterial).dispose();
    this.overlays.delete(id);
  }

  private notifySelection(): void {
    this.onSelectionChange?.(Array.from(this.selected));
  }
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

