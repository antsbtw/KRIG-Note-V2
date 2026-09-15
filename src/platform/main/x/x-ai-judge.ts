/**
 * X 时间线 AI 判断层（Phase 1）— Gemma 4 via Ollama
 *
 * 降级策略：Ollama 不可用 → console.error（fail loud）+ 推文保持 pending（等模型恢复后可重判）
 */

import { callOllama } from '../local-llm/ollama-client';
import { queryPending, markAiJudging, updateVerdict } from '../db/tweet-inbox-repo';
import { DEFAULT_JUDGE_CONFIG } from '@shared/types/x-timeline-types';
import type { JudgeConfig, AIVerdict, TweetInboxRecord } from '@shared/types/x-timeline-types';

/**
 * 运行时判断配置:模型名可用环境变量 KRIG_JUDGE_MODEL 覆盖。
 * 场景:win-desktop 只有 6GB 显存,跑 26b MoE(评测一致率 97.6% 打平 31b);
 * Mac 默认 31b 不受影响。改配置无需改代码重打包。
 */
export function getJudgeConfig(): JudgeConfig {
  const model = process.env.KRIG_JUDGE_MODEL;
  return model ? { ...DEFAULT_JUDGE_CONFIG, model } : DEFAULT_JUDGE_CONFIG;
}

/** OTun 产品背景 system prompt（注入业务语境，防 Gemma 4 因合规顾虑误判 VPN 求助） */
const SYSTEM_PROMPT = `你是 OTun VPN 产品的推文筛选助手。

⚠️ OTun 是**双向**服务(2026-09-07 用户订正,此前这里只写了一边):
 ① 从海外接入中国 —— 走中国住宅网络,用国内 App / 购物 / 流媒体
 ② 从受限网络出海 —— 有英国等海外节点
**两个方向的求助都值得回**,别只认「翻墙出去」那一类。

你的任务是判断推文是否值得 OTun 团队回复。以下类型的推文 worth=true：
- 用户寻求 VPN/代理工具的推荐或求助(两个方向都算)
- 用户第一人称抱怨自己在用的 VPN 不好用、连不上、速度慢、到期不想续费（潜在想换工具）
- 用户询问如何访问被限制的网站或服务(出海或回国均可)
- 人在海外、想用国内 App/看国内剧/上淘宝但受地区限制
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

/**
 * 从模型返回里取出判断数组。
 *
 * ⚠️ 曾经的写法是「取第一个 key 的值」——
 *   `parsed[Object.keys(parsed)[0]] ?? []`。
 * 它在两种真实情况下会**静默返回空数组**:
 *   ① 外层 key 不是数组(如 `{"results":{...}}`、`{"error":"..."}`)
 *   ② 数组不在第一个 key 上(如 `{"count":10,"results":[...]}` —— key 顺序不保证)
 * 后果:整批推文被判成「模型没返回」→ 全部回退 pending → `judged=0`,
 * 而 `startJudgeDrain` 把 `judged===0` 当成「pending 清空」**直接 break**,
 * 于是积压明明还在,drain 却显示正常结束(又一次「看着成功实际没做」)。
 * 2026-09-04 离线评测实测:80 条里整整一批 10 条就是这样丢的。
 *
 * 改为**扫所有 key 找数组**,一个都找不到就 throw —— 让调用方走既有的
 * 「回退 pending + 上抛」路径,由 drain 的连续失败计数处理,绝不静默当空批。
 */
function extractItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    // 批里只剩 1 条时模型会返回**裸对象** {"tweetId":...,"worth":...} 而非数组。
    // 2026-09-05 在生成侧实测到,此处同源:不认它 → 那条被判「模型没返回」
    // → 回退 pending → 下轮又只有它一条 → **永远判不完**(且不报错)。
    if ('tweetId' in (parsed as object)) return [parsed];
    const values = Object.values(parsed as Record<string, unknown>);
    // 优先取「元素像判断结果」的数组,避免误取到无关数组(如 tags)
    const looksLikeVerdicts = values.find(
      (v): v is unknown[] => Array.isArray(v)
        && v.some((it) => it && typeof it === 'object' && 'tweetId' in (it as object)),
    );
    if (looksLikeVerdicts) return looksLikeVerdicts;
    const anyArray = values.find((v): v is unknown[] => Array.isArray(v));
    if (anyArray) return anyArray;
  }
  throw new Error(
    `[x-ai-judge] response JSON contains no verdict array (keys=${
      parsed && typeof parsed === 'object' ? Object.keys(parsed as object).join(',') : typeof parsed
    })`,
  );
}

function parseVerdicts(content: string): Map<string, AIVerdict> {
  const result = new Map<string, AIVerdict>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`[x-ai-judge] failed to parse Ollama response as JSON: ${content.slice(0, 200)}`);
  }
  // ⚠️ 不能并进上面的 try:extractItems 的 throw 会被 catch 吞成
  //    「JSON 解析失败」,把「结构不对」误报成「不是 JSON」,掩盖真因。
  // Gemma 有时在 json_object 模式下把数组包在对象里,故不能只认顶层数组。
  const items = extractItems(parsed);

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

export interface JudgeBatchResult {
  judged: number;   // 本批实际写回 verdict 的条数
  worth: number;    // 其中判 worth 的条数
  /**
   * 本批从 pending 取到的条数。
   * ⚠️ 用来区分两种 `judged === 0`:
   *   `fetched === 0` → 队列真的空了(可以停)
   *   `fetched > 0`   → 取到了却一条没判成(模型返回没覆盖这些 id),**不是空队列**
   * 此前 drain 只看 judged,后者会被当成「清空」直接 break,积压还在却显示正常结束。
   */
  fetched: number;
}

/**
 * 对一批 pending 推文调用 Gemma 4 判断，写回 ai_verdict。
 *
 * Ollama 失败 → 推文回退 pending 后 **throw**（fail loud，调用方必须感知；
 * 曾经在这里静默吞掉导致 UI 显示"判断完成"实则全灭）。
 */
export async function judgeWithOllama(
  batch: TweetInboxRecord[],
  config: JudgeConfig,
): Promise<JudgeBatchResult> {
  if (batch.length === 0) return { judged: 0, worth: 0, fetched: 0 };

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
    console.error('[x-ai-judge] Ollama call failed:', (err as Error).message);
    /**
     * 回退 pending 后上抛，让调用方(UI/调度器)看到失败。
     *
     * ⚠️⚠️ **2026-09-14 修 Bug 1**:这里原来写的是 `UPDATE tweet_inbox` ——
     * 而 `tweet_inbox` 是**死表**(活库 28 行,最新一条停在 2026-09-01;
     * x_tweet 同期 11900+ 行)。于是「退回 pending 下次重判」这个动作
     * **打在空表上**,推文实际停在 `ai_judging`,**再也不会被重判**。
     *
     * ⚠️ 为什么一直没被发现:启动时 `recoverStuckAiJudging()` 会把卡住的捞回来,
     * 所以现象是「**要等下次重启才恢复**」而不是当场丢数据。
     * ⭐ 今天启动日志里那句「自愈:41 条卡在 ai_judging 已退回 pending」
     * 就是这个 bug 的活体现场。
     */
    const db = (await import('@storage/surreal/client')).getXDB();
    await db.query(
      `UPDATE x_tweet SET status = 'pending' WHERE tweet_id IN $ids`,
      { ids: tweetIds },
    );
    throw err;
  }

  // 写回判断结果
  let judged = 0;
  let worth = 0;
  for (const tweet of batch) {
    const verdict = verdictMap.get(tweet.tweet_id);
    if (!verdict) {
      // Ollama 没有返回这条推文的判断 → 回退 pending，下次重判
      // ⚠️ 同上(Bug 1 的第二处):原来打在死表 tweet_inbox 上,这条推会卡死在 ai_judging
      const db = (await import('@storage/surreal/client')).getXDB();
      await db.query(
        `UPDATE x_tweet SET status = 'pending' WHERE tweet_id = $id`,
        { id: tweet.tweet_id },
      );
      continue;
    }
    await updateVerdict(tweet.tweet_id, verdict);
    judged += 1;
    if (verdict.worth) worth += 1;
  }

  console.log(`[x-ai-judge] judged ${judged}/${batch.length} tweets, worth=${worth}`);
  return { judged, worth, fetched: batch.length };
}

/**
 * 从 tweet_inbox 拉取 pending 推文并批量判断。
 * 供调度器和 IPC handler（X_AI_JUDGE_BATCH）调用。
 *
 * Ollama 失败会 throw（fail loud），fire-and-forget 的调用方自行 .catch。
 *
 * @param wsId 传入时只判该 ws 的 pending（per-ws 隔离，防跨 ws 混批）；
 *             不传时判全部 ws 的 pending（向后兼容，但生产路径应始终传 wsId）。
 */
export async function runJudgeBatch(config: JudgeConfig, wsId?: string): Promise<JudgeBatchResult> {
  const pending = await queryPending(config.batchSize, wsId);
  if (pending.length === 0) {
    console.log(`[x-ai-judge] no pending tweets${wsId ? ` for ws=${wsId}` : ''}, skip`);
    return { judged: 0, worth: 0, fetched: 0 };
  }
  return judgeWithOllama(pending, config);
}

// ── 后台连续判断（清积压用）────────────────────────────────────────────
// 一批 10 条约 3 分钟,积压上千条时手动逐批点不现实;
// startJudgeDrain 在主进程后台逐批跑完全部 pending,出错即停(fail loud 留痕)。
const drainingWs = new Set<string>();

export function isDraining(wsId: string): boolean {
  return drainingWs.has(wsId);
}

export function startJudgeDrain(config: JudgeConfig, wsId: string): void {
  if (drainingWs.has(wsId)) {
    console.log(`[x-ai-judge] drain already running for ws=${wsId}, skip`);
    return;
  }
  drainingWs.add(wsId);
  void (async () => {
    let total = 0;
    let consecutiveFailures = 0;
    try {
      // 上限防失控:1000 批 = 万条,远超真实积压
      for (let i = 0; i < 1000; i++) {
        try {
          const r = await runJudgeBatch(config, wsId);
          if (r.fetched === 0) break;   // 队列真空了 —— 唯一可以正常收工的出口
          if (r.judged === 0) {
            // 取到了却一条没判成:模型返回没覆盖这些 id(推文已回退 pending)。
            // ⚠️ 这**不是**空队列 —— 此前按 judged===0 break,积压还在却报「完成」。
            // 计入连续失败,连续 3 次才停,避免同一批反复空转成死循环。
            consecutiveFailures += 1;
            console.error(
              `[x-ai-judge] drain ws=${wsId} batch returned no verdicts for ${r.fetched} tweets `
              + `(${consecutiveFailures}/3) —— 已回退 pending`,
            );
            if (consecutiveFailures >= 3) {
              throw new Error(`连续 ${consecutiveFailures} 批未取到任何判断,停止 drain(积压未清完)`);
            }
            continue;
          }
          total += r.judged;
          consecutiveFailures = 0;
          console.log(`[x-ai-judge] drain ws=${wsId} progress: ${total} judged so far`);
        } catch (err) {
          // 单批失败(26b MoE 偶发 JSON 输出坏掉,评测实测 ~18% 批次)容忍重试;
          // 连续 3 次才停(Ollama 真挂了的信号),失败推文已回退 pending 不丢
          consecutiveFailures += 1;
          console.error(`[x-ai-judge] drain ws=${wsId} batch failed (${consecutiveFailures}/3):`, (err as Error).message);
          if (consecutiveFailures >= 3) throw err;
        }
      }
      console.log(`[x-ai-judge] drain ws=${wsId} finished, total judged=${total}`);
    } catch (err) {
      console.error(`[x-ai-judge] drain ws=${wsId} stopped on error after ${total} judged:`, (err as Error).message);
    } finally {
      drainingWs.delete(wsId);
    }
  })();
}
