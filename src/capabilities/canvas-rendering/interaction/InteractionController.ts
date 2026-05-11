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

  /** 拖空白平移视口状态 */
  private panning: {
    startScreen: { x: number; y: number };
    startCenter: { x: number; y: number };
  } | null = null;

  /** 拖动期间是否真正发生位移(用于 mouseup 时判断 click 还是 drag end) */
  private dragMoved = false;

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
    this.panning = null;
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
  // mouse: down / move / up
  // ─────────────────────────────────────────────────────────

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // 只处理左键
    const rect = this.container.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const hit = this.hitTest(screenX, screenY);

    if (hit) {
      // 点中节点 — 选中 + 准备拖动
      this.setSelection([hit.instanceId]);
      const startWorld = this.sceneManager.screenToWorld(screenX, screenY);
      const snapshots = new Map<string, { x: number; y: number }>();
      for (const id of this.selected) {
        const inst = this.nodeRenderer.getInstance(id);
        if (inst?.position) snapshots.set(id, { ...inst.position });
      }
      this.dragging = { startWorld, snapshots };
      this.dragMoved = false;
    } else {
      // 空白 — 准备 pan + 清选中(若有)
      const view = this.sceneManager.getView();
      this.panning = {
        startScreen: { x: screenX, y: screenY },
        startCenter: { x: view.centerX, y: view.centerY },
      };
      this.dragMoved = false;
      if (this.selected.size > 0) this.clearSelection();
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragging && !this.panning) return;
    const rect = this.container.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (this.dragging) {
      const cur = this.sceneManager.screenToWorld(screenX, screenY);
      const dx = cur.x - this.dragging.startWorld.x;
      const dy = cur.y - this.dragging.startWorld.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) this.dragMoved = true;
      for (const [id, snap] of this.dragging.snapshots) {
        this.nodeRenderer.setPosition(id, { x: snap.x + dx, y: snap.y + dy });
        this.updateOverlay(id);
      }
    } else if (this.panning) {
      const dx = screenX - this.panning.startScreen.x;
      const dy = screenY - this.panning.startScreen.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) this.dragMoved = true;
      // 平移视口:屏幕 dx 像素 = 世界 dx / zoom
      const view = this.sceneManager.getView();
      this.sceneManager.setView(
        this.panning.startCenter.x - dx / view.zoom,
        this.panning.startCenter.y - dy / view.zoom,
        view.zoom,
      );
      this.onViewportChange?.();
    }
  }

  private handleMouseUp(_e: MouseEvent): void {
    if (this.dragging) {
      if (this.dragMoved) this.onInstancesChange?.();
      this.dragging = null;
    }
    if (this.panning) {
      this.panning = null;
    }
    this.dragMoved = false;
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.container.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    // zoom-to-cursor:鼠标位置作为缩放中心
    const view = this.sceneManager.getView();
    const beforeWorld = this.sceneManager.screenToWorld(screenX, screenY);
    // deltaY > 0 ⇒ 滚下 ⇒ 缩小;< 0 ⇒ 滚上 ⇒ 放大
    const factor = e.deltaY > 0 ? 0.9 : 1 / 0.9;
    const newZoom = Math.max(0.1, Math.min(20, view.zoom * factor));
    // 算 newCenter 让 beforeWorld 在屏幕上仍然在鼠标位置
    // screenX = cw/2 + (beforeWorld.x - newCenter.x) * newZoom
    // → newCenter.x = beforeWorld.x - (screenX - cw/2) / newZoom
    const { clientWidth, clientHeight } = this.container;
    const newCenterX = beforeWorld.x - (screenX - clientWidth / 2) / newZoom;
    const newCenterY = beforeWorld.y - (screenY - clientHeight / 2) / newZoom;
    this.sceneManager.setView(newCenterX, newCenterY, newZoom);
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
  // hit-test(简单 AABB,G3 不支持 OBB — 旋转节点的 hit-test 精度可能差,G4 补 OBB)
  // ─────────────────────────────────────────────────────────

  private hitTest(screenX: number, screenY: number): RenderedNode | null {
    const world = this.sceneManager.screenToWorld(screenX, screenY);
    // 从上(最后渲染)向下找,return 第一个命中
    const rendered: RenderedNode[] = [];
    for (const rn of this.allRendered()) rendered.push(rn);
    for (let i = rendered.length - 1; i >= 0; i--) {
      const rn = rendered[i];
      if (this.pointInAabb(world, rn)) return rn;
    }
    return null;
  }

  /** 简单 AABB 命中(不考虑 rotation,G3 简化) */
  private pointInAabb(world: { x: number; y: number }, rn: RenderedNode): boolean {
    const { position, size } = rn;
    return (
      world.x >= position.x &&
      world.x <= position.x + size.w &&
      world.y >= position.y &&
      world.y <= position.y + size.h
    );
  }

  /** 列出当前所有渲染节点(NodeRenderer.byId 内部访问 ids → get) */
  private allRendered(): RenderedNode[] {
    const out: RenderedNode[] = [];
    for (const id of this.nodeRenderer.ids()) {
      const rn = this.nodeRenderer.get(id);
      if (rn) out.push(rn);
    }
    return out;
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

// raycaster / ndc 暂留(给 G4 旋转 OBB / Line2 hit 用),G3 走简单 AABB
// 后续 G4 引入 HandlesOverlay 时,raycaster + ndc 接 handle hit-test
// 简化变量未在 G3 使用时让 TypeScript 不报错:
// (Already declared in class fields for G4 use)
void new THREE.Raycaster;
void new THREE.Vector2;
