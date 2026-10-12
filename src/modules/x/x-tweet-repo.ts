/**
 * `x_tweet` 写库 —— ⭐ **采到的推文落在这里**
 *
 * 调用边界：仅 main 进程调用。
 * ⚠️⚠️ **放在 X 模块里,不在 `platform/main/db/`** —— 2026-10-04 被守卫逮到:
 * 它 import X 的类型,放在平台层就等于**平台依赖 X**,删 X 时留下坏引用。
 * ⭐ 守卫自己的改法原话:「X 自带视图 / IPC / repo / schema」。
 * ⚠️ 这句原先在斜杠之间加了粗体星号,于是「星号星号斜杠」构成了注释结束符,
 * **把注释提前关掉了**(tsc 报 TS1127 Invalid character)——
 * 正是 `feedback-comment-breaks-what-it-documents`:注释弄坏了它所注释的代码。
 * ⭐ 写注释时**路径与粗体标记别挨着**。
 * (`mail-repo` 能放平台层是因为 mail 不要求可卸载。)
 * ⚠️ 走 **X 库(krig_x)**,不是笔记库 —— 用 `getXDB()`。
 *
 * ── ⚠️⚠️ 三个前人踩过的坑,这里从一开始就避开 ──
 *
 * ① **`INSERT IGNORE` 不是 upsert**(`project-x-upsert-insert-ignore`)
 * 　 旧实现用它:`tweet_id` 已存在 → **整条跳过、一个字段不更新、不抛错**
 * 　 → 调用方 `saved += 1` 照加,报告显示「入库 50 条」而**库里纹丝不动**。
 * 　 后果:`conversation_id` 卡在 9%、`tweet_url` 卡在 76% ——
 * 　 「老数据等重采时补上」**按原实现永远补不上**。
 *
 * ② **但也不能无脑全覆盖**(同一条记忆)
 * 　 `accepted` / `ai_verdict` / `replied` / `translation` 是**业务与人工填的**,
 * 　 覆盖掉**不可逆**(AI 要重跑、人工采纳直接丢)。
 * 　 ⭐ 所以**只更新采集字段**,业务字段一个都不碰。
 *
 * ③ **深→浅降级**(`project-x-upsert-overwrites-richer-text`)
 * 　 实测:重采把 **16081 字正文覆盖成 267 字**(列表页只给标题+摘要)。
 * 　 ⭐ 所以 `text` **只在变长或旧值为空时**才覆盖。
 */

import { getXDB } from '@storage/surreal/client';
import type { TweetRecord } from './x-timeline-audit';

/**
 * ⭐⭐ **采集字段** —— 重采时这些可以覆盖(它们都来自载荷)。
 * ⚠️ 加字段时**这里和下面的 SQL 要一起改** ——
 * `project-x-field-four-place-registration`:漏任一处都**静默丢失**。
 */
export const COLLECTED_FIELDS = [
  'text', 'lang', 'is_long_text', 'is_article', 'article_url',
  'conversation_id', 'tweet_url', 'in_reply_to', 'in_reply_to_user', 'quoted_status_id',
  /** ⭐ 互动对象(数字 id,schema 1.2.25)—— 朋友圈的原料 */
  'in_reply_to_user_id', 'mention_ids', 'quoted_author_id', 'retweet_of_id', 'retweet_of_author_id',
  'author_handle', 'author_rest_id', 'author_name_at_post', 'author_avatar', 'author_bio',
  'is_blue_verified', 'following', 'followed_by',
  'media', 'links', 'hashtags', 'mentions',
  'created_at', 'metrics', 'metrics_at', 'fetched_at',
  'liked', 'retweeted', 'bookmarked',
  'source', 'search_recipe', 'ws_id',
] as const;

/**
 * ⚠️⚠️ **业务字段 —— 重采时一个都不许碰**。
 * 它们是 AI 跑出来的、人工点出来的,覆盖不可逆。
 */
export const BUSINESS_FIELDS = [
  'accepted', 'accepted_at', 'replied', 'replied_at', 'reply_text',
  'ai_verdict', 'translation', 'filter_score', 'filter_reason', 'status',
] as const;

/** ⭐ 落库时调用方要补的「空」—— 解析器不知道自己在哪采的 */
export type CollectContext = {
  /** 从哪个入口采的(x.search / x.profile …) */
  readonly source: string;
  /** 哪条配方(手动采就没有) */
  readonly searchRecipe?: string;
  readonly wsId?: string;
};

export type SaveResult = {
  /** 新插入的条数 */
  readonly inserted: number;
  /** 更新了已有行的条数 */
  readonly updated: number;
  /**
   * ⚠️ 失败的那些 —— **一条坏不许让整批静默消失**。
   * `feedback-fail-loud-no-fallback`:吞掉的话界面会显示「入库 N 条」而库里没有。
   */
  readonly failed: ReadonlyArray<{ readonly id: string; readonly why: string }>;
};

/** ⚠️ 空串当成「没有」—— option<T> 要传 undefined 不是 null 也不是 '' */
const opt = (v: string | undefined): string | undefined =>
  (v === undefined || v === '' ? undefined : v);

/**
 * ⭐ X 的 `created_at` 是 `Fri Oct 04 12:00:00 +0000 2026` 这种格式。
 * ⚠️ 解析不出来就**返回 undefined**,别拿当前时间顶替 ——
 * 那会让时序分析全错,而且看不出来。
 */
function toDatetime(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/**
 * ⭐⭐⭐ 存一批推文。
 *
 * ⚠️ 返回 **inserted / updated 分开** —— 合成一个「保存了 N 条」的话,
 * 「全是重复的」和「全是新的」长得一模一样,
 * 而那正是 `INSERT IGNORE` 当年藏住的东西。
 */
export async function saveTweets(
  records: readonly TweetRecord[],
  ctx: CollectContext,
): Promise<SaveResult> {
  const db = getXDB();
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  const failed: Array<{ id: string; why: string }> = [];

  for (const r of records) {
    if (!r.id) {
      failed.push({ id: '(无 id)', why: '记录没有 tweet_id' });
      continue;
    }
    try {
      /**
       * ⭐ 先看在不在 —— 用来分 inserted/updated,
       * 也用来判「正文是不是变短了」(③ 深→浅降级)。
       */
      const found = await db.query<[Array<{ text?: string; status?: string }>]>(
        'SELECT text, status FROM x_tweet WHERE tweet_id = $id LIMIT 1',
        { id: r.id },
      );
      const old = (found[0] ?? [])[0];
      const exists = old !== undefined;

      /**
       * ⭐⭐⭐ **正文只在变长或旧值为空时才覆盖**。
       * ⚠️ 实测:重采把 16081 字覆盖成 267 字(列表页只给标题+摘要)。
       * ⭐ 不是「新值优先」,是「**更全的优先**」。
       */
      const oldText = typeof old?.text === 'string' ? old.text : '';
      const keepOldText = exists && oldText.length > r.text.length;
      /**
       * ⚠️⚠️ `status` 必填(非 option 无 DEFAULT),但它**是业务字段** ——
       * 已有行可能已经是 `worth` / `skip` / `replied`,
       * 重采把它打回 `pending` 会让人工判断和 AI 判断**白做一遍**。
       * ⭐ 所以:新建给 `pending`,已有行**原样沿用**。
       */
      const oldStatus = typeof old?.status === 'string' && old.status !== ''
        ? old.status : 'pending';

      const vars = {
        id: r.id,
        text: keepOldText ? oldText : r.text,
        lang: opt(r.lang),
        is_long_text: r.isLongText,
        is_article: r.isArticle,
        article_url: opt(r.articleUrl),
        conversation_id: opt(r.conversationId),
        tweet_url: opt(r.tweetUrl),
        in_reply_to: opt(r.inReplyToStatusId),
        in_reply_to_user: opt(r.inReplyToScreenName),
        quoted_status_id: opt(r.quotedStatusId),
        in_reply_to_user_id: opt(r.inReplyToUserId),
        /** ⚠️ 空数组也照写 —— 「采了,确实没提及谁」与「没采」要分开时看 fetched_at */
        mention_ids: r.mentionIds,
        quoted_author_id: opt(r.quotedAuthorId),
        retweet_of_id: opt(r.retweetOfId),
        retweet_of_author_id: opt(r.retweetOfAuthorId),
        author_handle: r.authorHandle,
        author_rest_id: opt(r.authorRestId),
        author_name_at_post: opt(r.authorName),
        author_avatar: opt(r.authorAvatar),
        author_bio: opt(r.authorBio),
        is_blue_verified: r.isBlueVerified,
        following: r.following,
        followed_by: r.followedBy,
        media: r.media,
        links: r.links,
        hashtags: r.hashtags,
        mentions: r.mentions,
        created_at: toDatetime(r.createdAt),
        metrics: r.metrics,
        metrics_at: r.metricsAt,
        fetched_at: now,
        liked: r.liked,
        retweeted: r.retweeted,
        bookmarked: r.bookmarked,
        /**
         * ⚠️ `source` 是 `TYPE string`(非 option),空串会让整行写不进去。
         * ⭐ 认不出页面时记 `unknown` —— 那是**事实**(确实不知道从哪采的),
         * 不是兜底:它与「x.search」一样是个真实的取值,查询时分得出来。
         */
        source: ctx.source || 'unknown',
        /**
         * ⚠️⚠️ `status` 是 `TYPE string` **非 option 也没有 DEFAULT** ——
         * 不给的话每一条都写不进去(`Expected \`string\` but found \`NONE\``)。
         * ⭐ `'pending'` = 等 AI 判断,是采集进来的入口状态
         * (`TweetInboxStatus` 的第一个值)。
         * ⚠️ 只在**新建时**用它 —— 已有行的 status 可能已经是 worth/skip,
         * 那是业务字段,见下面 `onlyOnCreate`。
         */
        status: oldStatus,
        search_recipe: opt(ctx.searchRecipe),
        ws_id: opt(ctx.wsId),
      };

      /**
       * ⭐⭐⭐ `UPSERT ... WHERE` —— 存在就更新,不存在就建。
       * ⚠️⚠️ **只列采集字段**;`accepted` / `ai_verdict` / `replied` /
       * `translation` 一个都不在这里 —— 它们是人工与 AI 填的,覆盖不可逆。
       */
      /**
       * ⭐⭐⭐ **`UPSERT type::record(...)` 而不是 `UPSERT x_tweet ... WHERE`**。
       *
       * ⚠️⚠️ 2026-10-05 真机实证:`UPSERT x_tweet SET ... WHERE tweet_id = $id`
       * 返回 **`[[]]`** —— **不报错、不插入、什么都不写**。
       * 面板照样显示「新入库 44 条」,而库里 **0 行**。
       * ⭐ 原因:带 `WHERE` 的 UPSERT 只更新**已匹配的行**,没匹配就什么都不做 ——
       * 又一个「名字骗人」(`project-x-upsert-insert-ignore` 同族,这次是我自己写的)。
       *
       * ⭐ 用 `tweet_id` 当 record id:天然唯一,重采自动落到同一行。
       * ⚠️ 这也是 `project-surreal-id-field-readonly` 的用法 ——
       * **不 DEFINE FIELD id**,只在 record id 位置用它。
       */
      await db.query(
        `UPSERT type::record('x_tweet', $id) SET
           tweet_id = $id,
           text = $text, lang = $lang,
           is_long_text = $is_long_text, is_article = $is_article,
           article_url = $article_url,
           conversation_id = $conversation_id, tweet_url = $tweet_url,
           in_reply_to = $in_reply_to, in_reply_to_user = $in_reply_to_user,
           quoted_status_id = $quoted_status_id,
           in_reply_to_user_id = $in_reply_to_user_id, mention_ids = $mention_ids,
           quoted_author_id = $quoted_author_id,
           retweet_of_id = $retweet_of_id, retweet_of_author_id = $retweet_of_author_id,
           author_handle = $author_handle, author_rest_id = $author_rest_id,
           author_name_at_post = $author_name_at_post,
           author_avatar = $author_avatar, author_bio = $author_bio,
           is_blue_verified = $is_blue_verified,
           following = $following, followed_by = $followed_by,
           media = $media, links = $links,
           hashtags = $hashtags, mentions = $mentions,
           -- created_at 也是 datetime,同样要 cast;但它是 option,
           -- 没值时必须给 NONE 而不是 type::datetime(undefined)
           created_at = IF $created_at != NONE THEN type::datetime($created_at) ELSE NONE END,
           metrics = $metrics,
           -- datetime 字段必须 cast:直接传 ISO 字符串会被库拒收
           -- (真机 2026-10-05 实证,这一条就足以让每一次写入都失败)
           metrics_at = type::datetime($metrics_at),
           fetched_at = type::datetime($fetched_at),
           liked = $liked, retweeted = $retweeted, bookmarked = $bookmarked,
           source = $source, search_recipe = $search_recipe, ws_id = $ws_id,
           -- status 只在新建时给 pending;已有行可能已是 worth/skip,
           -- 那是业务字段,重采不许把它打回去(见 BUSINESS_FIELDS)
           status = $status`,
        vars,
      );
      if (exists) updated += 1; else inserted += 1;
    } catch (e) {
      /** ⚠️ 一条坏只赔一条 —— 不让整批作废,但也**绝不静默** */
      failed.push({ id: r.id, why: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * ⭐⭐⭐ **落库也要留痕** —— 2026-10-05 的教训。
   *
   * ⚠️⚠️ 两跑「面板报入库 44/45 条、库里 0 行」,而我**读不出发生了什么**:
   * 留痕里只有 `harvest-ok`,没有一条跟写库有关 ——
   * 「压根没调」和「调了但每条都失败」长得一模一样,只能去真库里猜。
   * ⭐ `feedback-maintainability-over-feature-completion`:
   * **成功路径也要留痕**,否则下次验证又要靠人。
   * ⚠️ 失败原因只记**第一条**(整批同因时 45 条一模一样,记全了是噪音)。
   */
  console.log(
    `[x.tweet-repo] 落库 ${records.length} 条 → 新 ${inserted} / 更新 ${updated}`
    + (failed.length > 0 ? ` / 失败 ${failed.length}：${failed[0].why}` : ''),
  );

  return { inserted, updated, failed };
}
