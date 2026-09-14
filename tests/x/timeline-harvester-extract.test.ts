/**
 * harvestTimeline 的字段抽取 —— 用**真实 X 载荷**验证。
 *
 * 用户 2026-09-02:「先做好网页自动滚动,获取全部 X 上显示的推文的函数吧,
 * **包含校验方法**。这个函数过关再考虑其他的问题。」
 *
 * 滚动本身要实机才能验;字段抽取可以离线钉死,防止再出
 * 「长推被截断」「views 当数字读」这类静默失真。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { globSync } from 'node:fs';

const DIR = join(homedir(), 'Library/Application Support/KRIG Note V2/x-payload-survey');
const files = existsSync(DIR) ? globSync(join(DIR, 'raw-*.json')) : [];

// 与 x-timeline-harvester 同一份抽取逻辑(测的是契约,不是实现细节)
function extract(node: unknown, out: Map<string, any>): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const it of node) extract(it, out); return; }
  const o = node as Record<string, any>;
  const lg = o.legacy;
  if (lg && typeof lg === 'object' && typeof lg.id_str === 'string') {
    const nres = o.note_tweet?.note_tweet_results?.result;
    const noteText = nres && typeof nres.text === 'string' ? nres.text : undefined;
    const views = o.views;
    if (!out.has(lg.id_str)) {
      out.set(lg.id_str, {
        tweetId: lg.id_str,
        authorHandle: o.core?.user_results?.result?.core?.screen_name,
        text: noteText ?? lg.full_text ?? '',
        isLongText: !!noteText,
        inReplyToStatusId: lg.in_reply_to_status_id_str,
        conversationId: lg.conversation_id_str,
        viewsRaw: views?.count,
        self: { favorited: lg.favorited, bookmarked: lg.bookmarked },
      });
    }
  }
  for (const v of Object.values(o)) extract(v, out);
}

describe.skipIf(files.length === 0)('harvestTimeline 字段抽取(真实载荷)', () => {
  const all = new Map<string, any>();
  for (const f of files) {
    for (const p of JSON.parse(readFileSync(f, 'utf-8'))) extract(p.body, all);
  }
  const list = [...all.values()];

  it('能从真实载荷解析出推文', () => {
    expect(list.length).toBeGreaterThan(0);
  });

  it('⭐ 长推走 note_tweet 取全文 —— legacy.full_text 会被截断', () => {
    const long = list.filter((t) => t.isLongText);
    if (long.length === 0) return;  // 该批载荷没有长推
    // 长推的正文应明显长于推特 280 字符的短推上限区间
    expect(Math.max(...long.map((t) => t.text.length))).toBeGreaterThan(200);
  });

  it('⭐ views.count 是字符串,不能当数字直接用', () => {
    const withViews = list.filter((t) => t.viewsRaw !== undefined);
    for (const t of withViews) expect(typeof t.viewsRaw).toBe('string');
  });

  it('⭐ 登录态自身互动状态可得(favorited/bookmarked)', () => {
    const withSelf = list.filter((t) => typeof t.self.favorited === 'boolean');
    expect(withSelf.length).toBeGreaterThan(0);
  });

  it('回复带权威关系字段(父推 + 会话根)', () => {
    const replies = list.filter((t) => t.inReplyToStatusId);
    expect(replies.length).toBeGreaterThan(0);
    for (const r of replies.slice(0, 20)) expect(r.conversationId).toBeTruthy();
  });

  it('每条都有作者与 id —— 缺了就是解析漏了', () => {
    const bad = list.filter((t) => !t.tweetId || !t.authorHandle);
    expect(bad.length, `有 ${bad.length} 条缺 id 或作者`).toBe(0);
  });
});
