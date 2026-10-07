/**
 * ⭐⭐ 每个业务模块都要「删一行就卸载」
 *
 * 用户 2026-09-30 拍板的方向:
 * 「所有的模块都努力做大松耦合,可卸载才更好」
 *
 * ── 与 `x-module-detachable.test.ts` 的分工 ──
 *
 * 那条只钉 X(它正在重建,形态未定,还多钉了四类残留);
 * **本条钉全部 7 个 view**,判据统一:目录之外认识它的地方 ≤ 1(那一行 self-register)。
 *
 * ── 为什么能立这条 ──
 *
 * 实测(2026-09-30):跨 view 引用 = **0**,view 早已是自注册。
 * 补上「命令也自注册」(commit 9156164f)之后,7 个模块全部降到 1 处 ——
 * 所以这条守卫是在**已经达标**的状态下立的,不欠任何 KNOWN_DEBT。
 *
 * ⚠️ 它防的是**将来**:下一个人给某个 view 加一处跨模块 import 时当场变红,
 * 而不是等到哪天想拆模块时才发现拆不动(X 就是这么长成 1516 行 handler 的)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** 受本守卫约束的业务模块(= src/views 下的 view 目录) */
const MODULES = ['note', 'web', 'ebook', 'ai', 'mail', 'graph-canvas-view', 'thought'] as const;

/**
 * ⚠️ 剥注释 —— 注释里提到别的模块是**正常且有价值**的
 * (如 `use-note-list.ts:7` 写「N-2 合规:不依赖 @views/note/…」——
 * 那句话恰恰在说明它**没有**依赖,若当成违规就是把好注释判成 bug)。
 *
 * ⚠️⚠️ 行注释正则必须是 `(^|[^:])//` —— 否则 `https://` 里的 `//`
 * 会把整段 URL 连同后面的代码吃掉(feedback-guard-stripper-eats-urls)。
 */
const strip = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function listSources(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listSources(full));
    else if (/\.(ts|tsx|mts)$/.test(e.name)) out.push(full);
  }
  return out;
}

const allSources = listSources(SRC).map((p) => ({
  path: relative(ROOT, p),
  code: strip(readFileSync(p, 'utf-8')),
}));

/**
 * ⭐ 模块路径段后面必须是**边界**(`/` 或引号)。
 * 少了这条,`import '@views/web'`(末尾无斜杠、正是 self-register 的写法)
 * 会整条逃过 —— 同族第七刀实测过(feedback-guard-caught-what-tsc-cannot)。
 */
const refRe = (m: string): RegExp =>
  new RegExp(`['"][^'"]*@?views/${m}(?:/|(?=['"]))`);

/** 模块目录之外、引用了该模块的文件 */
function referrers(m: string): string[] {
  const own = `src/views/${m}/`;
  return allSources
    .filter(({ path }) => !path.startsWith(own))
    .filter(({ code }) => refRe(m).test(code))
    .map(({ path }) => path);
}

describe('⭐⭐ 每个模块:目录之外认识它的地方 ≤ 1', () => {
  it('前提自检:确实扫到了源码(否则整段空转)', () => {
    expect(allSources.length, '一个源文件都没扫到 —— 守卫在空转').toBeGreaterThan(200);
  });

  it('前提自检:每个模块目录真的存在(改名会让守卫静默恒绿)', () => {
    const missing = MODULES.filter((m) => !existsSync(join(SRC, 'views', m)));
    expect(missing, '这些模块目录不见了 —— 请更新 MODULES 清单').toEqual([]);
  });

  it('前提自检:判据能命中 self-register 那一行(末尾无斜杠)', () => {
    expect(refRe('web').test(`import '@views/web';`), 'self-register 写法逃过了判据').toBe(true);
    expect(refRe('web').test(`import { a } from '@views/web/web-commands';`)).toBe(true);
  });

  it('前提自检:不误伤注释与相邻同名', () => {
    // 注释里提到别的模块是正常的(且常常恰恰在说明「不依赖」)
    expect(refRe('note').test(strip(`// 不依赖 @views/note/use-notes-folders`))).toBe(false);
    // `@views/web` 不该命中 `@views/web-console`(前缀相同但不是同一个模块)
    expect(refRe('web').test(`import '@views/web-console';`), '前缀误伤:web 命中了 web-console').toBe(false);
  });

  it.each(MODULES)('⭐ %s:删掉它只需删一行', (m) => {
    const refs = referrers(m);
    expect(
      refs,
      `\n⭐ 原则(用户 2026-09-30):模块要能「删一个目录 + 删一行注册」就卸载。\n`
      + `${m} 被 ${refs.length} 处认识,超过 1 处就删不干净。\n`
      + `改法:让该模块在自己的 registerView({ ... }) 里自注册\n`
      + `(命令走 commands 字段、全局副作用直接写在 index.ts),\n`
      + `宿主只保留唯一一行 import '@views/${m}'。\n`,
    ).toHaveLength(1);
  });

  it('⭐ 那一处必须是 renderer 的 self-register,不是随便谁', () => {
    /**
     * ⚠️ 只数「≤1」不够:若那一处是**别的 view** 引用它,
     * 数字一样是 1,但模块之间就耦上了(而现在跨 view 引用是 0,要守住)。
     */
    const wrong: string[] = [];
    for (const m of MODULES) {
      for (const r of referrers(m)) {
        if (r !== 'src/platform/renderer/index.tsx') wrong.push(`${m} ← ${r}`);
      }
    }
    expect(
      wrong,
      '模块被 renderer 之外的地方引用 —— 跨模块耦合(实测 2026-09-30 本仓为 0,别破坏它):\n  '
      + wrong.join('\n  '),
    ).toEqual([]);
  });
});
