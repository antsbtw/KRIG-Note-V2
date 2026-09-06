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

/** 回复语言 —— 决定用哪套文案和哪组链接参数 */
export type ReplyLang = 'zh' | 'en';

/** 模板 id —— 与库里的 key 对应,写进 x_reply_draft 便于事后对账 */
export type ReplyTemplateId =
  | 'otun_full'      // 完整推荐(产品名 + 试用额度 + 全平台 + 链接)
  | 'otun_short'     // 简短推荐
  | 'nudge'          // 极简一句 + 链接
  | 'nudge_nopay'    // 极简 + 支付方式提醒
  | 'otun_full_en'   // ↓ 英文:无语料依据,待人工审核
  | 'otun_short_en'
  | 'nudge_en';

export interface ReplyTemplate {
  id: ReplyTemplateId;
  lang: ReplyLang;
  /** 正文。⚠️ 不含 @提及 —— X 回复框会自动带上被回复者,手动再加会变成 @@xxx */
  text: string;
  /** 人可读的短名,UI 上给用户选/看 */
  label: string;
  /** 语料里实际用过多少次 —— 仅作参考,不参与选择逻辑 */
  observedCount: number;
  /**
   * true = 这条文案**没有语料依据**(我按原意直译的新文案,未经实战检验)。
   * UI 必须显眼提示,由用户审过再发 —— 发出去的是产品承诺。
   */
  needsHumanReview?: boolean;
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
 * 链接的语言/版本参数 —— 用户 2026-09-04 给定:
 *   中文 `lang=zh&v=6`   英文 `lang=en&v=7`
 * 两者均已实测:307 → /trial?ref=...&s=x → 200,ref 原样透传。
 */
export const LINK_PARAMS: Record<ReplyLang, string> = {
  zh: 'lang=zh&v=6',
  en: 'lang=en&v=7',
};

/** 拼出带 ref 占位的完整落地页链接 */
function link(lang: ReplyLang): string {
  return `${LANDING_BASE}?ref=${REF_PLACEHOLDER}&${LINK_PARAMS[lang]}`;
}

/**
 * 模板库 —— 中文文案取自 netlab2gfw 真实语料(2026-09-04 导出,原文照抄)。
 *
 * ⚠️ **英文文案没有语料依据** —— 全库 1095 条自身回复里,
 * 像英文句子的(≥3 个英文单词)是 **0 条**;那 115 条「无中文」的
 * 全是数字与 emoji(「9+6」「👍」「125」)。
 * 故英文是按中文原意直译的**新写文案,未经实战检验**,
 * 用 `needsHumanReview` 标出 —— UI 必须显眼提示,由用户审过再发。
 * 不自作主张认为它可用:发出去的是产品承诺,不是我能替用户拍板的东西。
 *
 * ⚠️ 正文里**只有 {ref} 一个占位**,不允许再加别的插值 ——
 * 每多一个变量,正文的变体就翻一倍,而 X 判垃圾看的正是重复度与差异度。
 */
export const REPLY_TEMPLATES: readonly ReplyTemplate[] = [
  {
    id: 'otun_full',
    lang: 'zh',
    label: '完整推荐',
    observedCount: 103,
    text: `推荐OTun-M，按照下面的链接注册即可获得7天10G的测试流量了，支持iOS/Android/macOS/Windows/Google TV，一个账号，多个客户端共享。\n${link('zh')}`,
  },
  {
    id: 'otun_short',
    lang: 'zh',
    label: '简短推荐',
    observedCount: 73,
    text: `试试OTun-M呗，按照下面的链接注册即可获得7天10G的测试流量了，支持iOS/Android/macOS/Windows/Google TV，一个账号，多个客户端共享。\n${link('zh')}`,
  },
  {
    id: 'nudge',
    lang: 'zh',
    label: '极简一句',
    observedCount: 17,
    text: `试试这个？\n${link('zh')}`,
  },
  {
    id: 'nudge_nopay',
    lang: 'zh',
    label: '极简(注明支付方式)',
    observedCount: 15,
    text: `试试这个吧，但没有微信/支付宝支付方式哦。\n${link('zh')}`,
  },
  // ── 英文 ────────────────────────────────────────────────
  // 用户 2026-09-04 定的意思:「用户翻墙有困难,请他点击链接注册试用」——
  // 与中文同义,但更直接:点明处境(连不上/被墙)→ 给试用入口。
  // ⚠️ 仍无语料依据(全库 0 条英文句子回复),needsHumanReview 保留。
  {
    id: 'otun_full_en',
    lang: 'en',
    label: 'Full recommendation',
    observedCount: 0,
    needsHumanReview: true,
    text: `If you're having trouble getting a stable connection, try OTun-M. Sign up with the link below for a free 7-day 10GB trial — works on iOS/Android/macOS/Windows/Google TV, one account across all your devices.\n${link('en')}`,
  },
  {
    id: 'otun_short_en',
    lang: 'en',
    label: 'Short recommendation',
    observedCount: 0,
    needsHumanReview: true,
    text: `Having trouble connecting? Try OTun-M — sign up with the link below for a free 7-day 10GB trial.\n${link('en')}`,
  },
  {
    id: 'nudge_en',
    lang: 'en',
    label: 'Minimal nudge',
    observedCount: 0,
    needsHumanReview: true,
    text: `This might help — free trial if you want to test it:\n${link('en')}`,
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

/**
 * 正文从哪来。
 * `generated` = Gemma 针对这条推现写的(常态,引入模型的理由);
 * `template`  = 回落 —— 模型挂了/解析失败/校验没过。回落必带 fallbackReason。
 */
export type ReplySource = 'generated' | 'template';

export interface ReplyDraft {
  tweetId: string;
  tweetUrl: string;
  authorHandle: string;
  /** 待发正文 */
  text: string;
  source: ReplySource;
  /** 仅回落模板时有值 */
  templateId?: ReplyTemplateId;
  /** 仅回落时有值 —— 说明为什么没用生成的(便于发现「校验一直在拦」) */
  fallbackReason?: string;
  /** 本条用的语言(由推文 lang 决定,一批里可中英混杂) */
  lang: ReplyLang;
  /** true = 该文案无语料依据(新写的),UI 必须提示用户审核 */
  needsHumanReview: boolean;
  /**
   * 这条推是不是**回复串里的一条**(而非独立求助推)。
   *
   * ⚠️ 为什么要标出来:生成时只喂了 `tweet.text`,**没有任何上下文** ——
   * 没有父推、没有会话串。对独立求助推(「大家有没有好用的VPN推荐」)
   * 这没问题,那本来就没有上文;但对串里的一条,AI 是在**不知道上文的情况下
   * 猜着回**,很可能答非所问。
   *
   * 库里的关系字段目前几乎全空(2026-09-06 实测:search 采集的 3782 条里
   * 只有 48 条有 conversation_id),所以这里同时靠正文形态兜底判断。
   * 见 [[project-x-reply-no-context]]。
   */
  inThread: boolean;
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

/**
 * 按推文语言选用哪套模板。
 *
 * ⚠️ 非中文一律走英文模板 —— 给一条英文推回中文文案,
 * 对方多半看不懂,等于白发一条还留了垃圾记录。
 * 库里 lang 只有 zh/en 两种(实测),其余按 en 处理更安全:
 * 英文是国际通用回退,中文不是。
 */
export function langOf(tweetLang?: string): ReplyLang {
  return (tweetLang ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 该语言下可用的模板 */
export function templatesFor(lang: ReplyLang): ReplyTemplate[] {
  return REPLY_TEMPLATES.filter((t) => t.lang === lang);
}

/**
 * 判断一条推是不是「回复串里的一条」。
 *
 * ⚠️ 不能只看 `in_reply_to` 字段:实测搜索采集根本没写这两个关系字段
 * (x_tweet 6762 行里 search 来源只有 48 条有 conversation_id),
 * 只信字段等于**永远判 false**,提示形同虚设。
 * 故字段缺失时退回看正文形态 —— X 的串内回复正文天然以 @handle 开头。
 */
export function isInThread(t: { in_reply_to?: string; text?: string }): boolean {
  if (t.in_reply_to && t.in_reply_to.trim()) return true;
  return /^\s*@\w+/.test(t.text ?? '');
}
