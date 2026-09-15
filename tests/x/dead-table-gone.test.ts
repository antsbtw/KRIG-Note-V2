/**
 * ⭐⭐ 死表 `tweet_inbox` 不许复活
 *
 * ── 这张表造成过两个真 bug(2026-09-14 一并修掉)──
 *
 * | Bug | 形态 | 后果 |
 * |---|---|---|
 * | 1 | `UPDATE tweet_inbox SET status='pending'`(x-ai-judge) | 判断失败的推**卡死在 ai_judging**,要等重启靠自愈捞回 |
 * | 2 | `FROM tweet_inbox`(配方采纳率) | 统计**恒为 0 且不报错** |
 *
 * ⚠️ 两个都**不报错** —— 写进死表不会失败,查空表不会失败。
 * 记忆 `project-x-tweet-inbox-is-dead-table`:「名字骗人,写进去不报错且永远读不到,
 * 现象是『功能点了没反应』」。
 *
 * ⭐ migration 1.2.0 已把表删掉,所以复发会变成运行期报错而不是静默 ——
 * 但**在代码里写它仍然不该发生**,本守卫钉这一层。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** 递归收集 src 下的 .ts/.tsx,跳过构建产物 */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'dist' || e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(e.name) && statSync(full).size < 2_000_000) out.push(full);
  }
  return out;
}

const FILES = sources(join(ROOT, 'src')).map((path) => ({
  path: path.replace(ROOT + '/', ''),
  code: stripComments(readFileSync(path, 'utf-8')),
}));

/**
 * ⚠️ schema 文件是**唯一**豁免:历史 migration 里的 `DEFINE FIELD ON tweet_inbox`
 * 是既成事实,改了会让老库的迁移序列对不上(本仓铁律:migration 只加不改)。
 * 1.2.0 的 `REMOVE TABLE` 也在这里。
 */
const SCHEMA_FILES = ['src/storage/surreal/x-schema.ts', 'src/storage/surreal/schema.ts'];
const isSchema = (p: string) => SCHEMA_FILES.includes(p);

describe('⭐⭐ 死表不许复活', () => {
  it('⭐⭐ 业务代码里零处 SQL 操作 tweet_inbox', () => {
    const offenders: string[] = [];
    for (const { path, code } of FILES) {
      if (isSchema(path)) continue;
      // 只查**当成表用**的形态,不查变量名/文件名(repo 文件名就叫 tweet-inbox-repo)
      for (const pat of [
        /FROM\s+tweet_inbox/i,
        /UPDATE\s+tweet_inbox/i,
        /INSERT\s+INTO\s+tweet_inbox/i,
        /CREATE\s+tweet_inbox/i,
        /DELETE\s+FROM\s+tweet_inbox/i,
      ]) {
        if (pat.test(code)) offenders.push(`${path} 命中 ${pat}`);
      }
    }
    expect(
      offenders,
      '又把 tweet_inbox 当表用了 —— 它已被 migration 1.2.0 删除,' +
      '写进去/查出来都不会报错,只会「功能点了没反应」',
    ).toEqual([]);
  });

  it('⭐⭐ Bug 1 修好了:判断失败回退打在 x_tweet 上', () => {
    const judge = stripComments(
      readFileSync(join(ROOT, 'src/platform/main/x/x-ai-judge.ts'), 'utf-8'));
    // 两处回退都要在(批量 + 单条),且都打在活表
    const backoffs = judge.match(/UPDATE\s+x_tweet\s+SET\s+status\s*=\s*'pending'/g) ?? [];
    expect(
      backoffs.length,
      '回退语句少了 —— 判断失败的推会卡死在 ai_judging,要等重启才恢复',
    ).toBeGreaterThanOrEqual(2);
    expect(judge, 'Bug 1 复发:回退又打在死表上').not.toMatch(/UPDATE\s+tweet_inbox/);
  });

  it('⭐ Bug 2 修好了:配方采纳率查活表', () => {
    const repo = stripComments(
      readFileSync(join(ROOT, 'src/platform/main/db/search-recipe-repo.ts'), 'utf-8'));
    const at = repo.indexOf('export async function getRecipeStats(');
    expect(at, '锚点过时:找不到 getRecipeStats').toBeGreaterThan(0);
    const body = repo.slice(at, at + 800);
    expect(body, 'Bug 2 复发:又查死表,统计会恒为 0 且不报错').not.toMatch(/FROM\s+tweet_inbox/);
    expect(body).toMatch(/FROM\s+x_tweet/);
  });

  it('⭐ migration 1.2.0 真的删了表,且注册进了 runner', () => {
    const schema = readFileSync(join(ROOT, 'src/storage/surreal/x-schema.ts'), 'utf-8');
    expect(schema).toMatch(/REMOVE TABLE IF EXISTS tweet_inbox/);
    const runner = readFileSync(join(ROOT, 'src/storage/migrations/x-runner.ts'), 'utf-8');
    expect(runner, '写了 migration 但没注册 = 永远不会跑').toContain('x_migration_1_2_0');
    expect(runner).toMatch(/version: '1\.2\.0'/);
  });

  it('守卫自检:扫到的文件里确实有 SQL(否则本条是空转的)', () => {
    const withSql = FILES.filter(({ code }) => /FROM\s+x_tweet/i.test(code));
    expect(withSql.length, '一个 SQL 都没扫到 —— 收集逻辑坏了').toBeGreaterThan(3);
  });
});
