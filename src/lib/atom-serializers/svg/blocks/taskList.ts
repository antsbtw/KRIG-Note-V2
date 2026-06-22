/**
 * taskList / taskItem → 任务清单(L5 编辑↔渲染一致性专项 E4)
 *
 * note pm-host.css:
 *   .krig-task-item   flex / gap 8px / checkbox 16px(accent #8ab4f8)
 *   .checked 文字     #9aa0a6 + 删除线
 *   taskItem indent   node-view margin-left = indent × 24px
 *
 * schema:taskList content 'taskItem+';taskItem content 'block+' + attrs.checked/indent。
 *
 * 渲染策略(对齐 note):每个 taskItem 一行起 —— 左侧 checkbox 方框(未选空框/已选实心
 * 打勾)+ 右侧子块(block+)。checkbox 与文字 gap 8px;item 视觉缩进 indent×24。
 * 已完成项文字走灰色(删除线属 refinement,渲染链画删除线需额外 path,留 backlog)。
 *
 * 子块递归走调用方注入的 RenderChild(= index.ts renderAtom),避免循环 import。
 */
import type { Atom } from '../../types';
import type { LinkRect } from './textBlock';
import type { FontFamily } from '../font-loader';
import type { RenderChild } from './quoteCallout';
import { BLOCK_VISUAL_SPEC, BASE_FONT_SIZE as SPEC_BASE_FONT_SIZE } from '../../../visual-spec/block-visual-spec';

const { checkboxSize, accentColor, gap, indentPerLevel, checkedColor } = BLOCK_VISUAL_SPEC.taskList;

export async function renderTaskList(
  atom: Atom,
  yOffset: number,
  contentWidth: number,
  renderChild: RenderChild,
  links: LinkRect[],
  defaultTextColor?: string,
  baseFontSize?: number,
  fontFamily?: FontFamily,
): Promise<{ svg: string; height: number }> {
  const items = Array.isArray(atom.content) ? atom.content : [];
  if (items.length === 0) return { svg: '', height: 0 };

  const base = baseFontSize ?? SPEC_BASE_FONT_SIZE;
  const scale = base / SPEC_BASE_FONT_SIZE;
  const box = checkboxSize * scale;
  const gapPx = gap * scale;

  const parts: string[] = [];
  let y = yOffset;

  for (const item of items) {
    if (!item || (item.type !== 'taskItem' && item.type !== 'listItem')) continue;
    const checked = item.attrs?.checked === true;
    const itemIndent = typeof item.attrs?.indent === 'number'
      ? Math.max(0, item.attrs.indent) * indentPerLevel * scale
      : 0;
    const checkboxX = itemIndent;
    const childIndent = checkboxX + box + gapPx;
    const innerWidth = Math.max(20, contentWidth - childIndent);

    // checkbox 顶对齐首行文字(首行行高 = base×1.7,checkbox 垂直居中其中)
    const firstLineHeight = base * BLOCK_VISUAL_SPEC.body.lineHeight;
    const boxY = y + Math.max(0, (firstLineHeight - box) / 2);

    // 子块(block+):已完成项用灰色文字(对齐 note .checked);否则跟主题色/默认
    const childColor = checked ? checkedColor : defaultTextColor;
    const childKids = Array.isArray(item.content) ? item.content : [];
    let childY = y;
    const childParts: string[] = [];
    for (const kid of childKids) {
      if (!kid) continue;
      const localLinks: LinkRect[] = [];
      const { svg, height } = await renderChild(
        kid, childY, innerWidth, localLinks, childColor, baseFontSize, fontFamily,
      );
      if (svg) {
        childParts.push(
          childIndent !== 0 ? `<g transform="translate(${childIndent}, 0)">${svg}</g>` : svg,
        );
      }
      for (const r of localLinks) links.push({ ...r, x: r.x + childIndent });
      childY += height;
    }
    const itemHeight = Math.max(childY - y, firstLineHeight);

    // checkbox:圆角方框;已选填 accent + 勾,未选描边空框
    const r = Math.max(1, box * 0.18);
    if (checked) {
      parts.push(
        `<rect x="${checkboxX}" y="${boxY}" width="${box}" height="${box}" rx="${r}" ry="${r}" fill="${accentColor}" />`,
      );
      // 对勾:两段折线(M ... l ... l ...),白色 stroke
      const cx = checkboxX;
      const cy = boxY;
      const p1x = cx + box * 0.26, p1y = cy + box * 0.52;
      const p2x = cx + box * 0.43, p2y = cy + box * 0.70;
      const p3x = cx + box * 0.76, p3y = cy + box * 0.30;
      parts.push(
        `<path d="M ${p1x} ${p1y} L ${p2x} ${p2y} L ${p3x} ${p3y}" fill="none" stroke="#ffffff" stroke-width="${Math.max(1, box * 0.12)}" stroke-linecap="round" stroke-linejoin="round" />`,
      );
    } else {
      const sw = Math.max(1, box * 0.1);
      parts.push(
        `<rect x="${checkboxX + sw / 2}" y="${boxY + sw / 2}" width="${box - sw}" height="${box - sw}" rx="${r}" ry="${r}" fill="none" stroke="${accentColor}" stroke-width="${sw}" />`,
      );
    }
    parts.push(...childParts);
    y += itemHeight;
  }

  return { svg: parts.join(''), height: y - yOffset };
}
