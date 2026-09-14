/**
 * `web.net` 数据模型(`06-data-model-and-interfaces.md` §3.2 / §4.1)
 *
 * V1 的 `NetworkRecord` / `NetworkEvent` / `DownloadRecord` 实测站点特化为 0,可直接采用。
 * 本文件在其基础上做两处 V2 化:
 *  1. `pageId` 用步 1 的不透明 `PageId`(不是裸 string)
 *  2. 新增 `channel-lost` 事件 —— V1 没有,这是本步要补的**失聪告警**(见 `bus.ts` 注释)
 */

import type { PageId } from '../page/types';

/** 一次网络请求的完整快照 */
export type NetworkRecord = {
  /** 本层的规范 requestId(来自 webRequest 侧) */
  readonly requestId: string;
  readonly pageId: PageId;
  readonly frameId?: string | null;
  readonly url: string;
  readonly method: string;
  readonly resourceType?: string;
  readonly status?: number;
  readonly mimeType?: string;
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly startedAt: string;
  readonly finishedAt?: string;
  /** 取 body 用的句柄。调用方拿它去 `body(bodyRef)`,不直接持有 bytes */
  readonly bodyRef?: string;
  readonly bodyBytes?: number;
  /** CDP 侧的 requestId —— 与上面的 requestId **是两套编号**,靠 correlate 配对 */
  readonly providerRequestId?: string;
};

export type DownloadRecord = {
  readonly downloadId: string;
  readonly pageId: PageId;
  readonly frameId?: string | null;
  readonly url: string;
  readonly filename: string;
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly status: 'started' | 'completed' | 'failed' | 'cancelled';
  readonly error?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly storageRef?: string;
};

/**
 * 订阅者收到的事件。
 *
 * ⭐ `channel-failed` / `channel-lost` 是 V1 **没有**的两类,本步新增 ——
 * 它们是「静默失聪」的解药:
 *  - `channel-failed`:attach 失败(V1 只 console.warn,订阅者安静等一个永不来的载荷)
 *  - `channel-lost`:通道被外部抢占 / 页面销毁(V1 有 `dbg.on('detach')` 但不通知订阅者)
 *
 * 没有这两类,失败形态就是「不报错、不重试,只是再也收不到数据」——
 * 表现为「采集突然变 0」,而这正是 `x/refactor-02` §3.3 记的那个疑似真 bug。
 */
export type NetworkEvent =
  | {
      readonly kind: 'request-start';
      readonly pageId: PageId;
      readonly frameId?: string | null;
      readonly requestId: string;
      readonly url: string;
      readonly method: string;
      readonly at: string;
    }
  | {
      readonly kind: 'response-chunk';
      readonly pageId: PageId;
      readonly frameId?: string | null;
      readonly requestId: string;
      readonly mimeType?: string;
      readonly chunkText?: string;
      readonly at: string;
    }
  | {
      readonly kind: 'response-complete';
      readonly pageId: PageId;
      readonly frameId?: string | null;
      readonly requestId: string;
      readonly status?: number;
      readonly bodyRef?: string;
      readonly at: string;
    }
  | {
      readonly kind: 'download-complete';
      readonly pageId: PageId;
      readonly frameId?: string | null;
      readonly downloadId: string;
      readonly filename: string;
      readonly storageRef?: string;
      readonly at: string;
    }
  /** ⭐ 通道建立失败 —— 订阅者据此知道「我永远等不到载荷了」 */
  | {
      readonly kind: 'channel-failed';
      readonly pageId: PageId;
      readonly reason: string;
      readonly retryable: boolean;
      readonly at: string;
    }
  /** ⭐ 通道中途失去 —— 被外部 detach / 页面销毁 */
  | {
      readonly kind: 'channel-lost';
      readonly pageId: PageId;
      readonly reason: string;
      readonly at: string;
    };

export type NetworkEventKind = NetworkEvent['kind'];

/** 订阅时的匹配条件 */
export type NetworkMatcher = {
  readonly kinds?: readonly NetworkEventKind[];
  readonly frameId?: string;
  readonly urlIncludes?: string;
};

export type NetworkFilter = {
  readonly frameId?: string;
  readonly urlIncludes?: string;
  readonly resourceType?: string;
  readonly limit?: number;
};

/**
 * 捕获策略 —— ⭐ **噪音名单由调用方给,底座不内置站点规则**(`04` §3.1 / 决策 4)。
 *
 * V1 在 `session-capture.ts:31` 硬编码了 `s-cdn.anthropic.com/images/` 这类
 * 明显为 Claude 页面调的名单 —— 那是站点适配漏进了底层。
 * 本层只保留**通用**规则(按 resourceType 过滤),站点相关的一律走这个参数。
 */
export type CapturePolicy = {
  /** 只捕获这些 resourceType(归一化后)。默认 xhr/fetch/document */
  readonly resourceTypes?: readonly string[];
  /** 调用方给的噪音 URL 子串名单 —— 底座自己一条都不带 */
  readonly noisyUrlSubstrings?: readonly string[];
  /** 单条 body 上限,超过不存(防大文件吃爆内存) */
  readonly maxBodyBytes?: number;
};
