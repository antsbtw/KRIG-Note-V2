/**
 * ⭐⭐ 回读的「空」判据 —— **验证工具本身的守卫**
 *
 * ── 用户 2026-09-21 实测(x.home 那跑)──
 *
 * 报告红着脸报「created_at 整片为空(抽查 20 条全空)」,
 * 而库里是 **1785/1785 全有值**。是**回读误判**,不是采集丢数据。
 *
 * 真因:`created_at` 是 datetime,SDK 读回来是 `Date` 实例,
 * 而原判据里「空对象」那一条 `Object.keys(v).length === 0`
 * 对 `Date` 恒为真 —— 把每一个合法时间都判成了空。
 *
 * ⚠️ 这条守卫**不钉字面量**(「文本在、行为没了」是本仓库栽过的坑),
 * 而是把真实源码里的判据**抠出来执行**,直接问它:
 *   · Date 判成空吗? → 必须否(回归锁)
 *   · 真的空值还判得出来吗? → 必须是(别为了修 A 砍掉 B)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '../../src/platform/main/x/x-auto-collect.ts');

/** 从真实源码里抠出 isEmptyValue 的函数体并求值 —— 钉的是活代码,不是副本 */
function loadPredicate(): (v: unknown) => boolean {
  const src = readFileSync(SRC, 'utf8');
  const start = src.indexOf('const isEmptyValue =');
  expect(start, 'isEmptyValue 不在源码里了 —— 判据被改名或删除').toBeGreaterThan(-1);
  const end = src.indexOf('\n        };', start);
  expect(end, 'isEmptyValue 函数体没有正常结束 —— 切片锚点失效').toBeGreaterThan(start);
  const body = src.slice(start, end + '\n        };'.length)
    .replace(/:\s*unknown/g, '').replace(/:\s*boolean/g, '')
    .replace(/\s+as\s+object/g, '');
  expect(body.length, '切出来的函数体是空的').toBeGreaterThan(50);
  // eslint-disable-next-line no-new-func
  return new Function(`${body} return isEmptyValue;`)() as (v: unknown) => boolean;
}

describe('回读的「空」判据', () => {
  const isEmpty = loadPredicate();

  it('⭐ Date 不是空 —— 本 bug 的回归锁', () => {
    expect(isEmpty(new Date('2026-09-21T14:00:00Z'))).toBe(false);
    expect(isEmpty(new Date(0))).toBe(false);
  });

  it('真的空值仍要判得出来 —— 别为了修 A 砍掉 B', () => {
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty('')).toBe(true);
    // metrics 用的就是这条:真的 {} 才算空
    expect(isEmpty({})).toBe(true);
  });

  it('有内容的值都不是空', () => {
    expect(isEmpty({ views: 1 })).toBe(false);
    expect(isEmpty('x')).toBe(false);
    expect(isEmpty(0)).toBe(false);
    expect(isEmpty(false)).toBe(false);
  });
});
