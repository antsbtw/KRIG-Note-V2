/**
 * ChatGPT 完整对话提取(多 turn + Canvas + DALL-E/Code Interpreter 图)
 *
 * V1 源:src/plugins/web-bridge/capabilities/chatgpt-content-extractor.ts(593 行)
 * V2 适配:
 *   - V1 用 CDP + viewAPI.wbCdpFindResponse(IPC + main 进程 webContents.debugger);
 *     V2 简化:页面注入 chatgpt-conversation-hook.ts 截 fetch.clone() 缓存到
 *     window.__krig_chatgpt_cache,main 进程 executeJavaScript 读取
 *   - 跳过 viewAPILike 抽象;直接 webContents.executeJavaScript
 *
 * 数据源:
 *   - /backend-api/conversation/{uuid}  → 对话树 mapping
 *   - /backend-api/conversation/{uuid}/textdocs → Canvas 文档
 *   - /backend-api/estuary/content?id=file_xxx → 图片 bytes(base64)
 *
 * 流程:
 *   1. 注入 hook(已在 interceptor.ts 触发,本模块假设 cache 已有数据)
 *   2. 读 conversation cache → 解析 mapping → walkMapping → ordered messages
 *   3. 读 textdocs cache → 拼接 Canvas 内容(如有)
 *   4. 收集 messages 中的 fileRefs → 读 estuary cache → base64 dataUrl
 *   5. messageToMarkdown 把 user/assistant 消息 + 嵌入图 + Canvas → markdown
 *   6. 按 turn 拼接 ## 👤 用户 / ## 🤖 AI 分隔
 */

import type { WebContents } from 'electron';
import {
  getChatGPTReadCacheScript,
  getChatGPTFetchConversationScript,
} from '../inject-scripts/chatgpt-conversation-hook';
// ⭐ 步 4 还债②:解析逻辑已拆到纯函数模块(零 Electron 依赖,可完全单测)。
// 本文件只保留「取数」那一半 —— 它需要真 WebContents。
import {
  extractConversationId,
  sniffMimeFromBase64,
  fileIdFromEstuaryUrl,
  walkMapping,
  normalizeMessage,
  type NormalizedMessage,
} from '../parsers/chatgpt-payload';

interface CacheEntry {
  url: string;
  body: string;
  mimeType: string;
  length: number;
  ts: number;
  isBinary: boolean;
}

interface CacheReadResult {
  success: boolean;
  matches: CacheEntry[];
}

export interface ChatGPTFullExtractionResult {
  success: boolean;
  markdown?: string;
  title?: string;
  model?: string;
  turnCount?: number;
  artifactCount?: number;
  error?: string;
}

// ─── URL / ID helpers ────────────────────────────────────────────────

// ─── 读 cache helper ────────────────────────────────────────────────

async function readCache(
  wc: WebContents,
  urlSubstring: string,
  mode: 'all' | 'latest' | 'first' = 'latest',
): Promise<CacheEntry[]> {
  try {
    const script = getChatGPTReadCacheScript(urlSubstring, mode);
    const result = await wc.executeJavaScript(script) as CacheReadResult;
    if (!result.success) return [];
    return result.matches || [];
  } catch {
    return [];
  }
}

/**
 * 提取时在页面上下文**实时**拉取当前对话树 JSON(stale-cache 修复,见 hook 脚本注释)。
 * 成功返回 body 字符串;失败(网络/鉴权/离线)返回 null,caller 回退 hook 陈旧缓存。
 */
async function fetchConversationLive(
  wc: WebContents,
  conversationId: string,
): Promise<string | null> {
  try {
    const script = getChatGPTFetchConversationScript(conversationId);
    const result = (await wc.executeJavaScript(script)) as {
      ok: boolean;
      body?: string;
      status?: number;
      error?: string;
      hadToken?: boolean;
    };
    if (result?.ok && typeof result.body === 'string' && result.body.length > 0) {
      return result.body;
    }
    console.warn(
      `[chatgpt-extract] 实时拉对话树失败(status=${result?.status ?? '?'} hadToken=${result?.hadToken ?? '?'} err=${result?.error ?? ''}),回退 hook 缓存`,
    );
    return null;
  } catch (err) {
    console.warn('[chatgpt-extract] 实时拉对话树异常,回退 hook 缓存:', err);
    return null;
  }
}

// ─── 消息序列化 ─────────────────────────────────────────────────────

// ─── 结构化加载(整页 + 单条共享)────────────────────────────────────

/** ChatGPT 对话结构化数据(供整页拼接 + 单条提取共用)*/
export interface ChatGPTConversationData {
  title: string;
  /** 按 mapping tree 顺序的 user/assistant 消息(已过滤 hidden);含可匹配的 text */
  messages: NormalizedMessage[];
  /** fileId → 已下载的 dataUrl(图片/文件)*/
  fileMap: Map<string, { dataUrl: string; mimeType: string }>;
  /** Canvas 文档(整页附录用;单条提取不带)*/
  textdocs: Array<{ id: string; title: string; content: string }>;
}

/**
 * 从注入 hook cache 读取并结构化 ChatGPT 对话(整页 / 单条提取共享主体)。
 * 返 null 表示当前页非 ChatGPT 对话页或 cache 未就绪(带 error 文案在外层兜)。
 */
export async function loadChatGPTConversation(
  wc: WebContents,
): Promise<{ data?: ChatGPTConversationData; error?: string }> {
  const url = wc.getURL() || '';
  const conversationId = extractConversationId(url);
  if (!conversationId) {
    return { error: 'Not on a ChatGPT conversation page (no /c/{uuid} in URL)' };
  }

  // 1. 取对话树 JSON —— **优先实时拉**(stale-cache 修复:hook 缓存冻结在进页面那一刻,
  //    继续聊天走 SSE 不更新整树 → 旧数据。实时 fetch 拿当前最新全量)。
  //    实时失败(网络/鉴权/离线)才回退 hook 缓存(至少给个旧结果,不硬失败)。
  let convBody = await fetchConversationLive(wc, conversationId);
  if (!convBody) {
    // 回退:读 hook cache(必须排除 /textdocs / /stream_status 后缀)
    const convMatches = await readCache(wc, `/backend-api/conversation/${conversationId}`, 'all');
    const bareConvMatches = convMatches.filter((m) => {
      const tail = m.url.split(conversationId)[1] || '';
      return tail === '' || tail.startsWith('?');
    });
    convBody = bareConvMatches[bareConvMatches.length - 1]?.body ?? null;
  }
  if (!convBody) {
    return {
      error: `对话数据未捕获:请重新加载页面让 hook 截 /backend-api/conversation/${conversationId}`,
    };
  }

  let conv: { title?: string; mapping?: Record<string, { parent?: string | null; children?: string[]; message?: unknown }> };
  try {
    conv = JSON.parse(convBody);
  } catch (err) {
    return { error: `解析对话 JSON 失败: ${String(err)}` };
  }

  const title = conv.title || '未命名对话';
  const ordered = walkMapping(conv.mapping || {});
  const messages = ordered
    .map((m) => normalizeMessage(m as Parameters<typeof normalizeMessage>[0]))
    .filter((m) => !m.hidden || m.fileRefs.length > 0);

  // 2. 读 textdocs(Canvas)— 可选,缺则跳过
  const textdocs: Array<{ id: string; title: string; content: string }> = [];
  const tdMatches = await readCache(wc, `/backend-api/conversation/${conversationId}/textdocs`, 'latest');
  if (tdMatches[0]?.body) {
    try {
      const arr = JSON.parse(tdMatches[0].body);
      if (Array.isArray(arr)) {
        for (const d of arr) {
          textdocs.push({
            id: d.id || '',
            title: d.title || '',
            content: d.content || '',
          });
        }
      }
    } catch { /* ignore */ }
  }

  // 3. 收集 fileRefs → 读 estuary cache → base64 dataUrl
  const referenced = new Set<string>();
  for (const m of messages) for (const id of m.fileRefs) referenced.add(id);

  const fileMap = new Map<string, { dataUrl: string; mimeType: string }>();
  if (referenced.size > 0) {
    const estuaryMatches = await readCache(wc, '/backend-api/estuary/content', 'all');
    for (const r of estuaryMatches) {
      const id = fileIdFromEstuaryUrl(r.url);
      if (!id || !referenced.has(id) || !r.body) continue;
      const mime = sniffMimeFromBase64(r.body) || r.mimeType || 'application/octet-stream';
      fileMap.set(id, { dataUrl: `data:${mime};base64,${r.body}`, mimeType: mime });
    }
  }

  return { data: { title, messages, fileMap, textdocs } };
}

/**
 * 单条 user/assistant 消息 → markdown body(嵌入 fileRefs 图/文件)。
 * 返 { body, artifactCount };body 为空串表示该消息无可见内容。
 */
export function buildChatGPTMessageBody(
  msg: NormalizedMessage,
  fileMap: Map<string, { dataUrl: string; mimeType: string }>,
): { body: string; artifactCount: number } {
  let body = msg.text;
  let artifactCount = 0;

  // ① image_group:在文本里的 {{IMAGE_GROUP_N}} 占位符处插入第 N 组图(保留原位置)
  for (let n = 0; n < msg.imageGroups.length; n++) {
    const urls = msg.imageGroups[n];
    const imgs = urls.map((u) => `![](${u})`).join('\n\n');
    artifactCount += urls.length;
    body = body.split(`{{IMAGE_GROUP_${n}}}`).join(imgs);
  }
  // 清理:占位符多于实际组(数据缺失)→ 删掉残留占位符,不留 {{IMAGE_GROUP_N}} 到 Note
  body = body.replace(/\{\{IMAGE_GROUP_\d+\}\}/g, '');

  // ② fileRefs(上传图 / DALL-E / Code Interpreter)→ estuary 下载的 dataUrl,追加末尾
  const imgMarkdowns: string[] = [];
  for (const fileId of msg.fileRefs) {
    const file = fileMap.get(fileId);
    if (file && file.mimeType.startsWith('image/')) {
      imgMarkdowns.push(`![${fileId}](${file.dataUrl})`);
      artifactCount++;
    } else if (file) {
      imgMarkdowns.push(`[📎 ${fileId} (${file.mimeType})]`);
      artifactCount++;
    }
  }
  if (imgMarkdowns.length > 0) {
    const tail = imgMarkdowns.join('\n\n');
    body = body.trim() ? `${body.trimEnd()}\n\n${tail}` : tail;
  }

  // 折叠占位符插入可能留下的多余空行
  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return { body, artifactCount };
}

/** 是否计入「可见对话轮次」的消息(过滤工具调用)*/
export function isChatGPTVisibleMessage(msg: NormalizedMessage): boolean {
  if (msg.role !== 'user' && msg.role !== 'assistant') return false;
  if (msg.recipient && msg.recipient !== 'all') return false; // 跳过 python/dalle.text2im 等工具调用
  return true;
}

export type { NormalizedMessage as ChatGPTNormalizedMessage };

// ─── 入口 ───────────────────────────────────────────────────────────

export async function extractChatGPTFullConversation(
  wc: WebContents,
): Promise<ChatGPTFullExtractionResult> {
  const loaded = await loadChatGPTConversation(wc);
  if (!loaded.data) {
    return { success: false, error: loaded.error || '加载对话失败' };
  }
  const { title, messages, fileMap, textdocs } = loaded.data;

  // 4. 按 turn 拼接 markdown
  const turnBlocks: string[] = [];
  let artifactCount = 0;
  for (const msg of messages) {
    if (!isChatGPTVisibleMessage(msg)) continue;

    const header = msg.role === 'user' ? '## 👤 用户' : '## 🤖 AI (ChatGPT)';
    const built = buildChatGPTMessageBody(msg, fileMap);
    artifactCount += built.artifactCount;

    if (built.body) {
      turnBlocks.push(`${header}\n\n${built.body}`);
    }
  }

  // 5. Canvas 文档作为附录
  if (textdocs.length > 0) {
    turnBlocks.push('---\n\n## 📋 Canvas 文档');
    for (const td of textdocs) {
      artifactCount++;
      turnBlocks.push(`### ${td.title || td.id}\n\n${td.content}`);
    }
  }

  const header = `# ${title}\n\n> 共 ${messages.length} 条消息`;
  const markdown = `${header}\n\n${turnBlocks.join('\n\n---\n\n')}`;

  return {
    success: true,
    markdown,
    title,
    turnCount: messages.length,
    artifactCount,
  };
}
