/**
 * X 原始载荷勘查 —— 搞清楚**浏览器底层到底拿到了什么**。
 *
 * 用户 2026-09-02 定的方法论:
 * 「需要你再仔细分析我们从浏览器底层获取到的所有推文的元数据,
 *   才能够真正的搞清楚能够做到哪一个地步,而不是我要求什么,
 *   你想什么,怎么实现。」
 *
 * 此前的错误顺序:从「我恰好抓了哪些 DOM 字段」出发,逐个需求回答能不能做。
 * 正确顺序:**先测清底层供给,再谈能力边界**。
 *
 * ── 为什么 DOM 不是底层 ──────────────────────────────────────────
 * DOM 是 X **渲染之后**的产物,只保留了它想显示的部分。真正的全集在
 * GraphQL 响应里(X 前端自己就是消费它来渲染的)。举例:
 * DOM 上只能看到「点赞数 4」,而 API 响应里可能带着 favorited / retweeted
 * 等布尔位、完整的 entities(链接/话题/@提及)、以及回复关系的显式字段。
 * 差别决定了「能做到哪一步」,所以必须直接量 API,不是量 DOM。
 *
 * ── 手段 ────────────────────────────────────────────────────────
 * CDP(Network domain)挂在 X 的 webContents 上,捕获 GraphQL 响应体。
 * 本仓已有同样的用法(ai/interceptor.ts 抓 Gemini SSE),不是新机制。
 *
 * ⚠️ 只读勘查:不落库、不改状态。输出「字段清单 + 出现频次」,
 *    **不做解读、不预设结论** —— 由真实字段说话。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { resolveXWebContents } from './x-webcontents';

/** 一条被捕获的 GraphQL 响应 */
interface CapturedPayload {
  /** 来自哪个勘查目标页 */
  source: string;
  operation: string;
  url: string;
  bytes: number;
  body: string;
}

/**
 * 递归枚举对象里出现过的所有字段路径及其出现次数与样例值。
 * 不预判哪些字段有用 —— 全量列出,由人判读。
 */
function collectFieldPaths(
  node: unknown,
  prefix: string,
  out: Map<string, { count: number; sample: string }>,
  depth = 0,
): void {
  if (depth > 20 || node === null || node === undefined) return;

  if (Array.isArray(node)) {
    // ⚠️ 必须**全量遍历**:X 一个响应含约 20 条推,只看前 2 个会漏掉
    // 只在特定推文上才出现的字段(长推 note_tweet、投票 card、社区 community_results、
    // 引用 quoted_status_result…)。用户 2026-09-02:「推文的元数据越多越好」——
    // 字段发现阶段的漏采,后面补不回来。
    for (const item of node) collectFieldPaths(item, `${prefix}[]`, out, depth + 1);
    return;
  }

  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object') {
        collectFieldPaths(v, path, out, depth + 1);
      } else {
        const prev = out.get(path);
        const sample = String(v).slice(0, 120);
        out.set(path, { count: (prev?.count ?? 0) + 1, sample: prev?.sample ?? sample });
      }
    }
  }
}

export interface PayloadSurveyResult {
  /** 完整报告落盘路径 —— UI 只显示摘要,全量在这里 */
  reportPath: string;
  /** 原始响应样本落盘路径(供日后重新分析,不必再跑一次) */
  rawPath: string;
  /** 捕获到的 GraphQL 操作名与次数 */
  operations: Array<{ name: string; count: number; bytes: number }>;
  /** 全部标量字段路径(按出现次数降序),这是**能力边界的真实依据** */
  fields: Array<{ path: string; count: number; sample: string }>;
  /** 与「关系」直接相关的字段(仅做聚类展示,不改变上面的全量清单) */
  relationFields: Array<{ path: string; count: number; sample: string }>;
  totalPayloads: number;
  note: string;
}

/**
 * 勘查目标页 —— 不同页面供给不同关系,必须分别量。
 *
 * ⚠️ 2026-09-02 教训:我曾断言「点赞/转发关系拿不到」,依据是推文卡片上
 * 只有计数。那句话对**时间线页**成立,但我把一个页面的局限当成了整个 X 的
 * 局限 —— **通知页明确写着「X liked your post」「X reposted」**,
 * 是「谁对我做了什么」的完整真源,且是入向关系(别人对我),画像价值更高。
 * → 下结论前先把各页面都量一遍,别拿一个页面的观察外推。
 */
export const SURVEY_TARGETS = [
  { key: 'notifications', url: 'https://x.com/notifications', why: '入向关系:谁赞/转/回/关注了我' },
  { key: 'home',          url: 'https://x.com/home',          why: '时间线推文全字段' },
  // 画像素材:个人主页含 UserByScreenName —— 简介/注册时间/粉丝数/地区/置顶推等
  { key: 'profile',       url: 'https://x.com/NetLab2GFW',    why: '账号实体字段(画像基底)' },
  // 自己的回复流:含 in_reply_to_* 权威字段,验证回复关系
  { key: 'with_replies',  url: 'https://x.com/NetLab2GFW/with_replies', why: '回复关系权威字段' },
] as const;

/** 关系类关键词 —— 只用于分组展示,不用于过滤 */
const RELATION_HINTS = [
  'favorited', 'retweeted', 'bookmarked', 'liked',
  'in_reply_to', 'inReplyTo', 'conversation', 'quoted', 'parent',
  'reply_count', 'favorite_count', 'retweet_count', 'bookmark_count', 'quote_count',
  'following', 'followed_by', 'friends_count', 'followers_count',
  // 通知页特有:谁对我做了什么
  'notification', 'timelineNotification', 'from_users', 'target_objects', 'icon',
];

/**
 * 勘查 X 的 GraphQL 载荷。
 *
 * @param seconds 采集时长;期间需要**人工在 X 上滚动/操作**以触发请求
 */
export async function surveyXPayloads(
  targetWcId?: number,
  seconds = 25,
): Promise<PayloadSurveyResult | { error: string }> {
  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  let attached = false;
  try {
    // 已被别处 attach 时会抛,视为可继续(共用同一会话)
    wc.debugger.attach('1.3');
    attached = true;
  } catch (err) {
    console.warn('[x-payload-inspector] attach 失败(可能已被 attach):', err);
  }

  const captured: CapturedPayload[] = [];
  const pending = new Map<string, { url: string; op: string }>();
  let currentTarget = 'init';

  const onMessage = (_e: unknown, method: string, params: any): void => {
    if (method === 'Network.requestWillBeSent') {
      const url: string = params?.request?.url ?? '';
      // X 的数据接口:/i/api/graphql/<hash>/<OperationName>
      if (url.includes('/i/api/graphql/')) {
        const op = url.split('/').pop()?.split('?')[0] ?? 'unknown';
        pending.set(params.requestId, { url, op });
      }
      return;
    }
    if (method === 'Network.loadingFinished') {
      const info = pending.get(params.requestId);
      if (!info) return;
      pending.delete(params.requestId);
      wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
        .then((r: any) => {
          if (r?.body) {
            captured.push({ source: currentTarget, operation: info.op, url: info.url, bytes: r.body.length, body: r.body });
            console.log(`[x-payload-inspector] 捕获 ${info.op} (${r.body.length} bytes)`);
          }
        })
        .catch(() => { /* 响应体可能已被丢弃,忽略 */ });
    }
  };

  wc.debugger.on('message', onMessage);
  await wc.debugger.sendCommand('Network.enable').catch(() => {});

  // 逐个目标页导航 + 滚动,各页面供给不同关系,必须都量到
  const perTarget = Math.max(6, Math.floor(seconds / SURVEY_TARGETS.length));
  for (const t of SURVEY_TARGETS) {
    currentTarget = t.key;
    console.log(`[x-payload-inspector] → ${t.key} (${t.why})`);
    wc.loadURL(t.url);
    await new Promise((r) => setTimeout(r, 3500));
    const until = Date.now() + perTarget * 1000;
    while (Date.now() < until) {
      await wc.executeJavaScript(`window.scrollBy(0, window.innerHeight * 0.8)`).catch(() => {});
      await new Promise((r) => setTimeout(r, 1800));
    }
  }

  wc.debugger.off('message', onMessage);
  if (attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }

  if (captured.length === 0) {
    return { error: `${seconds}s 内没捕获到 GraphQL 响应(X 可能全走缓存 —— 试着手动滚动/切换标签页再跑)` };
  }

  // 统计操作名
  const opMap = new Map<string, { count: number; bytes: number }>();
  for (const c of captured) {
    const key = `${c.source}/${c.operation}`;
    const prev = opMap.get(key);
    opMap.set(key, { count: (prev?.count ?? 0) + 1, bytes: (prev?.bytes ?? 0) + c.bytes });
  }

  // 枚举字段
  const fieldMap = new Map<string, { count: number; sample: string }>();
  for (const c of captured) {
    try {
      collectFieldPaths(JSON.parse(c.body), '', fieldMap);
    } catch { /* 非 JSON 响应跳过 */ }
  }

  const allFields = [...fieldMap.entries()]
    .map(([path, v]) => ({ path, count: v.count, sample: v.sample }))
    .sort((a, b) => b.count - a.count);

  const relationFields = allFields.filter((f) =>
    RELATION_HINTS.some((hint) => f.path.toLowerCase().includes(hint.toLowerCase())),
  );

  const operations = [...opMap.entries()]
    .map(([name, v]) => ({ name, count: v.count, bytes: v.bytes }))
    .sort((a, b) => b.count - a.count);

  // ── 落盘 ────────────────────────────────────────────────────────
  // UI 文本框装不下几千个字段,且关掉就没了。字段发现是**一次性成本**,
  // 结果必须留痕:报告用于判读,原始响应用于日后重新分析(不必再跑一次)。
  const dir = join(app.getPath('userData'), 'x-payload-survey');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(dir, `survey-${stamp}.md`);
  const rawPath = join(dir, `raw-${stamp}.json`);

  const lines: string[] = [
    `# X GraphQL 载荷勘查 — ${new Date().toISOString()}`,
    '',
    `捕获 ${captured.length} 个响应,发现 ${allFields.length} 个字段路径。`,
    '',
    '## 捕获的接口(来源页/操作名)',
    '',
    ...operations.map((o) => `- \`${o.name}\` ×${o.count} (${Math.round(o.bytes / 1024)}KB)`),
    '',
    '## 关系类字段',
    '',
    ...relationFields.map((f) => `- \`${f.path}\` ×${f.count} = ${f.sample}`),
    '',
    `## 全部字段(${allFields.length} 个,按出现次数降序)`,
    '',
    ...allFields.map((f) => `- \`${f.path}\` ×${f.count} = ${f.sample}`),
  ];
  writeFileSync(reportPath, lines.join('\n'), 'utf-8');

  // 原始响应:每个接口留最大的一份(样本最全),避免文件过大
  const biggest = new Map<string, CapturedPayload>();
  for (const c of captured) {
    const k = `${c.source}/${c.operation}`;
    if (!biggest.has(k) || biggest.get(k)!.bytes < c.bytes) biggest.set(k, c);
  }
  writeFileSync(rawPath, JSON.stringify(
    [...biggest.entries()].map(([k, c]) => ({
      key: k, url: c.url, bytes: c.bytes,
      body: (() => { try { return JSON.parse(c.body); } catch { return c.body; } })(),
    })), null, 2), 'utf-8');

  console.log(`[x-payload-inspector] 报告: ${reportPath}`);
  console.log(`[x-payload-inspector] 原始: ${rawPath}`);

  return {
    reportPath,
    rawPath,
    operations,
    fields: allFields,
    relationFields,
    totalPayloads: captured.length,
    note: '字段清单来自 X GraphQL 原始响应 —— 这是能力边界的真实依据,不是 DOM 推断',
  };
}
