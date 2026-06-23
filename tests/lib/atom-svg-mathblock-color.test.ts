// @vitest-environment jsdom
/**
 * L5 编辑↔渲染一致性 — mathBlock 颜色读 attrs.color(对齐 note NodeView)
 *
 * note math-block NodeView 用 attrs.color 渲 KaTeX 文本色(spec.ts color attr;
 * node-view.ts: rendered.style.color = color || '')。渲染态原 renderMathBlock 只读
 * defaultTextColor、漏 attrs.color → 用户给数学块上色不生效。本测守 attrs.color 优先。
 */
import { describe, it, expect } from 'vitest';
import { atomsToSvg } from '../../src/lib/atom-serializers/svg';
import type { Atom } from '../../src/lib/atom-serializers/types';

describe('mathBlock 颜色 — attrs.color 优先', () => {
  it('attrs.color 设值 → math 用该色(覆盖默认/defaultTextColor)', async () => {
    const atom: Atom = { type: 'mathBlock', attrs: { color: '#ff0000' }, content: [{ type: 'text', text: 'x^2' }] };
    const svg = await atomsToSvg([atom], { width: 200, defaultTextColor: '#222' });
    expect(svg).toContain('#ff0000');  // attrs.color 胜出
    expect(svg).not.toContain('#222'); // defaultTextColor 被覆盖
  });

  it('attrs.color=null → 回落 defaultTextColor', async () => {
    const atom: Atom = { type: 'mathBlock', attrs: { color: null }, content: [{ type: 'text', text: 'x^2' }] };
    const svg = await atomsToSvg([atom], { width: 200, defaultTextColor: '#222' });
    expect(svg).toContain('#222');
  });

  it('无 attrs.color 无 defaultTextColor → 默认浅色 #e8eaed', async () => {
    const atom: Atom = { type: 'mathBlock', content: [{ type: 'text', text: 'x^2' }] };
    const svg = await atomsToSvg([atom], { width: 200 });
    expect(svg).toContain('#e8eaed');
  });
});
