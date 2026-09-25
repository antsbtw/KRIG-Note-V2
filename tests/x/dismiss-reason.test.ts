/**
 * ⭐⭐ 否决原因 —— 「新的学习方法」第一层(2026-09-24 用户拍板)。
 *
 * ── 为什么先做这一层(实测数据支撑)──
 * `x_reply_feedback` 425 行里:
 *  · `filled` **424** 条,`dismissed` **1** 条
 *  · `edited` **425/425 全 false** —— 人一字没改(⚠️ 查证过 UI 有编辑框、链路是通的,
 *    所以这是真实情况,不是 bug)
 *
 * ⭐ 学习信号只有「采用/否决」两态且几乎全是采用 → 模型**学不到「哪里不好」**。
 * ⭐⭐ 正因否决只占 **1/425**,每一条否决都金贵;
 *   而问一句「为什么不用」一年也就几十次 —— **收益/成本比最高**,所以先做它。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf-8');
const schema = read('src/storage/surreal/x-schema.ts');
const runner = read('src/storage/migrations/x-runner.ts');
const repo = strip(read('src/platform/main/db/x-reply-feedback-repo.ts'));
const handlers = strip(read('src/platform/main/x/x-timeline-handlers.ts'));
const dialog = strip(read('src/views/x-inbox/ReplyComposeDialog.tsx'));
const types = read('src/shared/types/x-reply-types.ts');

describe('⭐ 四处登记(本仓栽过多次:漏一处就静默丢失)', () => {
  it('① schema 有 dismiss_reason', () => {
    expect(schema, 'schema 没加字段')
      .toMatch(/dismiss_reason ON x_reply_feedback/);
  });

  it('⚠️⚠️ ② migration 必须注册进 runner —— 不注册字段就永远不会建', () => {
    expect(runner, 'migration 1.2.9 没注册').toMatch(/x_migration_1_2_9/);
    expect(runner, '版本号没登记').toMatch(/version: '1\.2\.9'/);
  });

  it('③ 类型里有 ReplyDismissReason', () => {
    expect(types, '没定义否决原因枚举').toMatch(/export type ReplyDismissReason/);
  });

  it('⚠️⚠️ ④ 写库 SQL 与参数**两处**都要有', () => {
    /** ⚠️ 漏 SQL 那一处 → 字段静默恒空,而类型和 UI 看着都对 */
    const i = repo.indexOf('INSERT INTO x_reply_feedback');
    expect(i, '找不到写库语句').toBeGreaterThan(0);
    const sql = repo.slice(i, repo.indexOf('}`', i));
    expect(sql, 'SQL 里没有 dismiss_reason —— 字段会静默恒空')
      .toMatch(/dismiss_reason: \$dismiss_reason/);
    const params = repo.slice(repo.indexOf('}`', i), repo.indexOf('}`', i) + 900);
    expect(params, '参数里没绑值 —— SurrealDB 拿不到')
      .toMatch(/dismiss_reason: fb\.dismiss_reason/);
  });
});

describe('⭐⭐ 语义:只在否决时收,采用时必须忽略', () => {
  it('⚠️⚠️ filled 时传来的 dismiss_reason 要丢掉', () => {
    /**
     * ⚠️ 混进采用的行 → 「为什么否决」这一列立刻失真,
     * 而统计出来的规律会把人引向错误的改进方向。
     */
    /**
     * ⚠️⚠️ 2026-09-24 这条**自己假绿过一次**:往后切 400 字会带进
     * 紧邻的 `dismiss_note:` 那行,**它也有 `p.action === 'dismissed'`** ——
     * 于是删掉 dismiss_reason 的判断后仍然命中。
     * ⭐ 改成钉 **dismiss_reason 那一行本身**(切到行尾,不跨行)。
     */
    const m = handlers.match(/^\s*dismiss_reason:.*$/m);
    expect(m, 'handler 没接否决原因').not.toBeNull();
    expect(m![0], "dismiss_reason 没判 action==='dismissed' —— 采用的行也会带上否决原因")
      .toMatch(/p\.action === 'dismissed'/);
    /** ⭐ note 那行同样要判 —— 两行各钉各的,别互相兜底 */
    const mn = handlers.match(/^\s*dismiss_note:.*$/m);
    expect(mn, 'handler 没接自由说明').not.toBeNull();
    expect(mn![0], "dismiss_note 没判 action==='dismissed'")
      .toMatch(/p\.action === 'dismissed'/);
  });

  it('⭐ dismiss_note 只在 other 时带(别的原因带上是噪音)', () => {
    const i = dialog.indexOf('dismiss_note:');
    expect(i, 'UI 没传自由说明').toBeGreaterThan(0);
    const blk = dialog.slice(Math.max(0, i - 200), i + 200);
    expect(blk, "自由说明没限定在 other —— 统计会混入噪音")
      .toMatch(/reason === 'other'/);
  });
});

describe('⭐⭐ UI:只在否决时问,不打断采用的正常节奏', () => {
  it('⚠️⚠️ 「跳过」要先问原因,而不是直接落库', () => {
    /** ⭐ 否决只占 1/425 —— 这一问几乎不增加负担,却是最有用的信号 */
    const i = dialog.indexOf('const dismiss = ');
    expect(i, '找不到 dismiss').toBeGreaterThan(0);
    const blk = dialog.slice(i, i + 300);
    expect(blk, '跳过时直接落库了 —— 没问为什么,信号丢了')
      .toMatch(/setAskingWhy\(true\)/);
  });

  it('⚠️ 采用(填入X)那条路**不许**弹原因框', () => {
    /** ⚠️ 424/425 都是采用,弹窗会打断人的正常节奏 */
    /**
     * ⚠️⚠️ 切片**不能跨到下一个函数** —— 2026-09-24 实测:
     * 往后切 900 字会把紧邻的 `const dismiss` 带进来,
     * 于是「fillIntoX 里有 setAskingWhy」恒成立(假红)。
     * ⭐ 切到**下一个 const 声明**为止,并断言切出来非空。
     */
    const i = dialog.indexOf('const fillIntoX');
    expect(i, '找不到 fillIntoX').toBeGreaterThan(0);
    const next = dialog.indexOf('  const ', i + 10);
    expect(next, 'fillIntoX 后面找不到下一个函数 —— 切片会一路到文件尾')
      .toBeGreaterThan(i);
    const blk = dialog.slice(i, next);
    expect(blk.length, 'fillIntoX 函数体切出来是空的').toBeGreaterThan(100);
    expect(blk, '采用时也弹了原因框 —— 会打断常态操作')
      .not.toMatch(/setAskingWhy\(true\)/);
  });

  it('⭐ 每个原因都要有人话标签(Record 让漏写编译不过)', () => {
    expect(dialog, '没有否决原因的标签表').toMatch(/DISMISS_LABEL: Record<ReplyDismissReason, string>/);
    for (const k of ['off_topic', 'too_salesy', 'wrong_tone', 'factual_error', 'should_not_reply', 'other']) {
      expect(dialog, `缺少 ${k} 的标签`).toMatch(new RegExp(`${k}:`));
    }
  });
});
