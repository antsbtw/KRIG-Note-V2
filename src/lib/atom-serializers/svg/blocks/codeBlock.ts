/**
 * codeBlock → 等宽代码图(深色圆角底,逐行 JetBrains Mono)
 *
 * 缘起(X 截图 2026-06):atomsToSvg 原本无 codeBlock 渲染(未识别 → [Code] 占位)。
 * X 发推时普通代码块装不下纯文本会丢格式,总指挥拍板「用 atomsToSvg 文本渲染」——
 * 故补上 codeBlock,**复用现成 textToPath(code mark 走 JetBrains Mono 等宽)**,不另造
 * 文字渲染。这同时让 Graph 画板也能渲码块(补 atomsToSvg 的缺口,非新造重复函数)。
 *
 * 不做语法高亮(高亮在活动编辑器的 CodeMirror/Lezer 装饰里,脱离编辑器拿不到;
 * 截图要的是「可读、不裸奔」,等宽纯色已达标)。Mermaid 不走这里(走 renderMermaidDiagram)。
 *
 * 布局:
 * - 整块一个深色圆角背景(#1e1e1e 系),与 X 深色主题协调,不白底黑边。
 * - 逐行渲染:不 wrap(代码换行有语义),超宽行直接溢出右边(viewBox 固定宽,接受裁切;
 *   截图首要是可读,长行罕见)。
 */
import type { Atom } from '../../types';
import { textToPath } from '../text-to-path';
import type { MarkSet } from '../font-loader';

const FONT_SIZE = 13;
const LINE_HEIGHT = 18;
const PADDING_X = 10;
const PADDING_Y = 10;
const BG_FILL = '#1e1e1e';
const BG_RADIUS = 6;
const CODE_TEXT_FILL = '#d4d4d4';
const CODE_MARKS: MarkSet = { code: true };

/**
 * 从 codeBlock atom 抽代码源码。
 * codeBlock schema content='text*',代码当文本子节点存;拼接所有 text child。
 */
function extractCode(atom: Atom): string {
  const children = atom.content;
  if (!Array.isArray(children) || children.length === 0) return '';
  return children
    .map((c) => (c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('');
}

export async function renderCodeBlock(
  atom: Atom,
  yOffset: number,
  contentWidth: number,
): Promise<{ svg: string; height: number }> {
  const code = extractCode(atom);
  // 空代码块:占一行高的空背景(保持视觉一致,不返 0 高度塌成相邻块)
  const rawLines = code.length > 0 ? code.split('\n') : [''];

  const parts: string[] = [];
  let maxLineWidth = 0;
  // 内容区从 yOffset + PADDING_Y 起,逐行画
  for (let i = 0; i < rawLines.length; i++) {
    const baselineY = yOffset + PADDING_Y + i * LINE_HEIGHT + FONT_SIZE;
    const line = rawLines[i];
    if (!line) continue; // 空行只占行高,不画 path
    const { svg, advance } = await textToPath(line, FONT_SIZE, PADDING_X, baselineY, CODE_TEXT_FILL, CODE_MARKS);
    if (svg) parts.push(svg);
    if (advance > maxLineWidth) maxLineWidth = advance;
  }

  const innerHeight = rawLines.length * LINE_HEIGHT;
  const totalHeight = innerHeight + PADDING_Y * 2;
  // 背景宽 = 最长行宽 + 左右 padding,封顶 contentWidth(短代码不铺满整宽 → 不留右侧大空白,
  // 配合 svgToPng tightCrop 让代码图也贴合内容,实机修「又宽又扁」)。
  const bgWidth = Math.min(contentWidth, Math.ceil(maxLineWidth) + PADDING_X * 2);
  // 背景圆角矩形铺在文字之下(parts 之前)
  const bg =
    `<rect x="0" y="${yOffset}" width="${bgWidth}" height="${totalHeight}" ` +
    `rx="${BG_RADIUS}" ry="${BG_RADIUS}" fill="${BG_FILL}" />`;

  return { svg: bg + parts.join(''), height: totalHeight };
}
