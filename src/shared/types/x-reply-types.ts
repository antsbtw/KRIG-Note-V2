/**
 * X 自动回复 —— 模板库与草稿类型(阶段 3)
 *
 * ⭐ 核心设计决定:**正文永远来自模板库,模型不生成一个字。**
 *
 * 依据是 2026-09-04 对 1095 条真实回复语料的离线分析:
 *  - 去掉 @提及 与短链后只剩 553 种文本,**前 3 个模板占 54%**
 *  - 能配对上下文的仅 381/1095(35%)
 *  - 更关键:342 条形态高度同质的「求推荐」父推,人工当时用的模板却是分散的
 *    (FULL 49.7% / OTHER 19% / SHORT_NUDGE 17.8% / SHORT 13.5%),
 *    **开头几乎一字不差的父推也用了不同模板** —— 说明模板选择本来就
 *    不是内容驱动的(更像随手换、避免重复)。
 *
 * 结论:这里面没有可学的信号。让模型选模板的离线一致率只有 37%,
 * 且错法单一(全部倒向最长模板)—— 那是在学噪声。
 * 所以模型只回答「要不要回」(离线实测 准确 93.8% / 精确 97.3%),
 * 「用哪个模板」由**去重轮换**决定,不问模型。
 *
 * 让模型写正文的风险也是实的:它不知道「7天10G」这类条款是否仍然有效,
 * 而 X 判垃圾看的是**重复度**不是文采 —— 模型改写只会制造一堆
 * 相似度 90% 的变体,比稳定用模板更像水军。
 */

/** 模板 id —— 与库里的 key 对应,写进 x_reply_draft 便于事后对账 */
export type ReplyTemplateId =
  | 'otun_full'      // 完整推荐(产品名 + 试用额度 + 全平台 + 链接)
  | 'otun_short'     // 简短推荐
  | 'nudge'          // 极简一句 + 链接
  | 'nudge_nopay';   // 极简 + 支付方式提醒

export interface ReplyTemplate {
  id: ReplyTemplateId;
  /** 正文。⚠️ 不含 @提及 —— X 回复框会自动带上被回复者,手动再加会变成 @@xxx */
  text: string;
  /** 人可读的短名,UI 上给用户选/看 */
  label: string;
  /** 语料里实际用过多少次 —— 仅作参考,不参与选择逻辑 */
  observedCount: number;
}

/**
 * 落地页 —— 用户 2026-09-04 给定的形态:
 *   https://situstechnologies.com/x?ref=tw_<标识>&lang=zh&v=6
 *
 * ⚠️ 语料里存的是 `https://t.co/xxxx` —— 那是 **X 自己的短链包装**,
 * 不是我们的链接。实测解开后:
 *   t.co/n283CfvXsB → situstechnologies.com/x?ref=tw_NetLab2GFW&lang=zh&v=6
 *                   → 307 /trial?ref=...&s=x  (200)
 * 所以模板里必须存**原始 URL**,不能存 t.co —— t.co 短码由 X 在发布时生成,
 * 我们既不能预知也不该硬编码(那等于把统计参数丢了)。
 *
 * 实测确认 ref 是透传的:换成没见过的 `tw_krigtest0904` 同样 307 → 200,
 * 参数原样带到 /trial。故任意标识都能用,不会被拒或回落。
 */
export const LANDING_BASE = 'https://situstechnologies.com/x';

/** 正文里的占位符 —— 由 renderTemplate() 在产草稿时替换成当次 ref */
export const REF_PLACEHOLDER = '{ref}';

/**
 * 模板库 —— 文案取自 netlab2gfw 真实语料(2026-09-04 导出,原文照抄),
 * 链接换成带 {ref} 占位的原始 URL。
 *
 * ⚠️ 正文里**只有 {ref} 一个占位**,不允许再加别的插值 ——
 * 每多一个变量,正文的变体就翻一倍,而 X 判垃圾看的正是重复度与差异度。
 */
export const REPLY_TEMPLATES: readonly ReplyTemplate[] = [
  {
    id: 'otun_full',
    label: '完整推荐',
    observedCount: 103,
    text: `推荐OTun-M，按照下面的链接注册即可获得7天10G的测试流量了，支持iOS/Android/macOS/Windows/Google TV，一个账号，多个客户端共享。\n${LANDING_BASE}?ref=${REF_PLACEHOLDER}&lang=zh&v=6`,
  },
  {
    id: 'otun_short',
    label: '简短推荐',
    observedCount: 73,
    text: `试试OTun-M呗，按照下面的链接注册即可获得7天10G的测试流量了，支持iOS/Android/macOS/Windows/Google TV，一个账号，多个客户端共享。\n${LANDING_BASE}?ref=${REF_PLACEHOLDER}&lang=zh&v=6`,
  },
  {
    id: 'nudge',
    label: '极简一句',
    observedCount: 17,
    text: `试试这个？\n${LANDING_BASE}?ref=${REF_PLACEHOLDER}&lang=zh&v=6`,
  },
  {
    id: 'nudge_nopay',
    label: '极简(注明支付方式)',
    observedCount: 15,
    text: `试试这个吧，但没有微信/支付宝支付方式哦。\n${LANDING_BASE}?ref=${REF_PLACEHOLDER}&lang=zh&v=6`,
  },
] as const;

/**
 * 追踪标识 —— **按批次,不按条**。
 *
 * 为什么不每条一个唯一码:X 会把链接重写成 t.co 短码,
 * 每条唯一 = 每条正文都不一样 —— 那正是水军最直接的特征之一。
 * 而按批次已经能回答「哪天/哪个配方带来的注册」,统计价值几乎不损失。
 *
 * 形态:`tw_<账号>_<YYYYMMDD>[_<配方>]`,如 `tw_netlab2gfw_20260904_vpnhelp`。
 * 只保留 URL 安全字符;配方名里的非法字符会被剔除而不是静默截断。
 */
export function buildRef(handle: string, at: Date, recipeId?: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  const d = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`;
  const parts = ['tw', safe(handle) || 'unknown', d];
  const r = recipeId ? safe(recipeId) : '';
  if (r) parts.push(r);
  return parts.join('_');
}

/**
 * 把模板正文里的 {ref} 换成实际标识。
 *
 * ⚠️ fail loud:模板里有占位却没给 ref → throw。
 * 静默留着 `{ref}` 字面量发出去,是把一条明显坏掉的链接推给用户点击。
 */
export function renderTemplate(t: ReplyTemplate, ref: string): string {
  if (!t.text.includes(REF_PLACEHOLDER)) return t.text;
  if (!ref || !ref.trim()) {
    throw new Error(`[x-reply] template ${t.id} needs a ref but none was provided`);
  }
  return t.text.split(REF_PLACEHOLDER).join(ref.trim());
}

export function getTemplate(id: ReplyTemplateId): ReplyTemplate {
  const t = REPLY_TEMPLATES.find((x) => x.id === id);
  // fail loud:id 打错会静默回退成第一个模板,发出去才发现 —— 不如直接炸
  if (!t) throw new Error(`[x-reply] unknown template id: ${id}`);
  return t;
}

/** 模型只回答这个 —— 不含正文,不含模板选择 */
export interface ReplyDecision {
  tweetId: string;
  /** 是否值得回复 */
  reply: boolean;
  confidence: number;
  reason: string;
}

/** 不予回复的原因 —— 用于 UI 显示与对账,区分「模型说不」和「被前置规则挡掉」 */
export type ReplySkipReason =
  | 'ai_declined'        // 模型判定不值得回
  | 'low_confidence'     // 置信度不足阈值
  | 'duplicate_text'     // 近期出现过高度相同的推文(模板刷屏)
  | 'author_recent'      // 同一作者近期已回过
  | 'already_replied'    // 这条推已经回过
  | 'blocked_author';    // 屏蔽名单

export interface ReplyDraft {
  tweetId: string;
  tweetUrl: string;
  authorHandle: string;
  /** 待发正文(来自模板库,逐字原文) */
  text: string;
  templateId: ReplyTemplateId;
  /** 本条链接里用的追踪标识 —— 落库便于事后对账「哪批带来的注册」 */
  ref: string;
  confidence: number;
  reason: string;
  createdAt: string;
}

export interface ReplySkip {
  tweetId: string;
  authorHandle: string;
  skipReason: ReplySkipReason;
  detail?: string;
}

export interface ReplyPlanResult {
  drafts: ReplyDraft[];
  skips: ReplySkip[];
}

/** 置信度阈值 —— 低于此值不生成草稿(宁可漏,不可扰) */
export const REPLY_CONFIDENCE_FLOOR = 0.6;

/**
 * 同一作者的冷却期。同一个人短期内被我们回复多次 = 骚扰,也最容易被举报。
 * 语料里就有对同一 handle 连发两条的情况(ba_baby1744861),是要避免的形态。
 */
export const SAME_AUTHOR_COOLDOWN_HOURS = 72;

/**
 * 模板是否还带着 X 的 t.co 短链 —— **那是坏的**,必须换成原始 URL。
 *
 * t.co 是 X 发布时自己生成的包装,硬编码它等于:
 *  ① 把 ref 统计参数丢了(短码背后是别人某次发布时的固定参数)
 *  ② 指向一条我们无法控制、也无法更新的跳转
 */
export function hasStaleShortLink(t: ReplyTemplate): boolean {
  return /https:\/\/t\.co\//.test(t.text);
}

/** 模板正文是否带 {ref} 占位(带则必须经 renderTemplate 才能发) */
export function needsRef(t: ReplyTemplate): boolean {
  return t.text.includes(REF_PLACEHOLDER);
}
