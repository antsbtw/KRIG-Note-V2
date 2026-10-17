/**
 * ⭐⭐ 关系按号存(1.2.27)—— **真 SurrealDB** 行为验证(起本机 surreal 二进制,skipIf 没有)
 *
 * 为什么是真库:「两个号互不覆盖」「认不出号就一条不写」「旧观察不盖新的」「子查询盖住旧字段」
 * 这些只有真库答得出(记忆 project-surreal-* 一串坑)。调的是 repo 的**真函数**。
 * 用户 10-16:「互相覆盖是很严重的问题哦,应该是分字段,判断起来简单吧?」
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Surreal } from 'surrealdb';
import { __setXDBForTest } from '@storage/surreal/client';
import { runXMigrations } from '@storage/migrations/x-runner';
import { x_migration_1_2_27 } from '@storage/surreal/x-schema';
import { saveUsers, saveTweetAuthors, refreshPerson } from '@modules/x/x-user-repo';
import { queryPeople, readPeopleOverview, readPerson, scanMutualIntent, setMutualIntent } from '@modules/x/x-people-repo';
import { lookupSpot } from '@modules/x/x-spot-check';
import { readOpsStatus } from '@modules/x/x-collect-log-repo';
import { DEFAULT_PEOPLE_FILTER } from '@modules/x/x-people-query';
import type { AccountDecision } from '@modules/x/x-account';
import type { XUserRecord } from '@modules/x/x-user-audit';

function findBinary(): string | null {
  for (const c of ['/opt/homebrew/bin/surreal', '/usr/local/bin/surreal']) if (existsSync(c)) return c;
  return null;
}
const BINARY = findBinary();
const PORT = 8603; // 避开 app(8533)与别的 verify(8599/8601)
const READY_TIMEOUT = 25000;

let proc: ChildProcess | null = null;
let db: Surreal | null = null;
let dbDir: string | null = null;

async function waitReady(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`surreal 没在 ${READY_TIMEOUT}ms 内起来`);
}

const A: AccountDecision = { kind: 'ok', restId: '1000', handle: 'otun_myvpn' };
const B: AccountDecision = { kind: 'ok', restId: '2000', handle: 'other' };
const user = (restId: string, o: Partial<XUserRecord> = {}): XUserRecord =>
  ({ handle: `u${restId}`, restId, name: `U${restId}`, isBlueVerified: true, ...o } as XUserRecord);

describe.skipIf(!BINARY)('关系按号存 —— 真 SurrealDB 验证', () => {
  beforeAll(async () => {
    if (!BINARY) return;
    dbDir = mkdtempSync(path.join(tmpdir(), 'krig-relation-verify-'));
    proc = spawn(BINARY, ['start', '--bind', `127.0.0.1:${PORT}`,
      '--username', 'root', '--password', 'verify', '--log', 'warn', `rocksdb://${dbDir}`],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    await waitReady();
    db = new Surreal();
    await db.connect(`ws://127.0.0.1:${PORT}/rpc`);
    await db.signin({ username: 'root', password: 'verify' });
    await db.use({ namespace: 'krig', database: 'relation_verify' });
    await runXMigrations(db);
    __setXDBForTest(db);
  }, 60000);

  afterAll(async () => {
    __setXDBForTest(null);
    await db?.close();
    proc?.kill();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  it('⭐⭐⭐ 两个号采同一个人,关系各存各的,互不覆盖', async () => {
    await saveUsers([user('1', { following: true, followedBy: true })], { listSource: 'followers' }, A);
    await saveUsers([user('1', { following: false, followedBy: false })], { listSource: 'followers' }, B);
    const a = await readPerson('1000', '1');
    const b = await readPerson('2000', '1');
    expect([a?.i_follow, a?.follows_me]).toEqual([true, true]);
    expect([b?.i_follow, b?.follows_me]).toEqual([false, false]);
  });

  it('⭐⭐⭐ 人表上不再写关系;旧字段的值被子查询盖住(不会漏出来)', async () => {
    /** 模拟迁移前的旧数据:人表上直接有 i_follow */
    await db!.query("UPDATE type::record('x_author', '1') SET i_follow = false, follows_me = false");
    await saveUsers([user('1', { following: true, followedBy: true })], { listSource: 'followers' }, A);
    const [raw] = await db!.query<[Array<{ i_follow?: boolean }>]>("SELECT i_follow FROM type::record('x_author', '1')");
    expect(raw?.[0]?.i_follow, 'saveUsers 又往人表写关系了').toBe(false);
    expect((await readPerson('1000', '1'))?.i_follow).toBe(true);
    /** 没有这个号的关系 → NONE(关系不明),不退回人表上的旧值 */
    const c = await readPerson('3000', '1');
    expect(c?.i_follow).toBeUndefined();
    expect(c?.follows_me).toBeUndefined();
  });

  it('⭐⭐⭐ 认不出号 → 人照写,关系一条不写,原因原样报出', async () => {
    const bad: AccountDecision = { kind: 'needIdentify', handle: 'x', reason: '登录的号变了' };
    const r = await saveUsers([user('9', { following: true, followedBy: true })], { listSource: 'followers' }, bad);
    expect(r.inserted).toBe(1);
    expect(r.relation).toMatchObject({ written: 0, skippedReason: '登录的号变了' });
    const [rows] = await db!.query<[unknown[]]>("SELECT * FROM x_relation WHERE person = '9'");
    expect(rows).toEqual([]);
  });

  it('⭐⭐ 旧观察不盖新观察(Laosun 那次):推文作者带旧时间,名单的新关系不动', async () => {
    await saveUsers([user('5', { following: true, followedBy: true })], { listSource: 'followers' }, A);
    await saveTweetAuthors([{
      authorRestId: '5', authorHandle: 'u5', following: false, followedBy: false, observedAt: '2020-01-01T00:00:00.000Z',
    }], undefined, A);
    const p = await readPerson('1000', '5');
    expect([p?.i_follow, p?.follows_me]).toEqual([true, true]);
  });

  it('⭐⭐ 列表、概览、状态页都按号算', async () => {
    await saveUsers([user('6', { following: true, followedBy: false })], { listSource: 'following' }, A);
    await saveUsers([user('6', { following: true, followedBy: true })], { listSource: 'following' }, B);
    const ia = await queryPeople('1000', { ...DEFAULT_PEOPLE_FILTER, group: 'iWait' }, 50, 0);
    const ib = await queryPeople('2000', { ...DEFAULT_PEOPLE_FILTER, group: 'iWait' }, 50, 0);
    expect(ia.rows.map((r) => r.rest_id)).toContain('6');
    expect(ib.rows.map((r) => r.rest_id)).not.toContain('6');
    const oa = await readPeopleOverview('1000');
    const ob = await readPeopleOverview('2000');
    expect(oa.iWait.total).toBeGreaterThanOrEqual(1);
    expect(ob.mutual.total).toBeGreaterThanOrEqual(1);
    const sa = await readOpsStatus('1000');
    const sb = await readOpsStatus('2000');
    expect(sa.people.iFollow).toBeGreaterThan(0);
    expect(sa.people.followsMe).not.toBe(sb.people.followsMe);
  });

  it('⭐⭐ 主页核对:关系按号写,并对这个号报出关系变化;认不出号时不报关系变化', async () => {
    await saveUsers([user('7', { following: true, followedBy: false })], { listSource: 'following' }, A);
    const d = await refreshPerson(user('7', { following: true, followedBy: true }), A);
    expect(d.changes).toContain('关系 我关注·他没回关 → 互关');
    expect((await readPerson('1000', '7'))?.follows_me).toBe(true);
    const n = await refreshPerson(user('7', { following: false, followedBy: false }), { kind: 'error', reason: '认不出' });
    expect(n.changes.some((c) => c.startsWith('关系'))).toBe(false);
    expect(n.relation.skippedReason).toBe('认不出');
    expect((await readPerson('1000', '7'))?.follows_me, '认不出号却改了关系').toBe(true);
  });

  it('⭐⭐⭐ 关系变化表(1.2.28):第一次记基线;重采没变不记;变了记一条;旧观察不记;另一个号各记各的', async () => {
    const changes = async (acct: string): Promise<Array<Record<string, unknown>>> => {
      const [rows] = await db!.query<[Array<Record<string, unknown>>]>(
        `SELECT from_i_follow, from_follows_me, to_i_follow, to_follows_me, source, <string> observed_at AS at,
           (IF prev_observed_at != NONE THEN <string> prev_observed_at ELSE NONE END) AS prev
           FROM x_relation_change WHERE account = $a AND person = '20' ORDER BY at`, { a: acct },
      );
      return rows ?? [];
    };
    await saveUsers([user('20', { following: true, followedBy: false })], { listSource: 'following' }, A);
    expect(await changes('1000')).toHaveLength(1);
    expect((await changes('1000'))[0]).toMatchObject({ to_i_follow: true, to_follows_me: false, source: 'following' });
    expect((await changes('1000'))[0].from_i_follow).toBeUndefined();

    /** 重采,关系没变 → 不多记 */
    await saveUsers([user('20', { following: true, followedBy: false })], { listSource: 'following' }, A);
    expect(await changes('1000')).toHaveLength(1);

    /** 他回关了 → 记一条,from/to/prev 都对 */
    const r = await saveUsers([user('20', { following: true, followedBy: true })], { listSource: 'followers' }, A);
    expect(r.relation.changed).toBe(1);
    const cs = await changes('1000');
    expect(cs).toHaveLength(2);
    expect(cs[1]).toMatchObject({ from_i_follow: true, from_follows_me: false, to_i_follow: true, to_follows_me: true, source: 'followers' });
    /**
     * prev = **最后一次**看到旧关系的时间 —— 是中间那次「重采没变」,不是第一次基线
     * (重采刷新了当前关系的 observed_at)→ 变化窗口 (prev, at] 越采越窄
     */
    expect(String(cs[1].prev) > String(cs[0].at)).toBe(true);
    expect(String(cs[1].prev) < String(cs[1].at)).toBe(true);

    /** 旧推文里的旧关系 → 当前不动,也不记变化 */
    await saveTweetAuthors([{
      authorRestId: '20', authorHandle: 'u20', following: false, followedBy: false, observedAt: '2020-01-01T00:00:00.000Z',
    }], undefined, A);
    expect(await changes('1000')).toHaveLength(2);

    /** 另一个号看到的,记在它自己名下 */
    await saveUsers([user('20', { following: false, followedBy: false })], { listSource: 'followers' }, B);
    expect(await changes('2000')).toHaveLength(1);
    expect(await changes('1000')).toHaveLength(2);
  });

  it('⭐⭐ 互关倾向扫描(1.2.30):Bio/自己的推文命中;转发不算;人标的不覆盖;不再命中就清;采集不碰', async () => {
    await saveUsers([
      user('30', { bio: '互关必回' }), user('31', { bio: '写代码的' }), user('32', { bio: '写代码的' }), user('33', { bio: '有关必回' }),
    ], { listSource: 'followers' }, A);
    await db!.query(`
      CREATE x_tweet SET tweet_id = 't31', author_rest_id = '31', author_handle = 'u31', text = '新号求互关,关注必回', source = 'x.profile', status = 'new', fetched_at = time::now(), metrics = {};
      CREATE x_tweet SET tweet_id = 't32', author_rest_id = '32', author_handle = 'u32', text = '互关必回', retweet_of_id = 'zzz', source = 'x.reposts', status = 'new', fetched_at = time::now(), metrics = {};`);
    await setMutualIntent('33', false);
    const r = await scanMutualIntent();
    expect(r.failed).toBe(0);
    const p = async (id: string): Promise<Record<string, unknown>> =>
      ((await db!.query<[Array<Record<string, unknown>>]>(`SELECT mutual_intent, mutual_intent_source, mutual_intent_evidence FROM type::record('x_author', $id)`, { id }))[0]?.[0]) ?? {};
    expect(await p('30')).toMatchObject({ mutual_intent: true, mutual_intent_source: 'rule', mutual_intent_evidence: 'Bio:互关必回' });
    expect(await p('31')).toMatchObject({ mutual_intent: true, mutual_intent_evidence: '推文 t31:新号求互关,关注必回' });
    expect((await p('32')).mutual_intent, '转发的是别人的话,不能算他的倾向').toBeUndefined();
    expect(await p('33'), '人标的「无」被算法改了').toMatchObject({ mutual_intent: false, mutual_intent_source: 'human' });

    /** 重扫不变 → 不写;Bio 改了不再命中 → 算法标的清掉 */
    const again = await scanMutualIntent();
    expect(again.set).toBe(0);
    await saveUsers([user('30', { bio: '写代码的' })], { listSource: 'followers' }, A);
    expect((await p('30')).mutual_intent, '采集把判断字段冲了 / 不该在采集时清').toBe(true);
    const third = await scanMutualIntent();
    expect(third.cleared).toBe(1);
    expect((await p('30')).mutual_intent).toBeUndefined();

    /** 只看有倾向的筛选 */
    const list = await queryPeople('1000', { ...DEFAULT_PEOPLE_FILTER, intentOnly: true }, 50, 0);
    expect(list.rows.map((x) => x.rest_id)).toContain('31');
    expect(list.rows.map((x) => x.rest_id)).not.toContain('33');
  });

  it('⭐⭐ 抽查查库:推文按 id / 人按 handle;查不到就是 found=false(漏采)', async () => {
    await saveUsers([user('40', { following: true, followedBy: true })], { listSource: 'followers' }, A);
    await db!.query("CREATE x_tweet SET tweet_id = 't40', author_rest_id = '40', author_handle = 'u40', text = '抽查用', source = 'x.search', status = 'new', fetched_at = time::now(), metrics = {};");
    const hit = await lookupSpot('1000', { kind: 'tweet', tweetId: 't40' });
    expect(hit).toMatchObject({ kind: 'tweet', found: true, tweet: { tweet_id: 't40', text: '抽查用' } });
    expect(hit.found && hit.kind === 'tweet' && hit.author?.i_follow).toBe(true);
    expect(await lookupSpot('1000', { kind: 'tweet', tweetId: 'nope' })).toEqual({ kind: 'tweet', found: false, tweetId: 'nope' });
    expect(await lookupSpot('1000', { kind: 'person', handle: '@U40' })).toMatchObject({ kind: 'person', found: true });
    expect(await lookupSpot('', { kind: 'person', handle: 'ghost' })).toEqual({ kind: 'person', found: false, handle: 'ghost' });
  });

  it('⭐ 迁移 1.2.27:x_ws_account 旧的随机 id 换成按 ws 定位,字段不丢,重跑不变', async () => {
    await db!.query("DELETE x_ws_account; CREATE x_ws_account SET ws_id = 'ws-1', handle = 'otun_myvpn', detected_at = time::now();");
    await x_migration_1_2_27(db!);
    await x_migration_1_2_27(db!);
    const [rows] = await db!.query<[Array<{ ws_id: string; handle: string }>]>(
      "SELECT ws_id, handle FROM type::record('x_ws_account', 'ws-1')",
    );
    expect(rows).toEqual([{ ws_id: 'ws-1', handle: 'otun_myvpn' }]);
    const [all] = await db!.query<[Array<{ n: number }>]>('SELECT count() AS n FROM x_ws_account GROUP ALL');
    expect(all?.[0]?.n).toBe(1);
  });
});
