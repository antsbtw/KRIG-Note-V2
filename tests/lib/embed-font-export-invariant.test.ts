/**
 * L5-G7b — 系统字体记名 + 导出可移植性不变量(墙 3 收口验证,策略转向版)
 *
 * 转向(L5-G7b):画板**只记字体名**(text_font='sysname:<family>'),**不嵌入字体本体**。
 * 本机渲染 / 导出时按名经 IPC(fontReadByName)读 buffer outline。本测证明:
 *
 *  1) 导出 SVG 输出是**纯 `<path d="...">` 矢量轮廓**,无 `<text>`/font-family/@font-face/
 *     font:// 引用 —— 字体在 loadFont→getPath 阶段栅格成 path,导出产物自包含(墙 3:换机/
 *     清缓存打开字不乱;唯导出时本机 outline 进产物,几乎免费)。
 *  2) **对方没装该系统字体(fontReadByName 返回 null)→ 回退打包字体,字正常显示不乱码、
 *     不豆腐块**(L5-G7b 新卖点核心:回退落到打包字体,字符全覆盖)。
 *  3) 装了该字体时:loadFont 按 family 名经 fontReadByName 取 buffer(无 font:// 协议)。
 *
 * 三消费者(画板 TextRenderer / X 长图 / graph 截图)共用 atomsToSvg→textToPath→loadFont,
 * 嵌入一处收口,自动一致。
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { textToPath } from '../../src/lib/atom-serializers/svg/text-to-path';
import { isSysnameKey } from '../../src/lib/atom-serializers/svg/font-loader';

// 打包字体 fetch(Vite `?url` 路径)在 node 里不认 → 统一 mock 成真 Inter-Regular.ttf,
// 让 textToPath 走完整 loadFont→getPath 真渲染。
let fetchSpy: ReturnType<typeof vi.spyOn>;
let interBuf: ArrayBuffer;

beforeAll(() => {
  const fontPath = path.resolve(
    __dirname,
    '../../src/lib/atom-serializers/svg/fonts/Inter-Regular.ttf',
  );
  const buf = fs.readFileSync(fontPath);
  interBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(interBuf, { status: 200 });
  });
});
afterAll(() => fetchSpy.mockRestore());

/** 默认:模拟"系统没装任何被选字体"——fontReadByName 永远返回 null(回退打包) */
beforeEach(() => {
  (globalThis as unknown as { window?: unknown }).window = {
    electronAPI: { fontReadByName: vi.fn(async () => null) },
  };
});

describe('L5-G7b:导出 SVG 纯 path 不变量(墙 3 可移植)', () => {
  it('textToPath 输出只含 <path>,无 <text>/font-family/font:// 引用', async () => {
    const { svg } = await textToPath('Hello Aa 123', 16, 0, 16);
    expect(svg).toContain('<path');
    // 关键:字体已栅格成 path,输出绝不含字体引用 → 换机/导出不丢字
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('font-family');
    expect(svg).not.toContain('@font-face');
    expect(svg).not.toContain('font://');
    expect(svg).not.toContain('sysname:');
  });

  it('对方没装该系统字体 → 回退打包字体,仍输出纯 path(不乱码/不豆腐块,新卖点核心)', async () => {
    // fontReadByName 返回 null(没装)→ splitByFont 每字符回退打包字体
    const { svg } = await textToPath('Hello 世界', 16, 0, 16, '#fff', {
      fontFamily: 'sysname:Nonexistent Family',
    });
    // 仍渲染出真实 path(打包 Inter / Noto 兜底),非空、非 tofu
    expect(svg).toContain('<path');
    expect(svg).not.toContain('sysname:');
    expect(svg).not.toContain('font://');
  });

  it('装了该系统字体:loadFont 按 family 名经 fontReadByName 取 buffer(无 font:// 协议)', async () => {
    const readByName = vi.fn(async () => interBuf);
    (globalThis as unknown as { window: { electronAPI: { fontReadByName: unknown } } }).window = {
      electronAPI: { fontReadByName: readByName },
    };
    const { svg } = await textToPath('Embed Aa', 16, 0, 16, '#fff', {
      fontFamily: 'sysname:My Font',
    });
    // 按 family 名问主进程要 buffer(URL 推导/协议都没了,纯 IPC by-name)
    expect(readByName).toHaveBeenCalledWith('My Font');
    // 输出仍纯 path,无字体引用泄漏 → 导出/换机自包含
    expect(svg).toContain('<path');
    expect(svg).not.toContain('font://');
    expect(svg).not.toContain('sysname:');
  });

  it('isSysnameKey:sysname key 与打包 key 区分(loadFont 据此分流 IPC vs FONT_URLS)', () => {
    expect(isSysnameKey('sysname:PingFang SC')).toBe(true);
    expect(isSysnameKey('inter')).toBe(false);
  });
});
