/**
 * X 的语义页面表 —— **adapter 的活**
 *
 * ⭐ 底座的 `goto` **不认识任何 URL**。业务方说「我要去某人的推文与回复页」,
 * 由这张表翻成 URL + 到位判据。站点改版时变的是右边,语义名不动 ——
 * 这是「改版只改一层」的直接兑现。
 *
 * ── 重建说明(2026-10-01)──
 *
 * 本文件**从旧实现继承了判据的知识**(`git show x-before-rebuild:…/x-pages.ts`),
 * 但不继承它的依赖:旧版 import 了 `x-timeline-scan`(596 行的采集模块)
 * 只为两个纯字符串函数 —— 那正是「一根 import 牵住十几个模块」的活样本。
 * ⭐ 本版**零业务依赖**:只认 URL 与判据,不认采集、不认库表。
 */

import type {
  AnchorName,
  PageResolver,
  ReadyCriterion,
} from '@platform/main/web-capability/page/control-types';

/** X 的站点常量 —— ⚠️ 模块自带,不从 shared/ 取(X 的东西要跟着模块走) */
const BASE_URL = 'https://x.com';

/** 归一化 handle(去 @、小写) */
function cleanHandle(h: string): string {
  return h.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * ⭐ 从**推文链接或裸 id** 取出 tweetId。取不出返回 null。
 *
 * ── 用户 2026-10-02:「应该是推文的链接,而不是 id 号,
 * 　因为没有必要单独填写 id 号」──
 *
 * ⭐ 对的:人手上有的就是**链接**(从 X 上复制的),
 * 让人先把 id 抠出来是把本该代码做的事推给人。
 *
 * ⚠️ 实测踩到:框只收 id 时用户粘了整条链接,
 * 于是拼出 `/i/status/https://x.com/.../status/2105…?s=20` —— 页面当然不存在。
 *
 * 支持三种写法(都是人真会粘的):
 * · `https://x.com/someone/status/123?s=20`
 * · `x.com/i/status/123`
 * · `123`(裸 id)
 *
 * ⚠️ **与 `identify()` 共用同一条正则** —— 另写一份会漂,
 * 而漂的表现是「正向解析得出来、反向认不出」。
 */
const STATUS_PATH = /\/(?:i|[^/]+)\/status\/(\d+)/;

export function extractTweetId(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  // ⭐ 裸数字 id 直接用(人也可能只粘 id)
  if (/^\d+$/.test(v)) return v;
  const m = v.match(STATUS_PATH);
  return m ? m[1] : null;
}

/**
 * ⭐⭐ 搜索词归一化 —— **从旧实现原样继承**(判断是实测换来的)。
 *
 * ── 用户 2026-09-23 实测踩到 ──
 *
 * 填 `VPN,翻墙` 采回 94 条**全不相干**:X 把逗号串当成**一个短语**,
 * 而且**不报错** —— 「搜的不是你想搜的」与「这个词真没人发」长得一样。
 *
 * ⚠️ 认到任一高级语法就原样放行 —— 判据保守:
 * 宁可少规范化,也不能把人写对的查询改坏。
 *
 * ⭐ 为什么就地放在本文件:旧版这两个函数住在 `x-timeline-scan`
 * (596 行的采集模块)里,页面表只用这两个**纯字符串函数**,
 * 却因此 import 了整条采集链 —— 一根 import 牵住十几个模块。
 * 判据:**纯函数不该跟着它碰巧所在的大模块走**,谁用它它就该离谁近。
 */
export function normalizeSearchQuery(raw: string): string {
  const q = (raw ?? '').trim();
  if (!q) return '';
  if (/\bOR\b|\bAND\b|from:|to:|filter:|since:|until:|lang:|["()]/.test(q)) return q;
  const words = q.split(/[,，、\s]+/).map((w) => w.trim()).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return `"${words[0]}"`;
  return `(${words.map((w) => `"${w}"`).join(' OR ')})`;
}

/**
 * ⭐⭐ **给手填的搜索加时间窗** —— 用户 2026-09-25:
 * 「查询采集,建议一次不要超过 24 小时的帖子,除非有特殊约定」。
 *
 * ── 为什么需要(旧实现查证过)──
 * **配方跑的时候一直有** `since:`,而**手填这条路完全没有** → 搜全部历史。
 * ⭐ 与「逗号当成短语」同一形态:**同一件事两套实现,手填那套绕开了规则**。
 *
 * ── ⚠️ 为什么默认 2 天而不是 24 小时(用户拍板)──
 *  · X 的 `since:` **只精确到天**,填「今天」会漏掉昨晚发的
 *  · X 的搜索索引有延迟,刚发的推可能几小时后才进 since: 的结果
 *  · ⭐ 配方那边甚至故意多抓 48 小时重叠,理由是「**宁可重复,不可遗漏**」
 *
 * ── 逃生口 ──
 * ⚠️ `days <= 0` → 不加(搜全部历史);
 * ⚠️ 查询里自带 since:/until: → 原样放行,不叠加
 *   (人显式写了时间条件,再塞一个会互相打架,而且**不报错**)。
 */
export function withSinceWindow(query: string, days = 2): string {
  const q = (query ?? '').trim();
  if (!q) return q;
  if (/\bsince:|\buntil:|\bsince_time:|\buntil_time:/i.test(q)) return q;
  if (!Number.isFinite(days) || days <= 0) return q;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0];
  return `${q} since:${since}`;
}

/**
 * ⭐ 手填搜索默认只看最近几天 —— 用户 2026-09-25 拍板。
 * ⚠️ 2 天不是 24 小时:`since:` 只到天级 + 索引有延迟,填 1 会漏掉昨晚的。
 */
export const DEFAULT_SEARCH_DAYS = 2;

/** URL 片段判据 —— 首页/通知这类「没有具体对象」的页面够用 */
const byUrl = (fragment: string): ReadyCriterion => ({ kind: 'urlIncludes', fragment });

/**
 * ⭐⭐ **某个人的页面**:URL 对 **且** 页面上真有推文。
 *
 * ── 为什么不能只比 URL(旧实现 2026-09-15 实测)──
 *
 * 用户填了不存在的账号跑 `goto`,结果判成**到位**:
 * X 对不存在的用户**保持 URL 不变**、在页内渲染「账号不存在」,
 * 于是「到了他的页」与「到了错误页」在 URL 判据下**完全一样**。
 *
 * 加上「有推文」这一条,账号不存在/被封/零推文时就会诚实超时。
 *
 * ⚠️ 代价说明白:**零推文的真实账号也会判失败**。这是有意的取舍 ——
 * 宁可对「空号」误报,也不能把「不存在」当成「到了」:
 * 前者人一看就知道,后者会让后续采集把错误页当成他的时间线。
 */
const byUrlAndTweets = (fragment: string): ReadyCriterion => ({
  kind: 'all',
  of: [
    { kind: 'urlIncludes', fragment },
    // ⚠️ 用 `as AnchorName` 铸造,**不用 `as never`** —— 后者是「让编译器闭嘴」,
    //    会连真正的类型错误一起吞掉。
    { kind: 'anchorAppears', anchor: X_ANCHORS.tweetArticle },
  ],
});

/** 本模块用到的语义锚点名 —— 与锚点表同一份常量,不各写一份 */
export const X_ANCHORS = {
  /** 一条推文的容器 */
  tweetArticle: 'x.tweetArticle' as AnchorName,
} as const;

/**
 * ⭐⭐ **每个语义页面要哪些参数** —— 面板问它要,**不许自己抄一份**。
 *
 * ── 为什么要有这张表(旧实现的血泪,原文)──
 *
 * > 真因:面板有**四处写死的正则** `/^x\.(profile|withReplies|articles)$/`
 * > 决定「要不要显示 handle 输入框、要不要传 handle」。新页面不在里面
 * > → 框不显示 → 参数不传 → resolve 拿到空 handle 返回 null。
 * > ⚠️ 又是「写死清单不会自己长」(同族第五刀)。
 *
 * ⭐ 2026-10-01 又验了一次:Console 第一版没有这张表,
 * 用户点 `x.profile` 直接 failed「没传参数」—— **面板没办法知道该填什么**。
 *
 * ⚠️ 加页面时**只改这一处**,面板自动跟上。
 */
export const PAGE_PARAMS: Readonly<Record<string, readonly string[]>> = {
  'x.home': [],
  'x.profile': ['handle'],
  'x.withReplies': ['handle'],
  'x.articles': ['handle'],
  'x.status': ['tweetId'],
  /** ⚠️ `f`/`days` 是**可选**的 —— 见 `OPTIONAL_PAGE_PARAMS`,不填也能跑 */
  'x.search': ['q', 'f', 'days'],
  // ── 人的列表页(产出的是**人**不是推文,见各自 resolver 的注释)──
  'x.followers': ['handle'],
  'x.verifiedFollowers': ['handle'],
  'x.following': ['handle'],
  'x.notifications': [],
  'x.compose': [],
  'x.composeArticles': [],
};

/**
 * ⭐⭐ **有默认值、不填也能跑的参数** —— 面板据此判断「缺不缺」。
 *
 * ── ⚠️ 旧实现的血泪(原文)──
 *
 * > 面板原来把这个清单**写死成只有 `'f'`**,于是新增可选参数(如 `days`)
 * > 会被当成必填 → 不填就禁用「采集」按钮,而人根本不知道该填什么。
 *
 * ⭐ 「清单不会自己长」在本仓栽过多次,所以放在**页面表这边**(真源),
 * 加可选参数时与 `PAGE_PARAMS` 一起改,面板不抄一份。
 *
 * ⚠️ `since` 必须登记在这里,否则参数校验会把它当未知参数丢掉 ——
 * 现象是「水位算出来了但窗口没变」,**而且不报错**。
 */
export const OPTIONAL_PAGE_PARAMS: readonly string[] = ['f', 'days', 'since'];

/**
 * ⭐ 每个参数**长什么样** —— 给面板当 placeholder。
 *
 * ⚠️ 2026-10-01 实测踩到:用户选 `x.status` 填了 `elonmusk`,
 * 于是拼出 `https://x.com/i/status/elonmusk`(不存在的推文)→ 到位判据诚实超时。
 * ⭐ **系统行为是对的**(没假装成功),但 UI 让人很容易填错:
 * 那个框只显示「tweetId」三个字,不说它要的是一串数字。
 *
 * ⚠️ 且提示**必须放在这里**而不是面板里 ——
 * 面板里写 `k === 'handle' ? … : …` 就是「写死清单」的开端
 * (守卫钉着:Console 不许出现写死的参数名分支)。
 */
export const PARAM_HINTS: Readonly<Record<string, string>> = {
  handle: '账号，如 elonmusk（不带 @）',
  tweetId: '推文链接，或裸数字 id',
  /**
   * ⚠️ 提示里要说清**逗号会被当成 OR** —— 用户 2026-09-23 填 `VPN,翻墙`
   * 采回 94 条全不相干,因为 X 把逗号串当成一个短语且不报错。
   * 现在我们会替他规范化成 `("VPN" OR "翻墙")`,但人得知道发生了什么。
   */
  q: '关键词，逗号/空格分隔自动变 OR；已带 OR/from: 等语法则原样用',
  f: 'live（默认，按时间）或 top（热门）',
  days: `只搜最近几天，默认 ${DEFAULT_SEARCH_DAYS}；填 0 = 搜全部历史`,
  since: '起始日 YYYY-MM-DD；⚠️ 填了就盖过 days',
};

type Resolved = { url: string; arrival: ReadyCriterion; describe: string };

/**
 * 语义名 → URL + 到位判据。
 *
 * ⚠️ 参数缺失一律返回 null(由底座翻成 Failed),**不拿默认值顶上**:
 * 空 handle 会导航到 `x.com/`(首页),然后被当成「那个人的主页」解析 ——
 * 旧实现 2026-09-07 的「把首页时间线当搜索结果」**整批入库**就是这么来的。
 */
const PAGES: Readonly<Record<string, (p: Readonly<Record<string, string>>) => Resolved | null>> = {
  /** 首页时间线 */
  'x.home': () => ({
    url: `${BASE_URL}/home`,
    arrival: byUrl('/home'),
    describe: '首页时间线',
  }),

  /** 某人主页 */
  'x.profile': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${BASE_URL}/${h}`,
      arrival: byUrlAndTweets(`/${h}`),
      describe: `@${h} 主页`,
    };
  },

  /** 某人的推文与回复 —— ⚠️ 判据带 handle,否则**别人的** with_replies 也算到位 */
  'x.withReplies': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${BASE_URL}/${h}/with_replies`,
      arrival: byUrlAndTweets(`/${h}/with_replies`),
      describe: `@${h} 的推文与回复`,
    };
  },

  /**
   * 单条推文。
   * ⚠️ 判据用 **tweetId 不用 handle**:X 会把 `/i/status/` 重写成
   * `/{真作者}/status/`,判 handle 会把「已经到了」误判成「没到位」。
   */
  'x.status': (p) => {
    /**
     * ⭐ 收**链接或裸 id** —— 人手上有的是从 X 复制的链接,
     * 让人先抠 id 是把代码该做的事推给人(用户 2026-10-02)。
     * ⚠️ 取不出来返回 null(由底座翻成 Failed),**不拿原值硬拼** ——
     * 硬拼会得到 `/i/status/https://…`,页面当然不存在,
     * 而报错会说成「没到位」,把人指向完全错误的方向。
     */
    const id = extractTweetId(p.tweetId ?? p.url ?? '');
    if (!id) return null;
    return {
      url: `${BASE_URL}/i/status/${id}`,
      arrival: byUrlAndTweets(`/status/${id}`),
      describe: `推文 ${id}`,
    };
  },

  /**
   * ⭐⭐ 某人的**长文列表**。
   *
   * ⚠️ 实测知识(`project-x-article-body-lost` / `project-x-collect-needs-scroll`):
   * ① **列表页载荷没有正文** —— 只有 title + preview_text,
   *    正文(DraftJS `content_state`)**只在单篇页**。这不是 bug 是 X 的设计。
   * ② 长文太少的账号会**一屏到底滚不动** → 不触发 `UserArticles` 载荷 → 采 0 条。
   *    那是「页面太短」不是「链路坏」,两种成因别混。
   */
  'x.articles': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${BASE_URL}/${h}/articles`,
      arrival: byUrlAndTweets(`/${h}/articles`),
      describe: `@${h} 的长文`,
    };
  },

  /**
   * ⭐⭐ **搜索结果** —— 采集主入口,也是规则最多的一页。
   *
   * 三条规则全部来自实测,一条都不是我加的:
   * ① 查询规范化(用户 2026-09-23:`VPN,翻墙` 采回 94 条全不相干)
   * ② 默认时间窗(用户 2026-09-25:「一次不要超过 24 小时」→ 实际 2 天)
   * ③ `since` 盖过 `days`(用户 2026-09-27:「按上一次采集时间倒推 12 小时」)
   *
   * ⚠️ ③ 的**水位要查库**,而本函数是**同步纯函数** ——
   * 所以由**调用方**先查好、用 `since` 参数传进来。这里只负责用,不负责查。
   * ⭐ 这样解析器保持可单测、不碰库,水位逻辑集中在一处。
   *
   * ⚠️ `since` 一旦给了就盖过 `days`:两个都算会互相打架,
   * 而打架的表现是「窗口比预期窄」,**在数据里看不出来**。
   */
  'x.search': (p) => {
    const raw = (p.q ?? '').trim();
    if (!raw) return null;
    const normalized = normalizeSearchQuery(raw);
    if (!normalized) return null;

    const explicitSince = typeof p.since === 'string' ? p.since.trim() : '';
    const days = p.days !== undefined && p.days !== ''
      ? Number(p.days) : DEFAULT_SEARCH_DAYS;
    const q = explicitSince
      ? `${normalized} since:${explicitSince}`
      : withSinceWindow(normalized, Number.isFinite(days) ? days : DEFAULT_SEARCH_DAYS);
    const f = p.f === 'top' ? 'top' : 'live';
    return {
      url: `${BASE_URL}/search?q=${encodeURIComponent(q)}&f=${f}`,
      arrival: byUrl('/search'),
      /** ⚠️ 描述里显示**最终发出去**的串 —— 人要看得见我们真正搜的是什么 */
      describe: `搜索 ${q}（${f}）`,
    };
  },

  /**
   * ⭐⭐ 人的列表页:关注者 / 验证关注者 / 关注中。
   *
   * ── 用户 2026-09-18 实测 ──
   * 在 `x.com/otun_myvpn/verified_followers` 采集,截到 **12 个
   * `BlueVerifiedFollowers` 载荷、每个约 40KB** —— 那就是人的列表。
   *
   * ⭐⭐ 这三页产出的是**人**(`x_author` 行)不是推文,是**第二种采集类型**:
   *
   * |      | 采推 | 采人 |
   * |---|---|---|
   * | 载荷 | HomeTimeline / UserTweets | Followers / BlueVerifiedFollowers / Following |
   * | 产出 | `x_tweet` | **`x_author`** |
   * | 字段 | metrics / conversationId | **bio / 粉丝数 / 关系** |
   *
   * ⭐ 它正是 `project-x-author-table-not-populated` 的正解:
   * x_author 仅 36 行而见过 3458 个作者 —— 关注列表一次采全,覆盖率直接拉满。
   * 关系(iFollow / followsMe)载荷自带,**零额外请求**。
   *
   * ⚠️⚠️ 到位判据用 `byUrl` **不用** `byUrlAndTweets`:
   * 这几页上**没有推文**,等 `x.tweetArticle` 锚点会必然超时。
   *
   * ⚠️ 2026-09-18 实测:在这几页上点采集曾报「认不出左边这个页面」——
   * 因为它们**根本没登记**。本次(2026-10-02)补回。
   */
  'x.followers': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${BASE_URL}/${h}/followers`,
      arrival: byUrl(`/${h}/followers`),
      describe: `@${h} 的关注者`,
    };
  },

  'x.verifiedFollowers': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${BASE_URL}/${h}/verified_followers`,
      arrival: byUrl(`/${h}/verified_followers`),
      describe: `@${h} 的验证关注者`,
    };
  },

  'x.following': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${BASE_URL}/${h}/following`,
      arrival: byUrl(`/${h}/following`),
      describe: `@${h} 关注的人`,
    };
  },

  /** 通知页(收件箱那条链路的入口) */
  'x.notifications': () => ({
    url: `${BASE_URL}/notifications`,
    arrival: byUrl('/notifications'),
    describe: '通知页',
  }),

  /**
   * 发推弹窗。
   * ⭐ 用独立 URL 而不是首页顶部那个框 —— 直达 compose,不依赖首页布局。
   * ⚠️⚠️ 这里**只是去那一页**。填内容走 `web.input`,
   * **发布永远留给人点** —— 用户反复确认过的红线。
   */
  'x.compose': () => ({
    url: `${BASE_URL}/compose/post`,
    arrival: byUrl('/compose/post'),
    describe: '发推弹窗',
  }),

  /**
   * 长文编辑器。
   * ⚠️ 同上:只导航,不发布。
   */
  'x.composeArticles': () => ({
    url: `${BASE_URL}/compose/articles`,
    arrival: byUrl('/compose/articles'),
    describe: '长文编辑器',
  }),
};

/**
 * ⭐ 反向:当前 URL → 语义名 + 参数。认不出来返回 null。
 *
 * ⚠️ **必须与正向同一张表的知识** —— 另写一份会漂,
 * 而漂的表现是「自动填的和实际采的不是同一页」。
 */
/**
 * ⭐⭐ **X 自己的路由** —— `/<handle>` 那条规则必须先排除它们。
 *
 * ⚠️ 不排除会怎样(旧实现原文):
 * > 会把「设置页」认成「一个叫 settings 的人的主页」,然后采集跑到那儿去 ——
 * > 而现象是「采到 0 条」,指向完全错误的方向。
 *
 * ⭐⭐ **前半截从 `PATH_SEGMENT` 真表推导,不写第二份清单** ——
 * 本仓「写死的清单不会自己长」已栽过五次
 * (`feedback-guard-hardcoded-list-never-grows`):
 * 我这轮刚加了 `x.search`/`x.notifications`/`x.compose`,
 * 如果保留清单要手工补,下一个加页面的人必然漏 →
 * `/search` 被认成「一个叫 search 的人」。
 *
 * ⚠️ 后半截(`EXTRA_RESERVED`)是**我们没登记但 X 真有**的路由,
 * 推导不出来,只能列 —— 这部分仍是写死的,加页面时无需动,
 * 但 X 新开一条顶级路由时要补。判据:它只该含**我们不去的页**。
 *
 * ── ⚠️⚠️ 实测:`PATH_SEGMENT` 推出来的四项目前是**冗余的** ──
 *
 * 2026-10-02 注入验证时发现:删掉 `'x.search': 'search'`,
 * `/search` 照样不会被认成人 —— 因为 `identify` 里
 * `/home`、`/notifications`、`/compose/*`、`/search` **各有前置分支**,
 * 走不到 `/<handle>` 那条规则。实测 `/settings` `/explore` `/messages`
 * 才是真靠这份清单返回 null 的。
 *
 * ⭐ **那为什么还留着推导?** 一条理由:
 * 将来有人**删掉或改窄某个前置分支**(比如把 `/home` 那条合并进别处),
 * 推导这一半会自动接上,而手写清单不会 —— 这正是
 * `feedback-guard-hardcoded-list-never-grows` 要治的。
 *
 * ⚠️⚠️ 我一度在这里写过第二条理由:「`/compose/xyz` 会掉到 `/<handle>`
 * 被认成一个叫 compose 的人」—— **实测证否**(返回 null):
 * `/<handle>` 的正则是 `^\/([^/]+)$`,**单段**,两段路径根本匹配不上。
 * ⭐ 留着这条更正,因为它是我**没验证就当结论写下**的推断,
 * 而注释里的假理由会让下一个人照着它做错决定。
 *
 * ⚠️ 代价说明白:**现在删掉推导这半截,测试不会红** ——
 * 它是对将来的保险,不是当下的防线。知道这一点比假装它在干活重要。
 */
const PATH_SEGMENT: Readonly<Record<string, string>> = {
  'x.home': 'home',
  'x.notifications': 'notifications',
  'x.compose': 'compose',
  'x.composeArticles': 'compose',
  'x.search': 'search',
};

const EXTRA_RESERVED: readonly string[] = [
  'explore', 'settings', 'messages', 'bookmarks', 'lists', 'communities',
  'jobs', 'premium', 'i', 'intent', 'login', 'logout', 'signup',
  'tos', 'privacy', 'about', 'download',
];

/** ⭐ 真源合并:登记页面占掉的首段 + X 自己的其他路由 */
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  ...Object.values(PATH_SEGMENT),
  ...EXTRA_RESERVED,
]);

/** `/<handle>/<sub>` 的子路径 → 语义名。⚠️ 与正向 PAGES 的键一一对应 */
const SUB_PATH_NAME: Readonly<Record<string, string>> = {
  with_replies: 'x.withReplies',
  articles: 'x.articles',
  followers: 'x.followers',
  verified_followers: 'x.verifiedFollowers',
  following: 'x.following',
};

function identify(url: string): { name: string; params: Record<string, string> } | null {
  let path: string;
  let search: URLSearchParams;
  try {
    const u = new URL(url);
    if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(u.hostname)) return null;
    // ⚠️ 去掉末尾斜杠 —— `/home/` 与 `/home` 是同一页
    path = u.pathname.replace(/\/$/, '') || '/';
    search = u.searchParams;
  } catch {
    return null;   // ⚠️ 不是合法 URL —— 如实说不认识,不猜
  }

  // ── 无参数的固定页 ──
  if (path === '/home') return { name: 'x.home', params: {} };
  if (path === '/notifications') return { name: 'x.notifications', params: {} };
  if (path === '/compose/post') return { name: 'x.compose', params: {} };
  if (path.startsWith('/compose/articles')) return { name: 'x.composeArticles', params: {} };

  /**
   * ⭐ 搜索页 —— ⚠️ 只回 `q` 与 `f`,**不回 days/since**:
   * URL 里的 `since:` 已经**在 q 里面**了,再单独回一个会让
   * 「用它」之后重新 resolve 时**叠加第二个时间条件**,而且不报错。
   */
  if (path === '/search') {
    const q = search.get('q') ?? '';
    return q ? { name: 'x.search', params: { q, f: search.get('f') === 'top' ? 'top' : 'live' } } : null;
  }

  // ⭐ 与 `extractTweetId` 共用同一条正则 —— 另写一份会漂
  const status = path.match(STATUS_PATH);
  if (status) return { name: 'x.status', params: { tweetId: status[1] } };

  // ── /<handle>/<sub> ──
  const sub = path.match(/^\/([^/]+)\/(with_replies|articles|followers|verified_followers|following)$/);
  if (sub) return { name: SUB_PATH_NAME[sub[2]], params: { handle: sub[1] } };

  // ── /<handle> ⚠️ 必须排除 X 自己的路由 ──
  const profile = path.match(/^\/([^/]+)$/);
  if (profile && !RESERVED_SEGMENTS.has(profile[1].toLowerCase())) {
    return { name: 'x.profile', params: { handle: profile[1] } };
  }
  return null;
}

/** ⭐ 本模块的页面表 —— 启动时 **push** 给底座,底座不认识 X */
export const xPageResolver: PageResolver & {
  paramsOf(name: string): readonly string[];
  hintOf(param: string): string;
  optionalOf(name: string): readonly string[];
} = {
  resolve: (name, params) => PAGES[name]?.(params ?? {}) ?? null,
  names: () => Object.keys(PAGES),
  /** ⭐ 面板据此渲染输入框 —— 真表,不许抄 */
  paramsOf: (name) => PAGE_PARAMS[name] ?? [],
  /** ⭐ 参数该填什么样的值 —— 同样是真表,面板不许自己写分支 */
  hintOf: (param) => PARAM_HINTS[param] ?? param,
  /**
   * ⭐ 哪些参数不填也能跑 —— 面板据此决定「缺不缺」。
   * ⚠️ 这里回的是**全局清单**(`f`/`days`/`since`),
   * 底座会与本页的 `paramsOf` 取交集,所以不会污染别的页面。
   */
  optionalOf: () => OPTIONAL_PAGE_PARAMS,
  identify,
};
