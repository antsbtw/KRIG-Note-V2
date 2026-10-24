/**
 * ⭐⭐⭐ 第 3 步第 3a 批:用网页的 9 个能力(Module5-04,2026-10-24)
 *
 * 判据:干活期间网页被执行器占着(锁上写着在干什么);网页被别人占着 → 三个入口都 refused、一步不动;
 * 「没动手」和「做了没成」分得开(查回关 / 关系采集原来都是同一个 ran:false / ok:false);
 * 定时器调 = auto,人点 / 收件箱 = manual;IPC 里这 9 个 op 只剩对照表转发;认号例外:不声明占网页。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  account: { wsId: 'ws-1', handle: 'me', restId: 'ME' } as Record<string, unknown> | null,
  calls: [] as Array<[string, unknown[]]>,
  /** 每个「干活」函数被调时,网页锁上写着什么 */
  heldAs: [] as Array<[string, string | null]>,
  ret: {} as Record<string, unknown>,
  queueBusy: false,
  noHost: false,
  /** 采互动被调那一刻,带进来的 token 是不是正持有网页 */
  tokenHeld: null as boolean | null,
}));

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
  getXDB: () => ({ query: async () => [[]] }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: () => undefined } }));
vi.mock('@modules/x/x-host-registry', () => ({ getXHostState: () => (h.noHost ? null : { wcId: 7, url: '' }), listXHostStates: () => new Map([['ws-1', { wcId: 7, url: '' }]]) }));

/** 「干活」函数:记参数 + 记下此刻网页锁上写着什么,回 h.ret[name] */
const work = (name: string, dflt: unknown) => async (...a: unknown[]): Promise<unknown> => {
  const { pageBusy, holdsPage } = await import('@modules/x/x-page-lock');
  if (name === 'collectEngagementWith') h.tokenHeld = typeof a[2] === 'string' && holdsPage(a[2], 7);
  h.calls.push([name, a]);
  h.heldAs.push([name, pageBusy(7)]);
  return name in h.ret ? h.ret[name] : dflt;
};
vi.mock('@modules/x/x-account-repo', () => ({
  readWsAccount: async () => h.account,
  identifyAccount: work('identifyAccount', { status: 'ok', account: { wsId: 'ws-1', handle: 'me', restId: 'ME' } }),
}));
vi.mock('@modules/x/x-follow-check', () => ({ FOLLOW_CHECK_BUSY: '任务:查回关', followCheckRunning: () => null, checkFollowBackOn: work('checkFollowBackOn', { ran: true, ok: true }) }));
vi.mock('@modules/x/x-relation-task', () => ({
  RELATION_BUSY: '任务:关系采集读现状', listRelationJobs: async () => [],
  startRelationTaskOn: work('startRelationTaskOn', { ok: true, created: true, jobId: 'J', plan: { target: { handle: 'me' }, self: true } }),
}));
vi.mock('@modules/x/x-ask-prepare', () => ({ prepareAskOn: work('prepareAskOn', { ok: true, plan: { kind: 'skip', why: '测试' } }) }));
vi.mock('@modules/x/x-vpn-run', () => ({
  prepareVpnOn: work('prepareVpnOn', { ok: true, plan: { kind: 'tweet' } }), readVpnOverview: async () => ({}), findVpnPostsWith: async () => ({ ok: true, runs: [] }), setVpnHuman: async () => undefined,
}));
vi.mock('@modules/x/x-engage-prepare', () => ({ screenEngageOn: work('screenEngageOn', { ok: true, active: true }), prepareEngageOn: work('prepareEngageOn', { ok: true }) }));
vi.mock('@modules/x/x-engage-thread', () => ({ loadEngageThread: work('loadEngageThread', { chain: [] }) }));
vi.mock('@modules/x/x-left-tweet', () => ({ readLeftTweet: work('readLeftTweet', { ok: true, tweet: { id: '9' } }) }));
vi.mock('@modules/x/x-engage-collect', () => ({ collectEngagementWith: work('collectEngagementWith', { ok: true, runs: [] }) }));
vi.mock('@modules/x/x-follow-queue', () => ({ followQueueStatus: () => (h.queueBusy ? { current: { handle: 'x' } } : {}) }));
vi.mock('@modules/x/x-collect-ports', () => ({ webviewPorts: () => ({ goto: work('goto', { ok: true }) }) }));

const { execute } = await import('@platform/main/capability/capability');
const { registerXCapabilities } = await import('@modules/x/x-capabilities');
const { acquirePage, releasePage, pageBusy } = await import('@modules/x/x-page-lock');
const { _resetLocks } = await import('@platform/main/flow/resource-lock');
registerXCapabilities();

const ws = { wsId: 'ws-1' };
/** [能力 id, 原 IPC op, 输入, 干活函数, 锁上写的用途, 期望返回(部分)] */
type Row = [string, string, Record<string, unknown>, string, string, unknown];
const PAGE: Row[] = [
  ['x.followCheck.run', 'followCheckRun', ws, 'checkFollowBackOn', '任务:查回关', { ran: true }],
  ['x.relation.start', 'relationStart', ws, 'startRelationTaskOn', '任务:关系采集读现状', { ok: true, jobId: 'J' }],
  ['x.ask.prepare', 'askPrepare', { ...ws, restId: '42', handle: 'he' }, 'prepareAskOn', '求关卡:准备 @he', { ok: true }],
  ['x.vpn.prepare', 'vpnPrepare', { ...ws, tweetId: '123' }, 'prepareVpnOn', '求助回复卡:准备 123', { ok: true }],
  ['x.engage.screen', 'engageScreen', { ...ws, restId: '42', handle: 'he' }, 'screenEngageOn', '互动:先过一轮 @he', { ok: true, active: true }],
  ['x.engage.thread', 'engageThread', { ...ws, restId: '42', tweetId: '123' }, 'loadEngageThread', '互动卡:读来龙去脉', { chain: [] }],
  ['x.left.read', 'leftTweet', ws, 'readLeftTweet', '读左边那条', { id: '9' }],
  ['x.engage.collect', 'engageCollect', ws, 'collectEngagementWith', '采互动(搜索)', { ok: true }],
];

beforeEach(() => {
  _resetLocks();
  h.rows.length = 0; h.calls.length = 0; h.heldAs.length = 0; h.ret = {}; h.queueBusy = false; h.noHost = false;
  h.account = { wsId: 'ws-1', handle: 'me', restId: 'ME' };
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('⭐⭐ 三个入口各调一次:同一个函数、干活时网页占着且写着在干什么、结束放掉、各记一行', () => {
  for (const [id, , input, fn, purpose, ret] of PAGE) {
    it(id, async () => {
      for (const caller of ['ui', 'timer', 'inbox'] as const) {
        expect(await execute(id, input, { caller }), `${id} ${caller}`).toMatchObject({ ok: true, value: ret });
      }
      expect(h.heldAs.filter(([n]) => n === fn).map(([, p]) => p)).toEqual([purpose, purpose, purpose]);
      expect(pageBusy(7)).toBeNull();
      expect(h.rows.map((r) => [r.caller, r.status])).toEqual([['ui', 'ok'], ['timer', 'ok'], ['inbox', 'ok']]);
    });
  }
});

describe('让路 / 前提', () => {
  it('⭐ 网页被别人占着 → 8 个都 refused(说出是谁占着),干活函数一次都没调', async () => {
    const other = acquirePage(7, '后台正在采 @x', 'timer');
    if (!other.ok) throw new Error('应拿到');
    for (const [id, , input] of PAGE) {
      const r = await execute(id, input, { caller: 'timer' });
      expect(r, id).toMatchObject({ ok: false, kind: 'refused' });
      if (!r.ok) expect(r.why, id).toContain('后台正在采 @x');
    }
    expect(h.calls).toEqual([]);
    expect(pageBusy(7)).toBe('后台正在采 @x');
    releasePage(other.token);
  });

  it('要认号的(求关卡 / 求助卡 / 来龙去脉 / 采互动):号没认出 → refused,不占网页', async () => {
    h.account = null;
    for (const id of ['x.ask.prepare', 'x.vpn.prepare', 'x.engage.thread', 'x.engage.collect']) {
      const row = PAGE.find((p) => p[0] === id)!;
      expect(await execute(id, row[2], { caller: 'ui' }), id).toMatchObject({ ok: false, kind: 'refused' });
    }
    expect(h.calls).toEqual([]);
  });

  it('求关卡:关注队列正在动作 → refused(原来在 prepareAsk 里查)', async () => {
    h.queueBusy = true;
    expect(await execute('x.ask.prepare', { ...ws, restId: '42', handle: 'he' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'refused', why: '关注队列正在动作' });
    expect(h.calls).toEqual([]);
  });

  it('⭐ 定时器调 = auto,人点 / 收件箱 = manual(查回关 / 关系采集记录里分得开)', async () => {
    await execute('x.followCheck.run', ws, { caller: 'timer' });
    await execute('x.followCheck.run', ws, { caller: 'ui' });
    await execute('x.relation.start', ws, { caller: 'timer' });
    await execute('x.relation.start', ws, { caller: 'inbox' });
    expect(h.calls.filter(([n]) => n === 'checkFollowBackOn').map(([, a]) => a[2])).toEqual(['auto', 'manual']);
    expect(h.calls.filter(([n]) => n === 'startRelationTaskOn').map(([, a]) => a[3])).toEqual(['auto', 'manual']);
  });

  it('⭐ 「没动手」和「做了没成」分得开:查回关 / 关系采集', async () => {
    h.ret.checkFollowBackOn = { ran: false, why: '正在查(ws-1)' };
    expect(await execute('x.followCheck.run', ws, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'refused' });
    h.ret.checkFollowBackOn = { ran: false, why: '翻页出错', failed: true };
    expect(await execute('x.followCheck.run', ws, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'failed' });
    h.ret.startRelationTaskOn = { ok: false, why: '正在查回关', refused: true };
    expect(await execute('x.relation.start', ws, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'refused' });
    h.ret.startRelationTaskOn = { ok: false, why: '没读到 @me 的主页资料' };
    expect(await execute('x.relation.start', ws, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'failed' });
  });

  it('采互动:搜索带着执行器占的那把锁进去(ownToken)—— 干活那一刻这个 token 正持有网页', async () => {
    h.tokenHeld = null;
    await execute('x.engage.collect', ws, { caller: 'timer' });
    expect(h.tokenHeld).toBe(true);
  });

  it('读左边那条:给了 open 先打开那条(锁上写明),打不开 → failed', async () => {
    expect(await execute('x.left.read', { ...ws, open: '555' }, { caller: 'ai' })).toMatchObject({ ok: true });
    expect(h.heldAs.find(([n]) => n === 'goto')?.[1]).toBe('读左边那条(先打开 555)');
    h.ret.goto = { ok: false, reason: '超时' };
    expect(await execute('x.left.read', { ...ws, open: '555' }, { caller: 'ai' })).toMatchObject({ ok: false, kind: 'failed' });
    expect(await execute('x.left.read', { ...ws, open: 'abc' }, { caller: 'ai' })).toMatchObject({ ok: false, kind: 'invalid' });
  });
});

describe('认号(例外:不声明占网页)', () => {
  it('网页被占着也能认(多半只读页面);pending → refused,failed → failed', async () => {
    const other = acquirePage(7, '后台正在采 @x', 'timer');
    if (!other.ok) throw new Error('应拿到');
    expect(await execute('x.account.identify', ws, { caller: 'ui' })).toMatchObject({ ok: true, value: { status: 'ok' } });
    expect(h.heldAs).toEqual([['identifyAccount', '后台正在采 @x']]);
    releasePage(other.token);
    h.ret.identifyAccount = { status: 'pending', reason: '等它空了再认' };
    expect(await execute('x.account.identify', ws, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'refused', why: '等它空了再认' });
    h.ret.identifyAccount = { status: 'failed', reason: '找不到数字 id' };
    expect(await execute('x.account.identify', ws, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'failed' });
    /** 网页没开 = 没动手(2026-10-24 Windows 真机:原来判成 failed),不去调 identifyAccount */
    h.noHost = true; h.heldAs.length = 0;
    expect(await execute('x.account.identify', ws, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'refused', why: 'X 网页没开,认不了号' });
    expect(h.heldAs).toEqual([]);
  });
});

describe('接线守卫', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const IPC = strip(read('src/modules/x/x-data-ipc.ts'));
  it('这 9 个 op 在对照表里、switch 里没有 case;认号的结果按徽章认的形状转(pending / failed 也是 ok 包着)', () => {
    const table = IPC.slice(IPC.indexOf('const CAP_OF_OP'), IPC.indexOf('};', IPC.indexOf('const CAP_OF_OP')));
    for (const [id, op] of [...PAGE.map((p) => [p[0], p[1]]), ['x.account.identify', 'identifyAccount']]) {
      expect(table, op).toMatch(new RegExp(`\\b${op}: '${id.replace(/\./g, '\\.')}'`));
      expect(IPC, op).not.toMatch(new RegExp(`case '${op}':`));
    }
    const fc = IPC.slice(IPC.indexOf('function fromCap'), IPC.indexOf('async function handle('));
    expect(fc).toMatch(/op === 'identifyAccount' && !r\.ok && r\.kind !== 'invalid'/);
    expect(fc).toMatch(/status: r\.kind === 'refused' \? 'pending' : 'failed', reason: r\.why/);
  });
  it('每天巡检三件事都走执行器(caller timer),不再直接调函数', () => {
    const D = strip(read('src/modules/x/x-daily-upkeep.ts'));
    for (const id of ['x.followCheck.run', 'x.relation.start', 'x.engage.collect']) {
      expect(D).toMatch(new RegExp(`execute\\('${id.replace(/\./g, '\\.')}', \\{ wsId \\}, \\{ caller: 'timer' \\}\\)`));
    }
    expect(D).not.toMatch(/checkFollowBack|startRelationTask|collectEngagement\(/);
  });
});
