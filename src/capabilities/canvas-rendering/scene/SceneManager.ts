import * as THREE from 'three';

/**
 * SceneManager — Three.js 底座(Freeform 风格无界画板)
 *
 * 职责:
 * - 创建 scene + 正交相机 + WebGLRenderer
 * - 处理容器 resize(ResizeObserver)
 * - 处理 Retina(setPixelRatio + setSize 第三参 true)
 * - RAF 渲染循环
 * - fitToBox / fitToContent
 * - dispose
 *
 * **不**做:节点渲染管线、交互、UI。
 *
 * 坐标系约定(对齐 Freeform / Figma / draw.io 标准做法):
 * - X 向右,Y **向下**(对齐 SVG / Canvas 习惯),Z 朝外(正交相机看 -Z)
 * - **世界坐标 = 画板坐标系,无界(可任意 zoom + pan)**
 * - shape mesh.position 是其在画板上的世界坐标(与 container 大小完全无关)
 *
 * 视口模型:
 * - viewCenter:世界坐标里"屏幕中心对应的世界点"(pan 改这个)
 * - zoom:无量纲缩放因子(zoom>1 放大,zoom<1 缩小)
 * - 视口宽 = clientWidth / zoom(实时由 zoom 派生,容器 resize 时自动跟随)
 *
 * 关键不变量:**1 个 zoom=1 单位的世界距离 = 1 个 CSS 像素**。这让 shape 数据
 * 里写 `size: { w: 160, h: 100 }` 在 zoom=1 时显示正好 160×100 CSS 像素,
 * 与画板大小无关。
 */
export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;

  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  private rafHandle: number | null = null;
  private disposed = false;
  /** view 变化(zoom / pan / resize)订阅 — DotGrid 等浮层同步用 */
  private viewChangeListeners = new Set<() => void>();
  /** F-1 点阵网格底 */
  private dotGrid: import('./DotGrid').DotGrid | null = null;

  /** 屏幕中心对应的世界坐标点 */
  private viewCenter = { x: 0, y: 0 };
  /** 无量纲缩放因子(1 = "1 世界单位 = 1 CSS 像素") */
  private zoom = 1;
  /** 是否已经初始化过 viewCenter(首次 resize 时根据容器尺寸定位) */
  private inited = false;

  constructor(container: HTMLElement) {
    if (!container) {
      throw new Error('[SceneManager] container is required');
    }
    this.container = container;

    this.scene = new THREE.Scene();
    // Three.js scene 不能直接吃 CSS var,这里用 token 同源色值(--krig-bg-base);
    // v1.x 优化方向:启动时 getComputedStyle 读 token 同步给 scene
    this.scene.background = new THREE.Color('#1e1e1e');

    // 正交相机(2D 画板专用)。frustum 由 applyCamera 实时计算
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.camera.position.z = 10;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(this.renderer.domElement);

    // ResizeObserver:容器变了同步 renderer + camera;**zoom 不变**,frustum
    // 自动按新 clientWidth/zoom 算
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    // 立刻处理一次 resize(初始尺寸)
    this.handleResize();

    // F-1 点阵网格底(lazy import 避免循环依赖)
    void import('./DotGrid').then(({ DotGrid }) => {
      if (this.disposed) return;
      this.dotGrid = new DotGrid(this);
    });

    // 起 RAF
    this.startRAF();
  }

  // ─────────────────────────────────────────────────────────
  // resize / camera
  // ─────────────────────────────────────────────────────────

  private handleResize(): void {
    if (this.disposed) return;
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    // ⚠️ 第三参数必须 true,否则 Retina canvas DOM 撑成 2 倍 CSS 像素超出容器
    this.renderer.setSize(clientWidth, clientHeight, true);

    // 首次 init:viewCenter 设为容器中心(世界坐标 = 容器中心 CSS 像素位置)
    // 这样 shape 数据里的 (0,0) 在容器左上角,自然布局
    if (!this.inited) {
      this.viewCenter = { x: clientWidth / 2, y: clientHeight / 2 };
      this.inited = true;
    }
    // 后续 resize:zoom 不变,viewCenter 不变。frustum 在 applyCamera 里实时
    // 用 clientWidth/zoom 算,自动跟随容器尺寸
    this.applyCamera();
  }

  /** 把 viewCenter / zoom 应用到 camera frustum
   *
   * Y 向下约定的实现:**camera.top 数值 < camera.bottom 数值**(直接传"颠倒"
   * 的 frustum),camera.up 用默认 (0,1,0)。Three.js OrthographicCamera 接受
   * 这种配置,投影矩阵会自动 Y 翻转 — 画板 world Y 增大显示在屏幕下方,与
   * worldToScreen 公式 `screen.y = container/2 + (world.y - center.y) * zoom`
   * 一致。
   *
   * 注意:不能再设 camera.up=(0,-1,0),否则会和 frustum 翻转叠加 → Y 不翻转。
   * 之前各种叠加都没对齐,这次统一只用 frustum 翻转。
   */
  private applyCamera(): void {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;

    // 视口宽高(世界坐标)= 容器像素 / zoom
    const halfW = clientWidth / this.zoom / 2;
    const halfH = clientHeight / this.zoom / 2;
    this.camera.left = this.viewCenter.x - halfW;
    this.camera.right = this.viewCenter.x + halfW;
    // Y 向下:top 数值 < bottom 数值。用默认 camera.up=(0,1,0)(不另设)
    this.camera.top = this.viewCenter.y - halfH;
    this.camera.bottom = this.viewCenter.y + halfH;
    this.camera.position.x = this.viewCenter.x;
    this.camera.position.y = this.viewCenter.y;
    this.camera.position.z = 10;
    // up 用默认 (0,1,0)— frustum 内置 top<bottom 已经反转 Y
    this.camera.lookAt(this.viewCenter.x, this.viewCenter.y, 0);
    this.camera.updateProjectionMatrix();
    // 通知订阅者(DotGrid 跟随同步)
    for (const cb of this.viewChangeListeners) {
      try { cb(); } catch (e) { console.error('[SceneManager.onViewChange] listener error', e); }
    }
  }

  /** 订阅 view 变化(zoom / pan / resize),返回取消订阅函数 */
  onViewChange(cb: () => void): () => void {
    this.viewChangeListeners.add(cb);
    return () => { this.viewChangeListeners.delete(cb); };
  }

  /**
   * 把 camera 视口适配到 [box.minX..maxX] × [box.minY..maxY] 范围,加 padding
   *
   * ⚠️ NaN 防御:setFromObject(scene) 含退化几何时返回 NaN box,4 分量 isFinite
   * 检查不过则跳过。
   */
  fitToBox(box: { minX: number; minY: number; maxX: number; maxY: number }, padding = 0.1): boolean {
    if (
      !Number.isFinite(box.minX) || !Number.isFinite(box.minY) ||
      !Number.isFinite(box.maxX) || !Number.isFinite(box.maxY)
    ) {
      console.warn('[SceneManager] fitToBox skipped: non-finite box', box);
      return false;
    }
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    if (w <= 0 || h <= 0) {
      console.warn('[SceneManager] fitToBox skipped: zero/negative size', box);
      return false;
    }
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return false;

    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const padW = w * (1 + padding);
    const padH = h * (1 + padding);
    // letterbox:取较小的 zoom(让 padW 和 padH 都能装进容器)
    const zoomX = clientWidth / padW;
    const zoomY = clientHeight / padH;
    const zoom = Math.min(zoomX, zoomY);

    this.viewCenter = { x: cx, y: cy };
    this.zoom = zoom;
    this.applyCamera();
    return true;
  }

  /** 用 scene 的 bounding box 触发 fitToBox(便利方法) */
  fitToContent(padding = 0.1): boolean {
    const box = new THREE.Box3();
    box.setFromObject(this.scene);
    return this.fitToBox(
      { minX: box.min.x, minY: box.min.y, maxX: box.max.x, maxY: box.max.y },
      padding,
    );
  }

  /** 直接设视口(用于 pan / zoom 控制 + 反序列化恢复视图) */
  setView(centerX: number, centerY: number, zoom: number): void {
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(zoom) || zoom <= 0) {
      console.warn('[SceneManager] setView ignored:', { centerX, centerY, zoom });
      return;
    }
    this.viewCenter = { x: centerX, y: centerY };
    this.zoom = zoom;
    this.inited = true;
    this.applyCamera();
  }

  /** 当前视图状态(给序列化 / Toolbar zoom 显示) */
  getView(): { centerX: number; centerY: number; zoom: number } {
    return {
      centerX: this.viewCenter.x,
      centerY: this.viewCenter.y,
      zoom: this.zoom,
    };
  }

  // ─────────────────────────────────────────────────────────
  // 屏幕 ↔ 世界坐标互转(交互模块要用)
  // ─────────────────────────────────────────────────────────

  /** 容器内 CSS 像素坐标 → 世界坐标 */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return { x: 0, y: 0 };
    return {
      x: this.viewCenter.x + (screenX - clientWidth / 2) / this.zoom,
      y: this.viewCenter.y + (screenY - clientHeight / 2) / this.zoom,
    };
  }

  /** 世界坐标 → 容器内 CSS 像素坐标 */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const { clientWidth, clientHeight } = this.container;
    return {
      x: clientWidth / 2 + (worldX - this.viewCenter.x) * this.zoom,
      y: clientHeight / 2 + (worldY - this.viewCenter.y) * this.zoom,
    };
  }

  // ─────────────────────────────────────────────────────────
  // RAF
  // ─────────────────────────────────────────────────────────

  /**
   * 把 Object3D 投影到屏幕,返回容器内 CSS 像素 AABB.
   *
   * 与 renderer.render 共享投影矩阵 — 用 Three.js 自己的 Vector3.project,
   * 保证返回的 AABB 与 mesh 真实视觉位置一致.
   *
   * 用法:CanvasView 算 EditOverlay popup 位置 + 未来 HandlesOverlay 算
   * handle 屏幕位置 + Toolbar 浮条跟随节点 等等.
   *
   * @param obj — 要投影的 Object3D(取它的世界 bbox)
   * @param tempVisible — 若 obj.visible=false,临时显示来算 bbox 然后恢复
   * @returns 容器内 CSS 像素 AABB({ minX, minY, maxX, maxY }),宽 = max-min
   */
  projectMeshToScreenAABB(
    obj: THREE.Object3D,
    tempVisible = true,
  ): { minX: number; minY: number; maxX: number; maxY: number } {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    let restoredVisible: boolean | null = null;
    if (tempVisible && !obj.visible) {
      restoredVisible = obj.visible;
      obj.visible = true;
    }
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (restoredVisible !== null) obj.visible = restoredVisible;

    const corners = [
      new THREE.Vector3(box.min.x, box.min.y, 0),
      new THREE.Vector3(box.max.x, box.min.y, 0),
      new THREE.Vector3(box.min.x, box.max.y, 0),
      new THREE.Vector3(box.max.x, box.max.y, 0),
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
      c.project(this.camera);
      // NDC[-1,1] → 容器内 CSS 像素;NDC y 朝上,屏幕 y 朝下
      const sx = (c.x + 1) / 2 * clientWidth;
      const sy = (1 - c.y) / 2 * clientHeight;
      if (sx < minX) minX = sx;
      if (sy < minY) minY = sy;
      if (sx > maxX) maxX = sx;
      if (sy > maxY) maxY = sy;
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * 屏幕 CSS 像素 → NDC[-1,1]Vector2.Three.js Raycaster.setFromCamera 用.
   * 抽出来给 InteractionController.hitTest / raycastLinkHref 共用.
   */
  screenToNDC(screenX: number, screenY: number, ndcOut: THREE.Vector2): boolean {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth <= 0 || clientHeight <= 0) return false;
    ndcOut.x = (screenX / clientWidth) * 2 - 1;
    ndcOut.y = -(screenY / clientHeight) * 2 + 1;
    return true;
  }

  private startRAF(): void {
    const tick = () => {
      if (this.disposed) return;
      this.renderer.render(this.scene, this.camera);
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  // ─────────────────────────────────────────────────────────
  // dispose
  // ─────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.resizeObserver.disconnect();
    this.viewChangeListeners.clear();
    this.dotGrid?.dispose();
    this.dotGrid = null;
    // 清理 scene 上的 geometry / material / textures
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else if (material) {
        material.dispose();
      }
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
