/**
 * ⭐ 把库里已有推文的**作者**补进人表(2026-10-08)
 *
 * 用法(⚠️ 要 app 在跑,且已重启过让迁移 1.2.23 建好 found_via_recipes):
 *   npx tsx scripts/x-backfill-tweet-authors.ts                      # 只看,不写(默认)
 *   npx tsx scripts/x-backfill-tweet-authors.ts --apply              # 真写
 *   npx tsx scripts/x-backfill-tweet-authors.ts --apply --unmatched-recipe=VPN求助-英文
 *       # 对不上任何现有配方的推文(配方后来改过),由人指定归给哪个配方;不指定就不记配方
 *
 * ── 为什么要补 ──
 * 采推文时一直只存推文、不存作者:配方搜到 130 条、123 个作者,只有 5 个在人表里。
 * 从这次起采推文会顺带写作者(x-data-ipc saveTweets),这个脚本补的是**之前**那批。
 *
 * ⚠️⚠️ 每个作者带**推文的采集时间**当观察时间:旧推文不覆盖人表里更新的数据
 * (2026-10-08 第一版没带,10-05 推文的「互不关注」冲掉了 10-08 名单的「互关」)。
 * ⚠️ 与实时写入用**同一套**纯函数(authorsFromTweets / buildAuthorUpsert / recipeNameForQuery),
 * 不另写一份。⚠️ 用 CJS(main 函数,不用顶层 await)—— .mts 会让 SDK 双包,RecordId 被编成 {}。
 * DBN 环境变量可指定别的 database(演练用)。
 */
import { Surreal } from 'surrealdb';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { authorsFromTweets, buildAuthorUpsert, type TweetAuthorSource } from '../src/modules/x/x-tweet-authors';
import { recipeNameForQuery } from '../src/modules/x/x-recipe-query';
import type { SearchRecipe } from '../src/shared/types/x-timeline-types';

const APPLY = process.argv.includes('--apply');
const UNMATCHED = process.argv.find((a) => a.startsWith('--unmatched-recipe='))?.split('=')[1];
const DBN = process.env.DBN ?? 'krig_x';

type TweetRow = {
  search_recipe?: string; author_rest_id?: string; author_handle?: string; author_name_at_post?: string;
  author_avatar?: string; author_bio?: string; is_blue_verified?: boolean; following?: boolean; followed_by?: boolean;
  fetched_at?: string;
};

async function main(): Promise<void> {
  const cred = join(homedir(), 'Library/Application Support/KRIG Note V2/.db-credentials');
  const { username, password } = JSON.parse(readFileSync(cred, 'utf-8'));
  const db = new Surreal();
  await Promise.race([
    db.connect('ws://127.0.0.1:8533/rpc'),
    new Promise((_, r) => setTimeout(() => r(new Error('连不上库 —— app 没在跑吧?先打开 app 再跑本脚本。')), 8000)),
  ]);
  await db.signin({ username, password });
  await db.use({ namespace: 'krig', database: DBN });
  try {
    const info = (await db.query<any[]>('INFO FOR TABLE x_author'))[0];
    if (!('found_via_recipes' in (info?.fields ?? {}))) {
      throw new Error('x_author.found_via_recipes 还不存在 —— 先重启 app 让迁移 1.2.23 跑完再补。');
    }
    if (UNMATCHED !== undefined) {
      const [[r]] = await db.query<any[]>('SELECT name FROM search_recipes WHERE name = $n', { n: UNMATCHED });
      if (!r) throw new Error(`--unmatched-recipe 指定的配方「${UNMATCHED}」不存在`);
    }

    const [recipeRows] = await db.query<any[]>('SELECT * FROM search_recipes');
    const recipes = (recipeRows ?? []).map((r: any) => ({ ...r, id: String(r.id) })) as SearchRecipe[];
    const [tweets] = await db.query<[TweetRow[]]>(`SELECT search_recipe, author_rest_id, author_handle,
      author_name_at_post, author_avatar, author_bio, is_blue_verified, following, followed_by,
      <string> fetched_at AS fetched_at FROM x_tweet`);

    /** ① 按配方分组 —— 对不上的单独一组,等人指定 */
    const groups = new Map<string, TweetAuthorSource[]>();
    const unmatchedQueries = new Set<string>();
    for (const t of tweets ?? []) {
      const name = recipeNameForQuery(t.search_recipe, recipes);
      if (name === undefined && t.search_recipe) unmatchedQueries.add(t.search_recipe);
      const key = name ?? UNMATCHED ?? '';
      const list = groups.get(key) ?? [];
      list.push({
        authorRestId: t.author_rest_id, authorHandle: t.author_handle, authorName: t.author_name_at_post,
        authorAvatar: t.author_avatar, authorBio: t.author_bio, isBlueVerified: t.is_blue_verified,
        following: t.following, followedBy: t.followed_by,
        /** ⭐⭐ 旧推文的观察时间 —— 不许覆盖人表里更新的数据(Laosun 那次就是这么错的) */
        observedAt: t.fetched_at,
      });
      groups.set(key, list);
    }

    console.log(`推文 ${(tweets ?? []).length} 条`);
    if (unmatchedQueries.size > 0) {
      console.log(`⚠️ 有 ${unmatchedQueries.size} 种查询串对不上任何现有配方(配方后来改过?):`);
      for (const q of unmatchedQueries) console.log(`   ${q.slice(0, 100)}…`);
      console.log(UNMATCHED ? `   → 按 --unmatched-recipe 归给「${UNMATCHED}」` : '   → 不记配方(要归给某个配方就加 --unmatched-recipe=名字)');
    }

    let inserted = 0; let updated = 0; let noId = 0; const failed: string[] = [];
    for (const [name, rows] of groups) {
      const { authors, skippedNoRestId } = authorsFromTweets(rows);
      noId += skippedNoRestId;
      const ids = authors.map((a) => a.restId);
      const [exist] = await db.query<[string[]]>('SELECT VALUE rest_id FROM x_author WHERE rest_id IN $ids', { ids });
      const newCount = authors.length - (exist ?? []).length;
      console.log(`配方「${name || '(不记)'}」:推文 ${rows.length} 条 → 作者 ${authors.length} 人(新 ${newCount} / 已在人表 ${(exist ?? []).length})`);
      if (!APPLY) continue;
      for (const a of authors) {
        try {
          const q = buildAuthorUpsert(a, name || undefined);
          const [before] = await db.query<[Array<unknown>]>(q.sql, q.vars);
          if (before?.[0] === undefined || before?.[0] === null) inserted += 1; else updated += 1;
        } catch (e) { failed.push(`${a.restId}: ${(e as Error).message}`); }
      }
    }
    if (noId > 0) console.log(`无数字 id 挡下 ${noId} 条`);

    if (!APPLY) {
      console.log('\n(只看模式,没写。确认无误后加 --apply 真写)');
    } else {
      console.log(`\n已写入:新 ${inserted} / 更新 ${updated}${failed.length ? ` / 失败 ${failed.length}:${failed[0]}` : ''}`);
      /** ⭐ 记账 —— 否则状态页对账会差出这批新人 */
      if (inserted + updated + failed.length > 0) {
        await db.query(`CREATE x_collect_log SET at = time::now(), kind = 'users', source = 'tweet-authors',
          given = $g, inserted = $i, updated = $u, failed = $f, origin = 'backfill'`,
        { g: inserted + updated + failed.length, i: inserted, u: updated, f: failed.length });
      }
    }

    const [ledger, [au]] = await db.query<any[]>(`
      SELECT math::sum(inserted) AS ins FROM x_collect_log WHERE kind = 'users' GROUP ALL;
      SELECT count() AS n FROM x_author GROUP ALL;`);
    const l = ledger?.[0]?.ins ?? 0;
    console.log(`对账:人 表 ${au?.n ?? 0} · 账本 ${l} ${au?.n === l ? '✓ 对上' : `⚠️ 差 ${(au?.n ?? 0) - l}`}`);
    const [[g]] = await db.query<any[]>(`SELECT count(i_follow = false AND follows_me = false) AS none,
      count(i_follow != true AND follows_me != true AND (i_follow = NONE OR follows_me = NONE)) AS unknown FROM x_author GROUP ALL`);
    console.log(`互不关注 ${g?.none ?? 0} · 关系不明 ${g?.unknown ?? 0}`);
  } finally {
    await db.close();
  }
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
