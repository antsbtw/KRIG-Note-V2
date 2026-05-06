/**
 * webview 配置常量(L5-B4)
 *
 * partition 隔离 webview 跟主 renderer:
 * - persist:webview — webview 共享一个 session(Cookie / cache 持久化但跟主 renderer 隔离)
 * - 跟 V1 web view 一致(WEBVIEW_PARTITION)
 */

export const WEBVIEW_PARTITION = 'persist:webview';

/** 默认主页(对齐 V1 默认)*/
export const WEBVIEW_DEFAULT_URL = 'https://www.google.com';
