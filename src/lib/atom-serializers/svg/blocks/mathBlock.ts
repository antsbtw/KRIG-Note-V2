/**
 * mathBlock → display 模式公式（独占一行）
 *
 * 与 mathInline 的区别：
 * - display=true，MathJax 输出更大尺寸 + 居中布局
 * - 自身占据完整一行，advance 不参与行内累加
 * - 返回 height 给 atomsToSvg 用于垂直堆叠
 */
import { renderTeX } from '../mathjax-svg';

const PADDING_X = 4;
const PADDING_Y = 4;

export async function renderMathBlock(
  tex: string,
  fontSize: number,
  yOffset: number,
  defaultTextColor?: string,
): Promise<{ svg: string; height: number }> {
  if (!tex) return { svg: '', height: 0 };

  let result;
  try {
    result = renderTeX(tex, fontSize, true);
  } catch (e) {
    console.warn('[mathBlock] MathJax render failed', e);
    return { svg: '', height: 0 };
  }

  const viewBoxMatch = /viewBox="([^"]+)"/.exec(result.svg);
  if (!viewBoxMatch) return { svg: '', height: 0 };

  const [vbX, vbY, vbW, vbH] = viewBoxMatch[1].split(/\s+/).map(parseFloat);

  let inner = extractInnerSvg(result.svg);
  if (!inner) return { svg: '', height: 0 };
  // 替换 currentColor 为节点主题色(Sticky 黄底用 '#222',默认 '#dddddd')
  const fill = defaultTextColor ?? '#dddddd';
  inner = inner.replace(/currentColor/g, fill);

  const scaleX = result.width / vbW;
  const scaleY = result.height / vbH;

  // display 公式：左对齐到 PADDING_X，垂直放在 yOffset + PADDING_Y 之下
  const top = yOffset + PADDING_Y;
  const transform = `translate(${PADDING_X - vbX * scaleX}, ${top - vbY * scaleY}) scale(${scaleX}, ${scaleY})`;

  const wrapped = `<g transform="${transform}" fill="${fill}" stroke="${fill}">${inner}</g>`;

  return { svg: wrapped, height: result.height + PADDING_Y * 2 };
}

function extractInnerSvg(svgString: string): string | null {
  const start = svgString.indexOf('>');
  const end = svgString.lastIndexOf('</svg>');
  if (start < 0 || end < 0 || end <= start) return null;
  return svgString.slice(start + 1, end);
}
