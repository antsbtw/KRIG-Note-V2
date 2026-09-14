/**
 * 策略:关键词搜索(`agent/Module5-02-x-pipeline.md` §1.4)
 *
 * ⭐ 注册表的第一个成员,也是**唯一在定时跑**的那一种。
 *
 * ⚠️⚠️ **URL 拼装必须与 `x-timeline-scan.ts:buildSearchUrl` 逐字一致** ——
 * 那里每一条都是实测换来的,凭印象重写必然丢:
 *
 * | 实测结论 | 代价 |
 * |---|---|
 * | 用 `filter:replies`,**不是** `include:replies` | 后者 X 已不支持,**静默返回 0 条不报错** |
 * | 裸 `from:` 本身就带回复(12 条里 11 条) | 「只要原创」反需额外过滤,与直觉相反 |
 * | `since:` 从**上次运行往前推**,不是「现在往前 24h」 | 后者在 app 关两天后,那两天永久丢失 |
 *
 * ⭐ 本文件**没有一行导航/滚动代码** —— 只回答三个问题。
 */

import type {
  CollectArrival,
  CollectParams,
  CollectStop,
  CollectStrategy,
  CollectTarget,
} from '@shared/types/x-collect-strategy';

/**
 * ⚠️⚠️ **两个不同的量,初稿把它们混成了一个 48 —— 那是 bug,已改**
 * (与 `x-timeline-scan.ts:353-357` 的注释同源)。
 *
 * | 量 | 值 | 管什么 |
 * |---|---|---|
 * | `SEARCH_OVERLAP_HOURS` | **48** | 搜索 URL 里的 `since:` 起点 —— **宽**,叠加防遗漏 |
 * | `MAX_SCROLL_DEPTH_HOURS` | **12** | 本轮**实际滚到哪** —— **窄**,只覆盖距上次运行那一段 |
 *
 * ⭐ 混用的代价(实测账):30 分钟一轮却每次滚 48 小时 = **76 倍无用功**
 * (1062 条里只有 14 条是新的)。
 */
const SEARCH_OVERLAP_HOURS = 48;
const MAX_SCROLL_DEPTH_HOURS = 12;

function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
}

function lastRunMs(params: CollectParams): number | null {
  const s = typeof params.lastRunAt === 'string' ? params.lastRunAt : undefined;
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * ⭐ 搜索窗口起点(`since:`)—— **宽**,上次运行往前叠 48h。
 *
 * ⚠️ 与 `x-timeline-scan.ts:computeSinceDate` 同一口径:
 * 「现在往前 24h」与上次运行毫无关系,app 关两天那两天就永久丢了。
 *
 * ⚠️ 用 `SEARCH_OVERLAP_HOURS`(48),**不是** `MAX_SCROLL_DEPTH_HOURS`(12)。
 */
function computeSince(params: CollectParams): string {
  const last = lastRunMs(params);
  if (last !== null) {
    return new Date(last - SEARCH_OVERLAP_HOURS * 3_600_000).toISOString().split('T')[0];
  }
  const sinceHours = typeof params.sinceHours === 'number' ? params.sinceHours : 24;
  return new Date(Date.now() - sinceHours * 3_600_000).toISOString().split('T')[0];
}

/**
 * ⭐⭐ 本轮**实际滚到哪** —— **窄**,封顶 12h(`computeScrollDepthMs` 同源)。
 *
 * 返回的是「滚到这个时间点就收工」的绝对时刻,喂给 `CollectStop.olderThan`。
 */
function computeScrollFloorTs(params: CollectParams): number {
  const capHours = typeof params.scrollDepthHours === 'number'
    ? params.scrollDepthHours
    : MAX_SCROLL_DEPTH_HOURS;
  const cap = capHours * 3_600_000;
  const last = lastRunMs(params);
  if (last === null) return Date.now() - cap;

  const bufferHours = typeof params.bufferHours === 'number' ? params.bufferHours : 2;
  const sinceLastRun = Date.now() - last + bufferHours * 3_600_000;
  return Date.now() - Math.min(sinceLastRun, cap);
}

export const keywordStrategy: CollectStrategy = {
  id: 'keyword',
  name: '关键词搜索',
  description:
    '按关键词 / 账号 / 求助信号词拼 X 搜索串,抓搜索结果页。' +
    '目前唯一在定时跑的策略 —— VPN求助中英、回国需求中英四条配方都走它。',

  paramsSchema: [
    {
      key: 'keywords',
      label: '关键词',
      kind: 'stringList',
      help: 'OR 关系。⚠️ 泛词噪音极高 —— 实测 blocked 精确率仅 4%、censorship 0%,改词组后噪音降 83%',
    },
    {
      key: 'fromAccounts',
      label: '限定账号',
      kind: 'stringList',
      help: 'from:xxx,OR 关系。⚠️ 裸 from: 本身就带回复(实测 12 条里 11 条是回复)',
    },
    {
      key: 'helpSignals',
      label: '求助信号词',
      kind: 'stringList',
      help: '如「求助」「怎么」「有没有」。与关键词是 AND 关系,用来把「在讨论」和「在求助」分开',
    },
    {
      key: 'lang', label: '语言', kind: 'enum',
      options: [
        { value: '', label: '不限' },
        { value: 'zh', label: '中文' },
        { value: 'en', label: '英文' },
      ],
      defaultValue: '',
    },
    { key: 'minLikes', label: '最少点赞', kind: 'number', min: 0, defaultValue: 0 },
    { key: 'minRetweets', label: '最少转发', kind: 'number', min: 0, defaultValue: 0 },
    {
      key: 'includeReplies', label: '连回复一起抓', kind: 'boolean', defaultValue: false,
      help: '✅ 实测用 filter:replies(22/22 全回复)。⚠️ include:replies 已失效且静默返回 0 条',
    },
    {
      key: 'resultType', label: '排序', kind: 'enum',
      options: [
        { value: 'latest', label: '最新' },
        { value: 'top', label: '热门' },
      ],
      defaultValue: 'latest',
    },
    {
      key: 'lastRunAt', label: '上次运行时间', kind: 'string',
      help: '⭐ 搜索窗口起点从这里往前推(不是「现在往前 24h」)—— app 关两天,那两天不会丢',
    },
    {
      key: 'sinceHours', label: '首次运行回溯(小时)', kind: 'number', min: 1, max: 168,
      defaultValue: 24,
      help: '只在从没跑过(没有上次运行时间)时生效',
    },
    {
      key: 'bufferHours', label: '回溯缓冲(小时)', kind: 'number', min: 0, max: 48, defaultValue: 2,
      help: '在上次运行时间基础上再往前一点,防止边界漏采',
    },
    {
      key: 'scrollDepthHours', label: '本轮滚动深度(小时)', kind: 'number', min: 1, max: 48,
      defaultValue: MAX_SCROLL_DEPTH_HOURS,
      help:
        '⚠️ 与「搜索窗口」是两个量:窗口宽(48h 叠加防遗漏),滚动深度窄(只覆盖距上次运行那段)。' +
        '混用的代价实测过:30 分钟一轮却每次滚 48 小时 = 76 倍无用功(1062 条里只有 14 条是新的)',
    },
  ],

  /** ① 去哪 —— 与 buildSearchUrl 逐字一致 */
  target(params: CollectParams): CollectTarget {
    const parts: string[] = [];

    const keywords = asList(params.keywords);
    if (keywords.length) parts.push(`(${keywords.map((k) => `"${k}"`).join(' OR ')})`);

    const from = asList(params.fromAccounts);
    if (from.length) parts.push(`(${from.map((a) => `from:${a}`).join(' OR ')})`);

    const signals = asList(params.helpSignals);
    if (signals.length) parts.push(`(${signals.map((s) => `"${s}"`).join(' OR ')})`);

    // ⭐ 实测:必须是 filter:replies —— include:replies X 已不支持且静默返 0 条
    if (params.includeReplies === true) parts.push('filter:replies');

    if (typeof params.minLikes === 'number' && params.minLikes > 0) {
      parts.push(`min_faves:${params.minLikes}`);
    }
    if (typeof params.minRetweets === 'number' && params.minRetweets > 0) {
      parts.push(`min_retweets:${params.minRetweets}`);
    }
    if (typeof params.lang === 'string' && params.lang) parts.push(`lang:${params.lang}`);

    parts.push(`since:${computeSince(params)}`);

    const q = encodeURIComponent(parts.join(' '));
    const f = params.resultType === 'top' ? 'top' : 'live';
    return {
      url: `https://x.com/search?q=${q}&f=${f}`,
      describe: `关键词搜索:${keywords.slice(0, 3).join(' / ') || '(无关键词)'}`,
    };
  },

  /**
   * ② 怎样算到位。
   *
   * ⚠️ `urlIncludes: '/search'` **不是可有可无的** —— 用户 2026-09-07 实测:
   * 采回来的推大多既不含关键词也不含求助信号,真因是**落在首页时间线上**,
   * 而「页面上有推文」这个判据对此完全无感。
   */
  arrived(): CollectArrival {
    return { urlIncludes: '/search', awaitSelector: 'article[data-testid="tweet"]' };
  },

  /**
   * ③ 什么时候停 —— ⭐⭐ **滚过本轮深度就收工**,不是滚到底。
   *
   * ⚠️ 初稿写的是 `atBottom`,**那是 bug**:搜索窗口叠了 48h 防遗漏,
   * 若每轮都滚到窗口尽头,30 分钟一轮 = **76 倍无用功**
   * (实测账:1062 条里只有 14 条是新的,`x-timeline-scan.ts:452`)。
   *
   * ⭐ 「真到底」仍然是兜底 —— 底座的 `atBottom`(scrollY 连续多轮不变)
   * 与轮次安全阀由**执行侧**保证,策略只声明「我要的那段到哪为止」。
   */
  stop(params: CollectParams): CollectStop {
    return { kind: 'olderThan', beforeTs: computeScrollFloorTs(params) };
  },
};
