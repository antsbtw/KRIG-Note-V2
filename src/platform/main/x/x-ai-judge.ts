/**
 * X 时间线 AI 判断层（Phase 1）— Gemma 4 via Ollama
 *
 * 降级策略：Ollama 不可用 → console.error（fail loud）+ 推文保持 pending（等模型恢复后可重判）
 */

import { callOllama } from '../local-llm/ollama-client';
import { queryPending, markAiJudging, updateVerdict } from '../db/tweet-inbox-repo';
import type { JudgeConfig, AIVerdict, TweetInboxRecord } from '@shared/types/x-timeline-types';

/** OTun 产品背景 system prompt（注入业务语境，防 Gemma 4 因合规顾虑误判 VPN 求助） */
const SYSTEM_PROMPT = `你是 OTun VPN 产品的推文筛选助手。OTun 是一款面向中国大陆用户的 VPN 工具，
帮助用户突破网络封锁，访问 X、Google、YouTube 等服务。

你的任务是判断推文是否值得 OTun 团队回复。以下类型的推文 worth=true：
- 用户寻求 VPN/翻墙工具的推荐或求助
- 用户第一人称抱怨自己在用的 VPN 不好用、连不上、速度慢、到期不想续费（潜在想换工具）
- 用户询问如何在中国大陆访问被封锁的网站或服务
- 用户提到 clash/v2ray/shadowsocks/梯子等翻墙相关工具出现问题

以下类型 worth=false：
- 纯政治讨论（无产品切入点）
- 广告/营销推文
- 模板化刷屏内容：口号式分段排版的软文,或同一句式反复出现的跟风/水军回复（如"求推荐同款纯度的VPN"这类带链接的梗回复）
- 对着某家具体 VPN/机场维权：用"你们"称呼厂商、找客服、催工单、要求修复——用户在向现有供应商讨说法,不是在找新工具
- 询问某个特定产品好不好用、稳不稳定的评价咨询（没有表达要找/要换工具）
- 翻墙周边疑问但没有找工具的意图（如"挂着梯子微信会不会被封"、账号封禁申诉、换区教程求助）
- 与翻墙/VPN 无关的内容

每次输入是一个推文 JSON 数组，每条推文包含 tweetId、text 和 lang。
- 如果 lang 不是 "zh"，必须在输出中加入 "translation" 字段，将推文内容翻译成中文（一句话，保留原意）。
- 如果 lang 是 "zh" 或者推文本身已是中文，translation 字段留空字符串 ""。

输出必须是 JSON 数组，每条对应一个判断结果，格式：
[
  {
    "tweetId": "...",
    "worth": true,
    "confidence": 0.9,
    "reason": "用户明确求助找翻墙工具",
    "tags": ["VPN求助", "潜在用户"],
    "suggestReply": true,
    "translation": "我需要一个好用的VPN"
  }
]
不要输出除 JSON 数组之外的任何文字。`;

interface RawVerdictItem {
  tweetId?: string;
  worth?: boolean;
  confidence?: number;
  reason?: string;
  tags?: string[];
  suggestReply?: boolean;
  translation?: string;
}

function parseVerdicts(content: string): Map<string, AIVerdict> {
  const result = new Map<string, AIVerdict>();
  let items: unknown[];
  try {
    // Gemma 有时在 json_object 模式下把数组包在对象里
    const parsed = JSON.parse(content);
    items = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown[]>)[Object.keys(parsed as object)[0]] ?? [];
  } catch {
    throw new Error(`[x-ai-judge] failed to parse Ollama response as JSON: ${content.slice(0, 200)}`);
  }

  for (const item of items) {
    const v = item as RawVerdictItem;
    if (!v.tweetId) continue;
    const translation = typeof v.translation === 'string' && v.translation.trim() ? v.translation.trim() : undefined;
    result.set(v.tweetId, {
      worth: Boolean(v.worth),
      confidence: typeof v.confidence === 'number' ? v.confidence : 0.5,
      reason: typeof v.reason === 'string' ? v.reason : '',
      tags: Array.isArray(v.tags) ? v.tags.filter((t) => typeof t === 'string') : [],
      suggestReply: Boolean(v.suggestReply),
      translation,
    });
  }
  return result;
}

/**
 * 对一批 pending 推文调用 Gemma 4 判断，写回 ai_verdict。
 *
 * Ollama 不可用 → console.error + 推文保持 pending（降级，非静默：有明确日志）。
 */
export async function judgeWithOllama(
  batch: TweetInboxRecord[],
  config: JudgeConfig,
): Promise<void> {
  if (batch.length === 0) return;

  const tweetIds = batch.map((t) => t.tweet_id);
  await markAiJudging(tweetIds);

  const userContent = JSON.stringify(
    batch.map((t) => ({ tweetId: t.tweet_id, text: t.text, lang: t.lang ?? 'unknown' })),
  );

  let verdictMap: Map<string, AIVerdict>;
  try {
    const response = await callOllama({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      endpoint: config.ollamaEndpoint,
      timeoutMs: config.timeoutMs,
      temperature: 0.2,
      responseFormat: 'json_object',
    });
    verdictMap = parseVerdicts(response.content);
  } catch (err) {
    // fail loud：打明确错误日志，推文回退 pending 等模型恢复
    console.error('[x-ai-judge] Ollama unavailable:', (err as Error).message);
    // 回退 pending
    const db = (await import('@storage/surreal/client')).getDB();
    await db.query(
      `UPDATE tweet_inbox SET status = 'pending' WHERE tweet_id IN $ids`,
      { ids: tweetIds },
    );
    return;
  }

  // 写回判断结果
  for (const tweet of batch) {
    const verdict = verdictMap.get(tweet.tweet_id);
    if (!verdict) {
      // Ollama 没有返回这条推文的判断 → 回退 pending，下次重判
      const db = (await import('@storage/surreal/client')).getDB();
      await db.query(
        `UPDATE tweet_inbox SET status = 'pending' WHERE tweet_id = $id`,
        { id: tweet.tweet_id },
      );
      continue;
    }
    await updateVerdict(tweet.tweet_id, verdict);
  }

  console.log(
    `[x-ai-judge] judged ${batch.length} tweets, worth=${[...verdictMap.values()].filter((v) => v.worth).length}`,
  );
}

/**
 * 从 tweet_inbox 拉取 pending 推文并批量判断。
 * 供调度器和 IPC handler（X_AI_JUDGE_BATCH）调用。
 *
 * @param wsId 传入时只判该 ws 的 pending（per-ws 隔离，防跨 ws 混批）；
 *             不传时判全部 ws 的 pending（向后兼容，但生产路径应始终传 wsId）。
 */
export async function runJudgeBatch(config: JudgeConfig, wsId?: string): Promise<void> {
  const pending = await queryPending(config.batchSize, wsId);
  if (pending.length === 0) {
    console.log(`[x-ai-judge] no pending tweets${wsId ? ` for ws=${wsId}` : ''}, skip`);
    return;
  }
  await judgeWithOllama(pending, config);
}
