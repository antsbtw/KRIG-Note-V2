/**
 * ⭐⭐⭐ 第 3 步第 1 批:读库类能力(Module5-04,2026-10-24)—— 26 个纯读的 IPC op 迁进能力目录
 *
 * 判据:每个能力从界面 / 定时器 / 收件箱调,结果一样、各记一行;要认号的,号没认出三个入口说同一句话;
 * 参数不对 → invalid(原来收件箱不校验);状态轮询类记录只留 7 天(用户 10-24「全记,只留 7 天」);
 * IPC 的 switch 里这 26 个 op 只剩转发(查对照表),不再自己校验 / 认号。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  account: { wsId: 'ws-1', handle: 'me', restId: 'ME' } as Record<string, unknown> | null,
  calls: [] as Array<[string, unknown[]]>,
}));
/** 每个被调的 repo 函数:记下参数,回一个能认出是谁的值 */
const fake = (name: string) => async (...a: unknown[]): Promise<unknown> => { h.calls.push([name, a]); return { from: name }; };
const fakeSync = (name: string) => (...a: unknown[]): unknown => { h.calls.push([name, a]); return { from: name }; };

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
  getXDB: () => ({ query: async () => [[]] }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: () => undefined } }));
vi.mock('@modules/x/x-host-registry', () => ({ getXHostState: () => ({ wcId: 7, url: '' }), listXHostStates: () => new Map() }));
vi.mock('@modules/x/x-account-repo', () => ({ readWsAccount: async (ws: string) => { h.calls.push(['readWsAccount', [ws]]); return h.account; } }));
vi.mock('@platform/main/db/search-recipe-repo', () => ({ listAllRecipes: fake('listAllRecipes') }));
vi.mock('@modules/x/x-cursor-repo', () => ({ readCursor: fake('readCursor') }));
vi.mock('@modules/x/x-collect-log-repo', () => ({ readOpsStatus: fake('readOpsStatus') }));
vi.mock('@modules/x/x-people-repo', () => ({
  readPeopleOverview: fake('readPeopleOverview'), queryPeople: fake('queryPeople'), readPerson: fake('readPerson'),
  readTagCatalog: fake('readTagCatalog'), readFriendCircle: fake('readFriendCircle'), readPersonTweets: fake('readPersonTweets'),
}));
vi.mock('@modules/x/x-task-blue-mutual', () => ({
  readBlueMutualOverview: fake('readBlueMutualOverview'), readCandidates: fake('readCandidates'),
  readFollowProgress: async (...a: unknown[]) => { h.calls.push(['readFollowProgress', a]); return { asked: 3 }; },
}));
vi.mock('@modules/x/x-ops-actions-repo', () => ({
  readSettings: async () => ({ settings: { 'follow.revisit_days': 7, 'follow.burst_size': 15 } }),
  readUnfollowGate: fake('readUnfollowGate'),
  readFollowGate: async () => ({ todayCount: 4, cap: 30, settings: { 'follow.revisit_days': 7, 'follow.burst_size': 15 } }),
}));
vi.mock('@modules/x/x-follow-check-repo', () => ({
  readAskStatuses: fake('readAskStatuses'), readLastFollowCheck: fake('readLastFollowCheck'), readPersonTimeline: fake('readPersonTimeline'),
}));
vi.mock('@modules/x/x-follow-check', () => ({ followCheckRunning: () => null }));
vi.mock('@modules/x/x-relation-task', () => ({ listRelationJobs: fake('listRelationJobs') }));
vi.mock('@modules/x/x-pace-repo', () => ({ readPaceViews: fake('readPaceViews') }));
vi.mock('@modules/x/x-list-member-repo', () => ({ readPersonLists: fake('readPersonLists') }));
vi.mock('@modules/x/x-vpn-run', () => ({ readVpnOverview: fake('readVpnOverview'), findVpnPostsWith: fake('findVpnPostsWith') }));
vi.mock('@modules/x/x-ask-draft', () => ({ readDraftRules: fake('readDraftRules') }));
vi.mock('@modules/x/x-follow-queue', () => ({ followQueueStatus: fakeSync('followQueueStatus') }));
vi.mock('@modules/x/x-bg-job-repo', () => ({
  listJobs: async (...a: unknown[]) => { h.calls.push(['listJobs', a]); return [{ status: 'done', restId: '1' }, { status: 'running', restId: '2' }]; },
}));
vi.mock('@modules/x/x-bg-runner', () => ({ bgRunnerStatus: () => ({ live: null }) }));
vi.mock('@modules/x/x-person-collect', () => ({ personCollectProgress: fakeSync('personCollectProgress') }));
vi.mock('@modules/x/x-engage-prepare', () => ({ prepareEngageOn: fake('prepareEngageOn') }));
vi.mock('@modules/x/x-engage-repo', () => ({ readEngageOverview: fake('readEngageOverview') }));
vi.mock('@modules/x/x-search-budget', () => ({ searchBudget: () => ({ usedPages: 0, freePages: 30 }) }));

const { execute, listCapabilities } = await import('@platform/main/capability/capability');
const { registerXCapabilities } = await import('@modules/x/x-capabilities');
registerXCapabilities();

const ws = { wsId: 'ws-1' };
/**
 * [能力 id, IPC op, 合法输入, 期望调到的函数, 期望参数(ME = 认出的号), 要不要认号, 是不是状态轮询]
 * ⭐ IPC op 列是「原来哪个 op」—— 守卫用它核对 IPC 对照表
 */
type Row = [string, string, Record<string, unknown>, string, unknown[], boolean, boolean];
const T: Row[] = [
  ['x.recipe.list', 'list', {}, 'listAllRecipes', [], false, false],
  ['x.cursor.read', 'readCursor', { scope: 'followers:me' }, 'readCursor', ['followers:me'], false, false],
  ['x.ops.status', 'opsStatus', ws, 'readOpsStatus', ['ME'], true, false],
  ['x.account.read', 'wsAccount', ws, 'readWsAccount', ['ws-1'], false, false],
  ['x.people.overview', 'peopleOverview', ws, 'readPeopleOverview', ['ME'], true, false],
  ['x.people.query', 'queryPeople', { ...ws, filter: { group: 'mutual' }, limit: 50, start: 0 }, 'queryPeople', ['ME', { scope: 'in', group: 'mutual', blueOnly: false, cnText: false, text: '', tag: '', intentOnly: false, sort: 'followersDesc' }, 50, 0], true, false],
  ['x.person.read', 'personDetail', { ...ws, restId: '42' }, 'readPerson', ['ME', '42'], true, false],
  ['x.tag.catalog', 'tagCatalog', {}, 'readTagCatalog', [], false, false],
  ['x.blueMutual.overview', 'blueMutualOverview', ws, 'readBlueMutualOverview', ['ME'], true, false],
  ['x.blueMutual.candidates', 'blueMutualCandidates', { ...ws, limit: 15 }, 'readCandidates', ['ME', 15], true, false],
  ['x.blueMutual.followProgress', 'blueMutualFollowProgress', ws, 'readFollowProgress', ['ME', 7], true, false],
  ['x.ask.followStatus', 'askFollowStatus', ws, 'readAskStatuses', ['ME', 7], true, false],
  ['x.relation.jobs', 'relationJobs', ws, 'listRelationJobs', ['ws-1'], false, true],
  ['x.pace.status', 'paceStatus', {}, 'readPaceViews', [], false, true],
  ['x.person.lists', 'personLists', { ...ws, restId: '42', limit: 20 }, 'readPersonLists', ['ME', '42', 20], true, true],
  ['x.person.timeline', 'personTimeline', { ...ws, restId: '42' }, 'readPersonTimeline', ['ME', '42'], true, false],
  ['x.vpn.overview', 'vpnOverview', ws, 'readVpnOverview', ['ME'], true, false],
  ['x.draft.rules', 'draftRules', { ...ws, mode: 'engage' }, 'readDraftRules', ['ME', 'engage'], true, false],
  ['x.followQueue.status', 'followQueueStatus', ws, 'followQueueStatus', ['ws-1'], false, true],
  ['x.bg.status', 'bgStatus', ws, 'listJobs', ['ws-1'], false, true],
  ['x.bg.jobs', 'bgListJobs', { ...ws, restId: '2' }, 'listJobs', ['ws-1'], false, true],
  ['x.settings.read', 'opsSettings', {}, '-', [], false, false],
  ['x.unfollow.gate', 'unfollowGate', { dayStartIso: '2026-10-24T04:00:00.000Z' }, 'readUnfollowGate', ['2026-10-24T04:00:00.000Z'], false, false],
  ['x.person.collectProgress', 'personCollectProgress', { wcId: 7 }, 'personCollectProgress', [7], false, true],
  ['x.person.friendCircle', 'friendCircle', { ...ws, restId: '42', limit: 30 }, 'readFriendCircle', ['ME', '42', 30], true, false],
  ['x.person.tweets', 'personTweets', { restId: '42', limit: 30 }, 'readPersonTweets', ['42', 30], false, false],
];

beforeEach(() => {
  h.rows.length = 0; h.calls.length = 0;
  h.account = { wsId: 'ws-1', handle: 'me', restId: 'ME' };
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('26 个读库能力都在目录里,都是 input 类,都有给 AI 读的说明', () => {
  it('目录里有,kind = input,describe / inputDoc 不空', () => {
    const cat = new Map(listCapabilities().map((c) => [c.id, c]));
    for (const [id] of T) {
      const c = cat.get(id);
      expect(c, id).toBeDefined();
      expect(c!.kind, id).toBe('input');
      expect(c!.describe.length, id).toBeGreaterThan(6);
    }
  });
});

describe('⭐⭐ 每个能力:三个入口各调一次,调到同一个函数、同样的参数、同样的结果,各记一行', () => {
  for (const [id, , input, fn, args, , probe] of T) {
    it(id, async () => {
      const out = [];
      for (const caller of ['ui', 'timer', 'inbox'] as const) out.push(await execute(id, input, { caller }));
      for (const r of out) expect(r.ok, `${id} ${JSON.stringify(r)}`).toBe(true);
      const shape = (x: unknown): string => JSON.stringify(x, (k, v) => (k === 'callId' || k === 'now' ? '<x>' : v));
      expect(new Set(out.map(shape)).size).toBe(1);
      if (fn !== '-') {
        const hits = h.calls.filter(([n]) => n === fn);
        expect(hits.length, fn).toBe(3);
        expect(hits[0][1].slice(0, args.length)).toEqual(args);
      }
      expect(h.rows.map((r) => [r.capability, r.caller, r.status])).toEqual(['ui', 'timer', 'inbox'].map((c) => [id, c, 'ok']));
      /** ⭐ 状态轮询:记录只留 7 天(用户 10-24);其余不设期限 */
      for (const r of h.rows) expect(r.keepDays, id).toBe(probe ? 7 : undefined);
    });
  }
});

describe('认号 / 参数', () => {
  it('⭐ 要认号的:号没认出 → 三个入口都 refused、同一句话;不去读库', async () => {
    h.account = null;
    for (const [id, , input, fn, , needsAcc] of T.filter((t) => t[5])) {
      const whys = new Set<string>();
      for (const caller of ['ui', 'timer', 'inbox'] as const) {
        const r = await execute(id, input, { caller });
        expect(r, id).toMatchObject({ ok: false, kind: 'refused' });
        if (!r.ok) whys.add(r.why);
        void needsAcc;
      }
      expect(whys.size, id).toBe(1);
      expect([...whys][0]).toContain('还没认出登录的是哪个号');
      expect(h.calls.filter(([n]) => n === fn), id).toEqual([]);
    }
  });

  it('参数不对 → invalid(原来收件箱一组只校验 wsId)', async () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['x.cursor.read', { scope: '  ' }],
      ['x.people.query', { ...ws, filter: {}, limit: 0, start: 0 }],
      /** 2026-10-24 Windows 真机发现:分组认不出原来跑进去才抛(记成 failed) */
      ['x.people.query', { ...ws, filter: { group: 'nope' }, limit: 10, start: 0 }],
      ['x.people.query', { ...ws, filter: { group: 'all', sort: 'random' }, limit: 10, start: 0 }],
      ['x.people.query', { ...ws, filter: {}, limit: 10, start: -1 }],
      ['x.person.read', { ...ws, restId: '' }],
      ['x.blueMutual.candidates', { ...ws, limit: 501 }],
      ['x.person.lists', { ...ws, restId: 'abc', limit: 20 }],
      ['x.person.timeline', { ...ws, restId: 'abc' }],
      ['x.unfollow.gate', { dayStartIso: '昨天' }],
      ['x.person.collectProgress', { wcId: 'x' }],
      ['x.person.friendCircle', { ...ws, restId: '42', limit: 201 }],
      ['x.person.tweets', { restId: '42', limit: 0 }],
      ['x.ops.status', {}],
    ];
    for (const [id, input] of bad) expect(await execute(id, input, { caller: 'inbox' }), `${id} ${JSON.stringify(input)}`).toMatchObject({ ok: false, kind: 'invalid' });
  });

  it('拼起来的返回值和原来 IPC 一样(followProgress 带今天关注数 / bgStatus 带各状态计数 / bgJobs 按人筛)', async () => {
    expect(await execute('x.blueMutual.followProgress', ws, { caller: 'ui' })).toMatchObject({ ok: true, value: { asked: 3, today: 4, cap: 30, burst: 15 } });
    expect(await execute('x.bg.status', ws, { caller: 'ui' })).toMatchObject({ ok: true, value: { live: null, counts: { done: 1, running: 1, queued: 0 } } });
    expect(await execute('x.bg.jobs', { ...ws, restId: '2' }, { caller: 'ui' })).toMatchObject({ ok: true, value: [{ restId: '2' }] });
    expect(await execute('x.ask.followStatus', ws, { caller: 'ui' })).toMatchObject({ ok: true, value: { running: false, revisitDays: 7 } });
  });
});

describe('接线守卫:IPC 只剩转发', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const IPC = strip(read('src/modules/x/x-data-ipc.ts'));

  it('这 26 个 op 在对照表里、对到对的能力;switch 里不再有它们的 case', () => {
    const table = IPC.slice(IPC.indexOf('const CAP_OF_OP'), IPC.indexOf('};', IPC.indexOf('const CAP_OF_OP')));
    expect(table.length).toBeGreaterThan(200);
    for (const [id, op] of T) {
      expect(table, op).toMatch(new RegExp(`\\b${op}: '${id.replace(/\./g, '\\.')}'`));
      expect(IPC, op).not.toMatch(new RegExp(`case '${op}':`));
    }
  });

  it('对照表在 switch 之前查,查到就 execute(caller ui)', () => {
    const h0 = IPC.indexOf('async function handle(');
    const body = IPC.slice(h0, IPC.indexOf('switch (p?.op)', h0));
    expect(body).toMatch(/const capId = CAP_OF_OP\[[^\]]+\];\s*if \(capId\) return fromCap\(await execute\(capId, p, \{ caller: 'ui' \}\)\);/);
  });
});
