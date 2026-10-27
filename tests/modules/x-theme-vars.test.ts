/**
 * ⭐ X 面板在浅色主题下看得清(2026-10-26)
 *
 * 用户在 Windows 测试机(系统浅色)截图:「Windows的字体和界面有问题哦,看得不是很清楚」——
 * 人名 / 数字卡 / 右键菜单都是白底淡灰字。根因:X 模块用 --text-primary / --text-secondary / --border-color …
 * 这几个名字 theme.css 里没定义,一律落到写死的兜底色(#ddd / #aaa / #444,给深色背景配的);
 * Mac 是深色所以一直看着正常。
 *
 * 判据:X 模块用到的每个 var(--名字),浅色主题里都有定义(或模块自己就地定义了,如 --viz-series-1)。
 * 名字从源码扫出来,不写死清单 —— 以后新用一个没定义的名字会红。
 *
 * ⭐ 深色那一半(2026-10-27 补):发推预览窗写 var(--text-primary) 不带兜底 —— 这个名字只在浅色段有,
 *   深色下没兜底就掉到继承色,整窗字发暗看不清(用户 Mac 真机截图报的)。
 *   判据:不带兜底色的 var(--名字),深色段(:root)也要有定义(或模块自己就地定义)。带兜底的深色下用兜底,不管。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const X_DIR = join(ROOT, 'src/modules/x');
const X_SRC = readdirSync(X_DIR).filter((f) => /\.tsx?$/.test(f)).map((f) => readFileSync(join(X_DIR, f), 'utf8')).join('\n');
const THEME = readFileSync(join(ROOT, 'src/platform/renderer/theme.css'), 'utf8');
const LIGHT = THEME.slice(THEME.indexOf('[data-theme="light"] {'), THEME.indexOf('}', THEME.indexOf('[data-theme="light"] {')));

const DARK = THEME.slice(0, THEME.indexOf('[data-theme="light"] {'));
const used = [...new Set([...X_SRC.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]))].sort();
const definedIn = (css: string, name: string): boolean => new RegExp(`(^|[\\s;{])--${name}\\s*:`, 'm').test(css);

describe('X 面板的颜色变量在浅色主题里都有定义', () => {
  it('扫描本身没坏(扫到了 X 模块用的变量,切出了浅色那一段)', () => {
    expect(used.length).toBeGreaterThan(8);
    expect(used).toContain('text-primary');
    expect(LIGHT.length).toBeGreaterThan(500);
    expect(definedIn(LIGHT, 'bg-shell')).toBe(true);
  });
  it('⭐ 每个都有:浅色主题里定义了,或 X 模块自己就地定义了', () => {
    const missing = used.filter((n) => !definedIn(LIGHT, n) && !definedIn(X_SRC, n));
    expect(missing, `浅色主题里没定义(会落到给深色配的兜底色):${missing.join(' ')}`).toEqual([]);
  });
});

/** 不带兜底的 var(--名字) 里,深色段和 X 模块自己都没定义的 */
const darkMissing = (src: string): string[] =>
  [...new Set([...src.matchAll(/var\(--([a-z0-9-]+)\s*\)/g)].map((m) => m[1]))]
    .filter((n) => !definedIn(DARK, n) && !definedIn(src, n));

describe('X 面板不带兜底的颜色变量在深色主题里也有定义', () => {
  it('扫描本身没坏(切出了深色那一段)', () => {
    expect(definedIn(DARK, 'text-bright')).toBe(true);
    expect(definedIn(DARK, 'text-primary')).toBe(false);
  });
  it('自检:注入不带兜底的 var(--text-primary)(只浅色段有),要变红', () => {
    expect(darkMissing(`${X_SRC}\ncolor: 'var(--text-primary)'`)).toContain('text-primary');
  });
  it('⭐ 每个都有', () => {
    const missing = darkMissing(X_SRC);
    expect(missing, `深色主题里没定义又不带兜底(会掉到继承色):${missing.join(' ')}`).toEqual([]);
  });
});
