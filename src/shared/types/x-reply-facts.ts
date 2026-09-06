/**
 * X 自动回复 —— 产品事实清单(Gemma 生成正文的唯一信源)
 *
 * ⭐ 2026-09-04 用户拍板转向:从「固定模板」改为「Gemma 现写 + 事实约束」。
 * 用户的论证成立:「如果只是固定模板,那需要 Gemma4 还有什么意义?写一个脚本就可以了。」
 *
 * 我此前三次反对,依据是「让模型选模板一致率仅 37%」—— 那是个**错误推理**:
 * 那个指标测的是「能否复现用户过去的模板选择」(而那些选择本就不是内容驱动的),
 * **完全没测「能不能写好一条回复」**。补测后结论相反:
 *  - 生成质量:「Google TV 上老连不上」→ 精准挑平台事实先答;
 *    「想找能微信支付的」→ **主动先说不支持微信支付**再给试用。模板做不到这个。
 *  - 编造风险:7 个诱导问题(价格/速度/节点数/退款/比Clash快/路由器/优惠码)→ **0 编造**。
 *
 * ⚠️ 所以安全不是「不让模型产出」,而是**约束输入(本清单)+ 程序校验 + 人工确认**。
 *
 * ## 只有中英两条线
 *
 * 实测(2026-09-04)落地页**只有英文和中文两版**:
 *   lang=en → 341 拉丁字符;lang=ru / lang=fa → **返回同一份英文页**(西里尔/波斯 0 字符);
 *   lang=zh → 真中文页。
 * 故用俄语/波斯语回复会把人导向读不懂的英文注册页,**比直接用英文更差**。
 * 用户定案:「回复没有大的原则错误,回复英语就好了,它看不懂英语,
 * 就没有必要交流下去」——**中文推回中文,其余一律英文**。
 *
 * 这同时消掉了一个实测到的真风险:同一份「严禁编造」约束下,
 * Gemma 写中文 0 编造,写**俄语会加「稳定运行」、波斯语会加「最佳选择」**
 * 等清单外承诺 —— 而用户读不懂那些字,「人工确认」形同虚设。不生成即无风险。
 */

import type { ReplyLang } from './x-reply-types';

/**
 * 产品事实 —— 模型只能用这里的内容。
 *
 * ⚠️ 这是**业务资产**,改它等于改所有回复的口径。
 * 刻意写成一份可读的清单而不是散落的常量:让用户一眼能核对全部对外承诺。
 */
export interface ProductFacts {
  productName: string;
  trial: string;
  platforms: string;
  accountSharing: string;
  paymentNote: string;
  /** 禁止提及的内容 —— 显式列出比「不要瞎说」有效得多(实测) */
  forbidden: string[];
}

export const PRODUCT_FACTS: ProductFacts = {
  productName: 'OTun-M',
  trial: '注册即得 7 天 10GB 测试流量',
  platforms: 'iOS / Android / macOS / Windows / Google TV',
  accountSharing: '一个账号可多客户端共享',
  paymentNote: '不支持微信 / 支付宝',
  forbidden: ['价格', '速度数字', '节点数量', '优惠活动', '退款政策', '与其他产品的性能对比'],
};

/** 事实清单渲染成 prompt 片段(中/英两版,与回复语言一致) */
function factsBlock(lang: ReplyLang, link: string): string {
  const f = PRODUCT_FACTS;
  if (lang === 'zh') {
    return `【可用事实 —— 只能用这里的内容，不得添加任何其他承诺】
- 产品名：${f.productName}
- 试用：${f.trial}
- 平台：${f.platforms}
- ${f.accountSharing}
- 支付方式：${f.paymentNote}
- 注册链接：${link}
【严禁】编造${f.forbidden.join('、')}，或任何上面没写的内容。
【严禁】做稳定性/速度承诺（如"稳定运行""最快"），也不要用"最佳""第一"这类最高级。`;
  }
  return `FACTS — use ONLY what is listed here, never add any other promise:
- Product: ${f.productName}
- Trial: free 7-day 10GB trial on signup
- Platforms: ${f.platforms}
- One account works across multiple devices
- Payment: no WeChat / Alipay
- Signup link: ${link}
NEVER invent prices, speed numbers, server counts, promotions, refund terms,
or performance comparisons with other products.
NEVER promise stability or speed ("rock solid", "fastest"), and never use
superlatives like "best" or "#1".`;
}

/**
 * 生成回复正文的 system prompt。
 *
 * 刻意要求「直接回应对方说的具体问题」——这正是模板做不到、
 * 也是引入模型的**唯一理由**。如果输出恒等于模板,就该用模板。
 *
 * @param examples 用户此前认可/修改过的例子(in-context learning)。
 *   ⚠️ 这不是训练模型,是把近期偏好放进上下文 —— 立刻见效、随时可撤。
 */
export function buildGenerationPrompt(
  lang: ReplyLang,
  link: string,
  examples: Array<{ tweet: string; reply: string }> = [],
): string {
  const facts = factsBlock(lang, link);
  const shots = examples.length > 0
    ? (lang === 'zh'
        ? `\n\n【你以往认可的回复风格 —— 照这个口气写】\n${
            examples.map((e) => `用户：${e.tweet}\n回复：${e.reply}`).join('\n---\n')}`
        : `\n\nEXAMPLES of previously approved replies — match this tone:\n${
            examples.map((e) => `User: ${e.tweet}\nReply: ${e.reply}`).join('\n---\n')}`)
    : '';

  if (lang === 'zh') {
    return `你是 ${PRODUCT_FACTS.productName} 的社区回复助手，代表官方账号在 X 上回复求助的用户。

${facts}

写回复的要求：
- 直接回应对方说的具体问题（他抱怨慢就说慢，问平台就答平台），不要套话开场
- 口语、简短，1-2 句，像真人随手回的，不是客服模板
- 必须包含注册链接，**原样照抄，一个字符都不能改**
- 不要加 @提及（X 会自动带）
- 不要用营销腔（"立即""超值""强烈推荐"），不要堆 emoji
- 对方问了清单里没有的（价格、速度、节点数），就如实说去官网/App 看，别编${shots}

输出 JSON 数组，每条：{"tweetId":"...","reply":"回复正文"}
不要输出 JSON 之外的任何文字。`;
  }

  return `You reply for ${PRODUCT_FACTS.productName} on X, on behalf of the official account,
to users asking for help getting past network blocks.

${facts}

How to write the reply:
- Address the specific thing they said (slow → speak to slow; asked about a platform → answer it).
  No generic openers.
- Casual and short, 1-2 sentences, like a real person replying — not a support macro.
- MUST include the signup link, **copied verbatim, not one character changed**.
- No @mentions (X adds those automatically).
- No marketing voice ("act now", "amazing deal"), no emoji pile-up.
- If they ask something not in the facts (price, speed, server count), say to check
  the site/app — do not make it up.
- Write in English.${shots}

Output a JSON array, each item: {"tweetId":"...","reply":"the reply text"}
Output nothing except the JSON array.`;
}

/** 生成结果的校验失败原因 —— 每条都对应一个实测过的真实风险 */
export type ReplyRejectReason =
  | 'empty'            // 空正文
  | 'link_missing'     // 没带链接 —— 白发一条
  | 'link_altered'     // 链接被改写 —— 统计资产被破坏,最隐蔽
  | 'has_mention'      // 自带 @ —— X 会再带一次,变 @@xxx
  | 'too_long'         // 超出 X 单条上限
  | 'superlative';     // 最高级/稳定性承诺 —— 外语实测踩过

/** X 单条推文上限(链接按 t.co 计 23 字符,留足余量) */
export const MAX_REPLY_CHARS = 260;

/**
 * 校验模型写出来的正文。
 *
 * ⚠️ **链接必须逐字存在**是最要紧的一条:它是统计资产,
 * 模型改一个字符(比如把 ref 换成它觉得更合理的值)不会报错、
 * 发出去也看不出来,但那次点击就永远归不了因。
 * 这条不能靠模型自觉,必须程序校验。
 */
export function verifyGeneratedReply(text: string, link: string): ReplyRejectReason | null {
  const t = (text ?? '').trim();
  if (!t) return 'empty';
  if (!t.includes(link)) {
    // 区分「压根没带」和「带了但改过」—— 后者更隐蔽,值得单独报
    return /https?:\/\/\S+/.test(t) ? 'link_altered' : 'link_missing';
  }
  if (/(^|\s)@\w+/.test(t)) return 'has_mention';
  if (t.length > MAX_REPLY_CHARS) return 'too_long';
  // 实测:外语会加「稳定运行」「最佳选择」这类清单外承诺
  if (/最佳|最好|第一|最快|稳定运行|保证|\bbest\b|\bfastest\b|\b#1\b|rock solid|guaranteed/i.test(t)) {
    return 'superlative';
  }
  return null;
}

/**
 * 单条「判断 + 生成」合并 prompt(卡片弹窗用)。
 *
 * ⭐ 为什么合并:用户 2026-09-06 反馈「生成很慢」。实测拆解 ——
 * 批量路径是**判断一次 + 生成一次两趟串行**,单条也走这套就是 ~27s(热)/~61s(冷)。
 * 单条场景下判断与生成本可一次问完:模型看同一条推,先决定回不回,
 * 该回就顺手写出来。实测合并后:该回的 ~27s → 一趟;
 * **不该回的只要 5-7s**(不用写正文,提前收工)。
 *
 * ⚠️ 契约刻意用**对象**而非数组。实测(2026-09-06):
 * 同一条推用 `[{...}]` 数组契约要 11-36s 且方差极大,
 * 换成 `{...}` 对象稳定 6-7s —— 数组 grammar 让模型难以判定何时收尾。
 * (曾试过 num_predict 限长提速,**是陷阱**:200/300/400 三档模型
 *  把预算烧光返回空串,512 时灵时不灵 —— 把「慢」换成了「静默截断」,已否决。)
 */
/**
 * 账号事实 —— 采自 `UserByScreenName` 载荷(能力勘查 §2.4)。
 * 有它时 posterKind 就不是猜的了。
 */
export interface PosterFacts {
  handle: string;
  followersCount?: number;
  followingCount?: number;
  tweetCount?: number;
  accountCreatedAt?: string;
  bio?: string;
  isBlueVerified?: boolean;
  /** 这人在库里被我们采到过几条推 —— 高频出现是推广者的强信号 */
  seenTweets?: number;
}

/** 账号事实渲染成 prompt 片段。没有资料就明说没有,让模型填 unclear。 */
function posterBlock(lang: ReplyLang, facts?: PosterFacts): string {
  if (!facts) {
    return lang === 'zh'
      ? '\n【账号资料】未采集到 —— 你只能凭正文判断，判不出就填 unclear。'
      : '\nACCOUNT DATA: not collected — judge from the text alone, and say unclear if you cannot tell.';
  }
  const age = facts.accountCreatedAt
    ? `${Math.floor((Date.now() - new Date(facts.accountCreatedAt).getTime()) / 86_400_000)} 天`
    : '未知';
  const ratio = facts.followersCount != null && facts.followingCount
    ? (facts.followersCount / Math.max(1, facts.followingCount)).toFixed(2)
    : '未知';
  if (lang === 'zh') {
    return `\n【账号资料 —— 已查证，可以据此判断】
- @${facts.handle}
- 粉丝 ${facts.followersCount ?? '未知'} / 关注 ${facts.followingCount ?? '未知'}（粉丝关注比 ${ratio}）
- 账号年龄 ${age}，累计发推 ${facts.tweetCount ?? '未知'}
- 我们库里采到过他 ${facts.seenTweets ?? 0} 条推
- 认证：${facts.isBlueVerified ? '蓝V' : '无'}
- 简介：${facts.bio ? facts.bio.slice(0, 120) : '(空)'}
参考判据：粉丝极少+关注极多+账号很新 → 多半是营销号；
简介里带机场/节点/推广链接、库里出现次数很高 → promoter；
正常粉丝关注比 + 有年头 + 简介与翻墙无关 → 更像真实用户。`;
  }
  return `\nACCOUNT DATA — verified, you may rely on this:
- @${facts.handle}
- ${facts.followersCount ?? '?'} followers / ${facts.followingCount ?? '?'} following (ratio ${ratio})
- account age ${age}, ${facts.tweetCount ?? '?'} tweets total
- we have collected ${facts.seenTweets ?? 0} of their tweets
- verified: ${facts.isBlueVerified ? 'blue check' : 'no'}
- bio: ${facts.bio ? facts.bio.slice(0, 120) : '(empty)'}
Heuristics: very few followers + following many + very new account → likely a marketing account;
bio pushing VPN/proxy services or links, or a high count in our DB → promoter;
normal ratio + established account + unrelated bio → more likely a real user.`;
}

export function buildSingleReplyPrompt(
  lang: ReplyLang,
  link: string,
  examples: Array<{ tweet: string; reply: string }> = [],
  posterFacts?: PosterFacts,
): string {
  const facts = factsBlock(lang, link) + posterBlock(lang, posterFacts);
  const shots = examples.length > 0
    ? (lang === 'zh'
        ? `\n\n【你以往认可的回复风格 —— 照这个口气写】\n${
            examples.map((e) => `用户：${e.tweet}\n回复：${e.reply}`).join('\n---\n')}`
        : `\n\nEXAMPLES of previously approved replies — match this tone:\n${
            examples.map((e) => `User: ${e.tweet}\nReply: ${e.reply}`).join('\n---\n')}`)
    : '';

  if (lang === 'zh') {
    return `你是 ${PRODUCT_FACTS.productName} 的社区回复助手，代表官方账号在 X 上回复求助的用户。

${facts}

回复前先做三步分析，每步都要输出（这是为了事后能回归检查，别省）：

① posterKind —— 发推的是什么人：
   genuine=像真实用户在求助 / promoter=同行推广或卖节点（带群号、报价、自荐机场）
   / bot=机器人或水军刷屏 / unclear=判不出来
   依据 = 上面的【账号资料】+ 这条推文正文。⚠️ 资料显示「未采集到」时只能看正文，
   那种情况下拿不准就填 unclear，**不要猜**。
   posterRead：一句话说明你凭什么这么判（引用具体数字或正文里的依据）。

② trigger —— 因由：对方为什么发这条推，他遇到的具体问题或需求是什么。
   用他自己话里的信息，别脑补。

③ 再决定值不值得回：用户在找翻墙工具、抱怨现用工具不好使、
   问怎么访问被封锁的服务 —— 这些值得回。
   广告引流、纯政治、教程分享、对厂商维权、跟风梗回复、与翻墙无关 —— 不值得回。

不值得回：worth=false，reply 留空字符串。
值得回：写回复 —— 直接回应他说的具体问题，口语、1-2 句、
必须包含注册链接（原样照抄一个字符都不改）、不要 @提及、不要营销腔。
对方问了清单里没有的（价格、速度、节点数），如实说去官网/App 看，别编。${shots}

输出 JSON 对象：
{"posterKind":"genuine","posterRead":"凭什么这么判","trigger":"因由",
 "worth":true,"confidence":0.9,"reason":"一句话","reply":"回复正文"}
不要输出 JSON 之外的任何文字。`;
  }

  return `You reply for ${PRODUCT_FACTS.productName} on X, on behalf of the official account.

${facts}

Do three steps of analysis before replying, and output each one
(this exists so the decision can be reviewed later — do not skip it):

1. posterKind — what kind of account this is:
   genuine = a real user asking for help / promoter = a competitor or reseller
   (group IDs, price lists, pushing their own service) / bot = spam or astroturf
   / unclear = you cannot tell.
   Base it on the ACCOUNT DATA above plus the tweet text. ⚠️ If the account data says
   "not collected", you only have the text — say unclear rather than guessing.
   posterRead: one line citing the specific numbers or wording you relied on.

2. trigger — why they posted: the concrete problem or need they describe.
   Use what is actually in their words; do not invent context.

3. Then decide whether it is worth replying: someone looking for a VPN,
   complaining their current tool fails, or asking how to reach blocked services — worth it.
   Ads and self-promo, pure politics, tutorials, users fighting with their vendor,
   copycat meme replies, anything unrelated — not worth it.

Not worth it: worth=false and leave reply as an empty string.
Worth it: write the reply — address the specific thing they said, casual, 1-2 sentences,
include the signup link **copied verbatim**, no @mentions, no marketing voice.
If they ask something not in the facts (price, speed, server count), say to check
the site/app — do not make it up. Write in English.${shots}

Output a JSON object:
{"posterKind":"genuine","posterRead":"why you judged that","trigger":"what prompted them",
 "worth":true,"confidence":0.9,"reason":"one line","reply":"the reply text"}
Output nothing except the JSON object.`;
}
