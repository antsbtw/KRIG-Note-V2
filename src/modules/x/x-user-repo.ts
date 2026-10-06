/**
 * `x_author` 写库 —— ⭐ **采到的 X 用户落在这里**
 *
 * ⭐⭐ **为什么不建新表**(用户 2026-10-05:「人,就是x的用户呀」)
 * follower / following 名单里的人,和推文的作者,是**同一个实体** ——
 * 同一个 X 用户,两条发现路径。给名单再建一张表就等于
 * 同一个人两行、两套计数、两处屏蔽状态,而「屏蔽点了没反应」
 * 正是这类分叉最典型的症状(`project-x-handle-normalize`)。
 * ⚠️ 表名 `x_author`(作者)取窄了,但**存量数据和引用都在**,不改名;
 * 代码里一律说 `user`,只有表名这一处保留历史。
 *
 * 调用边界:仅 main 进程。放在 X 模块内不在 `platform/main/db/` ——
 * 理由同 `x-tweet-repo`(平台层不许依赖 X,否则删 X 留坏引用)。
 * ⚠️ 走 **X 库(krig_x)** —— `getXDB()`,不是笔记库。
 *
 * ── ⚠️⚠️ 这张表比 x_tweet 更怕被覆盖 ──
 *
 * 它**已经有存量行**,而且行里装的是**人工与 AI 的成果**:
 * `blocked` / `blocked_reason` / `watched` / `watch_source` / `note` / `is_self`。
 * ⭐ 采集**一个都不许碰** —— 见 `BUSINESS_FIELDS`。
 * (`project-x-upsert-insert-ignore` 的教训是「该更新的没更新」,
 * 这张表的风险是反向的「不该更新的被更新」。两头都要防。)
 *
 * ── ⭐ 三条从别处买来的经验,这里一开始就遵守 ──
 *
 * ① **handle 必须归一化**(`project-x-handle-normalize`)
 * 　 `idx_author_handle` 是 UNIQUE,`Foo` 和 `foo` 会变两行,
 * 　 于是「屏蔽了一次只生效一半」且**不报错**。
 * 　 ⭐ 写入端与比对端**共用 `normalizeHandle()`**,这里不自己写一份。
 *
 * ② **`list_memberships` 只累加不覆盖**(schema 1.2.4 的原话)
 * 　 一个人可以既在 `followers` 又在 `verifiedFollowers` 里,
 * 　 覆盖掉的是**证据**:「他在不在我的关注者里」从此只能回答最后那次。
 *
 * ③ **计数字段「不知道」≠「零」**
 * 　 载荷没带 `followers_count` 就写 `undefined`(→ NONE),
 * 　 不是 0 —— `project-surreal-none-vs-null`:option 字段传 null 全挂,
 * 　 而兜底成 0 会让「没采到粉丝数」和「真的没粉丝」永远分不开。
 */

import { getXDB } from '@storage/surreal/client';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import type { XUserRecord } from './x-user-audit';

/**
 * ⭐⭐ **采集字段** —— 重采可以覆盖(都来自载荷)。
 * ⚠️ 加字段时**这里和下面的 SQL 要一起改**:
 * `project-x-field-four-place-registration` —— 漏任一处都**静默丢失**。
 */
export const USER_COLLECTED_FIELDS = [
  'handle', 'rest_id', 'display_name', 'avatar', 'bio', 'location',
  'followers_count', 'following_count', 'tweet_count', 'media_count',
  'website', 'is_blue_verified', 'is_verified', 'is_protected',
  'i_follow', 'follows_me',
  'account_created_at', 'list_source', 'list_seq', 'list_seen_at',
  'list_memberships', 'fetched_at',
] as const;

/**
 * ⚠️⚠️ **业务字段 —— 采集一个都不许碰**。
 * 人点出来的(blocked/watched/note)、代表身份的(is_self)、
 * 以及 X 侧的屏蔽态(x_blocking,与我们的 blocked 不同源)。
 * ⭐ 覆盖它们**不可逆**:屏蔽名单和追踪名单直接丢。
 */
export const USER_BUSINESS_FIELDS = [
  'blocked', 'blocked_at', 'blocked_reason',
  'watched', 'watched_at', 'watch_source', 'watch_depth',
  'is_self', 'note', 'x_blocking',
] as const;

/** ⭐ 落库时调用方要补的「空」—— 解析器不知道自己在哪采的 */
export type UserCollectContext = {
  /**
   * ⭐ 从哪个名单采的:`followers` / `following` / `verifiedFollowers` …
   * ⚠️ 这个值会进 `list_memberships`(累加),所以**必须是稳定的词**,
   * 别今天写 'followers' 明天写 '关注者' —— 那会让同一个名单记成两个。
   */
  readonly listSource: string;
  readonly wsId?: string;
};

export type SaveUsersResult = {
  readonly inserted: number;
  readonly updated: number;
  /**
   * ⚠️ 失败的那些 —— **一条坏不许让整批静默消失**
   * (`feedback-fail-loud-no-fallback`)。
   */
  readonly failed: ReadonlyArray<{ readonly handle: string; readonly why: string }>;
  /**
   * ⭐⭐ **handle 为空被挡下的** —— 不混进 `failed`。
   * ⚠️ `handle` 上有 `ASSERT $value != ''`,空的写进去会抛;
   * 但它不是「写库出错」而是「载荷本来就没解出人」,
   * 两者混在一起会让人去查错误的那一层。解析器也会在 `problems` 里报它。
   */
  readonly skippedNoHandle: number;
};

/** ⚠️ 空串当成「没有」—— option<T> 要传 undefined,不是 null 也不是 '' */
const opt = (v: string | undefined): string | undefined =>
  (v === undefined || v === '' ? undefined : v);

/**
 * ⭐ X 的 `created_at` 是 `Fri Oct 04 12:00:00 +0000 2026` 这种格式。
 * ⚠️ 解析不出来就**返回 undefined**,别拿当前时间顶替 ——
 * 那会让「账号注册多久了」这类判断全错,而且看不出来。
 */
function toDatetime(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

type OldRow = {
  readonly list_memberships?: unknown;
};

/**
 * ⭐⭐ 合并名单归属 —— **只加不减**(schema 1.2.4 定的语义)。
 * ⚠️ 返回**新数组**,别原地改旧值。
 */
function mergeMemberships(old: unknown, listSource: string): string[] {
  const prev = Array.isArray(old) ? old.filter((x): x is string => typeof x === 'string') : [];
  return prev.includes(listSource) ? prev : [...prev, listSource];
}

/**
 * ⭐⭐⭐ 存一批 X 用户。
 *
 * ⚠️ `inserted` / `updated` **分开返回** —— 合成「保存了 N 条」的话,
 * 「全是老人」和「全是新人」长得一模一样,而增量采集全靠这个分别。
 */
export async function saveUsers(
  records: readonly XUserRecord[],
  ctx: UserCollectContext,
): Promise<SaveUsersResult> {
  const db = getXDB();
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  let skippedNoHandle = 0;
  const failed: Array<{ handle: string; why: string }> = [];

  for (const r of records) {
    /**
     * ⭐ 归一化**在最前面** —— 后面的查、写、record id 全用这一个值。
     * ⚠️ 任何一处用原始 handle 都会制造出第二行。
     */
    const handle = normalizeHandle(r.handle);
    if (handle === '') {
      /** ⚠️ 不当失败记 —— 见 `skippedNoHandle` 的注释 */
      skippedNoHandle += 1;
      continue;
    }

    try {
      /**
       * ⭐ 先看在不在:分 inserted/updated,
       * 也取出旧的 `list_memberships` 来累加(②)。
       */
      const found = await db.query<[OldRow[]]>(
        'SELECT list_memberships FROM x_author WHERE handle = $handle LIMIT 1',
        { handle },
      );
      const old = (found[0] ?? [])[0];
      const exists = old !== undefined;

      const vars = {
        handle,
        rest_id: opt(r.restId),
        display_name: opt(r.name),
        avatar: opt(r.avatar),
        bio: opt(r.bio),
        location: opt(r.location),
        /** ⚠️ 没采到就是 undefined(→ NONE),**不是 0**(③) */
        followers_count: r.followersCount,
        following_count: r.followingCount,
        tweet_count: r.statusesCount,
        media_count: r.mediaCount,
        website: opt(r.website),
        is_blue_verified: r.isBlueVerified,
        /** ⚠️ 与蓝V**不是一回事** —— 两个都存,别合并 */
        is_verified: r.isVerified,
        is_protected: r.isProtected,
        /**
         * ⭐ X 的原词映射到表里的旧名:
         * `following`(我关注他)→ `i_follow`
         * `followedBy`(他关注我)→ `follows_me`
         * ⚠️ 别对调 —— 这两个字段是「追踪名单」的判据,搞反了方向全反。
         */
        i_follow: r.following,
        follows_me: r.followedBy,
        account_created_at: toDatetime(r.createdAt),
        list_source: ctx.listSource,
        /** ⭐ 名次只在**同一次采集内**可比(schema 1.2.4 原话) */
        list_seq: r.seq,
        list_seen_at: now,
        list_memberships: mergeMemberships(old?.list_memberships, ctx.listSource),
        fetched_at: now,
      };

      /**
       * ⭐⭐⭐ **`UPSERT type::record(...)` 而不是 `UPSERT x_author ... WHERE`**。
       * ⚠️⚠️ 带 `WHERE` 的 UPSERT 没匹配到就**什么都不写、也不报错** ——
       * 2026-10-05 真机实证过:面板报「入库 44 条」而库里 0 行。
       * ⭐ 用归一化的 handle 当 record id:天然唯一,重采自动落回同一行,
       * 也就天然守住了「同一个人只有一行」。
       * ⚠️ `project-surreal-id-field-readonly`:**不 DEFINE FIELD id**,
       * 只在 record id 的位置用它。
       *
       * ⚠️⚠️ 下面**一个业务字段都没有** —— blocked / watched / note / is_self
       * 不在这条 SET 里,新建时靠 schema 的 DEFAULT 落 false。
       * 那是人工与 AI 的成果,重采覆盖掉不可逆(见 USER_BUSINESS_FIELDS)。
       */
      await db.query(
        `UPSERT type::record('x_author', $handle) SET
           handle = $handle,
           rest_id = $rest_id,
           display_name = $display_name,
           avatar = $avatar, bio = $bio, location = $location,
           followers_count = $followers_count,
           following_count = $following_count,
           tweet_count = $tweet_count, media_count = $media_count,
           website = $website,
           is_blue_verified = $is_blue_verified,
           is_verified = $is_verified, is_protected = $is_protected,
           i_follow = $i_follow, follows_me = $follows_me,
           -- datetime 字段必须 cast:直传 ISO 字符串会被库拒收
           -- (option 的要先判 NONE,否则 type::datetime(NONE) 自己就抛)
           account_created_at = IF $account_created_at != NONE
             THEN type::datetime($account_created_at) ELSE NONE END,
           list_source = $list_source, list_seq = $list_seq,
           list_seen_at = type::datetime($list_seen_at),
           list_memberships = $list_memberships,
           fetched_at = type::datetime($fetched_at)`,
        vars,
      );
      if (exists) updated += 1; else inserted += 1;
    } catch (e) {
      /** ⚠️ 一条坏只赔一条 —— 不让整批作废,但也**绝不静默** */
      failed.push({ handle, why: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * ⭐⭐⭐ **落库也要留痕**(`feedback-maintainability-over-feature-completion`)。
   * ⚠️ 两跑「面板报入库 44 条、库里 0 行」而留痕里一个字都没有 ——
   * 「压根没调」和「调了但每条都失败」长得一模一样,只能去真库里猜。
   * ⭐ **成功路径也要留痕**,否则下次验证又要靠人截图。
   * ⚠️ 失败原因只记**第一条**(整批同因时 N 条一模一样,记全了是噪音)。
   */
  console.log(
    `[x.user-repo] 落库 ${records.length} 人(${ctx.listSource})`
    + ` → 新 ${inserted} / 更新 ${updated}`
    + (skippedNoHandle > 0 ? ` / 无 handle 挡下 ${skippedNoHandle}` : '')
    + (failed.length > 0 ? ` / 失败 ${failed.length}：${failed[0].why}` : ''),
  );

  return { inserted, updated, failed, skippedNoHandle };
}
