/**
 * ⭐⭐ 对一个 webview 采一个标签页 —— **主进程侧**的采集编排(2026-10-13,后台策略 3a)
 *
 * 原来这段在 renderer(`XOpsPeople.tsx::collectTweets`):runCollect 循环跑在 renderer,
 * 每轮经 webDomInvoke 转发到 main。后台 runner(3b)跑在主进程、**没有 renderer**,
 * 所以把「去那一页 → runCollect」搬到这里,人卡和 runner 都调它,不复制、不漂移。
 *
 * ── 为什么住在 X 模块而不是能力层(用户 2026-10-13 确认)──
 * 它要调 X 的 `runCollect` / `timeWindowStop`;放进能力层会撞
 * `capability-site-agnostic`「能力层不许 import 业务模块」,也会破坏「删 X = 删一目录 + 删一行」。
 * ⭐ 能力层只给通用原语(`web-collect-engine` 的 goto/harvest/run 入口),本文件只往下调。
 *
 * ── 只采,不存 ──
 * 返回 records,存库 / 采集记录(logPersonCollect)/ 重试 / UI 状态**全留给调用方**
 * (人卡保留「第一轮 403 重载再试」;runner 用 `x-bg-segment` 的 runSegment 包它)。
 *
 * ⚠️ 本文件零 Electron —— 真动作经 `WebviewPorts` 注入(主进程实现在 `x-collect-ports.ts`),
 * 所以能离线测「没去到页就不采」「参数原样传给 runCollect」这些编排判断。
 */

import { runCollect, type RunDeps } from './x-collect-run';
import { newestOwn, timeWindowStop } from './x-person-timeline';
import type { TweetRecord } from './x-timeline-audit';

/** 对一个 webview 的三个真动作 —— 主进程里由 `x-collect-ports.ts` 接到能力层 */
export type WebviewPorts = {
  /** 去语义页。⚠️ degraded 算到了(与 renderer 旧逻辑一致:只有 failed 才算没到) */
  goto(name: string, params: Record<string, string>): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
  harvest: RunDeps['harvest'];
  runScript: NonNullable<RunDeps['runScript']>;
};

export type CollectOnWebviewInput = {
  /** 语义页名(x.profile / x.withReplies / x.reposts) */
  readonly page: string;
  readonly handle: string;
  /** 他的 rest_id —— 「这一页他自己最新的一条」按它认 */
  readonly restId: string;
  /** 从这个游标接着翻(后台断点续采);不给就从首页开始 */
  readonly resumeCursor?: string;
  /** 范围起点 —— 这一页他自己最新的推文早于它就停;undefined=全部 */
  readonly start?: Date;
  /** 最多翻几页 */
  readonly pageCap: number;
};

export type CollectOnWebviewHooks = {
  /** 人点了停止 / runner 要停 */
  cancelled(): boolean;
  /** 每做一步报一句(翻到第几页 / 歇 / 限流) */
  onProgress(msg: string): void;
  /** 等一会儿(限流退避 / 随机停顿)—— ⚠️ 调用方负责「等的时候也能被叫停」 */
  wait(ms: number): Promise<void>;
};

export type CollectOnWebviewResult =
  /** 没去到这一页 —— ⚠️ 一条都没采,别在原页上接着采(那会静默串页) */
  | { readonly reached: false; readonly reason: string }
  | {
      readonly reached: true;
      /** 采到的推文(已滤掉没 id 的) */
      readonly records: readonly TweetRecord[];
      /** runCollect 的翻页账(没翻页时 null)—— 人卡据此判「第一轮就 403」 */
      readonly paging: { readonly rounds: number; readonly stopReason: string } | null;
      /** 停下来时手里的游标(下次续)—— 后台 runner 用 */
      readonly nextCursor?: string;
      /** X 说到头了 —— 后台 runner 用 */
      readonly exhausted: boolean;
      /** 翻页前沿:最后一页里他自己最新那条的时间(没翻页时 undefined)—— 后台进度「采到」用 */
      readonly frontierAt?: string;
    };

/**
 * ⭐ 首页采集给**明确的上限**(默认是 3000 轮 / 20 分钟,那是给名单用的)。
 * 首页来了就停(seedPages 1);之后全靠游标翻页。—— 与 renderer 旧版同参。
 */
const OPTS = { wantPages: 1, depth: 'expand-only', seedPages: 1, maxRounds: 20, maxMs: 60_000 } as const;

export async function collectOnWebview(
  ports: WebviewPorts,
  input: CollectOnWebviewInput,
  hooks: CollectOnWebviewHooks,
): Promise<CollectOnWebviewResult> {
  const go = await ports.goto(input.page, { handle: input.handle });
  if (!go.ok) return { reached: false, reason: go.reason };

  /**
   * ⭐⭐ 翻页前沿 = 最后一页里**他自己**最新那条的时间(与停止判据同一口径)。
   * ⚠️ 2026-10-14 真机:后台进度原来用「这一段所有推文里最新一条」→ 永远显示今天;
   * 也不能用「最旧一条」—— 置顶 / 被他引用的旧推会把它拉到几年前(真库这一段混着 2022 的一条)。
   */
  const stop = timeWindowStop(input.restId, input.start, input.pageCap);
  let frontierAt: string | undefined;
  const run = await runCollect({
    harvest: ports.harvest,
    runScript: ports.runScript,
    stopPaging: (st) => {
      frontierAt = newestOwn(st.roundRecords, input.restId) ?? frontierAt;
      /**
       * ⭐⭐ 每页记一句「他自己几条 · 最新 · 最旧」—— 停止判据就是拿这一页的「最新」做决定的,
       * 不记下来,停不下来/停早了都只能猜(2026-10-15 真机:半年采到 270 页,进度卡在 08-27 不动,
       * 疑是置顶推文每页都回来 —— 没有这一行就证实不了)。
       */
      const own = st.roundRecords.filter((r) => r.authorRestId === input.restId && r.createdAt && r.pinned !== true)
        .map((r) => ({ id: r.id, t: Date.parse(r.createdAt!) })).filter((x) => !Number.isNaN(x.t));
      if (own.length > 0) {
        const newest = own.reduce((a, b) => (b.t > a.t ? b : a));
        const oldest = own.reduce((a, b) => (b.t < a.t ? b : a));
        const d = (t: number): string => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
        hooks.onProgress?.(`第 ${st.round} 页:他自己 ${own.length} 条 · 最新 ${d(newest.t)}(${newest.id}) · 最旧 ${d(oldest.t)}`);
      } else {
        hooks.onProgress?.(`第 ${st.round} 页:没有他自己的推文(共 ${st.roundRecords.length} 条)`);
      }
      return stop(st);
    },
    cancelled: hooks.cancelled,
    onProgress: hooks.onProgress,
    wait: hooks.wait,
  }, { ...OPTS, resumeCursor: input.resumeCursor });

  return {
    reached: true,
    records: (run.summary?.items ?? []).map((t) => t.record).filter((r) => r.id !== ''),
    paging: run.paging ? { rounds: run.paging.rounds, stopReason: run.paging.stopReason } : null,
    nextCursor: run.nextCursor,
    exhausted: run.exhausted ?? false,
    frontierAt,
  };
}
