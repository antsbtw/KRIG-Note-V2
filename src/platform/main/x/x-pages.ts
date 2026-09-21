/**
 * X 的语义页面表 —— **adapter 的活**(`01-contract.md` §9.3)
 *
 * ⭐ 底座的 `goto` **不认识任何 URL**。业务方说「我要去某人的推文与回复页」,
 * 由这张表翻成 URL + 到位判据。站点改版时变的是右边,左边的语义名不动 ——
 * 这是「改版只改一层」的直接兑现。
 *
 * ── 与锚点表同源的两条纪律 ──
 *
 * ① **URL 能从 `X_PROFILE` 取的就取**,不在本文件抄第二份
 *    (锚点表刚因为抄了一份而漏掉输入框、还把双候选写成单候选)。
 * ② **解释不出来返回 null,绝不兜底** —— 兜底会导航到别的页面,
 *    而那正是 2026-09-07「把首页时间线当搜索结果」**整批入库**的成因。
 *
 * ── ⚠️ 到位判据必须带 handle ──
 *
 * `x.withReplies` 若只判 `/with_replies`,跳到**别人**的 with_replies 也算到位。
 * 与锚点表那条教训同源:判据要能区分「到了」与「到了对的地方」。
 */

import type { PageResolver, ReadyCriterion, AnchorName } from '../web-capability/page/control-types';
import { X_SERVICE_PROFILES } from '@shared/types/x-service-types';

const X_PROFILE = X_SERVICE_PROFILES[0];

/** 归一化 handle(去 @、小写)—— 与 `normalizeHandle` 同口径 */
function cleanHandle(h: string): string {
  return h.trim().replace(/^@+/, '').toLowerCase();
}

/** URL 片段判据 —— 首页/通知/搜索这类「没有具体对象」的页面够用 */
const byUrl = (fragment: string): ReadyCriterion => ({ kind: 'urlIncludes', fragment });

/**
 * ⭐⭐ **某个人的页面**:URL 对 **且** 页面上真有推文。
 *
 * ── 为什么不能只比 URL(2026-09-15 实测)──
 *
 * 用户填了不存在的账号 `fang_dani` 跑 `goto x.withReplies`,结果 **recovered**:
 * X 对不存在的用户**保持 URL 不变**、在页内渲染「账号不存在」,
 * 于是「到了他的页」与「到了错误页」在 URL 判据下**完全一样**。
 *
 * 加上 `tweet.article` 在场这一条,账号不存在/被封/零推文时就会诚实超时。
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
    //    而且会连真正的类型错误一起吞掉。与 `web-console-handler` 的 `asAnchor` 同一手法。
    { kind: 'anchorAppears', anchor: 'tweet.article' as AnchorName },
  ],
});

type Resolved = { url: string; arrival: ReadyCriterion; describe: string };

/**
 * 语义名 → URL + 到位判据。
 *
 * ⚠️ 参数缺失一律返回 null(由底座翻成 Failed),**不拿默认值顶上**:
 * 空 handle 会导航到 `x.com/`(首页),然后被当成「那个人的主页」解析。
 */
const PAGES: Readonly<Record<string, (p: Readonly<Record<string, string>>) => Resolved | null>> = {
  /** 首页时间线 */
  'x.home': () => ({
    url: X_PROFILE.homeUrl,
    arrival: byUrl('/home'),
    describe: '首页时间线',
  }),

  /** 某人主页 */
  'x.profile': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return { url: `${X_PROFILE.baseUrl}/${h}`, arrival: byUrlAndTweets(`/${h}`), describe: `@${h} 主页` };
  },

  /** 某人的推文与回复 —— ⚠️ 判据带 handle,否则别人的 with_replies 也算到位 */
  'x.withReplies': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${X_PROFILE.baseUrl}/${h}/with_replies`,
      arrival: byUrlAndTweets(`/${h}/with_replies`),
      describe: `@${h} 的推文与回复`,
    };
  },

  /** 某人的文章列表 */
  'x.articles': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${X_PROFILE.baseUrl}/${h}/articles`,
      arrival: byUrlAndTweets(`/${h}/articles`),
      describe: `@${h} 的文章`,
    };
  },

  /**
   * 单条推文。
   * ⚠️ 判据用 tweetId 不用 handle:X 会把 `/i/status/` 重写成 `/{真作者}/status/`,
   * 判 handle 会把「已经到了」误判成「没到位」。
   */
  'x.status': (p) => {
    const id = (p.tweetId ?? '').trim();
    if (!/^\d+$/.test(id)) return null;
    const h = p.handle ? cleanHandle(p.handle) : 'i';
    return {
      url: `${X_PROFILE.baseUrl}/${h}/status/${id}`,
      arrival: byUrl(`/status/${id}`),
      describe: `推文 ${id}`,
    };
  },

  /** 搜索结果 */
  'x.search': (p) => {
    const q = (p.q ?? '').trim();
    if (!q) return null;
    const f = p.f === 'top' ? 'top' : 'live';
    return {
      url: `${X_PROFILE.baseUrl}/search?q=${encodeURIComponent(q)}&f=${f}`,
      arrival: byUrl('/search'),
      describe: `搜索「${q}」(${f})`,
    };
  },

  /**
   * ⭐ 关注者 / 关注中 / 验证关注者 —— **人的列表页**(2026-09-18 补登记)。
   *
   * 用户在 `x.com/OTun_MyVPN/verified_followers` 上点采集,面板说
   * 「认不出左边这个页面」—— 因为这三页**根本没登记**。
   *
   * ⚠️ **登记 ≠ 能采**:这几页的载荷是 `Followers`/`Following`,内容是
   * **人的列表**,而 `extractTweetsFrom` 只认带 `legacy.id_str` 的推文对象,
   * 会把这些载荷整个跳过 → 采集会诚实地报「载荷 N 个、解析 0 条」。
   *
   * ⭐ 「采人」是另一种采集类型(产出 x_author 行而非 x_tweet 行、
   * 字段不同、报告口径不同),值得单独设计 —— 先把页面认出来,解析另说。
   *
   * ⚠️ 到位判据用 `urlIncludes` 不用 `byUrlAndTweets`:
   * 这几页上**没有推文**,等 `tweet.article` 会必然超时。
   */
  'x.followers': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${X_PROFILE.baseUrl}/${h}/followers`,
      arrival: byUrl(`/${h}/followers`),
      describe: `@${h} 的关注者`,
    };
  },

  'x.verifiedFollowers': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${X_PROFILE.baseUrl}/${h}/verified_followers`,
      arrival: byUrl(`/${h}/verified_followers`),
      describe: `@${h} 的验证关注者`,
    };
  },

  'x.following': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${X_PROFILE.baseUrl}/${h}/following`,
      arrival: byUrl(`/${h}/following`),
      describe: `@${h} 关注的人`,
    };
  },

  /** 通知页 */
  'x.notifications': () => ({
    url: `${X_PROFILE.baseUrl}/notifications`,
    arrival: byUrl('/notifications'),
    describe: '通知页',
  }),

  /**
   * 发推弹窗。
   * ⭐ 用独立 URL 而不是首页顶部那个框 —— 直达 compose,不依赖首页布局。
   * 🚦 只是**去那一页**;填内容走 `web.input`,发布永远留给人点。
   */
  'x.compose': () => ({
    url: X_PROFILE.composeUrl,
    arrival: byUrl('/compose/post'),
    describe: '发推弹窗',
  }),

  /** 长文编辑器 */
  'x.composeArticles': () => {
    const url = X_PROFILE.selectors.article?.composeUrl;
    if (!url) return null;
    return { url, arrival: byUrl('/compose/articles'), describe: '长文编辑器' };
  },
};

/**
 * 生产版语义页面解释器。
 *
 * ⚠️ 未登记 / 参数不全一律返回 null —— 底座据此 Failed 并列出可用页面名。
 */
/**
 * ⭐⭐ 每个语义页面**需要哪些参数** —— 从这里推,不在别处抄清单。
 *
 * ── 用户 2026-09-18 实测踩到 ──
 *
 * 加了 followers/verifiedFollowers/following 三页之后,在那个页面点采集,
 * 报错说「未登记的页面名 x.verifiedFollowers」,而**同一句话里的可用清单
 * 里就有它** —— 自相矛盾。
 *
 * 真因:面板有**四处写死的正则** `/^x\.(profile|withReplies|articles)$/`
 * 决定「要不要显示 handle 输入框、要不要传 handle」。新页面不在里面
 * → 框不显示 → 参数不传 → resolve 拿到空 handle 返回 null。
 *
 * ⚠️ 又是「写死清单不会自己长」(同族第五刀)。
 * ⭐ 所以这里给出**真表**:面板问它要参数,加页面时只改这一处。
 */
export const PAGE_PARAMS: Readonly<Record<string, readonly string[]>> = {
  'x.profile': ['handle'],
  'x.withReplies': ['handle'],
  'x.articles': ['handle'],
  'x.followers': ['handle'],
  'x.verifiedFollowers': ['handle'],
  'x.following': ['handle'],
  'x.status': ['handle', 'tweetId'],
  'x.search': ['q', 'f'],
  'x.home': [],
  'x.notifications': [],
  'x.compose': [],
  'x.composeArticles': [],
};

/**
 * ⭐⭐ **人话页名** —— 下拉里给人看的,不是给代码看的。
 *
 * ── 用户 2026-09-20 ──
 * > 「哪个是 status?」
 *
 * `x.status` 是**代码里的语义名**,对人没有意义。人想的是
 * 「单条推文详情页」。下拉里只给代码名 = 每次都要猜、或者来问。
 *
 * ⚠️ 与 `PAGE_PARAMS` 一样,这是**真表** —— 面板从这里读,不许抄一份
 * (抄的那份不会跟着新页面长,而漏了也不报错,只表现为下拉里缺一项)。
 * ⚠️ 加新页面时这里**也要加**:守卫钉了「两张表的键必须一致」。
 *
 * ⭐ `describe` 那个字段解决不了这件事:它是 resolve **之后**才有的
 * (要先有参数才能说「@xxx 的关注者」),而下拉在**选参数之前**就要显示。
 */
export const PAGE_LABELS: Readonly<Record<string, string>> = {
  'x.profile': '某人主页(只看推文)',
  'x.withReplies': '某人主页 + 回复',
  'x.articles': '某人的长文',
  'x.followers': '某人的关注者(谁关注他)',
  'x.verifiedFollowers': '某人的蓝V关注者',
  'x.following': '某人关注的人',
  'x.status': '单条推文详情(含回复)',
  'x.search': '搜索结果',
  'x.home': '首页时间线',
  'x.notifications': '通知页',
  'x.compose': '发推弹窗',
  'x.composeArticles': '长文编辑器',
};

export class XPageResolver implements PageResolver {
  resolve(name: string, params: Readonly<Record<string, string>> = {}): Resolved | null {
    const build = PAGES[name];
    if (!build) return null;
    return build(params);
  }

  names(): string[] {
    return Object.keys(PAGES);
  }

  /**
   * ⭐⭐ **反向**:当前 URL → 语义名 + 参数。
   *
   * 用户 2026-09-18:「点击左边时,右边自动填充变量,点击采集,即可采集。」
   *
   * ⚠️ 与正向**同一张表同一处维护** —— 另写一份会漂,
   * 而漂的表现是「自动填的页面名和实际采的不是同一个」,最难查。
   * 所以这里的顺序与 `PAGES` 的定义顺序对应,加页面时两边一起改。
   *
   * ⚠️ 认不出来返回 null,**绝不猜一个** ——
   * 猜错会让人以为「自动填好了」,然后采了别的页面。
   */
  identify(url: string): { name: string; params: Record<string, string> } | null {
    let path: string;
    let search: URLSearchParams;
    try {
      const u = new URL(url);
      // ⚠️ 只认 X 自己的域,别的站点一律不认
      if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(u.hostname)) return null;
      path = u.pathname.replace(/\/$/, '');
      search = u.searchParams;
    } catch { return null; }

    if (path === '/home') return { name: 'x.home', params: {} };
    if (path === '/notifications') return { name: 'x.notifications', params: {} };
    if (path === '/compose/post') return { name: 'x.compose', params: {} };
    if (path.startsWith('/compose/articles')) return { name: 'x.composeArticles', params: {} };
    if (path === '/search') {
      const q = search.get('q') ?? '';
      return q ? { name: 'x.search', params: { q, f: search.get('f') ?? 'live' } } : null;
    }

    // /<handle>/status/<id>
    const st = path.match(/^\/([^/]+)\/status\/(\d+)$/);
    if (st) return { name: 'x.status', params: { handle: st[1], tweetId: st[2] } };

    // /<handle>/with_replies | /articles | /followers | /verified_followers | /following
    const sub = path.match(/^\/([^/]+)\/(with_replies|articles|followers|verified_followers|following)$/);
    if (sub) {
      // ⚠️ 与正向 PAGES 的键一一对应 —— 加页面时两边一起改,否则会漂
      const NAME: Record<string, string> = {
        with_replies: 'x.withReplies',
        articles: 'x.articles',
        followers: 'x.followers',
        verified_followers: 'x.verifiedFollowers',
        following: 'x.following',
      };
      return { name: NAME[sub[2]], params: { handle: sub[1] } };
    }

    /**
     * /<handle> —— 某人主页。
     * ⚠️ 必须排除 X 自己的路由(/explore /settings /i/... 等),
     * 否则会把「设置页」认成「一个叫 settings 的人的主页」,
     * 然后采集跑到那儿去 —— 而现象是「采到 0 条」,指向完全错误的方向。
     */
    const RESERVED = new Set([
      'explore', 'settings', 'messages', 'bookmarks', 'lists', 'communities',
      'jobs', 'premium', 'i', 'intent', 'search', 'home', 'notifications',
      'compose', 'login', 'logout', 'signup', 'tos', 'privacy',
    ]);
    const one = path.match(/^\/([^/]+)$/);
    if (one && !RESERVED.has(one[1].toLowerCase())) {
      return { name: 'x.profile', params: { handle: one[1] } };
    }

    return null;   // ⚠️ 认不出来就是认不出来,不猜
  }
}
