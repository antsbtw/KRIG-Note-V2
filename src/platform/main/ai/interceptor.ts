/**
 * SSE Capture Manager
 *
 * Main-process orchestrator that captures AI response data.
 * Adapted from mirro-desktop's ai-bridge/sse-capture/sse-capture-manager.ts (verified).
 *
 * Strategy:
 * - ChatGPT: Inject fetch hook → detect /textdocs → call conversation API for full Markdown
 * - Claude: Inject fetch hook → intercept incremental text_delta SSE
 * - Gemini: CDP from main process → intercept StreamGenerate XHR
 *
 * V1 源:src/plugins/web-bridge/capabilities/interceptor.ts(字面搬,改 import alias)
 */

import { detectAIServiceByUrl } from '@shared/types/ai-service-types';
import { getSSECaptureScript } from './inject-scripts/sse-capture';
import { getArtifactPostMessageHookScript } from './inject-scripts/artifact-postmessage-hook';
import { getChatGPTConversationHookScript } from './inject-scripts/chatgpt-conversation-hook';

export interface SSEResponseRecord {
  id: string;
  timestamp: number;
  service: string;
  markdown: string;
  streaming: boolean;
  url: string;
}

export class SSECaptureManager {
  private started = false;
  private geminiDebuggerAttached = false;
  private geminiResponses: SSEResponseRecord[] = [];
  private readonly MAX_RESPONSES = 20;

  constructor(
    private webContents: Electron.WebContents,
  ) {}

  /** 取内部 webContents — askAI orchestrator 用于复用判断 */
  getWebContents(): Electron.WebContents {
    return this.webContents;
  }

  /**
   * Start capturing: inject hook now and re-inject on navigation.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.inject();

    // Inject early (dom-ready) so our fetch hook is in place before
    // the AI site's JS caches window.fetch in a closure.
    this.webContents.on('dom-ready', () => {
      this.inject();
      this.startGeminiCDP();
    });

    // Re-inject on SPA navigation (AI sites are SPAs).
    this.webContents.on('did-navigate-in-page', () => this.inject());
  }

  /**
   * Stop capturing and cleanup.
   */
  stop(): void {
    this.started = false;
    if (this.geminiDebuggerAttached) {
      try {
        this.webContents.debugger.detach();
      } catch { /* already detached */ }
      this.geminiDebuggerAttached = false;
    }
  }

  /**
   * 取所有 Gemini StreamGenerate 响应记录(Phase 10.B.3 用于多 turn 提取)。
   * 按时间从老到新顺序;每条 record 是一次 turn 的 AI 回复(Gemini 一次问答 = 一次 batchexecute)。
   */
  getAllGeminiResponses(): readonly SSEResponseRecord[] {
    return this.geminiResponses;
  }

  /**
   * Get the latest completed (non-streaming) response as markdown.
   */
  async getLatestResponse(): Promise<string | null> {
    // Check Gemini main-process cache first
    if (this.geminiResponses.length > 0) {
      const latest = this.geminiResponses[this.geminiResponses.length - 1];
      if (!latest.streaming && latest.markdown.length > 0) {
        return latest.markdown;
      }
    }

    // Check page-level cache (ChatGPT/Claude)
    try {
      return await this.webContents.executeJavaScript(`
        (function() {
          var responses = window.__krig_sse_responses || [];
          for (var i = responses.length - 1; i >= 0; i--) {
            if (!responses[i].streaming && responses[i].markdown.length > 0) {
              return responses[i].markdown;
            }
          }
          return null;
        })()
      `);
    } catch {
      return null;
    }
  }

  /**
   * Get capture status.
   */
  async getStatus(): Promise<{ count: number; latestStreaming: boolean; hooked: boolean }> {
    try {
      return await this.webContents.executeJavaScript(`
        (function() {
          var responses = window.__krig_sse_responses || [];
          var latest = responses.length > 0 ? responses[responses.length - 1] : null;
          return {
            count: responses.length,
            latestStreaming: latest ? latest.streaming : false,
            hooked: !!window.__krig_sse_hooked,
          };
        })()
      `);
    } catch {
      return { count: 0, latestStreaming: false, hooked: false };
    }
  }

  /**
   * Clear all cached responses.
   */
  async clearResponses(): Promise<void> {
    this.geminiResponses = [];
    try {
      await this.webContents.executeJavaScript(
        'window.__krig_sse_responses = [];',
      );
    } catch { /* page may not be loaded */ }
  }

  /**
   * Poll until the latest response is complete (non-streaming).
   * @param timeoutMs Maximum wait time (default: 60s)
   * @param pollIntervalMs Poll interval (default: 500ms)
   */
  async waitForResponse(timeoutMs = 60_000, pollIntervalMs = 500): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.getStatus();
      // Check Gemini cache
      if (this.geminiResponses.length > 0) {
        const latest = this.geminiResponses[this.geminiResponses.length - 1];
        if (!latest.streaming && latest.markdown.length > 0) {
          return latest.markdown;
        }
      }
      // Check page cache: if we have responses and the latest is not streaming
      if (status.count > 0 && !status.latestStreaming) {
        return this.getLatestResponse();
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    return null;
  }

  // ── Internal ──

  private inject(): void {
    const url = this.webContents.getURL();
    const profile = detectAIServiceByUrl(url);
    if (!profile) return;

    // Gemini is handled via CDP, not page-level hooks
    if (profile.id !== 'gemini') {
      const script = getSSECaptureScript(profile.id, profile.intercept.endpointPattern);
      this.webContents.executeJavaScript(script).then((result) => {
        if (result === 'hooked') {
          console.log(`[SSECapture] Fetch hook installed for ${profile.id}`);
        }
      }).catch(() => {
        // Page may not be ready — will retry on next lifecycle event
      });
    }

    // Claude artifact postMessage hook(独立于 SSE,跑在 Claude 页拦截 artifact iframe
    // 跟 parent 的 postMessage / fetch,把源码缓存到 window.__krig_artifact_messages,
    // claude-full-extraction 提取时读)
    if (profile.id === 'claude') {
      const artifactScript = getArtifactPostMessageHookScript();
      this.webContents.executeJavaScript(artifactScript).then((result) => {
        if (result === 'hooked') {
          console.log('[SSECapture] Artifact postMessage hook installed for Claude');
        }
      }).catch(() => {
        // Page may not be ready — retry on next lifecycle event
      });
    }

    // ChatGPT conversation cache hook(Phase 10.B.2):截 /backend-api/conversation,
    // /textdocs, /estuary/content 响应,缓存到 window.__krig_chatgpt_cache,
    // chatgpt-full-extraction 提取时读
    if (profile.id === 'chatgpt') {
      const cgptScript = getChatGPTConversationHookScript();
      this.webContents.executeJavaScript(cgptScript).then((result) => {
        if (result === 'hooked') {
          console.log('[SSECapture] ChatGPT conversation hook installed');
        }
      }).catch(() => {
        // Page may not be ready — retry on next lifecycle event
      });
    }
  }

  /**
   * Start CDP-based network interception for Gemini.
   * Uses Chrome DevTools Protocol to capture StreamGenerate XHR responses.
   */
  private startGeminiCDP(): void {
    const url = this.webContents.getURL();
    const profile = detectAIServiceByUrl(url);
    if (!profile || profile.id !== 'gemini') return;
    if (this.geminiDebuggerAttached) return;

    try {
      this.webContents.debugger.attach('1.3');
      this.geminiDebuggerAttached = true;
      console.log('[SSECapture] CDP debugger attached for Gemini');
    } catch (err) {
      console.warn('[SSECapture] Failed to attach CDP debugger:', err);
      return;
    }

    this.webContents.debugger.sendCommand('Network.enable').catch(() => {});

    const pendingRequests = new Map<string, string>();

    this.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        const reqUrl = params.request?.url || '';
        if (reqUrl.indexOf('StreamGenerate') !== -1) {
          pendingRequests.set(params.requestId, reqUrl);
        }
      }

      if (method === 'Network.loadingFinished') {
        const reqUrl = pendingRequests.get(params.requestId);
        if (!reqUrl) return;
        pendingRequests.delete(params.requestId);

        this.webContents.debugger.sendCommand('Network.getResponseBody', {
          requestId: params.requestId,
        }).then((result) => {
          if (result && result.body) {
            const markdown = this.parseGeminiResponse(result.body);
            if (markdown) {
              const record: SSEResponseRecord = {
                id: 'gemini-' + Date.now(),
                timestamp: Date.now(),
                service: 'gemini',
                markdown,
                streaming: false,
                url: reqUrl,
              };
              this.geminiResponses.push(record);
              while (this.geminiResponses.length > this.MAX_RESPONSES) {
                this.geminiResponses.shift();
              }
              console.log('[SSECapture] Gemini captured via CDP, length:', markdown.length);
            }
          }
        }).catch(() => {});
      }
    });

    this.webContents.debugger.on('detach', () => {
      this.geminiDebuggerAttached = false;
    });
  }

  /**
   * Parse Gemini StreamGenerate response body.
   * Format: length-prefixed JSON chunks. Each chunk:
   *   [["wrb.fr", null, "<inner JSON string>"]]
   * Inner JSON: inner[4] = candidates, candidate[1][0] = cumulative markdown.
   * (Paths from github.com/HanaokaYuzu/Gemini-API)
   */
  private parseGeminiResponse(responseText: string): string | null {
    if (!responseText) return null;

    let text = responseText;
    if (text.startsWith(")]}'")) {
      const nlIdx = text.indexOf('\n');
      if (nlIdx !== -1) text = text.substring(nlIdx + 1);
    }

    let lastMarkdown: string | null = null;
    let lastImageUrls: string[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || /^\d+$/.test(trimmed)) continue;

      try {
        const outer = JSON.parse(trimmed);
        const innerStr = outer?.[0]?.[2];
        if (typeof innerStr !== 'string') continue;

        const inner = JSON.parse(innerStr);
        const candidates = inner?.[4];
        if (!Array.isArray(candidates)) continue;

        const candidate = candidates[0];
        if (!candidate) continue;

        if (candidate?.[1]?.[0] && typeof candidate[1][0] === 'string') {
          lastMarkdown = candidate[1][0];
        }

        const chunkImages: string[] = [];

        // Web images: candidate[12][1][]
        const webImgList = candidate?.[12]?.[1];
        if (Array.isArray(webImgList)) {
          for (const webImg of webImgList) {
            const imgUrl = webImg?.[0]?.[0]?.[0];
            if (typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
              chunkImages.push(imgUrl);
            }
          }
        }

        // Generated images (ImageFX): candidate[12][7][0][]
        const genImgList = candidate?.[12]?.[7]?.[0];
        if (Array.isArray(genImgList)) {
          for (const genImg of genImgList) {
            const imgUrl = genImg?.[0]?.[3]?.[3];
            if (typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
              chunkImages.push(imgUrl);
            }
          }
        }

        if (chunkImages.length > 0) {
          lastImageUrls = chunkImages;
        }
      } catch {
        // Not valid JSON, skip
      }
    }

    if (lastMarkdown && lastImageUrls.length > 0) {
      const imgMarkdown = lastImageUrls.map(u => `![image](${u})`).join('\n\n');
      lastMarkdown = lastMarkdown + '\n\n' + imgMarkdown;
    } else if (!lastMarkdown && lastImageUrls.length > 0) {
      lastMarkdown = lastImageUrls.map(u => `![image](${u})`).join('\n\n');
    }

    return lastMarkdown;
  }
}
