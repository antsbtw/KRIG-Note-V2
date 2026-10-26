/**
 * ⭐⭐⭐ 第 3 步第 3b 批:采集流水线 10 个能力(Module5-04,2026-10-24)
 *
 * 重点「带锁进来」:界面先占住网页(人卡采主页 / 操作台搜索),再请主进程干活 ——
 * 执行器只核对 token 真是持有者,不再申请,跑完不替它放;token 不对 → refused 一步不动;不带 → 自己占、自己放。
 * 存推文 / 存人 / 核对落库共用一份存库函数(核对落库原来绕回 IPC 再调一次)。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<[string, unknown[]]>,
  /** 干活那一刻:网页锁上写着什么、带进来的 token 是不是持有者 */
  seen: [] as Array<{ fn: string; busy: string | null; tokenHeld?: boolean }>,
  account: { wsId: 'ws-1', handle: 'me', restId: 'ME' } as Record<string, unknown> | null,
  ret: {} as Record<string, unknown>,
}));

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
  getXDB: () => ({ query: async () => [[]] }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: () => undefined } }));
vi.mock('@modules/x/x-host-registry', () => ({ getXHostState: (ws: string) => (ws === 'ws-1' ? { wcId: 7, url: '' } : null), listXHostStates: () => new Map([['ws-1', { wcId: 7, url: '' }]]) }));
const work = (name: string, dflt: unknown) => async (...a: unknown[]): Promise<unknown> => {
  const { pageBusy, holdsPage } = await import('@modules/x/x-page-lock');
  const tok = (a[0] as { ownToken?: string } | undefined)?.ownToken;
  h.calls.push([name, a]);
  h.seen.push({ fn: name, busy: pageBusy(7), tokenHeld: tok === undefined ? undefined : holdsPage(tok, 7) });
  return name in h.ret ? h.ret[name] : dflt;
};
vi.mock('@modules/x/x-search-scroll', () => ({ SEARCH_SCROLL_BUSY: '滚动采搜索', collectSearchByScroll: work('collectSearchByScroll', { ok: true, rateLimited: false, pages: [], totals: { pages: 1 } }) }));
vi.mock('@platform/main/db/search-recipe-repo', () => ({ listAllRecipes: async () => [{ name: '蓝V互关', keywords: ['互关'] }] }));
vi.mock('@modules/x/x-recipe-query', () => ({ recipeNameForQuery: (q: string) => (q.includes('互关') ? '蓝V互关' : undefined) }));
vi.mock('@modules/x/x-person-collect', () => ({ collectPersonTab: work('collectPersonTab', { reached: true, records: [1, 2], pageInserted: 2 }), cancelPersonCollect: (wc: number) => { h.calls.push(['cancel', [wc]]); return true; } }));
vi.mock('@modules/x/x-user-repo', () => ({
  refreshPerson: work('refreshPerson', { isNew: true, stale: false, changes: [], relation: {} }),
  existingUserIds: async (ids: string[]) => ids.map((x) => `u:${x}`),
}));
vi.mock('@modules/x/x-tweet-repo', () => ({ existingTweetIds: async (ids: string[]) => ids.map((x) => `t:${x}`) }));
vi.mock('@modules/x/x-account-repo', () => ({ readWsAccount: async () => h.account, accountForWrite: async (wc: unknown) => ({ kind: 'ok', restId: 'ME', handle: 'me', wc }) }));
vi.mock('@modules/x/x-save-batch', () => ({
  saveTweetBatch: work('saveTweetBatch', { inserted: 3, updated: 1, failed: [] }),
  saveUserBatch: work('saveUserBatch', { inserted: 2, updated: 5, failed: [] }),
  logCollect: async (e: unknown) => { h.calls.push(['logCollect', [e]]); },
  /** 第 5 步:刷新落库一份(写库 + 留痕 + 新人记账在它里面,x-step5-one-impl 钉行为) */
  savePersonRefresh: work('savePersonRefresh', { isNew: true, stale: false, changes: [], relation: {} }),
}));
vi.mock('@modules/x/x-spot-check', () => ({ pollSpot: (ws: string, after: number) => { h.calls.push(['pollSpot', [ws, after]]); return null; }, lookupSpot: work('lookupSpot', { found: true }) }));
vi.mock('@modules/x/x-people-repo', async () => ({ ...(await vi.importActual<object>('@modules/x/x-people-repo')), scanMutualIntent: work('scanMutualIntent', { scanned: 10 }) }));

const { execute } = await import('@platform/main/capability/capability');
const { registerXCapabilities } = await import('@modules/x/x-capabilities');
const { acquirePage, releasePage, pageBusy, holdsPage } = await import('@modules/x/x-page-lock');
const { _resetLocks } = await import('@platform/main/flow/resource-lock');
registerXCapabilities();

beforeEach(() => {
  _resetLocks();
  h.rows.length = 0; h.calls.length = 0; h.seen.length = 0; h.ret = {};
  h.account = { wsId: 'ws-1', handle: 'me', restId: 'ME' };
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

const scroll = { wcId: 7, q: 'min_faves:5 互关', wantPages: 5 };
const tab = { wcId: 7, page: 'x.profile', handle: 'he', restId: '42', pageCap: 3, attempt: 1 };

describe('⭐⭐ 带锁进来(界面先占住网页)', () => {
  for (const [id, inp, fn] of [['x.search.scroll', scroll, 'collectSearchByScroll'], ['x.person.collectTab', tab, 'collectPersonTab']] as const) {
    it(`${id}:带着界面的锁 → 不再申请、干活时锁还是界面那把、跑完界面的锁还在`, async () => {
      const ui = acquirePage(7, '运营正在采他的推文', 'ui');
      if (!ui.ok) throw new Error('应拿到');
      const r = await execute(id, { ...inp, ownToken: ui.token }, { caller: 'ui' });
      expect(r, id).toMatchObject({ ok: true });
      expect(h.seen.find((x) => x.fn === fn)?.busy).toBe('运营正在采他的推文');
      expect(holdsPage(ui.token, 7)).toBe(true);
      releasePage(ui.token);
    });
    it(`${id}:带来的 token 不是持有者 → refused,一步不动,别人的锁不动`, async () => {
      const other = acquirePage(7, '任务:查回关', 'timer');
      if (!other.ok) throw new Error('应拿到');
      const r = await execute(id, { ...inp, ownToken: 'page:7#假的' }, { caller: 'ui' });
      expect(r).toMatchObject({ ok: false, kind: 'refused' });
      if (!r.ok) expect(r.why).toContain('带来的锁');
      expect(h.calls).toEqual([]);
      expect(pageBusy(7)).toBe('任务:查回关');
      releasePage(other.token);
    });
    it(`${id}:不带 token(任务页「找蓝V」/ AI)→ 自己占(写着在干什么)、跑完放`, async () => {
      expect(await execute(id, inp, { caller: 'ai' })).toMatchObject({ ok: true });
      expect(h.seen.find((x) => x.fn === fn)?.busy).toBe(id === 'x.search.scroll' ? '滚动采搜索「min_faves:5 互关」' : '采 @he x.profile');
      expect(pageBusy(7)).toBeNull();
    });
  }

  it('⭐ 搜索:传给搜索函数的 token 就是持有网页的那把(带来的或自己占的)', async () => {
    await execute('x.search.scroll', scroll, { caller: 'ui' });
    expect(h.seen[0].tokenHeld).toBe(true);
    const ui = acquirePage(7, '操作台正在采集', 'ui');
    if (!ui.ok) throw new Error('应拿到');
    await execute('x.search.scroll', { ...scroll, ownToken: ui.token }, { caller: 'ui' });
    expect((h.calls[1][1][0] as { ownToken: string }).ownToken).toBe(ui.token);
    releasePage(ui.token);
  });

  it('搜索:给 wsId 也行(按 ws 找网页);配方名按搜索串对上;页数上限 40;没成 → failed', async () => {
    expect(await execute('x.search.scroll', { wsId: 'ws-1', q: '互关', wantPages: 2 }, { caller: 'inbox' })).toMatchObject({ ok: true });
    expect((h.calls[0][1][0] as { recipeName?: string; wcId: number }).recipeName).toBe('蓝V互关');
    expect(await execute('x.search.scroll', { wsId: 'ws-2', q: 'a', wantPages: 2 }, { caller: 'inbox' })).toMatchObject({ ok: false, kind: 'refused', why: 'X 网页没开' });
    expect(await execute('x.search.scroll', { ...scroll, wantPages: 41 }, { caller: 'inbox' })).toMatchObject({ ok: false, kind: 'invalid' });
    h.ret.collectSearchByScroll = { ok: false, why: '去不到搜索页', rateLimited: false, pages: [] };
    expect(await execute('x.search.scroll', scroll, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'failed', why: '去不到搜索页' });
  });
});

describe('存库 / 其余', () => {
  it('存推文 / 存人 / 核对落库都调同一份存库函数;核对落库回读 inDb', async () => {
    expect(await execute('x.tweet.save', { records: [{ id: '1' }], ctx: { source: 'x.home', wcId: 7 } }, { caller: 'ui' })).toMatchObject({ ok: true, value: { inserted: 3 } });
    expect(await execute('x.user.save', { records: [{ restId: '9' }], ctx: { listSource: 'followers', wcId: 7 } }, { caller: 'ui' })).toMatchObject({ ok: true, value: { updated: 5 } });
    const v = await execute('x.page.saveVerify', { tweets: [{ id: '1' }], tweetCtx: { source: 'x.home' }, users: [{ restId: '9' }], userCtx: { listSource: 'followers' } }, { caller: 'ui' });
    expect(v).toMatchObject({ ok: true, value: { inDb: ['t:1', 'u:9'], tweetsInserted: 3, usersInserted: 2, usersUpdated: 5 } });
    expect(h.calls.map(([n]) => n)).toEqual(['saveTweetBatch', 'saveUserBatch', 'saveTweetBatch', 'saveUserBatch']);
    /** 记录里只记摘要,不把整批原样存进 flow 库 */
    expect(h.rows[0].output).toEqual({ inserted: 3, updated: 1, failed: 0 });
  });

  it('参数不对 → invalid,不落库:空记录 / 空 listSource / 有人没 userCtx', async () => {
    for (const [id, inp] of [
      ['x.tweet.save', { records: [], ctx: { source: 'x' } }],
      ['x.user.save', { records: [{}], ctx: { listSource: '  ' } }],
      ['x.page.saveVerify', { tweets: [], users: [{ restId: '9' }] }],
      ['x.person.refresh', { record: { handle: 'he' } }],
      ['x.spot.lookup', { wsId: 'ws-1', kind: 'tweet' }],
    ] as const) expect(await execute(id, inp, { caller: 'inbox' }), id).toMatchObject({ ok: false, kind: 'invalid' });
    expect(h.calls).toEqual([]);
  });

  it('刷新资料:按读到它的网页认号;新人记账', async () => {
    expect(await execute('x.person.refresh', { record: { restId: '42', handle: 'he' }, wcId: 7 }, { caller: 'ui' })).toMatchObject({ ok: true, value: { isNew: true } });
    expect(h.calls.find(([n]) => n === 'savePersonRefresh')?.[1][1]).toMatchObject({ kind: 'ok', wc: 7 });
    expect(h.rows[0].subjectRef).toBe('x_author:42');
  });

  it('抽查轮询是状态轮询(只留 7 天);抽查查库没认出号也查(原样)', async () => {
    await execute('x.spot.poll', { wsId: 'ws-1', after: 3 }, { caller: 'ui' });
    expect(h.rows[0].keepDays).toBe(7);
    h.account = null;
    expect(await execute('x.spot.lookup', { wsId: 'ws-1', kind: 'person', handle: 'he' }, { caller: 'ui' })).toMatchObject({ ok: true });
    expect(h.calls.find(([n]) => n === 'lookupSpot')?.[1][0]).toBe('');
  });

  it('停止采集 / 扫互关倾向', async () => {
    expect(await execute('x.person.cancelCollect', { wcId: 7 }, { caller: 'ui' })).toMatchObject({ ok: true, value: { cancelled: true } });
    expect(await execute('x.intent.scan', {}, { caller: 'ui' })).toMatchObject({ ok: true, value: { scanned: 10 } });
  });
});

describe('接线守卫', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('这 10 个 op 在对照表里、switch 里没有 case', () => {
    const IPC = strip(read('src/modules/x/x-data-ipc.ts'));
    const table = IPC.slice(IPC.indexOf('const CAP_OF_OP'), IPC.indexOf('};', IPC.indexOf('const CAP_OF_OP')));
    const M: Record<string, string> = {
      searchScroll: 'x.search.scroll', spotCheckPoll: 'x.spot.poll', spotCheckLookup: 'x.spot.lookup', scanMutualIntent: 'x.intent.scan',
      collectPersonTab: 'x.person.collectTab', cancelPersonCollect: 'x.person.cancelCollect', refreshPerson: 'x.person.refresh',
      saveTweets: 'x.tweet.save', saveUsers: 'x.user.save', savePageVerify: 'x.page.saveVerify',
    };
    for (const [op, id] of Object.entries(M)) {
      expect(table, op).toMatch(new RegExp(`\\b${op}: '${id.replace(/\./g, '\\.')}'`));
      expect(IPC, op).not.toMatch(new RegExp(`case '${op}':`));
    }
  });
  it('人卡采主页把占住的锁带进去;搜索函数不再自己占锁(只核对带来的)', () => {
    /** 2026-10-26 人卡采主页搬到流程 x.person.collectRange:带着流程占住的那把锁去采每个标签页 */
    const F = strip(read('src/modules/x/x-flows.ts'));
    const blk = F.slice(F.indexOf("id: 'x.person.collectRange'"));
    expect(blk).toMatch(/const token = f\.held\.get\(pageResource\(wcId\)\) as string;/);
    expect(blk).toMatch(/f\.call\('x\.person\.collectTab', \{[\s\S]{0,200}ownToken: token,/);
    const S = strip(read('src/modules/x/x-search-scroll.ts'));
    expect(S).not.toMatch(/acquirePage\(/);
    expect(S).toMatch(/readonly ownToken: string;/);
  });
});
