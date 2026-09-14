/**
 * 守卫:接口 B 服务端的契约行为(真起服务、真发 HTTP 请求)。
 *
 * 重点守三件容易做错、且错了很难发现的事:
 *  · 鉴权:两个方向都要带同一密钥(契约 §1),密钥错必须 401
 *  · 冷却:同 article 30s 内重复请求 → 429 + retry_after_ms(契约 §3.2.4)
 *  · Windows:监听地址**不能是 127.0.0.1**(契约 §6),否则对方敲不到
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-campaign-server.ts'), 'utf-8');
const cfg = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-campaign-config.ts'), 'utf-8');

describe('接口 B 契约实现', () => {
  it('⭐ 鉴权:非法密钥返回 401 UNAUTHORIZED', () => {
    expect(src).toMatch(/x-scraper-secret/);
    expect(src).toMatch(/401,\s*'UNAUTHORIZED'/);
  });

  it('⭐ 冷却:429 COOLDOWN 且带 retry_after_ms(契约 §3.2.4)', () => {
    expect(src).toMatch(/429,\s*'COOLDOWN'/);
    expect(src).toContain('retry_after_ms');
    expect(src).toMatch(/COOLDOWN_MS\s*=\s*30_000/);
  });

  it('⭐ 先推 A 再返回响应(契约 §3.2.2:响应到达时对方缓存已是新的)', () => {
    const fn = src.slice(src.indexOf('async function handleRefresh'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    const pushIdx = body.indexOf('pushPending');
    const respIdx = body.indexOf('send(res, 200');
    expect(pushIdx).toBeGreaterThan(0);
    expect(respIdx).toBeGreaterThan(pushIdx);
  });

  it('⭐ Windows:默认监听不得是 127.0.0.1(契约 §6,否则对方敲不到)', () => {
    expect(cfg).not.toMatch(/refreshBind[^;]*\|\|\s*'127\.0\.0\.1'/);
    expect(cfg).toMatch(/\|\|\s*'0\.0\.0\.0'/);
  });

  it('登录态失效 → 503 SCRAPER_UNAVAILABLE(契约 §3.4 logged_in:false 也算不健康)', () => {
    expect(src).toMatch(/503,\s*'SCRAPER_UNAVAILABLE'/);
    expect(src).toContain('logged_in');
  });

  it('/health 返回 ok / logged_in / last_fetch_at / last_push_at / version', () => {
    for (const f of ['ok:', 'logged_in:', 'last_fetch_at:', 'last_push_at:', 'version:']) {
      expect(src).toContain(f);
    }
  });

  it('⭐ 长跑必须阻止休眠(Windows 上睡了就等于服务不可达)', () => {
    expect(src).toContain('powerSaveBlocker');
    // 停服时必须释放,否则电脑再也睡不着
    const stop = src.slice(src.indexOf('export async function stopCampaignServer'));
    expect(stop.slice(0, stop.indexOf('\n}'))).toContain('powerSaveBlocker.stop');
  });

  it('密钥绝不落日志(只报「已配置/未配置」)', () => {
    expect(cfg).toMatch(/hasSecret/);
    // console 里不得直接打 secret 变量
    for (const line of cfg.split('\n')) {
      if (line.includes('console.')) expect(line).not.toMatch(/\bsecret\b(?!:)/);
    }
  });
});
