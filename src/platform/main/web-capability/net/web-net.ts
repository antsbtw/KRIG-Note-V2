/**
 * `web.net` 对外接口(`06-data-model-and-interfaces.md` §3.2)
 *
 * ⭐⭐ 接口上**没有 attach / detach** —— 这是本层最重要的一条设计。
 *
 * 应用**只订阅,永不 attach/detach**,通道由底座独占。
 * 「最后一个人关灯」这个时刻不存在,也就无从关错灯 ——
 * X 现在那 8 处「A 结束时 detach 把共用的 B 掐掉」的问题,
 * **在这个模型下根本不可能发生**,因为业务方压根没有这个动作。
 */

import type { Result } from '../result';
import type { PageId } from '../page/types';
import type {
  DownloadRecord,
  NetworkFilter,
  NetworkMatcher,
  NetworkRecord,
} from './types';
import type { NetworkListener } from './bus';

export interface WebNet {
  /**
   * 订阅页面的网络事件,返回取消订阅函数。
   *
   * ⚠️ 订阅者一定会收到 `channel-failed` / `channel-lost`(**不受 kinds 过滤**)——
   * 否则「通道没了」这件事本身也会被静默,那这层就白做了。
   */
  subscribe(pageId: PageId, matcher: NetworkMatcher, listener: NetworkListener): () => void;

  /** 等一个匹配的请求。超时返回 `Failed`,**不返回 null** */
  waitFor(
    pageId: PageId,
    matcher: { urlIncludes?: string; method?: string; resourceType?: string },
    timeoutMs: number,
  ): Promise<Result<NetworkRecord>>;

  /** 列出已记录的请求。没有就是空数组(如实说没有,不是兜底) */
  list(pageId: PageId, filter?: NetworkFilter): NetworkRecord[];

  /** 取 body。取不到返回 `Failed`,**不返回空 bytes 假装成功** */
  body(bodyRef: string): Result<Uint8Array>;

  downloads(pageId: PageId): DownloadRecord[];
}
