/**
 * ⭐⭐⭐ 第 4 步 4b:四个流程搬到主进程(Module5-04,2026-10-26)
 *
 * 每一步用到的能力在这里换成假的(同 id 登记),只测流程本身:分类 / 循环到哪停 / 重试 / 叫停 / 占网页 / 带锁;
 * 每一步的记录挂在这次流程名下(run_id)。最后守卫:界面里不再有这些循环,只剩「开始 → 看进度 → 叫停」。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<[string, Record<string, unknown>]>,
  /** 每个假能力的回法:按 id 给一个函数 */
  impl: {} as Record<string, (i: Record<string, unknown>) => unknown>,
  cancelled: [] as number[],
}));
vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: () => undefined } }));
vi.mock('@modules/x/x-host-registry', () => ({ getXHostState: (ws: string) => (ws === 'ws-1' ? { wcId: 7, url: '' } : null), listXHostStates: () => new Map([['ws-1', { wcId: 7, url: '' }]]) }));
vi.mock('@modules/x/x-account-repo', () => ({ readWsAccount: async () => ({ wsId: 'ws-1', handle: 'me', restId: 'ME' }) }));
vi.mock('@modules/x/x-person-collect', () => ({ cancelPersonCollect: (wc: number) => { h.cancelled.push(wc); return true; }, personCollectProgress: () => null }));
vi.mock('@modules/x/x-ops-actions-repo', () => ({ readSettings: async () => ({ settings: { 'collect.live_page_cap': 4 } }) }));

const cap = await import('@platform/main/capability/capability');
const { registerXFlows } = await import('@modules/x/x-flows');
const { acquirePage, releasePage, pageBusy, holdsPage } = await import('@modules/x/x-page-lock');
const { _resetLocks } = await import('@platform/main/flow/resource-lock');
const { _resetFlows, stopFlow, listFlows } = await import('@platform/main/capability/flow');

/** 流程里会调的那几个能力:假的,同 id */
for (const id of ['x.engage.screen', 'x.person.defer', 'x.vpn.judge', 'x.recipe.list', 'x.search.scroll', 'x.intent.scan', 'x.person.collectTab', 'x.tweet.save']) {
  cap.defineCapability<Record<string, unknown>, unknown>({
    id, kind: 'input', describe: `假的 ${id}`, inputDoc: {}, parse: (raw) => (raw ?? {}) as Record<string, unknown>,
    run: async (i) => {
      h.calls.push([id, i]);
      const v = await h.impl[id]?.(i);
      if (v instanceof Error) throw cap.capFailed(v.message);
      return v;
    },
  });
}
registerXFlows();

beforeEach(() => {
  _resetLocks(); _resetFlows();
  h.rows.length = 0; h.calls.length = 0; h.impl = {}; h.cancelled.length = 0;
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('x.engage.screenBatch —— 互动先过一轮', () => {
  const people = [{ restId: '1', handle: 'a' }, { restId: '2', handle: 'b' }, { restId: '3', handle: 'c' }, { restId: '4', handle: 'd' }];
  it('有动静 → 进卡;没动静 → 放一放;放一放没记上 / 没采成 → 照样进卡(是我们没看到);每步挂在流程名下', async () => {
    h.impl['x.engage.screen'] = (i) => (i.restId === '1' ? { ok: true, active: true } : i.restId === '4' ? new Error('去不到主页') : { ok: true, active: false });
    h.impl['x.person.defer'] = (i) => (i.restId === '3' ? new Error('写不进去') : { days: 3 });
    const r = await cap.execute('x.engage.screenBatch', { wsId: 'ws-1', people }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: { active: [{ restId: '1' }], quiet: [{ restId: '2' }], unknown: [{ restId: '3' }, { restId: '4' }] } });
    const steps = h.rows.filter((x) => x.capability !== 'x.engage.screenBatch');
    expect(steps.length).toBe(4 + 2);
    for (const s of steps) expect(s.runId).toBe(r.callId);
  });
  it('叫停 → 剩下的照样进卡(当前那个做完)', async () => {
    let n = 0;
    h.impl['x.engage.screen'] = () => {
      n += 1;
      if (n === 2) stopFlow(listFlows('ws-1')[0].runId);
      return { ok: true, active: true };
    };
    const r = await cap.execute('x.engage.screenBatch', { wsId: 'ws-1', people }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: { active: [{ restId: '1' }, { restId: '2' }], unknown: [{ restId: '3' }, { restId: '4' }], stopped: true } });
  });
});

describe('x.vpn.judgeAll —— 判到判完', () => {
  it('5 条一批,判到 left = 0 就停;合计判了几条', async () => {
    let left = 12;
    h.impl['x.vpn.judge'] = () => { const n = Math.min(5, left); left -= n; return { judged: n, failed: 0, left }; };
    expect(await cap.execute('x.vpn.judgeAll', { wsId: 'ws-1' }, { caller: 'ui' })).toMatchObject({ ok: true, value: { judged: 12, failed: 0 } });
    expect(h.calls.filter(([id]) => id === 'x.vpn.judge').map(([, i]) => i.limit)).toEqual([5, 5, 5]);
  });
  it('某一批没成(已经有一轮在判 / Gemma 挂了)→ 停,说出原因;一条都判不动 → 停(防空转)', async () => {
    h.impl['x.vpn.judge'] = () => new Error('本机还没装 gemma4:12b');
    expect(await cap.execute('x.vpn.judgeAll', { wsId: 'ws-1' }, { caller: 'ui' })).toMatchObject({ ok: true, value: { judged: 0, note: '本机还没装 gemma4:12b' } });
    h.calls.length = 0;
    h.impl['x.vpn.judge'] = () => ({ judged: 0, failed: 0, left: 7 });
    await cap.execute('x.vpn.judgeAll', { wsId: 'ws-1' }, { caller: 'ui' });
    expect(h.calls).toHaveLength(1);
  });
});

describe('x.blueMutual.find —— 找蓝V', () => {
  it('配方 → 搜索(搜索串由配方算)→ 扫倾向', async () => {
    h.impl['x.recipe.list'] = () => [{ name: '蓝V互关', enabled: true, template: 'plain', keywords: ['互关'], resultType: 'latest', intervalMinutes: 60, sinceHours: 24 }];
    h.impl['x.search.scroll'] = () => ({ ok: true, totals: { pages: 3 } });
    h.impl['x.intent.scan'] = () => ({ scanned: 9 });
    const r = await cap.execute('x.blueMutual.find', { wsId: 'ws-1', pages: 3 }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: { ok: true, scroll: { totals: { pages: 3 } }, intentScan: { scanned: 9 } } });
    const s = h.calls.find(([id]) => id === 'x.search.scroll')![1];
    expect(s).toMatchObject({ wsId: 'ws-1', wantPages: 3 });
    expect(String(s.q)).toContain('互关');
    expect(h.calls.map(([id]) => id)).toEqual(['x.recipe.list', 'x.search.scroll', 'x.intent.scan']);
  });
  it('没有配方 → 说出来,不搜;搜索没成 → 不扫倾向', async () => {
    h.impl['x.recipe.list'] = () => [];
    expect(await cap.execute('x.blueMutual.find', { wsId: 'ws-1', pages: 3 }, { caller: 'ui' })).toMatchObject({ ok: true, value: { ok: false, why: '找不到配方「蓝V互关」—— 先建配方' } });
    h.impl['x.recipe.list'] = () => [{ name: '蓝V互关', enabled: true, template: 'plain', keywords: ['互关'], resultType: 'latest', intervalMinutes: 60 }];
    h.impl['x.search.scroll'] = () => new Error('去不到搜索页');
    expect(await cap.execute('x.blueMutual.find', { wsId: 'ws-1', pages: 3 }, { caller: 'ui' })).toMatchObject({ ok: true, value: { ok: false, why: '找人没成:去不到搜索页' } });
    expect(h.calls.map(([id]) => id)).not.toContain('x.intent.scan');
  });
});

describe('⭐⭐ x.person.collectRange —— 人卡当场采一段', () => {
  const inp = { wsId: 'ws-1', restId: '42', handle: 'he', range: 'month' };
  const run = (records: number, stopReason = '到时间起点了', rounds = 2) => ({ reached: true, records: Array.from({ length: records }, (_, k) => ({ id: String(k) })), pageInserted: 1, paging: { rounds, stopReason } });

  it('整段占着网页(锁上「运营正在采他的推文」);每个标签页带着流程那把锁去采;采到的整批再存', async () => {
    const seen: Array<[string | null, boolean]> = [];
    h.impl['x.person.collectTab'] = (i) => { seen.push([pageBusy(7), holdsPage(String(i.ownToken), 7)]); return run(3); };
    h.impl['x.tweet.save'] = () => ({ inserted: 2 });
    const r = await cap.execute('x.person.collectRange', inp, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true });
    expect(seen).toHaveLength(3);
    for (const s of seen) expect(s).toEqual(['运营正在采他的推文', true]);
    expect(h.calls.filter(([id]) => id === 'x.person.collectTab').map(([, i]) => [i.page, i.pageCap, i.attempt])).toEqual([['x.profile', 4, 1], ['x.withReplies', 4, 1], ['x.reposts', 4, 1]]);
    expect(h.calls.filter(([id]) => id === 'x.tweet.save')).toHaveLength(3);
    expect((r.ok ? r.value : {}) as { text: string }).toMatchObject({ text: expect.stringContaining('帖子 3 页 3 条(新 3)') });
    expect(pageBusy(7)).toBeNull();
  });

  it('⭐ 第一次翻页就被拒(没带鉴权头)→ 这一页重载再试一次', async () => {
    let n = 0;
    h.impl['x.person.collectTab'] = (i) => { n += 1; return i.page === 'x.profile' && i.attempt === 1 ? run(1, 'HTTP 403', 0) : run(2); };
    h.impl['x.tweet.save'] = () => ({ inserted: 0 });
    const r = await cap.execute('x.person.collectRange', inp, { caller: 'ui' });
    expect(n).toBe(4);
    expect(h.calls.filter(([id, i]) => id === 'x.person.collectTab' && i.page === 'x.profile').map(([, i]) => i.attempt)).toEqual([1, 2]);
    expect((r.ok ? r.value : {}) as { text: string }).toMatchObject({ text: expect.stringContaining('[重载后]') });
  });

  it('⭐ 叫停 → 通知正在翻页的那次停(cancelPersonCollect),剩下的标签页不采', async () => {
    h.impl['x.person.collectTab'] = () => { stopFlow(listFlows('ws-1')[0].runId); return run(1); };
    h.impl['x.tweet.save'] = () => ({ inserted: 1 });
    const r = await cap.execute('x.person.collectRange', inp, { caller: 'ui' });
    expect(h.cancelled).toEqual([7]);
    expect(h.calls.filter(([id]) => id === 'x.person.collectTab')).toHaveLength(1);
    expect((r.ok ? r.value : {}) as { text: string }).toMatchObject({ text: expect.stringContaining('人点了停止') });
  });

  it('网页被别人占着 → 整个流程 refused,一页都不采;同一个号已经在采 → refused', async () => {
    const other = acquirePage(7, '任务:查回关', 'timer');
    if (!other.ok) throw new Error('应拿到');
    const r = await cap.execute('x.person.collectRange', inp, { caller: 'ui' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    if (!r.ok) expect(r.why).toContain('任务:查回关');
    expect(h.calls).toEqual([]);
    releasePage(other.token);
    expect(await cap.execute('x.person.collectRange', { ...inp, range: 'week' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'invalid' });
  });
});

describe('接线守卫:界面里不再有这些循环', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('四个界面改成 runFlow;原来那几个循环里逐个调的 op 不见了', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['XTaskEngage.tsx', 'x.engage.screenBatch', /op: 'engageScreen'|op: 'deferPerson'/],
      ['XTaskVpn.tsx', 'x.vpn.judgeAll', /op: 'vpnJudge'/],
      ['XTaskBlueMutual.tsx', 'x.blueMutual.find', /op: 'searchScroll'|op: 'scanMutualIntent'|recipeToQuery\(/],
      ['XOpsPeople.tsx', 'x.person.collectRange', /op: 'collectPersonTab'|op: 'logPersonCollect'|op: 'saveTweets'/],
    ];
    for (const [f, flow, gone] of cases) {
      const src = strip(read(`src/modules/x/${f}`));
      expect(src, f).toMatch(new RegExp(`runFlow\\([\\s\\S]{0,300}'${flow.replace(/\./g, '\\.')}'`));
      expect(src, f).not.toMatch(gone);
    }
  });
  it('四个 op 在对照表里', () => {
    const IPC = strip(read('src/modules/x/x-data-ipc.ts'));
    for (const [op, id] of [['engageScreenBatch', 'x.engage.screenBatch'], ['vpnJudgeAll', 'x.vpn.judgeAll'], ['blueMutualFind', 'x.blueMutual.find'], ['personCollectRange', 'x.person.collectRange'], ['flowRuns', 'flow.runs'], ['flowStop', 'flow.stop']]) {
      expect(IPC, op).toMatch(new RegExp(`\\b${op}: '${id.replace(/\./g, '\\.')}'`));
    }
  });
});
