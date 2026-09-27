/**
 * ⭐⭐ **备料** —— 给一批推补齐「作者 bio」与「这一楼的上文」。
 *
 * ── 用户 2026-09-26 定的流水线第 ③ 步 ──
 * > 「针对目标数据，获取对应的 bio-上下文--打包」
 * > 「这一步应该是先查询数据库，有就即可获取，没有再从 x 上定位获取。」
 *
 * ⚠️ **为什么抽成共用函数**(与 `planReplyBatch` 同一个理由):
 * 这两件事原本只活在 `X_PREFETCH_PROFILES` / `X_PREFETCH_CONTEXT`
 * 两个 IPC handler 里 —— **只有人点按钮才跑**。
 * 编排一跑就没有这一环,于是拟回复拿到的推**没有 bio 也没有上文**。
 *
 * ⭐ 这正是用户说的「你割裂了流程了」:
 * **能力一直都在,只是挂在各自的手点按钮上**。手点时人就是那根接线;
 * 编排一跑,接线断了。
 *
 * ⚠️ 抽出来**不是复制一份**:handler 与编排能力都调这里,
 * 两份实现必漂,而漂的表现是「手点能跑、编排跑出来的不一样」,极难查。
 */

import { queryInbox, setParentContext } from '../db/tweet-inbox-repo';
import { getAuthorCounts } from '../db/x-author-repo';
import { harvestAuthorProfile, PROFILE_STALE_HOURS } from './x-author-profile';
import { fetchParentTweet, DEFAULT_CONTEXT_DEPTH } from './x-parent-tweet';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import type { TweetInboxStatus } from '@shared/types/x-timeline-types';

/**
 * ⭐ 连续失败多少次就放弃这一趟的 bio 采集。
 * ⚠️ 与 `mechanismSuspect` 的阈值保持一致 —— 两个数分开会让
 * 「报了可疑却还在跑」或「停了却不报可疑」,两种都让人看不懂。
 */
export const BIO_GIVE_UP_AFTER = 5;

export interface PrefetchOptions {
  wsId?: string;
  wcId?: number;
  /** 取哪一页的候选 —— ⚠️ 口径要与调用方看到的一致 */
  status?: TweetInboxStatus;
  statuses?: TweetInboxStatus[];
  limit?: number;
  offset?: number;
  replied?: boolean;
  /** ⚠️ 跟随调用方的视图 —— 收件箱的「漏判抽查」等视图要用 */
  humanReviewed?: boolean;
  /**
   * ⚠️⚠️ **按不按 wsId 过滤,两个调用方口径不同** ——
   * · 收件箱面板:**不过滤**(列表本身就不按 ws 过滤,侧栏计数也不;
   *   过滤会出现「屏幕上明明有 67 条,预取却说没有可预抓的」——
   *   用户 2026-09-07 撞上过)
   * · 编排:**要过滤**(planReplyBatch 就是按 wsId 取候选的,
   *   不过滤会给别的 ws 的推白备料)
   * ⭐ 所以这里**由调用方决定**,不在函数里替它定。
   */
  filterByWs?: boolean;
  /**
   * ⭐ 上文取几条 —— **变量**(用户 2026-09-26:「是否做变量---届时该起来容易」)。
   * ⚠️ 判断层要 1 条就够,拟回复要的是整楼语境 —— 深度归调用方定。
   */
  contextDepth?: number;
}

export interface PrefetchReport {
  /** 这一页扫了多少条 */
  scanned: number;
  bio: {
    /** 这一页涉及多少个作者(去重后) */
    authors: number;
    /** ⭐ 库里就有、没去 X 跑 —— 「先查库」省下来的 */
    cached: number;
    /** 现去 X 采回来的 */
    fetched: number;
    failed: number;
    /**
     * ⭐ 因为**连续失败而跳过**的 —— ⚠️ 与 `failed` 分开:
     * 「试了没成」和「压根没试」是两回事,混在一起会让人以为全试过了。
     */
    skipped: number;
    /** 这一趟是不是中途放弃了 bio */
    gaveUp: boolean;
  };
  context: {
    /** ⭐ 这一页里有多少条是回复 —— UI 要用它区分「没抓到」与「本来就没有回复串」 */
    isReply: number;
    /** 真的是回复、值得抓上文的条数(= isReply 里还没有上文的) */
    attempted: number;
    /** ⭐ 库里已有上文,跳过 */
    cached: number;
    fetched: number;
    failed: number;
    /** 抓回来的上文平均多少条 —— 深度变量有没有生效,看这个 */
    avgDepth: number;
  };
  /**
   * ⚠️ **连续失败 = 机制层面的怀疑**,不是个别账号的问题。
   * 采不到单个账号是常事(私密号/已注销),但连着一串都采不到
   * 多半是采集机制坏了(如 X 改版让载荷截不到)。
   */
  mechanismSuspect: boolean;
  /** ⭐ 最长连续失败次数 —— UI 报「连续 N 个账号采不到」要用 */
  maxConsecutive: number;
  errors: string[];
}

/**
 * 判断一条推是不是「回复」—— 只有回复才有上文可抓。
 *
 * ⚠️ 对独立求助推白跑一次导航是**纯浪费**:
 * 实测 60 条 worth 样本里 **39 条是孤立原创推**(天生没有上下文)。
 */
function isReply(t: { in_reply_to_user?: string; text?: string }): boolean {
  return !!t.in_reply_to_user || /^\s*@\w+/.test(t.text ?? '');
}

/**
 * 给一批推备料。
 *
 * ⚠️ **先查库,缺了才去 X 取**(用户明确要求)——
 * bio 看 `PROFILE_STALE_HOURS` 内是否新鲜,上文看 `parent_text` 有没有值。
 *
 * ⚠️ 失败**不拦整批**:采不到某个人的 bio,别的推照样备料。
 * 但失败要**记下来并报出去**,不能静默(否则「备齐了」是谎报)。
 */
export async function prefetchReplyContext(
  opts: PrefetchOptions = {},
): Promise<PrefetchReport> {
  const depth = Math.max(1, Math.floor(opts.contextDepth ?? DEFAULT_CONTEXT_DEPTH));
  const pool = await queryInbox({
    ...(opts.statuses && opts.statuses.length
      ? { statuses: opts.statuses }
      : { status: opts.status ?? 'worth' }),
    ...(opts.filterByWs && opts.wsId ? { wsId: opts.wsId } : {}),
    ...(typeof opts.humanReviewed === 'boolean' ? { humanReviewed: opts.humanReviewed } : {}),
    ...(typeof opts.replied === 'boolean' ? { replied: opts.replied } : {}),
    limit: opts.limit ?? 20,
    offset: opts.offset ?? 0,
  });

  const errors: string[] = [];
  let consecutiveFail = 0;
  let maxConsecutive = 0;
  const noteFail = (msg: string): void => {
    consecutiveFail += 1;
    maxConsecutive = Math.max(maxConsecutive, consecutiveFail);
    if (errors.length < 5) errors.push(msg);
  };

  // ── ① bio ──
  /**
   * ⚠️ **handle 必须归一化**:`x_tweet` 存 `@Xxx`(带 @ 保留大小写),
   * `x_author` 存归一化小写。写入端与比对端不共用 `normalizeHandle()`
   * 就会**永远命中不上且不报错**。
   */
  const handles = [...new Set(pool.map((t) => normalizeHandle(t.author_handle ?? '')).filter(Boolean))];
  let bioCached = 0; let bioFetched = 0; let bioFailed = 0;
  /**
   * ⭐⭐ **连续失败就不再白等**(2026-09-27 真机止血)。
   *
   * 实测:那一趟 192 人里 **159 次全失败**,每次硬等满 12s = **32 分钟纯浪费**
   * (整个备料步 2129s,绝大部分耗在这里)。
   * ⚠️ 失败原因是**同一个**(「期间一条 GraphQL 载荷都没看见」)——
   * 既然是机制坏了,后面 159 次不可能突然好。
   *
   * ⭐ 判据用**连续**失败不是累计:个别账号采不到是常事(私密号/已注销),
   * 连着一串才说明机制坏了;成功一次就清零。
   * ⚠️ 放弃 bio **不算整步失败**:上文那一半还是好的(实测 75/83 成功)。
   */
  let bioSkipped = 0;
  let bioGaveUp = false;
  for (const h of handles) {
    if (bioGaveUp) { bioSkipped += 1; continue; }

    const have = await getAuthorCounts(h).catch(() => null);
    const fresh = have?.countsAt
      && (Date.now() - new Date(have.countsAt).getTime()) < PROFILE_STALE_HOURS * 3_600_000;
    if (fresh) { bioCached += 1; consecutiveFail = 0; continue; }

    const got = await harvestAuthorProfile(h, opts.wcId, 12_000)
      .catch((e) => ({ error: String(e) }));
    if ('error' in got) {
      bioFailed += 1;
      noteFail(`bio @${h}: ${got.error}`);
      /** ⚠️ 阈值与 mechanismSuspect 同一个数 —— 让那条判据真的止损,不只报一句 */
      if (consecutiveFail >= BIO_GIVE_UP_AFTER) bioGaveUp = true;
    } else { bioFetched += 1; consecutiveFail = 0; }
  }

  // ── ② 上文 ──
  const replies = pool.filter(isReply);
  const needContext = replies.filter((t) => !t.parent_text);
  let ctxCached = replies.length - needContext.length;
  let ctxFetched = 0; let ctxFailed = 0;
  let depthSum = 0;
  for (const t of needContext) {
    const got = await fetchParentTweet(
      t.tweet_url || `https://x.com/i/status/${t.tweet_id}`, opts.wcId, 10_000, depth,
    ).catch(() => null);
    if (!got) { ctxFailed += 1; noteFail(`上文 ${t.tweet_id}: 没抓到`); continue; }
    /**
     * ⚠️ 落库仍只存紧邻那条(`parent_text` 字段的语义没变)。
     * ⭐ 整段 `context` 现在只在**本次返回值**里往下传 ——
     * 存不存整段是数据模型的事(见设计文档 §6 `context_snapshot`),
     * 不在这一步偷偷扩字段。
     */
    await setParentContext(t.tweet_id, got.text, got.authorHandle).catch((e) => {
      noteFail(`上文入库 ${t.tweet_id}: ${String(e).slice(0, 80)}`);
    });
    ctxFetched += 1;
    depthSum += got.context.length;
    consecutiveFail = 0;
  }

  return {
    scanned: pool.length,
    bio: {
      authors: handles.length, cached: bioCached, fetched: bioFetched,
      failed: bioFailed, skipped: bioSkipped, gaveUp: bioGaveUp,
    },
    context: {
      isReply: replies.length,
      attempted: needContext.length,
      cached: ctxCached,
      fetched: ctxFetched,
      failed: ctxFailed,
      /** ⭐ 深度变量有没有真的生效,看这个数 —— 恒为 1 就是没生效 */
      avgDepth: ctxFetched > 0 ? depthSum / ctxFetched : 0,
    },
    /** 连续 5 个失败 = 机制层面的怀疑 */
    mechanismSuspect: maxConsecutive >= 5,
    maxConsecutive,
    errors,
  };
}
