/**
 * ⭐ 翻我的 followers 直到追上 —— 编排(依赖注入,不碰 Electron / 库;2026-10-19 第 4 阶段)
 *
 * 从 x-follow-check.ts 抽出来,为了能拿假页面做**行为测试**(源码扫描看不见会不会执行)。
 * 每页(种子页也是)存人 → 数连续老关注者 → 追上了 / 到页数上限 / X 说名单到头 就停。
 */
import { runCollect, type RunDeps, type RunResult } from './x-collect-run';
import { makeKnownRunTracker } from './x-follow-back';
import type { XUserRecord } from './x-user-audit';

export async function scanFollowersUntilCaughtUp(
  deps: {
    readonly harvest: RunDeps['harvest'];
    readonly runScript?: RunDeps['runScript'];
    /** 存这一页的人并回读(返回库里查得到的 id) */
    readonly save: (users: readonly XUserRecord[]) => Promise<{ readonly inDb: readonly string[] }>;
  },
  opts: { readonly known: ReadonlySet<string>; readonly limit: number; readonly maxPages: number },
): Promise<{ readonly run: RunResult; readonly pages: number; readonly caughtUp: boolean; readonly stopReason: string; readonly tracker: ReturnType<typeof makeKnownRunTracker> }> {
  const tracker = makeKnownRunTracker(opts.known, opts.limit);
  let pages = 0;
  const run = await runCollect({
    harvest: deps.harvest,
    runScript: deps.runScript,
    savePage: async ({ users }) => {
      pages += 1;
      if (users.length === 0) return { inDb: [] };
      const r = await deps.save(users);
      tracker.feed(users.map((u) => u.restId));
      return r;
    },
    stopPaging: (st) => {
      if (tracker.state.caughtUp) return { go: false, why: `追上了:连续 ${tracker.state.run} 个原来就关注我的人` };
      if (st.round + 1 >= opts.maxPages) return { go: false, why: `到页数上限 ${opts.maxPages} 页还没追上` };
      return { go: true };
    },
  }, { wantPages: 1, depth: 'as-is', seedPages: 1, maxRounds: 20, maxMs: 60_000 });
  const stopReason = run.paging?.stopReason ?? '(没有翻页:种子页就没拿到名单)';
  /** X 说名单到头了 = 整份都看过了,也算追上 */
  const caughtUp = tracker.state.caughtUp || /到头/.test(stopReason);
  return { run, pages, caughtUp, stopReason, tracker };
}
