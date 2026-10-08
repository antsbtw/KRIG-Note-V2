/**
 * ⭐⭐⭐ schema 1.2.20:x_author 身份 handle → rest_id 的合并逻辑
 *
 * ⚠️ 迁移在真库上的效果本文件证明不了。2026-10-07 在临时库演练过:
 * 跑完整迁移链 → 装入真库 6519 人(以 handle 为身份)→ 1.2.20 跑两遍 →
 * 6512 人、身份全是 rest_id、改名合并 7 对、日期字段仍是 datetime、账本补 −7、对账一致;临时库已删。
 * 这里钉的是**合并规则**:人工字段一个都不许丢。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RecordId } from 'surrealdb';
import { mergeAuthorRows } from '@storage/surreal/x-schema';

const row = (handle: string, fetched: string, extra: Record<string, unknown> = {}) => ({
  id: new RecordId('x_author', handle), handle, rest_id: '42', fetched_at: new Date(fetched), ...extra,
});

describe('mergeAuthorRows', () => {
  it('⭐ 采集字段取最近一次采到的那行,其它 handle 进曾用名', () => {
    const m = mergeAuthorRows([
      row('ray16ok', '2026-10-06T06:30:00Z', { followers_count: 1, display_name: '旧名' }),
      row('dieulinxx', '2026-10-06T21:51:00Z', { followers_count: 9, display_name: '新名' }),
    ]);
    expect(m.handle).toBe('dieulinxx');
    expect(m.followers_count).toBe(9);
    expect(m.handle_history).toEqual(['ray16ok']);
    expect('id' in m, '新内容不能带旧 id(会和 type::record 的 id 打架)').toBe(false);
  });

  it('⭐⭐⭐ 人工字段取「或」—— 旧行上的屏蔽/追踪/备注一个都不许丢', () => {
    const m = mergeAuthorRows([
      row('old', '2026-10-01T00:00:00Z', { blocked: true, blocked_reason: '骚扰', note: '老客户', watched: false, watch_depth: 3 }),
      row('new', '2026-10-06T00:00:00Z', { blocked: false, watched: true, note: '新备注', watch_depth: 1 }),
    ]);
    expect(m.blocked).toBe(true);
    expect(m.blocked_reason).toBe('骚扰');
    expect(m.watched).toBe(true);
    expect(m.watch_depth).toBe(3);
    expect(String(m.note)).toContain('老客户');
    expect(String(m.note)).toContain('新备注');
  });

  it('名单归属取并集;曾用名累加旧的曾用名', () => {
    const m = mergeAuthorRows([
      row('a', '2026-10-01T00:00:00Z', { list_memberships: ['following'], handle_history: ['zz'] }),
      row('b', '2026-10-06T00:00:00Z', { list_memberships: ['followers'] }),
    ]);
    expect([...(m.list_memberships as string[])].sort()).toEqual(['followers', 'following']);
    expect([...(m.handle_history as string[])].sort()).toEqual(['a', 'zz']);
  });

  it('单行也能过(大部分人都是单行,只是换身份)', () => {
    const m = mergeAuthorRows([row('solo', '2026-10-06T00:00:00Z', { follows_me: true })]);
    expect(m.handle).toBe('solo');
    expect(m.handle_history).toEqual([]);
    expect(m.follows_me).toBe(true);
  });
});

describe('1.2.20 迁移接线', () => {
  const SCHEMA = readFileSync(join(process.cwd(), 'src/storage/surreal/x-schema.ts'), 'utf8');
  const fn = SCHEMA.slice(SCHEMA.indexOf('export async function x_migration_1_2_20'),
    SCHEMA.indexOf('export async function x_migration_1_2_19'));

  it('⭐⭐ 登记进了 runner', () => {
    const runner = readFileSync(join(process.cwd(), 'src/storage/migrations/x-runner.ts'), 'utf8');
    expect(runner).toMatch(/version: '1\.2\.20'[\s\S]{0,200}up: x_migration_1_2_20/);
  });

  it('⭐⭐ handle 的 UNIQUE 去掉了(旧 handle 会被别人复用)', () => {
    const ddl = SCHEMA.slice(SCHEMA.indexOf('const X_SCHEMA_1_2_20'), SCHEMA.indexOf('`;', SCHEMA.indexOf('const X_SCHEMA_1_2_20')));
    expect(ddl).toMatch(/REMOVE INDEX IF EXISTS idx_author_handle/);
    expect(ddl).toMatch(/DEFINE INDEX IF NOT EXISTS idx_author_handle ON x_author FIELDS handle;/);
    expect(ddl).not.toMatch(/UNIQUE/);
  });

  it('⭐⭐ 搬完要问库核对(一人一行、身份 = rest_id),对不上就抛', () => {
    expect(fn.length).toBeGreaterThan(500);
    expect(fn).toMatch(/record::id\(id\) != rest_id/);
    expect(fn).toMatch(/WHERE n > 1/);
    expect(fn).toMatch(/throw new Error\(`\[x-schema 1\.2\.20\] 搬完对不上/);
  });

  it('⭐ 账本补更正记录,origin = migration(状态页的曲线与采集时间不计它)', () => {
    expect(fn).toMatch(/source = 'merge-renamed'/);
    expect(fn).toMatch(/origin = 'migration'/);
  });

  it('⚠️ 旧 id 恰好等于新 id 时不能删', () => {
    expect(fn).toMatch(/filter\(\(id\) => String\(id\.id\) !== rid\)/);
  });
});
