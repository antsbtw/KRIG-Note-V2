/**
 * mathInline → SVG group
 *
 * 方案 C：MathJax SVG 输出（fontCache: 'none'，自包含 <path>）
 *
 * MathJax 输出格式：<svg viewBox="..." width="..ex" height="..ex" style="vertical-align:..ex">
 *   <g stroke="currentColor" fill="currentColor" stroke-width="0">
 *     <g><path d="..."/></g>
 *     ...
 *   </g>
 * </svg>
 *
 * 嵌入策略：把 MathJax SVG 提取出 viewBox + 内层 g，包成一个外层 <g transform="...">
 * 平移到我们的坐标系基线。
 */
import { renderTeX } from '../mathjax-svg';

export async function renderMathInline(
  tex: string,
  fontSize: number,
  x: number,
  baselineY: number,
  defaultTextColor?: string,
): Promise<{ svg: string; advance: number }> {
  if (!tex) return { svg: '', advance: 0 };

  let result;
  try {
    result = renderTeX(tex, fontSize, false);
  } catch (e) {
    console.warn('[mathInline] MathJax render failed', e);
    return { svg: '', advance: 0 };
  }

  // MathJax SVG 字符串中提取 viewBox 和内容
  const viewBoxMatch = /viewBox="([^"]+)"/.exec(result.svg);
  if (!viewBoxMatch) return { svg: '', advance: 0 };

  const [vbX, vbY, vbW, vbH] = viewBoxMatch[1].split(/\s+/).map(parseFloat);

  // 提取根 svg 的内容(去掉 <svg ...> 和 </svg>)
  // currentColor 替换为节点主题色(Sticky 用 '#222',默认 '#dddddd')
  const fill = defaultTextColor ?? '#dddddd';
  let inner = extractInnerSvg(result.svg);
  if (!inner) return { svg: '', advance: 0 };
  inner = inner.replace(/currentColor/g, fill);

  // 缩放：MathJax viewBox 单位是内部坐标，需要缩放到 result.width × result.height
  const scaleX = result.width / vbW;
  const scaleY = result.height / vbH;
  // MathJax y 轴方向：viewBox 通常负 y 在上（typesetting baseline）
  // 我们要把 SVG 的"基线"对齐到 baselineY，左上角对齐到 (x, baselineY - height + valignFix)
  const top = baselineY - result.baselineOffset;

  // transform: 把 MathJax 内容平移到目标位置 + 缩放 + 处理 viewBox 偏移
  const transform = `translate(${x - vbX * scaleX}, ${top - vbY * scaleY}) scale(${scaleX}, ${scaleY})`;

  const wrapped = `<g transform="${transform}" fill="${fill}" stroke="${fill}">${inner}</g>`;

  return { svg: wrapped, advance: result.width + 4 };
}

function extractInnerSvg(svgString: string): string | null {
  const start = svgString.indexOf('>');
  const end = svgString.lastIndexOf('</svg>');
  if (start < 0 || end < 0 || end <= start) return null;
  return svgString.slice(start + 1, end);
}
