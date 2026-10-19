/**
 * ⭐⭐ 采某人的一个名单的一段 —— 主进程(2026-10-19,人卡采他的 followers / following / verified followers)
 *
 * 用户 10-19:「在人卡中增加自动采集follower/following/verified followers这三个自动采集的方法吧。」
 * 选「后台慢慢采全」→ 后台任务(kind = lists)每段调这里:去他的名单页,从断点翻 N 页,
 * 每页存人(按号写「他和我」的关系)+ 记「他在谁的名单里」(x_list_member)+ 回读,最后扫一遍互关倾向。
 *
 * ⚠️ 存人用的 listSource 固定 'person-list':x_author.list_memberships 原本记「我的哪个名单采到过他」,
 *   别人的名单不能写成 followers / following,否则意思就成了「他是我的关注者」。
 * ⚠️ 名单页「到头」只认 direction: Bottom 的 TimelineTerminateTimeline(10-19 修过)。
 */
import { webviewPorts } from './x-collect-ports';
import { runCollect } from './x-collect-run';
import { pageProblem } from './x-page-ledger';
import { accountForWrite } from './x-account-repo';
import { existingUserIds, saveUsers } from './x-user-repo';
import { writeListMembers } from './x-list-member-repo';
import { scanMutualIntent } from './x-people-repo';
import type { BgListTab } from './x-bg-job';
import type { RunOneResult } from './x-bg-segment';

export async function collectPersonListSegment(input: {
  readonly wcId: number;
  readonly page: string;
  readonly list: BgListTab;
  readonly handle: string;
  readonly ownerRestId: string;
  readonly pageCap: number;
  readonly resumeCursor?: string;
  readonly onProgress?: (m: string) => void;
}): Promise<RunOneResult> {
  const account = await accountForWrite(input.wcId);
  if (account.kind !== 'ok') {
    const why = `认不出这个 X 网页登录的号:${account.reason}`;
    return { pages: 0, saved: 0, exhausted: false, stopReason: why, failure: why };
  }
  const ports = webviewPorts(input.wcId);
  const go = await ports.goto(input.page, { handle: input.handle });
  if (!go.ok) return { pages: 0, saved: 0, exhausted: false, stopReason: go.reason, failure: go.reason };

  let saved = 0;
  let writeError: string | undefined;
  const run = await runCollect({
    harvest: ports.harvest,
    runScript: ports.runScript,
    savePage: async ({ users }) => {
      if (users.length === 0) return { inDb: [] };
      const ids = users.map((u) => u.restId);
      try {
        await saveUsers(users, { listSource: 'person-list' }, account);
        saved += await writeListMembers(input.ownerRestId, input.list, ids, account.restId);
      } catch (e) {
        writeError ??= e instanceof Error ? e.message : String(e);
        return { error: writeError };
      }
      return { inDb: await existingUserIds(ids) };
    },
    stopPaging: (st) => (st.round >= input.pageCap
      ? { go: false, why: `本段翻够 ${input.pageCap} 页上限` } : { go: true }),
    onProgress: input.onProgress,
    /** 限流退避时等着(runCollect 自己判多久) */
    wait: (ms) => new Promise((r) => { setTimeout(r, ms); }),
  }, { wantPages: 1, depth: 'as-is', seedPages: 1, maxRounds: 20, maxMs: 60_000, resumeCursor: input.resumeCursor });

  const stopReason = run.paging?.stopReason ?? '(没有翻页:种子页就没拿到名单)';
  const ledgerBad = (run.paging?.ledger ?? []).map(pageProblem).find((x) => x !== undefined);
  /** 扛不住的(限流 / 没带鉴权头 / 一页对不上 / 写库失败)→ failure,任务停下等人看(异常即停) */
  const failure = writeError ?? ledgerBad ?? (/403|没带鉴权头|限流|429/.test(stopReason) ? stopReason : undefined);
  try {
    await scanMutualIntent();
  } catch (e) {
    console.warn(`[x.list] 扫互关倾向出错(名单已存):${e instanceof Error ? e.message : String(e)}`);
  }
  return {
    pages: run.paging?.rounds ?? 0,
    saved,
    nextCursor: run.nextCursor,
    exhausted: run.exhausted ?? false,
    stopReason,
    failure,
  };
}
