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
// ⭐ 步 3 迁移:Gemini 的载荷捕获改走 web.net(见 startGeminiCDP 注释)
import { netBus, bodyProvider, pageRegistry, getNetMonitor, domRunner } from '../web-capability/wiring/runtime';
import { AI_SCRIPTS, type ScriptId } from '../web-capability/dom';
import { toPageHost } from '../web-capability/wiring/electron-page-host';
import type { PageId } from '../web-capability/page';

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
  /** ⭐ 步 3:本 wc 在 web.page 里的身份;未登记则 null */
  private pageId: PageId | null = null;
  /** web.net 订阅的退订函数 */
  private unsubscribeNet: (() => void) | null = null;
  /** ⭐ 证据:经 web.net 到达的 Gemini 载荷计数(供测试与人工核验区分新旧链路) */
  private capturedViaWebNet = 0;
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
    // ⭐ 步 3 迁移后**不再 detach** —— 单一持有者模型:通道由底座独占,
    // 只在页面销毁时随宿主消失(bodyProvider 注册了 onDestroyed)。
    //
    // 这正是 `04` §2 要治的病:旧写法里业务方持有 detach,X 那 8 处因此踩了
    // 「A 结束时 detach 把正在共用的 B 一起掐掉」—— B 静默失聪、不报错。
    // 现在业务方**没有关灯这个动作**,也就无从关错灯。
    this.unsubscribeNet?.();
    this.unsubscribeNet = null;
    this.geminiDebuggerAttached = false;
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

    // Check page-level cache (ChatGPT/Claude) —— ⭐ 步 4:改走 web.dom 预注册脚本
    const res = await domRunner.run(this.webContents, this.pageIdForDom(), AI_SCRIPTS.sseReadLatest);
    if (res.status !== 'ok') return null;
    return typeof res.value === 'string' ? res.value : null;
  }

  /**
   * Get capture status.
   */
  async getStatus(): Promise<{ count: number; latestStreaming: boolean; hooked: boolean }> {
    const res = await domRunner.run(this.webContents, this.pageIdForDom(), AI_SCRIPTS.sseStatus);
    if (res.status !== 'ok' || !res.value || typeof res.value !== 'object') {
      // 读不到状态时给"全零"是**既有行为**(调用方据此判断 hook 没装上),保持不变
      return { count: 0, latestStreaming: false, hooked: false };
    }
    return res.value as { count: number; latestStreaming: boolean; hooked: boolean };
  }

  /**
   * Clear all cached responses.
   */
  async clearResponses(): Promise<void> {
    this.geminiResponses = [];
    await domRunner.run(this.webContents, this.pageIdForDom(), AI_SCRIPTS.sseClear);
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

    // ⭐ 步 4:注入改走 web.dom —— 业务方只给**脚本 id + 参数**,给不了脚本字符串。
    // 这是 project-x-inject-template-escape(采集恒 0 一整天、tsc 单测全绿)的
    // 类型层面根治;脚本本体仍在 inject-scripts/(迁移=换调用方,不搬代码)。
    //
    // ⚠️ Gemini 不在此列:它走 CDP 网络层(步 3 已迁到 web.net),不注入页面脚本。
    if (profile.id !== 'gemini') {
      void this.runScript(AI_SCRIPTS.sseCapture, {
        serviceId: profile.id,
        endpointPattern: profile.intercept.endpointPattern,
      }, `Fetch hook installed for ${profile.id}`);
    }

    // Claude artifact postMessage hook(独立于 SSE,跑在 Claude 页拦截 artifact iframe
    // 跟 parent 的 postMessage / fetch,把源码缓存到 window.__krig_artifact_messages,
    // claude-full-extraction 提取时读)
    if (profile.id === 'claude') {
      void this.runScript(AI_SCRIPTS.artifactHook, {},
        'Artifact postMessage hook installed for Claude');
    }

    // ChatGPT conversation cache hook(Phase 10.B.2):截 /backend-api/conversation,
    // /textdocs, /estuary/content 响应,缓存到 window.__krig_chatgpt_cache,
    // chatgpt-full-extraction 提取时读
    if (profile.id === 'chatgpt') {
      void this.runScript(AI_SCRIPTS.chatgptConversationHook, {},
        'ChatGPT conversation hook installed');
    }
  }

  /**
   * 经 `web.dom` 跑一个预注册脚本。
   *
   * ⚠️ 失败**不静默**:旧写法是 `.catch(() => {})` 空吞,
   * 于是「脚本压根没注入」和「页面还没就绪」长得一模一样 ——
   * 那次转义事故烧掉一整天,一半原因就是失败被吞了/被猜测盖住了。
   * 这里如实打出**脚本 id + 真实错误**,不写「多半是…」这类猜测。
   */
  private async runScript(
    scriptId: ScriptId,
    params: Record<string, unknown>,
    okMessage: string,
  ): Promise<void> {
    const result = await domRunner.run(this.webContents, this.pageIdForDom(), scriptId, params);
    if (result.status === 'ok') {
      if (result.value === 'hooked') console.log(`[SSECapture] ${okMessage}`);
      return;
    }
    if (result.status === 'failed') {
      // 页面未就绪是常态(下次 dom-ready / navigate 会重试),但**要看得见**
      console.warn(`[SSECapture] 注入 ${scriptId} 未成功: ${result.reason}`);
    }
  }

  /** 供 web.dom / web.trace 用的页面身份;未登记时按需登记 */
  private pageIdForDom(): PageId {
    if (!this.pageId) {
      const facts = pageRegistry.register({
        window: 'main',
        ws: this.resolveWsFromPartition(),
        slot: 'left',
        partition: this.readPartition(),
        owner: 'ai-service',
        service: detectAIServiceByUrl(this.webContents.getURL())?.id,
        url: this.webContents.getURL(),
        state: 'complete',
      });
      this.pageId = facts.pageId;
    }
    return this.pageId;
  }

  /**
   * Gemini 载荷捕获 —— ⭐ 步 3 已迁移到 `web.net`(2026-09-08)
   *
   * ── 迁移前后 ──
   *
   * 迁移前:本方法自己 `debugger.attach` + `on('message')` + `getResponseBody`,
   *        `stop()` 里 `detach()`。
   * 迁移后:只 `bodyProvider.attach(...)`(单一持有者,**业务方没有 detach 这个动作**)
   *        + `netBus.subscribe(...)` 收载荷。
   *
   * ⚠️ **对外接口一字未动** —— `getAllGeminiResponses()` 的返回形状、
   * `geminiResponses` 的语义、`MAX_RESPONSES` 老化都保持原样,
   * 所以 `ai-sync-orchestrator` / `ask-orchestrator` **完全不用改**
   * (那里有个三家共用的 `serviceId === 'gemini' ? ... : ...` 分叉,
   *  claude/chatgpt 那一支属步 4 `web.dom` 的范围,本步不碰)。
   *
   * ── 为什么这样更稳(`04` §2)──
   *
   * 旧写法里业务方持有 detach,X 那 8 处正是因此踩了「A 结束时 detach
   * 把正在共用的 B 一起掐掉」的坑 —— B 静默失聪、不报错、只是再也收不到载荷。
   * `web.net` 的单一持有者模型里,**业务方压根没有关灯这个动作**,
   * 且 attach 失败 / 通道被抢占都会广播出来(旧写法只 `console.warn` 就 return)。
   *
   * ⚠️ 旧的 CDP 实现按 `08` §1.2「旧实现留在原地不删」保留在
   * `startGeminiCDPLegacy()`,**但已无任何调用方**(步 8 统一清理)。
   */
  private startGeminiCDP(): void {
    const url = this.webContents.getURL();
    const profile = detectAIServiceByUrl(url);
    if (!profile || profile.id !== 'gemini') return;
    if (this.geminiDebuggerAttached) return;

    // ① 在 web.page 登记本页面,拿到不透明 pageId
    //    partition 与 AI Host 一致(per-ws:`persist:webview-${wsId}`,见 ai-extraction/Host.tsx)
    if (!this.pageId) {
      const facts = pageRegistry.register({
        window: 'main',
        ws: this.resolveWsFromPartition(),
        slot: 'left',
        partition: this.readPartition(),
        owner: 'ai-service',
        service: 'gemini',
        url,
        state: 'complete',
      });
      this.pageId = facts.pageId;
    }
    const pageId = this.pageId;
    const endpointPattern = profile.intercept?.endpointPattern ?? 'StreamGenerate';

    // ② 订阅载荷 —— ⭐ 只订阅,永不 attach/detach
    const monitor = getNetMonitor(String(pageId));
    this.unsubscribeNet?.();
    this.unsubscribeNet = netBus.subscribe(pageId, {}, (event) => {
      monitor.observe(event);

      if (event.kind === 'channel-failed' || event.kind === 'channel-lost') {
        // ⭐ 旧实现在这里是**静默**的(attach 失败只 warn 就 return,订阅者干等)。
        // 现在通道故障会明确送到这里,不再「安静等一个永不来的载荷」。
        console.warn(`[SSECapture] Gemini 通道故障(${event.kind}): ${event.reason}`);
        return;
      }

      if (event.kind !== 'response-complete' || !event.bodyRef) return;
      const record = netBus.list(pageId, {}).find((r) => r.requestId === event.requestId);
      // 端点判据取自服务档案的单一来源(`ai-service-types.ts` 的 intercept.endpointPattern),
      // 不在这里硬编码第二份 —— 站点改版时只改档案那一处。
      if (!record || record.url.indexOf(endpointPattern) === -1) return;

      const body = netBus.body(event.bodyRef);
      if (body.status !== 'ok') {
        // 不静默丢 —— 拿不到 body 要留痕
        console.warn(`[SSECapture] Gemini 载荷取不到: ${body.status === 'failed' ? body.reason : ''}`);
        return;
      }

      const markdown = this.parseGeminiResponse(new TextDecoder().decode(body.value));
      if (!markdown) return;

      this.geminiResponses.push({
        id: 'gemini-' + Date.now(),
        timestamp: Date.now(),
        service: 'gemini',
        markdown,
        streaming: false,
        url: record.url,
      });
      while (this.geminiResponses.length > this.MAX_RESPONSES) {
        this.geminiResponses.shift();
      }
      this.capturedViaWebNet += 1;
      // ⭐ 「经 web.net 到达」的人可验证据:旧链路打的是 "captured via CDP"
      console.log(
        `[SSECapture] Gemini captured via web.net, length: ${markdown.length}` +
        ` (viaWebNet=${this.capturedViaWebNet}, pageId=${pageId})`,
      );
    });

    // ③ 装通道。⚠️ 失败不是静默 return —— provider 会广播 channel-failed,
    //    上面的订阅者立刻收到(真机实测 attach 失败确实抛异常,见 electron-page-host.ts)
    const ok = bodyProvider.attach(toPageHost(this.webContents), pageId, {
      resourceTypes: ['fetch', 'document', 'xhr'],
    });
    this.geminiDebuggerAttached = ok;
    if (ok) {
      console.log(`[SSECapture] Gemini 载荷捕获已接入 web.net (pageId=${pageId})`);
    }
  }

  /** 读本 wc 的 partition(web.page 的 PageFacts 必填,底座不猜) */
  private readPartition(): string {
    try {
      return this.webContents.session.storagePath
        ? `persist:${this.webContents.session.storagePath.split('/').pop()}`
        : 'persist:webview';
    } catch {
      return 'persist:webview';
    }
  }

  /** 从 partition 反推 ws(per-ws partition 形如 `persist:webview-<wsId>`) */
  private resolveWsFromPartition(): string {
    const m = this.readPartition().match(/^persist:webview-(.+)$/);
    return m ? m[1] : 'unknown';
  }

  /** ⭐ 测试/诊断用:经 web.net 到达的载荷数。0 且有载荷 = 走的是旧链路 */
  getCapturedViaWebNetCount(): number {
    return this.capturedViaWebNet;
  }

  /** 本 wc 在 web.page 里的身份(未登记则 null) */
  getPageId(): PageId | null {
    return this.pageId;
  }

  /**
   * ⚠️ 旧实现,`08` §1.2「旧实现留在原地不删」——**已无调用方**,步 8 清理。
   * 保留它是为了迁移出问题时能快速对照,不是为了兜底:
   * 它不会被执行(全仓零调用,有守卫测试锁死)。
   */
  private startGeminiCDPLegacy(): void {
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
