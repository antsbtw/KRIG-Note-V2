/**
 * ⭐⭐ 运营 → 状态:落库账本 + 数据概要
 *
 * ⚠️ SQL 在真库上的行为,本文件证明不了。2026-10-07 在**临时库**里完整演练过:
 * 迁移 DDL(错类型/漏字段/字符串日期都被拒收)→ 留痕补导 30 条(重跑不重复)→
 * 状态查询:人 6342 / 推文 130,对账一致;临时库已删,真库未动。
 * 这里钉的是**纯逻辑**与**接线**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bucketByDay, reconcile, ago, buildOpsStatusQuery, parseOpsStatus,
} from '@modules/x/x-ops-status';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('bucketByDay', () => {
  const now = new Date(2026, 9, 7, 15, 0); // 本地 10-07 15:00

  it('⭐ 最近 7 天含今天,没采集的那天是 0', () => {
    const b = bucketByDay([], now);
    expect(b.map((d) => d.label)).toEqual(['10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07']);
    expect(b.every((d) => d.users === 0 && d.tweets === 0)).toBe(true);
  });

  it('⭐⭐ 按**本地**日期分桶 —— 本地 23:30 的采集算当天,不被 UTC 切到第二天', () => {
    const lateNight = new Date(2026, 9, 6, 23, 30).toISOString();
    const b = bucketByDay([{ at: lateNight, kind: 'users', inserted: 5 }], now);
    expect(b.find((d) => d.label === '10-06')!.users).toBe(5);
    expect(b.find((d) => d.label === '10-07')!.users).toBe(0);
  });

  it('人与推文分开累加,窗口外的丢掉', () => {
    const at = new Date(2026, 9, 5, 12).toISOString();
    const old = new Date(2026, 8, 1).toISOString();
    const b = bucketByDay([
      { at, kind: 'users', inserted: 3 }, { at, kind: 'users', inserted: 4 },
      { at, kind: 'tweets', inserted: 9 }, { at: old, kind: 'users', inserted: 100 },
    ], now);
    const d = b.find((x) => x.label === '10-05')!;
    expect([d.users, d.tweets]).toEqual([7, 9]);
    expect(b.reduce((s, x) => s + x.users, 0)).toBe(7);
  });
});

describe('reconcile / ago', () => {
  it('⭐ 账本合计 ≠ 表行数要报差值', () => {
    expect(reconcile(6342, 6342)).toEqual({ ok: true, diff: 0 });
    expect(reconcile(6342, 6000)).toEqual({ ok: false, diff: 342 });
  });
  it('⚠️ 没记录说「无记录」,不说「刚刚」', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    expect(ago(undefined, now)).toBe('无记录');
    expect(ago('2026-10-07T09:00:00Z', now)).toBe('3 小时前');
    expect(ago('2026-10-05T12:00:00Z', now)).toBe('2 天前');
  });
});

describe('buildOpsStatusQuery / parseOpsStatus', () => {
  it('⭐⭐ 曲线与更新时间读账本,**不读 fetched_at**(重采会改成当天,画出来是假的)', () => {
    const { sql } = buildOpsStatusQuery();
    expect(sql).toContain('FROM x_collect_log');
    expect(sql).not.toContain('fetched_at');
    /** 时间转字符串 —— SDK 原样给 DateTime 类,过不了 IPC */
    expect(sql).toMatch(/<string> time::max\(at\)/);
    expect(sql).toMatch(/<string> at AS at/);
  });

  it('⭐⭐⭐ 人的数字只从三个标记来,不用名单归属(用户 2026-10-07 拍板)', () => {
    /**
     * 「蓝V/关注我/我关注这三个关键要素能够采集下来，就不存在千面的数据错误了。」
     * ⚠️ 拿 list_memberships 当事实闹出过「蓝V关注者 2681」(真实 4303)。
     */
    const { sql } = buildOpsStatusQuery();
    expect(sql).not.toContain('list_memberships');
    expect(sql).not.toContain('list_source');
    expect(sql).toMatch(/count\(follows_me = true\)/);
    expect(sql).toMatch(/count\(i_follow = true\)/);
    expect(sql).toMatch(/count\(is_blue_verified = true\)/);
  });

  it('⭐⭐ 解析的下标与语句顺序对得上(用真库的真实形状)', () => {
    /** 下面的数字 = 2026-10-07 真库只读查询的结果 */
    const res: unknown[] = [
      [{ n: 6342, follows_me: 5784, i_follow: 5369, blue: 4799 }],
      [{ n: 130 }],
      [{ source: 'x.search', n: 130 }],
      [
        { kind: 'users', source: 'followers', last_at: '2026-10-07T02:28:31Z', ins: 5000 },
        { kind: 'users', source: 'following', last_at: '2026-10-07T00:35:42Z', ins: 1342 },
        { kind: 'tweets', source: 'x.search', last_at: '2026-10-05T17:49:03Z', ins: 130 },
      ],
      [{ at: '2026-10-06T10:00:00Z', kind: 'users', inserted: 7 }],
      [{ n: 7, rows: 14 }],
      [], // x_interaction:空表 → GROUP ALL 返回 [] → 「还没采集」
    ];
    const st = parseOpsStatus(res);
    expect(st.people).toMatchObject({
      total: 6342, ledgerInserted: 6342, followsMe: 5784, iFollow: 5369, blue: 4799, renamedExtra: 7,
    });
    /** 采集时间 = 最近一次采人(不论哪个名单) */
    expect(st.people.lastAt).toBe('2026-10-07T02:28:31Z');
    expect(st.tweets.ledgerInserted).toBe(130);
    expect(st.tweets.sources[0]).toMatchObject({ name: 'x.search', count: 130 });
    expect(st.series).toHaveLength(1);
    expect(st.missing).toEqual(['互动']);
  });

  it('⭐⭐ 迁移写的更正记录:算进对账,不算进采集时间和曲线', () => {
    const { sql } = buildOpsStatusQuery();
    expect(sql).toMatch(/origin != 'migration'/);
    const st = parseOpsStatus([
      [{ n: 6512, follows_me: 1, i_follow: 1, blue: 1 }], [{ n: 0 }], [],
      [
        { kind: 'users', source: 'followers', origin: 'live', last_at: '2026-10-08T02:48:50Z', ins: 6519 },
        { kind: 'users', source: 'merge-renamed', origin: 'migration', last_at: '2026-10-08T09:00:00Z', ins: -7 },
      ],
      [], [], [{ n: 1 }],
    ]);
    expect(st.people.ledgerInserted).toBe(6512);
    expect(st.people.lastAt, '采集时间被迁移那一刻冒充了').toBe('2026-10-08T02:48:50Z');
  });

  it('没有改名重复时是 0,不是 NaN', () => {
    const st = parseOpsStatus([[{ n: 1, follows_me: 1, i_follow: 0, blue: 0 }], [], [], [], [], [], [{ n: 3 }]]);
    expect(st.people.renamedExtra).toBe(0);
    expect(st.missing).toEqual([]);
  });
});

describe('账本接线', () => {
  const IPC = read('src/modules/x/x-data-ipc.ts');
  const TYPES = read('src/modules/x/x-data-types.ts');
  const caseBody = (name: string): string => {
    const i = IPC.indexOf(`case '${name}':`);
    expect(i, `${name} 分支找不到`).toBeGreaterThan(-1);
    const end = IPC.indexOf('case \'', i + 10);
    const body = IPC.slice(i, end === -1 ? undefined : end);
    expect(body.length, `${name} 切出来是空的`).toBeGreaterThan(50);
    return body;
  };

  it('⭐⭐⭐ 人和推文落库后都记账 —— 漏一边,曲线和对账就少一半', () => {
    expect(caseBody('saveUsers')).toMatch(/logCollect\(\{\s*kind: 'users'/);
    expect(caseBody('saveTweets')).toMatch(/logCollect\(\{\s*kind: 'tweets'/);
  });

  it('⭐⭐ 记账失败不让落库报失败,但要留痕(不静默)', () => {
    const i = IPC.indexOf('async function logCollect');
    expect(i).toBeGreaterThan(-1);
    const body = IPC.slice(i, IPC.indexOf('\n}\n', i));
    expect(body).toMatch(/catch/);
    expect(body).toMatch(/traceRecorder\.lifecycle/);
    expect(body).not.toMatch(/return failed/);
  });

  it('⭐ opsStatus 契约有、handler 也有', () => {
    expect(TYPES).toMatch(/op: 'opsStatus'/);
    expect(IPC).toMatch(/case 'opsStatus':/);
  });

  it('⭐⭐ 迁移 1.2.19 登记进了 runner(只写 schema 不登记 = 表永远不建)', () => {
    const runner = read('src/storage/migrations/x-runner.ts');
    expect(runner).toMatch(/version: '1\.2\.19'[\s\S]{0,200}up: x_migration_1_2_19/);
  });

  it('⭐ 状态页走 opsStatus,且「状态」类真的渲染它', () => {
    expect(read('src/modules/x/XOpsStatus.tsx')).toMatch(/op: 'opsStatus'/);
    expect(read('src/modules/x/XOpsView.tsx')).toMatch(/category === 'status' && <XOpsStatus \/>/);
  });
});
