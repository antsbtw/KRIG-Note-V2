/**
 * Claude Conversation API Extractor
 *
 * 绕过 SSE 和 DOM，直接调用 Claude 的 conversation API 获取完整对话数据。
 * 这是 Claude 服务器返回的权威数据源，包含所有消息的原始 Markdown。
 *
 * API endpoints (发现于 CDP 抓包)：
 *   GET /api/organizations/{org_id}/chat_conversations/{conv_id}
 *     返回：{ uuid, chat_messages: [{ uuid, content: [{ type, text, ... }], sender, ... }], ... }
 *
 *   GET /api/organizations/{org_id}/artifacts/{conv_id}/
 *     返回：{ artifact_versions: [...] }
 *
 * 优势：
 * - 原始 Markdown，格式 100% 准确（SSE text_delta 相同的来源）
 * - 包含所有消息（不只是最后一条）
 * - 包含所有 Artifact 元数据（SVG、代码、图表）
 * - 任何时候可调用（不需要等 SSE 流或渲染 DOM）
 *
 * Design doc: docs/web/WebBridge-设计.md §五 读取能力
 */

export interface ClaudeMessage {
  uuid: string;
  sender: 'human' | 'assistant';
  index: number;
  text: string;  // Raw Markdown
  created_at: string;
  attachments?: any[];
  files?: any[];
}

export interface ClaudeConversation {
  uuid: string;
  name: string;
  model: string;
  messages: ClaudeMessage[];
  raw?: any; // Original API response
}

export interface ClaudeArtifactVersion {
  id?: string;
  type?: string;
  title?: string;
  content?: string;
  language?: string;
  raw?: any;
}

/**
 * Extract conversation_id from Claude page URL.
 * URL format: https://claude.ai/chat/{conversation_id}
 */
export function extractConversationId(url: string): string | null {
  const match = url.match(/\/chat\/([a-f0-9-]{36})/);
  return match ? match[1] : null;
}

/**
 * Extract full conversation data by calling Claude's internal API.
 * Runs in the guest webview context (has auth cookies).
 *
 * V2 改造:webview tag → 前台 WebContents(ai-webview-registry 拿到的活跃 wc),
 * .executeJavaScript() 跑在 guest 页 world,有 user 登录 cookies。
 *
 * @param webContents - 前台 AI Host webview 的 WebContents(getActiveAIWebContents 拿)
 * @returns Parsed conversation or null if extraction fails
 */
export async function extractClaudeConversation(
  webContents: Electron.WebContents,
): Promise<ClaudeConversation | null> {
  const url = webContents.getURL() || '';
  const convId = extractConversationId(url);
  if (!convId) {
    console.warn('[ClaudeAPI] Not on a Claude chat page:', url);
    return null;
  }

  try {
    // Execute fetch inside guest page — has login cookies
    const script = `(async function() {
      var convId = ${JSON.stringify(convId)};

      // Step 1: Get organization ID from bootstrap API
      var orgsResp = await fetch('/api/organizations/', { credentials: 'include' });
      if (!orgsResp.ok) return { error: 'Failed to get organizations: ' + orgsResp.status };
      var orgs = await orgsResp.json();
      if (!Array.isArray(orgs) || orgs.length === 0) return { error: 'No organizations found' };
      var orgId = orgs[0].uuid;

      // Step 2: Fetch conversation
      var convResp = await fetch('/api/organizations/' + orgId + '/chat_conversations/' + convId, {
        credentials: 'include',
      });
      if (!convResp.ok) return { error: 'Failed to get conversation: ' + convResp.status };
      var conv = await convResp.json();

      // Note: Artifact endpoint consistently returns 404.
      // Artifact content is NOT available via server API — it must be
      // extracted via the "Copy to clipboard" button in the page UI.
      return { conv: conv, orgId: orgId };
    })()`;

    const result = await webContents.executeJavaScript(script);

    if (!result || result.error) {
      console.warn('[ClaudeAPI] Extraction failed:', result?.error);
      return null;
    }

    const raw = result.conv;
    // Claude's chat_messages use the top-level `text` field as the authoritative source.
    // The `content` array exists but is always empty in observed responses.
    const messages: ClaudeMessage[] = (raw.chat_messages || []).map((m: any) => ({
      uuid: m.uuid,
      sender: m.sender,
      index: m.index,
      text: m.text || '',
      created_at: m.created_at,
      attachments: m.attachments,
      files: m.files,
    }));

    console.log(`[ClaudeAPI] Extracted ${messages.length} messages from conversation ${convId}`);

    return {
      uuid: raw.uuid,
      name: raw.name || '',
      model: raw.model || '',
      messages,
      raw: { conversation: raw },
    };
  } catch (err) {
    console.error('[ClaudeAPI] Exception:', err);
    return null;
  }
}

/**
 * Extract only the last assistant message (latest response).
 * Convenience wrapper for sync use case.
 */
export async function extractLatestClaudeResponse(
  webContents: Electron.WebContents,
): Promise<{ userMessage: string; assistantMessage: string; raw: ClaudeConversation | null } | null> {
  const conv = await extractClaudeConversation(webContents);
  if (!conv || conv.messages.length === 0) return null;

  // Find last assistant message + its preceding human message
  let lastAssistantIdx = -1;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].sender === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) return null;

  let userMessage = '';
  for (let i = lastAssistantIdx - 1; i >= 0; i--) {
    if (conv.messages[i].sender === 'human') {
      userMessage = conv.messages[i].text;
      break;
    }
  }

  return {
    userMessage,
    assistantMessage: conv.messages[lastAssistantIdx].text,
    raw: conv,
  };
}

/**
 * Check if current URL is a Claude conversation page.
 */
export function isClaudeConversationPage(url: string): boolean {
  return /^https:\/\/claude\.ai\/chat\/[a-f0-9-]+/.test(url);
}

/** Placeholder string Claude inserts for Artifact content when rendered for non-official clients. */
export const CLAUDE_ARTIFACT_PLACEHOLDER = 'This block is not supported on your current device yet.';
const ESCAPED_CLAUDE_ARTIFACT_PLACEHOLDER = CLAUDE_ARTIFACT_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ARTIFACT_PLACEHOLDER_BLOCK_PATTERN = '```[ \\t]*\\n' + ESCAPED_CLAUDE_ARTIFACT_PLACEHOLDER + '\\n```';

export function collapseAdjacentArtifactPlaceholders(text: string): string {
  if (!text) return text;
  const normalized = text.replace(/\r\n/g, '\n');
  const duplicatePattern = new RegExp(
    '(' + ARTIFACT_PLACEHOLDER_BLOCK_PATTERN + ')(?:\\n[ \\t]*' + ARTIFACT_PLACEHOLDER_BLOCK_PATTERN + ')+',
    'g',
  );
  return normalized.replace(duplicatePattern, '$1');
}

/**
 * Count how many artifact placeholders appear in a message text.
 * Each `\`\`\`\nThis block is not supported...\n\`\`\`` corresponds to one Artifact.
 */
export function countArtifactPlaceholders(text: string): number {
  if (!text) return 0;
  const normalized = collapseAdjacentArtifactPlaceholders(text);
  const placeholderPattern = '(^|\\n)' + ARTIFACT_PLACEHOLDER_BLOCK_PATTERN + '(?=\\n|$)';
  const matches = normalized.match(new RegExp(placeholderPattern, 'g'));
  return matches?.length ?? 0;
}

/**
 * Claude conversation API sometimes prepends a stray artifact placeholder
 * before the actual assistant prose in long/mixed-content replies. That
 * leading placeholder has no stable mapping to the visible turn content,
 * and if we keep it, fallback replacement produces a bogus callout at the
 * very top of the imported note.
 */
export function trimLeadingArtifactPlaceholder(text: string): string {
  if (!text) return text;
  const match = text.match(new RegExp('^\\s*```[ \\t]*\\n' + ESCAPED_CLAUDE_ARTIFACT_PLACEHOLDER + '\\n```(?:\\n\\s*)*'));
  if (!match) return text;
  const rest = text.slice(match[0].length);
  if (!rest.trim()) return text;
  return rest;
}


/**
 * Fetch Claude's artifact versions endpoint for a conversation.
 *
 * Observed URL: `/api/organizations/{org}/artifacts/{conv}/versions?source=w`
 * Response shape: `{ artifact_versions: [{ id?, type?, title?, content?, ... }, ...] }`
 *
 * The array is empty during/right after streaming — the caller should poll
 * until it's populated (or give up after a timeout).
 */
export async function fetchClaudeArtifactVersions(
  webContents: Electron.WebContents,
): Promise<any[] | null> {
  const url = webContents.getURL() || '';
  const convId = extractConversationId(url);
  if (!convId) return null;

  try {
    const script = `(async function() {
      var orgsResp = await fetch('/api/organizations/', { credentials: 'include' });
      if (!orgsResp.ok) return { error: 'orgs ' + orgsResp.status };
      var orgs = await orgsResp.json();
      if (!Array.isArray(orgs) || orgs.length === 0) return { error: 'no orgs' };
      var orgId = orgs[0].uuid;
      var convId = ${JSON.stringify(convId)};

      // Try both URL shapes — Claude has used both over time.
      var urls = [
        '/api/organizations/' + orgId + '/artifacts/' + convId + '/versions?source=w',
        '/api/organizations/' + orgId + '/artifacts/' + convId + '/versions',
        '/api/organizations/' + orgId + '/artifacts/' + convId,
      ];
      for (var i = 0; i < urls.length; i++) {
        try {
          var r = await fetch(urls[i], { credentials: 'include' });
          if (!r.ok) continue;
          var j = await r.json();
          var vers = j && (j.artifact_versions || j.versions || j);
          if (Array.isArray(vers) && vers.length > 0) return { versions: vers, url: urls[i] };
          if (Array.isArray(vers)) return { versions: [], url: urls[i] }; // empty but valid
        } catch (e) {}
      }
      return { versions: [], url: null };
    })()`;
    const result = await webContents.executeJavaScript(script);
    if (!result || result.error) return null;
    return Array.isArray(result.versions) ? result.versions : null;
  } catch {
    return null;
  }
}

/**
 * Extract the source text from a Claude artifact version object. The shape
 * varies (code artifact vs. HTML vs. React), but typically there's a
 * `content`, `source`, or `code` string somewhere.
 */
export function extractArtifactVersionSource(version: any): string | null {
  if (!version || typeof version !== 'object') return null;
  const candidates = [
    version.content,
    version.source,
    version.code,
    version.html,
    version.body,
    version.markup,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  // Nested under `artifact` or `data`
  if (version.artifact) {
    const nested = extractArtifactVersionSource(version.artifact);
    if (nested) return nested;
  }
  if (version.data) {
    const nested = extractArtifactVersionSource(version.data);
    if (nested) return nested;
  }
  return null;
}

/**
 * Raw captured postMessage record from the claude.ai → artifact iframe
 * data stream. Shape is whatever Anthropic's code posts; we only look at
 * fields we can recognize.
 */
export interface CapturedArtifactMessage {
  ts: number;
  channel?: 'window' | 'port';
  direction: 'in' | 'out';
  targetOrigin: string | null;
  sourceOrigin: string | null;
  data: any;
}

/**
 * Read all artifact-related postMessage payloads captured by the
 * artifact-postmessage-hook injected into the claude.ai page.
 *
 * Returns an empty array if the hook isn't installed or nothing was
 * captured yet.
 */
export async function readCapturedArtifactMessages(
  webContents: Electron.WebContents,
): Promise<CapturedArtifactMessage[]> {
  try {
    const result = await webContents.executeJavaScript(
      `(function() { return window.__krig_artifact_messages || []; })()`,
    );
    return Array.isArray(result) ? (result as CapturedArtifactMessage[]) : [];
  } catch {
    return [];
  }
}

/**
 * Best-effort extraction of artifact source code from a captured postMessage
 * payload. Claude's internal message shape is undocumented, so we walk the
 * object looking for plausible source-code-bearing string fields.
 *
 * Strategy: depth-first scan for string values under keys commonly used for
 * code (`source`, `code`, `content`, `html`, `artifact`, `files`...). We
 * prefer the longest plausible string in the payload as the artifact body.
 */
export function extractArtifactSourceFromPayload(payload: any): string | null {
  if (payload == null) return null;

  const SOURCE_KEYS = new Set([
    'source', 'sourceCode', 'code', 'content', 'body', 'contents',
    'html', 'svg', 'markup', 'text', 'artifact', 'files', 'file',
    'template', 'script',
  ]);

  // Ignore JSON-RPC notifications we know don't carry source.
  const NOISE_METHODS = new Set([
    'ui/notifications/sandbox-proxy-ready',
    'ui/notifications/initialized',
    'ui/notifications/size-changed',
    'notifications/message',
    'ui/initialize', // request, not response
  ]);
  if (payload && typeof payload === 'object' && typeof payload.method === 'string' && NOISE_METHODS.has(payload.method)) {
    return null;
  }

  let best: string | null = null;

  const consider = (s: string) => {
    if (typeof s !== 'string' || s.length < 40) return;
    if (!best || s.length > best.length) best = s;
  };

  const visit = (node: any, keyHint?: string) => {
    if (node == null) return;
    if (typeof node === 'string') {
      const looksLikeCode = /<\w|<\/|\bfunction\b|\bimport\b|\bconst\b|\breturn\b|\bclass\b|```|\{[\s\S]*\}/.test(node);
      const underKnownKey = keyHint ? SOURCE_KEYS.has(keyHint) : false;
      if (underKnownKey || looksLikeCode) consider(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, keyHint);
      return;
    }
    if (typeof node === 'object') {
      // MCP resources/read shape: { contents: [{ uri, mimeType, text }] }
      if (Array.isArray((node as any).contents)) {
        for (const c of (node as any).contents) {
          if (c && typeof c.text === 'string') consider(c.text);
          if (c && typeof c.blob === 'string') consider(c.blob);
        }
      }
      // Our fetch-hook shape: { url, body }
      if (typeof (node as any).url === 'string' && (node as any).body != null) {
        visit((node as any).body, 'body');
        return;
      }
      for (const k of Object.keys(node)) visit(node[k], k);
    }
  };

  visit(payload);
  return best;
}

/**
 * From a list of captured messages, pick the most recent artifact source
 * strings (deduplicated). Returns an ordered list, newest first.
 */
export function collectArtifactSources(
  messages: CapturedArtifactMessage[],
): string[] {
  const seen = new Set<string>();
  const sources: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const src = extractArtifactSourceFromPayload(messages[i].data);
    if (src && !seen.has(src)) {
      seen.add(src);
      sources.push(src);
    }
  }
  return sources;
}

/**
 * Detect the fenced code-block language hint (e.g. ```tsx, ```html) from
 * an artifact placeholder segment, so we can preserve the info line when
 * substituting real source in.
 */
function extractPlaceholderInfoString(placeholderBlock: string): string {
  const m = placeholderBlock.match(/^```([^\n]*)/);
  return m ? m[1].trim() : '';
}

const ARTIFACT_PLACEHOLDER_REGEX = new RegExp(
  '(^|\\n)' + ARTIFACT_PLACEHOLDER_BLOCK_PATTERN + '(?=\\n|$)',
  'g',
);

type ArtifactSegment =
  | { type: 'text'; text: string }
  | { type: 'placeholder'; block: string; info: string; index: number };

function splitByArtifactPlaceholders(messageText: string): ArtifactSegment[] {
  const segments: ArtifactSegment[] = [];
  if (!messageText) return [{ type: 'text', text: '' }];
  const normalizedText = collapseAdjacentArtifactPlaceholders(messageText);

  let lastIndex = 0;
  let placeholderIndex = 0;
  normalizedText.replace(ARTIFACT_PLACEHOLDER_REGEX, (block, prefix, offset: number) => {
    const actualBlock = String(block).startsWith('\n') ? String(block).slice(1) : String(block);
    const actualOffset = String(block).startsWith('\n') ? offset + 1 : offset;
    if (offset > lastIndex) {
      segments.push({ type: 'text', text: normalizedText.slice(lastIndex, actualOffset) });
    }
    segments.push({
      type: 'placeholder',
      block: actualBlock,
      info: extractPlaceholderInfoString(actualBlock),
      index: placeholderIndex++,
    });
    lastIndex = actualOffset + actualBlock.length;
    return String(block);
  });

  if (lastIndex < normalizedText.length) {
    segments.push({ type: 'text', text: normalizedText.slice(lastIndex) });
  }

  if (segments.length === 0) return [{ type: 'text', text: normalizedText }];
  return segments;
}

function rebuildArtifactSegments(
  segments: ArtifactSegment[],
  replacer: (placeholder: Extract<ArtifactSegment, { type: 'placeholder' }>) => string | null,
): { text: string; filled: number; remaining: number } {
  let filled = 0;
  let remaining = 0;
  const out = segments.map((segment) => {
    if (segment.type === 'text') return segment.text;
    const replaced = replacer(segment);
    if (replaced == null) {
      remaining += 1;
      return segment.block;
    }
    filled += 1;
    return replaced;
  }).join('');
  return { text: out, filled, remaining };
}

function collapseDuplicateFallbackCallouts(text: string): string {
  if (!text) return text;
  const normalized = text.replace(/\r\n/g, '\n');
  const calloutPattern =
    '(> \\[!note\\] 📥 此处图片请点击 Claude 页面的拷贝按钮\\n' +
    '(?:> \\[在 Claude 中查看原图\\]\\([^\\n]+\\)))';
  const duplicatePattern = new RegExp(
    calloutPattern + '(?:\\n[ \\t]*){1,3}' + calloutPattern,
    'g',
  );
  let out = normalized;
  while (duplicatePattern.test(out)) {
    duplicatePattern.lastIndex = 0;
    out = out.replace(duplicatePattern, '$1');
  }
  return out;
}

/**
 * Replace Claude Artifact placeholders in `messageText` with captured
 * artifact source code (from postMessage hook). Placeholders are matched in
 * document order and replaced with sources in the order they were captured
 * (newest first — so the Nth placeholder from the end of the message maps
 * to the Nth captured artifact).
 *
 * Returns the (possibly) rewritten text and a count of how many
 * placeholders were successfully filled.
 */
export function fillArtifactPlaceholders(
  messageText: string,
  capturedSources: string[],
): { text: string; filled: number; remaining: number } {
  if (!messageText || capturedSources.length === 0) {
    const remaining = countArtifactPlaceholders(messageText || '');
    return { text: messageText, filled: 0, remaining };
  }

  const segments = splitByArtifactPlaceholders(messageText);
  const placeholders = segments.filter((s): s is Extract<ArtifactSegment, { type: 'placeholder' }> => s.type === 'placeholder');
  // Map i-th placeholder (from end) to i-th captured source (newest first),
  // which matches the user's most-recent-visible-first mental model.
  const placeholdersFromEnd = placeholders.length;
  return rebuildArtifactSegments(segments, (placeholder) => {
    const idxFromEnd = placeholdersFromEnd - 1 - placeholder.index;
    const src = capturedSources[idxFromEnd];
    if (!src) return null;
    const info = placeholder.info || 'html';
    return '```' + info + '\n' + src + '\n```';
  });
}

/**
 * Replace Claude Artifact placeholders with rendered images.
 *
 * Used when the Copy-to-clipboard extractor has produced PNG dataUrls for
 * each artifact card on the page. The i-th placeholder from the top of
 * the message maps to the i-th image in document order (listArtifacts
 * also walks the DOM top-down, so indices line up).
 *
 * Returns both the rewritten text and how many placeholders were filled
 * so the caller can decide whether to further call
 * `replaceArtifactPlaceholders` for any remaining ones.
 */
export function fillArtifactPlaceholdersWithImages(
  messageText: string,
  imageDataUrls: string[],
): { text: string; filled: number; remaining: number } {
  if (!messageText || imageDataUrls.length === 0) {
    const remaining = countArtifactPlaceholders(messageText || '');
    return { text: messageText, filled: 0, remaining };
  }
  const segments = splitByArtifactPlaceholders(messageText);
  return rebuildArtifactSegments(segments, (placeholder) => {
    const url = imageDataUrls[placeholder.index];
    if (!url) return null;
    return `![Claude Artifact](${url})`;
  });
}

/**
 * Replace Claude Artifact placeholders with arbitrary markdown snippets.
 *
 * Used by the manual right-click extraction path once the artifact has
 * been downloaded and converted into a markdown representation such as:
 *   - image markdown for iframe-rendered SVG/PNG
 *   - fenced code block for code cards / file cards
 *   - fenced mermaid/html blocks for diagram / html cards
 */
export function fillArtifactPlaceholdersWithMarkdownPieces(
  messageText: string,
  pieces: string[],
): { text: string; filled: number; remaining: number } {
  if (!messageText || pieces.length === 0) {
    const remaining = countArtifactPlaceholders(messageText || '');
    return { text: messageText, filled: 0, remaining };
  }
  const segments = splitByArtifactPlaceholders(messageText);
  return rebuildArtifactSegments(segments, (placeholder) => {
    const piece = pieces[placeholder.index];
    if (!piece) return null;
    return piece;
  });
}

/**
 * Replace Claude Artifact placeholders with markdown snippets while
 * preserving placeholder order even if only some downloads succeeded.
 *
 * `pieces[i]` maps to placeholder i; null/empty entries leave that
 * placeholder untouched so later fallback can handle it without shifting
 * subsequent artifacts forward.
 */
export function fillArtifactPlaceholdersWithSparseMarkdownPieces(
  messageText: string,
  pieces: Array<string | null | undefined>,
): { text: string; filled: number; remaining: number } {
  if (!messageText || pieces.length === 0) {
    const remaining = countArtifactPlaceholders(messageText || '');
    return { text: messageText, filled: 0, remaining };
  }
  const segments = splitByArtifactPlaceholders(messageText);
  return rebuildArtifactSegments(segments, (placeholder) => {
    const piece = pieces[placeholder.index];
    if (!piece) return null;
    return piece;
  });
}

/**
 * Replace Claude Artifact placeholders with user-friendly callouts.
 *
 * Investigation conclusion (2026-04-13):
 *   - Claude server returns "This block is not supported..." placeholder in
 *     conversation API for any non-official client (regardless of headers/UA)
 *   - Real Artifact content is rendered in cross-origin iframe (claudemcpcontent.com)
 *     that we cannot access (CORS, sandboxed)
 *   - The placeholder string contains NO artifact ID/UUID — there's no way
 *     to look up the real content from API
 *
 * Best we can do: replace the cryptic placeholder with a friendly callout
 * pointing the user back to the Claude page where they can see the Artifact.
 */
export function replaceArtifactPlaceholders(
  messageText: string,
  conversationUrl?: string,
): string {
  const linkText = conversationUrl
    ? `> [在 Claude 中查看原图](${conversationUrl})`
    : '';
  const fallback = `> [!note] 📥 此处图片请点击 Claude 页面的拷贝按钮${linkText ? `\n${linkText}` : ''}`;
  const segments = splitByArtifactPlaceholders(messageText);
  return collapseDuplicateFallbackCallouts(
    rebuildArtifactSegments(segments, () => fallback).text,
  );
}
