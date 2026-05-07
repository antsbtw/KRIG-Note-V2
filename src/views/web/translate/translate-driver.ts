/**
 * TranslateDriver — Google Translate 注入引擎(L5-B4.2,从 V1 直迁)
 *
 * 注入策略:
 * - Step 1 (CSP) 立即执行 — 移除 CSP meta + MutationObserver 防新加 meta
 * - Step 2 (fetch element.js) await IPC(走 main 进程,避 webview CSP block)
 * - Step 3-5 顺序 fire-and-forget(.then 链)
 * - 每次 did-finish-load 触发新的 inject,旧的自然被页面导航中断(injectId 比对)
 */

// Vite ?raw import:把 .js 文件原文当字符串读
import googleTranslateInjectRaw from './google-translate-inject.js?raw';

interface WebviewElement extends HTMLElement {
  isLoading(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
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

    // Step 1:移除 CSP meta(防 Google CDN 被 block)+ MutationObserver 防新加
    webview.executeJavaScript(`
      (function() {
        document.querySelectorAll('meta[http-equiv]').forEach(function(m) {
          if (/content-security-policy/i.test(m.getAttribute('http-equiv'))) m.remove();
        });
        new MutationObserver(function(mutations) {
          mutations.forEach(function(mut) {
            mut.addedNodes.forEach(function(node) {
              if (node.nodeName === 'META' &&
                  /content-security-policy/i.test(node.getAttribute('http-equiv') || ''))
                node.remove();
            });
          });
        }).observe(document.head || document.documentElement, { childList: true });
      })();
    `).catch(() => {});

    // Step 2:fetch element.js(走 main IPC,安全 await)
    let elementJsCode: string | null = null;
    try {
      elementJsCode = await window.electronAPI.translateFetchElementJs();
    } catch (err) {
      console.warn('[translate-driver] fetchElementJs threw:', err);
      this.injecting = false;
      return;
    }
    if (!elementJsCode) {
      console.warn(
        '[translate-driver] fetchElementJs returned null — Google Translate CDN unreachable? 检查 main 进程能否访问 translate.googleapis.com',
      );
      this.injecting = false;
      return;
    }
    console.log('[translate-driver] element.js fetched,', elementJsCode.length, 'bytes — 开始注入');

    // 检查 await 期间是否被新 inject 覆盖(页面导航了)
    if (this.injectId !== myId) {
      console.log('[translate-driver] inject 被新的覆盖,放弃');
      this.injecting = false;
      return;
    }
    if (webview.isLoading()) {
      console.log('[translate-driver] webview 仍在加载,放弃');
      this.injecting = false;
      return;
    }

    // Step 3-5:顺序注入(fire-and-forget .then 链)
    const script = (googleTranslateInjectRaw as unknown as string).replace(
      /__KRIG_TARGET_LANG__/g,
      this.targetLang,
    );

    // 回退 V1 同款:两次 executeJavaScript(启动器 + element.js)
    // (script 标签注入被 Trusted Types CSP 拦截,且 isolated world 推断不成立)
    webview
      .executeJavaScript(script)
      .then(() => {
        console.log('[translate-driver] Step 3 注入器 OK');
        if (this.injectId !== myId) return;
        return webview.executeJavaScript(elementJsCode!);
      })
      .then(() => {
        console.log('[translate-driver] Step 4 element.js OK');
        // Step 5:暗色模式 meta 注入
        if (this.injectId !== myId) return;
        return webview.executeJavaScript(`
          (function() {
            var meta = document.querySelector('meta[name="color-scheme"]');
            if (!meta) {
              meta = document.createElement('meta');
              meta.setAttribute('name', 'color-scheme');
              document.head.appendChild(meta);
            }
            meta.setAttribute('content', 'dark');
            document.documentElement.style.colorScheme = 'dark';
          })();
        `);
      })
      .then(() => {
        if (this.injectId === myId) this.injecting = false;
        // 多次轮询诊断(子 chunks 异步加载,1.5s 不够,多看几次)
        const probe = (delayMs: number) => {
          setTimeout(() => {
            webview
              .executeJavaScript(`
                (function() {
                  var sel = document.querySelector('#google_translate_element select');
                  var gt = typeof google !== 'undefined' && google.translate;
                  var hasCtor = !!(gt && google.translate.TranslateElement);
                  var elDiv = document.getElementById('google_translate_element');
                  var hasTranslated = !!document.querySelector('font[style*="vertical-align"]');
                  return JSON.stringify({
                    initCalled: !!window.__krigInitCalled,
                    initOK: !!window.__krigInitOK,
                    initErr: window.__krigInitErr || null,
                    hasCtor: hasCtor,
                    divChildren: elDiv ? elDiv.children.length : -1,
                    selOpts: sel ? sel.options.length : 0,
                    selValue: sel ? sel.value : null,
                    hasTranslated: hasTranslated,
                    cookie: (document.cookie.match(/googtrans=[^;]*/) || ['none'])[0],
                  });
                })();
              `)
              .then((r) => console.log('[translate-driver] ' + delayMs + 'ms widget:', r))
              .catch(() => {});
          }, delayMs);
        };
        probe(1500);
        probe(3500);
        probe(6000);
      })
      .catch((err) => {
        console.warn('[translate-driver] inject 链路抛错:', err);
        if (this.injectId === myId) this.injecting = false;
      });
  }
}
