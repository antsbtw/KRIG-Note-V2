/**
 * Picker 缩略图 — shape / substance 渲染成 56×36 inline SVG.
 *
 * V1 直迁(src/plugins/graph/canvas/ui/LibraryPicker/preview-svg.ts:114 行),
 * V2 改动:用 `requireCapabilityApi('shape-library').shapes.evaluate` 替代
 * V1 直接 import `renderParametric`.
 *
 * 不挂 Three.js mini-canvas — 直接复用 EvaluatedPath.d 字符串,包成 <svg><path>.
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  EvaluatedPath,
  ShapeDef,
  ShapeLibraryApi,
} from '@capabilities/shape-library/types';

const PREVIEW_W = 56;
const PREVIEW_H = 36;
const STROKE_W = 1.4;

let _shapeApi: ShapeLibraryApi | null = null;
function getShapeApi(): ShapeLibraryApi {
  if (!_shapeApi) {
    _shapeApi = requireCapabilityApi<ShapeLibraryApi>('shape-library');
  }
  return _shapeApi;
}

/** Shape 缩略图 */
export function shapeToSVG(shapeId: string): string | null {
  const api = getShapeApi();
  const shape = api.shapes.get(shapeId);
  if (!shape) return null;
  if (shape.geometry.kind === 'text') {
    return textPlaceholderSVG();
  }
  if (shape.geometry.kind === 'svg') {
    // 阶段 B 真渲 svgPath;A 先退化矩形占位
    return rectFallbackSVG(shape);
  }
  if (shape.category === 'line') {
    return lineSampleSVG(shapeId);
  }
  // parametric:走 evaluate 拿 d 字符串
  let out: EvaluatedPath | null;
  try {
    out = api.shapes.evaluate(shapeId, {}, { width: PREVIEW_W, height: PREVIEW_H });
  } catch {
    return rectFallbackSVG(shape);
  }
  if (!out) return rectFallbackSVG(shape);
  return shapeSvgFromPath(out.d, shape);
}

/** Substance 缩略图:取 frame component 的 shape 渲染 */
export function substanceToSVG(substanceId: string): string | null {
  const api = getShapeApi();
  const def = api.substances.get(substanceId);
  if (!def) return null;
  const frame =
    def.components.find((c) => c.type === 'shape' && c.binding === 'frame') ??
    def.components.find((c) => c.type === 'shape');
  if (!frame) return rectFallbackSVG();
  const shape = api.shapes.get(frame.ref);
  if (!shape) return rectFallbackSVG();
  if (shape.category === 'line') return lineSampleSVG(frame.ref);
  let out: EvaluatedPath | null;
  try {
    out = api.shapes.evaluate(frame.ref, {}, { width: PREVIEW_W, height: PREVIEW_H });
  } catch {
    return rectFallbackSVG(shape);
  }
  if (!out) return rectFallbackSVG(shape);
  // substance frame 可被 component.style_overrides 覆盖
  const fillColor =
    (frame.style_overrides as { fill?: { color?: string } } | undefined)?.fill?.color
    ?? shape.default_style?.fill?.color
    ?? '#4A90E2';
  const strokeColor =
    (frame.style_overrides as { line?: { color?: string } } | undefined)?.line?.color
    ?? shape.default_style?.line?.color
    ?? '#2E5C8A';
  return wrapSvg(`<path d="${out.d}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${STROKE_W}" stroke-linejoin="round"/>`);
}

// ─────────────────────────────────────────────────────────
// 内部
// ─────────────────────────────────────────────────────────

function shapeSvgFromPath(d: string, shape: ShapeDef): string {
  const fill = shape.default_style?.fill;
  const line = shape.default_style?.line;
  const fillColor = fill?.type === 'solid' ? (fill.color ?? '#4A90E2') : 'none';
  const strokeColor = line?.type === 'solid' ? (line.color ?? '#2E5C8A') : 'none';
  return wrapSvg(`<path d="${d}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${STROKE_W}" stroke-linejoin="round"/>`);
}

/** Line 示意:直线 / 折线 / 曲线 */
function lineSampleSVG(ref: string): string {
  const x1 = 4, y1 = PREVIEW_H - 6;
  const x2 = PREVIEW_W - 4, y2 = 6;
  let path = '';
  if (ref === 'krig.line.elbow') {
    const mx = (x1 + x2) / 2;
    path = `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
  } else if (ref === 'krig.line.curved') {
    path = `M ${x1} ${y1} C ${x1 + 18} ${y1} ${x2 - 18} ${y2} ${x2} ${y2}`;
  } else {
    path = `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  return wrapSvg(`<path d="${path}" fill="none" stroke="#2E5C8A" stroke-width="${STROKE_W}" stroke-linecap="round"/>`);
}

function rectFallbackSVG(shape?: ShapeDef): string {
  const c = shape?.default_style?.fill?.color ?? '#4A90E2';
  return wrapSvg(`<rect x="6" y="6" width="${PREVIEW_W - 12}" height="${PREVIEW_H - 12}" rx="3" fill="${c}" stroke="#2E5C8A" stroke-width="${STROKE_W}"/>`);
}

function textPlaceholderSVG(): string {
  return wrapSvg(`<text x="${PREVIEW_W / 2}" y="${PREVIEW_H / 2 + 5}" font-size="16" font-weight="600" fill="#888" text-anchor="middle" font-family="sans-serif">T</text>`);
}

function wrapSvg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PREVIEW_W} ${PREVIEW_H}" width="${PREVIEW_W}" height="${PREVIEW_H}">${inner}</svg>`;
}
