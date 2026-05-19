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
import { getChatGPTReadCacheScript } from '../inject-scripts/chatgpt-conversation-hook';

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

function extractConversationId(url: string): string | null {
  const m = url.match(/\/c\/([a-f0-9-]{36})/);
  return m ? m[1] : null;
}

function sniffMimeFromBase64(b64: string | null | undefined): string | null {
  if (!b64 || b64.length < 8) return null;
  const head = b64.slice(0, 16);
  if (head.startsWith('iVBORw')) return 'image/png';
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('R0lGODl')) return 'image/gif';
  if (head.startsWith('UklGR')) return 'image/webp';
  if (head.startsWith('PHN2Zy') || head.startsWith('PD94bWw')) return 'image/svg+xml';
  if (head.startsWith('JVBER')) return 'application/pdf';
  return null;
}

function fileIdFromAssetPointer(ptr: string | undefined | null): string | null {
  if (!ptr || typeof ptr !== 'string') return null;
  const m = ptr.match(/file_[A-Za-z0-9]+/);
  return m ? m[0] : null;
}

function fileIdFromEstuaryUrl(url: string): string | null {
  const m = url.match(/[?&]id=(file_[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

// ─── ChatGPT 私有 widget directive 清理(V1 unwrapWidgets 简化版)─────

function unwrapWidgets(text: string): string {
  if (!text) return text;
  const GENU = 'genu';
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const found = text.indexOf(GENU, i);
    if (found < 0) {
      out.push(text.slice(i));
      break;
    }
    let brace = -1;
    for (let k = found + GENU.length; k < Math.min(found + GENU.length + 4, text.length); k++) {
      if (text[k] === '{') { brace = k; break; }
    }
    if (brace < 0) {
      out.push(text.slice(i, found + GENU.length));
      i = found + GENU.length;
      continue;
    }
    // 平衡 brace 扫
    let depth = 0; let j = brace; let inStr = false; let esc = false;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = false; continue; }
      } else {
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { j++; break; } }
      }
    }
    if (depth !== 0) {
      out.push(text.slice(i));
      break;
    }
    const body = text.slice(brace, j);
    let start = found;
    if (start > 0 && text.charCodeAt(start - 1) >= 0xE000 && text.charCodeAt(start - 1) <= 0xF8FF) start--;
    let end = j;
    if (end < text.length && text.charCodeAt(end) >= 0xE000 && text.charCodeAt(end) <= 0xF8FF) end++;
    out.push(text.slice(i, start));
    let replaced: string | null = null;
    try {
      const obj = JSON.parse(body);
      for (const key of Object.keys(obj)) {
        const payload = obj[key];
        if (payload && typeof payload === 'object') {
          const latex = typeof payload.content === 'string' ? payload.content
            : typeof payload.latex === 'string' ? payload.latex : null;
          if (latex && /math|latex/i.test(key)) {
            replaced = '\n\n$$' + latex.trim() + '$$\n\n';
            break;
          }
        }
      }
    } catch {}
    if (replaced) out.push(replaced);
    else out.push(text.slice(start, end));
    i = end;
  }
  return out.join('');
}

// ─── Conversation tree walk ──────────────────────────────────────────

function walkMapping(mapping: Record<string, { parent?: string | null; children?: string[]; message?: unknown }>): unknown[] {
  let rootId: string | null = null;
  for (const k of Object.keys(mapping)) {
    if (!mapping[k].parent) { rootId = k; break; }
  }
  const ordered: unknown[] = [];
  let cur: string | null = rootId;
  while (cur && mapping[cur]) {
    const node = mapping[cur];
    if (node.message) ordered.push(node.message);
    const children = node.children || [];
    cur = children.length ? children[children.length - 1] : null;
  }
  return ordered;
}

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

// ─── 消息序列化 ─────────────────────────────────────────────────────

interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  fileRefs: string[];
  recipient: string | null;
  hidden: boolean;
}

function normalizeMessage(raw: {
  id?: string;
  author?: { role?: string };
  recipient?: string;
  content?: { parts?: unknown[] };
  metadata?: {
    attachments?: Array<{ id?: string }>;
    aggregate_result?: { messages?: Array<{ image_url?: string }> };
    is_visually_hidden_from_conversation?: boolean;
  };
}): NormalizedMessage {
  const author = raw.author?.role || 'system';
  const recipient = raw.recipient ?? null;
  const parts = raw.content?.parts || [];

  const textParts: string[] = [];
  const fileRefs: string[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      if (p.length > 0) textParts.push(p);
    } else if (p && typeof p === 'object') {
      const obj = p as { asset_pointer?: string };
      if (obj.asset_pointer) {
        const id = fileIdFromAssetPointer(obj.asset_pointer);
        if (id) fileRefs.push(id);
      }
    }
  }

  const attachments = raw.metadata?.attachments;
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (a?.id && /^file_/.test(a.id)) fileRefs.push(a.id);
    }
  }
  const agg = raw.metadata?.aggregate_result;
  if (agg?.messages && Array.isArray(agg.messages)) {
    for (const m of agg.messages) {
      if (typeof m?.image_url === 'string') {
        const id = fileIdFromAssetPointer(m.image_url);
        if (id) fileRefs.push(id);
      }
    }
  }

  const text = unwrapWidgets(textParts.join('\n\n'));
  const role: NormalizedMessage['role'] = (author === 'user' || author === 'assistant' || author === 'tool' || author === 'system') ? author : 'system';
  return {
    id: raw.id || '',
    role,
    text,
    fileRefs: Array.from(new Set(fileRefs)),
    recipient,
    hidden: !!raw.metadata?.is_visually_hidden_from_conversation,
  };
}

// ─── 入口 ───────────────────────────────────────────────────────────

export async function extractChatGPTFullConversation(
  wc: WebContents,
): Promise<ChatGPTFullExtractionResult> {
  const url = wc.getURL() || '';
  const conversationId = extractConversationId(url);
  if (!conversationId) {
    return {
      success: false,
      error: 'Not on a ChatGPT conversation page (no /c/{uuid} in URL)',
    };
  }

  // 1. 读对话 cache(必须排除 /textdocs / /stream_status 后缀)
  const convMatches = await readCache(wc, `/backend-api/conversation/${conversationId}`, 'all');
  const bareConvMatches = convMatches.filter((m) => {
    const tail = m.url.split(conversationId)[1] || '';
    return tail === '' || tail.startsWith('?');
  });
  const convEntry = bareConvMatches[bareConvMatches.length - 1];
  if (!convEntry?.body) {
    return {
      success: false,
      error: `对话数据未捕获:请重新加载页面让 hook 截 /backend-api/conversation/${conversationId}`,
    };
  }

  let conv: { title?: string; mapping?: Record<string, { parent?: string | null; children?: string[]; message?: unknown }> };
  try {
    conv = JSON.parse(convEntry.body);
  } catch (err) {
    return { success: false, error: `解析对话 JSON 失败: ${String(err)}` };
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

  // 4. 按 turn 拼接 markdown
  const turnBlocks: string[] = [];
  let artifactCount = 0;
  for (const msg of messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    if (msg.recipient && msg.recipient !== 'all') continue; // 跳过 python/dalle.text2im 等工具调用

    const header = msg.role === 'user' ? '## 👤 用户' : '## 🤖 AI (ChatGPT)';
    let body = msg.text;

    // 嵌入文件引用为 ![image]() / [文件 fallback]
    if (msg.fileRefs.length > 0) {
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
        body = body ? `${body}\n\n${imgMarkdowns.join('\n\n')}` : imgMarkdowns.join('\n\n');
      }
    }

    if (body) {
      turnBlocks.push(`${header}\n\n${body}`);
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
