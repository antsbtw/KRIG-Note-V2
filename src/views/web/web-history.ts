/**
 * web-history — 轻量全局浏览历史(地址栏自动补全用)
 *
 * 范围说明:原 P0 prompt §4 把「完整历史/书签」列为未来 epic(等多标签 data-model
 * 落地后再设计)。本模块是用户主动要的**轻量补全版**,刻意**不碰 per-ws data-model
 * schema**,改用 localStorage 存一份全局 URL 访问列表(与 code-block 等模块的
 * localStorage 用法同源)。多标签 / 完整历史页等仍留 Phase 4+ epic。
 *
 * 存储:localStorage[KRIG_WEB_HISTORY] = WebHistoryEntry[](按最近访问降序,去重,上限 N)
 *
 * 纯数据逻辑(record / query / 排序 / 上限)抽成可单测函数,localStorage 读写隔离在边缘。
 */

import { WEBVIEW_SEARCH_URL } from '@shared/constants/webview';

const LS_KEY = 'krig:web:history';
/** 历史上限(超过裁掉最旧的)*/
const MAX_ENTRIES = 500;
/** 补全下拉最多候选数 */
const MAX_SUGGESTIONS = 8;

export interface WebHistoryEntry {
  url: string;
  title: string;
  /** 最近一次访问(ms epoch)*/
  lastVisit: number;
  /** 访问次数(用于排序权重)*/
  visitCount: number;
}

// ── 纯函数(可单测,不碰 localStorage)──

/**
 * 从搜索引擎模板(WEBVIEW_SEARCH_URL,如 `https://www.google.com/search?q=%s`)
 * 解出 { host, path } 用于历史过滤比对。
 *
 * 只取 origin host + pathname(query 不参与,模板里的 `%s`/`?q=` 不影响匹配)。
 * 解析失败(模板被改坏)→ null,过滤时不命中(宁可多记不错过正常页)。
 */
function parseSearchTemplate(template: string): { host: string; path: string } | null {
  try {
    const u = new URL(template);
    return { host: u.host.toLowerCase(), path: u.pathname.toLowerCase() };
  } catch {
    return null;
  }
}

const SEARCH_MATCHER = parseSearchTemplate(WEBVIEW_SEARCH_URL);

/**
 * 判断一个 URL 是否应记入历史(地址栏补全候选)。纯函数,便于单测。
 *
 * 规则:
 * 1. 只记 http:// / https://(about:/data:/file:/blob: 等跳过)。
 * 2. 跳过搜索结果页:host + pathname 前缀命中 WEBVIEW_SEARCH_URL 模板就不记
 *    (不 hardcode google.com/search,跟随搜索引擎常量)。
 *
 * @param matcher 可选注入搜索模板匹配信息(单测用);默认取模块级 SEARCH_MATCHER。
 */
export function shouldRecord(
  url: string,
  matcher: { host: string; path: string } | null = SEARCH_MATCHER,
): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (matcher) {
    const host = parsed.host.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    // 同 host 且 pathname 以模板 path 为前缀 → 视作搜索结果页,跳过
    if (host === matcher.host && path.startsWith(matcher.path)) return false;
  }
  return true;
}

/**
 * 把一次访问合并进历史列表(去重 by url,累加 visitCount,更新 lastVisit/title),
 * 返回新列表(按 lastVisit 降序,裁到 MAX_ENTRIES)。
 *
 * @param now 调用方传入时间戳(ms epoch)— 不在内部取时间,便于单测
 */
export function mergeVisit(
  list: WebHistoryEntry[],
  url: string,
  title: string,
  now: number,
): WebHistoryEntry[] {
  const existing = list.find((e) => e.url === url);
  const rest = list.filter((e) => e.url !== url);
  const merged: WebHistoryEntry = existing
    ? { url, title: title || existing.title, lastVisit: now, visitCount: existing.visitCount + 1 }
    : { url, title, lastVisit: now, visitCount: 1 };
  // 新条目置顶,其余按 lastVisit 降序,裁上限
  return [merged, ...rest].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, MAX_ENTRIES);
}

/**
 * 按输入前缀匹配历史(地址栏补全)。
 *
 * 匹配规则:对 url 去协议后做大小写不敏感的子串匹配(也匹配 title)。
 * 排序:visitCount 降序 → lastVisit 降序。返回最多 MAX_SUGGESTIONS 条。
 */
export function matchHistory(list: WebHistoryEntry[], rawInput: string): WebHistoryEntry[] {
  const q = rawInput.trim().toLowerCase();
  if (!q) return [];
  const stripScheme = (u: string) => u.replace(/^https?:\/\//, '');
  const hits = list.filter((e) => {
    const u = stripScheme(e.url).toLowerCase();
    return u.includes(q) || e.title.toLowerCase().includes(q);
  });
  hits.sort((a, b) => b.visitCount - a.visitCount || b.lastVisit - a.lastVisit);
  return hits.slice(0, MAX_SUGGESTIONS);
}

// ── localStorage 边缘(读写隔离)──

function load(): WebHistoryEntry[] {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  // 防御:只保留结构完整的条目(localStorage 可能被外部写脏)
  return parsed.filter(
    (e): e is WebHistoryEntry =>
      !!e &&
      typeof (e as WebHistoryEntry).url === 'string' &&
      typeof (e as WebHistoryEntry).lastVisit === 'number',
  );
}

function save(list: WebHistoryEntry[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

/**
 * 记录一次访问(导航成功时调用)。
 *
 * 过滤(shouldRecord):非 http(s) scheme(about:blank/data:/file: 等)、
 * 搜索结果页(WEBVIEW_SEARCH_URL host+path 命中)不记。SPA 内碎片跳转
 * 靠 mergeVisit 按 url 去重兜底(同 url 只累加 visitCount 不新增条目)。
 */
export function recordVisit(url: string, title: string): void {
  if (!shouldRecord(url)) return;
  save(mergeVisit(load(), url, title, Date.now()));
}

/** 查历史补全候选(地址栏输入时调用)。 */
export function queryHistory(rawInput: string): WebHistoryEntry[] {
  return matchHistory(load(), rawInput);
}

// ── NavSide 历史段:全量读 / 删除 / 清空(批1)──

/**
 * 取全部历史(NavSide 历史段列表用)。
 *
 * 已存储顺序即 lastVisit 降序(load() 返回 save 时已排序的数组;recordVisit
 * 经 mergeVisit 按 lastVisit 降序写回)。为防外部写脏顺序,这里再排一次兜底,
 * 保证「最近访问在前」。
 */
export function getAllHistory(): WebHistoryEntry[] {
  return load().sort((a, b) => b.lastVisit - a.lastVisit);
}

/** 删除单条历史(by url)。命中即写回;无命中也无副作用。 */
export function removeHistoryEntry(url: string): void {
  const list = load();
  const next = list.filter((e) => e.url !== url);
  if (next.length !== list.length) save(next);
}

/** 清空全部历史。 */
export function clearHistory(): void {
  save([]);
}
