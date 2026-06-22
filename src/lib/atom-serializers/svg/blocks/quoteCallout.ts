/**
 * blockquote / callout 块渲染(L5-G6c bug1 修复)
 *
 * 背景:atomsToSvg 原无 callout/blockquote 渲染器,二者落 renderUnknownAtom →
 * 降级成字面占位 `[Quote]` / `[Callout]`,**丢掉全部子内容**(实机:`123`/`正常`/
 * `测试callout,很好` 全没了)。本模块递归渲染子块 + 加装饰(quote 左竖条 / callout 圆角底框),
 * 内容不再丢。
 *
 * 两者 PM schema 均 `content: 'block+'`(含 paragraph/heading/list/math 等子块):
 * - blockquote:左侧竖条 + 子块右缩
 * - callout:圆角底框 + 图标(emoji/icon)+ 子块右缩 + 上下 padding
 *
 * 子块递归走调用方注入的 renderChild(= index.ts renderAtom),避免循环 import +
 * 支持任意子块类型(callout 里嵌 math/list 也不丢)。
 */
import type { Atom } from '../../types';
import type { LinkRect } from './textBlock';
import type { FontFamily } from '../font-loader';

/** 子块渲染回调(index.ts renderAtom 注入)*/
export type RenderChild = (
  atom: Atom,
  yOffset: number,
  contentWidth: number,
  links: LinkRect[],
  defaultTextColor?: string,
  baseFontSize?: number,
  fontFamily?: FontFamily,
) => Promise<{ svg: string; height: number }>;

const QUOTE_BAR_WIDTH = 3;
const QUOTE_BAR_FILL = '#7aa2f7';
const QUOTE_INDENT = 12;
const QUOTE_PAD_Y = 2;

const CALLOUT_BG_FILL = '#2a2f3a';
const CALLOUT_BG_RADIUS = 6;
const CALLOUT_PAD_X = 12;
const CALLOUT_PAD_Y = 10;
const CALLOUT_ICON_W = 22; // 图标列宽(emoji/icon 占位)

/** 渲染子块序列,统一向右平移 indent;返回 {svg, height}(从 yOffset 起的总高)*/
async function renderChildren(
  children: Atom[],
  renderChild: RenderChild,
  yOffset: number,
  indent: number,
  innerWidth: number,
  links: LinkRect[],
  defaultTextColor?: string,
  baseFontSize?: number,
  fontFamily?: FontFamily,
): Promise<{ svg: string; height: number }> {
  const parts: string[] = [];
  let y = yOffset;
  for (const child of children) {
    if (!child) continue;
    // 子块在自己坐标系收 link,再批量加 indent 偏移(与 g transform 同步)
    const localLinks: LinkRect[] = [];
    const { svg, height } = await renderChild(
      child, y, innerWidth, localLinks, defaultTextColor, baseFontSize, fontFamily,
    );
    if (svg) {
      parts.push(indent !== 0 ? `<g transform="translate(${indent}, 0)">${svg}</g>` : svg);
    }
    for (const r of localLinks) links.push({ ...r, x: r.x + indent });
    y += height;
  }
  return { svg: parts.join(''), height: y - yOffset };
}

/** blockquote:左竖条 + 子块右缩 */
export async function renderBlockquote(
  atom: Atom,
  yOffset: number,
  contentWidth: number,
  renderChild: RenderChild,
  links: LinkRect[],
  defaultTextColor?: string,
  baseFontSize?: number,
  fontFamily?: FontFamily,
): Promise<{ svg: string; height: number }> {
  const children = Array.isArray(atom.content) ? atom.content : [];
  if (children.length === 0) return { svg: '', height: 0 };

  const innerWidth = Math.max(20, contentWidth - QUOTE_INDENT);
  const body = await renderChildren(
    children, renderChild, yOffset + QUOTE_PAD_Y, QUOTE_INDENT, innerWidth,
    links, defaultTextColor, baseFontSize, fontFamily,
  );
  const totalHeight = body.height + QUOTE_PAD_Y * 2;
  // 左竖条铺满块高
  const bar =
    `<rect x="0" y="${yOffset}" width="${QUOTE_BAR_WIDTH}" height="${Math.max(1, totalHeight)}" ` +
    `rx="1" fill="${QUOTE_BAR_FILL}" />`;
  return { svg: bar + body.svg, height: totalHeight };
}

/** callout:圆角底框 + 图标 + 子块右缩 */
export async function renderCallout(
  atom: Atom,
  yOffset: number,
  contentWidth: number,
  renderChild: RenderChild,
  links: LinkRect[],
  defaultTextColor?: string,
  baseFontSize?: number,
  fontFamily?: FontFamily,
): Promise<{ svg: string; height: number }> {
  const children = Array.isArray(atom.content) ? atom.content : [];
  if (children.length === 0) return { svg: '', height: 0 };

  const indent = CALLOUT_PAD_X + CALLOUT_ICON_W;
  const innerWidth = Math.max(20, contentWidth - indent - CALLOUT_PAD_X);
  const body = await renderChildren(
    children, renderChild, yOffset + CALLOUT_PAD_Y, indent, innerWidth,
    links, defaultTextColor, baseFontSize, fontFamily,
  );
  const totalHeight = body.height + CALLOUT_PAD_Y * 2;

  const bg =
    `<rect x="0" y="${yOffset}" width="${contentWidth}" height="${Math.max(1, totalHeight)}" ` +
    `rx="${CALLOUT_BG_RADIUS}" ry="${CALLOUT_BG_RADIUS}" fill="${CALLOUT_BG_FILL}" />`;

  // 图标:callout 的 emoji(💡 等)是彩色字体字形,本链路 TextRenderer 用 SVGLoader.createShapes
  // 只渲**填充** path/circle(fill:none 的 stroke 被跳过,见 TextRenderer:142-143),且无 emoji 字体,
  // <text>emoji 会被 SVGLoader 静默丢弃 → 渲不出(实机 bug)。故画一个**填充矢量灯泡**代替 emoji,
  // 稳定可渲、读作 callout 标记。(忠实显示用户选的 emoji/lucide/image 需走 <image> 链路,留后)
  const icon = lightbulbIcon(CALLOUT_PAD_X + 3, yOffset + CALLOUT_PAD_Y + 2, defaultTextColor ?? '#f5c542');

  return { svg: bg + icon + body.svg, height: totalHeight };
}

/**
 * 填充矢量灯泡图标(callout 标记)— ~16px,平移到 (x,y)。**纯填充**(circle + path,无 stroke),
 * 适配 TextRenderer 只渲填充几何;灯泡圆 + 灯座梯形,简笔可辨识。
 */
function lightbulbIcon(x: number, y: number, fill: string): string {
  return (
    `<g transform="translate(${x}, ${y})">` +
    // 灯泡(填充圆)
    `<circle cx="8" cy="6" r="5.2" fill="${fill}" />` +
    // 灯座(填充梯形:上宽下窄)
    `<path d="M 5 11 L 11 11 L 10 14 L 6 14 Z" fill="${fill}" />` +
    `</g>`
  );
}
