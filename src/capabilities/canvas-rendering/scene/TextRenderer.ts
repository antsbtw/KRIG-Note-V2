import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { atomsToSvgWithLinks, type Atom, type LinkRect } from '../../../lib/atom-serializers/svg';
import type { FontFamily } from '../../../lib/atom-serializers/svg/font-loader';
import { extractPlainText } from '../../../lib/atom-serializers/extract';
import { LruCache } from '../../../lib/atom-serializers/lru';

/**
 * TextRenderer — 文字节点 SVG → Three.js Mesh 渲染器(L5-G4.5 P2)
 *
 * V1 直迁(src/plugins/graph/canvas/scene/TextRenderer.ts:197 行),无算法改动.
 * V2 改动仅 import 路径:
 * - V1 ../../../../lib/atom-serializers/svg → V2 ../../../lib/atom-serializers/svg
 *   (V1 depth 4 vs V2 depth 3)
 *
 * 三级缓存(spec Canvas-M2.1-TextNode-Spec.md §3.1):
 *  - L1(atomsToSvg 内部):atoms hash → SVG 字符串(LRU 1000)
 *  - L2(本类静态字段):SVG 字符串 → ShapeGeometry[] + Material(LRU 500,共享)
 *  - L3:Mesh 不缓存,每次新建(共享 L2 的 geom/mat 引用)
 *
 * 错误处理:atomsToSvg reject 时回退到 fallbackSvg(extractPlainText 兜底矩形)
 */

const DEFAULT_FILL = 0xdddddd;

interface CachedGeometryUnit {
  geometries: THREE.ShapeGeometry[];
  material: THREE.MeshBasicMaterial;
}
type CachedGeometry = CachedGeometryUnit[];

export class TextRenderer {
  private loader = new SVGLoader();

  /** L2 GeometryCache:跨 TextRenderer 实例共享(canvas / 未来 graph variant 都用同一份) */
  private static GEOMETRY_CACHE = new LruCache<string, CachedGeometry>(500);

  static getGeometryCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
    return {
      size: this.GEOMETRY_CACHE.size,
      hits: this.GEOMETRY_CACHE.hits,
      misses: this.GEOMETRY_CACHE.misses,
      hitRate: this.GEOMETRY_CACHE.hitRate(),
    };
  }

  static clearGeometryCache(): void {
    for (const cached of this.GEOMETRY_CACHE.values()) {
      for (const unit of cached) {
        for (const g of unit.geometries) g.dispose();
        unit.material.dispose();
      }
    }
    this.GEOMETRY_CACHE.clear();
  }

  /**
   * Atom[] → Three.js Group(只读 mesh)
   *
   * atoms 形态 = 序列化器同源 PM JSON(`{ type, content?, attrs?, marks?, text? }`),
   * 不是 NoteView 持久化态 Atom(`{ id, type, parentId, ... }`)
   * 调用方需先做 NoteView Atom → PM JSON 转换(走 atom-bridge.atomsToSvgInput).
   *
   * width:画板节点 instance.size.w,SVG 内部按此 wrap;不传时用默认 200
   */
  async render(atoms: Atom[], options: {
    width?: number;
    defaultTextColor?: string;
    valign?: 'top' | 'middle' | 'bottom';
    targetHeight?: number;
    /** L5-G5 Type section:基准字号(instance.text_size 透传);不传 = 默认 14 */
    baseFontSize?: number;
    /** L5-G5 Type section:字体族(instance.text_font 透传);不传 = 自动选字 */
    fontFamily?: FontFamily;
  } = {}): Promise<THREE.Object3D> {
    let svgString: string;
    let links: LinkRect[] = [];
    try {
      const out = await atomsToSvgWithLinks(atoms, {
        width: options.width,
        defaultTextColor: options.defaultTextColor,
        valign: options.valign,
        targetHeight: options.targetHeight,
        baseFontSize: options.baseFontSize,
        fontFamily: options.fontFamily,
      });
      svgString = out.svg;
      links = out.links;
    } catch (e) {
      console.warn('[TextRenderer] atomsToSvg failed, falling back', e);
      svgString = this.fallbackSvg(atoms);
    }

    const cached = this.getOrParseGeometry(svgString);

    const group = new THREE.Group();
    for (const unit of cached) {
      for (const g of unit.geometries) {
        const mesh = new THREE.Mesh(g, unit.material);
        // 标记 mesh 持有的 geometry/material 是 L2 缓存共享引用,
        // NodeRenderer.disposeGroup 必须跳过它们(否则 dispose 后 L2 缓存里
        // 其他 mesh 也会变空白)
        mesh.userData.sharedAsset = true;
        group.add(mesh);
      }
    }

    // F-6: link hit-rect 透明 mesh — 给 InteractionController raycast 命中走链接路由.
    // 不共享 geometry/material(每段 link 尺寸不同,且 userData.linkHref 是实例属性),
    // disposeGroup 正常释放即可(没有 sharedAsset 标记).
    for (const r of links) {
      const geom = new THREE.PlaneGeometry(r.w, r.h);
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      // PlaneGeometry 中心在 (0,0),平移到 link bbox 中心
      mesh.position.set(r.x + r.w / 2, r.y + r.h / 2, 0.005);
      mesh.userData.linkHref = r.href;
      mesh.userData.isLinkHit = true;
      group.add(mesh);
    }

    // SVG y 轴向下,Three.js y 轴向上 — 翻转
    // (canvas 里 SceneManager 已通过 frustum top<bottom 实现 Y 翻转,这里 y=-1 抵消)
    group.scale.y = -1;
    return group;
  }

  /** L2 缓存查找 / 回填 */
  private getOrParseGeometry(svgString: string): CachedGeometry {
    const cached = TextRenderer.GEOMETRY_CACHE.get(svgString);
    if (cached) return cached;

    const data = this.loader.parse(svgString);
    const units: CachedGeometryUnit[] = [];

    for (const path of data.paths) {
      const fillColor = path.userData?.style?.fill;
      if (fillColor === 'none') continue;

      const color =
        fillColor && fillColor !== 'currentColor'
          ? new THREE.Color().setStyle(fillColor)
          : new THREE.Color(DEFAULT_FILL);

      const material = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const shapes = SVGLoader.createShapes(path);
      const geometries: THREE.ShapeGeometry[] = [];
      for (const shape of shapes) {
        const g = new THREE.ShapeGeometry(shape);
        // NaN 防御(对齐 feedback_fitcontent_nan_defense):退化几何 bbox 含 NaN
        // 会让 frustum NaN 黑屏,跳过该 unit
        g.computeBoundingBox();
        const b = g.boundingBox;
        if (
          !b ||
          !Number.isFinite(b.min.x) || !Number.isFinite(b.min.y) ||
          !Number.isFinite(b.max.x) || !Number.isFinite(b.max.y)
        ) {
          g.dispose();
          continue;
        }
        geometries.push(g);
      }
      if (geometries.length > 0) {
        units.push({ geometries, material });
      } else {
        material.dispose();
      }
    }

    TextRenderer.GEOMETRY_CACHE.set(svgString, units);
    return units;
  }

  /** 取 mesh 的 bbox(world Box3,调用方可基于此设节点 size) */
  getBBox(rendered: THREE.Object3D): THREE.Box3 {
    return new THREE.Box3().setFromObject(rendered);
  }

  /**
   * dispose 时只摘 rendered 自身,不 dispose geometry / material
   * (它们由 L2 缓存共享管理,LRU 淘汰时统一释放)
   */
  dispose(rendered: THREE.Object3D): void {
    rendered.parent?.remove(rendered);
  }

  /** atomsToSvg reject 兜底:纯文字提取 + 简单矩形 */
  private fallbackSvg(atoms: Atom[]): string {
    const text = extractPlainText(atoms as never) || '...';
    const w = Math.max(text.length * 8, 20);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 20" width="${w}" height="20"><path d="M 0 4 h ${w} v 12 h -${w} Z" fill="#cccccc" /></svg>`;
  }
}
