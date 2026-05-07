/**
 * webview 配置常量(L5-B4)
 *
 * partition 隔离 webview 跟主 renderer:
 * - persist:webview — 普通 web view session
 * - persist:webview-translate — 翻译 webview 独立 session(L5-B4.2)
 *   main 进程对此 session 的所有响应剥离 CSP,允许 Google Translate 子 chunks 加载
 */

export const WEBVIEW_PARTITION = 'persist:webview';
export const WEBVIEW_TRANSLATE_PARTITION = 'persist:webview-translate';

/** 默认主页(对齐 V1 默认)*/
export const WEBVIEW_DEFAULT_URL = 'https://www.google.com';
