/**
 * tweet-fetcher capability — renderer 侧入口(L5-B3.18)
 *
 * ⚠️ ⚠️ ⚠️ 临时 capability ⚠️ ⚠️ ⚠️
 *
 * 详见同目录 DESIGN.md。
 *
 * - 仅服务 tweet-block 一个消费者(NodeView Fetch 按钮)
 * - **不接受新功能扩展** — 任何"顺手加点别的 scraping"一律走 Phase D browser-capability 通道
 * - Phase D browser-capability 正式化后,本 capability 被吸收为"DOM scraping" 子能力
 *
 * 实现位置:src/platform/main/tweet-fetcher/(BrowserWindow + DOM scraping)。
 * 本文件是 renderer 侧 IPC 调用封装 + Registry 注册门面。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { TweetFetcherApi, TweetFetchResult } from './types';

export type { TweetFetcherApi, TweetFetchData, TweetFetchResult } from './types';

/**
 * 抓取推文元数据
 *
 * @param tweetUrl 完整 Twitter / X URL(https://twitter.com/.../status/<id> 或 x.com)
 * @returns success:true + data 或 success:false + error
 *          失败原因:网络 / Twitter 反爬 / SPA 没渲染好 / Twitter 改 data-testid 选择器
 */
export async function fetchTweetData(tweetUrl: string): Promise<TweetFetchResult> {
  if (!window.electronAPI?.fetchTweetData) {
    return { success: false, error: 'electronAPI.fetchTweetData not available' };
  }
  return window.electronAPI.fetchTweetData(tweetUrl);
}

// W5 严格态:Registry 注册 + api 字段(view 通过 requireCapabilityApi 间接路由)
// 同时保留模块级 export(driver/slot 内部消费,W5 边界 A 临时允许项)
capabilityRegistry.register({
  id: 'tweet-fetcher',
  api: { fetchTweetData } satisfies TweetFetcherApi,
});
