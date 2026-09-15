/**
 * 守卫:人工处理过的推,不得再送 AI 判断。
 *
 * 用户 2026-09-02:「如果我都手工研判过了,Gemma4 就不应该再处理,
 * 而是认可人工的处理结果。」
 *
 * 此前 queryPending 只筛 status='pending' —— 已人工采纳/拒绝、
 * 或我已回复过的行照样会被送去判:
 *  · 浪费算力(队列积压 842 条、按当前配置要跑 4 小时)
 *  · 更糟的是机器判定可能覆盖人工结论
 *
 * ⚠️ 配套要求:排除后必须把它们的状态挪走(→ 'replied'),
 * 否则会滞留成「不会被判、也不会消失」的僵尸行。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = readFileSync(
  resolve(__dirname, '../../src/platform/main/db/tweet-inbox-repo.ts'), 'utf-8');
const rel = readFileSync(
  resolve(__dirname, '../../src/platform/main/db/x-reply-relation-repo.ts'), 'utf-8');

function queryPendingBody(): string {
  const i = repo.indexOf('export async function queryPending');
  return repo.slice(i, repo.indexOf('\n}', i));
}

describe('AI 判断队列排除人工已处理', () => {
  it('⭐ 已人工采纳/拒绝的不送 AI', () => {
    expect(queryPendingBody()).toMatch(/accepted\s*=\s*NONE/);
  });

  it('⭐ 我已回复过的不送 AI(回过就是最强的表态)', () => {
    expect(queryPendingBody()).toMatch(/replied\s*!=\s*true/);
  });

  it('⭐ 带 human: 判定快照的不送 AI', () => {
    expect(queryPendingBody()).toMatch(/human:/);
  });

  it('排除后必须把状态挪走,否则滞留成僵尸行', () => {
    /**
     * ⚠️ 2026-09-14 改写:原断言钉的是**那一句 SQL 的字面**
     * (`status = 'pending' AND replied = true`)。加了 `collected` 状态后
     * 实现改成 `status IN ['pending', 'collected']` —— 行为**变强**了
     * (多救一类会滞留的行),字面却对不上,于是假红。
     *
     * ⭐ 现在钉**意图**:凡是「被排除出判断队列、但已回复」的状态,都要挪走。
     * 判据 = 挪走语句的状态集合,必须覆盖所有这类状态。
     */
    const moveStmt = rel.match(/UPDATE x_tweet SET status = 'replied'[\s\S]{0,200}?;/);
    expect(moveStmt, '找不到「挪走状态」的语句 —— 僵尸行防线没了').toBeTruthy();
    const stmt = moveStmt![0];
    expect(stmt).toMatch(/replied\s*=\s*true/);

    // ⭐ 两类都必须在:pending(判过队列的)与 collected(本就不进队列的)。
    // ⚠️ 漏掉 collected 更隐蔽 —— 那批行本来就不在「待判」里,没人会发现它们卡住。
    for (const s of ['pending', 'collected']) {
      expect(stmt, `挪走语句漏了 '${s}' —— 这类行会永远滞留`).toContain(`'${s}'`);
    }
  });
});
