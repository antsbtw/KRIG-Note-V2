/**
 * ⭐⭐⭐ 流程(Module5-04 第 4 步 4b,2026-10-26)—— 平台层,不认识 X
 *
 * 流程 = 一个能力,里面一步步调别的能力(f.call);每一步的执行记录挂在这次流程名下(run_id = 流程那次调用的 callId)。
 * 跑的时候有进度(第几个 / 在干什么),界面看 flow.runs;能叫停(flow.stop,流程在步与步之间看);
 * 同一个流程在同一个范围(如 workspace)一次只跑一份;步骤的调用方 = 流程的调用方(AI 起的流程里,对外动作照样被拒)。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows: Array<Record<string, unknown>> = [];
vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) rows.push(v); return [[]]; } }),
}));

const cap = await import('@platform/main/capability/capability');
const flow = await import('@platform/main/capability/flow');

let gate: { open: () => void; wait: Promise<void> } | null = null;
const door = (): { open: () => void; wait: Promise<void> } => { let open!: () => void; const wait = new Promise<void>((r) => { open = r; }); return { open, wait }; };

cap.defineCapability<{ n: number }, number>({
  id: 'demo.step', kind: 'input', describe: '一步(测试用)', inputDoc: {},
  parse: (raw) => ({ n: (raw as { n: number }).n }),
  run: async (i) => { if (gate) await gate.wait; return i.n * 10; },
});
cap.defineCapability<Record<string, never>, string>({
  id: 'demo.out', kind: 'output', describe: '对外一步(测试用)', inputDoc: {}, parse: () => ({}), run: async () => 'sent',
});

const demo = flow.defineFlow<{ ws: string; items: number[] }, { got: number[]; stoppedAt?: number }>({
  id: 'demo.flow', describe: '逐个做一遍(测试用)', inputDoc: { ws: 'ws', items: '数组' },
  parse: (raw) => raw as { ws: string; items: number[] },
  scope: (i) => i.ws,
  run: async (i, f) => {
    const got: number[] = [];
    for (const [k, n] of i.items.entries()) {
      if (f.stopped()) return { got, stoppedAt: k };
      f.step(k + 1, i.items.length, `第 ${n} 个`);
      const r = await f.call('demo.step', { n });
      if (r.ok) got.push(r.value as number);
    }
    return { got };
  },
});

beforeEach(() => {
  rows.length = 0; gate = null;
  flow._resetFlows();
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('流程', () => {
  it('一步步调能力;每步的记录挂在这次流程名下(run_id = 流程的 callId);步骤调用方 = 流程调用方', async () => {
    const r = await cap.execute(demo.id, { ws: 'ws-1', items: [1, 2, 3] }, { caller: 'timer' });
    expect(r).toMatchObject({ ok: true, value: { got: [10, 20, 30] } });
    const steps = rows.filter((x) => x.capability === 'demo.step');
    expect(steps).toHaveLength(3);
    for (const s of steps) expect(s).toMatchObject({ runId: r.callId, caller: 'timer' });
    const head = rows.find((x) => x.capability === 'demo.flow');
    expect(head).toMatchObject({ runId: r.callId, callId: r.callId, status: 'ok' });
  });

  it('⭐ 跑着的时候看得到进度;同一个范围再起一份 → refused;别的范围不受影响', async () => {
    gate = door();
    const p = cap.execute(demo.id, { ws: 'ws-1', items: [1, 2] }, { caller: 'ui' });
    await new Promise((r) => setTimeout(r, 5));
    const runs = flow.listFlows('ws-1');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ flow: 'demo.flow', scope: 'ws-1', i: 1, total: 2, msg: '第 1 个' });
    const again = await cap.execute(demo.id, { ws: 'ws-1', items: [9] }, { caller: 'ui' });
    expect(again).toMatchObject({ ok: false, kind: 'refused' });
    if (!again.ok) expect(again.why).toContain('已经在跑');
    expect(flow.listFlows('ws-2')).toEqual([]);
    gate.open();
    await p;
    /** 跑完了:不在「正在跑」里,但最后一句还能看到一会儿(界面要显示结果) */
    expect(flow.listFlows('ws-1').filter((x) => x.done !== true)).toEqual([]);
    expect(flow.listFlows('ws-1')[0]).toMatchObject({ done: true, ok: true });
  });

  it('⭐ 叫停:流程在步与步之间停下(当前那步做完),叫停时的钩子会被调(用来通知正在跑的采集)', async () => {
    gate = door();
    let hooked = 0;
    const stoppable = flow.defineFlow<{ ws: string }, string>({
      id: 'demo.stoppable', describe: '能停(测试用)', inputDoc: {}, parse: (raw) => raw as { ws: string }, scope: (i) => i.ws,
      run: async (_i, f) => {
        f.onStop(() => { hooked += 1; });
        for (let k = 0; k < 5; k += 1) {
          if (f.stopped()) return `停在第 ${k} 步`;
          await f.call('demo.step', { n: k });
        }
        return '跑完了';
      },
    });
    const p = cap.execute(stoppable.id, { ws: 'ws-1' }, { caller: 'ui' });
    await new Promise((r) => setTimeout(r, 5));
    const runId = flow.listFlows('ws-1')[0].runId;
    expect(flow.stopFlow(runId)).toBe(true);
    expect(hooked).toBe(1);
    gate.open();
    expect(await p).toMatchObject({ ok: true, value: '停在第 1 步' });
    expect(flow.stopFlow('没有这个')).toBe(false);
  });

  it('⭐⭐ AI 起的流程里,对外动作那一步照样被拒(调用方带下去)', async () => {
    const withOut = flow.defineFlow<{ ws: string }, unknown>({
      id: 'demo.withOut', describe: '带对外一步(测试用)', inputDoc: {}, parse: (raw) => raw as { ws: string }, scope: (i) => i.ws,
      run: async (_i, f) => f.call('demo.out', {}),
    });
    const r = await cap.execute(withOut.id, { ws: 'ws-1' }, { caller: 'ai' });
    expect(r).toMatchObject({ ok: true, value: { ok: false, kind: 'refused' } });
    const ui = await cap.execute(withOut.id, { ws: 'ws-1' }, { caller: 'ui' });
    expect(ui).toMatchObject({ ok: true, value: { ok: true, value: 'sent' } });
  });

  it('流程抛错 → failed,也从「正在跑」里拿掉(不卡死后面的)', async () => {
    const boom = flow.defineFlow<{ ws: string }, never>({
      id: 'demo.boom', describe: '炸(测试用)', inputDoc: {}, parse: (raw) => raw as { ws: string }, scope: (i) => i.ws,
      run: async () => { throw new Error('中途炸了'); },
    });
    expect(await cap.execute(boom.id, { ws: 'ws-1' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'failed' });
    expect(flow.listFlows('ws-1').filter((x) => x.done !== true)).toEqual([]);
    expect(await cap.execute(boom.id, { ws: 'ws-1' }, { caller: 'ui' })).toMatchObject({ ok: false, kind: 'failed' });
  });

  it('flow.runs / flow.stop 也是能力(AI 能看、能停)', async () => {
    flow.registerFlowControlCapabilities();
    expect(await cap.execute('flow.runs', { scope: 'ws-1' }, { caller: 'ai' })).toMatchObject({ ok: true, value: [] });
    expect(await cap.execute('flow.stop', { runId: 'x' }, { caller: 'ai' })).toMatchObject({ ok: false, kind: 'refused' });
  });
});
