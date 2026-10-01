/**
 * ⭐⭐ X 是可装卸模块 —— 主程序只准认识它一次
 *
 * 用户 2026-09-30 拍板(`docs/handoff/x-module-boundary-principle.md`):
 * 「x 模块是一个完全独立的模块,可以很简单的卸载和安装。
 * 　底层 web 的控制、输入、输出部分函数共用。
 * 　只有属于 x 的特殊部分函数才为它特有。」
 *
 * ── 为什么现在建,而不是写完代码再建 ──
 *
 * 现在 X 目录是空的,「X 之外认识 X 的地方」**真的是 0**。
 * 这是唯一一次能让守卫从零开始长的时机 —— 之后每加一处违规都当场变红。
 *
 * ⚠️ 反过来(先写代码后补守卫)就是老路:上一版守卫建立时已有 23 处违规,
 * 只能全部写进 KNOWN_DEBT,而本仓的 KNOWN_DEBT **从来没有被清掉过**。
 *
 * ── 这条守卫与 `web-capability/layering-direction.test.ts` 的分工 ──
 *
 * 那条拦「底座 → 业务」(底座 import X);
 * 本条拦**反方向**「主程序 → X」(谁把 X 焊死在宿主里)。
 * ⭐ 反方向从来没有守卫,而**它才是拔不掉的成因** ——
 * 推倒前实测 17 文件 23 处引用 X。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** ⭐ X 模块自己的地盘 —— 这些目录**内部**互相引用是正常的,不算违规 */
const X_OWN_DIRS = [
  'src/modules/x',            // ⭐ 重建后的目标形态:一个目录自带一切
  'src/platform/main/x',      // 旧形态(推倒后为空,留着让守卫在过渡期也有效)
  'src/views/x',
  'src/capabilities/x-extraction',
];

/**
 * ⚠️ 剥注释 —— 否则本文件说明里的 `main/x/` 会让守卫永远红。
 *
 * ⚠️⚠️ 行注释正则必须写成 `(^|[^:])//` —— 前面不是冒号。
 * 否则 `https://x.com` 里的 `//` 被当注释开头,**整段 URL 连同后面的代码一起被吃掉**
 * → 扫 URL/引用的守卫永远假绿(`feedback-guard-stripper-eats-urls`,实测栽过)。
 */
const strip = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** ⭐ 给 strip 本身加自检 —— 记忆里那一刀就是 strip 悄悄坏掉造成的 */
describe('前提:剥注释函数自身正确', () => {
  it('不吃 URL 里的双斜杠', () => {
    const kept = strip(`const u = 'https://x.com/home'; import { a } from './main/x/b';`);
    expect(kept, 'URL 被吃掉了 —— 后面的 import 也会一起消失,守卫将永远假绿')
      .toContain('main/x/b');
    expect(kept).toContain('https://x.com/home');
  });
  it('确实剥掉真注释', () => {
    expect(strip(`// from './main/x/dead'\nlive`)).not.toContain('main/x/dead');
    expect(strip(`/* from './main/x/dead' */ live`)).not.toContain('main/x/dead');
  });
});

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

const allSources = listSources(SRC).map((p) => {
  const rel = relative(ROOT, p);
  return { path: rel, code: strip(readFileSync(p, 'utf-8')) };
});

/** X 目录之外的源码 —— 守卫的扫描面 */
const outsideX = allSources.filter(
  ({ path }) => !X_OWN_DIRS.some((d) => path.startsWith(d + '/')),
);

/**
 * ⭐ 找出「认识 X」的引用。
 *
 * 判据是**引用路径**,不是出现 x 这个字母 —— 否则 `box` / `max` / `index`
 * 全都命中,守卫会淹死在噪音里(`feedback-guard-hardcoded-list-never-grows`
 * 的反面:清单不能写死,但判据也不能宽到无意义)。
 *
 * ⚠️ 三种写法都要拦:
 *  · 相对路径  `from './x/…'` / `from '../main/x/…'`
 *  · 别名      `from '@platform/main/x/…'`
 *  · **副作用 import**(无 from)—— tsc 查不出来,删 X 时靠它炸了 vite
 */
/**
 * ⭐ 一段模块路径,末尾必须是**边界**(`/` 或引号)——
 * 这样 `x` / `x-extraction` 命中,而 `xz-util` / `index` 不会。
 *
 * ⚠️⚠️ 初版我把边界写成**只有** `\/`,于是
 * `import '@capabilities/x-extraction';`(**末尾没有斜杠**)整条逃过 ——
 * 而那正是**副作用 import**、tsc 查不出来、删 X 时炸了 vite 的那一种。
 * 注入自检当场把它抓出来(这就是自检存在的意义)。
 */
const X_SEG = `(?:x|x-extraction)(?:\\/|(?=['"]))`;

const X_REF = [
  // 具名:from '…/x/…' · '…/x-extraction' · '@modules/x'
  new RegExp(`from\\s+['"][^'"]*(?:\\/|^)${X_SEG}`),
  new RegExp(`from\\s+['"][^'"]*modules\\/${X_SEG}`),
  // ⭐ 副作用 import(无 from)—— tsc 看不见它
  new RegExp(`^\\s*import\\s+['"][^'"]*(?:\\/|^)${X_SEG}`, 'm'),
  new RegExp(`^\\s*import\\s+['"][^'"]*modules\\/${X_SEG}`, 'm'),
];

function xReferrers(): { path: string; hit: string }[] {
  const out: { path: string; hit: string }[] = [];
  for (const { path, code } of outsideX) {
    for (const re of X_REF) {
      const m = code.match(re);
      if (m) { out.push({ path, hit: m[0].trim() }); break; }
    }
  }
  return out;
}

describe('⭐⭐ X 目录之外,认识 X 的地方 ≤ 1(那一行注册)', () => {
  it('前提自检:确实扫到了源码(否则整段空转)', () => {
    /**
     * ⚠️ 不是凑数 —— 目录改名会让 listSources 返回空数组,
     * 而空数组让下面每条断言恒为真 → **整段假绿**。本仓栽过六次同族。
     */
    expect(allSources.length, '一个源文件都没扫到 —— 守卫在空转').toBeGreaterThan(200);
    expect(outsideX.length, 'X 之外一个文件都没有 —— 扫描面算错了').toBeGreaterThan(200);
  });

  it('前提自检:守卫的判据真的能命中(注入验证)', () => {
    /**
     * ⭐ 按 `feedback-verify-guard-can-fail`:守卫必须证明自己**能红**。
     * 这里不改真文件,直接喂三种写法给判据,确认每种都被认出来。
     */
    const samples = [
      `import { a } from '@platform/main/x/x-anchors';`,
      `import { b } from '../../x/x-pages';`,
      `import '@capabilities/x-extraction';`,          // ⭐ 副作用 import,末尾无斜杠
      `import { c } from '@modules/x';`,
      `import '@modules/x';`,                          // ⭐ 副作用 + 无斜杠
      `import { d } from '@views/x/x-commands';`,
    ];
    for (const s of samples) {
      const hit = X_REF.some((re) => re.test(strip(s)));
      expect(hit, `这种写法逃过了判据,守卫会漏掉它:\n  ${s}`).toBe(true);
    }
  });

  it('前提自检:判据不会误伤无关的 x 字样', () => {
    const innocent = [
      `const maxWidth = box.x;`,
      `import { index } from './helpers/index';`,
      `const u = 'https://x.com/home';`,   // ⭐ URL 不是 import
      `import { deflate } from './xz-util';`,
    ];
    for (const s of innocent) {
      const hit = X_REF.some((re) => re.test(strip(s)));
      expect(hit, `误伤了无关代码 —— 守卫会淹死在噪音里:\n  ${s}`).toBe(false);
    }
  });

  it('⭐⭐ 引用处 ≤ 1 —— 删 X 只需删一个目录 + 删一行', () => {
    /**
     * ⚠️ 本条第一版写的是 `toHaveLength(0)` —— 那是 X **还没建**时的状态。
     * 2026-10-01 X 模块落地,`main/index.ts` 多了那**唯一一行**
     * `import '@modules/x'`,于是它当场变红。
     * ⭐ 改成钉**原则本身**:≤ 1,且那一处必须是注册行。
     */
    const refs = xReferrers();
    expect(
      refs.map((r) => `${r.path}  ←  ${r.hit}`),
      '\n⭐ 原则(用户 2026-09-30):X 必须能「删一个目录 + 删一行注册」就卸载干净。\n'
      + 'X 目录之外认识它的地方超过 1 处 —— 每多一处就多一个删不掉的点。\n'
      + '改法:X 自带视图/IPC/repo/schema,启动时**推**给底座(registerPageTable 的模式),\n'
      + '宿主只保留唯一一行 `import \'@modules/x\'`。\n'
      + '⚠️ 别把它们加进白名单 —— 本仓的 KNOWN_DEBT 从来没有被清掉过。\n',
    ).toHaveLength(refs.length === 0 ? 0 : 1);

    /**
     * ⭐ 不止数量 —— 那一处必须是**副作用 import 的注册行**,
     * 不能是「从 X 里拿东西」。
     * ⚠️ 数字达标不代表没耦合:`import { something } from '@modules/x/...'`
     * 同样只有 1 处,但那是宿主在用 X 的内部实现。
     */
    if (refs.length === 1) {
      expect(
        refs[0].hit,
        `那一处不是自注册 import,而是在取 X 的内部实现 —— 宿主不该知道 X 有什么:\n  `
        + `${refs[0].path}  ←  ${refs[0].hit}`,
      /**
       * ⚠️ `hit` 是**判据正则捕获的片段**,末尾那个引号被 lookahead 排除在外
       * (`X_SEG` 用 `(?=['"])` 收尾)—— 所以这里不钉闭合引号,
       * 只钉「以 `import '@modules/x` 开头」即可区分
       * 自注册(`import '@modules/x'`)与取内部实现(`import { a } from '@modules/x/...'`)。
       */
      ).toMatch(/^import\s+['"]@modules\/x/);
    }
  });
});

describe('⭐ 装卸不只是代码:四类残留必须跟着模块走', () => {
  /**
   * ⚠️ 推倒 X 那次实测:删完 .ts 文件之后,这四类**仍然在**。
   * 光拦 import 不够 —— 状态、通道、schema 长在别处一样拔不掉。
   */
  const find = (p: string) => allSources.find((s) => s.path === p);

  it('② X 的视图不许注册在 renderer 里', () => {
    /**
     * 实测:推倒前 `renderer/index.tsx` 有 3 处引用 X,
     * 删代码后右栏仍显示「x-workbench-view(待 L5 component)」。
     */
    const f = find('src/platform/renderer/index.tsx');
    expect(f, 'renderer/index.tsx 不见了 —— 路径变了要改守卫').toBeDefined();
    const hit = X_REF.some((re) => re.test(f!.code));
    expect(hit, 'X 的视图注册散在 renderer 里 —— 删目录后会留残影').toBe(false);
  });

  it('③ X 的 IPC 类型不许住在 shared/ipc', () => {
    expect(
      existsSync(join(SRC, 'shared/ipc/x-types.ts')),
      'X 的通道类型住在全局 shared/ipc —— 通道表长在别处,删不掉',
    ).toBe(false);
  });

  it('④ X 的东西不许住在 shared/', () => {
    /**
     * ⚠️⚠️ 本条第一版**只查 `shared/x/` 这个目录名**,于是
     * `shared/types/x-*.ts` 整整 **8 个文件**全部逃过
     * (2026-10-01 建 X 模块时发现 —— 我自己写的守卫太窄)。
     * ⭐ 又一次「守卫钉的是我想到的那一种写法」。
     */
    expect(
      existsSync(join(SRC, 'shared/x')),
      'src/shared/x/ 还在 —— X 的东西住在共用目录里,拔不掉',
    ).toBe(false);

    /**
     * ⚠️ 已知债(2026-10-01 发现,**不是本次引入**):
     * `shared/types/` 下 8 个 X 专属类型文件,其中 4 个还有消费者
     * (`web-shared/should-handle` / `main-window` / `web-shortcuts` /
     *  `storage/x-schema` / `db/search-recipe-repo`)——
     * **X 的平台知识仍然织在共用层与存储层里**。
     *
     * ⭐ 清掉是 X 重建的一部分(类型跟着模块走),不是一刀能完:
     * 动 `storage/x-schema` 要连带库表,动 `should-handle` 要改 webview 分流。
     * 按 KNOWN_DEBT 范式锁住**只减不增**。
     */
    const KNOWN_SHARED_X = [
      'x-claude-advice.ts', 'x-collect-strategy.ts', 'x-reply-facts.ts',
      'x-reply-types.ts', 'x-service-types.ts', 'x-task.ts',
      'x-timeline-types.ts', 'x-ws-role-types.ts',
    ];
    const actual = existsSync(join(SRC, 'shared/types'))
      ? readdirSync(join(SRC, 'shared/types')).filter((f) => /^x-.*\.ts$/.test(f))
      : [];
    const unexpected = actual.filter((f) => !KNOWN_SHARED_X.includes(f));
    expect(
      unexpected,
      'shared/types/ 下新增了 X 专属类型 —— X 的东西要跟着模块走(src/modules/x/):\n  '
      + unexpected.join('\n  '),
    ).toEqual([]);

    const stale = KNOWN_SHARED_X.filter((f) => !actual.includes(f));
    expect(
      stale,
      '⭐ 这些已经搬走了,请从 KNOWN_SHARED_X 删掉(清单必须与现实精确对齐,\n'
      + '否则下一处真违规出现时它会误放行):\n  ' + stale.join('\n  '),
    ).toEqual([]);
  });

  it('⑤ 共用层不许认识 X 这个平台', () => {
    /**
     * 实测残留:`web-shared/should-handle.ts` 引用 X。
     * ⭐ 共用层认识某个具体平台,就等于「换个网站会失效」—— 按原则它不该共用。
     */
    const f = find('src/platform/main/web-shared/should-handle.ts');
    if (!f) return;                       // 文件可能已重构掉,不强求存在
    const hit = X_REF.some((re) => re.test(f.code));
    expect(hit, 'web-shared 认识 X —— 共用层绑死了具体平台').toBe(false);
  });
});
