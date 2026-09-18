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

/**
 * ⭐⭐ 执行者层(`platform/main/executor/`)—— 比能力层**更严**的一段
 *
 * ── 为什么单开一段,而不是把 LAYER_DIR 扩成两个目录 ──
 *
 * 执行者的规矩和能力层**不一样**:
 *  · 能力层不许 import 业务;
 *  · 执行者不许 import 业务,**还不许碰 Electron / wiring**。
 *
 * 后一条是它能在函数测试面板上「单独跑而不动你的数据」的前提 ——
 * 一旦它 import 了 wiring 或 electron,就只能在主进程里跑,
 * 测试和面板都得给它造一整套宿主,那条「原子函数可独立验证」就没了。
 *
 * ⚠️ 本段建立时(2026-09-15)executor/ 的分层守卫**为零** ——
 * `LAYER_DIR` 写死在 web-capability,全仓没有第二处扫 executor。
 * 也就是说 `local-executor.ts` 明天 import 一个 `getXDB()` 不会有任何东西反对,
 * 而这正是本次会话已经犯过一次、靠运气才发现的那种倒置。
 */
const EXECUTOR_DIR = join(process.cwd(), 'src/platform/main/executor');

const executorSources = listSources(EXECUTOR_DIR).map((p) => ({
  path: p.replace(process.cwd() + '/', ''),
  code: strip(readFileSync(p, 'utf-8')),
}));

describe('⭐⭐ 执行者层:不碰业务,也不碰 Electron', () => {
  it('前提自检:确实扫到了执行者源码(否则本段整段空转)', () => {
    /**
     * ⚠️ 这条不是凑数 —— 目录改名/搬家会让 listSources 返回空数组,
     * 而空数组让下面每条 `offenders` 都恒为 `[]` → **整段假绿**。
     * 本会话已经栽过同族的六次,这里把前提钉死。
     */
    expect(executorSources.length, 'executor/ 一个源文件都没扫到 —— 守卫在空转').toBeGreaterThan(1);
  });

  it('⭐⭐ 不许 import 任何业务层目录', () => {
    const offenders: string[] = [];
    for (const { path, code } of executorSources) {
      for (const biz of BUSINESS) {
        const rel = new RegExp(`from\\s+['"][./]*\\.\\./${biz}/`);
        const alias = new RegExp(`from\\s+['"]@platform/main/${biz}/`);
        if (rel.test(code) || alias.test(code)) offenders.push(`${path} → ${biz}/`);
      }
    }
    expect(
      offenders,
      '执行者 import 了业务层 —— 它就再也不能复用到别的判断种类了\n(「蓝V该不该点赞」与「该不该回复」必须走同一个执行者)\n  '
      + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('⭐⭐ 不许 import electron / wiring —— 否则没法单独跑', () => {
    const offenders: string[] = [];
    for (const { path, code } of executorSources) {
      if (/from\s+['"]electron['"]/.test(code)) offenders.push(`${path} → electron`);
      if (/from\s+['"][^'"]*wiring\//.test(code)) offenders.push(`${path} → wiring/`);
    }
    expect(
      offenders,
      '执行者碰了 Electron/wiring —— 面板与单测就得给它造一整套宿主,\n'
      + '「原子函数可独立验证」当场失效:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('⭐⭐ 不许写数据库 —— 执行者只算不存,落库是编排的事', () => {
    /**
     * 反例在仓里:`judgeWithOllama` 把「标记 ai_judging → 调模型 → 失败回滚
     * pending → 写回 verdict」焊死在一个函数里,于是它既不能复用到别的判断,
     * 也不能安全地单独跑 —— **一跑就改你的数据**。
     */
    const offenders: string[] = [];
    for (const { path, code } of executorSources) {
      if (/getXDB|getDB\(|db\.query\(|UPSERT|CREATE\s+\w+\s+SET/.test(code)) {
        offenders.push(path);
      }
    }
    expect(
      offenders,
      '执行者里出现了写库动作 —— 它就没法在面板上安全试跑了:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('⭐ 执行者不认识任何具体模型名(谁来执行是参数)', () => {
    /**
     * 用户定的方向:「选用任何的 AI 大模型应该作为变量」。
     * 硬编码 gemma/claude/gpt 会让「换更好的模型」变成改代码。
     * ⚠️ 只查**非注释**代码(strip 过),注释里举例说明是允许的。
     */
    const offenders: string[] = [];
    for (const { path, code } of executorSources) {
      const m = code.match(/['"`](?:gemma|claude|gpt-|qwen|llama)[\w.:-]*['"`]/i);
      if (m) offenders.push(`${path} → ${m[0]}`);
    }
    expect(
      offenders,
      '执行者里写死了模型名 —— 换模型就得改代码,而它应当是参数:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });
});

/**
 * ⭐⭐ 工作流层(`platform/main/flow/`)—— 执行记录与上下文
 *
 * ⚠️ 与 executor/ 同理:新目录**默认零分层保护**。
 * 这一层的规矩:
 *  · 不认识任何业务(它记的是「谁跑了什么」,不该知道那是 X 还是邮件)
 *  · 不碰 Electron(要能在单测里跑)
 *  · ⭐ 只写 krig_flow,**不碰别人的库** —— 执行记录混进业务库会让
 *    那边的备份/清理策略变形(设计 Module5-01 §6.1 独立库的理由)
 */
const FLOW_DIR = join(process.cwd(), 'src/platform/main/flow');

const flowSources = listSources(FLOW_DIR).map((p) => ({
  path: p.replace(process.cwd() + '/', ''),
  code: strip(readFileSync(p, 'utf-8')),
}));

describe('⭐⭐ 工作流层:不认识业务,只写自己的库', () => {
  it('前提自检:扫到了 flow/ 源码(否则整段空转)', () => {
    expect(flowSources.length, 'flow/ 一个源文件都没扫到 —— 守卫在空转').toBeGreaterThan(1);
  });

  it('⭐⭐ 不许 import 业务层', () => {
    const offenders: string[] = [];
    for (const { path, code } of flowSources) {
      for (const biz of BUSINESS) {
        const rel = new RegExp(`from\\s+['"][./]*\\.\\./${biz}/`);
        const alias = new RegExp(`from\\s+['"]@platform/main/${biz}/`);
        if (rel.test(code) || alias.test(code)) offenders.push(`${path} → ${biz}/`);
      }
    }
    expect(
      offenders,
      '执行记录层 import 了业务 —— 它就只能给那个业务用了:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('⭐⭐ 不许 import electron', () => {
    const offenders = flowSources
      .filter(({ code }) => /from\s+['"]electron['"]/.test(code))
      .map(({ path }) => path);
    expect(offenders, 'flow 层碰了 Electron —— 单测就跑不了:\n  ' + offenders.join('\n  '))
      .toEqual([]);
  });

  it('⭐⭐ 只用 getFlowDB —— 不许碰笔记库/X 库', () => {
    /**
     * 执行记录写进 krig_x 的话,X 的清理策略会连带把审计记录删掉;
     * 写进笔记库则会进备份。独立库的意义就在这里。
     */
    const offenders: string[] = [];
    for (const { path, code } of flowSources) {
      if (/\bgetXDB\b/.test(code)) offenders.push(`${path} → getXDB`);
      if (/\bgetDB\s*\(/.test(code)) offenders.push(`${path} → getDB`);
    }
    expect(
      offenders,
      '工作流层碰了别人的库 —— 记录会被那边的清理策略误删:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });
});
