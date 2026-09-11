/**
 * ⭐⭐ 高度估算必须覆盖 **textBox 的上下内缩**(真机日志定位)
 *
 * 日志实测 m002:
 *   轮1 估算130 contentH=90 insetY=39 → 需要137 → 撑到138
 *   轮2 估算138 contentH=90 insetY=41 → 需要139 → 撑到140
 *   轮3 估算140 contentH=90 insetY=42 → 需要140 → 停
 *
 * ⚠️⚠️ 两个问题:
 *  ① 我的 padY 只有 28,**没覆盖上下内缩**(实测 insetY≈42)
 *  ② ⭐ `insetY = 2 × 0.15 × min(w,h)` **随高度增长** →
 *     h 涨 → insetY 涨 → 需要的 h 又涨 → **自激**。
 *     日志里撑了 3 轮才收敛(+8, +2, 停),每一轮都是一次全节点重渲。
 *
 * ⭐ 只要估算一次就覆盖住,撑高**根本不触发**,自激也就不存在。
 */
import { describe, it, expect } from 'vitest';
import {
  buildLayoutRequest,
  projectToInstances,
  isTreeLineId,
  type LayoutAnswer,
} from '@capabilities/diglot-model/project-to-canvas';
import { noteDocToTree } from '@capabilities/diglot-model/note-projection';
import { BLOCK_VISUAL_SPEC, headingFontSize } from '../../../src/lib/visual-spec/block-visual-spec';

const LINE = BLOCK_VISUAL_SPEC.body.lineHeight;
const BODY = BLOCK_VISUAL_SPEC.body.fontSize;
const INSET_RATIO = 0.15;
const ADAPT_PADDING = 8; // NodeRenderer.adaptTextNodeSizeToContent

/** 真机那个节点:标题 + 一块正文 + 一块公式 */
const nodeWith = (bodyBlocks: number) => {
  const content: unknown[] = [
    { type: 'heading', attrs: { level: 1, id: 'root' }, content: [{ type: 'text', text: '主题' }] },
    { type: 'heading', attrs: { level: 2, id: 'a' }, content: [{ type: 'text', text: '分支Achang123' }] },
  ];
  for (let i = 0; i < bodyBlocks; i++) {
    content.push({ type: 'paragraph', attrs: { id: `b${i}` }, content: [{ type: 'text', text: '123' }] });
  }
  const s = noteDocToTree({ format: 'pm-doc-json', version: '0.1', payload: { type: 'doc', content } });
  const g = new Map();
  const req = buildLayoutRequest(s, g);
  const layout: LayoutAnswer = { nodes: req.nodes.map((n, i) => ({ id: n.id, x: i * 400, y: i * 300 })) };
  return projectToInstances(s, g, layout).filter((i) => !isTreeLineId(i.id)).find((i) => i.id === 'a')!;
};

describe('高度覆盖 textBox 上下内缩', () => {
  for (const blocks of [0, 1, 2, 3]) {
    it(`⭐⭐ ${blocks} 块正文:估算高 ≥ 内容高 + 上下内缩 + 撑高阈值`, () => {
      const n = nodeWith(blocks);
      const h = n.size!.h;

      // 渲染层的内容高(与 textBlock.ts 同公式)
      const contentH =
        Math.round(headingFontSize(2) * LINE) + Math.round(BODY * LINE) * blocks;
      // ⚠️ insetY 以**最终高度**为基准 —— 这正是自激的来源
      const insetY = 2 * INSET_RATIO * Math.min(n.size!.w, h);

      expect(
        h,
        `估算 ${h} < 需要 ${Math.ceil(contentH + insetY) + ADAPT_PADDING} → 会触发撑高(日志实测撑了 3 轮)`,
      ).toBeGreaterThanOrEqual(Math.ceil(contentH + insetY) + ADAPT_PADDING);
    });
  }

  it('⭐⭐ 不自激:按估算高算出的 insetY,仍然装得下', () => {
    // ⚠️ 自激判据:用**撑高后**的 h 反算 insetY,若又超了就会再撑一轮
    const n = nodeWith(2);
    const h = n.size!.h;
    const contentH = Math.round(headingFontSize(2) * LINE) + Math.round(BODY * LINE) * 2;
    const insetY = 2 * INSET_RATIO * Math.min(n.size!.w, h);
    const need = Math.ceil(contentH + insetY) + ADAPT_PADDING;
    expect(need, '一轮之后仍需再撑 → 自激,每轮都是一次全节点重渲').toBeLessThanOrEqual(h);
  });
});
