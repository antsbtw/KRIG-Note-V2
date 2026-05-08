/**
 * tweet-fetcher IPC handlers — L5-B3.18
 *
 * 1 个 invoke:TWEET_FETCH_DATA → fetchTweetData 透传 + URL 防呆。
 *
 * 跟 platform/main/{ipc, ytdlp, media}/ 同风格(集中导出 register* 函数,平铺,
 * 不用 index.ts 聚合)。注册入口:`platform/main/ipc/ipc-bus.ts.initIpcBus()`。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { fetchTweetData } from './fetcher';

/** 仅允许 https://(twitter.com|x.com) 域 — 防 file:// / about: / 自定义协议越权 */
const TWEET_URL_PATTERN = /^https:\/\/(twitter\.com|x\.com|www\.twitter\.com|www\.x\.com)\//;

export function registerTweetFetcherHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.TWEET_FETCH_DATA, async (_event, tweetUrl: unknown) => {
    if (typeof tweetUrl !== 'string' || !tweetUrl) {
      return { success: false, error: 'invalid url' };
    }
    if (!TWEET_URL_PATTERN.test(tweetUrl)) {
      return { success: false, error: 'url must be https://twitter.com or https://x.com' };
    }
    return fetchTweetData(tweetUrl);
  });
}
