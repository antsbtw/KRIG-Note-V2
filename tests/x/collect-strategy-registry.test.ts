/**
 * ⭐⭐ 采集策略注册制守卫(`agent/Module5-02-x-pipeline.md` §1.3)
 *
 * 守的是用户 2026-09-09 那条拍板:
 *
 * > 「(盯推主)这个只是**一个例子**,也就是**不要写死代码**。」
 *
 * ── 判据(文档 §1.3 原文)──
 *
 * > **加一种新采集策略 = 新增一个文件 + 一行注册;
 * >   改动现有文件数 = 0,改动 UI = 0。**
 *
 * ⚠️ 这个判据**不能只靠人读代码保证** —— 它会在「就加一个 switch 分支嘛」
 * 这种一次次的小让步里悄悄失效,而失效时没有任何测试会红。
 * 所以下面逐条钉死,并全部经注入验证过能真的红。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CollectStrategyRegistry,
  keywordStrategy,
  authorWatchStrategy,
  INITIAL_STRATEGIES,
  registerInitialStrategies,
} from '@capabilities/x-collect';
import type { CollectStrategy } from '@capabilities/x-collect';

const SRC = join(process.cwd(), 'src/capabilities/x-collect');
const CONTRACT = join(process.cwd(), 'src/shared/types/x-collect-strategy.ts');

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function sourcesOf(dir: string): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourcesOf(full));
    else if (e.name.endsWith('.ts')) {
      out.push({ path: full.replace(process.cwd() + '/', ''), code: stripComments(readFileSync(full, 'utf-8')) });
    }
  }
  return out;
}

const sources = sourcesOf(SRC);

describe('⭐⭐ 契约里没有 run() —— 策略只声明,不执行', () => {
  it('⭐⭐ CollectStrategy 接口不含 run / execute / scroll / navigate', () => {
    const contract = stripComments(readFileSync(CONTRACT, 'utf-8'));
    const iface = contract.slice(
      contract.indexOf('export interface CollectStrategy'),
      contract.indexOf('export type ParamValidation'),
    );
    expect(iface.length, '没找到 CollectStrategy 接口').toBeGreaterThan(0);
    for (const banned of ['run(', 'execute(', 'scroll', 'navigate', 'loadURL']) {
      expect(
        iface,
        `契约里出现 ${banned} —— 有它就等于允许策略自己写导航/滚动,` +
          '「同一 bug 修三遍」会原样复发(10 天 433 条回复只入库 81 条)',
      ).not.toContain(banned);
    }
  });

  it('⭐ 策略实现里零处导航 / 滚动代码', () => {
    for (const { path, code } of sources) {
      for (const banned of [/loadURL/, /scrollBy/, /scrollTop/, /executeJavaScript/, /webContents/]) {
        expect(code, `${path} 出现 ${banned} —— 策略不许自己执行`).not.toMatch(banned);
      }
    }
  });

  it('守卫自检:三个答案的方法名确实在契约里(否则上面两条是空转的)', () => {
    const contract = readFileSync(CONTRACT, 'utf-8');
    expect(contract).toMatch(/target\(params/);
    expect(contract).toMatch(/arrived\(params/);
    expect(contract).toMatch(/stop\(params/);
  });
});

describe('⭐⭐ 注册制,不是枚举', () => {
  it('⭐⭐ 全仓策略代码里零处 switch (strategy.id) 这类分支', () => {
    for (const { path, code } of sources) {
      expect(code, `${path} 按策略 id 分支 —— 那等于把注册制退回枚举`).not.toMatch(
        /switch\s*\(\s*\w*\.?(strategyId|strategy\.id|id)\s*\)/,
      );
      // 联合类型写死策略名,是初稿被否决的那个形态
      expect(code, `${path} 把策略名写成联合类型`).not.toMatch(
        /'keyword'\s*\|\s*'(browse|author-watch|tweet-watch)'/,
      );
    }
  });

  it('⭐ 注册表本身不认识任何具体策略(registry.ts 零处策略名)', () => {
    const reg = sources.find((s) => s.path.endsWith('registry.ts'));
    expect(reg, '找不到 registry.ts').toBeDefined();
    for (const name of ['keyword', 'author-watch', 'authorWatch', 'browse', 'tweet-watch']) {
      expect(reg!.code, `registry.ts 提到了具体策略 "${name}" —— 它不该认识任何一个`)
        .not.toContain(name);
    }
  });

  it('⭐⭐ 加一种新策略:注册进去就能用,不改注册表一行', () => {
    // 这条用行为证明,不靠读源码 —— 真造一个注册表里从没见过的策略
    const registry = new CollectStrategyRegistry();
    registerInitialStrategies(registry);
    const before = registry.list().length;

    const hashtag: CollectStrategy = {
      id: 'hashtag',
      name: '盯话题标签',
      description: '注册表从没见过它',
      paramsSchema: [{ key: 'tag', label: '标签', kind: 'string', required: true }],
      target: (p) => ({ url: `https://x.com/search?q=%23${p.tag}&f=live`, describe: `#${p.tag}` }),
      arrived: () => ({ urlIncludes: '/search' }),
      stop: () => ({ kind: 'atBottom' }),
    };
    registry.register(hashtag);

    expect(registry.list().length).toBe(before + 1);
    expect(registry.get('hashtag').name).toBe('盯话题标签');
    // ⭐ 校验也自动就有了 —— UI 不认识 hashtag,只读它的 schema
    expect(registry.validate('hashtag', {}).ok, '必填缺失该失败').toBe(false);
    expect(registry.validate('hashtag', { tag: 'vpn' }).ok).toBe(true);
    expect(registry.get('hashtag').target({ tag: 'vpn' }).url).toContain('%23vpn');
  });
});

describe('⭐ 注册表 fail loud,不静默', () => {
  it('⭐⭐ id 重复 → 抛,绝不覆盖也不忽略', () => {
    const r = new CollectStrategyRegistry();
    r.register(keywordStrategy);
    expect(() => r.register({ ...keywordStrategy, name: '另一个' })).toThrow(/重复/);
    // 原来那个必须还在,没被顶掉
    expect(r.get('keyword').name).toBe(keywordStrategy.name);
  });

  it('⭐ 取不存在的策略 → 抛,不返回 null', () => {
    const r = new CollectStrategyRegistry();
    expect(() => r.get('nope')).toThrow(/没有注册过/);
  });

  it('空 id 拒绝注册', () => {
    const r = new CollectStrategyRegistry();
    expect(() => r.register({ ...keywordStrategy, id: '  ' })).toThrow();
  });

  it('⭐ list 按注册顺序返回,不排序不择优(与 web.page 的 find 同源)', () => {
    const r = new CollectStrategyRegistry();
    r.register(authorWatchStrategy);
    r.register(keywordStrategy);
    expect(r.list().map((s) => s.id)).toEqual(['author-watch', 'keyword']);
  });
});

describe('⭐ 参数校验:必填缺失必须明确失败,不静默套默认值', () => {
  const r = new CollectStrategyRegistry();
  registerInitialStrategies(r);

  it('⭐⭐ author-watch 缺 handle → ok:false 且说清是哪个参数', () => {
    const v = r.validate('author-watch', {});
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.problems.join(' ')).toContain('handle');
  });

  it('⭐ 非必填缺失 → 补默认值,不报错', () => {
    const v = r.validate('author-watch', { handle: 'someone' });
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.params.depth, 'depth 应补上默认值 40').toBe(40);
  });

  it('⭐ 类型不对 → 明确失败(不是硬转)', () => {
    const v = r.validate('author-watch', { handle: 'x', depth: 'many' });
    expect(v.ok).toBe(false);
  });

  it('⭐ 数字越界 → 明确失败', () => {
    expect(r.validate('author-watch', { handle: 'x', depth: 0 }).ok).toBe(false);
    expect(r.validate('author-watch', { handle: 'x', depth: 9999 }).ok).toBe(false);
  });

  it('enum 只认候选值', () => {
    expect(r.validate('keyword', { resultType: 'random' }).ok).toBe(false);
    expect(r.validate('keyword', { resultType: 'top' }).ok).toBe(true);
  });
});

describe('⭐⭐ keyword 策略:URL 拼装必须保住那几条实测血泪', () => {
  it('⭐⭐ 用 filter:replies,**绝不**用 include:replies', () => {
    const url = decodeURIComponent(
      keywordStrategy.target({ keywords: ['VPN'], includeReplies: true }).url,
    );
    expect(url, 'include:replies X 已不支持,且静默返回 0 条不报错').not.toContain('include:replies');
    expect(url).toContain('filter:replies');
  });

  it('⭐ 不要回复时不带 filter:replies(反向锁)', () => {
    const url = decodeURIComponent(keywordStrategy.target({ keywords: ['VPN'] }).url);
    expect(url).not.toContain('filter:replies');
  });

  it('⭐ 关键词是 OR、带引号', () => {
    const url = decodeURIComponent(keywordStrategy.target({ keywords: ['VPN', '翻墙'] }).url);
    expect(url).toContain('("VPN" OR "翻墙")');
  });

  /**
   * ⚠️⚠️ **这两条初稿写错了(2026-09-14 探针实证后改)**,留记录免得有人改回去。
   *
   * 初稿断言「关机 10 天 → since 应被 48h 截住」「刚跑过 → 窗口 ≤50h」。
   * 拿原实现 `computeSinceDate` 跑探针,两条都不成立:
   *
   * | 场景 | 原实现的 since | 初稿期望 |
   * |---|---|---|
   * | 关机 10 天 | **305.3h 前** | ≤72h ❌ |
   * | 刚跑过 30 分 | **65.3h 前** | ≤50h ❌ |
   *
   * 真相两条:
   *  ① 原 `computeSinceDate` **根本没有下限封顶** —— 就是 `lastRunAt - 48h`,
   *    上次运行多久以前,窗口就多久以前。封顶的是**滚动深度**(12h),不是搜索窗口。
   *  ② `since:` 只精确到**日期**(`toISOString().split('T')[0]`),
   *    48.5h 前取整到当天 0 点 → 从「现在」量过去自然变成 65.3h。
   *
   * ⭐ 所以断言改成钉**真正的不变量**:窗口起点由 `lastRunAt` 推出,
   * 且比「现在往前 24h」明显更早 —— 反向锁能咬住「退化成固定窗口」这个真 bug。
   */
  it('⭐⭐ since: 从**上次运行**往前推(≈lastRunAt−48h),不是「现在往前 24h」', () => {
    const lastRun = Date.now() - 10 * 86400_000;
    const url = decodeURIComponent(
      keywordStrategy.target({ keywords: ['x'], lastRunAt: new Date(lastRun).toISOString() }).url,
    );
    const m = url.match(/since:(\d{4}-\d{2}-\d{2})/);
    expect(m, '必须有 since:').toBeTruthy();
    const since = new Date(`${m![1]}T00:00:00Z`).getTime();

    // ⭐ 关键不变量:起点跟着 lastRunAt 走 —— 落在 lastRunAt−48h 的那一天
    const expectedDay = new Date(lastRun - 48 * 3_600_000).toISOString().split('T')[0];
    expect(m![1], 'since 必须由 lastRunAt 推出,不是由「现在」推出').toBe(expectedDay);

    // ⭐ 反向锁:实现若退化成「现在往前 24h」,since 会落在今天/昨天 → 这条红
    const ageHours = (Date.now() - since) / 3_600_000;
    expect(ageHours, '关机 10 天,窗口必须真的回溯那么远,否则那段永久丢').toBeGreaterThan(24 * 9);
  });

  it('⭐ 刚跑过 → 窗口只回溯到「上次运行前 48h」,不是恒定回溯 10 天(反向锁)', () => {
    const lastRun = Date.now() - 30 * 60_000;
    const url = decodeURIComponent(
      keywordStrategy.target({ keywords: ['x'], lastRunAt: new Date(lastRun).toISOString() }).url,
    );
    const since = new Date(`${url.match(/since:(\d{4}-\d{2}-\d{2})/)![1]}T00:00:00Z`).getTime();
    const ageHours = (Date.now() - since) / 3_600_000;

    // 48h 叠加 + 日期取整,最多再多一天;但绝不该是「10 天前」那种量级
    expect(ageHours, '刚跑过就该只回溯约两三天,不是无限回溯').toBeLessThan(24 * 4);
    expect(ageHours, '仍要有 48h 叠加防遗漏,不能退化成「只查今天」').toBeGreaterThan(24);
  });

  it('⭐ min_faves / lang / 排序都进 URL', () => {
    const t = keywordStrategy.target({ keywords: ['a'], minLikes: 5, lang: 'zh', resultType: 'top' });
    const url = decodeURIComponent(t.url);
    expect(url).toContain('min_faves:5');
    expect(url).toContain('lang:zh');
    expect(t.url).toContain('f=top');
  });

  it('⭐⭐ 判到位必须查 URL 含 /search —— 否则会把首页时间线当搜索结果', () => {
    expect(keywordStrategy.arrived({}).urlIncludes).toBe('/search');
  });
});

/**
 * ⭐⭐ 这一组守的是 2026-09-14 修掉的一个**实打实的缺口**。
 *
 * 初稿的 `CollectStop` 只有三种(atBottom/rounds/itemCount),于是 keyword 的
 * `stop()` 只能写 `atBottom` —— 而 `scanRecipe` 真实的停法是**第四种**:
 * 「本轮最旧一条早于 scrollToMs 就收工」。
 *
 * 丢了它的代价(`x-timeline-scan.ts:452` 的实测账):
 *   **30 分钟一轮却每次滚 48 小时 = 76 倍无用功(1062 条里只有 14 条是新的)。**
 *
 * 连带还有一处:初稿把「搜索窗口 48h」与「滚动深度 12h」**混成了一个 48** ——
 * 两个量在原代码里有明确注释分开,我写契约时没读那段。
 */
describe('⭐⭐ 搜索窗口(48h) vs 滚动深度(12h) —— 两个量不许混', () => {
  it('⭐⭐ keyword 停在 olderThan,不是 atBottom(否则 76 倍无用功)', () => {
    const s = keywordStrategy.stop({ lastRunAt: new Date(Date.now() - 30 * 60_000).toISOString() });
    expect(s.kind).toBe('olderThan');
  });

  it('⭐⭐ 刚跑过 30 分钟 → 滚动深度只覆盖那一段,**不是** 48h', () => {
    const s = keywordStrategy.stop({
      lastRunAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      bufferHours: 2,
    });
    if (s.kind !== 'olderThan') throw new Error('应为 olderThan');
    const depthHours = (Date.now() - s.beforeTs) / 3_600_000;
    // 30 分钟 + 2h 缓冲 ≈ 2.5h,远小于 12h 封顶,更远小于搜索窗口的 48h
    expect(depthHours).toBeLessThan(4);
    expect(depthHours, '不该退化成 0(那样一条都滚不到)').toBeGreaterThan(1);
  });

  it('⭐ 从没跑过 / 关机很久 → 封顶 12h,**不是** 48h', () => {
    const never = keywordStrategy.stop({});
    if (never.kind !== 'olderThan') throw new Error('应为 olderThan');
    expect((Date.now() - never.beforeTs) / 3_600_000).toBeCloseTo(12, 0);

    const longAgo = keywordStrategy.stop({
      lastRunAt: new Date(Date.now() - 10 * 86400_000).toISOString(),
    });
    if (longAgo.kind !== 'olderThan') throw new Error('应为 olderThan');
    const h = (Date.now() - longAgo.beforeTs) / 3_600_000;
    expect(h, '滚动深度封顶 12h —— 写成 48 就是把两个量混了').toBeCloseTo(12, 0);
  });

  it('⭐⭐ 同一次调用:搜索窗口仍是 48h 叠加(窗口宽、滚动窄,两者并存)', () => {
    const params = { keywords: ['VPN'], lastRunAt: new Date(Date.now() - 30 * 60_000).toISOString() };

    // 窗口:since: 从上次运行往前叠 48h
    const url = decodeURIComponent(keywordStrategy.target(params).url);
    const since = new Date(`${url.match(/since:(\d{4}-\d{2}-\d{2})/)![1]}T00:00:00Z`).getTime();
    const windowHours = (Date.now() - since) / 3_600_000;
    expect(windowHours, '搜索窗口应 ≥48h(叠加防遗漏)').toBeGreaterThan(47);

    // 滚动:只覆盖距上次运行那一段
    const stop = keywordStrategy.stop(params);
    if (stop.kind !== 'olderThan') throw new Error('应为 olderThan');
    const depthHours = (Date.now() - stop.beforeTs) / 3_600_000;

    expect(depthHours, '⭐ 滚动深度必须远小于搜索窗口 —— 相等就说明两个量被混成了一个')
      .toBeLessThan(windowHours / 4);
  });

  it('⭐ 滚动深度可配(schema 声明了就要真生效,不能是死参数)', () => {
    const s = keywordStrategy.stop({ scrollDepthHours: 3 });
    if (s.kind !== 'olderThan') throw new Error('应为 olderThan');
    expect((Date.now() - s.beforeTs) / 3_600_000).toBeCloseTo(3, 0);
  });

  it('⭐ schema 里声明了这两个参数(代码认、UI 不认 = 又一种写死)', () => {
    const keys = keywordStrategy.paramsSchema.map((p) => p.key);
    expect(keys).toContain('scrollDepthHours');
    expect(keys).toContain('sinceHours');
  });
});

describe('⭐ author-watch 策略:第二个成员,可插拔的证明', () => {
  it('⭐ 走 /with_replies 一级导航,不走搜索语法', () => {
    expect(authorWatchStrategy.target({ handle: 'someone' }).url)
      .toBe('https://x.com/someone/with_replies');
  });

  it('⭐⭐ handle 归一化:去 @、转小写(写入端与比对端必须同口径)', () => {
    // 记忆 project-x-handle-normalize:漂移 = 屏蔽恒不命中且不报错
    expect(authorWatchStrategy.target({ handle: '@Miekko22' }).url)
      .toBe('https://x.com/miekko22/with_replies');
    expect(authorWatchStrategy.arrived({ handle: '@Miekko22' }).urlIncludes)
      .toBe('/miekko22/with_replies');
  });

  it('⭐⭐ 空 handle → 抛,不拼出垃圾 URL', () => {
    // 空串会拼出 https://x.com//with_replies,导航「成功」但落在 404,
    // 而判到位只查 URL 含不含 handle —— 空串恒真,于是继续抓、抓到一堆别的
    expect(() => authorWatchStrategy.target({ handle: '' })).toThrow();
    expect(() => authorWatchStrategy.target({})).toThrow();
  });

  it('⭐ 停在 itemCount(收够就走),与 keyword 的 olderThan 不同', () => {
    expect(authorWatchStrategy.stop({ depth: 25 })).toEqual({ kind: 'itemCount', n: 25 });
    // ⚠️ keyword 曾写成 atBottom —— 那是 bug,见下面「76 倍无用功」那组
    expect(keywordStrategy.stop({}).kind).toBe('olderThan');
  });
});

describe('⭐ 初始成员', () => {
  it('两个成员都在,且 id 稳定(落库/留痕都用它,改了会断)', () => {
    expect(INITIAL_STRATEGIES.map((s) => s.id)).toEqual(['keyword', 'author-watch']);
  });

  it('⭐ 每个策略都有描述和参数 schema(「有描述、有配置」的兑现)', () => {
    for (const s of INITIAL_STRATEGIES) {
      expect(s.description.length, `${s.id} 没有描述`).toBeGreaterThan(10);
      expect(s.paramsSchema.length, `${s.id} 没有参数 schema → UI 生不出表单`).toBeGreaterThan(0);
      for (const p of s.paramsSchema) {
        expect(p.label.length, `${s.id}.${p.key} 没有 label`).toBeGreaterThan(0);
      }
    }
  });

  it('⭐ 三个答案对任何合法参数都给得出(不抛、不返空)', () => {
    const r = new CollectStrategyRegistry();
    registerInitialStrategies(r);
    const samples: Record<string, Record<string, unknown>> = {
      keyword: { keywords: ['VPN'] },
      'author-watch': { handle: 'someone' },
    };
    for (const s of r.list()) {
      const p = samples[s.id];
      expect(s.target(p).url).toMatch(/^https:\/\/x\.com\//);
      expect(s.target(p).describe.length).toBeGreaterThan(0);
      expect(s.arrived(p).urlIncludes.length).toBeGreaterThan(0);
      expect(s.stop(p).kind.length).toBeGreaterThan(0);
    }
  });
});
