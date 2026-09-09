/**
 * 三态结果契约 —— `Ok` / `Failed` / `Degraded`(`06` §4.2)
 *
 * V1 各接口失败表达不统一(有的返 null,有的只 console.warn),
 * 订阅者会安静等一个永不到来的结果。按可靠性纲领铁律一,本层全部统一三态。
 *
 * ⚠️ **没有第四态,特别不许「返回空值假装成功」。**
 * 下面两条构造器守卫(空 reason / 空 missing)就是为此:
 * 一个没有原因的 Failed 等于没说失败;一个没缺东西的 Degraded 等于骗人。
 * 二者都是「看着成功实际没做」的变体。
 */
import { describe, it, expect } from 'vitest';
import { ok, failed, degraded, isOk, isFailed, isDegraded } from '@platform/main/web-capability/result';

describe('三态构造与判别', () => {
  it('ok 带值,判别正确', () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isFailed(r)).toBe(false);
    expect(isDegraded(r)).toBe(false);
    if (isOk(r)) expect(r.value).toBe(42);
  });

  it('failed 带原因与可否重试,默认不可重试', () => {
    const r = failed('网络断了', true);
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toBe('网络断了');
    expect(r.retryable).toBe(true);
    // 默认值:不给就是不可重试(保守 —— 免得调用方无脑重试打爆对端)
    const d = failed('页面不存在');
    if (!isFailed(d)) throw new Error('unreachable');
    expect(d.retryable).toBe(false);
  });

  it('degraded 带值和「缺了什么」', () => {
    const r = degraded([1, 2, 3], ['第 4-100 条没抓到']);
    expect(isDegraded(r)).toBe(true);
    if (!isDegraded(r)) throw new Error('unreachable');
    expect(r.value).toEqual([1, 2, 3]);
    expect(r.missing).toEqual(['第 4-100 条没抓到']);
  });

  it('三态互斥:任一结果只命中一个判别式', () => {
    const all = [ok(1), failed('x'), degraded(1, ['y'])];
    for (const r of all) {
      const hits = [isOk(r), isFailed(r), isDegraded(r)].filter(Boolean);
      expect(hits).toHaveLength(1);
    }
  });
});

describe('⭐ 构造器守卫 —— 挡住「假装成功」的两种形态', () => {
  it('⭐ 空 reason 的 Failed 直接抛 —— 没说原因等于没说失败', () => {
    expect(() => failed('')).toThrow(/必须给出原因/);
    expect(() => failed('   ')).toThrow(/必须给出原因/);
  });

  it('⭐ 空 missing 的 Degraded 直接抛 —— 没缺东西就该用 ok()', () => {
    // 允许空 missing 会让调用方误判成「部分失败」,进而走错误分支;
    // 更糟的是它掩盖了「其实完全成功」这个事实。
    expect(() => degraded([1, 2], [])).toThrow(/必须说明缺了什么/);
  });
});

describe('⭐ Degraded 不许被当成 Ok', () => {
  it('isOk 对 Degraded 返回 false(调用方必须显式处理)', () => {
    // `06` §4.2 原话:Degraded 是为本仓真实场景设的 —— 抓了 80/100 条、
    // 喂图成功但缩略图没校验。现在这些要么被当成功要么被当失败,**两种都错**。
    const r = degraded(['抓到 80 条'], ['另外 20 条超时']);
    expect(isOk(r)).toBe(false);
    expect(isFailed(r)).toBe(false);
  });
});
