/**
 * codeBlock → 等宽代码图(深色圆角底,逐行 JetBrains Mono)
 *
 * 缘起(X 截图 2026-06):atomsToSvg 原本无 codeBlock 渲染。X 发推 / Graph 画板复用此渲染。
 *
 * L5 一致性(2026-06-23 真机):
 * - **自动换行**:画板节点宽有限,长行原溢出被裁 → 等宽字符断行 wrap(codeWrap option)。
 * - **背景**:保持不透明 #2a2a2a 对齐 note(深底浅字对比高、代码清晰)。半透明机制
 *   (codeBgOpacity/fill-opacity)保留备用,但画板**不传**——实测半透明透出彩色 shape
 *   致代码字对比低、糊(用户拍板回不透明)。
 * - **语法高亮**:tokens 由上层(canvas-rendering)预算注入 atom.attrs._syntaxTokens
 *   (W5:本层纯净不 import code-editing;tokenize 在能用 capability 的层做),按 tag→色
 *   逐段上色;无 tokens / 语言未 load → 回落纯色(fail loud 不崩)。
 *
 * X 路径默认(wrap=false / opacity=1 / 无 tokens)= 原行为不变。
 */
import type { Atom } from '../../types';
import { textToPath } from '../text-to-path';
import type { MarkSet } from '../font-loader';
import { BLOCK_VISUAL_SPEC } from '../../../visual-spec/block-visual-spec';

// L5 一致性 E3:codeBlock 视觉常量接 block-visual-spec 向 note(pm-host.css)看齐。
const FONT_SIZE = BLOCK_VISUAL_SPEC.code.fontSize;
const LINE_HEIGHT = BLOCK_VISUAL_SPEC.code.fontSize * BLOCK_VISUAL_SPEC.code.lineHeight;
const PADDING_X = BLOCK_VISUAL_SPEC.code.padX;
const PADDING_Y = BLOCK_VISUAL_SPEC.code.padY;
const BG_FILL = BLOCK_VISUAL_SPEC.code.bgFill;
const BORDER_COLOR = BLOCK_VISUAL_SPEC.code.borderColor;
const BG_RADIUS = BLOCK_VISUAL_SPEC.code.radius;
const CODE_TEXT_FILL = BLOCK_VISUAL_SPEC.code.textColor;
const SYNTAX_COLORS = BLOCK_VISUAL_SPEC.code.syntax;
const CODE_MARKS: MarkSet = { code: true };

/** 等宽字符宽估算(JetBrains Mono ASCII ≈ 0.6em,CJK ≈ 1em)。wrap 用。 */
function charWidth(ch: string, fontSize: number): number {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x2e80 ? fontSize : fontSize * 0.6; // CJK/全角 ≈ 1em
}

/** 上层注入的语法 token(W5:本层只消费数据,不 import code-editing)。 */
interface SyntaxToken {
  from: number;
  to: number;
  tag: string;
}

export interface CodeBlockRenderOptions {
  /** 自动换行(画板 true;X 默认 false 保持原不裁行为) */
  wrap?: boolean;
  /** 背景不透明度(画板 0.7 半透明;默认 1 不透明,对齐 note) */
  bgOpacity?: number;
}

function extractCode(atom: Atom): string {
  const children = atom.content;
  if (!Array.isArray(children) || children.length === 0) return '';
  return children
    .map((c) => (c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('');
}

/** 读上层预算注入的 tokens(atom.attrs._syntaxTokens);无则空。 */
function extractTokens(atom: Atom): SyntaxToken[] {
  const raw = (atom.attrs as { _syntaxTokens?: unknown } | undefined)?._syntaxTokens;
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is SyntaxToken =>
    !!t && typeof t === 'object'
    && typeof (t as SyntaxToken).from === 'number'
    && typeof (t as SyntaxToken).to === 'number'
    && typeof (t as SyntaxToken).tag === 'string');
}

/** 某全局字符 offset 命中的 token 色(无 token / 未命中 tag → 默认码字色)。 */
function colorAt(offset: number, tokens: SyntaxToken[]): string {
  for (const t of tokens) {
    if (offset >= t.from && offset < t.to) {
      return SYNTAX_COLORS[t.tag] ?? CODE_TEXT_FILL;
    }
  }
  return CODE_TEXT_FILL;
}

/** 把一段文本按"连续同色"切成 run(每 run 一次 textToPath)。globalStart = 该段首字符的全局 offset。 */
function splitByColor(text: string, globalStart: number, tokens: SyntaxToken[]): { text: string; color: string }[] {
  if (tokens.length === 0) return text ? [{ text, color: CODE_TEXT_FILL }] : [];
  const runs: { text: string; color: string }[] = [];
  let buf = '';
  let bufColor = '';
  let i = 0;
  for (const ch of text) {
    const color = colorAt(globalStart + i, tokens);
    if (buf && color !== bufColor) {
      runs.push({ text: buf, color: bufColor });
      buf = '';
    }
    buf += ch;
    bufColor = color;
    i += ch.length; // 按 UTF-16 code unit 推进(对齐 PM/Lezer offset)
  }
  if (buf) runs.push({ text: buf, color: bufColor });
  return runs;
}

/** 逻辑行按 maxWidth 等宽断行,返回 [{text, globalStart}]。不 wrap 时整行一条。 */
function wrapLine(line: string, globalStart: number, maxWidth: number, wrap: boolean): { text: string; start: number }[] {
  if (!wrap || maxWidth <= 0) return [{ text: line, start: globalStart }];
  const out: { text: string; start: number }[] = [];
  let buf = '';
  let bufStart = globalStart;
  let w = 0;
  let i = 0;
  for (const ch of line) {
    const cw = charWidth(ch, FONT_SIZE);
    if (w > 0 && w + cw > maxWidth) {
      out.push({ text: buf, start: bufStart });
      buf = '';
      bufStart = globalStart + i;
      w = 0;
    }
    buf += ch;
    w += cw;
    i += ch.length;
  }
  out.push({ text: buf, start: bufStart });
  return out;
}

export async function renderCodeBlock(
  atom: Atom,
  yOffset: number,
  contentWidth: number,
  options: CodeBlockRenderOptions = {},
): Promise<{ svg: string; height: number }> {
  const wrap = options.wrap ?? false;
  const bgOpacity = options.bgOpacity ?? 1;
  const code = extractCode(atom);
  const tokens = extractTokens(atom);

  // 逻辑行(\n 切);wrap 时每逻辑行再按可用宽断成多视觉行,记每视觉行首字符全局 offset。
  const maxTextWidth = contentWidth - PADDING_X * 2;
  const logicalLines = code.length > 0 ? code.split('\n') : [''];
  const visualLines: { text: string; start: number }[] = [];
  let globalOffset = 0;
  for (const ln of logicalLines) {
    const wrapped = wrapLine(ln, globalOffset, maxTextWidth, wrap);
    visualLines.push(...wrapped);
    globalOffset += ln.length + 1; // +1 = 被 split 掉的 '\n'
  }

  const parts: string[] = [];
  let maxLineWidth = 0;
  for (let i = 0; i < visualLines.length; i++) {
    const { text: lineText, start } = visualLines[i];
    const baselineY = yOffset + PADDING_Y + i * LINE_HEIGHT + FONT_SIZE;
    if (!lineText) continue;
    // 按色切 run,逐 run 上色;x 累加 run 的真实 advance
    const runs = splitByColor(lineText, start, tokens);
    let x = PADDING_X;
    for (const run of runs) {
      const { svg, advance } = await textToPath(run.text, FONT_SIZE, x, baselineY, run.color, CODE_MARKS);
      if (svg) parts.push(svg);
      x += advance;
    }
    if (x - PADDING_X > maxLineWidth) maxLineWidth = x - PADDING_X;
  }

  const innerHeight = visualLines.length * LINE_HEIGHT;
  const totalHeight = innerHeight + PADDING_Y * 2;
  // 背景宽 = 最长视觉行宽 + 左右 padding,封顶 contentWidth(wrap 时本就 ≤ contentWidth)。
  const bgWidth = Math.min(contentWidth, Math.ceil(maxLineWidth) + PADDING_X * 2);
  const opacityAttr = bgOpacity < 1 ? ` fill-opacity="${bgOpacity}"` : '';
  const bg =
    `<rect x="0" y="${yOffset}" width="${bgWidth}" height="${totalHeight}" ` +
    `rx="${BG_RADIUS}" ry="${BG_RADIUS}" fill="${BG_FILL}"${opacityAttr} ` +
    `stroke="${BORDER_COLOR}" stroke-width="1" />`;

  return { svg: bg + parts.join(''), height: totalHeight };
}
