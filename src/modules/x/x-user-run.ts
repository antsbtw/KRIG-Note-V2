/**
 * ⭐⭐⭐ **人流采集的编排** —— followers / following / verifiedFollowers
 *
 * ⚠️⚠️ **为什么不塞进 `x-collect-run`**:
 * 停止判据不同。推文那边判「有没有没见过的**推**」,
 * 这边判「有没有没见过的**人**」—— 而人流还多一条推文没有的闸:
 * `TimelineTerminateTimeline`(X 翻到底会发,**但仍附带游标**)。
 * ⭐ 混成一个函数就要在循环里到处 `if (isUser)`,那是最容易漂的形状。
 *
 * ⚠️⚠️ **但判据的那套道理是照抄的,不是重新想的** ——
 * 下面每一条停止条件都带着它的来历,别再「换个数」:
 *
 * ① **「几页没新人」不能当到底**(`project-x-cursor-paging` 实测)
 * 　 滚动已经采过的人让翻页头几页**天然零新增**,
 * 　 3 页刹车把 2604 账号卡死在 2244、三跑同数,而 X 一直说 hasMore=true。
 * 　 ⭐ 所以**本模块不设空轮上限** —— 要不要停是业务的事(见 `stopPaging`)。
 *
 * ② **「我自己设的闸门」别当成「平台的限制」**
 * 　 (`project-x-followers-2500-ceiling` ——⚠️ 那条结论已被**证否**)
 * 　 所谓「X 天花板 2500」真因是**滚动轮数不够**,
 * 　 而轮数当时是人填的目标值。改掉之后实采 **2781/2782 零失败**。
 * 　 ⭐ 轮数是**安全网不是目标**。
 *
 * ③ **判据必须用「这一页」的人,不能用累计 Map**
 * 　 (`project-x-fast-incremental` 的三铁律之一)
 * 　 累计表里已见过的人不再出现 → 「已知数」恒为 0 → 条件**永不成立**。
 *
 * ⚠️ 本模块**不写快照、不做增量** —— 那是另一件事,而它有自己的铁律:
 * 「快速模式绝不写快照」(存几十人会让下次差集报「取关 2700」,
 * 一次毁基线**且数据里看不出来**)。先把全量采对,增量另开。
 */

import { auditUserPayload, type XUserAudit, type XUserRecord } from './x-user-audit';
import { carriesUsers, X_NOISY_URLS, X_PAGE_MATCHERS } from './x-pages';
import { X_SCRIPTS } from './x-dom-scripts';
import type { RunDeps, RunHarvest } from './x-collect-run';

/**
 * ⭐ **安全网,不是目标**(见文件头 ②)。
 * ⚠️ 2645 人实测要翻 ~130 轮,给到 2000 是为了「人多的号也别被我拦住」——
 * 真正该停的地方是三条数据判据。
 */
const USER_PAGING_SAFETY_ROUNDS = 2000;

/** ⭐ 翻完一页之后问调用方:继续吗 —— 与推文那边同形,但数的是人 */
export type UserPagingState = {
  readonly round: number;
  /** 到目前为止一共多少个**不重复**用户 */
  readonly uniqueUsers: number;
  /** ⭐⭐ **这一页**新增几个(0 = 这一页全是见过的) */
  readonly freshThisRound: number;
  /** ⚠️ 连续多少轮没有新人 —— 业务拿它定自己的刹车,本模块不定 */
  readonly emptyRounds: number;
  /** ⭐ X 说「到头了」(TimelineTerminateTimeline)—— 它仍可能附带游标 */
  readonly terminated: boolean;
};

export type UserRunDeps = Pick<RunDeps, 'harvest' | 'runScript' | 'cancelled' | 'onProgress'> & {
  /**
   * ⭐⭐⭐ **还翻不翻** —— 业务的研判,采集层不替它决定
   * (用户 2026-10-04:「判断是否停下来是由业务编排时的研判逻辑来定,
   * 　而不是你在采集中定下来。」)
   */
  stopPaging?(state: UserPagingState): { readonly go: boolean; readonly why?: string };
};

export type UserRunResult = {
  /** ⭐ 去重后的人,**按名次排好** */
  readonly users: readonly XUserRecord[];
  /** ⭐ 每一页的账 —— 覆盖率/问题都在里面,报告要印 */
  readonly audits: readonly XUserAudit[];
  readonly totalResponses: number;
  readonly paging: {
    readonly rounds: number;
    /** ⭐ 哪道闸停的 —— 报告必须答得出「为什么停在这」 */
    readonly stopReason: string;
    readonly freshTotal: number;
    readonly terminated: boolean;
  };
  /**
   * ⚠️⚠️ **解析出的问题要带出去** —— 空 handle 之类。
   * 解析器把它们放进 `problems`,这里汇总;
   * 丢掉的话「采到 500 人」里有多少是残的就没人知道。
   */
  readonly problems: readonly string[];
};

/** ⭐ 从一次 harvest 里挑出人流载荷并解析 */
function userAuditsOf(rep: RunHarvest, seqFrom: number): XUserAudit[] {
  let seq = seqFrom;
  const out: XUserAudit[] = [];
  for (const it of rep.items) {
    /**
     * ⚠️ 用 `carriesUsers` —— 这三页**曾被 `carriesTweets` 认成时间线**、
     * 喂给推文解析器 → 0 条 + 报「一条推文都没解出来,可能结构变了」。
     * ⭐ 误导性告警**比报错还坏**:它把人指向「X 改版了」这个错方向。
     */
    if (!carriesUsers(it.url)) continue;
    const a = auditUserPayload(it.text, seq);
    seq += a.items.length;
    out.push(a);
  }
  return out;
}

/**
 * ⭐⭐⭐ 采一个人流名单 —— 滚动 + 主动翻页,一直到数据说到头。
 *
 * ⚠️ **不落库** —— 落库是 `saveUsers` 的事,调用方串。
 * 分开是因为「采到了」和「存进去了」是两件事,
 * 而把它们合成一个数正是「面板报入库 44 条、库里 0 行」那家族的起点。
 */
export async function runUserCollect(
  deps: UserRunDeps,
  opts: {
    /** ⭐ 采哪个名单 —— 会原样进 `list_source`,必须是稳定的词 */
    readonly listSource: string;
    /** ⭐ 首轮滚动翻几页 */
    readonly wantPages?: number;
    readonly maxRounds?: number;
  },
): Promise<UserRunResult> {
  const say = (m: string): void => deps.onProgress?.(m);
  let totalResponses = 0;

  say(`开始采 ${opts.listSource}…`);
  const rep = await deps.harvest({
    wantPages: opts.wantPages ?? 1,
    pageUrlIncludes: X_PAGE_MATCHERS,
    noisyUrlSubstrings: X_NOISY_URLS,
    maxRounds: opts.maxRounds,
  });
  if (rep === null) {
    return {
      users: [], audits: [], totalResponses: 0,
      paging: { rounds: 0, stopReason: '首轮没收到响应', freshTotal: 0, terminated: false },
      problems: ['首轮 harvest 返回 null —— 采集压根没跑起来'],
    };
  }
  totalResponses += rep.items.length;

  const audits: XUserAudit[] = userAuditsOf(rep, 0);
  /**
   * ⭐⭐ 去重用 **handle**(小写归一化留给 repo 做,这里只管同形去重)。
   * ⚠️ 用 Map 而不是 Set:后面那份字段可能更全(名单页和资料页给的不一样),
   * 留**后到的**那份。
   */
  const byHandle = new Map<string, XUserRecord>();
  const take = (list: readonly XUserAudit[]): number => {
    const before = byHandle.size;
    for (const a of list) {
      for (const u of a.items) {
        const k = u.handle.toLowerCase();
        /** ⚠️ 空 handle 不进去凑数 —— 解析器已经在 problems 里报过它 */
        if (k === '') continue;
        byHandle.set(k, u);
      }
    }
    return byHandle.size - before;
  };
  take(audits);
  const seedCount = byHandle.size;
  say(`首轮:${byHandle.size} 人`);

  /**
   * ⭐ 翻页要用**页面自己发过的那条请求** —— queryId 与 features 都在里面,
   * 推不出来也不该写死(随 X 版本变)。
   * ⚠️⚠️ **Followers 必须 POST** —— GET 恒 404 + **空 body**,
   * 而空 body 会骗你以为 queryId 过期(社区好几个 issue 标题就这么写)。
   * ⭐ 这里不写死 POST:`fetchNextPage` 脚本做的是
   * 「**404 且响应体非 JSON** 才换形状重试」,并把 `shapeSwitched` 记进留痕 ——
   * 因为本机留痕里 **X 自己用 GET 且成功**,写死反而错。
   */
  const seed = rep.items.find((it) => carriesUsers(it.url) && it.url.includes('variables='));
  let stopReason = `跑满安全网 ${USER_PAGING_SAFETY_ROUNDS} 轮（未触发任何数据判据）`;
  let round = 0;
  let emptyRounds = 0;
  let terminated = audits.some((a) => a.terminated);

  if (seed === undefined || deps.runScript === undefined) {
    stopReason = seed === undefined
      ? '没有可用来翻页的请求（这一页没发过人流载荷）'
      : '调用方没给 runScript —— 不主动翻页';
    say(stopReason);
  } else {
    const seenCursors = new Set<string>();
    while (round < USER_PAGING_SAFETY_ROUNDS) {
      /** ⭐ 每轮开头先看人有没有喊停 —— 停在轮次之间,已采到的都留着 */
      if (deps.cancelled?.()) {
        stopReason = '人点了停止';
        say(`已停止（翻了 ${round} 轮）`); break;
      }
      /**
       * ⭐⭐ X 说到头了 —— `TimelineTerminateTimeline`。
       * ⚠️ 它**仍附带游标**,所以「有游标」不等于「还有人」;
       * 只看游标会在这里空转到安全网。
       */
      if (terminated) {
        stopReason = 'X 发了 TimelineTerminateTimeline（名单到头）';
        say(`翻页结束：${stopReason}（共 ${round} 轮）`); break;
      }
      /** ⭐ 游标取**最新那一份账**里的,不是第一页的 */
      const cursor = [...audits].reverse()
        .map((a) => a.cursor)
        .find((c) => c !== undefined && c !== '');
      if (cursor === undefined) {
        stopReason = '没有下一页游标（X 说到头了）';
        say(`翻页结束：${stopReason}（共 ${round} 轮）`); break;
      }
      /** ⚠️ 同一个游标出现两次 = 翻不动了,**立刻停**,别空转 */
      if (seenCursors.has(cursor)) {
        stopReason = '游标不再变化（真的翻不动了）';
        say(`翻页结束：${stopReason}（共 ${round} 轮）`); break;
      }
      seenCursors.add(cursor);

      round += 1;
      say(`翻页 第 ${round} 页…（已 ${byHandle.size} 人）`);

      let one: RunHarvest | null;
      try {
        await deps.runScript(X_SCRIPTS.fetchNextPage, { url: seed.url, cursor });
        one = await deps.harvest({
          wantPages: 1,
          pageUrlIncludes: X_PAGE_MATCHERS,
          noisyUrlSubstrings: X_NOISY_URLS,
          /** ⚠️ 这一步**不滚动**,只等响应 */
          maxRounds: 0,
        });
      } catch (e) {
        /** ⚠️ 翻页失败**不毁整轮** —— 已经采到的还在 */
        stopReason = `第 ${round} 轮失败：${e instanceof Error ? e.message : String(e)}`;
        say(stopReason); break;
      }
      if (one === null) {
        stopReason = `第 ${round} 轮没收到响应`;
        say(stopReason); break;
      }
      totalResponses += one.items.length;

      const got = userAuditsOf(one, byHandle.size);
      /**
       * ⭐⭐⭐ 判据是「**有没有没见过的人**」,不是「这一页有几个人」。
       * ⚠️ 推文那边正因为数了「页里有几条」而不是「新收了几条」,
       * 该数恒 > 0 → 停止条件**永远到不了**,跑满上限
       * (`feedback-pdca-close-the-loop` 的「数错元素」)。
       */
      const fresh = take(got);
      emptyRounds = fresh === 0 ? emptyRounds + 1 : 0;
      audits.push(...got);
      if (got.some((a) => a.terminated)) terminated = true;

      /**
       * ⭐⭐⭐ **问调用方:还翻吗**。
       * ⚠️ 采集层把它知道的事实都摆出来(翻了几轮、共多少人、这轮新增几个、
       * 连续几轮没新人、X 有没有说到头)—— **怎么用是业务的事**。
       * ⚠️ 不给 `stopPaging` 就一直翻到数据说到头(只有安全网兜底)——
       * 这正是「几页没新人就停」那个错误的反面。
       */
      if (deps.stopPaging) {
        const d = deps.stopPaging({
          round, uniqueUsers: byHandle.size, freshThisRound: fresh, emptyRounds, terminated,
        });
        if (!d.go) {
          stopReason = d.why ?? '业务判定够了';
          say(`翻页结束：${stopReason}（共 ${round} 轮）`); break;
        }
      }
    }
  }

  /**
   * ⭐ 按名次排 —— `seq` 是增量采集的命根子,
   * 乱序存进去「新人全落在 seq 0-10」这条实测判据就用不了了。
   */
  const users = [...byHandle.values()].sort((a, b) => a.seq - b.seq);
  const problems = audits.flatMap((a) => a.problems);

  /**
   * ⭐⭐⭐ **成功路径也要留痕**
   * (`feedback-maintainability-over-feature-completion`:
   * 「你不记录如何做验证」—— 这次采集**完全成功**的依据照样要留下来)。
   * ⚠️ 要同时有「翻了几轮」「哪道闸停的」「翻页带来多少新人」——
   * 上一跑翻了 47 轮而我读不出是哪道判据停的,就是因为只 say() 不落盘。
   */
  console.log(
    `[x.user-run] ${opts.listSource}：${users.length} 人`
    + ` / 载荷 ${totalResponses} / 翻页 ${round} 轮`
    + ` / 翻页新增 ${byHandle.size - seedCount}`
    + ` / 停因:${stopReason}`
    + (problems.length > 0 ? ` / 问题 ${problems.length} 条：${problems[0]}` : ''),
  );

  return {
    users, audits, totalResponses,
    paging: { rounds: round, stopReason, freshTotal: byHandle.size - seedCount, terminated },
    problems,
  };
}
