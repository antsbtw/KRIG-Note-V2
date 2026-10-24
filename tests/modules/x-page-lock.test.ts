/**
 * ⭐⭐⭐ 资源锁(Module5-04 第 1 步,2026-10-23)—— 左边 X 网页同一时刻只有一个占用者,别人放不掉它的锁
 *
 * 修的两个真 bug(Module5-04 §1.3):
 *  1. 「忙」被别人删掉:主进程一个网页只记一个原因,renderer 的忙同步过来直接覆盖 / 清除 ——
 *     后台查回关标了忙 → 操作台点采集盖掉 → 操作台结束清掉 → 查回关还在跑,别人看不见忙。
 *  2. 卡片采主页时不标忙:prepareAsk / prepareEngage / screenEngage / prepareVpn 只查别人,自己采的那几秒不登记 →
 *     巡检 / 后台采集到点就把网页带走。
 * ⚠️ 行为测试:真跑查回关 / 准备函数 / 巡检 / 后台调度,只把「网页」和「库」换成假的。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  /** 一扇可以按住的门:被调用的人卡在 wait() 上,测试调 open() 放行 */
  const door = () => {
    let open!: () => void;
    let entered = 0;
    const p = new Promise<void>((r) => { open = r; });
    return { wait: async () => { entered += 1; await p; }, open: () => open(), get entered() { return entered; } };
  };
  return {
    door,
    gotoDoor: null as ReturnType<typeof door> | null,
    collectDoor: null as ReturnType<typeof door> | null,
    threadDoor: null as ReturnType<typeof door> | null,
    collectThrows: false,
    calls: [] as string[],
  };
});

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async () => [[]] }),
  getXDB: () => ({
    query: async (sql: string) => {
      if (sql.includes("type::record('x_vpn_post'")) return [[{ author_rest_id: '42', author_handle: 'he' }], [{ text: '求个梯子' }]];
      if (sql.includes('FROM x_engage')) return [[], []];
      return [[]];
    },
  }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: () => undefined } }));
vi.mock('@modules/x/x-host-registry', () => ({
  getXHostState: (ws: string) => (ws === 'ws-1' ? { wcId: 7, url: '' } : null),
  listXHostStates: () => new Map([['ws-1', { wcId: 7, url: '' }]]),
}));
vi.mock('@modules/x/x-collect-ports', () => ({
  webviewPorts: (wcId: number) => ({
    goto: async (name: string) => { h.calls.push(`goto:${wcId}:${name}`); await h.gotoDoor?.wait(); return { ok: false, reason: '测试:不往下走' }; },
    harvest: async () => null,
    runScript: async () => null,
  }),
}));
vi.mock('@modules/x/x-person-collect', () => ({
  collectPersonTab: async (i: { handle: string }) => {
    h.calls.push(`collect:${i.handle}`);
    await h.collectDoor?.wait();
    if (h.collectThrows) throw new Error('测试:采到一半网页没了');
    return { reached: true, records: [], ledger: [], pageInserted: 0 };
  },
  personCollectProgress: () => null,
}));
vi.mock('@modules/x/x-engage-thread', () => ({
  loadEngageThread: async () => { h.calls.push('thread'); await h.threadDoor?.wait(); return undefined; },
}));
vi.mock('@modules/x/x-account-repo', () => ({
  accountForWrite: async () => ({ kind: 'ok', restId: 'ME', handle: 'me' }),
  readWsAccount: async () => ({ wsId: 'ws-1', restId: 'ME', handle: 'me' }),
}));
vi.mock('@modules/x/x-ops-actions-repo', () => ({
  readSettings: async () => ({ settings: { 'follow.check_known_run': 5, 'follow.check_max_pages': 3, 'follow.revisit_days': 7, 'ask.collect_pages': 2 } }),
}));
vi.mock('@modules/x/x-follow-check-repo', () => ({
  insertFollowCheck: async () => undefined, readAskStatuses: async () => [], readKnownFollowers: async () => new Set<string>(),
  readLastFollowCheck: async () => null,
}));
vi.mock('@modules/x/x-user-repo', () => ({ existingUserIds: async () => new Set(), saveUsers: async () => ({ failed: [] }), writeRelations: async () => ({}) }));
vi.mock('@modules/x/x-people-repo', () => ({ readPerson: async () => null }));
vi.mock('@modules/x/x-follow-queue', () => ({ followQueueStatus: () => ({}) }));
vi.mock('@modules/x/x-relation-task', () => ({ listRelationJobs: async () => [], startRelationTask: async () => ({ ok: false, why: '测试' }) }));
vi.mock('@modules/x/x-engage-collect', () => ({ collectEngagement: async () => ({ ok: false, why: '测试' }) }));
vi.mock('@modules/x/x-engage-repo', () => ({ readEngageCoverage: async () => ({}) }));
/** 后台调度:一个到期的任务,只看它有没有被开跑 */
const job = {
  id: 'J1', restId: '42', handle: 'he', wsId: 'ws-1', range: 'all', status: 'running',
  profile: {}, replies: {}, reposts: {}, totalPages: 0, totalSaved: 0, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};
vi.mock('@modules/x/x-bg-job-repo', () => ({
  wsWithActiveJobs: async () => ['ws-1'], activeJobsForWs: async () => [job], readJob: async () => job, saveJob: async () => undefined,
}));
vi.mock('@modules/x/x-pace-repo', () => ({ readPace: async () => ({ gapSec: 0, pages: 1 }), recordPaceOutcome: async () => undefined }));

const lock = await import('@platform/main/flow/resource-lock');
const { acquirePage, releasePage, pageBusy } = await import('@modules/x/x-page-lock');
const { checkFollowBack } = await import('@modules/x/x-follow-check');
const { prepareAsk } = await import('@modules/x/x-ask-prepare');
const { screenEngage } = await import('@modules/x/x-engage-prepare');
/** ⭐ 2026-10-23 第 2 步:互动卡准备迁到能力层 —— 占网页由执行器做(x.engage.prepare) */
const { execute } = await import('@platform/main/capability/capability');
const { registerXCapabilities, X_CAP } = await import('@modules/x/x-capabilities');
registerXCapabilities();
/** 统一结果 → 旧形状(ok + why),下面的断言照旧 */
const prepareEngage = async (ws: string, _acc: string, restId: string, handle: string): Promise<unknown> => {
  const r = await execute(X_CAP.engagePrepare, { wsId: ws, restId, handle }, { caller: 'ui' });
  return r.ok ? r.value : { ok: false, why: r.why };
};
const { prepareVpn } = await import('@modules/x/x-vpn-run');
const { dailyUpkeepTick } = await import('@modules/x/x-daily-upkeep');
const { tickOnce, _resetBgRunner } = await import('@modules/x/x-bg-runner');

/** 等到被调用方卡在门上 */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i += 1) await new Promise((r) => setTimeout(r, 1));
  expect(cond()).toBe(true);
}

beforeEach(() => {
  lock._resetLocks();
  _resetBgRunner();
  h.gotoDoor = null; h.collectDoor = null; h.threadDoor = null; h.collectThrows = false; h.calls = [];
});

describe('平台层资源锁(不认识 X)', () => {
  it('一个资源只有一个持有者;被拒时说清被谁占着、干什么', () => {
    const a = lock.acquireLock('page:7', '查回关', 'timer');
    expect(a.ok).toBe(true);
    const b = lock.acquireLock('page:7', '操作台采集', 'ui');
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.holder).toMatchObject({ purpose: '查回关', caller: 'timer' });
    /** 别的资源不受影响 */
    expect(lock.acquireLock('page:8', '操作台采集', 'ui').ok).toBe(true);
  });

  it('⭐⭐ 只有持有者能放:拿错 token 放不掉', () => {
    const a = lock.acquireLock('page:7', '查回关', 'timer');
    if (!a.ok) throw new Error('应拿到');
    expect(lock.releaseLock('别人的 token')).toBe(false);
    expect(lock.lockHolder('page:7')?.purpose).toBe('查回关');
    expect(lock.releaseLock(a.token)).toBe(true);
    expect(lock.lockHolder('page:7')).toBeNull();
    /** 放两次:第二次说不是 */
    expect(lock.releaseLock(a.token)).toBe(false);
  });

  it('⭐ 超时收回要响(console.error),不静默过期', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const a = lock.acquireLock('page:7', '查回关', 'timer', { ttlMs: 1000, now: 0 });
    expect(a.ok).toBe(true);
    expect(lock.lockHolder('page:7', 500)?.purpose).toBe('查回关');
    expect(lock.lockHolder('page:7', 1001)).toBeNull();
    expect(err).toHaveBeenCalled();
    expect(String(err.mock.calls[0]?.[0])).toContain('查回关');
    err.mockRestore();
  });
});

describe('⭐⭐⭐ 后台查回关持锁时,操作台申请 → 被拒,且查回关的锁没被放掉', () => {
  it('查回关跑着 → 操作台申请被拒(说出是查回关)→ 操作台乱放一把 → 查回关的锁还在 → 查完才空', async () => {
    h.gotoDoor = h.door();
    const run = checkFollowBack('ws-1', 'auto');
    await until(() => h.gotoDoor!.entered === 1);
    expect(pageBusy(7)).toContain('查回关');

    const ui = acquirePage(7, '操作台正在采集', 'ui');
    expect(ui.ok).toBe(false);
    if (!ui.ok) expect(ui.why).toContain('查回关');

    /** 旧 bug 的样子:操作台结束时把「忙」清掉 —— 现在它手里没有查回关的 token,放不掉 */
    expect(releasePage('操作台以为是自己的')).toBe(false);
    expect(pageBusy(7)).toContain('查回关');

    /** 别的占用者(关注队列 / 后台采集)同样看得见、抢不走 */
    expect(acquirePage(7, '关注队列', 'timer').ok).toBe(false);

    h.gotoDoor.open();
    await run;
    expect(pageBusy(7)).toBeNull();
    /** 查完了,操作台再申请就拿得到 */
    const again = acquirePage(7, '操作台正在采集', 'ui');
    expect(again.ok).toBe(true);
  });

  it('操作台先占着 → 查回关到点让路(不去 followers 页)', async () => {
    const ui = acquirePage(7, '操作台正在采集', 'ui');
    expect(ui.ok).toBe(true);
    const r = await checkFollowBack('ws-1', 'auto');
    expect(r).toMatchObject({ ran: false });
    if (!r.ran) expect(r.why).toContain('操作台正在采集');
    expect(h.calls.filter((c) => c.startsWith('goto'))).toEqual([]);
    expect(pageBusy(7)).toBe('操作台正在采集');
  });
});

describe('⭐⭐⭐ 卡片准备期间,巡检 / 后台采集到点 → 让路', () => {
  /** 四个准备函数:采主页 / 读来龙去脉的那几秒都要占住网页 */
  const preparers: Array<[string, () => Promise<unknown>, 'collect' | 'thread']> = [
    ['求关卡 prepareAsk', () => prepareAsk('ws-1', 'ME', '42', 'he'), 'collect'],
    ['互动卡 prepareEngage', () => prepareEngage('ws-1', 'ME', '42', 'he'), 'collect'],
    ['互动先过一轮 screenEngage', () => screenEngage('ws-1', '42', 'he'), 'collect'],
    ['求助回复卡 prepareVpn', () => prepareVpn('ws-1', 'ME', '123'), 'thread'],
  ];

  for (const [name, prepare, where] of preparers) {
    it(`${name}:准备中 → 网页被占;巡检查回关让路、后台不开跑;准备完放锁`, async () => {
      const d = h.door();
      if (where === 'collect') h.collectDoor = d; else h.threadDoor = d;
      const run = prepare();
      await until(() => d.entered === 1);
      expect(pageBusy(7)).not.toBeNull();

      /** 巡检到点(查回关恒到期:上次查回关 = null)→ 让路,不去 followers */
      await dailyUpkeepTick(Date.parse('2026-10-23T12:00:00Z'));
      expect(h.calls.filter((c) => c.startsWith('goto'))).toEqual([]);

      /** 后台采集到点 → 不开跑 */
      const drive = vi.fn(async () => undefined);
      await tickOnce(drive);
      expect(drive).not.toHaveBeenCalled();

      d.open();
      await run;
      expect(pageBusy(7)).toBeNull();
    });
  }

  it('采到一半抛错 → 锁照样放掉', async () => {
    h.collectThrows = true;
    await expect(prepareAsk('ws-1', 'ME', '42', 'he')).rejects.toThrow('网页没了');
    expect(pageBusy(7)).toBeNull();
  });

  it('网页被别人占着 → 准备函数直接被拒,不去采', async () => {
    const other = acquirePage(7, '任务:查回关', 'timer');
    expect(other.ok).toBe(true);
    for (const [, prepare] of preparers) {
      const r = (await prepare()) as { ok: boolean; why?: string };
      expect(r).toMatchObject({ ok: false });
      expect(r.why).toContain('查回关');
    }
    expect(h.calls).toEqual([]);
  });

  it('对照(证明上面能失败):网页空着时,后台到点会开跑,且跑的时候占着网页', async () => {
    let held: string | null = null;
    await tickOnce(async () => { held = pageBusy(7); });
    expect(held).toContain('后台');
    expect(pageBusy(7)).toBeNull();
  });

  it('后台在采时,准备函数被拒(后台的 runningWc 已并进这把锁)', async () => {
    let r: unknown;
    await tickOnce(async () => { r = await prepareEngage('ws-1', 'ME', '42', 'he'); });
    expect(r).toMatchObject({ ok: false });
    expect((r as { why: string }).why).toContain('后台');
  });
});
