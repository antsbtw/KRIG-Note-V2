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

/** 记录一次访问(导航成功时调用)。about:blank / 空 URL 不记。 */
export function recordVisit(url: string, title: string): void {
  if (!url || url === 'about:blank') return;
  save(mergeVisit(load(), url, title, Date.now()));
}

/** 查历史补全候选(地址栏输入时调用)。 */
export function queryHistory(rawInput: string): WebHistoryEntry[] {
  return matchHistory(load(), rawInput);
}
