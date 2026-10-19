/**
 * ⭐ 网页 DevTools 日志落盘 —— 每个 webContents 的 console / 报错 / 加载失败 写进 `logs/page/`
 *
 * 以前网页日志只在那个网页自己的 DevTools 里(记忆 feedback-log-where-the-human-looks),
 * 全仓只有剪藏监听了 `console-message`,且只认 `KRIG_IMPORT:` 前缀。
 *
 * ── 挂在哪 ──
 * 由 `index.ts` 经 `app.on('web-contents-created')` 对**每个** webContents 挂(主窗口 renderer、
 * 每个 webview、隐藏的抓取窗口都算)。⚠️ 不走 `setPerWindowWebviewHooks`:那是 per-window 的
 * `did-attach-webview`,只覆盖 webview;这里要的是全部,而且 app 级事件天然不存在「次级窗口漏挂」。
 *
 * ── 每条带什么 ──
 * wc(webContents id)· type(window / webview …)· host(webview 的宿主窗口 wc)·
 * pageId(能力层登记过的页面才有;查询时现取,因为登记发生在 attach 之后)· url · kind · level · msg
 *
 * kind:
 *   console  —— console.* 与未捕获异常(Chromium 把 Uncaught 也作为 error 级 console-message 发出)
 *   load-fail —— did-fail-load(主框架 error,子框架 warning;-3 ERR_ABORTED 也照记,由读的人判断)
 *   preload  —— preload 脚本抛错
 *   gone     —— 渲染进程退出
 *   unresponsive / responsive
 *   nav      —— 导航(含 SPA 内跳转)—— 回答「当时在哪页」
 *   dropped  —— 限流丢掉的条数(见下)
 *
 * ── 限流 ──
 * 有的网站 console 刷得很凶。每个 webContents 每分钟最多 `MAX_PER_MIN` 条 console,
 * 超出只计数,下一分钟第一条之前(或页面销毁时)补一行 `dropped`。⚠️ 丢了必须说得出丢了几条。
 */

import type { WebContents } from 'electron';
import { clipMsg, type DailyLogWriter } from './log-file';

export const MAX_PER_MIN = 600;
const WINDOW_MS = 60_000;

type Level = 'info' | 'warning' | 'error' | 'debug';

export type PageTapDeps = {
  readonly writer: DailyLogWriter;
  readonly run: string;
  /** wc → 能力层 pageId(没登记过返回 null)。注入,免得诊断层依赖 web-capability */
  readonly resolvePageId: (wc: WebContents) => string | null;
  readonly now?: () => number;
};

const attached = new WeakSet<WebContents>();

export function tapPageConsole(wc: WebContents, deps: PageTapDeps): void {
  if (attached.has(wc)) return;
  attached.add(wc);
  const now = deps.now ?? Date.now;
  /** 这些只在活着时取得到,先记下来,销毁后的事件也能带上 */
  const id = wc.id;
  let type = 'unknown';
  try { type = wc.getType(); } catch { /* 取不到就 unknown */ }
  let host: number | undefined;
  try { host = wc.hostWebContents?.id; } catch { /* 非 webview 没有 */ }
  let lastUrl = '';

  const rec = (kind: string, level: Level, fields: Record<string, unknown>): void => {
    let url = lastUrl;
    let pageId: string | null = null;
    if (!wc.isDestroyed()) {
      try { url = wc.getURL(); lastUrl = url; } catch { /* 用上一次的 */ }
      try { pageId = deps.resolvePageId(wc); } catch { /* 查不到就不带 */ }
    }
    deps.writer.write({
      ts: now(), run: deps.run, wc: id, type,
      ...(host !== undefined ? { host } : {}),
      ...(pageId ? { pageId } : {}),
      url, kind, level, ...fields,
    });
  };

  let windowStart = 0;
  let inWindow = 0;
  let dropped = 0;
  const flushDropped = (): void => {
    if (dropped === 0) return;
    rec('dropped', 'warning', { msg: `限流:${WINDOW_MS / 1000}s 内超过 ${MAX_PER_MIN} 条,丢了 ${dropped} 条`, count: dropped });
    dropped = 0;
  };

  wc.on('console-message', (details) => {
    const t = now();
    if (t - windowStart >= WINDOW_MS) {
      flushDropped();
      windowStart = t;
      inWindow = 0;
    }
    if (inWindow >= MAX_PER_MIN) { dropped += 1; return; }
    inWindow += 1;
    const d = details as unknown as { message?: string; level?: Level; sourceId?: string; lineNumber?: number };
    rec('console', d.level ?? 'info', { ...clipMsg(String(d.message ?? '')), src: d.sourceId, line: d.lineNumber });
  });

  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    rec('load-fail', isMainFrame ? 'error' : 'warning', {
      msg: `${errorDescription} (${errorCode}) ${validatedURL}`, errorCode, failedUrl: validatedURL, mainFrame: isMainFrame,
    });
  });

  wc.on('preload-error', (_e, preloadPath, error) => {
    rec('preload', 'error', { ...clipMsg(error?.stack ?? String(error)), preload: preloadPath });
  });

  wc.on('render-process-gone', (_e, details) => {
    rec('gone', 'error', { msg: `渲染进程退出:${details.reason} (exit ${details.exitCode})`, reason: details.reason });
  });

  wc.on('unresponsive', () => { rec('unresponsive', 'warning', { msg: '页面无响应' }); });
  wc.on('responsive', () => { rec('responsive', 'info', { msg: '页面恢复响应' }); });

  wc.on('did-navigate', (_e, url, httpResponseCode, httpStatusText) => {
    rec('nav', httpResponseCode >= 400 ? 'warning' : 'info', { msg: `→ ${url} ${httpResponseCode} ${httpStatusText}`, status: httpResponseCode });
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) rec('nav', 'info', { msg: `→ ${url}(页内)` });
  });

  wc.once('destroyed', () => { flushDropped(); });
}
