/**
 * ⭐⭐ **水位接线 + goto/collect 职责分离** —— 用户 2026-09-27:
 *
 * > 「goto 后就是滚动当前 goto 的页面，然后自动收集了，
 * >   收集是 goto 到哪里就收集哪里，是一个分离的动作」
 *
 * ⚠️⚠️ 原来 goto 和 collect **各 resolve 一次**同一份参数。
 * 两次结果一样纯属巧合 —— 而 `autoCollect` 的行为是「不在这一页就跳过去」，
 * 所以一旦两次算出的 URL 有差异（加水位后两次算 since 可能跨午夜零点），
 * collect 会**把页面跳走**，采的就不是 goto 带你去的那一页。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8');
/** ⚠️ 行注释正则要躲开 `https://` 里的 `//` */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const CAPS = read('src/platform/main/x/x-flow-capabilities.ts');
/** 切出某个能力的函数体 —— ⚠️ 别整文件 toMatch（同名 token 会假绿） */
const capBody = (name: string, next: string): string => {
  const i = CAPS.indexOf(`async ${name}(`);
  expect(i, `找不到能力 ${name}`).toBeGreaterThan(0);
  const j = CAPS.indexOf(`async ${next}(`, i);
  expect(j, `找不到 ${name} 后面的 ${next}`).toBeGreaterThan(i);
  const body = CAPS.slice(i, j);
  expect(body.length, `${name} 的 slice 空转`).toBeGreaterThan(100);
  return body;
};

describe('⭐⭐ collect 采当前页，不自己算 URL', () => {
  it('⭐⭐ collect 里不许再出现 resolver.resolve', () => {
    /**
     * ⭐ 这是「分离的动作」的核心证据:
     * 决定「去哪一页」是 goto 的职责，collect 只管采当前页。
     */
    expect(
      /resolver\.resolve\(/.test(strip(capBody('collect', 'judge'))),
      'collect 又自己算 URL 了 —— 两次算的窗口可能不同，autoCollect 会把页面跳走',
    ).toBe(false);
  });

  it('⭐⭐ collect 传空串给 autoCollect（＝采当前页）', () => {
    const body = strip(capBody('collect', 'judge'));
    expect(
      body,
      'collect 没传空串 —— autoCollect 的「传空串 = 采当前页」这条路没走上',
    ).toMatch(/autoCollect\(''/);
  });

  it('⚠️ goto 仍然要 resolve（它才是决定去哪一页的那一步）', () => {
    expect(
      strip(capBody('goto', 'collect')),
      'goto 不 resolve 了 —— 那就没人决定去哪一页了',
    ).toMatch(/resolver\.resolve\(/);
  });
});

describe('⭐⭐ 水位:读在 goto、写在 collect', () => {
  it('⭐⭐ goto 读水位并算出 since', () => {
    const body = strip(capBody('goto', 'collect'));
    expect(body, 'goto 没读水位').toMatch(/getSearchWatermark\(/);
    expect(body, 'goto 没算 since').toMatch(/computeSinceDate\(/);
    expect(body, '算出来了没传给 resolver —— 窗口不会变').toMatch(/pageParams\.since = since/);
  });

  it('⭐⭐ collect 采完推水位', () => {
    const body = strip(capBody('collect', 'judge'));
    expect(body, 'collect 没推水位 —— 下次还会重采同一段').toMatch(/bumpSearchWatermark\(/);
  });

  it('⭐⭐ 推的是**推文时间**不是跑的时间', () => {
    /**
     * ⚠️ 记跑的时间 → 下次从那往后采 → X 索引延迟期间的那段**永远漏掉**，
     * 而且漏了在数据里看不出来。
     */
    const body = strip(capBody('collect', 'judge'));
    const i = body.indexOf('bumpSearchWatermark(');
    const call = body.slice(i, body.indexOf(');', i));
    expect(call, '推的不是采到的最新一条推的时间').toMatch(/r\.newestAt/);
    /**
     * ⚠️⚠️ **不许用 `dateSpan.newest`** —— 2026-09-27 真机踩到:
     * 那个字段是**按天聚合**的(`YYYY-MM-DD`),拿去当时间戳会把
     * 「20:38:55」存成「00:00:00」→ 下次窗口平白多退一整天。
     * ⭐ 现象是「每次都重采一大段」,而且**看着像正常工作** —— 极难发现。
     */
    expect(
      /dateSpan/.test(call),
      '又用了按天聚合的 dateSpan —— 时间会被截断到 00:00:00',
    ).toBe(false);
    expect(
      /Date\.now\(\)|new Date\(\)/.test(call),
      '推的是「现在」—— 那是跑的时间不是推文时间',
    ).toBe(false);
  });

  it('⚠️ 只对搜索页算水位（别的页面没有搜索词）', () => {
    const g = strip(capBody('goto', 'collect'));
    const c = strip(capBody('collect', 'judge'));
    expect(g, 'goto 没限定搜索页').toMatch(/page === 'x\.search'/);
    expect(c, 'collect 没限定搜索页').toMatch(/page === 'x\.search'/);
  });

  it('⚠️ 人显式写了 since 就别覆盖（他说了算）', () => {
    expect(
      strip(capBody('goto', 'collect')),
      '人写了 since 还被水位覆盖 —— 那他就没法手动指定窗口了',
    ).toMatch(/!pageParams\.since/);
  });

  it('⭐ 窗口凭什么是这个要报出来（采少了看不出来）', () => {
    const body = capBody('goto', 'collect');
    expect(body, '没报窗口依据 —— 「采少了」只能靠这句话回溯')
      .toMatch(/waterNote/);
    expect(body, '没区分增量与冷启动').toMatch(/冷启动/);
  });
});

describe('⚠️ 配方里不该再写死 days', () => {
  it('⭐ shared 里去掉了 days（窗口由水位决定）', () => {
    const rec = read('src/platform/main/x/x-flow-recipes.ts');
    const i = rec.indexOf('shared:');
    expect(i, '配方里找不到 shared').toBeGreaterThan(0);
    const line = rec.slice(i, rec.indexOf('\n', i));
    expect(
      /days:/.test(line),
      'shared 里又写死了 days —— 水位算出来的窗口会被它的冷启动值掩盖',
    ).toBe(false);
  });
});
