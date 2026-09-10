/**
 * heading-toggle 布局不变量守卫(静态)
 *
 * 三角是「悬在标题文字左缘外」的,⋮⋮ 手柄必须再往左让位 —— 这条对齐 Notion
 * 的布局横跨三个文件,任何一处单独改都会让两者**视觉重叠**,而重叠既不报错
 * 也不会被任何运行时测试发现(node 环境无排版)。这里把它钉住:
 *
 *   1. 三角显不显 与 handle 让不让位 —— 必须同一判据(hasCollapsibleContent),
 *      否则「三角显了但 handle 没让」= 压在一起。
 *   2. CSS 里三角的左偏移 与 handle 让位的像素 —— 必须一致。
 *
 * ⚠️ 用 stripComments 读源码:注释里写着反模式/示例是常事,
 *    「用注释里的说明骗过守卫」是明令禁止的(见 tests/helpers/source-scan.ts)。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { stripComments } from '../helpers/source-scan';

const REPO = path.resolve(__dirname, '../..');
const HANDLE = 'src/drivers/text-editing-driver/plugins/build-block-handle-plugin.ts';
const TOGGLE = 'src/drivers/text-editing-driver/plugins/build-heading-toggle-plugin.ts';
const CSS = 'src/drivers/text-editing-driver/pm-host.css';

function readCode(rel: string): string {
  return stripComments(fs.readFileSync(path.join(REPO, rel), 'utf-8'));
}

/**
 * 读 CSS 并**剥掉注释**。
 *
 * ⚠️ 踩过:本文件的 CSS 注释里把两条死路原样写成 `height: 1.7em` / `height: 1lh`
 * 当反面教材,不剥注释的守卫会匹配到**自己的文档**而误报(真实 height 是 22px)。
 * 与 stripComments 的立意同源 —— 注释里的反面教材不算数。
 */
function readCss(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

describe('heading-toggle 与 block-handle 的让位不变量', () => {
  it('两边都用 hasCollapsibleContent 作判据(不各判各的)', () => {
    expect(readCode(TOGGLE)).toContain('hasCollapsibleContent');
    expect(readCode(HANDLE)).toContain('hasCollapsibleContent');
  });

  it('handle 定位时真的减去了让位量(不是只声明了常量没用)', () => {
    const code = readCode(HANDLE);
    // 常量存在
    expect(code).toMatch(/HEADING_TOGGLE_RESERVE\s*:\s*\d+/);
    // 且被 left 计算实际消费
    const leftLine = code
      .split('\n')
      .find((l) => l.includes('const leftAbs'));
    expect(leftLine, 'leftAbs 计算行应存在').toBeTruthy();
    expect(leftLine!).toContain('reserve');
  });

  it('CSS 三角左偏移 == handle 让位像素(数值一致,不然重叠或裂缝)', () => {
    const handleCode = readCode(HANDLE);
    const reserve = Number(
      /HEADING_TOGGLE_RESERVE\s*:\s*(\d+)/.exec(handleCode)?.[1],
    );
    expect(Number.isFinite(reserve)).toBe(true);

    const css = fs.readFileSync(path.join(REPO, CSS), 'utf-8');
    // 取 .krig-heading-toggle 规则块里的 left: -Npx
    const block = /\.krig-heading-toggle\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(block, '.krig-heading-toggle 规则块应存在').toBeTruthy();
    const cssLeft = Number(/left:\s*-(\d+)px/.exec(block!)?.[1]);
    expect(Number.isFinite(cssLeft)).toBe(true);

    expect(cssLeft).toBe(reserve);
  });

  it('折叠态三角常驻可见(CSS 有 --collapsed 的 opacity:1 规则)', () => {
    const css = fs.readFileSync(path.join(REPO, CSS), 'utf-8');
    const block = /\.krig-heading-toggle--collapsed\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(block, '--collapsed 规则块应存在').toBeTruthy();
    expect(block!).toMatch(/opacity:\s*1/);
  });

  it('三角字号与 toggleList 的 ▶ 一致(用户要求"至少一样大")', () => {
    const css = fs.readFileSync(path.join(REPO, CSS), 'utf-8');
    const arrow = /\.krig-toggle-list__arrow\s*\{([^}]*)\}/.exec(css)?.[1];
    const glyph = /\.krig-heading-toggle::before\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(arrow, 'toggleList 箭头规则应存在').toBeTruthy();
    expect(glyph, '三角 ::before 规则应存在').toBeTruthy();
    const arrowSize = Number(/font-size:\s*(\d+)px/.exec(arrow!)?.[1]);
    const glyphSize = Number(/font-size:\s*(\d+)px/.exec(glyph!)?.[1]);
    expect(glyphSize).toBe(arrowSize);
  });

  it('三角用实心 ▶/▼(与 toggleList 同字形;空心 ▸/▾ 同字号下明显更小)', () => {
    const css = fs.readFileSync(path.join(REPO, CSS), 'utf-8');
    const glyph = /\.krig-heading-toggle::before\s*\{([^}]*)\}/.exec(css)?.[1];
    const collapsed = /\.krig-heading-toggle--collapsed::before\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(glyph!).toContain('▼');
    expect(collapsed!).toContain('▶');
  });

  it('⚠️ 垂直居中不得退回 em/lh 量行高 —— 两者都按本元素字号解析(实测踩过)', () => {
    const css = readCss(CSS);
    const block = /\.krig-heading-toggle\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    // height 若写成 1.7em / 1lh,居中会落在标题上部(Electron 40 实测中心 y=11 应为 35.3)
    expect(
      /height:\s*[\d.]*(em|lh)\b/.test(block),
      'height 不可用 em/lh 表达标题行高 —— 它们解析的是三角自己的 font-size,\n' +
        '  正解:外壳继承标题字号,top: calc(padding + 0.85em) + translateY(-50%)',
    ).toBe(false);
    // 外壳不得设 font-size(它要继承标题字号才能用 em 量行高)
    expect(
      /font-size:/.test(block),
      '外壳不可设 font-size —— 设了 em 就不再是标题字号,居中即失效;\n' +
        '  字形大小请设在 ::before 上',
    ).toBe(false);
    expect(block).toMatch(/translateY\(-50%\)/);
  });

  it('三角不进文档流(absolute 定位)—— 否则标题文字横移、整篇重排', () => {
    const css = fs.readFileSync(path.join(REPO, CSS), 'utf-8');
    const block = /\.krig-heading-toggle\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(block!).toMatch(/position:\s*absolute/);
  });
});
