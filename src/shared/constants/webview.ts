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

/**
 * 地址栏关键词搜索引擎(P0)
 *
 * `%s` 占位符 = 已 encodeURIComponent 的查询词。地址栏输入不像 URL 时,
 * resolveOmniboxInput 用此模板拼搜索 URL(见 src/views/web/omnibox.ts)。
 */
export const WEBVIEW_SEARCH_URL = 'https://www.google.com/search?q=%s';
