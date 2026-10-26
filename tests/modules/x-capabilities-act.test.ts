/**
 * ⭐⭐⭐ 第 3 步第 4 批:AI 类 + 对外动作(Module5-04,2026-10-25)
 *
 * 判据:对外动作(求关发送 / 关注队列 加入 / 继续)只接受人在界面上点的(ui)和定时器(timer),
 *   AI / 收件箱调用一律 refused「要人批复」,一步不动;暂停 / 清空不是对外动作,谁都能调;
 *   求关做了一半(赞成了留言没成)→ failed,但卡片照样拿到哪步成了(partial);闸门挡下 → refused;
 *   判求助帖「已经有一轮在判」→ refused;草拟只给帖子 id 也能到库里读正文;
 *   IPC switch 里只剩底座 4 个 + 界面流程上报 3 个;收件箱老指令都走执行器。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<[string, unknown[]]>,
  account: { wsId: 'ws-1', handle: 'me', restId: 'ME' } as Record<string, unknown> | null,
  ret: {} as Record<string, unknown>,
  dbText: '库里那条的正文' as string | undefined,
}));
const fake = (name: string, dflt: unknown) => async (...a: unknown[]): Promise<unknown> => { h.calls.push([name, a]); return name in h.ret ? h.ret[name] : dflt; };
const fakeSync = (name: string, dflt: unknown) => (...a: unknown[]): unknown => { h.calls.push([name, a]); return name in h.ret ? h.ret[name] : dflt; };

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
  getXDB: () => ({
    query: async (sql: string) => {
      if (sql.includes('FROM x_tweet')) return [h.dbText === undefined ? [] : [{ text: h.dbText }]];
      if (sql.includes("x_vpn_post")) return [[{ recipe: 'VPN求助-中文', verdict: { direction: 'out' } }]];
      return [[]];
    },
  }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: () => undefined } }));
vi.mock('@modules/x/x-host-registry', () => ({ getXHostState: () => ({ wcId: 7, url: '' }), listXHostStates: () => new Map([['ws-1', { wcId: 7, url: '' }]]) }));
vi.mock('@modules/x/x-account-repo', () => ({ readWsAccount: async () => h.account, accountForWrite: async () => ({ kind: 'ok', restId: 'ME', handle: 'me' }) }));
vi.mock('@modules/x/x-vpn-run', () => ({
  judgeVpnPosts: fake('judgeVpnPosts', { judged: 5, failed: 0, left: 3 }), pruneVpnPosts: fake('pruneVpnPosts', { removed: 2, kept: 9 }),
  readVpnOverview: async () => ({}), findVpnPostsWith: async () => ({ ok: true, runs: [] }), setVpnHuman: async () => undefined, prepareVpnOn: async () => ({ ok: true }),
}));
vi.mock('@modules/x/x-ask-draft', () => ({ draftAskReply: fake('draftAskReply', { ok: true, text: '早上好', ms: 900, examples: 3 }), readDraftRules: async () => [], setDraftRuleActive: async () => undefined }));
vi.mock('@modules/x/x-ask-run', () => ({ runAsk: fake('runAsk', { ok: true, liked: 'ok', replied: 'ok', followed: 'ok' }) }));
vi.mock('@modules/x/x-follow-queue', () => ({
  addToFollowQueue: fakeSync('addToFollowQueue', { added: 2, skipped: 0 }),
  controlFollowQueue: fakeSync('controlFollowQueue', undefined),
  followQueueStatus: () => ({ waiting: 0 }),
}));

const { execute } = await import('@platform/main/capability/capability');
const { registerXCapabilities } = await import('@modules/x/x-capabilities');
registerXCapabilities();

const ws = { wsId: 'ws-1' };
const run = { ...ws, restId: '42', handle: 'he', tweetId: '123', tweetText: '#蓝V互关', pickKind: 'tweet', reply: '互关一起冲' };
const OUTPUT: Array<[string, Record<string, unknown>, string]> = [
  ['x.ask.run', run, 'runAsk'],
  ['x.followQueue.add', { ...ws, items: [{ restId: '1', handle: 'a' }, { restId: '2', handle: 'b' }] }, 'addToFollowQueue'],
  ['x.followQueue.resume', ws, 'controlFollowQueue'],
];

beforeEach(() => {
  h.rows.length = 0; h.calls.length = 0; h.ret = {}; h.dbText = '库里那条的正文';
  h.account = { wsId: 'ws-1', handle: 'me', restId: 'ME' };
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('⭐⭐⭐ 对外动作只接受人点的 / 定时器', () => {
  for (const [id, inp, fn] of OUTPUT) {
    it(`${id}:ui / timer 照做;ai / inbox → refused「要人批复」,一步不动,各记一行`, async () => {
      expect(await execute(id, inp, { caller: 'ui' }), id).toMatchObject({ ok: true });
      expect(await execute(id, inp, { caller: 'timer' }), id).toMatchObject({ ok: true });
      for (const caller of ['ai', 'inbox'] as const) {
        const r = await execute(id, inp, { caller });
        expect(r, `${id} ${caller}`).toMatchObject({ ok: false, kind: 'refused' });
        if (!r.ok) expect(r.why).toContain('人批复');
      }
      expect(h.calls.filter(([n]) => n === fn)).toHaveLength(2);
      expect(h.rows.map((r) => [r.caller, r.status, r.stepType])).toEqual([['ui', 'ok', 'output'], ['timer', 'ok', 'output'], ['ai', 'refused', 'output'], ['inbox', 'refused', 'output']]);
    });
  }

  it('暂停 / 清空关注队列不是对外动作:谁都能调;继续不能用这个能力', async () => {
    for (const caller of ['ui', 'ai', 'inbox'] as const) {
      expect(await execute('x.followQueue.control', { ...ws, action: 'pause' }, { caller }), caller).toMatchObject({ ok: true });
    }
    expect(await execute('x.followQueue.control', { ...ws, action: 'clear' }, { caller: 'ai' })).toMatchObject({ ok: true });
    expect(await execute('x.followQueue.control', { ...ws, action: 'resume' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'invalid' });
    expect(h.calls.filter(([n]) => n === 'controlFollowQueue').map(([, a]) => a[1])).toEqual(['pause', 'pause', 'pause', 'clear']);
  });
});

describe('求关发送的三种结果', () => {
  it('成了 → ok;闸门 / 网页忙挡下 → refused;做了一半 → failed 且带 partial(卡片要看哪步成了)', async () => {
    expect(await execute('x.ask.run', run, { caller: 'ui' })).toMatchObject({ ok: true, value: { liked: 'ok' } });
    h.ret.runAsk = { ok: false, blocked: 'X 网页正忙:任务:查回关' };
    expect(await execute('x.ask.run', run, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'refused', why: 'X 网页正忙:任务:查回关' });
    h.ret.runAsk = { ok: false, liked: 'ok', replied: 'failed', failedStep: 'reply', detail: '留言没发出去' };
    const r = await execute('x.ask.run', run, { caller: 'ui' });
    expect(r).toMatchObject({ ok: false, kind: 'failed', why: '留言没发出去', partial: { liked: 'ok', replied: 'failed', failedStep: 'reply' } });
    expect(h.rows.at(-1)).toMatchObject({ status: 'failed', subjectRef: 'x_author:42' });
  });
  it('参数不对 → invalid,不动手', async () => {
    expect(await execute('x.ask.run', { ...run, pickKind: 'random' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'invalid' });
    expect(await execute('x.ask.run', { ...run, tweetId: 'abc' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'invalid' });
    expect(await execute('x.followQueue.add', { ...ws, items: [{ handle: 'a' }] }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'invalid' });
    expect(h.calls).toEqual([]);
  });
});

describe('AI 类', () => {
  it('判求助帖:按号判;「已经有一轮在判」→ refused;AI / 收件箱也能调(不对外)', async () => {
    expect(await execute('x.vpn.judge', { ...ws, limit: 5 }, { caller: 'ai' })).toMatchObject({ ok: true, value: { judged: 5 } });
    expect(h.calls[0][1]).toEqual(['ME', 5]);
    h.ret.judgeVpnPosts = { judged: 0, failed: 0, left: -1 };
    expect(await execute('x.vpn.judge', { ...ws, limit: 5 }, { caller: 'inbox' })).toMatchObject({ ok: false, kind: 'refused', why: '已经有一轮判断在跑' });
    expect(await execute('x.vpn.judge', { ...ws, limit: 51 }, { caller: 'inbox' })).toMatchObject({ ok: false, kind: 'invalid' });
  });

  it('草拟:给正文照用;只给帖子 id 就到库里读正文;库里没有 → failed;回复求助带上链接语言', async () => {
    await execute('x.ask.draft', { ...ws, tweetText: '他写的', mode: 'engage' }, { caller: 'ui' });
    expect((h.calls[0][1][0] as { tweet: string }).tweet).toBe('他写的');
    await execute('x.ask.draft', { ...ws, mode: 'vpn', tweetId: '123' }, { caller: 'inbox' });
    const v = h.calls[1][1][0] as { tweet: string; mode: string; vpn?: { link: string; direction?: string } };
    expect(v.tweet).toBe('库里那条的正文');
    expect(v.mode).toBe('vpn');
    expect(v.vpn?.direction).toBe('out');
    h.dbText = undefined;
    expect(await execute('x.ask.draft', { ...ws, tweetId: '999' }, { caller: 'ai' })).toMatchObject({ ok: false, kind: 'failed' });
    expect(await execute('x.ask.draft', { ...ws }, { caller: 'ai' })).toMatchObject({ ok: false, kind: 'invalid' });
    h.ret.draftAskReply = { ok: false, why: 'Gemma 超时' };
    expect(await execute('x.ask.draft', { ...ws, tweetText: 'x' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'failed', why: 'Gemma 超时' });
  });

  it('清过期求助帖(新能力):按号清', async () => {
    expect(await execute('x.vpn.prune', ws, { caller: 'inbox' })).toMatchObject({ ok: true, value: { removed: 2 } });
    expect(h.calls[0]).toEqual(['pruneVpnPosts', ['ME']]);
  });
});

describe('接线守卫:第 3 步收口', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const IPC = strip(read('src/modules/x/x-data-ipc.ts'));
  it('⭐ IPC switch 只剩底座 4 个 + 界面流程上报 3 个(业务全走能力对照表)', () => {
    const cases = [...IPC.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]).sort();
    expect(cases).toEqual(['logAction', 'logPersonCollect', 'logPersonProgress', 'pageAcquire', 'pageBusy', 'pageRelease', 'syncHost']);
  });
  it('⭐ 关注队列控制按 action 分:继续 → 对外动作的能力;做了一半的结果原样给卡片', () => {
    const table = IPC.slice(IPC.indexOf('const CAP_OF_OP'), IPC.indexOf('};', IPC.indexOf('const CAP_OF_OP')));
    expect(table).toMatch(/followQueueControl: \(p\) => \(\(p as \{ action\?: string \}\)\.action === 'resume' \? 'x\.followQueue\.resume' : 'x\.followQueue\.control'\)/);
    expect(table).toMatch(/askRun: 'x\.ask\.run'/);
    const fc = IPC.slice(IPC.indexOf('function fromCap'), IPC.indexOf('async function handle('));
    expect(fc).toMatch(/if \(!r\.ok && r\.partial !== undefined\) return \{ status: 'ok', value: r\.partial \};/);
  });
  it('⭐ 收件箱:没有直接调业务函数的了(都走 execute)', () => {
    const I = strip(read('src/modules/x/x-dev-inbox.ts'));
    expect(I).not.toMatch(/\b(judgeVpnPosts|pruneVpnPosts|readVpnOverview|draftAskReply|checkFollowBack|startRelationTask|collectEngagement|screenEngage|prepareEngage|findVpnPosts|readLeftTweet|readEngageOverview)\(/);
    expect(I).not.toMatch(/\bcollectPersonTab\(\{/);
  });
});
