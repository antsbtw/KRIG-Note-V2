/**
 * X 自动回复 —— 草稿规划(阶段 3)
 *
 * 职责:给一批推文产出「待发草稿」,**只填不发**。
 *
 * ⚠️⚠️ 沿用写方向最高红线(x-write.ts §9):
 *   永远是「填充内容,用户点发布」,**绝不程序自动点发布**。
 *   本模块产出 ReplyDraft,由用户在 X 页面上自己点回复 —— 不碰发布按钮。
 *
 * 分工(2026-09-04 离线评测定的):
 *   ① 前置规则过滤 —— 刷屏/冷却/已回过/屏蔽。**不问模型**,模型一次只看一条,
 *      判不出「同一句话出现过 3 次」这种跨条现象(评测里唯一残留的假阳正是此类)。
 *   ② 模型判「要不要回」 —— 实测 准确 93.8% / 精确 97.3% / 召回 90.0%。
 *   ③ 模板选择 —— **不问模型**(离线一致率仅 37%,且语料本身无信号),
 *      按去重轮换,避免同一模板连发被判水军。
 */

import { callOllama } from '../local-llm/ollama-client';
import { getBlockedHandleSet } from '../db/x-author-repo';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import type { JudgeConfig, TweetInboxRecord } from '@shared/types/x-timeline-types';
import {
  REPLY_TEMPLATES, REPLY_CONFIDENCE_FLOOR, SAME_AUTHOR_COOLDOWN_HOURS,
  buildRef, renderTemplate,
  type ReplyDecision, type ReplyDraft, type ReplyPlanResult,
  type ReplySkip, type ReplyTemplateId,
} from '@shared/types/x-reply-types';

/**
 * 回复决策 prompt。
 *
 * ⚠️ 与 x-ai-judge 的 SYSTEM_PROMPT 刻意保持**同源规则、不同产物**:
 *   判断层产出 worth(值不值得看),这里产出 reply(要不要回)。
 *   「模板化刷屏/跟风梗回复」那条必须在两边都有 —— 2026-09-04 评测
 *   漏抄它导致假阳 2 个,补上后精确率 94.4% → 97.3%。
 *
 * **不要求模型输出正文,也不要求它选模板** —— 见 x-reply-types.ts 顶部说明。
 */
const REPLY_SYSTEM_PROMPT = `你是 OTun VPN 的回复筛选助手。OTun 是面向中国大陆用户的 VPN 工具。

给你一批推文，你只判断**要不要回复**。你不生成任何回复正文。

reply=true（值得回复）：
- 用户明确求推荐 VPN/翻墙工具/梯子/机场
- 用户第一人称抱怨在用的工具不好用、连不上、慢、到期想换
- 用户问在中国大陆怎么访问被封锁的服务

reply=false（不回复）：
- 模板化刷屏/跟风梗回复：同一句式反复出现的水军式回复，尤其是
  "第一次见这么低的纯度/纯净度，求推荐同款VPN" 这类带链接的梗回复
  —— 它形似求助，实为刷屏，回复它只会撞进水军堆里
- 同行广告/引流（带 qq 群、tg 群、推广话术、自荐机场、贴自己的价格表）
- 纯政治/新闻/情绪发泄，无产品切入点
- 教程分享、技术科普（对方在给别人答疑，不是自己求助）
- 对着某家厂商维权、催客服、要求退款
- 询问某个特定产品好不好用的评价咨询（没有要找/要换工具的意思）
- 与翻墙/VPN 无关

输出必须是 JSON 数组，每条：
{"tweetId":"...","reply":true,"confidence":0.9,"reason":"明确求推荐"}
confidence 是 0~1 的小数。不要输出 JSON 之外的任何文字。`;

/**
 * 从模型返回里取出决策数组。
 *
 * ⚠️ 与 x-ai-judge.extractItems 同款防护 —— 「取第一个 key」在结构变化时
 * 会静默返回空数组,整批被当成「模型没返回」。判断层丢一批只是漏几条待处理;
 * **回复层丢一批 = 该回的没回,而面板显示一切正常**,后果更重。
 * 故一个数组都找不到就 throw,绝不当空批。
 */
function extractDecisions(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const values = Object.values(parsed as Record<string, unknown>);
    const looksRight = values.find(
      (v): v is unknown[] => Array.isArray(v)
        && v.some((it) => it && typeof it === 'object' && 'tweetId' in (it as object)),
    );
    if (looksRight) return looksRight;
    const anyArray = values.find((v): v is unknown[] => Array.isArray(v));
    if (anyArray) return anyArray;
  }
  throw new Error(
    `[x-reply-planner] response JSON contains no decision array (keys=${
      parsed && typeof parsed === 'object' ? Object.keys(parsed as object).join(',') : typeof parsed
    })`,
  );
}

function parseDecisions(content: string): Map<string, ReplyDecision> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`[x-reply-planner] failed to parse response as JSON: ${content.slice(0, 200)}`);
  }
  // 结构错不能并进上面的 catch,否则会被误报成「不是 JSON」,掩盖真因
  const items = extractDecisions(parsed);

  const map = new Map<string, ReplyDecision>();
  for (const item of items) {
    const d = item as Partial<ReplyDecision>;
    if (!d.tweetId) continue;
    map.set(d.tweetId, {
      tweetId: d.tweetId,
      reply: Boolean(d.reply),
      confidence: typeof d.confidence === 'number' ? d.confidence : 0,
      reason: typeof d.reason === 'string' ? d.reason : '',
    });
  }
  return map;
}

/**
 * 文本指纹 —— 用于识别「同一句话反复出现」的模板刷屏。
 *
 * 去掉 @提及、链接、数字与所有非中英文字符后比对。
 * 依据(2026-09-04 实测):评测里唯一残留的假阳
 * 「我有小火箭加速器,求推荐一个好用的VPN」在 tweet_feedback 里
 * **一字不差出现 3 次**,还有「求推荐一个好用的梯子」的变体 ——
 * 单条看是真求助,跨条看才是刷屏。模型一次只看一条,判不出来,
 * 所以这层必须在代码里做。
 */
export function textFingerprint(text: string): string {
  return (text || '')
    .replace(/@\w+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^一-鿿A-Za-z]/g, '')
    .toLowerCase()
    .slice(0, 60);
}

/** 同指纹出现多少次即视为模板刷屏(含本条)。2 就够:真人不会一字不差发两遍 */
export const DUPLICATE_FINGERPRINT_THRESHOLD = 2;

export interface PlanContext {
  /** 近期已回复过的作者(归一化 handle)→ 最近一次回复时间 ISO */
  recentlyRepliedAuthors?: Map<string, string>;
  /** 已回复过的 tweet_id */
  alreadyRepliedTweetIds?: Set<string>;
  /** 语料库里出现过的文本指纹计数(用于识别刷屏);不传则只在本批内部比对 */
  fingerprintCounts?: Map<string, number>;
  /** 最近用过的模板(最新在前)—— 用于轮换,避免连发同一句 */
  recentTemplateIds?: ReplyTemplateId[];
  now?: Date;
  /**
   * 追踪标识(链接里的 ref)。不传则按 `tw_<本ws账号>_<日期>[_<配方>]` 现生成。
   * **按批次不按条** —— 每条唯一会让正文条条不同,那正是水军特征。
   */
  ref?: string;
  /** 生成 ref 用:本 ws 登录的账号 */
  selfHandle?: string;
  /** 生成 ref 用:来源配方,便于回答「哪个配方带来的注册」 */
  recipeId?: string;
}

/**
 * 选模板 —— **不问模型**,按「避开最近用过的」轮换。
 *
 * 为什么不问模型:离线评测一致率仅 37%,错法单一(全部倒向最长模板)。
 * 深查发现真因在数据 —— 形态几乎一样的父推,人工当时也用了不同模板,
 * 说明当时的选择不是内容驱动的,学它等于学噪声。
 *
 * 为什么要轮换而不是固定一个:X 判垃圾看重复度。连发同一句最容易被判水军。
 */
export function pickTemplate(recentTemplateIds: ReplyTemplateId[] = []): ReplyTemplateId {
  const recent = recentTemplateIds.slice(0, REPLY_TEMPLATES.length - 1);
  const unused = REPLY_TEMPLATES.find((t) => !recent.includes(t.id));
  // 全用过 → 取最久没用的(recent 末尾之后的那个)
  return (unused ?? REPLY_TEMPLATES[REPLY_TEMPLATES.length - 1]).id;
}

function tweetUrlOf(t: TweetInboxRecord): string {
  return t.tweet_url
    || `https://x.com/${normalizeHandle(t.author_handle ?? 'i') || 'i'}/status/${t.tweet_id}`;
}

/**
 * 给一批推文规划回复草稿。
 *
 * @returns drafts = 待发草稿(用户逐条确认后填进 X 回复框);
 *          skips  = 被挡掉的,**带原因** —— 不静默丢,否则「为什么没回这条」无从查起
 */
export async function planReplies(
  batch: TweetInboxRecord[],
  config: JudgeConfig,
  ctx: PlanContext = {},
): Promise<ReplyPlanResult> {
  const drafts: ReplyDraft[] = [];
  const skips: ReplySkip[] = [];
  if (batch.length === 0) return { drafts, skips };

  const now = ctx.now ?? new Date();
  const blocked = new Set((await getBlockedHandleSet()).map(normalizeHandle));

  // ── ① 前置规则过滤(不问模型)────────────────────────────────
  // 本批内部的指纹计数,与历史计数合并 —— 同一批里重复出现的也要能识别
  const fpCounts = new Map(ctx.fingerprintCounts ?? []);
  for (const t of batch) {
    const fp = textFingerprint(t.text);
    if (fp) fpCounts.set(fp, (fpCounts.get(fp) ?? 0) + 1);
  }

  const candidates: TweetInboxRecord[] = [];
  for (const t of batch) {
    const handle = normalizeHandle(t.author_handle ?? '');
    const push = (skipReason: ReplySkip['skipReason'], detail?: string) =>
      skips.push({ tweetId: t.tweet_id, authorHandle: handle, skipReason, detail });

    if (ctx.alreadyRepliedTweetIds?.has(t.tweet_id)) { push('already_replied'); continue; }
    if (handle && blocked.has(handle)) { push('blocked_author'); continue; }

    const fp = textFingerprint(t.text);
    const dupes = fp ? (fpCounts.get(fp) ?? 0) : 0;
    if (dupes >= DUPLICATE_FINGERPRINT_THRESHOLD) {
      push('duplicate_text', `相同文本出现 ${dupes} 次(模板刷屏)`);
      continue;
    }

    const last = handle ? ctx.recentlyRepliedAuthors?.get(handle) : undefined;
    if (last) {
      const hours = (now.getTime() - new Date(last).getTime()) / 3_600_000;
      if (hours < SAME_AUTHOR_COOLDOWN_HOURS) {
        push('author_recent', `${hours.toFixed(0)}h 前刚回过(冷却 ${SAME_AUTHOR_COOLDOWN_HOURS}h)`);
        continue;
      }
    }
    candidates.push(t);
  }

  if (candidates.length === 0) return { drafts, skips };

  // ── ② 模型判「要不要回」──────────────────────────────────
  const response = await callOllama({
    model: config.model,
    messages: [
      { role: 'system', content: REPLY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify(candidates.map((t) => ({ tweetId: t.tweet_id, text: t.text }))),
      },
    ],
    endpoint: config.ollamaEndpoint,
    timeoutMs: config.timeoutMs,
    temperature: 0.2,
    responseFormat: 'json_object',
  });
  // 解析失败会 throw —— 调用方必须感知,绝不静默产出空草稿列表
  const decisions = parseDecisions(response.content);

  // ── ③ 组装草稿(正文来自模板库)────────────────────────────
  // ref 整批算一次 —— 按批次不按条,同一批里各条正文完全相同。
  const ref = ctx.ref?.trim()
    || buildRef(ctx.selfHandle ?? 'netlab2gfw', now, ctx.recipeId);
  const recentTemplates = [...(ctx.recentTemplateIds ?? [])];
  for (const t of candidates) {
    const handle = normalizeHandle(t.author_handle ?? '');
    const d = decisions.get(t.tweet_id);
    if (!d) {
      // 模型没覆盖这条 —— 留痕,不当成「不该回」
      skips.push({
        tweetId: t.tweet_id, authorHandle: handle,
        skipReason: 'ai_declined', detail: '模型未返回该条判断(可重跑)',
      });
      continue;
    }
    if (!d.reply) {
      skips.push({ tweetId: t.tweet_id, authorHandle: handle, skipReason: 'ai_declined', detail: d.reason });
      continue;
    }
    if (d.confidence < REPLY_CONFIDENCE_FLOOR) {
      skips.push({
        tweetId: t.tweet_id, authorHandle: handle, skipReason: 'low_confidence',
        detail: `confidence ${d.confidence.toFixed(2)} < ${REPLY_CONFIDENCE_FLOOR}`,
      });
      continue;
    }

    const templateId = pickTemplate(recentTemplates);
    recentTemplates.unshift(templateId);
    const template = REPLY_TEMPLATES.find((x) => x.id === templateId)!;

    drafts.push({
      tweetId: t.tweet_id,
      tweetUrl: tweetUrlOf(t),
      authorHandle: handle,
      // ⚠️ 只做 {ref} 一处替换,别的一字不改 ——
      //    任何按推文内容改写正文的口子,都是「模型生成正文」的后门。
      //    ref 按批次生成,故同一批里各条正文仍然完全相同。
      text: renderTemplate(template, ref),
      templateId,
      ref,
      confidence: d.confidence,
      reason: d.reason,
      createdAt: now.toISOString(),
    });
  }

  console.log(
    `[x-reply-planner] ${batch.length} 条 → 草稿 ${drafts.length} / 跳过 ${skips.length}`,
  );
  return { drafts, skips };
}
