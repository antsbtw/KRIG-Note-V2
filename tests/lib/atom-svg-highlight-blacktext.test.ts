/**
 * L5 编辑↔渲染一致性 — highlight mark 黑字对齐 note
 *
 * note highlight.ts:黄/浅底强制黑字 #000(dark theme 默认浅字叠浅黄底不可读)。
 * 渲染态原只画黄底、文字仍浅色 → 与编辑态不一致(且可读性差)。本测守渲染态
 * highlight 文字色 = #000,且默认色仍是黄底(highlight mark 无 color attr 时)。
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

describe('highlight mark — 黄底黑字对齐 note', () => {
  it('highlight 文字(ASCII)渲染黄底 + 黑字 path', async () => {
    const atom: Atom = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'hi', marks: [{ type: 'highlight' }] }],
    };
    const svg = await atomsToSvg([atom], { width: 200 });
    // 默认黄底(highlight mark 无 color → 'yellow')
    expect(svg).toContain('fill="yellow"');
    // 文字 path 强制黑字 #000(不再浅字)
    expect(svg).toContain('fill="#000"');
  });

  it('highlight.color 显式色保留,文字仍黑字', async () => {
    const atom: Atom = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'hi', marks: [{ type: 'highlight', attrs: { color: '#aaffaa' } }] }],
    };
    const svg = await atomsToSvg([atom], { width: 200 });
    expect(svg).toContain('fill="#aaffaa"'); // 自定义底色
    expect(svg).toContain('fill="#000"');    // 黑字
  });
});
