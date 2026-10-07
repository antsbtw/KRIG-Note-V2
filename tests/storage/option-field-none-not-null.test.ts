/**
 * ⭐⭐⭐ `option<T>` 字段**绝不传 null** —— 第二次踩了
 *
 * ── 症状(两次一模一样)──
 * ```
 * Couldn't coerce value for field `lang` of `search_recipes:xxx`:
 * Expected `none | string` but found `NULL`
 * ```
 * · 2026-08-28 `mail-repo` 9 处 `?? null` → **邮件一封都落不了库**
 * · 2026-10-04 `search-recipe-repo` 2 处 → **配方存不进去**
 *
 * ⭐ 原理:SurrealDB 的 `NONE` 与 `NULL` 是两个值,`option<T>` 只收 NONE;
 * SDK 绑定 **undefined→NONE、null→NULL**(实测,不是猜的)。
 *
 * ⚠️ 为什么要**结构守卫**:tsc 查不出来(null 和 undefined 都能赋给
 * `string | null | undefined`),单测也盖不住(要连真库才看得见)——
 * **两次都是真机报错才发现的**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const DB_DIR = join(ROOT, 'src/platform/main/db');

/** ⚠️ 去掉注释 —— 不然注释里写「别用 ?? null」自己会被判违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    /** ⚠️ `(^|[^:])` 防止吃掉 `https://` 里的 `//`(feedback-guard-stripper-eats-urls) */
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('⭐⭐⭐ 写库时 option<T> 传 undefined,不传 null', () => {
  /** ⭐ 清单**从目录推**,不写死 —— 新加的 repo 自动进视野 */
  const repos = readdirSync(DB_DIR).filter((f) => f.endsWith('-repo.ts'));

  it('⚠️ 真的扫到了 repo —— 否则下面的断言空转', () => {
    expect(repos.length, 'db 目录下一个 *-repo.ts 都没有?').toBeGreaterThan(0);
  });

  for (const file of repos) {
    it(`⭐⭐⭐ ${file} 里没有 \`?? null\``, () => {
      const src = stripComments(readFileSync(join(DB_DIR, file), 'utf-8'));
      const bad = src.split('\n')
        .map((line, i) => ({ line: line.trim(), no: i + 1 }))
        .filter(({ line }) => /\?\?\s*null\b/.test(line))
        /**
         * ⚠️ **读**出来的值 `?? null` 是对的(把 NONE 读成 null 给上层)——
         * 只有**写进去**的才是 bug。判据:这一行在不在 `bind`/参数对象里。
         * ⭐ 宁可窄一点:`return ... ?? null` 明显是读,放过。
         */
        .filter(({ line }) => !line.startsWith('return '));
      expect(
        bad.map((b) => `第 ${b.no} 行: ${b.line}`),
        `${file} 里有 \`?? null\` —— option<T> 只收 NONE,传 NULL 整条写入会被拒\n`
        + '⭐ 改成 undefined(`project-surreal-none-vs-null`)\n',
      ).toEqual([]);
    });
  }

  /** ⭐ 剥注释本身要自检 —— 否则它悄悄吃掉代码,守卫永远绿 */
  it('⚠️ 剥注释不吃代码也不吃 URL', () => {
    const got = stripComments([
      'const a = 1; // 注释里写 ?? null 不算',
      "const u = 'https://x.com/a'; const b = x ?? null;",
      '/* 块注释 ?? null */',
      'const c = y ?? null;',
    ].join('\n'));
    expect(got, '把 URL 后面的代码吃掉了').toContain("https://x.com/a");
    expect(got.match(/\?\?\s*null/g) ?? [], '该留的没留 / 该去的没去').toHaveLength(2);
  });
});
