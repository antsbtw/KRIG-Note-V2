/**
 * ⭐⭐ textBox 内缩必须按**真实公式**算(用户 2026-09-11 问「是相对距离还是绝对值?」)
 *
 * 答案:roundRect 的 `rad = 0.15 × min(w, h)` —— 是**相对值**,但基准是
 * **宽高里较小的那个**。
 *
 * ⚠️ 我的宽度公式写成了 `w ≥ need / (1 − 2×0.15)`,等于假设内缩 = 0.3×**w**。
 * 而节点通常 h < w,真实内缩只有 0.3×h —— 于是白白多留一大截空白:
 * 实测「分支Achang123」框宽 326、文字仅 207、右侧富余 **88px**。
 * ⭐ 这段无用空白还有副作用:框被撑得过宽 → 盖住父节点连过来的曲线。
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

const renderWidth = (text: string, fontSize: number): number => {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    w += c >= 0x4e00 && c <= 0x9fff ? fontSize : fontSize * 0.6;
  }
  return w;
};

const TITLE = '分支Achang123';

const node = () => {
  const s = noteDocToTree({
    format: 'pm-doc-json', version: '0.1',
    payload: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, id: 'root' }, content: [{ type: 'text', text: '主题' }] },
      { type: 'heading', attrs: { level: 2, id: 'a' }, content: [{ type: 'text', text: TITLE }] },
      { type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'text', text: '123' }] },
    ] },
  });
  const g = new Map();
  const req = buildLayoutRequest(s, g);
  const layout: LayoutAnswer = { nodes: req.nodes.map((n, i) => ({ id: n.id, x: i * 400, y: i * 200 })) };
  return projectToInstances(s, g, layout).filter((i) => !isTreeLineId(i.id)).find((i) => i.id === 'a')!;
};

describe('textBox 内缩按真实公式', () => {
  it('⭐⭐ 标题仍然一行装得下(不能为了瘦身牺牲这条)', () => {
    const n = node();
    const fs = headingFontSize(2) * (n.text_size! / BLOCK_VISUAL_SPEC.body.fontSize);
    const rad = 0.15 * Math.min(n.size!.w, n.size!.h); // ⭐ 真实公式:min(w,h)
    expect(n.size!.w - 2 * rad).toBeGreaterThanOrEqual(renderWidth(TITLE, fs));
  });

  it('⭐⭐ 右侧富余不该过大(框被无谓撑宽会盖住父节点的连线)', () => {
    const n = node();
    const fs = headingFontSize(2) * (n.text_size! / BLOCK_VISUAL_SPEC.body.fontSize);
    const rad = 0.15 * Math.min(n.size!.w, n.size!.h);
    const slack = n.size!.w - 2 * rad - renderWidth(TITLE, fs);
    // 留 10% 误差余量是合理的;富余到半个标题宽就是公式算错了
    expect(slack, `富余 ${Math.round(slack)}px 过大 —— 内缩按 min(w,h) 不是按 w`).toBeLessThan(
      renderWidth(TITLE, fs) * 0.25,
    );
  });
});
