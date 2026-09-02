/**
 * 回复关系采集 —— 拦截 X 的 GraphQL 响应,取出权威回复字段。
 *
 * 业务定位(用户 2026-09-02):主线是「找到需要买 VPN 的人 → **回复他们**
 * → 跟踪点击 → 按买/没买分流画像」。回复关系是这条主线的第一环。
 *
 * 为什么走 CDP 而不是 DOM:
 *   X 在 `/with_replies` 页面**不渲染**「Replying to」文本(用视觉连接线表示),
 *   而 GraphQL 响应的 legacy 对象里带着完整权威字段。实测证据见
 *   docs/10-business-design/x/data-acquisition-capability-survey.md §2.4。
 *   → 从 DOM 猜是舍近求远,且必然有损。
 *
 * ⚠️ 本模块**只采回复关系**,不替换主采集链路(用户已拍板:CDP 全面换轨单独排期)。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { resolveXWebContents } from './x-webcontents';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import { saveAuthorCounts, getAuthorCounts } from '../db/x-author-repo';
import { backfillRepliedFromRelations, saveReplyRelations, saveOwnReplies,
  getOwnReplyCoverage, getCollectCursor, saveCollectCursor,
  type ReplyRelation, type OwnReply } from '../db/x-reply-relation-repo';

/**
 * 从响应里取出 X 自己给的分页游标。
 *
 * 用户 2026-09-02:「其实 X 上有很多标记,你要善于利用。」—— 这就是那个标记:
 * content.__typename = 'TimelineTimelineCursor',cursorType = 'Top' | 'Bottom'。
 * Bottom 即「下一页从这里继续」,是 X 自己的续传凭证,比拿时间戳猜边界精确。
 */
function extractBottomCursor(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = extractBottomCursor(item);
      if (r) return r;
    }
    return undefined;
  }
  const o = node as Record<string, unknown>;
  const isCursor = o.__typename === 'TimelineTimelineCursor'
    || o.entryType === 'TimelineTimelineCursor';
  if (isCursor && o.cursorType === 'Bottom' && typeof o.value === 'string') return o.value;
  for (const v of Object.values(o)) {
    const r = extractBottomCursor(v);
    if (r) return r;
  }
  return undefined;
}

/**
 * 从 UserByScreenName 响应里取账号基线计数。
 *
 * 用户 2026-09-02 点出:post 总数就是**基线** —— 采集完整度的分母。
 * /with_replies 页面加载时 X 自己就会请求 UserByScreenName,顺手接住即可,
 * 不需要额外发请求。
 */
function extractAuthorCounts(node: unknown, wantHandle: string): {
  tweetCount?: number; mediaCount?: number; followersCount?: number;
  followingCount?: number; favouritesCount?: number; accountCreatedAt?: string;
} | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = extractAuthorCounts(item, wantHandle);
      if (r) return r;
    }
    return undefined;
  }
  const o = node as Record<string, unknown>;
  const tc = o.tweet_counts as Record<string, unknown> | undefined;
  const rc = o.relationship_counts as Record<string, unknown> | undefined;
  if (tc && typeof tc.tweets === 'number') {
    const ac = o.action_counts as Record<string, unknown> | undefined;
    const core = o.core as Record<string, unknown> | undefined;
    // ⚠️ **必须核对 handle**:响应里到处都是 user 对象(通知里的操作者、
    //    时间线里的其他作者),不核对就会把**别人的** 39850 条当成自己的基线。
    //    2026-09-02 实测踩到:从 NotificationsTimeline 抓回了一个陌生账号的计数。
    const sn = typeof core?.screen_name === 'string' ? core.screen_name : undefined;
    if (!sn || normalizeHandle(sn) !== wantHandle) {
      // 不是目标账号 → 继续往下找,别在这里返回
      for (const v of Object.values(o)) {
        const r = extractAuthorCounts(v, wantHandle);
        if (r) return r;
      }
      return undefined;
    }
    return {
      tweetCount: tc.tweets,
      mediaCount: typeof tc.media_tweets === 'number' ? tc.media_tweets : undefined,
      followersCount: typeof rc?.followers === 'number' ? rc.followers : undefined,
      followingCount: typeof rc?.following === 'number' ? rc.following : undefined,
      favouritesCount: typeof ac?.favorites_count === 'number' ? ac.favorites_count : undefined,
      accountCreatedAt: typeof core?.created_at === 'string' ? core.created_at : undefined,
    };
  }
  for (const v of Object.values(o)) {
    const r = extractAuthorCounts(v, wantHandle);
    if (r) return r;
  }
  return undefined;
}

/** 取字符串字段(载荷里缺字段是常态,不能假设存在) */
function str(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === 'string' && v ? v : undefined;
}
function num(o: Record<string, unknown>, k: string): number | undefined {
  const v = o[k];
  return typeof v === 'number' ? v : undefined;
}

/**
 * 递归找出响应里所有带回复字段的 legacy 对象。
 *
 * 同时产出两样东西 —— 它们服务不同目的,别合并:
 *  - relations:轻量关系,用于**标记被回复的线索**为「我回复过了」
 *  - ownReplies:我自己发的回复全量字段,用于**入库**(会话链/话术复盘/促转发)
 *
 * ⚠️ 长推 full_text 会被截断,真全文在 note_tweet(能力勘查 §4.6)。
 */
function extractRelations(
  node: unknown,
  out: ReplyRelation[],
  own: OwnReply[],
  selfHandle: string,
): void {
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) extractRelations(item, out, own, selfHandle);
    return;
  }

  const obj = node as Record<string, unknown>;
  const legacy = obj.legacy as Record<string, unknown> | undefined;
  if (legacy && typeof legacy === 'object') {
    const parent = str(legacy, 'in_reply_to_status_id_str');
    const self = str(legacy, 'id_str');
    const replyTo = str(legacy, 'in_reply_to_screen_name');
    const conv = str(legacy, 'conversation_id_str');

    // 关系:只有回复才有(原创推没有父推)
    if (parent && self) {
      out.push({
        tweetId: self,
        inReplyToStatusId: parent,
        inReplyToScreenName: replyTo ? normalizeHandle(replyTo) : undefined,
        conversationId: conv,
      });
    }

    // 我自己发的推:**原创与回复都要**(用户 2026-09-02:AI 要学说话方式,
    // 只有回复学不全 —— 主动表达与应答是两种语料)。
    // 此前这段嵌在 `if (parent && self)` 里,原创推被整个丢掉。
    if (self) {
      const core = obj.core as Record<string, unknown> | undefined;
      const ur = core?.user_results as Record<string, unknown> | undefined;
      const urr = ur?.result as Record<string, unknown> | undefined;
      const ucore = urr?.core as Record<string, unknown> | undefined;
      const authorHandle = ucore ? str(ucore, 'screen_name') : undefined;

      if (authorHandle && normalizeHandle(authorHandle) === selfHandle) {
        // ⚠️ 长推:legacy.full_text **会被截断**,真全文在 note_tweet。
        // 训练素材必须保真,截断的语料会教出截断的说话方式。
        const note = obj.note_tweet as Record<string, unknown> | undefined;
        const nres = (note?.note_tweet_results as Record<string, unknown> | undefined)
          ?.result as Record<string, unknown> | undefined;
        const fullText = (nres && str(nres, 'text')) ?? str(legacy, 'full_text') ?? '';

        own.push({
          tweetId: self,
          text: fullText,
          authorHandle: normalizeHandle(authorHandle),
          createdAt: str(legacy, 'created_at'),
          lang: str(legacy, 'lang'),
          inReplyToStatusId: parent,
          inReplyToScreenName: replyTo ? normalizeHandle(replyTo) : undefined,
          conversationId: conv,
          metrics: {
            likes: num(legacy, 'favorite_count'),
            retweets: num(legacy, 'retweet_count'),
            replies: num(legacy, 'reply_count'),
            quotes: num(legacy, 'quote_count'),
            bookmarks: num(legacy, 'bookmark_count'),
          },
        });
      }
    }
  }

  for (const v of Object.values(obj)) extractRelations(v, out, own, selfHandle);
}

export interface ReplyCollectResult {
  /** 滚了几轮 */
  rounds: number;
  /** 捕获的 GraphQL 响应数 */
  payloads: number;
  /** 解出的回复关系条数(去重后) */
  relations: number;
  /** 其中我自己发的回复条数 */
  ownReplies: number;
  /** 自己的回复入库结果 */
  ownSaved: { inserted: number; skipped: number };
  /** 写到「我的回复」那些推上的条数 */
  savedOnReplies: number;
  /** 回填战果 */
  backfill: { received: number; markedReplied: number; amongAccepted: number; parentNotInDb: number };
  /** 覆盖到的最旧回复距今天数 —— 如实反映抓了多深,不谎称全量 */
  oldestDays: number | null;
  /** **连续**覆盖天数 —— 真正的进度指标(oldestDays 会被置顶旧推带偏) */
  contiguousDays: number;
  /** 为什么停 —— 区分「到底了」与「封顶了」,不含糊 */
  stopReason: string;
  /** 诊断落盘路径 */
  dumpPath?: string;
}

/**
 * 采集指定账号的回复关系。
 *
 * @param handle     目标账号(通常是自己)
 * @param maxRounds  滚动轮次上限
 * @param targetDays 回溯窗口(天)—— 达到即停。用户拍板:一般 7 天够判行为特征
 *
 * ⚠️ **边界如实汇报**:X 用虚拟列表 + 懒加载,B′ 诊断实测滚 60 轮只覆盖 3.2 天。
 *    本函数返回 oldestDays,调用方**不得声称"全量"** —— 抓到多少说多少。
 */
export async function collectReplyRelations(
  handle: string,
  targetWcId?: number,
  maxRounds = 40,
  targetDays = 7,
): Promise<ReplyCollectResult | { error: string }> {
  const h = normalizeHandle(handle);
  if (!h) return { error: 'empty handle' };

  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  let attached = false;
  try { wc.debugger.attach('1.3'); attached = true; }
  catch (err) { console.warn('[x-reply-collector] attach 失败(可能已 attach):', err); }

  const relMap = new Map<string, ReplyRelation>();
  const ownMap = new Map<string, OwnReply>();
  const times: string[] = [];
  const pending = new Map<string, string>();
  let payloads = 0;
  let latestCursor: string | undefined;
  let authorCounts: ReturnType<typeof extractAuthorCounts>;

  const onMessage = (_e: unknown, method: string, params: any): void => {
    if (method === 'Network.requestWillBeSent') {
      const url: string = params?.request?.url ?? '';
      if (url.includes('/i/api/graphql/')) pending.set(params.requestId, url);
      return;
    }
    if (method === 'Network.loadingFinished') {
      const url = pending.get(params.requestId);
      if (!url) return;
      pending.delete(params.requestId);
      wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
        .then((r: any) => {
          if (!r?.body) return;
          payloads++;
          try {
            const parsed = JSON.parse(r.body);
            const found: ReplyRelation[] = [];
            const foundOwn: OwnReply[] = [];
            extractRelations(parsed, found, foundOwn, h);
            for (const rel of found) relMap.set(rel.tweetId, rel);
            for (const o of foundOwn) ownMap.set(o.tweetId, o);
            // 每个响应都可能带新的 Bottom 游标 —— 留最后一个(最深的那页)
            const cur = extractBottomCursor(parsed);
            if (cur) latestCursor = cur;
            // 基线:页面加载时 X 自己会请求 UserByScreenName,顺手接住
            if (!authorCounts) authorCounts = extractAuthorCounts(parsed, h);
            // 记录时间戳以计算覆盖深度
            const collectTimes = (n: unknown): void => {
              if (n === null || typeof n !== 'object') return;
              if (Array.isArray(n)) { n.forEach(collectTimes); return; }
              const o = n as Record<string, unknown>;
              const lg = o.legacy as Record<string, unknown> | undefined;
              if (lg && typeof lg.created_at === 'string') times.push(lg.created_at);
              Object.values(o).forEach(collectTimes);
            };
            collectTimes(parsed);
          } catch { /* 非 JSON 跳过 */ }
        })
        .catch(() => { /* 响应体可能已丢弃 */ });
    }
  };

  wc.debugger.on('message', onMessage);
  await wc.debugger.sendCommand('Network.enable').catch(() => {});

  // ── 续传:用 X 自己给的 Bottom 游标 ──────────────────────────────
  //
  // 用户 2026-09-02 两条指正,本段是它们的落地:
  //  ①「不要增加用户负担,应该更加简洁」→ **一个按钮**,不让用户选方向
  //  ②「X 上有很多标记,你要善于利用」→ 用 X 的 Bottom 游标,不拿时间戳猜边界
  //
  // 我原来的两按钮方案(增量/补历史)是把实现细节暴露给用户:
  // 时间戳做锚点必须区分「往新」「往旧」,所以才需要两个模式。
  // 而游标天然是单向续传凭证 —— 有就接着上次挖,没有就从头,用户不必知道。
  // 两条流各有各的游标 —— X 的 with_replies 与 Posts 是不同 timeline,
  // 共用一个游标会互相覆盖(一条流的续传点对另一条无意义)。
  const scope = `${h}:replies`;
  const saved = await getCollectCursor(scope);
  const coverage = await getOwnReplyCoverage();
  console.log(`[x-reply-collector] 库存 ${coverage.count} 条 `
    + `(最旧 ${coverage.oldest ?? '?'}), 游标=${saved.bottomCursor ? '有(续传)' : '无(从头)'}`
    + `${saved.exhausted ? ' [已到底]' : ''}`);

  // ── 两条流依次采(用户 2026-09-02:「所有的发帖回复都要爬取」)──
  // /with_replies 只给回复流;原创推在 Posts 标签页(UserOriginalsTimeline)。
  // 两条都要:AI 学说话方式,主动表达与应答是两种语料,缺一半学不全。
  const streams = [
    { key: 'replies', url: `https://x.com/${h}/with_replies` },
    { key: 'posts',   url: `https://x.com/${h}` },
  ];
  let streamIdx = 0;

  wc.loadURL(streams[0].url);
  await new Promise((r) => setTimeout(r, 4000));

  let rounds = 0;
  let oldestDays: number | null = null;
  let contiguousDays = 0;
  let stopReason = `达到轮次上限 ${maxRounds}`;
  let noProgress = 0;
  let lastRelCount = 0;

  for (let i = 1; i <= maxRounds; i++) {
    rounds = i;
    if (times.length) {
      const oldest = times.reduce((a, b) => (new Date(a) < new Date(b) ? a : b));
      oldestDays = Math.round((Date.now() - new Date(oldest).getTime()) / 86_400_000 * 10) / 10;

      // ⚠️ **不能用「见过的最旧一条」当覆盖深度** —— 2026-09-02 实测踩到:
      //   X 会把置顶/热门的旧推排在前面,一条 3 月的推就让 oldestDays=166,
      //   瞬间"满足" 30 天目标 → 10 轮就停,而最近 6 天的密集回复根本没抓到
      //   (库里 08-26~08-30 完全空白,用户按每天 20+ 条一算就发现了)。
      //   这是又一次「拿有缺陷的测量当证据」:最旧一条 ≠ 连续覆盖。
      //
      // 正解:看**连续覆盖**的边界 —— 从今天往回数,哪一天开始出现空档,
      //   那之前的都不算覆盖到。用抓到的日期集合算连续天数。
      const daySet = new Set(times.map((t) => new Date(t).toISOString().slice(0, 10)));
      let contiguous = 0;
      for (let back = 0; back < 400; back++) {
        const d = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
        if (daySet.has(d)) { contiguous = back + 1; continue; }
        // 容忍单天空档(那天可能真的没发推),连续两天空才判定断档
        const prev = new Date(Date.now() - (back + 1) * 86_400_000).toISOString().slice(0, 10);
        if (!daySet.has(prev)) break;
      }
      contiguousDays = contiguous;

      if (contiguous >= targetDays) {
        if (streamIdx < streams.length - 1) {
          streamIdx++;
          console.log(`[x-reply-collector] 连续覆盖 ${contiguous} 天,切到 ${streams[streamIdx].key} 流`);
          wc.loadURL(streams[streamIdx].url);
          await new Promise((r) => setTimeout(r, 4000));
          times.length = 0;      // 新流重新计深度
          contiguousDays = 0;
          noProgress = 0;
          lastRelCount = relMap.size;
          continue;
        }
        stopReason = `连续覆盖 ${contiguous} 天(两条流)`;
        break;
      }
    }

    // ── 自然滚动(用户 2026-09-02 定的策略)────────────────────────
    // 「滚动采集要有策略,不要触发 X 的风控就好。建议滚动自然,一直放下翻页,
    //   做采集时间标记,这样就不会重复了。」
    //
    // ⚠️ 我上一版改成 scrollTo(文档底部) 是**错的**:瞬间跳到底是明显的机器行为,
    //    为了挖深反而做了更容易触发风控的动作。已改回自然滚动。
    //
    // 自然的含义:一屏以内的位移 + 随机化 + 随机停顿(人不会匀速滚)。
    // 慢不是代价 —— 增量锚点保证不重复,深度靠多次累积而非单次冲刺。
    const step = 0.55 + Math.random() * 0.3;          // 0.55~0.85 屏,不足一屏
    const moved = await wc.executeJavaScript(`(function () {
      var before = window.scrollY;
      window.scrollBy({ top: window.innerHeight * ${step.toFixed(3)}, behavior: 'smooth' });
      return { before: before, docH: Math.max(
        document.body.scrollHeight, document.documentElement.scrollHeight) };
    })()`).catch(() => null) as { before: number; docH: number } | null;

    // 随机停顿 1.8~3.4s:匀速请求是风控最容易识别的特征之一
    await new Promise((r) => setTimeout(r, 1800 + Math.random() * 1600));

    // 进度以**新解出的关系**为准,不以滚动位移为准:
    // 位移了但没新数据 = 到底了或懒加载封顶,两者都该停
    if (relMap.size === lastRelCount) {
      noProgress++;
      // 容忍度留足:滚过已知区域时本来就没有新数据,
      // 太急会把"正在穿过已知区"误判成"到底了"(拿有缺陷的测量当证据)
      const limit = 8;
      if (noProgress >= limit) {
        // 本条流跑完 → 切下一条;两条都跑完才真正结束
        if (streamIdx < streams.length - 1) {
          streamIdx++;
          console.log(`[x-reply-collector] 切到 ${streams[streamIdx].key} 流`);
          wc.loadURL(streams[streamIdx].url);
          await new Promise((r) => setTimeout(r, 4000));
          noProgress = 0;
          lastRelCount = relMap.size;
          continue;
        }
        stopReason = `两条流都跑完(docH=${moved?.docH ?? '?'})`
          + ` —— 到底了或 X 懒加载封顶`;
        break;
      }
    } else {
      noProgress = 0;
      lastRelCount = relMap.size;
    }
  }

  wc.debugger.off('message', onMessage);
  if (attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }

  const relations = [...relMap.values()];
  const ownReplies = [...ownMap.values()];
  console.log(`[x-reply-collector] @${h}: ${rounds} 轮, ${payloads} 个响应, `
    + `解出 ${relations.length} 条回复关系(其中我自己发的 ${ownReplies.length} 条), `
    + `覆盖 ${oldestDays ?? '?'} 天`);

  // 诊断落盘:采集是有成本的,结果留痕便于复核(不必再跑一次)
  let dumpPath: string | undefined;
  try {
    const dir = join(app.getPath('userData'), 'x-payload-survey');
    mkdirSync(dir, { recursive: true });
    dumpPath = join(dir, `replies-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(dumpPath, JSON.stringify(
      { handle: h, rounds, payloads, oldestDays, stopReason, relations, ownReplies }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[x-reply-collector] 诊断落盘失败(不影响主流程):', err);
  }

  // 顺序要紧:先把自己的回复插进去,再补关系 —— 否则新插的行拿不到关系更新
  const ownSaved = await saveOwnReplies(ownReplies);
  const savedOnReplies = await saveReplyRelations(relations);
  const backfill = await backfillRepliedFromRelations(relations);

  // 存基线 —— 采集完整度的分母(用户 2026-09-02 点出的关键)
  if (authorCounts?.tweetCount) {
    await saveAuthorCounts(h, authorCounts);
    console.log(`[x-reply-collector] 基线更新: 发推总数 ${authorCounts.tweetCount}`);
  }

  // 存游标:下次从这里接着挖。没拿到新游标 = X 不再给下一页 → 标记到底。
  // ⚠️ 只在**确实抓到了数据**时才判定到底 —— 一次都没抓到可能是网络/风控,
  //    那种情况不该把 exhausted 钉死,否则以后再也不挖了(静默坍缩)。
  const gotData = relations.length > 0;
  await saveCollectCursor(scope, {
    bottomCursor: latestCursor ?? saved.bottomCursor,
    oldestAt: ownReplies.length
      ? ownReplies.map((o) => o.createdAt).filter(Boolean).sort()[0]
      : saved.oldestAt,
    exhausted: gotData && !latestCursor,
  });

  console.log(`[x-reply-collector] 落库: 自己的回复入库 ${ownSaved.inserted} 条`
    + `(已存在 ${ownSaved.skipped} 条); 补关系 ${savedOnReplies} 条; `
    + `标记 replied ${backfill.markedReplied} 条(其中已采纳 ${backfill.amongAccepted});`
    + `父推不在库 ${backfill.parentNotInDb} 条`);

  return { rounds, payloads, relations: relations.length, ownReplies: ownReplies.length,
    ownSaved, savedOnReplies, backfill, oldestDays, contiguousDays, stopReason, dumpPath };
}
