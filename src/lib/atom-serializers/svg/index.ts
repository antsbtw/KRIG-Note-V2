import type { Atom } from '../types';
export type { Atom } from '../types';
import { renderTextBlock, type LinkRect } from './blocks/textBlock';
import { renderMathBlock } from './blocks/mathBlock';
import { renderCodeBlock } from './blocks/codeBlock';
import { renderList } from './blocks/list';
import { renderBlockquote, renderCallout, type IconRect, type RenderChild } from './blocks/quoteCallout';
import { renderHorizontalRule } from './blocks/horizontalRule';
import { renderTaskList } from './blocks/taskList';
import { renderToggleList } from './blocks/toggleList';
import type { FontFamily } from './font-loader';
import { LruCache } from '../lru';
import { BLOCK_VISUAL_SPEC } from '../../visual-spec/block-visual-spec';

export type { LinkRect } from './blocks/textBlock';
export type { IconRect } from './blocks/quoteCallout';

/**
 * 渲染态可渲染块集(atom.type)— **单一真源**(L5 编辑↔渲染一致性专项 E1)。
 *
 * 与下方 `renderAtom` switch 的 case 一一对应:**改 switch 必同步改此集合**(单测守)。
 * 用途:graph 编辑态 slash/turn-into 白名单据此过滤,守「编辑能插 ⊆ 渲染能渲」不变量
 * (防"功能黑洞":能插却渲不出 → Esc 后灰字占位/丢内容)。
 *
 * 'textBlock' 是 V1 NoteView 旧 atom 命名(= paragraph),保留兼容。
 * E4 已补 horizontalRule/taskList/toggleList(轻量矢量块)→ graph slash 闸自动放开。
 */
export const RENDERABLE_ATOM_TYPES: ReadonlySet<string> = new Set([
  'textBlock',
  'paragraph',
  'heading',
  'mathBlock',
  'mathInline',
  'codeBlock',
  'bulletList',
  'orderedList',
  'blockquote',
  'callout',
  'horizontalRule', // E4
  'taskList',        // E4
  'toggleList',      // E4
]);

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_VIEWBOX_W = 200;
const VIEWBOX_H = 30;
// L5 一致性 E3:默认基准字号 14→16,向 note 正文(spec.body.fontSize)看齐。
// instance.text_size 仍优先覆盖;缺省的老画板节点现按 note 正文 16 渲染。
const FONT_SIZE = BLOCK_VISUAL_SPEC.body.fontSize;
/** 内容区左右各留白(textBlock x 起点 4 + 右边 4),对齐 textBlock 内 x = 4 起算 */
const HORIZONTAL_PADDING = 8;

/** L1 SvgCache(spec § 5.1):atoms hash → { svg, links } */
const SVG_CACHE = new LruCache<string, { svg: string; links: LinkRect[]; icons: IconRect[] }>(1000);

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
  /**
   * 基准字号(L5-G5 Type section):画板文字节点 instance.text_size 透传至此,
   * 覆盖默认。heading 走绝对 px 模型(L5 一致性 E3:38/28/22 × base/16)。
   * 不传 = spec.body.fontSize(16,向 note 正文看齐;原 14)。
   */
  baseFontSize?: number;
  /**
   * 字体族覆盖(L5-G5 Type section):instance.text_font 透传至此,注入每个 run 的
   * MarkSet.fontFamily,优先于自动选字(CJK 字符仍强制中文字体)。不传 / 'auto' = 自动。
   */
  fontFamily?: FontFamily;
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
): Promise<{ svg: string; links: LinkRect[]; icons: IconRect[] }> {
  const viewBoxW = options.width ?? DEFAULT_VIEWBOX_W;
  const defaultTextColor = options.defaultTextColor;
  const targetHeight = options.targetHeight;
  const valign = options.valign ?? 'top';
  const baseFontSize = options.baseFontSize ?? FONT_SIZE;
  const fontFamily = options.fontFamily;
  // 缓存 key 含 width / 主题色 / 目标高度 / valign / 字号 / 字体族(任一变化都得重渲)
  const key = `w=${viewBoxW}|c=${defaultTextColor ?? ''}|th=${targetHeight ?? 'auto'}|va=${valign}|fs=${baseFontSize}|ff=${fontFamily ?? 'auto'}|${JSON.stringify(atoms)}`;
  const cached = SVG_CACHE.get(key);
  if (cached !== undefined) return cached;

  // 内容区有效宽度(留出左右 padding,与 textBlock x 起点 4 一致)
  const contentWidth = Math.max(20, viewBoxW - HORIZONTAL_PADDING);

  const parts: string[] = [];
  const links: LinkRect[] = [];
  const icons: IconRect[] = [];
  let y = 0;
  for (const atom of atoms) {
    const { svg, height } = await renderAtom(atom, y, contentWidth, links, icons, defaultTextColor, baseFontSize, fontFamily);
    if (svg) parts.push(svg);
    y += height;
  }
  const contentH = y;
  // viewBox 高度:targetHeight 优先(让 valign 有空间);否则 max(VIEWBOX_H, contentH)
  const viewBoxH = targetHeight ?? Math.max(VIEWBOX_H, contentH);
  // F-10 valign:有富余空间(viewBoxH > contentH)时,按 valign 在顶部留偏移
  // 用 <g transform> 包裹所有内容(包括 link / icon bbox 也得跟着偏移)
  const slack = Math.max(0, viewBoxH - contentH);
  let yOffset = 0;
  if (slack > 0) {
    if (valign === 'middle') yOffset = slack / 2;
    else if (valign === 'bottom') yOffset = slack;
  }
  // link / icon bbox 也按 yOffset 平移(与 SVG transform 同步)
  if (yOffset !== 0) {
    for (const r of links) r.y += yOffset;
    for (const ic of icons) ic.y += yOffset;
  }
  const innerSvg = yOffset !== 0
    ? `<g transform="translate(0, ${yOffset})">${parts.join('\n')}</g>`
    : parts.join('\n');
  const svg = wrapSvg(innerSvg, viewBoxW, viewBoxH);
  const result = { svg, links, icons };
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
  icons: IconRect[],
  defaultTextColor?: string,
  baseFontSize: number = FONT_SIZE,
  fontFamily?: FontFamily,
): Promise<{ svg: string; height: number }> {
  // RenderChild 适配:blockquote/callout 子块递归回 renderAtom,把 icons 经闭包透传
  // (RenderChild 签名只到 links,nested callout 的图标也能 emit)
  const childRender: RenderChild = (a, y, cw, lks, dtc, bfs, ff) =>
    renderAtom(a, y, cw, lks, icons, dtc, bfs, ff);
  switch (atom.type) {
    case 'textBlock':        // 旧 atom 格式兼容(V1 NoteView)
    case 'paragraph':        // V2 BlockSpec.id 拆分后:paragraph
    case 'heading':          // V2 BlockSpec.id 拆分后:heading (level 走 attrs.level)
      return renderTextBlock(atom, yOffset, contentWidth, links, defaultTextColor, baseFontSize, fontFamily);
    case 'mathBlock': {
      // NoteView mathBlock schema:content: 'text*',LaTeX 存在 PM 子 text 节点里
      // 兼容老 attrs.latex / attrs.tex 数据(若 content 为空)
      const fromContent = extractMathLatex(atom);
      const latex = fromContent
        || (atom.attrs?.latex as string)
        || (atom.attrs?.tex as string)
        || '';
      // L5 一致性:mathBlock 颜色优先级 = 节点级 attrs.color(用户给该块上的色)
      // > defaultTextColor(Sticky 主题)> 默认。原只读 defaultTextColor、漏 attrs.color
      // → 用户给数学块上色不生效(真机暴露)。
      const mathColor = (typeof atom.attrs?.color === 'string' && atom.attrs.color)
        ? (atom.attrs.color as string)
        : defaultTextColor;
      return renderMathBlock(latex, baseFontSize, yOffset, mathColor);
    }
    case 'codeBlock':
      // 等宽代码图(深色圆角底,逐行 JetBrains Mono);X 截图复用此渲染。
      return renderCodeBlock(atom, yOffset, contentWidth);
    case 'bulletList':
      return renderList(atom, yOffset, false, 0, contentWidth, links, defaultTextColor, baseFontSize, fontFamily);
    case 'orderedList':
      return renderList(atom, yOffset, true, 0, contentWidth, links, defaultTextColor, baseFontSize, fontFamily);
    case 'blockquote':
      // 递归子块 + 左竖条(L5-G6c bug1:不再降级 [Quote] 丢内容)
      return renderBlockquote(atom, yOffset, contentWidth, childRender, links, defaultTextColor, baseFontSize, fontFamily);
    case 'callout':
      // 递归子块 + 圆角底框 + 图标 IconRect(L5-G6c:忠实还原 emoji/lucide/上传图)
      return renderCallout(atom, yOffset, contentWidth, childRender, links, icons, defaultTextColor, baseFontSize, fontFamily);
    case 'horizontalRule':
      // L5 一致性 E4:1px 分隔线(矢量,无 content)
      return renderHorizontalRule(yOffset, contentWidth);
    case 'taskList':
      // L5 一致性 E4:checkbox + 子块(递归);taskItem 在内部处理
      return renderTaskList(atom, yOffset, contentWidth, childRender, links, defaultTextColor, baseFontSize, fontFamily);
    case 'toggleList':
      // L5 一致性 E4:箭头 + 折叠体(open 时渲全部子块,closed 只渲首子)
      return renderToggleList(atom, yOffset, contentWidth, childRender, links, defaultTextColor, baseFontSize, fontFamily);
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
 * 未识别 atom 的降级渲染:构造一个虚拟 paragraph,内容是 ASCII 占位
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
    type: 'paragraph',
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
    case 'mathVisual':    return '[Function Graph]';
    case 'horizontalRule': return '---';
    case 'pageAnchor':    return '[Anchor]';
    case 'taskList':      return '[Tasks]';
    default:              return `[${atomType}]`;
  }
}

function wrapSvg(inner: string, w: number, h: number): string {
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${inner}</svg>`;
}
