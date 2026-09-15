/**
 * ⭐⭐ 依赖方向:业务 → 底座,**绝不反过来**(2026-09-15)
 *
 * ── 起因:我自己刚踩了一次 ──
 *
 * 给 `web.input` / `web.page` 接锚点表时,我在 `wiring/runtime.ts` 里直接写了
 * `import { XAnchorResolver } from '../../x/x-anchors'` —— 能力层反过来依赖 X。
 * 后果是底座**离开 X 业务代码就不能构建**,而 `runtime.ts` 是 AI 也在用的共用文件。
 *
 * ⚠️ **当时没有任何守卫会拦它**:
 *  - `page-boundary-guard` 守的是「除 wiring/ 外零处 Electron」
 *  - `dom-boundary-guard` 守的是「脚本文本不在业务代码现拼」
 *  - `input-boundary-guard` 守的是「底座不做危险性判断」
 * 三个都不管**依赖方向**。于是这种倒置只会悄悄烂掉 —— 正是本仓反复吃亏的形态。
 *
 * ⭐ 改法是依赖倒置:底座提供 `registerAnchorTable(owner, resolver)`,
 * 业务在启动时把自己的表**推**进来。本文件钉住这个方向。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LAYER_DIR = join(process.cwd(), 'src/platform/main/web-capability');

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listSources(full));
    else if (e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** ⚠️ 先剥注释 —— 否则上面那段说明里的 `../../x/` 会让守卫永远红 */
const strip = (s: string) =>
  s
    // ⚠️⚠️ 行注释的 `//` 必须**前面不是冒号** —— 否则 `https://x.com` 里的 `//`
    // 会被当成注释开头,把整个 URL 连同后面的代码一起吃掉。
    // 实测(2026-09-15):`'https://x.com/home'` → `'https:`,于是
    // 「面板不许拼 URL」那条守卫**永远看不见 URL**,注入验证当场假绿(第六次)。
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const sources = listSources(LAYER_DIR).map((p) => ({
  path: p.replace(process.cwd() + '/', ''),
  code: strip(readFileSync(p, 'utf-8')),
}));

/** 业务层目录 —— 能力层不许 import 其中任何一个 */
const BUSINESS = ['x', 'ai', 'mail', 'db', 'note'] as const;

describe('⭐⭐ 能力层不许 import 业务层', () => {
  it('前提自检:确实扫到了源码(否则本守卫空转)', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  /**
   * ⚠️ **已知债**(2026-09-15 发现,不是本次引入)。
   *
   * `dom/ai-scripts.ts` 把 AI 的 6 个注入脚本登记进 `web.dom`,
   * 但脚本**本体**仍在 `ai/inject-scripts/`(该文件自述:
   * 「脚本本体没有搬动…这里只是把它们登记进注册表」)。
   * 于是能力层 import 了业务层 —— 与我这次在 runtime.ts 犯的**同一种倒置**,
   * 只是方向从「锚点表」换成「脚本表」。
   *
   * ⭐ 正解与锚点表一样:`web.dom` 提供注册入口,AI 在启动时把脚本推进来。
   * 本次不顺手改 —— 它牵动 AI 的 6 个脚本与 `dom-script-eval` 等守卫,
   * 属于独立一刀。先用清单锁死,**只减不增**。
   */
  const KNOWN_DEBT = [
    'src/platform/main/web-capability/dom/ai-scripts.ts → ai/',
  ];

  /** 现在还在倒置的 */
  function currentOffenders(): string[] {
    const offenders: string[] = [];
    for (const { path, code } of sources) {
      for (const biz of BUSINESS) {
        // 相对路径(../../x/…)与别名(@platform/main/x/…)两种写法都要拦
        const rel = new RegExp(`from\\s+['"][./]*\\.\\./${biz}/`);
        const alias = new RegExp(`from\\s+['"]@platform/main/${biz}/`);
        if (rel.test(code) || alias.test(code)) offenders.push(`${path} → ${biz}/`);
      }
    }
    return offenders;
  }

  it('⭐⭐ 已知债之外零处 import 业务目录', () => {
    const unexpected = currentOffenders().filter((o) => !KNOWN_DEBT.includes(o));
    expect(
      unexpected,
      '能力层反过来依赖业务层 —— 底座离开业务代码就不能构建。\n'
      + '改法:底座提供注册入口,业务在启动时把自己的东西推进来:\n  '
      + unexpected.join('\n  '),
    ).toEqual([]);
  });

  it('⭐ 已知债清单只减不增 —— 修好一条就要删一条', () => {
    const stale = KNOWN_DEBT.filter((d) => !currentOffenders().includes(d));
    expect(
      stale,
      '这些已经不倒置了,请从 KNOWN_DEBT 删掉(清单必须与现实精确对齐,\n'
      + '否则它会在下一处真违规出现时误放行):\n  ' + stale.join('\n  '),
    ).toEqual([]);
  });

  it('⭐ 锚点表走注册,不走 import', () => {
    const runtime = sources.find((s) => s.path.endsWith('wiring/runtime.ts'));
    expect(runtime, 'runtime.ts 不见了').toBeDefined();
    expect(
      runtime!.code,
      '没有注册入口 —— 业务方无法把锚点表推进来,只能靠底座 import 它(倒置)',
    ).toMatch(/export function registerAnchorTable\s*\(/);
    // 且不许出现任何具体业务的解释器名
    expect(runtime!.code, 'runtime 里出现了具体业务的解释器')
      .not.toMatch(/XAnchorResolver|AIAnchorResolver/);
  });
});
