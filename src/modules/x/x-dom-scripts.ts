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

import type { RegisteredScript, ScriptId, ScriptParams } from '@platform/main/web-capability/dom/types';

/** ⭐ 本模块的脚本 id —— 与注册表同一份常量,不各写一份 */
export const X_SCRIPTS = {
  /** 点开当前页所有折叠的推文,并回读展开后的全文 */
  expandAll: 'x.expandAllTweetText' as ScriptId,
  /**
   * ⭐⭐ **探针** —— 「进单篇页再返回」这条路走不走得通,只有真机答得出。
   * ⚠️ 它**不采集任何数据**,只回报现场:history 深度、滚动位置、URL。
   */
  navProbe: 'x.navBackProbe' as ScriptId,
  /**
   * ⭐⭐ 在**他的主页**上取关(2026-10-10,用户取消了「不由程序点按钮」的红线)。
   * 模拟人的操作:点 Following → 确认框点 Unfollow → 等按钮变回 Follow 才算成。
   * ⚠️ 按钮按**他的数字 id** 定位(`<id>-unfollow`),不会点到页面上别人的按钮。
   * ⚠️ 依赖 X 的页面标记,真机才验得出;哪一步卡住就如实报哪一步。
   */
  unfollow: 'x.unfollowOnProfile' as ScriptId,
  /**
   * ⭐⭐⭐ **滚不动时跳到最后一张卡片** —— 虚拟列表的抢救动作。
   *
   * ── 用户 2026-09-19 原话 ──
   * > 「如果校验发现没有滚动就往下一个位置去采集数据。
   * >   这样才对吧,而不是盲目采集直到出问题都不懂」
   *
   * ⚠️⚠️ X 的名单是虚拟列表:滚过去的 DOM 会被删掉,
   * 「滚不动」常常**不是到底了,而是新内容还没渲染**。
   * ⭐ `scrollIntoView` 到最后一张卡片会**强制渲染它后面的内容**,
   * 比盲目 `scrollBy` 可靠(历史代码实测:250 → 2781)。
   */
  jumpToLastCard: 'x.jumpToLastCard' as ScriptId,
  /**
   * ⭐⭐⭐ **拿游标主动翻下一页** —— 搜索页滚动不翻页,只能自己发。
   * ⚠️ 这是**本仓第一个带参数的脚本**(URL 与游标是运行时值),
   * 参数走 `JSON.stringify`,绝不拼进脚本文本。
   */
  fetchNextPage: 'x.fetchNextPage' as ScriptId,
  /**
   * ⭐⭐ **认号**(2026-10-16,蓝V互关 M0)—— 这个 X 网页此刻登录的是哪个号。
   * 用户选 A:从页面认(左侧「个人资料」链接 + 账号切换按钮),不碰登录凭据。
   * ⚠️ 只读不点;两处标记原样回报,判断在 `x-account.ts::parseWhoAmI`。
   * ⚠️ data-testid 是 X 的页面结构,真机才验得出。
   */
  whoAmI: 'x.whoAmI' as ScriptId,
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


/**
 * ⭐⭐⭐ 「进去看完再返回」**探针** —— 2026-10-03
 *
 * ── 为什么需要它 ──
 * 用户 2026-10-02 原话:「但如果正常的人的浏览会怎么做呢?
 * 　**点击进去观看,观看完毕,点击返回上一下,继续往下浏览。**」
 *
 * 这条路比我原先提的「两阶段」(先扫完清单→再逐篇补)简单得多,因为
 * **浏览器的「后退」本来就负责恢复现场**。但它依赖两个前提:
 *
 *   ① 后退后**滚动位置自己回来**(否则还得重新滚到那里)
 *   ② 后退**不销毁页面** → 已装的两条腿(CDP + hook)还在
 *
 * ⚠️⚠️ 这两条我**只能推断,推断过的已经错过很多次**
 * (`feedback-dont-guess-look-at-real-data`;
 * 　`project-x-collect-two-legs`:CDP 通道的行为只有真机验得出来)。
 * ⭐ 所以先花一次真机跑把前提钉死,再决定编排怎么写 —— 别反过来。
 *
 * ⚠️ 本脚本**不导航**,只读现场。导航由编排层发起(后退要算在控制侧,
 * 页面内 `history.back()` 会绕过控制层的留痕)。
 *
 * 返回形状:`{ url, scrollY, historyLength, tweetCards, firstCardId }`
 *
 * ── ⚠️ 怎么读这几个数(2026-10-03 写明,免得误读)──
 * · `historyLength` **后退时不会减少** —— 它是条目总数,后退只移动位置。
 * 　 所以它只能看出「进去时有没有新增条目」(+1),**不能**当「后退成功」的判据。
 * · ⭐ 判「回到原处」要 `url` + `firstCardId` + `scrollY` **三个一起看**:
 * 　 单看 `scrollY` 会被「页面重新加载成另一批推文而位置碰巧相同」骗过。
 */
const NAV_PROBE_SCRIPT: string = [
  '(function () {',
  '  var cards = document.querySelectorAll(\'[data-testid="tweet"]\');',
  '  var firstId = "";',
  '  if (cards.length > 0) {',
  /**
   * ⭐ 拿第一张卡的推文 id —— 后退后对比它,就知道
   * 「回到的是不是原来那个位置」(光看 scrollY 不够:
   * 页面可能重新加载成了另一批推文而 scrollY 碰巧相同)。
   */
  '    var a = cards[0].querySelector(\'a[href*="/status/"]\');',
  '    if (a) {',
  '      var m = /\\/status\\/(\\d+)/.exec(a.getAttribute("href") || "");',
  '      if (m) firstId = m[1];',
  '    }',
  '  }',
  '  return {',
  '    url: location.href,',
  '    scrollY: window.scrollY,',
  '    historyLength: history.length,',
  '    tweetCards: cards.length,',
  '    firstCardId: firstId,',
  '  };',
  '})();',
].join('\n');


/**
 * ⭐⭐⭐ **主动翻下一页** —— 2026-10-04
 *
 * ── 为什么非有不可(三跑实测)──
 * 配方搜索每跑都只拿到 **1 条 `SearchTimeline`**,而:
 * · 不是噪音(挡掉 m3u8 后 6 条响应全干净,仍是 1 条)
 * · 不是滚动不够(21 条推文约 17000px,实际滚了 **47360px**,早在空滚)
 * · 不是结果就这么多(**报告写「翻页游标 1/1 页有」—— X 自己说还有下一页**)
 * ⭐ 对照:同样滚 4 万 px,**x.profile 出 43 条载荷、x.search 出 1 条** ——
 * 个人主页滚动会自动翻页,**搜索页不会**。这是 X 的页面差异。
 *
 * ── 怎么翻 ──
 * 拿**页面自己发过的那条请求**(URL 里带 queryId 与 features),
 * 在 `variables` 里塞 `cursor`,**在页面上下文里** fetch 一次。
 *
 * ⚠️⚠️ 必须在页面里发,不能从 Node 发 —— 登录态/CSRF 头都在页面这边。
 * ⭐ 发出去的响应**会被两条腿照常捕到**(fetch 被钩子覆盖、CDP 也看得见),
 * 所以这里**不需要把正文回传** —— 回传等于绕开采集链路再造一份。
 *
 * ⚠️ `queryId` 从**传进来的 URL 里现取**,不写死(随 X 版本变)。
 */
const FETCH_NEXT_PAGE_SCRIPT = (params: ScriptParams): string => {
  /**
   * ⚠️⚠️ 参数**一律 JSON.stringify** —— 这是
   * `project-x-inject-template-escape` 换来的那道闸:
   * 拼串时 `\/` 会被模板字面量吃掉 → 浏览器收到非法正则 →
   * **采集恒 0 而 tsc 与单测全绿**。
   */
  const url = JSON.stringify(String(params.url ?? ''));
  const cursor = JSON.stringify(String(params.cursor ?? ''));
  /**
   * ⭐⭐⭐ **原样重发 X 自己的请求头** —— 2026-10-06 真机:只带 cookie
   * 时游标翻页第 1 轮就 **HTTP 403**。X 的 GraphQL 还要
   * `authorization` 与 `x-csrf-token`。
   * ⚠️ 自己拼鉴权那条路本仓早否决过(token 会过期、随版本变),
   * 正确做法是**复用 X 刚发过的那条请求**。
   * ⚠️⚠️ 参数仍走 `JSON.stringify` 绑定,绝不拼进脚本文本
   * (`project-x-inject-template-escape` 那道闸)。
   */
  const headers = JSON.stringify(
    (params.headers ?? {}) as Record<string, string>,
  );
  return [
    '(function () {',
    '  var u = ' + url + ';',
    '  var c = ' + cursor + ';',
    '  var rawHeaders = ' + headers + ';',
    /**
     * ⚠️⚠️ **浏览器禁止脚本设置的头要剔掉** —— 否则整个 fetch 直接抛
     * (`Refused to set unsafe header`),表现成「翻页一轮都没跑」。
     * ⭐ cookie 由 `credentials:"include"` 自动带,不能也不需要手设。
     */
    '  var FORBIDDEN = ["host","cookie","content-length","connection",',
    '    "origin","referer","user-agent","accept-encoding","sec-fetch-mode",',
    '    "sec-fetch-site","sec-fetch-dest","sec-ch-ua","sec-ch-ua-mobile",',
    '    "sec-ch-ua-platform"];',
    '  var safeHeaders = {};',
    '  for (var hk in rawHeaders) {',
    '    if (FORBIDDEN.indexOf(String(hk).toLowerCase()) === -1) {',
    '      safeHeaders[hk] = rawHeaders[hk];',
    '    }',
    '  }',
    '  if (!u || !c) return { ok: false, why: "缺 url 或 cursor" };',
    '  try {',
    '    var parsed = new URL(u);',
    /** ⭐ variables 是 JSON 串,塞 cursor 再放回去 */
    '    var raw = parsed.searchParams.get("variables");',
    '    if (!raw) return { ok: false, why: "URL 里没有 variables" };',
    '    var vars = JSON.parse(raw);',
    '    vars.cursor = c;',
    '    var feats = parsed.searchParams.get("features");',
    /** ⭐ queryId 在**路径里**,从路径现取 —— 随 X 版本变,不写死 */
    '    var segs = parsed.pathname.split("/").filter(Boolean);',
    '    var op = segs[segs.length - 1];',
    '    var queryId = segs[segs.length - 2] || "";',
    '',
    /**
     * ⭐⭐⭐ **先按抄到的形状发(GET),404-非JSON 才换 POST 重试**。
     *
     * ⚠️⚠️ `project-x-cursor-paging` 实证:X 把这些 endpoint 改成**只认 POST**,
     * GET 一律 **404 + 空 body**,而 `queryId` 并没过期。
     * ⭐ 「404 + 空 body」是这个改动的**指纹** —— GraphQL 的业务错误
     * 一定带 JSON 说明;空 body 说明请求**根本没进 GraphQL handler**。
     *
     * ⚠️ 为什么不直接写死 POST:本机留痕显示 **X 自己用的就是 GET 且成功** ——
     * 写死等于拿别人的 issue 覆盖本机实测。
     * ⚠️ POST 不是「换个 method」:URL **不带 query string**,
     * 参数要搬进 body `{variables, features, queryId}`。
     */
    '    function asPost() {',
    '      var body = { variables: vars, queryId: queryId };',
    '      if (feats) { try { body.features = JSON.parse(feats); } catch (e) { void e; } }',
    '      return fetch(parsed.origin + parsed.pathname, {',
    '        method: "POST",',
    '        credentials: "include",',
    '        headers: Object.assign({}, safeHeaders, { "content-type": "application/json" }),',
    '        body: JSON.stringify(body),',
    '      });',
    '    }',
    '',
    '    parsed.searchParams.set("variables", JSON.stringify(vars));',
    /**
     * ⚠️ `credentials: "include"` 必须有 —— 少了它 X 当成未登录,
     * 回 401 而**不报错**,表现成「翻了但没数据」。
     */
    '    return fetch(parsed.toString(), { credentials: "include", headers: safeHeaders })',
    '      .then(function (r) {',
    '        return r.text().then(function (t) {',
    /**
     * ⭐ 只在**这个指纹**上重试:404 且响应体不是 JSON。
     * ⚠️ 业务错误(带 `errors[]` 的 JSON)重发一次还是错,
     * 还会把真正的错误信息盖掉。
     */
    '          var looksBlocked = r.status === 404 && t.trim().charAt(0) !== "{";',
    '          if (!looksBlocked) {',
    /**
     * ⭐⭐⭐ **把 body 原样带回来** —— 2026-10-06,照旧版 `buildRefetchScript` 改。
     *
     * ⚠️⚠️ 原先只回 `bytes`,正文全靠两条捕获腿兜着 ——
     * 于是「发了请求」和「拿到这一页」之间隔着一层异步,
     * 编排层只能**再跑一次 harvest** 去等响应,
     * 做不到旧版那种「一页 → 判断 → 下一页」的闭环。
     * ⭐ 旧版实测:30 次请求拿 2000+ 人,比滚动快几十倍。
     */
    '            return { ok: r.ok, status: r.status, bytes: t.length, shape: "GET", body: t };',
    '          }',
    '          return asPost().then(function (r2) {',
    '            return r2.text().then(function (t2) {',
    /** ⭐⭐ `shapeSwitched` 要留痕 —— 「X 的 GET 已不认」是外部事实,不留就随这跑消失 */
    '              return {',
    '                ok: r2.ok, status: r2.status, bytes: t2.length, body: t2,',
    '                shape: "POST", shapeSwitched: true,',
    '                why: "GET 被 X 挡下（404+非 JSON），改用 POST 形状重试",',
    '              };',
    '            });',
    '          });',
    '        });',
    '      })',
    '      .catch(function (e) { return { ok: false, why: String(e) }; });',
    '  } catch (e) {',
    '    return { ok: false, why: String(e) };',
    '  }',
    '})();',
  ].join('\n');
};

/** ⭐ 注册表 —— 由 `main.ts` 在启动时 push 给底座 */
/**
 * ⭐ 取关脚本 —— 参数(数字 id)走 JSON 绑定,且脚本里再校验只能是数字。
 * 返回 state:unfollowed / not-following / no-button / no-confirm / no-switch / bad-id / error
 */
const buildUnfollowScript = (params: Readonly<Record<string, unknown>>): string => {
  const id = JSON.stringify(String(params.restId ?? ''));
  return [
    '(function () {',
    '  return new Promise(function (resolve) {',
    '    try {',
    '      var id = ' + id + ';',
    "      if (!/^\\d+$/.test(id)) { resolve({ done: false, state: 'bad-id' }); return; }",
    // ⚠️ 选择器里同时有单双引号 —— 用反引号包这一行(本行没有 ${ 也没有反斜杠,原样输出)
    `      var q = function (suffix) { return document.querySelector('[data-testid="' + id + suffix + '"]'); };`,
    '      var waitFor = function (get, ms, then) {',
    '        var t0 = Date.now();',
    '        var tick = function () {',
    '          var el = get();',
    '          if (el) { then(el); return; }',
    '          if (Date.now() - t0 > ms) { then(null); return; }',
    '          setTimeout(tick, 200);',
    '        };',
    '        tick();',
    '      };',
    "      waitFor(function () { return q('-unfollow') || q('-follow'); }, 6000, function (btn) {",
    "        if (!btn) { resolve({ done: false, state: 'no-button' }); return; }",
    "        if (btn.getAttribute('data-testid') === id + '-follow') { resolve({ done: false, state: 'not-following' }); return; }",
    '        btn.click();',
    `        waitFor(function () { return document.querySelector('[data-testid="confirmationSheetConfirm"]'); }, 5000, function (ok) {`,
    "          if (!ok) { resolve({ done: false, state: 'no-confirm' }); return; }",
    '          ok.click();',
    "          waitFor(function () { return q('-follow'); }, 5000, function (after) {",
    "            resolve(after ? { done: true, state: 'unfollowed' } : { done: false, state: 'no-switch' });",
    '          });',
    '        });',
    '      });',
    "    } catch (e) { resolve({ done: false, state: 'error', why: String(e) }); }",
    '  });',
    '})();',
  ].join('\n');
};

export const X_DOM_SCRIPTS: readonly RegisteredScript[] = [
  {
    id: X_SCRIPTS.whoAmI,
    purpose: 'X:读这个网页此刻登录的号(个人资料链接 href + 账号切换按钮文字),只读不点',
    /** ⚠️ **无参数** —— 没有运行时值就没有拼串的机会(`inject-template-escape` 那道闸) */
    build: () => [
      '(function () {',
      '  try {',
      `    var a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');`,
      `    var b = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');`,
      "    return { profileHref: a ? a.getAttribute('href') || undefined : undefined,",
      "      switcherText: b ? (b.textContent || '').slice(0, 200) : undefined };",
      '  } catch (e) { return { why: String(e) }; }',
      '})();',
    ].join('\n'),
  },
  {
    id: X_SCRIPTS.unfollow,
    purpose: 'X:在他的主页上取关(点 Following → 确认 Unfollow → 等按钮变回 Follow)',
    build: buildUnfollowScript,
  },
  {
    id: X_SCRIPTS.expandAll,
    purpose: 'X:点开当前页所有折叠的推文(Show more)并回读展开后的全文',
    /**
     * ⚠️ **无参数** —— 这个脚本不需要任何运行时值,
     * 所以连拼串的机会都没有(那正是 `inject-template-escape` 的根因)。
     */
    build: () => EXPAND_ALL_SCRIPT,
  },
  {
    id: X_SCRIPTS.navProbe,
    purpose: 'X:读当前页现场(URL/滚动位置/history深度/首张卡id)—— 验「进去再返回」的前提',
    /** ⚠️ 同样**无参数**,只读不写 */
    build: () => NAV_PROBE_SCRIPT,
  },
  {
    id: X_SCRIPTS.jumpToLastCard,
    purpose: 'X:滚不动时跳到最后一张卡片,逼虚拟列表渲染后面的内容',
    /**
     * ⚠️ **无参数** —— 选择器是 X 的业务知识,写死在脚本里即可,
     * 没有运行时值就没有拼串的机会(`inject-template-escape` 那道闸)。
     *
     * ⭐⭐ 选择器按**从具体到通用**依次试:
     * `UserCell` 是人流名单的卡片(历史代码实测有效),
     * `article` 是推文流的;都没有才退回「滚到文档底」。
     * ⚠️ 返回值要说清**跳成功没有** —— 底座据此决定要不要再给一轮,
     * 恒回 true 会让「真到底」永远停不下来。
     */
    build: () => [
      '(function () {',
      '  try {',
      // ⚠️ CSS 属性值用**单引号**:外层 TS 字符串也是单引号时,
      // 反斜杠转义会原样发到浏览器(守卫当场逮到过)。用反引号包住最省事。
      `    var sels = ['[data-testid="UserCell"]', 'article[data-testid="tweet"]'];`,
      '    for (var i = 0; i < sels.length; i++) {',
      '      var cells = document.querySelectorAll(sels[i]);',
      '      var last = cells[cells.length - 1];',
      '      if (last && last.scrollIntoView) {',
      `        last.scrollIntoView({ block: 'end' });`,
      '        return { jumped: true, by: sels[i], count: cells.length };',
      '      }',
      '    }',
      /** ⚠️ 一张卡片都找不到:**如实回 false**,别假装抢救过 */
      '    var el = document.scrollingElement || document.documentElement;',
      '    var before = el.scrollTop;',
      '    el.scrollTop = el.scrollHeight;',
      `    return { jumped: el.scrollTop !== before, by: 'scrollHeight', count: 0 };`,
      '  } catch (e) { return { jumped: false, why: String(e) }; }',
      '})();',
    ].join('\n'),
  },
  {
    id: X_SCRIPTS.fetchNextPage,
    purpose: 'X:拿游标主动翻下一页(搜索页滚动不翻页) —— 在页面上下文里 fetch',
    /**
     * ⭐ **本仓第一个带参数的脚本**。参数(URL、游标)是运行时值,
     * 走 `JSON.stringify` 绑定 —— 绝不拼进脚本文本。
     */
    build: FETCH_NEXT_PAGE_SCRIPT,
  },
];
