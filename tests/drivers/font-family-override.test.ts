/**
 * pickFontForChar fontFamily 覆盖 + CJK fallback 回归守护(L5-G5 / G5.6)
 *
 * 锁住关键不变量:Type section 选西文字体时,中文字符仍强制走中文字体(不丢字)。
 */
import { describe, it, expect } from 'vitest';
import { pickFontForChar } from '../../src/lib/atom-serializers/svg/font-loader';

describe('pickFontForChar fontFamily 覆盖(G5.6)', () => {
  it('无覆盖:维持自动选字(西文 inter / 中文 notoSansSc)', () => {
    expect(pickFontForChar('a')).toBe('inter');
    expect(pickFontForChar('中')).toBe('notoSansSc');
  });

  it('fontFamily=mono:西文走 jetBrainsMono', () => {
    expect(pickFontForChar('a', { fontFamily: 'mono' })).toBe('jetBrainsMono');
  });

  it('fontFamily=mono:中文仍走中文字体(不丢字 — mono 无中文字形)', () => {
    expect(pickFontForChar('中', { fontFamily: 'mono' })).toBe('notoSansSc');
  });

  it('fontFamily=serif(本期未打包):西文优雅回退 inter,不报错', () => {
    expect(pickFontForChar('a', { fontFamily: 'serif' })).toBe('inter');
  });

  it('fontFamily=serif:中文仍走中文字体', () => {
    expect(pickFontForChar('好', { fontFamily: 'serif' })).toBe('notoSansSc');
  });

  it('fontFamily=auto:等同无覆盖', () => {
    expect(pickFontForChar('a', { fontFamily: 'auto' })).toBe('inter');
    expect(pickFontForChar('字', { fontFamily: 'auto' })).toBe('notoSansSc');
  });

  it('bold + fontFamily=sans:西文走 interBold;中文走 notoSansScBold', () => {
    expect(pickFontForChar('A', { fontFamily: 'sans', bold: true })).toBe('interBold');
    expect(pickFontForChar('粗', { fontFamily: 'sans', bold: true })).toBe('notoSansScBold');
  });

  it('code mark 优先于 fontFamily(语义不被字体族盖)', () => {
    expect(pickFontForChar('x', { fontFamily: 'serif', code: true })).toBe('jetBrainsMono');
  });
});
