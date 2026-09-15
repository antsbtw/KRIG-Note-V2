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

import type { PageResolver, ReadyCriterion } from '../web-capability/page/control-types';
import { X_SERVICE_PROFILES } from '@shared/types/x-service-types';

const X_PROFILE = X_SERVICE_PROFILES[0];

/** 归一化 handle(去 @、小写)—— 与 `normalizeHandle` 同口径 */
function cleanHandle(h: string): string {
  return h.trim().replace(/^@+/, '').toLowerCase();
}

/** URL 片段判据 —— X 的页面绝大多数靠 URL 认 */
const byUrl = (fragment: string): ReadyCriterion => ({ kind: 'urlIncludes', fragment });

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
    return { url: `${X_PROFILE.baseUrl}/${h}`, arrival: byUrl(`/${h}`), describe: `@${h} 主页` };
  },

  /** 某人的推文与回复 —— ⚠️ 判据带 handle,否则别人的 with_replies 也算到位 */
  'x.withReplies': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${X_PROFILE.baseUrl}/${h}/with_replies`,
      arrival: byUrl(`/${h}/with_replies`),
      describe: `@${h} 的推文与回复`,
    };
  },

  /** 某人的文章列表 */
  'x.articles': (p) => {
    const h = cleanHandle(p.handle ?? '');
    if (!h) return null;
    return {
      url: `${X_PROFILE.baseUrl}/${h}/articles`,
      arrival: byUrl(`/${h}/articles`),
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
export class XPageResolver implements PageResolver {
  resolve(name: string, params: Readonly<Record<string, string>> = {}): Resolved | null {
    const build = PAGES[name];
    if (!build) return null;
    return build(params);
  }

  names(): string[] {
    return Object.keys(PAGES);
  }
}
