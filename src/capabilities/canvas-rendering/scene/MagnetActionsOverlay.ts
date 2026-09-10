import * as THREE from 'three';
import type { SceneManager } from './SceneManager';
import {
  MAGNET_ACTION_RADIUS_PX,
  type MagnetActionIcon,
  type ResolvedMagnetAction,
} from '../interaction/magnet-actions';

/**
 * MagnetActionsOverlay —— 连接点操作点的**画笔**(three 薄壳)
 *
 * 职责边界(⭐ 照 HandlesOverlay 的 `ParamHandleProvider` 范式):
 * - overlay **只画**;画什么由外部 provider 每帧给(已解析到世界坐标的操作点列表)
 * - 命中判定 / 落点解析在 `interaction/magnet-actions.ts`(纯函数,可单测)——
 *   本文件刻意不含判定逻辑,因为 vitest 是 node 环境测不到 three
 *
 * ⚠️ 本 overlay **不认识任何业务语义**(不知道什么叫「折叠」),
 * 只知道「这个连接点上有个可点的圆,图标是 +/-/·」。
 *
 * 视觉:
 * - 蓝边白底小圆(与 resize 白圆同族,但**画在连接点上**且带 +/- 记号,可区分)
 * - ⭐ **像素恒定不随 zoom 缩放**:每个操作点一个 group,
 *   `group.position` = magnet 世界坐标,`group.scale = 1/zoom`
 *   → mesh 顶点 1 单位 == 屏幕 1 像素(与 HandlesOverlay 同一套推导)
 * - ⭐ 记号**画几何**(线段),不走文字渲染 ——
 *   打包字体按 CJK/ASCII 分流,`⊕` 这类符号会渲染成空白宽度(刚踩过)
 *
 * ⚠️ 节点 rotation 不参与:操作点是圆 + 轴对齐的 +/- 记号,跟着转没有意义,
 * 位置本身已由 listMagnets 处理过 rotation。
 */

const ACTION_FILL = 0xffffff;         // 内圆白
const ACTION_BORDER = 0x4A90E2;       // 边框蓝(与选中色同族)
const ACTION_GLYPH = 0x2E5C8A;        // 记号深蓝
const ACTION_BORDER_PX = 1.2;         // 边框宽度(像素)
const GLYPH_HALF_PX = 3;              // 记号半长(像素)
const GLYPH_THICK_PX = 1.4;           // 记号线宽(像素)
const DOT_RADIUS_PX = 2;              // 'dot' 图标的实心点半径(像素)

/** 比 handles(0.05)更上层 —— 操作点要能被点到,不该被别的 overlay 盖住 */
const Z_ACTION = 0.06;

/**
 * ⚠️⚠️ 操作点必须画在**所有连线之上**(真机踩过:树连线在此汇聚,
 * 把圆里的 `+`/`-` 记号糊掉 → 看起来「折叠和展开长得一样」)。
 *
 * ⭐ 两件事缺一不可,**只调 Z 没用**:
 *  1. `LineRenderer` 的线是 `depthTest:false` —— 它**根本不看 Z**,
 *     纯按 renderOrder 排。所以把 Z 抬到 0.06 对它毫无作用。
 *  2. `renderOrder` **不从 Group 继承到子 mesh**(three 的语义:
 *     排序看的是每个可渲染对象自己的 renderOrder)。设在 root Group 上
 *     等于没设,子 mesh 仍是 0 —— 输给线的 1。
 *
 * ⭐ 所以:**逐个 mesh** 设 renderOrder,且比线的 1 高;同时 `depthTest:false`
 * 让它与线同一套规则(纯 renderOrder 排),不再受 Z 影响。
 *
 * ⚠️ 同族隐患:`HandlesOverlay` 也是设在 Group 上(第 114 行)。它没暴露是因为
 * handle 长在 bbox 边缘、离连线远;**别照抄那处写法**。
 */
const ACTION_RENDER_ORDER = 20;

/** 每帧提供「当前该画哪些操作点」(已解析到世界坐标);由 Host 注入 */
export type MagnetActionProvider = () => ResolvedMagnetAction[];

export class MagnetActionsOverlay {
  private root: THREE.Group;
  private provider: MagnetActionProvider | null = null;
  /** 当前帧解析结果(hitTest 由 InteractionController 走纯函数消费,这里只做缓存出口)*/
  private current: ResolvedMagnetAction[] = [];
  /** mesh 池:数量随操作点数变,按 icon 重建记号 */
  private pool: Array<{ group: THREE.Group; icon: MagnetActionIcon | null }> = [];
  private rafTick: number | null = null;
  private disposed = false;

  constructor(private sceneManager: SceneManager) {
    this.root = new THREE.Group();
    // ⚠️ 不在 root Group 上设 renderOrder —— 不继承给子 mesh,设了等于没设。
    //    真正生效的是每个 mesh 自己的 ACTION_RENDER_ORDER(见常量注释)。
    sceneManager.scene.add(this.root);
    this.startSyncLoop();
  }

  /** 注入 provider(传 null 停画);⭐ 不给 provider = 一个操作点都不画 */
  setProvider(fn: MagnetActionProvider | null): void {
    this.provider = fn;
    if (!fn) {
      this.current = [];
      this.layout();
    }
  }

  /** 当前帧的操作点(InteractionController 拿去喂 hitTestMagnetAction)*/
  getResolved(): ResolvedMagnetAction[] {
    return this.current;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafTick !== null) cancelAnimationFrame(this.rafTick);
    this.rafTick = null;
    this.sceneManager.scene.remove(this.root);
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) for (const x of m) x.dispose();
      else if (m) (m as THREE.Material).dispose();
    });
    this.pool = [];
    this.current = [];
    this.provider = null;
  }

  // ─────────────────────────────────────────────────────────
  // 内部
  // ─────────────────────────────────────────────────────────

  /** 常驻 RAF:节点拖动 / zoom 变 / 折叠态变 都要重布(⚠️ dispose 里必须停,见铁律)*/
  private startSyncLoop(): void {
    const tick = (): void => {
      if (this.disposed) return;
      this.current = this.provider?.() ?? [];
      this.layout();
      this.rafTick = requestAnimationFrame(tick);
    };
    this.rafTick = requestAnimationFrame(tick);
  }

  private layout(): void {
    const view = this.sceneManager.getView();
    const inv = view.zoom > 0 ? 1 / view.zoom : 0;

    // 池按需扩容
    while (this.pool.length < this.current.length) {
      const group = new THREE.Group();
      this.root.add(group);
      this.pool.push({ group, icon: null });
    }

    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      const action = this.current[i];
      if (!action || inv === 0) {
        slot.group.visible = false;
        continue;
      }
      // icon 变了才重建记号(避免每帧丢弃几何)
      if (slot.icon !== action.icon) {
        rebuildActionMesh(slot.group, action.icon);
        slot.icon = action.icon;
      }
      slot.group.position.set(action.x, action.y, Z_ACTION);
      // ⭐ 像素恒定:顶点按屏幕像素构造,scale=1/zoom 抵消 zoom
      slot.group.scale.set(inv, inv, 1);
      slot.group.visible = true;
    }
  }
}

/** 重建一个操作点的 mesh:外圆边框 + 内圆底 + 记号(顶点单位 = 屏幕像素) */
function rebuildActionMesh(group: THREE.Group, icon: MagnetActionIcon): void {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }

  // ⚠️ 三层自身也要分先后(边框 < 底 < 记号),否则圆内部会自己盖自己。
  //    同样只能靠 renderOrder —— depthTest 关了之后 Z 不再参与排序。
  const border = addLayer(
    group,
    new THREE.CircleGeometry(MAGNET_ACTION_RADIUS_PX + ACTION_BORDER_PX, 24),
    ACTION_BORDER,
    0,
  );
  border.position.z = -0.002;

  const fill = addLayer(
    group,
    new THREE.CircleGeometry(MAGNET_ACTION_RADIUS_PX, 24),
    ACTION_FILL,
    1,
  );
  fill.position.z = -0.001;

  // ⭐ 记号画几何(横/竖线段),不用文字 —— 见文件头注释
  if (icon === 'dot') {
    addLayer(group, new THREE.CircleGeometry(DOT_RADIUS_PX, 16), ACTION_GLYPH, 2);
    return;
  }
  // 横线(minus / plus 共用)
  addLayer(
    group,
    new THREE.PlaneGeometry(GLYPH_HALF_PX * 2, GLYPH_THICK_PX),
    ACTION_GLYPH,
    2,
  );
  if (icon === 'plus') {
    addLayer(
      group,
      new THREE.PlaneGeometry(GLYPH_THICK_PX, GLYPH_HALF_PX * 2),
      ACTION_GLYPH,
      2,
    );
  }
}

/**
 * 加一层 mesh:统一 `depthTest:false` + **逐 mesh** renderOrder。
 *
 * ⚠️ 这两项是「操作点不被连线糊住」的**唯一**生效点,别挪回 Group 上,
 * 也别去掉 depthTest:false —— 线本身就是 depthTest:false,只比 renderOrder。
 */
function addLayer(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  color: number,
  layer: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false }),
  );
  mesh.renderOrder = ACTION_RENDER_ORDER + layer;
  group.add(mesh);
  return mesh;
}

function disposeObject(obj: THREE.Object3D): void {
  const mesh = obj as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const m = mesh.material;
  if (Array.isArray(m)) for (const x of m) x.dispose();
  else if (m) (m as THREE.Material).dispose();
}
