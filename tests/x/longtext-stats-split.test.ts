/**
 * ⭐⭐ 长推 / 长文的统计口径 —— **报告不能再自己骗自己**
 *
 * ── 用户 2026-09-21 实测踩到(x.articles / @KA594594)──
 *
 * 报告说:`长推(Show more):72 条 · 最长 48 字 ⚠️ 疑似被截断`
 *  · 那 72 条**全是长文**,不是长推
 *  · 48 字是**标题的正常长度**,根本没截断
 * → 下一个人会去查一个**不存在的 bug**。
 *
 * ⚠️ 同时修的第二个缺陷:`count` 数的是长推,而 `maxChars`/`avgChars`
 * 却拿**全部推**算 —— 分子分母不对齐,短推会把平均值拉低,
 * 于是「疑似被截断」平白无故地报。
 *
 * ⚠️ 这是**行为测试**:钉的是「算出来的数对不对」,不是「源码里有没有某个词」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '../../src/platform/main/x/x-auto-collect.ts');

type T = { text: string; isLongText: boolean; isArticle: boolean };

/** 从真实源码里抠出统计块并执行 —— 钉活代码,不钉副本 */
function loadStat(): (tweets: T[]) => any {
  const src = readFileSync(SRC, 'utf8');
  const start = src.indexOf('    longText: (() => {');
  expect(start, '统计块不在源码里了 —— 锚点失效').toBeGreaterThan(-1);
  const end = src.indexOf('\n    })(),', start);
  expect(end, '统计块没有正常结束').toBeGreaterThan(start);
  let body = src.slice(start + '    longText: '.length, end + '\n    })()'.length);
  expect(body.length, '切出来的是空的').toBeGreaterThan(100);
  // 去掉 TS 注解,并把 r.tweets 换成入参
  body = body.replace(/:\s*typeof r\.tweets/g, '').replace(/r\.tweets/g, 'tweets');
  // eslint-disable-next-line no-new-func
  return new Function('tweets', `return (${body});`) as (t: T[]) => any;
}

const stat = loadStat();
const note = (n: number): T => ({ text: 'x'.repeat(n), isLongText: true, isArticle: false });
const article = (n: number, body: boolean): T =>
  ({ text: 'x'.repeat(n), isLongText: body, isArticle: true });
const plain = (n: number): T => ({ text: 'x'.repeat(n), isLongText: false, isArticle: false });

describe('长推/长文统计口径', () => {
  it('⭐ 长文不算进长推 —— 本 bug 的回归锁', () => {
    // 复现用户那一跑:72 篇长文(只有标题)+ 0 条长推
    const r = stat([...Array(72)].map(() => article(48, false)));
    expect(r.count, '长推数必须是 0,不能把 72 篇长文算进来').toBe(0);
    expect(r.articles.count).toBe(72);
  });

  it('⭐ maxChars 只拿长推自己算,不被短推拉低', () => {
    const r = stat([note(5000), plain(10), plain(10), plain(10)]);
    expect(r.count).toBe(1);
    expect(r.maxChars, '5000 字的长推在场,最长不该是短推的 10').toBe(5000);
    expect(r.avgChars, '平均也只算长推').toBe(5000);
  });

  it('⚠️ 不被短推拉低 → 不再平白报「疑似被截断」(面板判据 maxChars<=290)', () => {
    const r = stat([note(5000), ...[...Array(50)].map(() => plain(20))]);
    expect(r.maxChars).toBeGreaterThan(290);
  });

  it('⭐ withBody 如实回答「几篇长文真拿到正文」', () => {
    const r = stat([article(16081, true), article(48, false), article(7, false)]);
    expect(r.articles.count).toBe(3);
    expect(r.articles.withBody).toBe(1);
  });

  it('⚠️ 长文不被两边各数一次', () => {
    const r = stat([article(16081, true), note(900)]);
    expect(r.count, '有正文的长文仍不算长推').toBe(1);
    expect(r.articles.count).toBe(1);
  });

  it('都没有时两边都是 0,不报任何东西', () => {
    const r = stat([plain(10), plain(20)]);
    expect(r.count).toBe(0);
    expect(r.articles.count).toBe(0);
  });
});
