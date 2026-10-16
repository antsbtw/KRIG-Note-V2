/**
 * ⭐ 运营 → 「人」的读库(仅 main 进程)—— SQL 与解析在 `x-people-query.ts`(纯函数)
 *
 * 除了「排除」(人的决定,1.2.21)之外都是只读。
 * ⭐ 读关系的函数都要 `account`(号的数字 id)—— 关系按号存(1.2.27)。
 */

import { getXDB } from '@storage/surreal/client';
import { PEOPLE_WITH_RELATION } from './x-account';
import { computeCircle, looksChinese, type CirclePerson, type CircleTweet } from './x-friend-circle';
import {
  buildOverviewQuery, buildPeopleQuery, parseOverview, parsePeopleResult, PERSON_DETAIL_SQL, SET_EXCLUDED_SQL,
  SET_TAGS_SQL, TAG_ROWS_SQL, normalizeTags, tagCatalog, PERSON_TWEETS_SQL, type PersonTweet,
  type PeopleFilter, type PeopleOverview, type PersonDetail, type PersonRow,
} from './x-people-query';

export async function readPeopleOverview(account: string): Promise<PeopleOverview> {
  const q = buildOverviewQuery(account);
  return parseOverview(await getXDB().query<unknown[]>(q.sql, q.vars));
}

export async function queryPeople(
  account: string, f: PeopleFilter, limit: number, start: number,
): Promise<{ readonly total: number; readonly rows: PersonRow[] }> {
  const q = buildPeopleQuery(account, f, limit, start);
  return parsePeopleResult(await getXDB().query<unknown[]>(q.sql, q.vars));
}

/** ⚠️ 查不到返回 null —— 调用方要说「这个人不在库里」,不显示一张空卡 */
export async function readPerson(account: string, restId: string): Promise<PersonDetail | null> {
  if (account === '') throw new Error('[x.people] 没有号的数字 id,不知道看哪个号的关系');
  const [rows] = await getXDB().query<[PersonDetail[]]>(PERSON_DETAIL_SQL, { rest_id: restId, acct: account });
  return rows?.[0] ?? null;
}

/**
 * ⭐⭐ 排除 / 取消排除(人的决定)。
 * ⚠️⚠️ 人不存在时 UPDATE **返回空数组且不报错** —— 2026-10-08 临时库实测。
 * 不检查的话,面板会显示「已排除」而库里什么都没变。
 */
export async function setExcluded(restId: string, excluded: boolean): Promise<void> {
  const [rows] = await getXDB().query<[Array<{ rest_id: string; excluded: boolean }>]>(
    SET_EXCLUDED_SQL, { rest_id: restId, excluded },
  );
  if (!rows || rows.length !== 1 || rows[0].excluded !== excluded) {
    throw new Error(`[x.people] 没写上:库里找不到数字 id ${restId} 这个人`);
  }
}

/**
 * ⭐⭐ 写一个人的标签(整组替换)。清洗在这里**再做一次** —— 不信任 renderer 传来的。
 * ⚠️ 清洗出问题(太长)要报出来,不静默丢掉那个标签。
 */
export async function setTags(restId: string, raw: readonly string[]): Promise<string[]> {
  const { tags, problems } = normalizeTags(raw);
  if (problems.length > 0) throw new Error(`[x.people] 标签有问题:${problems.join(';')}`);
  const [rows] = await getXDB().query<[Array<{ rest_id: string; tags: string[] }>]>(
    SET_TAGS_SQL, { rest_id: restId, tags },
  );
  if (!rows || rows.length !== 1) {
    throw new Error(`[x.people] 没写上:库里找不到数字 id ${restId} 这个人`);
  }
  return rows[0].tags;
}

export async function readTagCatalog(): Promise<Array<{ tag: string; count: number }>> {
  const [rows] = await getXDB().query<[Array<{ tags?: string[] }>]>(TAG_ROWS_SQL);
  return tagCatalog(rows ?? []);
}

/** ⭐ 他的推文 —— 总数 + 最新 limit 条 */
export async function readPersonTweets(restId: string, limit: number): Promise<{ total: number; rows: PersonTweet[] }> {
  const [c, rows] = await getXDB().query<[Array<{ n: number }>, PersonTweet[]]>(
    PERSON_TWEETS_SQL, { rest_id: restId, limit },
  );
  return { total: c?.[0]?.n ?? 0, rows: rows ?? [] };
}

/**
 * ⭐⭐ 他的朋友圈(2026-10-10)—— 从推文现算(规则在 `x-friend-circle.ts`,纯)。
 * 返回前 limit 个人,带上人表里的资料;人表里没有的(只被提及过)用推文里见过的 handle 显示。
 */

export async function readFriendCircle(account: string, restId: string, limit: number): Promise<{
  tweets: number; people: number; rows: CirclePerson[];
}> {
  const db = getXDB();
  const [his, toHim] = await db.query<[CircleTweet[], CircleTweet[]]>(`
    SELECT author_rest_id, in_reply_to_user_id, in_reply_to_user, mention_ids, mentions, quoted_author_id, retweet_of_author_id
      FROM x_tweet WHERE author_rest_id = $id;
    SELECT author_rest_id, author_handle, in_reply_to_user_id
      FROM x_tweet WHERE in_reply_to_user_id = $id AND author_rest_id != $id;`, { id: restId });
  const all = computeCircle(restId, his ?? [], toHim ?? []);
  const top = all.slice(0, limit);
  const [rows] = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT rest_id, handle, display_name, avatar, bio, is_blue_verified, i_follow, follows_me
       FROM ${PEOPLE_WITH_RELATION} WHERE rest_id IN $ids`, { ids: top.map((e) => e.id), acct: account },
  );
  const byId = new Map((rows ?? []).map((r) => [String(r.rest_id), r]));
  return {
    tweets: (his ?? []).length,
    people: all.length,
    rows: top.map((e) => {
      const p = byId.get(e.id);
      return {
        ...e,
        handle: (p?.handle as string | undefined) ?? e.handleSeen,
        display_name: p?.display_name as string | undefined,
        avatar: p?.avatar as string | undefined,
        is_blue_verified: p?.is_blue_verified as boolean | undefined,
        i_follow: p?.i_follow as boolean | undefined,
        follows_me: p?.follows_me as boolean | undefined,
        chinese: looksChinese(p?.display_name as string | undefined, p?.bio as string | undefined),
        inTable: p !== undefined,
      };
    }),
  };
}
