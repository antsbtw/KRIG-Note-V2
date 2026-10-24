/**
 * ⭐⭐⭐ 第 3 步第 2 批:改自己的库(Module5-04,2026-10-24)—— 15 个 IPC op 迁进能力目录,类别 control
 *
 * 判据同第 1 批:三个入口调到同一个函数、同样的参数、同样的结果,各记一行(带 subject);要认号的号没认出一律 refused;
 * 参数不对 → invalid(改设置原来不校验就写,写进去才抛);状态不对(暂停一个已完成的任务)→ refused,不动库;
 * IPC 里这 15 个 op 只剩对照表转发。
 * ⚠️ 不在这批:关注队列(加了就会去 X 上点关注 = 对外动作,放输出类那批)、界面流程上报 log*(第 4 步整个搬走)。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  account: { wsId: 'ws-1', handle: 'me', restId: 'ME' } as Record<string, unknown> | null,
  calls: [] as Array<[string, unknown[]]>,
  job: { id: 'J1', status: 'running' } as Record<string, unknown> | null,
}));
const fake = (name: string, ret: unknown = undefined) => async (...a: unknown[]): Promise<unknown> => { h.calls.push([name, a]); return ret; };

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
  getXDB: () => ({ query: async () => [[]] }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: (e: unknown) => { h.calls.push(['trace', [e]]); } } }));
vi.mock('@modules/x/x-host-registry', () => ({ getXHostState: () => ({ wcId: 7, url: '' }), listXHostStates: () => new Map() }));
vi.mock('@modules/x/x-account-repo', () => ({ readWsAccount: async () => h.account }));
vi.mock('@platform/main/db/search-recipe-repo', () => ({
  listAllRecipes: async () => [], upsertRecipe: fake('upsertRecipe', { id: 'R1', name: '配方' }), deleteRecipe: fake('deleteRecipe'),
}));
vi.mock('@modules/x/x-cursor-repo', () => ({ readCursor: async () => null, saveCursor: fake('saveCursor'), clearCursor: fake('clearCursor') }));
vi.mock('@modules/x/x-people-repo', async () => ({
  ...(await vi.importActual<object>('@modules/x/x-people-repo')),
  setExcluded: fake('setExcluded'), setTags: fake('setTags', ['客户', '朋友']), setMutualIntent: fake('setMutualIntent'),
}));
vi.mock('@modules/x/x-vpn-run', () => ({ readVpnOverview: async () => ({}), findVpnPostsWith: async () => ({}), setVpnHuman: fake('setVpnHuman') }));
vi.mock('@modules/x/x-defer-repo', () => ({ DEFER_DAYS: 3, recordDefer: fake('recordDefer') }));
vi.mock('@modules/x/x-ask-draft', () => ({ readDraftRules: async () => [], setDraftRuleActive: fake('setDraftRuleActive') }));
vi.mock('@modules/x/x-bg-job-repo', () => ({
  listJobs: async () => [], createJob: fake('createJob', { id: 'J9', created: true }),
  readJob: async (id: string) => { h.calls.push(['readJob', [id]]); return h.job; },
  setJobStatus: fake('setJobStatus'), deleteJob: fake('deleteJob'),
}));
vi.mock('@modules/x/x-bg-runner', () => ({ bgRunnerStatus: () => ({}), kickBgRunner: () => { h.calls.push(['kickBgRunner', []]); } }));
vi.mock('@modules/x/x-ops-actions-repo', async () => ({
  ...(await vi.importActual<object>('@modules/x/x-ops-actions-repo')),
  writeSetting: fake('writeSetting'),
}));

const { execute, listCapabilities } = await import('@platform/main/capability/capability');
const { registerXCapabilities } = await import('@modules/x/x-capabilities');
registerXCapabilities();

const ws = { wsId: 'ws-1' };
/** [能力 id, 原 IPC op, 输入, 调到的函数, 期望参数, 要认号, subject, 期望返回(部分)] */
type Row = [string, string, Record<string, unknown>, string, unknown[], boolean, string | undefined, unknown];
const T: Row[] = [
  ['x.recipe.upsert', 'upsert', { recipe: { name: '配方', keywords: ['a'] } }, 'upsertRecipe', [{ name: '配方', keywords: ['a'] }], false, undefined, { id: 'R1' }],
  ['x.recipe.delete', 'delete', { recipeId: 'R1' }, 'deleteRecipe', ['R1'], false, 'search_recipe:R1', { deleted: 'R1' }],
  ['x.cursor.save', 'saveCursor', { cursor: { scope: 'followers:me', exhausted: false } }, 'saveCursor', [{ scope: 'followers:me', exhausted: false }], false, undefined, { saved: 'followers:me' }],
  ['x.cursor.clear', 'clearCursor', { scope: 'followers:me' }, 'clearCursor', ['followers:me'], false, undefined, { cleared: 'followers:me' }],
  ['x.person.setExcluded', 'setExcluded', { restId: '42', excluded: true, reason: '机器人' }, 'setExcluded', ['42', true, '机器人'], false, 'x_author:42', { restId: '42', excluded: true }],
  ['x.person.setTags', 'setTags', { restId: '42', tags: ['客户', '朋友'] }, 'setTags', ['42', ['客户', '朋友']], false, 'x_author:42', ['客户', '朋友']],
  ['x.vpn.mark', 'vpnHuman', { ...ws, tweetId: '123', human: 'accept' }, 'setVpnHuman', ['ME', '123', 'accept'], true, 'x_tweet:123', true],
  ['x.person.defer', 'deferPerson', { ...ws, restId: '42', mode: 'engage', tweetId: '123' }, 'recordDefer', ['ME', '42', 'engage', '123'], true, 'x_author:42', { days: 3 }],
  ['x.draft.setRuleActive', 'draftRuleActive', { ...ws, id: 'rule1', active: false }, 'setDraftRuleActive', ['ME', 'rule1', false], true, undefined, true],
  ['x.person.setMutualIntent', 'setMutualIntent', { restId: '42', value: true }, 'setMutualIntent', ['42', true], false, 'x_author:42', { restId: '42', value: true }],
  ['x.bg.createJob', 'bgCreateJob', { restId: '42', handle: 'he', ...ws, range: 'year' }, 'createJob', [{ restId: '42', handle: 'he', wsId: 'ws-1', range: 'year', kind: undefined }], false, 'x_author:42', { id: 'J9', created: true }],
  ['x.bg.pauseJob', 'bgPauseJob', { id: 'J1' }, 'setJobStatus', ['J1', 'paused'], false, 'x_bg_job:J1', { id: 'J1' }],
  ['x.bg.resumeJob', 'bgResumeJob', { id: 'J1' }, 'setJobStatus', ['J1', 'queued'], false, 'x_bg_job:J1', { id: 'J1' }],
  ['x.bg.cancelJob', 'bgCancelJob', { id: 'J1' }, 'deleteJob', ['J1'], false, 'x_bg_job:J1', { id: 'J1' }],
  ['x.settings.write', 'setOpsSetting', { key: 'unfollow.daily_cap', value: 40 }, 'writeSetting', ['unfollow.daily_cap', 40], false, undefined, { key: 'unfollow.daily_cap', value: 40 }],
];

beforeEach(() => {
  h.rows.length = 0; h.calls.length = 0;
  h.account = { wsId: 'ws-1', handle: 'me', restId: 'ME' };
  h.job = { id: 'J1', status: 'running' };
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('15 个改库能力都在目录里,类别 control', () => {
  it('目录里有,kind = control,说明不空', () => {
    const cat = new Map(listCapabilities().map((c) => [c.id, c]));
    for (const [id] of T) {
      expect(cat.get(id), id).toBeDefined();
      expect(cat.get(id)!.kind, id).toBe('control');
      expect(cat.get(id)!.describe.length, id).toBeGreaterThan(6);
    }
  });
});

describe('⭐⭐ 三个入口各调一次:同一个函数、同样参数、同样结果,各记一行带 subject', () => {
  for (const [id, , input, fn, args, , subject, ret] of T) {
    it(id, async () => {
      if (id === 'x.bg.resumeJob') h.job = { id: 'J1', status: 'paused' };
      const out = [];
      for (const caller of ['ui', 'timer', 'inbox'] as const) out.push(await execute(id, input, { caller }));
      for (const r of out) expect(r, id).toMatchObject({ ok: true, value: ret });
      const hits = h.calls.filter(([n]) => n === fn);
      expect(hits.length, fn).toBe(3);
      expect(hits[0][1]).toEqual(args);
      expect(h.rows.map((r) => [r.caller, r.status, r.stepType, r.subjectRef])).toEqual(['ui', 'timer', 'inbox'].map((c) => [c, 'ok', 'control', subject]));
      for (const r of h.rows) expect(r.keepDays, id).toBeUndefined();
    });
  }
});

describe('认号 / 参数 / 状态', () => {
  it('要认号的:号没认出 → refused,不动库', async () => {
    h.account = null;
    for (const [id, , input, fn] of T.filter((t) => t[5])) {
      expect(await execute(id, input, { caller: 'ui' }), id).toMatchObject({ ok: false, kind: 'refused' });
      expect(h.calls.filter(([n]) => n === fn), id).toEqual([]);
    }
  });

  it('参数不对 → invalid,不动库(改设置原来不校验,写进去才抛)', async () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['x.recipe.upsert', { recipe: { name: '  ' } }],
      ['x.recipe.delete', {}],
      ['x.cursor.save', { cursor: { scope: '' } }],
      ['x.cursor.clear', { scope: ' ' }],
      ['x.person.setExcluded', { restId: '42', excluded: 'yes' }],
      ['x.person.setTags', { restId: '42', tags: ['a', 3] }],
      ['x.vpn.mark', { ...ws, tweetId: '123', human: 'maybe' }],
      ['x.person.defer', { ...ws, restId: 'abc' }],
      ['x.draft.setRuleActive', { ...ws, id: 'r', active: 1 }],
      ['x.person.setMutualIntent', { restId: '', value: true }],
      ['x.bg.createJob', { restId: '42', handle: 'he', ...ws, range: 'month' }],
      ['x.bg.createJob', { restId: '42', handle: 'he', ...ws, range: 'year', kind: 'lists' }],
      ['x.bg.pauseJob', {}],
      ['x.settings.write', { key: 'no.such.key', value: 1 }],
      ['x.settings.write', { key: 'unfollow.daily_cap', value: -5 }],
    ];
    for (const [id, input] of bad) expect(await execute(id, input, { caller: 'inbox' }), `${id} ${JSON.stringify(input)}`).toMatchObject({ ok: false, kind: 'invalid' });
    expect(h.calls.filter(([n]) => !['readJob', 'trace'].includes(n))).toEqual([]);
  });

  it('⭐ 状态不对 → refused,不动库:暂停已完成的 / 继续没暂停的 / 任务不存在', async () => {
    h.job = { id: 'J1', status: 'done' };
    const a = await execute('x.bg.pauseJob', { id: 'J1' }, { caller: 'ui' });
    expect(a).toMatchObject({ ok: false, kind: 'refused' });
    if (!a.ok) expect(a.why).toContain('done');
    h.job = { id: 'J1', status: 'running' };
    expect(await execute('x.bg.resumeJob', { id: 'J1' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'refused' });
    h.job = null;
    expect(await execute('x.bg.pauseJob', { id: 'J1' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'refused' });
    expect(h.calls.filter(([n]) => n === 'setJobStatus')).toEqual([]);
  });

  it('继续后台任务会叫醒后台调度;建任务留痕', async () => {
    h.job = { id: 'J1', status: 'paused' };
    await execute('x.bg.resumeJob', { id: 'J1' }, { caller: 'ui' });
    expect(h.calls.map(([n]) => n)).toContain('kickBgRunner');
    await execute('x.bg.createJob', { restId: '42', handle: 'he', ...ws, range: 'all', kind: 'lists' }, { caller: 'ui' });
    expect(h.calls.some(([n, a]) => n === 'trace' && (a[0] as { event?: string }).event === 'x-bg-job-create')).toBe(true);
  });
});

describe('接线守卫:IPC 只剩转发', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const IPC = strip(read('src/modules/x/x-data-ipc.ts'));
  it('这 15 个 op 在对照表里、对到对的能力;switch 里不再有它们的 case', () => {
    const table = IPC.slice(IPC.indexOf('const CAP_OF_OP'), IPC.indexOf('};', IPC.indexOf('const CAP_OF_OP')));
    for (const [id, op] of T) {
      expect(table, op).toMatch(new RegExp(`\\b${op}: '${id.replace(/\./g, '\\.')}'`));
      expect(IPC, op).not.toMatch(new RegExp(`case '${op}':`));
    }
  });
});
