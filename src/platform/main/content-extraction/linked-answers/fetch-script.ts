/**
 * 生成「在题目页里抓一张解答页」的注入脚本(guest.executeJavaScript,返回 JSON 字符串)。
 *
 * 为什么在网页里抓:AoPS 前有 Cloudflare 人机验证,主进程直接请求只拿到「Just a moment...」
 * (2026-11-05 实测)。网页本身已过验证,同源 fetch 带着它的 cookie 就能拿到。
 *
 * 做法:MediaWiki `api.php?action=parse` 拿正文 HTML(redirects=1:AMC 10/12 共用题会
 * 重定向,如 12A Problem 5 → 10A Problem 13)→ 放进一个**独立的空文档**(不碰用户正在看的
 * 页面;图片不会去加载)→ 公式图还原成 LaTeX → Defuddle 转 markdown。
 */

import { getDefuddleBundle } from '../defuddle-bundle';
import { latexImagesToMath, collectLatexFigureSizes } from '../latex-images';
import type { LinkedAnswerRule } from './rules';

export interface FetchedPage {
  ok: boolean;
  why?: string;
  /** 重定向后的真实页面名 */
  title?: string;
  markdown?: string;
  /** 公式图 / 绘图显示尺寸 { 绝对地址: [宽, 高] } */
  imageSizes?: Record<string, [number, number]>;
}

export function generateMediaWikiFetchScript(rule: LinkedAnswerRule, pageTitle: string): string {
  const bundle = getDefuddleBundle();
  return `
    (async function() {
      try {
        var api = ${JSON.stringify(rule.fetch.apiPath)};
        var page = ${JSON.stringify(pageTitle)};
        var resp = await fetch(api + '?action=parse&format=json&prop=text&redirects=1&disablelimitreport=1&disableeditsection=1&page=' + encodeURIComponent(page), { credentials: 'same-origin' });
        if (!resp.ok) return JSON.stringify({ ok: false, why: 'HTTP ' + resp.status });
        var text = await resp.text();
        var data;
        try { data = JSON.parse(text); } catch (e) {
          return JSON.stringify({ ok: false, why: '返回的不是 JSON(可能被人机验证拦了):' + text.slice(0, 80) });
        }
        if (data.error) return JSON.stringify({ ok: false, why: (data.error.code || '') + ' ' + (data.error.info || '') });
        if (!data.parse || !data.parse.text) return JSON.stringify({ ok: false, why: 'api 返回里没有 parse.text' });
        var title = data.parse.title || page;

        var _defuddleModule = {};
        (function(module, exports) {
          ${bundle}
        })(_defuddleModule, _defuddleModule);
        var DefuddleClass = _defuddleModule.exports || _defuddleModule;
        if (DefuddleClass.default) DefuddleClass = DefuddleClass.default;

        var doc = document.implementation.createHTMLDocument(title);
        doc.body.innerHTML = '<article>' + data.parse.text['*'] + '</article>';
        // 相对 / 协议相对地址 → 绝对(独立文档没有 base,图片本地化要绝对地址)
        doc.querySelectorAll('img[src]').forEach(function(el) {
          try { el.setAttribute('src', new URL(el.getAttribute('src'), location.href).href); } catch (e) {}
        });
        doc.querySelectorAll('a[href]').forEach(function(el) {
          try { el.setAttribute('href', new URL(el.getAttribute('href'), location.href).href); } catch (e) {}
        });
        doc.querySelectorAll('#toc, .toc, .mw-editsection').forEach(function(el) { el.remove(); });
        (${latexImagesToMath.toString()})(doc);
        var imageSizes = (${collectLatexFigureSizes.toString()})(doc);

        var result = new DefuddleClass(doc, {
          url: location.origin + '/wiki/index.php?title=' + encodeURIComponent(title),
          markdown: true,
        }).parse();
        return JSON.stringify({ ok: true, title: title, markdown: result.content || '', imageSizes: imageSizes });
      } catch (err) {
        return JSON.stringify({ ok: false, why: (err && err.message) || String(err) });
      }
    })();
  `;
}
