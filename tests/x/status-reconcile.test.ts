import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

/**
 * ⭐⭐ 单条推详情页(x.status)的对账。
 *
 * 分母是**根推自己的 reply_count** —— 所有页面里最干净的一个:
 * 分子分母都在这一跑的载荷里,不查库、无时间差。
 */
describe('⭐⭐ x.status 的完整性对账', () => {
  const src = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-auto-collect.ts'), 'utf-8'));

  it('⭐⭐⭐ status 分支**不能**挂在 ownerHandle 门槛里(会永远进不去)', () => {
    /**
     * ⚠️ x.status 可以没有 handle(X 接受 `/i/status/<id>` 并自己跳转)。
     * 挂在 `&& opts.ownerHandle` 那条里 = 没传 handle 时**静默无对账**,
     * 而现象是「报告里就是没有那一行」—— 最难发现的一类。
     */
    const i = src.indexOf('} else if (isStatus');
    expect(
      i,
      'status 没有独立分支 —— 挂在 ownerHandle 门槛里时,没传 handle 就永远不对账',
    ).toBeGreaterThan(0);
    /** 钉这条分支的条件:必须只看 isStatus + 有没有推,不看 ownerHandle */
    const cond = src.slice(i, src.indexOf('{', i));
    expect(cond, 'status 分支的条件里混进了 ownerHandle').not.toMatch(/ownerHandle/);
  });

  it('⭐⭐⭐ 根推按 reply_count 最大认,不是「第一条」', () => {
    /**
     * ⚠️ 载荷里的顺序**不保证根推在前**(X 有时先给热门回复)。
     * 按「第一条」认会把某条回复当成根推 → 分母变成那条回复的回复数
     * → 对账结果完全错,**而且看不出来**(仍然是个像模像样的百分比)。
     *
     * ⭐ 判据:一棵树里根推的回复数必然 ≥ 任何一条回复的回复数。
     */
    const assign = src.match(/const rootTweet\s*=\s*([\s\S]{0,300}?);/)?.[1] ?? '';
    expect(assign, '找不到 rootTweet 的赋值').toBeTruthy();
    expect(
      assign,
      '根推不是按 reply_count 最大认的 —— 载荷顺序不保证根推在前,'
      + '按第一条会把回复当根推,分母全错且看不出来',
    ).toMatch(/reduce|replies/);
    expect(assign, '根推认定没看 metrics.replies').toMatch(/metrics\?\.replies/);
  });

  it('⭐⭐ 分子要**排除根推自己** —— 根推不是自己的回复', () => {
    const i = src.indexOf('} else if (isStatus');
    const blk = src.slice(i, i + 900);
    const assign = blk.match(/const replies\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(assign, '找不到 replies 的赋值').toBeTruthy();
    expect(
      assign,
      '分子没减去根推 —— 把根推自己算成一条回复,比例虚高',
    ).toMatch(/-\s*1/);
    expect(assign, '没有防负数(只采到根推时会是 -1)').toMatch(/Math\.max/);
  });

  it('⭐⭐⭐ 必须说明「对不齐是正常的」—— 否则会被当成采漏', () => {
    /**
     * ⚠️⚠️ reply_count 是**整棵树**的总数(含回复的回复),
     * 而详情页一次只给直接回复 + 部分展开 —— **天然对不齐**。
     * 判成「没采完」会让人去加轮数改滚动,而那是 X 的分页设计,不是漏。
     * 与采推那条「低比例不等于采漏」同一个纪律。
     */
    const i = src.indexOf('} else if (isStatus');
    const blk = src.slice(i, i + 2200);
    expect(
      blk,
      '没说明「对不齐是正常的」—— 会把 X 的分页设计误读成我们采漏了',
    ).toMatch(/对不齐是正常|不是我们采漏/);
    expect(blk, '没解释 reply_count 是整棵树的总数').toMatch(/整棵树/);
    expect(blk, '结论没回到游标这个真判据').toMatch(/paging\.hasMore/);
  });

  it('⭐⭐ 拿不到 reply_count 时**不编分母**', () => {
    const i = src.indexOf('} else if (isStatus');
    const blk = src.slice(i, i + 900);
    expect(
      blk,
      '没有「拿不到 reply_count」的分支 —— 会拿 undefined 算出 NaN%',
    ).toMatch(/statusBaseline === undefined/);
  });
});
