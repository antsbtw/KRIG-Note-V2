/**
 * ⭐⭐ 任务「VPN求助」—— 纯函数(2026-10-23)
 *
 * 用户 10-23:「下面再完成VPN求助配方这个任务?和蓝V互关类似了,先找到VPN的求助贴,再筛选有价值的,然后再草拟回复对方的方法。」
 * 用户选:先帮忙再带链接 · 只回 24 小时内的 · Gemma 先判、我抽看推翻。
 *
 * 判断:一次一条、对象契约(记忆 project-x-judge-array-contract-spin:数组契约下 Gemma 只答第一条,整批丢);
 *   提示词取自 9-29 删掉的 x-ai-judge.ts SYSTEM_PROMPT(双向产品、worth=true/false 的分类是那时用户定的)。
 * 回复:只用产品事实清单(x-reply-facts.ts);链接逐字、带来源标识(x-reply-types.ts buildRef);
 *   程序校验(verifyGeneratedReply)—— 链接被改 / 没带 / @ / 太长 / 最高级都不填。
 */
import { PRODUCT_FACTS, verifyGeneratedReply, type ReplyRejectReason } from '@shared/types/x-reply-facts';
import { LANDING_BASE, LINK_PARAMS, buildRef, type ReplyLang } from '@shared/types/x-reply-types';

/** 任务用的配方(库里 search_recipes 的名字)—— 出海求助 + 回国需求,中英各一 */
export const VPN_RECIPES = ['VPN求助-中文', 'VPN求助-英文', '回国需求-中文', '回国需求-英文'] as const;
/** 只回多新的(用户 10-23 选「24 小时内」) */
export const VPN_FRESH_HOURS = 24;

const CJK = /[一-鿿]/;
const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return [...t].length > n ? `${[...t].slice(0, n).join('')}…` : t;
};

/**
 * ⭐ 这条推文自己是不是命中了配方(关键词任一 且 求助信号任一)—— 纯函数
 * ⚠️ 2026-10-23 真机:一次搜索的载荷里还带着被引用的推文、回复的上文,存库时也记了这条搜索;
 *   不筛就把《部落冲突》、政治帖、偏方都登记成「求助帖」(同 10-22 采互动的坑)。
 */
export function matchesRecipe(text: string, keywords: readonly string[], signals: readonly string[]): boolean {
  const t = text.toLowerCase();
  const hit = (w: string): boolean => t.includes(w.toLowerCase());
  return keywords.some(hit) && (signals.length === 0 || signals.some(hit));
}

export type VpnVerdict = {
  readonly worth: boolean;
  /** out = 想从受限网络出去 · in = 人在海外想回国用国内服务 · none = 都不是 */
  readonly direction: 'out' | 'in' | 'none';
  readonly reason: string;
  readonly translation?: string;
};

const JUDGE_SYSTEM = `你是 OTun VPN 产品的推文筛选助手。
⚠️ OTun 是双向服务:① 从海外接入中国(走中国住宅网络,用国内 App / 购物 / 流媒体);② 从受限网络出海(有英国等海外节点)。两个方向的求助都值得回。

worth=true:
- 寻求 VPN / 代理工具的推荐或求助(两个方向都算)
- 第一人称抱怨自己在用的 VPN 不好用、连不上、速度慢、到期不想续费(潜在想换)
- 询问如何访问被限制的网站或服务(出海或回国)
- 人在海外、想用国内 App / 看国内剧 / 上淘宝但受地区限制
- 提到 clash / v2ray / shadowsocks / 梯子等工具出问题

worth=false:
- 纯政治讨论(无产品切入点)
- 广告 / 营销推文
- 模板化刷屏:口号式分段软文,或同一句式反复出现的跟风 / 水军回复(如「求推荐同款纯度的VPN」这类带链接的梗回复)
- 对着某家具体 VPN / 机场维权:用「你们」称呼厂商、找客服、催工单 —— 在向现有供应商讨说法,不是在找新工具
- 只问某个特定产品好不好用、稳不稳定(没表达要找 / 要换)
- 翻墙周边疑问但没有找工具的意图(如「挂着梯子微信会不会被封」、账号封禁申诉、换区教程)
- 与翻墙 / VPN 无关
有「上一层」时先看上一层:这楼如果和 VPN 无关(比如只是在聊别的、顺嘴提一句),worth=false。

输出单个 JSON 对象(不是数组),不要任何其他文字:
{"worth": true, "direction": "out", "reason": "一句话理由(中文)", "translation": "不是中文时译成中文,否则空字符串"}
direction 只能是 out / in / none。`;

export type JudgeExample = { readonly text: string; readonly verdict: 'accept' | 'reject' };

/** 判断提示词 —— 纯函数 */
export function buildJudgePrompt(input: {
  readonly text: string; readonly lang?: string; readonly parent?: string; readonly examples: readonly JudgeExample[];
}): Array<{ role: 'system' | 'user'; content: string }> {
  const shots = input.examples.map((e) => `推文:${clip(e.text, 160)}\n人工判断:${e.verdict === 'accept' ? '值得回' : '不值得回'}`).join('\n\n');
  const user = `${shots ? `下面是人工判过的例子:\n\n${shots}\n\n` : ''}${input.parent ? `上一层:${clip(input.parent, 300)}\n` : ''}`
    + `这条推文(lang=${input.lang ?? '未知'}):${clip(input.text, 500)}`;
  return [{ role: 'system', content: JUDGE_SYSTEM }, { role: 'user', content: user }];
}

/** 解析判断 —— 纯函数;不合格回原因(调用方记 judge_error,下次重判;绝不当成「不值得」) */
export function parseJudge(raw: string): { readonly verdict: VpnVerdict } | { readonly problem: string } {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return { problem: '模型没回 JSON 对象' };
  let o: Record<string, unknown>;
  try { o = JSON.parse(m[0]) as Record<string, unknown>; } catch { return { problem: '模型回的 JSON 解析不了' }; }
  if (typeof o.worth !== 'boolean') return { problem: '模型没给 worth(true/false)' };
  const direction = o.direction === 'out' || o.direction === 'in' ? o.direction : 'none';
  const reason = typeof o.reason === 'string' && o.reason.trim() !== '' ? o.reason.trim() : '(模型没给理由)';
  const translation = typeof o.translation === 'string' && o.translation.trim() !== '' ? o.translation.trim() : undefined;
  return { verdict: { worth: o.worth, direction, reason, translation } };
}

/** 回复用什么语言:帖子里有中文 → 中文,否则英文 */
export function replyLangOf(text: string): ReplyLang {
  return CJK.test(text) ? 'zh' : 'en';
}

const RECIPE_TAG: Record<string, string> = { 'VPN求助-中文': 'vpnzh', 'VPN求助-英文': 'vpnen', '回国需求-中文': 'backzh', '回国需求-英文': 'backen' };

/** ⭐ 试用链接:落地页 + 来源标识(账号_日期_配方,能对账哪条配方带来转化)+ 语言参数 —— 纯函数 */
export function vpnLink(lang: ReplyLang, myHandle: string, recipe: string | undefined, now: Date): string {
  const tag = recipe ? RECIPE_TAG[recipe] ?? recipe : undefined;
  return `${LANDING_BASE}?ref=${buildRef(myHandle, now, tag)}&${LINK_PARAMS[lang]}`;
}

function factsBlock(lang: ReplyLang, link: string): string {
  const f = PRODUCT_FACTS;
  if (lang === 'zh') {
    return `【可用事实 —— 只能用这里的内容,不得添加任何其他承诺】
- 产品名:${f.productName}
- 服务方向:${f.direction}
- 试用:${f.trial}
- 平台:${f.platforms}
- ${f.accountSharing}
- 支付方式:${f.paymentNote}
- 注册链接(逐字照抄,一个字都不能改):${link}
【严禁】编造${f.forbidden.join('、')},或任何上面没写的内容;不做稳定性 / 速度承诺,不用「最佳」「第一」这类最高级。`;
  }
  return `FACTS — use ONLY what is listed here:
- Product: ${f.productName}
- Direction: ${f.direction}
- Trial: ${f.trial}
- Platforms: ${f.platforms}
- ${f.accountSharing}
- Payment: ${f.paymentNote}
- Signup link (copy EXACTLY, do not change a single character): ${link}
NEVER invent any of: ${f.forbidden.join(', ')} — or anything not listed. No stability / speed promises, no superlatives like "best" or "#1".`;
}

/** ⭐ 回复提示词 —— 纯函数。先帮忙(针对他的具体问题说一两句有用的),再带试用链接(用户 10-23 选) */
export function buildVpnReplyPrompt(input: {
  readonly tweet: string;
  readonly lang: ReplyLang;
  readonly link: string;
  readonly direction?: 'out' | 'in' | 'none';
  readonly context?: string;
  readonly examples: ReadonlyArray<{ readonly tweet: string; readonly reply: string }>;
  readonly rules?: readonly string[];
  readonly revise?: { readonly previous: string; readonly note: string };
}): Array<{ role: 'system' | 'user'; content: string }> {
  const zh = input.lang === 'zh';
  const sys = [
    zh ? '你替 OTun-M 的推特账号回复一个正在找 VPN / 网络工具帮助的人。目的是先真正帮到他,再自然地给出试用链接。'
      : 'You reply on behalf of the OTun-M X account to someone looking for VPN / network help. First genuinely help, then naturally offer the trial link.',
    zh ? '结构:先针对他说的具体问题说一两句有用的话(像真人,口语、真诚),最后一句带上注册链接。'
      : 'Structure: one or two genuinely useful sentences about his specific problem (human, casual, sincere), then end with the signup link.',
    zh ? `规矩:用中文;全文不超过 200 字;链接只出现一次、放在最后、逐字照抄;不要 @ 任何人;不要话题标签;不要引号和解释。${input.direction === 'in' ? '他是人在海外想回国用国内服务。' : input.direction === 'out' ? '他是想从受限网络出去。' : ''}`
      : `Rules: write in English; under 200 characters; the link appears exactly once, at the end, copied exactly; no @mentions; no hashtags; no quotes or explanations.${input.direction === 'in' ? ' He is abroad and wants Chinese services.' : input.direction === 'out' ? ' He wants to get out of a restricted network.' : ''}`,
    factsBlock(input.lang, input.link),
    ...(input.rules && input.rules.length > 0 ? [`他的长期要求(一定照做,冲突时以这里为准):\n${input.rules.map((r, i) => `${i + 1}. ${r.trim()}`).join('\n')}`] : []),
    zh ? '只输出这一条回复本身。' : 'Output only the reply itself.',
  ].join('\n');
  const shots = input.examples.map((e, i) => `例 ${i + 1}\n他的帖子:${clip(e.tweet, 140)}\n我的回复:${e.reply.trim()}`).join('\n\n');
  const ctx = input.context && input.context.trim() !== '' ? `这条帖子所在的对话(从原帖开始):\n${input.context.slice(0, 1200)}\n\n` : '';
  const tail = input.revise ? `\n\n上一版回复:${input.revise.previous.trim()}\n他对上一版的点评(照着改):${input.revise.note.trim()}\n\n改好的回复:` : '\n\n我的回复:';
  const user = `${shots ? `下面是我以前亲手写的回复:\n\n${shots}\n\n` : ''}${ctx}现在要回复的帖子:\n${clip(input.tweet, 400)}${tail}`;
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

const REJECT_TEXT: Record<ReplyRejectReason, string> = {
  empty: '模型回了空的', link_missing: '没带试用链接', link_altered: '链接被改动了(来源标识会丢)',
  has_mention: '带了 @(X 会自动带上对方)', too_long: '太长了', superlative: '用了「最好 / 最快 / 保证」这类承诺',
};

/** 收拾 + 校验回复草稿 —— 纯函数;不合格回原因,不填 */
export function cleanVpnDraft(raw: string, link: string): { readonly text: string } | { readonly problem: string } {
  const lines = raw.trim().split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4);
  let t = lines.join('\n').replace(/^(改好的回复|我的回复|回复|Reply)\s*[:：]\s*/i, '').replace(/^["“「『'`]+|["”」』'`]+$/g, '').trim();
  /** 模型常在链接后面带个句号 —— 去掉紧贴链接的标点,链接本身不动 */
  t = t.replace(new RegExp(`${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[。.!！]+`), link);
  const bad = verifyGeneratedReply(t, link);
  if (bad) return { problem: REJECT_TEXT[bad] };
  if (/(^|\s)#\S/.test(t)) return { problem: '带了话题标签' };
  return { text: t };
}
