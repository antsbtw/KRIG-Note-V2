/// <reference types="vite/client" />
/**
 * InteractionController — 画板鼠标 / 键盘交互(L5-G4.2 加 resize/rotate/undo/clipboard)
 *
 * 范围(对齐 design v0.3 § 1.1 + G4.2 接续):
 * - 单选 + 多选(Shift/Cmd-click toggle)
 * - 拖动选中节点(mousedown + mousemove + mouseup)
 * - 8 方向 resize + rotation handle(走 HandlesOverlay,V1 模式直迁)
 * - 删除选中(Delete / Backspace)
 * - undo / redo(Cmd+Z / Shift+Cmd+Z,50 步全量快照)
 * - 复制 / 粘贴(Cmd+C / Cmd+V,view-scoped clipboard)
 * - pan(trackpad 双指拖动)+ zoom-to-cursor(pinch / 鼠标滚轮)
 * - 选中态:单层 LineLoop 矩形线框 overlay
 *
 * 砍掉(留 G4.3 / G4.4 / G4.5):
 * - marquee 框选
 * - 画 line(press-drag-release 创建)/ line rewire / magnet 吸附
 * - addMode(添加模式,Picker 触发后点击画布实例化)
 * - 文字节点双击进入编辑(canvas-text-node)
 * - 右键菜单(G5 走 contextMenuRegistry)
 * - link 路由(独立阶段)
 *
 * 形态来源:V1 src/plugins/graph/canvas/interaction/InteractionController.ts(1975 行)— G3/G4.2 按 V1 直迁 + 整段砍.
 */

import * as THREE from 'three';
import type { SceneManager } from '../scene/SceneManager';
import type { NodeRenderer, RenderedNode } from '../scene/NodeRenderer';
import type { HandlesOverlay, HandleKind } from '../scene/HandlesOverlay';
import type { Instance, InstanceKind } from '../types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { ShapeLibraryApi } from '@capabilities/shape-library/types';
import { renderLine, updateLineGeometry } from '../scene/LineRenderer';
import { findClosestMagnet, listMagnets, MAGNET_SNAP_RADIUS_PX } from './magnet-snap';

/**
 * Picker / Toolbar 触发"添加模式"的入参:
 * - kind: shape / substance
 * - ref: 资源 id(krig.basic.roundRect / family.person 等)
 * - defaultSize: 可选自定义尺寸
 * - presetInstance: 创建时浅合并到 instance(M2.2 Sticky 的预设 fill)
 * V1 InteractionController.ts:1630-1640 直迁.
 */
export interface AddModeSpec {
  kind: InstanceKind;
  ref: string;
  defaultSize?: { w: number; h: number };
  presetInstance?: Partial<Instance>;
}

/** V1 wheel zoom 灵敏度 / 上下限(InteractionController.ts:155-160 直迁) */
const WHEEL_ZOOM_SENSITIVITY = 0.005;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 20;

export interface InteractionControllerOpts {
  container: HTMLElement;
  sceneManager: SceneManager;
  nodeRenderer: NodeRenderer;
  /** Handles overlay(8 resize + 1 rotation)— G4.2 必传 */
  handlesOverlay: HandlesOverlay;
  /** 反查 instance(给 resize/rotate 修原始 Instance 用) */
  getInstance: (id: string) => Instance | undefined;
  /** 选中变化回调(view 端 toolbar 用) */
  onSelectionChange?: (ids: string[]) => void;
  /** 节点状态变化(拖动 / resize / rotate / 删除 / 粘贴后 view 端防抖保存) */
  onInstancesChange?: () => void;
  /** 视口变化(pan / zoom 时推 view 持久化) */
  onViewportChange?: () => void;
  /** addMode 状态变化(给 view UI 显隐 "Click to place" 提示用) */
  onAddModeChange?: (spec: AddModeSpec | null) => void;
  /**
   * 双击节点回调(G4.5 文字节点用):view 端调 canvas-text-node.enterEdit
   * 打开 EditOverlay popup.参数 = 命中的 instance + 屏幕坐标 + 节点屏幕尺寸.
   */
  onNodeDoubleClick?: (info: NodeDoubleClickInfo) => void;
}

export interface NodeDoubleClickInfo {
  instanceId: string;
  /** 节点在屏幕坐标的左上角(用于 popup 定位) */
  screenX: number;
  screenY: number;
  /** 节点在屏幕上的宽高(用于 popup 尺寸) */
  screenW: number;
  screenH: number;
}

export class InteractionController {
  private container: HTMLElement;
  private sceneManager: SceneManager;
  private nodeRenderer: NodeRenderer;
  private handlesOverlay: HandlesOverlay;
  private getInstance: (id: string) => Instance | undefined;
  private onSelectionChange?: (ids: string[]) => void;
  private onInstancesChange?: () => void;
  private onViewportChange?: () => void;
  private onAddModeChange?: (spec: AddModeSpec | null) => void;
  private onNodeDoubleClick?: (info: NodeDoubleClickInfo) => void;

  /** 当前选中(G3 单选,G4.2 起支持多选 toggle) */
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

  /** Resize 状态(8 个边/角 handle 之一)— V1:67-77 直迁 */
  private resizing: {
    instanceId: string;
    handle: Exclude<HandleKind, 'rotate'>;
    startWorld: { x: number; y: number };
    startPos: { x: number; y: number };
    startSize: { w: number; h: number };
    startRotation: number;
  } | null = null;

  /** Rotation 状态(rotation handle)— V1:79-87 直迁 */
  private rotating: {
    instanceId: string;
    centerWorld: { x: number; y: number };
    startAngle: number;
    startRotation: number;
  } | null = null;

  /** Clipboard:Cmd+C 时存当前选中 instances 全量快照(view-scoped,不跨画板) */
  private clipboard: Instance[] = [];

  /** Undo/Redo 历史栈(V1:158-160 直迁,50 步全量快照) */
  private undoStack: Instance[][] = [];
  private redoStack: Instance[][] = [];
  private static readonly HISTORY_LIMIT = 50;

  /** Marquee 框选状态(V1:55-64 直迁;空白拖动框选) */
  private marquee: {
    startWorld: { x: number; y: number };
    currentWorld: { x: number; y: number };
    overlayGroup: THREE.Group;
    /** Shift/Cmd 按住时加到现有 selection,否则替换 */
    additive: boolean;
  } | null = null;

  /** 添加模式 — 用户从 Picker 选 spec,等点击画布放置(V1:133) */
  private addMode: AddModeSpec | null = null;

  /** 画 line 状态(addMode 是 line 类时 mousedown 启动;V1:89-101 直迁) */
  private drawingLine: {
    startInstanceId: string;
    startMagnetId: string;
    /** 起点世界坐标(magnet 解析结果,绑定后不再变) */
    startWorld: { x: number; y: number };
    /** 同 addMode.spec.ref */
    lineRef: string;
    /** 预览 line 的 THREE.Group(挂在 sceneManager.scene) */
    previewGroup: THREE.Group;
  } | null = null;

  /** Magnet 提示 overlay:hover shape / 画 line 时显示该 shape 的 magnet 点(V1:104 直迁) */
  private magnetHints = new Map<string, THREE.Group>();

  /**
   * Line 端点 handle:line 单选时显示 2 个端点小圆(替代常规 8 resize handle)
   * 仅当选中实例是 line 时存在;切换选区时清掉(V1:113-118)
   */
  private lineEndpointHandles: {
    instanceId: string;
    handles: [THREE.Mesh, THREE.Mesh];
    group: THREE.Group;
  } | null = null;

  /** Rewire 状态(拖 line 端点改连接;V1:121-130 直迁) */
  private rewiring: {
    instanceId: string;
    endpointIndex: 0 | 1;
    startEndpoints: [
      { instance: string; magnet: string },
      { instance: string; magnet: string },
    ];
  } | null = null;

  // [G4.4 砍] onNodeDoubleClick / onContextMenu(V1:139-141)

  /** 事件解绑函数 */
  private unsubscribers: Array<() => void> = [];

  /** raycast 暂存对象 */
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  constructor(opts: InteractionControllerOpts) {
    this.container = opts.container;
    this.sceneManager = opts.sceneManager;
    this.nodeRenderer = opts.nodeRenderer;
    this.handlesOverlay = opts.handlesOverlay;
    this.getInstance = opts.getInstance;
    this.onSelectionChange = opts.onSelectionChange;
    this.onInstancesChange = opts.onInstancesChange;
    this.onViewportChange = opts.onViewportChange;
    this.onAddModeChange = opts.onAddModeChange;
    this.onNodeDoubleClick = opts.onNodeDoubleClick;
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
    this.refreshHandles();
    this.notifySelection();
  }

  clearSelection(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.refreshOverlays();
    this.refreshHandles();
    this.notifySelection();
  }

  /**
   * 进入添加模式 — UI(Picker)选好 shape/substance 后调,等用户点击画布放置
   * 配套副作用:cursor 切 crosshair,通知 onAddModeChange.
   */
  enterAddMode(spec: AddModeSpec): void {
    this.addMode = spec;
    this.container.style.cursor = 'crosshair';
    this.onAddModeChange?.(spec);
  }

  /** 退出添加模式(ESC / 点完一次后自动调用 / 外部主动取消) */
  exitAddMode(): void {
    if (!this.addMode) return;
    this.addMode = null;
    this.cancelDrawingLine();
    this.clearMagnetHints();
    this.container.style.cursor = '';
    this.onAddModeChange?.(null);
  }

  isAddMode(): boolean {
    return this.addMode !== null;
  }

  deleteSelected(): void {
    if (this.selected.size === 0) return;
    this.pushHistory();
    for (const id of this.selected) {
      this.removeOverlay(id);
      this.nodeRenderer.remove(id);
    }
    this.selected.clear();
    this.handlesOverlay.setTarget(null);
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
    this.resizing = null;
    this.rotating = null;
    if (this.marquee) {
      this.sceneManager.scene.remove(this.marquee.overlayGroup);
      disposeMarqueeOverlay(this.marquee.overlayGroup);
      this.marquee = null;
    }
    if (this.drawingLine) {
      this.sceneManager.scene.remove(this.drawingLine.previewGroup);
      disposeLineGroup(this.drawingLine.previewGroup);
      this.drawingLine = null;
    }
    for (const group of this.magnetHints.values()) {
      this.sceneManager.scene.remove(group);
      disposeMagnetHintGroup(group);
    }
    this.magnetHints.clear();
    this.clearLineEndpointHandles();
    this.rewiring = null;
    this.addMode = null;
    this.undoStack = [];
    this.redoStack = [];
    this.clipboard = [];
    this.container.style.cursor = '';
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
    const onDblClick = (e: MouseEvent): void => this.handleDoubleClick(e);
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    el.addEventListener('dblclick', onDblClick);
    this.unsubscribers.push(
      () => el.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => el.removeEventListener('wheel', onWheel),
      () => window.removeEventListener('keydown', onKeyDown),
      () => el.removeEventListener('dblclick', onDblClick),
    );
  }

  private handleDoubleClick(e: MouseEvent): void {
    if (!this.onNodeDoubleClick) return;
    const screen = this.toContainerCoords(e);
    const hit = this.hitTest(screen.x, screen.y);
    if (!hit) return;
    // 算节点屏幕坐标 + 尺寸(走 SceneManager 同源投影,与 mesh 视觉一致)
    const tl = this.sceneManager.worldToScreen(hit.position.x, hit.position.y);
    const br = this.sceneManager.worldToScreen(
      hit.position.x + hit.size.w,
      hit.position.y + hit.size.h,
    );
    // 把 container-relative 坐标转 viewport(EditOverlay popup 用 fixed 定位)
    const rect = this.container.getBoundingClientRect();
    this.onNodeDoubleClick({
      instanceId: hit.instanceId,
      screenX: rect.left + Math.min(tl.x, br.x),
      screenY: rect.top + Math.min(tl.y, br.y),
      screenW: Math.abs(br.x - tl.x),
      screenH: Math.abs(br.y - tl.y),
    });
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
    this.container.focus(); // V1:抢键盘焦点(Delete / Escape / Cmd+Z 用)

    const screen = this.toContainerCoords(e);
    const world = this.sceneManager.screenToWorld(screen.x, screen.y);

    // ── 0. addMode 优先级最高(V1 365-374 直迁) ──
    if (this.addMode) {
      // line 类 shape:press-drag-release 画线模式 — mousedown 必须在某 magnet 16px 内,
      // 否则取消(不创建悬空 line)
      if (this.isAddingLine()) {
        this.tryStartDrawingLine(world);
        return;
      }
      this.placeInstance(world);
      return;
    }

    // [G4.4 砍] raycastLinkHref → dispatchLinkHref

    // ── 1. 优先命中 HandlesOverlay(resize / rotate)──
    const handleHit = this.handlesOverlay.hitTest(screen.x, screen.y);
    const handleTarget = this.handlesOverlay.getTarget();
    if (handleHit && handleTarget) {
      if (handleHit === 'rotate') {
        this.startRotate(handleTarget, world);
      } else {
        this.startResize(handleTarget, handleHit, world);
      }
      return;
    }

    // ── 1.5 line endpoint handle 命中 → 进 rewire(V1:388-393) ──
    const epIdx = this.hitTestLineEndpointHandle(world);
    if (epIdx !== null && this.lineEndpointHandles) {
      this.startRewire(this.lineEndpointHandles.instanceId, epIdx);
      return;
    }

    // ── 2. 命中节点 → 选中 + 启动拖动 ──
    const hit = this.hitTest(screen.x, screen.y);
    const additive = e.shiftKey || e.metaKey;
    if (hit) {
      if (additive) {
        if (this.selected.has(hit.instanceId)) {
          this.selected.delete(hit.instanceId);
        } else {
          this.selected.add(hit.instanceId);
        }
        this.refreshOverlays();
        this.refreshHandles();
        this.notifySelection();
      } else {
        if (!this.selected.has(hit.instanceId)) {
          this.selected.clear();
          this.selected.add(hit.instanceId);
          this.refreshOverlays();
          this.refreshHandles();
          this.notifySelection();
        }
      }
      this.startDragNodes(world);
    } else {
      // 空白处:启动 marquee 框选(V1 1110-1120 直迁)
      // additive=false 时若框太小(单击空白)会在 finishMarquee 当 clearSelection 处理
      this.startMarquee(world, additive);
    }
  }

  /** V1 startDrag:pushHistory + 记录所有选中节点的起始位置快照,move 时 + delta */
  private startDragNodes(startWorld: { x: number; y: number }): void {
    const snapshots = new Map<string, { x: number; y: number }>();
    for (const id of this.selected) {
      const inst = this.nodeRenderer.getInstance(id);
      if (inst?.position) snapshots.set(id, { ...inst.position });
    }
    if (snapshots.size === 0) {
      this.dragging = null;
      return;
    }
    this.pushHistory();
    this.dragging = { startWorld, snapshots };
    this.dragMoved = false;
  }

  private handleMouseMove(e: MouseEvent): void {
    const screen = this.toContainerCoords(e);
    const world = this.sceneManager.screenToWorld(screen.x, screen.y);

    if (this.resizing) {
      this.applyResize(world);
      return;
    }
    if (this.rotating) {
      this.applyRotate(world, e.shiftKey);
      return;
    }
    if (this.rewiring) {
      this.updateRewire(world);
      return;
    }
    if (this.drawingLine) {
      this.updateDrawingLine(world);
      this.refreshMagnetHintsForHover(world);
      return;
    }
    // addMode 是 line(未起手)时 hover 高亮 magnet
    if (this.addMode && this.isAddingLine()) {
      this.refreshMagnetHintsForHover(world);
      return;
    }
    if (this.marquee) {
      this.marquee.currentWorld = world;
      rebuildMarqueeOverlay(this.marquee.overlayGroup, this.marquee.startWorld, world);
      this.container.style.cursor = 'crosshair';
      return;
    }

    // hover handle:更新 cursor(V1 1719-1731 cursorForHandle 直迁)
    if (!this.dragging) {
      this.updateHoverCursor(screen.x, screen.y);
    }
    if (this.dragging) {
      const dx = world.x - this.dragging.startWorld.x;
      const dy = world.y - this.dragging.startWorld.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) this.dragMoved = true;
      for (const [id, snap] of this.dragging.snapshots) {
        this.nodeRenderer.setPosition(id, { x: snap.x + dx, y: snap.y + dy });
        this.updateOverlay(id);
      }
      // 拖动时 handles 跟着动(node 是同一引用,layout 通过 RAF 自动跟)
      const target = this.handlesOverlay.getTarget();
      if (target) this.handlesOverlay.setTarget(this.nodeRenderer.get(target.instanceId) ?? null);
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (this.resizing) {
      this.resizing = null;
      this.refreshHandles();
      this.onInstancesChange?.();
      return;
    }
    if (this.rotating) {
      this.rotating = null;
      this.refreshHandles();
      this.onInstancesChange?.();
      return;
    }
    if (this.rewiring) {
      const screen = this.toContainerCoords(e);
      const world = this.sceneManager.screenToWorld(screen.x, screen.y);
      this.tryFinishRewire(world);
      return;
    }
    if (this.drawingLine) {
      const screen = this.toContainerCoords(e);
      const world = this.sceneManager.screenToWorld(screen.x, screen.y);
      this.tryFinishDrawingLine(world);
      return;
    }
    if (this.marquee) {
      this.finishMarquee();
      this.container.style.cursor = '';
      return;
    }
    if (this.dragging) {
      if (this.dragMoved) this.onInstancesChange?.();
      this.dragging = null;
    }
    this.dragMoved = false;
  }

  /**
   * Hover handle 时换 cursor(resize 双箭头 / rotation grab);未命中 handle 时还原 default.
   * V1 InteractionController 在 mousemove 拐角处调用 cursorForHandle(rotation 折算 8 方位).
   */
  private updateHoverCursor(screenX: number, screenY: number): void {
    const handleHit = this.handlesOverlay.hitTest(screenX, screenY);
    const target = this.handlesOverlay.getTarget();
    if (handleHit && target) {
      this.container.style.cursor = cursorForHandle(handleHit, target.rotation ?? 0);
    } else {
      this.container.style.cursor = 'default';
    }
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

    const meta = e.metaKey || e.ctrlKey;

    // Cmd/Ctrl + Z / Shift+Z(undo / redo)
    if (meta && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    // Cmd/Ctrl + C(copy)
    if (meta && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      this.copySelected();
      return;
    }
    // Cmd/Ctrl + V(paste)
    if (meta && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      this.pasteClipboard();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selected.size > 0) {
        e.preventDefault();
        this.deleteSelected();
      }
    } else if (e.key === 'Escape') {
      // V1 优先级:resize/rotate → marquee → rewire → drawingLine → addMode → 清选区
      if (this.resizing) {
        this.resizing = null;
        this.refreshHandles();
      } else if (this.rotating) {
        this.rotating = null;
        this.refreshHandles();
      } else if (this.marquee) {
        this.cancelMarquee();
      } else if (this.rewiring) {
        this.cancelRewire();
      } else if (this.drawingLine) {
        this.cancelDrawingLine();
      } else if (this.addMode) {
        this.exitAddMode();
      } else if (this.selected.size > 0) {
        this.clearSelection();
      }
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
  // addMode 实例化(V1 429-463 直迁;Picker 触发后点画布创建 instance)
  // ─────────────────────────────────────────────────────────

  /** 当前 addMode spec 是否是 line 类 shape — G4.3c 真消费时区分点击 / press-drag 路径 */
  private isAddingLine(): boolean {
    if (!this.addMode || this.addMode.kind !== 'shape') return false;
    const api = getShapeApi();
    const shape = api.shapes.get(this.addMode.ref);
    return shape?.category === 'line';
  }

  /** 把当前 spec 实例化到点击的世界坐标,居中对齐 */
  private placeInstance(world: { x: number; y: number }): void {
    const spec = this.addMode;
    if (!spec) return;
    this.pushHistory();

    const size = resolveDefaultSize(spec);
    const id = this.nodeRenderer.nextInstanceId();
    const position = { x: world.x - size.w / 2, y: world.y - size.h / 2 };
    const instance: Instance = {
      ...(spec.presetInstance ?? {}),
      id,
      type: spec.kind,
      ref: spec.ref,
      position,
      size,
    };
    // 文字节点:创建时初始化空 DriverSerialized 信封(decision 018 P0d hotfix
    // 形态对齐 — 与 view 端编辑结束写回 inst.doc 的 DriverSerialized 信封一致,
    // 防 incomingDocToPmPayload 走 fallback 触发 warn 噪音化)。
    if (spec.ref === 'krig.text.label') {
      instance.doc = {
        format: 'pm-doc-json',
        version: '0.1',
        payload: { type: 'doc', content: [] },
      };
      // L5-G5 §5.4b:新建文字节点默认字号 16(对齐 note 正文)。老画板节点无此字段,
      // 渲染端兜底 14(视觉不变)。
      instance.text_size = 16;
    }
    this.nodeRenderer.add(instance);
    // 防御:shape/substance 找不到时 add 不渲染也不存数据,此时不要选中孤儿 id
    if (!this.nodeRenderer.get(id)) {
      console.warn(`[InteractionController] placeInstance: ${spec.kind} '${spec.ref}' 渲染失败,跳过选中`);
      this.exitAddMode();
      return;
    }

    // 选中新建的 instance,退出 addMode
    this.selected.clear();
    this.selected.add(id);
    this.refreshOverlays();
    this.refreshHandles();
    this.notifySelection();
    this.exitAddMode();
    this.onInstancesChange?.();
  }

  // ─────────────────────────────────────────────────────────
  // 画 line(V1 874-973 直迁;addMode line 类下 press-drag-release + magnet 吸附)
  // ─────────────────────────────────────────────────────────

  /** 收集所有候选 magnet 节点(供 findClosestMagnet 用) */
  private allMagnetCandidates(): Array<{ node: RenderedNode; instance: Instance }> {
    const out: Array<{ node: RenderedNode; instance: Instance }> = [];
    for (const id of this.nodeRenderer.ids()) {
      const node = this.nodeRenderer.get(id);
      const inst = this.getInstance(id);
      if (node && inst) out.push({ node, instance: inst });
    }
    return out;
  }

  /** 屏幕像素吸附半径 → 世界距离(用于 magnet 吸附半径换算) */
  private snapRadiusWorld(): number {
    const zoom = this.sceneManager.getView().zoom;
    return MAGNET_SNAP_RADIUS_PX / Math.max(zoom, 0.01);
  }

  /** mousedown 在 magnet 16px 内 → 起手画线;否则取消 addMode(不创建悬空 line) */
  private tryStartDrawingLine(world: { x: number; y: number }): void {
    if (!this.addMode) return;
    const closest = findClosestMagnet(
      world.x, world.y,
      this.allMagnetCandidates(),
      this.snapRadiusWorld(),
    );
    if (!closest) {
      this.exitAddMode();
      return;
    }
    const lineRef = this.addMode.ref;
    const startWorld = { x: closest.magnet.x, y: closest.magnet.y };
    // 创建预览 line(start = end = magnet 处,长度 0)
    const previewGroup = renderLine(lineRef, {
      start: startWorld,
      end: startWorld,
    });
    this.sceneManager.scene.add(previewGroup);
    this.drawingLine = {
      startInstanceId: closest.magnet.instanceId,
      startMagnetId: closest.magnet.magnetId,
      startWorld,
      lineRef,
      previewGroup,
    };
  }

  /** mousemove:更新预览 line 终点(吸附附近 magnet 或跟鼠标) */
  private updateDrawingLine(world: { x: number; y: number }): void {
    if (!this.drawingLine) return;
    const exclude = new Set([this.drawingLine.startInstanceId]);
    const closest = findClosestMagnet(
      world.x, world.y,
      this.allMagnetCandidates(),
      this.snapRadiusWorld(),
      exclude,
    );
    const end = closest ? { x: closest.magnet.x, y: closest.magnet.y } : world;
    updateLineGeometry(
      this.drawingLine.previewGroup,
      this.drawingLine.lineRef,
      this.drawingLine.startWorld,
      end,
    );
  }

  /** mouseup:落点在 magnet 16px 内 → 创建 line instance;否则取消 */
  private tryFinishDrawingLine(world: { x: number; y: number }): void {
    if (!this.drawingLine) return;
    const drawing = this.drawingLine;
    // 清掉预览 line(无论成败)
    this.sceneManager.scene.remove(drawing.previewGroup);
    disposeLineGroup(drawing.previewGroup);
    this.drawingLine = null;

    const exclude = new Set([drawing.startInstanceId]);
    const closest = findClosestMagnet(
      world.x, world.y,
      this.allMagnetCandidates(),
      this.snapRadiusWorld(),
      exclude,
    );
    if (!closest) {
      this.exitAddMode();
      return;
    }

    // 创建 line instance(endpoints 驱动,无 position/size)
    this.pushHistory();
    const id = this.nodeRenderer.nextInstanceId();
    const instance: Instance = {
      id,
      type: 'shape',
      ref: drawing.lineRef,
      endpoints: [
        { instance: drawing.startInstanceId, magnet: drawing.startMagnetId },
        { instance: closest.magnet.instanceId, magnet: closest.magnet.magnetId },
      ],
    };
    this.nodeRenderer.add(instance);

    // 选中新 line(line 不显 handles — refreshHandles 内部已守门)
    this.selected.clear();
    this.selected.add(id);
    this.refreshOverlays();
    this.refreshHandles();
    this.notifySelection();
    this.exitAddMode();
    this.onInstancesChange?.();
  }

  /** ESC / unmount / exitAddMode 时取消画 line(清掉预览 group) */
  private cancelDrawingLine(): void {
    if (!this.drawingLine) return;
    this.sceneManager.scene.remove(this.drawingLine.previewGroup);
    disposeLineGroup(this.drawingLine.previewGroup);
    this.drawingLine = null;
  }

  // ─────────────────────────────────────────────────────────
  // Magnet hints(V1 1163-1251 + 1806-1858 直迁;hover shape 显示 magnet 点)
  // ─────────────────────────────────────────────────────────

  /**
   * hover 显示 magnet 提示:
   * - 画线中:显示除起点 instance 外所有 shape 的 magnet 点
   * - 仅 addMode 是 line(未起手):只显示鼠标 hover 的 shape 的 magnet 点
   */
  private refreshMagnetHintsForHover(world: { x: number; y: number }): void {
    if (this.drawingLine) {
      const startId = this.drawingLine.startInstanceId;
      this.showMagnetHintsFor((id) => id !== startId);
      return;
    }
    const proximityIds = this.findShapesNearMouse(world);
    if (proximityIds.size === 0) {
      this.clearMagnetHints();
      return;
    }
    this.showMagnetHintsFor((id) => proximityIds.has(id));
  }

  /**
   * 找鼠标附近的 shape:命中本体 OR 距任意 magnet ≤ snapRadius
   * 用于"鼠标接近边缘 magnet 时"也能显示候选 shape 的所有 magnets(V1 1189)
   */
  private findShapesNearMouse(world: { x: number; y: number }): Set<string> {
    const radius = this.snapRadiusWorld();
    const ids = new Set<string>();
    const hit = this.hitTestByWorldOBB(world);
    if (hit) ids.add(hit);
    for (const { node, instance } of this.allMagnetCandidates()) {
      if (ids.has(instance.id)) continue;
      const magnets = listMagnets(node, instance);
      for (const m of magnets) {
        const d = Math.hypot(world.x - m.x, world.y - m.y);
        if (d <= radius) {
          ids.add(instance.id);
          break;
        }
      }
    }
    return ids;
  }

  /** 在指定 instance 上显示 magnet 点(filter 返回 true 的 instance 才显;V1 1211) */
  private showMagnetHintsFor(filter: (id: string) => boolean): void {
    const wantedIds = new Set<string>();
    for (const id of this.nodeRenderer.ids()) {
      if (!filter(id)) continue;
      const node = this.nodeRenderer.get(id);
      const inst = this.getInstance(id);
      if (!node || !inst) continue;
      if (listMagnets(node, inst).length === 0) continue;
      wantedIds.add(id);
    }
    // 删多余
    for (const [id, group] of Array.from(this.magnetHints)) {
      if (!wantedIds.has(id)) {
        this.sceneManager.scene.remove(group);
        disposeMagnetHintGroup(group);
        this.magnetHints.delete(id);
      }
    }
    // 加新 / 更新已有(magnet 位置可能因节点拖动 / 旋转变化)
    for (const id of wantedIds) {
      const node = this.nodeRenderer.get(id);
      const inst = this.getInstance(id);
      if (!node || !inst) continue;
      const existing = this.magnetHints.get(id);
      if (existing) {
        rebuildMagnetHintDots(existing, node, inst);
      } else {
        const group = makeMagnetHintGroup(node, inst);
        this.sceneManager.scene.add(group);
        this.magnetHints.set(id, group);
      }
    }
  }

  private clearMagnetHints(): void {
    for (const group of this.magnetHints.values()) {
      this.sceneManager.scene.remove(group);
      disposeMagnetHintGroup(group);
    }
    this.magnetHints.clear();
  }

  // ─────────────────────────────────────────────────────────
  // Line endpoint handles + Rewire(V1 1524-1611 + 980-1104 直迁)
  // ─────────────────────────────────────────────────────────

  /** 单选 line 时显示 2 个端点 handle(rewire 入口) */
  private refreshLineEndpointHandles(): void {
    const ids = Array.from(this.selected);
    const single = ids.length === 1 ? this.nodeRenderer.get(ids[0]) : null;
    const isLine = single && isLineKind(single);
    if (!isLine) {
      this.clearLineEndpointHandles();
      return;
    }
    const inst = this.getInstance(single.instanceId);
    if (!inst) return;
    const ep = this.resolveLineWorldEndpoints(inst);
    if (!ep) {
      this.clearLineEndpointHandles();
      return;
    }
    if (this.lineEndpointHandles && this.lineEndpointHandles.instanceId === single.instanceId) {
      this.lineEndpointHandles.handles[0].position.set(ep.start.x, ep.start.y, MAGNET_HINT_Z);
      this.lineEndpointHandles.handles[1].position.set(ep.end.x, ep.end.y, MAGNET_HINT_Z);
    } else {
      this.clearLineEndpointHandles();
      const group = new THREE.Group();
      const h0 = makeEndpointHandleMesh();
      const h1 = makeEndpointHandleMesh();
      h0.position.set(ep.start.x, ep.start.y, MAGNET_HINT_Z);
      h1.position.set(ep.end.x, ep.end.y, MAGNET_HINT_Z);
      group.add(h0);
      group.add(h1);
      this.sceneManager.scene.add(group);
      this.lineEndpointHandles = { instanceId: single.instanceId, handles: [h0, h1], group };
    }
  }

  private clearLineEndpointHandles(): void {
    if (!this.lineEndpointHandles) return;
    this.sceneManager.scene.remove(this.lineEndpointHandles.group);
    for (const m of this.lineEndpointHandles.handles) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.lineEndpointHandles = null;
  }

  /** 解析一条 line 实例两端的世界坐标(V1 1574-1594) */
  private resolveLineWorldEndpoints(
    inst: Instance,
  ): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
    if (!inst.endpoints) return null;
    const resolveOther = (id: string): { node: RenderedNode; instance: Instance } | null => {
      const n = this.nodeRenderer.get(id);
      const i = this.getInstance(id);
      return n && i ? { node: n, instance: i } : null;
    };
    const a = inst.endpoints[0];
    const b = inst.endpoints[1];
    const aPair = resolveOther(a.instance);
    const bPair = resolveOther(b.instance);
    if (!aPair || !bPair) return null;
    const start = listMagnets(aPair.node, aPair.instance).find((m) => m.magnetId === a.magnet);
    const end = listMagnets(bPair.node, bPair.instance).find((m) => m.magnetId === b.magnet);
    if (!start || !end) return null;
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  }

  /** 世界坐标 → 命中的 line endpoint handle index(0/1) or null(V1 1597-1610) */
  private hitTestLineEndpointHandle(world: { x: number; y: number }): 0 | 1 | null {
    if (!this.lineEndpointHandles) return null;
    const handles = this.lineEndpointHandles.handles;
    const radius = 12; // 世界单位
    for (let i = 0; i < 2; i++) {
      const p = handles[i].position;
      const d = Math.hypot(world.x - p.x, world.y - p.y);
      if (d <= radius) return i as 0 | 1;
    }
    return null;
  }

  /** 进入 rewire 状态:记 line + 拖的哪一端 + 起始 endpoints 快照(V1 980-996) */
  private startRewire(instanceId: string, endpointIndex: 0 | 1): void {
    const inst = this.getInstance(instanceId);
    if (!inst || !inst.endpoints) return;
    this.pushHistory();
    this.rewiring = {
      instanceId,
      endpointIndex,
      startEndpoints: [
        { ...inst.endpoints[0] },
        { ...inst.endpoints[1] },
      ],
    };
    // 进 rewire 时显示所有候选 shape 的 magnet 点(除 line 自身)
    this.showMagnetHintsFor((id) => id !== instanceId);
  }

  /**
   * mousemove:line 几何跟随鼠标(吸附附近 magnet 或跟手),不改 Instance.endpoints
   * (避免 endpoints 字段不支持"自由坐标"的限制).mouseup 命中 magnet 才正式写.
   */
  private updateRewire(world: { x: number; y: number }): void {
    if (!this.rewiring) return;
    const inst = this.getInstance(this.rewiring.instanceId);
    if (!inst || !inst.endpoints) return;
    const node = this.nodeRenderer.get(this.rewiring.instanceId);
    if (!node) return;

    // 解析另一端世界坐标(rewire 中固定不动)
    const otherIdx = this.rewiring.endpointIndex === 0 ? 1 : 0;
    const otherEp = this.rewiring.startEndpoints[otherIdx];
    const otherPair = ((): { node: RenderedNode; instance: Instance } | null => {
      const n = this.nodeRenderer.get(otherEp.instance);
      const i = this.getInstance(otherEp.instance);
      return n && i ? { node: n, instance: i } : null;
    })();
    if (!otherPair) return;
    const otherMagnet = listMagnets(otherPair.node, otherPair.instance)
      .find((m) => m.magnetId === otherEp.magnet);
    if (!otherMagnet) return;
    const fixedEnd = { x: otherMagnet.x, y: otherMagnet.y };

    // 被拖端:吸附附近 magnet,否则跟鼠标
    const exclude = new Set([otherEp.instance]);
    const closest = findClosestMagnet(
      world.x, world.y,
      this.allMagnetCandidates(),
      this.snapRadiusWorld(),
      exclude,
    );
    const draggedEnd = closest
      ? { x: closest.magnet.x, y: closest.magnet.y }
      : { x: world.x, y: world.y };

    const start = this.rewiring.endpointIndex === 0 ? draggedEnd : fixedEnd;
    const end = this.rewiring.endpointIndex === 0 ? fixedEnd : draggedEnd;

    // 直接改 line group 几何(不动 endpoints)
    updateLineGeometry(node.group, inst.ref, start, end);

    // 同步 endpoint handle 位置(被拖端跟着)
    if (this.lineEndpointHandles &&
        this.lineEndpointHandles.instanceId === this.rewiring.instanceId) {
      this.lineEndpointHandles.handles[this.rewiring.endpointIndex]
        .position.set(draggedEnd.x, draggedEnd.y, MAGNET_HINT_Z);
    }
  }

  /** mouseup:落点吸附到 magnet 则写 endpoints,落空则还原(V1 1052-1088) */
  private tryFinishRewire(world: { x: number; y: number }): void {
    if (!this.rewiring) return;
    const r = this.rewiring;
    this.rewiring = null;
    this.clearMagnetHints();
    const inst = this.getInstance(r.instanceId);
    if (!inst || !inst.endpoints) return;

    const otherIdx = r.endpointIndex === 0 ? 1 : 0;
    const otherInst = r.startEndpoints[otherIdx].instance;
    const exclude = new Set([otherInst]);
    const closest = findClosestMagnet(
      world.x, world.y,
      this.allMagnetCandidates(),
      this.snapRadiusWorld(),
      exclude,
    );
    if (closest) {
      inst.endpoints[r.endpointIndex] = {
        instance: closest.magnet.instanceId,
        magnet: closest.magnet.magnetId,
      };
      this.nodeRenderer.updateLinesFor(closest.magnet.instanceId);
      this.refreshOverlays();
      this.onInstancesChange?.();
    } else {
      // 落空:还原原 endpoints + 刷几何 + 弹掉 pushHistory 记的快照
      inst.endpoints[0] = { ...r.startEndpoints[0] };
      inst.endpoints[1] = { ...r.startEndpoints[1] };
      this.nodeRenderer.updateLinesFor(r.startEndpoints[0].instance);
      this.refreshOverlays();
      if (this.undoStack.length > 0) this.undoStack.pop();
    }
  }

  /** ESC / unmount:还原起始 endpoints(V1 1091-1104) */
  private cancelRewire(): void {
    if (!this.rewiring) return;
    const r = this.rewiring;
    this.rewiring = null;
    this.clearMagnetHints();
    const inst = this.getInstance(r.instanceId);
    if (inst && inst.endpoints) {
      inst.endpoints[0] = { ...r.startEndpoints[0] };
      inst.endpoints[1] = { ...r.startEndpoints[1] };
      this.nodeRenderer.updateLinesFor(r.startEndpoints[0].instance);
      this.refreshOverlays();
    }
    if (this.undoStack.length > 0) this.undoStack.pop();
  }

  /**
   * 旧 OBB hit-test(基于世界坐标 + AABB 反变换);用于 findShapesNearMouse
   * 等拿到的是世界坐标的场景.与 Raycaster hitTest 有微小偏差,在 zoom 后视觉
   * 精度场景不要用这个(V1 804-828 直迁).
   */
  private hitTestByWorldOBB(world: { x: number; y: number }): string | null {
    let bestShape: { id: string; area: number } | null = null;
    for (const id of this.nodeRenderer.ids()) {
      const node = this.nodeRenderer.get(id);
      if (!node || isLineKind(node)) continue;
      const { position, size } = node;
      if (size.w === 0 && size.h === 0) continue;
      const cx = position.x + size.w / 2;
      const cy = position.y + size.h / 2;
      const dx = world.x - cx;
      const dy = world.y - cy;
      const rad = -((node.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      const halfW = size.w / 2;
      const halfH = size.h / 2;
      if (lx >= -halfW && lx <= halfW && ly >= -halfH && ly <= halfH) {
        const area = size.w * size.h;
        if (!bestShape || area < bestShape.area) bestShape = { id, area };
      }
    }
    return bestShape?.id ?? null;
  }

  // ─────────────────────────────────────────────────────────
  // Marquee 框选(V1 1110-1162 直迁;空白拖动 → AABB 内节点全选)
  // ─────────────────────────────────────────────────────────

  private startMarquee(startWorld: { x: number; y: number }, additive: boolean): void {
    const overlayGroup = new THREE.Group();
    rebuildMarqueeOverlay(overlayGroup, startWorld, startWorld);
    this.sceneManager.scene.add(overlayGroup);
    this.marquee = {
      startWorld,
      currentWorld: startWorld,
      overlayGroup,
      additive,
    };
  }

  /** mouseup:框内 shape 加进 selected;太小则视为"清选区" */
  private finishMarquee(): void {
    if (!this.marquee) return;
    const { startWorld, currentWorld, additive, overlayGroup } = this.marquee;
    this.marquee = null;
    this.sceneManager.scene.remove(overlayGroup);
    disposeMarqueeOverlay(overlayGroup);

    const minX = Math.min(startWorld.x, currentWorld.x);
    const maxX = Math.max(startWorld.x, currentWorld.x);
    const minY = Math.min(startWorld.y, currentWorld.y);
    const maxY = Math.max(startWorld.y, currentWorld.y);

    // 太小的框(单击空白)→ 非 additive 时清选区,additive 不动
    if (maxX - minX < 2 && maxY - minY < 2) {
      if (!additive && this.selected.size > 0) {
        this.selected.clear();
        this.refreshOverlays();
        this.refreshHandles();
        this.notifySelection();
      }
      return;
    }

    // 找所有 shape 中心落在框内(line 用 bbox 中心;substance 同)
    if (!additive) this.selected.clear();
    for (const id of this.nodeRenderer.ids()) {
      const node = this.nodeRenderer.get(id);
      if (!node) continue;
      const cx = node.position.x + node.size.w / 2;
      const cy = node.position.y + node.size.h / 2;
      if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
        this.selected.add(id);
      }
    }
    this.refreshOverlays();
    this.refreshHandles();
    this.notifySelection();
  }

  private cancelMarquee(): void {
    if (!this.marquee) return;
    this.sceneManager.scene.remove(this.marquee.overlayGroup);
    disposeMarqueeOverlay(this.marquee.overlayGroup);
    this.marquee = null;
    this.container.style.cursor = '';
  }

  // ─────────────────────────────────────────────────────────
  // Resize / Rotate(V1 1254-1426 直迁,无算法改动)
  // ─────────────────────────────────────────────────────────

  private startResize(
    node: RenderedNode,
    handle: Exclude<HandleKind, 'rotate'>,
    startWorld: { x: number; y: number },
  ): void {
    this.pushHistory();
    this.resizing = {
      instanceId: node.instanceId,
      handle,
      startWorld,
      startPos: { x: node.position.x, y: node.position.y },
      startSize: { w: node.size.w, h: node.size.h },
      startRotation: node.rotation ?? 0,
    };
  }

  private startRotate(node: RenderedNode, startWorld: { x: number; y: number }): void {
    this.pushHistory();
    const cx = node.position.x + node.size.w / 2;
    const cy = node.position.y + node.size.h / 2;
    const startAngle = (Math.atan2(startWorld.y - cy, startWorld.x - cx) * 180) / Math.PI;
    this.rotating = {
      instanceId: node.instanceId,
      centerWorld: { x: cx, y: cy },
      startAngle,
      startRotation: node.rotation ?? 0,
    };
  }

  /**
   * 应用 resize:支持 8 handle + 已旋转节点(V1 1324-1403 算法直迁)
   * 把 mouse delta 转回节点本地坐标(去 startRotation),按 handle 类型
   * 调整本地半宽/半高 + 中心位移,再把中心位移转回世界更新 position
   */
  private applyResize(world: { x: number; y: number }): void {
    const r = this.resizing;
    if (!r) return;
    const inst = this.getInstance(r.instanceId);
    if (!inst || !inst.position || !inst.size) return;

    const startCx = r.startPos.x + r.startSize.w / 2;
    const startCy = r.startPos.y + r.startSize.h / 2;

    const dx = world.x - r.startWorld.x;
    const dy = world.y - r.startWorld.y;

    // delta 转本地坐标(逆 rotation)
    const rad = (-r.startRotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const ldx = dx * cos - dy * sin;
    const ldy = dx * sin + dy * cos;

    const dir = handleDir(r.handle);
    const isCorner = dir.x !== 0 && dir.y !== 0;

    const startHW = r.startSize.w / 2;
    const startHH = r.startSize.h / 2;
    const minHalf = 5;
    let newHW = startHW;
    let newHH = startHH;
    let centerShiftX = 0;
    let centerShiftY = 0;

    if (isCorner) {
      // 角 handle = 等比缩放:沿对角线方向投影
      const startHX = dir.x * startHW;
      const startHY = dir.y * startHH;
      const newHX = startHX + ldx;
      const newHY = startHY + ldy;
      const startLen = Math.hypot(startHX, startHY);
      const proj = (newHX * startHX + newHY * startHY) / startLen;
      const ratio = Math.max(minHalf / Math.min(startHW, startHH), proj / startLen);
      newHW = startHW * ratio;
      newHH = startHH * ratio;
      centerShiftX = (dir.x * (newHW - startHW)) / 2;
      centerShiftY = (dir.y * (newHH - startHH)) / 2;
    } else {
      // 边 handle = 单边缩放
      if (dir.x !== 0) {
        newHW = Math.max(minHalf, startHW + dir.x * ldx);
        centerShiftX = (dir.x * (newHW - startHW)) / 2;
      }
      if (dir.y !== 0) {
        newHH = Math.max(minHalf, startHH + dir.y * ldy);
        centerShiftY = (dir.y * (newHH - startHH)) / 2;
      }
    }

    // 本地中心位移转回世界
    const cosBack = Math.cos((r.startRotation * Math.PI) / 180);
    const sinBack = Math.sin((r.startRotation * Math.PI) / 180);
    const wShiftX = centerShiftX * cosBack - centerShiftY * sinBack;
    const wShiftY = centerShiftX * sinBack + centerShiftY * cosBack;

    const newCx = startCx + wShiftX;
    const newCy = startCy + wShiftY;
    const newW = newHW * 2;
    const newH = newHH * 2;

    inst.size.w = newW;
    inst.size.h = newH;
    inst.position.x = newCx - newW / 2;
    inst.position.y = newCy - newH / 2;
    this.nodeRenderer.update(inst);
    this.handlesOverlay.setTarget(this.nodeRenderer.get(r.instanceId) ?? null);
    this.refreshOverlays();
  }

  /** 应用 rotate:当前角度 - 起始角度 + startRotation;Shift 吸附到 15°(V1 1406-1426 直迁) */
  private applyRotate(world: { x: number; y: number }, snap: boolean): void {
    const r = this.rotating;
    if (!r) return;
    const inst = this.getInstance(r.instanceId);
    if (!inst) return;

    const curAngle =
      (Math.atan2(world.y - r.centerWorld.y, world.x - r.centerWorld.x) * 180) / Math.PI;
    let newRot = r.startRotation + (curAngle - r.startAngle);
    while (newRot > 180) newRot -= 360;
    while (newRot < -180) newRot += 360;
    if (snap) newRot = Math.round(newRot / 15) * 15;

    inst.rotation = newRot;
    this.nodeRenderer.update(inst);
    this.handlesOverlay.setTarget(this.nodeRenderer.get(r.instanceId) ?? null);
    this.refreshOverlays();
  }

  // ─────────────────────────────────────────────────────────
  // Undo / Redo(V1 1432-1482 直迁,50 步全量快照)
  // ─────────────────────────────────────────────────────────

  /** 在原子操作前调:把当前 instances 全量快照压入 undo stack,清 redo stack */
  private pushHistory(): void {
    const snap = this.nodeRenderer.listInstances().map(cloneInstance);
    this.undoStack.push(snap);
    if (this.undoStack.length > InteractionController.HISTORY_LIMIT) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.nodeRenderer.listInstances().map(cloneInstance));
    this.applySnapshot(prev);
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.nodeRenderer.listInstances().map(cloneInstance));
    this.applySnapshot(next);
  }

  /** 加载一份 instances 快照:清空,逐个 add,清选区,触发持久化 */
  private applySnapshot(snap: Instance[]): void {
    this.dragging = null;
    this.resizing = null;
    this.rotating = null;
    this.nodeRenderer.clear();
    for (const inst of snap) this.nodeRenderer.add(cloneInstance(inst));
    this.selected.clear();
    this.refreshOverlays();
    this.handlesOverlay.setTarget(null);
    this.notifySelection();
    this.onInstancesChange?.();
  }

  // ─────────────────────────────────────────────────────────
  // Clipboard(view-scoped Cmd+C / Cmd+V;V1 复制偏移 + 新 id)
  // ─────────────────────────────────────────────────────────

  /** Cmd+C:存当前选中 instances 全量快照 */
  private copySelected(): void {
    if (this.selected.size === 0) return;
    const ids = Array.from(this.selected);
    this.clipboard = ids
      .map((id) => this.getInstance(id))
      .filter((x): x is Instance => x !== undefined)
      .map(cloneInstance);
  }

  /**
   * Cmd+V:把 clipboard instances 加进画板,各自生成新 id + 偏移 16 像素.
   * line 的 endpoints.instance 引用:若引用的是同批粘贴里的 instance(id 映射存在),
   * 则换成新 id;否则保留原引用(指向画板上未变的 instance).
   * 粘贴后选中新粘贴的 instances + handles 锁定第一个.
   */
  private pasteClipboard(): void {
    if (this.clipboard.length === 0) return;
    this.pushHistory();
    const OFFSET = 16;
    // 旧 id → 新 id 映射(用于 line.endpoints rewire)
    const idMap = new Map<string, string>();
    for (const inst of this.clipboard) idMap.set(inst.id, genId());

    const newIds: string[] = [];
    for (const orig of this.clipboard) {
      const next = cloneInstance(orig);
      next.id = idMap.get(orig.id) as string;
      if (next.position) {
        next.position.x += OFFSET;
        next.position.y += OFFSET;
      }
      if (next.endpoints) {
        const [a, b] = next.endpoints;
        next.endpoints = [
          { ...a, instance: idMap.get(a.instance) ?? a.instance },
          { ...b, instance: idMap.get(b.instance) ?? b.instance },
        ];
      }
      this.nodeRenderer.add(next);
      newIds.push(next.id);
    }
    this.selected = new Set(newIds);
    this.refreshOverlays();
    this.refreshHandles();
    this.notifySelection();
    this.onInstancesChange?.();
  }

  // ─────────────────────────────────────────────────────────
  // Handles 同步(选中变 / size 变后 setTarget;单选时显示,多选 / 空选时隐藏)
  // ─────────────────────────────────────────────────────────

  /** 选中态变化后同步 HandlesOverlay 显示:单选 line 之外的节点才显 */
  private refreshHandles(): void {
    if (this.selected.size !== 1) {
      this.handlesOverlay.setTarget(null);
      return;
    }
    const [only] = this.selected;
    const node = this.nodeRenderer.get(only);
    if (!node || isLineKind(node)) {
      this.handlesOverlay.setTarget(null);
      return;
    }
    this.handlesOverlay.setTarget(node);
  }

  // ─────────────────────────────────────────────────────────
  // 选中边框 overlay
  // ─────────────────────────────────────────────────────────

  private refreshOverlays(): void {
    // 清不在 selected 集合的 overlay
    for (const id of this.overlays.keys()) {
      if (!this.selected.has(id)) this.removeOverlay(id);
    }
    // 加新选中的 overlay + 刷新已存在 overlay 的顶点(resize/rotate 时跟随)
    // V1:line 实例不显矩形选中边框(它的 bbox 是端点 AABB,框个矩形没意义;
    // 选中视觉走 line endpoint handles 替代)
    for (const id of this.selected) {
      const node = this.nodeRenderer.get(id);
      if (!node) continue;
      if (isLineKind(node)) {
        if (this.overlays.has(id)) this.removeOverlay(id);
        continue;
      }
      if (!this.overlays.has(id)) this.createOverlay(id);
      else this.updateOverlay(id);
    }
    // 单选 line 时显示 2 个端点 handle(V1:1520)
    this.refreshLineEndpointHandles();
  }

  /** 计算节点旋转后的 4 个 OBB 角点(世界坐标),用于选中边框 LineLoop */
  private obbCorners(rn: RenderedNode): THREE.Vector3[] {
    const { position, size, rotation } = rn;
    const cx = position.x + size.w / 2;
    const cy = position.y + size.h / 2;
    const halfW = size.w / 2;
    const halfH = size.h / 2;
    const rad = ((rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const corners: Array<[number, number]> = [
      [-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH],
    ];
    return corners.map(([lx, ly]) => new THREE.Vector3(
      cx + lx * cos - ly * sin,
      cy + lx * sin + ly * cos,
      0.1,
    ));
  }

  private createOverlay(id: string): void {
    const rn = this.nodeRenderer.get(id);
    if (!rn) return;
    const geom = new THREE.BufferGeometry().setFromPoints(this.obbCorners(rn));
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
    const geom = new THREE.BufferGeometry().setFromPoints(this.obbCorners(rn));
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

/** Handle 方向向量(本地坐标;Y 向下)— V1 1701-1712 直迁 */
function handleDir(h: Exclude<HandleKind, 'rotate'>): { x: number; y: number } {
  switch (h) {
    case 'nw': return { x: -1, y: -1 };
    case 'n':  return { x:  0, y: -1 };
    case 'ne': return { x:  1, y: -1 };
    case 'e':  return { x:  1, y:  0 };
    case 'se': return { x:  1, y:  1 };
    case 's':  return { x:  0, y:  1 };
    case 'sw': return { x: -1, y:  1 };
    case 'w':  return { x: -1, y:  0 };
  }
}

/** Instance 深拷贝(undo/redo + clipboard 用;V1 1696-1698 直迁) */
function cloneInstance(inst: Instance): Instance {
  return structuredClone(inst);
}

/** line 类节点判断(shapeRef 以 'krig.line.' 开头;V1 1691-1693 直迁) */
function isLineKind(node: RenderedNode): boolean {
  return !!node.shapeRef && node.shapeRef.startsWith('krig.line.');
}

/**
 * 给 handle hover / drag 选 cursor(V1 1719-1731 直迁).
 * 节点旋转后 handle 视觉位置变了,cursor 也跟着旋转(rotation 折算到最近 8 方位 bucket).
 */
function cursorForHandle(h: HandleKind, rotationDeg: number): string {
  if (h === 'rotate') return 'grab';
  const baseDeg: Record<Exclude<HandleKind, 'rotate'>, number> = {
    n: -90, ne: -45, e: 0, se: 45, s: 90, sw: 135, w: 180, nw: -135,
  };
  const deg = (baseDeg[h] + rotationDeg + 360 + 22.5) % 360;
  const bucket = Math.floor(deg / 45);  // 0..7
  // bucket 0..7 → e, se, s, sw, w, nw, n, ne
  const cursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize',
                   'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
  return cursors[bucket];
}

// ─────────────────────────────────────────────────────────
// shape-library lazy singleton(magnet-snap / NodeRenderer 模式一致)
// ─────────────────────────────────────────────────────────

let _shapeApi: ShapeLibraryApi | null = null;
function getShapeApi(): ShapeLibraryApi {
  if (!_shapeApi) {
    _shapeApi = requireCapabilityApi<ShapeLibraryApi>('shape-library');
  }
  return _shapeApi;
}

/**
 * 解析新实例的 size(V1 1643-1672 直迁):
 * - 优先 spec.defaultSize
 * - shape:line 类默认 200×100;text.label 默认 200×40;其他默认 160×100
 * - substance:从 components transform 估 bbox
 * - 兜底 100×100
 */
function resolveDefaultSize(spec: AddModeSpec): { w: number; h: number } {
  if (spec.defaultSize) return spec.defaultSize;
  const api = getShapeApi();
  if (spec.kind === 'shape') {
    if (spec.ref === 'krig.text.label') return { w: 200, h: 40 };
    const shape = api.shapes.get(spec.ref);
    if (shape) {
      if (shape.category === 'line') return { w: 200, h: 100 };
      return { w: 160, h: 100 };
    }
  } else {
    const def = api.substances.get(spec.ref);
    if (def) {
      let maxX = 0, maxY = 0;
      for (const c of def.components) {
        const w = c.transform.w ?? 0;
        const h = c.transform.h ?? 0;
        const right = c.transform.x + (c.transform.anchor === 'center' ? w / 2 : w);
        const bottom = c.transform.y + (c.transform.anchor === 'center' ? h / 2 : h);
        if (right > maxX) maxX = right;
        if (bottom > maxY) maxY = bottom;
      }
      if (maxX > 0 && maxY > 0) return { w: maxX, h: maxY };
    }
  }
  return { w: 100, h: 100 };
}

// ─────────────────────────────────────────────────────────
// Marquee overlay 渲染 helpers(V1 1913-1975 直迁)
// ─────────────────────────────────────────────────────────

const MARQUEE_COLOR = 0x4A90E2;
const MARQUEE_Z = 0.03;

/** 重建框选 overlay:半透明 fill mesh + LineLoop 边框 */
function rebuildMarqueeOverlay(
  group: THREE.Group,
  start: { x: number; y: number },
  end: { x: number; y: number },
): void {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    if ('geometry' in child) (child as THREE.Mesh).geometry?.dispose();
    const m = (child as THREE.Mesh).material;
    if (Array.isArray(m)) for (const x of m) x.dispose();
    else if (m) (m as THREE.Material).dispose();
  }

  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return;

  const fillGeom = new THREE.PlaneGeometry(w, h);
  const fillMat = new THREE.MeshBasicMaterial({
    color: MARQUEE_COLOR,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const fill = new THREE.Mesh(fillGeom, fillMat);
  fill.position.set(minX + w / 2, minY + h / 2, MARQUEE_Z);
  group.add(fill);

  const borderGeom = new THREE.BufferGeometry();
  borderGeom.setAttribute('position', new THREE.Float32BufferAttribute([
    minX, minY, MARQUEE_Z,
    maxX, minY, MARQUEE_Z,
    maxX, maxY, MARQUEE_Z,
    minX, maxY, MARQUEE_Z,
  ], 3));
  const borderMat = new THREE.LineBasicMaterial({ color: MARQUEE_COLOR });
  const border = new THREE.LineLoop(borderGeom, borderMat);
  border.renderOrder = 2;
  group.add(border);
}

// ─────────────────────────────────────────────────────────
// Magnet hint mesh helpers(V1 1791-1858 直迁)
// ─────────────────────────────────────────────────────────

const MAGNET_HINT_COLOR = 0x4A90E2;
const MAGNET_HINT_Z = 0.04;            // 略低于 handles(0.05),不抢交互

function makeMagnetHintGroup(node: RenderedNode, inst: Instance): THREE.Group {
  const group = new THREE.Group();
  rebuildMagnetHintDots(group, node, inst);
  return group;
}

/** 每个 magnet 一个 CircleGeometry(世界坐标系) */
function rebuildMagnetHintDots(group: THREE.Group, node: RenderedNode, inst: Instance): void {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) for (const x of m) x.dispose();
    else if (m) (m as THREE.Material).dispose();
  }
  const dots = listMagnets(node, inst);
  for (const m of dots) {
    // 半径取 max(节点半最小边的 0.04, 4 世界单位),保证视觉可见
    const r = Math.max(Math.min(node.size.w, node.size.h) * 0.04, 4);
    const geom = new THREE.CircleGeometry(r, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: MAGNET_HINT_COLOR,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(m.x, m.y, MAGNET_HINT_Z);
    group.add(mesh);
  }
}

/**
 * Line endpoint handle mesh:line 选中时两端的深蓝小圆,供拖拽 rewire
 * 半径 6 世界单位(低 zoom 下也清晰可点)— V1 1898-1907 直迁
 */
function makeEndpointHandleMesh(): THREE.Mesh {
  const geom = new THREE.CircleGeometry(6, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x2E5C8A,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geom, mat);
}

function disposeMagnetHintGroup(group: THREE.Group): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) for (const x of m) x.dispose();
    else if (m) (m as THREE.Material).dispose();
  }
}

/** 释放 line 预览 group 的几何 / 材质(V1 1796-1804 直迁) */
function disposeLineGroup(group: THREE.Group): void {
  for (const child of group.children) {
    const line = child as THREE.Line;
    if (line.geometry) line.geometry.dispose();
    const m = line.material;
    if (Array.isArray(m)) for (const x of m) x.dispose();
    else if (m) (m as THREE.Material).dispose();
  }
}

function disposeMarqueeOverlay(group: THREE.Group): void {
  for (const child of group.children) {
    if ('geometry' in child) (child as THREE.Mesh).geometry?.dispose();
    const m = (child as THREE.Mesh).material;
    if (Array.isArray(m)) for (const x of m) x.dispose();
    else if (m) (m as THREE.Material).dispose();
  }
}

/** 生成新 instance id(粘贴用;crypto.randomUUID 兜底 fallback) */
function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

