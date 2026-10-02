/**
 * 页面内网络钩子的**脚本文本**(M4)
 *
 * ⚠️⚠️⚠️ 本文件的内容会被**原样送进页面求值** —— 三条铁律:
 *
 * ① **不许拼运行时值进脚本**。参数一律由 `JSON.stringify` 绑定成一行前缀
 *    (见 `buildHookScript`)。`project-x-inject-template-escape`:
 *    拼串时 `\/` 被模板字面量求值吃掉 → 浏览器收到非法正则 →
 *    整段解析失败 → **采集恒 0,而 tsc 与单测全绿**。
 * ② **不许用模板字面量写脚本体**(反引号会与页面代码里的反引号打架,
 *    且 `${}` 会被 TS 提前求值)。本文件用**普通字符串数组 + join**。
 * ③ 脚本必须**自防重**:同一文档可能被注入两次(新文档一次 + 补注入一次),
 *    钩两次会让每条响应送回两份。
 */

/** 页面里挂的全局标记名 —— ⚠️ 与脚本体里写的必须一致 */
export const HOOK_FLAG = '__krigNetHookInstalled';

/**
 * 构造注入脚本。
 *
 * @param bindingName 页面里可调用的函数名(由 `Runtime.addBinding` 注册)
 * @param maxBytes    单条送回的上限 —— ⚠️ **不是截断数据**,
 *                    超过的只送元信息(见脚本体注释),正文仍留在页面侧丢弃。
 *                    ⭐ 这是**传输**限制不是**数据**限制:
 *                    binding 的 payload 过大会被 CDP 截断且**不报错**,
 *                    那才是真正的静默数据损坏。
 */
export function buildHookScript(bindingName: string, maxBytes = 2_000_000): string {
  /**
   * ⭐ 参数**绑定**成一行常量,不拼进脚本体 ——
   * `JSON.stringify` 保证任何字符都被正确转义。
   */
  const prelude =
    'var __KRIG_BINDING = ' + JSON.stringify(bindingName) + ';\n'
    + 'var __KRIG_MAX = ' + JSON.stringify(maxBytes) + ';\n';

  /**
   * ⚠️ 脚本体用**数组 + join** 而不是模板字面量:
   * 页面代码里有反引号、`${}`,写进模板字面量会被 TS 提前求值或打架。
   */
  const body = [
    '(function () {',
    '  "use strict";',
    // ── ③ 自防重 ──
    '  if (window.' + HOOK_FLAG + ') { return; }',
    '  window.' + HOOK_FLAG + ' = true;',
    '',
    '  var send = function (rec) {',
    '    try {',
    '      var fn = window[__KRIG_BINDING];',
    '      if (typeof fn !== "function") { return; }',
    '      var s = JSON.stringify(rec);',
    //     ⚠️ 过大的 payload 经 binding 会被**静默截断** —— 那是真的数据损坏。
    //        所以超限时只送元信息 + 明确标记,**绝不送半条**。
    '      if (s.length > __KRIG_MAX) {',
    '        fn(JSON.stringify({',
    '          via: rec.via, url: rec.url, method: rec.method,',
    '          status: rec.status, at: rec.at,',
    '          text: "", byteLength: rec.byteLength, oversize: true,',
    '        }));',
    '        return;',
    '      }',
    '      fn(s);',
    '    } catch (e) { /* 送不回去不能影响页面 */ }',
    '  };',
    '',
    // ── XHR ──
    '  var XHR = window.XMLHttpRequest;',
    '  if (XHR && XHR.prototype) {',
    '    var origOpen = XHR.prototype.open;',
    '    var origSend = XHR.prototype.send;',
    '    XHR.prototype.open = function (m, u) {',
    '      try { this.__krigM = String(m); this.__krigU = String(u); } catch (e) {}',
    '      return origOpen.apply(this, arguments);',
    '    };',
    '    XHR.prototype.send = function () {',
    '      var self = this;',
    '      try {',
    '        self.addEventListener("load", function () {',
    '          try {',
    //         ⚠️ 只取文本型响应;arraybuffer/blob 读 responseText 会抛
    '            var t = "";',
    '            if (self.responseType === "" || self.responseType === "text") {',
    '              t = self.responseText || "";',
    '            } else if (self.responseType === "json") {',
    '              t = JSON.stringify(self.response);',
    '            } else { return; }',
    '            send({',
    '              via: "xhr", url: self.__krigU || self.responseURL || "",',
    '              method: self.__krigM || "GET", status: self.status || 0,',
    '              text: t, byteLength: t.length,',
    '              at: new Date().toISOString(),',
    '            });',
    '          } catch (e) {}',
    '        });',
    '      } catch (e) {}',
    '      return origSend.apply(this, arguments);',
    '    };',
    '  }',
    '',
    // ── fetch ──
    '  var origFetch = window.fetch;',
    '  if (typeof origFetch === "function") {',
    '    window.fetch = function (input, init) {',
    '      var url = "";',
    '      var method = "GET";',
    '      try {',
    '        url = (typeof input === "string") ? input : (input && input.url) || "";',
    '        method = (init && init.method) || (input && input.method) || "GET";',
    '      } catch (e) {}',
    '      return origFetch.apply(this, arguments).then(function (res) {',
    '        try {',
    //       ⭐⭐ **必须 clone** —— 响应体只能读一次,直接读会把站点自己的那份吃掉,
    //          页面当场坏掉(这是本脚本最危险的一行)。
    '          var copy = res.clone();',
    '          var ct = "";',
    '          try { ct = copy.headers.get("content-type") || ""; } catch (e) {}',
    //       ⚠️ 只读文本型 —— 视频/图片读 text() 会把几 MB 二进制变成垃圾字符串
    '          if (ct.indexOf("json") < 0 && ct.indexOf("text") < 0',
    '              && ct.indexOf("javascript") < 0) { return res; }',
    '          copy.text().then(function (t) {',
    '            send({',
    '              via: "fetch", url: url || res.url || "", method: String(method),',
    '              status: res.status || 0, text: t, byteLength: t.length,',
    '              at: new Date().toISOString(),',
    '            });',
    '          }).catch(function () {});',
    '        } catch (e) {}',
    '        return res;',
    '      });',
    '    };',
    '  }',
    '})();',
  ].join('\n');

  return prelude + body;
}

/**
 * ⭐ 自检脚本 —— 问页面「钩子装上了吗」。
 * ⚠️ 必要性:注入失败是**静默**的,而症状(`hooked === 0`)
 * 与「页面没发请求」完全一样。没有这个自检就分不开。
 */
export const HOOK_PROBE = 'window.' + HOOK_FLAG + ' === true';
