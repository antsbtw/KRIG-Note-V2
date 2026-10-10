/**
 * ⭐ 运营 → 「人」的读库(仅 main 进程)—— SQL 与解析在 `x-people-query.ts`(纯函数)
 *
 * 除了「排除」(人的决定,1.2.21)之外都是只读。
 */

import { getXDB } from '@storage/surreal/client';
import {
  buildOverviewQuery, buildPeopleQuery, parseOverview, parsePeopleResult, PERSON_DETAIL_SQL, SET_EXCLUDED_SQL,
  SET_TAGS_SQL, TAG_ROWS_SQL, normalizeTags, tagCatalog, PERSON_TWEETS_SQL, type PersonTweet,
  type PeopleFilter, type PeopleOverview, type PersonDetail, type PersonRow,
} from './x-people-query';

export async function readPeopleOverview(): Promise<PeopleOverview> {
  return parseOverview(await getXDB().query<unknown[]>(buildOverviewQuery()));
}

export async function queryPeople(
  f: PeopleFilter, limit: number, start: number,
): Promise<{ readonly total: number; readonly rows: PersonRow[] }> {
  const q = buildPeopleQuery(f, limit, start);
  return parsePeopleResult(await getXDB().query<unknown[]>(q.sql, q.vars));
}

/** ⚠️ 查不到返回 null —— 调用方要说「这个人不在库里」,不显示一张空卡 */
export async function readPerson(restId: string): Promise<PersonDetail | null> {
  const [rows] = await getXDB().query<[PersonDetail[]]>(PERSON_DETAIL_SQL, { rest_id: restId });
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
