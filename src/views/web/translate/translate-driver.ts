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
    // 注意:用 /regex/g 全局替换 — String.replace(string, string) 只替换第一个匹配,
    // 而 inject 文件里 __KRIG_TARGET_LANG__ 出现 2 处(注释+真实变量),只替换第一个会
    // 导致真实变量保留占位符,Google Translate widget 用错误"语言"创建,翻译不生效
    const script = (googleTranslateInjectRaw as unknown as string).replace(
      /__KRIG_TARGET_LANG__/g,
      this.targetLang,
    );

    // Step 3-4:把启动器 + element.js 拼一起,注入到 main world(用 <script> 标签插入)
    // 关键:Electron webview.executeJavaScript 默认跑在 isolated world,
    // 启动器定义的 window.googleTranslateElementInit 在 isolated world 内,
    // element.js 加载子 chunks 时跑在 main world,看不到 init 回调 → widget 永不创建
    // 修法:用 script 标签插入,两段代码都跑在 main world(同 webview 页面)
    const combinedScript = `${script}\n;\n${elementJsCode}`;
    const injectViaScriptTag = `
      (function() {
        try {
          var s = document.createElement('script');
          s.type = 'text/javascript';
          s.textContent = ${JSON.stringify(combinedScript)};
          (document.head || document.documentElement).appendChild(s);
          // 注入完成后移除 script 节点(textContent 已执行,DOM 痕迹无用)
          if (s.parentNode) s.parentNode.removeChild(s);
          return 'injected';
        } catch (e) {
          return 'error:' + (e && e.message || e);
        }
      })();
    `;

    webview
      .executeJavaScript(injectViaScriptTag)
      .then((r) => {
        console.log('[translate-driver] Step 3+4 script 标签注入结果:', r);
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
        // 1.5 秒后诊断:Google Translate widget 是否生效
        setTimeout(() => {
          webview
            .executeJavaScript(`
              (function() {
                var sel = document.querySelector('#google_translate_element select');
                var lang = window.__krigCurrentLang || null;
                var gt = typeof google !== 'undefined' && google.translate;
                var hasTranslateElement = !!(gt && google.translate.TranslateElement);
                var elDiv = document.getElementById('google_translate_element');
                var hasTranslated = !!document.querySelector('font[style*="vertical-align"]');
                return JSON.stringify({
                  hasSelect: !!sel,
                  selectValue: sel ? sel.value : null,
                  selectOptions: sel ? sel.options.length : 0,
                  krigLang: lang,
                  hasGoogleTranslate: !!gt,
                  hasTranslateElementCtor: hasTranslateElement,
                  initCalled: !!window.__krigInitCalled,
                  initOK: !!window.__krigInitOK,
                  initErr: window.__krigInitErr || null,
                  divExists: !!elDiv,
                  divChildren: elDiv ? elDiv.children.length : 0,
                  cookieGoogtrans: (document.cookie.match(/googtrans=[^;]*/) || ['none'])[0],
                  hasTranslatedNodes: hasTranslated,
                });
              })();
            `)
            .then((r) => console.log('[translate-driver] 1.5s 后 widget 状态:', r))
            .catch(() => {});
        }, 1500);
      })
      .catch((err) => {
        console.warn('[translate-driver] inject 链路抛错:', err);
        if (this.injectId === myId) this.injecting = false;
      });
  }
}
