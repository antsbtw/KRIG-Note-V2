/**
 * icon-raster — callout 图标栅格化(L5-G6c:emoji / lucide / 上传图 → canvas)
 *
 * 背景:画板文字层走 SVGLoader 只渲填充矢量,渲不出 emoji 彩色字形 / lucide stroke / 位图。
 * 故 callout 图标改走「栅格成 canvas → THREE 纹理 quad」路(见 TextRenderer)。本模块负责
 * 把三种来源画到一个正方 canvas:
 *  - imageSrc(media:// 上传图,最高优先):fetch → ImageBitmap → drawImage
 *  - iconName(lucide):renderToStaticMarkup 出 SVG 串 → Image(data URL)→ drawImage
 *  - emoji(默认 💡):canvas fillText(系统彩色 emoji 字体)
 *
 * 纯渲染工具(canvas-rendering 内,允许用 DOM/canvas/React);结果按 key 缓存(LRU 简化版 Map)。
 * 失败 → 返 null(调用方 fail loud 降级,不静默崩)。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as LucideIcons from 'lucide-react';

export interface IconSpec {
  emoji?: string;
  iconName?: string;
  imageSrc?: string;
}

const cache = new Map<string, HTMLCanvasElement>();
const CACHE_MAX = 200;

function cacheKey(spec: IconSpec, sizePx: number): string {
  return `${sizePx}|${spec.imageSrc ?? ''}|${spec.iconName ?? ''}|${spec.emoji ?? ''}`;
}

function putCache(key: string, c: HTMLCanvasElement): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, c);
}

/**
 * 栅格化 callout 图标到 sizePx×sizePx 的 canvas(devicePixelRatio 放大保清晰)。
 * 优先级 imageSrc > iconName > emoji(对齐编辑器 NodeView)。失败返 null。
 */
export async function rasterizeIcon(spec: IconSpec, sizePx: number): Promise<HTMLCanvasElement | null> {
  const key = cacheKey(spec, sizePx);
  const hit = cache.get(key);
  if (hit) return hit;

  let canvas: HTMLCanvasElement | null = null;
  try {
    if (spec.imageSrc) canvas = await rasterImage(spec.imageSrc, sizePx);
    else if (spec.iconName) canvas = await rasterLucide(spec.iconName, sizePx);
    else if (spec.emoji) canvas = rasterEmoji(spec.emoji, sizePx);
  } catch (e) {
    console.warn('[icon-raster] 栅格化失败,降级 null', spec, e);
    return null;
  }
  if (canvas) putCache(key, canvas);
  return canvas;
}

/** devicePixelRatio 放大的方 canvas + 居中绘制上下文 */
function makeCanvas(sizePx: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; dpr: number } {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sizePx * dpr);
  canvas.height = Math.round(sizePx * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[icon-raster] 2d context 拿不到');
  ctx.scale(dpr, dpr);
  return { canvas, ctx, dpr };
}

/** emoji → canvas fillText(系统彩色 emoji)。glyph/框比 0.75 对齐编辑器(框 24 / 字 18)*/
function rasterEmoji(emoji: string, sizePx: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(sizePx);
  ctx.font = `${Math.round(sizePx * 0.75)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, sizePx / 2, sizePx / 2 + sizePx * 0.04);
  return canvas;
}

/** lucide iconName(Pascal)→ SVG 串 → Image → drawImage */
async function rasterLucide(iconName: string, sizePx: number): Promise<HTMLCanvasElement | null> {
  const Comp = (LucideIcons as unknown as Record<string, unknown>)[iconName]
    ?? (LucideIcons as unknown as Record<string, unknown>)[`${iconName}Icon`];
  if (!Comp || typeof Comp !== 'object') {
    console.warn(`[icon-raster] 未知 lucide iconName: ${iconName}`);
    return null;
  }
  // lucide 是 stroke 图标 → 给个可见描边色(浅灰,贴近编辑器观感)
  const svg = renderToStaticMarkup(
    createElement(Comp as React.ComponentType<Record<string, unknown>>, {
      size: sizePx,
      color: '#dddddd',
      'aria-hidden': true,
    }),
  );
  return svgStringToCanvas(svg, sizePx);
}

/** imageSrc(media:// 等)→ fetch blob → ImageBitmap → drawImage(等比 contain 居中) */
async function rasterImage(src: string, sizePx: number): Promise<HTMLCanvasElement | null> {
  const res = await fetch(src);
  if (!res.ok) {
    console.warn(`[icon-raster] 上传图 fetch 失败 ${res.status}: ${src}`);
    return null;
  }
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const { canvas, ctx } = makeCanvas(sizePx);
  // contain:等比缩放铺进方框,居中
  const scale = Math.min(sizePx / bmp.width, sizePx / bmp.height);
  const w = bmp.width * scale;
  const h = bmp.height * scale;
  ctx.drawImage(bmp, (sizePx - w) / 2, (sizePx - h) / 2, w, h);
  bmp.close();
  return canvas;
}

/** SVG 字符串 → Image(data URL)→ canvas(异步 onload) */
function svgStringToCanvas(svg: string, sizePx: number): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const { canvas, ctx } = makeCanvas(sizePx);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, sizePx, sizePx);
      resolve(canvas);
    };
    img.onerror = () => {
      console.warn('[icon-raster] SVG → Image 加载失败');
      resolve(null);
    };
    img.src = url;
  });
}
