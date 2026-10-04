/**
 * ⭐⭐⭐ 配方 → 查询串
 *
 * ⚠️ 判据全部钉**最终发出去的串**,不钉中间变量 ——
 * 配方里填的词与真正搜的东西不是一回事(会加 OR、引号、from:、
 * min_faves、since:),只有最终串才是人该核对的。
 */
import { describe, it, expect } from 'vitest';
import { recipeToQuery } from '@modules/x/x-recipe-query';
import type { SearchRecipe } from '@shared/types/x-timeline-types';

/** ⭐ 固定时刻 —— 否则 since: 每天都不一样,钉不住 */
const NOW = Date.parse('2026-10-04T12:00:00Z');

const recipe = (p: Partial<SearchRecipe>): SearchRecipe => ({
  id: 'r1', name: '测试', enabled: true, template: 'trending',
  resultType: 'latest', intervalMinutes: 60, ...p,
});

describe('⭐⭐ 词的拼法', () => {
  it('⭐⭐ 多个关键词是 **OR** 不是 AND —— 否则几乎搜不到东西', () => {
    const r = recipeToQuery(recipe({ keywords: ['翻墙', '梯子'] }), NOW);
    expect(r.q, '词之间不是 OR').toContain('("翻墙" OR "梯子")');
  });

  it('⭐⭐ 词**加引号** —— 不加的话 X 把词组拆成多词 AND,噪音暴涨', () => {
    const r = recipeToQuery(recipe({ keywords: ['回国 加速器'] }), NOW);
    expect(r.q, '词组没加引号').toContain('"回国 加速器"');
  });

  it('⭐ 单个词不套括号 —— 省得出现 ("a") 这种噪音', () => {
    const r = recipeToQuery(recipe({ keywords: ['翻墙'] }), NOW);
    expect(r.q).toContain('"翻墙"');
    expect(r.q, '一个词也套了括号').not.toContain('("翻墙")');
  });

  it('⚠️ 已经带引号/操作符的**原样放行** —— 别套两层', () => {
    const r = recipeToQuery(recipe({ keywords: ['"已带引号"', 'lang:en'] }), NOW);
    expect(r.q, '套了两层引号').not.toContain('""已带引号""');
    expect(r.q).toContain('lang:en');
  });

  it('⚠️⚠️ from: 要**去掉 @** —— X 不认 from:@xxx', () => {
    const r = recipeToQuery(recipe({ fromAccounts: ['@elonmusk'] }), NOW);
    expect(r.q, '@ 没去掉 —— X 搜不出东西且不报错').toContain('from:elonmusk');
    expect(r.q).not.toContain('from:@');
  });
});

describe('⭐⭐⭐ 四个模板的区别', () => {
  it('⭐ trending:关键词任一命中', () => {
    const r = recipeToQuery(recipe({ template: 'trending', keywords: ['a', 'b'] }), NOW);
    expect(r.q).toContain('("a" OR "b")');
    expect(r.problems).toEqual([]);
  });

  it('⭐⭐ vip-tracking:**只认 from:**,不筛词', () => {
    const r = recipeToQuery(recipe({
      template: 'vip-tracking', fromAccounts: ['alice', 'bob'],
      /** ⚠️ 故意填了关键词 —— 盯人模板不该把它拼进去 */
      keywords: ['不该出现'],
    }), NOW);
    expect(r.q).toContain('(from:alice OR from:bob)');
    expect(r.q, '盯人模板把关键词也拼进去了 —— 那就不是盯人了')
      .not.toContain('不该出现');
  });

  it('⚠️⚠️ vip-tracking 没填账号 → **报问题**,不静默出个空查询', () => {
    const r = recipeToQuery(recipe({ template: 'vip-tracking' }), NOW);
    expect(r.problems.join(''), '盯人却没填盯谁,居然不报').toContain('fromAccounts');
  });

  /**
   * ⭐⭐⭐ help-wanted 的全部意义:关键词 **且** 求助信号 —— 两组是 AND。
   * 只搜「vpn」会捞回一堆广告(实测英文泛词精确率 4%),
   * 加上「怎么办/求助/连不上」才是真求助。
   */
  it('⭐⭐⭐ help-wanted:关键词 **AND** 求助信号(两组都要命中)', () => {
    const r = recipeToQuery(recipe({
      template: 'help-wanted', keywords: ['vpn'], helpSignals: ['怎么办', '连不上'],
    }), NOW);
    expect(r.q).toContain('"vpn"');
    expect(r.q).toContain('("怎么办" OR "连不上")');
    /** ⚠️ 两组之间是空格(AND),不是 OR —— 是 OR 就退化成普通搜索了 */
    expect(r.q, '两组之间成了 OR —— 求助信号白加了')
      .not.toMatch(/"vpn"\s+OR/);
  });

  it('⚠️ help-wanted 没填信号词 → 报问题(退化成普通搜索)', () => {
    const r = recipeToQuery(recipe({ template: 'help-wanted', keywords: ['vpn'] }), NOW);
    expect(r.problems.join(''), '退化了却不说').toContain('helpSignals');
  });

  it('⚠️ 既没词也没账号 → 报问题,不出个只有 since: 的空查询', () => {
    const r = recipeToQuery(recipe({ template: 'custom' }), NOW);
    expect(r.problems.join('')).toContain('搜不出东西');
  });
});

describe('⭐⭐ 门槛与时间窗', () => {
  it('⭐ 赞/转门槛拼成 min_faves / min_retweets', () => {
    const r = recipeToQuery(recipe({ keywords: ['a'], minLikes: 10, minRetweets: 5 }), NOW);
    expect(r.q).toContain('min_faves:10');
    expect(r.q).toContain('min_retweets:5');
  });

  it('⚠️ 门槛是 0 或没填 → **不拼** —— min_faves:0 是噪音', () => {
    const r = recipeToQuery(recipe({ keywords: ['a'], minLikes: 0 }), NOW);
    expect(r.q, '把 0 也拼进去了').not.toContain('min_faves');
  });

  /**
   * ⚠️⚠️ `include:replies` **X 已不支持**,加上去结果变 0 条且**静默不报错**。
   * 实测 2026-09-06:from: 裸查 12 条/回复 11,+filter:replies 22 条/回复 22。
   */
  it('⚠️⚠️ 连回复一起抓用 **filter:replies**,不是 include:replies', () => {
    const r = recipeToQuery(recipe({ keywords: ['a'], includeReplies: true }), NOW);
    expect(r.q).toContain('filter:replies');
    expect(r.q, 'include:replies 已失效 —— 会静默返回 0 条').not.toContain('include:replies');
  });

  /**
   * ⚠️ X 的 `since:` **只到天级**,所以小时数要**向上取整到天**。
   * `sinceHours=6` 若算成「今天」,会漏掉昨夜那几条。
   */
  it('⭐⭐ sinceHours 不足一天 → 仍回退到**整一天**(since 只到天级)', () => {
    const r = recipeToQuery(recipe({ keywords: ['a'], sinceHours: 6 }), NOW);
    expect(r.q, '6 小时被算成「今天」—— 会漏掉昨夜的').toContain('since:2026-10-03');
  });

  it('⭐ sinceHours=48 → 两天前', () => {
    const r = recipeToQuery(recipe({ keywords: ['a'], sinceHours: 48 }), NOW);
    expect(r.q).toContain('since:2026-10-02');
  });

  it('⭐ 没填 sinceHours → 默认 24 小时', () => {
    const r = recipeToQuery(recipe({ keywords: ['a'] }), NOW);
    expect(r.q).toContain('since:2026-10-03');
  });

  it('⭐ resultType 原样带出 —— 交给 x.search 的 f', () => {
    expect(recipeToQuery(recipe({ keywords: ['a'], resultType: 'top' }), NOW).resultType).toBe('top');
    expect(recipeToQuery(recipe({ keywords: ['a'] }), NOW).resultType).toBe('latest');
  });
});

/**
 * ⭐⭐ **人点之前要看得见实际会搜什么** ——
 * 配方里填的词与最终发出去的串不是一回事。
 */
describe('⭐⭐ 要能说清这条配方实际搜什么', () => {
  it('⭐⭐ explain 说清词数/门槛/时间窗', () => {
    const r = recipeToQuery(recipe({
      keywords: ['a', 'b'], minLikes: 10, lang: 'zh', sinceHours: 24,
    }), NOW);
    expect(r.explain, '没说关键词').toContain('2 个关键词');
    expect(r.explain, '没说门槛').toContain('赞 ≥ 10');
    expect(r.explain, '没说语言').toContain('zh');
    expect(r.explain, '没说时间窗').toContain('2026-10-03');
  });

  it('⭐ 能用的配方 problems 为空 —— 面板靠它决定能不能点', () => {
    expect(recipeToQuery(recipe({ keywords: ['a'] }), NOW).problems).toEqual([]);
  });
});
