/**
 * 通知实时监听 —— **给人看的**,不是给程序算的。
 *
 * 用户 2026-09-03:「这里变成一个主动监听 x 页面变化的方法,显示在监听,
 *   什么时候进来了一条 notification,是什么内容,元数据是什么,统计情况如何?
 *   这样我才能够在测试中发现是否漏东西。
 *   按照你给出的方法,作为人类是无法通过肉眼来识别你给出的结果是否正确。」
 *
 * → 说得对。我给的是**我算出来的结论**(「点赞 2 条」),
 *   而人要核对的是**过程**:什么时候来了什么、原始文案是什么、
 *   我把它解成了什么、为什么算(或不算)这篇文章的。
 *   结论对不对,只有能看见过程才判断得了。
 *
 * 做法:CDP 常驻挂在 X 的 webContents 上,**不导航、不滚动**
 * (X 自己 ~10s 刷新通知页,被动收即可),每捕获一个通知载荷就:
 *   ① 逐条解析
 *   ② 与已见过的比对,标出**本次新增**的
 *   ③ 连同原始文案、目标推、归属判定一起推给界面
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, webContents as allWebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { resolveAnyXWebContents } from './x-webcontents';
import { extractInteractions, isRealInteraction, aggregationGap,
  type Interaction } from './x-notifications';
import { upsertInteractions, upsertCampaignReplies } from '../db/x-campaign-repo';
import { getWsAccount } from '../db/x-ws-role-repo';
import { interactionsToContractItems } from './x-campaign-loop';
import { pushPending } from './x-campaign-push';
import { parseTweetUrl } from './x-article-replies';

/** 一条被观察到的通知事件 —— 字段全部面向「人工核对」 */
export interface NotifEvent {
  /** 观察到的时刻(本地) */
  seenAt: string;
  /** X 给的通知时间 */
  notifiedAt?: string;
  kind: string;
  /** 原始文案 —— 人核对的第一依据 */
  message?: string;
  actorHandle?: string;
  actorUid: string;
  targetId: string;
  targetText?: string;
  targetConversationId?: string;
  targetQuotedStatusId?: string;
  targetHasMedia?: boolean;
  /** 是否算作互动(推荐/社群公告不算)—— 让「为什么没进名单」可见 */
  isInteraction: boolean;
  /** 归属判定:属于配置的那篇文章吗?为什么? */
  belongsToArticle: boolean;
  belongsWhy: string;
  /**
   * 聚合缺口:X 文案说 N 条、载荷只给 1 条时的差额(N−1)。
   * undefined = 非聚合通知。摆出来是为了让「X 扣着多少没给」可见而非静默。
   */
  aggMissing?: number;
}

export interface WatchSnapshot {
  running: boolean;
  articleId?: string;
  startedAt?: string;
  /** 收到过几个通知载荷 */
  payloads: number;
  /** 累计观察到的事件(去重后) */
  total: number;
  /** 按类型计数 */
  byKind: Record<string, number>;
  /** 属于目标文章的条数 */
  belongs: number;
  /** 最近的事件,最新在前 —— 人眼核对用 */
  recent: NotifEvent[];
  /** 上次收到载荷距今多少秒 —— 能看出「是不是还在收」 */
  secondsSinceLastPayload?: number;
  /** 正在监听的**真实 URL** —— 「绿灯却收不到」时第一眼就能看出是不是页面不对 */
  watchingUrl?: string;
  /** 累计入库条数(新增 / 已存在)—— 让「看得到」与「留得下」分开可见 */
  saved?: { inserted: number; existing: number };
  /** 非空 = 监听有异常,面板应变黄。不猜原因,把可能性列清楚给人判断 */
  stallWarning?: string;
  /** 自动跳回通知页的次数 —— 让「页面老被抢走」这件事可见而非无声自愈 */
  returns?: number;
}

interface WatchState {
  wcId: number;
  articleId?: string;
  seen: Map<string, NotifEvent>;
  events: NotifEvent[];
  payloads: number;
  startedAt: number;
  lastPayloadAt?: number;
  onMessage: (e: unknown, method: string, params: any) => void;
  pending: Map<string, string>;
  attached: boolean;
  /** 监听所属 ws 与账号 —— 入库要用(通知是「别人对**这个**账号」) */
  wsId?: string;
  ownerHandle?: string;
  /** 累计入库计数 */
  saved: { inserted: number; existing: number };
  /** 已留档的「解析出 0 条」样本数 —— 限量,避免 X 每 10s 重发刷爆目录 */
  zeroArchived: number;
  /** 自动回通知页:上次导航时刻(冷却用)与累计次数(给人看) */
  lastReturnAt?: number;
  returns: number;
  /**
   * 心跳 —— **卡住的守卫必须自己能响**。
   *
   * ⚠️ broadcast 原先只在「收到载荷」时发,而 stallWarning 恰恰描述的是
   *   **收不到载荷**的状态 —— 靠载荷驱动的推送永远送不出这条警告,
   *   面板会一直停在最后一次正常快照上,绿灯长亮。
   *   (feedback-verify-guard-can-fail:守卫要能真的失败)
   */
  heartbeat: ReturnType<typeof setInterval>;
}

let watch: WatchState | null = null;

/**
 * 当前页面能不能收到通知载荷。
 *
 * ⚠️ 抽成纯函数是为了**能被测试反向注入** —— 这条守卫挡的是「假绿灯」:
 *   停在首页时 CDP attach 一样成功、面板一样显示「● 监听中」,
 *   但 X 只在通知页轮询 NotificationsTimeline,别处一个载荷都不发。
 *   守卫若失效,现象是「等一晚上,零数据,零报错」。
 */
export function canReceiveNotifications(url: string): boolean {
  return /x\.com\/notifications/i.test(url);
}

/**
 * 载荷留档 —— 只在**出现没见过的互动**时写盘。
 *
 * 判据用 `kind|actorUid|targetId`(与 seen 同一把钥匙):X 每 ~10s 重发全量首屏,
 * 无条件写会几分钟塞满一个目录,而全是同一份内容。
 *
 * ⚠️ 聚合类通知(`liked 7 of your posts`)的 targetId 会随代表推变化,
 *   计数从 5 涨到 7 时 key 也变 —— 正好会留档,这正是要抓的样本。
 */
function archiveIfNew(state: WatchState, found: Interaction[], body: string): void {
  const hasNew = found.some(
    (i) => !state.seen.has(`${i.kind}|${i.actorUid}|${i.targetId}`));

  // ⚠️ 2026-09-04 真机踩到:「收到载荷 25 个 · 事件 0 条」——
  //   X 一直在发,解析却一条都出不来(载荷结构变了 / 走了别的字段路径)。
  //   而原先的条件是「有新互动才留档」,于是**最该留证据的情况恰好一个字节都不写**,
  //   排查时手里空空。这正是「守卫在最该响的时候哑掉」那一族。
  //   → 解析出 0 条也必须留档,而且要**优先**留(它才是异常样本)。
  //   限量:同一次监听最多存 3 份 zero,避免 X 每 10s 重发把目录刷爆。
  const parsedNothing = found.length === 0;
  if (parsedNothing) {
    if (state.zeroArchived >= 3) return;
    state.zeroArchived++;
  } else if (!hasNew) {
    return;
  }

  const tag = parsedNothing ? 'zero' : 'new';
  try {
    const dir = join(app.getPath('userData'), 'x-payload-survey');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `watch-${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
      body, 'utf-8');
  } catch (err) {
    // 留档失败不影响监听主流程,但要说出来 —— 否则「样本怎么一直没攒下」查不到原因
    console.warn('[notif-watch] 载荷留档失败:', err);
  }
}

/**
 * 页面被别处导航走时,**自动跳回通知页**。
 *
 * ⚠️ 2026-09-04 用户实测:「有时候它会自动跳转到其他页面而无法捕捉 notification」。
 *   同一个 X webview 被很多路径共用,都会 loadURL 走:
 *     - /refresh 外部触发 → fetchArticleReplies(x-article-replies.ts:161)
 *       ← **最可能的元凶**:campaign-tasks 从别的机器随时敲,本机没人在场
 *     - 试抓 / 抓通知 / 发推 / 配方扫描……
 *   原先的守卫只在**启动时**校验页面,跑起来之后被导航走就只剩一条黄字警告,
 *   而无人值守时没人看得见 —— 通知就这么静默地断了。
 *
 * 策略:发现不在通知页就导航回去,但**留够冷却**(30s),
 *   避免与正在用该 webview 干正事的流程(发推、抓回复)互相打架、
 *   把人家的页面反复抢走。次数计入快照,让「老被抢」可见而不是无声自愈。
 */
export function shouldReturnToNotifications(
  url: string, now: number, lastReturnAt?: number, cooldownMs = 30_000,
): boolean {
  if (canReceiveNotifications(url)) return false;         // 还在通知页,不动
  if (lastReturnAt && now - lastReturnAt < cooldownMs) return false;  // 冷却中
  return true;
}

function returnToNotificationsIfDrifted(): void {
  if (!watch) return;
  const wc = allWebContents.fromId(watch.wcId);
  if (!wc || wc.isDestroyed()) return;
  const url = (() => { try { return wc.getURL(); } catch { return ''; } })();
  const now = Date.now();
  if (!shouldReturnToNotifications(url, now, watch.lastReturnAt)) return;
  watch.lastReturnAt = now;
  watch.returns++;
  console.warn(`[notif-watch] 页面被导航到 ${url || '未知'} —— 自动跳回通知页`
    + `(第 ${watch.returns} 次)`);
  wc.loadURL('https://x.com/notifications').catch((err) => {
    // 跳不回去要说出来,否则又是「看着在监听、其实收不到」
    console.error('[notif-watch] ⚠️ 自动跳回通知页失败:', err);
  });
}

/**
 * 把监听到的互动落库,命中活动文章的顺带走契约推送。
 *
 * ⚠️ **串行化**:CDP 的 loadingFinished 是并发回调,X 每次刷新会同时到几个载荷。
 *   upsertInteractions 是「先 SELECT 再 CREATE」的读改写,并发跑同一条互动会
 *   两边都查不到、然后各 CREATE 一条 —— 重复行。用一条 promise 链排队。
 *
 * ⚠️ 失败**不吞**:入库失败必须让人看见(feedback-fail-loud-no-fallback),
 *   否则又是「面板有、库里没有」这种看着成功实际没有的坑。
 */
let persistChain: Promise<void> = Promise.resolve();

async function persistWatched(state: WatchState, found: Interaction[]): Promise<void> {
  if (found.length === 0) return;
  if (!state.wsId) return;        // 没识别出 ws 就不写,避免写错归属
  const wsId = state.wsId;

  persistChain = persistChain.then(async () => {
    try {
      const r = await upsertInteractions(wsId, state.ownerHandle, found);
      state.saved.inserted += r.inserted;
      state.saved.existing += r.existing;
      if (r.inserted > 0) {
        console.log(`[notif-watch] 入库 +${r.inserted} 条(已存在 ${r.existing})`);
      }

      // 命中活动文章的回复/引用 → 走契约(与主循环同一套判定与推送)
      if (!state.articleId) return;
      const parsed = parseTweetUrl(state.articleId);
      if ('error' in parsed) return;
      const items = interactionsToContractItems(found, parsed.tweetId);
      if (items.length === 0) return;
      await upsertCampaignReplies(parsed.tweetId, items);
      const p = await pushPending(parsed.tweetId);
      console.log(`[notif-watch] 契约推送 accepted=${p.accepted} updated=${p.updated}`
        + (p.fatal ? ` ⚠️ ${p.fatal}` : ''));
    } catch (err) {
      // 面板上看得到、库里却没有 —— 这种不一致必须响
      console.error('[notif-watch] ⚠️ 入库/推送失败(面板显示的条目未必已落库):', err);
    }
  });
  return persistChain;
}

function judgeBelongs(i: Interaction, articleId?: string): { yes: boolean; why: string } {
  if (!articleId) return { yes: false, why: '未配置文章' };
  if (i.targetId === articleId) return { yes: true, why: '直接对文章' };
  if (i.targetQuotedStatusId === articleId) return { yes: true, why: '引用转发' };
  if (i.targetConversationId === articleId) return { yes: true, why: '会话内回复' };
  return { yes: false, why: `针对别的推(${i.targetId || '无目标'})` };
}

function snapshot(): WatchSnapshot {
  if (!watch) {
    return { running: false, payloads: 0, total: 0, byKind: {}, belongs: 0, recent: [] };
  }
  const byKind: Record<string, number> = {};
  for (const e of watch.events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  // 真实 URL:页面可能在监听期间被导航走(用户点了别的),绿灯必须跟着塌
  const wc = allWebContents.fromId(watch.wcId);
  const url = wc && !wc.isDestroyed()
    ? (() => { try { return wc.getURL(); } catch { return ''; } })() : '';

  // ⚠️ 不干等:启动 20s 还是 0 载荷、或收着收着断了 60s,都要把话说出来。
  //   只列可能原因,不替人下结论(X 约 10s 一次刷新,60s 没动就不正常了)。
  const idleMs = Date.now() - (watch.lastPayloadAt ?? watch.startedAt);
  let stallWarning: string | undefined;
  if (!canReceiveNotifications(url)) {
    stallWarning = `页面被导航到「${url || '未知'}」—— X 不再发通知载荷,`
      + `正在自动跳回通知页(已跳回 ${watch.returns} 次);若反复发生,`
      + `多半是 /refresh 外部触发或试抓在抢同一个 webview`;
  } else if (watch.payloads === 0 && idleMs > 20_000) {
    stallWarning = `已等 ${Math.round(idleMs / 1000)}s 仍未收到任何通知载荷 —— `
      + `可能是登录态失效,或 CDP 被别处占用(试抓/抓通知正在跑)`;
  } else if (watch.payloads > 0 && idleMs > 60_000) {
    stallWarning = `距上次载荷已 ${Math.round(idleMs / 1000)}s(正常约 10s 一次)—— `
      + `X 可能停止了自动刷新,试着在通知页手动滚一下`;
  }

  return {
    running: true,
    articleId: watch.articleId,
    startedAt: new Date(watch.startedAt).toISOString(),
    payloads: watch.payloads,
    total: watch.events.length,
    byKind,
    belongs: watch.events.filter((e) => e.belongsToArticle).length,
    recent: [...watch.events].reverse().slice(0, 40),
    secondsSinceLastPayload: watch.lastPayloadAt
      ? Math.round((Date.now() - watch.lastPayloadAt) / 1000) : undefined,
    watchingUrl: url,
    saved: watch.saved,
    stallWarning,
    returns: watch.returns,
  };
}

function broadcast(): void {
  const snap = snapshot();
  for (const wc of allWebContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    try { wc.send(IPC_CHANNELS.X_NOTIF_WATCH_UPDATE, snap); } catch { /* 已销毁 */ }
  }
}

/**
 * 开始监听。**不导航、不滚动** —— 用户可以自由使用 X 页面,
 * 我们只是搭个耳朵在网络层听 X 自己的刷新。
 */
export async function startNotifWatch(
  articleId?: string, targetWcId?: number, wsId?: string,
): Promise<{ ok: true } | { error: string }> {
  if (watch) return { ok: true };

  const resolved = resolveAnyXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  // ⚠️ 2026-09-03 实测踩到的「假绿灯」:resolver 只校验是不是 x.com,
  //   **不校验在哪一页**。停在首页(For you)时 attach 一样成功、面板一样显示
  //   「● 监听中」,但 X 在首页只轮询 HomeTimeline,NotificationsTimeline
  //   一个都不发 —— 于是「收到载荷 0 个」永远不动,而人看着绿灯以为一切正常,
  //   干等下去。这正是「看着成功实际没有」那一族 bug。
  //   → 不在通知页就**拒绝启动并说清楚**,不假装在监听。
  const url = (() => { try { return wc.getURL(); } catch { return ''; } })();
  if (!canReceiveNotifications(url)) {
    return { error: `X 当前停在「${url || '未知页面'}」,不是通知页 —— `
      + `X 只在通知页才会轮询 NotificationsTimeline,在别的页面监听收不到任何载荷。`
      + `请先在左侧点 🔔 切到通知页再开始监听。` };
  }

  // 入库归属:通知是「别人对**该 ws 登录的账号**」。识别不出账号仍可监听
  // (面板照常给人看),但**不入库** —— 宁可不写,不可写错归属。
  const acc = wsId ? await getWsAccount(wsId).catch(() => null) : null;
  if (wsId && !acc) {
    console.warn(`[notif-watch] ws=${wsId} 未识别登录账号 —— 只监听不入库`
      + `(请先点「识别我的账号」)`);
  }

  const state: WatchState = {
    wcId: wc.id, articleId,
    wsId: acc ? wsId : undefined, ownerHandle: acc?.handle,
    saved: { inserted: 0, existing: 0 },
    zeroArchived: 0,
    returns: 0,
    // 占位,attach 成功后立刻换成真心跳(见下方 state.heartbeat = ...)
    heartbeat: setInterval(() => {}, 1 << 30),
    seen: new Map(), events: [], payloads: 0,
    startedAt: Date.now(), pending: new Map(), attached: false,
    onMessage: (_e, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        const u: string = params?.request?.url ?? '';
        if (u.includes('/i/api/graphql/')) state.pending.set(params.requestId, u);
        return;
      }
      if (method === 'Network.loadingFinished') {
        const u = state.pending.get(params.requestId);
        if (!u) return;
        state.pending.delete(params.requestId);
        if (!u.includes('Notifications')) return;
        wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
          .then((r: any) => {
            if (!r?.body) return;
            state.payloads++;
            state.lastPayloadAt = Date.now();
            let parsed: unknown;
            try { parsed = JSON.parse(r.body); } catch { return; }

            const found: Interaction[] = [];
            // ownerHandle 必须传:reply 的判据是 in_reply_to_screen_name == 我,
            // 不传就只能收 quote,回复整类照漏(见 x-notifications 的 TimelineTweet 分支)
            extractInteractions(parsed, found, state.ownerHandle);

            // 原始载荷留档 —— **只在出现没见过的互动时**落盘。
            //
            // ⚠️ 2026-09-04:reply / quote 的真实通知形态至今一个样本都没有,
            //   而「聚合」这一族问题只能靠原始载荷判(文案说 N 条、
            //   target_objects 给几条)。监听是最可能先撞见真实回复的地方,
            //   但它原先不落盘,撞见了也留不下证据 —— 解析后的视图证明不了聚合。
            //   条件落盘:X 每 ~10s 重发一次全量首屏,无条件写会刷屏。
            archiveIfNew(state, found, r.body);

            // ⭐ 入库 —— 监听不再只是「给人看」。
            //   2026-09-03 实测:被动监听秒级就收到新通知,而主循环 3 分钟一轮、
            //   要抢 webview、用户在用就整轮跳过。及时的通道一直在跑,却只推给面板,
            //   关掉面板数据就没了 —— 现成的实时性没接到存储上。
            //   这里**全量入库**(不过滤),取舍仍交给查询层(见 c227c037)。
            void persistWatched(state, found);

            for (const i of found) {
              const key = `${i.kind}|${i.actorUid}|${i.targetId}`;
              if (state.seen.has(key)) continue;      // 只报**新**的
              const b = judgeBelongs(i, state.articleId);
              const ev: NotifEvent = {
                seenAt: new Date().toISOString(),
                notifiedAt: i.notifiedAt,
                kind: i.kind,
                message: i.message,
                actorHandle: i.actorHandle,
                actorUid: i.actorUid,
                targetId: i.targetId,
                targetText: i.targetText,
                targetConversationId: i.targetConversationId,
                targetQuotedStatusId: i.targetQuotedStatusId,
                targetHasMedia: i.targetHasMedia,
                isInteraction: isRealInteraction(undefined, i.message),
                // 聚合缺口:X 说「liked 7 of your posts」却只给 1 条代表推 →
                // 这条事件其实代表 7 次互动,我们只知道 1 条推是哪个。
                // 把差额摆在面板上,而不是让它静悄悄地少(用户要过程)。
                //
                // ⚠️ 这里的「1」是本条通知产出的 target 数:聚合通知实测恒为 1,
                //   非聚合的 aggregationGap 直接返回 undefined,不受影响。
                aggMissing: aggregationGap(i.message, 1)?.missing,
                belongsToArticle: b.yes,
                belongsWhy: b.why,
              };
              state.seen.set(key, ev);
              state.events.push(ev);
              console.log(`[notif-watch] 新通知 [${ev.kind}] @${ev.actorHandle} `
                + `→ 推 ${ev.targetId} · ${ev.belongsWhy} | ${ev.message ?? ''}`);
            }
            broadcast();
          })
          .catch(() => { /* 响应体可能已丢弃 */ });
      }
    },
  };

  try { wc.debugger.attach('1.3'); state.attached = true; }
  catch { /* 已被 attach,共用 */ }
  wc.debugger.on('message', state.onMessage);
  await wc.debugger.sendCommand('Network.enable').catch(() => {});

  // 每 10s 推一次快照:没有载荷时 stallWarning 才送得出去,
  // 「上次收到 N 秒前」也才会自己往上走(否则停在最后一次正常值上)
  clearInterval(state.heartbeat);
  state.heartbeat = setInterval(() => {
    returnToNotificationsIfDrifted();   // 被抢走就自己回来,不干等人来看黄字
    broadcast();
  }, 10_000);

  watch = state;
  console.log('[notif-watch] 开始监听通知(不导航、不滚动,收 X 自己的刷新)'
    + ` · 页面=${url}`
    + (state.wsId ? ` · 入库 ws=${state.wsId} @${state.ownerHandle}` : ' · **不入库**'));
  broadcast();
  return { ok: true };
}

export function stopNotifWatch(): WatchSnapshot {
  if (!watch) return snapshot();
  const final = snapshot();
  // 常驻 timer 必须有停止调用(project-graceful-shutdown 的铁律)
  clearInterval(watch.heartbeat);
  const wc = allWebContents.fromId(watch.wcId);
  if (wc && !wc.isDestroyed()) {
    wc.debugger.off('message', watch.onMessage);
    if (watch.attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }
  }
  console.log(`[notif-watch] 停止 —— 共 ${final.total} 条事件 / ${final.payloads} 个载荷`);
  watch = null;
  broadcast();
  return final;
}

export function notifWatchSnapshot(): WatchSnapshot { return snapshot(); }
