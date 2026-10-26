/**
 * ⭐ 谁在谁的名单里 —— x_list_member 读写(2026-10-19,人卡采他的三个名单)
 *
 * 用户 10-19 选「人卡显示名单 + 标出候选」。一行 = 某人(owner)的某个名单里有某人(member),
 * 只更新 last_seen、不删 —— 名单变了从时间看得出来。
 * ⚠️ 写记录用 UPSERT type::record(表, id),不用 UPSERT…WHERE(没匹配静默不写)。
 */
import { getXDB } from '@storage/surreal/client';
import { PEOPLE_WITH_RELATION } from './x-account';
import type { BgListTab } from './x-bg-job';

const UPSERT_SQL = `
  FOR $m IN $members {
    UPSERT type::record('x_list_member', string::concat($owner, '|', $list, '|', $m)) SET
      owner = $owner, list = $list, member = $m, seen_by = $by,
      first_seen = first_seen ?? time::now(), last_seen = time::now();
  };
  SELECT count() AS n FROM x_list_member WHERE owner = $owner AND list = $list AND member IN $members GROUP ALL;`;

/** 记一批;回读这批里库里查得到几条(不信写入返回) */
export async function writeListMembers(owner: string, list: BgListTab, members: readonly string[], seenBy: string): Promise<number> {
  const ids = [...new Set(members.filter((m) => /^\d+$/.test(m)))];
  if (ids.length === 0) return 0;
  const res = await getXDB().query<unknown[]>(UPSERT_SQL, { owner, list, members: ids, by: seenBy });
  const last = res[res.length - 1] as Array<{ n: number }> | undefined;
  const n = last?.[0]?.n ?? 0;
  if (n !== ids.length) throw new Error(`[x.list] ${owner} 的 ${list} 记了 ${ids.length} 人,回读只有 ${n}`);
  return n;
}

export type ListMemberRow = {
  readonly rest_id: string; readonly handle: string; readonly display_name?: string; readonly avatar?: string;
  readonly is_blue_verified?: boolean; readonly followers_count?: number;
  readonly i_follow?: boolean; readonly follows_me?: boolean; readonly excluded?: boolean;
  readonly mutual_intent?: boolean; readonly mutual_intent_evidence?: string;
};

export type PersonLists = {
  readonly counts: Readonly<Record<BgListTab, number>>;
  /** 三个名单合起来的候选:蓝V · 我没关注 · 有互关倾向 · 没排除(与任务页同一组条件,只是不要求「配方找到的」) */
  readonly candidates: readonly (ListMemberRow & { readonly lists: readonly BgListTab[] })[];
  readonly candidateTotal: number;
};

/** ⭐ 人卡:他的三个名单各多少人 + 其中的候选(粉丝多的在前) */
export async function readPersonLists(account: string, owner: string, limit: number): Promise<PersonLists> {
  const db = getXDB();
  const [counts, members] = await db.query<[
    Array<{ list: BgListTab; n: number }>,
    Array<{ member: string; list: BgListTab }>,
  ]>(
    `SELECT list, count() AS n FROM x_list_member WHERE owner = $owner GROUP BY list;
     SELECT member, list FROM x_list_member WHERE owner = $owner;`,
    { owner },
  );
  const listsOf = new Map<string, BgListTab[]>();
  for (const m of members ?? []) listsOf.set(m.member, [...(listsOf.get(m.member) ?? []), m.list]);
  const c: Record<BgListTab, number> = { followers: 0, following: 0, verifiedFollowers: 0 };
  for (const r of counts ?? []) c[r.list] = r.n;
  if (listsOf.size === 0) return { counts: c, candidates: [], candidateTotal: 0 };
  const [cand] = await db.query<[ListMemberRow[]]>(
    `SELECT rest_id, handle, display_name, avatar, is_blue_verified, followers_count, i_follow, follows_me, excluded,
            mutual_intent, mutual_intent_evidence
       FROM ${PEOPLE_WITH_RELATION}
       WHERE rest_id IN $ids AND rest_id != $acct
         AND is_blue_verified = true AND i_follow != true AND mutual_intent = true AND excluded != true
       ORDER BY followers_count DESC`,
    { acct: account, ids: [...listsOf.keys()] },
  );
  const all = cand ?? [];
  return {
    counts: c,
    candidates: all.slice(0, limit).map((r) => ({ ...r, lists: listsOf.get(r.rest_id) ?? [] })),
    candidateTotal: all.length,
  };
}
