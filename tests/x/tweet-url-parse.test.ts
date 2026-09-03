/**
 * 守卫:推文链接解析。
 *
 * 用户 2026-09-03 拍板改用「贴链接」而非自动探测置顶帖 ——
 * 自动探测是程序在猜哪一篇,链接是用户手里现成的、确定性的输入。
 *
 * ⚠️ 关键:链接里的 handle 可能**不是当前登录账号**
 *   (实例 https://x.com/OTun_MyVPN/status/... 而 is_self 是 netlab2gfw)。
 *   必须以链接为准,否则拼详情页 URL 会拼错、抓不到。
 */
import { describe, it, expect } from 'vitest';
import { parseTweetUrl } from '@platform/main/x/x-article-replies';

const ok = (r: ReturnType<typeof parseTweetUrl>) => {
  if ('error' in r) throw new Error(`不该失败: ${r.error}`);
  return r;
};

describe('parseTweetUrl', () => {
  it('⭐ 用户给的真实形态(带 ?s=20)', () => {
    const r = ok(parseTweetUrl('https://x.com/OTun_MyVPN/status/2092213139139854555?s=20'));
    expect(r.tweetId).toBe('2092213139139854555');
    expect(r.handle).toBe('otun_myvpn');   // 归一化:小写无 @
  });

  it('⭐ handle 取自链接,不是登录账号 —— 抓别人的文章也要对', () => {
    expect(ok(parseTweetUrl('https://x.com/SomeoneElse/status/123456789')).handle)
      .toBe('someoneelse');
  });

  it('twitter.com 老域名兼容', () => {
    expect(ok(parseTweetUrl('https://twitter.com/foo/status/999888777')).tweetId)
      .toBe('999888777');
  });

  it('纯数字 id 也接受(用户只贴 id)', () => {
    const r = ok(parseTweetUrl('2092213139139854555'));
    expect(r.tweetId).toBe('2092213139139854555');
    expect(r.handle).toBeUndefined();
  });

  it('末尾斜杠 / 多余路径段不影响', () => {
    expect(ok(parseTweetUrl('https://x.com/foo/status/123456/photo/1')).tweetId).toBe('123456');
  });

  it('无协议也能解析', () => {
    expect(ok(parseTweetUrl('x.com/foo/status/123456')).tweetId).toBe('123456');
  });

  it('/i/status/ 形态:有 id 无 handle(调用方需回落 is_self)', () => {
    const r = ok(parseTweetUrl('https://x.com/i/status/123456'));
    expect(r.tweetId).toBe('123456');
    expect(r.handle).toBeUndefined();
  });

  it('非 X 链接必须报错,不能静默当成 id', () => {
    expect(parseTweetUrl('https://example.com/foo/status/123')).toHaveProperty('error');
  });

  it('缺 /status/ 报错', () => {
    expect(parseTweetUrl('https://x.com/OTun_MyVPN')).toHaveProperty('error');
  });

  it('空输入报错', () => {
    expect(parseTweetUrl('')).toHaveProperty('error');
    expect(parseTweetUrl('   ')).toHaveProperty('error');
  });
});
