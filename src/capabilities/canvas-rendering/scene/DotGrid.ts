import * as THREE from 'three';
import type { SceneManager } from './SceneManager';

/**
 * DotGrid — 点阵网格底(F-1)
 *
 * 视觉对齐 Freeform / Figma:深底上浅色小点阵,提供视觉锚点 + 对齐参考.
 *
 * 实现:
 * - 全屏 plane(单位 1×1,sync 时按视口 ×1.5 缩放;不用 1e5 巨型 plane 避免
 *   Three.js 浮点精度副作用)
 * - ShaderMaterial:fragment shader 用 modelMatrix 算每个像素的世界坐标,
 *   按 SPACING 取模找最近格点,smoothstep 抗锯齿(uAA 由 JS 端按 zoom 算)
 * - DoubleSide:Y-flip frustum(top<bottom)下 plane 法向可能朝相机背后,加
 *   DoubleSide 兜底
 * - renderOrder = -100:最先画,在所有节点之下
 * - userData.isDotGrid=true:Raycaster 等扫 scene 时跳过此 plane
 *   (避免 hit-test 误命中 / setFromObject(scene) 把 plane 算进 bbox)
 * - zoom 自适应 alpha:zoom < 0.2 完全消失(避免点糊一团);0.2~0.5 渐淡
 *
 * 同步:SceneManager.onViewChange 订阅(F-11 添加的契约),zoom/pan/resize
 * 时立即重算 plane scale + alpha;不用 RAF 轮询.
 */

const SPACING = 48;          // 点间距(世界坐标)
const DOT_RADIUS = 1.4;      // 点半径(世界坐标)
const DOT_COLOR = new THREE.Color('#888888');
const Z_LAYER = -9.5;        // 最底层 z

const VERT_SHADER = `
varying vec2 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xy;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAG_SHADER = `
varying vec2 vWorldPos;
uniform float uSpacing;
uniform float uDotRadius;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uAA;

void main() {
  vec2 cell = mod(vWorldPos, uSpacing);
  cell -= uSpacing * 0.5;
  float dist = length(cell);
  float a = uAlpha * (1.0 - smoothstep(uDotRadius - uAA, uDotRadius + uAA, dist));
  if (a < 0.001) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export class DotGrid {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private unsubViewChange: (() => void) | null = null;

  constructor(private sceneManager: SceneManager) {
    const geom = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      uniforms: {
        uSpacing: { value: SPACING },
        uDotRadius: { value: DOT_RADIUS },
        uColor: { value: DOT_COLOR },
        uAlpha: { value: 1.0 },
        uAA: { value: 0.5 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.position.z = Z_LAYER;
    this.mesh.renderOrder = -100;
    // 关键:让 raycaster 跳过 — hit-test / setFromObject 都该忽略这个底
    // (F-1 上一版踩坑:1e5 巨型 plane 影响 setFromObject 的 bbox 计算)
    this.mesh.userData.isDotGrid = true;
    // raycast 设为 noop,任何 raycast 都不会命中此 mesh
    this.mesh.raycast = () => { /* no-op:dot grid 永远不命中 */ };

    sceneManager.scene.add(this.mesh);

    this.unsubViewChange = sceneManager.onViewChange(() => this.sync());
    this.sync();
  }

  /** 同步 plane 位置 / 缩放 / alpha 到当前 view */
  private sync(): void {
    const view = this.sceneManager.getView();
    this.mesh.position.x = view.centerX;
    this.mesh.position.y = view.centerY;

    // plane scale 按视口世界尺寸 × 1.5(留缓冲)
    const cam = this.sceneManager.camera;
    const wWorld = Math.abs(cam.right - cam.left);
    const hWorld = Math.abs(cam.bottom - cam.top);
    const buffer = 1.5;
    this.mesh.scale.set(wWorld * buffer, hWorld * buffer, 1);

    // zoom 自适应 alpha
    const z = view.zoom;
    let alpha: number;
    if (z >= 0.5) alpha = 1.0;
    else if (z <= 0.2) alpha = 0;
    else alpha = (z - 0.2) / 0.3;
    this.material.uniforms.uAlpha.value = alpha;

    // 抗锯齿半径:1 屏幕像素 ≈ 1/zoom 世界单位
    this.material.uniforms.uAA.value = 0.5 / Math.max(z, 0.01);
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  dispose(): void {
    if (this.unsubViewChange) {
      this.unsubViewChange();
      this.unsubViewChange = null;
    }
    this.sceneManager.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
