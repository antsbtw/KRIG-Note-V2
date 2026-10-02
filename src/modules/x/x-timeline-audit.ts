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

/** 一条推文的完整性画像 —— ⚠️ 字段选取对应已知的丢失形态 */
export type TweetAudit = {
  readonly id: string;
  /**
   * ⭐ 正文开头 —— 用户 2026-10-02:「对于推文中的**数据是否完整**没有显示哦。」
   * ⚠️ 只给**开头 80 字**:面板要能一眼看出「这条采到的是什么」,
   * 而整段正文几千字会把面板撑爆(真要看全文点开原始载荷)。
   */
  readonly preview: string;
  /** 正文有没有 */
  readonly hasText: boolean;
  readonly textLen: number;
  /** ⚠️ 长推(note_tweet)与长文(article)是**两回事**,分开量 */
  readonly isLongText: boolean;
  readonly isArticle: boolean;
  /** 作者 */
  readonly hasAuthor: boolean;
  readonly handle: string;
  /** ⚠️ 这几个是历史上丢过的 */
  readonly hasCreatedAt: boolean;
  readonly hasMetrics: boolean;
  readonly hasConversationId: boolean;
  readonly hasTweetUrl: boolean;
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
     * ⚠️ 正文取**最长**的那个 —— 长推的全文在 `note_tweet` 里,
     * `legacy.full_text` 是截断版。
     * `project-x-article-body-lost`:取错了会「23 字 vs 16081 字」。
     */
    const full = str(legacy.full_text);
    const noteText = isObj(noteTweet?.note_tweet_results)
      ? str((((noteTweet.note_tweet_results as Record<string, unknown>).result) as Record<string, unknown> | undefined)?.text)
      : '';
    const text2 = noteText.length > full.length ? noteText : full;

    // 作者 —— ⚠️ 不写死路径,按特征找
    const users = collectBy(node.core ?? node, (o) => typeof o.screen_name === 'string');
    const handle = users.length > 0 ? str(users[0].screen_name) : '';

    const metrics = ['favorite_count', 'retweet_count', 'reply_count']
      .some((k) => typeof legacy[k] === 'number');

    return {
      id: str(legacy.id_str) || str(node.rest_id),
      // ⚠️ 去掉换行:面板一行显示,换行会把布局撑开
      preview: text2.slice(0, 80).replace(/\s+/g, ' '),
      hasText: text2.length > 0,
      textLen: text2.length,
      isLongText: noteText.length > 0,
      isArticle: article !== undefined,
      hasAuthor: handle.length > 0,
      handle,
      hasCreatedAt: typeof legacy.created_at === 'string',
      hasMetrics: metrics,
      hasConversationId: typeof legacy.conversation_id_str === 'string',
      // ⚠️ tweet_url 在载荷里不是直接字段,靠 handle+id 拼得出来才算有
      hasTweetUrl: Boolean(handle && str(legacy.id_str)),
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

  const pct = (f: (t: TweetAudit) => boolean): number =>
    (items.length === 0 ? 0 : Math.round((items.filter(f).length / items.length) * 100));

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
    coverage: {
      正文: pct((t) => t.hasText),
      作者: pct((t) => t.hasAuthor),
      发布时间: pct((t) => t.hasCreatedAt),
      互动数: pct((t) => t.hasMetrics),
      会话id: pct((t) => t.hasConversationId),
      推文链接: pct((t) => t.hasTweetUrl),
      长推: pct((t) => t.isLongText),
      长文: pct((t) => t.isArticle),
    },
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
  const pct = (f: (t: TweetAudit) => boolean): number =>
    (all.length === 0 ? 0 : Math.round((all.filter(f).length / all.length) * 100));

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
    if (!t.hasMetrics) missing.push('互动数');
    if (!t.hasConversationId) missing.push('会话id');
    if (!t.hasTweetUrl) missing.push('推文链接');
    return { audit: t, missing };
  }).filter((x) => x.missing.length > 0);

  return {
    pages: audits.length,
    tweets: all.length,
    uniqueTweets: ids.size,
    items: uniq,
    incomplete,
    coverage: {
      正文: pct((t) => t.hasText),
      作者: pct((t) => t.hasAuthor),
      发布时间: pct((t) => t.hasCreatedAt),
      互动数: pct((t) => t.hasMetrics),
      会话id: pct((t) => t.hasConversationId),
      推文链接: pct((t) => t.hasTweetUrl),
      长推: pct((t) => t.isLongText),
      长文: pct((t) => t.isArticle),
    },
    problems,
  };
}
