/**
 * 守卫:身份归属到 ws,不用全局单例。
 *
 * 用户 2026-09-03 指正:「当前 ws 是登录什么账号,就核实这个 ws 的状态,
 *   而不是跑到一个对应不上的 ws 来核实」。
 *
 * 此前的错误建模:x_author.is_self 全局唯一(setSelfAuthor 会清掉其它行)。
 * 但 X webview 登录态是 per-ws(partition = persist:webview-${wsId}),
 * 两个 ws 可登不同账号 → 第二个识别时**静默覆盖**第一个,
 * 之后所有「我是谁」的查询都给出错的那个,而现象只是「抓不到/对不上」,不报错。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');
const repo = read('src/platform/main/db/x-ws-role-repo.ts');
const handlers = read('src/platform/main/x/x-timeline-handlers.ts');
const schema = read('src/storage/surreal/x-schema.ts');

describe('per-ws 身份', () => {
  it('⭐ x_ws_account 按 ws 唯一', () => {
    expect(schema).toMatch(/idx_ws_account_ws\s+ON\s+x_ws_account\s+FIELDS\s+ws_id\s+UNIQUE/);
  });

  it('⭐ 识别账号时必须记到 ws 上(否则两个 ws 会互相覆盖)', () => {
    const i = handlers.lastIndexOf('await setWsAccount');
    expect(i, '识别流程未调用 setWsAccount').toBeGreaterThan(0);
  });

  it('⭐ 文章抓取不得回落全局 is_self', () => {
    // 锚到 X_FETCH_ARTICLE_REPLIES 这个 handler 本身,而不是「最后一个
    // parseTweetUrl」—— 后者会随新增调用点漂移(2026-09-03 就漂到了
    // 通知 handler 里,导致守卫误报)。
    const i = handlers.indexOf('X_FETCH_ARTICLE_REPLIES, async');
    expect(i, '找不到文章抓取 handler').toBeGreaterThan(0);
    const block = handlers.slice(i, i + 2000);
    expect(
      block.includes('getSelfHandleDb'),
      '回落全局 is_self 会在多 ws 场景抓错账号 —— 必须用 getWsAccount(wsId)',
    ).toBe(false);
    expect(block).toContain('getWsAccount');
  });

  it('requireWsAccount 未识别必须抛,不静默用别的账号', () => {
    const fn = repo.slice(repo.indexOf('export async function requireWsAccount'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('throw new Error');
  });

  it('listArticles 按本 ws 账号列,不用全局', () => {
    const i = handlers.indexOf('X_LIST_ARTICLES');
    const block = handlers.slice(i, i + 900);
    expect(block).toContain('requireWsAccount');
  });

  it('restId 只在与 handle 同属一人时才采信(页面混着别人的 id)', () => {
    const probe = read('src/platform/main/x/x-self-account.ts');
    expect(probe).toMatch(/restIdHandle\)\s*===\s*normalized/);
  });
});
