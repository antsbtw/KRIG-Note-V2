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
    expect(rel).toMatch(/status\s*=\s*'replied'[\s\S]{0,120}status\s*=\s*'pending'\s*AND\s*replied\s*=\s*true/);
  });
});
