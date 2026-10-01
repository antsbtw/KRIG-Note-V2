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
    const id = (p.tweetId ?? '').trim();
    if (!id) return null;
    return {
      url: `${BASE_URL}/i/status/${id}`,
      arrival: byUrlAndTweets(`/status/${id}`),
      describe: `推文 ${id}`,
    };
  },
};

/**
 * ⭐ 反向:当前 URL → 语义名 + 参数。认不出来返回 null。
 *
 * ⚠️ **必须与正向同一张表的知识** —— 另写一份会漂,
 * 而漂的表现是「自动填的和实际采的不是同一页」。
 */
function identify(url: string): { name: string; params: Record<string, string> } | null {
  let path: string;
  try {
    const u = new URL(url);
    if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(u.hostname)) return null;
    path = u.pathname;
  } catch {
    return null;   // ⚠️ 不是合法 URL —— 如实说不认识,不猜
  }

  if (path === '/home') return { name: 'x.home', params: {} };

  const status = path.match(/^\/(?:i|[^/]+)\/status\/(\d+)/);
  if (status) return { name: 'x.status', params: { tweetId: status[1] } };

  const withReplies = path.match(/^\/([^/]+)\/with_replies\/?$/);
  if (withReplies) return { name: 'x.withReplies', params: { handle: withReplies[1] } };

  const profile = path.match(/^\/([^/]+)\/?$/);
  if (profile && !['home', 'explore', 'notifications', 'messages', 'i'].includes(profile[1])) {
    return { name: 'x.profile', params: { handle: profile[1] } };
  }
  return null;
}

/** ⭐ 本模块的页面表 —— 启动时 **push** 给底座,底座不认识 X */
export const xPageResolver: PageResolver = {
  resolve: (name, params) => PAGES[name]?.(params ?? {}) ?? null,
  names: () => Object.keys(PAGES),
  identify,
};
