/**
 * ⭐⭐ 推文作者 → 人表 + 「互不关注 / 关系不明」+ 配方来源(2026-10-08)
 *
 * 用户:「还缺少一种类型，就是我既没有关注他，他也没有关注我。是通过配方找到的用户。」
 * 「建议这样的人，在搜索下来时就添加标签--哪个配方的收集下来的。」
 * ⚠️ SQL 在真库上的行为本文件证明不了 —— 交付前在临时库演练。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authorsFromTweets, buildAuthorUpsert, TWEET_AUTHOR_FIELDS } from '@modules/x/x-tweet-authors';
import { recipeNameForQuery, recipeToQuery } from '@modules/x/x-recipe-query';
import { USER_BUSINESS_FIELDS } from '@modules/x/x-user-repo';
import { PEOPLE_GROUPS } from '@modules/x/x-people-query';
import type { SearchRecipe } from '@shared/types/x-timeline-types';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');
const NOW = '2026-10-08T00:00:00.000Z';

describe('authorsFromTweets', () => {
  it('⭐ 按数字 id 去重;后面的有值字段覆盖,没值的不覆盖;handle 归一化;没 id 挡下', () => {
    const { authors, skippedNoRestId } = authorsFromTweets([
      { authorRestId: '1', authorHandle: '@Foo', following: true, authorBio: 'bio1' },
      { authorRestId: '1', authorHandle: 'foo', followedBy: false, authorBio: '' },
      { authorRestId: '', authorHandle: 'noid' },
      { authorRestId: '2', authorHandle: '' },
    ]);
    expect(skippedNoRestId).toBe(2);
    expect(authors).toEqual([{ restId: '1', handle: 'foo', iFollow: true, followsMe: false, bio: 'bio1' }]);
  });
});

describe('buildAuthorUpsert', () => {
  it('⭐⭐⭐ 只写有值的字段 —— 推文没带关系标记时不许把名单采来的标记冲成 NONE', () => {
    const q = buildAuthorUpsert({ restId: '1', handle: 'foo', name: '老朋友' }, undefined, NOW);
    expect(q.sql).toContain('display_name = $display_name');
    expect(q.sql).not.toMatch(/i_follow|follows_me|is_blue_verified/);
    expect(Object.keys(q.vars).sort()).toEqual(['display_name', 'handle', 'now', 'rest_id']);
  });

  it('⭐⭐⭐ 人工字段一个都不碰(清单从人工字段常量推,不写死)', () => {
    const q = buildAuthorUpsert({
      restId: '1', handle: 'foo', name: 'n', avatar: 'a', bio: 'b', isBlueVerified: true, iFollow: false, followsMe: false,
    }, '配方A', NOW);
    expect(USER_BUSINESS_FIELDS.length).toBeGreaterThan(10);
    for (const f of USER_BUSINESS_FIELDS) {
      expect(q.sql, `${f} 是人工字段`).not.toMatch(new RegExp(`\\b${f}\\b`));
    }
    /** 名单字段也不碰 —— 这不是名单 */
    expect(q.sql).not.toMatch(/list_/);
    for (const f of USER_BUSINESS_FIELDS) expect(TWEET_AUTHOR_FIELDS).not.toContain(f);
  });

  it('⭐⭐ 身份按数字 id、不带 WHERE、RETURN BEFORE 分新旧;配方只加不减', () => {
    const q = buildAuthorUpsert({ restId: '42', handle: 'x' }, '配方A', NOW);
    expect(q.sql).toContain("UPSERT type::record('x_author', $rest_id)");
    expect(q.sql).not.toMatch(/\bWHERE\b/);
    expect(q.sql).toMatch(/RETURN BEFORE;$/);
    expect(q.sql).toContain('found_via_recipes = array::union(found_via_recipes ?? [], [$recipe])');
    expect(buildAuthorUpsert({ restId: '42', handle: 'x' }, undefined, NOW).sql).not.toContain('found_via_recipes');
  });
});

describe('recipeNameForQuery', () => {
  const r = (name: string, keywords: string[]): SearchRecipe => ({
    id: name, name, enabled: true, template: 'trending', keywords,
  } as unknown as SearchRecipe);
  const recipes = [r('A', ['VPN', '翻墙']), r('B', ['回国VPN'])];

  it('⭐ 去掉每天都变的 since:/until: 后完全一致才算', () => {
    const q = recipeToQuery(recipes[0], Date.parse('2026-10-04')).q;
    expect(recipeNameForQuery(q, recipes, Date.parse('2026-10-08'))).toBe('A');
  });

  it('⭐⭐ 对不上不猜;两个配方生成同一串也不猜', () => {
    expect(recipeNameForQuery('("VPN" OR "翻墙") ("help") since:2026-10-04', recipes)).toBeUndefined();
    expect(recipeNameForQuery(undefined, recipes)).toBeUndefined();
    expect(recipeNameForQuery(recipeToQuery(recipes[0]).q, [...recipes, r('A2', ['VPN', '翻墙'])])).toBeUndefined();
  });
});

describe('「互不关注」与「关系不明」', () => {
  it('⭐⭐⭐ 互不关注要两个标记都明确是 false;有一个不知道就归关系不明(不当成互不关注)', () => {
    const w = Object.fromEntries(PEOPLE_GROUPS.map((g) => [g.id, g.where]));
    expect(w.none).toBe('i_follow = false AND follows_me = false');
    expect(w.unknown).toContain('i_follow = NONE OR follows_me = NONE');
    expect(w.unknown).toContain('i_follow != true AND follows_me != true');
  });

  it('⭐ 关系不明只在有人时才占一格;互不关注格注明来源', () => {
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    expect(PAGE).toMatch(/g\.id !== 'unknown' \|\| \(overview\?\.unknown\.total \?\? 0\) > 0/);
    expect(PAGE).toContain('多为配方找到的');
    expect(PAGE).toMatch(/配方:\{r\}/);
  });
});

describe('接线', () => {
  const IPC = read('src/modules/x/x-data-ipc.ts');
  const body = IPC.slice(IPC.indexOf("case 'saveTweets':"), IPC.indexOf("case 'saveUsers':"));

  it('⭐⭐⭐ 存推文后顺带写作者,对回配方名,并记账(否则对账差出这批新人)', () => {
    expect(body.length).toBeGreaterThan(500);
    expect(body).toMatch(/recipeNameForQuery\(p\.ctx\?\.searchRecipe, recipes\)/);
    expect(body).toMatch(/await saveTweetAuthors\(p\.records, recipeName\)/);
    expect(body).toMatch(/kind: 'users', source: 'tweet-authors'/);
  });

  it('⭐⭐ 写作者失败不让存推文报失败 —— 在 try 里、catch 只留痕', () => {
    const i = body.indexOf('await saveTweetAuthors');
    const tryAt = body.lastIndexOf('try {', i);
    expect(tryAt, '写作者不在 try 里').toBeGreaterThan(-1);
    const catchBody = body.slice(body.indexOf('} catch (e) {', i), body.indexOf("return { status: 'ok', value: r };", i));
    expect(catchBody).toMatch(/traceRecorder\.lifecycle/);
    expect(catchBody).not.toMatch(/return failed/);
  });

  it('⭐ 迁移 1.2.23 登记了', () => {
    expect(read('src/storage/migrations/x-runner.ts')).toMatch(/version: '1\.2\.23'[\s\S]{0,200}up: x_migration_1_2_23/);
  });
});
