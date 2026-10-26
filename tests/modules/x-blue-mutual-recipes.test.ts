/**
 * ⭐ 蓝V互关配方(2026-10-16,M1)—— 用户:「配方搜索已经有了,关键就是配方了。」
 * 钉:只看蓝V的语法、两条配方实际会搜什么、新开关(与补上的老开关)映射不丢。
 */
import { describe, it, expect } from 'vitest';
import { recipeToQuery } from '@modules/x/x-recipe-query';
import { recipeParams, rowToRecipe, INSERT_RECIPE_SQL, UPDATE_RECIPE_SQL, type RecipeRow } from '@platform/main/db/search-recipe-row';
import { BLUE_MUTUAL_RECIPES } from '../../scripts/x-seed-blue-mutual-recipes';

const NOW = Date.parse('2026-10-16T12:00:00Z');

describe('⭐ 话题标签不加引号(加了 X 按短语搜,不按话题)', () => {
  it('#蓝V互关 原样;普通词组照样加引号', () => {
    const q = recipeToQuery({ id: '', name: 'x', enabled: true, template: 'custom', keywords: ['#蓝V互关', '互关必回'], resultType: 'latest', intervalMinutes: 60 }, NOW);
    expect(q.q).toContain('(#蓝V互关 OR "互关必回")');
  });
});

describe('只看蓝V作者', () => {
  it('blueOnly → filter:blue_verified,说明里写出来;不勾就没有', () => {
    const base = { id: '', name: 'x', enabled: true, template: 'custom' as const, keywords: ['互关必回'], resultType: 'latest' as const, intervalMinutes: 60 };
    const on = recipeToQuery({ ...base, blueOnly: true }, NOW);
    expect(on.q).toContain('filter:blue_verified');
    expect(on.explain).toContain('只看蓝V作者');
    expect(recipeToQuery(base, NOW).q).not.toContain('filter:blue_verified');
  });
});

describe('两条配方实际会搜什么', () => {
  it('⭐ 中文:话题标签不加引号、词组加引号、任一命中、中文、只看蓝V、最近 30 天', () => {
    const q = recipeToQuery({ ...BLUE_MUTUAL_RECIPES[0], id: '' }, NOW);
    expect(q.problems).toEqual([]);
    expect(q.q).toBe('(#蓝V互关 OR #互关 OR #真诚交友 OR #浇朋友 OR "互关必回" OR "关注必回" OR "有关必回" OR "互关") lang:zh filter:blue_verified since:2026-09-16');
    expect(q.resultType).toBe('latest');
  });

  it('⚠️ 不用单字「回关」—— 真库误中「直接回关小黑屋」', () => {
    expect(BLUE_MUTUAL_RECIPES[0].keywords).not.toContain('回关');
  });

  it('英文:#followback / follow back / F4F', () => {
    const q = recipeToQuery({ ...BLUE_MUTUAL_RECIPES[1], id: '' }, NOW);
    expect(q.q).toBe('(#followback OR "follow back" OR "F4F") lang:en filter:blue_verified since:2026-09-16');
  });
});

describe('⭐⭐ 配方 ↔ 库里一行:新开关与老开关都不丢(加字段要登记的每一处)', () => {
  it('写库参数带上两个开关;读回来也有', () => {
    const p = recipeParams({ ...BLUE_MUTUAL_RECIPES[0], includeReplies: true });
    expect(p).toMatchObject({ blue_only: true, include_replies: true });
    const back = rowToRecipe({ ...(p as unknown as RecipeRow), recipe_id: 'r1', last_run_at: null, lang: 'zh' });
    expect(back.blueOnly).toBe(true);
    expect(back.includeReplies).toBe(true);
    /** 老行没有这两个字段 → 读成 false,不是 undefined */
    const old = rowToRecipe({ ...(p as unknown as RecipeRow), recipe_id: 'r1', last_run_at: null, lang: null, blue_only: undefined, include_replies: undefined });
    expect([old.blueOnly, old.includeReplies]).toEqual([false, false]);
  });

  it('⚠️ INSERT 与 UPDATE 两条 SQL 都写了两个开关(include_replies 当年就是 SQL 漏了)', () => {
    for (const sql of [INSERT_RECIPE_SQL, UPDATE_RECIPE_SQL]) {
      expect(sql).toMatch(/blue_only[:=\s]+\$blue_only/);
      expect(sql).toMatch(/include_replies[:=\s]+\$include_replies/);
    }
  });
});
