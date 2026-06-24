/**
 * L5 编辑↔渲染一致性专项 E4 — 轻量块渲染:horizontalRule / taskList / toggleList
 *
 * 背景:这三块原落 renderUnknownAtom → 降级占位 `---`/`[Tasks]`/`[Toggle]`。E4 补真渲染器
 * (矢量友好,接 svg/index dispatch + 读 block-visual-spec),消除「编辑能插渲染渲不出」黑洞。
 *
 * 验收:
 *  1. 各块渲染出几何(rect/path),非占位文字;
 *  2. taskList:已选项有 accent 填充 + 勾;未选有描边框;子文字渲染;
 *  3. toggleList:open 渲全部子块,closed 只渲首子(子块数差);箭头出 path;
 *  4. horizontalRule:一条线 rect。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomsToSvg } from '../../src/lib/atom-serializers/svg';
import type { Atom } from '../../src/lib/atom-serializers/types';

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
const countPaths = (svg: string): number => (svg.match(/<path/g) ?? []).length;
const countRects = (svg: string): number => (svg.match(/<rect/g) ?? []).length;

describe('E4 — horizontalRule', () => {
  it('渲染一条线 rect,不降级 `---` 占位', async () => {
    const svg = await atomsToSvg([{ type: 'horizontalRule' }], { width: 200 });
    expect(countRects(svg)).toBeGreaterThanOrEqual(1);
    // 占位会走 renderTextBlock 画 '---' 的 path;真线是 rect → 不含 '---' 文本路径占位
    expect(svg).toContain('<rect');
  });
});

describe('E4 — taskList', () => {
  it('未选项:描边空框 rect + 子文字 path', async () => {
    // 子文字用 ASCII(测试 font mock 是 Inter,CJK glyph 缺 → 不画 path)
    const atom: Atom = {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: false }, content: [para('buy milk')] }],
    };
    const svg = await atomsToSvg([atom], { width: 200 });
    expect(countRects(svg)).toBeGreaterThanOrEqual(1); // checkbox 框
    expect(countPaths(svg)).toBeGreaterThan(0);        // 子文字
    expect(svg).toContain('stroke=');                  // 未选 = 描边框
  });

  it('已选项:accent 填充框 + 对勾 path', async () => {
    const atom: Atom = {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: true }, content: [para('done')] }],
    };
    const svg = await atomsToSvg([atom], { width: 200 });
    expect(svg).toContain('#8ab4f8'); // accent 填充
    expect(countPaths(svg)).toBeGreaterThan(0); // 对勾 + 文字
  });

  it('已选项:文字灰色 #9aa0a6 + 删除线(对齐 note .checked)', async () => {
    const checked: Atom = {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: true }, content: [para('done task')] }],
    };
    const unchecked: Atom = {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: false }, content: [para('done task')] }],
    };
    const cSvg = await atomsToSvg([checked], { width: 200 });
    const uSvg = await atomsToSvg([unchecked], { width: 200 });
    expect(cSvg).toContain('#9aa0a6'); // 已完成文字灰(checkedColor)
    // 删除线:已选比未选多画线 path → path 数更多
    expect(countPaths(cSvg)).toBeGreaterThan(countPaths(uSvg));
  });

  it('多项:每项各画 checkbox', async () => {
    const atom: Atom = {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [para('A')] },
        { type: 'taskItem', attrs: { checked: true }, content: [para('B')] },
      ],
    };
    const svg = await atomsToSvg([atom], { width: 200 });
    expect(countRects(svg)).toBeGreaterThanOrEqual(2);
  });
});

describe('E4 — toggleList', () => {
  it('open:渲全部子块 + 箭头', async () => {
    const atom: Atom = {
      type: 'toggleList',
      attrs: { open: true },
      content: [para('title'), para('body1'), para('body2')],
    };
    const svg = await atomsToSvg([atom], { width: 200 });
    expect(countPaths(svg)).toBeGreaterThan(0); // 箭头 + 文字
  });

  it('closed:只渲首子(高度/path 少于 open)', async () => {
    const base: Atom = {
      type: 'toggleList',
      content: [para('title'), para('body1'), para('body2'), para('body3')],
    };
    const openSvg = await atomsToSvg([{ ...base, attrs: { open: true } }], { width: 200 });
    const closedSvg = await atomsToSvg([{ ...base, attrs: { open: false } }], { width: 200 });
    // closed 只渲首子 → path 数应少于 open(open 渲了 4 段文字 vs closed 1 段 + 箭头)
    expect(countPaths(closedSvg)).toBeLessThan(countPaths(openSvg));
  });
});
