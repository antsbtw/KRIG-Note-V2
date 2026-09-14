/**
 * Web 能力层统一结果契约(`06-data-model-and-interfaces.md` §4.2)
 *
 * V1 各接口失败表达不统一(有的返 null,有的只 console.warn),订阅者会安静等一个
 * 永不到来的结果。按可靠性纲领铁律一,本层**全部统一成三态**:
 *
 *   Ok(值)                  成了,且已确认
 *   Failed(原因, 可否重试)   明确失败
 *   Degraded(值, 缺了什么)   部分成功 —— 调用方必须显式处理,不许当 Ok
 *
 * ⚠️ **没有第四态,特别不许「返回空值假装成功」。**
 * `Degraded` 是为本仓真实场景设的:抓了 80/100 条、喂图成功但缩略图没校验 ——
 * 现在这些要么被当成功要么被当失败,**两种都错**。
 */

export type Ok<T> = { readonly status: 'ok'; readonly value: T };

export type Failed = {
  readonly status: 'failed';
  /** 人能读懂的失败原因 —— 不许空串 */
  readonly reason: string;
  /** 重试有没有意义。调用方据此决定退避还是放弃 */
  readonly retryable: boolean;
};

export type Degraded<T> = {
  readonly status: 'degraded';
  readonly value: T;
  /** 缺了什么 —— 不许空数组(那是 Ok,不是 Degraded) */
  readonly missing: readonly string[];
};

export type Result<T> = Ok<T> | Failed | Degraded<T>;

export function ok<T>(value: T): Ok<T> {
  return { status: 'ok', value };
}

export function failed(reason: string, retryable = false): Failed {
  if (!reason.trim()) {
    // fail loud:空原因的 Failed 等于没说失败,是静默坍缩的另一种形态
    throw new Error('[web.result] Failed 必须给出原因');
  }
  return { status: 'failed', reason, retryable };
}

export function degraded<T>(value: T, missing: readonly string[]): Degraded<T> {
  if (missing.length === 0) {
    // fail loud:没缺东西就是 Ok。允许空 missing 会让调用方误判成「部分失败」
    throw new Error('[web.result] Degraded 必须说明缺了什么;没缺就该用 ok()');
  }
  return { status: 'degraded', value, missing };
}

export function isOk<T>(r: Result<T>): r is Ok<T> {
  return r.status === 'ok';
}

export function isFailed<T>(r: Result<T>): r is Failed {
  return r.status === 'failed';
}

export function isDegraded<T>(r: Result<T>): r is Degraded<T> {
  return r.status === 'degraded';
}
