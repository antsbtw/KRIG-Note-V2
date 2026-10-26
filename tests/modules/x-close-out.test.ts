/**
 * ⭐⭐⭐ Module5-04 收尾(2026-10-26)—— 五条判据里 1 / 2 / 3 / 4 的缺口
 *
 * 用户 10-26 追问「同一个功能多个地方有重复的执行代码的问题解决完毕了吗?」→ 逐条对判据,还差三件:
 *   ① 后台采集每一段、关注队列每关一个人:定时器自己占锁、自己干,不进执行器 → 执行记录里没有(判据 1 / 4)
 *      → 定时器只「到点调一下」:x.bg.segment / x.person.follow,占锁 / 记录归执行器
 *   ② 求关卡发送在 runAsk 里自己占锁,占锁人写死「界面」→ 能力声明占网页,执行器占;
 *      认号只在缺数字 id 时才开主页(按需占锁,保留),但占锁人记真实调用方
 *   ③ 操作台(XConsole)在界面里直接驱动网页 13 处 + 在界面进程跑整套采集(判据 2 / 3)
 *      → 用户 10-26 同意拆;配方(只有它有)搬到「任务」页(用户:「运营」= dashboard,「任务」才是真正的执行者)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<[string, unknown[]]>,
  /** 每次干活那一刻,网页 7 的锁上写着什么 */
  heldAs: [] as Array<[string, string | null]>,
  ret: {} as Record<string, unknown>,
  jobs: new Map<string, Record<string, unknown>>(),
}));
const work = (name: string, dflt: unknown) => async (...a: unknown[]): Promise<unknown> => {
  const { pageBusy } = await import('@modules/x/x-page-lock');
  h.calls.push([name, a]);
  h.heldAs.push([name, pageBusy(7)]);
  return name in h.ret ? h.ret[name] : dflt;
};

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async (sql: string, v: Record<string, unknown>) => { if (sql.includes('CREATE flow_step_run')) h.rows.push(v); return [[]]; } }),
  getXDB: () => ({ query: async () => [[]] }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: () => undefined } }));
vi.mock('@modules/x/x-host-registry', () => ({
  getXHostState: (ws: string) => (ws === 'ws-1' ? { wcId: 7, url: '' } : null),
  listXHostStates: () => new Map([['ws-1', { wcId: 7, url: '' }]]),
}));
vi.mock('@modules/x/x-account-repo', () => ({
  readWsAccount: async () => ({ wsId: 'ws-1', handle: 'me', restId: 'ME' }),
  accountForWrite: async () => ({ kind: 'ok', restId: 'ME', handle: 'me' }),
  identifyAccount: async () => ({ status: 'ok', account: { wsId: 'ws-1', handle: 'me', restId: 'ME' } }),
}));
vi.mock('@modules/x/x-ask-run', async (orig) => ({ ...(await orig<object>()), runAsk: work('runAsk', { ok: true, liked: 'ok', replied: 'ok', followed: 'ok' }) }));
vi.mock('@modules/x/x-person-act', () => ({
  followOn: work('followOn', { state: 'followed' }),
  unfollowOn: work('unfollowOn', { done: true }), verifyPersonOn: work('verifyPersonOn', { kind: 'same' }),
  unfollowHalted: () => null, resumeUnfollow: () => false,
}));
vi.mock('@modules/x/x-bg-job-repo', async (orig) => ({
  ...(await orig<object>()),
  readJob: async (id: string) => h.jobs.get(id) ?? null,
}));
vi.mock('@modules/x/x-bg-runner', async (orig) => ({
  ...(await orig<object>()),
  driveSegment: work('driveSegment', { saved: true, progress: '帖子第 3 页' }),
}));

const { execute } = await import('@platform/main/capability/capability');
const { registerXCapabilities } = await import('@modules/x/x-capabilities');
const { acquirePage, releasePage } = await import('@modules/x/x-page-lock');
const { _resetLocks } = await import('@platform/main/flow/resource-lock');
registerXCapabilities();

beforeEach(() => {
  _resetLocks();
  h.rows.length = 0; h.calls.length = 0; h.heldAs.length = 0; h.ret = {};
  h.jobs = new Map([['job-1', { id: 'job-1', handle: 'he', wsId: 'ws-1', status: 'running', range: 'all' }]]);
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('① 定时器只「到点调一下」:后台采集一段 / 关注一个人都进执行器', () => {
  it('⭐ x.bg.segment:执行器占着网页(锁上写明在采谁)跑一段,记一行(caller timer)', async () => {
    const r = await execute('x.bg.segment', { wsId: 'ws-1', jobId: 'job-1', handle: 'he' }, { caller: 'timer' });
    expect(r).toMatchObject({ ok: true, value: { progress: '帖子第 3 页' } });
    expect(h.heldAs).toEqual([['driveSegment', '后台正在采 @he(可在人卡暂停)']]);
    expect(h.calls[0][1].slice(0, 2)).toEqual(['ws-1', 7]);
    expect(h.rows.map((x) => [x.caller, x.status])).toEqual([['timer', 'ok']]);
  });
  it('网页被别人占着 → refused,没跑;任务没了 / 暂停了 → refused', async () => {
    const other = acquirePage(7, '正在核对', 'ui');
    if (!other.ok) throw new Error('应拿到');
    expect(await execute('x.bg.segment', { wsId: 'ws-1', jobId: 'job-1', handle: 'he' }, { caller: 'timer' })).toMatchObject({ ok: false, kind: 'refused' });
    releasePage(other.token);
    expect(await execute('x.bg.segment', { wsId: 'ws-1', jobId: 'nope', handle: 'he' }, { caller: 'timer' })).toMatchObject({ ok: false, kind: 'refused' });
    h.jobs.set('job-1', { ...h.jobs.get('job-1'), status: 'paused' });
    expect(await execute('x.bg.segment', { wsId: 'ws-1', jobId: 'job-1', handle: 'he' }, { caller: 'timer' })).toMatchObject({ ok: false, kind: 'refused' });
    expect(h.calls).toEqual([]);
  });

  it('⭐ x.person.follow:对外动作 —— 定时器 / 人点照做(执行器占锁),AI / 收件箱 → 要人批复', async () => {
    const inp = { wsId: 'ws-1', restId: '42', handle: 'he', reason: '蓝V互关' };
    expect(await execute('x.person.follow', inp, { caller: 'timer' })).toMatchObject({ ok: true, value: { state: 'followed' } });
    expect(h.heldAs).toEqual([['followOn', '关注 @he']]);
    for (const caller of ['ai', 'inbox'] as const) {
      const r = await execute('x.person.follow', inp, { caller });
      expect(r).toMatchObject({ ok: false, kind: 'refused' });
      if (!r.ok) expect(r.why).toContain('人批复');
    }
    expect(h.calls).toHaveLength(1);
    h.ret.followOn = { state: 'failed', detail: '关注没成:no-button' };
    expect(await execute('x.person.follow', inp, { caller: 'timer' })).toMatchObject({ ok: false, kind: 'failed', why: '关注没成:no-button', partial: { state: 'failed' } });
  });
});

describe('② 求关卡发送:执行器占锁(不再在 runAsk 里写死「界面」)', () => {
  const run = { wsId: 'ws-1', restId: '42', handle: 'he', tweetId: '123', tweetText: 'x', pickKind: 'tweet', reply: '互关一起冲' };
  it('⭐ 占着网页做;网页忙 → refused,一步不动', async () => {
    expect(await execute('x.ask.run', run, { caller: 'ui' })).toMatchObject({ ok: true });
    expect(h.heldAs).toEqual([['runAsk', '任务:正在求关 @he']]);
    expect(h.calls[0][1][1]).toBe(7);
    const other = acquirePage(7, '后台正在采 @x', 'timer');
    if (!other.ok) throw new Error('应拿到');
    const r = await execute('x.ask.run', run, { caller: 'ui' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    if (!r.ok) expect(r.why).toContain('后台正在采 @x');
    expect(h.calls).toHaveLength(1);
    releasePage(other.token);
  });
});

describe('守卫(从源码推,不写死)', () => {
  const ROOT = resolve(__dirname, '../..');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const X = walk(join(ROOT, 'src/modules/x')).map((p) => ({ f: relative(join(ROOT, 'src/modules/x'), p), s: strip(readFileSync(p, 'utf8')) }));
  const src = (f: string): string => X.find((x) => x.f === f)?.s ?? '';
  const fnBody = (s: string, head: string): string => {
    const i = s.indexOf(head);
    if (i < 0) return '';
    const j = s.indexOf('\n}\n', i);
    return s.slice(i, j < 0 ? undefined : j);
  };

  it('扫描本身没坏', () => {
    expect(X.length).toBeGreaterThan(80);
    expect(src('x-page-lock.ts')).toMatch(/export function acquirePage/);
  });

  it('⭐⭐ 自己占网页锁的地方只剩这几处底座(新加一处 → 红):锁本身 / 开发收件箱占网页工具 / 认号按需(界面自带锁的 pageAcquire 已拆)', () => {
    const who = X.filter((x) => /\bacquirePage\(/.test(x.s)).map((x) => x.f).sort();
    expect(who).toEqual(['x-account-repo.ts', 'x-dev-inbox.ts', 'x-page-lock.ts']);
    /** 界面那边也没有「先占住网页再请主进程干活」的入口了 */
    expect(X.filter((x) => /op: 'pageAcquire'|acquireXPage/.test(x.s)).map((x) => x.f)).toEqual([]);
  });

  it('⭐ 后台采集:tickOnce 不占锁,默认 drive 调 x.bg.segment(caller timer)', () => {
    const B = src('x-bg-runner.ts');
    const tick = fnBody(B, 'export async function tickOnce');
    expect(tick.length).toBeGreaterThan(300);
    expect(tick).not.toMatch(/acquirePage|releasePage/);
    expect(B).toMatch(/execute\('x\.bg\.segment', \{ wsId, jobId: job\.id, handle: job\.handle \}, \{ caller: 'timer' \}\)/);
  });

  it('⭐ 关注队列:每关一个人调 x.person.follow(caller timer),不自己占锁、不直接 followOn', () => {
    const Q = src('x-follow-queue.ts');
    expect(Q).toMatch(/execute\('x\.person\.follow', /);
    expect(Q).toMatch(/\{ caller: 'timer' \}/);
    expect(Q).not.toMatch(/acquirePage|followOn\(/);
  });

  it('⭐ 求关发送不自己占锁;认号按需占锁时记真实调用方', () => {
    expect(src('x-ask-run.ts')).not.toMatch(/acquirePage|releasePage/);
    const I = fnBody(src('x-account-repo.ts'), 'export async function identifyAccount');
    expect(I).toMatch(/acquirePage\(wcId, IDENTIFY_BUSY, caller\)/);
    expect(src('x-capabilities-page.ts')).toMatch(/identifyAccount\(i\.wsId, caller\)/);
  });

  it('⭐⭐ 操作台拆了:界面组件里没有直接驱动网页;配方在「任务」页', () => {
    expect(existsSync(join(ROOT, 'src/modules/x/XConsole.tsx'))).toBe(false);
    const tsx = X.filter((x) => x.f.endsWith('.tsx'));
    expect(tsx.length).toBeGreaterThan(10);
    expect(tsx.filter((x) => /webDomInvoke|webInputInvoke/.test(x.s)).map((x) => x.f)).toEqual([]);
    expect(tsx.filter((x) => /XConsole/.test(x.s)).map((x) => x.f)).toEqual([]);
    /** 配方的增删在任务页那一族(XTask*)里 */
    const recipe = tsx.filter((x) => /op: 'upsert', recipe/.test(x.s) && /op: 'delete', recipeId/.test(x.s)).map((x) => x.f);
    expect(recipe.length).toBe(1);
    expect(recipe[0]).toMatch(/^XTask/);
  });
});
