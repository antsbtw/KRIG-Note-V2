/**
 * ⭐⭐⭐ 第 4 步 4a:业务界面不再直接驱动网页(Module5-04,2026-10-26)
 *
 *   x.page.open       左边打开某人主页 / 某条推文(原来三张卡片各自 webDomInvoke goto,只问不占)
 *   x.person.verify   点人核对:开他主页读资料、关系写回库(原来 renderer 里 harvest + refreshPerson)
 *   x.person.unfollow 取关:闸门 → 去主页 → 点 → 记动作 → 同一把锁里核对;没成 → 这个号的取关暂停(主进程一份)
 *   x.unfollow.halt / x.unfollow.resume   看 / 解除「取关已暂停」
 *
 * 顺带修的两个旧问题:
 *   ① 任务页取关后的核对没占网页(取关占着,核对时锁已经放了)→ 现在同一把锁里做完
 *   ② 「异常即停」人卡和任务页各管各的(React 状态)→ 按 workspace 记在主进程,两边看同一份
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<[string, unknown[]]>,
  /** 每次碰网页那一刻,锁上写着什么 */
  heldAs: [] as Array<[string, string | null]>,
  ret: {} as Record<string, unknown>,
  gate: { allowed: true, todayCount: 3, cap: 50 } as Record<string, unknown>,
}));

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
  getXDB: () => ({ query: async () => [[]] }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: () => undefined } }));
vi.mock('@modules/x/x-host-registry', () => ({ getXHostState: (ws: string) => (ws.startsWith('ws-') ? { wcId: ws === 'ws-2' ? 8 : 7, url: '' } : null), listXHostStates: () => new Map([['ws-1', { wcId: 7, url: '' }], ['ws-2', { wcId: 8, url: '' }]]) }));
const page = (name: string, dflt: unknown) => async (...a: unknown[]): Promise<unknown> => {
  const { pageBusy } = await import('@modules/x/x-page-lock');
  h.calls.push([name, a]);
  h.heldAs.push([name, pageBusy(7)]);
  return name in h.ret ? h.ret[name] : dflt;
};
vi.mock('@modules/x/x-collect-ports', () => ({
  webviewPorts: () => ({
    goto: page('goto', { ok: true }),
    runScript: page('runScript', { done: true, state: 'unfollowed' }),
    harvest: page('harvest', { items: [{ url: 'https://x.com/i/api/graphql/x/UserByScreenName', text: '{}' }] }),
  }),
}));
vi.mock('@modules/x/x-user-audit', () => ({ auditUserPayload: () => ({ items: [{ restId: '42', handle: 'he' }] }) }));
vi.mock('@modules/x/x-person-refresh', async () => ({
  ...(await vi.importActual<object>('@modules/x/x-person-refresh')),
  pickProfileUser: (users: Array<{ restId: string }>, _h: string, id?: string) => users.find((u) => !id || u.restId === id) ?? null,
}));
vi.mock('@modules/x/x-user-repo', () => ({ refreshPerson: page('refreshPerson', { isNew: false, stale: false, changes: ['我关注他:是 → 否'], relation: {} }) }));
vi.mock('@modules/x/x-account-repo', () => ({ readWsAccount: async () => ({ wsId: 'ws-1', handle: 'me', restId: 'ME' }), accountForWrite: async () => ({ kind: 'ok', restId: 'ME', handle: 'me' }) }));
vi.mock('@modules/x/x-ops-actions-repo', async () => ({
  ...(await vi.importActual<object>('@modules/x/x-ops-actions-repo')),
  readUnfollowGate: async () => h.gate,
  appendAction: async (e: unknown) => { h.calls.push(['appendAction', [e]]); },
}));
/** 第 5 步起刷新落库一份(savePersonRefresh)—— 转给上面的假 refreshPerson,照样看得到「写库那一刻锁上写着什么」 */
vi.mock('@modules/x/x-save-batch', () => ({
  logCollect: async () => undefined, saveTweetBatch: async () => ({}), saveUserBatch: async () => ({}),
  savePersonRefresh: async (rec: unknown, acc: unknown) => (await import('@modules/x/x-user-repo')).refreshPerson(rec as never, acc as never),
}));

const { execute } = await import('@platform/main/capability/capability');
const { registerXCapabilities } = await import('@modules/x/x-capabilities');
const { acquirePage, releasePage, pageBusy } = await import('@modules/x/x-page-lock');
const { _resetLocks } = await import('@platform/main/flow/resource-lock');
const { _resetUnfollowHalt } = await import('@modules/x/x-person-act');
registerXCapabilities();

const who = { wsId: 'ws-1', restId: '42', handle: 'he' };
beforeEach(() => {
  _resetLocks(); _resetUnfollowHalt();
  h.rows.length = 0; h.calls.length = 0; h.heldAs.length = 0; h.ret = {};
  h.gate = { allowed: true, todayCount: 3, cap: 50 };
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('x.page.open —— 左边打开某人主页 / 某条推文', () => {
  it('打开时占着网页(锁上写明),打开后放;网页被占着 → refused 不跳', async () => {
    expect(await execute('x.page.open', { wsId: 'ws-1', page: 'status', tweetId: '123' }, { caller: 'ui' })).toMatchObject({ ok: true });
    expect(h.heldAs).toEqual([['goto', '打开推文 123']]);
    expect(h.calls[0][1]).toEqual(['x.status', { tweetId: '123' }]);
    expect(await execute('x.page.open', { wsId: 'ws-1', page: 'profile', handle: 'he' }, { caller: 'ai' })).toMatchObject({ ok: true });
    expect(h.calls[1][1]).toEqual(['x.profile', { handle: 'he' }]);
    expect(pageBusy(7)).toBeNull();
    const other = acquirePage(7, '任务:查回关', 'timer');
    if (!other.ok) throw new Error('应拿到');
    const r = await execute('x.page.open', { wsId: 'ws-1', page: 'profile', handle: 'he' }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    if (!r.ok) expect(r.why).toContain('任务:查回关');
    expect(h.calls).toHaveLength(2);
    releasePage(other.token);
  });
  it('参数不对 → invalid;没打开 → failed', async () => {
    expect(await execute('x.page.open', { wsId: 'ws-1', page: 'status' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'invalid' });
    expect(await execute('x.page.open', { wsId: 'ws-1', page: 'home' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'invalid' });
    h.ret.goto = { ok: false, reason: '超时' };
    expect(await execute('x.page.open', { wsId: 'ws-1', page: 'status', tweetId: '1' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'failed' });
  });
});

describe('x.person.verify —— 点人核对', () => {
  it('开他主页读资料 → 写回库(按这个网页认号);全程占着网页;返回 same / changed / new', async () => {
    const r = await execute('x.person.verify', who, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: { kind: 'changed', changes: ['我关注他:是 → 否'] } });
    expect(h.heldAs.map(([n, b]) => [n, b])).toEqual([['harvest', '核对 @he'], ['refreshPerson', '核对 @he']]);
    expect(h.rows[0].subjectRef).toBe('x_author:42');
  });
  it('没读到资料 → 返回 miss(原样给界面看,不算异常)', async () => {
    h.ret.harvest = { items: [] };
    expect(await execute('x.person.verify', who, { caller: 'ui' })).toMatchObject({ ok: true, value: { kind: 'miss' } });
  });
});

describe('⭐⭐ x.person.unfollow —— 取关', () => {
  it('闸门 → 去主页 → 点 → 记动作 → ⭐ 同一把锁里核对(原来任务页核对时锁已经放了)', async () => {
    const r = await execute('x.person.unfollow', { ...who, reason: '求关 7 天没回关' }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: { done: true, verify: { kind: 'changed' } } });
    expect(h.heldAs.map(([n]) => n)).toEqual(['goto', 'runScript', 'harvest', 'refreshPerson']);
    expect(new Set(h.heldAs.map(([, b]) => b))).toEqual(new Set(['取关 @he']));
    const act = h.calls.find(([n]) => n === 'appendAction')![1][0] as Record<string, unknown>;
    expect(act).toMatchObject({ action: 'unfollow', targetRestId: '42', result: 'ok', reason: '求关 7 天没回关', wsId: 'ws-1' });
    expect(pageBusy(7)).toBeNull();
  });

  it('本来就没关注 → 不算异常,照样核对把库纠正', async () => {
    h.ret.runScript = { done: false, state: 'not-following' };
    expect(await execute('x.person.unfollow', who, { caller: 'ui' })).toMatchObject({ ok: true, value: { done: false, state: 'not-following', verify: { kind: 'changed' } } });
  });

  it('⭐⭐ 没成 → failed(带哪步没成)+ 这个号的取关暂停;两个界面看同一份;恢复后才能接着取关', async () => {
    h.ret.runScript = { done: false, state: 'no-switch' };
    const r = await execute('x.person.unfollow', who, { caller: 'ui' });
    expect(r).toMatchObject({ ok: false, kind: 'failed', partial: { done: false, state: 'no-switch' } });
    expect(h.calls.find(([n]) => n === 'appendAction')![1][0]).toMatchObject({ result: 'failed' });
    /** 停了:不核对(没成就别再动网页) */
    expect(h.calls.map(([n]) => n)).not.toContain('harvest');
    const halt = await execute('x.unfollow.halt', { wsId: 'ws-1' }, { caller: 'ui' });
    expect(halt).toMatchObject({ ok: true, value: { halted: expect.stringContaining('@he') } });
    h.calls.length = 0;
    const again = await execute('x.person.unfollow', { ...who, restId: '43', handle: 'she' }, { caller: 'ui' });
    expect(again).toMatchObject({ ok: false, kind: 'refused' });
    if (!again.ok) expect(again.why).toContain('取关已暂停');
    expect(h.calls).toEqual([]);
    /** 别的号不受影响 */
    expect(await execute('x.unfollow.halt', { wsId: 'ws-2' }, { caller: 'ui' })).toMatchObject({ ok: true, value: { halted: null } });
    expect(await execute('x.unfollow.resume', { wsId: 'ws-1' }, { caller: 'ui' })).toMatchObject({ ok: true });
    h.ret.runScript = { done: true, state: 'unfollowed' };
    expect(await execute('x.person.unfollow', { ...who, restId: '43', handle: 'she' }, { caller: 'ui' })).toMatchObject({ ok: true });
  });

  it('超过平时的量:照做,只带提醒(用户 10-21「我的任务我自己控制」)', async () => {
    h.gate = { allowed: false, reason: '今天已取关 50 个(平时上限 50)', todayCount: 50, cap: 50 };
    expect(await execute('x.person.unfollow', who, { caller: 'ui' })).toMatchObject({ ok: true, value: { done: true, warning: '今天已取关 50 个(平时上限 50)' } });
  });

  it('是对外动作:AI / 收件箱 refused,一步不动', async () => {
    for (const caller of ['ai', 'inbox'] as const) expect(await execute('x.person.unfollow', who, { caller })).toMatchObject({ ok: false, kind: 'refused' });
    expect(h.calls).toEqual([]);
  });
});

describe('接线守卫:业务界面不再直接驱动网页', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('⭐ 除了操作台(测试后台,将来隐藏),X 的界面文件里没有 webDomInvoke', () => {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const dir = resolve(__dirname, '../../src/modules/x');
    const ui = readdirSync(dir).filter((f: string) => f.endsWith('.tsx') && f !== 'XConsole.tsx');
    expect(ui.length).toBeGreaterThan(10);
    const hits = ui.filter((f: string) => /webDomInvoke/.test(strip(readFileSync(resolve(dir, f), 'utf8'))));
    expect(hits).toEqual([]);
    expect(strip(read('src/modules/x/x-unfollow-run.ts'))).not.toMatch(/webDomInvoke/);
  });
  it('取关 / 核对 / 打开页面的 op 都在对照表里', () => {
    const IPC = strip(read('src/modules/x/x-data-ipc.ts'));
    const table = IPC.slice(IPC.indexOf('const CAP_OF_OP'), IPC.indexOf('};', IPC.indexOf('const CAP_OF_OP')));
    for (const [op, id] of [['pageOpen', 'x.page.open'], ['personVerify', 'x.person.verify'], ['personUnfollow', 'x.person.unfollow'], ['unfollowHalt', 'x.unfollow.halt'], ['unfollowResume', 'x.unfollow.resume']]) {
      expect(table, op).toMatch(new RegExp(`\\b${op}: '${id.replace(/\./g, '\\.')}'`));
    }
  });
});
