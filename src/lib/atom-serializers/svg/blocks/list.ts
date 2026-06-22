/**
 * bulletList / orderedList 序列化.
 *
 * NoteView schema(权威源,plugins/note/blocks/bullet-list.ts):
 *   content: 'block+'  ← 直接含 textBlock / nested list,**没有 listItem 包装**
 *
 * 形态:
 *   bulletList {
 *     content: [
 *       textBlock,           // 列表项 1
 *       textBlock,           // 列表项 2
 *       bulletList,          // 嵌套子列表(缩进 +1 级渲染)
 *     ]
 *   }
 *
 * 渲染策略:
 * - 每个 textBlock child = 一个列表项,画 bullet/number + 缩进文本
 * - 嵌套 list child 缩进递归,自身不画 bullet(由子 list 的项画)
 */
import type { Atom } from '../../types';
import { renderTextBlock, type LinkRect } from './textBlock';
import { textToPath } from '../text-to-path';
import type { FontFamily } from '../font-loader';
import { BLOCK_VISUAL_SPEC, BASE_FONT_SIZE as SPEC_BASE_FONT_SIZE } from '../../../visual-spec/block-visual-spec';

// L5 一致性 E3:list 视觉常量接 block-visual-spec 向 note(pm-host.css)看齐。
const INDENT_PER_LEVEL = BLOCK_VISUAL_SPEC.list.indentPerLevel; // 24(原 16,= note li padding-left)
const BULLET_DIAMETER = BLOCK_VISUAL_SPEC.list.bulletDiameter;  // 6(原 4,= note bullet 6px)
const BULLET_X_OFFSET = 4; // bullet 中心相对 indent 起点的偏移
const BULLET_FILL = BLOCK_VISUAL_SPEC.body.color; // #e8eaed(原 #cccccc,note bullet = currentColor 文字色)
const NUMBER_FONT_SIZE = BLOCK_VISUAL_SPEC.list.numberFontSize; // 16(原 14,= note 序号继承正文)

export async function renderList(
  atom: Atom,
  yOffset: number,
  ordered: boolean,
  depth = 0,
  contentWidth = 200,
  links?: LinkRect[],
  defaultTextColor?: string,
  baseFontSize?: number,
  fontFamily?: FontFamily,
): Promise<{ svg: string; height: number }> {
  if (!atom.content || atom.content.length === 0) return { svg: '', height: 0 };

  const parts: string[] = [];
  let y = yOffset;
  let index = 1;

  const indent = INDENT_PER_LEVEL * (depth + 1);
  // 缩进后,可用文字宽度收窄(嵌套越深越窄)
  const innerWidth = Math.max(20, contentWidth - indent);

  // note schema(权威源,bullet-list/spec.ts):content='listItem+';listItem content='block+'.
  // 即真实结构是 bulletList > listItem > paragraph(**有 listItem 中间层**,
  // 原注释「没有 listItem」是陈旧错误,导致渲染器跳过 listItem → 整列表渲空,L5 修复)。
  // 兼容三种子形态:① listItem 包装(权威);② 直接 paragraph/heading(V1 旧 atom);
  // ③ 直接嵌套 list。

  // 画一个列表项:首块画 bullet/number,后续块(嵌套 list / 多段)缩进续渲。
  const renderItem = async (blocks: Atom[]): Promise<number> => {
    const itemYStart = y;
    let drewMarker = false;
    for (const blk of blocks) {
      if (!blk) continue;
      if (blk.type === 'textBlock' || blk.type === 'paragraph' || blk.type === 'heading') {
        const { svg, height } = await renderIndentedTextBlock(blk, y, indent, innerWidth, links, defaultTextColor, baseFontSize, fontFamily);
        if (svg) parts.push(svg);
        // bullet/number 只在该 item 首块基线画一次(对齐 note:marker 对首行)
        if (!drewMarker) {
          await drawMarker(itemYStart);
          drewMarker = true;
        }
        y += height;
      } else if (blk.type === 'bulletList') {
        const { svg, height } = await renderList(blk, y, false, depth + 1, contentWidth, links, defaultTextColor, baseFontSize, fontFamily);
        if (svg) parts.push(svg);
        y += height;
      } else if (blk.type === 'orderedList') {
        const { svg, height } = await renderList(blk, y, true, depth + 1, contentWidth, links, defaultTextColor, baseFontSize, fontFamily);
        if (svg) parts.push(svg);
        y += height;
      }
      // 其他块(callout/math 嵌列表项)暂跳过,不破坏布局
    }
    return y - itemYStart;
  };

  // 在 item 首块基线画 bullet / number(颜色跟随主题色;字号/偏移随 base 缩放,L5)
  const drawMarker = async (markerYStart: number): Promise<void> => {
    const bulletFill = defaultTextColor ?? BULLET_FILL;
    const base = baseFontSize ?? SPEC_BASE_FONT_SIZE;
    const numberFontSize = NUMBER_FONT_SIZE * (base / SPEC_BASE_FONT_SIZE);
    const baselineY = markerYStart + base + 2;
    if (ordered) {
      const text = `${index}.`;
      const numX = indent - INDENT_PER_LEVEL + BULLET_X_OFFSET;
      const r = await textToPath(text, numberFontSize, numX, baselineY, bulletFill);
      if (r.svg) parts.push(r.svg);
    } else {
      const bulletDiameter = BULLET_DIAMETER * (base / SPEC_BASE_FONT_SIZE);
      const cx = indent - INDENT_PER_LEVEL + BULLET_X_OFFSET + bulletDiameter / 2;
      const cy = baselineY - base / 2 + 1;
      parts.push(circlePath(cx, cy, bulletDiameter / 2, bulletFill));
    }
  };

  for (const child of atom.content) {
    if (!child) continue;

    if (child.type === 'listItem') {
      // 权威结构:listItem > block+,整项缩进、首块画 marker
      const blocks = Array.isArray(child.content) ? child.content : [];
      await renderItem(blocks);
      index++;
    } else if (child.type === 'textBlock' || child.type === 'paragraph' || child.type === 'heading') {
      // V1 旧 atom:list 直接含 paragraph(无 listItem 包装)
      await renderItem([child]);
      index++;
    } else if (child.type === 'bulletList') {
      // 直接嵌套无序列表(无 listItem 包装的旧形态)
      const { svg, height } = await renderList(child, y, false, depth + 1, contentWidth, links, defaultTextColor, baseFontSize, fontFamily);
      if (svg) parts.push(svg);
      y += height;
    } else if (child.type === 'orderedList') {
      const { svg, height } = await renderList(child, y, true, depth + 1, contentWidth, links, defaultTextColor, baseFontSize, fontFamily);
      if (svg) parts.push(svg);
      y += height;
    }
    // 其他 block(如 callout / mathBlock 嵌入列表)暂跳过,不破坏布局
  }

  return { svg: parts.join(''), height: y - yOffset };
}

/**
 * 缩进版 textBlock:renderTextBlock 的内容统一向右平移 indent.
 * width 已收窄(由父级算好),内层 textBlock 在自己的 contentWidth 内 wrap.
 *
 * link bbox 处理:textBlock 在自己坐标系收集 link,本函数把 indent 加到 x
 * (与 SVG g transform 同步).
 */
async function renderIndentedTextBlock(
  atom: Atom,
  yOffset: number,
  indent: number,
  contentWidth: number,
  links?: LinkRect[],
  defaultTextColor?: string,
  baseFontSize?: number,
  fontFamily?: FontFamily,
): Promise<{ svg: string; height: number }> {
  // 用本地累加器接 textBlock 的 link,再批量加 indent 偏移到上层
  const localLinks: LinkRect[] | undefined = links ? [] : undefined;
  const { svg, height } = await renderTextBlock(atom, yOffset, contentWidth, localLinks, defaultTextColor, baseFontSize, fontFamily);
  if (links && localLinks) {
    for (const r of localLinks) {
      links.push({ ...r, x: r.x + indent });
    }
  }
  if (!svg) return { svg: '', height };
  // 包一层 transform(SVGLoader 解析嵌套 g 没问题)
  return {
    svg: `<g transform="translate(${indent}, 0)">${svg}</g>`,
    height,
  };
}

function circlePath(cx: number, cy: number, r: number, fill: string = BULLET_FILL): string {
  // SVG path: 圆 = M(cx-r,cy) a r r 0 1 0 (2r) 0 a r r 0 1 0 -(2r) 0
  return `<path d="M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0" fill="${fill}" />`;
}
