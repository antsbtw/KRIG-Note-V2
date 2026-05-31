/**
 * omnibox — 地址栏输入判别(P0)
 *
 * Chrome 式 omnibox:用户在地址栏敲的东西,可能是网址也可能是搜索词。
 * 判别规则(看起来像 URL → 当 URL;否则 → 搜索):
 *
 * - 已带 http(s):// / file:// / about: 等协议  → 原样(仅补 https 见下)
 * - localhost / localhost:port                  → URL
 * - 纯 IP(v4)/ IP:port                         → URL
 * - 含 `.` 且无空格(像 host.tld / host.tld/path)→ URL,补 https://
 * - 其余(含空格,或无点的单词)                 → 搜索
 *
 * 抽成纯函数便于单测,不依赖 DOM / Electron。
 */

import { WEBVIEW_SEARCH_URL } from '@shared/constants/webview';

/** 已知带协议前缀(这些直接当 URL,不再补 https)*/
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** about: / mailto: 等无 // 的 scheme */
const HAS_SCHEMELESS_PROTOCOL = /^(about|mailto|tel|data|chrome|view-source):/i;
/** localhost,可带端口和路径 */
const LOCALHOST = /^localhost(:\d+)?(\/.*)?$/i;
/** IPv4,可带端口和路径 */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/;

/**
 * 把地址栏原始输入解析成可加载的 URL。
 *
 * @param raw 用户在地址栏敲的原始字符串(未 trim)
 * @returns 可直接喂给 webview.loadURL 的 URL;空输入返回 '' (caller 负责忽略)
 */
export function resolveOmniboxInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // 已带协议 → 原样(http(s):// / file:// / ftp:// 等,以及 about:/mailto: 等无 // 协议)
  if (HAS_SCHEME.test(trimmed) || HAS_SCHEMELESS_PROTOCOL.test(trimmed)) {
    return trimmed;
  }

  if (looksLikeUrl(trimmed)) {
    return `https://${trimmed}`;
  }

  return WEBVIEW_SEARCH_URL.replace('%s', encodeURIComponent(trimmed));
}

/** 不带协议时,判断 trimmed 是否"看起来像 URL"(不含空格的 host[/path])*/
function looksLikeUrl(trimmed: string): boolean {
  if (LOCALHOST.test(trimmed)) return true;
  if (IPV4.test(trimmed)) return true;

  // 含空格 = 多半是搜索词(host 不含空格)
  if (/\s/.test(trimmed)) return false;

  // host 部分(取第一个 / 之前)必须含 `.` 才算 host.tld
  const host = trimmed.split('/')[0];
  return host.includes('.');
}
