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

  // 图标:emoji(默认 💡)放图标列居中。emoji 字体回退缺失时退化为小圆点(纯 ASCII 安全)。
  const emoji = typeof atom.attrs?.emoji === 'string' ? atom.attrs.emoji : '';
  const iconCx = CALLOUT_PAD_X + CALLOUT_ICON_W / 2;
  const iconCy = yOffset + CALLOUT_PAD_Y + 10;
  const icon = emoji
    ? `<text x="${iconCx}" y="${iconCy + 5}" font-size="14" text-anchor="middle" fill="${defaultTextColor ?? '#dddddd'}">${escapeXml(emoji)}</text>`
    : `<circle cx="${iconCx}" cy="${iconCy}" r="3" fill="${QUOTE_BAR_FILL}" />`;

  return { svg: bg + icon + body.svg, height: totalHeight };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
}
