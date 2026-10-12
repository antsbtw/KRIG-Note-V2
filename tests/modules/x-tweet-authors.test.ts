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
const OBS = { observedAt: NOW };

describe('authorsFromTweets', () => {
  it('⭐ 按数字 id 去重;后面的有值字段覆盖,没值的不覆盖;handle 归一化;没 id 挡下', () => {
    const { authors, skippedNoRestId } = authorsFromTweets([
      { authorRestId: '1', authorHandle: '@Foo', following: true, authorBio: 'bio1' },
      { authorRestId: '1', authorHandle: 'foo', followedBy: false, authorBio: '' },
      { authorRestId: '', authorHandle: 'noid' },
      { authorRestId: '2', authorHandle: '' },
    ], NOW);
    expect(skippedNoRestId).toBe(2);
    expect(authors).toEqual([{ restId: '1', handle: 'foo', iFollow: true, followsMe: false, bio: 'bio1', observedAt: NOW }]);
  });
});

describe('buildAuthorUpsert', () => {
  it('⭐⭐⭐ 只写有值的字段 —— 推文没带关系标记时不许把名单采来的标记冲成 NONE', () => {
    const q = buildAuthorUpsert({ restId: '1', handle: 'foo', name: '老朋友', ...OBS }, undefined);
    expect(q.sql).toMatch(/display_name = IF [^;]+ THEN \$display_name ELSE display_name END/);
    expect(q.sql).not.toMatch(/i_follow|follows_me|is_blue_verified/);
    expect(Object.keys(q.vars).sort()).toEqual(['display_name', 'handle', 'obs', 'rest_id']);
  });

  it('⭐⭐⭐ 人工字段一个都不碰(清单从人工字段常量推,不写死)', () => {
    const q = buildAuthorUpsert({
      restId: '1', handle: 'foo', name: 'n', avatar: 'a', bio: 'b', isBlueVerified: true, iFollow: false, followsMe: false, ...OBS,
    }, '配方A');
    expect(USER_BUSINESS_FIELDS.length).toBeGreaterThan(10);
    for (const f of USER_BUSINESS_FIELDS) {
      expect(q.sql, `${f} 是人工字段`).not.toMatch(new RegExp(`\\b${f}\\b`));
    }
    /** 名单字段也不碰 —— 这不是名单 */
    expect(q.sql).not.toMatch(/list_/);
    for (const f of USER_BUSINESS_FIELDS) expect(TWEET_AUTHOR_FIELDS).not.toContain(f);
  });

  it('⭐⭐ 身份按数字 id、不带 WHERE、RETURN BEFORE 分新旧;配方只加不减', () => {
    const q = buildAuthorUpsert({ restId: '42', handle: 'x', ...OBS }, '配方A');
    expect(q.sql).toContain("UPSERT type::record('x_author', $rest_id)");
    expect(q.sql).not.toMatch(/\bWHERE\b/);
    expect(q.sql).toMatch(/RETURN BEFORE;$/);
    expect(q.sql).toContain('found_via_recipes = array::union(found_via_recipes ?? [], [$recipe])');
    expect(buildAuthorUpsert({ restId: '42', handle: 'x', ...OBS }, undefined).sql).not.toContain('found_via_recipes');
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

describe('⭐⭐⭐ 旧的观察不许覆盖新的(2026-10-08 Laosun 那次)', () => {
  /**
   * 补导拿 10-05 推文里的「互不关注」覆盖了 10-08 名单采到的「互关」。
   * 临时库验过:旧推文 vs 新名单 → 不动;新推文 vs 旧数据 → 更新;新人 → 写入;实时 → 更新。
   */
  it('采集字段都带「比库里新才写」的条件;fetched_at 是最后一个赋值', () => {
    const q = buildAuthorUpsert({ restId: '1', handle: 'h', iFollow: false, followsMe: false, ...OBS }, 'R');
    for (const col of ['handle', 'i_follow', 'follows_me', 'fetched_at']) {
      expect(q.sql, `${col} 没带时间条件`).toMatch(new RegExp(`${col} = IF \\(fetched_at = NONE OR fetched_at <= type::datetime\\(\\$obs\\)\\) THEN`));
    }
    const sets = q.sql.slice(q.sql.indexOf(' SET ') + 5, q.sql.indexOf(' RETURN'));
    expect(sets.trim().startsWith('rest_id')).toBe(true);
    /**
     * ⚠️ 第一版只比「最后一次 fetched_at 在 i_follow 之后」—— 注入「在最前面**再加**一次 fetched_at」时仍全绿,
     * 而那一次就足以让后面所有判断拿新值比。改成:**只赋值一次,且是最后一项**。
     */
    /** ⚠️ 只数**赋值**(`fetched_at = IF`)—— 每个条件里都有 `fetched_at = NONE`,数它会把条件也算进去 */
    expect(sets.match(/\bfetched_at = IF\b/g)?.length, 'fetched_at 被赋值不止一次').toBe(1);
    expect(sets.trim(), 'fetched_at 不是最后一项 —— 后面的判断会拿新值比').toMatch(/fetched_at = IF [^,]+ END$/);
    /** 配方来源不受时间限制(旧推文也确实是那个配方找到的) */
    expect(sets).toMatch(/found_via_recipes = array::union/);
  });

  it('同一作者多条推文:按观察时间合并,最新的有值字段胜出', () => {
    const { authors } = authorsFromTweets([
      { authorRestId: '1', authorHandle: 'a', following: true, observedAt: '2026-10-07T00:00:00Z' },
      { authorRestId: '1', authorHandle: 'a', following: false, observedAt: '2026-10-05T00:00:00Z' },
    ]);
    expect(authors[0]).toMatchObject({ iFollow: true, observedAt: '2026-10-07T00:00:00Z' });
  });

  it('补导脚本把推文的采集时间当观察时间传下去', () => {
    const SCRIPT = read('scripts/x-backfill-tweet-authors.ts');
    expect(SCRIPT).toMatch(/observedAt: t\.fetched_at/);
    expect(SCRIPT).toMatch(/<string> fetched_at AS fetched_at FROM x_tweet/);
  });
});
