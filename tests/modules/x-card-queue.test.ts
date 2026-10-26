/**
 * ⭐⭐⭐ 第 4 步 4c:卡片队列搬到主进程(Module5-04,2026-10-26)
 *
 * 用户 10-26 选「现在就把卡片队列搬到主进程」+「发完这张再准备下一张」:
 *   这一批人 / 第几张 / 前面每张的结果存在主进程(进库),关窗口、重启 app 后还停在那一张;
 *   下一张在这张做完(发送 / 跳过 / 放一放 / 下一个)之后才准备 —— 不把左边网页带走;发送还是人点。
 * 卡片里的准备 / 草拟 / 选推文 / 发送不动(本来就是单个能力调用)。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  /** 假的 x_card_queue 表:id → state JSON */
  table: new Map<string, string>(),
}));
vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
  getXDB: () => ({
    query: async (sql: string, v: Record<string, unknown>) => {
      const id = String(v.id);
      if (sql.startsWith('SELECT')) return [h.table.has(id) ? [{ state: h.table.get(id) }] : []];
      if (sql.startsWith('UPSERT')) { h.table.set(id, String(v.state)); return [[{ id }]]; }
      if (sql.startsWith('DELETE')) { h.table.delete(id); return [[]]; }
      throw new Error(`没想到的 SQL ${sql}`);
    },
  }),
}));

const { execute } = await import('@platform/main/capability/capability');
const { registerCardQueueCapabilities } = await import('@modules/x/x-card-queue');
registerCardQueueCapabilities();

const people = [{ restId: '1', handle: 'a' }, { restId: '2', handle: 'b', hisTweetId: '99' }, { restId: '3', handle: 'c' }];
type Q = { wsId: string; mode: string; items: unknown[]; index: number; done: Array<{ who: { restId: string }; outcome: string }> };
const val = <T>(r: { ok: boolean }): T => (r as unknown as { value: T }).value;

beforeEach(() => {
  h.rows.length = 0; h.table.clear();
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('卡片队列在主进程(进库)', () => {
  it('起一批 → 进库;再读回来是同一批、停在第 1 张(关窗口 / 重启后界面一打开就接着)', async () => {
    const s = await execute('x.cards.start', { wsId: 'ws-1', mode: 'ask', people }, { caller: 'ui' });
    expect(s).toMatchObject({ ok: true, value: { mode: 'ask', index: 0, done: [] } });
    expect(h.table.has('ws-1:ask')).toBe(true);
    const r = await execute('x.cards.state', { wsId: 'ws-1', mode: 'ask' }, { caller: 'ui' });
    expect(val<Q>(r)).toMatchObject({ index: 0, items: people });
    /** 别的号 / 别的卡互不相干 */
    expect(await execute('x.cards.state', { wsId: 'ws-1', mode: 'engage' }, { caller: 'ui' })).toMatchObject({ ok: true, value: null });
    expect(await execute('x.cards.state', { wsId: 'ws-2', mode: 'ask' }, { caller: 'ui' })).toMatchObject({ ok: true, value: null });
  });

  it('⭐ 做完一张 → 记下结果、到下一张;最后一张做完 → 这一批结束(库里删掉),返回每张的结果', async () => {
    await execute('x.cards.start', { wsId: 'ws-1', mode: 'engage', people }, { caller: 'ui' });
    let r = await execute('x.cards.advance', { wsId: 'ws-1', mode: 'engage', index: 0, outcome: '✓ 互动完成' }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: { finished: false, queue: { index: 1 } } });
    r = await execute('x.cards.advance', { wsId: 'ws-1', mode: 'engage', index: 1, outcome: '先放一放' }, { caller: 'ui' });
    r = await execute('x.cards.advance', { wsId: 'ws-1', mode: 'engage', index: 2, outcome: '跳过' }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: { finished: true } });
    expect(val<{ done: Q['done'] }>(r).done.map((d) => [d.who.restId, d.outcome])).toEqual([['1', '✓ 互动完成'], ['2', '先放一放'], ['3', '跳过']]);
    expect(h.table.has('ws-1:engage')).toBe(false);
  });

  it('⭐ 「已经不是这一张了」→ refused,不重复往下走(连点两下 / 两个窗口开着同一批)', async () => {
    await execute('x.cards.start', { wsId: 'ws-1', mode: 'ask', people }, { caller: 'ui' });
    await execute('x.cards.advance', { wsId: 'ws-1', mode: 'ask', index: 0, outcome: '✓' }, { caller: 'ui' });
    const again = await execute('x.cards.advance', { wsId: 'ws-1', mode: 'ask', index: 0, outcome: '✓' }, { caller: 'ui' });
    expect(again).toMatchObject({ ok: false, kind: 'refused' });
    expect(val<Q>(await execute('x.cards.state', { wsId: 'ws-1', mode: 'ask' }, { caller: 'ui' })).index).toBe(1);
    expect(await execute('x.cards.advance', { wsId: 'ws-1', mode: 'vpn', index: 0, outcome: '✓' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'refused' });
  });

  it('结束这一批 → 库里删掉,返回已做完的那些;再起一批会盖掉没做完的(说一声)', async () => {
    await execute('x.cards.start', { wsId: 'ws-1', mode: 'ask', people }, { caller: 'ui' });
    await execute('x.cards.advance', { wsId: 'ws-1', mode: 'ask', index: 0, outcome: '✓' }, { caller: 'ui' });
    const e = await execute('x.cards.end', { wsId: 'ws-1', mode: 'ask' }, { caller: 'ui' });
    expect(val<{ done: Q['done'] }>(e).done).toHaveLength(1);
    expect(h.table.size).toBe(0);
    await execute('x.cards.start', { wsId: 'ws-1', mode: 'ask', people }, { caller: 'ui' });
    await execute('x.cards.start', { wsId: 'ws-1', mode: 'ask', people: people.slice(0, 1) }, { caller: 'ui' });
    expect(vi.mocked(console.warn).mock.calls.some((c) => String(c[0]).includes('盖掉'))).toBe(true);
    expect(val<Q>(await execute('x.cards.state', { wsId: 'ws-1', mode: 'ask' }, { caller: 'ui' })).items).toHaveLength(1);
  });

  it('参数不对 → invalid;库里存坏了 → failed(响,不当成没有)', async () => {
    expect(await execute('x.cards.start', { wsId: 'ws-1', mode: 'follow', people }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'invalid' });
    expect(await execute('x.cards.start', { wsId: 'ws-1', mode: 'ask', people: [] }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'invalid' });
    expect(await execute('x.cards.start', { wsId: 'ws-1', mode: 'ask', people: [{ handle: 'x' }] }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'invalid' });
    h.table.set('ws-1:ask', '{坏的');
    expect(await execute('x.cards.state', { wsId: 'ws-1', mode: 'ask' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'failed' });
  });
});

describe('接线守卫', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('⭐ 卡片「下一张 / 结束这一批」都报给主进程;第几张来自主进程(不再是组件里的 useState)', () => {
    const A = strip(read('src/modules/x/XTaskAsk.tsx'));
    expect(A).not.toMatch(/const \[i, setI\] = useState/);
    const next = A.slice(A.indexOf('const next = '), A.indexOf('const next = ') + 600);
    expect(next).toMatch(/await advanceCards\(wsId, mode, q\.index, outcome\)/);
    expect(A).toMatch(/onClick=\{\(\) => void endBatch\(\)\}>结束这一批/);
  });
  it('⭐ 三个任务页:起一批走主进程;一打开先问主进程有没有没做完的那批(重启后接着)', () => {
    for (const [f, mode] of [['XTaskFollow.tsx', 'ask'], ['XTaskEngage.tsx', 'engage'], ['XTaskVpn.tsx', 'vpn']]) {
      const src = strip(read(`src/modules/x/${f}`));
      expect(src, f).toMatch(new RegExp(`readCards\\(wsId, '${mode}'\\)`));
      expect(src, f).toMatch(new RegExp(`startCards\\(wsId, '${mode}', `));
    }
  });
  it('迁移 1.2.41 登记了;对照表有四个 op', () => {
    expect(read('src/storage/migrations/x-runner.ts')).toMatch(/version: '1\.2\.41'[\s\S]{0,200}up: x_migration_1_2_41/);
    const IPC = strip(read('src/modules/x/x-data-ipc.ts'));
    for (const [op, id] of [['cardsStart', 'x.cards.start'], ['cardsState', 'x.cards.state'], ['cardsAdvance', 'x.cards.advance'], ['cardsEnd', 'x.cards.end']]) {
      expect(IPC, op).toMatch(new RegExp(`\\b${op}: '${id.replace(/\./g, '\\.')}'`));
    }
  });
});
