/**
 * Web 全局设置 renderer 同步缓存(per-ws 代理工程 · 阶段3)
 *
 * 核心矛盾:omnibox.resolveOmniboxInput 和 data-model 的 DEFAULT_URL 是 renderer
 * **同步函数**,不能 await IPC。所以本模块持模块级变量缓存,WebView mount 时 await
 * initWebSettings() 填缓存,omnibox/data-model 同步读 getWebSettings()。
 *
 * 默认值 = 现有写死常量(WEBVIEW_SEARCH_URL / WEBVIEW_DEFAULT_URL),保证缓存未就绪
 * 时(initWebSettings 是 async,首次调用可能早于缓存填充)行为跟现在一致,无回归。
 *
 * 用户改设置 → IPC 写 store + 返回新全量 → 调 setWebSettingsCache 更新缓存,
 * 「新搜索 / 新 tab」即时生效(已打开页面不变,符合预期)。
 */

import type { WebGlobalSettings } from '@shared/types/web-settings-types';
import { WEBVIEW_SEARCH_URL, WEBVIEW_DEFAULT_URL } from '@shared/constants/webview';

let cache: WebGlobalSettings = {
  searchEngineTemplate: WEBVIEW_SEARCH_URL,
  defaultUrl: WEBVIEW_DEFAULT_URL,
};
let initialized = false;

/** 同步读当前缓存(omnibox / data-model 用)*/
export function getWebSettings(): WebGlobalSettings {
  return cache;
}

/** 覆盖缓存(initWebSettings 拉到 / 用户 update 返回后调)*/
export function setWebSettingsCache(s: WebGlobalSettings): void {
  if (s && typeof s === 'object') cache = s;
}

export function isWebSettingsInit(): boolean {
  return initialized;
}

/** 启动初始化:WebView mount 时调一次,await 拉全局设置填缓存(只跑一次)*/
export async function initWebSettings(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const s = await window.electronAPI.getWebSettings();
    if (s) cache = s;
  } catch {
    /* 用默认缓存,无回归 */
  }
}
