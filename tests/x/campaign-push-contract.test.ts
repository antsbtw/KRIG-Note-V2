/**
 * 守卫:接口 A 客户端的契约行为(真起一个 mock server 做 HTTP 往返)。
 *
 * 契约 §2.3 的重试策略是**有方向性**的,弄反了后果不同:
 *  · 5xx/超时 → 重试(对方临时故障)
 *  · 4xx      → **不重试**(请求本身有问题,重试只会刷屏)
 *  · 401      → **停下报警**(密钥错了越试越糟,还可能被对方封)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { chunkItems, pushBatch } from '@platform/main/x/x-campaign-push';
import type { ArticleReplyItem } from '@platform/main/x/x-article-replies';

const ARTICLE = '2092213139139854555';
let srv: Server | null = null;

function item(over: Partial<ArticleReplyItem> = {}): ArticleReplyItem {
  return {
    tweet_id: 't1', kind: 'reply', username: 'someone',
    has_media: true, created_at: '2026-09-05T08:12:33.000Z', ...over,
  };
}

/** 起一个 mock campaign-tasks;返回其 URL */
async function mock(handler: (req: any, res: any) => void): Promise<string> {
  srv = createServer(handler);
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', () => r()));
  const port = (srv!.address() as { port: number }).port;
  return `http://127.0.0.1:${port}/x-replies/import`;
}

afterEach(async () => {
  if (srv) { await new Promise<void>((r) => srv!.close(() => r())); srv = null; }
  delete process.env.CAMPAIGN_TASKS_IMPORT_URL;
  delete process.env.X_SCRAPER_SECRET;
});

describe('接口 A 分批', () => {
  it('⭐ 一批不超过 500 条(契约 §2.1)', () => {
    const batches = chunkItems(Array.from({ length: 1200 }, (_, i) => item({ tweet_id: `t${i}` })));
    expect(batches.length).toBe(3);
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(500);
  });

  it('⭐ 请求体接近 1MB 时提前切批', () => {
    const big = Array.from({ length: 400 }, (_, i) =>
      item({ tweet_id: `t${i}`, text_excerpt: 'x'.repeat(3000) }));
    const batches = chunkItems(big);
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) {
      expect(JSON.stringify({ article_id: ARTICLE, items: b }).length).toBeLessThan(1_000_000);
    }
  });
});

describe('接口 A 推送与错误处理', () => {
  it('⭐ 成功:带上 X-Scraper-Secret,解析 accepted/updated', async () => {
    let gotSecret = '';
    let gotBody: any = null;
    const url = await mock((req, res) => {
      gotSecret = req.headers['x-scraper-secret'] ?? '';
      let d = ''; req.on('data', (c: any) => { d += c; });
      req.on('end', () => {
        gotBody = JSON.parse(d);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true,
          data: { accepted: 2, updated: 1, matched_pending: 1, rejected: [] } }));
      });
    });
    process.env.CAMPAIGN_TASKS_IMPORT_URL = url;
    process.env.X_SCRAPER_SECRET = 'test-secret-abc';

    const r = await pushBatch(ARTICLE, [item({ tweet_id: 'a' }), item({ tweet_id: 'b' })]);
    expect(gotSecret).toBe('test-secret-abc');
    expect(gotBody.article_id).toBe(ARTICLE);
    expect(r.accepted).toBe(2);
    expect(r.updated).toBe(1);
    expect(r.matchedPending).toBe(1);
    expect(r.confirmedIds).toEqual(['a', 'b']);
  });

  it('⭐ 401 必须是 fatal(停下报警),不是 retryable', async () => {
    const url = await mock((_req, res) => {
      res.writeHead(401); res.end(JSON.stringify({ success: false }));
    });
    process.env.CAMPAIGN_TASKS_IMPORT_URL = url;
    process.env.X_SCRAPER_SECRET = 'wrong';
    const r = await pushBatch(ARTICLE, [item()]);
    expect(r.fatal, '401 必须 fatal').toBeTruthy();
    expect(r.retryable, '401 不能标成可重试(会无限循环)').toBeUndefined();
  });

  it('⭐ 5xx 必须是 retryable,不是 fatal', async () => {
    const url = await mock((_req, res) => { res.writeHead(500); res.end('{}'); });
    process.env.CAMPAIGN_TASKS_IMPORT_URL = url;
    process.env.X_SCRAPER_SECRET = 's';
    const r = await pushBatch(ARTICLE, [item()]);
    expect(r.retryable).toBeTruthy();
    expect(r.fatal).toBeUndefined();
  });

  it('400 不重试(请求结构问题)', async () => {
    const url = await mock((_req, res) => { res.writeHead(400); res.end('{}'); });
    process.env.CAMPAIGN_TASKS_IMPORT_URL = url;
    process.env.X_SCRAPER_SECRET = 's';
    const r = await pushBatch(ARTICLE, [item()]);
    expect(r.fatal).toBeTruthy();
  });

  it('⭐ 单条被拒的不进 confirmedIds(否则永不重试,而它可能下次能过)', async () => {
    const url = await mock((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { accepted: 1, updated: 0,
        rejected: [{ tweet_id: 'bad', reason: 'MISSING_USERNAME' }] } }));
    });
    process.env.CAMPAIGN_TASKS_IMPORT_URL = url;
    process.env.X_SCRAPER_SECRET = 's';
    const r = await pushBatch(ARTICLE, [item({ tweet_id: 'ok' }), item({ tweet_id: 'bad' })]);
    expect(r.confirmedIds).toEqual(['ok']);
    expect(r.rejected[0].reason).toBe('MISSING_USERNAME');
  });

  it('⭐ 未配置密钥时 fatal,且提示是「未配置」而非网络问题', async () => {
    const r = await pushBatch(ARTICLE, [item()]);
    expect(r.fatal).toMatch(/未配置/);
  });
});

describe('配置容错(部署时踩过的坑)', () => {
  it('⭐ 占位符密钥不算「已配置」—— 否则带假密钥启动,对方一律 401', async () => {
    process.env.CAMPAIGN_TASKS_IMPORT_URL = 'http://example.com/import';
    process.env.X_SCRAPER_SECRET = 'REPLACE_ME_WITH_REAL_SECRET';
    const r = await pushBatch('a1', [item()]);
    expect(r.fatal, '占位符必须被识别为未配置').toMatch(/未配置/);
  });
});
