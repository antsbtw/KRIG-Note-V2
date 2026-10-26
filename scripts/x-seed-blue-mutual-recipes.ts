/**
 * ⭐ 建「蓝V互关」两条配方(2026-10-16,蓝V互关 M1)
 *
 * 用户 10-16:「配方搜索已经有了,关键就是配方了。」—— M1 只写配方,搜索 / 提取 / 作者进人表全复用。
 * 词来自真库互关蓝V的 Bio 实际写法(互关必回 / 关注必回 / 有关必回 / 诚信互关 / 互关交友 / 互粉 …)。
 * ⚠️ 不用单字「回关」:误中「直接回关小黑屋」(真库实测)。
 * ⚠️ filter:blue_verified 未经真机验证 —— 第一次搜要看结果是不是全是蓝V。
 *
 * 用法(⚠️ app 要在跑,且已重启过让迁移 1.2.29 建好 blue_only):
 *   npx tsx scripts/x-seed-blue-mutual-recipes.ts            # 只看(默认)
 *   npx tsx scripts/x-seed-blue-mutual-recipes.ts --apply    # 真建
 *   npx tsx scripts/x-seed-blue-mutual-recipes.ts --apply --update   # 已存在的同名配方:**只改关键词与时间窗**,先打出改前改后
 * 同名配方已存在默认**跳过不覆盖**(人可能已经在操作台改过);要改得明说 --update。
 * ⚠️ 映射与 SQL 用 search-recipe-row.ts(与 app 同一份),不另写。
 * ⚠️ 用 CJS(main 函数)—— .mts 会让 SDK 双包。
 */
import { Surreal } from 'surrealdb';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateUlid } from '../src/shared/ulid';
import { INSERT_RECIPE_SQL, recipeParams } from '../src/platform/main/db/search-recipe-row';
import { recipeToQuery } from '../src/modules/x/x-recipe-query';
import { SEARCH_TERMS_EN, SEARCH_TERMS_ZH } from '../src/modules/x/x-mutual-intent';
import type { SearchRecipe } from '../src/shared/types/x-timeline-types';

const APPLY = process.argv.includes('--apply');
const UPDATE = process.argv.includes('--update');
const DBN = process.env.DBN ?? 'krig_x';

export const BLUE_MUTUAL_RECIPES: ReadonlyArray<Omit<SearchRecipe, 'id'>> = [
  {
    name: '蓝V互关',
    enabled: true,
    template: 'custom',
    /** ⭐ 搜索词在 x-mutual-intent.ts(每个都是判断认得出的);以话题标签为主(用户 10-16) */
    keywords: [...SEARCH_TERMS_ZH],
    lang: 'zh',
    blueOnly: true,
    sinceHours: 24 * 30,
    resultType: 'latest',
    intervalMinutes: 60,
  },
  {
    name: '蓝V互关-英文',
    enabled: true,
    template: 'custom',
    keywords: [...SEARCH_TERMS_EN],
    lang: 'en',
    blueOnly: true,
    sinceHours: 24 * 30,
    resultType: 'latest',
    intervalMinutes: 60,
  },
];

async function main(): Promise<void> {
  const cred = JSON.parse(readFileSync(join(homedir(), 'Library/Application Support/KRIG Note V2/.db-credentials'), 'utf-8'));
  const db = new Surreal();
  await Promise.race([
    db.connect('ws://127.0.0.1:8533/rpc'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('连不上库(8s)—— app 没在跑?')), 8000)),
  ]);
  try {
    await db.signin({ username: cred.username, password: cred.password });
    await db.use({ namespace: 'krig', database: DBN });
    const [info] = await db.query<[{ fields?: Record<string, unknown> }]>('INFO FOR TABLE search_recipes');
    if (!('blue_only' in (info?.fields ?? {}))) throw new Error('search_recipes 还没有 blue_only —— 先重启 app 跑迁移 1.2.29');
    for (const r of BLUE_MUTUAL_RECIPES) {
      const q = recipeToQuery({ ...r, id: '' });
      const [found] = await db.query<[Array<{ recipe_id: string; keywords: string[]; since_hours: number }>]>(
        'SELECT recipe_id, keywords, since_hours FROM search_recipes WHERE name = $n', { n: r.name },
      );
      const old = found?.[0];
      if (old) {
        if (!UPDATE) { console.log(`「${r.name}」已存在,跳过(不覆盖;要改加 --update)`); continue; }
        console.log(`「${r.name}」改关键词与时间窗:\n  原:${JSON.stringify(old.keywords)} · ${old.since_hours} 小时\n  新:${JSON.stringify(r.keywords)} · ${r.sinceHours} 小时\n  实际会搜:${q.q}`);
        if (!APPLY) continue;
        const [upd] = await db.query<[unknown[]]>(
          'UPDATE search_recipes SET keywords = $k, since_hours = $h WHERE recipe_id = $id RETURN recipe_id',
          { k: r.keywords, h: r.sinceHours, id: old.recipe_id },
        );
        if (!upd || upd.length !== 1) throw new Error(`「${r.name}」没改上`);
        console.log('  已改 ✓');
        continue;
      }
      console.log(`「${r.name}」→ 实际会搜:${q.q}${q.problems.length > 0 ? `  ⚠️ ${q.problems.join(';')}` : ''}`);
      if (!APPLY) continue;
      await db.query(INSERT_RECIPE_SQL, { ...recipeParams(r), recipe_id: generateUlid() });
      const [back] = await db.query<[Array<{ blue_only?: boolean; lang?: string }>]>(
        'SELECT blue_only, lang FROM search_recipes WHERE name = $n', { n: r.name },
      );
      if (back?.[0]?.blue_only !== true) throw new Error(`「${r.name}」建了但 blue_only 没存上`);
      console.log('  已建 ✓');
    }
    if (!APPLY) console.log('(只看模式,没写。加 --apply 真建)');
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : String(e)); process.exit(1); });
}
