/**
 * ⭐⭐ **打包送 Claude 取建议** —— 流水线第 ④ 步(用户 2026-09-26 定)。
 *
 * > 「在回复阶段，它主动提取这个推主的 bio，以及这条推文上下文10～20条，
 * >   打包发送到 Claude 网页版，Claude 做统一建议，取回 Claude 的建议后，
 * >   用户（人工）做一次选定和回复。」
 *
 * ## 为什么是独立一层(纯函数)
 *
 * ⭐ prompt 格式是**学习环节的主战场** —— 改 prompt 比训练模型快得多、
 * 见效立刻、随时可撤。放在能力层里改一次要连着 webview 一起跑,没法迭代。
 * ⭐ 一进一出都是纯函数:可单测、可离线回放,不需要开 webview。
 *
 * ## 与给 Gemma 那套的分工(⚠️ 别混)
 *
 * | | Gemma(`x-reply-facts.ts`) | Claude(本文件) |
 * |---|---|---|
 * | 谁在跑 | 本机小模型 | 网页版大模型 |
 * | 一次几条 | **一条**(对象契约) | **整批**(用户 2026-09-26 选) |
 * | 有没有上下文 | 只有 tweet.text | bio + 整楼上文 |
 * | 输出 | JSON,程序直接用 | **给人看的建议**,人再选定 |
 *
 * ⭐ **事实清单与校验两边共用**(`PRODUCT_FACTS` / `verifyGeneratedReply`)——
 * 那是业务资产,两份必漂。只有**指令**是各写各的。
 *
 * ## ⚠️ 红线
 *
 * 这一步**只取建议**。发不发、发哪条,是人点的
 * (`askAI` 里的 clickSendButton 是**发给 Claude**,与发推无关,别混)。
 */

import type { ReplyLang } from './x-reply-types';
import { PRODUCT_FACTS, type ProductFacts } from './x-reply-facts';

/** 一条候选推 + 它的全部语境 —— 打包的输入单元 */
export interface AdviceItem {
  tweetId: string;
  tweetUrl?: string;
  authorHandle: string;
  text: string;
  lang: ReplyLang;
  /** 作者简介 —— ⚠️ 没采到就是 undefined,**别填空串**(空串会让模型以为"简介是空的") */
  bio?: string;
  followersCount?: number;
  followingCount?: number;
  /** 账号注册时间(ISO) —— 新号 + 粉丝极少是营销号的强信号 */
  accountCreatedAt?: string;
  /** 他关注了我们 —— 真实用户的强信号(水军不会关注小账号) */
  followsMe?: boolean;
  /**
   * ⭐ 这一楼的上文,**由近及远**([0] 是紧邻那条)。
   * ⚠️ 空数组 = 独立原创推(本来就没有上文),与「没抓到」不同 —— 见 `contextMissing`。
   */
  context?: Array<{ text: string; authorHandle?: string }>;
  /** ⚠️ true = 这是回复串里的一条但**上文没抓到**,模型看不到楼里在聊什么 */
  contextMissing?: boolean;
  /** Gemma 判断时给的理由 —— 让 Claude 知道前一步为什么把它挑出来 */
  aiReason?: string;
}

export interface BuildAdviceOptions {
  /** 落地页链接(已带 ref 占位或真 ref) */
  link: string;
  /** 用户在面板里改过的口径;不传回落代码默认值 */
  facts?: ProductFacts;
  /** 用户此前原样认可过的回复 —— 让 Claude 对齐语气 */
  examples?: Array<{ tweet: string; reply: string }>;
  /** 单条正文上限 —— 与发推校验同一个数,别各写各的 */
  maxChars?: number;
}

/** 一条推在 prompt 里渲染成什么样 */
function renderItem(it: AdviceItem, seq: number): string {
  const lines: string[] = [`### ${seq}. @${it.authorHandle}（id: ${it.tweetId}）`];

  /**
   * ⚠️ 账号资料**没有就明说没有**,不留空 ——
   * 留空模型会当成"这人没写简介",而实际是"我们没采到",两者含义完全不同。
   */
  const prof: string[] = [];
  if (it.followersCount != null) {
    prof.push(`粉丝 ${it.followersCount}`);
    if (it.followingCount != null) prof.push(`关注 ${it.followingCount}`);
  }
  if (it.accountCreatedAt) {
    const days = Math.floor((Date.now() - new Date(it.accountCreatedAt).getTime()) / 86_400_000);
    if (Number.isFinite(days)) prof.push(`账号 ${days} 天`);
  }
  if (it.followsMe) prof.push('**他关注了我们**');
  lines.push(`- 账号：${prof.length > 0 ? prof.join(' / ') : '（未采到）'}`);
  lines.push(`- 简介：${it.bio?.trim() ? it.bio.trim().slice(0, 200) : '（未采到）'}`);

  /**
   * ⭐ 上文三态要分清楚,**别合成一种**:
   *  · 有上文      → 列出来
   *  · 独立原创推  → 本来就没有(不是缺陷)
   *  · 没抓到      → ⚠️ 模型据此该更保守
   */
  if (it.context && it.context.length > 0) {
    lines.push(`- 这一楼的上文（由近及远，共 ${it.context.length} 条）：`);
    it.context.forEach((c, i) => {
      lines.push(`  ${i + 1}. @${c.authorHandle ?? '?'}：${c.text.trim().slice(0, 300)}`);
    });
  } else if (it.contextMissing) {
    lines.push('- 上文：⚠️ **这是回复串里的一条，但上文没抓到** ——'
      + '你看不到这楼在聊什么，拿不准就建议「不回」。');
  } else {
    lines.push('- 上文：（独立推文，不在回复串里，本来就没有上文）');
  }

  if (it.aiReason) lines.push(`- 前一步挑中它的理由：${it.aiReason}`);
  lines.push(`- 推文正文：\n> ${it.text.trim().replace(/\n/g, '\n> ')}`);
  return lines.join('\n');
}

/**
 * 事实清单 —— ⚠️ 与 Gemma 那份**同源**(都读 `ProductFacts`),
 * 措辞按 Claude 的场景重写:这里是给人看的建议,不是程序直接用的 JSON。
 */
function factsSection(f: ProductFacts, link: string): string {
  return `## 我方产品事实（**只能用这里的内容，其余一律不许说**）

- 产品名：${f.productName}
- 服务方向：${f.direction}
- 试用：${f.trial}
- 平台：${f.platforms}
- 账号共享：${f.accountSharing}
- 支付方式：${f.paymentNote}
- 注册链接：${link}

**严禁**编造：${f.forbidden.join('、')}，以及任何上面没写的内容。
**严禁**做稳定性/速度承诺（"稳定运行""最快"），不要用"最佳""第一"这类最高级。`;
}

/**
 * ⭐⭐ 把一批候选打包成给 Claude 的一条消息。
 *
 * ⚠️ **整批一次发**(用户 2026-09-26 选)——好处是 Claude 能**横向比较**
 * (「这几条里这条最值得回」),那正是逐条发拿不到的。
 */
export function buildAdvicePrompt(
  items: readonly AdviceItem[],
  opts: BuildAdviceOptions,
): string {
  const f = opts.facts ?? PRODUCT_FACTS;
  const max = opts.maxChars ?? 260;
  const shots = (opts.examples ?? []).length > 0
    ? `\n\n## 以往人工认可过的回复（照这个口气）\n${
      (opts.examples ?? []).map((e) => `- 推文：${e.tweet}\n  回复：${e.reply}`).join('\n')}`
    : '';

  return `你是 ${f.productName} 的社区回复顾问。下面是我们从 X 上筛出来的 ${items.length} 条推文，
请对每一条给出**回复建议**。

${factsSection(f, opts.link)}

## 怎么判断

先看这楼在聊什么，再看这个人是谁，最后才决定回不回、怎么回：

1. **这楼和我们相关吗** —— 是不是在说「上不去某个网站 / 需要能翻墙或回国的工具」？
   ⚠️ 不相关就建议不回。在聊游戏/追星的楼里有人说「我 VPN 太卡关了」，
   他**不是在找 VPN**，去推销只会招人烦。
2. **这人是什么人** —— 真实求助者 / 同行推广（卖节点、带群号报价）/ 机器人刷屏 / 看不出来。
   依据是上面的账号资料和正文。⚠️ 写着「未采到」时就只能看正文，
   **拿不准就说看不准，不要猜**。
3. **方向别搞反** —— 想看国内的（爱奇艺/腾讯/B站/淘宝/微信）→ 说「接入中国」那边；
   想看海外的（YouTube/Netflix/英超/美区商店）→ 说「出海节点」那边。

## 回复怎么写

- 直接回应他说的**具体问题**，不要套话开场
- 口语、简短，1-2 句，像真人随手回的
- **必须包含注册链接，原样照抄，一个字符都不能改**
- 不要 @提及（X 会自动带），不要营销腔，不要堆 emoji
- 全文不超过 ${max} 字符
- 他问了清单里没有的（价格、速度、节点数），如实说去官网/App 看，**别编**
- ⚠️ 推文是中文就回中文，**其余一律回英文**（我们的落地页只有中英两版，
  用俄语/波斯语回复会把人导向他读不懂的英文页，比直接用英文更差）

## 候选

${items.map((it, i) => renderItem(it, i + 1)).join('\n\n')}${shots}

## 输出格式

每条一段，**严格照这个格式**，不要加别的：

\`\`\`
[1] id=<推文id> 建议=<回复|不回> 把握=<高|中|低>
理由：<一句话说清为什么>
正文：<建议的回复原文；建议不回时这行写「—」>
\`\`\`

⚠️ 最后另起一段，用一两句话说说**这批里哪几条最值得优先回**，以及为什么。`;
}

/** Claude 给的一条建议 */
export interface ParsedAdvice {
  tweetId: string;
  shouldReply: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  /** 建议不回时为空串 */
  text: string;
}

export interface ParseAdviceResult {
  advices: ParsedAdvice[];
  /** ⚠️ 整体总结(「这批里哪几条最值得优先回」)—— 给人看的,不进库 */
  summary?: string;
  /**
   * ⚠️⚠️ **解析不出来的原样留下** —— fail loud。
   * Claude 改了格式必须**看得见**,不能静默返回空数组
   * (现象会是「点了没反应」,本仓最贵的一类 bug)。
   */
  unparsed: string[];
}

const CONF: Record<string, ParsedAdvice['confidence']> = {
  高: 'high', 中: 'medium', 低: 'low',
  high: 'high', medium: 'medium', low: 'low',
};

/**
 * ⭐⭐ 解析 Claude 的回答。
 *
 * ⚠️ **宽进严出**:模型的排版会飘(多余空行、markdown 包裹、全角冒号),
 * 这些都要吃下来;但**吃不下的必须报**,不能假装解析成功。
 */
export function parseAdviceResponse(markdown: string): ParseAdviceResult {
  const advices: ParsedAdvice[] = [];
  const unparsed: string[] = [];
  const raw = (markdown ?? '').trim();
  if (!raw) return { advices, unparsed: ['(空回答)'] };

  /** ⚠️ 去掉 ``` 围栏:模型常把整段包在代码块里 */
  const body = raw.replace(/^```[\w]*\s*$/gm, '');

  /**
   * 按 `[n]` 切块 —— ⚠️ 用 lookahead 保留分隔符本身。
   *
   * ⚠️ **末尾的总结段也要切出来**:它没有 `[n]` 前缀,
   * 不切的话会粘在最后一条建议里(实测踩过,见上面正文的空行边界)。
   */
  const blocks = body
    .split(/\n(?=\s*\[\d+\])/)
    .flatMap((blk) => {
      const m = blk.match(/\n\s*\n([\s\S]+)$/);
      /** 建议块里不会有空行;出现空行说明后面跟的是别的段落 */
      return m && /^\[\d+\]/.test(blk.trim())
        ? [blk.slice(0, blk.length - m[1].length), m[1]]
        : [blk];
    });
  for (const blk of blocks) {
    const b = blk.trim();
    if (!b) continue;
    if (!/^\[\d+\]/.test(b)) {
      /** 不是建议块 —— 最后那段总结走这里 */
      if (b.length > 8) unparsed.push(b);
      continue;
    }
    /** ⚠️ 全角/半角冒号都吃 */
    const id = b.match(/id\s*[=：:]\s*(\d{6,25})/)?.[1];
    const act = b.match(/建议\s*[=：:]\s*(回复|不回)/)?.[1];
    if (!id || !act) { unparsed.push(b.slice(0, 200)); continue; }
    const conf = b.match(/把握\s*[=：:]\s*(高|中|低|high|medium|low)/i)?.[1] ?? '中';
    const reason = b.match(/理由\s*[=：:]\s*(.+)/)?.[1]?.trim() ?? '';
    /**
     * ⚠️ 正文可能多行,取到下一个已知字段或块尾。
     *
     * ⚠️⚠️ **空行即止** —— 2026-09-26 实测:最后一块的「正文」原来会把
     * 后面那段**总结句一起吞进去**(因为块尾之前没有任何终止符),
     * 于是「建议不回」的那条 text 不是空串而是整段总结。
     * ⭐ Claude 的建议块内部不会有空行,段落之间才有 —— 用空行当边界。
     */
    const textRaw = b.match(
      /正文\s*[=：:]\s*([\s\S]+?)(?=\n\s*\n|\n\s*(?:\[\d+\]|理由|建议|把握)|$)/,
    )?.[1] ?? '';
    /** ⚠️ 破折号/减号都算「不回」,模型两种都写过 */
    const text = /^[—-]$/.test(textRaw.trim()) ? '' : textRaw.trim();
    advices.push({
      tweetId: id,
      shouldReply: act === '回复',
      confidence: CONF[conf.toLowerCase()] ?? 'medium',
      reason,
      text,
    });
  }

  /**
   * ⭐ 最后一段没有 `[n]` 的当总结 —— 但**仍留在 unparsed 里**:
   * 把它当总结是我们的猜测,猜错了要看得出来。
   */
  const summary = unparsed.length > 0 ? unparsed[unparsed.length - 1] : undefined;
  return { advices, summary, unparsed };
}
