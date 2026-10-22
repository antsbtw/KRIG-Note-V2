/**
 * ⭐⭐⭐ 求关三个动作(2026-10-17)—— 真的会在 X 上点赞 / 留言 / 关注,保护规则用行为测试钉住
 * 用户 10-17:「选择一条和互关相关的,点赞、留言求关、关注。三个动作。」
 * 保护:动手前过闸 / 哪步没成停在哪步 / 每个动作留痕 / 每步核对 / 留言进 x_ask(人写的范例)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  busy: null as string | null,
  gate: { allowed: true } as Record<string, unknown>,
  account: { kind: 'ok', restId: 'ME', handle: 'antsBTW' } as Record<string, unknown>,
  like: 'liked', box: { found: true, count: 1, text: '' } as Record<string, unknown>,
  typed: { status: 'ok', value: { checked: true, landed: true, via: 'synthetic-paste', attempts: 1 } } as Record<string, unknown>,
  send: { state: 'sent', replyId: '999' } as Record<string, unknown>,
  follow: 'followed',
  calls: [] as string[],
  actions: [] as Array<Record<string, unknown>>,
  rels: [] as Array<Record<string, unknown>>,
  asks: [] as Array<Record<string, unknown>>,
  sendParams: null as Record<string, unknown> | null,
}));

vi.mock('@storage/surreal/client', () => ({
  getXDB: () => ({ query: async (_sql: string, v: Record<string, unknown>) => { h.asks.push(v); return [[{ id: 'x_ask:1' }]]; } }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({
  inputEngine: { type: async (_p: string, i: Record<string, unknown>) => { h.calls.push(`type:${String(i.text)}`); return h.typed; } },
}));
vi.mock('@platform/main/web-capability/wiring/web-collect-engine', () => ({ resolve: () => ({ wc: {}, pageId: 'p1' }) }));
vi.mock('@modules/x/x-collect-ports', async () => {
  const { X_SCRIPTS } = await import('@modules/x/x-dom-scripts');
  return {
    webviewPorts: () => ({
      goto: async (n: string) => { h.calls.push(`goto:${n}`); return { ok: true }; },
      runScript: async (id: string, p: Record<string, unknown>) => {
        h.calls.push(`run:${id}`);
        if (id === X_SCRIPTS.likeTweet) return { state: h.like };
        if (id === X_SCRIPTS.replyBoxState) return h.box;
        if (id === X_SCRIPTS.sendReply) { h.sendParams = p; return h.send; }
        if (id === X_SCRIPTS.follow) return { state: h.follow };
        throw new Error(`没想到的脚本 ${id}`);
      },
    }),
  };
});
vi.mock('@modules/x/x-host-registry', () => ({
  getXHostState: () => ({ wcId: 7 }), getXHostBusy: () => h.busy, setXHostBusy: () => undefined,
}));
vi.mock('@modules/x/x-bg-runner', () => ({ bgRunningOn: () => null }));
vi.mock('@modules/x/x-follow-queue', () => ({ followQueueStatus: () => ({}) }));
vi.mock('@modules/x/x-account-repo', () => ({ accountForWrite: async () => h.account }));
vi.mock('@modules/x/x-ops-actions-repo', () => ({
  readFollowGate: async () => h.gate,
  appendAction: async (e: Record<string, unknown>) => { h.actions.push(e); },
}));
vi.mock('@modules/x/x-user-repo', () => ({
  writeRelations: async (_a: unknown, obs: Array<Record<string, unknown>>, source: string) => { h.rels.push({ ...obs[0], source }); return {}; },
}));

const { runAsk, replyProblem } = await import('@modules/x/x-ask-run');
const { X_SCRIPTS } = await import('@modules/x/x-dom-scripts');

const input = { wsId: 'ws-1', restId: '42', handle: 'he', tweetId: '123', tweetText: '#蓝V互关', pickKind: 'tweet' as const, reply: '  早上好，互关一起冲！ ' };

beforeEach(() => {
  h.busy = null; h.gate = { allowed: true }; h.account = { kind: 'ok', restId: 'ME', handle: 'antsBTW' };
  h.like = 'liked'; h.box = { found: true, count: 1, text: '' };
  h.typed = { status: 'ok', value: { checked: true, landed: true, via: 'synthetic-paste', attempts: 1 } };
  h.send = { state: 'sent', replyId: '999' }; h.follow = 'followed';
  h.calls = []; h.actions = []; h.rels = []; h.asks = []; h.sendParams = null;
});

describe('runAsk', () => {
  it('⭐⭐ 全成:去推文 → 赞 → 查框 → 贴 → 发 → 去主页 → 关;三笔动作留痕;关系写我关注他;x_ask 记人写的留言', async () => {
    const r = await runAsk(input);
    expect(r).toMatchObject({ ok: true, liked: 'ok', replied: 'ok', followed: 'ok', replyId: '999' });
    expect(h.calls).toEqual([
      'goto:x.status', `run:${X_SCRIPTS.likeTweet}`, `run:${X_SCRIPTS.replyBoxState}`, 'type:早上好，互关一起冲！',
      `run:${X_SCRIPTS.sendReply}`, 'goto:x.profile', `run:${X_SCRIPTS.follow}`,
    ]);
    expect(h.sendParams).toEqual({ needle: '早上好互关一起冲', me: 'antsBTW' });
    expect(h.actions.map((a) => `${String(a.action)}:${String(a.result)}`)).toEqual(['like:ok', 'reply:ok', 'follow:ok']);
    expect(h.actions.every((a) => a.decidedBy === 'human' && a.targetRestId === '42')).toBe(true);
    expect(h.rels).toEqual([expect.objectContaining({ person: '42', iFollow: true, source: 'follow-action' })]);
    expect(h.asks).toEqual([expect.objectContaining({ account: 'ME', person: '42', tid: '123', reply: '早上好，互关一起冲！', rid: '999', liked: 'ok', replied: 'ok', followed: 'ok' })]);
  });

  it('⭐⭐ 闸门没过 / 网页忙 / 认不出号 / 留言空 → 一个动作都不做', async () => {
    h.gate = { allowed: false, reason: '今天已关注 30/30' };
    expect((await runAsk(input)).blocked).toContain('30/30');
    h.gate = { allowed: true }; h.busy = '操作台正在采集';
    expect((await runAsk(input)).blocked).toContain('正忙');
    h.busy = null; h.account = { kind: 'needIdentify', handle: 'x', reason: '登录的号变了' };
    expect((await runAsk(input)).blocked).toContain('认不出');
    h.account = { kind: 'ok', restId: 'ME', handle: 'antsBTW' };
    expect((await runAsk({ ...input, reply: '!!' })).blocked).toContain('没有字也没有表情');
    expect(h.calls).toEqual([]);
    expect(h.actions).toEqual([]);
  });

  it('⭐⭐ 点赞没成 → 停,不留言不关注;x_ask 记下停在哪', async () => {
    h.like = 'no-button';
    const r = await runAsk(input);
    expect(r).toMatchObject({ ok: false, liked: 'failed', failedStep: 'like' });
    expect(h.calls.some((c) => c.startsWith('type:') || c === 'goto:x.profile')).toBe(false);
    expect(h.asks[0]).toMatchObject({ liked: 'failed', fstep: 'like' });
  });

  it('⭐⭐ 回复框里有残留 → 不贴不发', async () => {
    h.box = { found: true, count: 1, text: '上次没发的' };
    const r = await runAsk(input);
    expect(r).toMatchObject({ failedStep: 'reply', replied: 'failed' });
    expect(h.calls.some((c) => c.startsWith('type:'))).toBe(false);
    expect(h.calls).not.toContain(`run:${X_SCRIPTS.sendReply}`);
  });

  it('⭐⭐ 留言没贴对(校验没过)→ 不点发送', async () => {
    h.typed = { status: 'ok', value: { checked: true, landed: false, via: 'none', attempts: 3 } };
    expect(await runAsk(input)).toMatchObject({ failedStep: 'reply' });
    expect(h.calls).not.toContain(`run:${X_SCRIPTS.sendReply}`);
  });

  it('⭐⭐ 点了发送但页面上没看到我的回复 → 停,不关注(说不清发没发出去)', async () => {
    h.send = { state: 'unseen' };
    const r = await runAsk(input);
    expect(r).toMatchObject({ ok: false, replied: 'unseen', failedStep: 'reply' });
    expect(h.calls).not.toContain('goto:x.profile');
    expect(h.rels).toEqual([]);
  });

  it('本来就赞过 / 本来就关注着:不重复记动作,照常往下走', async () => {
    h.like = 'already-liked'; h.follow = 'already-following';
    const r = await runAsk(input);
    expect(r).toMatchObject({ ok: true, liked: 'already', followed: 'already' });
    expect(h.actions.map((a) => a.action)).toEqual(['reply']);
  });
});

describe('replyProblem', () => {
  it('空 / 只有表情 / 超长 不发', () => {
    expect(replyProblem('  ')).toContain('空');
    expect(replyProblem('……!')).toContain('没有字也没有表情');
    /** 用户 10-21:只回一个 👍 是允许的 */
    expect(replyProblem('👍')).toBeNull();
    expect(replyProblem('好'.repeat(281))).toContain('280');
    expect(replyProblem('互关一起冲')).toBeNull();
  });
});

describe('⭐⭐ 互动模式(2026-10-22,蓝V互关第 3 件事:点赞 + 回复,不关注)', () => {
  it('不去主页、不点关注、不写「我关注他」;动作留痕标「互动」;记进 x_engage(回他找我的那条 = his-message)', async () => {
    const r = await runAsk({ ...input, mode: 'engage', reply: '说得对,这波确实超预期' });
    expect(r).toMatchObject({ ok: true, liked: 'ok', replied: 'ok' });
    expect(r.followed).toBeUndefined();
    expect(h.calls).not.toContain('goto:x.profile');
    expect(h.calls).not.toContain(`run:${X_SCRIPTS.follow}`);
    expect(h.rels).toEqual([]);
    expect(h.actions.map((a) => `${String(a.action)}:${String(a.reason).slice(0, 2)}`)).toEqual(['like:互动', 'reply:互动']);
    expect(h.asks).toEqual([expect.objectContaining({ kind: 'his-message', reply: '说得对,这波确实超预期', liked: 'ok', replied: 'ok' })]);
    expect(h.asks[0]).not.toHaveProperty('followed');
  });
  it('关注闸门不管互动(今天关注满了也能互动)', async () => {
    h.gate = { allowed: false, reason: '今天已关注 30/30' };
    const r = await runAsk({ ...input, mode: 'engage' });
    expect(r.ok).toBe(true);
  });
});
