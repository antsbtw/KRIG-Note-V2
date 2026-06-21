/**
 * L5-G7.5 — 嵌入字体导出可移植性不变量(墙 3 收口验证)
 *
 * 核心证明:atomsToSvg / textToPath 的输出是**纯 `<path d="...">` 矢量轮廓**,
 * 字体在 loadFont→getPath 阶段就被栅格化成 path,**输出 SVG 里没有任何 <text> /
 * font-family / @font-face / font:// 引用**。
 *
 * → 三消费者(画板 TextRenderer / X 长图 / graph 截图)共用此管线,嵌入字体一处收口:
 *   导出 PNG/SVG、换机打开都是自包含轮廓,不依赖目标机装没装该字体 —— 墙 3「可移植」成立。
 *
 * 嵌入字体 fetch('font://') 在 node/vitest 无协议,无法端到端;此处用打包字体走**同一条
 * 代码路径**证明"输出无字体引用"的结构不变量,并单测 embed key 的 URL 推导。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { textToPath } from '../../src/lib/atom-serializers/svg/text-to-path';
import { isEmbedKey } from '../../src/lib/atom-serializers/svg/font-loader';

// node 里 fetch 不认 Vite `?url` 字体路径,也无 font:// 协议;统一 mock:
// 任何字体请求(打包路径 / font://)都回真 Inter-Regular.ttf 二进制。
// 这样 textToPath 走完整 loadFont→getPath 真渲染,断言输出结构不变量。
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  const fontPath = path.resolve(
    __dirname,
    '../../src/lib/atom-serializers/svg/fonts/Inter-Regular.ttf',
  );
  const buf = fs.readFileSync(fontPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(ab, { status: 200 });
  });
});
afterAll(() => fetchSpy.mockRestore());

describe('L5-G7.5:导出 SVG 纯 path 不变量(墙 3 可移植)', () => {
  it('textToPath 输出只含 <path>,无 <text>/font-family/font:// 引用', async () => {
    const { svg } = await textToPath('Hello Aa 123', 16, 0, 16);
    expect(svg).toContain('<path');
    // 关键:字体已栅格成 path,输出绝不含字体引用 → 换机/导出不丢字
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('font-family');
    expect(svg).not.toContain('@font-face');
    expect(svg).not.toContain('font://');
    expect(svg).not.toContain('embed:');
  });

  it('嵌入字体走同一栅格化路径:embed key 经 loadFont(font://)后输出仍是纯 path', async () => {
    fetchSpy.mockClear();
    const { svg } = await textToPath('Embed Aa', 16, 0, 16, '#fff', {
      fontFamily: 'embed:font-deadbeef',
    });
    // loadFont 应对嵌入 key 发出 font://font-deadbeef 请求(URL 推导正确)
    const fontUrlCalled = fetchSpy.mock.calls.some((c) =>
      String(c[0]).startsWith('font://font-deadbeef'),
    );
    expect(fontUrlCalled).toBe(true);
    // 输出仍是纯 path,无字体引用泄漏 → 导出/换机自包含
    expect(svg).toContain('<path');
    expect(svg).not.toContain('font://');
    expect(svg).not.toContain('embed:');
  });

  it('isEmbedKey:embed key 与打包 key 区分(loadFont 据此分流 font:// vs FONT_URLS)', () => {
    expect(isEmbedKey('embed:font-x')).toBe(true);
    expect(isEmbedKey('inter')).toBe(false);
  });
});
