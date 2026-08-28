/**
 * NavSide 一致性 —— 守卫测试
 *
 * 堵的是这个洞:**view 没有 NavSide 内容,却在 ActivityBar 里占了个 tab,
 * 于是左边杵着一栏空白**(里面只有「NavSide (待 view 注册内容)」占位)。
 *
 * 2026-08-28 用户实拍 mail view 的这一栏空白。当时 mail **已经**声明了
 * `navSideDisabled: true`,但那个 flag 只被 ActivityBar 用来「禁止点已激活 tab
 * 展开」,管不到渲染;真正负责收起的 `navSideOnSwitch: 'collapse'` 又只在
 * handleSwitch 里生效(= 用户点 tab 切过来的那一次),view 靠恢复会话状态 /
 * slot 重建等路径成为活跃时根本不跑。已改成由 navSideDisabled 直接把关渲染。
 *
 * 但**修了渲染不等于堵住了洞**:新 view 若忘了声明 flag,照样渲染空白栏。
 * 没有守卫的话,这种缺陷只能靠人眼在截图里发现 —— mail 就是这么被发现的。
 *
 * ## 为什么不干脆「自动检测有没有内容」把 flag 废掉
 *
 * 最直觉的修法是别要 flag,直接看 navSideRegistry 里有没有内容。但 navSide 内容是
 * **运行时注册**的,注册时机不保证早于首帧 —— 「registry 还没注册完」和
 * 「这个 view 本来就没内容」在首帧长得一模一样,结果是 note 启动时闪一下没有
 * NavSide 再弹出来。用抖动换掉一栏空白不划算。故 flag 保留,改用静态守卫兜住。
 *
 * ## 断言
 *
 * 1. 进 ActivityBar(有 navSideTab)的 view,要么有 navSide 内容注册,
 *    要么显式声明 navSideDisabled: true —— 二者必居其一
 * 2. 声明了 navSideDisabled 却又注册了内容 = 自相矛盾(内容永远显示不出来)
 * 3. 守卫锚点还在(navSideDisabled 仍被渲染路径消费)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve(__dirname, '../../src');
const VIEWS = path.join(SRC, 'views');

interface ViewInfo {
  dir: string;
  /** 该 view 目录下所有源码拼接(用于判定注册了什么) */
  code: string;
  hasNavSideTab: boolean;
  hasNavSideDisabled: boolean;
  registersNavSideContent: boolean;
}

/**
 * 剥掉块注释 / 行注释(整行换成空白,不保留内容)。
 *
 * ⚠️ 这一步是**必须**的,不是洁癖:本守卫第一版没剥注释,结果
 * `src/views/mail/index.ts` 顶部的文档注释里写着
 * 「navSideDisabled: true —— 本 view 无 NavSide 内容」,正则把这行注释
 * 当成了真实声明 —— 我故意删掉真代码里那行做反向验证,守卫**依然全绿**。
 * 兄弟守卫 slot-resource-guard 的注释里早就写了这一课(它的文档里故意写着
 * 反模式的样子),我第一版没吸取。
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** 递归读一个 view 目录下的全部 .ts/.tsx 源码(已剥注释) */
function readViewSources(dir: string): string {
  let out = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out += readViewSources(full);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out += stripComments(fs.readFileSync(full, 'utf-8')) + '\n';
    }
  }
  return out;
}

function collectViews(): ViewInfo[] {
  return fs
    .readdirSync(VIEWS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(VIEWS, e.name);
      const code = readViewSources(dir);
      return {
        dir: e.name,
        code,
        // navSideTab: { … } 出现在 registerView 里 = 这个 view 进 ActivityBar
        hasNavSideTab: /navSideTab\s*:\s*\{/.test(code),
        hasNavSideDisabled: /navSideDisabled\s*:\s*true/.test(code),
        registersNavSideContent: /navSideRegistry\s*\.\s*register\s*\(/.test(code),
      };
    });
}

const ALL_VIEWS = collectViews();

describe('NavSide 守卫 — 不许在 ActivityBar 里摆一栏空白', () => {
  it('进 ActivityBar 的 view:要么有 NavSide 内容,要么声明 navSideDisabled', () => {
    const offenders = ALL_VIEWS.filter(
      (v) => v.hasNavSideTab && !v.registersNavSideContent && !v.hasNavSideDisabled,
    );
    expect(
      offenders.length,
      offenders.length === 0
        ? ''
        : `\n以下 view 会在左侧摆一栏空白 NavSide:\n` +
          offenders.map((v) => `  src/views/${v.dir}/`).join('\n') +
          `\n\n→ 二选一:\n` +
          `   ① 这个 view 本来就没有 NavSide 内容(webview 类居多):\n` +
          `      在 registerView 的 navSideTab 里加 navSideDisabled: true\n` +
          `      (通常还要配 navSideOnSwitch: 'collapse')\n` +
          `   ② 它应该有内容:补 navSideRegistry.register({ view: '<id>', … })\n\n` +
          `  只声明 navSideOnSwitch: 'collapse' **不够** —— 那只在用户点 tab 切过来的\n` +
          `  那一次生效,靠恢复会话状态 / slot 重建成为活跃时不跑,空白栏照样出现。\n`,
    ).toBe(0);
  });

  it('navSideDisabled 与「注册了内容」不得同时成立(自相矛盾)', () => {
    const contradictory = ALL_VIEWS.filter(
      (v) => v.hasNavSideDisabled && v.registersNavSideContent,
    );
    expect(
      contradictory.length,
      contradictory.length === 0
        ? ''
        : `\n以下 view 既声明 navSideDisabled 又注册了 NavSide 内容,` +
          `注册的内容永远显示不出来:\n` +
          contradictory.map((v) => `  src/views/${v.dir}/`).join('\n') +
          `\n\n→ 想清楚要哪个:有内容就去掉 navSideDisabled,没内容就别注册。\n`,
    ).toBe(0);
  });

  it('守卫锚点:navSideDisabled 仍被渲染路径消费', () => {
    // 反向断言 —— 若哪天有人把渲染处那道 !navSideDisabled 判断删了,
    // 上面两条会"因为无事可查而全绿",守卫静默失效(见 memory
    // feedback-verify-guard-can-fail:掏空抽象层后测试仍全绿 = 假保证)。
    const instance = fs.readFileSync(
      path.join(SRC, 'workspace', 'workspace-instance', 'WorkspaceInstance.tsx'),
      'utf-8',
    );
    expect(
      /!navSideDisabled/.test(instance),
      'WorkspaceInstance 里的 `!navSideDisabled &&` 渲染判断不见了 —— ' +
        'navSideDisabled 退化成只管 ActivityBar 的 toggle,空白栏会卷土重来。',
    ).toBe(true);
  });
});
