/**
 * 载荷结构画像 —— ⭐ 回答「每条里有什么数据、有什么元数据」
 *
 * 用户 2026-10-02:「采集了几条,**每条的内容是什么,有哪些数据,有哪些元数据**?」
 *
 * ⚠️ 它是**观察工具**:自己崩掉比看不到更坏
 * (`project-x-readback-lies`:「工具谎报比采集出错更坏 —— 它让人去改没坏的代码」)。
 */

import { describe, it, expect } from 'vitest';
import { describePayload } from '@modules/x/x-payload-shape';

describe('⭐⭐ 一眼看出这条有什么', () => {
  it('⭐ 推文载荷 → 认出推文/用户/互动数', () => {
    const payload = JSON.stringify({
      data: { home: { instructions: [{ entries: [
        { content: { result: {
          legacy: { full_text: 'hi', favorite_count: 3 },
          core: { user: { legacy: { screen_name: 'someone' } } },
        } } },
        { content: { result: {
          legacy: { full_text: 'yo', favorite_count: 1 },
          core: { user: { legacy: { screen_name: 'other' } } },
        } } },
      ] }] } },
    });
    const sh = describePayload(payload);
    expect(sh.entities['推文'], '没认出推文').toBe(2);
    expect(sh.entities['用户']).toBe(2);
    expect(sh.entities['互动数']).toBe(2);
    expect(sh.summary, '概括里没提推文').toContain('推文 2');
  });

  it('⭐ 认出长推/长文/游标 —— 它们是**不同的东西**', () => {
    const sh = describePayload(JSON.stringify({
      a: { note_tweet_results: {} },
      b: { article_results: {} },
      c: { cursorType: 'Bottom', value: 'DAAB' },
    }));
    expect(sh.entities['长推正文']).toBe(1);
    expect(sh.entities['长文']).toBe(1);
    expect(sh.entities['翻页游标']).toBe(1);
  });

  it('⭐⭐ 找出**最大的集合** —— 数据在哪、有多少', () => {
    const sh = describePayload(JSON.stringify({
      meta: { tags: [{ a: 1 }, { a: 2 }] },
      data: { items: Array.from({ length: 20 }, (_, i) => ({ id: i })) },
    }));
    expect(sh.collections.length).toBeGreaterThan(0);
    expect(sh.collections[0].count, '没找到最大的那个集合').toBe(20);
    expect(sh.collections[0].path).toContain('items');
  });

  it('⚠️ 字符串数组**不算**数据集合 —— 那多半是 id 列表', () => {
    const sh = describePayload(JSON.stringify({ ids: ['a', 'b', 'c', 'd'] }));
    expect(sh.collections, '把 id 列表当成了数据').toEqual([]);
  });
});

describe('⭐⭐ 空与坏:如实说,不装作有内容', () => {
  it('⭐⭐ 空响应 → 明说「本来就没内容」', () => {
    /**
     * ⚠️ 本轮实测 6 条里**五条是 0KB**(心跳/埋点类)——
     * 它们不是故障,但人看到「0KB」会以为采坏了。
     */
    const sh = describePayload('');
    expect(sh.empty).toBe(true);
    expect(sh.summary, '没说清空不等于坏').toContain('本来就没内容');
  });

  it('⭐ 不是 JSON → 说清,并给开头(可能是 HTML 或被截断)', () => {
    const sh = describePayload('<!doctype html><html>…');
    expect(sh.notJson).toBe(true);
    expect(sh.summary).toContain('不是 JSON');
    expect(sh.summary, '没给开头 —— 人判断不了是 HTML 还是截断').toContain('doctype');
  });

  it('⭐ 认不出实体时**说清顶层键** —— 不是一句「没有数据」了事', () => {
    const sh = describePayload(JSON.stringify({ ok: true, ts: 1 }));
    expect(sh.entities).toEqual({});
    expect(sh.summary, '没给顶层键 —— 人不知道这是什么响应').toContain('ok');
  });
});

describe('⚠️ 观察工具自己不许崩', () => {
  it('⭐⭐ 载荷有环也不死循环', () => {
    /** ⭐ X 的载荷里确实有互相引用 */
    const o: Record<string, unknown> = { legacy: { full_text: 'x' } };
    o.self = o;
    // 用一段**真实会出现**的深嵌套代替(JSON 本身无法表达环)
    let deep: Record<string, unknown> = { legacy: { full_text: 'x' } };
    for (let i = 0; i < 60; i += 1) deep = { nest: deep };
    expect(() => describePayload(JSON.stringify(deep))).not.toThrow();
  });

  it('⭐ 超大载荷不卡死', () => {
    const big = JSON.stringify({
      items: Array.from({ length: 5000 }, (_, i) => ({ id: i, legacy: { full_text: 'x' } })),
    });
    const t0 = Date.now();
    const sh = describePayload(big);
    expect(Date.now() - t0, '概括一条载荷花了太久 —— 会卡住面板').toBeLessThan(2000);
    expect(sh.collections[0].count).toBe(5000);
  });

  it('⚠️ 各种畸形输入都不抛', () => {
    for (const bad of ['null', 'undefined', '[]', '"x"', '123', '{', '{"a":']) {
      expect(() => describePayload(bad), `「${bad}」让工具崩了`).not.toThrow();
    }
  });
});
