/**
 * Web Translate IPC handlers — L5-B4.2
 *
 * 给 translate-driver 用:fetch Google Translate element.js
 * 必须走 main 进程(避 webview CSP block + 缓存复用)
 *
 * 安全:仅 fetch 固定 URL(translate.google.com/translate_a/element.js),
 * 不接受 renderer 传入参数 — 不做开放 fetch。
 */

import { ipcMain, net } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';

const ELEMENT_JS_URL =
  'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';

let cachedElementJs: string | null = null;
let cacheExpireAt = 0;
/** 缓存 1 小时 — Google CDN 内容稳定,但不长期持有(让 element.js 升级时 max 1 小时刷新)*/
const CACHE_TTL_MS = 60 * 60 * 1000;

export function registerWebTranslateHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WEB_TRANSLATE_FETCH_ELEMENT_JS, async () => {
    const now = Date.now();
    if (cachedElementJs && now < cacheExpireAt) {
      return cachedElementJs;
    }
    try {
      const resp = await net.fetch(ELEMENT_JS_URL);
      if (!resp.ok) return null;
      const text = await resp.text();
      cachedElementJs = text;
      cacheExpireAt = now + CACHE_TTL_MS;
      return text;
    } catch (err) {
      console.warn('[web-translate] fetch element.js failed:', err);
      return null;
    }
  });
}
