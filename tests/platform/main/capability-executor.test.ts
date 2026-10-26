/**
 * ⭐⭐⭐ 能力契约 + 执行器(Module5-04 第 2 步,2026-10-23)—— 平台层,不认识 X
 *
 * 判据(Module5-04 §2):任何功能从界面 / 定时器 / 收件箱 / AI 调,前提检查、占锁、留记录、结果格式完全一样;
 * 每次执行在 krig_flow.flow_step_run 有一行,含被拒 / 失败的。
 * 执行器固定顺序:校验 → 前提检查 → 占锁 → run → 放锁 → 写记录 → 统一结果。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows: Array<Record<string, unknown>> = [];
const db = { down: false };
const selects: Array<{ sql: string; v: Record<string, unknown> }> = [];
const deletes: string[] = [];
vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({
    query: async (sql: string, v: Record<string, unknown>) => {
      if (db.down) throw new Error('库挂了');
      if (sql.includes('CREATE flow_step_run')) rows.push(v);
      if (sql.includes('DELETE flow_step_run')) { deletes.push(sql); return [[{ id: 1 }, { id: 2 }]]; }
      if (sql.includes('SELECT call_id')) { selects.push({ sql, v }); return [[{ call_id: 'c1', capability: 'demo.double', caller: 'ui', status: 'ok' }]]; }
      return [[]];
    },
  }),
}));

const cap = await import('@platform/main/capability/capability');
const lock = await import('@platform/main/flow/resource-lock');

type In = { readonly n: number };
const order: string[] = [];
let heldDuringRun: string | null = null;

const demo = cap.defineCapability<In, { doubled: number }, { label: string }>({
  id: 'demo.double',
  kind: 'input',
  describe: '把 n 翻倍(测试用)',
  inputDoc: { n: '整数 0–100' },
  parse: (raw) => {
    const n = (raw as { n?: unknown })?.n;
    return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100 ? { n: n as number } : 'n 要 0–100 的整数';
  },
  prepare: async (i) => {
    order.push('prepare');
    if (i.n === 13) return { refused: '13 不吉利' };
    return { needs: [{ resource: 'page:7', purpose: `翻倍 ${i.n}`, label: '测试网页' }], ctx: { label: `#${i.n}` } };
  },
  run: async (i, ctx) => {
    order.push('run');
    heldDuringRun = lock.lockHolder('page:7')?.purpose ?? null;
    expect(ctx.held.get('page:7')).toBeTruthy();
    if (i.n === 99) throw cap.capFailed('99 算不动');
    if (i.n === 98) throw new Error('意外炸了');
    if (i.n === 97) throw cap.capRefused('跑到一半发现不该跑');
    return { doubled: i.n * 2 };
  },
  subject: (i) => `num:${i.n}`,
});

beforeEach(() => {
  rows.length = 0;
  order.length = 0;
  heldDuringRun = null;
  lock._resetLocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('统一结果', () => {
  it('ok:value + callId;run 期间占着锁,结束放掉;记一行', async () => {
    const r = await cap.execute('demo.double', { n: 4 }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: { doubled: 8 } });
    expect(r.callId).toMatch(/^call_/);
    expect(order).toEqual(['prepare', 'run']);
    expect(heldDuringRun).toBe('翻倍 4');
    expect(lock.lockHolder('page:7')).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      capability: 'demo.double', caller: 'ui', callId: r.callId, runId: r.callId, status: 'ok',
      stepType: 'input', subjectRef: 'num:4', input: { n: 4 },
    });
  });

  it('invalid:参数不对 → 不走前提检查、不占锁;也记一行', async () => {
    const r = await cap.execute('demo.double', { n: 'x' }, { caller: 'inbox' });
    expect(r).toMatchObject({ ok: false, kind: 'invalid', why: 'n 要 0–100 的整数' });
    expect(order).toEqual([]);
    expect(rows[0]).toMatchObject({ status: 'invalid', reasoning: 'n 要 0–100 的整数', caller: 'inbox' });
  });

  it('refused(前提不满足)→ 没动手;记一行', async () => {
    const r = await cap.execute('demo.double', { n: 13 }, { caller: 'timer' });
    expect(r).toMatchObject({ ok: false, kind: 'refused', why: '13 不吉利' });
    expect(order).toEqual(['prepare']);
    expect(rows[0]).toMatchObject({ status: 'refused', reasoning: '13 不吉利', caller: 'timer' });
  });

  it('⭐ refused(网页被别人占着)→ 不跑;别人的锁不受影响', async () => {
    const other = lock.acquireLock('page:7', '任务:查回关', 'timer');
    if (!other.ok) throw new Error('应拿到');
    const r = await cap.execute('demo.double', { n: 5 }, { caller: 'ai' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    if (!r.ok) expect(r.why).toMatch(/^测试网页正忙:任务:查回关/);
    expect(order).toEqual(['prepare']);
    expect(lock.lockHolder('page:7')?.token).toBe(other.token);
    expect(rows[0]).toMatchObject({ status: 'refused', caller: 'ai' });
  });

  it('failed:run 报 capFailed / 意外抛错 → failed,锁照样放;run 里 capRefused → refused', async () => {
    const a = await cap.execute('demo.double', { n: 99 }, { caller: 'ui' });
    expect(a).toMatchObject({ ok: false, kind: 'failed', why: '99 算不动' });
    const b = await cap.execute('demo.double', { n: 98 }, { caller: 'ui' });
    expect(b).toMatchObject({ ok: false, kind: 'failed' });
    if (!b.ok) expect(b.why).toContain('意外炸了');
    const c = await cap.execute('demo.double', { n: 97 }, { caller: 'ui' });
    expect(c).toMatchObject({ ok: false, kind: 'refused', why: '跑到一半发现不该跑' });
    expect(lock.lockHolder('page:7')).toBeNull();
    expect(rows.map((x) => x.status)).toEqual(['failed', 'failed', 'refused']);
  });

  it('不认识的能力 → invalid(说出来),不静默', async () => {
    const r = await cap.execute('no.such', {}, { caller: 'inbox' });
    expect(r).toMatchObject({ ok: false, kind: 'invalid' });
    if (!r.ok) expect(r.why).toContain('no.such');
  });

  it('⭐⭐ 四个入口调同一个能力:前提检查 / 锁 / 记录 / 结果形状完全一样,只差 caller', async () => {
    const out = [];
    for (const caller of ['ui', 'timer', 'inbox', 'ai'] as const) {
      out.push(await cap.execute('demo.double', { n: 6 }, { caller }));
    }
    const shape = (x: unknown): string => JSON.stringify(x, (k, v) => (k === 'callId' ? '<id>' : v));
    expect(new Set(out.map(shape)).size).toBe(1);
    const strip = (r: Record<string, unknown>): Record<string, unknown> => {
      const { caller: _c, callId: _i, runId: _r, durationMs: _d, ...rest } = r;
      return rest;
    };
    expect(new Set(rows.map((r) => JSON.stringify(strip(r)))).size).toBe(1);
    expect(rows.map((r) => r.caller)).toEqual(['ui', 'timer', 'inbox', 'ai']);
  });

  it('记录写不进去 → 不拦业务,但要响(console.error)', async () => {
    db.down = true;
    const r = await cap.execute('demo.double', { n: 1 }, { caller: 'ui' });
    db.down = false;
    expect(r.ok).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('flow.calls.recent —— AI 能自己回看执行记录', () => {
  it('按条件读能力调用(只读 caller 有值的行);这次查询本身也记一行(只记条数)', async () => {
    const { registerFlowCapabilities } = await import('@platform/main/capability/flow-capabilities');
    registerFlowCapabilities();
    selects.length = 0;
    const r = await cap.execute('flow.calls.recent', { limit: 5, status: 'refused', caller: 'timer' }, { caller: 'ai' });
    expect(r).toMatchObject({ ok: true, value: { calls: [{ call_id: 'c1' }] } });
    expect(selects[0].sql).toMatch(/WHERE caller != NONE AND caller = \$caller AND status = \$status ORDER BY created_at DESC LIMIT \$limit/);
    expect(selects[0].v).toMatchObject({ limit: 5, caller: 'timer', status: 'refused' });
    expect(rows.at(-1)).toMatchObject({ capability: 'flow.calls.recent', caller: 'ai', output: { count: 1 } });
    expect(await cap.execute('flow.calls.recent', { status: 'weird' }, { caller: 'ai' })).toMatchObject({ ok: false, kind: 'invalid' });
  });
});

describe('⭐ 状态轮询(用户 10-24:「全记,只留 7 天」)', () => {
  const poll = cap.defineCapability<{ fail?: boolean }, { n: number }>({
    id: 'demo.poll', kind: 'input', describe: '轮询的状态(测试用)', inputDoc: {}, probe: true,
    parse: (raw) => ({ fail: (raw as { fail?: boolean })?.fail === true }),
    run: async (i) => { if (i.fail) throw cap.capFailed('读不到'); return { n: 1 }; },
  });
  it('每次都记一行,带 keepDays = 7;成功不打终端,失败照打', async () => {
    vi.mocked(console.log).mockClear();
    await cap.execute(poll.id, {}, { caller: 'ui' });
    expect(rows.at(-1)).toMatchObject({ capability: 'demo.poll', status: 'ok', keepDays: 7 });
    expect(vi.mocked(console.log).mock.calls.filter((c) => String(c[0]).startsWith('[cap] demo.poll'))).toEqual([]);
    await cap.execute(poll.id, { fail: true }, { caller: 'ui' });
    expect(rows.at(-1)).toMatchObject({ status: 'failed', keepDays: 7 });
    expect(vi.mocked(console.warn).mock.calls.some((c) => String(c[0]).startsWith('[cap] demo.poll'))).toBe(true);
  });
  it('非轮询的不带 keepDays(长期保留)', async () => {
    await cap.execute('demo.double', { n: 2 }, { caller: 'ui' });
    expect(rows.at(-1)?.keepDays).toBeUndefined();
  });
  it('清理只删 keep_days 有值且过期的行,并说删了几行', async () => {
    const { purgeExpiredCalls } = await import('@platform/main/flow/flow-run-repo');
    deletes.length = 0;
    expect(await purgeExpiredCalls()).toBe(2);
    expect(deletes[0]).toMatch(/DELETE flow_step_run WHERE keep_days != NONE AND created_at < time::now\(\) - 7d RETURN BEFORE/);
  });
});

describe('⭐ 带着锁进来(界面已经占住网页,再请主进程干活 —— 第 3 步 3b)', () => {
  const reuse = cap.defineCapability<{ token?: string }, string | null>({
    id: 'demo.reuse', kind: 'input', describe: '带锁进来(测试用)', inputDoc: {},
    parse: (raw) => ({ token: (raw as { token?: string })?.token }),
    prepare: async (i) => ({ needs: [{ resource: 'page:7', purpose: '演示', label: '测试网页', reuse: i.token }], ctx: undefined }),
    run: async () => lock.lockHolder('page:7')?.purpose ?? null,
  });
  it('带来的 token 正持有 → 不再申请、照常跑、跑完不替它放', async () => {
    const mine = lock.acquireLock('page:7', '界面:人卡采主页', 'ui');
    if (!mine.ok) throw new Error('应拿到');
    const r = await cap.execute(reuse.id, { token: mine.token }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: '界面:人卡采主页' });
    expect(lock.holdsLock(mine.token, 'page:7')).toBe(true);
    lock.releaseLock(mine.token);
  });
  it('带来的 token 不是持有者(过期 / 别人的 / 编的)→ refused,别人的锁不动', async () => {
    const other = lock.acquireLock('page:7', '任务:查回关', 'timer');
    if (!other.ok) throw new Error('应拿到');
    const r = await cap.execute(reuse.id, { token: 'page:7#假的' }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    if (!r.ok) expect(r.why).toContain('带来的锁');
    expect(lock.lockHolder('page:7')?.token).toBe(other.token);
    lock.releaseLock(other.token);
  });
  it('不带 token → 自己申请、跑完放', async () => {
    const r = await cap.execute(reuse.id, {}, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: '演示' });
    expect(lock.lockHolder('page:7')).toBeNull();
  });
});

describe('⭐⭐ 对外动作(kind output)只接受人点的 / 定时器;AI、收件箱要人批复(Module5-04 §5;批复入口在 P3)', () => {
  let ran = 0;
  const post = cap.defineCapability<Record<string, never>, string>({
    id: 'demo.post', kind: 'output', describe: '对外发一条(测试用)', inputDoc: {},
    parse: () => ({}), run: async () => { ran += 1; return 'sent'; },
  });
  it('ui / timer → 照做', async () => {
    ran = 0;
    expect(await cap.execute(post.id, {}, { caller: 'ui' })).toMatchObject({ ok: true });
    expect(await cap.execute(post.id, {}, { caller: 'timer' })).toMatchObject({ ok: true });
    expect(ran).toBe(2);
  });
  it('ai / inbox → refused(说清要人批复),一步不动,记一行', async () => {
    ran = 0; rows.length = 0;
    for (const caller of ['ai', 'inbox'] as const) {
      const r = await cap.execute(post.id, {}, { caller });
      expect(r).toMatchObject({ ok: false, kind: 'refused' });
      if (!r.ok) expect(r.why).toContain('人批复');
    }
    expect(ran).toBe(0);
    expect(rows.map((x) => [x.caller, x.status])).toEqual([['ai', 'refused'], ['inbox', 'refused']]);
  });
});

describe('⭐ 没成但带着做了一半的结果(求关:赞成了、留言没成)', () => {
  const half = cap.defineCapability<Record<string, never>, never>({
    id: 'demo.half', kind: 'input', describe: '做一半(测试用)', inputDoc: {},
    parse: () => ({}), run: async () => { throw cap.capFailed('留言没发出去', { liked: 'ok', replied: 'failed' }); },
  });
  it('记 failed,结果里带 partial(界面要显示哪步成了)', async () => {
    rows.length = 0;
    const r = await cap.execute(half.id, {}, { caller: 'ui' });
    expect(r).toMatchObject({ ok: false, kind: 'failed', why: '留言没发出去', partial: { liked: 'ok', replied: 'failed' } });
    expect(rows[0]).toMatchObject({ status: 'failed', output: { partial: { liked: 'ok', replied: 'failed' } } });
  });
});

describe('能力目录(给 AI 读)', () => {
  it('列得出 id / kind / describe / inputDoc', () => {
    expect(cap.listCapabilities()).toContainEqual({ id: 'demo.double', kind: 'input', describe: '把 n 翻倍(测试用)', inputDoc: { n: '整数 0–100' } });
  });
  it('同一个 id 登记两次 → 抛错(两份实现必漂)', () => {
    expect(() => cap.defineCapability({ ...demo, prepare: undefined } as never)).toThrow(/demo\.double/);
  });
});
