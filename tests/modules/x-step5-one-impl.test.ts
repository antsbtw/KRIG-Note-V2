/**
 * ⭐⭐⭐ 第 5 步:合并重复(Module5-04,2026-10-26)—— 关注 / 取关 / 刷新资料各留一份;采集账写法统一
 *
 *   关注:原来主进程两份(关注队列 x-follow-queue 每步 / 求关卡 x-ask-run 第 ③ 步),去主页 → 点 → 写关系 → 记动作各抄一遍
 *        → x-person-act.ts followOn 一份(和取关 unfollowOn 挨着)
 *   读主页资料:点人核对 / 关系采集 / 认号各抄一遍 harvest + pickProfileUser → x-person-profile.ts readProfileOn 一份
 *   刷新落库:核对 / x.person.refresh / 关系采集 —— 关系采集那份不留痕不记账 → x-save-batch.ts savePersonRefresh 一份
 *   采集账:存推 / 存人只走 x-save-batch;账本只经 logCollect(记不上响 + 留痕,不让落库报失败)
 *          —— 原来逐页存推(x-save-page)记不上就整页报失败;查回关 / 名单采集 / 后台整批补存不记账
 *
 * 判据(交接文档 §4):grep 只剩一份实现。守卫从全仓文件推(不写死清单),新增的文件天然在视野里。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  ret: {} as Record<string, unknown>,
  actions: [] as Array<Record<string, unknown>>,
  relations: [] as Array<[unknown, unknown, string]>,
  ledger: [] as Array<Record<string, unknown>>,
  ledgerThrows: false,
}));

vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: async () => [[]] }),
  getXDB: () => ({ query: async () => [[]] }),
}));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: () => undefined } }));
vi.mock('@platform/main/db/search-recipe-repo', () => ({ listAllRecipes: async () => [] }));
vi.mock('@modules/x/x-collect-ports', () => ({
  webviewPorts: () => ({
    goto: async (...a: unknown[]) => { h.calls.push(['goto', a]); return 'goto' in h.ret ? h.ret.goto : { ok: true }; },
    runScript: async (...a: unknown[]) => { h.calls.push(['runScript', a]); return h.ret.runScript ?? null; },
    harvest: async (...a: unknown[]) => { h.calls.push(['harvest', a]); return h.ret.harvest ?? null; },
  }),
}));
vi.mock('@modules/x/x-ops-actions-repo', () => ({
  appendAction: async (a: Record<string, unknown>) => { h.actions.push(a); },
  readUnfollowGate: async () => ({ allowed: true }),
  readFollowGate: async () => ({ allowed: true }),
}));
vi.mock('@modules/x/x-collect-log-repo', () => ({
  appendCollectLog: async (e: Record<string, unknown>) => { if (h.ledgerThrows) throw new Error('账本库挂了'); h.ledger.push(e); },
}));
vi.mock('@modules/x/x-tweet-repo', () => ({
  saveTweets: async (recs: unknown[]) => ({ inserted: recs.length, updated: 0, failed: [] }),
  existingTweetIds: async (ids: string[]) => ids,
}));
vi.mock('@modules/x/x-user-repo', () => ({
  writeRelations: async (acc: unknown, obs: unknown, source: string) => { h.relations.push([acc, obs, source]); return { report: {}, before: new Map() }; },
  saveUsers: async (users: unknown[], _ctx: unknown, account: unknown) => { h.calls.push(['saveUsers', [account]]); return { inserted: users.length, updated: 0, failed: [], skippedNoHandle: 0, skippedNoRestId: 0, relation: { written: 0, changed: 0, failed: 0 } }; },
  saveTweetAuthors: async () => ({ inserted: 0, updated: 0, failed: [], skippedNoRestId: 0, relation: { written: 0, changed: 0, failed: 0 } }),
  refreshPerson: async () => ({ isNew: true, stale: false, changes: [], relation: { account: 'me' } }),
}));
vi.mock('@modules/x/x-account-repo', () => ({ accountForWrite: async () => ({ kind: 'ok', restId: '100', handle: 'me' }) }));

const ACC = { kind: 'ok', restId: '100', handle: 'me' } as const;

beforeEach(() => {
  h.calls.length = 0; h.actions.length = 0; h.relations.length = 0; h.ledger.length = 0;
  h.ret = {}; h.ledgerThrows = false;
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe('关注一份:followOn(去主页 → 点 → 写关系 → 记动作)', () => {
  it('关上了 → 写关系(follow-action)+ 记动作 ok', async () => {
    const { followOn } = await import('@modules/x/x-person-act');
    h.ret.runScript = { state: 'followed' };
    const r = await followOn('ws-1', 7, ACC as never, { restId: '5', handle: 'bob' }, '求关 · 推文 9');
    expect(r).toEqual({ state: 'followed' });
    expect(h.calls[0]).toEqual(['goto', ['x.profile', { handle: 'bob' }]]);
    expect(h.relations).toHaveLength(1);
    expect(h.relations[0][2]).toBe('follow-action');
    expect(h.actions).toEqual([expect.objectContaining({ action: 'follow', targetRestId: '5', result: 'ok', reason: '求关 · 推文 9', wsId: 'ws-1', decidedBy: 'human' })]);
  });
  it('本来就关注 → 写关系,不记动作', async () => {
    const { followOn } = await import('@modules/x/x-person-act');
    h.ret.runScript = { state: 'already-following' };
    expect((await followOn('ws-1', 7, ACC as never, { restId: '5', handle: 'bob' })).state).toBe('already-following');
    expect(h.relations).toHaveLength(1);
    expect(h.actions).toHaveLength(0);
  });
  it('没关上 / 去不到主页 → 记动作 failed(带原因),不写关系;原因回给调用方', async () => {
    const { followOn } = await import('@modules/x/x-person-act');
    h.ret.runScript = { state: 'no-button', why: '找不到关注按钮' };
    const r = await followOn('ws-1', 7, ACC as never, { restId: '5', handle: 'bob' });
    expect(r.state).toBe('failed');
    expect(r.detail).toMatch(/no-button.*找不到关注按钮/);
    expect(h.relations).toHaveLength(0);
    expect(h.actions[0]).toMatchObject({ result: 'failed', detail: r.detail });

    h.actions.length = 0; h.calls.length = 0;
    h.ret.goto = { ok: false, reason: '超时' };
    const g = await followOn('ws-1', 7, ACC as never, { restId: '5', handle: 'bob' });
    expect(g).toMatchObject({ state: 'failed', detail: expect.stringMatching(/去不到他的主页:超时/) });
    expect(h.calls.map((c) => c[0])).toEqual(['goto']);
    expect(h.actions[0]).toMatchObject({ result: 'failed' });
  });
});

describe('读主页资料一份 / 刷新落库一份', () => {
  it('readProfileOn:没来 / 对不上 / 读到 —— 三种都说清楚', async () => {
    const { readProfileOn } = await import('@modules/x/x-person-profile');
    expect(await readProfileOn(7, { handle: 'bob' })).toMatchObject({ ok: false, why: expect.stringMatching(/去不到他的主页/) });
    h.ret.harvest = { items: [], problems: ['403'] };
    expect(await readProfileOn(7, { handle: 'bob' })).toMatchObject({ ok: false, why: expect.stringMatching(/主页资料那条请求没来:403/) });
  });
  it('savePersonRefresh:写库 + 新人记一笔账(profile-refresh);账记不上不报失败', async () => {
    const { savePersonRefresh } = await import('@modules/x/x-save-batch');
    const d = await savePersonRefresh({ restId: '5', handle: 'bob' } as never, ACC as never);
    expect(d.isNew).toBe(true);
    expect(h.ledger).toEqual([expect.objectContaining({ kind: 'users', source: 'profile-refresh', inserted: 1 })]);
    h.ledgerThrows = true;
    await expect(savePersonRefresh({ restId: '5', handle: 'bob' } as never, ACC as never)).resolves.toMatchObject({ isNew: true });
  });
});

describe('采集账统一', () => {
  it('⭐ 逐页存推:账本记不上 → 不让这一页报失败(人和推文已经进库了),但响', async () => {
    const { saveTweetPage } = await import('@modules/x/x-save-page');
    h.ledgerThrows = true;
    const r = await saveTweetPage({ tweets: [{ id: '1' }, { id: '2' }] as never, source: 'x.search' });
    expect(r.inDb).toEqual(['1', '2']);
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).includes('账本没记上'))).toBe(true);
  });
  it('存人可以直接给号(查回关 / 名单采集已经认过号),照样记账', async () => {
    const { saveUserBatch } = await import('@modules/x/x-save-batch');
    const other = { kind: 'ok', restId: '200', handle: 'alt' };
    await saveUserBatch([{ restId: '1', handle: 'a' }] as never, { listSource: 'followers', wsId: 'ws-1' }, other as never);
    expect(h.calls.find((c) => c[0] === 'saveUsers')?.[1][0]).toBe(other);
    expect(h.ledger).toEqual([expect.objectContaining({ kind: 'users', source: 'followers', inserted: 1, wsId: 'ws-1' })]);
  });
});

describe('守卫:grep 只剩一份(从全仓文件推)', () => {
  const ROOT = resolve(__dirname, '../..');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const SRC = walk(join(ROOT, 'src')).map((p) => ({ f: relative(ROOT, p), s: strip(readFileSync(p, 'utf8')) }));
  const where = (re: RegExp): string[] => SRC.filter((x) => re.test(x.s)).map((x) => x.f).sort();

  it('全仓扫到了文件(扫描本身没坏)', () => {
    expect(SRC.length).toBeGreaterThan(200);
    expect(where(/export async function saveUserBatch/)).toEqual(['src/modules/x/x-save-batch.ts']);
  });
  it('⭐ 点关注 / 点取关的脚本只在 x-person-act 里跑', () => {
    /** x-dom-scripts 是脚本本身的定义(id: X_SCRIPTS.follow),不算调用 */
    const run = (re: RegExp): string[] => where(re).filter((f) => !f.endsWith('x-dom-scripts.ts'));
    expect(where(/X_SCRIPTS\.follow\b/)).toContain('src/modules/x/x-dom-scripts.ts');
    expect(run(/X_SCRIPTS\.follow\b/)).toEqual(['src/modules/x/x-person-act.ts']);
    expect(run(/X_SCRIPTS\.unfollow\b/)).toEqual(['src/modules/x/x-person-act.ts']);
  });
  it('⭐ 读主页资料(等 PROFILE_ENDPOINT 那一条)只在 x-person-profile', () => {
    expect(where(/pageUrlIncludes:\s*\[PROFILE_ENDPOINT\]/)).toEqual(['src/modules/x/x-person-profile.ts']);
  });
  it('⭐ 刷新落库 / 存推 / 存人 / 记账只在 x-save-batch(repo 自己的定义除外)', () => {
    expect(where(/\brefreshPerson\(/).filter((f) => !f.endsWith('x-user-repo.ts'))).toEqual(['src/modules/x/x-save-batch.ts']);
    expect(where(/\b(saveTweets|saveUsers|saveTweetAuthors)\(/).filter((f) => !/x-(tweet|user)-repo\.ts$/.test(f))).toEqual(['src/modules/x/x-save-batch.ts']);
    expect(where(/\bappendCollectLog\(/).filter((f) => !f.endsWith('x-collect-log-repo.ts'))).toEqual(['src/modules/x/x-save-batch.ts']);
  });
});
