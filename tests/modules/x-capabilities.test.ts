/**
 * ⭐⭐⭐ X 先接的三个能力(Module5-04 第 2 步,2026-10-23)—— 形状差最大的三个:
 *   x.engage.prepare  占网页(采主页 + 读来龙去脉)
 *   x.vpn.find        花搜索额度(整轮找帖期间占着网页,搜索带着同一把锁)
 *   x.engage.overview 纯读库(不占网页)
 * 判据:三个入口(界面 / 定时器 / 收件箱)各调一次 —— 检查 / 锁 / 记录 / 结果一致;flow_step_run 有行(含 refused)。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  account: { wsId: 'ws-1', handle: 'me', restId: 'ME' } as Record<string, unknown> | null,
  host: { wcId: 7, url: '' } as { wcId: number; url: string } | null,
  budget: { usedPages: 0, freePages: 30 } as Record<string, unknown>,
  calls: [] as string[],
  heldInCollect: [] as Array<string | null>,
  searchTokens: [] as Array<string | undefined>,
}));

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
  getXDB: () => ({ query: async () => [[], []] }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: () => undefined } }));
vi.mock('@modules/x/x-host-registry', () => ({
  getXHostState: () => h.host,
  listXHostStates: () => new Map(h.host ? [['ws-1', h.host]] : []),
}));
vi.mock('@modules/x/x-account-repo', () => ({
  readWsAccount: async () => h.account,
  accountForWrite: async () => ({ kind: 'ok', restId: 'ME', handle: 'me' }),
}));
vi.mock('@modules/x/x-person-collect', () => ({
  collectPersonTab: async (i: { handle: string }) => {
    const { pageBusy } = await import('@modules/x/x-page-lock');
    h.calls.push(`collect:${i.handle}`);
    h.heldInCollect.push(pageBusy(7));
    return { reached: true, records: [], ledger: [], pageInserted: 0 };
  },
}));
vi.mock('@modules/x/x-engage-thread', () => ({ loadEngageThread: async () => undefined }));
vi.mock('@modules/x/x-ops-actions-repo', () => ({ readSettings: async () => ({ settings: { 'ask.collect_pages': 2 } }) }));
vi.mock('@modules/x/x-people-repo', () => ({ readPerson: async () => null }));
vi.mock('@modules/x/x-user-repo', () => ({ writeRelations: async () => ({}) }));
vi.mock('@modules/x/x-search-budget', () => ({ searchBudget: () => h.budget, recordSearch: () => undefined }));
vi.mock('@platform/main/db/search-recipe-repo', () => ({
  listAllRecipes: async () => [{ name: 'VPN求助-中文', keywords: ['梯子'], template: 'plain' }],
}));
vi.mock('@modules/x/x-search-scroll', () => ({
  collectSearchByScroll: async (i: { ownToken?: string; wsId?: string }) => {
    const { holdsPage } = await import('@modules/x/x-page-lock');
    h.calls.push('search');
    h.searchTokens.push(i.ownToken);
    if (i.ownToken === undefined || !holdsPage(i.ownToken, 7)) return { ok: false, why: '没带着找帖的锁', rateLimited: false, pages: [] };
    return { ok: true, rateLimited: false, pages: [], totals: { pages: 1, uniqueTweets: 0, xTweets: 0 } };
  },
}));
vi.mock('@modules/x/x-vpn-help', async () => ({
  ...(await vi.importActual<object>('@modules/x/x-vpn-help')),
  VPN_RECIPES: ['VPN求助-中文'],
}));
vi.mock('@modules/x/x-engage-repo', () => ({
  readEngageOverview: async (a: string, hd: string, n: number) => { h.calls.push(`overview:${a}:${hd}:${n}`); return { days: 7, mutualBlue: 3 }; },
}));

const { execute } = await import('@platform/main/capability/capability');
const { registerXCapabilities, X_CAP } = await import('@modules/x/x-capabilities');
const { acquirePage, releasePage, pageBusy } = await import('@modules/x/x-page-lock');
const { _resetLocks } = await import('@platform/main/flow/resource-lock');
registerXCapabilities();

const CALLERS = ['ui', 'timer', 'inbox'] as const;
const prepIn = { wsId: 'ws-1', restId: '42', handle: 'he' };

beforeEach(() => {
  _resetLocks();
  h.rows.length = 0; h.calls.length = 0; h.heldInCollect.length = 0; h.searchTokens.length = 0;
  h.account = { wsId: 'ws-1', handle: 'me', restId: 'ME' };
  h.host = { wcId: 7, url: '' };
  h.budget = { usedPages: 0, freePages: 30 };
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('x.engage.prepare —— 占网页', () => {
  it('⭐⭐ 三个入口各调一次:结果一样、采主页时都占着网页、各记一行(只差 caller)', async () => {
    const rs = [];
    for (const caller of CALLERS) rs.push(await execute(X_CAP.engagePrepare, prepIn, { caller }));
    for (const r of rs) expect(r).toMatchObject({ ok: true, value: { ok: true, person: { restId: '42', handle: 'he' } } });
    expect(h.heldInCollect).toEqual(['互动卡:准备 @he', '互动卡:准备 @he', '互动卡:准备 @he']);
    expect(pageBusy(7)).toBeNull();
    expect(h.rows.map((r) => [r.capability, r.caller, r.status, r.subjectRef])).toEqual(
      CALLERS.map((c) => [X_CAP.engagePrepare, c, 'ok', 'x_author:42']));
  });

  it('网页被占着 → 三个入口都 refused(同一句话),不去采;记 refused', async () => {
    const other = acquirePage(7, '任务:查回关', 'timer');
    if (!other.ok) throw new Error('应拿到');
    const whys = [];
    for (const caller of CALLERS) {
      const r = await execute(X_CAP.engagePrepare, prepIn, { caller });
      expect(r).toMatchObject({ ok: false, kind: 'refused' });
      if (!r.ok) whys.push(r.why.replace(/已 \d+ 秒/, ''));
    }
    expect(new Set(whys).size).toBe(1);
    expect(whys[0]).toContain('任务:查回关');
    expect(h.calls).toEqual([]);
    expect(h.rows.map((r) => r.status)).toEqual(['refused', 'refused', 'refused']);
    releasePage(other.token);
  });

  it('号没认出 / 网页没开 → refused;参数不对 → invalid(原来收件箱一组只校验 wsId)', async () => {
    h.account = null;
    expect(await execute(X_CAP.engagePrepare, prepIn, { caller: 'inbox' })).toMatchObject({ ok: false, kind: 'refused' });
    h.account = { wsId: 'ws-1', handle: 'me', restId: 'ME' };
    h.host = null;
    expect(await execute(X_CAP.engagePrepare, prepIn, { caller: 'inbox' })).toMatchObject({ ok: false, kind: 'refused', why: 'X 网页没开' });
    expect(await execute(X_CAP.engagePrepare, { wsId: 'ws-1', restId: 'abc', handle: 'he' }, { caller: 'inbox' })).toMatchObject({ ok: false, kind: 'invalid' });
    expect(h.calls).toEqual([]);
  });
});

describe('x.vpn.find —— 花搜索额度', () => {
  it('⭐ 整轮找帖占着网页,每次搜索带着同一把锁进去(中途别人插不进来)', async () => {
    const r = await execute(X_CAP.vpnFind, { wsId: 'ws-1' }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: true, value: { runs: [{ recipe: 'VPN求助-中文' }] } });
    expect(h.searchTokens).toHaveLength(1);
    expect(h.searchTokens[0]).toBeTruthy();
    expect(pageBusy(7)).toBeNull();
  });

  it('⭐⭐ 额度不够 / 刚撞过限流 → 三个入口都 refused(原来界面「再找一轮」不查额度),不占网页、不搜;记 refused', async () => {
    h.budget = { usedPages: 40, freePages: 0, waitUntil: Date.now() + 600_000 };
    for (const caller of CALLERS) {
      const r = await execute(X_CAP.vpnFind, { wsId: 'ws-1' }, { caller });
      expect(r).toMatchObject({ ok: false, kind: 'refused' });
      if (!r.ok) expect(r.why).toContain('限流');
    }
    h.budget = { usedPages: 40, freePages: 0 };
    const r = await execute(X_CAP.vpnFind, { wsId: 'ws-1' }, { caller: 'ui' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    if (!r.ok) expect(r.why).toContain('额度');
    expect(h.calls).toEqual([]);
    expect(h.rows.map((x) => x.status)).toEqual(['refused', 'refused', 'refused', 'refused']);
  });
});

describe('x.engage.overview —— 纯读库', () => {
  it('不占网页(网页被占着照样读);三个入口结果一样;按号读', async () => {
    const other = acquirePage(7, '后台正在采 @x', 'timer');
    if (!other.ok) throw new Error('应拿到');
    for (const caller of CALLERS) {
      expect(await execute(X_CAP.engageOverview, { wsId: 'ws-1', limit: 20 }, { caller })).toMatchObject({ ok: true, value: { mutualBlue: 3 } });
    }
    expect(h.calls).toEqual(['overview:ME:me:20', 'overview:ME:me:20', 'overview:ME:me:20']);
    expect(pageBusy(7)).toBe('后台正在采 @x');
    expect(h.rows.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
    releasePage(other.token);
  });
});

describe('接线守卫:三个入口都走执行器,旧路已删', () => {
  const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  /** 剥注释(⚠️ 不吃 https:// —— 守卫剥注释第四刀) */
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const IPC = strip(read('src/modules/x/x-data-ipc.ts'));
  const INBOX = strip(read('src/modules/x/x-dev-inbox.ts'));
  const caseOf = (name: string): string => {
    const i = IPC.indexOf(`case '${name}':`);
    expect(i, name).toBeGreaterThan(-1);
    const j = IPC.indexOf('case ', i + 10);
    return IPC.slice(i, j);
  };

  it('IPC 三个 op 只转发给 execute(caller ui),不再自己校验 / 认号', () => {
    for (const [op, id] of [['engagePrepare', 'engagePrepare'], ['engageOverview', 'engageOverview'], ['vpnFind', 'vpnFind']]) {
      const c = caseOf(op);
      expect(c, op).toMatch(new RegExp(`execute\\(X_CAP\\.${id}, `));
      expect(c, op).toMatch(/caller: 'ui'/);
      expect(c, op).not.toMatch(/accountOfWs|readWsAccount|prepareEngage\(|findVpnPosts\(|readEngageOverview\(/);
    }
  });

  it('收件箱:能调目录里任意能力(op call),能列目录(op capabilities);老三个 op 也走执行器', () => {
    expect(INBOX).toMatch(/cmd\.op === 'call'[\s\S]{0,200}execute\(cmd\.capability, cmd\.input \?\? \{\}, \{ caller: 'inbox' \}\)/);
    expect(INBOX).toMatch(/cmd\.op === 'capabilities'[\s\S]{0,120}listCapabilities\(\)/);
    for (const id of ['engagePrepare', 'engageOverview', 'vpnFind']) expect(INBOX).toMatch(new RegExp(`execute\\(X_CAP\\.${id}, `));
    expect(INBOX).not.toMatch(/prepareEngage\(|findVpnPosts\(|readEngageOverview\(/);
  });

  it('旧的 prepareEngage / findVpnPosts 已删(迁一个删一个)', () => {
    expect(strip(read('src/modules/x/x-engage-prepare.ts'))).not.toMatch(/export async function prepareEngage\(/);
    expect(strip(read('src/modules/x/x-vpn-run.ts'))).not.toMatch(/export async function findVpnPosts\(/);
  });

  it('X 主进程入口登记了能力(删 X 目录即卸载)', () => {
    expect(strip(read('src/modules/x/main.ts'))).toMatch(/registerXCapabilities\(\);/);
  });
});
