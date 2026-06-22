/**
 * pickFontForChar fontFamily 覆盖 + CJK fallback 回归守护(L5-G5 / G5.6)
 *
 * 锁住关键不变量:Type section 选西文字体时,中文字符仍强制走中文字体(不丢字)。
 */
import { describe, it, expect } from 'vitest';
import {
  pickFontForChar,
  pickPackagedFallbackForChar,
  isSysnameKey,
} from '../../src/lib/atom-serializers/svg/font-loader';

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

  it('fontFamily=serif:西文走 Source Serif,中文走 Noto Serif SC(L5-G6 已打包)', () => {
    expect(pickFontForChar('a', { fontFamily: 'serif' })).toBe('sourceSerif');
    expect(pickFontForChar('好', { fontFamily: 'serif' })).toBe('notoSerifSc');
  });

  it('fontFamily=handwriting:西文走 Caveat,中文走 LXGW 文楷(L5-G6 已打包)', () => {
    expect(pickFontForChar('a', { fontFamily: 'handwriting' })).toBe('caveat');
    expect(pickFontForChar('字', { fontFamily: 'handwriting' })).toBe('lxgwWenKai');
  });

  it('serif/handwriting bold:无专属粗体文件 → 中文回退黑体 Bold,不伪粗', () => {
    expect(pickFontForChar('粗', { fontFamily: 'serif', bold: true })).toBe('notoSansScBold');
    expect(pickFontForChar('粗', { fontFamily: 'handwriting', bold: true })).toBe('notoSansScBold');
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

describe('L5-G7b:系统字体记名 sysname: 前缀', () => {
  it('sysname: 字体族 → 返回该 sysname key(西文 + 中文都先用系统字体)', () => {
    expect(pickFontForChar('a', { fontFamily: 'sysname:PingFang SC' })).toBe('sysname:PingFang SC');
    expect(pickFontForChar('中', { fontFamily: 'sysname:PingFang SC' })).toBe('sysname:PingFang SC');
  });

  it('bold + sysname: → 切粗体变体 key sysname:bold:<family>(L5-G7b bold 修复)', () => {
    // 修复前 bug:sysname 分支裸返回 family,无视 marks.bold → 编辑态点 B 不生效。
    // 修复后:bold 切到独立 key,loadFont 据此 IPC 取该 family 的 Bold style 文件。
    expect(pickFontForChar('a', { fontFamily: 'sysname:PingFang SC', bold: true }))
      .toBe('sysname:bold:PingFang SC');
    expect(pickFontForChar('中', { fontFamily: 'sysname:PingFang SC', bold: true }))
      .toBe('sysname:bold:PingFang SC');
  });

  it('bold 变体 key 仍是 sysname(isSysnameKey 真)', () => {
    expect(isSysnameKey('sysname:bold:PingFang SC')).toBe(true);
  });

  it('code mark 仍优先(系统字体不盖 code 语义)', () => {
    expect(pickFontForChar('x', { fontFamily: 'sysname:PingFang SC', code: true })).toBe('jetBrainsMono');
  });

  it('isSysnameKey 正确识别', () => {
    expect(isSysnameKey('sysname:PingFang SC')).toBe(true);
    expect(isSysnameKey('inter')).toBe(false);
    expect(isSysnameKey('notoSansSc')).toBe(false);
  });

  it('pickPackagedFallbackForChar:系统字体缺字 / 对方没装时的打包兜底(中文→notoSansSc,西文→inter)', () => {
    // 红线:回退必须落到**打包字体**(字符全覆盖,不乱码)。即便 marks 带 sysname,
    // fallback 也强制走打包(等价 auto 自动选字),保证不丢字不豆腐块。
    expect(pickPackagedFallbackForChar('中', { fontFamily: 'sysname:X Font' })).toBe('notoSansSc');
    expect(pickPackagedFallbackForChar('a', { fontFamily: 'sysname:X Font' })).toBe('inter');
    expect(pickPackagedFallbackForChar('粗', { fontFamily: 'sysname:X Font', bold: true })).toBe('notoSansScBold');
  });
});
