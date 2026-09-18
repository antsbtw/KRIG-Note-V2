/**
 * ⭐⭐ 「采人」—— 从载荷里抽**人的列表**(关注者 / 关注中 / 验证关注者)
 *
 * ── 用户 2026-09-18 ──
 *
 * 在 `x.com/otun_myvpn/verified_followers` 采集,实测截到 **12 个
 * `BlueVerifiedFollowers` 载荷、每个约 40KB** —— 那就是人的列表。
 * 而 `extractTweetsFrom` 只认带 `legacy.id_str` 的**推文**对象,
 * 会把这些整个跳过,于是报 0 条。
 *
 * ⭐ 「采人」与「采推」是两种采集:
 *
 * |        | 采推 | 采人 |
 * |---|---|---|
 * | 载荷   | HomeTimeline / UserTweets | Followers / BlueVerifiedFollowers / Following |
 * | 产出   | `x_tweet` 行 | **`x_author` 行** |
 * | 字段   | metrics / conversationId / … | **bio / 粉丝数 / 关系** |
 *
 * ⭐ 它正是盘点缺口的正解:bio 与关系覆盖率此前只有 **2%**,
 * 因为唯一的路是「导航到每个人主页 + 等 12 秒」。
 * 关注列表一次采全,覆盖率直接拉满。
 *
 * ── ⚠️ 不写死嵌套路径 ──
 *
 * 与 `x-author-profile.ts` 的 `findUserResult` 同一手法:**按特征递归找**。
 * 理由那边写着:「X 的响应外层结构变过好几次,写死路径会在改版后
 * **静默取不到**(返回 undefined 而不报错)」。
 * 所以这里也不认 `data.user.result.timeline.instructions[...]` 那种路径,
 * 只认「带 screen_name 的对象」。
 */

import { normalizeHandle } from '@shared/types/x-timeline-types';

/** 一个采到的人 —— 字段与 `AuthorCounts` 对齐,便于直接入库 */
export interface HarvestedPerson {
  handle: string;
  restId?: string;
  displayName?: string;
  bio?: string;
  avatar?: string;
  followersCount?: number;
  followingCount?: number;
  tweetCount?: number;
  isBlueVerified?: boolean;
  /** 我与此人的关系 —— 载荷自带,零额外请求 */
  iFollow?: boolean;
  followsMe?: boolean;
  /** X 上的真实拉黑(与本 app 的屏蔽意志不是一回事) */
  xBlocking?: boolean;
  accountCreatedAt?: string;
  location?: string;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined;

/** 明确的 true/false 才给值;字段不在就 undefined(「没查」≠「查过是 false」) */
const bool = (...vs: unknown[]): boolean | undefined => {
  for (const v of vs) if (v === true) return true;
  for (const v of vs) if (v === false) return false;
  return undefined;
};

/**
 * 把一个「像 user 的对象」解析成人。
 *
 * ⚠️ 新旧两种形态都试(与 `x-author-profile.ts:82` 同口径):
 * 新形态在 `core` / `profile_bio` / `relationship_counts`,旧形态全在 `legacy`。
 * 只读一种会在 X 改版后**静默少字段**。
 */
export function parsePerson(o: Record<string, unknown>): HarvestedPerson | null {
  const core = (o.core ?? {}) as Record<string, unknown>;
  const legacy = (o.legacy ?? {}) as Record<string, unknown>;
  const bioObj = (o.profile_bio ?? {}) as Record<string, unknown>;
  const relCounts = (o.relationship_counts ?? {}) as Record<string, unknown>;
  const tweetCounts = (o.tweet_counts ?? {}) as Record<string, unknown>;
  const persp = (o.relationship_perspectives ?? {}) as Record<string, unknown>;
  const verification = (o.verification ?? {}) as Record<string, unknown>;
  const avatarObj = (o.avatar ?? {}) as Record<string, unknown>;

  const screenName = str(core.screen_name) ?? str(legacy.screen_name);
  if (!screenName) return null;

  const handle = normalizeHandle(screenName);
  if (!handle) return null;

  return {
    handle,
    restId: str(o.rest_id) ?? str(legacy.id_str),
    displayName: str(core.name) ?? str(legacy.name),
    bio: str(bioObj.description) ?? str(legacy.description),
    avatar: str(avatarObj.image_url) ?? str(legacy.profile_image_url_https),
    followersCount: num(relCounts.followers) ?? num(legacy.followers_count),
    followingCount: num(relCounts.following) ?? num(legacy.friends_count),
    tweetCount: num(tweetCounts.tweets) ?? num(legacy.statuses_count),
    isBlueVerified: bool(o.is_blue_verified, verification.is_blue_verified),
    // ⭐ 关系:两个位置都看(与 x-author-profile.ts:95 同口径)
    iFollow: bool(persp.following, legacy.following),
    followsMe: bool(persp.followed_by, legacy.followed_by),
    xBlocking: bool(persp.blocking, legacy.blocking),
    accountCreatedAt: str(core.created_at) ?? str(legacy.created_at),
    location: str((o.location as Record<string, unknown> | undefined)?.location)
      ?? str(legacy.location),
  };
}

/**
 * 递归抽取载荷里所有的人。
 *
 * ⚠️ **不写死嵌套路径** —— 按特征找「带 screen_name 的对象」。
 * X 的响应外层结构变过好几次,写死路径会在改版后静默取不到。
 *
 * ⚠️ 按 handle 去重:同一个人可能在载荷里出现多次
 * (如列表项 + 推荐模块),**第一次解到的留下**。
 */
export function extractPeopleFrom(
  node: unknown,
  out: Map<string, HarvestedPerson>,
  depth = 0,
): void {
  /**
   * ⚠️ 深度上限 24,不是 12 —— 实测路径就有 13 层:
   * data → user → result → timeline → timeline → instructions → [0]
   *   → entries → [0] → content → itemContent → user_results → result
   * **数组也算一层**,12 会在最后一步之前停下 → 一个人都找不到,
   * 而且**不报错**(现象是「采到 0 人」,像解析器写错了)。
   *
   * ⭐ 上限仍要有:X 的响应里有环形引用的先例,没上限会栈溢出。
   */
  if (node === null || typeof node !== 'object' || depth > 24) return;
  if (Array.isArray(node)) {
    for (const it of node) extractPeopleFrom(it, out, depth + 1);
    return;
  }

  const o = node as Record<string, unknown>;
  const core = o.core as Record<string, unknown> | undefined;
  const legacy = o.legacy as Record<string, unknown> | undefined;
  const hasName = typeof core?.screen_name === 'string'
    || typeof legacy?.screen_name === 'string';

  /**
   * ⚠️ 只在**看起来是个完整 user 对象**时才解:要有 screen_name,
   * 并且带 rest_id / legacy / core 之一。
   * 光有 screen_name 的可能是引用片段(如「回复给 @xxx」),
   * 解出来会是个只有 handle 的空壳 —— 那会污染人表。
   */
  if (hasName && (o.rest_id || legacy || core)) {
    const p = parsePerson(o);
    // ⚠️ 已有就不覆盖:第一次解到的通常最完整
    if (p && !out.has(p.handle)) out.set(p.handle, p);
    // ⭐ 不 return —— user 对象里可能嵌着别的 user(如「被谁关注」)
  }

  for (const v of Object.values(o)) extractPeopleFrom(v, out, depth + 1);
}

/**
 * 这个操作名是不是「人的列表」。
 *
 * ⚠️⚠️ **生产代码不用它,也不该用** —— 记在这里免得有人再写一遍。
 *
 * 解析**不按操作名分派**:每个载荷都试解人、也试解推
 * (`x-timeline-harvester` 里两个 extract 并排调)。理由:
 *  · 同一个载荷可能**既有推也有人**(时间线里的推荐关注模块)
 *  · 操作名会随 X 改版变(实测就有 `BlueVerifiedFollowers` 这种
 *    我们事先不知道的名字)—— 按名字分派等于把「认不认识这个名字」
 *    变成「采不采得到」,而那是**静默失败**
 *
 * ⭐ 所以三个 tab(Verified Followers / Followers / Following)
 * **都能采**,不取决于我们认不认识它的操作名。
 *
 * 保留它只为**诊断展示**(在报告里标注哪些载荷是人的列表)。
 * ⚠️ 若某天它被用来「决定要不要解析」,那就是退回按名字分派 —— 别这么做。
 */
export function isPeopleOp(op: string): boolean {
  return /Followers|Following|FollowersYouKnow|Subscriptions/i.test(op);
}


/**
 * ⭐⭐ 找**分页游标** —— 回答「还有没有」,不靠猜。
 *
 * ── 用户 2026-09-18 问全量/增量 ──
 *
 * 现在判「采完没有」靠的是 `scrollY` 连续 8 轮不变(滚不动了 ≈ 到底了)——
 * 那是**猜**。而 X **明确告诉了你**:载荷里带
 * `{ __typename: 'TimelineTimelineCursor', cursorType: 'Bottom', value: '…' }`。
 *
 * ⚠️ 同一个洞在 `x-article-replies.ts:34` 已经认识到了:
 * 「X 明确告诉了你『还有,拿这个 cursor 来取』,而原先的代码在数
 *   『连续 4 轮没新增』—— 真源就摆在载荷里,我们没读」。
 * 那边只找 `ShowMore`(折叠区),**列表分页用的是 `Bottom`** —— 这里补上。
 *
 * ── 游标怎么用 ──
 *
 * `hasMore=true`  → 还有下一页(继续滚/翻)
 * `hasMore=false` → **真的采完了**(不是「滚不动了」)
 * `bottom` 的值   → 跨次增量的**断点**:下次从这里接着采
 *
 * ⚠️ 空游标(`value` 为空串)等于没有 —— X 在列表末尾会给一个空游标,
 * 当成「还有」会让滚动永不停止。
 */
export function findPagingCursor(node: unknown): {
  bottom?: string;
  top?: string;
  /** 还有下一页吗 —— **X 说的,不是我们猜的** */
  hasMore: boolean;
} {
  let bottom: string | undefined;
  let top: string | undefined;

  const walk = (o: unknown, depth: number): void => {
    if (o === null || typeof o !== 'object' || depth > 24) return;
    if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; }
    const r = o as Record<string, unknown>;
    if (r.__typename === 'TimelineTimelineCursor'
      && typeof r.value === 'string' && r.value.trim()
      && typeof r.cursorType === 'string') {
      if (/^bottom$/i.test(r.cursorType)) bottom = r.value;
      else if (/^top$/i.test(r.cursorType)) top = r.value;
    }
    for (const v of Object.values(r)) walk(v, depth + 1);
  };
  walk(node, 0);

  return { bottom, top, hasMore: !!bottom };
}
