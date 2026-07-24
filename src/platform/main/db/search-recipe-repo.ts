/**
 * search_recipes 表 CRUD（X 时间线智能筛选 Phase 1）
 *
 * 调用边界：仅 main 进程调用，直接 import @storage/surreal/client。
 */

import { getDB } from '@storage/surreal/client';
import { generateUlid } from '@shared/ulid';
import type { SearchRecipe } from '@shared/types/x-timeline-types';

/** SearchRecipe 与 DB 行之间的映射（snake_case ↔ camelCase） */
interface RecipeRow {
  recipe_id: string;
  name: string;
  enabled: boolean;
  template: string;
  keywords: string[];
  from_accounts: string[];
  help_signals: string[];
  min_likes: number;
  min_retweets: number;
  lang: string | null;
  since_hours: number;
  result_type: string;
  interval_minutes: number;
  last_run_at: string | null;
}

function rowToRecipe(row: RecipeRow): SearchRecipe {
  return {
    id: row.recipe_id,
    name: row.name,
    enabled: row.enabled,
    template: row.template as SearchRecipe['template'],
    keywords: row.keywords,
    fromAccounts: row.from_accounts,
    helpSignals: row.help_signals,
    minLikes: row.min_likes,
    minRetweets: row.min_retweets,
    lang: row.lang ?? undefined,
    sinceHours: row.since_hours,
    resultType: row.result_type as SearchRecipe['resultType'],
    intervalMinutes: row.interval_minutes,
    lastRunAt: row.last_run_at != null ? String(row.last_run_at) : undefined,
  };
}

/** 初始两条搜索配方（VPN 求助-英文 / 中文） */
const INITIAL_RECIPES: Omit<SearchRecipe, 'id'>[] = [
  {
    name: 'VPN求助-英文',
    enabled: true,
    template: 'help-wanted',
    keywords: ['VPN', 'proxy', 'bypass GFW', 'censorship', 'blocked', 'shadowsocks', 'clash', 'v2ray', 'xray'],
    helpSignals: ["help", "how to", "can't connect", "not working", "anyone know", "recommend", "looking for", "need a"],
    minLikes: 0,
    minRetweets: 0,
    lang: 'en',
    sinceHours: 24,
    resultType: 'latest',
    intervalMinutes: 30,
  },
  {
    name: 'VPN求助-中文',
    enabled: true,
    template: 'help-wanted',
    keywords: ['VPN', '翻墙', '科学上网', '梯子', 'clash', 'v2ray', 'shadowsocks', '连不上', '不能用'],
    helpSignals: ['求助', '请问', '怎么', '如何', '有没有', '推荐', '帮帮', '求推荐'],
    minLikes: 0,
    minRetweets: 0,
    lang: 'zh',
    sinceHours: 24,
    resultType: 'latest',
    intervalMinutes: 30,
  },
];

/**
 * 首次启动时写入初始配方（幂等：若表中已有记录则跳过）。
 * 在 initStorage + migration_1_8_0 之后调用。
 */
export async function seedRecipes(): Promise<void> {
  const db = getDB();
  const existing = await db.query<[Array<{ recipe_id: string }>]>(
    `SELECT recipe_id FROM search_recipes LIMIT 1`,
  );
  if ((existing[0] ?? []).length > 0) return; // 已有数据，跳过

  for (const recipe of INITIAL_RECIPES) {
    const id = generateUlid();
    await db.query(
      `INSERT INTO search_recipes {
        recipe_id: $recipe_id,
        name: $name,
        enabled: $enabled,
        template: $template,
        keywords: $keywords,
        from_accounts: $from_accounts,
        help_signals: $help_signals,
        min_likes: $min_likes,
        min_retweets: $min_retweets,
        lang: $lang,
        since_hours: $since_hours,
        result_type: $result_type,
        interval_minutes: $interval_minutes,
        last_run_at: NONE
      }`,
      {
        recipe_id: id,
        name: recipe.name,
        enabled: recipe.enabled,
        template: recipe.template,
        keywords: recipe.keywords ?? [],
        from_accounts: recipe.fromAccounts ?? [],
        help_signals: recipe.helpSignals ?? [],
        min_likes: recipe.minLikes ?? 0,
        min_retweets: recipe.minRetweets ?? 0,
        lang: recipe.lang ?? null,
        since_hours: recipe.sinceHours ?? 24,
        result_type: recipe.resultType,
        interval_minutes: recipe.intervalMinutes,
      },
    );
  }
  console.log('[search-recipe-repo] seeded', INITIAL_RECIPES.length, 'initial recipes');
}

/** 取所有 enabled=true 的配方 */
export async function listEnabledRecipes(): Promise<SearchRecipe[]> {
  const db = getDB();
  const res = await db.query<[RecipeRow[]]>(
    `SELECT * FROM search_recipes WHERE enabled = true`,
  );
  return (res[0] ?? []).map(rowToRecipe);
}

/** 更新配方的 last_run_at */
export async function updateLastRunAt(recipeId: string, at: string): Promise<void> {
  const db = getDB();
  await db.query(
    `UPDATE search_recipes SET last_run_at = $at WHERE recipe_id = $recipe_id`,
    { at: new Date(at), recipe_id: recipeId },
  );
}

/** 按 recipe_id 取单条配方 */
export async function getRecipeById(recipeId: string): Promise<SearchRecipe | null> {
  const db = getDB();
  const res = await db.query<[RecipeRow[]]>(
    `SELECT * FROM search_recipes WHERE recipe_id = $recipe_id LIMIT 1`,
    { recipe_id: recipeId },
  );
  const row = res[0]?.[0];
  return row ? rowToRecipe(row) : null;
}

/** 取所有配方（不过滤 enabled，按名称排序） */
export async function listAllRecipes(): Promise<SearchRecipe[]> {
  const db = getDB();
  const res = await db.query<[RecipeRow[]]>(
    `SELECT * FROM search_recipes ORDER BY name ASC`,
  );
  return (res[0] ?? []).map(rowToRecipe);
}

/**
 * 新建或更新配方。
 * id 有值 = UPDATE，无值 = INSERT（生成新 ULID）。
 */
export async function upsertRecipe(
  recipe: Omit<SearchRecipe, 'id'> & { id?: string },
): Promise<SearchRecipe> {
  const db = getDB();
  const params = {
    name: recipe.name,
    enabled: recipe.enabled,
    template: recipe.template,
    keywords: recipe.keywords ?? [],
    from_accounts: recipe.fromAccounts ?? [],
    help_signals: recipe.helpSignals ?? [],
    min_likes: recipe.minLikes ?? 0,
    min_retweets: recipe.minRetweets ?? 0,
    lang: recipe.lang ?? null,
    since_hours: recipe.sinceHours ?? 24,
    result_type: recipe.resultType,
    interval_minutes: recipe.intervalMinutes,
  };

  if (recipe.id) {
    await db.query(
      `UPDATE search_recipes SET
        name = $name, enabled = $enabled, template = $template,
        keywords = $keywords, from_accounts = $from_accounts, help_signals = $help_signals,
        min_likes = $min_likes, min_retweets = $min_retweets, lang = $lang,
        since_hours = $since_hours, result_type = $result_type, interval_minutes = $interval_minutes
       WHERE recipe_id = $recipe_id`,
      { ...params, recipe_id: recipe.id },
    );
  } else {
    const id = generateUlid();
    await db.query(
      `INSERT INTO search_recipes {
        recipe_id: $recipe_id, name: $name, enabled: $enabled, template: $template,
        keywords: $keywords, from_accounts: $from_accounts, help_signals: $help_signals,
        min_likes: $min_likes, min_retweets: $min_retweets, lang: $lang,
        since_hours: $since_hours, result_type: $result_type, interval_minutes: $interval_minutes,
        last_run_at: NONE
      }`,
      { ...params, recipe_id: id },
    );
    recipe = { ...recipe, id };
  }

  const saved = await getRecipeById(recipe.id as string);
  if (!saved) throw new Error(`upsertRecipe: failed to read back recipe ${recipe.id}`);
  return saved;
}

/** 删除配方（不删关联的 tweet_inbox 记录） */
export async function deleteRecipe(recipeId: string): Promise<void> {
  const db = getDB();
  await db.query(
    `DELETE FROM search_recipes WHERE recipe_id = $recipe_id`,
    { recipe_id: recipeId },
  );
}

export interface RecipeStats {
  recipeId: string;
  total: number;       // 全部采集条数
  gemmaPass: number;   // Gemma 通过（非 filtered_out）
  adopted: number;     // 人工采纳（worth）
  rejected: number;    // 人工拒绝（skip）
  adoptRate: number;   // worth / (worth + skip) × 100，NaN 时为 0
}

/** 按 recipe id 统计 tweet_inbox 采纳率 */
export async function getRecipeStats(recipeId: string): Promise<RecipeStats> {
  const db = getDB();
  const res = await db.query<[Array<{ status: string; cnt: number }>]>(
    `SELECT status, count() AS cnt
     FROM tweet_inbox
     WHERE search_recipe = $recipe_id
     GROUP BY status`,
    { recipe_id: recipeId },
  );
  const rows = res[0] ?? [];
  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[row.status] = Number(row.cnt);

  const filteredOut = byStatus['filtered_out'] ?? 0;
  const pending    = byStatus['pending'] ?? 0;
  const worth      = byStatus['worth'] ?? 0;
  const skip       = byStatus['skip'] ?? 0;
  const replied    = byStatus['replied'] ?? 0;

  const total      = filteredOut + pending + worth + skip + replied;
  const gemmaPass  = pending + worth + skip + replied; // 非 filtered_out
  const adopted    = worth + replied;
  const rejected   = skip;
  const denom      = adopted + rejected;
  const adoptRate  = denom > 0 ? Math.round((adopted / denom) * 100) : 0;

  return { recipeId, total, gemmaPass, adopted, rejected, adoptRate };
}
