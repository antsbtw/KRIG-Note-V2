/**
 * ⭐⭐ 草稿落库 —— 用户 2026-09-24 拍板:
 *
 * > 「落库,这是未来AI学习和优化的环节吧?」
 *
 * ⭐ 对:草稿 + 人改成什么 + 发没发 = **「AI 写的 vs 人要的」差集**,
 *   那才是训练信号。不落库就没有这个差集。
 *
 * ── 起因(编排实跑查实)──
 * 编排报「拟出 6 条草稿」而库里**一条都查不到**:
 *  · planReplies 只**返回**草稿,全仓没有任何地方写进库
 *  · `reply_draft` 字段定义在 **tweet_inbox**(死表),x_tweet 上根本没有 ——
 *    实测往 x_tweet 写它**整条 upsert 失败**(不是静默丢弃)
 *  · UI 那条路径放 `useState`,关掉就没
 * ⭐ 手点时人当场看得见所以一直没暴露;编排跑完没人看 → 草稿蒸发。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf-8');
const schema = read('src/storage/surreal/x-schema.ts');
const runner = read('src/storage/migrations/x-runner.ts');
const repo = strip(read('src/platform/main/db/x-reply-draft-repo.ts'));
const handlers = strip(read('src/platform/main/x/x-timeline-handlers.ts'));
const caps = strip(read('src/platform/main/x/x-flow-capabilities.ts'));

describe('⭐⭐ 表与 migration:四处都要登记', () => {
  it('⭐ schema 里有 x_reply_draft', () => {
    expect(schema, '没定义 x_reply_draft 表').toMatch(/DEFINE TABLE IF NOT EXISTS x_reply_draft/);
  });

  it('⚠️⚠️ migration 必须注册进 runner —— 不注册表就永远不会建', () => {
    /** ⚠️ 本仓栽过:schema 写了、runner 没登记 → 表根本没建,而现象是「字段全空」 */
    expect(runner, 'migration 1.2.8 没注册 —— 表不会被创建').toMatch(/x_migration_1_2_8/);
    expect(runner, "版本号没登记").toMatch(/version: '1\.2\.8'/);
  });

  it('⭐⭐ 训练信号必需的字段一个都不能少', () => {
    /**
     * ⭐ 这几样合起来才构成「AI 写的 vs 人要的」差集:
     * ai_text(AI 写了什么)+ status(人怎么处置)+ 推断链(为什么这么写)。
     */
    for (const f of ['ai_text', 'status', 'ai_reason', 'poster_kind', 'trigger', 'confidence']) {
      expect(schema, `x_reply_draft 缺字段 ${f} —— 训练信号不完整`)
        .toMatch(new RegExp(`${f}\\s+ON x_reply_draft`));
    }
  });

  it('⚠️ 推文正文必须快照,不能 join x_tweet(那边有 TTL)', () => {
    expect(schema, '没存 tweet_text 快照 —— x_tweet 过期后回看就没上下文了')
      .toMatch(/tweet_text\s+ON x_reply_draft/);
  });

  it('⚠️ 不做 tweet_id 唯一索引(同一条推可被多次拟稿)', () => {
    /** ⚠️ 加唯一索引会让重跑的草稿覆盖掉上次的,丢掉「这次写得不一样」这个信号 */
    expect(schema, 'tweet_id 上加了唯一索引 —— 重跑会覆盖历史草稿')
      .not.toMatch(/INDEX[^\n]*x_reply_draft FIELDS tweet_id UNIQUE/);
  });
});

describe('⭐⭐ 接线:拟出来就写,人表态就收口', () => {
  it('⚠️⚠️ planReplyBatch 必须落库(编排与手点走同一条路)', () => {
    expect(handlers, 'planReplyBatch 没落库 —— 编排跑完草稿还是会蒸发')
      .toMatch(/insertReplyDrafts\(/);
  });

  it('⭐⭐ 人表态时要收口 pending,否则「还有多少没处理」永远是错的', () => {
    expect(handlers, '人表态后没更新草稿状态 —— pending 会永远堆着')
      .toMatch(/resolveReplyDraft\(/);
  });

  it('⚠️ 落库失败**不许拦返回**,但要带回失败数', () => {
    /**
     * ⚠️ 草稿已经拟出来了,不能因为存不下而当没拟(降级要局部);
     * 但也不能静默 —— 那就成了「报 6 条、实际 0 条」的老毛病。
     */
    const i = handlers.indexOf('insertReplyDrafts(');
    expect(i, '找不到落库调用').toBeGreaterThan(0);
    const blk = handlers.slice(i, i + 500);
    expect(blk, '落库失败会拦住返回 —— 拟好的草稿因存不下而丢失').toMatch(/catch/);
    expect(handlers, '没把落库结果带回去 —— 失败了报告看不出来').toMatch(/persisted/);
  });

  it('⭐⭐ 编排报告要把「拟出几条」与「存进几条」分开报', () => {
    /**
     * ⚠️ 之前报「拟出 6 条」而库里一条没有 —— 两个数必须都报,
     * 相等才算真成。
     */
    const i = caps.indexOf('async planReply(');
    expect(i, '找不到 planReply 适配器').toBeGreaterThan(0);
    const blk = caps.slice(i, i + 2600);
    expect(blk, '没报落库结果 —— 又回到「看着成功实际没有」')
      .toMatch(/persisted|已落库/);
    expect(blk, '没报失败条数').toMatch(/failed/);
  });
});

describe('⚠️ 两张表分工:各记各的,不互相替代', () => {
  it('⭐ 人表态时**两张都写**', () => {
    /**
     * x_reply_draft = AI 产出了什么(流水,没人参与也有行)
     * x_reply_feedback = 人最终怎么表态(结论,必须有人)
     * ⚠️ 只写一张会丢掉另一半:没人看的草稿,或者人的修改记录。
     */
    const i = handlers.indexOf('resolveReplyDraft(');
    expect(i, '找不到收口调用').toBeGreaterThan(0);
    const blk = handlers.slice(i, i + 900);
    expect(blk, '收口了却不写反馈表 —— 人的表态丢了')
      .toMatch(/insertReplyFeedback\(/);
  });
});
