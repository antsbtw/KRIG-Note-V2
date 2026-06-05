/**
 * Gemini 对话历史主动拉取 + 结构化解析(去 DOM、对齐 Claude/ChatGPT 模式)
 *
 * 背景:Gemini 不像 Claude/ChatGPT 有「打开页就能拉完整对话」的简单 API;它的对话历史
 * 由 batchexecute 的 **hNvQHb** rpc 加载(打开历史对话页时浏览器发的那个请求)。V2 之前
 * 只被动拦 StreamGenerate(仅本次实时发的消息),所以打开历史对话提取就空 —— 本模块改为
 * **提取时主动在 guest 页 fetch hNvQHb**(带当前 URL 的 conversationId),拿整条历史。
 *
 * 数据来源 100% 网络(无 DOM):一个 hNvQHb 响应含所有 turn 的 [用户提问 + AI markdown +
 * groundings + 图],turn 内天然对齐。解析 path 抓包实测确认(与 V1 一致):
 *   inner = JSON.parse(rpc 'hNvQHb' 的 row[2]); inner[0] = turns[]
 *   turn[0][0]=convId  turn[0][1]=respId  turn[2][0][0]=用户提问  turn[3][0][0][1][0]=AI markdown
 *
 * V1 源:plugins/browser-capability/artifact/gemini-conversation-query.ts(batchexecute 解析)
 */

import type { WebContents } from 'electron';

export type GeminiGrounding = { title: string; url: string };

export type GeminiTurn = {
  index: number;
  conversationId: string;
  responseId: string;
  userMessage: string;
  /** AI 回复完整 markdown(hNvQHb 已是 markdown,无需重组)*/
  markdown: string;
  thinking: string | null;
  /** Imagen 图 URL(lh3.googleusercontent.com,短时有效)*/
  imageUrls: string[];
  groundings: GeminiGrounding[];
  createdAt: number;
};

export type GeminiConversationData = {
  conversationId: string | null;
  turns: GeminiTurn[];
};

// ── batchexecute 解析(V1 字面移植)──

function getPath(obj: unknown, path: number[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as unknown[])[k];
  }
  return cur;
}

/**
 * 解 batchexecute 响应体为帧数组。格式:`)]}'` 前缀 + 长度分隔的 JSON 帧。
 * 忽略声明的字节长度(UTF-8/16 不一致),贪婪解析到下一帧边界。
 */
function parseBatchExecute(body: string): unknown[] {
  let rest = body;
  if (rest.startsWith(")]}'")) rest = rest.slice(4);
  rest = rest.replace(/^\s+/, '');

  const frames: unknown[] = [];
  while (rest.length > 0) {
    const nl = rest.indexOf('\n');
    if (nl < 0) break;
    const header = rest.slice(0, nl).trim();
    if (!/^\d+$/.test(header)) break;
    rest = rest.slice(nl + 1);
    const next = rest.search(/\n\d+\n/);
    const chunk = next < 0 ? rest : rest.slice(0, next);
    try {
      frames.push(JSON.parse(chunk));
      rest = next < 0 ? '' : rest.slice(next + 1);
    } catch {
      break;
    }
  }
  return frames;
}

/** 从帧里取指定 rpcId 的内层 payload */
function pickRpcInner(frames: unknown[], rpcId: string): unknown | null {
  for (const frame of frames) {
    if (!Array.isArray(frame)) continue;
    for (const row of frame) {
      if (Array.isArray(row) && row[0] === 'wrb.fr' && row[1] === rpcId && typeof row[2] === 'string') {
        try { return JSON.parse(row[2]); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * 生成图/搜索图真实 URL。
 * 抓包实测(2026-06-05):图组在 assistant[12][0][0][0][9][0][0][0] 数组,每个 slot 的
 * [3] 位置是 lh3.googleusercontent.com 真实 URL(多数 slot 为 null,只少数有图)。
 * 注:assistant = turn[3],故相对 assistant 的 path 是 [12][0][0][0][9][0][0][0]。
 * (markdown 文本里只有假占位符 image_generation_content/N,真实 URL 在此 path)
 */
function collectImageUrls(assistant: unknown): string[] {
  const group = getPath(assistant, [12, 0, 0, 0, 9, 0, 0, 0]);
  if (!Array.isArray(group)) return [];
  const urls: string[] = [];
  for (const slot of group) {
    const u = getPath(slot, [3]);
    if (typeof u === 'string' && u.startsWith('https://lh3.')) urls.push(u);
  }
  return urls;
}

/** Web search groundings:turn[3][12][0][0][14][12][](V1 字面)*/
function collectGroundings(assistant: unknown): GeminiGrounding[] {
  const entries = getPath(assistant, [12, 0, 0, 14, 12]);
  if (!Array.isArray(entries)) return [];
  const out: GeminiGrounding[] = [];
  for (const e of entries) {
    const title = getPath(e, [0, 0, 1, 2]);
    const url = getPath(e, [0, 0, 1, 3, 1, 2, 1, 0]);
    if (typeof title === 'string' && typeof url === 'string' && url.startsWith('http')) {
      out.push({ title, url });
    }
  }
  return out;
}

function normalizeTurn(raw: unknown, index: number): GeminiTurn | null {
  const convId = getPath(raw, [0, 0]);
  const respId = getPath(raw, [0, 1]);
  const userText = getPath(raw, [2, 0, 0]);
  const assistant = getPath(raw, [3]);
  const markdown = getPath(assistant, [0, 0, 1, 0]);
  const thinking = getPath(assistant, [0, 0, 37, 0, 0]);
  const tsSec = getPath(raw, [4, 0]);

  if (typeof convId !== 'string' || typeof respId !== 'string') return null;

  return {
    index,
    conversationId: convId,
    responseId: respId,
    userMessage: typeof userText === 'string' ? userText : '',
    markdown: typeof markdown === 'string' ? markdown : '',
    thinking: typeof thinking === 'string' ? thinking : null,
    imageUrls: collectImageUrls(assistant),
    groundings: collectGroundings(assistant),
    createdAt: typeof tsSec === 'number' ? tsSec : 0,
  };
}

/** 把 hNvQHb 响应体解成结构化对话(供整页/单条共用)*/
export function parseGeminiHistory(body: string, conversationId: string | null): GeminiConversationData | null {
  const frames = parseBatchExecute(body);
  if (frames.length === 0) return null;
  const inner = pickRpcInner(frames, 'hNvQHb');
  if (!Array.isArray(inner) || !Array.isArray(inner[0])) return null;

  const turnsRaw = inner[0];

  const turns: GeminiTurn[] = [];
  for (const raw of turnsRaw) {
    const t = normalizeTurn(raw, 0); // index 在 reverse 后重排
    if (t) turns.push(t);
  }
  // hNvQHb 是最新在前 → 倒成时间正序
  turns.reverse();
  for (let i = 0; i < turns.length; i++) turns[i].index = i;

  return { conversationId, turns };
}

// ── 主动拉取 hNvQHb(在 guest 页 fetch,带登录 cookie)──

/** 从 Gemini URL 取 conversationId(c_xxx)。URL 形如 gemini.google.com/app/{id}(id 不带 c_ 前缀)*/
function extractConversationId(url: string): string | null {
  const m = url.match(/\/app\/([a-f0-9]+)/i);
  if (!m) return null;
  // hNvQHb 入参用 "c_<id>";URL 里是裸 id
  return m[1].startsWith('c_') ? m[1] : `c_${m[1]}`;
}

/**
 * 主动拉取当前 Gemini 对话历史(整条)。在 guest webContents 里 fetch batchexecute
 * 的 hNvQHb rpc(带页面登录态),拿完整对话 → 结构化。
 *
 * 失败返 null(非对话页 / 未登录 / 结构变更)。
 */
export async function fetchGeminiConversation(wc: WebContents): Promise<GeminiConversationData | null> {
  const url = wc.getURL() || '';
  const convId = extractConversationId(url);
  if (!convId) {
    console.warn('[gemini-query] not on a Gemini conversation page:', url);
    return null;
  }

  // 在 guest 页执行 fetch:batchexecute?rpcids=hNvQHb,body 为 f.req=[[["hNvQHb","<inner>",null,"generic"]]]
  // inner = ["c_<id>",10,null,1,[1],[4],null,1](抓包实测;第 2 个 10 = 拉取条数上限)
  // 需要 at token(XSRF)— 从页面 WIZ_global_data.SNlM0e 取(Google 标准)。
  const script = `(async function() {
    try {
      var convId = ${JSON.stringify(convId)};
      // at token:窗口里的 WIZ_global_data.SNlM0e
      var at = (window.WIZ_global_data && window.WIZ_global_data.SNlM0e) || null;
      if (!at) {
        var mt = document.documentElement.innerHTML.match(/"SNlM0e":"([^"]+)"/);
        if (mt) at = mt[1];
      }
      if (!at) return { error: 'no at token' };
      var innerReq = JSON.stringify([convId, 10, null, 1, [1], [4], null, 1]);
      var freq = JSON.stringify([[["hNvQHb", innerReq, null, "generic"]]]);
      var bl = (window.WIZ_global_data && window.WIZ_global_data['cfb2h']) || '';
      var apiUrl = '/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&source-path=' +
        encodeURIComponent(location.pathname) +
        (bl ? '&bl=' + encodeURIComponent(bl) : '') +
        '&_reqid=' + Math.floor(Math.random()*1000000) + '&rt=c';
      var bodyStr = 'f.req=' + encodeURIComponent(freq) + '&at=' + encodeURIComponent(at) + '&';
      var resp = await fetch(apiUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: bodyStr,
      });
      if (!resp.ok) return { error: 'http ' + resp.status };
      var text = await resp.text();
      return { body: text };
    } catch (e) {
      return { error: String(e) };
    }
  })()`;

  try {
    const result = await wc.executeJavaScript(script) as { body?: string; error?: string };
    if (!result || result.error || typeof result.body !== 'string') {
      console.warn('[gemini-query] fetch hNvQHb failed:', result?.error);
      return null;
    }
    return parseGeminiHistory(result.body, convId);
  } catch (err) {
    console.warn('[gemini-query] fetchGeminiConversation exception:', err);
    return null;
  }
}
