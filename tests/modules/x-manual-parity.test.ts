/**
 * ⭐⭐⭐ P2 验收:新旧两套账逐页逐条一致(设计 §11 P2,2026-10-19)
 *
 * 旧:`censusPage`(X 专用代码,10-16;切换后冻结在 x-legacy-census.ts)  新:通用引擎 + `x.manual.json`
 * 三层比:
 *  ① 手造的 X 真实形状(与 x-page-ledger.test.ts 同一批,含 top/bottom、广告、墓碑、模块、推荐的人)
 *  ② 随机生成的 X 形状载荷(把每个分支的组合都撞一遍,固定种子可复现)
 *  ③ 本机真实载荷样本(`krig-data/x-dev/samples/`,含登录态内容不进 git);没有就**明说跳过**,不假装过了
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { legacyCensusPage as censusPage } from './x-legacy-census';
import { censusByManual } from '@modules/x/x-manual';

const tw = (id: string, extra: Record<string, unknown> = {}) => ({
  itemContent: { ...extra, tweet_results: { result: { __typename: 'Tweet', rest_id: id, legacy: { id_str: id, full_text: id } } } },
});

describe('① 手造的 X 形状', () => {
  const cases: Array<[string, unknown]> = [
    ['搜索页全家福', { data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [
      { type: 'TimelineClearCache' },
      { type: 'TimelineAddEntries', entries: [
        { entryId: 'cursor-top-1', content: { cursorType: 'Top', value: 'DAADtop' } },
        { entryId: 'tweet-1', content: tw('1') },
        { entryId: 'promoted-tweet-9', content: tw('9', { promotedMetadata: {} }) },
        { entryId: 'tweet-2', content: { itemContent: { tweet_results: { result: { __typename: 'TweetTombstone' } } } } },
        { entryId: 'conversationthread-3', content: { items: [
          { entryId: 'conversationthread-3-tweet-3', item: tw('3') },
          { entryId: 'conversationthread-3-tweet-4', item: { itemContent: { tweet_results: { result: { __typename: 'TweetWithVisibilityResults', tweet: { rest_id: '4', legacy: { id_str: '4' } } } } } } },
        ] } },
        { entryId: 'who-to-follow-77', content: { items: [{ entryId: 'u', item: { itemContent: { user_results: { result: { rest_id: '77' } } } } }] } },
        { entryId: 'messageprompt-123', content: { foo: 1 } },
        { entryId: 'cursor-bottom-1', content: { cursorType: 'Bottom', value: 'DAADbottom' } },
      ] },
    ] } } } } }],
    ['置顶 + 替换游标 + 模块追加', { data: { user: { result: { timeline: { timeline: { instructions: [
      { type: 'TimelinePinEntry', entry: { entryId: 'tweet-50', content: tw('50') } },
      { type: 'TimelineReplaceEntry', entry: { entryId: 'cursor-bottom-x', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'B2' } } },
      { type: 'TimelineAddToModule', moduleItems: [{ entryId: 'profile-conversation-1-tweet-51', item: tw('51') }] },
    ] } } } } } }],
    ['名单页', { data: { user: { result: { timeline: { timeline: { instructions: [
      { type: 'TimelineAddEntries', entries: [
        { entryId: 'user-1', content: { itemContent: { user_results: { result: { rest_id: '1' } } } } },
        { entryId: 'user-2', content: { itemContent: { user_results: {} } } },
        { entryId: 'cursor-bottom-1', content: { cursorType: 'Bottom', value: '1|2' } },
      ] },
    ] } } } } } }],
    ['空 / 怪形状', { a: [{ instructions: [null, 3, { entries: [null, { entryId: '' }, { entryId: 'x-123456789012345' , content: 'str' }] }] }] }],
  ];
  for (const [name, root] of cases) {
    it(name, () => {
      const text = JSON.stringify(root);
      expect(censusByManual(text)).toEqual(censusPage(text));
    });
  }
  it('不是 JSON → 两边都 null', () => {
    expect(censusByManual('Rate limit exceeded')).toBeNull();
    expect(censusPage('Rate limit exceeded')).toBeNull();
  });
});

/** 键排序后序列化 —— 对象键顺序不算差异,数组(id 顺序)照比 */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

/** 固定种子的伪随机 —— 失败可复现 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe('② 随机生成的 X 形状载荷(10000 份,每个分支的组合)', () => {
  it('逐份逐字段一致', () => {
    const r = rng(20261019);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    const maybe = (p: number): boolean => r() < p;
    const id = (): string => pick(['', '1', '2', '3', '42', '1234567890123456789']);
    const entryId = (): string => pick(['', 'tweet-1', 'promoted-tweet-2', 'who-to-follow-77', 'messageprompt-123', 'cursor-top-DAAD', 'x-ABCDEFGHIJKLMN', 'conversationthread-9-tweet-1', 'tweet']);
    const result = (depth: number): unknown => pick([
      undefined, null, 'str',
      { __typename: pick(['Tweet', 'TweetTombstone', 'TweetUnavailable', '']), ...(maybe(0.7) ? { rest_id: id() } : {}), ...(maybe(0.5) ? { legacy: { id_str: id() } } : {}) },
      { __typename: 'TweetWithVisibilityResults', ...(maybe(0.8) ? { tweet: depth > 0 ? result(depth - 1) : { rest_id: id() } } : {}), rest_id: id() },
    ]);
    const content = (depth: number): unknown => {
      const k = Math.floor(r() * 9);
      const ic = (): Record<string, unknown> => ({
        ...(maybe(0.6) ? { tweet_results: maybe(0.9) ? { result: result(1) } : 'x' } : {}),
        ...(maybe(0.3) ? { user_results: { ...(maybe(0.8) ? { result: maybe(0.8) ? { rest_id: id() } : 7 } : {}) } } : {}),
        ...(maybe(0.2) ? { promotedMetadata: maybe(0.8) ? {} : 'x' } : {}),
      });
      switch (k) {
        case 0: return { cursorType: pick(['Top', 'Bottom', 'top', 'BOTTOM', 'ShowMore', '', 3]), value: pick(['DAADa', 'DAADb', '', 5]) };
        case 1: return { entryType: pick(['TimelineTimelineCursor', 'TimelineTimelineItem']), value: 'v', ...(maybe(0.5) ? { cursorType: 'Bottom' } : {}) };
        case 2: return { itemType: 'TimelineTimelineCursor', cursorType: pick(['Top', '']), value: 'w' };
        case 3: return maybe(0.8) ? { itemContent: ic() } : { itemContent: 'notobj', content: ic() };
        case 4: return { content: ic() };
        case 5: return depth > 0 ? { items: Array.from({ length: Math.floor(r() * 4) }, () => pick([
          null, 5, { entryId: entryId(), item: content(depth - 1) }, { item: content(depth - 1) }, { entryId: entryId(), ...(content(depth - 1) as object) },
        ])) } : { items: [] };
        case 6: return pick([null, undefined, 'str', 7]);
        case 7: return { foo: 1 };
        default: return { itemContent: ic(), items: maybe(0.5) ? [] : 'no' };
      }
    };
    const entry = (): unknown => pick([
      null,
      { entryId: entryId(), content: content(2) },
      { entryId: entryId(), item: content(2) },
      { entryId: entryId(), content: null, item: content(1) },
      { content: content(2) },
    ]);
    const ins = (): unknown => pick([
      null,
      { type: pick(['TimelineAddEntries', 'TimelineClearCache', '', 5]), entries: Array.from({ length: Math.floor(r() * 6) }, entry) },
      { type: 'TimelinePinEntry', entry: entry() },
      { type: 'TimelineReplaceEntry', entry: entry(), entries: maybe(0.3) ? [entry()] : undefined },
      { type: 'TimelineAddToModule', moduleItems: Array.from({ length: Math.floor(r() * 3) }, entry) },
      { entries: 'notarray' },
    ]);
    const root = (): unknown => pick([
      { data: { x: { timeline: { instructions: Array.from({ length: Math.floor(r() * 4) }, ins) } } } },
      { data: [{ instructions: [ins()] }, { deep: { instructions: [ins(), ins()] } }] },
      { instructions: 'notarray', inner: { instructions: [ins()] } },
      [{ a: 1 }, { b: { instructions: [ins()] } }],
      'plain', 42, null,
    ]);
    let mism = 0;
    const hit = { tweet: 0, promoted: 0, tombstone: 0, user: 0, top: 0, bottom: 0, other: 0 };
    for (let i = 0; i < 10000; i += 1) {
      const text = JSON.stringify(root());
      const a = censusPage(text); const b = censusByManual(text);
      if (a) {
        if (a.tweetIds.length) hit.tweet += 1;
        if (a.promotedIds.length) hit.promoted += 1;
        if (a.tombstones) hit.tombstone += 1;
        if (a.userIds.length) hit.user += 1;
        if (a.cursors.top !== undefined) hit.top += 1;
        if (a.cursors.bottom !== undefined) hit.bottom += 1;
        if (Object.keys(a.other).length) hit.other += 1;
      }
      if (canon(a) !== canon(b)) {
        mism += 1;
        if (mism === 1) expect(b, `第 ${i} 份不一致:${text}`).toEqual(a);
      }
    }
    expect(mism).toBe(0);
    /** ⚠️ 先确认每个分支都真的撞到过 —— 全是空载荷时「一致」毫无意义 */
    for (const [k, n] of Object.entries(hit)) expect(n, `分支 ${k} 只撞到 ${n} 次`).toBeGreaterThan(50);
  });
});

/** ⚠️ 与 Electron `app.getPath('userData')` 一致:macOS 下是 ~/Library/Application Support/<productName> */
function samplesDir(): string | undefined {
  const env = process.env.KRIG_SAMPLES_DIR;
  if (env) return env;
  const base = join(homedir(), 'Library', 'Application Support');
  if (!existsSync(base)) return undefined;
  for (const name of readdirSync(base)) {
    const d = join(base, name, 'krig-data', 'x-dev', 'samples');
    if (existsSync(d)) return d;
  }
  return undefined;
}

describe('③ 本机真实载荷样本(不进 git)', () => {
  const dir = samplesDir();
  const files = dir ? readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.json')) : [];
  it.skipIf(files.length === 0)(`逐份逐条一致(${dir ?? '本机没有样本目录'},${files.length} 个文件)`, () => {
    let pages = 0; let items = 0;
    for (const f of files) {
      const s = JSON.parse(readFileSync(join(dir!, f), 'utf8')) as { items: Array<{ url: string; text: string }> };
      for (const it of s.items) {
        const a = censusPage(it.text); const b = censusByManual(it.text);
        expect(b, `${f} · ${it.url.slice(0, 120)}`).toEqual(a);
        pages += 1; items += (a?.tweetIds.length ?? 0) + (a?.userIds.length ?? 0);
      }
    }
    console.log(`[parity] 真实样本 ${files.length} 个文件 · ${pages} 份载荷 · ${items} 个条目,新旧全一致`);
    expect(items).toBeGreaterThan(0);
  });
});

describe('⭐⭐ 并跑接线(行为测试,不是源码扫描)', () => {
  it('游标只有 DAAD 兜底 → manualDiff 记一笔「游标」,但页面判定照旧 ✓、不重采;旁路收到每页载荷', async () => {
    const { runCollect } = await import('@modules/x/x-collect-run');
    const { pageProblem } = await import('@modules/x/x-page-ledger');
    const { setPageTap } = await import('@modules/x/x-page-tap');
    const SEED = `https://x.com/i/api/graphql/q/SearchTimeline?variables=${encodeURIComponent(JSON.stringify({ rawQuery: 'x', product: 'Latest', count: 20 }))}`;
    const t = (id: string, at: string) => ({ entryId: `tweet-${id}`, content: { itemContent: { tweet_results: { result: {
      __typename: 'Tweet', rest_id: id, legacy: { id_str: id, full_text: id, created_at: at },
      core: { user_results: { result: { rest_id: `u${id}`, legacy: { screen_name: `a${id}` } } } } } } } } });
    const wrap = (entries: unknown[]) => JSON.stringify({ data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } } });
    /** 种子页:游标没有 cursorType,只有 DAAD 开头的值 —— 翻页靠兜底,说明书认不出 down */
    const seed = wrap([t('s1', 'Fri Oct 16 20:00:00 +0000 2026'), { entryId: 'cursor-x', content: { value: 'DAADfallback' } }]);
    const tapped: Array<{ page: number; n: number }> = [];
    setPageTap((p) => tapped.push({ page: p.page, n: p.items.length }));
    try {
      const sent: string[] = [];
      const r = await runCollect({
        async harvest(plan) { return plan.gotoPage ? { items: [] } : { items: [{ url: SEED, text: seed, status: 200, requestHeaders: { authorization: 'B', 'x-csrf-token': 'c' } }] }; },
        async runScript(_id, params) { sent.push(String(params.cursor)); return { ok: true, status: 200, body: wrap([t('p1', 'Fri Oct 16 19:50:00 +0000 2026')]) }; },
        async savePage({ tweets }) { return { inDb: tweets.map((x) => x.id) }; },
        stopPaging: (st) => ({ go: st.round < 3 }),
      }, { wantPages: 3, depth: 'as-is' });
      const led = r.paging?.ledger ?? [];
      expect(led[0].manualDiff).toMatch(/游标:说明书 down \(无\) \/ 翻页用 #/);
      expect(led.every((l) => pageProblem(l) === undefined)).toBe(true);
      expect(sent).toEqual(['DAADfallback']);
      expect(led.every((l) => l.retried === false)).toBe(true);
      expect(tapped.map((x) => x.page)).toEqual(led.map((l) => l.page));
      expect(tapped.every((x) => x.n >= 1)).toBe(true);
    } finally {
      setPageTap(null);
    }
  });
});

describe('④ 按时间排 / 噪音表:挪进说明书后与改前一致', () => {
  /** 改前的实现原样冻结在这里当对照(x-collect-run.ts 10-16 版) */
  const legacyChrono = (url: string): boolean => {
    let u = url;
    try { u = decodeURIComponent(url); } catch { /* 原样用 */ }
    if (/\/SearchTimeline/.test(u)) return u.includes('"product":"Latest"');
    return /\/(UserTweets|UserTweetsAndReplies|UserRepliesTimeline|UserOriginalsTimeline|UserRepostsTimeline|UserMedia)\b/.test(u);
  };
  it('一批 URL 逐个一致(含编码 / 坏编码 / 前缀撞名)', async () => {
    const { isChronological } = await import('@modules/x/x-collect-run');
    const v = (op: string, o: object) => `https://x.com/i/api/graphql/q/${op}?variables=${encodeURIComponent(JSON.stringify(o))}`;
    const urls = [
      v('SearchTimeline', { product: 'Latest' }), v('SearchTimeline', { product: 'Top' }), v('SearchTimeline', {}),
      ...['UserTweets', 'UserTweetsAndReplies', 'UserRepliesTimeline', 'UserOriginalsTimeline', 'UserRepostsTimeline', 'UserMedia',
        'UserMediaX', 'UserTweetsX', 'HomeTimeline', 'HomeLatestTimeline', 'TweetDetail', 'Followers', 'ListLatestTweetsTimeline', 'UserHighlightsTweets']
        .map((op) => v(op, { product: 'Latest' })),
      'https://x.com/i/api/graphql/q/SearchTimeline?variables=%E0%A4%A', 'https://x.com/i/api/graphql/q/UserTweets', '', 'garbage',
    ];
    for (const u of urls) expect(isChronological(u), u).toBe(legacyChrono(u));
  });
  it('噪音表与改前逐条相同(顺序也同)', async () => {
    const { X_NOISY_URLS } = await import('@modules/x/x-pages');
    expect(X_NOISY_URLS).toEqual(['video.twimg.com', 'pbs.twimg.com', 'abs.twimg.com', '/i/api/1.1/jot/', 'promoted_content/log',
      'fleets/v1/avatar_content', '1.1/graphql/viewer_context.json']);
  });
});
