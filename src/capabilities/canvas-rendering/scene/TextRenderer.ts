import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { atomsToSvgWithLinks, type Atom, type LinkRect, type IconRect } from '../../../lib/atom-serializers/svg';
import type { FontFamily } from '../../../lib/atom-serializers/svg/font-loader';
import { extractPlainText } from '../../../lib/atom-serializers/extract';
import { LruCache } from '../../../lib/atom-serializers/lru';
import { rasterizeIcon } from './icon-raster';

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
    /** L5-G5 Type section:基准字号(instance.text_size 透传);不传 = spec 正文 16(L5 一致性 E3,原 14)*/
    baseFontSize?: number;
    /** L5-G5 Type section:字体族(instance.text_font 透传);不传 = 自动选字 */
    fontFamily?: FontFamily;
  } = {}): Promise<THREE.Object3D> {
    let svgString: string;
    let links: LinkRect[] = [];
    let icons: IconRect[] = [];
    // 注:code 块语法高亮 token 由调用方(NodeRenderer)在 atom.attrs._syntaxTokens 预注入
    // (W5:atom-serializers 不依赖 code-editing;tokenize 在能用 capability 的层做)。
    try {
      const out = await atomsToSvgWithLinks(atoms, {
        width: options.width,
        defaultTextColor: options.defaultTextColor,
        valign: options.valign,
        targetHeight: options.targetHeight,
        baseFontSize: options.baseFontSize,
        fontFamily: options.fontFamily,
        // 画板 code 块:自动换行(长行不裁)。背景保持不透明 #2a2a2a 对齐 note —— 半透明
        // 实测(2026-06-23 真机)透出彩色 shape 致代码字对比度低、糊,撤回不透明。
        codeWrap: true,
      });
      svgString = out.svg;
      links = out.links;
      icons = out.icons;
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

    // L5-G6c:callout 图标纹理 quad(emoji/lucide/上传图栅格成 canvas → CanvasTexture)。
    // 渲染链 SVGLoader 渲不出 emoji/位图/stroke,故图标走纹理路,定位到 IconRect bbox。
    for (const ic of icons) {
      const canvas = await rasterizeIcon(
        { emoji: ic.emoji, iconName: ic.iconName, imageSrc: ic.imageSrc },
        Math.max(8, Math.round(ic.w)),
      );
      if (!canvas) continue; // 栅格失败 → 跳过(fail loud 已在 rasterizeIcon warn)
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter; // 非 2 次幂 canvas:线性,免 mipmap 警告
      const geom = new THREE.PlaneGeometry(ic.w, ic.h);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(ic.x + ic.w / 2, ic.y + ic.h / 2, 0.01);
      // 抵消下方 group.scale.y=-1(否则纹理上下颠倒);local 翻一次 → 正立
      mesh.scale.y = -1;
      mesh.userData.isCalloutIcon = true;
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

      // fill-opacity 支持(callout 半透明白底等):THREE.Color 丢 alpha,SVGLoader 把
      // fill-opacity 单独解析到 style.fillOpacity。读它设 material transparent/opacity,
      // 否则 rgba(...,0.04) 会退化成纯不透明色(实机 callout 白底刺眼根因)。
      const fillOpacityRaw = path.userData?.style?.fillOpacity;
      const fillOpacity = typeof fillOpacityRaw === 'number'
        ? fillOpacityRaw
        : (typeof fillOpacityRaw === 'string' && fillOpacityRaw !== '' ? parseFloat(fillOpacityRaw) : 1);
      const opacity = Number.isFinite(fillOpacity) ? Math.max(0, Math.min(1, fillOpacity)) : 1;

      const material = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthWrite: false,
        transparent: opacity < 1,
        opacity,
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
