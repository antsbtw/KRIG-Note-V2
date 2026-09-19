/**
 * ⭐⭐ 一个人可以同时在多个名单里 —— 源码守卫
 *
 * ── 用户 2026-09-18 实测暴露 ──
 *
 * 采完 verifiedFollowers 后,面板上 `x.followers` 从 **308 人掉到 28 人**。
 * 人没丢,是**被改判了**:`list_source` 是单值字段、无条件覆盖,
 * 同一个人再出现在别的名单里,前一个来源就被整条盖掉。
 *
 * ⚠️ 蓝V关注者本就是关注者的**子集** —— 重叠是常态不是例外,
 * 所以这不是边角情况,是必然发生。
 *
 * ⚠️ 后果不是「少了几行」,是**证据被覆盖**:
 * 「这个人在不在我的关注者里」从此只能回答最后采的那一次。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const repo = strip(readFileSync(
  join(process.cwd(), 'src/platform/main/db/x-author-repo.ts'), 'utf-8',
));

describe('⭐⭐ 名单累加,不覆盖', () => {
  it('前提自检:切到了写库语句', () => {
    expect(repo.indexOf('const setClause'), '找不到 setClause —— 下面会空转')
      .toBeGreaterThan(0);
  });

  it('⭐⭐ list_memberships 必须是累加,不能直接赋值', () => {
    const i = repo.indexOf('list_memberships =');
    expect(i, 'list_memberships 根本没写 —— 重叠证据会继续丢').toBeGreaterThan(0);
    const stmt = repo.slice(i, repo.indexOf('END,', i) + 4);
    expect(stmt.length, '切出来的语句是空的').toBeGreaterThan(40);
    expect(
      stmt,
      'list_memberships 被直接覆盖了 —— 和 list_source 同一个 bug',
    ).toMatch(/array::distinct\(\(list_memberships \?\? \[\]\) \+ \[\$lsrc\]\)/);
  });

  it('⭐⭐ 没有新来源时不许把已有名单清空', () => {
    const i = repo.indexOf('list_memberships =');
    const stmt = repo.slice(i, repo.indexOf('END,', i) + 4);
    expect(
      stmt,
      '$lsrc 为 NONE 时没保留原值 —— 普通的画像更新会把名单抹掉',
    ).toMatch(/IF \$lsrc = NONE THEN list_memberships/);
  });

  it('⭐ list_source 的语义保持不变(仍是「最近一次」)', () => {
    /**
     * ⚠️ 不要顺手把 list_source 也改成累加 —— 它和 list_seq 成对,
     * 序号只在**同一次采集内**可比。两个字段各司其职,别互相解释。
     */
    expect(repo, 'list_source 被改成了别的写法 —— list_seq 的语义会跟着坏')
      .toMatch(/list_source = \$lsrc/);
  });
});

describe('⭐⭐ migration 必须真的加字段并补齐存量', () => {
  const schema = strip(readFileSync(
    join(process.cwd(), 'src/storage/surreal/x-schema.ts'), 'utf-8',
  ));

  it('⭐⭐ 1.2.4 登记进了 runner(否则永远不会跑)', () => {
    const runner = strip(readFileSync(
      join(process.cwd(), 'src/storage/migrations/x-runner.ts'), 'utf-8',
    ));
    expect(runner, '1.2.4 没进 migration 列表 —— 字段永远不会被创建')
      .toMatch(/version: '1\.2\.4'/);
    expect(runner, '1.2.4 的 up 没接上').toMatch(/up: x_migration_1_2_4/);
    expect(runner, '1.2.4 没 import').toMatch(/x_migration_1_2_4[,\s}]/);
  });

  it('⭐⭐ 加完要校验真加上了(fail loud,不静默跳过)', () => {
    const i = schema.indexOf('export async function x_migration_1_2_4');
    const body = schema.slice(i, schema.indexOf('\n}', i));
    expect(body, '没校验字段是否真的加上 —— DDL 被拒收也看不出来')
      .toMatch(/throw new Error/);
  });

  it('⭐⭐ 存量数据要补齐,否则空值和「只在一个名单」分不开', () => {
    const i = schema.indexOf('export async function x_migration_1_2_4');
    const body = schema.slice(i, schema.indexOf('\n}', i));
    expect(body, '没补齐存量 —— 老数据这个字段永远是空的')
      .toMatch(/UPDATE x_author SET list_memberships = \[list_source\]/);
  });
});
