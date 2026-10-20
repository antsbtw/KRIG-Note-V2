/**
 * ⭐⭐ 采某人的一个名单的一段 —— 主进程(2026-10-19 人卡采名单;10-20 并进「关系采集」任务)
 *
 * 用户 10-20:「在任务中添加一个"关系采集"这样的完整任务…先读取用户的bio,了解现状…比对库中的差距;制定采集策略,
 *  然后自动采集,并显示进度。」—— 策略在建任务时定好(x-relation-plan.ts),这里照着执行一段:
 *  · incremental:从第一页往下,连续 KNOWN_RUN 个库里已有的 = 追上了,这个名单做完
 *  · full:翻到 X 说到头;够数(≥98%)才把这轮没再出现的标成走了(只对我自己的号)
 * 存法:
 *  · 我自己的号 → 存人时 listSource 用名单名(写「他和我」的关系;变了自动进关系变化表)
 *  · 别人的号 → listSource 固定 'person-list'(不冒充「我的名单」)+ 记 x_list_member
 * 撞限流 → 不算失败:保住断点,交给节奏自调(x-pace)放慢,歇够了接着翻。
 */
import { getXDB } from '@storage/surreal/client';
import { webviewPorts } from './x-collect-ports';
import { runCollect } from './x-collect-run';
import { pageProblem } from './x-page-ledger';
import { accountForWrite } from './x-account-repo';
import { PEOPLE_WITH_RELATION, type AccountDecision } from './x-account';
import { existingUserIds, saveUsers, writeRelations } from './x-user-repo';
import { writeListMembers } from './x-list-member-repo';
import { scanMutualIntent } from './x-people-repo';
import { makeKnownRunTracker } from './x-follow-back';
import { isRateLimited } from './x-pace';
import { KNOWN_RUN, canReconcile, escalateAfterCatchUp, type RelTabPlan } from './x-relation-plan';
import type { BgListTab } from './x-bg-job';
import type { RunOneResult } from './x-bg-segment';

/** 我自己的名单存人时的 listSource(与 X_USER_LIST_PAGES 同一组词) */
const SELF_LIST_SOURCE: Record<BgListTab, string> = { followers: 'followers', following: 'following', verifiedFollowers: 'verifiedFollowers' };

/** 开始这一段前,库里已经有的这个名单的人 */
async function readKnown(account: string, owner: string, list: BgListTab, self: boolean): Promise<Set<string>> {
  const db = getXDB();
  if (!self) {
    const [r] = await db.query<[string[]]>('SELECT VALUE member FROM x_list_member WHERE owner = $o AND list = $l', { o: owner, l: list });
    return new Set(r ?? []);
  }
  if (list === 'verifiedFollowers') {
    const [r] = await db.query<[string[]]>(`SELECT VALUE rest_id FROM ${PEOPLE_WITH_RELATION} WHERE follows_me = true AND is_blue_verified = true`, { acct: account });
    return new Set(r ?? []);
  }
  const col = list === 'followers' ? 'follows_me' : 'i_follow';
  const [r] = await db.query<[string[]]>(`SELECT VALUE person FROM x_relation WHERE account = $a AND ${col} = true`, { a: account });
  return new Set(r ?? []);
}

/** 库里现在这个名单有几个人(复核用;与 x-relation-task dbCounts 同口径) */
async function countNow(account: string, owner: string, list: BgListTab, self: boolean): Promise<number> {
  return (await readKnown(account, owner, list, self)).size;
}

/**
 * ⭐ 全量到底后对账:这一轮(任务开始之后)没再看到、库里还记着「关注着」的 → 标成不关注了。
 * ⚠️ 写关系有时间守卫:这一轮看到过的人观察时间已经比任务开始晚,不会被这里改。
 */
async function reconcileSelf(account: AccountDecision & { kind: 'ok' }, list: 'followers' | 'following', startedAt: string): Promise<number> {
  const col = list === 'followers' ? 'follows_me' : 'i_follow';
  const [stale] = await getXDB().query<[string[]]>(
    `SELECT VALUE person FROM x_relation WHERE account = $a AND ${col} = true AND observed_at < type::datetime($t)`,
    { a: account.restId, t: startedAt },
  );
  const now = new Date().toISOString();
  const obs = (stale ?? []).map((person) => (list === 'followers' ? { person, followsMe: false, observedAt: now } : { person, iFollow: false, observedAt: now }));
  if (obs.length === 0) return 0;
  const r = await writeRelations(account, obs, `relation-reconcile-${list}`);
  if (r.report.failed > 0) throw new Error(`对账写关系失败 ${r.report.failed} 个:${r.report.firstFailure}`);
  console.log(`[x.relation] 全量对账 ${list}:${obs.length} 人这轮没再出现 → 标成不${list === 'followers' ? '关注我' : '关注他'}了`);
  return obs.length;
}

export async function collectPersonListSegment(input: {
  readonly wcId: number;
  readonly page: string;
  readonly list: BgListTab;
  readonly handle: string;
  readonly ownerRestId: string;
  readonly pageCap: number;
  readonly resumeCursor?: string;
  /** ⭐ 关系采集的策略;没有(10-19 人卡老任务)= 全量、别人的号 */
  readonly plan?: RelTabPlan;
  readonly self?: boolean;
  /** 任务开始时间 —— 全量对账用 */
  readonly startedAt?: string;
  readonly onProgress?: (m: string) => void;
}): Promise<RunOneResult> {
  const account = await accountForWrite(input.wcId);
  if (account.kind !== 'ok') {
    const why = `认不出这个 X 网页登录的号:${account.reason}`;
    return { pages: 0, saved: 0, exhausted: false, stopReason: why, failure: why };
  }
  const self = input.self === true;
  if (self && account.restId !== input.ownerRestId) {
    const why = `任务是采我自己(${input.ownerRestId})的名单,但这个 X 网页登录的是 @${account.handle}(${account.restId})`;
    return { pages: 0, saved: 0, exhausted: false, stopReason: why, failure: why };
  }
  const mode = input.plan?.mode ?? 'full';
  const known = await readKnown(account.restId, input.ownerRestId, input.list, self);
  const tracker = makeKnownRunTracker(known, KNOWN_RUN);
  const ports = webviewPorts(input.wcId);
  const go = await ports.goto(input.page, { handle: input.handle });
  if (!go.ok) return { pages: 0, saved: 0, exhausted: false, stopReason: go.reason, failure: go.reason };

  let saved = 0;
  let seen = 0;
  let writeError: string | undefined;
  const run = await runCollect({
    harvest: ports.harvest,
    runScript: ports.runScript,
    savePage: async ({ page, users }) => {
      if (users.length === 0) return { inDb: [] };
      const ids = users.map((u) => u.restId);
      /** ⚠️ 续采时前面那趟滚动(抄请求模板)会把第一页再拿一次 —— 照存,但不算进这一段的人数 / 追上判据 */
      const seedRepeat = input.resumeCursor !== undefined && page === 0;
      try {
        await saveUsers(users, { listSource: self ? SELF_LIST_SOURCE[input.list] : 'person-list' }, account);
        if (!self) await writeListMembers(input.ownerRestId, input.list, ids, account.restId);
        if (!seedRepeat) {
          saved += ids.length;
          seen += ids.length;
          tracker.feed(ids);
        }
      } catch (e) {
        writeError ??= e instanceof Error ? e.message : String(e);
        return { error: writeError };
      }
      return { inDb: await existingUserIds(ids) };
    },
    stopPaging: (st) => {
      if (mode === 'incremental' && tracker.state.caughtUp) return { go: false, why: `追上了:连续 ${KNOWN_RUN} 个库里已有的` };
      return st.round >= input.pageCap ? { go: false, why: `本段翻够 ${input.pageCap} 页上限` } : { go: true };
    },
    onProgress: input.onProgress,
    /** ⚠️ 不给 wait:撞限流让这一段停下,交给节奏自调放慢(不在采集里干等占着网页) */
  }, { wantPages: 1, depth: 'as-is', seedPages: 1, maxRounds: 20, maxMs: 60_000, resumeCursor: input.resumeCursor });

  const stopReason = run.paging?.stopReason ?? '(没有翻页:种子页就没拿到名单)';
  const limited = isRateLimited(stopReason);
  const ledgerBad = (run.paging?.ledger ?? []).map(pageProblem).find((x) => x !== undefined);
  /** 扛不住的(没带鉴权头 / 一页对不上 / 写库失败)→ failure,任务停下等人看;限流不在这里 */
  const failure = writeError ?? (limited ? undefined : ledgerBad ?? (/403|没带鉴权头/.test(stopReason) ? stopReason : undefined));
  const exhausted = !limited && (run.exhausted ?? false);
  const caughtUp = mode === 'incremental' && tracker.state.caughtUp;

  let reconciled: number | undefined;
  let note: string | undefined;
  let escalate: string | undefined;
  /** ⭐ 增量追上后复核:库里现在和 X 还差一截 → 改全量(PDCA,2026-10-20 真机:追上了还差 ~150) */
  if (failure === undefined && caughtUp && input.plan) {
    escalate = escalateAfterCatchUp(input.plan, await countNow(account.restId, input.ownerRestId, input.list, self));
    if (escalate) note = escalate;
  }
  if (limited) note = `被限流 —— 这一段停在这里,节奏自动放慢,歇够了从断点接着翻`;
  if (failure === undefined && exhausted && input.plan && self && (input.list === 'followers' || input.list === 'following')) {
    /** ⭐ 够不够数用库里的真实人数(任务开始后被看到、仍在名单里的),不用各段累加 —— 累加会被重复页撑大 */
    const col = input.list === 'followers' ? 'follows_me' : 'i_follow';
    const [cnt] = await getXDB().query<[Array<{ n: number }>]>(
      `SELECT count() AS n FROM x_relation WHERE account = $a AND ${col} = true AND observed_at >= type::datetime($t) GROUP ALL`,
      { a: account.restId, t: input.startedAt ?? new Date(0).toISOString() },
    );
    const c = canReconcile(input.plan, cnt?.[0]?.n ?? 0, true);
    if (c.ok && input.startedAt) {
      try { reconciled = await reconcileSelf(account, input.list, input.startedAt); note = `对账:${c.why};${reconciled} 人这轮没出现,标成走了`; }
      catch (e) { note = `对账没做成:${e instanceof Error ? e.message : String(e)}`; }
    } else {
      note = c.why;
    }
  }
  try {
    await scanMutualIntent();
  } catch (e) {
    console.warn(`[x.list] 扫互关倾向出错(名单已存):${e instanceof Error ? e.message : String(e)}`);
  }
  return {
    pages: run.paging?.rounds ?? 0,
    saved,
    /** 限流时没拿到新游标 → 保住原断点,别从头再翻 */
    nextCursor: run.nextCursor ?? (limited ? input.resumeCursor : undefined),
    exhausted,
    caughtUp,
    stopReason,
    failure,
    note,
    listStats: { seen, fresh: tracker.state.fresh.length, reconciled, note },
    escalate,
  };
}
