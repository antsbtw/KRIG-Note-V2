/**
 * Web Translate IPC handlers + CSP Bypass — L5-B4.2
 *
 * 1. fetch element.js IPC
 * 2. 对 WEBVIEW_TRANSLATE_PARTITION session 的所有响应剥离 CSP 头,
 *    允许 Google Translate 子 chunks(_loadJs 加载的脚本)绕过 page CSP
 *    (对齐 V1 setupCSPBypass)
 *
 * 安全:CSP bypass 仅作用于翻译专用 partition,不影响普通 web view。
 *      用户翻译 view 不应登录敏感账号(README 提示)。
 */

import { ipcMain, net, session } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { WEBVIEW_TRANSLATE_PARTITION } from '@shared/constants/webview';

const ELEMENT_JS_URL =
  'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';

let cachedElementJs: string | null = null;
let cacheExpireAt = 0;
/** 缓存 1 小时 — Google CDN 内容稳定,但不长期持有(让 element.js 升级时 max 1 小时刷新)*/
const CACHE_TTL_MS = 60 * 60 * 1000;

let cspBypassRegistered = false;

/**
 * 对翻译 partition 的所有响应剥离 CSP / X-Frame-Options 头
 * (对齐 V1 csp-bypass.ts,但 V2 用 partition 维度而非 webContents id 维度)
 */
function setupCSPBypass(): void {
  if (cspBypassRegistered) return;
  cspBypassRegistered = true;

  const translateSession = session.fromPartition(WEBVIEW_TRANSLATE_PARTITION);
  translateSession.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    const headers = { ...details.responseHeaders };
    // 剥离 CSP(各种大小写)
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    delete headers['content-security-policy-report-only'];
    delete headers['Content-Security-Policy-Report-Only'];
    // 顺便剥 X-Frame-Options(部分 Google 服务用此)
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    callback({ responseHeaders: headers });
  });
  console.log('[web-translate] CSP bypass 已注册到', WEBVIEW_TRANSLATE_PARTITION);
}

export function registerWebTranslateHandlers(): void {
  // 启动即注册 CSP bypass(在用户切翻译模式之前 session 就准备好)
  setupCSPBypass();

  ipcMain.handle(IPC_CHANNELS.WEB_TRANSLATE_FETCH_ELEMENT_JS, async () => {
    const now = Date.now();
    if (cachedElementJs && now < cacheExpireAt) {
      return cachedElementJs;
    }
    try {
      console.log('[web-translate] fetching', ELEMENT_JS_URL);
      const resp = await net.fetch(ELEMENT_JS_URL);
      if (!resp.ok) {
        console.warn('[web-translate] fetch element.js HTTP', resp.status, resp.statusText);
        return null;
      }
      const text = await resp.text();
      console.log('[web-translate] element.js fetched OK,', text.length, 'bytes');
      cachedElementJs = text;
      cacheExpireAt = now + CACHE_TTL_MS;
      return text;
    } catch (err) {
      console.warn('[web-translate] fetch element.js failed (网络不通?):', err);
      return null;
    }
  });
}
