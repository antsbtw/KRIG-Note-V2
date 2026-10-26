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
import { recordSearch } from './x-search-budget';
import { webviewPorts } from './x-collect-ports';
import { X_NOISY_URLS, X_PAGE_MATCHERS, X_PAGE_NAME, carriesTweets } from './x-pages';
import { X_SCRIPTS } from './x-dom-scripts';
import { getXHostState, listXHostStates } from './x-host-registry';
import { holdsPage } from './x-page-lock';
import { auditTimelinePayload, type TweetRecord } from './x-timeline-audit';
import { ledgerFor, pageTimes, type RunHarvest } from './x-collect-run';
import { manualSummary, pageProblem, type PageLedgerRow } from './x-page-ledger';
import { X_MANUAL } from './x-manual';
import { summarizeBatch, type BatchStats } from './x-batch-stats';
import { saveTweetPage } from './x-save-page';
import { app } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ledgerLine } from './x-page-ledger';
import { statsLine } from './x-batch-stats';

/** ⭐ 每跑一份报告(人和我都读得到):对账 + 逐页账 + 本批统计 —— 写不了只打终端,不毁这一跑 */
function writeReport(input: SearchScrollInput, r: SearchScrollReport): string | undefined {
  try {
    const dir = path.join(app.getPath('userData'), 'krig-data', 'x-audit');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `x-scroll-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    const h = (r.harvest ?? {}) as Record<string, unknown>;
    const c = h.completeness as { seen: number; captured: number } | undefined;
    const L = [
      `X 搜索滚动截获　${new Date().toISOString()}`,
      `查询:${input.q}`,
      `页数上限 ${input.wantPages} · 用时 ${Math.round(Number(h.elapsedMs ?? 0) / 1000)}s · 滚 ${h.rounds ?? '?'} 轮 · 停因 ${h.stopReason ?? '?'}`,
      r.rateLimited ? '⚠️ 撞了 429(这一跑停在那里,不是采完了)' : '',
      '',
      '── 对账(浏览器收到 vs 采到)──',
      c ? (c.seen === c.captured ? `✓ 浏览器收到 ${c.seen} 次,采到 ${c.captured} 页` : `⚠️ 浏览器收到 ${c.seen} 次,采到 ${c.captured} 页`) : '(无)',
      '',
      '── 逐页账 ──',
      ...r.pages.map((p) => `${ledgerLine(p)}  ${p.newest ?? ''} ~ ${p.oldest ?? ''}`),
      r.totals ? `合计:${r.totals.pages} 页 · X 列 ${r.totals.xTweets} · 解析缺 ${r.totals.notParsed} · 入库缺 ${r.totals.notInDb} · 对不上 ${r.totals.badPages} 页` : '',
      manualSummary(r.pages, X_MANUAL.site, X_MANUAL.version),
      '',
      r.stats ? `本批:${statsLine(r.stats)}` : '',
    ];
    writeFileSync(file, L.filter((x) => x !== undefined).join('\n'));
    return file;
  } catch (e) {
    console.warn('[x.search-scroll] 报告没写上:', e);
    return undefined;
  }
}

export type SearchScrollInput = {
  /** 用哪个 ws 的 X 网页(收件箱用)—— 与 wcId 二选一 */
  readonly wsId?: string;
  /** 直接给 X 网页(操作台用) */
  readonly wcId?: number;
  /**
   * ⭐⭐ 必须带着这个 X 网页的锁进来(Module5-04 第 3 步 3b):占网页由能力执行器做(x.search.scroll / x.vpn.find / x.engage.collect),
   * 这里只核对 token 真是现在的持有者 —— 不是就不采(不能拿过期 / 别的网页的锁混进来)。
   */
  readonly ownToken: string;
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
  /** 报告文件(x-audit/x-scroll-*.txt) */
  readonly reportFile?: string;
};

/** 占网页时写在锁上的用途(能力 x.search.scroll 用) */
export const SEARCH_SCROLL_BUSY = '滚动采搜索';

export async function collectSearchByScroll(input: SearchScrollInput): Promise<SearchScrollReport> {
  const wcId = input.wcId ?? (input.wsId ? getXHostState(input.wsId)?.wcId : undefined);
  if (wcId === undefined) return { ok: false, why: `${input.wsId ?? '?'} 的 X 网页没开`, rateLimited: false, pages: [] };
  const wsId = input.wsId ?? [...listXHostStates()].find(([, st]) => st.wcId === wcId)?.[0];
  if (!holdsPage(input.ownToken, wcId)) return { ok: false, why: '带来的锁已经不是这个 X 网页的持有者了(超时被收回 / 已放 / 没带)—— 没采', rateLimited: false, pages: [] };
  {
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
    /** ⭐ 记进搜索额度账本(配方搜索 / 采互动 / 操作台共用一个额度,x-search-budget.ts) */
    recordSearch(searchPages.length, rateLimited);
    /** 按到达先后排成「第几页」 */
    const ok200 = searchPages.filter((it) => (it.status ?? 200) === 200)
      .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));

    const all: TweetRecord[] = [];
    const pages: Array<PageLedgerRow & { newest?: string; oldest?: string }> = [];
    let prevNewest: number | undefined;
    for (let i = 0; i < ok200.length; i += 1) {
      const one: RunHarvest = { items: [ok200[i]] };
      const got = [auditTimelinePayload(ok200[i].text)];
      const row = await ledgerFor({
        harvest: async () => null,
        /** ⭐ 存一页 + 记账本 + 回读 —— 与人卡 / 后台同一个函数(x-save-page.ts) */
        savePage: async ({ tweets }) => saveTweetPage({
          tweets, source: X_PAGE_NAME.search, searchRecipe: input.q, recipeName: input.recipeName, wsId, wcId,
        }),
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
    const out: SearchScrollReport = { ok: true, harvest, rateLimited, pages, totals, stats: summarizeBatch([...uniq.values()]) };
    return { ...out, reportFile: writeReport(input, out) };
  }
}
