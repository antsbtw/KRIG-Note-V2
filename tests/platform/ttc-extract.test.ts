/**
 * L5-G7.1 — ttc-extract shim 单测
 *
 * 验证纯 JS ttc 拆解(救 CJK 系统字体的关键)能把 .ttc 子字体重组成
 * opentype 可解析的独立 sfnt。结构性断言用合成 buffer(CI 可跑、不依赖系统字体);
 * 真实 .ttc → getPath 端到端验证仅在本机有该字体时跑(否则跳过,不让 CI 红)。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as opentype from 'opentype.js';
import { isTtc, ttcFontCount, extractSfntFromTtc } from '@platform/main/fonts/ttc-extract';

/** 构造一个最小合法 ttc 头(numFonts 个子字体,offset 指向给定 sfnt 偏移) */
function makeTtcHeader(subFontOffsets: number[]): Buffer {
  const n = subFontOffsets.length;
  const buf = Buffer.alloc(12 + n * 4);
  buf.write('ttcf', 0, 'ascii');
  buf.writeUInt16BE(1, 4); // majorVersion
  buf.writeUInt16BE(0, 6); // minorVersion
  buf.writeUInt32BE(n, 8); // numFonts
  subFontOffsets.forEach((off, i) => buf.writeUInt32BE(off, 12 + i * 4));
  return buf;
}

describe('ttc-extract: 签名与计数', () => {
  it('isTtc 认 ttcf 头,拒非 ttc', () => {
    expect(isTtc(makeTtcHeader([16, 32]))).toBe(true);
    const ttf = Buffer.alloc(12);
    ttf.writeUInt32BE(0x00010000, 0); // TrueType sfnt version
    expect(isTtc(ttf)).toBe(false);
    expect(isTtc(Buffer.alloc(2))).toBe(false); // 太短
  });

  it('ttcFontCount 读 numFonts;非 ttc 抛错', () => {
    expect(ttcFontCount(makeTtcHeader([16, 32, 48]))).toBe(3);
    expect(() => ttcFontCount(Buffer.alloc(12))).toThrow(/not a ttc/);
  });

  it('extractSfntFromTtc 越界 fontIndex 抛错', () => {
    const ttc = makeTtcHeader([16]);
    expect(() => extractSfntFromTtc(ttc, 5)).toThrow(/out of range/);
    expect(() => extractSfntFromTtc(ttc, -1)).toThrow(/out of range/);
  });

  it('非 ttc buffer 抛错', () => {
    expect(() => extractSfntFromTtc(Buffer.alloc(12), 0)).toThrow(/not a ttc/);
  });
});

/**
 * 端到端:本机真实 .ttc → 抽子字体 → opentype.parse → getPath。
 * 找一个本机存在的 CJK .ttc(Hiragino / STHeiti);找不到则跳过(CI 友好)。
 */
function findRealCjkTtc(): string | null {
  const candidates = [
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

describe('ttc-extract: 真实 .ttc 端到端(本机有 CJK ttc 才跑)', () => {
  const real = findRealCjkTtc();
  it.skipIf(!real)('抽出的子字体可被 opentype.parse + getPath 出真实字形', () => {
    const buf = fs.readFileSync(real as string);
    expect(isTtc(buf)).toBe(true);
    const count = ttcFontCount(buf);
    expect(count).toBeGreaterThan(0);

    // 抽第 0 个子字体
    const ab = extractSfntFromTtc(buf, 0);
    const font = opentype.parse(ab);
    expect(font.names).toBeTruthy();

    // CJK 字形存在(charToGlyphIndex !== 0 = 非 .notdef)
    const gi = font.charToGlyphIndex('测');
    expect(gi).not.toBe(0);

    // getPath 出真实路径命令(导出管线靠这个)
    const path = font.getPath('测试Aa', 0, 0, 16);
    expect(path.commands.length).toBeGreaterThan(0);
  });
});
