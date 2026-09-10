import * as THREE from 'three';
import type { SceneManager } from './SceneManager';
import {
  labelFor,
  radiusFor,
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
 * - ⭐ **数字是唯一例外**(圆内计数):走 `canvas fillText → CanvasTexture`,
 *   ⚠️ 用的是**系统字体**,不是那套打包字体,所以不受上面那条字形缺失影响
 *   (同款做法:callout 的 icon-raster、TextRenderer 的 CanvasTexture)。
 *   ⚠️ 别把它改成矢量文字层 —— 那就踩回 `⊕` 那个坑了。
 *
 * ⚠️ 节点 rotation 不参与:操作点是圆 + 轴对齐的 +/- 记号,跟着转没有意义,
 * 位置本身已由 listMagnets 处理过 rotation。
 */

const ACTION_FILL = 0xffffff;         // 内圆白
const ACTION_BORDER = 0x4A90E2;       // 边框蓝(与选中色同族)
const ACTION_GLYPH = 0x2E5C8A;        // 记号深蓝
const ACTION_BORDER_PX = 1.2;         // 边框宽度(像素)

/**
 * ⭐ 呼吸区外环:圆最外面再套一圈**与画布同色**的环,视觉上是「留白」。
 *
 * ⚠️ 解决的问题:画布背景网格点(DotGrid,世界坐标、到处都是)会**恰好落在圆旁边**,
 *   看着像圆上黏了个脏点(真机踩过)。
 * ⭐ 为什么不靠「把圆画成不透明」—— 圆本来就是不透明的;
 *   那个网格点在**圆外面**,不在覆盖范围内,再不透明也盖不住。
 * ⭐ 为什么不针对那一个点修 —— 它随平移/缩放就挪走了,是巧合不是稳定现象。
 *   外环是**通用解**:操作点在任何背景上都有干净边界。
 *
 * ⚠️ 必须与 SceneManager 的 `scene.background` 同色,否则外环会显形。
 *   两处都写死 '#1e1e1e';改背景色时**必须同步改这里**(已由守卫钉住)。
 */
const ACTION_HALO = 0x1e1e1e;         // = SceneManager scene.background
const ACTION_HALO_PX = 3.5;           // 外环宽度(像素)
const GLYPH_HALF_PX = 3;              // 记号半长(像素)
const GLYPH_THICK_PX = 1.4;           // 记号线宽(像素)
const DOT_RADIUS_PX = 2;              // 'dot' 图标的实心点半径(像素)

/**
 * ⭐ 数字纹理的**超采样倍数** —— 圆只有十几像素,1:1 画出来的数字发糊,
 * 且用户可以放大画布看(那时纹理会被拉伸)。4× 是清晰度/显存的折中。
 */
const COUNT_TEXTURE_SCALE = 4;

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
  /**
   * mesh 池:数量随操作点数变,按 **icon + 圆内数字** 重建记号。
   * ⚠️ key 必须含数字 —— 只比 icon 的话,分支数从 3 变 5 会**留着旧纹理**
   * (icon 没变 → 不重建),用户看到的是过期计数。
   */
  private pool: Array<{ group: THREE.Group; icon: MagnetActionIcon | null; label: string }> = [];
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
    this.root.traverse((obj) => disposeObject(obj));
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
      this.pool.push({ group, icon: null, label: '' });
    }

    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      const action = this.current[i];
      if (!action || inv === 0) {
        slot.group.visible = false;
        continue;
      }
      // icon 或数字变了才重建(避免每帧丢弃几何 / 重造纹理)
      const label = labelFor(action);
      if (slot.icon !== action.icon || slot.label !== label) {
        rebuildActionMesh(slot.group, action.icon, label, radiusFor(action));
        slot.icon = action.icon;
        slot.label = label;
      }
      slot.group.position.set(action.x, action.y, Z_ACTION);
      // ⭐ 像素恒定:顶点按屏幕像素构造,scale=1/zoom 抵消 zoom
      slot.group.scale.set(inv, inv, 1);
      slot.group.visible = true;
    }
  }
}

/**
 * 重建一个操作点的 mesh:外圆边框 + 内圆底 + 记号(顶点单位 = 屏幕像素)。
 *
 * @param label 圆内数字;空串 = 画 icon 记号(+/-/·),非空 = **数字取代记号**
 * @param radius 内圆半径(带数字时会比基准半径大,见 radiusFor)
 */
function rebuildActionMesh(
  group: THREE.Group,
  icon: MagnetActionIcon,
  label: string,
  radius: number,
): void {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }

  // ⚠️ 各层要分先后(外环 < 边框 < 底 < 记号),否则圆内部会自己盖自己。
  //    同样只能靠 renderOrder —— depthTest 关了之后 Z 不再参与排序。

  // ⭐ 呼吸区外环(画布同色)—— 画在最底,把圆周围的背景网格点盖掉
  const halo = addLayer(
    group,
    new THREE.CircleGeometry(radius + ACTION_BORDER_PX + ACTION_HALO_PX, 24),
    ACTION_HALO,
    0,
  );
  halo.position.z = -0.003;

  const border = addLayer(
    group,
    new THREE.CircleGeometry(radius + ACTION_BORDER_PX, 24),
    ACTION_BORDER,
    1,
  );
  border.position.z = -0.002;

  const fill = addLayer(
    group,
    new THREE.CircleGeometry(radius, 24),
    ACTION_FILL,
    2,
  );
  fill.position.z = -0.001;

  // ⭐ 有数字就画数字,**取代** +/- 记号 —— 两者叠在同一个小圆里会糊成一团。
  //    (语义不丢:折叠态才有数字,数字本身就表达「点开有 N 个」。)
  if (label) {
    addCountLabel(group, label, radius);
    return;
  }

  // ⭐ 记号画几何(横/竖线段),不用文字 —— 见文件头注释
  if (icon === 'dot') {
    addLayer(group, new THREE.CircleGeometry(DOT_RADIUS_PX, 16), ACTION_GLYPH, 3);
    return;
  }
  // 横线(minus / plus 共用)
  addLayer(
    group,
    new THREE.PlaneGeometry(GLYPH_HALF_PX * 2, GLYPH_THICK_PX),
    ACTION_GLYPH,
    3,
  );
  if (icon === 'plus') {
    addLayer(
      group,
      new THREE.PlaneGeometry(GLYPH_THICK_PX, GLYPH_HALF_PX * 2),
      ACTION_GLYPH,
      3,
    );
  }
}

/**
 * ⭐ 圆内数字:canvas fillText → CanvasTexture → 贴在一个方片上。
 *
 * ⚠️ 走**系统字体**(`fillText` 用的是浏览器/OS 字体栈),阿拉伯数字必然有字形 ——
 * 这正是它能绕开打包字体字形缺失(`⊕` 空白)的原因。别改成矢量文字层。
 *
 * ⚠️ `document` 在这里是安全的:overlay 只在 renderer 进程构造(three 已经要 WebGL),
 * 纯函数判定层(magnet-actions.ts)刻意不含这段,才能在 node 环境单测。
 */
function addCountLabel(group: THREE.Group, label: string, radius: number): void {
  // ⚠️⚠️ 方片必须**内接于圆**(边长 = 直径/√2),不是「边长 = 直径」——
  //   后者四角伸出圆外 2.5px,数字画到圆边缘甚至外面,看着像一坨黑斑。
  //   (真机踩过:折叠圆里是个糊成一团的黑点,展开态的 +/- 反而干净,
  //    因为只有数字这条路径走方片贴图。)
  const sidePx = Math.ceil((radius * 2) / Math.SQRT2);
  const canvas = document.createElement('canvas');
  canvas.width = sidePx * COUNT_TEXTURE_SCALE;
  canvas.height = sidePx * COUNT_TEXTURE_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // ⚠️ 不静默:拿不到 2d context 说明环境异常,画个记号也不对,直接说出来
    console.warn('[MagnetActionsOverlay] 取不到 2d context,圆内数字画不出');
    return;
  }

  // ⚠️⚠️ 字号是「方片边长的百分比」,**再乘超采样倍数**才是 canvas 内的像素值。
  //   曾经写成 `sidePx * COUNT_TEXTURE_SCALE * 0.62` —— 那是**整张 canvas 的 62%**,
  //   等于把字号连超采样倍数一起放大了 4 倍,墨迹高度 5.4px 塞进半径 6px 的圆,
  //   数字顶满圆边 → 真机看着就是个黑斑,根本读不出是几。
  // ⚠️ 按**位数**收:'99+' 三字符要比单字符小,否则撑出方片。
  // ⚠️ 用户实测反馈 0.62 太小看不清。方片已内接于圆,还有余量 ——
  //   单字符提到 0.82(墨迹约占圆直径 44%),三字符 '99+' 仍收窄避免撑出方片。
  const fontRatio = label.length >= 3 ? 0.52 : 0.82;
  const fontPx = sidePx * fontRatio * COUNT_TEXTURE_SCALE;
  ctx.font = `600 ${fontPx}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillStyle = '#2E5C8A'; // = ACTION_GLYPH,与记号同色
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  // ⚠️⚠️ **必须声明 sRGB,否则数字边缘发黑糊成一坨**(真机踩过两轮,且**与字号无关** ——
  //   这是当初误判成「数字画太大」的原因:改小了字,黑边跟着缩,看着还是黑)。
  //   canvas 2d 画出来的是 sRGB;不声明的话 three 当线性空间处理,
  //   抗锯齿边缘那圈半透明像素被压暗成黑边,小圆里就是一个黑斑。
  // ⭐ 同款做法:TextRenderer 的 callout 图标纹理(scene/TextRenderer.ts:144)。
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter; // ⚠️ 非 2 次幂尺寸,mipmap 会报警且没必要
  texture.magFilter = THREE.LinearFilter;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(sidePx, sidePx),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true, // ⚠️ 少了它数字周围是一圈黑底方块
      depthTest: false,
      depthWrite: false, // 半透明贴图不写深度(对齐 TextRenderer 的图标纹理)
      side: THREE.DoubleSide,
    }),
  );
  mesh.renderOrder = ACTION_RENDER_ORDER + 3; // 与记号同层(记号和数字互斥)

  // ⚠️⚠️ **抵消相机的 Y 翻转,否则数字上下颠倒**(真机踩过:`2` 看着像镜像字符)。
  //
  // SceneManager 用 **top < bottom 的颠倒 frustum** 实现「world Y 向下」
  // (见 applyCamera 注释),投影矩阵因此自带一次 Y 翻转。
  // ⭐ 实测确认过是 **Y 翻、X 不翻**:world(0,0.5) → NDC(0,-0.5),world(0.5,0) → NDC(0.5,0)。
  //
  // ⚠️ 为什么以前没暴露:圆、`+`、`-` 都**上下对称**,翻了看不出来;
  //    数字不对称,一上来就露馅。**别据此以为「以前是对的、现在坏了」。**
  // ⭐ 同款做法:TextRenderer 给 callout 图标也是 `mesh.scale.y = -1`。
  mesh.scale.y = -1;

  group.add(mesh);
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
  if (Array.isArray(m)) for (const x of m) disposeMaterial(x);
  else if (m) disposeMaterial(m as THREE.Material);
}

/**
 * ⚠️ `material.dispose()` **不释放它的贴图** —— 数字用的 CanvasTexture 每次
 * 计数变化都会重造一张,不单独 dispose 就是逐次泄漏显存。
 */
function disposeMaterial(m: THREE.Material): void {
  const map = (m as THREE.MeshBasicMaterial).map;
  if (map) map.dispose();
  m.dispose();
}
