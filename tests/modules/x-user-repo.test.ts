/**
 * ⭐⭐⭐ `x_author` 写库的**结构守卫**
 *
 * ⚠️⚠️ 为什么是结构守卫而不是行为测试:
 * repo 只在 **main 进程**跑、要真 SurrealDB 连接,离线驱不动它。
 * ⭐ `feedback-source-scan-cant-see-execution` 说得明白:
 * 源码扫描**看不见「会不会执行」**。所以这里钉的只有一件事 ——
 * **写库 SQL 里有什么字段、没有什么字段**。
 * 「它到底被调了没有」要等真机验收,**本文件证明不了,别当它证明了**。
 *
 * ── ⚠️ 前四刀假绿都在这里规避 ──
 * ① 不钉写死的清单 → 清单从 `USER_*_FIELDS` 常量**推**出来
 * 　(`feedback-guard-hardcoded-list-never-grows`:写死的清单不会自己长)
 * ② 不整文件 `toMatch` → 先 **slice 出那条 UPSERT 语句**再断言
 * 　(`feedback-guard-scope-to-the-branch`:token 出现多次时整文件必然假绿)
 * ③ slice 出来的要**断言非空** → `indexOf` 返 -1 会让 slice 空转恒真
 * ④ 不剥注释 → 本文件压根不剥,避开 `feedback-guard-stripper-eats-urls`
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USER_COLLECTED_FIELDS, USER_BUSINESS_FIELDS } from '@modules/x/x-user-repo';

const SRC = readFileSync(
  join(process.cwd(), 'src/modules/x/x-user-repo.ts'), 'utf8',
);

/**
 * ⭐⭐ 切出那条 **UPSERT 语句**(从 `UPSERT type::record` 到反引号结束)。
 * ⚠️ 必须切 —— 业务字段名在**注释里**反复出现(正是为了说明「不许碰」),
 * 整文件 toMatch 会把注释当成「代码里有」,守卫**永远假绿**。
 */
function upsertSql(): string {
  const from = SRC.indexOf("UPSERT type::record('x_author'");
  expect(from, 'UPSERT 语句找不到了 —— 守卫切不出东西就什么也证明不了').toBeGreaterThan(-1);
  const end = SRC.indexOf('`', from);
  expect(end, 'SQL 的收尾反引号找不到').toBeGreaterThan(from);
  const sql = SRC.slice(from, end);
  expect(sql.length, '切出来是空的 —— indexOf 返 -1 会让 slice 空转恒真').toBeGreaterThan(50);
  return sql;
}

describe('x_author 写库守卫', () => {
  it('⭐⭐⭐ 业务字段一个都不许出现在写库 SQL 里', () => {
    const sql = upsertSql();
    /**
     * ⭐ 清单从常量来,不在守卫里写死 ——
     * 将来 `USER_BUSINESS_FIELDS` 加了新字段,这条**自动**跟着管。
     */
    expect(USER_BUSINESS_FIELDS.length).toBeGreaterThan(5);
    for (const f of USER_BUSINESS_FIELDS) {
      expect(sql, `${f} 是人工/AI 填的,采集覆盖不可逆`).not.toContain(f);
    }
  });

  it('⭐⭐ 采集字段都要真的写进去(声明了却没写 = 静默丢失)', () => {
    const sql = upsertSql();
    /**
     * ⚠️⚠️ `project-x-field-four-place-registration` 的原形:
     * `conversation_id` 类型声明补了、**SQL 字段写死没跟上** → 整列全空,
     * 而同批里 `tweet_url` 进库了,看着像「只有它坏」。
     * ⭐ 两张清单对照,不钉单个字段。
     */
    for (const f of USER_COLLECTED_FIELDS) {
      expect(sql, `${f} 在 USER_COLLECTED_FIELDS 里却没写进 SQL`).toContain(f);
    }
  });

  it('⭐⭐ 每个 $变量都必须真绑上值', () => {
    const sql = upsertSql();
    const used = new Set([...sql.matchAll(/\$([a-z_]+)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(10);
    /** ⭐ `vars` 对象那一段 —— 绑值在这里 */
    const vFrom = SRC.indexOf('const vars = {');
    expect(vFrom).toBeGreaterThan(-1);
    const vars = SRC.slice(vFrom, SRC.indexOf('};', vFrom));
    expect(vars.length).toBeGreaterThan(100);
    for (const v of used) {
      /**
       * ⚠️ 两种绑法都算:`handle: x` 和 **简写 `handle,`**。
       * ⭐ 这条守卫第一次跑就把 `$handle` 报成「没绑」—— 它是简写绑的,
       * 真绑了。**错的是守卫的正则不是代码**,只认冒号会制造假红,
       * 而假红和假绿一样坏:它会让人去改没坏的代码。
       */
      expect(vars, `SQL 用了 $${v} 但 vars 里没绑 —— 会写成 NONE 且不报错`)
        .toMatch(new RegExp(`\\b${v}\\s*(:|,)`));
    }
  });

  it('⭐⭐⭐ handle 必须经 normalizeHandle 归一化', () => {
    /**
     * ⚠️ `idx_author_handle` 是 UNIQUE:`Foo` 和 `foo` 会成两行,
     * 于是同一个人被屏蔽两次只生效一次,**且不报错**
     * (`project-x-handle-normalize`)。
     */
    expect(SRC).toContain("import { normalizeHandle }");
    const fn = SRC.slice(SRC.indexOf('export async function saveUsers'));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn, '写入端必须共用 normalizeHandle(),别自己写一份')
      .toMatch(/const handle = normalizeHandle\(r\.handle\)/);
  });

  it('⭐⭐⭐ record id 是数字 id(rest_id),不是 handle(2026-10-07 改)', () => {
    /**
     * handle 会变、rest_id 不变。用 handle 当身份:改名 → 一人两行(真库 7 例);
     * 旧 handle 被别人注册 → 两个人并一行(人工字段落到别人头上,不报错)。
     */
    const sql = upsertSql();
    expect(sql).toContain("type::record('x_author', $rest_id)");
    expect(sql).not.toContain("type::record('x_author', $handle)");
    const vFrom = SRC.indexOf('const vars = {');
    const vars = SRC.slice(vFrom, SRC.indexOf('};', vFrom));
    expect(vars, 'vars.handle 仍必须是归一化后的那个局部变量').toMatch(/^\s*handle,\s*$/m);
    expect(vars, 'vars.rest_id 必须是过了「非空」闸门的那个').toMatch(/rest_id: restId,/);
  });

  it('⭐⭐⭐ 没有数字 id 不建人 —— 绝不退回用 handle 当身份', () => {
    const fn = SRC.slice(SRC.indexOf('export async function saveUsers'));
    const guard = fn.slice(fn.indexOf('if (restId === undefined)'));
    expect(guard.length, '「没有 rest_id」的闸门不见了').toBeGreaterThan(20);
    const branch = guard.slice(0, guard.indexOf('}'));
    expect(branch).toMatch(/skippedNoRestId \+= 1/);
    expect(branch).toMatch(/continue/);
    expect(branch, '不是写库失败').not.toMatch(/failed\.push/);
    /** 找旧行也按 rest_id,不按 handle */
    expect(fn).toMatch(/FROM type::record\('x_author', \$rest_id\)/);
    expect(fn).not.toMatch(/WHERE handle = \$handle/);
  });

  it('⭐⭐ 改名时旧名进 handle_history(只加不减)', () => {
    expect(upsertSql()).toMatch(/handle_history = \$handle_history/);
    const vFrom = SRC.indexOf('const vars = {');
    expect(SRC.slice(vFrom, SRC.indexOf('};', vFrom))).toMatch(/handle_history: mergeHandleHistory\(old, handle\)/);
  });

  it('⭐⭐⭐ UPSERT 不许带 WHERE —— 没匹配到就什么都不写且不报错', () => {
    const sql = upsertSql();
    /**
     * ⚠️⚠️ 2026-10-05 真机:`UPSERT x_tweet SET ... WHERE tweet_id = $id`
     * 返回 `[[]]`,面板报「入库 44 条」而库里 **0 行**。
     */
    expect(sql).not.toMatch(/\bWHERE\b/);
  });

  it('⭐⭐ datetime 字段必须 cast', () => {
    const sql = upsertSql();
    /**
     * ⚠️ 直传 ISO 字符串会被库拒收 —— 这一条就足以让每次写入都失败。
     * ⭐ 清单从 schema 推:x_author 上的 datetime 采集字段。
     */
    for (const f of ['list_seen_at', 'fetched_at', 'account_created_at']) {
      expect(sql, `${f} 是 datetime,必须 type::datetime() cast`)
        .toMatch(new RegExp(`${f}\\s*=[^,]*type::datetime`));
    }
    /** ⭐ option 的那个还要先判 NONE,否则 type::datetime(NONE) 自己抛 */
    expect(sql).toMatch(/account_created_at\s*=\s*IF \$account_created_at != NONE/);
  });

  it('⭐⭐ list_memberships 只累加不覆盖', () => {
    /**
     * ⚠️ schema 1.2.4 的原话:覆盖掉的是**证据** ——
     * 「他在不在我的关注者里」从此只能回答最后采的那次。
     */
    const fn = SRC.slice(SRC.indexOf('function mergeMemberships'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body.length).toBeGreaterThan(50);
    expect(body, '必须把旧值读进来再加,不能直接返回新的那一个')
      .toMatch(/prev\.includes\(listSource\) \? prev : \[\.\.\.prev, listSource\]/);
    /** ⭐ 而且要真的把旧值传进去 */
    const vFrom = SRC.indexOf('const vars = {');
    const vars = SRC.slice(vFrom, SRC.indexOf('};', vFrom));
    expect(vars).toMatch(/mergeMemberships\(old\?\.list_memberships, ctx\.listSource\)/);
  });

  it('⭐⭐ 计数「没采到」要写 undefined,不许兜底成 0', () => {
    /**
     * ⚠️ `project-surreal-none-vs-null`:option 字段传 null 全挂,
     * 而兜底成 0 会让「没采到粉丝数」和「真的没粉丝」永远分不开。
     */
    const vFrom = SRC.indexOf('const vars = {');
    const vars = SRC.slice(vFrom, SRC.indexOf('};', vFrom));
    for (const f of ['followers_count', 'following_count', 'tweet_count']) {
      expect(vars, `${f} 不许 ?? 0`).not.toMatch(new RegExp(`${f}:[^,]*\\?\\?\\s*0`));
    }
    /** ⭐ 全文件也不许出现 `?? null` —— 见那条记忆的判据「见 ?? null 就是 bug」 */
    expect(SRC).not.toMatch(/\?\?\s*null/);
  });

  it('⭐⭐ 关系字段方向不许搞反', () => {
    /**
     * ⚠️ `following`(我关注他)→ `i_follow`;
     * `followedBy`(他关注我)→ `follows_me`。
     * 搞反了「追踪名单」整个方向就反了,而数据里看不出来。
     */
    const vFrom = SRC.indexOf('const vars = {');
    const vars = SRC.slice(vFrom, SRC.indexOf('};', vFrom));
    expect(vars).toMatch(/i_follow:\s*r\.following\b/);
    expect(vars).toMatch(/follows_me:\s*r\.followedBy\b/);
  });

  it('⭐⭐ 失败不许静默 + 成功路径也要留痕', () => {
    /**
     * `feedback-maintainability-over-feature-completion`:
     * 本次采集**完全成功**的依据照样要留下来。
     */
    const fn = SRC.slice(SRC.indexOf('export async function saveUsers'));
    expect(fn).toMatch(/failed\.push\(/);
    expect(fn, '成功路径要有一行留痕,否则「压根没调」和「每条都失败」长一样')
      .toMatch(/console\.log\(\s*`\[x\.user-repo\] 落库/);
    /** ⭐ 留痕里要同时有 新/更新,合成一个数就分不出「全是老人」 */
    const logFrom = fn.indexOf('[x.user-repo] 落库');
    const log = fn.slice(logFrom, fn.indexOf(');', logFrom));
    expect(log).toMatch(/\$\{inserted\}/);
    expect(log).toMatch(/\$\{updated\}/);
  });

  it('⭐⭐ 空 handle 要挡在写库前,且不混进 failed', () => {
    /**
     * ⚠️ `handle` 上有 `ASSERT $value != ''`,空的写进去会抛;
     * 但那不是「写库出错」而是「载荷没解出人」—— 混在一起会指错层。
     */
    const fn = SRC.slice(SRC.indexOf('export async function saveUsers'));
    const guard = fn.slice(fn.indexOf("if (handle === '')"));
    expect(guard.length).toBeGreaterThan(20);
    const branch = guard.slice(0, guard.indexOf('}'));
    expect(branch).toMatch(/skippedNoHandle \+= 1/);
    expect(branch, '空 handle 不该记成写库失败').not.toMatch(/failed\.push/);
  });

  it('⭐⭐⭐ 文件头要写明「落到 x_author,不建新表」', () => {
    /**
     * ⚠️ 用户 2026-10-05:「人,就是x的用户呀」——
     * follower 和推文作者是同一个实体。
     * ⭐ 钉这句是**防止下一个人给同一个实体再建一张表**。
     */
    const head = SRC.slice(0, SRC.indexOf('import '));
    expect(head).toContain('x_author');
    expect(head).toMatch(/不建新表|同一个实体/);
  });
});
