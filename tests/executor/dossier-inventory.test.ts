/**
 * ⭐⭐ 卷宗盘点 —— **真调函数**,假的只有数据库那一层
 *
 * ── 为什么要测一个「只是数数」的函数 ──
 *
 * 它要回答的是「卷宗能有多厚」,而这个答案会**决定后面一整条链的设计**:
 * bio 只有 3 行还是 3000 行,Claude 那边收到的卷宗完全是两回事。
 * 数错了比没有更坏 —— 会让人以为资料齐全,其实模型在瞎判。
 *
 * ⚠️ 最容易错的是 **total 为 0 时 rate 该是多少**:
 * 直觉写 `have/total` 会得到 NaN,写 `|| 1` 会得到「100% 覆盖」——
 * 而事实是**没有样本**。没样本 ≠ 全覆盖(记忆 feedback-check-sample-contains-phenomenon)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** 假库:按顺序返回每条 SELECT 的计数 */
const mockQuery = vi.fn();
vi.mock('@storage/surreal/client', () => ({
  getXDB: () => ({ query: (...a: unknown[]) => mockQuery(...a) }),
}));

import { takeDossierInventory } from '@platform/main/db/x-dossier-inventory';

/** 造一批计数结果(10 条 SELECT),再造 distinct 作者清单 */
function feed(counts: number[], distinctAuthors: string[]) {
  mockQuery
    .mockResolvedValueOnce(counts.map((c) => [{ c }]))
    .mockResolvedValueOnce([distinctAuthors]);
}

beforeEach(() => mockQuery.mockReset());

describe('⭐⭐ 数得对:覆盖率的分子分母', () => {
  it('⭐ 基本计数各就各位', async () => {
    // tweets, authorRows, bio, verified, relation, parent, inReplyTo, conv, replied, accepted
    feed([1000, 36, 12, 5, 3, 48, 60, 55, 20, 7], ['a', 'b', 'c']);

    const inv = await takeDossierInventory();

    expect(inv.tweets).toBe(1000);
    expect(inv.authorRows).toBe(36);
    expect(inv.authorsSeen, 'distinct 作者数没数对').toBe(3);
  });

  it('⭐⭐ 「人」类附件的分母是**见过的作者数**,不是 x_author 行数', async () => {
    /**
     * x_author 只在「对某人动过作」(屏蔽/追踪)时才建行 ——
     * 拿它当分母会让覆盖率虚高得离谱:
     * 12/36 = 33% 看着还行,12/3458 = 0.3% 才是真相。
     */
    feed([1000, 36, 12, 0, 0, 0, 0, 0, 0, 0], new Array(3458).fill('x').map((_, i) => `u${i}`));

    const inv = await takeDossierInventory();
    const bio = inv.attachments.find((a) => a.name === 'bio')!;

    expect(bio.total, '分母用了 x_author 行数 —— 覆盖率会虚高 100 倍').toBe(3458);
    expect(bio.rate).toBeCloseTo(12 / 3458, 6);
  });

  it('⭐ 「推」类附件的分母是推文总数', async () => {
    feed([1000, 36, 0, 0, 0, 48, 0, 0, 0, 0], ['a']);

    const inv = await takeDossierInventory();
    const ctx = inv.attachments.find((a) => a.name === '上下文(父推正文)')!;

    expect(ctx.total).toBe(1000);
    expect(ctx.have).toBe(48);
  });
});

describe('⭐⭐ 没样本 ≠ 全覆盖', () => {
  it('⭐⭐ total 为 0 时 rate 是 **0**,不是 1,更不是 NaN', async () => {
    /**
     * `have/total` → NaN(面板上显示 NaN%)
     * `|| 1`       → 100%(谎报「资料齐全」)
     * 正确:0 —— 没有样本就是没有覆盖。
     */
    feed([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], []);

    const inv = await takeDossierInventory();

    for (const a of inv.attachments) {
      expect(Number.isNaN(a.rate), `${a.name} 的 rate 是 NaN`).toBe(false);
      expect(a.rate, `${a.name}:没样本却报成有覆盖`).toBe(0);
    }
  });

  it('⭐⭐ 一条都没有的附件要**明确标出来**(否则人看不出这项是空的)', async () => {
    feed([1000, 36, 0, 0, 0, 0, 0, 0, 0, 0], ['a', 'b']);

    const inv = await takeDossierInventory();
    const bio = inv.attachments.find((a) => a.name === 'bio')!;

    expect(bio.have).toBe(0);
    expect(bio.note, '空附件没有警示 —— 人扫一眼看不出这项根本没数据').toContain('⚠️');
  });
});

describe('⭐ 只读不写', () => {
  it('⭐⭐ 只发 SELECT,绝不写库(盘点不该动你的数据)', async () => {
    feed([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], ['a']);

    await takeDossierInventory();

    for (const call of mockQuery.mock.calls) {
      const sql = String(call[0]);
      expect(sql, `盘点发出了写语句:${sql.slice(0, 80)}`)
        .not.toMatch(/\b(UPDATE|CREATE|UPSERT|DELETE|REMOVE)\b/i);
    }
  });

  it('⭐ 计数一律带 GROUP ALL(不带会按行返回,拿到的是第一行不是总数)', async () => {
    feed([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], ['a']);

    await takeDossierInventory();

    const counting = String(mockQuery.mock.calls[0][0]);
    const countStatements = counting.split(';').filter((x) => /count\(\)/i.test(x));
    expect(countStatements.length, '一条 count 都没有 —— 断言会空转').toBeGreaterThan(5);
    for (const st of countStatements) {
      expect(st, `count 没带 GROUP ALL:${st.trim().slice(0, 60)}`).toMatch(/GROUP ALL/i);
    }
  });
});
