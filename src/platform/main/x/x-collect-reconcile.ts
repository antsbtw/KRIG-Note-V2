/**
 * ⭐⭐ 采集完整性对账 —— 两路各采一次,逐字段比,取并集
 *
 * ── 用户 2026-09-18 定的采集层要求 ──
 *
 * > 「不管是 DOM 还是 SSE,还是 CDP,需要确保采集数据的完整性,
 * >   可以多个手段同时使用,但是不能缺少数据。要可验证。」
 * > 「每一种方法都采一次,比对都有哪些数据,取它的并集。」
 *
 * ── 为什么必须有这个(实测)──
 *
 * 仓里**两条解析链并存**,而入库走的是字段少的那条:
 *
 *   DOM 路   `XTweetData`      有 authorName / authorAvatar / media[] / tweetUrl
 *   载荷路   `HarvestedTweet`  有 authorRestId / conversationId / quotedStatusId /
 *                              inReplyToScreenName / self / metrics.quotes,bookmarks
 *
 * **互有独有** —— 任何一路单独走都在丢数据。
 * 盘点实测的后果:上下文 1%(86/14331)、会话串 11% ——
 * 不是「没采到」,是**采到了、入库时那一路没有这个字段**。
 *
 * ⚠️ 而这件事此前**不可验**:没有任何东西告诉你少了什么,
 * 是我事后查盘点数字才发现的。本文件就是把它变成可验的。
 *
 * ── 三种差异,处置完全不同 ──
 *
 *   一致        正常
 *   只有一方有   取有的那方,并记下「这个字段只有 X 路拿得到」
 *   ⚠️ 两方冲突  **必须报** —— 至少一路在产假数据,而假数据比缺数据更坏
 *
 * ⚠️ 本文件**只比对、不写库**。入库是另一步的事(纪律同执行者:只算不存)。
 */

import type { XTweetData } from './x-extract-tweet';
import type { HarvestedTweet } from './x-timeline-harvester';
import { normalizeHandle } from '@shared/types/x-timeline-types';

/** 一个字段在两路上的表现 */
export interface FieldReconcile {
  readonly field: string;
  /** DOM 路有值的条数 */
  readonly domHas: number;
  /** 载荷路有值的条数 */
  readonly payloadHas: number;
  /** 两路都有且**值相同** */
  readonly agree: number;
  /** ⚠️ 两路都有但**值不同** —— 至少一路解错了 */
  readonly conflict: number;
  /** 只有 DOM 拿得到 */
  readonly domOnly: number;
  /** 只有载荷拿得到 */
  readonly payloadOnly: number;
  /** 两路都没有 */
  readonly neither: number;
}

export interface ReconcileReport {
  /** 对账的推文条数(两路 tweet_id 的并集) */
  readonly total: number;
  /** 只有 DOM 采到的推(载荷没出现) */
  readonly domOnlyTweets: number;
  /** 只有载荷采到的推(DOM 没渲染/没滚到) */
  readonly payloadOnlyTweets: number;
  readonly bothTweets: number;
  readonly fields: readonly FieldReconcile[];
  /** ⚠️ 冲突样本 —— 拿去看到底谁解错了,不只给个数字 */
  readonly conflictSamples: ReadonlyArray<{
    tweetId: string; field: string; dom: unknown; payload: unknown;
  }>;
  readonly at: string;
}

/**
 * 字段映射表 —— 两路的**同一个事实**叫什么名字。
 *
 * ⚠️ 这张表是对账的全部要害:名字对错了会把「两路都有」误判成「各有独有」。
 * 我差点就栽在这上面 —— 看见 `inReplyTo`(DOM)与 `inReplyToStatusId`(载荷)
 * 就断言「字段名写错了」,其实两边各自自洽,是**两个不同的类型**。
 * 先确认类型,再比字段(feedback-check-sample-contains-phenomenon)。
 */
const FIELD_MAP: ReadonlyArray<{
  readonly field: string;
  readonly dom: (t: XTweetData) => unknown;
  readonly payload: (t: HarvestedTweet) => unknown;
  /** 值怎么算「相同」—— 不给就用 === */
  readonly same?: (a: unknown, b: unknown) => boolean;
}> = [
  { field: 'text', dom: (t) => t.text, payload: (t) => t.text },
  { field: 'createdAt', dom: (t) => t.createdAt, payload: (t) => t.createdAt },
  { field: 'lang', dom: (t) => t.lang, payload: (t) => t.lang },
  {
    field: 'authorHandle',
    dom: (t) => t.authorHandle, payload: (t) => t.authorHandle,
    // ⚠️ 两路大小写/@ 前缀不一致是常态,必须归一化后比 —— 否则冲突数会虚高
    // (记忆 project-x-handle-normalize:写入端与比对端必须共用 normalizeHandle)
    same: (a, b) => normalizeHandle(String(a ?? '')) === normalizeHandle(String(b ?? '')),
  },
  { field: 'inReplyToId', dom: (t) => t.inReplyTo, payload: (t) => t.inReplyToStatusId },
  {
    field: 'inReplyToUser',
    dom: (t) => t.inReplyToUser, payload: (t) => t.inReplyToScreenName,
    same: (a, b) => normalizeHandle(String(a ?? '')) === normalizeHandle(String(b ?? '')),
  },
  { field: 'metrics.likes', dom: (t) => t.metrics?.likes, payload: (t) => t.metrics?.likes },
  { field: 'metrics.retweets', dom: (t) => t.metrics?.retweets, payload: (t) => t.metrics?.retweets },
  { field: 'metrics.replies', dom: (t) => t.metrics?.replies, payload: (t) => t.metrics?.replies },
  { field: 'metrics.views', dom: (t) => t.metrics?.views, payload: (t) => t.metrics?.views },
  // ── 以下为单路独有,对账时会体现成 domOnly / payloadOnly 全额 ──
  { field: 'authorName', dom: (t) => t.authorName, payload: () => undefined },
  { field: 'authorAvatar', dom: (t) => t.authorAvatar, payload: () => undefined },
  { field: 'tweetUrl', dom: (t) => t.tweetUrl, payload: () => undefined },
  { field: 'media', dom: (t) => (t.media?.length ? t.media.length : undefined), payload: () => undefined },
  { field: 'authorRestId', dom: () => undefined, payload: (t) => t.authorRestId },
  { field: 'conversationId', dom: () => undefined, payload: (t) => t.conversationId },
  { field: 'quotedStatusId', dom: (t) => t.quotedTweet, payload: (t) => t.quotedStatusId },
  { field: 'metrics.quotes', dom: () => undefined, payload: (t) => t.metrics?.quotes },
  { field: 'metrics.bookmarks', dom: () => undefined, payload: (t) => t.metrics?.bookmarks },
  { field: 'self.favorited', dom: () => undefined, payload: (t) => t.self?.favorited },
];

/** 有值 = 非 undefined/null/空串。⚠️ 0 和 false **算有值** */
function present(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/**
 * 两路对账。
 *
 * ⚠️ 传进来的两批**必须来自同一次采集**(同一个页面、同一批推),
 * 否则比的是两批不同数据,差异全是假的。
 */
export function reconcile(
  domTweets: readonly XTweetData[],
  payloadTweets: readonly HarvestedTweet[],
  opts: { maxConflictSamples?: number } = {},
): ReconcileReport {
  const maxSamples = opts.maxConflictSamples ?? 20;

  const domById = new Map<string, XTweetData>();
  for (const t of domTweets) if (t.tweetId) domById.set(t.tweetId, t);
  const payloadById = new Map<string, HarvestedTweet>();
  for (const t of payloadTweets) if (t.tweetId) payloadById.set(t.tweetId, t);

  const allIds = new Set([...domById.keys(), ...payloadById.keys()]);

  let domOnlyTweets = 0, payloadOnlyTweets = 0, bothTweets = 0;
  for (const id of allIds) {
    const d = domById.has(id), p = payloadById.has(id);
    if (d && p) bothTweets += 1;
    else if (d) domOnlyTweets += 1;
    else payloadOnlyTweets += 1;
  }

  const conflictSamples: Array<{ tweetId: string; field: string; dom: unknown; payload: unknown }> = [];
  const fields: FieldReconcile[] = [];

  for (const spec of FIELD_MAP) {
    let domHas = 0, payloadHas = 0, agree = 0, conflict = 0;
    let domOnly = 0, payloadOnly = 0, neither = 0;

    for (const id of allIds) {
      const d = domById.get(id);
      const p = payloadById.get(id);
      const dv = d ? spec.dom(d) : undefined;
      const pv = p ? spec.payload(p) : undefined;
      const dHas = present(dv), pHas = present(pv);

      if (dHas) domHas += 1;
      if (pHas) payloadHas += 1;

      if (dHas && pHas) {
        const same = spec.same ? spec.same(dv, pv) : dv === pv;
        if (same) agree += 1;
        else {
          conflict += 1;
          if (conflictSamples.length < maxSamples) {
            conflictSamples.push({ tweetId: id, field: spec.field, dom: dv, payload: pv });
          }
        }
      } else if (dHas) domOnly += 1;
      else if (pHas) payloadOnly += 1;
      else neither += 1;
    }

    fields.push({
      field: spec.field, domHas, payloadHas, agree, conflict,
      domOnly, payloadOnly, neither,
    });
  }

  return {
    total: allIds.size,
    domOnlyTweets, payloadOnlyTweets, bothTweets,
    fields, conflictSamples,
    at: new Date().toISOString(),
  };
}

/**
 * ⭐ 取并集:同一条推,两路的字段合成一份。
 *
 * ── 取舍规则(冲突时谁赢)──
 *
 * **载荷优先**。理由不是「载荷更好」,是**载荷是 X 自己的数据结构**,
 * 而 DOM 是渲染结果 —— 渲染会做省略(「1.2万」)、会本地化、会随改版变形。
 * 实测佐证:`metrics.views` DOM 路经常拿不到或是省略形式。
 *
 * ⚠️ 但**只在两路都有值时**才轮到优先级。只有一方有值,就取那一方 ——
 * 这正是「不能缺少数据」:头像/媒体只有 DOM 有,会话串只有载荷有。
 */
export function mergeTweet(
  dom: XTweetData | undefined,
  payload: HarvestedTweet | undefined,
): Record<string, unknown> | null {
  const tweetId = payload?.tweetId ?? dom?.tweetId;
  if (!tweetId) return null;

  const pick = <T>(p: T | undefined, d: T | undefined): T | undefined =>
    present(p) ? p : (present(d) ? d : undefined);

  return {
    tweetId,
    text: pick(payload?.text, dom?.text),
    createdAt: pick(payload?.createdAt, dom?.createdAt),
    lang: pick(payload?.lang, dom?.lang),
    authorHandle: normalizeHandle(String(pick(payload?.authorHandle, dom?.authorHandle) ?? '')),
    // 只有 DOM 有的
    authorName: dom?.authorName,
    authorAvatar: dom?.authorAvatar,
    tweetUrl: dom?.tweetUrl,
    media: dom?.media,
    // 只有载荷有的
    authorRestId: payload?.authorRestId,
    conversationId: payload?.conversationId,
    quotedStatusId: payload?.quotedStatusId,
    isLongText: payload?.isLongText,
    self: payload?.self,
    // 两路都可能有的
    inReplyToId: pick(payload?.inReplyToStatusId, dom?.inReplyTo),
    inReplyToUser: pick(payload?.inReplyToScreenName, dom?.inReplyToUser),
    metrics: {
      likes: pick(payload?.metrics?.likes, dom?.metrics?.likes),
      retweets: pick(payload?.metrics?.retweets, dom?.metrics?.retweets),
      replies: pick(payload?.metrics?.replies, dom?.metrics?.replies),
      views: pick(payload?.metrics?.views, dom?.metrics?.views),
      quotes: payload?.metrics?.quotes,
      bookmarks: payload?.metrics?.bookmarks,
    },
    /** ⭐ 这条推的字段各自来自哪一路 —— 出问题时能追到是哪一路解错的 */
    _sources: {
      dom: !!dom,
      payload: !!payload,
    },
  };
}
