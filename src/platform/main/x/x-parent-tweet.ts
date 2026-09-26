/**
 * 取「上一层」—— 回复所在楼的父推正文。
 *
 * ⭐ 用户 2026-09-06 定的回复链条:
 *   「先追踪这个帖子的上一层的内容(**确保它和 VPN 相关**),
 *     再确认这个用户的活跃度,最后才能拟定出比较好的回复内容。」
 *
 * ① 是**正确性闸门**,不是锦上添花:一条「我也想要」「+1」放在
 * 卖手办的楼里和放在求 VPN 的楼里,意思完全不同 —— 只看这一条根本判不出来。
 *
 * ## 为什么是「B 兜底」
 *
 * A(采集时顺带存)管**将来**,但存量推没有上文;而且 DOM 层只拿得到
 * 被回复者 handle,拿不到父推 id(载荷层才有)。
 * 所以回复时若发现「这是条回复但没有上文」,就现抓一次 —— 代价是多几秒。
 *
 * ⚠️ **只对真的是回复的推抓**:独立求助推本来就没有上文,
 * 为它们白跑一次导航是纯浪费(实测收件箱里绝大多数是独立求助推)。
 */

import { resolveXWebContents } from './x-webcontents';
import { normalizeHandle } from '@shared/types/x-timeline-types';

export interface ParentTweet {
  /** 父推正文 —— ⚠️ 紧邻那一条(向后兼容:老调用方只认这个字段) */
  text: string;
  authorHandle?: string;
  /** 从哪拿到的,便于排查 */
  via: 'thread-page';
  /**
   * ⭐⭐ **整段上文** —— 由近及远(`[0]` 就是 `text` 那条)。
   *
   * ── 用户 2026-09-26 ──
   * > 「获取这条推文上下文 10～20 条」
   * > 「是否做变量---届时该起来容易」
   *
   * ⭐ 代价几乎为零:X 的 status 页**本来就把整条会话链渲染出来了**,
   * 多读几条是**同一次导航**里的事,不用多跳页。
   * (原实现只读了 `arts[idx-1]` 这一条,不是拿不到。)
   */
  context: Array<{ text: string; authorHandle?: string }>;
}

/** ⭐ 默认往上取几条 —— 变量,不写死在实现里 */
export const DEFAULT_CONTEXT_DEPTH = 1;

/**
 * 打开这条推的详情页,读它**上面的 N 条**(即这一楼的上文)。
 *
 * X 的 status 页会把整条会话链按顺序渲染成 article 列表,
 * 目标推**之前**的那些就是上文。
 *
 * ── 深度为什么是变量(2026-09-26 改)──
 * 原来写死「取紧邻一条」,理由是「再往上对**判断**『这楼是不是 VPN 相关』
 * 通常没有增量」—— ⚠️ 那是**判断层**的需求。
 * 而**拟回复**要的是语境:回一句「我也遇到过」得知道整楼在聊什么。
 * ⭐ 两个消费者要的深度不同,所以深度归调用方定,不归这里定。
 *
 * ⚠️ fail loud:抓不到返回 null,由调用方决定要不要继续 ——
 * **绝不编一个空上文**,那会让模型以为「上文是空的」而不是「没拿到」。
 *
 * @param depth 往上取几条(≥1)。1 = 老行为(只取紧邻那条)。
 */
export async function fetchParentTweet(
  tweetUrl: string,
  targetWcId?: number,
  budgetMs = 10_000,
  depth = DEFAULT_CONTEXT_DEPTH,
): Promise<ParentTweet | null> {
  if (!tweetUrl) return null;
  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return null;
  const wc = resolved.wc;

  const idMatch = tweetUrl.match(/status\/(\d+)/);
  if (!idMatch) return null;
  const targetId = idMatch[1];

  wc.loadURL(tweetUrl);

  const deadline = Date.now() + budgetMs;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    ready = await wc.executeJavaScript(
      `document.querySelectorAll('article[data-testid="tweet"]').length > 0`,
    ).catch(() => false) as boolean;
    if (!ready) await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) return null;
  // 会话链是逐段渲染的,等一拍让上文也进 DOM
  await new Promise((r) => setTimeout(r, 1200));

  const got = await wc.executeJavaScript(`(function () {
    var arts = Array.prototype.slice.call(
      document.querySelectorAll('article[data-testid="tweet"]'));
    // 找到目标推所在的位置:它的时间链接 href 里带自己的 id
    var idx = -1;
    for (var i = 0; i < arts.length; i++) {
      var a = arts[i].querySelector('a[href*="/status/${targetId}"]');
      if (a) { idx = i; break; }
    }
    // 目标推不在首位 → 它前面那些就是上文
    if (idx <= 0) return null;
    function readOne(art) {
      var textEl = art.querySelector('[data-testid="tweetText"]');
      var nameEl = art.querySelector('[data-testid="User-Name"]');
      var handle = '';
      if (nameEl) {
        var spans = nameEl.querySelectorAll('span');
        for (var j = 0; j < spans.length; j++) {
          var t = (spans[j].textContent || '').trim();
          if (t.charAt(0) === '@') { handle = t; break; }
        }
      }
      return {
        text: textEl ? (textEl.innerText || '') : '',
        authorHandle: handle,
      };
    }
    /**
     * ⭐ 由近及远:[0] 是紧邻那条。
     * ⚠️ 取到楼顶就停(idx-depth 可能为负,用 Math.max 夹住)——
     * 不足 depth 条**不是错误**,这楼本来就只有这么深。
     */
    var out = [];
    var from = Math.max(0, idx - ${Math.max(1, Math.floor(depth))});
    for (var k = idx - 1; k >= from; k--) out.push(readOne(arts[k]));
    return out;
  })()`).catch(() => null) as Array<{ text?: string; authorHandle?: string }> | null;

  /**
   * ⚠️ **丢掉空正文的那些**(纯图片/纯视频推没有 tweetText)——
   * 留着会让上文里出现空条目,模型读到的是「有一条但没内容」。
   */
  const ctx = (got ?? [])
    .map((r) => ({
      text: (r.text ?? '').trim(),
      authorHandle: r.authorHandle ? normalizeHandle(r.authorHandle) : undefined,
    }))
    .filter((r) => r.text);

  if (ctx.length === 0) return null;   // 拿不到就说拿不到,不返回空壳
  return {
    /** ⚠️ 向后兼容:老调用方只读 text,给它紧邻那条 */
    text: ctx[0].text,
    authorHandle: ctx[0].authorHandle,
    via: 'thread-page',
    context: ctx,
  };
}
