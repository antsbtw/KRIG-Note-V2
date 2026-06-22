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

  // NoteView schema(权威源):bulletList/orderedList content='block+',
  // 子元素直接是 paragraph/heading/嵌套 list,**没有 listItem 中间层**.
  // 序列化器适配此结构:每个 paragraph/heading child = 一个列表项,嵌套 list 缩进递归.
  // (兼容旧 atom 'textBlock' 命名)
  for (const child of atom.content) {
    if (!child) continue;
    const childYStart = y;

    if (child.type === 'textBlock' || child.type === 'paragraph' || child.type === 'heading') {
      const { svg, height } = await renderIndentedTextBlock(child, y, indent, innerWidth, links, defaultTextColor, baseFontSize, fontFamily);
      if (svg) parts.push(svg);

      // 在文本基线位置画 bullet / number(baselineY 与 textBlock 内 baseline 算法一致)
      // bullet/number 颜色跟随节点主题色(Sticky 黄底深色,默认 note 文字色 #e8eaed)
      const bulletFill = defaultTextColor ?? BULLET_FILL;
      // L5 一致性 E3:序号字号 / baseline 偏移随实际 base 缩放(原硬编码 14 → 大字号 bullet 错位)。
      const base = baseFontSize ?? SPEC_BASE_FONT_SIZE;
      const numberFontSize = NUMBER_FONT_SIZE * (base / SPEC_BASE_FONT_SIZE);
      const baselineY = childYStart + base + 2;
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

      y += height;
      index++;
    } else if (child.type === 'bulletList') {
      // 嵌套无序列表:缩进 +1 级,index 不增,可用宽度也收窄
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
