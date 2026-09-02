/**
 * 守卫:新采到的线索必须与「我已回复过的」对账。
 *
 * 起因(用户 2026-09-02):「请检查一下第一条,是否已经回复过了,也爬取过了,
 * 怎么还会显示呢?」
 *
 * 根因:回填只有**单向** —— 采到我的回复时去标记它的父推。
 * 顺序反过来就漏(实测两条):
 *   12:08 采到我的回复(父推还不在库里,无从标记)
 *   23:38 搜索才采到那条父推 → 带着 replied=false 进「待判」
 * 后果:我明明回过的人又出现在待处理列表,会被重复回复。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = readFileSync(
  resolve(__dirname, '../../src/platform/main/db/x-reply-relation-repo.ts'), 'utf-8');
const scan = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-timeline-scan.ts'), 'utf-8');
const sched = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-search-scheduler.ts'), 'utf-8');

describe('已回复反向对账', () => {
  it('⭐ 对账函数存在,且以 self_reply 的 in_reply_to 为准', () => {
    expect(repo).toContain('reconcileRepliedFromOwnReplies');
    expect(repo).toMatch(/source\s*=\s*'self_reply'[\s\S]{0,80}in_reply_to/);
  });

  it('⭐ 每轮采集后必须对账(否则新线索会带着 replied=false 进待判)', () => {
    // 查**调用**,不是查 import —— 只留 import 不调用等于没做
    expect(
      /await\s+reconcileRepliedFromOwnReplies\(/.test(scan),
      '只 import 不调用 = 对账没跑,新线索仍会带着 replied=false 进待判',
    ).toBe(true);
  });

  it('启动时也对一次账(覆盖上次运行期间采到的)', () => {
    expect(sched).toContain('reconcileRepliedFromOwnReplies');
  });

  it('对账失败必须留痕,不得静默', () => {
    expect(scan).toMatch(/console\.error[\s\S]{0,60}对账/);
  });
});
