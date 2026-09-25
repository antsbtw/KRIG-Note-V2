/**
 * X 时间线智能筛选 — 搜索配方驱动的批量推文采集（Phase 1）
 *
 * 铁律遵守：
 * 1. webview 操作通过 requireXWebContents（web-service-base），不自己包 executeJavaScript
 * 3. 采集/注入失败 → throw（fail loud）
 * 4. 本 Phase 无写推文操作
 */

import { webContents } from 'electron';
import { TWEET_SCRAPE_FN_BODY } from '../tweet-fetcher/extract-script';
import { upsertTweet, insertFilteredOut, getTweetIdSet } from '../db/tweet-inbox-repo';
import { reconcileRepliedFromOwnReplies } from '../db/x-reply-relation-repo';
import { googleTranslateBatch } from './google-translate';
import type { XTweetData } from './x-extract-tweet';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import { runCollectStrategy } from './x-collect-runner';
import { keywordStrategy } from '@capabilities/x-collect';
import type {
  SearchRecipe,
  TimelineFilterConfig,
  TweetInboxRecord,
} from '@shared/types/x-timeline-types';


/** per-ws abort 标志（wsId → abort） */
const scanAbortMap = new Map<string, boolean>();

export function abortScan(wsId: string): void {
  scanAbortMap.set(wsId, true);
}

/**
 * 从上次运行时间推算搜索起点 —— **叠加 48 小时**。
 *
 * 用户 2026-09-02:「搜索完毕,就往下滚动,采用叠加方式,比上一次的最后时间
 * 多叠加 48 个小时。所有的缓存做比对,就能够获取需要的帖子了。」
 *
 * 为什么必须叠加(而不是从 lastRunAt 精确接上):
 *  · X 的搜索索引有延迟 —— 一条推可能在发布几小时后才进入 since: 的结果
 *  · 采集本身可能中断/失败,那段窗口就永久丢了
 *  · since: 只精确到**天**(X 的语法限制),边界本就模糊
 * 重叠抓回来的靠 tweet_id 去重(seenIds + INSERT IGNORE),成本只是多滚几屏,
 * 换来的是**不漏**。宁可重复,不可遗漏。
 *
 * 没有 lastRunAt(首次运行)→ 回落到 recipe.sinceHours。
 */
export function computeSinceDate(recipe: SearchRecipe, overlapHours = 48): Date {
  if (recipe.lastRunAt) {
    const last = new Date(recipe.lastRunAt).getTime();
    if (Number.isFinite(last)) {
      return new Date(last - overlapHours * 3_600_000);
    }
  }
  return new Date(Date.now() - (recipe.sinceHours ?? 24) * 3_600_000);
}

/**
 * 本轮**实际要滚多深** —— 与 since 窗口分开的两件事。
 *
 * 用户 2026-09-02:「我觉得每次扫描的执行太久了吧?」
 * 实测症结:配方每 30 分钟跑一次,却每次都滚回 48 小时前 ——
 * 48h 窗口内有 1062 条,而 30 分钟真正新增的只有 14 条,**76 倍无用功**。
 *
 * 但 48h 叠加窗口本身是对的(用户此前拍板:宁可重复不可遗漏,
 * 防的是 app 关机/采集失败导致窗口永久丢失)。两者不矛盾:
 *  · `since:` 保持宽 —— 它只是告诉 X「别给我更旧的」,不花我们时间
 *  · **滚动深度**按「距上次成功运行多久」算,正常轮次只需覆盖那一小段
 *
 * 规则(用户 2026-09-02 拍板:「就执行 12 小时以内的就可以了」):
 *  · 常规:上次运行至今 + 2 小时缓冲(X 搜索索引有延迟,新推可能晚几小时才出现)
 *  · **上限 12 小时** —— 即使关机好几天,单轮也只滚 12 小时,
 *    剩下的靠下一轮继续(每 30 分钟一轮,补齐很快),不让单次跑到失控
 *  · 首次运行没有 lastRunAt → 直接用 12 小时上限
 *
 * ⚠️ 这不影响 `since:` 的 48h 叠加窗口 —— 那个照旧宽,防的是窗口永久丢失;
 *    这里限的是**滚动深度**,即「本轮实际往回读多远」。两者是两件事。
 */
export const MAX_SCROLL_DEPTH_HOURS = 12;

export function computeScrollDepthMs(recipe: SearchRecipe, bufferHours = 2): number {
  const cap = MAX_SCROLL_DEPTH_HOURS * 3_600_000;
  if (!recipe.lastRunAt) return cap;

  const last = new Date(recipe.lastRunAt).getTime();
  if (!Number.isFinite(last)) return cap;

  const sinceLastRun = Date.now() - last + bufferHours * 3_600_000;
  return Math.min(sinceLastRun, cap);
}

/**
 * 按 SearchRecipe 拼装 X 搜索 URL。
 *
 * ⚠️ **2026-09-14 起生产路径不再走这里** —— `scanRecipe` 已改用
 * `keywordStrategy.target()`(见 `capabilities/x-collect/strategies/keyword.ts`)。
 *
 * ⭐ **但本函数必须留着**:它是那个策略的**对照基准** ——
 * 「策略拼出来的 URL 与这里逐字一致」由 `tests/x/collect-strategy-registry.test.ts`
 * 钉住。删了它,那几条实测血泪(filter:replies / since: 从 lastRunAt 推)
 * 就只剩一份实现,再没有第二份可以对照。
 */
/**
 * ⭐⭐ **把「人随手填的几个词」规范成 X 的搜索语法** —— 2026-09-23 用户实测踩到。
 *
 * ── 现象 ──
 * 面板搜索框里填 `VPN,翻墙`,采回来 94 条**全是不相干的**
 * (孙大午、「po文合集」垃圾推),一条 VPN 相关的都没有。
 *
 * ── 真因 ──
 * X 的搜索语法里**逗号不是「或」**:`VPN,翻墙` 被当成**一个短语**去匹配,
 * 几乎匹配不到东西。而 X **不报错**,只是返回一堆不相干的结果 ——
 * 于是「搜的不是你想搜的」和「这个词真没人发」长得一模一样。
 *
 * ⭐ 而配方跑的时候**一直是对的**(`buildSearchUrl` 拼的是 `("VPN" OR "翻墙")`)——
 * 手填这条路径绕开了那套语法,两边**同一件事两种写法**,这才是根子。
 *
 * ── 规则 ──
 * · 已经带 X 高级语法的(OR / from: / filter: / 括号 / 引号)→ **原样不动**
 *   ⚠️ 人想用高级语法时不能被我们改写,否则「我明明写对了它却改掉」更难查
 * · 否则按逗号/空格/顿号切成词,拼成 `("a" OR "b")`
 * · 单个词直接加引号,不套括号(干净)
 */
/**
 * ⭐⭐ **给手填的搜索加时间窗** —— 用户 2026-09-25:
 *
 * > 「查询采集,建议一次不要超过 24 小时的帖子,除非有特殊约定」
 *
 * ── 为什么需要(查证)──
 * **配方跑的时候一直有** `since:`(`buildSearchUrl` 里),而**手填这条路完全没有**
 * —— 面板/编排档搜的是**全部历史**。
 * ⭐ 与「逗号当成短语」那次同一形态:**同一件事两套实现,手填那套绕开了规则**。
 *
 * ── ⚠️ 为什么默认 2 天而不是 24 小时(用户拍板) ──
 *  · X 的 `since:` **只精确到天**(语法限制,见 computeSinceDate 的注释)——
 *    填「今天」会漏掉昨晚发的
 *  · X 的**搜索索引有延迟**,刚发的推可能几小时后才进 since: 的结果
 *  · ⭐ 配方那边甚至故意多抓 **48 小时重叠**,理由写着「**宁可重复,不可遗漏**」
 *    (重复的靠 tweet_id 去重,成本只是多滚几屏)
 *
 * ── 逃生口 ──
 * ⚠️ `days <= 0` → **不加**(要搜全部历史时用);
 * ⚠️ 查询里**自带 since:/until:** → 原样放行,不叠加
 *   (人显式写了时间条件,我们再塞一个会互相打架,而且**不报错**)
 */
export function withSinceWindow(query: string, days = 2): string {
  const q = (query ?? '').trim();
  if (!q) return q;
  /** ⭐ 人自己写了时间条件 → 他说了算 */
  if (/\bsince:|\buntil:|\bsince_time:|\buntil_time:/i.test(q)) return q;
  if (!Number.isFinite(days) || days <= 0) return q;
  const since = new Date(Date.now() - days * 86_400_000)
    .toISOString().split('T')[0];
  return `${q} since:${since}`;
}

export function normalizeSearchQuery(raw: string): string {
  const q = (raw ?? '').trim();
  if (!q) return '';
  /**
   * ⚠️ 认到任一高级语法就原样放行 —— 判据保守:
   * 宁可少规范化,也不能把人写对的查询改坏。
   */
  if (/\bOR\b|\bAND\b|from:|to:|filter:|since:|until:|lang:|["()]/.test(q)) return q;
  const words = q.split(/[,，、\s]+/).map((w) => w.trim()).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return `"${words[0]}"`;
  return `(${words.map((w) => `"${w}"`).join(' OR ')})`;
}

export function buildSearchUrl(recipe: SearchRecipe): string {
  const parts: string[] = [];

  if (recipe.keywords?.length) {
    parts.push(`(${recipe.keywords.map((k) => `"${k}"`).join(' OR ')})`);
  }

  if (recipe.fromAccounts?.length) {
    parts.push(`(${recipe.fromAccounts.map((a) => `from:${a}`).join(' OR ')})`);
  }

  if (recipe.template === 'help-wanted' && recipe.helpSignals?.length) {
    parts.push(`(${recipe.helpSignals.map((s) => `"${s}"`).join(' OR ')})`);
  }

  // ⭐ 2026-09-06 实机 spike 结论(设计 §4.4⑤(a) 要求的验证已完成):
  //      from:netlab2gfw                    共 12 条,其中回复 11
  //      from:netlab2gfw include:replies    共  0 条,其中回复  0   ← **无效**
  //      from:netlab2gfw filter:replies     共 22 条,其中回复 22   ← 有效且最全
  //
  //    `include:replies` **X 已不支持**,写上去会把结果打成 0 条 ——
  //    不报错、静默返回空,正是文档警告的那种失败形态。照文档假设就中招了。
  //    故这里用 `filter:replies`。
  //
  //    ⚠️ 另一个实测发现:裸 `from:` 本身就已经带回复(12 条里 11 条是回复),
  //    所以「只要原创推」反而需要额外过滤 —— 与直觉相反,别想当然。
  if (recipe.includeReplies) parts.push('filter:replies');

  if (recipe.minLikes) parts.push(`min_faves:${recipe.minLikes}`);
  if (recipe.minRetweets) parts.push(`min_retweets:${recipe.minRetweets}`);
  if (recipe.lang) parts.push(`lang:${recipe.lang}`);

  // ⚠️ 起点从**上次运行时间往前推 48h**,不是从「现在往前 24h」——
  // 后者与上次运行毫无关系:app 关两天,那两天的窗口就永久丢了。
  const sinceStr = computeSinceDate(recipe).toISOString().split('T')[0];
  parts.push(`since:${sinceStr}`);

  const q = encodeURIComponent(parts.join(' '));
  const f = recipe.resultType === 'top' ? 'top' : 'live';
  return `https://x.com/search?q=${q}&f=${f}`;
}

/** 本地漏斗 L1-L4 */
export function applyFilter(
  tweet: XTweetData,
  config: TimelineFilterConfig,
  seenIds: Set<string>,
): { pass: boolean; reason?: string } {
  // L1 黑名单
  if (config.keywordBlacklist.some((kw) => tweet.text?.includes(kw))) {
    return { pass: false, reason: 'keyword_blacklist' };
  }
  // ⚠️ 必须归一化后再比:库里 authorHandle 是 '@Miekko22'(带 @、保留大小写),
  // 而 accountBlacklist 按契约存的是归一化形态。少这一步 = 屏蔽恒不命中且不报错。
  if (tweet.authorHandle && config.accountBlacklist.includes(normalizeHandle(tweet.authorHandle))) {
    return { pass: false, reason: 'account_blacklist' };
  }

  // L2 语言
  if (config.allowedLangs.length && tweet.lang && !config.allowedLangs.includes(tweet.lang)) {
    return { pass: false, reason: 'lang_filter' };
  }

  // L3 互动阈值
  if ((tweet.metrics?.likes ?? 0) < config.minLikes) {
    return { pass: false, reason: 'min_likes' };
  }
  if ((tweet.metrics?.retweets ?? 0) < config.minRetweets) {
    return { pass: false, reason: 'min_retweets' };
  }

  // L4 去重
  if (!tweet.tweetId || seenIds.has(tweet.tweetId)) {
    return { pass: false, reason: 'duplicate' };
  }

  // L5 关键词兜底 —— **不能全信 X 的搜索**(2026-09-07 用户发现)。
  //    实测:最新 30 条里只有 3 条含关键词,其余既无关键词也无求助信号。
  //    此前这里完全不校验正文,等于"X 给什么就存什么" ——
  //    一旦落错页面(首页时间线)或 X 搜索放宽,整批噪音直接进库,
  //    还要占用 Gemma 的判断额度。
  //    ⚠️ 只在配方**声明了关键词**时才校验:没声明说明本来就想全量收。
  if (config.requireKeywords?.length) {
    const t = (tweet.text ?? '').toLowerCase();
    const hit = config.requireKeywords.some((k) => t.includes(k.toLowerCase()));
    if (!hit) return { pass: false, reason: 'no_keyword' };
  }

  return { pass: true };
}



/** 在 webContents 内批量提取当前可见推文（复用 TWEET_SCRAPE_FN_BODY） */
/**
 * 连续注入失败计数 —— **必须放模块级**:放函数里每次调用都归零,
 * 永远到不了阈值,那条「不是导航撞车」的提示就永远不会出现。
 * 成功一次即清零(见下方)。
 */
let injectFails = 0;

/**
 * ⚠️ 2026-09-14 改为导出:盯人采集(`x-watchlist-collect.ts`)复用同一份提取。
 *
 * ⭐ **绝不允许第二份实现** —— 这个函数里那条「连续注入失败才说不是导航撞车」
 * 的判据是踩了一整天换来的(转义被模板字面量吃掉,采集恒 0 而日志说
 * 「多半撞上导航」)。复制一份出去,那个教训就只在其中一份里。
 */
export async function extractVisibleTweets(wc: Electron.WebContents): Promise<XTweetData[]> {
  const script = `
    (function() {
      ${TWEET_SCRAPE_FN_BODY}
      try {
        var articles = document.querySelectorAll('article[data-testid="tweet"]');
        var results = [];
        for (var i = 0; i < articles.length; i++) {
          try { results.push(scrapeTweetArticle(articles[i])); } catch(e) {}
        }
        return results;
      } catch(e) {
        return [];
      }
    })()
  `;
  // 同上:滚动过程中 X 会自己跳转/重载(登录态刷新、路由切换),
  // 注入撞上导航窗口就被拒。**单轮**抽取失败不该让整轮采集崩掉 ——
  // 返回空数组让外层继续滚,真的一直抽不到,靠「滚不动 3 轮」正常收尾。
  // ⚠️ 这里的 catch 曾把一个真 bug 盖了一整天(2026-09-07):
  //    提取脚本里一个转义写错导致**每次**注入都抛,
  //    而日志只说「多半撞上导航」—— 一句猜测被当成了结论,
  //    于是采集连续一天报「0 条」却没人知道真因。
  //    现在**记连续失败次数**:偶发确实多半是导航;
  //    但连着失败就不是导航了,必须换一句话说。
  const raw = await wc.executeJavaScript(script).catch((err: unknown) => {
    injectFails += 1;
    console.warn(
      injectFails >= 3
        ? '[x-timeline-scan] ❗ extractVisibleTweets 连续注入失败 —— '
          + '这**不是导航撞车**,多半是提取脚本本身报错'
          + '(先在 X 页面控制台试一下那段脚本):'
        : '[x-timeline-scan] extractVisibleTweets 注入失败(可能撞上导航),本轮跳过:',
      err);
    return [];
  });
  if (!Array.isArray(raw)) {
    throw new Error('[x-timeline-scan] extractVisibleTweets returned non-array');
  }
  injectFails = 0;   // 成功即清零 —— 偶发导航撞车不该累积成误报
  return raw as XTweetData[];
}

export interface ScanResult {
  /** 屏幕上滚过、被提取到的推文总数 */
  fetched: number;
  /** 真正新入库的 */
  saved: number;
  /** 被规则过滤掉的(关键词黑名单/语言/点赞数不够等) */
  filteredOut: number;
  /**
   * 早就采过、这次跳过的。
   * ⭐ 必须与 saved 分开报(用户 2026-09-07):只说「采集 0 条」会让人
   * 以为不工作,而实际常常是**扫到的都是旧的** —— 那是正常且预期的。
   */
  duplicates: number;
  /** 反向对账补标「已回复」的条数 */
  reconciled: number;
  elapsedMs: number;
  /** 搜索窗口起点(since:YYYY-MM-DD) */
  sinceDate: string;
}

/**
 * 执行一次完整的搜索配方采集。
 *
 * @param recipe          搜索配方
 * @param wsId            workspace id（per-ws abort 定向）
 * @param targetWcId      X Host guest webContents id（per-ws 定向，fail loud 不回退全局）
 * @param filterConfig    漏斗配置
 * @param onPendingReady  每批写库后通知，供调度器决定是否触发 AI 判断
 * @param maxScrollRounds 轮次**安全阀**(默认 200)。正常情况靠「滚过 since 窗口」
 *                        或「真的滚不动」结束 —— 不是靠这个数停。
 */
export async function scanRecipe(
  recipe: SearchRecipe,
  wsId: string,
  targetWcId: number,
  filterConfig: TimelineFilterConfig,
  onPendingReady?: (pendingCount: number) => void,
  maxScrollRounds = 200,
): Promise<ScanResult> {
  scanAbortMap.set(wsId, false);

  const wc = webContents.fromId(targetWcId);
  if (!wc || wc.isDestroyed()) {
    throw new Error(`[x-timeline-scan] webContents ${targetWcId} not found or destroyed`);
  }

  // ⭐⭐ 导航 / 等到位 / 落地校验 / 滚动判停 **全部交给执行器**
  //     (`x-collect-runner.ts` + `keywordStrategy` 的三个答案)。
  //     本函数从此只管「抓到的推怎么过滤、怎么入库」—— 见下面的 onRound。
  //
  //  ⚠️ 那三段被搬走的逻辑一条没少,都在执行器里(含各自的血泪注释):
  //   · loadURL 要 await,但 reject 不算失败(X 常自行接管导航)
  //   · waitArrived 超时才是真失败 → throw,fail loud
  //   · 落地校验(URL 必须含 /search)—— 2026-09-07 「把首页时间线当搜索结果」那次
  //   · 滚动:同步 scrollBy + 滚动后回读;scrollY 连续 3 轮不变才算到底

  // 预加载去重窗口内已有的 tweet_id
  // 去重集合来自 x_tweet 全表(含 expires_at=NONE 的永久行) —— 采纳过的推文
  // 不会因为过期而"消失"再被重新抓回来(A 期修掉的重复爬根因)。
  const seenIds = await getTweetIdSet();

  let fetched = 0;
  let saved = 0;
  let filteredOut = 0;
  // ⭐ 单独数「早就采过的」——用户 2026-09-07 指出:只报 saved=0 会让人
  //    以为「不工作」,而实际常常是**扫到的都是旧的**。两者必须分开报,
  //    否则「正常但没新货」和「真的没扫到」长得一模一样。
  let duplicates = 0;
  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  // ⚠️ **不再设 TTL**(用户 2026-09-02 拍板:「永久保存吧,等容量到了一定的程度,
  // 再考虑迁移新的架构」)。
  //
  // 原来设 7 天过期,前提是「没被采纳的推没价值」—— 这个前提已被推翻:
  //   「有些不显示的帖子不见得没有用途,可以用于分析竞争对手。」
  // 被 Gemma 判 skip / 被黑名单过滤掉的推,正是竞品分析与语料的素材,
  // 删掉不可再生(A 期就因 TTL 丢过 449 条已采纳正文,教训在前)。
  //
  // undefined → NONE(SurrealDB 的 option 语义),cleanExpired 会跳过这些行。
  const expiresAt = undefined;

  // ⚠️ 两个不同的量,别混:
  //  · sinceMs   = 搜索 URL 里的 since: 起点(宽,48h 叠加,防遗漏)
  //  · scrollToMs = 本轮**实际滚到哪**(窄,只覆盖距上次运行那一段)
  // 30 分钟一轮却每次滚 48 小时 = 76 倍无用功(实测 1062 条里只有 14 条是新的)。
  const sinceMs = computeSinceDate(recipe).getTime();
  const scrollToMs = Date.now() - computeScrollDepthMs(recipe);
  console.log(`[x-timeline-scan] since=${new Date(sinceMs).toISOString().slice(0, 10)} `
    + `滚动深度=${Math.round(computeScrollDepthMs(recipe) / 3_600_000)}h`);
  /**
   * ⭐⭐ recipe → 策略参数。
   *
   * ⚠️ **签名不变,调用方零改动** —— 两个调用方(调度器 / X_RUN_RECIPE handler)
   * 传的仍是 `SearchRecipe`,映射在这里做。这样本步的风险面只有一个文件,
   * `tests/x` 的既有守卫可以直接当回归网用。
   *
   * ⚠️ `scrollDepthHours` 不从这里传 —— 本函数已有算好的 `scrollToMs`
   * (`computeScrollDepthMs`,含 lastRunAt/bufferHours/12h 封顶的全部口径),
   * 直接喂给 `olderThan`,免得同一个量算两遍、两处漂移。
   */
  const strategyParams = {
    keywords: recipe.keywords,
    fromAccounts: recipe.fromAccounts,
    helpSignals: recipe.template === 'help-wanted' ? recipe.helpSignals : undefined,
    lang: recipe.lang,
    minLikes: recipe.minLikes,
    minRetweets: recipe.minRetweets,
    includeReplies: recipe.includeReplies,
    resultType: recipe.resultType,
    lastRunAt: recipe.lastRunAt,
    sinceHours: recipe.sinceHours,
  };

  await runCollectStrategy(
    keywordStrategy,
    strategyParams,
    wc,
    {
      // ── 抓(甲案:边滚边抓,虚拟列表滚过就删 DOM,滚完再抓必然丢)──
      capture: () => extractVisibleTweets(wc),

      /**
       * ⭐ 判停用的时间 —— `olderThan` 要拿它跟 `beforeTs` 比。
       *
       * ⚠️ 取不到返回 null(执行器会忽略这条),**不返回 0** ——
       * 0 会被当成 1970 年,立刻判「已滚过深度」,整轮采集一屏就收工。
       */
      timeOf: (item) => {
        const t = (item as XTweetData).createdAt;
        if (!t) return null;
        const ms = new Date(t).getTime();
        return Number.isFinite(ms) ? ms : null;
      },

      isAborted: () => scanAbortMap.get(wsId) === true,
      maxRounds: maxScrollRounds,

      // ── 每轮:过滤 → 翻译 → 入库(原样,一行没动)──
      onRound: async ({ items }) => {
        // ⚠️ 契约的必然代价:执行器不认识推文,回来的是 unknown[]。
        //    这里转回去 —— 形状不对就 throw,绝不默默当空数组
        //    (那会让「提取脚本坏了」表现为「今天没采到」)。
        const tweets = items as XTweetData[];
        fetched += tweets.length;

        const pendingBatch: TweetInboxRecord[] = [];

        for (const tweet of tweets) {
          const { pass, reason } = applyFilter(tweet, filterConfig, seenIds);

          if (!pass) {
            if (reason === 'duplicate') duplicates += 1;
            // filtered_out 也写库（供 V4 统计分布），但 tweetId 缺失的静默跳过（无法去重）
            if (tweet.tweetId && reason !== 'duplicate') {
              await insertFilteredOut({
                tweet_id: tweet.tweetId,
                text: tweet.text ?? '',
                author_name: tweet.authorName ?? '',
                // ⚠️ 存归一化形态(migration 1.0.2 统一):不归一化则同一人被算成两个
                author_handle: normalizeHandle(tweet.authorHandle ?? ''),
                author_avatar: tweet.authorAvatar,
                tweet_url: tweet.tweetUrl,
                lang: tweet.lang,
                metrics: tweet.metrics ?? {},
                fetched_at: nowIso,
                created_at: tweet.createdAt || undefined,
                in_reply_to: tweet.inReplyTo || undefined,
                // 被回复者 handle —— ① 判断「这楼和 VPN 有没有关系」的入口
                in_reply_to_user: tweet.inReplyToUser || undefined,
                expires_at: expiresAt,
                source: 'search',
                search_recipe: recipe.id,
                filter_reason: reason ?? 'unknown',
                replied_at: undefined,
                reply_draft: undefined,
              });
              seenIds.add(tweet.tweetId);
              filteredOut++;
            }
            continue;
          }

          seenIds.add(tweet.tweetId!);
          const record: TweetInboxRecord = {
            tweet_id: tweet.tweetId!,
            text: tweet.text ?? '',
            author_name: tweet.authorName ?? '',
            // ⚠️ 同上:存归一化形态,与 x_author.handle / normalizeHandle 一致
            author_handle: normalizeHandle(tweet.authorHandle ?? ''),
            author_avatar: tweet.authorAvatar,
            tweet_url: tweet.tweetUrl,
            lang: tweet.lang,
            metrics: tweet.metrics ?? {},
            fetched_at: nowIso,
            // A':extract-script 早就提取了这两个字段(:75 / :147),此前组装记录时漏带 —— 只是接线
            created_at: tweet.createdAt || undefined,
            in_reply_to: tweet.inReplyTo || undefined,
            in_reply_to_user: tweet.inReplyToUser || undefined,
            expires_at: expiresAt,
            source: 'search',
            search_recipe: recipe.id,
            ws_id: wsId,
            filter_score: 1.0,
            status: 'pending',
          };
          pendingBatch.push(record);
        }

            // 对非中文推文批量翻译（Google 翻译，失败条目静默跳过，不阻断采集）
            const toTranslate = pendingBatch
              .filter((r) => r.lang && r.lang !== 'zh')
              .map((r) => ({ tweetId: r.tweet_id, text: r.text }));
            if (toTranslate.length > 0) {
              const translations = await googleTranslateBatch(toTranslate);
              for (const r of pendingBatch) {
                const t = translations.get(r.tweet_id);
                if (t) r.translation = t;
              }
            }

            // 批量写库
            for (const r of pendingBatch) {
              await upsertTweet(r);
              saved++;
            }

            if (pendingBatch.length > 0) {
              onPendingReady?.(saved);
            }
      },

      /**
       * ⭐⭐ 什么时候停 —— **覆盖策略的默认答案**。
       *
       * `keywordStrategy.stop()` 会自己按 lastRunAt/12h 封顶算一个 `beforeTs`,
       * 但本函数已经有算好的 `scrollToMs`(`computeScrollDepthMs`,同一套口径)。
       * 用现成的,免得同一个量算两遍、日后两处漂移。
       *
       * ⚠️ 这不是「策略白写了」:策略给的是**默认值**,调用方有更准的上下文时
       * 可以覆盖 —— 与 `web.page` 的「停止条件由调用方传」同源。
       *
       * ⚠️⚠️ 三条停法在这里汇合,一条都不许丢:
       *  ① 已滚过本轮深度 → `olderThan`(这里)
       *  ② 真的滚不动(scrollY 连续 3 轮不变)→ 执行器内建
       *  ③ `maxRounds` 安全阀 → 上面传的 maxScrollRounds
       * ⚠️ 「本轮没有新推文」**不作为**停止条件 —— 时间线里夹着已见过的很正常,
       *    急着停正是漏数据的元凶(reply 采集上栽过,验证页量出漏 83%)。
       */
      stopOverride: { kind: 'olderThan', beforeTs: scrollToMs },
    },
  );

  // ⭐ 反向对账:本轮新采到的线索里,有些我**早就回复过**了。
  // 回填此前只有单向(采到我的回复 → 标记它的父推),顺序反过来就漏:
  // 我 12:08 回的推,那条线索 23:38 才被搜索采到 —— 它带着 replied=false
  // 进「待判」,于是我明明回过的人又出现在待处理列表里(用户 2026-09-02 发现)。
  let reconciled = 0;
  try {
    reconciled = await reconcileRepliedFromOwnReplies();
  } catch (err) {
    // 对账失败不该让整轮采集算失败,但必须留痕 —— 静默会让重复回复悄悄回来
    console.error('[x-timeline-scan] 反向对账失败(采集本身已完成):', err);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[x-timeline-scan] recipe="${recipe.name}" fetched=${fetched} saved=${saved} `
    + `dup=${duplicates} filteredOut=${filteredOut} 补标已回复=${reconciled} ${(elapsedMs / 1000).toFixed(0)}s`,
  );
  return {
    fetched, saved, filteredOut, duplicates, reconciled, elapsedMs,
    // 搜索窗口起点(since:YYYY-MM-DD)—— 让用户知道扫的是哪段时间
    sinceDate: computeSinceDate(recipe).toISOString().split('T')[0],
  };
}
