/**
 * Unit test: lexrank (Decision 028 §2.3 字典序排位键)
 *
 * 覆盖:
 *  - rankBetween 严格落在两端之间(字典序)
 *  - rankAfter / rankBefore 单调
 *  - initialRanks 严格升序
 *  - 风险对策(§5):连续中插 1000 次不退化、不撞、保持有序
 *  - 边界:a >= b throw;null 端点
 */
import { describe, it, expect } from 'vitest';
import {
  rankBetween,
  rankAfter,
  rankBefore,
  initialRanks,
} from '@platform/main/note/lexrank';

describe('lexrank', () => {
  it('rankBetween 落在两端严格之间', () => {
    const a = rankAfter(null);
    const b = rankAfter(a);
    const mid = rankBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('rankAfter 单调递增', () => {
    let prev: string | null = null;
    let last = '';
    for (let i = 0; i < 100; i++) {
      const r = rankAfter(prev);
      if (prev !== null) expect(prev < r).toBe(true);
      prev = r;
      last = r;
    }
    expect(last.length).toBeGreaterThan(0);
  });

  it('rankBefore 单调递减', () => {
    let next: string | null = null;
    for (let i = 0; i < 100; i++) {
      const r = rankBefore(next);
      if (next !== null) expect(r < next).toBe(true);
      next = r;
    }
  });

  it('initialRanks(n) 严格升序、长度 n、互异', () => {
    for (const n of [1, 2, 5, 50, 500]) {
      const ranks = initialRanks(n);
      expect(ranks).toHaveLength(n);
      for (let i = 1; i < ranks.length; i++) {
        expect(ranks[i - 1] < ranks[i]).toBe(true);
      }
      expect(new Set(ranks).size).toBe(n);
    }
  });

  it('initialRanks(0) → []', () => {
    expect(initialRanks(0)).toEqual([]);
  });

  it('连续在同一缝隙中插 1000 次不退化(§5 风险对策)', () => {
    // 取相邻两个 rank,反复在它们之间插中点,验证:
    //  - 每次结果都严格落在当前 (lo, hi) 之间
    //  - 1000 次后字符串长度可控(base-62 增长极慢,远不会爆)
    const seq = initialRanks(2);
    let lo = seq[0];
    const hi = seq[1];
    let maxLen = 0;
    for (let i = 0; i < 1000; i++) {
      const mid = rankBetween(lo, hi);
      expect(lo < mid).toBe(true);
      expect(mid < hi).toBe(true);
      lo = mid; // 永远往左半边继续中插(最坏情况:字符串持续加长)
      maxLen = Math.max(maxLen, mid.length);
    }
    // base-62 下每位可细分 ~31 次才需进位,1000 次中插字符串长度应在 ~200 位内远小于灾难
    expect(maxLen).toBeLessThan(1100);
  });

  it('全序列规模插入后整体仍可重排为升序(随机中插压力)', () => {
    // 模拟真实编辑:在随机位置不断插入新块,维护一个有序 rank 列表
    let ranks = initialRanks(10);
    for (let i = 0; i < 2000; i++) {
      // 用 i 做确定性"随机"位置(测试禁用 Math.random)
      const pos = i % (ranks.length + 1);
      const a = pos > 0 ? ranks[pos - 1] : null;
      const b = pos < ranks.length ? ranks[pos] : null;
      const r = rankBetween(a, b);
      ranks.splice(pos, 0, r);
    }
    // 整体应严格升序、无重复
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i - 1] < ranks[i]).toBe(true);
    }
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('a >= b throw', () => {
    expect(() => rankBetween('b', 'a')).toThrow();
    expect(() => rankBetween('x', 'x')).toThrow();
  });

  it('null 端点', () => {
    const first = rankBetween(null, null);
    expect(typeof first).toBe('string');
    expect(first.length).toBeGreaterThan(0);
    const before = rankBetween(null, first);
    expect(before < first).toBe(true);
    const after = rankBetween(first, null);
    expect(first < after).toBe(true);
  });
});
