/**
 * L5-G6c bug1 — atomsToSvg callout / blockquote 子内容不丢
 *
 * 背景:实机文字转 SVG 时 callout/blockquote 落 renderUnknownAtom → 降级 `[Callout]`/`[Quote]`
 * 占位,**丢全部子内容**。修复后递归渲染子块 + 装饰(quote 左竖条 / callout 圆角底框)。
 *
 * 验收:
 *  1. blockquote/callout 子段落文字渲染出 path(非占位);
 *  2. 输出含装饰 <rect>(quote 竖条 / callout 底框);
 *  3. 子内容字数多于占位 → path 数量随子内容增加(证未丢)。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomsToSvg } from '../../src/lib/atom-serializers/svg';
import type { Atom } from '../../src/lib/atom-serializers/types';

// 打包字体 fetch(Vite ?url 路径)在 node 不认 → mock 成真 Inter-Regular.ttf,
// 让 textToPath 走完整 loadFont→getPath(对齐 embed-font-export-invariant.test.ts）。
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  const fontPath = path.resolve(__dirname, '../../src/lib/atom-serializers/svg/fonts/Inter-Regular.ttf');
  const buf = fs.readFileSync(fontPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(ab, { status: 200 }));
});
afterAll(() => fetchSpy.mockRestore());

function para(text: string): Atom {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}
function countPaths(svg: string): number {
  return (svg.match(/<path/g) ?? []).length;
}
function countRects(svg: string): number {
  return (svg.match(/<rect/g) ?? []).length;
}

describe('L5-G6c bug1 — blockquote 子内容渲染', () => {
  it('blockquote 含段落 → 渲染子文字 path + 左竖条 rect,不降级占位', async () => {
    const quote: Atom = { type: 'blockquote', content: [para('ABCDEFGH'), para('IJKLMNOP')] };
    const svg = await atomsToSvg([quote]);
    expect(countRects(svg)).toBeGreaterThanOrEqual(1); // 左竖条
    expect(countPaths(svg)).toBeGreaterThan(0);        // 子文字成 path
    // 子内容比占位 [Quote](6 字)多得多:两段 16 字 → path 数显著更多
    const placeholder = await atomsToSvg([para('[Quote]')]);
    expect(countPaths(svg)).toBeGreaterThan(countPaths(placeholder));
  });

  it('空 blockquote → 0 高度,不崩', async () => {
    const svg = await atomsToSvg([{ type: 'blockquote', content: [] }]);
    expect(typeof svg).toBe('string');
  });
});

describe('L5-G6c bug1 — callout 子内容渲染', () => {
  it('callout 含段落 → 渲染子文字 path + 圆角底框 rect,不降级占位', async () => {
    const callout: Atom = {
      type: 'callout',
      attrs: { emoji: '' }, // 空 emoji → 退化小圆点(node 无 emoji 字体,避免回退缺失)
      content: [para('CALLOUTBODY')],
    };
    const svg = await atomsToSvg([callout]);
    expect(countRects(svg)).toBeGreaterThanOrEqual(1); // 圆角底框
    expect(countPaths(svg)).toBeGreaterThan(0);        // 子文字成 path
    const placeholder = await atomsToSvg([para('[Callout]')]);
    expect(countPaths(svg)).toBeGreaterThanOrEqual(countPaths(placeholder));
  });

  it('callout 嵌 mathBlock 子块也不丢(递归任意子块)', async () => {
    const callout: Atom = {
      type: 'callout',
      attrs: { emoji: '' },
      content: [{ type: 'mathBlock', content: [{ type: 'text', text: 'x^2' }] }],
    };
    const svg = await atomsToSvg([callout]);
    // math 渲染出 path(MathJax → path);至少底框 + 内容
    expect(countRects(svg)).toBeGreaterThanOrEqual(1);
    expect(svg.length).toBeGreaterThan(100);
  });
});
