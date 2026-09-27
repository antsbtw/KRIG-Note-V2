/**
 * ⭐⭐ **学习环节的地基** —— 用户 2026-09-26:
 *
 * > 「用户确定并发送，数据记录并进入学习环节」
 * > 「记录下来的目的是未来人工点评和优化。」
 * > 「后期用户可以对已经发送的数据继续点评纠正，这样迭代工作。」
 *
 * ⚠️ 只存「人最终发了什么」**教不了任何人**:模型学不到
 * 「在这种语境下该这么答」,只能学到「照抄这句话」。
 * ⭐ 真正的训练信号是**差集**:AI 当时看到什么 → 写了什么 → 人改成什么。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8');
/** ⚠️ 行注释正则要躲开 `https://` 里的 `//` */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SCHEMA = read('src/storage/surreal/x-schema.ts');
const REPO = strip(read('src/platform/main/db/x-reply-draft-repo.ts'));
const HANDLERS = strip(read('src/platform/main/x/x-timeline-handlers.ts'));

/** ⭐ 这四个字段少一个，这批数据的价值就掉一大截 */
const LEARNING_FIELDS = [
  'context_snapshot', 'advice_raw', 'user_edit_diff', 'reviewed_at',
] as const;

describe('⭐⭐ 加字段要登记四处（漏一处就静默丢失）', () => {
  it('⭐⭐ schema 里四个字段都定义了', () => {
    const i = SCHEMA.indexOf('X_SCHEMA_1_2_11');
    expect(i, '找不到 1.2.11 的 DDL').toBeGreaterThan(0);
    /** ⚠️ 切到本段 DDL 结尾，别跨到后面新加的 migration(见下条注释) */
    const ddl = SCHEMA.slice(i, SCHEMA.indexOf('`;', i));
    expect(ddl.length, 'slice 空转').toBeGreaterThan(100);
    for (const f of LEARNING_FIELDS) {
      expect(ddl, `schema 里没定义 ${f}`).toContain(f);
    }
  });

  it('⭐⭐ 存量行不能变非法：全部 option<>', () => {
    /** ⚠️ 库里已有 9 条草稿，加成非 option 会让它们整批读不出来 */
    const i = SCHEMA.indexOf('X_SCHEMA_1_2_11');
    /**
     * ⚠️ 2026-09-27 改锚点:原来切到 `x_migration_1_2_11`，
     * 而新加的 migration 常插在**两者之间** → slice 会吃进别的表的 DDL，
     * 那些表本来就不该全是 option → **假红**。
     * ⭐ 切到这段 DDL 自己的反引号结尾为止，不跨到别的定义。
     */
    const ddl = SCHEMA.slice(i, SCHEMA.indexOf('`;', i));
    expect(ddl, 'slice 越界或空转').toContain('x_reply_draft');
    const defs = ddl.split('\n').filter((l) => l.includes('DEFINE FIELD'));
    expect(defs.length, '一条字段定义都没找到').toBeGreaterThan(3);
    for (const d of defs) {
      expect(d, `${d.trim()} 不是 option —— 9 条存量草稿会变非法行`).toMatch(/option</);
    }
  });

  it('⭐⭐ 写库 SQL 的 SET 与参数**两处**都登记了', () => {
    /**
     * ⚠️ 本仓「加字段要登记四处」栽过多次:漏 SQL 这一处
     * → 字段**静默恒空**，而类型和 UI 看着都对。
     */
    const i = REPO.indexOf('CREATE x_reply_draft SET');
    expect(i, '找不到写库 SQL').toBeGreaterThan(0);
    const sql = REPO.slice(i, REPO.indexOf('`,', i));
    expect(sql.length, 'slice 空转').toBeGreaterThan(100);
    expect(sql, 'SQL 里没写 context_snapshot —— 会静默恒空').toContain('context_snapshot');
    expect(sql, 'SQL 里没写 advice_raw').toContain('advice_raw');

    /** ⭐ 每个 $变量都必须真绑值 */
    const params = REPO.slice(REPO.indexOf('{', REPO.indexOf('`,', i)), i + 2600);
    for (const v of ['contextSnapshot', 'adviceRaw']) {
      expect(sql, `SQL 里没有 $${v}`).toContain(`$${v}`);
      expect(params, `$${v} 没绑值 —— 会静默传 NONE`).toMatch(new RegExp(`${v}:`));
    }
  });

  it('⚠️ option 字段传 undefined 不传 null（NONE ≠ NULL）', () => {
    const i = REPO.indexOf('contextSnapshot:');
    expect(i, '找不到 contextSnapshot 绑值').toBeGreaterThan(0);
    const blk = REPO.slice(i, i + 200);
    expect(
      /\?\?\s*null/.test(blk),
      '用了 ?? null —— SurrealDB 的 option<T> 只认 NONE，写 NULL 会整条失败',
    ).toBe(false);
  });
});

describe('⭐⭐ 已发送的还能回头改点评（用户明确要求）', () => {
  it('⭐⭐ 点评**不限 status**，pending 之外的也能改', () => {
    /**
     * ⚠️ 加了 `status = 'pending'` 条件的话，
     * 「后期对已经发送的数据继续点评纠正」就做不到了 ——
     * 而那正是用户要的「迭代」。
     */
    const i = REPO.indexOf('export async function reviewReplyDraft');
    expect(i, '找不到 reviewReplyDraft').toBeGreaterThan(0);
    const body = REPO.slice(i, REPO.indexOf('export async function listPendingDrafts'));
    expect(body.length, 'slice 空转').toBeGreaterThan(200);
    const upd = body.slice(body.indexOf('UPDATE x_reply_draft'));
    expect(
      /status = 'pending'/.test(upd),
      '点评被限制在 pending —— 已发送的就改不了了，与用户要求相反',
    ).toBe(false);
  });

  it('⭐ 点评次数累加 —— 「改过几轮」本身是信号', () => {
    const i = REPO.indexOf('export async function reviewReplyDraft');
    const body = REPO.slice(i, REPO.indexOf('export async function listPendingDrafts'));
    expect(body, '没累加 review_count').toMatch(/review_count = \(review_count \?\? 0\) \+ 1/);
  });

  it('⚠️ 只补点评时不许把已有的 diff 清空', () => {
    /** 没传 finalText = 只补一句评价，不该动 user_edit_diff */
    const i = REPO.indexOf('export async function reviewReplyDraft');
    const body = REPO.slice(i, REPO.indexOf('export async function listPendingDrafts'));
    expect(body, '没传 finalText 时 diff 会被清空')
      .toMatch(/opts\.finalText === undefined[\s\S]{0,60}undefined/);
    /** ⭐ SQL 侧也要兜住:传 NONE 时保留原值（实测 `NONE ?? a` 保留旧值） */
    expect(body, 'SQL 没用 ?? 兜住 —— 传 undefined 会把字段写成 NONE')
      .toMatch(/user_edit_diff = \$diff \?\? user_edit_diff/);
  });

  it('⭐ diff 由写入端算，不存两份正文让读的人自己比', () => {
    /** ⚠️ 比法不一致（有人 trim 有人不 trim）会让统计全废 */
    const i = REPO.indexOf('export async function reviewReplyDraft');
    const body = REPO.slice(i, REPO.indexOf('export async function listPendingDrafts'));
    expect(body, '没在写入端比对 ai_text').toMatch(/final === aiText\.trim\(\)/);
  });
});

describe('⭐⭐ 语境快照真的存进去了（不是只有字段）', () => {
  it('⭐⭐ 拟回复时把语境传给了落库', () => {
    /**
     * ⚠️ 本仓最贵的一类 bug:「类型有、字段有、消费层零传递」的死字段。
     * 这条钉的是**真的传了**。
     */
    const i = HANDLERS.indexOf('insertReplyDrafts(');
    expect(i, '找不到落库调用').toBeGreaterThan(0);
    const blk = HANDLERS.slice(i, HANDLERS.indexOf('}).catch', i));
    expect(blk.length, 'slice 空转').toBeGreaterThan(40);
    expect(blk, '语境没传下去 —— 字段会永远是空的').toMatch(/contextOf:/);
  });

  it('⭐⭐ 快照里要有「当时看到了什么」的几样关键信息', () => {
    const i = HANDLERS.indexOf('const contextById = new Map');
    expect(i, '找不到组装快照的地方').toBeGreaterThan(0);
    const blk = HANDLERS.slice(i, HANDLERS.indexOf('const persisted', i));
    expect(blk.length, 'slice 空转').toBeGreaterThan(100);
    for (const k of ['bio', 'parentText', 'aiReason']) {
      expect(blk, `快照里没有 ${k} —— 回看时不知道 AI 当时凭什么这么写`).toContain(k);
    }
  });

  it('⚠️ bio 一次取齐，不在循环里逐条查库', () => {
    const i = HANDLERS.indexOf('const bioByHandle');
    expect(i, '找不到批量取 bio').toBeGreaterThan(0);
    const blk = HANDLERS.slice(i, HANDLERS.indexOf('const contextById', i));
    expect(blk, 'bio 没按 handle 去重 —— 同一个人会查很多次').toMatch(/new Set\(/);
    expect(blk, 'handle 没归一化 —— x_author 存的是小写，永远查不到')
      .toMatch(/normalizeHandle/);
  });

  it('⚠️ 取不到 bio 要留 undefined，不能填空串', () => {
    /** 空串会让回看的人以为「这人当时没写简介」，而实际是我们没采到 */
    const i = HANDLERS.indexOf('bioByHandle.set(');
    expect(i, '找不到写 bio 的地方').toBeGreaterThan(0);
    expect(HANDLERS.slice(i, HANDLERS.indexOf('\n', i)), '取不到时填了空串')
      .toMatch(/\|\| undefined/);
  });
});
