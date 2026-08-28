/**
 * Google 翻译免费端点封装（无需 API key）
 * 用于推文非中文内容的实时翻译，替代 Gemma 本地翻译（速度慢、占资源）
 *
 * ## 限速 / 退避 / 熔断（2026-08-28）
 *
 * 这是个**无 key 的免费端点**，Google 会按 IP 反爬限流。之前的实现逐条全速打、
 * 失败即弃、且不打断整轮，实测一次补填 28 条里 **14 条被 429 打掉**（一半），
 * 终端刷满 `failed: HTTP 429`，而那 14 条翻译**永久丢失** —— 下次启动重新查出来、
 * 重新再打一遍 429。既吵又白烧配额。
 *
 * 三层防护：
 *
 * 1. **限速**：两次请求之间至少隔 `MIN_INTERVAL_MS`（模块级串行，跨调用方共享）。
 *    免费端点没有公开配额，这个值是保守估计，宁慢勿被封。
 * 2. **退避重试**：429/403/5xx 是**暂时性**的，指数退避重试 `MAX_RETRIES` 次。
 *    4xx（除 429/403）是请求本身的问题，重试没有意义，直接放弃。
 * 3. **熔断**：连续失败达 `CIRCUIT_THRESHOLD` 次即判定「当前 IP 已被限流」，
 *    停掉后续所有请求并**打一行总结**，不再逐条刷屏。熔断后 `COOLDOWN_MS` 内
 *    直接短路返回 null；冷却期过后自动半开重试一次。
 *
 * 熔断是关键：被限流时继续打只会加深封锁，而且每条都要等完整的退避周期，
 * 一轮补填能拖十几分钟。fail fast 比硬撑更快也更礼貌。
 */

const GT_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

/** 两次请求最小间隔 —— 免费端点无公开配额，保守取值 */
const MIN_INTERVAL_MS = 350;
/** 暂时性失败的重试次数（不含首次） */
const MAX_RETRIES = 3;
/** 退避基数：第 n 次重试等 BACKOFF_BASE_MS * 2^n */
const BACKOFF_BASE_MS = 800;
/** 连续失败多少次判定被限流、熔断 */
const CIRCUIT_THRESHOLD = 5;
/** 熔断后冷却多久才半开重试 */
const COOLDOWN_MS = 5 * 60_000;

/** 上一次请求发出的时刻（模块级，跨调用方共享同一条限速队列） */
let lastRequestAt = 0;
/** 当前连续失败计数（成功即清零） */
let consecutiveFailures = 0;
/** 熔断打开的时刻；0 表示未熔断 */
let circuitOpenedAt = 0;
/** 熔断期间被短路掉的请求数，用于恢复时打总结 */
let suppressedCount = 0;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 熔断是否生效中（顺带处理冷却到期的半开） */
function circuitIsOpen(): boolean {
  if (circuitOpenedAt === 0) return false;
  if (Date.now() - circuitOpenedAt >= COOLDOWN_MS) {
    // 冷却到期 —— 半开：清空状态放一个请求过去探路
    console.log(
      `[googleTranslate] 冷却结束，恢复翻译（熔断期间跳过 ${suppressedCount} 条）`,
    );
    circuitOpenedAt = 0;
    consecutiveFailures = 0;
    suppressedCount = 0;
    return false;
  }
  return true;
}

/** 记一次失败；达到阈值则熔断并打**一行**总结（不再逐条刷屏） */
function recordFailure(reason: string): void {
  consecutiveFailures++;
  if (consecutiveFailures === CIRCUIT_THRESHOLD) {
    circuitOpenedAt = Date.now();
    console.warn(
      `[googleTranslate] 连续 ${CIRCUIT_THRESHOLD} 次失败（最后一次：${reason}），` +
        `判定为被限流，暂停翻译 ${COOLDOWN_MS / 60_000} 分钟。` +
        `期间的翻译请求会直接跳过，不再逐条报错。`,
    );
  }
}

/** 该状态码是否值得重试（暂时性故障） */
function isRetryable(status: number): boolean {
  return status === 429 || status === 403 || status >= 500;
}

/** 限速闸门：确保与上一次请求间隔 ≥ MIN_INTERVAL_MS */
async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * 翻译单条文本到中文。
 * 失败时返回 null（非致命，调用方决定是否重试）。
 *
 * 内部已含限速 / 退避重试 / 熔断，调用方**不需要**自己加 sleep 或重试。
 */
export async function googleTranslate(text: string, targetLang = 'zh-CN'): Promise<string | null> {
  if (circuitIsOpen()) {
    suppressedCount++;
    return null;
  }

  const url = `${GT_ENDPOINT}?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!resp.ok) {
        // 不可重试的 4xx：请求本身有问题，再试多少次都一样
        if (!isRetryable(resp.status)) {
          recordFailure(`HTTP ${resp.status}`);
          return null;
        }
        // 可重试：还有机会就退避后再来，没机会了记失败
        if (attempt < MAX_RETRIES) {
          await sleep(BACKOFF_BASE_MS * 2 ** attempt);
          continue;
        }
        recordFailure(`HTTP ${resp.status}`);
        return null;
      }

      const json = (await resp.json()) as unknown[][];
      // 返回结构: [[["译文","原文",null,null,1],...],null,"检测语言",...]
      const segments = json[0];
      if (!Array.isArray(segments)) {
        recordFailure('响应结构异常');
        return null;
      }
      const translation = (segments as Array<string[]>)
        .map((s) => s[0])
        .filter(Boolean)
        .join('');

      consecutiveFailures = 0; // 成功即清零，避免零星失败累积成误熔断
      return translation.trim() || null;
    } catch (err) {
      // 网络层错误（超时 / DNS / 连接重置）同样按暂时性处理
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_BASE_MS * 2 ** attempt);
        continue;
      }
      recordFailure((err as Error).message);
      return null;
    }
  }
  return null;
}

/** 熔断是否正在生效 —— 调用方据此提前收工，别在被限流时空转整轮 */
export function translateCircuitOpen(): boolean {
  return circuitIsOpen();
}

/**
 * 批量翻译，返回 tweetId → translation 的 Map。
 * 逐条请求（Google 翻译接口不支持批量），失败条目跳过。
 *
 * 熔断触发后立即停止 —— 剩下的条目留给下次（DB 里没写 translation 就还会被查出来）。
 */
export async function googleTranslateBatch(
  items: Array<{ tweetId: string; text: string }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const item of items) {
    if (translateCircuitOpen()) break;
    const translation = await googleTranslate(item.text);
    if (translation) result.set(item.tweetId, translation);
  }
  return result;
}
