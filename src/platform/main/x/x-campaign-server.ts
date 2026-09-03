/**
 * 接口 B 服务端 —— campaign-tasks 主动触发重抓(契约 §3)。
 *
 * 两个端点:
 *  · POST /refresh  用户授权后未命中缓存时调,目的是「让用户在同一个页面上
 *                   几秒内拿到结果」
 *  · GET  /health   每分钟探一次,连续 3 次失败亮红灯;logged_in:false 也算不健康
 *
 * ⚠️ Windows 部署要点(契约 §6,用户明确要求长期跑在 Windows):
 *  · 监听 **不能是 127.0.0.1** —— 必须是 tailnet IP 或 0.0.0.0,
 *    否则 campaign-tasks 从别的机器敲不到
 *  · 防火墙入站只对 Tailscale 网卡放行
 *  · 活动期间关闭休眠(见 registerCampaignServer 里的 powerSaveBlocker)
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { powerSaveBlocker } from 'electron';
import { getCampaignConfig } from './x-campaign-config';
import { getRefreshServingWs } from '../db/x-ws-role-repo';
import { getWsAccount } from '../db/x-ws-role-repo';
import { fetchArticleReplies, parseTweetUrl } from './x-article-replies';
import { upsertCampaignReplies } from '../db/x-campaign-repo';
import { pushPending } from './x-campaign-push';
import { getActiveWcId } from './x-search-scheduler';

let server: Server | null = null;
let blockerId: number | null = null;
let lastFetchAt: string | undefined;
let lastPushAt: string | undefined;
/** 契约 §3.2.4:同一 article 30s 内已刷过可直接 429 */
const lastRefreshAt = new Map<string, number>();
const COOLDOWN_MS = 30_000;

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function fail(res: ServerResponse, status: number, code: string, message: string,
  retryable: boolean, extra?: Record<string, unknown>): void {
  send(res, status, { success: false, error: { code, message, retryable }, ...extra });
}

async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); return; }
      data += c.toString('utf-8');
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** POST /refresh —— 立刻抓一次,**先推 A 再返回**(契约 §3.2.2) */
async function handleRefresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = Date.now();
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    fail(res, 413, 'PAYLOAD_TOO_LARGE', '请求体超过 1MB', false);
    return;
  }

  let body: { article_id?: string; reason?: string; budget_ms?: number;
    hint?: { x_uid?: string; username?: string } };
  try { body = JSON.parse(raw); }
  catch { fail(res, 400, 'VALIDATION_ERROR', 'body 不是合法 JSON', false); return; }

  const articleId = body.article_id;
  if (!articleId) { fail(res, 400, 'VALIDATION_ERROR', '缺 article_id', false); return; }

  // 冷却:双保险(campaign-tasks 侧也有 30s)
  const last = lastRefreshAt.get(articleId);
  if (last && Date.now() - last < COOLDOWN_MS) {
    const wait = COOLDOWN_MS - (Date.now() - last);
    fail(res, 429, 'COOLDOWN', `${Math.ceil(wait / 1000)}s 内已刷新过`, true,
      { retry_after_ms: wait });
    return;
  }

  // 由**配置指定的那个 campaign ws** 承接(用户:「通过 ws 的配置项构建」)
  const serving = await getRefreshServingWs();
  if (!serving) {
    fail(res, 503, 'SCRAPER_UNAVAILABLE',
      '没有 ws 配置为承接 /refresh —— 请在活动配置里勾选「承接外部触发口」', true);
    return;
  }
  const acc = await getWsAccount(serving.wsId);
  if (!acc) {
    // 登录态未识别 = 不健康(契约 §3.4 明确 logged_in:false 也算不健康)
    fail(res, 503, 'SCRAPER_UNAVAILABLE',
      `ws=${serving.wsId} 尚未识别登录账号(登录态可能已失效)`, true);
    return;
  }

  // 文章作者:优先用配置里存的链接;否则回落承接 ws 的账号
  const cfgArticle = serving.articleId ? parseTweetUrl(serving.articleId) : null;
  const authorHandle = (cfgArticle && !('error' in cfgArticle) && cfgArticle.handle)
    || acc.handle;

  const wcId = getActiveWcId(serving.wsId) ?? undefined;
  lastRefreshAt.set(articleId, Date.now());

  const budget = typeof body.budget_ms === 'number' ? body.budget_ms : 6_000;
  const r = await fetchArticleReplies(articleId, authorHandle, wcId, {
    hint: body.hint, budgetMs: budget,
  });
  if ('error' in r) {
    fail(res, 503, 'SCRAPER_UNAVAILABLE', r.error, true);
    return;
  }
  lastFetchAt = new Date().toISOString();

  // ⚠️ 契约 §3.2.2:**先**通过接口 A 推,**再**返回本接口响应 ——
  // 这样 campaign-tasks 收到响应时它那边的缓存已经是新的。
  await upsertCampaignReplies(articleId, r.items);
  const pushed = await pushPending(articleId).catch((err) => {
    console.error('[campaign-server] 推送失败(不影响本次响应):', err);
    return { batches: 0, accepted: 0, updated: 0, rejected: 0, matchedPending: 0 };
  });
  if (pushed.accepted || pushed.updated) lastPushAt = new Date().toISOString();

  send(res, 200, {
    success: true,
    data: {
      fetched: r.fetched,
      pushed: pushed.accepted + pushed.updated,
      hint_found: r.hintFound,
      elapsed_ms: Date.now() - started,
      partial: r.partial,
    },
  });
}

/** GET /health —— 运营面板每分钟探一次 */
async function handleHealth(res: ServerResponse): Promise<void> {
  const serving = await getRefreshServingWs().catch(() => null);
  const acc = serving ? await getWsAccount(serving.wsId).catch(() => null) : null;
  // 契约 §3.4:logged_in:false 也算不健康
  const loggedIn = !!acc;
  send(res, 200, {
    success: true,
    data: {
      ok: loggedIn && !!serving,
      logged_in: loggedIn,
      account: acc?.handle,
      ws_id: serving?.wsId,
      last_fetch_at: lastFetchAt,
      last_push_at: lastPushAt,
      version: '1.0',
    },
  });
}

/** 启动接口 B 服务端。已启动则先停再起(配置改了要生效) */
export async function startCampaignServer(): Promise<{ ok: true; port: number } | { error: string }> {
  const cfg = getCampaignConfig();
  if (!cfg) return { error: '未配置 X_SCRAPER_SECRET / CAMPAIGN_TASKS_IMPORT_URL' };

  await stopCampaignServer();

  server = createServer((req, res) => {
    // 鉴权:两个方向都带同一个密钥(契约 §1)
    const got = req.headers['x-scraper-secret'];
    if (got !== cfg.secret) {
      fail(res, 401, 'UNAUTHORIZED', '密钥不对', false);
      return;
    }
    const url = (req.url ?? '').split('?')[0];
    if (req.method === 'POST' && url === '/refresh') {
      handleRefresh(req, res).catch((err) => {
        console.error('[campaign-server] /refresh 异常:', err);
        fail(res, 503, 'SCRAPER_UNAVAILABLE', String(err), true);
      });
      return;
    }
    if (req.method === 'GET' && url === '/health') {
      handleHealth(res).catch(() => fail(res, 503, 'SCRAPER_UNAVAILABLE', 'health 异常', true));
      return;
    }
    fail(res, 404, 'VALIDATION_ERROR', `未知路径 ${req.method} ${url}`, false);
  });

  return new Promise((resolve) => {
    server!.once('error', (err) => {
      console.error('[campaign-server] 启动失败:', err);
      server = null;
      resolve({ error: String(err) });
    });
    // ⚠️ 契约 §6:Windows 上监听地址**不能是 127.0.0.1**,否则对方敲不到
    server!.listen(cfg.refreshPort, cfg.refreshBind, () => {
      console.log(`[campaign-server] 监听 ${cfg.refreshBind}:${cfg.refreshPort}`);
      // 活动期间阻止休眠 —— 长期跑在 Windows,睡了就等于服务不可达
      if (blockerId === null) {
        blockerId = powerSaveBlocker.start('prevent-app-suspension');
      }
      resolve({ ok: true, port: cfg.refreshPort });
    });
  });
}

export async function stopCampaignServer(): Promise<void> {
  if (blockerId !== null) {
    try { powerSaveBlocker.stop(blockerId); } catch { /* 已停 */ }
    blockerId = null;
  }
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  console.log('[campaign-server] 已停止');
}

export function campaignServerRunning(): boolean {
  return server !== null;
}
