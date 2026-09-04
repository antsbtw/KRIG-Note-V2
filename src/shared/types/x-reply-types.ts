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
 * 模板库 —— 取自 netlab2gfw 真实用过的文本(2026-09-04 从库里导出,原文照抄)。
 *
 * ⚠️ 这里的短链是**语料里的原样**。上线前必须由用户确认/替换成当前有效的
 * 推广链接 —— 代码不猜、不生成、也不校验链接是否还活着(那是业务决定)。
 * 见 needsLinkReview()。
 */
export const REPLY_TEMPLATES: readonly ReplyTemplate[] = [
  {
    id: 'otun_full',
    label: '完整推荐',
    observedCount: 103,
    text: '推荐OTun-M，按照下面的链接注册即可获得7天10G的测试流量了，支持iOS/Android/macOS/Windows/Google TV，一个账号，多个客户端共享。\nhttps://t.co/n283CfvXsB',
  },
  {
    id: 'otun_short',
    label: '简短推荐',
    observedCount: 73,
    text: '试试OTun-M呗，按照下面的链接注册即可获得7天10G的测试流量了，支持iOS/Android/macOS/Windows/Google TV，一个账号，多个客户端共享。\nhttps://t.co/n283CfvXsB',
  },
  {
    id: 'nudge',
    label: '极简一句',
    observedCount: 17,
    text: '试试这个？\nhttps://t.co/Eu5F4jYEpz',
  },
  {
    id: 'nudge_nopay',
    label: '极简(注明支付方式)',
    observedCount: 15,
    text: '试试这个吧，但没有微信/支付宝支付方式哦。\nhttps://t.co/Eu5F4jYEpz',
  },
] as const;

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
 * 判断模板是否仍带着语料里的原始短链 —— 上线前需人工确认。
 * 不自动改写:链接是业务资产,代码猜错的代价是把流量导去死链。
 */
export function needsLinkReview(t: ReplyTemplate): boolean {
  return /https:\/\/t\.co\//.test(t.text);
}
