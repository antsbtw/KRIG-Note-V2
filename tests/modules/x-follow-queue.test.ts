/**
 * ⭐⭐⭐ 关注队列(2026-10-16,蓝V互关 M4)—— 真的会在 X 上点关注,保护规则用行为测试钉住
 * 用户:「你在候选列表里勾一批,程序按节奏慢慢关」;保护=节奏 / 异常即停 / 动作留痕 / 执行后核对
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  busy: null as string | null,
  bg: null as { handle: string } | null,
  gate: { allowed: true, todayCount: 0, cap: 30, settings: { 'follow.min_gap_sec': 60, 'follow.jitter_sec': 0 } } as Record<string, unknown>,
  account: { kind: 'ok', restId: 'ME', handle: 'me' } as Record<string, unknown>,
  scriptState: 'followed',
  actions: [] as Array<Record<string, unknown>>,
  rels: [] as Array<Record<string, unknown>>,
  gotos: [] as string[],
}));

vi.mock('@modules/x/x-collect-ports', () => ({
  webviewPorts: () => ({
    goto: async (_n: string, p: Record<string, string>) => { h.gotos.push(p.handle); return { ok: true }; },
    runScript: async () => ({ state: h.scriptState }),
    harvest: async () => null,
  }),
}));
vi.mock('@modules/x/x-host-registry', () => ({
  getXHostState: () => ({ wcId: 7 }), getXHostBusy: () => h.busy, setXHostBusy: () => undefined,
}));
vi.mock('@modules/x/x-bg-runner', () => ({ bgRunningOn: () => h.bg }));
vi.mock('@modules/x/x-account-repo', () => ({ accountForWrite: async () => h.account }));
vi.mock('@modules/x/x-ops-actions-repo', () => ({
  readFollowGate: async () => h.gate,
  appendAction: async (e: Record<string, unknown>) => { h.actions.push(e); },
}));
vi.mock('@modules/x/x-user-repo', () => ({
  writeRelations: async (_a: unknown, obs: Array<Record<string, unknown>>, source: string) => { h.rels.push({ ...obs[0], source }); return { report: {}, before: new Map() }; },
}));

const Q = await import('@modules/x/x-follow-queue');

let n = 0;
const ws = (): string => `ws-t${(n += 1)}`;
beforeEach(() => {
  h.busy = null; h.bg = null; h.scriptState = 'followed';
  h.gate = { allowed: true, todayCount: 0, cap: 30, settings: { 'follow.min_gap_sec': 60, 'follow.jitter_sec': 0 } };
  h.account = { kind: 'ok', restId: 'ME', handle: 'me' };
  h.actions = []; h.rels = []; h.gotos = [];
});

describe('关注队列', () => {
  it('⭐ 关成了:去他主页 → 记一笔成功(人决定)→ 关系写成我关注他 → 下一个隔够间隔', async () => {
    const w = ws();
    Q.addToFollowQueue(w, [{ restId: '1', handle: 'a', reason: '蓝V互关:互关必回' }, { restId: '2', handle: 'b' }]);
    await Q.followQueueTick();
    expect(h.gotos).toEqual(['a']);
    expect(h.actions).toEqual([expect.objectContaining({ action: 'follow', targetRestId: '1', result: 'ok', decidedBy: 'human', reason: '蓝V互关:互关必回' })]);
    expect(h.rels).toEqual([expect.objectContaining({ person: '1', iFollow: true, source: 'follow-action' })]);
    const st = Q.followQueueStatus(w);
    expect(st.waiting).toBe(1);
    expect(st.nextAt - st.now).toBeGreaterThan(55_000);
    /** 间隔没到 → 这一拍不关下一个 */
    await Q.followQueueTick();
    expect(h.gotos).toEqual(['a']);
  });

  it('⭐⭐⭐ 没关成 → 记一笔失败 + 整条队列暂停(异常即停),不往下关', async () => {
    const w = ws();
    h.scriptState = 'no-button';
    Q.addToFollowQueue(w, [{ restId: '1', handle: 'a' }, { restId: '2', handle: 'b' }]);
    await Q.followQueueTick();
    expect(h.actions).toEqual([expect.objectContaining({ result: 'failed', detail: expect.stringContaining('no-button') })]);
    expect(h.rels).toEqual([]);
    expect(Q.followQueueStatus(w).paused).toContain('异常即停');
    await Q.followQueueTick();
    expect(h.gotos).toEqual(['a']);
    Q.controlFollowQueue(w, 'resume');
    h.scriptState = 'followed';
    await Q.followQueueTick();
    expect(h.gotos).toEqual(['a', 'b']);
  });

  it('本来就关注着 → 不占额度(不记成功),只把关系写成我关注他', async () => {
    const w = ws();
    h.scriptState = 'already-following';
    Q.addToFollowQueue(w, [{ restId: '1', handle: 'a' }]);
    await Q.followQueueTick();
    expect(h.actions).toEqual([]);
    expect(h.rels).toHaveLength(1);
    expect(Q.followQueueStatus(w).done[0].state).toBe('already-following');
  });

  it('⭐⭐ 到了每日上限 → 暂停,一个都不点;X 网页忙 / 后台在采 → 让路;认不出号 → 暂停', async () => {
    const w1 = ws();
    h.gate = { allowed: false, reason: '今天已关注 30 个,到了上限 30', todayCount: 30, cap: 30, settings: {} };
    Q.addToFollowQueue(w1, [{ restId: '1', handle: 'a' }]);
    await Q.followQueueTick();
    expect(h.gotos).toEqual([]);
    expect(Q.followQueueStatus(w1).paused).toContain('上限');

    h.gate = { allowed: true, todayCount: 0, cap: 30, settings: { 'follow.min_gap_sec': 60, 'follow.jitter_sec': 0 } };
    const w2 = ws();
    h.busy = '操作台正在采集';
    Q.addToFollowQueue(w2, [{ restId: '1', handle: 'a' }]);
    await Q.followQueueTick();
    expect(h.gotos).toEqual([]);
    expect(Q.followQueueStatus(w2).note).toContain('让路');

    h.busy = null;
    const w3 = ws();
    h.account = { kind: 'needIdentify', handle: 'x', reason: '登录的号变了' };
    Q.addToFollowQueue(w3, [{ restId: '1', handle: 'a' }]);
    await Q.followQueueTick();
    expect(h.gotos.filter((g) => g === 'a')).toHaveLength(0);
    expect(Q.followQueueStatus(w3).paused).toContain('认不出');
  });

  it('同一个人不重复进队列;数字 id 不合法的不收', () => {
    const w = ws();
    expect(Q.addToFollowQueue(w, [{ restId: '1', handle: 'a' }, { restId: '1', handle: 'a' }, { restId: 'x', handle: 'bad' }])).toEqual({ added: 1, skipped: 2 });
  });
});

describe('关注脚本', () => {
  it('真编译得过;数字 id 走 JSON 绑定;按 <id>-follow / <id>-unfollow 定位', async () => {
    const { X_DOM_SCRIPTS, X_SCRIPTS } = await import('@modules/x/x-dom-scripts');
    const src = X_DOM_SCRIPTS.find((s) => s.id === X_SCRIPTS.follow)!.build({ restId: '12345' });
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('var id = "12345"');
    expect(src).toContain("q('-unfollow')");
    const evil = X_DOM_SCRIPTS.find((s) => s.id === X_SCRIPTS.follow)!.build({ restId: '1"; alert(1); "' });
    expect(() => new Function(evil)).not.toThrow();
  });
});
