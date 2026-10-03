/**
 * X 时间线载荷的**完整性核对** —— ⭐ 这是 X 的活,所以在 X 模块里
 *
 * ── 用户 2026-10-02 ──
 * 「测试期间,每次就爬取**两页**就够了。关键是**核对爬取的数据完整没有**。」
 * 「一定要注意能力分层…**x 的活才放在 x 中**。」
 *
 * ⭐ 底座(`web.acquire`)只知道「采到几条响应」,**不可能**知道
 * 一个 timeline 载荷里该有什么 —— 那是 X 的业务知识,必须在这里。
 *
 * ── ⚠️ 为什么「核对完整性」不能只看条数 ──
 *
 * 本仓记过三次同族的事故,全是「数字对了但东西没了」:
 * · `project-x-article-body-lost`     长文正文整片丢失,报告仍说「✓ 全文已取回」
 * · `project-x-upsert-overwrites-richer-text` 16081 字被 267 字覆盖
 * · 2026-10-02 本轮                   captured=72 而**一条推文都没有**
 *
 * ⭐ 所以核对必须**逐字段量**,而且**不量的字段永远 100%**。
 */

/**
 * 一条推文的完整性画像。
 *
 * ── ⭐⭐ 字段清单**照搬旧实现实际取过的**(用户 2026-10-02:
 * 「我建议你调研一下原来的设计,究竟都取了哪些数据」「包括元数据」)──
 *
 * ⚠️ 我原来只量 8 项,那是**我挑的**。查 `x-timeline-harvester.ts`
 * (旧实现的载荷解析器,1871 行)与 `x_tweet` 表 schema 后,
 * 真实清单是 **22 项**,下面逐条对齐。
 *
 * ⭐ 分三组,因为它们「缺了」的含义完全不同:
 * ① **正文与身份** —— 缺了就是真丢数据
 * ② **元数据** —— 缺了影响筛选/排序,但推文本身还在
 * ③ **DOM 独有** —— ⚠️ 载荷路**本来就没有**,标「—」不是「漏采」
 *    (旧实现原话:「不是『漏采』,是『这一路拿不到』。两者必须看得出区别」)
 */
export type TweetAudit = {
  readonly id: string;
  /**
   * ⭐ 正文开头 —— 一眼看出采到的是什么。
   * ⚠️ 只给 80 字:整段几千字会把面板撑爆(看全文点开原始载荷)。
   */
  readonly preview: string;

  // ── ① 正文与身份 ──
  readonly hasText: boolean;
  readonly textLen: number;
  /** ⚠️ 长推(note_tweet)与长文(article)是**两回事**,分开量 */
  readonly isLongText: boolean;
  readonly isArticle: boolean;
  /**
   * ⭐⭐ **这条没拿全,以及为什么** —— 旧实现的 `incomplete` 字段。
   *
   * 用户 2026-09-22 原话:「不管长文短文,如果折叠起来就应该 show all,
   * 然后获取完整的内容,就像人一样,但是现在却是分的零碎」。
   * ⚠️ 此前是「载荷给什么存什么」——「没拿全」和「本来就这么短」
   * 在库里**长得一模一样**。
   */
  readonly incomplete?: 'text-truncated' | 'article-no-body';
  readonly hasAuthor: boolean;
  readonly handle: string;
  /** ⭐ 作者数字 id —— username 会改名,rest_id 不会(旧实现实测 131/131 都有) */
  readonly authorRestId: string;
  /** ⚠️ 显示名:`core.name`(新)/ `legacy.name`(旧)**两个位置都要看** */
  readonly authorName: string;
  /** ⚠️ 头像:`avatar.image_url`(新)/ `legacy.profile_image_url_https`(旧) */
  readonly hasAvatar: boolean;

  // ── ② 元数据 ──
  readonly hasCreatedAt: boolean;
  readonly lang: string;
  /** ⭐ 六项互动数 —— 旧实现全取:likes/retweets/replies/quotes/bookmarks/views */
  readonly metrics: Readonly<Record<string, number | undefined>>;
  readonly metricsCount: number;
  readonly hasConversationId: boolean;
  /** ⭐ 回复关系 —— `project-x-reply-chain-order`:「先看上文确认真相关」 */
  readonly inReplyToStatusId: string;
  readonly inReplyToScreenName: string;
  readonly quotedStatusId: string;
  /**
   * ⭐ 媒体 —— ⚠️ 判据**很窄**(旧实现契约 §2.1,三个不算):
   * 链接预览卡不算、引用原文里的图不算、回复里 @ 到的推的图不算。
   * 只认 `legacy.extended_entities.media`。
   */
  readonly hasMedia: boolean;
  readonly mediaTypes: readonly string[];
  readonly hasTweetUrl: boolean;

  // ── ③ 登录态独有(零额外请求) ──
  /** ⭐ 我对这条推的状态 —— 登录态 webview 独有 */
  readonly self: { favorited?: boolean; retweeted?: boolean; bookmarked?: boolean };
  /** ⚠️ 蓝V:`is_blue_verified` 与 `verification.is_blue_verified` **两个位置** */
  readonly isBlueVerified?: boolean;
  /**
   * ⚠️ 我与作者的关系 —— **带了就有值,没带就是 undefined**。
   * 「没关注」与「不知道关注没」是两件事,混起来会让追踪名单判错人。
   */
  readonly iFollow?: boolean;
  readonly followsMe?: boolean;
  /** ⚠️ 作者 bio —— 旧实现这里曾是**说谎的字段**(报 0 其实是根本没采) */
  readonly authorBio: string;
};

/** 一次核对的结果 */
export type TimelineAudit = {
  /** 这个载荷里解出几条推文 */
  readonly tweets: number;
  /** ⭐ 有没有翻页游标 —— 没有就说明**这是最后一页**或载荷不完整 */
  readonly hasCursor: boolean;
  readonly cursor?: string;
  /** 逐条画像 */
  readonly items: readonly TweetAudit[];
  /**
   * ⭐⭐ 字段覆盖率 —— **百分比**。
   * ⚠️ `project-x-field-four-place-registration` 的教训:
   * 「**不量的字段永远 100%**」—— 所以这里列的每一项都真的在量。
   */
  readonly coverage: Readonly<Record<string, number>>;
  /** ⚠️ 解析过程中的问题 —— 空才算这个载荷读懂了 */
  readonly problems: readonly string[];
};

/**
 * ⭐ 递归找带某个特征的对象 —— **不写死嵌套路径**。
 *
 * ⚠️ 理由照搬旧实现的 `findUserResult`:
 * 「X 的响应外层结构变过好几次,写死路径会在改版后**静默取不到**
 * (返回 undefined 而不报错)」。
 */
function collectBy(node: unknown, pred: (o: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (seen.has(n)) return;      // ⚠️ 防环:X 的载荷里有互相引用
    seen.add(n);
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    const o = n as Record<string, unknown>;
    if (pred(o)) out.push(o);
    for (const v of Object.values(o)) walk(v);
  };
  walk(node);
  return out;
}

/**
 * ⭐⭐ **覆盖率表只有这一份** —— 2026-10-02 抽出来。
 *
 * ⚠️ 原来单页与汇总各写一份,我改了汇总忘了单页 → 单页少了四项,
 * 而 `coverage['长推']` 变成 `undefined`,面板上那一格**什么都不显示**。
 * ⭐ 两份表必然漂,漂的表现是「同一份数据两处算出不同的覆盖率」。
 */
function buildCoverage(items: readonly TweetAudit[]): Record<string, number> {
  const pct = (f: (t: TweetAudit) => boolean): number =>
    (items.length === 0 ? 0 : Math.round((items.filter(f).length / items.length) * 100));
  return {
    // ── ① 正文与身份:缺了就是真丢数据 ──
    正文: pct((t) => t.hasText),
    作者: pct((t) => t.hasAuthor),
    作者id: pct((t) => t.authorRestId.length > 0),
    显示名: pct((t) => t.authorName.length > 0),
    头像: pct((t) => t.hasAvatar),
    // ── ② 元数据:缺了影响筛选/排序 ──
    发布时间: pct((t) => t.hasCreatedAt),
    语言: pct((t) => t.lang.length > 0),
    // ⭐ 六项齐了才算 100% —— 只量「有没有」的话缺三项照样满分
    互动数: pct((t) => t.metricsCount >= 6),
    会话id: pct((t) => t.hasConversationId),
    推文链接: pct((t) => t.hasTweetUrl),
    // ── ③ 登录态独有(零额外请求)──
    蓝V: pct((t) => t.isBlueVerified !== undefined),
    关系: pct((t) => t.iFollow !== undefined),
    作者bio: pct((t) => t.authorBio.length > 0),
    我的操作: pct((t) => Object.values(t.self).some((v) => v !== undefined)),
    // ── ④ **种类分布**,不是缺失 ──
    长推: pct((t) => t.isLongText),
    长文: pct((t) => t.isArticle),
    有媒体: pct((t) => t.hasMedia),
    是回复: pct((t) => t.inReplyToStatusId.length > 0),
  };
}

/**
 * ⭐⭐ 正文**真的被截断了吗**。
 *
 * ── ⚠️⚠️ 2026-10-02 实测误报 16/36 条 ──
 *
 * 我原来的判据含 `https:\/\/t\.co\/\w+$` —— 以 t.co 短链结尾就算截断。
 * 真机结果:36 条里 16 条被标「正文被截断」,而它们**根本没截断**:
 *
 *   「一觉醒来，粉丝超过 1k 了，谢谢各位原始股东！🎉 https://t.co/MOWj8yNqAC」
 *
 * ⭐ 那个 t.co 是 **X 给自己的图片/视频生成的链接** —— 几乎每条带图的推都有。
 * ⚠️ `project-x-readback-lies`:**工具谎报比采集出错更坏 —— 它让人去改没坏的代码**。
 *
 * ── ⭐ 现在的判据 ──
 *
 * ① 结尾是 `…` / `...` —— X 截断时留的省略号,这是**真信号**
 * ② 结尾是 t.co 短链,**且这条推没有媒体** —— 没图却挂着图片链接才可疑
 *    ⚠️ 有媒体时那个短链是正常的,一律不算
 *
 * ⚠️ 判据宁可**漏报**不要误报:漏了只是少一个提示,
 * 误报会让人去查一个不存在的问题(16 条全误报时,真有问题的那条也被淹了)。
 */
function isTruncated(fullText: string, hasMedia: boolean): boolean {
  const t = fullText.trim();
  /**
   * ⚠️ 这行是**防御性冗余** —— 空串本来也通不过下面两条正则
   * (注入验证实测:删掉它测试照样全绿)。
   * ⭐ 留着是因为判据将来可能加「长度小于 N 就可疑」那类规则,
   * 到时候空串会被误判。写明它现在不起作用,免得下一个人以为它在干活。
   */
  if (!t) return false;
  // ① 省略号结尾 —— X 真截断时的标记
  if (/[…]$|\.\.\.$/.test(t)) return true;
  /**
   * ② t.co 结尾**且没有媒体**。
   * ⚠️ 有媒体时那是图片/视频的正常链接(实测 36 条里 13 条如此)。
   */
  if (!hasMedia && /https:\/\/t\.co\/\w+$/.test(t)) return true;
  return false;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * ⭐⭐ 核对一个 timeline 载荷。
 *
 * ⚠️ 解不出来**不抛** —— 回 `problems` 非空的结果:
 * 「这个载荷读不懂」与「这个载荷是空的」是两件事,混起来就查不动。
 */
export function auditTimelinePayload(text: string): TimelineAudit {
  const problems: string[] = [];
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    return {
      tweets: 0, hasCursor: false, items: [], coverage: {},
      problems: [`不是合法 JSON(${e instanceof Error ? e.message : '未知'})—— `
        + '可能被截断了,或这根本不是 timeline 载荷'],
    };
  }

  /**
   * ⭐ 推文对象的特征:带 `legacy.id_str` 或 `rest_id` + `legacy`。
   * ⚠️ 照搬旧实现的判据(`extractTweetsFrom` 只认带 `legacy.id_str` 的),
   * 不自己发明 —— 发明的话会与采集侧的口径漂开。
   */
  const tweetNodes = collectBy(root, (o) => {
    const legacy = o.legacy;
    return isObj(legacy) && typeof legacy.full_text === 'string';
  });

  const items: TweetAudit[] = tweetNodes.map((node) => {
    const legacy = node.legacy as Record<string, unknown>;
    const noteTweet = (node.note_tweet as Record<string, unknown> | undefined);
    const article = (node.article as Record<string, unknown> | undefined);

    /**
     * ⚠️ 正文取**最长**的那个 —— 长推全文在 `note_tweet`,
     * `legacy.full_text` 是截断版(`project-x-article-body-lost`:23 字 vs 16081 字)。
     */
    const full = str(legacy.full_text);
    const noteText = isObj(noteTweet?.note_tweet_results)
      ? str((((noteTweet.note_tweet_results as Record<string, unknown>).result) as Record<string, unknown> | undefined)?.text)
      : '';
    /** ⭐ 长文正文在 `article_results.result.content_state`,**列表页不给** */
    const ares = isObj(article?.article_results)
      ? ((article.article_results as Record<string, unknown>).result as Record<string, unknown> | undefined)
      : undefined;
    const articleBody = ares && isObj(ares.content_state) ? JSON.stringify(ares.content_state) : '';
    const text2 = [full, noteText].sort((a, b) => b.length - a.length)[0] ?? '';

    /**
     * ⭐⭐ 作者 —— ⚠️ 旧实现踩过:只读一个位置会漏。
     * 显示名 `core.name`(新)/ `legacy.name`(旧);
     * 头像 `avatar.image_url`(新)/ `legacy.profile_image_url_https`(旧)。
     * 后果曾是「tweet_url 77% 空、author_avatar 80% 空」。
     */
    const urr = isObj(node.core)
      ? (((node.core as Record<string, unknown>).user_results as Record<string, unknown> | undefined)
        ?.result as Record<string, unknown> | undefined)
      : undefined;
    const ucore = urr?.core as Record<string, unknown> | undefined;
    const ulegacy = urr?.legacy as Record<string, unknown> | undefined;
    const uavatar = urr?.avatar as Record<string, unknown> | undefined;
    const handle = str(ucore?.screen_name) || str(ulegacy?.screen_name);
    const authorName = str(ucore?.name) || str(ulegacy?.name);
    const avatarUrl = str(uavatar?.image_url) || str(ulegacy?.profile_image_url_https);

    /** ⚠️ 蓝V **两个位置**都要看(旧实现:只读一个是 x_author 蓝V仅 2% 的成因) */
    const verification = urr?.verification as Record<string, unknown> | undefined;
    const blue = typeof urr?.is_blue_verified === 'boolean'
      ? urr.is_blue_verified as boolean
      : (typeof verification?.is_blue_verified === 'boolean'
        ? verification.is_blue_verified as boolean : undefined);

    /** ⚠️ 关系同样两个位置;**没带就是 undefined,不兜底成 false** */
    const persp = urr?.relationship_perspectives as Record<string, unknown> | undefined;
    const iFollow = typeof persp?.following === 'boolean'
      ? persp.following as boolean
      : (typeof ulegacy?.following === 'boolean' ? ulegacy.following as boolean : undefined);
    const followsMe = typeof persp?.followed_by === 'boolean'
      ? persp.followed_by as boolean
      : (typeof ulegacy?.followed_by === 'boolean' ? ulegacy.followed_by as boolean : undefined);

    /** ⚠️ bio 也是两个位置(旧实现这里曾是**说谎的字段**:报 0 其实根本没采) */
    const profileBio = urr?.profile_bio as Record<string, unknown> | undefined;
    const authorBio = str(profileBio?.description) || str(ulegacy?.description);

    /** ⭐ 六项互动数。⚠️ `views.count` 是**字符串**,且 state=Enabled 时没有数字 */
    const views = node.views as Record<string, unknown> | undefined;
    const num = (v: unknown): number | undefined =>
      (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const metrics = {
      likes: num(legacy.favorite_count),
      retweets: num(legacy.retweet_count),
      replies: num(legacy.reply_count),
      quotes: num(legacy.quote_count),
      bookmarks: num(legacy.bookmark_count),
      views: typeof views?.count === 'string' ? Number(views.count) : undefined,
    };

    /**
     * ⭐ 媒体判据**很窄**(旧实现契约 §2.1,三个不算):
     * 链接预览卡不算、引用原文里的图不算、回复里 @ 到的推的图不算。
     * 只认 `legacy.extended_entities.media`。
     */
    const extEnt = legacy.extended_entities as Record<string, unknown> | undefined;
    const mediaArr = Array.isArray(extEnt?.media) ? extEnt.media as Record<string, unknown>[] : [];
    const mediaTypes = [...new Set(mediaArr.map((m) => str(m.type)).filter(Boolean))];

    /**
     * ⭐⭐ **这条没拿全,以及为什么**(旧实现的 `incomplete`)。
     * ⚠️ 长文只有标题+摘要(列表页不给正文)是 `article-no-body`;
     * ⚠️ 没有 note_tweet 而 full_text 带截断特征是 `text-truncated`。
     */
    let incomplete: TweetAudit['incomplete'];
    if (article !== undefined && articleBody.length === 0) incomplete = 'article-no-body';
    else if (noteText.length === 0 && isTruncated(full, mediaArr.length > 0)) {
      incomplete = 'text-truncated';
    }

    return {
      id: str(legacy.id_str) || str(node.rest_id),
      preview: text2.slice(0, 80).replace(/\s+/g, ' '),
      hasText: text2.length > 0,
      textLen: text2.length,
      isLongText: noteText.length > 0,
      isArticle: article !== undefined,
      incomplete,
      hasAuthor: handle.length > 0,
      handle,
      authorRestId: str(urr?.rest_id),
      authorName,
      hasAvatar: avatarUrl.length > 0,
      hasCreatedAt: typeof legacy.created_at === 'string',
      lang: str(legacy.lang),
      metrics,
      metricsCount: Object.values(metrics).filter((v) => v !== undefined).length,
      hasConversationId: typeof legacy.conversation_id_str === 'string',
      inReplyToStatusId: str(legacy.in_reply_to_status_id_str),
      inReplyToScreenName: str(legacy.in_reply_to_screen_name),
      quotedStatusId: str(legacy.quoted_status_id_str),
      hasMedia: mediaArr.length > 0,
      mediaTypes,
      // ⚠️ tweet_url 载荷里没有,靠 handle+id 拼得出来才算有
      hasTweetUrl: Boolean(handle && str(legacy.id_str)),
      self: {
        favorited: typeof legacy.favorited === 'boolean' ? legacy.favorited : undefined,
        retweeted: typeof legacy.retweeted === 'boolean' ? legacy.retweeted : undefined,
        bookmarked: typeof legacy.bookmarked === 'boolean' ? legacy.bookmarked : undefined,
      },
      isBlueVerified: blue,
      iFollow,
      followsMe,
      authorBio,
    };
  });

  /**
   * ⭐⭐ 翻页游标 —— **没有它就说明这是最后一页,或载荷不完整**。
   * ⚠️ `project-x-cursor-paging`:「几页没新人」不能当到底,
   * 而 X 一直说 hasMore=true —— 游标在不在是硬证据。
   */
  const cursors = collectBy(root, (o) =>
    str(o.cursorType).toLowerCase() === 'bottom'
    || (typeof o.value === 'string' && str(o.value).startsWith('DAAD')));
  const cursor = cursors.length > 0 ? str(cursors[0].value) : '';

  if (items.length === 0) {
    problems.push('这个载荷里**一条推文都没解出来** —— 可能不是 timeline 载荷,或结构变了');
  }
  if (items.length > 0 && !cursor) {
    problems.push('没有翻页游标 —— 要么是最后一页,要么载荷不完整(翻不动下一页)');
  }

  return {
    tweets: items.length,
    hasCursor: cursor.length > 0,
    cursor: cursor || undefined,
    items,
    /**
     * ⚠️ 每一项都**真的在量** —— `project-x-field-four-place-registration`:
     * 「不量的字段永远 100%」(载荷路径曾不产出 tweet_url/avatar,
     * 而 coverage 不量它们,故恒报 100%)。
     */
    coverage: buildCoverage(items),
    problems,
  };
}

/**
 * ⭐ 把多个载荷的核对结果**汇总**成一句人话。
 * ⚠️ 去重按 tweet id —— 两页之间会有重叠,不去重会把条数报虚高。
 */
export function summarizeAudits(audits: readonly TimelineAudit[]): {
  pages: number; tweets: number; uniqueTweets: number;
  coverage: Record<string, number>; problems: string[];
  /**
   * ⭐⭐ **逐条明细**(去重后)—— 用户 2026-10-02:
   * 「对于推文中的**数据是否完整**没有显示哦。」
   * ⚠️ 只给百分比的话,人不知道**哪几条**不完整、缺的是什么。
   */
  items: TweetAudit[];
  /** ⭐ 有缺失的那些 —— 面板优先显示它们 */
  incomplete: Array<{ audit: TweetAudit; missing: string[] }>;
} {
  const ids = new Set<string>();
  const all: TweetAudit[] = [];
  const problems: string[] = [];
  for (const a of audits) {
    problems.push(...a.problems);
    for (const t of a.items) {
      all.push(t);
      if (t.id) ids.add(t.id);
    }
  }
  /** ⭐ 去重后的明细 —— 两页之间会重叠 */
  const seen = new Set<string>();
  const uniq: TweetAudit[] = [];
  for (const t of all) {
    if (t.id && seen.has(t.id)) continue;
    if (t.id) seen.add(t.id);
    uniq.push(t);
  }

  /**
   * ⭐⭐ 逐条算**缺了什么** —— 这才是「数据是否完整」的直接答案。
   * ⚠️ 长推/长文**不算缺失**:它们是推文的种类,不是必备字段。
   */
  const incomplete = uniq.map((t) => {
    const missing: string[] = [];
    if (!t.hasText) missing.push('正文');
    if (!t.hasAuthor) missing.push('作者');
    if (!t.hasCreatedAt) missing.push('发布时间');
    // ⭐ 六项互动数缺哪几项要说清 —— 「缺互动数」太笼统
    if (t.metricsCount < 6) {
      const lack = Object.entries(t.metrics).filter(([, v]) => v === undefined).map(([k]) => k);
      missing.push(`互动数(${lack.join(',')})`);
    }
    if (!t.hasConversationId) missing.push('会话id');
    if (!t.hasTweetUrl) missing.push('推文链接');
    if (!t.hasAvatar) missing.push('头像');
    if (t.authorRestId.length === 0) missing.push('作者id');
    if (t.authorName.length === 0) missing.push('显示名');
    /**
     * ⭐⭐ 旧实现的 `incomplete` —— 它比任何缺字段都要紧:
     * 「没拿全」和「本来就这么短」此前在库里**长得一模一样**。
     */
    if (t.incomplete === 'text-truncated') missing.push('⚠️正文被截断');
    if (t.incomplete === 'article-no-body') missing.push('⚠️长文没正文');
    return { audit: t, missing };
  }).filter((x) => x.missing.length > 0);

  return {
    pages: audits.length,
    tweets: all.length,
    uniqueTweets: ids.size,
    items: uniq,
    incomplete,
    coverage: buildCoverage(all),
    problems,
  };
}
