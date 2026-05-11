import type { Atom } from '../types';
export type { Atom } from '../types';
import { renderTextBlock, type LinkRect } from './blocks/textBlock';
import { renderMathBlock } from './blocks/mathBlock';
import { renderList } from './blocks/list';
import { LruCache } from '../lru';

export type { LinkRect } from './blocks/textBlock';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_VIEWBOX_W = 200;
const VIEWBOX_H = 30;
const FONT_SIZE = 14;
/** 内容区左右各留白(textBlock x 起点 4 + 右边 4),对齐 textBlock 内 x = 4 起算 */
const HORIZONTAL_PADDING = 8;

/** L1 SvgCache(spec § 5.1):atoms hash → { svg, links } */
const SVG_CACHE = new LruCache<string, { svg: string; links: LinkRect[] }>(1000);

/** 暴露给上层用于性能监控 / 调试 */
export function getSvgCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
  return {
    size: SVG_CACHE.size,
    hits: SVG_CACHE.hits,
    misses: SVG_CACHE.misses,
    hitRate: SVG_CACHE.hitRate(),
  };
}

export function clearSvgCache(): void {
  SVG_CACHE.clear();
}

export interface AtomsToSvgOptions {
  /** 整个 SVG 的目标宽度(画板的 instance.size.w);不指定时用 DEFAULT_VIEWBOX_W */
  width?: number;
  /**
   * 文字默认色(M2.2 Sticky):浅底节点(如黄色 Sticky)用 '#222';
   * 不传 = '#dddddd'(深色背景适配).textStyle.color mark 始终覆盖此默认.
   */
  defaultTextColor?: string;
  /**
   * 节点目标高度(F-10):用于 valign 偏移计算.
   * 不传 = 用 max(VIEWBOX_H, contentH);传了且 > contentH → 多余空间按 valign
   * 在顶 / 中 / 底分配.
   */
  targetHeight?: number;
  /**
   * 文字垂直对齐(F-10):'top'(默认)/ 'middle' / 'bottom'.
   * 仅当 targetHeight > contentH(节点高度大于内容)时生效.
   */
  valign?: 'top' | 'middle' | 'bottom';
}

/**
 * 主入口:atoms → { svg, links }
 *
 * links:渲染态 link mark 的 bbox 数组(F-6 给画板 hit-rect overlay 用).
 * NoteView PM 编辑态不需要 links(已用 anchor tag),取 .svg 即可.
 *
 * 缓存的是 { svg, links } 整体 — 同 atoms 的 links 也应稳定.
 */
export async function atomsToSvgWithLinks(
  atoms: Atom[],
  options: AtomsToSvgOptions = {},
): Promise<{ svg: string; links: LinkRect[] }> {
  const viewBoxW = options.width ?? DEFAULT_VIEWBOX_W;
  const defaultTextColor = options.defaultTextColor;
  const targetHeight = options.targetHeight;
  const valign = options.valign ?? 'top';
  // 缓存 key 含 width / 主题色 / 目标高度 / valign(任一变化都得重渲)
  const key = `w=${viewBoxW}|c=${defaultTextColor ?? ''}|th=${targetHeight ?? 'auto'}|va=${valign}|${JSON.stringify(atoms)}`;
  const cached = SVG_CACHE.get(key);
  if (cached !== undefined) return cached;

  // 内容区有效宽度(留出左右 padding,与 textBlock x 起点 4 一致)
  const contentWidth = Math.max(20, viewBoxW - HORIZONTAL_PADDING);

  const parts: string[] = [];
  const links: LinkRect[] = [];
  let y = 0;
  for (const atom of atoms) {
    const { svg, height } = await renderAtom(atom, y, contentWidth, links, defaultTextColor);
    if (svg) parts.push(svg);
    y += height;
  }
  const contentH = y;
  // viewBox 高度:targetHeight 优先(让 valign 有空间);否则 max(VIEWBOX_H, contentH)
  const viewBoxH = targetHeight ?? Math.max(VIEWBOX_H, contentH);
  // F-10 valign:有富余空间(viewBoxH > contentH)时,按 valign 在顶部留偏移
  // 用 <g transform> 包裹所有内容(包括 link bbox 也得跟着偏移)
  const slack = Math.max(0, viewBoxH - contentH);
  let yOffset = 0;
  if (slack > 0) {
    if (valign === 'middle') yOffset = slack / 2;
    else if (valign === 'bottom') yOffset = slack;
  }
  // link bbox 也按 yOffset 平移(与 SVG transform 同步)
  if (yOffset !== 0) {
    for (const r of links) r.y += yOffset;
  }
  const innerSvg = yOffset !== 0
    ? `<g transform="translate(0, ${yOffset})">${parts.join('\n')}</g>`
    : parts.join('\n');
  const svg = wrapSvg(innerSvg, viewBoxW, viewBoxH);
  const result = { svg, links };
  SVG_CACHE.set(key, result);
  return result;
}

/** 兼容旧调用方:只取 svg 字符串 */
export async function atomsToSvg(
  atoms: Atom[],
  options: AtomsToSvgOptions = {},
): Promise<string> {
  const { svg } = await atomsToSvgWithLinks(atoms, options);
  return svg;
}

async function renderAtom(
  atom: Atom,
  yOffset: number,
  contentWidth: number,
  links: LinkRect[],
  defaultTextColor?: string,
): Promise<{ svg: string; height: number }> {
  switch (atom.type) {
    case 'textBlock':
      return renderTextBlock(atom, yOffset, contentWidth, links, defaultTextColor);
    case 'mathBlock': {
      // NoteView mathBlock schema:content: 'text*',LaTeX 存在 PM 子 text 节点里
      // 兼容老 attrs.latex / attrs.tex 数据(若 content 为空)
      const fromContent = extractMathLatex(atom);
      const latex = fromContent
        || (atom.attrs?.latex as string)
        || (atom.attrs?.tex as string)
        || '';
      return renderMathBlock(latex, FONT_SIZE, yOffset, defaultTextColor);
    }
    case 'bulletList':
      return renderList(atom, yOffset, false, 0, contentWidth, links, defaultTextColor);
    case 'orderedList':
      return renderList(atom, yOffset, true, 0, contentWidth, links, defaultTextColor);
    default:
      // 未识别的 block:渲染一行灰字占位
      return renderUnknownAtom(atom, yOffset, contentWidth);
  }
}

/**
 * 从 PM JSON 形态的 mathBlock 抽 LaTeX 字符串.
 *
 * NoteView mathBlock schema 是 `content: 'text*'`,LaTeX 当作普通文本子节点存,
 * PM JSON: { content: [{ type: 'text', text: 'x^2 + 1' }] }
 * 拼接所有 text child 即得 LaTeX 源码.
 */
function extractMathLatex(atom: Atom): string {
  const children = atom.content;
  if (!Array.isArray(children) || children.length === 0) return '';
  return children
    .map((c) => (c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('');
}

/**
 * 未识别 atom 的降级渲染:构造一个虚拟 textBlock,内容是 ASCII 占位
 * (避免 emoji 字体回退缺失;占位文字不可编辑,只是视觉提示).
 *
 * 详见 docs/graph/canvas/Canvas-M2.1-TextNode-Spec.md §2.3
 */
async function renderUnknownAtom(
  atom: Atom,
  yOffset: number,
  contentWidth: number,
): Promise<{ svg: string; height: number }> {
  const label = unknownAtomLabel(atom.type);
  const placeholderAtom: Atom = {
    type: 'textBlock',
    content: [{ type: 'text', text: label }],
  };
  return renderTextBlock(placeholderAtom, yOffset, contentWidth);
}

/** 把未识别的 atom 类型映射成简短占位标签(纯 ASCII,避免 emoji 字体缺失) */
function unknownAtomLabel(atomType: string): string {
  switch (atomType) {
    case 'image':         return '[Image]';
    case 'video':         return '[Video]';
    case 'audio':         return '[Audio]';
    case 'tweet':         return '[Tweet]';
    case 'codeBlock':     return '[Code]';
    case 'table':         return '[Table]';
    case 'columnList':    return '[Columns]';
    case 'frameBlock':    return '[Frame]';
    case 'callout':       return '[Callout]';
    case 'blockquote':    return '[Quote]';
    case 'toggleList':    return '[Toggle]';
    case 'externalRef':   return '[Ref]';
    case 'fileBlock':     return '[File]';
    case 'htmlBlock':     return '[HTML]';
    case 'mathVisual':    return '[Diagram]';
    case 'horizontalRule': return '---';
    case 'pageAnchor':    return '[Anchor]';
    case 'taskList':      return '[Tasks]';
    default:              return `[${atomType}]`;
  }
}

function wrapSvg(inner: string, w: number, h: number): string {
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${inner}</svg>`;
}
