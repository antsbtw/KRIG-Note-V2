/**
 * ⭐⭐⭐ 断点续采的游标读写 —— **结构守卫**
 *
 * ⚠️ repo 只在 main 进程跑、要真 SurrealDB 连接,离线驱不动 ——
 * 所以这里钉的是「写库 SQL 长什么样」,
 * **「有没有真的调」要真机验收**(`feedback-source-scan-cant-see-execution`)。
 * ⭐ 但 `cursorScope` 是纯函数,那部分是**行为测试**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cursorScope } from '@modules/x/x-cursor-repo';

const SRC = readFileSync(
  join(process.cwd(), 'src/modules/x/x-cursor-repo.ts'), 'utf8',
);

/** ⭐ 切出 UPSERT 语句 —— 不整文件 toMatch */
function upsertSql(): string {
  const from = SRC.indexOf("UPSERT type::record('x_collect_cursor'");
  expect(from, 'UPSERT 语句找不到了 —— 切不出东西就什么也证明不了')
    .toBeGreaterThan(-1);
  const end = SRC.indexOf('`', from);
  expect(end).toBeGreaterThan(from);
  const sql = SRC.slice(from, end);
  expect(sql.length).toBeGreaterThan(50);
  return sql;
}

describe('断点游标:范围键', () => {
  it('⭐⭐⭐ 按账号 + 名单分开 —— 两个账号不许共用一个断点', () => {
    /**
     * ⚠️ 混用的话 A 账号的游标会被 B 账号续采,
     * 而那种错**在数据里看不出来**(采到的人看着都正常)。
     */
    expect(cursorScope('antsBTW', 'followers')).toBe('antsbtw:followers');
    expect(cursorScope('otherGuy', 'followers')).not.toBe(cursorScope('antsBTW', 'followers'));
    expect(cursorScope('antsBTW', 'following')).not.toBe(cursorScope('antsBTW', 'followers'));
  });

  it('⭐⭐ handle 要归一化 —— 带 @、大小写都算同一个人', () => {
    /** ⚠️ 不归一化的话 @Foo 和 foo 会存成两条断点,各续各的 */
    expect(cursorScope('@AntsBTW', 'followers')).toBe('antsbtw:followers');
    expect(cursorScope('  antsbtw  ', 'followers')).toBe('antsbtw:followers');
  });
});

describe('断点游标:写库', () => {
  it('⭐⭐⭐ UPSERT 不许带 WHERE —— 没匹配到就什么都不写且不报错', () => {
    /**
     * ⚠️⚠️ 2026-10-05 真机:`UPSERT 表 SET ... WHERE` 返回 `[[]]`,
     * 面板报「入库 44 条」而库里 0 行。
     */
    expect(upsertSql()).not.toMatch(/\bWHERE\b/);
  });

  it('⭐⭐ 每个字段都要写进 SQL —— 声明了没写 = 静默丢失', () => {
    const sql = upsertSql();
    for (const f of [
      'scope', 'bottom_cursor', 'exhausted',
      'last_round', 'last_reason', 'total_seen', 'updated_at',
    ]) {
      expect(sql, `${f} 没写进 SQL`).toContain(f);
    }
  });

  it('⭐⭐ 每个 $变量都要真绑上值', () => {
    const sql = upsertSql();
    const used = new Set([...sql.matchAll(/\$([a-z_]+)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(5);
    const vFrom = SRC.indexOf('      scope: c.scope,');
    expect(vFrom).toBeGreaterThan(-1);
    const vars = SRC.slice(vFrom, SRC.indexOf('    },', vFrom));
    expect(vars.length).toBeGreaterThan(50);
    for (const v of used) {
      expect(vars, `SQL 用了 $${v} 但没绑值 —— 会写成 NONE 且不报错`)
        .toMatch(new RegExp(`\\b${v}\\s*(:|,)`));
    }
  });

  it('⭐⭐ datetime 必须 cast', () => {
    /** ⚠️ 直传 ISO 字符串会被库拒收 —— 这一条就足以让每次写入都失败 */
    expect(upsertSql()).toMatch(/updated_at\s*=\s*type::datetime/);
  });

  it('⭐⭐⭐ 被挡下时也要存 —— 那正是最需要断点的一次', () => {
    /**
     * ⚠️⚠️ 不存的话下次从第 1 页开始,
     * 50 次配额全浪费在重采已入库的人上,**一个新人都拿不到**。
     */
    const head = SRC.slice(0, SRC.indexOf('import '));
    expect(head).toMatch(/50 次\/窗口|50 次/);
    expect(head, '文件头要写明为什么非要断点').toMatch(/重采旧数据|一个新人都拿不到/);
  });

  it('⭐⭐ 读不到断点要回 null,不许编一个', () => {
    /**
     * ⭐ 游标是**可重算的派生状态**,读不到就从头采 ——
     * 那是正确行为不是降级(`feedback-fail-loud-no-fallback` 的例外侧)。
     */
    const fn = SRC.slice(SRC.indexOf('export async function readCursor'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/if \(r === undefined\) return null;/);
  });
});
