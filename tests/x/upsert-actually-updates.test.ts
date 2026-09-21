import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

/**
 * ⭐⭐⭐ `upsertTweet` 必须**真的 update** —— 2026-09-21 实测揪出的真 bug。
 *
 * ── 现象 ──
 * 函数名叫 upsert,语句却是 `INSERT IGNORE INTO`:
 * tweet_id 已存在就整条跳过、**一个字段不更新**、**不抛错**,
 * 调用方 `saved += 1` 照加 → 报告显示「入库 50 条」而库里纹丝不动。
 *
 * ⚠️ 后果远不止一次采集:用户说「老数据等再次采集时补上」——
 * 按原实现**永远补不上**(全库 conversation_id 卡在 9%、tweet_url 卡在 75%)。
 *
 * ⚠️ 这类 bug **纯文本守卫挡不住**:每一处单看都正常,
 * 名字、类型、schema、调用方全对,只有语义不对。
 */
describe('⭐⭐⭐ upsertTweet 必须真的更新已存在的行', () => {
  const repo = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/db/tweet-inbox-repo.ts'), 'utf-8'));
  const body = (() => {
    const i = repo.indexOf('export async function upsertTweet');
    expect(i, '找不到 upsertTweet').toBeGreaterThan(0);
    return repo.slice(i, i + 4500);
  })();

  it('⭐⭐⭐ 不能是纯 INSERT IGNORE(已存在就整条跳过,静默不更新)', () => {
    /**
     * 实测坐实(直接对库跑):先 INSERT text='原始',
     * 再 `INSERT IGNORE` 同 id 且 text='改过了' + conversation_id='NEW'
     * → 读回来仍是 `text:'原始'`、`conversation_id:None`。
     */
    const stmt = body.slice(body.indexOf('db.query'), body.indexOf('}`,'));
    expect(
      stmt,
      'upsertTweet 用的是 INSERT IGNORE —— 已存在的行**一个字段都不会更新**,'
      + '而且不抛错:报告显示「入库 N 条」,库里纹丝不动;老数据永远补不上',
    ).not.toMatch(/INSERT\s+IGNORE/i);
  });

  it('⭐⭐⭐ 必须有 ON DUPLICATE KEY UPDATE,否则重采补不上历史数据', () => {
    expect(
      body,
      '没有 ON DUPLICATE KEY UPDATE —— 已存在的推不会被更新,'
      + '「重采时自然补上」这个预期不成立',
    ).toMatch(/ON\s+DUPLICATE\s+KEY\s+UPDATE/i);
  });

  it('⭐⭐⭐ 更新子句里必须有**采集该负责**的字段', () => {
    /**
     * ⚠️ 光有 ON DUPLICATE 不够 —— 得真的把采集字段列进去。
     * 少列一个,那个字段就永远停留在第一次入库时的值。
     */
    const uStart = body.search(/ON\s+DUPLICATE\s+KEY\s+UPDATE/i);
    const uEnd = body.indexOf('`', uStart);
    const upd = body.slice(uStart, uEnd > uStart ? uEnd : uStart + 900);
    expect(upd.length, '切不出更新子句').toBeGreaterThan(50);
    for (const f of [
      'text', 'metrics', 'tweet_url', 'author_avatar',
      'author_name_at_post', 'conversation_id', 'in_reply_to',
    ]) {
      expect(
        upd,
        `更新子句里没有 ${f} —— 重采时这个字段永远不会被补上`,
      ).toMatch(new RegExp(`${f}\\s*=`));
    }
  });

  it('⭐⭐⭐ 更新子句**不许碰业务字段**(否则一重采就清空人工结果)', () => {
    /**
     * ⚠️⚠️ 这是改动的另一半风险:IGNORE 原本**确实在保护**
     * `accepted` / `ai_verdict` / `replied` / `translation` ——
     * 那些是业务/人工后填的。无脑改成全覆盖会把它们清掉,
     * 而那种损失**不可逆**(AI 判断要重跑,人工采纳直接丢)。
     *
     * ⭐ 已对真库实测:改后重采,accepted=true 与 translation 都保住了。
     */
    /**
     * ⚠️ 实测假红:切片必须**收口在 SQL 结束处**(反引号),
     * 否则会越过本函数、圈进后面另一个函数里的 `WHERE accepted = NONE`
     * —— 守卫报了个不存在的问题(同族:feedback-guard-scope-to-the-branch)。
     */
    const updStart = body.search(/ON\s+DUPLICATE\s+KEY\s+UPDATE/i);
    const updEnd = body.indexOf('`', updStart);
    expect(updEnd, '切不出更新子句的结尾(SQL 的反引号)').toBeGreaterThan(updStart);
    const upd = body.slice(updStart, updEnd);
    for (const f of ['accepted', 'ai_verdict', 'replied', 'translation',
      'reply_draft', 'filter_reason', 'status']) {
      expect(
        upd,
        `更新子句里出现了业务字段 ${f} —— 一次重采就会把人工/AI 的结果清掉,不可逆`,
      ).not.toMatch(new RegExp(`\\b${f}\\s*=`));
    }
  });

  it('⭐⭐ 函数名与行为要一致(叫 upsert 就得真 upsert)', () => {
    /**
     * ⭐ 这个 bug 之所以藏了这么久,正是因为**名字骗了所有人**:
     * 调用方看到 `upsertTweet` 就以为会更新,没人去读那条 SQL。
     * 同族:记忆里「tweet_inbox 是死表」——名字骗人那一类。
     */
    expect(
      body,
      'upsertTweet 的语句里既没有 UPSERT 也没有 ON DUPLICATE —— 名字与行为不符',
    ).toMatch(/UPSERT|ON\s+DUPLICATE/i);
  });
});
