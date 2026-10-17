/**
 * ⭐⭐⭐ 逐页账(2026-10-16)
 * 用户:「A页是多少条,落库多少条,对不上问题在哪里,直接就可以敲定了,一页数据不完整,再往下翻页又有什么意义呢?」
 * 「应该找一个可靠的方法,把页面数据完成的采集下来。这是所有工作的基础呀!」
 * ⚠️ 假载荷按 X 搜索页的**真实形状**造(top 在前、bottom 在后、广告、墓碑、对话模块、推荐的人)——
 * 旧测试只放一个 bottom 游标,搜索翻页往错方向翻了两周没被抓到。
 */
import { describe, it, expect } from 'vitest';
import { censusPage, directionWrong, pageProblem } from '@modules/x/x-page-ledger';
import { runCollect, isChronological, type RunDeps } from '@modules/x/x-collect-run';

const t = (id: string, at: string, promoted = false) => ({
  entryId: promoted ? `promoted-tweet-${id}` : `tweet-${id}`,
  content: { itemContent: {
    ...(promoted ? { promotedMetadata: {} } : {}),
    tweet_results: { result: {
      __typename: 'Tweet', rest_id: id,
      legacy: { id_str: id, full_text: `推文${id}`, created_at: at },
      core: { user_results: { result: { rest_id: `u${id}`, legacy: { screen_name: `a${id}` } } } },
    } },
  } },
});
const cursor = (type: 'Top' | 'Bottom', v: string) => ({ entryId: `cursor-${type.toLowerCase()}-${v}`, content: { cursorType: type, value: v } });
const wrap = (instructions: unknown[]) => JSON.stringify({ data: { search_by_raw_query: { search_timeline: { timeline: { instructions } } } } });
/** 一页:top 游标在前、推文、bottom 游标在后 —— X 搜索页的真实顺序 */
const page = (ids: Array<[string, string]>, top: string, bottom: string | null) => wrap([{
  type: 'TimelineAddEntries',
  entries: [cursor('Top', top), ...ids.map(([id, at]) => t(id, at)), ...(bottom ? [cursor('Bottom', bottom)] : [])],
}]);

describe('censusPage —— 清点 X 这一页列了什么', () => {
  it('⭐ 推文 / 广告 / 墓碑 / 对话模块 / 推荐的人 / 不认识的类型 / 两个游标,各归各类', () => {
    const text = wrap([
      { type: 'TimelineClearCache' },
      { type: 'TimelineAddEntries', entries: [
        cursor('Top', 'DAADtop'),
        t('1', 'Fri Oct 16 20:00:00 +0000 2026'),
        t('9', 'Fri Oct 16 20:00:00 +0000 2026', true),
        { entryId: 'tweet-2', content: { itemContent: { tweet_results: { result: { __typename: 'TweetTombstone' } } } } },
        { entryId: 'conversationthread-3', content: { items: [
          { entryId: 'conversationthread-3-tweet-3', item: { itemContent: { tweet_results: { result: { rest_id: '3', legacy: { id_str: '3', full_text: 'x' } } } } } },
          { entryId: 'conversationthread-3-tweet-4', item: { itemContent: { tweet_results: { result: { __typename: 'TweetWithVisibilityResults', tweet: { rest_id: '4', legacy: { id_str: '4', full_text: 'y' } } } } } } },
        ] } },
        { entryId: 'who-to-follow-77', content: { items: [{ entryId: 'u', item: { itemContent: { user_results: { result: { rest_id: '77' } } } } }] } },
        { entryId: 'messageprompt-123', content: { foo: 1 } },
        cursor('Bottom', 'DAADbottom'),
      ] },
    ]);
    const c = censusPage(text)!;
    expect(c.tweetIds).toEqual(['1', '3', '4']);
    expect(c.promotedIds).toEqual(['9']);
    expect(c.tombstones).toBe(1);
    expect(c.userIds).toEqual(['77']);
    expect(c.cursors).toEqual({ top: 'DAADtop', bottom: 'DAADbottom' });
    expect(c.other).toEqual({ messageprompt: 1 });
    expect(c.instructions).toEqual({ TimelineClearCache: 1, TimelineAddEntries: 1 });
  });

  it('不是 JSON → null(调用方记成「非JSON响应」)', () => {
    expect(censusPage('Rate limit exceeded')).toBeNull();
  });
});

describe('方向判据 / 只对按时间排的页', () => {
  it('这一页多数比上一页最新的还新 → 方向反', () => {
    expect(directionWrong(1000, [1500, 1600, 900])).toBe(true);
    expect(directionWrong(1000, [500, 600, 1500])).toBe(false);
    expect(directionWrong(undefined, [1500])).toBe(false);
  });
  it('搜索「最新」/ 个人主页各页判;搜索「热门」/ 首页推荐不判', () => {
    const v = (o: object) => `https://x.com/i/api/graphql/q/SearchTimeline?variables=${encodeURIComponent(JSON.stringify(o))}`;
    expect(isChronological(v({ rawQuery: 'x', product: 'Latest' }))).toBe(true);
    expect(isChronological(v({ rawQuery: 'x', product: 'Top' }))).toBe(false);
    expect(isChronological('https://x.com/i/api/graphql/q/HomeTimeline?variables=%7B%7D')).toBe(false);
    expect(isChronological('https://x.com/i/api/graphql/q/UserTweets?variables=%7B%7D')).toBe(true);
  });
});

describe('⭐⭐⭐ runCollect 逐页账:对上才往下翻;对不上重采一次,还不对就停在这页', () => {
  const SEED = `https://x.com/i/api/graphql/q/SearchTimeline?variables=${encodeURIComponent(JSON.stringify({ rawQuery: 'x', product: 'Latest', count: 20 }))}`;
  const H = { authorization: 'B', 'x-csrf-token': 'c' };
  /** 种子页:最新的两条(20:00、19:59) */
  const seedText = page([['s1', 'Fri Oct 16 20:00:00 +0000 2026'], ['s2', 'Fri Oct 16 19:59:00 +0000 2026']], 'T0', 'B0');

  function deps(next: Record<string, string>, opts: { dropFromDb?: string } = {}): { d: RunDeps; sent: string[]; saved: number } {
    const sent: string[] = []; const box = { saved: 0 };
    const d: RunDeps = {
      async harvest(plan) {
        if (plan.gotoPage) return { items: [] };
        return { items: [{ url: SEED, text: seedText, status: 200, requestHeaders: H }] };
      },
      async runScript(_id, params) {
        const c = String(params.cursor ?? ''); sent.push(c);
        const body = next[c];
        return body === undefined ? { ok: true, status: 200, body: page([], 'TX', null) } : { ok: true, status: 200, body };
      },
      async savePage({ tweets }) {
        box.saved += 1;
        return { inDb: tweets.map((x) => x.id).filter((id) => id !== opts.dropFromDb) };
      },
      stopPaging: (st) => ({ go: st.round < 5 }),
    };
    return { d, sent, get saved() { return box.saved; } } as never;
  }

  it('⭐ 正常:每页更旧、都解出、都在库 → 一页一行 ✓,每页都存了', async () => {
    const x = deps({
      B0: page([['p1', 'Fri Oct 16 19:50:00 +0000 2026']], 'T1', 'B1'),
      B1: page([['p2', 'Fri Oct 16 19:40:00 +0000 2026']], 'T2', null),
    });
    const r = await runCollect(x.d, { wantPages: 5, depth: 'as-is' });
    const led = r.paging?.ledger ?? [];
    expect(led.map((l) => [l.page, l.label, l.xTweets])).toEqual([[0, '种子', 2], [1, '翻页', 1], [2, '翻页', 1]]);
    expect(led.every((l) => pageProblem(l) === undefined)).toBe(true);
    expect(led.every((l) => l.notInDb !== undefined && l.notInDb.length === 0)).toBe(true);
  });

  it('⭐⭐⭐ 拿错游标(翻回来的比上一页还新)→ 重采一次 → 仍反 → 停在这页,停因写「翻页方向反了」', async () => {
    const newer = page([['n1', 'Fri Oct 16 20:05:00 +0000 2026']], 'T1', 'B1');
    const x = deps({ B0: newer, B1: page([['p9', 'Fri Oct 16 19:00:00 +0000 2026']], 'T9', null) });
    const r = await runCollect(x.d, { wantPages: 5, depth: 'as-is' });
    expect(x.sent).toEqual(['B0', 'B0']);
    expect(r.paging?.stopReason).toContain('翻页方向反了');
    expect(r.paging?.ledger?.at(-1)?.retried).toBe(true);
  });

  it('⭐⭐ 存完回读少一条 → 重采一次 → 还少 → 停,停因写「落库层」', async () => {
    const x = deps({ B0: page([['p1', 'Fri Oct 16 19:50:00 +0000 2026']], 'T1', 'B1') }, { dropFromDb: 'p1' });
    const r = await runCollect(x.d, { wantPages: 5, depth: 'as-is' });
    expect(x.sent).toEqual(['B0', 'B0']);
    expect(r.paging?.stopReason).toContain('落库层');
    expect(r.paging?.ledger?.at(-1)?.notInDb).toEqual(['p1']);
  });

  it('⭐⭐ X 列了、解析器没解出来(没有正文)→ 停,停因写「解析层」', async () => {
    const bad = wrap([{ type: 'TimelineAddEntries', entries: [
      cursor('Top', 'T1'),
      { entryId: 'tweet-q1', content: { itemContent: { tweet_results: { result: { __typename: 'Tweet', rest_id: 'q1', legacy: { id_str: 'q1' } } } } } },
      cursor('Bottom', 'B1'),
    ] }]);
    const x = deps({ B0: bad });
    const r = await runCollect(x.d, { wantPages: 5, depth: 'as-is' });
    expect(r.paging?.stopReason).toContain('解析层');
    expect(r.paging?.ledger?.at(-1)?.notParsed).toEqual(['q1']);
  });

  it('第一次对不上、重采后对上 → 照常往下翻(记「重采过」)', async () => {
    let calls = 0;
    const good = page([['p1', 'Fri Oct 16 19:50:00 +0000 2026']], 'T1', null);
    const x = deps({});
    x.d.runScript = async (_id, params) => {
      calls += 1;
      if (String(params.cursor) === 'B0' && calls === 1) return { ok: true, status: 200, body: page([['n1', 'Fri Oct 16 20:05:00 +0000 2026']], 'T1', 'B1') };
      return { ok: true, status: 200, body: good };
    };
    const r = await runCollect(x.d, { wantPages: 5, depth: 'as-is' });
    const last = r.paging?.ledger?.at(-1);
    expect(last?.retried).toBe(true);
    expect(pageProblem(last!)).toBeUndefined();
    expect(r.paging?.stopReason).not.toContain('对不上');
  });
});

describe('接线', () => {
  const read = (p: string): string => require('node:fs').readFileSync(require('node:path').join(process.cwd(), p), 'utf8');
  it('savePageVerify 复用 saveTweets / saveUsers 分支后按 id 回读;操作台每页调它;报告有逐页账', () => {
    const IPC = read('src/modules/x/x-data-ipc.ts');
    const body = IPC.slice(IPC.indexOf("case 'savePageVerify':"), IPC.indexOf('default:', IPC.indexOf("case 'savePageVerify':")));
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/await handle\(\{ op: 'saveTweets', records: tweets, ctx: p\.tweetCtx \}\)/);
    expect(body).toMatch(/await handle\(\{ op: 'saveUsers', records: users, ctx: p\.userCtx \}\)/);
    expect(body).toMatch(/existingTweetIds\(/);
    expect(body).toMatch(/existingUserIds\(/);
    expect(read('src/modules/x/XConsole.tsx')).toMatch(/savePage: async \(\{ tweets, users \}\) => \{[\s\S]{0,600}op: 'savePageVerify'/);
    expect(read('src/modules/x/x-run-report.ts')).toMatch(/L\.push\(\.\.\.ledgerSection\(run\.paging\?\.ledger\)\);/);
  });
});

describe('⭐⭐⭐ 操作台搜索页走滚动截获(2026-10-16 真机 30 页全对)', () => {
  const read = (p: string): string => require('node:fs').readFileSync(require('node:path').join(process.cwd(), p), 'utf8');
  it('搜索页 → searchScroll(不再走自己拿游标重放);页数上限 40;自己登记的忙不让路', () => {
    const C = read('src/modules/x/XConsole.tsx');
    const i = C.indexOf("if (origin?.name === X_PAGE_NAME.search && (origin.params.q ?? '') !== '') {");
    expect(i).toBeGreaterThan(-1);
    const branch = C.slice(i, C.indexOf('return;\n                      }', i));
    expect(branch).toMatch(/op: 'searchScroll'/);
    expect(branch).toMatch(/Math\.min\(Math\.max\(Number\(pagesWanted\) \|\| 10, 1\), 40\)/);
    expect(branch).toMatch(/ownBusy: '操作台正在采集'/);
    /** 分支在 runCollect 之前,且 return 掉 —— 不会两条路都跑 */
    expect(i).toBeLessThan(C.indexOf('const run = await runCollect({'));
    expect(read('src/modules/x/x-data-ipc.ts')).toMatch(/p\.wantPages > 40\) return failed/);
    expect(read('src/modules/x/x-search-scroll.ts')).toMatch(/if \(busy !== null && busy !== input\.ownBusy\) return/);
  });
});
