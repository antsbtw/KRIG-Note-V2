/**
 * L5 一致性(2026-06-23 真机三改)— codeBlock 半透明底 / 自动换行 / 语法高亮
 *
 * - 半透明:codeBgOpacity<1 → bg rect 带 fill-opacity。
 * - 换行:codeWrap=true → 长行按等宽断成多视觉行(高度增加)。
 * - 高亮:atom.attrs._syntaxTokens(上层注入的纯数据)→ 按 tag→色 上色(spec.code.syntax)。
 * - 降级:无 tokens → 纯色码字(不崩)。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomsToSvg } from '../../src/lib/atom-serializers/svg';
import { BLOCK_VISUAL_SPEC } from '../../src/lib/visual-spec/block-visual-spec';
import type { Atom } from '../../src/lib/atom-serializers/types';

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  const fp = path.resolve(__dirname, '../../src/lib/atom-serializers/svg/fonts/Inter-Regular.ttf');
  const buf = fs.readFileSync(fp);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(ab, { status: 200 }));
});
afterAll(() => fetchSpy.mockRestore());

function code(text: string, attrs: Record<string, unknown> = {}): Atom {
  return { type: 'codeBlock', attrs, content: [{ type: 'text', text }] };
}
const reHeight = (svg: string): number => {
  const m = /<svg[^>]*height="([\d.]+)"/.exec(svg);
  return m ? parseFloat(m[1]) : 0;
};

describe('codeBlock — 半透明底', () => {
  it('codeBgOpacity<1 → bg rect 带 fill-opacity', async () => {
    const svg = await atomsToSvg([code('hi')], { width: 300, codeBgOpacity: 0.7 });
    expect(svg).toMatch(/<rect[^>]*fill="#2a2a2a"[^>]*fill-opacity="0.7"/);
  });
  it('默认(不传)→ 不透明,无 fill-opacity(X 路径不变)', async () => {
    const svg = await atomsToSvg([code('hi')], { width: 300 });
    expect(svg).toContain('fill="#2a2a2a"');
    expect(svg).not.toContain('fill-opacity');
  });
});

describe('codeBlock — 自动换行', () => {
  it('codeWrap=true 长行 → 断成多视觉行(高度 > 不换行)', async () => {
    const longLine = 'x'.repeat(200); // 远超窄宽
    const wrapped = await atomsToSvg([code(longLine)], { width: 160, codeWrap: true });
    const noWrap = await atomsToSvg([code(longLine)], { width: 160, codeWrap: false });
    expect(reHeight(wrapped)).toBeGreaterThan(reHeight(noWrap));
  });
});

describe('codeBlock — 语法高亮(注入 _syntaxTokens)', () => {
  it('tokens 命中 → 该段用 spec 配色;无 token 段用默认码字色', async () => {
    // "let x" → 'let'(0-3)keyword 蓝;其余默认
    const atom = code('let x', { _syntaxTokens: [{ from: 0, to: 3, tag: 'keyword' }] });
    const svg = await atomsToSvg([atom], { width: 300 });
    expect(svg).toContain(BLOCK_VISUAL_SPEC.code.syntax.keyword); // #569cd6
    expect(svg).toContain(BLOCK_VISUAL_SPEC.code.textColor);      // 默认段 #e8eaed
  });

  it('未知 tag → 回落默认码字色(不崩)', async () => {
    const atom = code('abc', { _syntaxTokens: [{ from: 0, to: 3, tag: 'nope_unknown' }] });
    const svg = await atomsToSvg([atom], { width: 300 });
    expect(svg).toContain(BLOCK_VISUAL_SPEC.code.textColor);
  });

  it('无 _syntaxTokens → 纯色码字(降级)', async () => {
    const svg = await atomsToSvg([code('plain code')], { width: 300 });
    expect(svg).toContain(BLOCK_VISUAL_SPEC.code.textColor);
  });
});
