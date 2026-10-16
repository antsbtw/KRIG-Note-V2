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
 * ⭐⭐ 截断判据用到的**原始证据**(X 自己给的,不是我推断的)。
 *
 * ⚠️ 带 `?` 的全是「载荷没带就 undefined」,**不兜底成 0/false**
 * (`feedback-fail-loud-no-fallback`:兜底会把「没带」伪装成「是 0」)。
 */
export type TruncationEvidence = {
  /**
   * ⭐ `legacy.display_text_range` —— X 说「正文该显示到第几个字」。
   * ⚠️ 单位是 **UTF-16 code unit**,不是字符:emoji 占 2。
   */
  readonly displayTextRange?: readonly [number, number];
  /**
   * ⭐ **`legacy.full_text` 的长度**(按**码点**,与 `display_text_range` 同单位)。
   *
   * ⚠️⚠️ 2026-10-04 更正:我原先写「按 UTF-16 code unit」——**错的**。
   * X 的 `display_text_range` 是**码点**偏移;拿 JS 的 `.length`(UTF-16 单元)
   * 去比,带 emoji 的推文永远对不齐(一个 emoji = 1 码点 = 2 单元)。
   *
   * ⚠️⚠️ 这个数**可能小于报告上面那行的「正文 N 字」** —— 不是 bug:
   * 长推(note_tweet)的「正文」取的是 full_text 与 note 全文里**长的那个**,
   * 而截断判据必须量 `full_text` —— `display_text_range` 和 `entities`
   * 描述的都是它。拿 note 全文去比 range 等于**跨着两个字符串比**。
   * ⭐ 真机 2026-10-03 第 2 条:正文 767 字(note)而这里 135(full_text)。
   */
  readonly textUnits: number;
  /**
   * ⭐⭐ 末尾那个 t.co **在不在 `entities.urls` 里**。
   *
   * 这是区分「链接卡片」和「真截断」的关键:
   * 卡片的 t.co 是 X 为真实链接生成的,`entities.urls` 里有它 + `expanded_url`;
   * 真截断末尾那串**不在** urls 里。
   * ⚠️ 末尾压根没 t.co 时是 undefined,不是 false。
   */
  readonly trailingUrlIsEntity?: boolean;
  /** ⭐ 末尾 t.co 展开后指向哪 —— 人一眼能判断是不是卡片 */
  readonly trailingExpandedUrl?: string;
  /** ⭐ 省略号结尾 —— X 真截断的显式标记 */
  readonly endsWithEllipsis: boolean;
  /** ⭐ 有没有媒体(带图的推末尾 t.co 是图片链接) */
  readonly hasMedia: boolean;
  /**
   * ⭐⭐ **结论的一句话理由** —— 报告直接印这句。
   * ⚠️ 不管判成截断还是没截断**都写**:成功路径也要留痕。
   */
  readonly verdict: string;
};

/**
 * ⭐⭐⭐ **一条推文的完整记录** —— 落库用,按用户 2026-10-04 的五维组织。
 *
 * ── 为什么与 `TweetAudit` 分开 ──
 * `TweetAudit` 是**给人看的核对结果**:`preview` 只留 80 字(整段几千字会把
 * 面板撑爆)、媒体只留 `['photo']` 不留 URL。它从来不是为存储设计的。
 * ⚠️⚠️ 后果是我们辛苦取回的**长文正文 23446 字,在解析这一步就被扔了** ——
 * 接个 repo 到末尾也没东西可存。
 *
 * ── 五维(用户 2026-10-04:「可以分人、事、物、时、空五个维度」)──
 * 【人】作者是谁       —— `author*`
 * 【事】发生了什么     —— `text` / `isReply` / `metrics`
 * 【物】涉及什么东西   —— `media` / `links` / `hashtags` / `mentions`
 * 【时】什么时候       —— `createdAt` / `metricsAt`
 * 【空】从哪来         —— 采集来源由调用方补(配方/ws),解析器不知道
 *
 * ⭐ 「物」这一维在原先的三分法里**没有位置** —— 被归进「事」,
 * 于是媒体和链接就当成推文的附属品丢掉了。五维一摆缺口立刻显形。
 * ⚠️ 但**不独立成表**:它们现在连存都没存过,形态是猜的
 * (用户 2026-09-01 定过:「边的形态在真实数据跑出来之前是猜的」)。
 */
export type TweetRecord = {
  // ── 【事】本体 ──
  readonly id: string;
  /**
   * ⭐⭐ **完整正文**,不截断。
   * ⚠️ 取最长的那份:长文正文 > 长推 note_tweet > `legacy.full_text`
   * (`project-x-upsert-overwrites-richer-text`:16081 字被 267 字盖掉过)。
   */
  readonly text: string;
  readonly lang: string;
  readonly isLongText: boolean;
  readonly isArticle: boolean;
  /** ⭐ 长文正文的去处 —— 只在列表页缺正文时有 */
  readonly articleUrl?: string;
  /** ⚠️ 没拿全以及为什么 —— 与 `TweetAudit.incomplete` 同义 */
  readonly incomplete?: 'text-truncated' | 'article-no-body';
  readonly conversationId: string;
  readonly tweetUrl: string;
  readonly isReply: boolean;
  readonly inReplyToStatusId: string;
  readonly inReplyToScreenName: string;
  readonly quotedStatusId: string;
  /**
   * ⭐⭐ 互动对象,全用**数字 id**(2026-10-10,「他的朋友圈」的原料)。
   * 人的身份是 rest_id —— 存 handle 的话对方一改名关系就断。
   * ⚠️ 载荷没带就是空串 / 空数组,不编。
   */
  readonly inReplyToUserId: string;
  readonly mentionIds: readonly string[];
  /** 引用了谁的推文(原作者) */
  readonly quotedAuthorId: string;
  /**
   * ⭐ 这条是**转发** —— 转发了哪条、原作者是谁。
   * ⚠️ 外层是「他的转发」、里层是原推文;原推文另作为一条推文存(作者=原作者),
   * 这里把**两层的关系**记下来(第一版只存了两条推文,关系丢了)。
   */
  readonly retweetOfId: string;
  readonly retweetOfAuthorId: string;

  // ── 【人】作者 ──
  readonly authorHandle: string;
  readonly authorRestId: string;
  readonly authorName: string;
  readonly authorAvatar: string;
  readonly authorBio: string;
  /** ⚠️ 载荷没带就是 undefined,**不兜底成 false** */
  readonly isBlueVerified?: boolean;
  /**
   * ⭐⭐ **用 X 自己的词** —— 用户 2026-10-04:
   * 「这个还是按照 x 的分类吧 **following/follower**」。
   *
   * ⚠️ 我原先叫 `iFollow` / `followsMe` —— 那是**我自造的说法**。
   * 载荷里的原名就是 `relationship_perspectives.following` / `.followed_by`,
   * 照抄平台的词,少一层翻译就少一层漂移
   * (同 `project-x-persistent-tracking` 那条「措辞一律用追踪不用关注」:
   * 　**名字要对得上它描述的那件事**)。
   *
   * `following`  —— 我关注了他
   * `followedBy` —— 他关注了我(X 原名 `followed_by`)
   * ⚠️ 载荷没带就是 undefined,**不兜底成 false**。
   */
  readonly following?: boolean;
  readonly followedBy?: boolean;

  // ── 【物】涉及什么 ──
  /** ⭐⭐ 媒体 **带 URL** —— 只存 type 等于没采(现状就是这样) */
  readonly media: ReadonlyArray<{ readonly type: string; readonly url: string }>;
  /** ⭐ 外链(已展开)—— `t.co` 是包装,存展开后的真地址 */
  readonly links: readonly string[];
  readonly hashtags: readonly string[];
  readonly mentions: readonly string[];

  // ── 【时】 ──
  /** ⚠️ 发布时间 —— 载荷没带就 undefined,别拿采集时间顶替 */
  readonly createdAt?: string;
  /**
   * ⭐⭐ 互动数是**哪一刻**的 —— 解析这条载荷的时刻。
   * ⚠️ 没有它的话「赞 7」是今天还是上周的分不出来。
   */
  readonly metricsAt: string;
  readonly metrics: Readonly<Record<string, number>>;

  // ── 【我的动作】—— 不是推文本体,是「我对它做过什么」 ──
  readonly liked?: boolean;
  readonly retweeted?: boolean;
  readonly bookmarked?: boolean;

  /**
   * ⭐⭐ 这条来自主页**置顶条目**(载荷里单独一条 `TimelinePinEntry` 指令)——
   * 置顶本身**以及它内嵌引用的推文**都算。**只在内存里用,不落库**。
   * ⚠️ 2026-10-15 真机:X 在帖子页**每一次翻页**都把置顶带回来,
   * 于是「这一页他最新一条」永远是置顶 → 按时间停的判据永远不停(半年 = 全部),进度卡在置顶日期。
   * ⚠️⚠️ 2026-10-16 真机补:只排除置顶本身不够 —— 置顶(08-27)引用了 05-13 那条、它又引用 05-12,
   * 两条引用也跟着置顶**每页回来**,作者也是他 → 时间线翻过 05-13 后「最新」又卡在 05-13。
   * 对「按时间停」来说,**整个置顶条目都不是时间线本身**。
   */
  readonly pinned?: true;
};

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
   * ⭐⭐⭐ **这条推的完整记录** —— 落库取它,不要从核对结果反推。
   * ⚠️ 核对结果是给人看的(preview 80 字、媒体只有 type),
   * 拿它落库会把全文和媒体 URL 丢掉。
   */
  readonly record: TweetRecord;
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
  /**
   * ⭐⭐ **判据的依据** —— `incomplete` 是怎么得出来的。
   *
   * ── 为什么要存这个(2026-10-03)──
   * 真机报告写着「正文被截断」,我**拿不出它凭什么这么说**:
   * 原始载荷只在内存,跑完就没,只能回头猜判据。
   * 那条实测是**误报**(链接卡片,不是截断)。
   *
   * ⭐ `feedback-maintainability-over-feature-completion`:
   * 成功路径也要留痕 —— 下次核对不该靠人截图,靠报告自己说清。
   */
  readonly truncationEvidence?: TruncationEvidence;
  /**
   * ⭐⭐⭐ 长文正文的**去处** —— `https://x.com/i/article/<id>`
   *
   * ── 2026-10-03 真机发现(@KA594594,40 条里 38 条是长文)──
   * 列表页不给正文,但**给了地址**:它就是末尾那个 t.co 在
   * `entities.urls` 里的 `expanded_url`。38/38 全配上,反向 0 误报。
   *
   * ⭐⭐ 这把「补长文正文」从「模拟人点卡片」降成了「按地址逐个取」——
   * 不用找卡片、不用猜 URL、不依赖 DOM 结构。
   * ⚠️ article id **不等于**推文 id(实测 5/5 都不同),所以推不出来,
   * 　 只能从载荷里拿 —— 这正是它非存不可的原因。
   */
  readonly articleUrl?: string;
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
/**
 * ⭐ 取 `xxx_result.result` 里的推文,剥掉 X 的可见性包装
 * (`TweetWithVisibilityResults` 把真推文放在 `.tweet` 里)。拿不到返回 undefined。
 */
function innerTweet(r: unknown): Record<string, unknown> | undefined {
  if (!isObj(r)) return undefined;
  const res = isObj(r.result) ? r.result : undefined;
  if (!res) return undefined;
  return isObj(res.tweet) && res.__typename === 'TweetWithVisibilityResults' ? res.tweet : res;
}

/** 推文作者的数字 id —— `core.user_results.result.rest_id`;拿不到是空串 */
function authorIdOf(t: Record<string, unknown> | undefined): string {
  if (!t || !isObj(t.core)) return '';
  const ur = (t.core as Record<string, unknown>).user_results;
  return isObj(ur) && isObj(ur.result) ? str(ur.result.rest_id) : '';
}

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
 * ⭐⭐⭐ 这条正文**是不是没拿全** —— 连带给出判据的依据。
 *
 * ── 为什么要重写(2026-10-03 真机)──
 * 旧判据:「没媒体 + 以 t.co 结尾」就算截断。真机把**链接卡片**误判了:
 *
 *   「新人必备 跟上峰哥的节奏 https://t.co/4QMNIjlI8f」(36 字,无媒体)
 *
 * 那是一条**分享链接**的推 —— 卡片既不算媒体(媒体判据只认
 * `extended_entities.media`)也不算引用,所以旧判据看它像截断。
 *
 * ⭐⭐ 改用 **X 自己给的证据**,不靠我推断:
 *   ① `entities.urls` 里有这个 t.co + `expanded_url` → **卡片**,不是截断
 *   ② `display_text_range[1] < 正文长度` → X 自己说正文显示不全
 *   ③ 省略号结尾 → 真截断的显式标记
 *
 * ⚠️ 宁可漏报不要误报(`project-x-readback-lies`:
 * **工具谎报比采集出错更坏 —— 它让人去改没坏的代码**)。
 */
function judgeTruncation(
  fullText: string,
  hasMedia: boolean,
  entities: Record<string, unknown> | undefined,
  displayRange: unknown,
): { truncated: boolean; evidence: TruncationEvidence } {
  const t = fullText.trim();
  /** ⚠️ 按**码点**量,才能和 `display_text_range` 对齐(JS `.length` 是 UTF-16 单元) */
  const textUnits = [...fullText].length;
  const endsWithEllipsis = /[…]$|\.\.\.$/.test(t);

  /** ⭐ `display_text_range` 必须是两个数,**别的形状一律当没带** */
  const range = Array.isArray(displayRange)
    && displayRange.length === 2
    && typeof displayRange[0] === 'number'
    && typeof displayRange[1] === 'number'
    ? ([displayRange[0], displayRange[1]] as const)
    : undefined;

  /** ⭐ 末尾那串 t.co(有就取出来,好去 `entities.urls` 里找) */
  const trailing = /https:\/\/t\.co\/(\w+)$/.exec(t)?.[0];
  let trailingUrlIsEntity: boolean | undefined;
  let trailingExpandedUrl: string | undefined;
  if (trailing !== undefined) {
    /**
     * ⚠️⚠️ 只有**确实拿到了 urls 数组**才敢说「不在里面」。
     * 载荷没给 urls 时留 `undefined` —— 「查不到」和「查过没有」
     * 是两件事,混起来就会把判不了的当成可疑的(第一版就栽在这:
     * 无条件写 `hit !== undefined`,让「没给」变成了「不在」)。
     */
    const urls = Array.isArray(entities?.urls)
      ? entities.urls as Record<string, unknown>[]
      : undefined;
    if (urls !== undefined) {
      const hit = urls.find((u) => str(u.url) === trailing);
      trailingUrlIsEntity = hit !== undefined;
      if (hit !== undefined) trailingExpandedUrl = str(hit.expanded_url) || undefined;
    }
  }

  const mk = (truncated: boolean, verdict: string) => ({
    truncated,
    evidence: {
      displayTextRange: range,
      textUnits,
      trailingUrlIsEntity,
      trailingExpandedUrl,
      endsWithEllipsis,
      hasMedia,
      verdict,
    },
  });

  /**
   * ⚠️ 这行是**防御性冗余** —— 空串本来也通不过下面几条
   * (注入验证实测:删掉它测试照样全绿)。留着是因为将来若加
   * 「长度小于 N 就可疑」那类规则,空串会被误判。
   */
  if (!t) return mk(false, '正文是空的 —— 那是「没正文」不是「截断」');

  // ① 省略号结尾 —— X 真截断的显式标记,最硬的信号
  if (endsWithEllipsis) return mk(true, '以省略号结尾 —— X 截断的显式标记');

  /**
   * ② X 自己说正文显示不全 —— ⚠️⚠️ **但要先扣掉末尾的实体链接**。
   *
   * ── 2026-10-04 真机第三次误报(72 条里误报 50 条)──
   * 我原先写 `range[1] < textUnits` 就算截断。实测差值分布:
   *   **35 条差正好 24** = 一个空格 + `https://t.co/xxxxxxxxxx`(23 字符)
   *   另有 25/26/27/28 的(多个链接)、以及几条差 1(末尾空格)
   *
   * 典型:「今天地铁人不多 不开车很舒服 还可以玩手机 https://t.co/3nxAcK91hb」
   * 正文 47、range 到 23 —— 那 23 字**本来就是全文**,后面是 X 给配图
   * 自动加的链接。**X 本来就把末尾实体 URL 排除在显示区间之外**。
   *
   * ⭐ 所以判据改成:range 之后**除了实体链接和空白,还剩别的字**才算截断。
   * ⚠️ 这是同一个判据第三次误报(① 带图的 t.co ② 链接卡片 ③ 这次)——
   * 三次都因为我拿「看起来像」的特征当判据,而不是先量真实分布。
   */
  if (range !== undefined && range[1] < textUnits) {
    /**
     * ⭐ range 之后那一段;t.co 链接和空白都不算「被截掉的正文」。
     *
     * ⚠️ **先把全文里的 t.co 全抹掉再切**,不能先切后抹:
     * `range[1]` 可能落在链接**中间**(实测 23 落在 `https` 的 h 后面),
     * 那样切出来是 `ttps://t.co/…` —— 正则认不出,扣不掉。
     * ⭐ 抹成等长空格,位置才不会错位。
     */
    const blanked = fullText.replace(/https:\/\/t\.co\/\w+/g, (m) => ' '.repeat(m.length));
    /**
     * ⚠️⚠️ **按码点切,不按 `.length` 切**(2026-10-04 实测)。
     * `display_text_range` 是**码点**偏移,JS 的 `.length` 是 UTF-16 单元 ——
     * 一个 emoji = 1 码点 = 2 单元,**两者永远对不齐**。
     * 实测残留的 10 条误报里有 4 条正是切在代理对中间,
     * 切出半个 emoji(`\udf89`)被当成「还剩正文」。
     */
    const tail = [...blanked].slice(range[1]).join('').trim();
    if (tail.length > 0) {
      return mk(
        true,
        `display_text_range 到 ${range[1]}、正文有 ${textUnits}，`
        + `扣掉末尾链接后仍多出 ${tail.length} 字 —— X 说显示不全`,
      );
    }
  }

  // ③ 末尾 t.co 的归属:在 entities.urls 里 = 卡片/图片链接,不是截断
  if (trailing !== undefined) {
    if (trailingUrlIsEntity === true) {
      return mk(false, `末尾 t.co 在 entities.urls 里(→ ${trailingExpandedUrl ?? '未给展开地址'})—— 是链接卡片不是截断`);
    }
    if (hasMedia) return mk(false, '末尾 t.co 且有媒体 —— 那是图片/视频链接');
    /**
     * ⚠️⚠️ 走到这里 = 末尾挂着 t.co、**不在** entities.urls、也没媒体。
     * 真机 2026-10-03 那条误报就卡在这 —— 当时载荷连 entities 都没解,
     * 所以 `trailingUrlIsEntity` 是 undefined 而非 false。
     * ⭐ 现在只有**确实查过 urls 且没找到**才报,查不到就不报(宁可漏报)。
     */
    if (trailingUrlIsEntity === false) {
      return mk(true, '末尾 t.co 不在 entities.urls 里且无媒体 —— 可疑');
    }
    return mk(false, '末尾有 t.co 但载荷没给 entities.urls —— 判不了,按没截断算(宁可漏报)');
  }

  return mk(false, '正文正常结尾,无截断特征');
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
  /**
   * ⭐⭐ **空响应体**单独说 —— 2026-10-04 真机。
   *
   * ⚠️ 本函数的文档注释写着「『这个载荷读不懂』与『这个载荷是空的』
   * 是两件事,混起来就查不动」—— 而代码**正是混着的**:
   * 空串走 JSON.parse 会抛 `Unexpected end of JSON input`,
   * 于是报成「可能被截断了」,把人指向「腿把响应切了」这个错方向。
   * ⭐ 真相是**压根没有响应体**(CDP 的 noBody),那是另一类问题。
   */
  if (text.trim() === '') {
    return {
      tweets: 0, hasCursor: false, items: [], coverage: {},
      problems: ['**响应体是空的** —— 不是解析失败,是这条响应根本没拿到内容'
        + '(多半是 CDP 读 body 失败,看 legs 里的 noBody)'],
    };
  }
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
  /**
   * ⭐⭐ 置顶 = `{ type: 'TimelinePinEntry', entry: {...} }`(真实载荷对过,x-payload-survey 2026-09-02)。
   * ⚠️ 取**整个置顶条目子树**里的推文(置顶 + 它内嵌引用的)—— 见 TweetRecord.pinned 的 10-16 补记。
   * 判据与下面 tweetNodes 同一个(带 legacy.full_text 的对象),不另发明。
   */
  const pinnedIds = new Set(
    collectBy(root, (o) => o.type === 'TimelinePinEntry' && isObj(o.entry))
      .flatMap((o) => collectBy(o.entry, (n) => isObj(n.legacy) && typeof (n.legacy as Record<string, unknown>).full_text === 'string'))
      .map((n) => str((n.legacy as Record<string, unknown>).id_str) || str(n.rest_id))
      .filter((id) => id !== ''),
  );

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
    /**
     * ⭐⭐⭐ 长文**正文**(DraftJS `content_state.blocks[]`)——
     * 2026-10-03 真机在 `TweetResultByRestId` 拿到。
     *
     * ⚠️ 此前这里是 `JSON.stringify(content_state)`,**只当「有没有」的旗子用**:
     * 单篇页明明把正文给了,`textLen` 照样报 23(那个 t.co 短链)——
     * 与 `project-x-article-body-lost` 是同一个形态(23 字 vs 16081 字)。
     *
     * 实测块结构(非推测,记在 project-x-article-body-lost):
     * · `unstyled` 正文段 / `header-two` 小标题
     * · ⚠️ `atomic` 是媒体占位,`text` 是**单个空格** —— 不滤会留一堆孤立空行
     */
    const articleBody = ((): string => {
      if (!ares || !isObj(ares.content_state)) return '';
      const blocks = (ares.content_state as Record<string, unknown>).blocks;
      if (!Array.isArray(blocks)) return '';
      return blocks
        .map((b) => (isObj(b) && typeof b.text === 'string' ? b.text : ''))
        /** ⚠️ 滤掉 atomic 的单空格(trim 后为空) */
        .filter((t) => t.trim().length > 0)
        .join('\n');
    })();
    /** ⭐ 标题也算正文的一部分 —— 它**不在** blocks 里 */
    const articleTitle = ares ? str(ares.title) : '';
    /**
     * ⭐⭐⭐ 长文的**地址**在 `entities.urls` 里(2026-10-03 真机)。
     * ⚠️ 只认 `/i/article/` 开头的 —— 别的 expanded_url 是普通外链。
     */
    const entUrls = isObj(legacy.entities) && Array.isArray(legacy.entities.urls)
      ? legacy.entities.urls as Record<string, unknown>[]
      : [];
    const articleUrl = entUrls
      .map((u) => str(u.expanded_url))
      .find((u) => /^https:\/\/(x|twitter)\.com\/i\/article\/\d+/.test(u));
    /**
     * ⭐⭐ 正文取**最长**的那个 —— 长文正文(标题+正文)也参与比较。
     * ⚠️ 列表页的长文只有 23 字 t.co,单篇页才有几千字:
     * 同一个字段两种深度,取长的才不会被列表页那份盖掉
     * (`project-x-upsert-overwrites-richer-text` 的教训:深→浅降级)。
     */
    const articleText = articleBody.length > 0
      ? [articleTitle, articleBody].filter((x) => x.length > 0).join('\n\n')
      : '';
    const text2 = [full, noteText, articleText].sort((a, b) => b.length - a.length)[0] ?? '';

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
     * ⭐⭐⭐ 【物】这一维 —— 2026-10-04 按用户的五维补。
     *
     * ⚠️⚠️ 这些路径**解析器一直在读**(截断判据就在用 `entities.urls`),
     * 只是读完就扔 —— 于是「媒体」只剩一个 `['photo']`,
     * **URL、外链、话题标签、@提及全丢**。采了等于没采。
     *
     * ⭐ 媒体存 **type + URL**:只存 type 的话,
     * 「这条推配了什么图」永远答不上来。
     */
    const ent = isObj(legacy.entities) ? legacy.entities : undefined;
    const media = mediaArr
      .map((m) => ({ type: str(m.type), url: str(m.media_url_https) || str(m.expanded_url) }))
      .filter((m) => m.type !== '' || m.url !== '');
    /** ⭐ 外链存**展开后**的真地址 —— `t.co` 是 X 的包装,不是我们要的链接 */
    const links = (Array.isArray(ent?.urls) ? ent.urls as Record<string, unknown>[] : [])
      .map((u) => str(u.expanded_url))
      .filter((u) => u.length > 0);
    const hashtags = (Array.isArray(ent?.hashtags) ? ent.hashtags as Record<string, unknown>[] : [])
      .map((h) => str(h.text))
      .filter((h) => h.length > 0);
    const mentions = (Array.isArray(ent?.user_mentions)
      ? ent.user_mentions as Record<string, unknown>[] : [])
      .map((m) => str(m.screen_name))
      .filter((m) => m.length > 0);
    /** ⭐ 提及的**数字 id**(朋友圈按 id 认人)*/
    const mentionIds = (Array.isArray(ent?.user_mentions)
      ? ent.user_mentions as Record<string, unknown>[] : [])
      .map((m) => str(m.id_str))
      .filter((m) => m.length > 0);
    /** ⭐ 引用原推 / 转发原推 —— 取出里层推文与它的作者 id(先剥可见性包装)*/
    const quotedTweet = innerTweet(node.quoted_status_result);
    const retweeted = innerTweet(legacy.retweeted_status_result);

    /**
     * ⭐⭐ **这条没拿全,以及为什么**(旧实现的 `incomplete`)。
     * ⚠️ 长文只有标题+摘要(列表页不给正文)是 `article-no-body`;
     * ⚠️ 没有 note_tweet 而 full_text 带截断特征是 `text-truncated`。
     */
    let incomplete: TweetAudit['incomplete'];
    /**
     * ⭐⭐ 判据连**依据**一起算出来 —— 不管结论是什么都留痕。
     * ⚠️ `entities` 与 `display_text_range` 都在 `legacy` 上,
     * 从 **note_tweet 那边取不到**(长推的 entities 是另一份)。
     */
    const trunc = judgeTruncation(
      full,
      mediaArr.length > 0,
      isObj(legacy.entities) ? legacy.entities : undefined,
      legacy.display_text_range,
    );
    if (article !== undefined && articleBody.length === 0) incomplete = 'article-no-body';
    else if (noteText.length === 0 && trunc.truncated) {
      incomplete = 'text-truncated';
    }

    /**
     * ⭐⭐⭐ **完整记录** —— 落库用的那份(五维),与核对结果分开。
     * ⚠️ `text` 取 `text2`:它已经是「长文正文 / 长推全文 / full_text」里
     * **最长的那份**(只许变长,见 `project-x-upsert-overwrites-richer-text`)。
     * ⭐ 挂在 audit 条目上**而不是另开一条链路** —— 两条链路必漂。
     */
    const recordId = str(legacy.id_str) || str(node.rest_id);
    const record: TweetRecord = {
      ...(pinnedIds.has(recordId) ? { pinned: true as const } : {}),
      id: recordId,
      text: text2,
      lang: str(legacy.lang),
      isLongText: noteText.length > 0,
      isArticle: article !== undefined,
      articleUrl,
      incomplete,
      conversationId: str(legacy.conversation_id_str),
      /**
       * ⭐ 推文链接 —— **拼出来存**,不是只记「能不能拼」。
       * ⚠️ 原先只有 `hasTweetUrl: boolean`,URL 本身从没留过。
       */
      tweetUrl: handle && str(legacy.id_str)
        ? `https://x.com/${handle}/status/${str(legacy.id_str)}`
        : '',
      isReply: str(legacy.in_reply_to_status_id_str).length > 0,
      inReplyToStatusId: str(legacy.in_reply_to_status_id_str),
      inReplyToScreenName: str(legacy.in_reply_to_screen_name),
      quotedStatusId: str(legacy.quoted_status_id_str),
      inReplyToUserId: str(legacy.in_reply_to_user_id_str),
      mentionIds,
      quotedAuthorId: authorIdOf(quotedTweet),
      retweetOfId: retweeted ? (str((retweeted.legacy as Record<string, unknown> | undefined)?.id_str) || str(retweeted.rest_id)) : '',
      retweetOfAuthorId: authorIdOf(retweeted),
      authorHandle: handle,
      authorRestId: str(urr?.rest_id),
      authorName,
      authorAvatar: avatarUrl,
      authorBio: authorBio,
      isBlueVerified: blue,
      following: iFollow,
      followedBy: followsMe,
      media,
      links,
      hashtags,
      mentions,
      /** ⚠️ 载荷没带就 undefined —— **别拿采集时间顶替发布时间** */
      createdAt: typeof legacy.created_at === 'string' ? legacy.created_at : undefined,
      /** ⭐ 互动数是**这一刻**读到的 —— 没有它「赞 7」是今天还是上周分不出来 */
      metricsAt: new Date().toISOString(),
      metrics: Object.fromEntries(
        Object.entries(metrics).filter(([, v]) => typeof v === 'number'),
      ) as Record<string, number>,
      liked: typeof legacy.favorited === 'boolean' ? legacy.favorited : undefined,
      retweeted: typeof legacy.retweeted === 'boolean' ? legacy.retweeted : undefined,
      bookmarked: typeof legacy.bookmarked === 'boolean' ? legacy.bookmarked : undefined,
    };

    return {
      id: str(legacy.id_str) || str(node.rest_id),
      record,
      preview: text2.slice(0, 80).replace(/\s+/g, ' '),
      hasText: text2.length > 0,
      textLen: text2.length,
      isLongText: noteText.length > 0,
      isArticle: article !== undefined,
      incomplete,
      /**
       * ⭐ 有长推全文时判据本身没意义,但**依据照样存** ——
       * 「为什么没报截断」也是要能读出来的。
       */
      truncationEvidence: trunc.evidence,
      articleUrl,
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
 * ⭐⭐⭐ 把 DOM 展开后的全文**合并**进核对结果。
 *
 * ── 用户 2026-10-02:「你的这个流程是什么意思,我搞不懂」──
 * 他问的是流程,而我借此发现:**「展开全部」的结果压根没接进采集** ——
 * 展开后的全文只在 DOM 里,核对用的还是载荷里的截断版,那一步**白点**。
 *
 * ── ⚠️ 合并的唯一规则:**只许变长** ──
 *
 * 旧实现原话:「`text` 只许变长 —— 与写库那层同一条底线
 * (2026-09-22 的数据损坏就是它防住的)」。
 * ⚠️ `project-x-upsert-overwrites-richer-text` 实测:
 * 重采把 **16081 字正文覆盖成 267 字** —— 深→浅降级是真发生过的数据损坏。
 *
 * ⭐ 所以:DOM 的全文只有**比载荷里的长**才顶上去;
 * 反过来载荷的长文正文也不会被 DOM 摘要顶掉。
 */
export function mergeExpandedText(
  audit: TimelineAudit,
  domTweets: ReadonlyArray<{ id: string; text: string }>,
): TimelineAudit {
  if (domTweets.length === 0) return audit;
  const byId = new Map(domTweets.map((t) => [t.id, t.text]));

  const items = audit.items.map((t) => {
    const dom = byId.get(t.id);
    // ⚠️ **只许变长** —— 短的一律不动
    if (!dom || dom.length <= t.textLen) return t;
    return {
      ...t,
      textLen: dom.length,
      preview: dom.slice(0, 80).replace(/\s+/g, ' '),
      hasText: true,
      /**
       * ⭐ 拿到更长的正文 = 截断这件事已经解决了。
       * ⚠️ 但 `article-no-body` **不清** —— DOM 上的长文摘要同样不是正文,
       * 那个缺口要靠进单篇页才补得上。
       */
      incomplete: t.incomplete === 'text-truncated' ? undefined : t.incomplete,
    };
  });

  return { ...audit, items, coverage: buildCoverage(items) };
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
  /**
   * ⭐⭐ 去重后的明细 —— 两页之间会重叠。
   *
   * ⚠️⚠️ **同一条推的两份要留「更全」的那份**(2026-10-03 改)。
   *
   * 长文会出现两次:列表页那份只有 23 字 t.co,单篇页那份才有正文。
   * 原先「保留先出现的」会把**补回来的正文整个丢掉** ——
   * 逐篇跑完 38 趟,报告照样说「缺 38 篇」。
   * ⭐ 那正是 `project-x-upsert-overwrites-richer-text` 的同一形态
   * (深→浅降级),也是「跑了一趟、看着做了事、正文还是没有」。
   *
   * ⭐ 判据用 `textLen`:**只许变长**,与 `mergeExpandedText` 同一条规矩。
   */
  const byId = new Map<string, number>();
  const uniq: TweetAudit[] = [];
  for (const t of all) {
    if (!t.id) { uniq.push(t); continue; }
    const at = byId.get(t.id);
    if (at === undefined) {
      byId.set(t.id, uniq.length);
      uniq.push(t);
      continue;
    }
    /** ⚠️ 只在**真的更长**时替换 —— 一样长就不动,免得来回横跳 */
    if (t.textLen > uniq[at].textLen) uniq[at] = t;
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
