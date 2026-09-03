/**
 * 活动主循环 —— **以通知页为主**(用户 2026-09-03 拍板)。
 *
 * 「上线后,重点关注的是 notification 这个页面吧,观察谁点赞,谁转发。」
 * 「用户操作,后台有操作记录,就可以认可匹配了」
 *
 * ── 为什么通知页能当主循环(实测依据)────────────────────────────
 * 通知的 `target_objects[]` 带的是**完整推文对象**,不是光秃秃的 id。
 * 于是契约判定的三要素一次全给:
 *   谁      ← from_users[](具名 rest_id + handle)
 *   哪篇文章 ← target.legacy.conversation_id_str
 *   带没带图 ← target.legacy.extended_entities.media
 *
 * → 相比「为每篇文章定时轮询详情页」:成本低、覆盖全(赞/转/回/关注一页搞定)、
 *   实时性更好。文章详情页降级为**按需兜底**(通知漏了或超出保留期时)。
 *
 * ⚠️ 边界:通知是「别人对**我**」,这个「我」= 该 ws 登录的账号。
 *    拿不到「第三方对第三方」的互动(X 2024-06 移除,与爬虫水平无关)。
 */

import { harvestNotifications } from './x-notifications';
import { getWsAccount, listWsByRole, campaignInterval } from '../db/x-ws-role-repo';
import { upsertInteractions } from '../db/x-campaign-repo';
import { upsertCampaignReplies } from '../db/x-campaign-repo';
import { pushPending } from './x-campaign-push';
import { parseTweetUrl, type ArticleReplyItem } from './x-article-replies';
import { getActiveWcId } from './x-search-scheduler';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import type { Interaction } from './x-notifications';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
/** 用户正在操作 X 界面时暂停自动抓取,避免抢同一个 webview */
let pausedUntil = 0;

/**
 * 用户碰了 X 界面 —— 暂停自动抓取一段时间。
 *
 * ⚠️ 2026-09-03 实测踩到:主循环每 3 分钟 loadURL 到通知页,
 * 而用户正在同一个 webview 上点推文 —— 页面被硬生生导航走,
 * 表现为**一直转圈**,而且 /health 也卡住(主进程在等 webview)。
 * 这正是 ws 角色隔离要防的争抢,我却在单个 ws 内部又造了一次。
 */
export function pauseCampaignLoop(seconds = 45): void {
  // ⚠️ **暂停时长必须明显短于循环间隔**,否则会饿死循环:
  //   2026-09-03 实测,暂停设成 3 分钟、间隔也是 3 分钟 ——
  //   每次手动操作都把下一轮整轮推掉,6 分钟内一条新互动都没抓到。
  //   目的只是「别在用户点页面的当口抢走它」,45 秒足够,不需要整轮。
  pausedUntil = Date.now() + seconds * 1_000;
  console.log(`[campaign-loop] 用户正在操作 X,暂停自动抓取 ${seconds}s`);
}

/**
 * 把通知里的互动转成契约 item。
 *
 * 只保留**属于目标文章**的回复/引用 —— 契约 §4 的有效判定是
 * kind ∈ {reply, quote} ∧ has_media,点赞/关注不参与判定
 * (但它们仍会入 x_interaction,供画像与后续活动用)。
 */
export function interactionsToContractItems(
  list: Interaction[], articleId: string,
): ArticleReplyItem[] {
  const out: ArticleReplyItem[] = [];
  for (const it of list) {
    // 只有回复/引用算「留言」;点赞关注不是
    if (it.kind !== 'reply' && it.kind !== 'quote') continue;
    // 必须属于这篇文章
    if (it.targetConversationId !== articleId) continue;
    if (!it.actorHandle || !it.targetCreatedAt) continue;

    out.push({
      tweet_id: it.targetId,
      kind: it.kind === 'quote' ? 'quote' : 'reply',
      x_uid: it.actorUid,
      username: normalizeHandle(it.actorHandle),
      // ⚠️ 带图与否取自被操作推自己的 extended_entities(与详情页同一判据)
      has_media: it.targetHasMedia === true,
      created_at: it.targetCreatedAt,
      text_excerpt: it.targetText,
    });
  }
  return out;
}

/** 跑一轮:抓通知 → 落互动 → 命中活动文章的转成契约 item 落库 → 推送 */
export async function runCampaignRound(): Promise<void> {
  const wsList = await listWsByRole('campaign');
  if (wsList.length === 0) return;

  for (const cfg of wsList) {
    const acc = await getWsAccount(cfg.wsId);
    if (!acc) {
      // 登录态未识别 —— 说清楚而不是静默跳过,否则会以为「没人互动」
      console.warn(`[campaign-loop] ws=${cfg.wsId} 未识别登录账号,跳过本轮`);
      continue;
    }

    const wcId = getActiveWcId(cfg.wsId) ?? undefined;
    const r = await harvestNotifications(wcId);
    if ('error' in r) {
      console.warn(`[campaign-loop] ws=${cfg.wsId} 抓通知失败:${r.error}`);
      continue;
    }
    if (r.problems.length) console.warn('[campaign-loop] 通知采集问题:', r.problems);

    // 所有互动都入库(点赞/转发也要 —— 后续活动与画像要用)
    const saved = await upsertInteractions(cfg.wsId, acc.handle, r.interactions);

    // 命中活动文章的回复/引用 → 走契约
    let pushedSummary = '';
    if (cfg.articleId) {
      const parsed = parseTweetUrl(cfg.articleId);
      if (!('error' in parsed)) {
        const items = interactionsToContractItems(r.interactions, parsed.tweetId);
        if (items.length > 0) {
          await upsertCampaignReplies(parsed.tweetId, items);
          const p = await pushPending(parsed.tweetId).catch((err) => {
            console.error('[campaign-loop] 推送失败:', err);
            return null;
          });
          if (p) pushedSummary = `,推送 accepted=${p.accepted} updated=${p.updated}`
            + (p.fatal ? ` ⚠️ ${p.fatal}` : '');
        }
      }
    }

    console.log(`[campaign-loop] ws=${cfg.wsId}(@${acc.handle}): `
      + `互动 ${r.interactions.length} 条(新增 ${saved.inserted})${pushedSummary}`);
  }
}

/** 启动主循环。间隔取各 campaign ws 配置里的最小值(默认 3 分钟) */
export async function startCampaignLoop(): Promise<void> {
  await stopCampaignLoop();

  const wsList = await listWsByRole('campaign').catch(() => []);
  if (wsList.length === 0) {
    console.log('[campaign-loop] 没有 campaign 角色的 ws,不启动');
    return;
  }
  const minutes = Math.min(...wsList.map(campaignInterval));

  timer = setInterval(() => {
    // 上一轮没跑完就跳过 —— 通知页抓取要占用 webview,重入会互相打断
    if (running) { console.log('[campaign-loop] 上一轮未结束,跳过'); return; }
    // 用户正在用 X 界面 —— 让路,不跟他抢 webview
    if (Date.now() < pausedUntil) {
      console.log('[campaign-loop] 用户正在操作 X,本轮跳过');
      return;
    }
    running = true;
    runCampaignRound()
      .catch((err) => console.error('[campaign-loop] 本轮异常:', err))
      .finally(() => { running = false; });
  }, minutes * 60_000);

  console.log(`[campaign-loop] 已启动,每 ${minutes} 分钟一轮(通知页驱动)`);
}

export async function stopCampaignLoop(): Promise<void> {
  if (timer) { clearInterval(timer); timer = null; }
}

export function campaignLoopRunning(): boolean {
  return timer !== null;
}
