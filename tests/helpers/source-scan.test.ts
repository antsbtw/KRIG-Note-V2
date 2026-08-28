/**
 * source-scan 工具自身的测试
 *
 * 为什么工具也要测:两个静态守卫的**全部可信度**都建立在 stripComments 正确上。
 * 它一旦剥错(把真代码当注释吃掉 / 把注释当真代码留下),守卫就会给出假保证 ——
 * 2026-08-28 的 navside 守卫第一版就是因为剥注释不到位而全绿的。
 * 守卫保护业务代码,这条保护守卫。
 */

import { describe, it, expect } from 'vitest';
import { stripComments } from './source-scan';

describe('stripComments', () => {
  it('剥掉行注释与块注释', () => {
    const out = stripComments(`const a = 1; // 注释\n/* 块\n注释 */\nconst b = 2;`);
    expect(out).not.toContain('注释');
    expect(out).toContain('const a = 1;');
    expect(out).toContain('const b = 2;');
  });

  it('保留行号(行数不变)', () => {
    const src = `line1\n// c\n/* a\nb */\nline5`;
    expect(stripComments(src).split('\n')).toHaveLength(src.split('\n').length);
  });

  it('不误伤字符串里的 // —— 后面的真代码必须留下', () => {
    // 这正是正则版的致命伤:`const real = 1;` 会被整段吃掉。
    // 被吃掉的代码里若含违规,守卫查不到 = 假保证。
    const out = stripComments(`const s = "a // b"; const real = 1;`);
    expect(out).toContain('const real = 1;');
    expect(out).toContain('"a // b"');
  });

  it('不误伤模板串 / 单引号里的 //', () => {
    expect(stripComments('const s = `p // q`; const real = 3;')).toContain('const real = 3;');
    expect(stripComments(`const s = 'x // y'; const real = 4;`)).toContain('const real = 4;');
  });

  it('不误伤 URL 里的 //', () => {
    const out = stripComments(`const u = "https://example.com/x"; const real = 5;`);
    expect(out).toContain('const real = 5;');
    expect(out).toContain('https://example.com/x');
  });

  it('字符串里的 /* 不会开启块注释态', () => {
    const out = stripComments(`const s = "x /* y"; const real = 6;`);
    expect(out).toContain('const real = 6;');
  });

  it('转义引号不会提前结束字符串态', () => {
    const out = stripComments(`const s = "a\\" // still string"; const real = 7;`);
    expect(out).toContain('const real = 7;');
  });

  it('注释里的代码样例不会被当成真声明(守卫踩过的坑)', () => {
    // navside 守卫第一版栽在这:mail/index.ts 顶部注释里写着
    // 「navSideDisabled: true —— 本 view 无 NavSide 内容」,被正则当成了真声明。
    const src = `/**\n * - navSideDisabled: true —— 说明文字\n */\nregisterView({ id: 'x' });`;
    expect(/navSideDisabled\s*:\s*true/.test(stripComments(src))).toBe(false);
  });
});
