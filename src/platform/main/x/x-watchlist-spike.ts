/**
 * B' 期 spike —— 实机确认「怎么抓到某人的推文 + 回复」。
 *
 * ⚠️ 这是**一次性诊断工具,不是产品代码**。B' 实施定稿后应删除或收编。
 *
 * 为什么必须 spike(交接文档 §4.1):
 *   X 的搜索语法易变,`include:replies` / `filter:replies` / `to:` 行为不同且会变,
 *   方案书里写的语法**不可信**。照文档假设写代码 = 拿没验证的前提当地基。
 *
 * 本工具做两件事,都只**读取并如实汇报**,不写库、不改任何状态:
 *
 *   ① 语法对照:同一个 handle 跑多种搜索写法,报告各自抓到多少条、其中多少条是回复。
 *      判据 —— 能把「回复」抓出来的那个写法才是对的。
 *   ② DOM 探针:在当前页面上对照多种「这条是回复吗」的判定方式。
 *      起因:实测库里 856 行 in_reply_to **全为 NONE**,怀疑现有选择器
 *      (socialContext)取的根本不是「Replying to」——socialContext 是
 *      「xx 转推了 / 已置顶」那条横幅。若属实,watchlist 抓回来也标不出回复。
 *
 * 用法:UI「B' spike」按钮 → 结果打进日志和返回值,由人判读后再定实现。
 */

import { resolveXWebContents } from './x-webcontents';
import { normalizeHandle } from '@shared/types/x-timeline-types';

/** 待验证的搜索写法。每条都是一个候选,由实机结果裁决,不预设赢家。 */
export const SYNTAX_CANDIDATES = [
  { key: 'bare',            build: (h: string) => `from:${h}` },
  { key: 'include_replies', build: (h: string) => `from:${h} include:replies` },
  { key: 'filter_replies',  build: (h: string) => `from:${h} filter:replies` },
  { key: 'to_only',         build: (h: string) => `to:${h}` },
] as const;

export interface SyntaxProbeResult {
  key: string;
  query: string;
  url: string;
  /** 页面上抓到的 article 条数 */
  articles: number;
  /** 其中被判定为「回复」的条数(按 DOM 探针的最佳判据) */
  replies: number;
  /** 抓到的前几条摘要,供人肉核对 */
  samples: Array<{ handle: string; isReply: boolean; replyingTo: string | null; text: string }>;
  error?: string;
}

/**
 * DOM 探针:在**当前已加载的搜索结果页**上,对每条 article 用多种方式判断是否为回复。
 *
 * 三种判据同时汇报,便于看出哪个可信:
 *  a) socialContext —— 现有代码在用的(疑似取错,见文件头)
 *  b) 「Replying to / 回复」提示行 —— X 在回复推上方渲染的文本
 *  c) article 内是否存在指向他人 status 的前置链接
 */
const PROBE_JS = `(function () {
  var arts = document.querySelectorAll('article[data-testid="tweet"]');
  var out = { articles: arts.length, samples: [], counts: { social: 0, replyingTo: 0, anyReply: 0 } };

  for (var i = 0; i < arts.length; i++) {
    var a = arts[i];
    var handle = '';
    try {
      var un = a.querySelector('[data-testid="User-Name"]');
      if (un) {
        var sp = un.querySelectorAll('span');
        for (var j = 0; j < sp.length; j++) {
          var t = (sp[j].textContent || '').trim();
          if (t.indexOf('@') === 0) { handle = t; break; }
        }
      }
    } catch (e) {}

    // (a) 现有写法:socialContext
    var social = null;
    try {
      var sc = a.querySelector('[data-testid="socialContext"]');
      if (sc) social = (sc.textContent || '').trim();
    } catch (e) {}

    // (b) 「Replying to @xxx」提示行 —— X 用一个含 @ 链接的行渲染
    var replyingTo = null;
    try {
      var txt = (a.textContent || '');
      // 中英两种界面语言
      var m = txt.match(/(?:Replying to|回复)\\s*(@[A-Za-z0-9_]+)/);
      if (m) replyingTo = m[1];
    } catch (e) {}

    var isReply = !!replyingTo;
    if (social) out.counts.social++;
    if (replyingTo) out.counts.replyingTo++;
    if (isReply) out.counts.anyReply++;

    if (out.samples.length < 5) {
      var body = '';
      try {
        var te = a.querySelector('[data-testid="tweetText"]');
        body = te ? (te.textContent || '').slice(0, 60) : '';
      } catch (e) {}
      out.samples.push({
        handle: handle, isReply: isReply, replyingTo: replyingTo,
        social: social, text: body
      });
    }
  }
  return out;
})()`;

async function waitForArticles(wc: Electron.WebContents, timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await wc.executeJavaScript(
      `document.querySelectorAll('article[data-testid="tweet"]').length`,
    ) as number;
    if (typeof n === 'number' && n > 0) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

/**
 * 对一个 handle 跑全部候选语法,逐个导航 → 等结果 → 探针。
 *
 * ⚠️ 会**占用前台 X webview** 逐条导航(每条约 3-8 秒),spike 期间别同时操作 X。
 * 结束后停在最后一条的结果页,不自动跳回。
 */
export async function runWatchlistSpike(
  handle: string,
  targetWcId?: number,
): Promise<{ handle: string; results: SyntaxProbeResult[] } | { error: string }> {
  const h = normalizeHandle(handle);
  if (!h) return { error: 'empty handle' };

  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const results: SyntaxProbeResult[] = [];

  for (const cand of SYNTAX_CANDIDATES) {
    const query = cand.build(h);
    const url = `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;
    console.log(`[x-watchlist-spike] === ${cand.key} === ${query}`);

    try {
      wc.loadURL(url);
      const ok = await waitForArticles(wc);
      if (!ok) {
        results.push({ key: cand.key, query, url, articles: 0, replies: 0, samples: [],
          error: '超时:12s 内没出现推文元素(可能是无结果,也可能被限流)' });
        console.log(`[x-watchlist-spike] ${cand.key}: NO ARTICLES`);
        continue;
      }

      const probe = await wc.executeJavaScript(PROBE_JS) as {
        articles: number;
        counts: { social: number; replyingTo: number; anyReply: number };
        samples: Array<{ handle: string; isReply: boolean; replyingTo: string | null; social: string | null; text: string }>;
      };

      results.push({
        key: cand.key, query, url,
        articles: probe.articles,
        replies: probe.counts.replyingTo,
        samples: probe.samples.map((s) => ({
          handle: s.handle, isReply: s.isReply, replyingTo: s.replyingTo, text: s.text,
        })),
      });

      console.log(`[x-watchlist-spike] ${cand.key}: ${probe.articles} 条, `
        + `其中回复 ${probe.counts.replyingTo} 条 `
        + `(socialContext 命中 ${probe.counts.social} 条 —— 若两数不等,说明现有选择器取错了)`);
    } catch (err) {
      results.push({ key: cand.key, query, url, articles: 0, replies: 0, samples: [],
        error: String(err) });
      console.error(`[x-watchlist-spike] ${cand.key} failed:`, err);
    }
  }

  return { handle: h, results };
}
