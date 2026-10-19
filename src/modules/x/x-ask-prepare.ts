/**
 * ⭐⭐ 求关:准备一个人(2026-10-17)—— 主进程
 * 采他主页最新几页(设置 ask.collect_pages,默认 2;人卡同一条路:一页一存、逐页账)→ 读 Bio / 名字 → 按规则选推文(x-ask-plan.ts)。
 * 放弃的人记成「算法排除」(写明原因;人标过的不动)—— 不再出现在候选里。
 */
import { getXDB } from '@storage/surreal/client';
import { getXHostBusy, getXHostState } from './x-host-registry';
import { bgRunningOn } from './x-bg-runner';
import { collectPersonTab } from './x-person-collect';
import { X_PAGE_NAME } from './x-pages';
import { readPerson } from './x-people-repo';
import { pickAskTweet, type AskPlan } from './x-ask-plan';
import { followQueueStatus } from './x-follow-queue';
import { readSettings } from './x-ops-actions-repo';

export type AskPrepared =
  | { readonly ok: false; readonly why: string }
  | { readonly ok: true; readonly plan: AskPlan; readonly person: { restId: string; handle: string; name?: string; bio?: string; followers?: number; followsMe?: boolean } ; readonly ledgerProblem?: string };

/** 算法排除 —— 人 > AI > 算法:人或 AI 定过的不改 */
const EXCLUDE_RULE_SQL = `UPDATE type::record('x_author', $rest_id) SET
  excluded = true, excluded_source = 'rule', excluded_reason = $reason, excluded_at = time::now()
  WHERE excluded_source = NONE OR excluded_source = 'rule' RETURN rest_id`;

export async function prepareAsk(wsId: string, account: string, restId: string, handle: string): Promise<AskPrepared> {
  const wcId = getXHostState(wsId)?.wcId;
  if (wcId === undefined) return { ok: false, why: 'X 网页没开' };
  const busy = getXHostBusy(wcId);
  if (busy !== null) return { ok: false, why: `X 网页正忙:${busy}` };
  if (bgRunningOn(wcId) !== null) return { ok: false, why: '后台正在采' };
  if (followQueueStatus(wsId).current) return { ok: false, why: '关注队列正在动作' };

  const { settings } = await readSettings();
  const r = await collectPersonTab({ wcId, page: X_PAGE_NAME.profile, handle, restId, pageCap: settings['ask.collect_pages'], attempt: 1 });
  if (!r.reached) return { ok: false, why: `去不到他的主页:${r.reason}` };
  const p = await readPerson(account, restId);
  /** ⭐ 求关过的人 = 再互动(2026-10-19):避开求关过的推文;选不到也**不排除**他(他已在求关名单里,排除会让他从分析里消失) */
  const [asked] = await getXDB().query<[string[]]>(
    'SELECT VALUE tweet_id FROM x_ask WHERE account = $a AND person = $p', { a: account, p: restId },
  );
  const revisit = (asked ?? []).length > 0 ? { avoidIds: new Set(asked) } : undefined;
  const plan = pickAskTweet(r.records, { restId, handle, bio: p?.bio, name: p?.display_name }, revisit);
  /**
   * ⚠️ 只有「采到了他的推文、账对得上、确实没求关」才排除;
   * 一条都没采到 / 这一页账对不上 = 我们这边的问题,不能算到他头上(不排除,说清楚)。
   */
  if (!revisit && plan.kind === 'skip' && plan.recent.length > 0 && r.ledgerProblem === undefined) {
    await getXDB().query(EXCLUDE_RULE_SQL, { rest_id: restId, reason: `求关放弃:${plan.why}` });
  }
  console.log(`[x.ask] @${handle}:${plan.kind === 'skip' ? `放弃 —— ${plan.why}` : `选推文 ${plan.tweet.id}(${plan.why})`}`);
  return {
    ok: true, plan, ledgerProblem: r.ledgerProblem,
    person: { restId, handle, name: p?.display_name, bio: p?.bio, followers: p?.followers_count, followsMe: p?.follows_me },
  };
}
