/**
 * ⭐⭐ 任务「蓝V互关」的概况(2026-10-16)—— 主进程,只读
 *
 * 用户 10-16:「是否增加一个和运营同级的task(任务),这个任务就是蓝V互关」「应该按照设计流程,蓝V互关我们要做什么,
 * 围绕需要做的事情来展现或构建就好了」→ 页面按设计文档的三件事:
 *   1 找我还没关注的蓝V   2 对有互关倾向的互动求关   3 已互关的蓝V看互动情况
 * 这里给每件事「做到哪了」的数字;关系按**当前号**算(1.2.27)。
 */
import { readDeferred } from './x-defer-repo';
import { getXDB } from '@storage/surreal/client';
import { PEOPLE_WITH_RELATION } from './x-account';

/** 这个任务用的配方名(M1 建的) */
export const BLUE_MUTUAL_RECIPES = ['蓝V互关', '蓝V互关-英文'] as const;

export type BlueMutualOverview = {
  /** 1 找人:最近一次配方搜索采到推文的时间 */
  readonly lastFindAt?: string;
  /** 配方找到过的人(按 found_via_recipes)/ 其中蓝V / 其中我没关注的蓝V */
  readonly found: number;
  readonly foundBlue: number;
  readonly foundBlueNotFollowed: number;
  /** 2 求关:蓝V · 我没关注 · 有互关倾向 · 没排除 —— 候选 */
  readonly candidates: number;
  /** 3 互动:互关的蓝V */
  readonly mutualBlue: number;
};

export async function readBlueMutualOverview(account: string): Promise<BlueMutualOverview> {
  const db = getXDB();
  const [last, found, mutual] = await db.query<[
    Array<{ at?: string }>,
    Array<{ n: number; blue: number; blueNot: number; cand: number }>,
    Array<{ n: number }>,
  ]>(`
    SELECT <string> time::max(fetched_at) AS at FROM x_tweet WHERE source = 'x.search' AND search_recipe CONTAINS '#蓝V互关' GROUP ALL;
    SELECT count() AS n,
      count(is_blue_verified = true) AS blue,
      count(is_blue_verified = true AND i_follow != true) AS blueNot,
      count(is_blue_verified = true AND i_follow != true AND mutual_intent = true AND excluded != true AND rest_id NOTINSIDE $deferred) AS cand
      FROM ${PEOPLE_WITH_RELATION} WHERE array::len(array::intersect(found_via_recipes ?? [], $recipes)) > 0 GROUP ALL;
    SELECT count() AS n FROM ${PEOPLE_WITH_RELATION} WHERE is_blue_verified = true AND i_follow = true AND follows_me = true GROUP ALL;`,
  { acct: account, recipes: [...BLUE_MUTUAL_RECIPES], deferred: await readDeferred(account, 'ask') });
  const f = found?.[0];
  return {
    lastFindAt: last?.[0]?.at,
    found: f?.n ?? 0, foundBlue: f?.blue ?? 0, foundBlueNotFollowed: f?.blueNot ?? 0, candidates: f?.cand ?? 0,
    mutualBlue: mutual?.[0]?.n ?? 0,
  };
}

/** 候选的条件:配方找到的 · 蓝V · 我没关注 · 有互关倾向 · 没排除 · 最近没放一放(用户 10-23) */
const CAND_WHERE = `array::len(array::intersect(found_via_recipes ?? [], $recipes)) > 0
  AND is_blue_verified = true AND i_follow != true AND mutual_intent = true AND excluded != true AND rest_id NOTINSIDE $deferred`;

export type Candidate = {
  readonly rest_id: string; readonly handle: string; readonly display_name?: string; readonly avatar?: string;
  readonly followers_count?: number; readonly follows_me?: boolean; readonly mutual_intent_evidence?: string;
  readonly mutual_intent_source?: string;
};

/** ⭐ 2 求关:候选名单(粉丝多的在前) */
export async function readCandidates(account: string, limit: number): Promise<Candidate[]> {
  const [rows] = await getXDB().query<[Candidate[]]>(
    `SELECT rest_id, handle, display_name, avatar, followers_count, follows_me, mutual_intent_evidence, mutual_intent_source
       FROM ${PEOPLE_WITH_RELATION} WHERE ${CAND_WHERE} ORDER BY followers_count DESC LIMIT $limit`,
    { acct: account, recipes: [...BLUE_MUTUAL_RECIPES], limit, deferred: await readDeferred(account, 'ask') },
  );
  return rows ?? [];
}

export type FollowProgress = {
  readonly followedTotal: number;
  /** 关注过的人里现在回关了的 */
  readonly followedBack: number;
  /** 关注满 N 天还没回关的(回访名单) */
  readonly revisit: ReadonlyArray<{ readonly rest_id: string; readonly handle: string; readonly followedAt: string }>;
  readonly revisitDays: number;
};

/**
 * ⭐ 2 求关的进度 + 回访名单:按动作记录(我们关注过谁、何时)对当前号的关系。
 * ⚠️ 回访只列「我仍关注着、他还没回关」的 —— 已经取关的不算。
 */
export async function readFollowProgress(account: string, revisitDays: number): Promise<FollowProgress> {
  const db = getXDB();
  const [acts] = await db.query<[Array<{ rid: string; handle: string; at: string }>]>(
    `SELECT target_rest_id AS rid, target_handle AS handle, <string> time::max(at) AS at FROM x_action_log
       WHERE action = 'follow' AND result = 'ok' GROUP BY rid, handle`,
  );
  const list = acts ?? [];
  if (list.length === 0) return { followedTotal: 0, followedBack: 0, revisit: [], revisitDays };
  const [rel] = await db.query<[Array<{ rest_id: string; i_follow?: boolean; follows_me?: boolean }>]>(
    `SELECT rest_id, i_follow, follows_me FROM ${PEOPLE_WITH_RELATION} WHERE rest_id IN $ids`,
    { acct: account, ids: list.map((a) => a.rid) },
  );
  const byId = new Map((rel ?? []).map((r) => [r.rest_id, r]));
  const cutoff = Date.now() - revisitDays * 86_400_000;
  return {
    followedTotal: list.length,
    followedBack: list.filter((a) => byId.get(a.rid)?.follows_me === true).length,
    revisit: list
      .filter((a) => Date.parse(a.at) < cutoff && byId.get(a.rid)?.i_follow === true && byId.get(a.rid)?.follows_me !== true)
      .map((a) => ({ rest_id: a.rid, handle: a.handle, followedAt: a.at })),
    revisitDays,
  };
}
