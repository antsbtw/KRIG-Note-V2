/**
 * ⭐⭐ X 的**数据** IPC(配方 CRUD + 推文落库 + 用户落库)—— **X 自带,与 X 同生共死**
 *
 * ⚠️ `search-recipe-repo` 本来就在(表、CRUD 都齐),
 * 缺的只是「renderer 怎么调到它」这一环。
 *
 * ⚠️⚠️ 本文件**只做接线**:参数校验 + 调 repo + 三态返回。
 * 业务判据(配方怎么翻译成查询)在 `x-recipe-query.ts`,不在这儿。
 */

import { ipcMain, webContents, type WebContents } from 'electron';

import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';

import { appendAction } from './x-ops-actions-repo';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { XDataInvoke, XDataResult } from './x-data-types';
import { clearXHostState, getXHostState, setXHostState } from './x-host-registry';

import { acquirePage, pageBusy, releasePage, revokePage } from './x-page-lock';
import { revokeLocks } from '@platform/main/flow/resource-lock';
import { execute, type CapResult } from '@platform/main/capability/capability';
import { readWsAccount } from './x-account-repo';

import { addToFollowQueue, controlFollowQueue, followQueueStatus } from './x-follow-queue';

import { draftAskReply } from './x-ask-draft';

import { getXDB } from '@storage/surreal/client';
import { judgeVpnPosts } from './x-vpn-run';
import { replyLangOf, vpnLink } from './x-vpn-help';
import type { ReplyLang } from '@shared/types/x-reply-types';

import { runAsk } from './x-ask-run';

import { tracePersonProgress } from './x-person-collect';

const failed = (reason: string): XDataResult => ({ status: 'failed', reason });

/**
 * ⭐⭐ 读关系要知道看哪个号(1.2.27)—— 这个 ws 记的登录号的数字 id。
 * ⚠️ 没认出来就**明说**,不退回「全库那份」(那正是互相覆盖的老问题)。
 */
/** 卡片的三种模式:求关 / 互动 / 回复求助 —— 其余一律当求关 */
const modeOf = (m: unknown): 'ask' | 'engage' | 'vpn' => (m === 'engage' || m === 'vpn' ? m : 'ask');

async function accountOfWs(wsId: unknown): Promise<{ restId: string } | { reason: string }> {
  if (typeof wsId !== 'string' || wsId === '') return { reason: '[x.data] 缺 wsId —— 关系按号存,不知道看哪个号' };
  const a = await readWsAccount(wsId);
  if (!a) return { reason: `${wsId} 还没认出登录的是哪个号 —— 打开 X 网页,在运营面板点「认号」` };
  if (!a.restId) return { reason: `${wsId} 登录的是 @${a.handle},但数字 id 还没拿到 —— 在运营面板点「认号」` };
  return { restId: a.restId };
}

/** ⚠️ 幂等 —— 多窗口/热重载下可能被调多次 */
let wired = false;

export function registerXDataIpc(): void {
  if (wired) return;
  wired = true;

  ipcMain.handle(IPC_CHANNELS.X_DATA_INVOKE, (e, p: XDataInvoke) => handle(p, e.sender));
}

/**
 * ⭐ renderer 申请的锁记在「哪个窗口申请的」名下 —— 窗口直接关掉(来不及 finally 放锁)时主进程自己收回,
 * 不然 X 网页一直「正忙」到超时。
 */
const lockOwnerByToken = new Map<string, number>();
const watchedSenders = new Set<number>();
function trackSenderLock(sender: WebContents, token: string): void {
  lockOwnerByToken.set(token, sender.id);
  if (watchedSenders.has(sender.id)) return;
  watchedSenders.add(sender.id);
  const id = sender.id;
  sender.once('destroyed', () => {
    watchedSenders.delete(id);
    const mine = new Set([...lockOwnerByToken].filter(([, s]) => s === id).map(([t]) => t));
    for (const t of mine) lockOwnerByToken.delete(t);
    if (mine.size > 0) revokeLocks((h) => mine.has(h.token), `申请它的窗口(wc#${id})关掉了,没来得及放`);
  });
}

/**
 * ⭐⭐⭐ 已迁到能力层的 op → 能力 id(Module5-04 第 2 步 + 第 3 步第 1、2、3a、3b 批)
 * 校验 / 认号 / 额度 / 占网页 / 留记录都在执行器;这里只转发,caller = ui。renderer 的 op 名不变。
 */
const CAP_OF_OP: Readonly<Record<string, string>> = {
  list: 'x.recipe.list',
  readCursor: 'x.cursor.read',
  opsStatus: 'x.ops.status',
  wsAccount: 'x.account.read',
  peopleOverview: 'x.people.overview',
  queryPeople: 'x.people.query',
  personDetail: 'x.person.read',
  tagCatalog: 'x.tag.catalog',
  blueMutualOverview: 'x.blueMutual.overview',
  blueMutualCandidates: 'x.blueMutual.candidates',
  blueMutualFollowProgress: 'x.blueMutual.followProgress',
  askFollowStatus: 'x.ask.followStatus',
  relationJobs: 'x.relation.jobs',
  paceStatus: 'x.pace.status',
  personLists: 'x.person.lists',
  personTimeline: 'x.person.timeline',
  vpnOverview: 'x.vpn.overview',
  draftRules: 'x.draft.rules',
  followQueueStatus: 'x.followQueue.status',
  bgStatus: 'x.bg.status',
  bgListJobs: 'x.bg.jobs',
  opsSettings: 'x.settings.read',
  unfollowGate: 'x.unfollow.gate',
  personCollectProgress: 'x.person.collectProgress',
  friendCircle: 'x.person.friendCircle',
  personTweets: 'x.person.tweets',
  engagePrepare: 'x.engage.prepare',
  engageOverview: 'x.engage.overview',
  vpnFind: 'x.vpn.find',
  // 第 3 步第 2 批:改自己的库
  upsert: 'x.recipe.upsert',
  delete: 'x.recipe.delete',
  saveCursor: 'x.cursor.save',
  clearCursor: 'x.cursor.clear',
  setExcluded: 'x.person.setExcluded',
  setTags: 'x.person.setTags',
  vpnHuman: 'x.vpn.mark',
  deferPerson: 'x.person.defer',
  draftRuleActive: 'x.draft.setRuleActive',
  setMutualIntent: 'x.person.setMutualIntent',
  bgCreateJob: 'x.bg.createJob',
  bgPauseJob: 'x.bg.pauseJob',
  bgResumeJob: 'x.bg.resumeJob',
  bgCancelJob: 'x.bg.cancelJob',
  setOpsSetting: 'x.settings.write',
  // 第 3 步第 3a 批:用网页的
  identifyAccount: 'x.account.identify',
  followCheckRun: 'x.followCheck.run',
  relationStart: 'x.relation.start',
  askPrepare: 'x.ask.prepare',
  vpnPrepare: 'x.vpn.prepare',
  engageScreen: 'x.engage.screen',
  engageThread: 'x.engage.thread',
  leftTweet: 'x.left.read',
  engageCollect: 'x.engage.collect',
  // 第 3 步第 3b 批:采集流水线
  searchScroll: 'x.search.scroll',
  spotCheckPoll: 'x.spot.poll',
  spotCheckLookup: 'x.spot.lookup',
  scanMutualIntent: 'x.intent.scan',
  collectPersonTab: 'x.person.collectTab',
  cancelPersonCollect: 'x.person.cancelCollect',
  refreshPerson: 'x.person.refresh',
  saveTweets: 'x.tweet.save',
  saveUsers: 'x.user.save',
  savePageVerify: 'x.page.saveVerify',
};

/**
 * 能力层的统一结果 → 现在 renderer 认的 IPC 形状(过渡:renderer 还没改成认 refused / failed / invalid)。
 * 没成的一律 failed(why),why 原样 —— 界面显示的话和原来一样。
 */
function fromCap(r: CapResult<unknown>, op?: string): XDataResult {
  /**
   * ⚠️ 认号:徽章认的是 { status: ok | pending | failed, reason } —— 没认成也是 ok 包着(它据此重试 / 重读库)。
   * refused = pending(网页忙,等它空了再认),failed = failed;参数不对才是 IPC 失败。
   */
  if (op === 'identifyAccount' && !r.ok && r.kind !== 'invalid') {
    return { status: 'ok', value: { status: r.kind === 'refused' ? 'pending' : 'failed', reason: r.why } };
  }
  return r.ok ? { status: 'ok', value: r.value } : failed(r.why);
}

/** ⭐ 单入口 —— savePageVerify 复用 saveTweets / saveUsers 分支,不另写一份存库流程 */
async function handle(p: XDataInvoke, sender?: WebContents): Promise<XDataResult> {
  {
    try {
      const capId = CAP_OF_OP[(p as { op?: string })?.op ?? ''];
      if (capId) return fromCap(await execute(capId, p, { caller: 'ui' }), p.op);
      switch (p?.op) {
        /**
         * ⭐⭐⭐ **采到的推文落库** —— 2026-10-05。
         * ⚠️ 返回 `inserted / updated / failed` 原样回去 ——
         * 合成一个「保存了 N 条」的话,「全是重复的」和「全是新的」
         * 长得一模一样,而那正是 `INSERT IGNORE` 当年藏住的东西。
         */
        /**
         * ⭐⭐⭐ **采到的 X 用户落库** —— 2026-10-05。
         * ⚠️ 返回 `inserted / updated / skippedNoHandle / failed` **原样回去**:
         * 「全是老人」和「全是新人」合成一个数就分不出来,
         * 而增量采集(以后要做的)全靠这个分别。
         */
        /**
         * ⭐⭐⭐ **断点续采** —— 2026-10-07。
         * ⚠️ scope 为空要拒收:那会让所有名单共用一个断点,
         * A 名单的游标被 B 续采,而那种错在数据里看不出来。
         */
        /** ⭐⭐ 认号(1.2.27)—— 结果三态原样回去,pending/failed 的原因给人看 */
        /** ⭐ 运营 → 人(2026-10-08)—— 只读 */
        case 'followQueueAdd': {
          if (typeof p.wsId !== 'string' || !Array.isArray(p.items)) return failed('[x.data] followQueueAdd 要 wsId 和 items');
          const r = addToFollowQueue(p.wsId, p.items);
          traceRecorder.lifecycle({ layer: 'web.net', event: 'x-follow-queue-add', pageId: 'x-data', detail: { wsId: p.wsId, ...r } });
          return { status: 'ok', value: r };
        }

        /** ⭐⭐ 已迁到能力层(Module5-04 第 2 步):校验 / 认号 / 额度 / 占网页 / 留记录都在执行器,这里只转发 */
        case 'vpnJudge': {
          if (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > 50) return failed('[x.data] vpnJudge 的 limit 要 1–50');
          const acc = await accountOfWs(p.wsId);
          if ('reason' in acc) return failed(acc.reason);
          return { status: 'ok', value: await judgeVpnPosts(acc.restId, p.limit) };
        }

        case 'askDraft': {
          if (typeof p.tweetText !== 'string' || p.tweetText.trim() === '') return failed('[x.data] askDraft 缺他那条帖子的正文');
          const acc = await accountOfWs(p.wsId);
          if ('reason' in acc) return failed(acc.reason);
          const rv = p.revise as { previous?: unknown; note?: unknown; keep?: unknown } | undefined;
          if (rv !== undefined && (typeof rv.previous !== 'string' || typeof rv.note !== 'string' || rv.note.trim() === '')) return failed('[x.data] 点评要上一版 + 点评内容');
          const mode = modeOf(p.mode);
          /** ⭐ 回复求助:试用链接(按这条帖子的配方打来源标识)/ 语言 / 方向 —— 从名单里这条读 */
          let vpn: { link: string; lang: ReplyLang; direction?: 'out' | 'in' | 'none' } | undefined;
          if (mode === 'vpn') {
            if (typeof p.tweetId !== 'string' || p.tweetId === '') return failed('[x.data] 回复求助草拟要 tweetId');
            const me = await readWsAccount(p.wsId as string);
            if (!me?.handle) return failed('认不出登录的号');
            const [post] = await getXDB().query<[Array<{ recipe?: string; verdict?: { direction?: 'out' | 'in' | 'none' } }>]>(
              `SELECT recipe, verdict FROM type::record('x_vpn_post', $id)`, { id: p.tweetId });
            const lang = replyLangOf(p.tweetText);
            vpn = { link: vpnLink(lang, me.handle, post?.[0]?.recipe, new Date()), lang, direction: post?.[0]?.verdict?.direction };
          }
          const r = await draftAskReply({ account: acc.restId, tweet: p.tweetText, person: { name: p.name, bio: p.bio }, mode, vpn,
            context: typeof p.context === 'string' ? p.context : undefined,
            revise: rv ? { previous: rv.previous as string, note: (rv.note as string).trim(), keep: rv.keep === true } : undefined });
          traceRecorder.lifecycle({ layer: 'web.net', event: r.ok ? 'x-ask-draft' : 'x-ask-draft-failed', pageId: 'x-data',
            detail: r.ok ? { ms: r.ms, examples: r.examples, text: r.text } : { why: r.why } });
          return { status: 'ok', value: r };
        }

        case 'askRun': {
          if (typeof p.reply !== 'string' || typeof p.tweetText !== 'string' || typeof p.handle !== 'string'
            || !['tweet', 'bio-latest', 'other'].includes(p.pickKind)) return failed('[x.data] askRun 参数不全');
          const r = await runAsk({ wsId: p.wsId, restId: p.restId, handle: p.handle, tweetId: p.tweetId,
            tweetText: p.tweetText, pickKind: p.pickKind, reply: p.reply,
            aiText: typeof p.aiText === 'string' && p.aiText !== '' ? p.aiText : undefined,
            mode: modeOf(p.mode) });
          traceRecorder.lifecycle({ layer: 'web.net', event: 'x-ask-run', pageId: 'x-data',
            detail: { handle: p.handle, tweetId: p.tweetId, ok: r.ok, blocked: r.blocked, liked: r.liked, replied: r.replied,
              followed: r.followed, failedStep: r.failedStep, detail: r.detail } });
          return { status: 'ok', value: r };
        }

        case 'followQueueControl':
          if (typeof p.wsId !== 'string' || !['pause', 'resume', 'clear'].includes(p.action)) return failed('[x.data] followQueueControl 参数不对');
          controlFollowQueue(p.wsId, p.action);
          console.log(`[x.follow] ${p.wsId} ${p.action}`);
          return { status: 'ok', value: followQueueStatus(p.wsId) };

        /** ⭐⭐⭐ 搜索滚动截获(2026-10-16)—— 配方名在这里对回(推文上记查询串,作者记配方名) */
        /** ⭐ 抽查(2026-10-16)—— 问有没有新请求 / 按 id 查库 */
        /** ⭐⭐ 互关倾向(1.2.30,蓝V互关 M2)—— 扫描结果与人的决定都留痕 */
        /**
         * ⭐⭐⭐ renderer 的 X 网页登记同步进主进程(`x-host-sync.ts`)—— 后台 runner 靠它。
         * ⚠️ webview 销毁时主进程自己清掉:窗口直接关掉时 renderer 来不及发「卸了」,
         * 不清的话 runner 拿已销毁的 wcId 去采 → 没去到页 → 任务被标 failed。
         */
        case 'syncHost': {
          if (typeof p.wsId !== 'string' || p.wsId === '') return failed('[x.data] syncHost 缺 wsId');
          if (p.wcId === null) { clearXHostState(p.wsId); return { status: 'ok', value: { cleared: p.wsId } }; }
          if (!Number.isInteger(p.wcId)) return failed('[x.data] syncHost 的 wcId 要是整数或 null');
          const wc = webContents.fromId(p.wcId);
          if (!wc || wc.isDestroyed()) return failed(`[x.data] syncHost:wc#${p.wcId} 不存在或已销毁`);
          setXHostState(p.wsId, p.wcId, '');
          const ws = p.wsId; const id = p.wcId;
          wc.once('destroyed', () => {
            /** ⚠️ 只清「还是这个 wc」的登记 —— 同 ws 可能已换成新 webview */
            if (getXHostState(ws)?.wcId === id) clearXHostState(ws);
            revokePage(id, `X 网页 wc#${id} 销毁了`);
          });
          console.log(`[x.host] ${p.wsId} 的 X 网页 = wc#${p.wcId}(后台采集可见)`);
          return { status: 'ok', value: { wsId: p.wsId, wcId: p.wcId } };
        }

        /** ⭐⭐⭐ X 网页占用(x-page-lock)—— renderer 只申请,锁只在主进程 */
        case 'pageAcquire': {
          if (!Number.isInteger(p.wcId) || typeof p.purpose !== 'string' || p.purpose === '') return failed('[x.data] pageAcquire 要 wcId 和 purpose');
          const r = acquirePage(p.wcId, p.purpose, 'ui');
          if (r.ok && sender) trackSenderLock(sender, r.token);
          return { status: 'ok', value: r };
        }

        case 'pageRelease': {
          if (typeof p.token !== 'string' || p.token === '') return failed('[x.data] pageRelease 缺 token');
          lockOwnerByToken.delete(p.token);
          const released = releasePage(p.token);
          return released ? { status: 'ok', value: { released } } : failed(`[x.data] pageRelease:这把锁不是你的(已放过 / 超时被收回)`);
        }

        case 'pageBusy':
          if (!Number.isInteger(p.wcId)) return failed('[x.data] pageBusy 缺 wcId');
          return { status: 'ok', value: pageBusy(p.wcId) };

        /** ⭐⭐ 后台采集任务(2026-10-14 第 4 步)—— 只做校验 + 调 repo */
        /** ⭐⭐ 此刻状态(运营顶栏 / 人卡「在不在跑」)+ 这个号各状态任务数 */
        /** ⭐ 运营设置 / 取关闸门 / 动作记录(2026-10-10) */
        case 'logAction': {
          const e = p.entry;
          if (!e || e.action !== 'unfollow' || !e.targetRestId || !e.targetHandle
            || (e.decidedBy !== 'human' && e.decidedBy !== 'ai') || (e.result !== 'ok' && e.result !== 'failed')) {
            return failed('[x.data] logAction 的记录不完整');
          }
          await appendAction(e);
          /** ⭐ 动作也打到主进程日志 —— 人看的那块屏(feedback-log-where-the-human-looks) */
          console.log(`[x.ops] ${e.decidedBy === 'human' ? '人' : 'AI'} ${e.action} @${e.targetHandle} → ${e.result}${e.detail ? `(${e.detail})` : ''}`);
          traceRecorder.lifecycle({
            layer: 'web.net', event: `x-action-${e.result}`, pageId: 'x-data',
            detail: { action: e.action, target: e.targetHandle, restId: e.targetRestId, by: e.decidedBy, detail: e.detail ?? '' },
          });
          return { status: 'ok', value: { logged: true } };
        }

        case 'logPersonProgress':
          /** ⭐ 与主进程采集时写的是同一份(`x-person-collect.ts`):event: 'x-person-progress' */
          tracePersonProgress(p.entry);
          return { status: 'ok', value: { logged: true } };

        case 'logPersonCollect': {
          const e = p.entry;
          console.log(`[x.people] 采 @${e.handle} ${e.tab}(${e.range}):${e.pages} 页 ${e.records} 条(新 ${e.inserted})—— ${e.stopReason || '(无停因)'}`);
          traceRecorder.lifecycle({ layer: 'web.net', event: 'x-person-collect', pageId: 'x-data', detail: { ...e } });
          return { status: 'ok', value: { logged: true } };
        }

        /**
         * ⭐⭐⭐ 一页一存、存完回读(2026-10-16,逐页账)。
         * ⚠️ 存库**走同一条路**(递归调 saveTweets / saveUsers 分支):记账、留痕、按号写关系、本批统计都照旧,
         * 不另写一份(另写就是「加字段要登记的第五处」)。回读按 id 问库,不信返回的计数。
         */
        default:
          /** ⚠️ 不认识的 op 要**明说**,不静默回 ok */
          return failed(`[x.recipe] 不认识的 op: ${String((p as { op?: string })?.op)}`);
      }
    } catch (e) {
      /** ⚠️ 异常如实往上报 —— 吞掉的话界面会显示「保存成功」而库里没有 */
      return failed(`[x.recipe] ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
