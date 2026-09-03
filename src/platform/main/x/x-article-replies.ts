/**
 * 抓「某篇文章下的回复与引用」—— campaign-tasks 契约(§2)的数据来源。
 *
 * 业务:OTun-M 上线活动任务 2「在置顶文章下回复并附截图」。
 * 判定「有效留言」= kind ∈ {reply, quote} ∧ has_media ∧ !deleted ∧ 时间≥文章发布。
 * 判定在 campaign-tasks 侧做,本模块只**如实提供事实**。
 *
 * ⚠️ 与「某账号的时间线」不是一回事:
 *   时间线按作者取(UserTweets/UserRepliesTimeline);
 *   这里按**会话**取(TweetDetail)—— 打开文章详情页,X 会把整条 conversation
 *   连同各层回复一起下发,`conversation_id_str === article_id` 即属于本文章。
 *
 * ⚠️ 只用 role='campaign' 的 ws(用户 2026-09-03 拍板「一个 ws 只干一件事」)。
 *   跨角色复用会被定时搜索导航打断,现象是「活动偶尔抓不到」,极难定位。
 */

import { harvestTimeline, extractTweetsFrom, type HarvestedTweet } from './x-timeline-harvester';
import { resolveXWebContents, resolveAnyXWebContents } from './x-webcontents';
import { normalizeHandle } from '@shared/types/x-timeline-types';

/** 契约 §2.1 的一条 item(字段名保持契约原样,便于直接序列化) */
export interface ArticleReplyItem {
  tweet_id: string;
  kind: 'reply' | 'quote';
  x_uid?: string;
  username: string;
  has_media: boolean;
  created_at: string;
  in_reply_to_tweet_id?: string;
  text_excerpt?: string;
}

export interface ArticleRepliesResult {
  articleId: string;
  items: ArticleReplyItem[];
  /** 本次翻到的条目总数(含不属于本文章的,契约 §3.3 的 fetched) */
  fetched: number;
  /** 命中 hint 的那个人(接口 B 用) */
  hintFound: boolean;
  /** 因 budget 提前返回 */
  partial: boolean;
  elapsedMs: number;
  problems: string[];
}

/**
 * 把 harvester 的产出转成契约 item。
 *
 * 归属判定:`conversationId === articleId` 或直接回复了文章本身。
 * ⚠️ **排除文章自己**(tweetId === articleId)—— 它不是"留言"。
 * ⚠️ **排除 DOM 兜底来源**:DOM 分不清用户上传的图与外链预览卡,
 *    has_media 会不可信,而这个字段直接决定发不发奖励(见 harvester 注释)。
 */
export function toContractItems(
  tweets: HarvestedTweet[],
  articleId: string,
  selfHandle?: string,
): ArticleReplyItem[] {
  const items: ArticleReplyItem[] = [];
  for (const t of tweets) {
    if (t.tweetId === articleId) continue;                 // 文章本身
    if (t.fromDom) continue;                               // has_media 不可信
    if (!t.authorHandle || !t.createdAt) continue;         // 契约必填缺失

    // 自己的回复不算参与(活动是给用户发奖励)
    if (selfHandle && normalizeHandle(t.authorHandle) === normalizeHandle(selfHandle)) continue;

    const isReply = t.conversationId === articleId || t.inReplyToStatusId === articleId;
    const isQuote = t.quotedStatusId === articleId;
    if (!isReply && !isQuote) continue;

    items.push({
      tweet_id: t.tweetId,
      // 同时满足两者时按 reply 记(契约 §4:两种都算,不影响判定)
      kind: isReply ? 'reply' : 'quote',
      x_uid: t.authorRestId,
      username: normalizeHandle(t.authorHandle),
      has_media: t.hasMedia,
      created_at: new Date(t.createdAt).toISOString(),
      in_reply_to_tweet_id: t.inReplyToStatusId,
      text_excerpt: t.text ? t.text.slice(0, 200) : undefined,
    });
  }
  return items;
}

/**
 * 抓一篇文章的回复与引用。
 *
 * @param articleId 文章(置顶 post)的 id
 * @param authorHandle 文章作者(拼详情页 URL 用),即本账号
 * @param opts.hint 正在等结果的用户 —— 翻到就可以提前结束(契约 §3.1)
 * @param opts.budgetMs 时间预算,超了返回 partial(契约 §3.1)
 */
export async function fetchArticleReplies(
  articleId: string,
  authorHandle: string,
  targetWcId?: number,
  opts: { hint?: { x_uid?: string; username?: string }; budgetMs?: number } = {},
): Promise<ArticleRepliesResult | { error: string }> {
  const started = Date.now();
  const h = normalizeHandle(authorHandle);
  if (!articleId) return { error: 'articleId required' };
  if (!h) return { error: 'authorHandle required' };

  // ⚠️ 用无人值守版本:campaign 的 /refresh 是外部随时敲进来的,
  // 那台机器上不会有人一直守着 X 页面(wcId 随界面卸载被清掉,实测 503)。
  const resolved = resolveAnyXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const url = `https://x.com/${h}/status/${articleId}`;
  const budgetMs = opts.budgetMs ?? 45_000;
  const hintUid = opts.hint?.x_uid;
  const hintName = opts.hint?.username ? normalizeHandle(opts.hint.username) : undefined;

  // ⚠️ **不复用 harvestTimeline**(2026-09-03 实测踩到:
  //    「翻到 42 条 → 属于本文章 0 条」,而且日期空洞跨 48 天 ——
  //    那是时间线滚动器的行为:它为「把某人的历史翻完」设计,
  //    在详情页上会一路滚进推荐流/相关推文,抓回一堆无关内容。
  //    用户点明正确做法:「点击这个推文,往下翻页,最新的回复就够了」。)
  //
  // 详情页的接口是 **TweetDetail**(时间线是 UserTweets/HomeTimeline),
  // 载荷勘查记录里从未出现过 TweetDetail —— 印证此前根本没落到详情页数据上。
  const tweets = new Map<string, HarvestedTweet>();
  const pending = new Map<string, string>();
  let payloads = 0;
  let detailPayloads = 0;
  const problems: string[] = [];

  const onMessage = (_e: unknown, method: string, params: any): void => {
    if (method === 'Network.requestWillBeSent') {
      const u: string = params?.request?.url ?? '';
      if (u.includes('/i/api/graphql/')) pending.set(params.requestId, u);
      return;
    }
    if (method === 'Network.loadingFinished') {
      const u = pending.get(params.requestId);
      if (!u) return;
      pending.delete(params.requestId);
      wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
        .then((r: any) => {
          if (!r?.body) return;
          payloads++;
          // 只吃详情页的响应 —— 侧边推荐、谁可以关注等接口一律不要
          if (u.includes('TweetDetail')) detailPayloads++;
          try { extractTweetsFrom(JSON.parse(r.body), tweets); } catch { /* 非 JSON */ }
        })
        .catch(() => { /* 响应体可能已丢弃 */ });
    }
  };

  let attached = false;
  try { wc.debugger.attach('1.3'); attached = true; }
  catch { /* 已被 attach,共用即可 */ }
  wc.debugger.on('message', onMessage);
  await wc.debugger.sendCommand('Network.enable').catch(() => {});

  let partial = false;
  try {
    wc.loadURL(url);

    // ⚡ 用户 2026-09-03:「1 秒可以完成入库」—— 对。
    // **第一个 TweetDetail 响应就已经带着回复**,不必先等固定 4.5s 再滚。
    // 改为轮询等首个 detail 响应(每 200ms 探一次,最多 8s),到了立刻可用。
    const firstDetailDeadline = Date.now() + 8_000;
    while (detailPayloads === 0 && Date.now() < firstDetailDeadline) {
      await new Promise((r) => setTimeout(r, 200));
    }

    // 往下翻页取回复。**只翻回复区**,靠三个判据停,不做时间线那种长途滚动:
    //  ① 本文章的条目不再增长(回复翻完了)
    //  ② hint 命中(契约 §3.1:翻到那个人就不用抓完)
    //  ③ budget 到点(契约要求宁可 partial 也不干等)
    let noGrowth = 0;
    let lastOwn = 0;
    // 详情页回复量有限。首个响应通常就够(1 秒内),多翻几轮只为拿更多历史回复;
    // 「最新的够了」是用户定的判据,所以轮次上限保守设小。
    const MAX_ROUNDS = 12;
    for (let i = 1; i <= MAX_ROUNDS; i++) {
      if (Date.now() - started >= budgetMs) { partial = true; break; }

      const own = toContractItems([...tweets.values()], articleId, h);
      if (hintUid || hintName) {
        const hit = own.some((it) =>
          (hintUid && it.x_uid === hintUid) || (hintName && it.username === hintName));
        if (hit) break;
      }

      if (own.length === lastOwn) {
        noGrowth++;
        if (noGrowth >= 4) break;             // 连续 4 轮没有新的本文章回复 → 翻完了
      } else {
        noGrowth = 0;
        lastOwn = own.length;
      }

      await wc.executeJavaScript(`(function () {
        var y = window.scrollY;
        window.scrollBy(0, window.innerHeight * 0.8);
        if (window.scrollY === y) {
          var all = document.querySelectorAll('div');
          for (var k = 0; k < all.length; k++) {
            var el = all[k];
            if (el.scrollHeight > el.clientHeight + 400) {
              el.scrollTop = el.scrollTop + el.clientHeight * 0.8; break;
            }
          }
        }
      })()`).catch(() => {});
      await new Promise((r) => setTimeout(r, 1600 + Math.random() * 900));
    }
  } finally {
    wc.debugger.off('message', onMessage);
    if (attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }
  }

  // fail loud:一个 TweetDetail 都没捕到,说明没落到详情页数据上 ——
  // 此时「属于本文章 0 条」是**采集失败**,不是「真的没人回复」,必须区分开。
  if (detailPayloads === 0) {
    problems.push(`未捕获到 TweetDetail 响应(共 ${payloads} 个 GraphQL 响应)`
      + ` —— 可能是页面没加载出来/登录态失效/该帖不可见,而**不是**没人回复`);
  }

  const items = toContractItems([...tweets.values()], articleId, h);
  const hintFound = !!(hintUid || hintName) && items.some((i) =>
    (hintUid && i.x_uid === hintUid) || (hintName && i.username === hintName));

  return {
    articleId,
    items,
    fetched: tweets.size,
    hintFound,
    partial,
    elapsedMs: Date.now() - started,
    problems,
  };
}

/**
 * 解析推文链接 → { handle, tweetId }。
 *
 * 用户 2026-09-03:「置顶帖的自动监测有问题,不如让用户自动填写
 *   https://x.com/OTun_MyVPN/status/2092213139139854555?s=20 这样的帖子链接?」
 * → 对。自动探测是我在猜你要哪一篇;链接是你手里现成的东西,解析它是确定性的。
 *
 * ⚠️ 顺带解决一个我漏掉的问题:链接里的 handle 可能**不是当前登录账号**
 *   (示例里是 OTun_MyVPN,而 is_self 是 netlab2gfw)。此前代码用 is_self
 *   拼详情页 URL,抓别的账号的文章就会拼错。改为**以链接里的 handle 为准**。
 *
 * 兼容形态:x.com / twitter.com、带 ?s=20 等查询参数、末尾斜杠、/i/status/xxx。
 */
export function parseTweetUrl(input: string): { handle?: string; tweetId: string } | { error: string } {
  const raw = (input || '').trim();
  if (!raw) return { error: '链接为空' };

  // 纯数字 id 也接受(用户可能只贴 id)
  if (/^\d{5,25}$/.test(raw)) return { tweetId: raw };

  let u: URL;
  try {
    u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return { error: `无法解析为链接:${raw.slice(0, 60)}` };
  }
  if (!/(^|\.)(x\.com|twitter\.com)$/i.test(u.hostname)) {
    return { error: `不是 X 链接(host=${u.hostname})` };
  }

  const segs = u.pathname.split('/').filter(Boolean);
  const si = segs.findIndex((x) => x === 'status' || x === 'statuses');
  if (si < 0 || !segs[si + 1]) return { error: '链接里找不到 /status/<id>' };

  const tweetId = segs[si + 1].replace(/\D+$/, '');
  if (!/^\d{5,25}$/.test(tweetId)) return { error: `id 形态不对:${segs[si + 1]}` };

  // /i/status/xxx 这种没有 handle
  const first = segs[0];
  const handle = first && first !== 'i' && si > 0 ? normalizeHandle(first) : undefined;
  return { handle, tweetId };
}

/**
 * 探测本账号发过的 Article,供 UI 下拉选择。
 *
 * 用户 2026-09-03:「建议你在 UI 上做一个配置项,我自己设定,而不是受制于你」
 * → 所以这里只**列出候选**,选哪一篇由用户在界面上定,代码不猜、不写死默认值。
 *
 * 依据:载荷里带 `article` 字段的推就是 Article(实测抓到 2 篇)。
 */
export async function listOwnArticles(
  authorHandle: string,
  targetWcId?: number,
): Promise<Array<{ tweetId: string; text: string; createdAt?: string }> | { error: string }> {
  const h = normalizeHandle(authorHandle);
  if (!h) return { error: 'authorHandle required' };

  // Articles 有独立标签页,直接取,比翻整个时间线快
  const r = await harvestTimeline(`https://x.com/${h}/articles`, targetWcId, 30);
  if ('error' in r) return { error: r.error };

  return r.tweets
    .filter((t) => t.authorHandle && normalizeHandle(t.authorHandle) === h)
    .map((t) => ({
      tweetId: t.tweetId,
      text: (t.text || '').slice(0, 80),
      createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : undefined,
    }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}
