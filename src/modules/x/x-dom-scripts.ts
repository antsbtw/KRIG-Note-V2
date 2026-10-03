/**
 * X 的 DOM 补全脚本 —— ⭐ **载荷拿不到的,去页面上拿**
 *
 * ── 用户 2026-09-22(旧实现原话,这次要兑现的就是它)──
 * 「不管长文短文,如果**折叠起来就应该 show all**,然后获取完整的内容,
 * 　就像人一样,但是现在却是分的零碎,却无法获取完整的内容。」
 *
 * ── ⚠️ 为什么非做不可(2026-10-02 实测)──
 *
 * 37 条推文里:
 * · 1 条正文被截断 —— 「X 根本就是全球社媒中最真实的软件…**坐过牢的、**」
 *   94 字就断了,而折叠时 `[data-testid="tweetText"]` 里**只有开头**,
 *   剩下的正文**压根没渲染**(不是 display:none)——
 *   所以「读 textContent」拿到的必然是截断版。
 * · 2 条长文正文只有 23 字的 t.co 短链(正文在单篇页,见 `X_ARTICLE_*`)
 *
 * ⚠️⚠️ **脚本一律走 `script-registry` 预注册**,参数由底座 `JSON.stringify` 绑定 ——
 * `project-x-inject-template-escape`:拼串时 `\\/` 被模板字面量吃掉 →
 * 浏览器收到非法正则 → **采集恒 0,而 tsc 与单测全绿**。
 */

import type { RegisteredScript, ScriptId } from '@platform/main/web-capability/dom/types';

/** ⭐ 本模块的脚本 id —— 与注册表同一份常量,不各写一份 */
export const X_SCRIPTS = {
  /** 点开当前页所有折叠的推文,并回读展开后的全文 */
  expandAll: 'x.expandAllTweetText' as ScriptId,
} as const;

/**
 * ⭐⭐ 展开 + 回读。
 *
 * ⚠️ 返回值形状:`{ expanded, tweets: [{ id, text }] }`
 * · `expanded` —— 这一趟点开了几个(0 = 本来就都是全的)
 * · `tweets`   —— **全部**推文的 id + 展开后正文(不只展开的那些),
 *   调用方按 id 比对「比载荷里的长吗」。
 *
 * ⚠️ 为什么回读全部而不只回读展开的那几条:
 * 点击是异步的,点完立刻读未必拿到新文本。回读全部 + 调用方按
 * 「**只许变长**」合并,就不依赖时序了(旧实现同一条底线)。
 */
const EXPAND_ALL_SCRIPT = [
  '(function () {',
  '  "use strict";',
  '  var out = { expanded: 0, tweets: [] };',
  '  try {',
  '    var arts = document.querySelectorAll(\'article[data-testid="tweet"]\');',
  '    for (var a = 0; a < arts.length; a++) {',
  '      var article = arts[a];',
  /**
   * ① X 的正式按钮 —— 有 testid,最稳。
   */
  '      try {',
  '        var btns = article.querySelectorAll(\'button[data-testid="tweet-text-show-more-link"]\');',
  '        for (var i = 0; i < btns.length; i++) { btns[i].click(); out.expanded++; }',
  '        if (btns.length === 0) {',
  //       ② 兜底:按文案找**按钮** —— ⚠️ 绝不匹配 a(外链,点了会离开页面)
  '          var cands = article.querySelectorAll(\'button, [role="button"]\');',
  '          for (var j = 0; j < cands.length; j++) {',
  '            var el = cands[j];',
  '            if (el.tagName === "A" || el.closest("a")) continue;',
  '            var t = (el.textContent || "").replace(/\\s+/g, " ").trim();',
  '            if (/^(Show more|显示更多|さらに表示|더 보기|Показать ещё)$/i.test(t)) {',
  '              el.click(); out.expanded++;',
  '            }',
  '          }',
  '        }',
  '      } catch (e) {}',
  /**
   * ③ 回读这条推的 id 与正文。
   * ⚠️ id 从状态链接取(`/status/<数字>`)—— DOM 上没有别的地方带 id。
   */
  '      try {',
  '        var id = "";',
  '        var links = article.querySelectorAll(\'a[href*="/status/"]\');',
  '        for (var k = 0; k < links.length; k++) {',
  '          var m = (links[k].getAttribute("href") || "").match(/\\/status\\/(\\d+)/);',
  '          if (m) { id = m[1]; break; }',
  '        }',
  '        var node = article.querySelector(\'[data-testid="tweetText"]\');',
  '        var text = node ? (node.innerText || node.textContent || "") : "";',
  '        if (id && text) out.tweets.push({ id: id, text: text });',
  '      } catch (e) {}',
  '    }',
  '  } catch (e) {}',
  '  return out;',
  '})();',
].join('\n');

/** ⭐ 注册表 —— 由 `main.ts` 在启动时 push 给底座 */
export const X_DOM_SCRIPTS: readonly RegisteredScript[] = [
  {
    id: X_SCRIPTS.expandAll,
    purpose: 'X:点开当前页所有折叠的推文(Show more)并回读展开后的全文',
    /**
     * ⚠️ **无参数** —— 这个脚本不需要任何运行时值,
     * 所以连拼串的机会都没有(那正是 `inject-template-escape` 的根因)。
     */
    build: () => EXPAND_ALL_SCRIPT,
  },
];
