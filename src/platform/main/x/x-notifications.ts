/**
 * 通知页采集 —— 「谁对我做了什么」的具名名单(入向互动)。
 *
 * 用户 2026-09-03:「应该获取它的元数据:点赞多少次(名单),转发多少次(名单),
 *   回复多少次(名单)。只有能够区别出这些,才能够谈得上更新多少个呀?」
 *   「这个需要在 notification 中拿到」——**对,已实测验证**。
 *
 * ⚠️ 与社区调研的关键差异(能力勘查 §3.1):
 *   twikit 等库用的是 v1.1 REST(`globalObjects.notifications`),
 *   而 x.com 网页端实际调 **GraphQL NotificationsTimeline**,
 *   字段路径完全不同(实测 globalObjects 为空)——
 *   照 twikit 的 recipe 写解析会**一条都解不出来**。
 *
 * ⚠️ twikit 的第二个坑:它只取 `fromUsers[0]`。
 *   实测「X and 2 others liked your reply」的 from_users **确实是 3 个** ——
 *   只取第一个会丢掉 2/3 的名单。本实现取全量。
 *
 * ⚠️ 边界:通知是「别人对**我**」,这个「我」= **该 ws 登录的账号**。
 *   拿不到「第三方对第三方」的点赞(X 2024-06 移除,与爬虫水平无关)。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { resolveXWebContents } from './x-webcontents';
import { normalizeHandle } from '@shared/types/x-timeline-types';

/**
 * 一条入向互动。
 *
 * ⭐ 2026-09-03 实测的关键发现(用户点出「应该是可以找到对应的元数据的」):
 *   `target_objects[]` 带的是**完整推文对象**(22 个 legacy 字段),
 *   不是一个光秃秃的 id。于是契约判定的三要素通知页一次全给:
 *     谁(from_users)+ 哪篇文章(conversation_id_str)+ 带没带图(extended_entities)
 *   → 文章详情页从「必需」降级为「兜底」,主循环改走通知页。
 */
export interface Interaction {
  kind: 'like' | 'retweet' | 'reply' | 'follow' | 'quote' | 'mention' | 'other';
  actorUid: string;
  actorHandle?: string;
  /** 被操作的推 id;follow 类没有目标推,用空串 */
  targetId: string;
  notifiedAt?: string;
  message?: string;
  /** 被操作推的会话根 = **它属于哪篇文章**(契约的 article_id) */
  targetConversationId?: string;
  /** 被操作推**自己**带了图/视频(契约的 has_media,发奖励的硬条件) */
  targetHasMedia?: boolean;
  /** 被操作推的正文摘要,给运营看 */
  targetText?: string;
  /** 被操作推的发布时间 */
  targetCreatedAt?: string;
}

/**
 * icon → 行为类型。
 *
 * ⚠️ 实测样本里只见过 heart_icon / bell_icon / report_icon / recommendation_icon,
 *   **没见过转发的 icon**。故 retweet 的映射是按 X 的命名惯例推的,
 *   未实机验证 —— 见到真样本前不能声称「转发名单已可用」。
 *   未知 icon 一律归 other 并保留原文案,便于事后补映射(而不是丢掉)。
 */
/**
 * 是不是「别人对我做了什么」的真实互动。
 *
 * ⚠️ 实测:通知页里 16 条有 13 条是 `recommendation_icon` —— 那是
 * **X 推给你的内容**(「Recent post from X」),不是用户对你的行为。
 * 把它们当成互动会污染名单:活动核验会把 X 的推荐算成用户参与。
 */
export function isRealInteraction(icon: string | undefined, message?: string): boolean {
  const i = (icon ?? '').toLowerCase();
  // 推荐流/系统通知,一律不是互动
  if (i.includes('recommendation') || i.includes('report') || i.includes('announcement')) return false;
  const k = iconToKind(icon, message);
  return k !== 'other';
}

export function iconToKind(icon: string | undefined, message?: string): Interaction['kind'] {
  const i = (icon ?? '').toLowerCase();
  if (i.includes('heart')) return 'like';
  if (i.includes('retweet') || i.includes('repost')) return 'retweet';   // 📖 未实测
  if (i.includes('person') || i.includes('follow')) return 'follow';
  if (i.includes('reply') || i.includes('conversation')) return 'reply';
  if (i.includes('quote')) return 'quote';
  if (i.includes('mention') || i.includes('at_icon')) return 'mention';
  // 文案兜底:X 的文案比 icon 名更稳定
  const m = (message ?? '').toLowerCase();
  if (m.includes('liked')) return 'like';
  if (m.includes('reposted') || m.includes('retweeted')) return 'retweet';
  if (m.includes('followed')) return 'follow';
  if (m.includes('replied')) return 'reply';
  return 'other';
}

/**
 * 解析通知时间。
 *
 * ⚠️ 字段名是 `timestamp_ms`,但实测值是 **ISO 字符串**;也可能是真毫秒数。
 * 两种都接,解析不出就返回 undefined —— 宁可缺时间,不可写入 Invalid Date。
 */
export function parseNotifTime(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v === 'string' && v) {
    // 纯数字字符串按毫秒,其余按日期串
    const d = /^\d+$/.test(v) ? new Date(Number(v)) : new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

/**
 * 从 NotificationsTimeline 载荷里解出具名互动。
 *
 * 结构(实测):
 *   TimelineNotification
 *     ├── notification_icon
 *     ├── rich_message.text
 *     ├── timestamp_ms
 *     └── template.{from_users[], target_objects[]}
 */
export function extractInteractions(node: unknown, out: Interaction[]): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const it of node) extractInteractions(it, out);
    return;
  }
  const o = node as Record<string, unknown>;

  if (o.__typename === 'TimelineNotification') {
    const icon = typeof o.notification_icon === 'string' ? o.notification_icon : undefined;
    const rich = o.rich_message as Record<string, unknown> | undefined;
    const msg = rich && typeof rich.text === 'string' ? rich.text : undefined;
    // ⚠️ 字段名叫 timestamp_ms,**实际值却是 ISO 字符串**
    //   (实测:'2026-08-20T16:35:09.521Z',不是毫秒数)。
    //   照名字 Number() 会得到 NaN,再 toISOString() 直接抛 RangeError ——
    //   离线拿真实载荷验证时当场炸了,靠字段名想当然就会踩。
    //   两种形态都兼容,解析失败一律留 undefined,不写坏值进库。
    const ts = parseNotifTime(o.timestamp_ms);
    const kind = iconToKind(icon, msg);
    // 推荐流不是互动 —— 跳过,但**继续递归**(嵌套里可能还有真通知)
    if (!isRealInteraction(icon, msg)) {
      for (const v of Object.values(o)) extractInteractions(v, out);
      return;
    }

    const tpl = o.template as Record<string, unknown> | undefined;
    const fromUsers = Array.isArray(tpl?.from_users) ? tpl!.from_users as unknown[] : [];
    const targets = Array.isArray(tpl?.target_objects) ? tpl!.target_objects as unknown[] : [];

    // 目标推(follow 类没有)。⭐ 不只取 id —— target 里带着完整推文对象,
    // 契约要的 conversation_id / has_media 都在它的 legacy 里(实测)。
    //
    // ⚠️ **必须遍历全部 target**,不能只取第一个(2026-09-03 用户对账发现):
    //   一条通知可以覆盖多条推 ——「reposted **2 of your posts**」
    //   「liked **4 of your posts**」。只取 target[0] 会把 4 次点赞记成 1 次,
    //   与用户在页面上数出来的数字对不上。
    //   这与 from_users 那个坑是同一个形态:聚合通知里**两个维度都是数组**,
    //   我避开了 actor 那个,却在 target 上照犯。
    interface TargetInfo {
      id: string; conversationId?: string; hasMedia?: boolean;
      text?: string; createdAt?: string;
    }
    const targetInfos: TargetInfo[] = [];
    for (const t of targets) {
      const tr = ((t as Record<string, unknown>)?.tweet_results as Record<string, unknown>)
        ?.result as Record<string, unknown> | undefined;
      if (!tr || typeof tr.rest_id !== 'string') continue;
      const lg = tr.legacy as Record<string, unknown> | undefined;
      const ext = lg?.extended_entities as Record<string, unknown> | undefined;
      let createdAt: string | undefined;
      if (lg && typeof lg.created_at === 'string') {
        const d = new Date(lg.created_at);
        if (!Number.isNaN(d.getTime())) createdAt = d.toISOString();
      }
      targetInfos.push({
        id: tr.rest_id,
        conversationId: lg && typeof lg.conversation_id_str === 'string'
          ? lg.conversation_id_str : undefined,
        // ⚠️ 只认自己的 extended_entities.media(预览卡不算、引用原文的图不算)
        hasMedia: lg ? Array.isArray(ext?.media) && (ext!.media as unknown[]).length > 0 : undefined,
        text: lg && typeof lg.full_text === 'string' ? lg.full_text.slice(0, 200) : undefined,
        createdAt,
      });
    }
    // follow 类没有目标推 —— 用一个空目标占位,保证仍产出一条记录
    if (targetInfos.length === 0) targetInfos.push({ id: '' });

    // ⚠️ 取**全部** from_users(twikit 的坑),再与**全部** target 交叉 ——
    // 「A and 2 others liked 4 of your posts」= 3 人 × 4 推 = 12 条互动事实。
    for (const u of fromUsers) {
      const ur = ((u as Record<string, unknown>)?.user_results as Record<string, unknown>)
        ?.result as Record<string, unknown> | undefined;
      if (!ur || typeof ur.rest_id !== 'string') continue;
      const core = ur.core as Record<string, unknown> | undefined;
      const handle = core && typeof core.screen_name === 'string'
        ? normalizeHandle(core.screen_name) : undefined;
      for (const ti of targetInfos) {
        out.push({
          kind, actorUid: ur.rest_id, actorHandle: handle,
          targetId: ti.id, notifiedAt: ts, message: msg,
          targetConversationId: ti.conversationId,
          targetHasMedia: ti.hasMedia,
          targetText: ti.text,
          targetCreatedAt: ti.createdAt,
        });
      }
    }
  }

  for (const v of Object.values(o)) extractInteractions(v, out);
}

export interface NotificationHarvest {
  interactions: Interaction[];
  payloads: number;
  rounds: number;
  problems: string[];
}

/**
 * 抓通知页(CDP 捕获 NotificationsTimeline 载荷)。
 *
 * ⚠️ 只用**指定 ws** 的 webview —— 通知属于该 ws 登录的账号,
 *   跑到别的 ws 上抓会拿到别人的通知(用户 2026-09-03 指正过这类错误)。
 */
export async function harvestNotifications(
  targetWcId?: number,
  maxRounds = 20,
): Promise<NotificationHarvest | { error: string }> {
  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const seen = new Map<string, Interaction>();
  const pending = new Map<string, string>();
  let payloads = 0;
  let notifPayloads = 0;
  const problems: string[] = [];

  const onMessage = (_e: unknown, method: string, params: any): void => {
    if (method === 'Network.requestWillBeSent') {
      const u: string = params?.request?.url ?? '';
      if (u.includes('/i/api/graphql/')) pending.set(params.requestId, u);
      return;
    }
    if (method === 'Network.loadingFinished') {
      const u = pending.get(params.requestId);
      if (!u) return;
      pending.delete(params.requestId);
      wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
        .then((r: any) => {
          if (!r?.body) return;
          payloads++;
          if (!u.includes('Notifications')) return;      // 只吃通知接口
          notifPayloads++;
          // 诊断落盘:通知载荷是「谁对我做了什么」的唯一真源,
          // 出问题时(如核验名单恒为空)必须能回看原始结构,而不是靠猜。
          try {
            const dir = join(app.getPath('userData'), 'x-payload-survey');
            mkdirSync(dir, { recursive: true });
            writeFileSync(
              join(dir, `notif-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
              r.body, 'utf-8');
          } catch { /* 诊断落盘失败不影响主流程 */ }
          try {
            const found: Interaction[] = [];
            extractInteractions(JSON.parse(r.body), found);
            for (const it of found) {
              seen.set(`${it.kind}|${it.actorUid}|${it.targetId}`, it);
            }
          } catch { /* 非 JSON */ }
        })
        .catch(() => { /* 响应体可能已丢弃 */ });
    }
  };

  let attached = false;
  try { wc.debugger.attach('1.3'); attached = true; }
  catch { /* 已被 attach */ }
  wc.debugger.on('message', onMessage);
  await wc.debugger.sendCommand('Network.enable').catch(() => {});

  let rounds = 0;
  try {
    wc.loadURL('https://x.com/notifications');
    // 等首个通知响应(首屏就带数据,不必固定长等)
    const deadline = Date.now() + 10_000;
    while (notifPayloads === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }

    let lastCount = 0;
    let noGrowth = 0;
    for (let i = 1; i <= maxRounds; i++) {
      rounds = i;
      if (seen.size === lastCount) {
        noGrowth++;
        if (noGrowth >= 4) break;
      } else { noGrowth = 0; lastCount = seen.size; }

      await wc.executeJavaScript(
        `window.scrollBy(0, window.innerHeight * 0.85)`).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 800));
    }
  } finally {
    wc.debugger.off('message', onMessage);
    if (attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }
  }

  // fail loud:一个通知载荷都没捕到 ≠ 没有通知
  if (notifPayloads === 0) {
    problems.push(`未捕获到 NotificationsTimeline 响应(共 ${payloads} 个 GraphQL 响应)`
      + ` —— 可能是页面没加载/登录态失效,而**不是**没有互动`);
  }

  return { interactions: [...seen.values()], payloads: notifPayloads, rounds, problems };
}
