/**
 * tweet-fetcher core — BrowserWindow + DOM scraping(L5-B3.18)
 *
 * V1 → V2 直迁:src/plugins/web/main/ipc-handlers.ts:1335-1364 fetchTweetData。
 *
 * ⚠️ 临时 capability 实现(用户红线"避免临时能力长期化"):
 * - 本模块仅服务 tweet-block 一个消费者,不接受新功能扩展
 * - Phase D browser-capability 正式化后,本能力被吸收为"DOM scraping"子能力
 * - DESIGN.md 顶部 banner 标识临时性
 *
 * 实现路径:
 * 1. 创建隐藏 BrowserWindow(800x900,show:false,nodeIntegration:false,contextIsolation:true)
 * 2. loadURL(tweetUrl)— 等 Twitter SPA 路由完成
 * 3. 轮询最多 10 秒,检查 article[data-testid="tweet"] 是否渲染
 * 4. executeJavaScript(EXTRACT_TWEET_JS)— DOM scraping 拿元数据
 * 5. finally 销毁 BrowserWindow(防内存泄漏)
 *
 * 失败模式:
 * - 网络断 / Twitter 反爬 → loadURL throw → success:false + error
 * - SPA 没渲染好(轮询超时)→ success:false + 'Tweet page did not render in time'
 * - executeJavaScript throw → success:false + error
 *
 * 任何路径都保证 BrowserWindow.destroy()(finally 兜底)。
 */

import { BrowserWindow } from 'electron';
import { EXTRACT_TWEET_JS } from './extract-script';

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

const RENDER_POLL_INTERVAL_MS = 500;
const RENDER_POLL_MAX_TIMES = 20; // 共 10 秒

/**
 * 抓取推文元数据
 *
 * @param tweetUrl 完整 https://twitter.com/.../status/<id> 或 https://x.com/.../status/<id>
 * @returns success:true + data 或 success:false + error
 */
export async function fetchTweetData(tweetUrl: string): Promise<TweetFetchResult> {
  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      width: 800,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    await win.loadURL(tweetUrl);

    // 等待 Twitter SPA 渲染(轮询最多 10 秒,检查推文 article 元素)
    let rendered = false;
    for (let i = 0; i < RENDER_POLL_MAX_TIMES; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, RENDER_POLL_INTERVAL_MS));
      if (win.isDestroyed()) {
        return { success: false, error: 'BrowserWindow destroyed during render polling' };
      }
      const hasArticle = (await win.webContents.executeJavaScript(
        'document.querySelector(\'article[data-testid="tweet"]\') !== null',
      )) as boolean;
      if (hasArticle) {
        rendered = true;
        break;
      }
    }
    if (!rendered) {
      return { success: false, error: 'Tweet page did not render in time' };
    }

    // 执行 DOM 提取
    const data = (await win.webContents.executeJavaScript(EXTRACT_TWEET_JS)) as TweetFetchData;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: String(err) };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}
