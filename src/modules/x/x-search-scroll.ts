/**
 * ⭐⭐⭐ 搜索采集:**让页面自己翻页,我们只截获**(2026-10-16)—— 主进程
 *
 * 用户 10-16:「为了采集,我们工作将近一个月…应该找一个可靠的方法,把页面数据完成的采集下来。」
 * 社区(twikit / twifork / browser-agent PR#7#8,10-16 查):X 搜索要求每次请求带页面**现场生成**的
 * x-client-transaction-id,**重放请求会 404**;最可靠的是让页面自己的脚本翻页(它自己填 bottom 游标、
 * queryId、交易号),我们只截获返回。
 * ⚠️ 推翻 10-03 的「搜索页滚动不翻页」:10-16 诊断(apiSeen)看到滚动时浏览器发了 49 次 SearchTimeline 200,
 * 当年「只收到 1 次」多半是采集去重只看前 256 字吞掉的(那个毛病 10-02 起就在)—— 待本函数真机核实。
 *
 * 每截获一页 SearchTimeline 就过一遍逐页账(清点 X 列的 → 逐条核对解出 → 存库并按 id 回读 → 判方向)。
 * ⚠️ 碰到 429 就停,不重试(异常即停);页数上限由调用方给,保证 15 分钟内远低于 ~50 次。
 */
import { webviewPorts } from './x-collect-ports';
import { X_NOISY_URLS, X_PAGE_MATCHERS, X_PAGE_NAME, carriesTweets } from './x-pages';
import { X_SCRIPTS } from './x-dom-scripts';
import { getXHostBusy, getXHostState, setXHostBusy } from './x-host-registry';
import { bgRunningOn } from './x-bg-runner';
import { auditTimelinePayload, type TweetRecord } from './x-timeline-audit';
import { ledgerFor, pageTimes, type RunHarvest } from './x-collect-run';
import { pageProblem, type PageLedgerRow } from './x-page-ledger';
import { saveTweets, existingTweetIds } from './x-tweet-repo';
import { saveTweetAuthors } from './x-user-repo';
import { accountForWrite } from './x-account-repo';
import { summarizeBatch, type BatchStats } from './x-batch-stats';
import { appendCollectLog } from './x-collect-log-repo';

export type SearchScrollInput = {
  readonly wsId: string;
  readonly q: string;
  /** latest(按时间)/ top(热门)—— 默认 latest */
  readonly f?: 'latest' | 'top';
  /** 最多采几页(SearchTimeline 响应数)—— 防限流的上限,不是目标 */
  readonly wantPages: number;
  readonly maxMs: number;
  /** 配方名(作者进人表时记来源)—— 不给就不记 */
  readonly recipeName?: string;
};

export type SearchScrollReport = {
  readonly ok: boolean;
  readonly why?: string;
  readonly harvest?: Record<string, unknown>;
  readonly rateLimited: boolean;
  readonly pages: readonly (PageLedgerRow & { readonly newest?: string; readonly oldest?: string })[];
  readonly totals?: {
    readonly pages: number; readonly xTweets: number; readonly notParsed: number; readonly notInDb: number;
    readonly badPages: number; readonly uniqueTweets: number;
  };
  readonly stats?: BatchStats;
};

const BUSY = '开发测试:滚动采搜索';

export async function collectSearchByScroll(input: SearchScrollInput): Promise<SearchScrollReport> {
  const wcId = getXHostState(input.wsId)?.wcId;
  if (wcId === undefined) return { ok: false, why: `${input.wsId} 的 X 网页没开`, rateLimited: false, pages: [] };
  const busy = getXHostBusy(wcId);
  if (busy !== null) return { ok: false, why: `X 网页正忙:${busy}`, rateLimited: false, pages: [] };
  const bg = bgRunningOn(wcId);
  if (bg !== null) return { ok: false, why: `后台正在采 @${bg.handle}`, rateLimited: false, pages: [] };

  setXHostBusy(wcId, BUSY);
  try {
    const rep = await webviewPorts(wcId).harvest({
      gotoPage: { name: X_PAGE_NAME.search, params: { q: input.q, f: input.f ?? 'latest' } },
      wantPages: input.wantPages,
      pageUrlIncludes: X_PAGE_MATCHERS,
      noisyUrlSubstrings: X_NOISY_URLS,
      afterRoundScriptId: X_SCRIPTS.expandAll,
      onStuckScriptId: X_SCRIPTS.jumpToLastCard,
      maxRounds: 3000,
      maxMs: input.maxMs,
    });
    if (!rep) return { ok: false, why: '采集没拿到报告(去不到搜索页 / 页面没了)', rateLimited: false, pages: [] };
    const raw = rep as RunHarvest & Record<string, unknown>;
    const harvest = {
      rounds: raw.rounds, scrolledPx: raw.scrolledPx, elapsedMs: raw.elapsedMs, stopReason: raw.stopReason,
      reachedBottom: raw.reachedBottom, apiSeen: raw.apiSeen, completeness: raw.completeness, rawHeld: raw.rawHeld,
      legs: raw.legs, problems: raw.problems, responses: rep.items.length,
    };
    const searchPages = rep.items
      .filter((it) => carriesTweets(it.url) && it.url.includes('/SearchTimeline'))
      .map((it) => it as typeof it & { at?: string });
    const rateLimited = searchPages.some((it) => it.status === 429);
    /** 按到达先后排成「第几页」 */
    const ok200 = searchPages.filter((it) => (it.status ?? 200) === 200)
      .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));

    const account = await accountForWrite(wcId);
    const all: TweetRecord[] = [];
    const pages: Array<PageLedgerRow & { newest?: string; oldest?: string }> = [];
    let prevNewest: number | undefined;
    for (let i = 0; i < ok200.length; i += 1) {
      const one: RunHarvest = { items: [ok200[i]] };
      const got = [auditTimelinePayload(ok200[i].text)];
      const row = await ledgerFor({
        harvest: async () => null,
        savePage: async ({ tweets }) => {
          const recs = tweets.filter((t) => t.id !== '');
          const sv = await saveTweets(recs, { source: X_PAGE_NAME.search, searchRecipe: input.q, wsId: input.wsId });
          const au = await saveTweetAuthors(tweets, input.recipeName, account);
          /** ⭐ 记账本 —— 与 IPC saveTweets 同口径,否则状态页对账差出这批 */
          await appendCollectLog({ kind: 'tweets', source: X_PAGE_NAME.search, given: recs.length,
            inserted: sv.inserted, updated: sv.updated, failed: sv.failed.length, wsId: input.wsId });
          await appendCollectLog({ kind: 'users', source: 'tweet-authors', given: au.inserted + au.updated + au.failed.length,
            inserted: au.inserted, updated: au.updated, failed: au.failed.length, wsId: input.wsId });
          return { inDb: await existingTweetIds(tweets.map((t) => t.id).filter((x) => x !== '')) };
        },
      }, i + 1, '滚动', one, got, prevNewest, undefined, false);
      const times = pageTimes(got);
      if (times.length > 0) prevNewest = Math.max(...times);
      pages.push({
        ...row,
        newest: times.length > 0 ? new Date(Math.max(...times)).toISOString() : undefined,
        oldest: times.length > 0 ? new Date(Math.min(...times)).toISOString() : undefined,
      });
      all.push(...got.flatMap((a) => a.items.map((t) => t.record)));
    }
    const uniq = new Map(all.map((t) => [t.id, t]));
    const totals = {
      pages: pages.length,
      xTweets: pages.reduce((n, r) => n + r.xTweets, 0),
      notParsed: pages.reduce((n, r) => n + r.notParsed.length, 0),
      notInDb: pages.reduce((n, r) => n + (r.notInDb?.length ?? 0), 0),
      badPages: pages.filter((r) => pageProblem(r) !== undefined).length,
      uniqueTweets: uniq.size,
    };
    console.log(`[x.search-scroll] 「${input.q.slice(0, 40)}」${totals.pages} 页 · X 列 ${totals.xTweets} · 解析缺 ${totals.notParsed}`
      + ` · 入库缺 ${totals.notInDb} · 对不上 ${totals.badPages} 页${rateLimited ? ' · ⚠️ 撞了 429' : ''}`);
    return { ok: true, harvest, rateLimited, pages, totals, stats: summarizeBatch([...uniq.values()]) };
  } finally {
    setXHostBusy(wcId, null);
  }
}
