/**
 * ⭐⭐⭐ **这条推要不要再取一次、取到哪一层** —— 研判层
 *
 * ── 用户 2026-10-03 定的逻辑(原话)──
 * 「先 tweetid,然后**研判**这个推文是需要 showall 还是需要点击进入 article,
 * 　最后**根据业务的要求**来执行是否要获取全部内容。这才是正确的逻辑。
 * 　是否需要逐层获取,**根据采集的要求定下来**就可以了。」
 *
 * ⭐⭐ 这一层的铁律:**只研判,不执行**。
 * 它不碰页面、不发请求、不知道什么是 CDP —— 吃一条已采到的推文,
 * 吐「它缺什么、补它要走哪条路」。执行与否由 `decideFetch` 按**采集要求**定。
 *
 * ── 为什么要拆出来 ──
 * 此前这件事缠在 `TweetAudit.incomplete` 里:那个字段既是「报告该标什么」
 * 又被当成「接下来要做什么」。两件事缠在一起的后果是
 * **「缺就补」被写死进了代码** —— 而补不补、补到哪层,本该是采集要求说了算
 * (有的采集只要标题和互动数,进 38 篇详情页纯属浪费)。
 *
 * ⚠️ 本层**没有** fallback:判不出来就说判不出来(`feedback-fail-loud-no-fallback`)。
 */

import type { TweetAudit } from './x-timeline-audit';

/**
 * ⭐ 一条推的**内容层级** —— 它现在处在哪一层。
 *
 * ⚠️ 这是**事实不是意图**:描述「手上这份有多全」,不说「要不要去补」。
 */
export type ContentLevel =
  /** ⭐ 已经是全的 —— 载荷给的就是完整正文 */
  | 'complete'
  /** ⚠️ 正文被折叠(Show more)—— 全文在页面上,展开就有 */
  | 'collapsed'
  /** ⚠️⚠️ 长文,手上只有标题/摘要 —— 正文只在单篇页 */
  | 'article-stub'
  /** ⚠️ 长文且正文已到手(进过单篇页) */
  | 'article-full';

/**
 * ⭐ 要补全它得走哪条路 —— ⚠️ **路径不是命令**,走不走由上层定。
 */
export type FetchRoute =
  /** 什么都不用做 */
  | { readonly kind: 'none' }
  /**
   * ⭐ 在**当前页**展开 —— 代价最小,不离开页面。
   * (对应已有的 `X_SCRIPTS.expandAll`)
   */
  | { readonly kind: 'expand-in-place' }
  /**
   * ⚠️ 要**进单篇页**才拿得到 —— 代价最大:离开当前页。
   * ⭐ `url` 来自载荷(`entities.urls[].expanded_url`),**推不出来**。
   */
  | { readonly kind: 'open-article'; readonly url: string };

/** ⭐ 研判结果 —— 连**理由**一起给,报告要印得出来 */
export type TweetNeed = {
  readonly id: string;
  readonly level: ContentLevel;
  readonly route: FetchRoute;
  /** ⭐⭐ 一句话理由 —— 不管判成什么都写(成功路径也要留痕) */
  readonly why: string;
};

/**
 * ⭐⭐⭐ **研判一条推** —— 纯函数,不执行任何动作。
 *
 * ⚠️ 判据顺序有讲究:长文先判。一条推可以**既是长文又带省略号**,
 * 那种情况下展开当前页**也拿不到正文**(正文压根不在这一页)。
 */
export function judgeTweet(t: TweetAudit): TweetNeed {
  // ① 长文:正文在不在手上
  if (t.isArticle) {
    if (t.incomplete !== 'article-no-body') {
      return {
        id: t.id, level: 'article-full', route: { kind: 'none' },
        why: '长文,正文已到手',
      };
    }
    if (t.articleUrl !== undefined) {
      return {
        id: t.id, level: 'article-stub', route: { kind: 'open-article', url: t.articleUrl },
        why: `长文只有标题/摘要 —— 正文在单篇页 ${t.articleUrl}`,
      };
    }
    /**
     * ⚠️⚠️ 长文却**没有地址** —— 这条补不了,如实说。
     * 不许退化成 `expand-in-place`:在列表页展开拿不到长文正文,
     * 那只会「跑了一趟、看着做了事、正文还是没有」。
     */
    return {
      id: t.id, level: 'article-stub', route: { kind: 'none' },
      why: '长文但载荷没给单篇页地址 —— **补不了**(不是不用补)',
    };
  }

  // ② 普通推:正文被折叠
  if (t.incomplete === 'text-truncated') {
    return {
      id: t.id, level: 'collapsed', route: { kind: 'expand-in-place' },
      why: '正文被折叠 —— 当前页展开即可,不用离开页面',
    };
  }

  return { id: t.id, level: 'complete', route: { kind: 'none' }, why: '正文已完整' };
}

/**
 * ⭐⭐⭐ **采集要求** —— 「要不要补、补到哪层」由它定,不由代码定。
 *
 * 用户 2026-10-03:「根据业务的要求来执行是否要获取全部内容」
 * 「是否需要逐层获取,根据采集的要求定下来就可以了」。
 */
export type FetchDepth =
  /** ⭐ 只要列表页给的 —— 最快,不做任何补全(有的采集只要互动数) */
  | 'as-is'
  /** ⭐ 补到**不离开页面**为止 —— 展开折叠,但不进单篇页 */
  | 'expand-only'
  /** ⚠️ 补全 —— 包括逐篇进单篇页(最慢,38 篇就是 38 次导航) */
  | 'full';

/** ⭐ 一层比一层深 —— 判「这条路够不够得着」用它,不写一串 if */
const DEPTH_ALLOWS: Readonly<Record<FetchDepth, readonly FetchRoute['kind'][]>> = {
  'as-is': [],
  'expand-only': ['expand-in-place'],
  full: ['expand-in-place', 'open-article'],
};

/**
 * ⭐⭐ 按采集要求**筛**出真正要做的事。
 *
 * ⚠️ 被深度挡下来的**不是「不缺」** —— 它们照样是缺的,只是这次不补。
 * 两者必须分得开,否则报告会说成「全都齐了」
 * (`project-x-article-body-lost`:不量的字段永远 100%)。
 */
export function decideFetch(
  needs: readonly TweetNeed[],
  depth: FetchDepth,
): {
  /** 这次要执行的 */
  readonly todo: readonly TweetNeed[];
  /** ⚠️ 缺,但**本次深度不做**的 —— 要如实报出来 */
  readonly skipped: readonly TweetNeed[];
  /** ⚠️⚠️ 缺,而且**根本补不了**的(如长文没地址) */
  readonly impossible: readonly TweetNeed[];
} {
  const allowed = DEPTH_ALLOWS[depth];
  const todo: TweetNeed[] = [];
  const skipped: TweetNeed[] = [];
  const impossible: TweetNeed[] = [];

  for (const n of needs) {
    if (n.route.kind === 'none') {
      /** ⭐ `none` 有两种:本来就全的、和**补不了**的 —— 不许混为一谈 */
      if (n.level !== 'complete' && n.level !== 'article-full') impossible.push(n);
      continue;
    }
    if (allowed.includes(n.route.kind)) todo.push(n);
    else skipped.push(n);
  }
  return { todo, skipped, impossible };
}
