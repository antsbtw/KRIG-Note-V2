/**
 * L5 编辑↔渲染一致性 — list 渲染 listItem 包装结构(真机 bug 回归)
 *
 * 真机暴露:画板节点末尾的无序列表整块没渲(bullet + 文字全丢)。根因 = note schema
 * 是 bulletList > **listItem** > paragraph(content:'listItem+'),而 renderList 原只认
 * 直接 paragraph/heading 子,跳过 listItem → 整列表渲空。本测守 listItem 包装结构能渲。
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

const countPaths = (svg: string): number => (svg.match(/<path/g) ?? []).length;
function li(text: string): Atom {
  return { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

describe('list — listItem 包装结构(note 权威 schema)', () => {
  it('bulletList > listItem > paragraph:渲文字 + bullet 圆点(非空)', async () => {
    const atom: Atom = { type: 'bulletList', content: [li('item one'), li('item two')] };
    const svg = await atomsToSvg([atom], { width: 200 });
    // 文字 path + bullet circle path 都在 → 不再整块渲空
    expect(countPaths(svg)).toBeGreaterThan(0);
    // 两项 → 至少两个 bullet 圆点(circlePath 产 <path>)
    expect(countPaths(svg)).toBeGreaterThanOrEqual(2);
  });

  it('orderedList > listItem > paragraph:渲序号 1. 2.', async () => {
    const atom: Atom = { type: 'orderedList', content: [li('first'), li('second')] };
    const svg = await atomsToSvg([atom], { width: 200 });
    expect(countPaths(svg)).toBeGreaterThan(0);
  });

  it('混合:paragraph + 末尾 bulletList(真机场景)整块都在', async () => {
    const atoms: Atom[] = [
      { type: 'paragraph', content: [{ type: 'text', text: 'head' }] },
      { type: 'bulletList', content: [li('tail list')] },
    ];
    const svg = await atomsToSvg(atoms, { width: 200 });
    // head 段 + 列表项文字 + bullet → path 数明显 > 0(原 bug:列表块整丢)
    expect(countPaths(svg)).toBeGreaterThan(1);
  });

  it('V1 兼容:bulletList 直接含 paragraph(无 listItem)仍渲', async () => {
    const atom: Atom = {
      type: 'bulletList',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'legacy' }] }],
    };
    const svg = await atomsToSvg([atom], { width: 200 });
    expect(countPaths(svg)).toBeGreaterThan(0);
  });
});
