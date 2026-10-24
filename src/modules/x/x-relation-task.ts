/**
 * ⭐⭐⭐ 关系采集任务 —— 主进程入口(2026-10-20)
 *
 * 用户 10-20:「在任务中添加一个"关系采集"这样的完整任务吧,具体要求是:1、先读取用户的bio,了解现状,
 *  followers/following/verified followers;2、比对库中的差距;制定采集策略,然后自动采集,并显示进度。」
 *
 * 一步到底:去他的主页读 X 显示的人数 → 比对库 → 每个名单定策略(x-relation-plan.ts)→ 建后台任务(kind = lists)马上开跑。
 * 后面一段段采由后台节奏控制器跑(节奏自调,x-pace);进度在任务页看。
 * ⚠️ 读主页要占一下 X 网页:忙 / 后台在采 / 正在查回关 → 让路,说清楚。
 */
import { getXDB } from '@storage/surreal/client';
import { webviewPorts } from './x-collect-ports';
import { X_NOISY_URLS, X_PAGE_NAME } from './x-pages';
import { getXHostState } from './x-host-registry';
import { kickBgRunner } from './x-bg-runner';
import { acquirePage, releasePage } from './x-page-lock';
import { followCheckRunning } from './x-follow-check';
import { accountForWrite } from './x-account-repo';
import { PEOPLE_WITH_RELATION } from './x-account';
import { auditUserPayload } from './x-user-audit';
import { PROFILE_ENDPOINT, pickProfileUser } from './x-person-refresh';
import { refreshPerson } from './x-user-repo';
import { createJob, listJobs, readJob } from './x-bg-job-repo';
import { kindOf, type BgJob, type BgListTab } from './x-bg-job';
import { planRelation, type RelPlan } from './x-relation-plan';

const BUSY = '任务:关系采集读现状';

/** 库里这个名单现在有几个人 */
async function dbCounts(account: string, owner: string, self: boolean): Promise<Record<BgListTab, number>> {
  const db = getXDB();
  if (self) {
    const [r] = await db.query<[Array<{ f: number; g: number; v: number }>]>(
      `SELECT count(follows_me = true) AS f, count(i_follow = true) AS g, count(follows_me = true AND is_blue_verified = true) AS v
         FROM ${PEOPLE_WITH_RELATION} GROUP ALL`, { acct: account },
    );
    return { followers: r?.[0]?.f ?? 0, following: r?.[0]?.g ?? 0, verifiedFollowers: r?.[0]?.v ?? 0 };
  }
  const [r] = await db.query<[Array<{ list: BgListTab; n: number }>]>(
    'SELECT list, count() AS n FROM x_list_member WHERE owner = $o GROUP BY list', { o: owner },
  );
  const c: Record<BgListTab, number> = { followers: 0, following: 0, verifiedFollowers: 0 };
  for (const x of r ?? []) c[x.list] = x.n;
  return c;
}

export type RelationStart =
  | { readonly ok: false; readonly why: string }
  | { readonly ok: true; readonly created: boolean; readonly jobId: string; readonly plan: RelPlan };

/**
 * @param target 不给 = 我自己(这个 ws 登录的号)
 */
export async function startRelationTask(wsId: string, target?: { readonly restId: string; readonly handle: string }, trigger: 'auto' | 'manual' = 'manual'): Promise<RelationStart> {
  const wcId = getXHostState(wsId)?.wcId;
  if (wcId === undefined) return { ok: false, why: `${wsId} 的 X 网页没开` };
  if (followCheckRunning() !== null) return { ok: false, why: '正在查回关' };
  const account = await accountForWrite(wcId);
  if (account.kind !== 'ok') return { ok: false, why: `认不出这个 X 网页登录的号:${account.reason}` };
  const who = target ?? { restId: account.restId, handle: account.handle };
  const self = who.restId === account.restId;

  /** 已经有一个在跑 / 排队 → 不重建,把那个的策略给出去 */
  const running = (await listJobs(wsId)).find((j) => kindOf(j) === 'lists' && j.restId === who.restId && j.status !== 'done' && j.status !== 'failed');
  if (running?.plan) return { ok: true, created: false, jobId: running.id, plan: running.plan };

  /** ⭐ 读现状要开他的主页 —— 占住 X 网页;被占着(后台在采一段 / 查回关 / 卡片准备 …)就不读,说出来 */
  const lock = acquirePage(wcId, BUSY, trigger === 'auto' ? 'timer' : 'ui');
  if (!lock.ok) return { ok: false, why: lock.why };
  let followers: number | undefined;
  let following: number | undefined;
  try {
    const rep = await webviewPorts(wcId).harvest({
      gotoPage: { name: X_PAGE_NAME.profile, params: { handle: who.handle } },
      pageUrlIncludes: [PROFILE_ENDPOINT], wantPages: 1, maxRounds: 3, maxMs: 10_000,
      noisyUrlSubstrings: X_NOISY_URLS,
    });
    const items = (rep?.items ?? []).filter((it) => it.url.includes(PROFILE_ENDPOINT));
    const rec = pickProfileUser(items.flatMap((it) => auditUserPayload(it.text).items), who.handle, who.restId);
    if (!rec) return { ok: false, why: `没读到 @${who.handle} 的主页资料(${items.length === 0 ? '主页资料那条请求没来' : '载荷里找不到这个人'})` };
    followers = rec.followersCount;
    following = rec.followingCount;
    /** 顺手把他的资料和「他和我」的关系更新进库 */
    await refreshPerson(rec, account);
  } finally {
    releasePage(lock.token);
  }

  const plan = planRelation({
    target: who, self, trigger, xCounts: { followers, following },
    db: await dbCounts(account.restId, who.restId, self), now: new Date(),
  });
  const r = await createJob({ restId: who.restId, handle: who.handle, wsId, range: 'all', kind: 'lists', plan });
  console.log(`[x.relation] @${who.handle}${self ? '(我)' : ''} 现状:关注者 X ${followers ?? '?'} / 库 ${plan.tabs.followers.dbCount}(${plan.tabs.followers.mode})`
    + ` · 他关注的 X ${following ?? '?'} / 库 ${plan.tabs.following.dbCount}(${plan.tabs.following.mode})`
    + ` · 蓝V关注者 库 ${plan.tabs.verifiedFollowers.dbCount}(${plan.tabs.verifiedFollowers.mode})→ 任务 ${r.id}`);
  kickBgRunner();
  const job = await readJob(r.id);
  return { ok: true, created: r.created, jobId: r.id, plan: job?.plan ?? plan };
}

/** 任务页:这个号的关系采集任务(最新的在前) */
export async function listRelationJobs(wsId: string): Promise<BgJob[]> {
  return (await listJobs(wsId)).filter((j) => kindOf(j) === 'lists');
}
