/**
 * horizontalRule → 水平分隔线(L5 编辑↔渲染一致性专项 E4)
 *
 * note pm-host.css `.krig-horizontal-rule`:border-top 1px solid #444,margin 1.5em 0。
 * 渲染态画一条 1px 横线,上下留 marginY 空白(对齐 note 视觉)。
 *
 * schema:leaf atom(无 content),attrs 仅 id/bookAnchor。
 */
import { BLOCK_VISUAL_SPEC } from '../../../visual-spec/block-visual-spec';

export function renderHorizontalRule(
  yOffset: number,
  contentWidth: number,
): { svg: string; height: number } {
  const { thickness, color, marginY } = BLOCK_VISUAL_SPEC.horizontalRule;
  // 线居中在上下 margin 之间;总高 = marginY*2 + thickness
  const lineY = yOffset + marginY;
  const svg =
    `<rect x="0" y="${lineY}" width="${contentWidth}" height="${thickness}" fill="${color}" />`;
  return { svg, height: marginY * 2 + thickness };
}
