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
import { buildGenerationPrompt, buildSingleReplyPrompt, verifyGeneratedReply } from '@shared/types/x-reply-facts';
import type { PosterFacts } from '@shared/types/x-reply-facts';
import {
  REPLY_TEMPLATES, REPLY_CONFIDENCE_FLOOR, SAME_AUTHOR_COOLDOWN_HOURS,
  buildRef, renderTemplate, langOf, templatesFor, isInThread, LANDING_BASE, LINK_PARAMS,
  type ReplyDecision, type ReplyDraft, type ReplyPlanResult,
  type ReplySkip, type ReplyTemplateId, type ReplyLang, type ReplySource,
  type ReplyTrace, type PosterKind,
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
    // 实测(2026-09-05,英文生成):批里只有 1-2 条时,模型会直接返回**裸对象**
    //   {"tweetId":"d","reply":"..."}  而不是数组。
    // 此前当成「没有数组」throw → 整批回落模板,而中文批因为条数多没踩到,
    // 现象就是「英文永远是模板腔」—— 极易被当成模型不会写英文。
    if ('tweetId' in (parsed as object)) return [parsed];
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
  /**
   * 发推者的**已查证**账号资料(采自 UserByScreenName)。
   * 传了 posterKind 就有事实依据;不传则模型只能看正文并倾向 unclear。
   */
  posterFacts?: PosterFacts;
  /** 上一层内容(链条第①)。取不到时配合 isReplyThread 让模型知道「没看到」而非「没有」 */
  parentTweet?: { text: string; authorHandle?: string };
  /**
   * 用户此前认可/修改过的例子 —— 放进生成 prompt 当少样本。
   * ⚠️ 这不是训练模型,是 in-context learning:立刻见效、随时可撤。
   * 学习期积累的修改就从这里回流。
   */
  approvedExamples?: Array<{ tweet: string; reply: string }>;
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
export function pickTemplate(
  recentTemplateIds: ReplyTemplateId[] = [],
  lang: ReplyLang = 'zh',
): ReplyTemplateId {
  // ⚠️ 只在**该语言**的模板里轮换 —— 给英文推回中文文案对方看不懂,
  //    等于白发一条还留了垃圾记录。
  const pool = templatesFor(lang);
  if (pool.length === 0) throw new Error(`[x-reply] no template for lang=${lang}`);
  const recent = recentTemplateIds.slice(0, pool.length - 1);
  const unused = pool.find((t) => !recent.includes(t.id));
  // 全用过 → 取最久没用的
  return (unused ?? pool[pool.length - 1]).id;
}

/**
 * 让 Gemma 为一批推文**现写**回复正文。
 *
 * ⭐ 这是引入模型的**唯一理由** —— 直接回应对方说的具体问题,模板做不到。
 * 实测:「Google TV 上老连不上」→ 精准挑平台事实先答;
 *       「想找能微信支付的」→ 主动先说不支持微信支付再给试用。
 *
 * 每条产出都过 verifyGeneratedReply:链接被改/缺失、自带 @、超长、
 * 冒出最高级承诺 —— 一律判不通过,由调用方回落模板(不硬发)。
 *
 * @returns tweetId → 通过校验的正文;没通过或没返回的**不在 map 里**
 */
async function generateReplies(
  items: Array<{ tweetId: string; text: string; lang: ReplyLang }>,
  link: (lang: ReplyLang) => string,
  config: JudgeConfig,
  examples: Array<{ tweet: string; reply: string }>,
): Promise<{ texts: Map<string, string>; rejects: Map<string, string> }> {
  const texts = new Map<string, string>();
  const rejects = new Map<string, string>();
  // 按语言分组:事实清单与语气要求都是分语言的,混在一次请求里会串味
  for (const lang of ['zh', 'en'] as const) {
    const group = items.filter((it) => it.lang === lang);
    if (group.length === 0) continue;
    const theLink = link(lang);
    let content: string;
    try {
      const res = await callOllama({
        model: config.model,
        messages: [
          { role: 'system', content: buildGenerationPrompt(lang, theLink, examples) },
          { role: 'user', content: JSON.stringify(group.map((g) => ({ tweetId: g.tweetId, text: g.text }))) },
        ],
        endpoint: config.ollamaEndpoint,
        timeoutMs: config.timeoutMs,
        // 生成要一点多样性(全批同一句话就又变回模板了),但不能放飞
        temperature: 0.7,
        responseFormat: 'json_object',
      });
      content = res.content;
    } catch (err) {
      // 生成失败不致命 —— 调用方会回落模板。但必须留痕,不静默。
      console.error(`[x-reply-planner] 生成失败(lang=${lang}),将回落模板:`, (err as Error).message);
      for (const g of group) rejects.set(g.tweetId, `生成失败:${(err as Error).message}`);
      continue;
    }

    let items2: unknown[];
    try {
      items2 = extractDecisions(JSON.parse(content));
    } catch (err) {
      console.error(`[x-reply-planner] 生成结果解析失败(lang=${lang}),将回落模板:`, (err as Error).message);
      for (const g of group) rejects.set(g.tweetId, '生成结果解析失败');
      continue;
    }

    for (const raw of items2) {
      const r = raw as { tweetId?: string; reply?: string };
      if (!r.tweetId || typeof r.reply !== 'string') continue;
      const bad = verifyGeneratedReply(r.reply, theLink);
      if (bad) {
        // ⚠️ 校验不通过**绝不硬发** —— link_altered 尤其隐蔽:
        //    发出去看不出异常,但那次点击永远归不了因。
        rejects.set(r.tweetId, `校验未通过:${bad}`);
        continue;
      }
      texts.set(r.tweetId, r.reply.trim());
    }
  }
  return { texts, rejects };
}

/**
 * 取本 ws 登录的账号 —— **拿不到就 throw,不再兜底成 'netlab2gfw'**。
 *
 * ⭐ 为什么改(2026-09-06 实测发现):
 * 那 20 条回复里有 7 条来自 ws-1,而 `x_ws_account` 只登记了 ws-2。
 * 取不到账号时旧代码默默用默认值 'netlab2gfw' —— **这次侥幸对了**
 * (ws-1 登的正好也是这个账号),但那是运气不是机制:
 * 若 ws-1 登的是 otun_myvpn,那 7 条就会被打上 netlab2gfw 的 ref,
 * **后台看到的归因是错的,而且从数据上完全看不出来**。
 *
 * ref 是统计资产,宁可拦住也不能默默归错账
 * (与「不要兜底 fallback」同源:静默兜底掩盖真 bug)。
 * 错误信息直接给出修法,别让用户对着 "wsId required" 猜。
 */
function requireSelfHandle(ctx: PlanContext): string {
  const h = ctx.selfHandle?.trim();
  if (h) return h;
  throw new Error(
    '无法确定本 workspace 登录的 X 账号,已停止 —— 否则这批回复的 ref 会归错账号,'
    + '而且事后从数据上看不出来。\n'
    + '修法:在这个 workspace 的 X 页面点一次「识别我的账号」(X Inbox → ⚙ 活动配置)。',
  );
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

  // ── ③ 先定「该回哪些」,再让模型为这些现写正文 ──────────────
  // ref 整批算一次 —— 按批次不按条,免得正文条条不同反成水军特征。
  const ref = ctx.ref?.trim()
    || buildRef(requireSelfHandle(ctx), now, ctx.recipeId);
  const linkFor = (lang: ReplyLang) =>
    `${LANDING_BASE}?ref=${ref}&${LINK_PARAMS[lang]}`;

  const accepted: Array<{ t: TweetInboxRecord; handle: string; d: ReplyDecision; lang: ReplyLang }> = [];
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
    // 语言由**推文**决定;非中文一律英文 —— 实测落地页只有中/英两版,
    // 用俄语/波斯语回复会把人导向读不懂的英文注册页,比直接用英文更差。
    accepted.push({ t, handle, d, lang: langOf(t.lang) });
  }

  if (accepted.length === 0) return { drafts, skips };

  // Gemma 现写正文(引入模型的唯一理由)。失败/校验不过 → 回落模板,不硬发。
  const { texts, rejects } = await generateReplies(
    accepted.map((a) => ({ tweetId: a.t.tweet_id, text: a.t.text, lang: a.lang })),
    linkFor, config, ctx.approvedExamples ?? [],
  );

  const recentTemplates = [...(ctx.recentTemplateIds ?? [])];
  for (const { t, handle, d, lang } of accepted) {
    const generated = texts.get(t.tweet_id);
    let text: string;
    let source: ReplySource;
    let templateId: ReplyTemplateId | undefined;
    let fallbackReason: string | undefined;

    if (generated) {
      text = generated;
      source = 'generated';
    } else {
      // 回落模板:模型挂了、解析失败、或校验没过。
      // ⚠️ 回落**必须留原因** —— 否则「为什么这条是模板腔」查不出来,
      //    也就永远发现不了「校验一直在拦」这种系统性问题。
      const tid = pickTemplate(recentTemplates, lang);
      recentTemplates.unshift(tid);
      const tpl = REPLY_TEMPLATES.find((x) => x.id === tid)!;
      text = renderTemplate(tpl, ref);
      source = 'template';
      templateId = tid;
      fallbackReason = rejects.get(t.tweet_id) ?? '模型未返回该条正文';
      console.warn(`[x-reply-planner] ${t.tweet_id} 回落模板:${fallbackReason}`);
    }

    drafts.push({
      tweetId: t.tweet_id,
      tweetUrl: tweetUrlOf(t),
      authorHandle: handle,
      text,
      source,
      templateId,
      fallbackReason,
      lang,
      inThread: isInThread(t),
      /** 生成的正文人必须看过 —— 模板文案则已有语料依据 */
      needsHumanReview: source === 'generated'
        || (templateId ? REPLY_TEMPLATES.find((x) => x.id === templateId)?.needsHumanReview === true : false),
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

/**
 * 为**单条**推文一次问完「该不该回 + 回什么」(卡片弹窗路径)。
 *
 * ⭐ 与 planReplies 的区别是**调用次数**:那边批量场景判断与生成分两趟
 * (批量判断能一次筛掉大半,分开更省);单条场景分两趟纯属浪费 ——
 * 用户 2026-09-06 反馈「生成很慢」,实测就是这两趟串行导致的 ~27s(热)。
 * 合并后:不该回的 5-7s 就返回(不用写正文),该回的一趟出结果。
 *
 * 前置规则(刷屏/冷却/已回过/屏蔽)仍**先于模型**执行 —— 那些是跨条现象,
 * 模型看不出来,而且能在花任何推理时间之前就挡掉。
 */
export async function planOneReply(
  tweet: TweetInboxRecord,
  config: JudgeConfig,
  ctx: PlanContext = {},
): Promise<{ draft?: ReplyDraft; skip?: ReplySkip }> {
  const now = ctx.now ?? new Date();
  const handle = normalizeHandle(tweet.author_handle ?? '');
  const skip = (skipReason: ReplySkip['skipReason'], detail?: string) =>
    ({ skip: { tweetId: tweet.tweet_id, authorHandle: handle, skipReason, detail } });

  // ── 前置规则(不问模型,先挡)──────────────────────────────
  if (ctx.alreadyRepliedTweetIds?.has(tweet.tweet_id)) return skip('already_replied');
  const blocked = new Set((await getBlockedHandleSet()).map(normalizeHandle));
  if (handle && blocked.has(handle)) return skip('blocked_author');

  const fp = textFingerprint(tweet.text);
  const dupes = fp ? (ctx.fingerprintCounts?.get(fp) ?? 0) : 0;
  if (dupes >= DUPLICATE_FINGERPRINT_THRESHOLD) {
    return skip('duplicate_text', `相同文本出现 ${dupes} 次(模板刷屏)`);
  }
  const last = handle ? ctx.recentlyRepliedAuthors?.get(handle) : undefined;
  if (last) {
    const hours = (now.getTime() - new Date(last).getTime()) / 3_600_000;
    if (hours < SAME_AUTHOR_COOLDOWN_HOURS) {
      return skip('author_recent', `${hours.toFixed(0)}h 前刚回过(冷却 ${SAME_AUTHOR_COOLDOWN_HOURS}h)`);
    }
  }

  // ── 一次问完:该不该回 + 回什么 ──────────────────────────
  const lang = langOf(tweet.lang);
  const ref = ctx.ref?.trim() || buildRef(requireSelfHandle(ctx), now, ctx.recipeId);
  const link = `${LANDING_BASE}?ref=${ref}&${LINK_PARAMS[lang]}`;

  let parsed: {
    worth?: boolean; confidence?: number; reason?: string; reply?: string;
    posterKind?: string; posterRead?: string; trigger?: string;
    threadTopic?: string; threadRelevant?: boolean;
  };
  try {
    const res = await callOllama({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: buildSingleReplyPrompt(
            lang, link, ctx.approvedExamples ?? [], ctx.posterFacts,
            ctx.parentTweet, isInThread(tweet),
          ),
        },
        { role: 'user', content: tweet.text },
      ],
      endpoint: config.ollamaEndpoint,
      timeoutMs: config.timeoutMs,
      temperature: 0.6,
      responseFormat: 'json_object',
    });
    // ⚠️ 契约是**对象**不是数组(实测数组 grammar 慢 2-5× 且方差极大)
    parsed = JSON.parse(res.content) as typeof parsed;
  } catch (err) {
    // fail loud:调用方要看到失败,不返回一个空草稿装作「没什么可说的」
    throw new Error(`[x-reply-planner] 单条生成失败:${(err as Error).message}`);
  }

  // 推断链 —— 三步都留档,回错了才能定位是哪一步坏的(用户 2026-09-06)。
  // ⚠️ posterKind 是模型看正文的**推断**,不是查证过的事实:
  //    库里没有粉丝数/注册时间(x_author 36 行、fc 全空)。
  //    取值不在枚举内一律归 'unclear',绝不勉强塞进某一类。
  const KINDS: PosterKind[] = ['genuine', 'promoter', 'bot', 'unclear'];
  const trace: ReplyTrace = {
    // 有没有账号资料撑着 —— UI 据此区分「有据可依」与「纯读正文的印象」
    hasAccountFacts: !!ctx.posterFacts,
    posterKind: KINDS.includes(parsed?.posterKind as PosterKind)
      ? (parsed!.posterKind as PosterKind) : 'unclear',
    posterRead: typeof parsed?.posterRead === 'string' ? parsed.posterRead.trim() : '',
    trigger: typeof parsed?.trigger === 'string' ? parsed.trigger.trim() : '',
  };

  // ① 闸门:上文与翻墙无关 → 直接不回,**不管它 worth 说什么**。
  // 实测(2026-09-06):只在 prompt 里说「无关就判 false」模型会照回不误;
  // 拆成显式的 threadRelevant 字段 + 代码强制,才真的拦得住。
  if (parsed?.threadRelevant === false) {
    return skip('ai_declined',
      `上文与翻墙无关${parsed.threadTopic ? `(这楼在聊:${parsed.threadTopic})` : ''}`);
  }

  if (!parsed?.worth) {
    return {
      skip: {
        tweetId: tweet.tweet_id, authorHandle: handle, skipReason: 'ai_declined',
        // 不回的理由也带上推断链 —— 「为什么没回这条」同样需要能复查
        detail: [
          typeof parsed?.reason === 'string' ? parsed.reason : '',
          trace.posterKind !== 'unclear' ? `(判为${trace.posterKind})` : '',
        ].filter(Boolean).join(' ') || undefined,
      },
    };
  }
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  if (confidence < REPLY_CONFIDENCE_FLOOR) {
    return skip('low_confidence', `confidence ${confidence.toFixed(2)} < ${REPLY_CONFIDENCE_FLOOR}`);
  }

  const generated = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  const bad = generated ? verifyGeneratedReply(generated, link) : 'empty';

  let text: string;
  let source: ReplySource;
  let templateId: ReplyTemplateId | undefined;
  let fallbackReason: string | undefined;
  if (!bad) {
    text = generated;
    source = 'generated';
  } else {
    // 校验没过 → 回落模板,**绝不硬发**;留原因,否则发现不了「校验一直在拦」
    templateId = pickTemplate(ctx.recentTemplateIds ?? [], lang);
    const tpl = REPLY_TEMPLATES.find((x) => x.id === templateId)!;
    text = renderTemplate(tpl, ref);
    source = 'template';
    fallbackReason = `校验未通过:${bad}`;
    console.warn(`[x-reply-planner] ${tweet.tweet_id} 回落模板:${fallbackReason}`);
  }

  return {
    draft: {
      tweetId: tweet.tweet_id,
      tweetUrl: tweetUrlOf(tweet),
      authorHandle: handle,
      text, source, templateId, fallbackReason, lang,
      trace,
      inThread: isInThread(tweet),
      needsHumanReview: source === 'generated'
        || (templateId ? REPLY_TEMPLATES.find((x) => x.id === templateId)?.needsHumanReview === true : false),
      ref,
      confidence,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      createdAt: now.toISOString(),
    },
  };
}
