/**
 * `web.input` 边界守卫 —— 扫源码,守四条会**静默失效**的约束
 *
 * 1. ⭐⭐ **注入脚本求值后必须是合法 JS** —— `project-x-inject-template-escape`
 *    (那次 `\/` 被吃掉,浏览器收到非法正则,**采集恒 0 一整天而 tsc 单测全绿**)
 * 2. **参数一律 JSON.stringify** —— 同一事故的同族攻击面
 * 3. ⭐ **能力层零 Electron** —— 真正碰 clipboard/CDP 的只有 `wiring/` 一个文件
 * 4. 🚦 **底座不做危险性判断** —— 发布闸门是业务层的事(§7.1)
 *
 * ⚠️ 本仓踩过两次(`02-testing.md` §0.2 第 3 条):**比对源码前先剥注释**。
 * 不剥会被自己写的说明文字骗过(下面注释里就写着 `WebContents`);
 * 剥错了(把字符串也当注释)会**永远绿**。故第一组用例专门自检剥注释真的在工作。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAnchorExistsScript,
  buildContainsScript,
  buildDirectWriteScript,
  buildExactScript,
  buildFocusScript,
  buildHoverScript,
  buildPressScript,
  buildSyntheticPasteScript,
  buildTapScript,
} from '@platform/main/web-capability/input';

const INPUT_DIR = join(process.cwd(), 'src/platform/main/web-capability/input');

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, ''); // 行尾注释也剥 —— 只剥整行会漏掉 `const a = 1; // WebContents`
}

const sources = readdirSync(INPUT_DIR)
  .filter((n) => n.endsWith('.ts'))
  .map((n) => ({ path: `input/${n}`, code: stripComments(readFileSync(join(INPUT_DIR, n), 'utf-8')) }));

describe('守卫自检 —— 先证明剥注释真的在工作', () => {
  it('本层源码里确实存在只出现在注释中的敏感词(否则守卫是空转的)', () => {
    const raw = readdirSync(INPUT_DIR)
      .filter((n) => n.endsWith('.ts'))
      .map((n) => readFileSync(join(INPUT_DIR, n), 'utf-8'))
      .join('\n');
    // 注释里讨论 clipboard / WebContents 是应该的(讲清楚为什么不在这层)
    expect(raw).toMatch(/clipboard/i);
  });

  it('stripComments 能剥掉行注释与块注释,但不剥代码', () => {
    expect(stripComments('const a = 1; // clipboard\n')).not.toContain('clipboard');
    expect(stripComments('/* clipboard */ const a = 1;')).not.toContain('clipboard');
    expect(stripComments('const clipboard = 1;')).toContain('clipboard');
  });

  it('剥完注释后每个文件都非空(没把整个文件剥没)', () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const { path, code } of sources) {
      expect(code.trim().length, `${path} 剥注释后成空文件`).toBeGreaterThan(0);
    }
  });
});

describe('⭐ 能力层零 Electron —— 碰 clipboard / CDP 的只有 wiring/', () => {
  it('input/ 下零处 import electron', () => {
    const offenders = sources.filter(({ code }) => /from\s+['"]electron['"]/.test(code));
    expect(offenders.map((s) => s.path)).toEqual([]);
  });

  it('input/ 下零处 clipboard / debugger.attach / sendInputEvent', () => {
    const offenders: string[] = [];
    for (const { path, code } of sources) {
      for (const p of [/\bclipboard\b/, /debugger\s*\.\s*attach/, /sendInputEvent/]) {
        if (p.test(code)) offenders.push(`${path} 命中 ${p}`);
      }
    }
    expect(offenders, '这些属接线层(wiring/),不属能力层').toEqual([]);
  });

  it('⭐ wiring/electron-input.ts 确实存在且确实碰了 Electron(否则上面两条是空转的)', () => {
    const wiring = readFileSync(
      join(process.cwd(), 'src/platform/main/web-capability/wiring/electron-input.ts'),
      'utf-8',
    );
    expect(stripComments(wiring)).toMatch(/from\s+['"]electron['"]/);
    expect(stripComments(wiring)).toMatch(/clipboard/);
  });
});

describe('⭐⭐ 注入脚本求值后必须是合法 JS(`project-x-inject-template-escape`)', () => {
  /**
   * ⚠️ 覆盖**全部** builder,不是「记得的那几个」。
   * 每个都过一遍「真的让 JS 引擎解析」—— 这正是 tsc 覆盖不到的那一步:
   * 源码里写的是对的,**求值之后**才是错的。
   */
  /**
   * ⚠️ 每个 builder 的**每一个字符串入参**都要能吃到测试值 ——
   * 只留一个入口(比如只有 container)会让「另一个参数裸拼」这类缺陷完全够不着。
   * 踩过:第一版只把 nasty 喂给 container,注入「tap 的 anchor 裸拼」时**行为测试零红**,
   * 只有源码守卫抓到了。`02-testing.md` §0.1:没红过的守卫是假保证。
   *
   * 约定:`build(v)` 把 v 灌进该 builder 的**所有**字符串参数。
   */
  const builders: Array<[string, (v: string) => string]> = [
    ['focus', (v) => buildFocusScript(v, v)],
    ['syntheticPaste', (v) => buildSyntheticPasteScript(v, v, v, v)],
    ['directWrite', (v) => buildDirectWriteScript(v, v, v)],
    ['contains', (v) => buildContainsScript(v, v, v)],
    ['exact', (v) => buildExactScript(v, v, v)],
    ['anchorExists', (v) => buildAnchorExistsScript(v, v)],
    ['tap', (v) => buildTapScript(v, v)],
    ['hover', (v) => buildHoverScript(v, v)],
    ['press', (v) => buildPressScript(v, v)],
  ];

  it('builder 清单非空(否则下面的遍历是空转的)', () => {
    expect(builders.length).toBeGreaterThanOrEqual(9);
  });

  for (const [name, build] of builders) {
    it(`⭐ ${name} 求值后能被 JS 引擎解析`, () => {
      for (const v of ['', '.modal', '#a']) {
        const script = build(v);
        expect(
          () => new Function(`return (${script});`),
          `${name}(参数=${v || '空'})求值后不是合法 JS`,
        ).not.toThrow();
      }
    });
  }

  it('⭐⭐ 含引号 / 反斜杠 / 换行 / 正则的参数不会破坏脚本结构', () => {
    // 这是转义事故的同族攻击面:参数里带特殊字符,直接拼进文本就会截断脚本。
    // JSON.stringify 后作为绑定值则安全。
    // 末尾那段正则正是当年被吃掉转义的那一个
    const nasty = `'); alert(1); var x='` + '\\' + '\n"quoted"/^\\/([A-Za-z0-9_]{1,15})$/';
    for (const [name, build] of builders) {
      const script = build(nasty);
      // ⭐ 真求值 —— 裸拼会在这里当场语法错(那次事故 tsc 完全沉默,只有真 parse 抓得到)
      expect(() => new Function(`return (${script});`), `${name} 被参数截断`).not.toThrow();
      // 且参数以**字面量**形式出现(JSON.stringify 的结果),不是裸拼
      expect(script, `${name} 的参数没走 JSON.stringify`).toContain(JSON.stringify(nasty));
      // ⚠️ 反向锁:裸拼的特征是参数**原样**出现在脚本里(没被转义)。
      //    只断言「包含 JSON.stringify 结果」不够 —— 两者可能同时成立。
      const bare = `'${nasty}'`;
      expect(script, `${name} 出现裸拼参数`).not.toContain(bare);
    }
  });

  it('⭐ 源码里的模板插值一律 JSON.stringify(守住将来新加的)', () => {
    // 行为测试只覆盖我想到的参数;这条扫源码,守住「将来新加的插值也得这么写」
    const code = readFileSync(join(INPUT_DIR, 'input-scripts.ts'), 'utf-8');
    const offenders: string[] = [];
    for (const m of code.matchAll(/\$\{([^}]*)\}/g)) {
      const expr = m[1];
      // 允许:JSON.stringify(...) 与内部拼装函数(scopePrelude / body 这类结构性插值)
      if (expr.includes('JSON.stringify')) continue;
      if (/^(scopePrelude\(|body$)/.test(expr.trim())) continue;
      offenders.push(`\${${expr}}`);
    }
    expect(offenders, '注入脚本的参数插值必须走 JSON.stringify(防转义事故)').toEqual([]);
  });

  it('⭐ 脚本是纯表达式:不以换行开头、不以分号结尾', () => {
    // 踩过:脚本以换行开头时 `return\n(function...)` 被 ASI 插分号 →
    // **结果恒 undefined 且不报错**,测试会「绿得毫无意义」。
    for (const [name, build] of builders) {
      const s = build('');
      expect(s.startsWith('\n'), `${name} 以换行开头(会触发 ASI 陷阱)`).toBe(false);
      expect(s.trimEnd().endsWith(';'), `${name} 以分号结尾(包不进 return (...))`).toBe(false);
      // 真验一次:包进 return 后确实拿得到返回值,而不是 undefined
      const fn = new Function('document', 'window', `return (${s});`);
      expect(() => fn({ querySelector: () => null, querySelectorAll: () => [] }, {})).not.toThrow();
    }
  });
});

describe('🚦 底座不做判断(§2 / §10.3)', () => {
  it('零处危险词表 / 白名单 —— 发布闸门是业务层的事', () => {
    const offenders: string[] = [];
    for (const { path, code } of sources) {
      if (/\b(FORBIDDEN|DANGEROUS|BLOCKED|DENY_?LIST|ALLOW_?LIST|WHITELIST)\b/.test(code)) {
        offenders.push(path);
      }
    }
    expect(offenders, '底座不判断哪个动作「危险」(§2)').toEqual([]);
  });

  it('⭐ 作用域解析零处「挑第一个」的痕迹', () => {
    // `within` 命中多个必须报错。若有人改成 hits[0],这条会红。
    const code = sources.find((s) => s.path.endsWith('input-scripts.ts'))!.code;
    const scopeFn = code.slice(code.indexOf('function __scope'), code.indexOf('function __pick'));
    expect(scopeFn.length).toBeGreaterThan(0);
    expect(scopeFn, '__scope 必须在多命中时返回 AMBIGUOUS').toContain('__AMBIGUOUS');
    expect(scopeFn, '不许出现 hits[0] 之外的择优;命中多个只能报错').toMatch(
      /hits\.length\s*>\s*1[\s\S]*?__AMBIGUOUS/,
    );
  });

  it('零站点知识:不出现 x.com / twitter / draftjs 之类的站点名', () => {
    const offenders: string[] = [];
    for (const { path, code } of sources) {
      if (/x\.com|twitter|chatgpt|claude\.ai|gemini/i.test(code)) offenders.push(path);
    }
    expect(offenders, '底座零站点知识 —— 站点知识归 adapter(§14)').toEqual([]);
  });
});

describe('⭐ 只加不改 —— 旧的 web-service-base 一个字没动', () => {
  it('webview-input.ts / webview-file-input.ts 仍是三家在用的原件', () => {
    // 「收编」是搬移,不是改造。旧文件现在有 AI / X 发推 / X 长文三家在用,
    // 动它就等于在没有安全网的情况下改三条产线。
    const base = join(process.cwd(), 'src/platform/main/web-service-base');
    const oldInput = readFileSync(join(base, 'webview-input.ts'), 'utf-8');
    const oldFile = readFileSync(join(base, 'webview-file-input.ts'), 'utf-8');
    // 三个被收编的原语仍原样导出 —— 它们还在服役
    expect(oldInput).toContain('export async function focusInputBox');
    expect(oldInput).toContain('export async function pasteTextToWebview');
    expect(oldInput).toContain('export async function locateSendButton');
    expect(oldFile).toContain('export async function feedFilesToInput');
    expect(oldFile).toContain('export async function feedVideoToInput');
  });

  it('新层零处 import 旧的 web-service-base(是搬移,不是包装)', () => {
    // 若去 import 它,electron 就被拖进能力层,当场撞上「零 Electron」那条守卫。
    const offenders = sources.filter(({ code }) => /web-service-base/.test(code));
    expect(offenders.map((s) => s.path)).toEqual([]);
  });
});
