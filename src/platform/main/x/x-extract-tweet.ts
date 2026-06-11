/**
 * X 推文提取(阶段 1)— 按 guest viewport 坐标定位 + 抓全字段
 *
 * 流程(铁律 1:直接抓当前前台 X webview,不开隐藏窗口):
 * 1. 按活跃 ws 定向取本 ws 的 X Host webContents(resolveXWebContents,收口 ②);
 *    未登记 / 已销毁 / 非 X 页 → fail loud(不再走全局 getActiveXWebContents)。
 * 3. 对该 webContents executeJavaScript:elementFromPoint(x,y) 向上 closest 到
 *    article[data-testid="tweet"],命中后用 tweet-fetcher 的 TWEET_SCRAPE_FN_BODY
 *    抓全字段(复用而非复制,铁律 1)。
 * 4. 没点中推文 / 抓到空(无 text 无 media)→ fail。
 *
 * 返 XExtractTweetResult,renderer 侧 x-commands 据 success 决定构造 tweetBlock 或 toast。
 */

import { resolveXWebContents } from './x-webcontents';
import { getXServiceProfile, type XServiceId } from '@shared/types/x-service-types';
import { TWEET_SCRAPE_FN_BODY } from '../tweet-fetcher/extract-script';

/** 抓到的推文字段(对齐 tweet-block schema attrs + tweet-fetcher TweetFetchData)*/
export interface XTweetData {
  authorName?: string;
  authorHandle?: string;
  authorAvatar?: string;
  text?: string;
  createdAt?: string;
  lang?: string;
  media?: Array<{ type: 'image' | 'video'; url: string; thumbUrl?: string }>;
  metrics?: { replies?: number; retweets?: number; likes?: number; views?: number };
  quotedTweet?: string;
  inReplyTo?: string;
  tweetUrl?: string;
  tweetId?: string;
}

export interface XExtractTweetResult {
  success: boolean;
  data?: XTweetData;
  error?: string;
}

/**
 * 构造在 X webContents 内执行的脚本:坐标定位 article → 复用 scrapeTweetArticle 抓字段。
 *
 * 返回值约定(供主进程区分失败原因,铁律 4):
 * - { __noTweet: true }            点中位置向上找不到推文 article
 * - tweet 字段对象(可能 text 空) 命中 article,字段尽力抓
 */
function buildExtractScript(x: number, y: number, tweetSelector: string): string {
  const sel = JSON.stringify(tweetSelector);
  return `
(function() {
  ${TWEET_SCRAPE_FN_BODY}
  try {
    var sel = ${sel};
    var el = document.elementFromPoint(${x}, ${y});
    var article = el && el.closest ? el.closest(sel) : null;
    // 回退:纵向 ±24px 邻域内找最近的 article(点在推文间隙时)
    if (!article) {
      var list = Array.prototype.slice.call(document.querySelectorAll(sel));
      var best = null, bestDist = Infinity;
      for (var i = 0; i < list.length; i++) {
        var rect = list[i].getBoundingClientRect();
        var dy = 0;
        if (${y} < rect.top) dy = rect.top - ${y};
        else if (${y} > rect.bottom) dy = ${y} - rect.bottom;
        var inside = ${y} >= rect.top - 24 && ${y} <= rect.bottom + 24;
        if ((inside || dy < 240) && dy < bestDist) { best = list[i]; bestDist = dy; }
      }
      article = best;
    }
    if (!article) return { __noTweet: true };
    return scrapeTweetArticle(article);
  } catch (e) {
    return { __noTweet: true, __error: String(e) };
  }
})()
`;
}

/**
 * 提取 (x,y) 坐标命中的推文。
 *
 * @param serviceId  X 服务 id(目前固定 'x')
 * @param x          guest viewport x
 * @param y          guest viewport y
 * @param targetWcId 本活跃 ws 的 X Host guest wcId(renderer x-host-registry 按活跃 ws 查出
 *   后透传;收口 ② 治多 X 实例串扰)。未命中 → fail loud,不回退全局 active。
 */
export async function extractTweetAt(
  serviceId: XServiceId,
  x: number,
  y: number,
  targetWcId?: number,
): Promise<XExtractTweetResult> {
  const got = resolveXWebContents(targetWcId);
  if ('error' in got) {
    return { success: false, error: got.error };
  }
  const wc = got.wc;

  const profile = getXServiceProfile(serviceId);
  let raw: unknown;
  try {
    raw = await wc.executeJavaScript(buildExtractScript(x, y, profile.selectors.tweetElement));
  } catch (err) {
    return { success: false, error: `提取脚本执行失败:${String(err)}` };
  }

  const obj = (raw ?? {}) as XTweetData & { __noTweet?: boolean };
  if (obj.__noTweet) {
    return { success: false, error: '没有点中推文 — 请在某条推文上右键' };
  }

  // 抓到空(既无正文也无媒体)→ fail loud,不塞空 block(铁律 4)
  const hasContent =
    (typeof obj.text === 'string' && obj.text.trim().length > 0) ||
    (Array.isArray(obj.media) && obj.media.length > 0);
  if (!hasContent) {
    return { success: false, error: '未能抓到推文内容(可能 X 改版或推文未加载完)' };
  }

  return { success: true, data: obj };
}
