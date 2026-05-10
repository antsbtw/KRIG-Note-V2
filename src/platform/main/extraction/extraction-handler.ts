/**
 * Extraction 下载拦截器(L5-C6)
 *
 * V1 → V2 直迁:src/plugins/web/main/extraction-handler.ts(161 行)。
 *
 * 在 Platform WebView 中注入 JS 脚本,拦截 JSON 文件下载行为:
 * 1. 覆盖 <a> download + click,读取 blob → JSON 字符串
 * 2. 通过 console.log('KRIG_IMPORT:' + JSON) 发送给 KRIG-Note 主进程
 * 3. WebView "extraction" 监听 console-message → IPC EXTRACTION_IMPORT handler
 *
 * 比 will-download 拦截可靠:不丢失、不乱序、确定性传输。
 *
 * V2 接入路径:由 EBookView 触发 extractionOpen IPC 时,main 端 setup 一个临时
 * BrowserWindow 或通过 webview 的 webContents.on('console-message')监听 — 详见
 * handlers.ts 的 EXTRACTION_OPEN handler。
 */

import type { WebContents } from 'electron';

/** 注入到 Platform WebView 中拦截下载的 JS 脚本 */
const DOWNLOAD_INTERCEPT_SCRIPT = `
(function() {
  if (window.__krigDownloadInterceptInstalled) return;
  window.__krigDownloadInterceptInstalled = true;

  // 收集同一轮操作中的所有文件
  const pendingFiles = [];
  let flushTimer = null;
  const FLUSH_DELAY = 1500; // 最后一个文件读取完成后等 1.5 秒

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      if (pendingFiles.length === 0) return;
      const batch = pendingFiles.splice(0);
      // 按 pageStart 排序
      batch.sort((a, b) => a.pageStart - b.pageStart);
      // 发送批次
      console.log('KRIG_IMPORT:' + JSON.stringify({
        type: 'batch',
        chapters: batch
      }));
    }, FLUSH_DELAY);
  }

  // 从文件名解析元数据
  function parseFileName(fileName) {
    let name = fileName.replace(/\\.json$/, '');
    let pageStart = 0, pageEnd = 0;
    const pageMatch = name.match(/_p(\\d+)-(\\d+)$/);
    if (pageMatch) {
      pageStart = parseInt(pageMatch[1], 10);
      pageEnd = parseInt(pageMatch[2], 10);
      name = name.slice(0, -pageMatch[0].length);
    }
    let bookName = name, chapterTitle = '';
    const pdfSep = name.indexOf('.pdf_');
    if (pdfSep >= 0) {
      bookName = name.slice(0, pdfSep);
      chapterTitle = name.slice(pdfSep + '.pdf_'.length);
      chapterTitle = chapterTitle.replace(/／\\d+$/, '');
      chapterTitle = chapterTitle.replace(/_/g, ' ');
    } else {
      bookName = bookName.replace(/\\.pdf$/, '');
    }
    return { bookName, chapterTitle, pageStart, pageEnd };
  }

  // 拦截 <a> 元素的点击下载
  const origCreateElement = document.createElement.bind(document);
  document.createElement = function(tagName, options) {
    const el = origCreateElement(tagName, options);
    if (tagName.toLowerCase() === 'a') {
      const origClick = el.click.bind(el);
      el.click = function() {
        // 检查是否是 JSON 下载
        const href = el.href || '';
        const download = el.download || '';
        if (download.endsWith('.json') && href.startsWith('blob:')) {
          // 拦截:读取 blob 内容
          fetch(href)
            .then(r => r.text())
            .then(text => {
              const parsed = parseFileName(download);
              try {
                const data = JSON.parse(text);
                pendingFiles.push({
                  fileName: download,
                  bookName: data.bookName || parsed.bookName,
                  title: parsed.chapterTitle || parsed.bookName,
                  pageStart: parsed.pageStart,
                  pageEnd: parsed.pageEnd,
                  pages: data.pages || [],
                });
                console.log('[KRIG Bridge] Captured: ' + download);
                scheduleFlush();
              } catch (e) {
                console.error('[KRIG Bridge] JSON parse failed:', download, e);
              }
              // 释放 blob URL
              URL.revokeObjectURL(href);
            })
            .catch(err => {
              console.error('[KRIG Bridge] Fetch failed:', href, err);
              origClick();
            });
          return;
        }
        origClick();
      };
    }
    return el;
  };

  console.log('[KRIG Bridge] Download intercept installed');
})();
`;

/**
 * 给 webview 的 webContents 注册下载拦截:
 * - did-finish-load:注入脚本
 * - did-navigate-in-page:SPA 路由切换重新注入
 *
 * 调用方负责:在 console-message 事件里识别 'KRIG_IMPORT:' 前缀并 IPC 转发。
 */
export function setupExtractionInterceptor(guestWebContents: WebContents): void {
  guestWebContents.on('did-finish-load', () => {
    guestWebContents.executeJavaScript(DOWNLOAD_INTERCEPT_SCRIPT).catch((err) => {
      console.error('[Extraction] Failed to inject intercept script:', err);
    });
  });

  guestWebContents.on('did-navigate-in-page', () => {
    guestWebContents.executeJavaScript(DOWNLOAD_INTERCEPT_SCRIPT).catch(() => {
      // ignore
    });
  });
}
