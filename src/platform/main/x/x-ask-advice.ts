/**
 * ⭐⭐ **送 Claude 取回复建议** —— 流水线第 ④ 步(用户 2026-09-26)。
 *
 * > 「在回复阶段，它主动提取这个推主的 bio，以及这条推文上下文10～20条，
 * >   打包发送到 Claude 网页版，Claude 做统一建议，取回 Claude 的建议后，
 * >   用户（人工）做一次选定和回复。」
 *
 * ## 三件事,各有归属
 *
 * ① **组装语境** —— 这里做(从库里取候选 + bio + 上文)
 * ② **打包/解析** —— `@shared/types/x-claude-advice` 的纯函数做
 * ③ **收发** —— `ai/ask-orchestrator` 的 `askAI` 做(现成的,粘贴+发送+等回复)
 *
 * ⚠️ 三件分开是有意的:② 是纯函数可单测可离线回放,
 * 而 prompt 格式是**学习环节的主战场**(改 prompt 比训练模型快得多),
 * 混进这里就得连 webview 一起跑才能改一个字。
 *
 * ## ⚠️ 红线
 *
 * 这一步**只取建议**,发不发是人点的。
 * `askAI` 内部的 `clickSendButton` 是**发给 Claude**,与发推无关 —— 别混。
 *
 * ## ⚠️ 已知未验
 *
 * `askAI` 在本仓**长期无人调用**(注释写着「保留供测试 / 程序化调用」)。
 * 用户 2026-09-26 确认「当然活着」,但**未经本机实测**。
 * ⭐ 第一次真跑若失败(现象多是「粘贴进去了但没回应」或 waitForResponse 超时),
 * **先回来怀疑这条**,别往别处查。
 */

import { askAI } from '../ai/ask-orchestrator';
import { queryInbox } from '../db/tweet-inbox-repo';
import { getAuthorCounts } from '../db/x-author-repo';
import { getProductFacts } from '../db/x-product-facts-repo';
import { getApprovedExamples } from '../db/x-reply-feedback-repo';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import { langOf, LANDING_BASE, LINK_PARAMS, REF_PLACEHOLDER } from '@shared/types/x-reply-types';
import { MAX_REPLY_CHARS, verifyGeneratedReply } from '@shared/types/x-reply-facts';
import {
  buildAdvicePrompt, parseAdviceResponse,
  type AdviceItem, type ParsedAdvice,
} from '@shared/types/x-claude-advice';

export interface AskAdviceOptions {
  wsId: string;
  /** 本 ws 的 AI Host guest wcId —— ⚠️ 不传会回退到登记表,多 ws 下会串 */
  wcId?: number;
  /** 一批几条 —— ⚠️ 太多会超 Claude 单条输入上限,默认保守 */
  limit?: number;
  /** ref 追踪标记(进链接) */
  ref?: string;
  /** 等 Claude 回答的预算 —— 整批比单条慢得多 */
  timeoutMs?: number;
}

export interface AskAdviceResult {
  /** 送过去几条 */
  sent: number;
  /** 解析出几条建议 */
  parsed: number;
  /** 其中建议「回复」的 */
  recommended: number;
  advices: ParsedAdvice[];
  summary?: string;
  /**
   * ⚠️ 解析不出来的原样带回 —— Claude 改了格式必须**看得见**。
   * 静默返回空数组的现象是「点了没反应」,本仓最贵的一类 bug。
   */
  unparsed: string[];
  /**
   * ⭐ 程序校验没通过的(链接被改写 / 带 @ / 超长 / 最高级承诺)。
   * ⚠️ 这一层**对 Claude 同样要做** —— 它写得流畅,不代表不会改链接。
   */
  rejected: Array<{ tweetId: string; reason: string }>;
  error?: string;
}

/** 落地页链接 —— 与模板走同一套拼法,不另写一份 */
function buildLink(lang: 'zh' | 'en', ref?: string): string {
  const r = ref?.trim() || REF_PLACEHOLDER;
  return `${LANDING_BASE}?ref=${r}&${LINK_PARAMS[lang]}`;
}

/**
 * 从库里取候选并配齐语境。
 *
 * ⚠️ **不现采** —— bio 与上文由第 ③ 步(备料)负责。
 * 这里只读库:取不到就如实标「未采到」,让模型据此保守,
 * 而不是在这一步偷偷再跑一次详情页(那会让「备料」这一步失去意义,
 * 而且两处都能采 = 两份实现必漂)。
 */
async function collectItems(
  wsId: string, limit: number,
): Promise<AdviceItem[]> {
  const pool = await queryInbox({
    status: 'worth', wsId, replied: false, limit,
  });
  const items: AdviceItem[] = [];
  for (const t of pool) {
    /** ⚠️ handle 必须归一化:x_tweet 存 @Xxx,x_author 存小写,不归一化永远查不到 */
    const h = normalizeHandle(t.author_handle ?? '');
    const a = h ? await getAuthorCounts(h).catch(() => null) : null;
    const parentText = (t.parent_text ?? '').trim();
    /**
     * ⚠️ 是不是回复串里的一条 —— 与备料那边同一个判据。
     * 用它区分「独立原创推(本来没上文)」与「是回复但没抓到」。
     */
    const isReply = !!t.in_reply_to_user || /^\s*@\w+/.test(t.text ?? '');
    items.push({
      tweetId: t.tweet_id,
      tweetUrl: t.tweet_url,
      authorHandle: h || (t.author_handle ?? ''),
      text: t.text ?? '',
      lang: langOf(t.lang),
      bio: a?.bio?.trim() || undefined,
      followersCount: a?.followersCount,
      followingCount: a?.followingCount,
      accountCreatedAt: a?.accountCreatedAt,
      followsMe: a?.followsMe,
      /**
       * ⚠️ 库里只存了**紧邻一条**父推(`parent_text`)。
       * 整段上文目前只在备料那一趟的返回值里,还没有落库字段
       * (见设计文档 §6 `context_snapshot`,尚未做)——
       * 所以这里最多给一条,**不假装有十条**。
       */
      context: parentText
        ? [{ text: parentText, authorHandle: t.parent_handle }]
        : undefined,
      contextMissing: isReply && !parentText,
      /** ⭐ 前一步挑中它的理由 —— 让 Claude 知道 Gemma 为什么把它选出来 */
      aiReason: t.ai_verdict?.reason || undefined,
    });
  }
  return items;
}

/**
 * ⭐⭐ 送一批候选给 Claude,取回建议。
 *
 * ⚠️ **整批一次发**(用户 2026-09-26 选)——Claude 能横向比较
 * 「这几条里哪条最值得回」,那是逐条发拿不到的。
 */
export async function askClaudeForAdvice(
  opts: AskAdviceOptions,
): Promise<AskAdviceResult> {
  const empty: AskAdviceResult = {
    sent: 0, parsed: 0, recommended: 0, advices: [], unparsed: [], rejected: [],
  };
  const items = await collectItems(opts.wsId, opts.limit ?? 10);
  if (items.length === 0) return empty;

  /**
   * ⚠️ 一批里可能中英混杂,而链接分语言。
   * 取**多数派**那个语言的链接进 prompt —— 校验也用它。
   * (更细的做法是按条给链接,但那样 prompt 里会出现两条链接,
   *  模型容易张冠李戴;宁可这一批只推一种。)
   */
  const zhCount = items.filter((i) => i.lang === 'zh').length;
  const lang: 'zh' | 'en' = zhCount * 2 >= items.length ? 'zh' : 'en';
  const link = buildLink(lang, opts.ref);

  const [facts, examples] = await Promise.all([
    getProductFacts(),
    getApprovedExamples(lang, 5).catch(() => []),
  ]);

  const prompt = buildAdvicePrompt(items, {
    link, facts, examples, maxChars: MAX_REPLY_CHARS,
  });

  const res = await askAI('claude', prompt, opts.wcId, opts.timeoutMs ?? 180_000);
  if (!res.success || !res.markdown) {
    /**
     * ⚠️ fail loud:把原因原样带回。
     * ⭐ `askAI` 本仓长期无人调用,第一次真跑失败**先怀疑它**(见文件头)。
     */
    return { ...empty, sent: items.length, error: res.error ?? 'Claude 没有返回内容' };
  }

  const parsed = parseAdviceResponse(res.markdown);

  /**
   * ⭐⭐ **Claude 写的也要过程序校验** —— 它写得流畅不代表不改链接。
   * ⚠️ 链接被改写最隐蔽:发出去看不出来,但那次点击永远归不了因。
   */
  const rejected: Array<{ tweetId: string; reason: string }> = [];
  const advices = parsed.advices.filter((a) => {
    if (!a.shouldReply) return true;          // 建议不回的没有正文要校验
    const bad = verifyGeneratedReply(a.text, link);
    if (bad) { rejected.push({ tweetId: a.tweetId, reason: bad }); return false; }
    return true;
  });

  return {
    sent: items.length,
    parsed: parsed.advices.length,
    recommended: advices.filter((a) => a.shouldReply).length,
    advices,
    summary: parsed.summary,
    unparsed: parsed.unparsed,
    rejected,
  };
}
