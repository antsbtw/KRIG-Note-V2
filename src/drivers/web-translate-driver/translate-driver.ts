/**
 * TranslateDriver — Google Translate 注入引擎(L5-B4.2,从 V1 直迁)
 *
 * 注入策略:
 * - Step 1 (CSP) 立即执行 — 移除 CSP meta + MutationObserver 防新加 meta
 * - Step 2 (fetch element.js) await IPC(走 main 进程,避 webview CSP block)
 * - Step 3-5 顺序 fire-and-forget(.then 链)
 * - 每次 did-finish-load 触发新的 inject,旧的自然被页面导航中断(injectId 比对)
 *
 * 历史(W4.2 C2):文件原位于 src/views/web/translate/,driver 协议要求 driver
 * 不绑定 view 模块。本 driver 自身依赖只有 webview tag + window.electronAPI(IPC),
 * 无 slot-bus / view 模块依赖,物理迁移即可,无需接口注入。
 */

/**
 * ⭐ 脚本 id —— 脚本**本体**已登记在 main 侧
 * (`web-capability/dom/renderer-scripts.ts`),这里只认名字。
 *
 * ⚠️ 不从 `@platform` import 那些常量:renderer 不许 import 能力层
 * (`ipc-dom-boundary-guard` 钉着)。两边各写一份字面量,
 * 由守卫**双向对照**钉住一致 —— 宁可重复一个字符串,
 * 不把 main 的模块拖进渲染进程。
 */
const SCRIPTS = {
  stripCsp: 'renderer.translate-strip-csp',
  mount: 'renderer.translate-mount',
  darkMeta: 'renderer.translate-dark-meta',
} as const;

interface WebviewElement extends HTMLElement {
  isLoading(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
  /**
   * ⭐ guest 的 webContents id —— 走 `web.dom` IPC 面时用它**指认页面**。
   * ⚠️ webview 未 attached 时会**抛**(同 executeJavaScript),调用方要 try。
   */
  getWebContentsId(): number;
}

export class TranslateDriver {
  private targetLang: string;
  /** 翻译注入进行中(SyncDriver poll 时跳过)*/
  injecting = false;
  /** 递增 ID — await 期间页面导航了就丢弃旧注入 */
  private injectId = 0;

  constructor(targetLang = 'zh-CN') {
    this.targetLang = targetLang;
  }

  setTargetLang(lang: string): void {
    this.targetLang = lang;
  }

  async inject(webview: WebviewElement): Promise<void> {
    if (webview.isLoading()) return;

    const myId = ++this.injectId;
    this.injecting = true;

    /**
     * ⭐ 2026-09-30:Step 1/3/5 改走 `web.dom` IPC 面(L2 收口步 2b)。
     *
     * ⚠️ 旧做法 Step 3 是
     * `googleTranslateInjectRaw.replace(/占位符/g, this.targetLang)` ——
     * 把运行时值**文本替换进脚本源码**,与 `project-x-inject-template-escape`
     * 同机制;且那个占位符在 inject 文件出现 2 处(一处注释一处真实变量),
     * 与 `sync-inject` 踩过的完全同形。
     *
     * ⚠️⚠️ **Step 4(element.js)刻意不走** —— 见下面的说明。
     */
    let wcId: number;
    try {
      // ⚠️ webview 未 attached 时会抛(同 executeJavaScript)
      wcId = webview.getWebContentsId();
    } catch {
      this.injecting = false;
      return;
    }
    const api = window.electronAPI;
    if (!api?.webDomRun) {
      console.warn('[translate-driver] webDomRun 不可用 —— preload 没接上?');
      this.injecting = false;
      return;
    }
    const run = async (scriptId: string, params?: Record<string, string>): Promise<boolean> => {
      const r = await api.webDomRun({ wcId }, scriptId, params);
      if (r.status === 'failed') {
        // ⚠️ 不静默 —— 翻译失效时日志里必须有话
        console.warn(`[translate-driver] ${scriptId} 失败: ${r.reason}`);
        return false;
      }
      return true;
    };

    // Step 1:剥 CSP meta(防 Google CDN 被 block)+ MutationObserver 防新加
    await run(SCRIPTS.stripCsp);
    if (this.injectId !== myId) { this.injecting = false; return; }

    // Step 2:fetch element.js(走 main IPC,安全 await)
    let elementJsCode: string | null = null;
    try {
      elementJsCode = await window.electronAPI.translateFetchElementJs();
    } catch {
      this.injecting = false;
      return;
    }
    if (!elementJsCode) {
      console.warn('[translate-driver] element.js fetch failed — 网络不通?');
      this.injecting = false;
      return;
    }

    // 检查 await 期间是否被新 inject 覆盖(页面导航了)
    if (this.injectId !== myId) { this.injecting = false; return; }
    if (webview.isLoading()) { this.injecting = false; return; }

    // Step 3:挂载壳(targetLang 走**绑定值**,不再文本替换)
    if (!(await run(SCRIPTS.mount, { targetLang: this.targetLang }))) {
      this.injecting = false;
      return;
    }
    if (this.injectId !== myId) { this.injecting = false; return; }

    /**
     * Step 4:注入 Google 的 element.js。
     *
     * ⚠️⚠️ **刻意不走 `web.dom`,而且不该走** ——
     * 它注入的是**从 Google 现下载的第三方代码**
     * (`web-translate-handler.ts` 里 `net.fetch(ELEMENT_JS_URL)`),
     * 内容每次可能不同、也不是我们写的。
     *
     * ⭐ 而 `web.dom` 的 `run` 只收**预注册脚本 id** —— 它的全部价值就在于
     * 「调用方给不了脚本文本」。把一段现下载的代码塞进去,
     * 等于绕开那道防线,还要为它开一个收脚本文本的口子(`runDynamic`),
     * 那正是我们**明确拒绝**对 renderer 开放的东西。
     *
     * ⭐ 判据(设计 §二):**注入脚本里有没有运行时值?**
     * 这里整段脚本**本身就是**运行时取回的 —— 它不属于「参数绑定」能治的问题,
     * 属于「要不要信任第三方代码」这个独立问题。
     * 留在原路径,并把失败如实说出来(旧实现这里也是 `.catch` 里 warn)。
     */
    try {
      await webview.executeJavaScript(elementJsCode);
    } catch (err) {
      console.warn('[translate-driver] element.js 注入失败:', err);
      this.injecting = false;
      return;
    }
    if (this.injectId !== myId) { this.injecting = false; return; }

    // Step 5:暗色模式 meta
    await run(SCRIPTS.darkMeta);
    if (this.injectId === myId) this.injecting = false;
  }
}
