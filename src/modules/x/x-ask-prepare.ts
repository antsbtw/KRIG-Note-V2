/**
 * ⭐⭐ 求关:准备一个人(2026-10-17)—— 主进程
 * 采他主页最新几页(设置 ask.collect_pages,默认 2;人卡同一条路:一页一存、逐页账)→ 读 Bio / 名字 → 按规则选推文(x-ask-plan.ts)。
 * 放弃的人记成「算法排除」(写明原因;人标过的不动)—— 不再出现在候选里。
 */
import { getXDB } from '@storage/surreal/client';
import { getXHostState } from './x-host-registry';
import { acquirePage, releasePage } from './x-page-lock';
import { collectPersonTab } from './x-person-collect';
import { X_PAGE_NAME } from './x-pages';
import { readPerson } from './x-people-repo';
import { pickAskTweet, type AskPlan } from './x-ask-plan';
import { followQueueStatus } from './x-follow-queue';
import { readSettings } from './x-ops-actions-repo';
import { accountForWrite } from './x-account-repo';
import { writeRelations } from './x-user-repo';

export type AskPrepared =
  | { readonly ok: false; readonly why: string }
  | {
    readonly ok: true; readonly plan: AskPlan;
    readonly person: { restId: string; handle: string; name?: string; bio?: string; followers?: number; followsMe?: boolean };
    readonly ledgerProblem?: string;
    /** ⭐ 刚从 X 读到的「我和他」(他自己推文载荷里带的);没读到 = undefined */
    readonly live?: { readonly following?: boolean; readonly followedBy?: boolean };
    /** ⭐ 互动卡:选中那条的来龙去脉(原帖 → 来回 → 这条;2026-10-22) */
    readonly thread?: import('./x-engage-thread-model').EngageThread & { readonly fetchNote?: string };
  };

/** 算法排除 —— 人 > AI > 算法:人或 AI 定过的不改 */
const EXCLUDE_RULE_SQL = `UPDATE type::record('x_author', $rest_id) SET
  excluded = true, excluded_source = 'rule', excluded_reason = $reason, excluded_at = time::now()
  WHERE excluded_source = NONE OR excluded_source = 'rule' RETURN rest_id`;

/**
 * ⭐⭐ 准备期间占住 X 网页(Module5-04 §1.3 bug 2):原来只查别人忙不忙、自己采的那几秒不登记 →
 * 巡检 / 后台采集到点就把网页带走,卡片采到的不是这个人。
 */
export async function prepareAsk(wsId: string, account: string, restId: string, handle: string): Promise<AskPrepared> {
  const wcId = getXHostState(wsId)?.wcId;
  if (wcId === undefined) return { ok: false, why: 'X 网页没开' };
  if (followQueueStatus(wsId).current) return { ok: false, why: '关注队列正在动作' };
  const lock = acquirePage(wcId, `求关卡:准备 @${handle}`, 'ui');
  if (!lock.ok) return lock;
  try {
    return await prepareAskOn(wcId, account, restId, handle);
  } finally {
    releasePage(lock.token);
  }
}

async function prepareAskOn(wcId: number, account: string, restId: string, handle: string): Promise<AskPrepared> {
  const { settings } = await readSettings();
  const r = await collectPersonTab({ wcId, page: X_PAGE_NAME.profile, handle, restId, pageCap: settings['ask.collect_pages'], attempt: 1 });
  if (!r.reached) return { ok: false, why: `去不到他的主页:${r.reason}` };
  const p = await readPerson(account, restId);
  /** ⭐ 求关过的人 = 再互动(2026-10-19):避开求关过的推文;选不到也**不排除**他(他已在求关名单里,排除会让他从分析里消失) */
  const [asked] = await getXDB().query<[string[]]>(
    'SELECT VALUE tweet_id FROM x_ask WHERE account = $a AND person = $p', { a: account, p: restId },
  );
  const revisit = (asked ?? []).length > 0 ? { avoidIds: new Set(asked) } : undefined;

  /**
   * ⭐⭐ 动手前核对现状(2026-10-21 用户:「准备发消息前要再确认用户的新状态,否则继续关注一个已经关注过的用户可不太好。」
   * 截图 @luoyisidi:X 上已是 Following + Follows you,库里还当候选)。
   * 用刚采到的他自己推文里 X 给的关系(following = 我关注他,followedBy = 他关注我),先写回库;
   *  · 第一次求关:我已经关注他 → 不求关
   *  · 再互动(我关注着、等他回关):他已经回关 → 不用再互动
   */
  const mine = r.records.find((t) => t.authorRestId === restId && (t.following !== undefined || t.followedBy !== undefined));
  const live = mine ? { following: mine.following, followedBy: mine.followedBy } : undefined;
  if (live) {
    const acc = await accountForWrite(wcId);
    if (acc.kind === 'ok') {
      await writeRelations(acc, [{ person: restId, iFollow: live.following, followsMe: live.followedBy, observedAt: new Date().toISOString() }], 'ask-prepare')
        .catch((e) => console.warn(`[x.ask] @${handle} 关系没写回:${e instanceof Error ? e.message : String(e)}`));
    }
  }
  const stopWhy = !live ? undefined
    : !revisit && live.following === true ? (live.followedBy === true ? '已经互关了(X 上刚看到)—— 不用求关' : '我已经关注他了(X 上刚看到),他还没回关 —— 不重复求关')
      : revisit && live.followedBy === true ? '他已经回关了(X 上刚看到)—— 不用再互动'
        : undefined;
  if (stopWhy) {
    console.log(`[x.ask] @${handle}:${stopWhy}`);
    return {
      ok: true, live, ledgerProblem: r.ledgerProblem,
      plan: { kind: 'skip', recent: [], why: stopWhy, alreadyRelated: true },
      person: { restId, handle, name: p?.display_name, bio: p?.bio, followers: p?.followers_count, followsMe: live?.followedBy },
    };
  }
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
    ok: true, plan, ledgerProblem: r.ledgerProblem, live,
    person: { restId, handle, name: p?.display_name, bio: p?.bio, followers: p?.followers_count, followsMe: live?.followedBy ?? p?.follows_me },
  };
}
