/**
 * ⭐⭐ 打开主页时顺手核对一个人(2026-10-09)
 *
 * 用户:「选定右边的用户，左边页面弹出来，就把这个页面的数据再读取一次」;
 * 单击自动核对、有变化直接更新并提示(都已同意)。
 * ⚠️ 「主页加载时 UserByScreenName 真的会来、能被收到」只有真机验得出;
 * SQL 语义已在临时库验过(回关 / 改名 / 旧观察不改 / 一致)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROFILE_ENDPOINT, pickProfileUser, buildPersonRefresh, diffPerson, PERSON_REFRESH_FIELDS,
} from '@modules/x/x-person-refresh';
import { USER_BUSINESS_FIELDS } from '@modules/x/x-user-repo';
import type { XUserRecord } from '@modules/x/x-user-audit';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');
const rec = (o: Partial<XUserRecord>): XUserRecord => ({
  handle: 'guy', restId: '7', name: '', bio: '', avatar: '', location: '', seq: 0, ...o,
} as XUserRecord);
const NOW = '2026-10-09T01:00:00.000Z';

describe('pickProfileUser', () => {
  it('⭐ 先按数字 id、再按 handle 对;对不上不拿第一个凑数', () => {
    const users = [rec({ handle: 'other', restId: '1' }), rec({ handle: 'Guy', restId: '7' })];
    expect(pickProfileUser(users, 'nobody', '7')?.restId).toBe('7');
    expect(pickProfileUser(users, '@GUY')?.restId).toBe('7');
    expect(pickProfileUser(users, 'nobody')).toBeUndefined();
  });
});

describe('buildPersonRefresh', () => {
  it('⭐⭐⭐ 人工字段与名单字段一个都不碰(清单从常量推)', () => {
    const q = buildPersonRefresh(rec({
      name: 'n', bio: 'b', avatar: 'a', location: 'l', website: 'w', followersCount: 1, followingCount: 2,
      statusesCount: 3, mediaCount: 4, isBlueVerified: true, isVerified: false, isProtected: false,
      following: true, followedBy: true, createdAt: 'Fri Jun 02 10:00:00 +0000 2023',
    }), NOW);
    for (const f of USER_BUSINESS_FIELDS) expect(q.sql, `${f} 是人工字段`).not.toMatch(new RegExp(`\\b${f}\\b`));
    expect(q.sql).not.toMatch(/list_/);
    for (const f of USER_BUSINESS_FIELDS) expect(PERSON_REFRESH_FIELDS).not.toContain(f);
  });

  it('⭐⭐ 只写有值的字段:空字符串与没给的不写', () => {
    const q = buildPersonRefresh(rec({ isBlueVerified: true }), NOW);
    expect(q.sql).toContain('is_blue_verified = IF');
    expect(q.sql).not.toMatch(/display_name|bio|followers_count/);
  });

  it('⭐⭐⭐ 关系不写人表(1.2.27):载荷带了关系也不出现在人表 SQL 里 —— 它按号写 x_relation', () => {
    const q = buildPersonRefresh(rec({ following: true, followedBy: false }), NOW);
    expect(q.sql).not.toMatch(/\bi_follow\b|\bfollows_me\b/);
    expect(PERSON_REFRESH_FIELDS).not.toContain('i_follow');
    expect(PERSON_REFRESH_FIELDS).not.toContain('follows_me');
  });

  it('⭐⭐⭐ 旧观察不覆盖新的:都带时间条件;fetched_at 只赋值一次且最后;曾用名在改 handle 之前', () => {
    const q = buildPersonRefresh(rec({ following: true }), NOW);
    const sets = q.sql.slice(q.sql.indexOf(' SET ') + 5, q.sql.indexOf(' RETURN'));
    expect(sets.match(/\bfetched_at = IF\b/g)?.length).toBe(1);
    expect(sets.trim()).toMatch(/fetched_at = IF [^,]+ END$/);
    expect(sets.indexOf('handle_history = IF')).toBeLessThan(sets.indexOf('handle = IF'));
    expect(q.sql).toContain("UPSERT type::record('x_author', $rest_id)");
    expect(q.sql).not.toMatch(/\bWHERE\b/);
  });
});

describe('diffPerson', () => {
  it('关系变化(按号)、改名、蓝V 变化要报出来;一致就是空', () => {
    const before = { handle: 'guy', is_blue_verified: true, fetched_at: '2026-10-07T00:00:00Z' };
    const rel = { before: { i_follow: true, follows_me: false } };
    expect(diffPerson(before, rec({ following: true, followedBy: true }), NOW, rel).changes).toEqual(['关系 我关注·他没回关 → 互关']);
    expect(diffPerson(before, rec({ handle: 'New' }), NOW, rel).changes).toEqual(['改名 @guy → @new']);
    expect(diffPerson(before, rec({ isBlueVerified: false }), NOW, rel).changes).toEqual(['不再是蓝V']);
    expect(diffPerson(before, rec({ following: true }), NOW, rel).changes).toEqual([]);
    expect(diffPerson(null, rec({}), NOW).isNew).toBe(true);
  });

  it('⭐⭐ 这次关系没写(认不出号)→ 不许报关系变化:「没写」不能说成「变了」', () => {
    const before = { handle: 'guy', fetched_at: '2026-10-07T00:00:00Z' };
    expect(diffPerson(before, rec({ following: false, followedBy: false }), NOW).changes).toEqual([]);
    /** 这个号以前没记过他(before:null)→ 从「关系不明」变成看到的关系 */
    expect(diffPerson(before, rec({ following: true, followedBy: true }), NOW, { before: null }).changes)
      .toEqual(['关系 关系不明 → 互关']);
  });

  it('⭐⭐⭐ 观察比库里旧(SQL 没写)就不许报变化 —— 临时库实测第一版报了假变化', () => {
    const before = { handle: 'guy', fetched_at: '2026-10-09T02:00:00Z' };
    const d = diffPerson(before, rec({ following: false, followedBy: false }), '2026-10-01T00:00:00Z');
    expect(d).toEqual({ isNew: false, stale: true, changes: [] });
  });
});

describe('接线', () => {
  const PAGE = read('src/modules/x/XOpsPeople.tsx');
  const IPC = read('src/modules/x/x-data-ipc.ts');

  it('⭐⭐ 核对:去主页 + 只等主页资料那一条 + 不多滚 + 有时限', () => {
    const fn = PAGE.slice(PAGE.indexOf('const runVerify'), PAGE.indexOf('const openInX'));
    expect(fn.length).toBeGreaterThan(500);
    expect(fn).toMatch(/await readProfileAndRefresh\(p, wcId\)/);
    /** 2026-10-19 去主页读资料抽到 x-unfollow-run.ts(运营核对 + 任务页取关后核对共用) */
    const RUN = read('src/modules/x/x-unfollow-run.ts');
    const rd = RUN.slice(RUN.indexOf('export async function readProfileAndRefresh'));
    expect(rd).toMatch(/gotoPage: \{ name: X_PAGE_NAME\.profile/);
    expect(rd).toMatch(/pageUrlIncludes: \[PROFILE_ENDPOINT\], wantPages: 1, maxRounds: 3, maxMs: 10_000/);
    expect(PROFILE_ENDPOINT).toBe('UserByScreenName');
  });

  it('⭐⭐⭐ 操作台采集中不跳;自己核对期间占住网页,结束(含出错)一定放掉', () => {
    const fn = PAGE.slice(PAGE.indexOf('const runVerify'), PAGE.indexOf('const openInX'));
    /** 2026-10-23 起占网页走主进程的锁(x-page-lock):拿不到就不跳;核对是串行的(openInX 排队),不需要「自己的忙不算」的豁免 */
    expect(fn).toMatch(/const lock = await acquireXPage\(wcId, VERIFY_BUSY\);\s*if \(!lock\.ok\)/);
    /**
     * ⚠️ 第一版只看「finally 后 80 字内出现清忙」—— 注入「把它挪到 finally 块外面」仍全绿
     * (还在 80 字内),而那样一出错就永远挂着「忙」。改成钉 **finally 块本身**的内容。
     */
    expect(fn).toMatch(/\} finally \{\s*await releaseXPage\(lock\.token\);\s*\}/);
  });

  it('⭐⭐ 一次只核对一个;核对中再点只记住最后一个', () => {
    const fn = PAGE.slice(PAGE.indexOf('const openInX'), PAGE.indexOf('const selectPerson'));
    expect(fn).toMatch(/if \(verifying\.current\) \{ pending\.current = p; return; \}/);
    expect(fn).toMatch(/next = pending\.current;\s*pending\.current = null;/);
  });

  it('⭐ refreshPerson:契约 + handler;新人记账', () => {
    expect(read('src/modules/x/x-data-types.ts')).toMatch(/op: 'refreshPerson'/);
    const body = IPC.slice(IPC.indexOf("case 'refreshPerson':"), IPC.indexOf("case 'refreshPerson':") + 1200);
    expect(body).toMatch(/source: 'profile-refresh'/);
    expect(body).toMatch(/if \(d\.isNew\)/);
  });
});
