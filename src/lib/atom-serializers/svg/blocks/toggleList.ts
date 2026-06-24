/**
 * toggleList → 折叠列表(L5 编辑↔渲染一致性专项 E4)
 *
 * note pm-host.css `.krig-toggle-list`:flex / gap 4px / 箭头列 20px(font 16 #e8eaed);
 *   首子 = 折叠标题(始终显示),其余子块为可折叠体;closed 态只显首子。
 *
 * schema:content 'block+' + attrs.open(默认 true)。
 *
 * 渲染策略(对齐 note):
 * - 首行左侧画箭头(open ▼ / closed ▶),首子块在箭头右侧(让出 arrowBox + gap)。
 * - open 时其余子块缩进到箭头右继续渲染;closed 时只渲首子(对齐 note 折叠态)。
 *
 * 子块递归走调用方注入的 RenderChild(= index.ts renderAtom)。
 */
import type { Atom } from '../../types';
import type { LinkRect } from './textBlock';
import type { FontFamily } from '../font-loader';
import type { RenderChild } from './quoteCallout';
import { textToPath } from '../text-to-path';
import { BLOCK_VISUAL_SPEC, BASE_FONT_SIZE as SPEC_BASE_FONT_SIZE } from '../../../visual-spec/block-visual-spec';

const { arrowBox, gap, arrowColor } = BLOCK_VISUAL_SPEC.toggle;

export async function renderToggleList(
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

  const base = baseFontSize ?? SPEC_BASE_FONT_SIZE;
  const scale = base / SPEC_BASE_FONT_SIZE;
  const arrowW = arrowBox * scale;
  const gapPx = gap * scale;
  const open = atom.attrs?.open !== false;

  const indent = arrowW + gapPx;
  const innerWidth = Math.max(20, contentWidth - indent);

  const parts: string[] = [];
  let y = yOffset;

  // 渲染一个子块(缩进到箭头右),返回新 y
  const renderKid = async (kid: Atom, atY: number): Promise<number> => {
    const localLinks: LinkRect[] = [];
    const { svg, height } = await renderChild(
      kid, atY, innerWidth, localLinks, defaultTextColor, baseFontSize, fontFamily,
    );
    if (svg) parts.push(`<g transform="translate(${indent}, 0)">${svg}</g>`);
    for (const r of localLinks) links.push({ ...r, x: r.x + indent });
    return atY + height;
  };

  // 首子(折叠标题)始终渲染
  const titleY = y;
  y = await renderKid(children[0], y);

  // 箭头:画在首行左侧,垂直居中首行(首行行高 = base×1.7)
  const firstLineHeight = base * BLOCK_VISUAL_SPEC.body.lineHeight;
  const arrowGlyph = open ? '▼' : '▶';
  const arrowFontSize = base; // 对齐 note arrow font-size = 正文
  const arrowBaselineY = titleY + (firstLineHeight + arrowFontSize) / 2 - arrowFontSize * 0.15;
  const arrowX = Math.max(0, (arrowW - arrowFontSize) / 2);
  const arrow = await textToPath(arrowGlyph, arrowFontSize, arrowX, arrowBaselineY, arrowColor);
  if (arrow.svg) parts.push(arrow.svg);

  // open 时渲染其余子块
  if (open) {
    for (let i = 1; i < children.length; i++) {
      const kid = children[i];
      if (!kid) continue;
      y = await renderKid(kid, y);
    }
  }

  return { svg: parts.join(''), height: y - yOffset };
}
