/**
 * ⭐ 查回关 / 互动时间线 —— 读写库(2026-10-19,蓝V互关求关第 4 阶段)
 * 判定在 `x-follow-back.ts`(纯函数),这里只取数、存运行记录。
 * ⚠️ datetime 字段一律 `<string>` 转出来再给纯函数(SDK 回的是 DateTime 对象)。
 */
import { getXDB } from '@storage/surreal/client';
import {
  buildTimeline, classifyAsks,
  type ActionRow, type AskDetailRow, type AskStatus, type LastCheck, type RelationChangeRow, type RelationNow, type TimelineEvent, type TweetRow,
} from './x-follow-back';

/** 这个号现在被认作「关注我」的人 —— 查回关时「已知」的那一批 */
export async function readKnownFollowers(account: string): Promise<Set<string>> {
  const [rows] = await getXDB().query<[string[]]>(
    'SELECT VALUE person FROM x_relation WHERE account = $a AND follows_me = true', { a: account },
  );
  return new Set(rows ?? []);
}

export type FollowCheckRow = {
  readonly account: string; readonly wsId: string; readonly trigger: 'auto' | 'manual';
  readonly ok: boolean; readonly caughtUp: boolean; readonly pages: number; readonly seen: number;
  readonly newFollowers: number; readonly askedBack: readonly string[]; readonly stopReason: string; readonly problem?: string;
};

export async function insertFollowCheck(r: FollowCheckRow): Promise<void> {
  const [rows] = await getXDB().query<[unknown[]]>(
    `CREATE x_follow_check CONTENT {
       account: $account, ws_id: $ws, trigger: $trigger, at: time::now(), ok: $ok, caught_up: $caught,
       pages: $pages, seen: $seen, new_followers: $fresh, asked_back: $back, stop_reason: $stop, problem: $problem
     }`,
    {
      account: r.account, ws: r.wsId, trigger: r.trigger, ok: r.ok, caught: r.caughtUp, pages: r.pages, seen: r.seen,
      fresh: r.newFollowers, back: [...r.askedBack], stop: r.stopReason, problem: r.problem ?? undefined,
    },
  );
  /** CREATE 不报错也可能没写上(记忆:UPSERT/CREATE 静默)—— 看返回行 */
  if (!rows || rows.length !== 1) throw new Error('[x.follow-check] 运行记录没写上');
}

export type FollowCheckSummary = LastCheck & {
  readonly trigger: string; readonly pages: number; readonly newFollowers: number;
  readonly askedBack: readonly string[]; readonly stopReason: string; readonly problem?: string;
};

export async function readLastFollowCheck(account: string): Promise<FollowCheckSummary | null> {
  const [rows] = await getXDB().query<[Array<{
    at: string; ok: boolean; caught_up: boolean; trigger: string; pages: number; new_followers: number;
    asked_back: string[]; stop_reason: string; problem?: string;
  }>]>(
    `SELECT <string> at AS at, ok, caught_up, trigger, pages, new_followers, asked_back, stop_reason, problem
       FROM x_follow_check WHERE account = $a ORDER BY at DESC LIMIT 1`, { a: account },
  );
  const r = rows?.[0];
  return r ? {
    at: r.at, ok: r.ok, caughtUp: r.caught_up, trigger: r.trigger, pages: r.pages, newFollowers: r.new_followers,
    askedBack: r.asked_back, stopReason: r.stop_reason, problem: r.problem ?? undefined,
  } : null;
}

/** 最近一次「追上了」的查回关时间 —— 判「满 N 天没回关」要它(没追上的那次不能当证据) */
export async function readLastCaughtUp(account: string): Promise<string | undefined> {
  /** ⚠️ ORDER BY 的字段必须在选出的字段里(SurrealDB 3.0.4;SELECT VALUE 不行 —— 10-19 真机 parse error) */
  const [rows] = await getXDB().query<[Array<{ at: string }>]>(
    'SELECT <string> at AS at FROM x_follow_check WHERE account = $a AND ok = true AND caught_up = true ORDER BY at DESC LIMIT 1',
    { a: account },
  );
  return rows?.[0]?.at;
}

/** ⭐ 每个求关对象的回关状态 */
export async function readAskStatuses(account: string, revisitDays: number, now = new Date()): Promise<AskStatus[]> {
  const db = getXDB();
  const [asks] = await db.query<[Array<{ person: string; person_handle: string; at: string; followed?: 'ok' | 'already' | 'failed' }>]>(
    'SELECT person, person_handle, <string> at AS at, followed FROM x_ask WHERE account = $a', { a: account },
  );
  const ids = [...new Set((asks ?? []).map((a) => a.person))];
  if (ids.length === 0) return [];
  const [rel, ch] = await db.query<[
    Array<{ person: string; follows_me?: boolean; i_follow?: boolean; observed_at: string }>,
    RelationChangeRow[],
  ]>(
    `SELECT person, follows_me, i_follow, <string> observed_at AS observed_at FROM x_relation WHERE account = $a AND person IN $ids;
     SELECT person, <string> observed_at AS observed_at, (IF prev_observed_at != NONE THEN <string> prev_observed_at ELSE NONE END) AS prev_observed_at,
            from_follows_me, to_follows_me, from_i_follow, to_i_follow, source
       FROM x_relation_change WHERE account = $a AND person IN $ids;`,
    { a: account, ids },
  );
  const relations = new Map<string, RelationNow>((rel ?? []).map((r) => [r.person, r]));
  return classifyAsks({
    asks: (asks ?? []).map((a) => ({ person: a.person, handle: a.person_handle, at: a.at, followed: a.followed })),
    relations, changes: ch ?? [], lastCaughtUp: await readLastCaughtUp(account), now, revisitDays,
  });
}

/** ⭐ 一个人的互动时间线 */
export async function readPersonTimeline(account: string, person: string): Promise<{ readonly events: TimelineEvent[]; readonly sources: Record<string, number> }> {
  const db = getXDB();
  const [asks, acts, ch, tw] = await db.query<[AskDetailRow[], ActionRow[], RelationChangeRow[], TweetRow[]]>(
    `SELECT person, person_handle AS handle, <string> at AS at, followed, liked, replied, failed_step, tweet_id, tweet_text, reply_text, reply_id
       FROM x_ask WHERE account = $a AND person = $p;
     SELECT <string> at AS at, action, result, reason, detail FROM x_action_log
       WHERE target_rest_id = $p AND ws_id IN (SELECT VALUE ws_id FROM x_ws_account WHERE rest_id = $a);
     SELECT person, <string> observed_at AS observed_at, (IF prev_observed_at != NONE THEN <string> prev_observed_at ELSE NONE END) AS prev_observed_at,
            from_follows_me, to_follows_me, from_i_follow, to_i_follow, source
       FROM x_relation_change WHERE account = $a AND person = $p;
     SELECT tweet_id, (IF created_at != NONE THEN <string> created_at ELSE NONE END) AS created_at, text, author_rest_id,
            in_reply_to_user_id, mention_ids, quoted_author_id, retweet_of_author_id
       FROM x_tweet
       WHERE (author_rest_id = $p AND (in_reply_to_user_id = $a OR $a INSIDE mention_ids OR quoted_author_id = $a OR retweet_of_author_id = $a))
          OR (author_rest_id = $a AND (in_reply_to_user_id = $p OR $p INSIDE mention_ids OR quoted_author_id = $p OR retweet_of_author_id = $p));`,
    { a: account, p: person },
  );
  const events = buildTimeline({ me: account, person, asks: asks ?? [], actions: acts ?? [], changes: ch ?? [], tweets: tw ?? [] });
  return {
    events,
    sources: { 求关记录: asks?.length ?? 0, 动作记录: acts?.length ?? 0, 关系变化: ch?.length ?? 0, 推文: tw?.length ?? 0 },
  };
}
