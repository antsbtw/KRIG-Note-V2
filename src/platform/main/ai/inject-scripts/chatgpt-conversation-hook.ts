/**
 * ChatGPT Conversation Hook — 页面级 fetch hook 截获 conversation/textdocs/file 响应。
 *
 * V1 用 CDP(Chrome DevTools Protocol)拿 Service Worker 注入的 auth header,
 * V2 简化:hook window.fetch 截获每次响应,缓存 body 到 window.__krig_chatgpt_cache,
 * main 进程 executeJavaScript 读取(不需要 CDP attach,SW 已附加 auth → fetch.clone() 拿响应)。
 *
 * 拦截:
 *   - /backend-api/conversation/{uuid}  (bare,无 /textdocs / /stream_status 后缀)
 *     → 对话树 mapping
 *   - /backend-api/conversation/{uuid}/textdocs
 *     → Canvas 文档数组
 *   - /backend-api/estuary/content?id=file_xxx
 *     → 文件 bytes(base64 dataUrl 形式)
 *   - /backend-api/files/download/{file_id}
 *     → 文件元数据
 *
 * 设计:
 * - 用 response.clone() 不影响 ChatGPT 自身处理
 * - 二进制响应(image)走 blob → base64 转换
 * - 缓存 key = url(完整带 query),value = { body, mimeType, length, ts }
 * - 最多缓存 50 条,FIFO 淘汰
 */

export function getChatGPTConversationHookScript(): string {
  return `(function() {
  if (window.__krig_chatgpt_hooked) return 'already_hooked';
  window.__krig_chatgpt_hooked = true;

  var MAX_CACHE = 50;
  window.__krig_chatgpt_cache = window.__krig_chatgpt_cache || {};

  function setCache(url, entry) {
    window.__krig_chatgpt_cache[url] = entry;
    var keys = Object.keys(window.__krig_chatgpt_cache);
    if (keys.length > MAX_CACHE) {
      // FIFO:按 ts 排序删最老的
      keys.sort(function(a, b) {
        return (window.__krig_chatgpt_cache[a].ts || 0) - (window.__krig_chatgpt_cache[b].ts || 0);
      });
      var toDelete = keys.slice(0, keys.length - MAX_CACHE);
      for (var i = 0; i < toDelete.length; i++) {
        delete window.__krig_chatgpt_cache[toDelete[i]];
      }
    }
  }

  // base64 编码 ArrayBuffer
  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function isInterestingUrl(url) {
    if (typeof url !== 'string') return false;
    return url.indexOf('/backend-api/conversation/') !== -1
        || url.indexOf('/backend-api/estuary/content') !== -1
        || url.indexOf('/backend-api/files/download/') !== -1;
  }

  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = '';
    if (typeof input === 'string') url = input;
    else if (input && typeof input === 'object' && input.url) url = input.url;

    var p = originalFetch.apply(this, arguments);
    if (isInterestingUrl(url)) {
      p.then(function(resp) {
        if (!resp.ok) return;
        try {
          var clone = resp.clone();
          var ct = clone.headers && clone.headers.get && clone.headers.get('content-type') || '';
          // 二进制 / image / octet-stream → base64
          if (ct.indexOf('image') !== -1 || ct.indexOf('octet-stream') !== -1 || ct.indexOf('binary') !== -1) {
            clone.arrayBuffer().then(function(buf) {
              setCache(url, {
                body: arrayBufferToBase64(buf),
                mimeType: ct,
                length: buf.byteLength,
                ts: Date.now(),
                isBinary: true,
              });
            }).catch(function(){});
          } else {
            // JSON / text
            clone.text().then(function(text) {
              setCache(url, {
                body: text,
                mimeType: ct,
                length: text.length,
                ts: Date.now(),
                isBinary: false,
              });
            }).catch(function(){});
          }
        } catch (e) {}
      }).catch(function(){});
    }
    return p;
  };

  return 'hooked';
})()`;
}

/**
 * 实时拉取当前对话树的脚本(main 进程 executeJavaScript 调).
 *
 * 背景(2026-07-25 stale-cache 修复):conversation hook 只截**页面加载时那一次** GET
 * /backend-api/conversation/{id}。用户在同一页**继续聊天**走 SSE 流式追加,不再重新 GET
 * 整份对话树 → hook 缓存冻结在进页面那一刻 → 提取永远拿旧的最后一轮(表现:多轮对话
 * 提取到重复的用户提问 / 轮次对不准)。
 *
 * 修法:提取时在页面上下文**主动 fetch 一次**该 endpoint(同源 + Service Worker 已附加
 * auth,与 hook clone 拿到响应同源),拿到**当前最新**的 mapping。credentials:'include'
 * 确保带 cookie/auth。失败(网络/鉴权/离线)返回 { ok:false } 让 caller 回退陈旧缓存。
 *
 * @param conversationId /c/{uuid} 里的 uuid
 */
export function getChatGPTFetchConversationScript(conversationId: string): string {
  return `(async function() {
  var id = ${JSON.stringify(conversationId)};
  // ChatGPT 的 /backend-api/* 走 Bearer token 鉴权,光 cookie(credentials:include)会 401。
  // token 从 /api/auth/session 的 accessToken 取(同源、cookie 可访问),带上 Authorization。
  async function getAccessToken() {
    try {
      var r = await fetch('/api/auth/session', { credentials: 'include' });
      if (!r.ok) return null;
      var j = await r.json();
      return (j && j.accessToken) ? j.accessToken : null;
    } catch (e) { return null; }
  }
  try {
    var token = await getAccessToken();
    var headers = { 'accept': 'application/json' };
    if (token) headers['authorization'] = 'Bearer ' + token;
    var resp = await fetch('/backend-api/conversation/' + id, {
      method: 'GET',
      credentials: 'include',
      headers: headers,
    });
    if (!resp.ok) return { ok: false, status: resp.status, hadToken: !!token };
    var text = await resp.text();
    return { ok: true, body: text };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
})()`;
}

/**
 * 读 cache 的脚本(main 进程 executeJavaScript 调).
 *
 * @param urlSubstring 模糊匹配 cache key
 * @param mode 'all' | 'latest' | 'first' — 多匹配时取哪个
 */
export function getChatGPTReadCacheScript(
  urlSubstring: string,
  mode: 'all' | 'latest' | 'first' = 'latest',
): string {
  return `(function() {
  var cache = window.__krig_chatgpt_cache || {};
  var sub = ${JSON.stringify(urlSubstring)};
  var mode = ${JSON.stringify(mode)};
  var matches = [];
  for (var url in cache) {
    if (url.indexOf(sub) !== -1) {
      matches.push({ url: url, ...cache[url] });
    }
  }
  if (matches.length === 0) return { success: true, matches: [] };
  matches.sort(function(a, b) { return (a.ts||0) - (b.ts||0); });
  if (mode === 'all') return { success: true, matches: matches };
  if (mode === 'first') return { success: true, matches: [matches[0]] };
  return { success: true, matches: [matches[matches.length - 1]] }; // latest
})()`;
}
