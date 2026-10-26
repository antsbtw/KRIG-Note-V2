/**
 * ⭐⭐ 推文作者 → 人表(2026-10-08)—— 纯函数,main 侧 repo 与补导脚本共用
 *
 * 用户之前定的:「人的信息另外在采推文时顺带更新」;这次补上「互不关注 = 配方找到的人」。
 * 起因:配方搜到 130 条推文、123 个作者,只有 5 个在人表里 —— 采推文时只存推文、不存作者。
 *
 * ── ⚠️ 守着的几件事 ──
 * ① 身份 = 数字 id(rest_id);没有 id 的作者不建人(与 saveUsers 一致)
 * ② **只写有值的字段** —— 推文载荷偶尔不带关系标记;写成 NONE 会把名单采来的正确标记冲掉
 * ③ 人工字段(排除/标签/大陆背景…)一个都不碰;名单字段(list_*)也不碰 —— 这不是名单
 * ④ 配方来源只加不减(array::union)
 * ⑥ 关系(iFollow/followsMe)**不写人表**(2026-10-16,1.2.27)—— 它是「哪个号看到的」,
 *    由调用方按号写 x_relation(`writeRelations`);这里只把它从推文里取出来
 * ⑤ ⭐⭐ **旧的观察不许覆盖新的**(2026-10-08 真库实证):补导拿 10-05 推文里的「互不关注」
 *    覆盖了 10-08 名单采到的「互关」(Laosun)。所以每个作者带**观察时间**,
 *    只有比人表现有数据(fetched_at)更新时才写采集字段;实时采集的观察时间就是「现在」。
 */

import { normalizeHandle } from '@shared/types/x-timeline-types';

export type TweetAuthor = {
  readonly restId: string;
  readonly handle: string;
  readonly name?: string;
  readonly avatar?: string;
  readonly bio?: string;
  readonly isBlueVerified?: boolean;
  readonly iFollow?: boolean;
  readonly followsMe?: boolean;
  /** ⭐ 这些字段是什么时候看到的 —— 旧的观察不覆盖新的(⑤) */
  readonly observedAt: string;
};

/** 推文记录里与作者有关的那几个字段 —— 采集记录(TweetRecord)与库里的推文行都能映射成它 */
export type TweetAuthorSource = {
  readonly authorRestId?: string;
  readonly authorHandle?: string;
  readonly authorName?: string;
  readonly authorAvatar?: string;
  readonly authorBio?: string;
  readonly isBlueVerified?: boolean;
  readonly following?: boolean;
  readonly followedBy?: boolean;
  /** 这条推文是什么时候采到的;缺了就当「现在」(实时采集) */
  readonly observedAt?: string;
};

const nonEmpty = (v: string | undefined): string | undefined => (v === undefined || v.trim() === '' ? undefined : v);

/**
 * ⭐ 从一批推文里取出作者,按数字 id 去重。
 * 同一个人多条推文时,按观察时间**从旧到新**合并:新的有值字段覆盖旧的,没值的不覆盖(②⑤)。
 */
export function authorsFromTweets(
  rows: readonly TweetAuthorSource[], nowIso: string = new Date().toISOString(),
): { readonly authors: TweetAuthor[]; readonly skippedNoRestId: number } {
  const byId = new Map<string, Record<string, unknown>>();
  let skippedNoRestId = 0;
  const ordered = rows.map((r) => ({ r, at: r.observedAt ?? nowIso }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const { r, at } of ordered) {
    const restId = nonEmpty(r.authorRestId);
    const handle = normalizeHandle(r.authorHandle ?? '');
    if (restId === undefined || handle === '') { skippedNoRestId += 1; continue; }
    const cur = byId.get(restId) ?? { restId };
    const next: Record<string, unknown> = { ...cur, handle, observedAt: at };
    const put = (k: string, v: unknown): void => { if (v !== undefined) next[k] = v; };
    put('name', nonEmpty(r.authorName));
    put('avatar', nonEmpty(r.authorAvatar));
    put('bio', nonEmpty(r.authorBio));
    put('isBlueVerified', r.isBlueVerified);
    put('iFollow', r.following);
    put('followsMe', r.followedBy);
    byId.set(restId, next);
  }
  return { authors: [...byId.values()] as TweetAuthor[], skippedNoRestId };
}

/** 作者字段 → 表字段 —— 只有这些会被写;人工字段与名单字段不在其中(③) */
const FIELD_MAP: ReadonlyArray<readonly [keyof TweetAuthor, string]> = [
  ['name', 'display_name'],
  ['avatar', 'avatar'],
  ['bio', 'bio'],
  ['isBlueVerified', 'is_blue_verified'],
];

/** 导出给守卫:作者写库可能碰到的全部字段 */
export const TWEET_AUTHOR_FIELDS: readonly string[] = [
  'rest_id', 'handle', 'fetched_at', 'found_via_recipes', ...FIELD_MAP.map(([, col]) => col),
];

/**
 * ⭐⭐ 写一个作者的 SQL。`RETURN BEFORE` —— 之前不存在就是新人(分 inserted / updated)。
 * ⚠️ 不用 `UPSERT ... WHERE`(没匹配到什么都不写也不报错,本仓栽过)。
 * ⚠️⚠️ 采集字段只在「这次观察比库里新」时才写(⑤);**fetched_at 放在最后一个赋值** ——
 * SET 按顺序执行,先改 fetched_at 的话后面的判断就拿新值比了。
 * 配方来源不受时间限制(只加不减,旧推文也确实是那个配方找到的)。
 */
export function buildAuthorUpsert(
  a: TweetAuthor, recipeName: string | undefined,
): { readonly sql: string; readonly vars: Record<string, unknown> } {
  const NEWER = '(fetched_at = NONE OR fetched_at <= type::datetime($obs))';
  const when = (col: string, v: string): string => `${col} = IF ${NEWER} THEN ${v} ELSE ${col} END`;
  const sets = ['rest_id = $rest_id', when('handle', '$handle')];
  const vars: Record<string, unknown> = { rest_id: a.restId, handle: a.handle, obs: a.observedAt };
  for (const [k, col] of FIELD_MAP) {
    if (a[k] !== undefined) { sets.push(when(col, `$${col}`)); vars[col] = a[k]; }
  }
  if (recipeName !== undefined) {
    sets.push('found_via_recipes = array::union(found_via_recipes ?? [], [$recipe])');
    vars.recipe = recipeName;
  }
  /** ⚠️ 必须最后 —— 见上 */
  sets.push(when('fetched_at', 'type::datetime($obs)'));
  return {
    sql: `UPSERT type::record('x_author', $rest_id) SET ${sets.join(', ')} RETURN BEFORE;`,
    vars,
  };
}
