/**
 * 搜索语法实机 spike —— 确认「怎么才能连回复一起搜到」。
 *
 * ⭐ 为什么必须实测:设计文档 §4.4⑤(a) 明令 ——
 *   「X 搜索语法对 `include:replies` 的支持时有变化,也有用 `filter:replies` / `to:`
 *     的写法。**实施前必须实机 spike 确认哪个真的有效**,不能照文档假设
 *     (参照 X selector 屡次改版的教训)。」
 *
 * 追踪名单(watchlist)靠它:名单建好了,但如果搜不到被追踪者的**回复**,
 * 就只能拿到他的原创推,「推文和回复都追」这个需求落不了地。
 *
 * 判据不是「有没有报错」而是**「结果里有没有真的回复」**:
 * 三种写法都不会报错,错的那种只是**静默地只返回原创推**——
 * 这正是最容易被当成「能用」的失败形态。
 */

import { resolveXWebContents } from './x-webcontents';
import { normalizeHandle } from '@shared/types/x-timeline-types';

/** 候选写法 —— 谁真的有效由实测说了算,不预设 */
export const SYNTAX_CANDIDATES = [
  { key: 'plain',            build: (h: string) => `from:${h}` },
  { key: 'include_replies',  build: (h: string) => `from:${h} include:replies` },
  { key: 'filter_replies',   build: (h: string) => `from:${h} filter:replies` },
] as const;

export interface SyntaxProbe {
  key: string;
  query: string;
  /** 搜到的推文条数 */
  total: number;
  /** 其中**是回复**的条数(正文以 @ 开头,或卡片上有「回复」标记) */
  replies: number;
  /** 页面是否明确报「没有结果」—— 语法非法时 X 常给这个 */
  noResults: boolean;
  sample: string[];
}

/**
 * 在当前 X webview 里依次跑三种写法,回报各自搜到多少条、其中多少是回复。
 *
 * ⚠️ 会占用该 ws 的 X webview(逐条导航),跑完请自行导航回去。
 * 只读:不点任何按钮、不发任何东西。
 */
export async function probeSearchSyntax(
  handle: string,
  targetWcId?: number,
): Promise<{ handle: string; probes: SyntaxProbe[]; verdict: string } | { error: string }> {
  const h = normalizeHandle(handle);
  if (!h) return { error: '需要一个 handle(建议选一个你知道他最近回复过别人的账号)' };

  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const probes: SyntaxProbe[] = [];

  for (const cand of SYNTAX_CANDIDATES) {
    const query = cand.build(h);
    const url = `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;
    console.log(`[search-syntax-spike] → ${query}`);
    wc.loadURL(url);

    // 等推文出现或「没有结果」提示出现,最多 15s
    const deadline = Date.now() + 15_000;
    let settled = false;
    while (Date.now() < deadline && !settled) {
      settled = await wc.executeJavaScript(`(function () {
        var arts = document.querySelectorAll('article[data-testid="tweet"]').length;
        var empty = document.body.innerText.indexOf('No results') >= 0
                 || document.body.innerText.indexOf('没有结果') >= 0;
        return arts > 0 || empty;
      })()`).catch(() => false) as boolean;
      if (!settled) await new Promise((r) => setTimeout(r, 700));
    }
    // 多等一轮让首屏渲染完整,否则计数偏低
    await new Promise((r) => setTimeout(r, 1500));

    const stat = await wc.executeJavaScript(`(function () {
      var arts = Array.prototype.slice.call(
        document.querySelectorAll('article[data-testid="tweet"]'));
      var out = { total: arts.length, replies: 0, sample: [], noResults: false };
      out.noResults = document.body.innerText.indexOf('No results') >= 0
                   || document.body.innerText.indexOf('没有结果') >= 0;
      for (var i = 0; i < arts.length; i++) {
        var t = arts[i].innerText || '';
        // X 的回复卡片会带「Replying to @xxx」/「回复 @xxx」这一行 ——
        // 比看正文是否以 @ 开头更准(正文里的 @ 可能只是提及)
        var isReply = t.indexOf('Replying to') >= 0 || t.indexOf('回复 @') >= 0;
        if (isReply) out.replies++;
        if (out.sample.length < 3) {
          out.sample.push((isReply ? '[回复] ' : '[原创] ') + t.slice(0, 80).replace(/\\n/g, ' '));
        }
      }
      return out;
    })()`).catch(() => null) as Omit<SyntaxProbe, 'key' | 'query'> | null;

    probes.push({
      key: cand.key,
      query,
      total: stat?.total ?? 0,
      replies: stat?.replies ?? 0,
      noResults: stat?.noResults ?? false,
      sample: stat?.sample ?? [],
    });
  }

  // 判据:能搜到回复、且总量没被打没的那个写法才算有效
  const plain = probes.find((p) => p.key === 'plain');
  const winners = probes.filter((p) => p.replies > 0 && !p.noResults);
  const verdict = winners.length === 0
    ? `三种写法都没搜到回复(plain 共 ${plain?.total ?? 0} 条)——`
      + '要么这个账号近期没回复过别人(换个人再试),要么 X 已不支持在搜索里带回复。'
    : `建议用 ${winners.map((w) => `${w.key}(回复 ${w.replies}/${w.total})`).join('、')}`;

  return { handle: h, probes, verdict };
}


/**
 * 实测「Replying to」那一行到底长什么样。
 *
 * ⭐ 起因(2026-09-06):我改了 DOM 提取器抓被回复者 handle,
 * 但实测 **search 采的 3782 条里只有 48 条有值**,而那 48 条是更早走载荷层拿到的
 * —— 说明我的 DOM 选择器**根本没命中**,又是"照猜写、没实测"。
 * (与 socialContext 那次同源:那次也是想当然地取了个错元素。)
 *
 * 这个探针把候选选择器逐个试一遍,报告各自命中多少、抓到什么,
 * 由实测决定用哪个 —— 而不是我再猜一版。
 */
export async function probeReplyContextDom(
  targetWcId?: number,
): Promise<{ total: number; probes: Array<{ how: string; hit: number; samples: string[] }> } | { error: string }> {
  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const got = await wc.executeJavaScript(`(function () {
    var arts = Array.prototype.slice.call(
      document.querySelectorAll('article[data-testid="tweet"]'));
    var out = { total: arts.length, probes: [] };
    function push(how, fn) {
      var hit = 0, samples = [];
      for (var i = 0; i < arts.length; i++) {
        try {
          var v = fn(arts[i]);
          if (v) { hit++; if (samples.length < 3) samples.push(String(v).slice(0, 60)); }
        } catch (e) {}
      }
      out.probes.push({ how: how, hit: hit, samples: samples });
    }
    // ① 我现在用的:div[dir] 且 textContent 以 Replying to 开头
    push('div[dir] startsWith(Replying to)', function (a) {
      var bs = a.querySelectorAll('div[dir]');
      for (var i = 0; i < bs.length; i++) {
        var t = bs[i].textContent || '';
        if (t.indexOf('Replying to') === 0) return t;
      }
      return null;
    });
    // ② 放宽:任何元素**包含**(不必开头)Replying to / 回复
    push('any el contains(Replying to|回复)', function (a) {
      var all = a.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var t = all[i].textContent || '';
        if ((t.indexOf('Replying to') >= 0 || t.indexOf('回复 @') >= 0) && t.length < 200) return t;
      }
      return null;
    });
    // ③ 整个 article 文本里有没有这串(判断"页面上到底有没有")
    push('article.innerText contains', function (a) {
      var t = a.innerText || '';
      return (t.indexOf('Replying to') >= 0 || t.indexOf('回复 @') >= 0) ? t.slice(0, 60) : null;
    });
    // ④ 结构法:正文之前是否有指向某人主页的链接
    push('a[href^=/] before tweetText', function (a) {
      var body = a.querySelector('[data-testid="tweetText"]');
      if (!body) return null;
      var links = a.querySelectorAll('a[href^="/"]');
      for (var i = 0; i < links.length; i++) {
        var h = links[i].getAttribute('href') || '';
        if (/^\\/[A-Za-z0-9_]{1,15}$/.test(h)
            && (links[i].compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          return h;
        }
      }
      return null;
    });
    return out;
  })()`).catch(() => null) as { total: number; probes: Array<{ how: string; hit: number; samples: string[] }> } | null;

  if (!got) return { error: '页面上取不到推文(先切到 X 并加载一个含回复的页面)' };
  return got;
}
