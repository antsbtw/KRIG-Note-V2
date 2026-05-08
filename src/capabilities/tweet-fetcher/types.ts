/**
 * tweet-fetcher capability — 对外类型(L5-B3.18)
 *
 * ⚠️ 临时 capability(Phase D browser-capability 正式化时被吸收)
 * 详见同目录 DESIGN.md
 */

export interface TweetFetchData {
  authorName?: string;
  authorHandle?: string;
  authorAvatar?: string;
  text?: string;
  createdAt?: string;
  lang?: string;
  media?: Array<{ type: 'image' | 'video'; url: string; thumbUrl?: string }>;
  metrics?: { replies?: number; retweets?: number; likes?: number; views?: number };
  quotedTweet?: string;
  inReplyTo?: string;
}

export interface TweetFetchResult {
  success: boolean;
  data?: TweetFetchData;
  error?: string;
}

/** view 业务路径 API(单一 method,不接受扩展)*/
export interface TweetFetcherApi {
  /** 抓取推文元数据
   *  - 接受 https://twitter.com / https://x.com 域 URL
   *  - 失败(网络 / 反爬 / SPA 没渲染好 / 选择器变了)→ success:false + error
   *  - main 侧 BrowserWindow + DOM scraping 实现 */
  fetchTweetData(tweetUrl: string): Promise<TweetFetchResult>;
}
