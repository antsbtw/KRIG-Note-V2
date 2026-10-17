/**
 * ⭐⭐ 配方 ↔ 库里一行 的映射与写入 SQL —— **纯模块**(不碰 electron / 库连接)
 *
 * 2026-10-16(蓝V互关 M1)从 search-recipe-repo 抽出来:repo 与脚本(scripts/x-seed-blue-mutual-recipes.ts)
 * 共用这一份,不各写一份 —— 本仓「加字段要登记四处」栽过多次,脚本再抄一份就是第五处。
 * ⚠️ 加字段:类型(SearchRecipe)/ 表(x-schema)/ 这里的 RecipeRow + rowToRecipe + recipeParams + 两条 SQL。
 *    include_replies 就是漏了这里,操作台勾了从来没存上(1.2.29 补)。
 */

import type { SearchRecipe } from '@shared/types/x-timeline-types';

/** SearchRecipe 与 DB 行之间的映射(snake_case ↔ camelCase) */
export interface RecipeRow {
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
  /** ⭐ 自动回复开关 —— **按配方**(老行没有这个字段,故可空) */
  auto_reply?: boolean | null;
  auto_reply_at?: string | null;
  /** ⭐ 1.2.29 —— 老行没有,故可空 */
  include_replies?: boolean | null;
  blue_only?: boolean | null;
}

export function rowToRecipe(row: RecipeRow): SearchRecipe {
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
    /**
     * ⭐ 自动回复开关。⚠️ **缺省是 false 不是 undefined** ——
     * 老配方没有这个字段,读成 undefined 再传给闸门会走进
     * 「没表态」分支;这里当场归一成 false,**默认关**。
     */
    autoReply: row.auto_reply === true,
    autoReplyAt: row.auto_reply_at != null ? String(row.auto_reply_at) : undefined,
    includeReplies: row.include_replies === true,
    blueOnly: row.blue_only === true,
  };
}

/** 写库参数 —— INSERT / UPDATE 共用 */
export function recipeParams(recipe: Omit<SearchRecipe, 'id'>): Record<string, unknown> {
  return {
    name: recipe.name,
    enabled: recipe.enabled,
    template: recipe.template,
    keywords: recipe.keywords ?? [],
    from_accounts: recipe.fromAccounts ?? [],
    help_signals: recipe.helpSignals ?? [],
    min_likes: recipe.minLikes ?? 0,
    min_retweets: recipe.minRetweets ?? 0,
    /**
     * ⚠️⚠️ **传 undefined 不传 null** —— `lang` 是 `option<string>`。
     * SurrealDB 的 `NONE` 与 `NULL` 是两个值,`option<T>` 只收 NONE;
     * SDK 绑定 undefined→NONE、null→NULL(实测)。
     * 传 null 会被拒:`Expected \`none | string\` but found \`NULL\``
     * —— 真机 2026-10-04 存配方时就这么报的。
     * ⭐ `project-surreal-none-vs-null` 的铁律:**看到 `?? null` 就是 bug**。
     */
    lang: recipe.lang === undefined || recipe.lang === '' ? undefined : recipe.lang,
    since_hours: recipe.sinceHours ?? 24,
    result_type: recipe.resultType,
    interval_minutes: recipe.intervalMinutes,
    /** ⚠️ 默认关 —— 自动回复必须是明确打开的,不能因为字段缺失而默认开 */
    auto_reply: recipe.autoReply === true,
    include_replies: recipe.includeReplies === true,
    blue_only: recipe.blueOnly === true,
  };
}

/**
 * ⚠️ **SQL 与参数两处都要登记** —— 漏 SQL 这一处 → 开关点了没反应,而类型和 UI 看着都对。
 * ⚠️ auto_reply_at 只在**从关变开**时写,重复保存不刷新。
 */
export const UPDATE_RECIPE_SQL = `UPDATE search_recipes SET
  name = $name, enabled = $enabled, template = $template,
  keywords = $keywords, from_accounts = $from_accounts, help_signals = $help_signals,
  min_likes = $min_likes, min_retweets = $min_retweets, lang = $lang,
  since_hours = $since_hours, result_type = $result_type, interval_minutes = $interval_minutes,
  include_replies = $include_replies, blue_only = $blue_only,
  auto_reply = $auto_reply,
  auto_reply_at = IF $auto_reply = true AND auto_reply != true
    THEN time::now() ELSE auto_reply_at END
 WHERE recipe_id = $recipe_id`;

/** ⚠️ 新建分支也要登记 —— 漏了的话新建时勾的开关会静默丢失 */
export const INSERT_RECIPE_SQL = `INSERT INTO search_recipes {
  recipe_id: $recipe_id, name: $name, enabled: $enabled, template: $template,
  keywords: $keywords, from_accounts: $from_accounts, help_signals: $help_signals,
  min_likes: $min_likes, min_retweets: $min_retweets, lang: $lang,
  since_hours: $since_hours, result_type: $result_type, interval_minutes: $interval_minutes,
  include_replies: $include_replies, blue_only: $blue_only,
  auto_reply: $auto_reply,
  auto_reply_at: IF $auto_reply = true THEN time::now() ELSE NONE END,
  last_run_at: NONE
}`;
