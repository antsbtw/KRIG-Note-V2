/**
 * tweet-fetcher core — BrowserWindow + DOM scraping(L5-B3.18)
 *
 * V1 → V2 直迁:src/plugins/web/main/ipc-handlers.ts:1335-1364 fetchTweetData。
 *
 * ⚠️ 临时 capability 实现(用户红线"避免临时能力长期化"):
 * - 本模块仅服务 tweet-block 一个消费者,不接受新功能扩展
 * - DESIGN.md 顶部 banner 标识临时性
 *
 * ── ⭐ 2026-09-30:「等元素出现」已改走 `web.page.ready`(L2 收口第 1 批)──
 *
 * 本文件头注释原本写着这么一条债:
 *   「Phase D browser-capability 正式化后,本能力被吸收为 DOM scraping 子能力」
 * —— 当时就意识到了,只是一直没还。现在还其中一半。
 *
 * **换掉了什么**:手写的「setTimeout 轮询 20 次 × 500ms 查元素」。
 * ⭐ 不只是少几行 —— `ready` 多做了一件手写版**没做**的事:
 * 页面正在导航时 `executeJavaScript` 必抛,手写版直接把这一轮当"没渲染好"白等,
 * `ready` 把注入异常**记下来继续等**,超时时再如实说出最后一次异常。
 * 于是「网络慢」与「脚本坏了」不再混成同一句 'did not render in time'。
 *
 * **没换的**:`EXTRACT_TWEET_JS` 那一大段 DOM 提取(它是**站点知识**,
 * 归 adapter 不归底座),以及隐藏 BrowserWindow 的创建/销毁。
 *
 * 实现路径:
 * 1. 创建隐藏 BrowserWindow(800x900,show:false,nodeIntegration:false,contextIsolation:true)
 * 2. 登记进 `pageRegistry` + `bindPageHost`(底座靠 pageId 找到这个 wc)
 * 3. `controlEngine.goto` 导航 + `ready` 等推文 article 出现
 * 4. executeJavaScript(EXTRACT_TWEET_JS)— DOM scraping 拿元数据
 * 5. finally 销毁 BrowserWindow(防内存泄漏)
 *
 * 失败模式:
 * - 网络断 / Twitter 反爬 → goto 返 Failed → success:false + error
 * - SPA 没渲染好 → `ready` 超时 → success:false + error(**带最后一次注入异常**)
 * - executeJavaScript throw → success:false + error
 *
 * 任何路径都保证 BrowserWindow.destroy()(finally 兜底)。
 */

import { BrowserWindow } from 'electron';
import { EXTRACT_TWEET_JS } from './extract-script';
import { controlEngine, pageRegistry, registerAnchorTable } from '../web-capability/wiring/runtime';
import { bindPageHost } from '../web-capability/wiring/page-hosts';
import type { AnchorName } from '../web-capability/dom/types';

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

/** 等推文渲染的总超时(原实现 20 × 500ms = 10s,口径不变) */
const RENDER_TIMEOUT_MS = 10_000;

/**
 * 本模块的语义锚点名 —— 只此一个。
 *
 * ⭐ `AnchorName` 是**带 brand 的类型**,故意不让调用方随手传裸字符串:
 * 底座只认登记过的语义名,拼不出坏脚本(`dom/types.ts` 记的那次转义事故 ——
 * 采集恒 0 一整天而 tsc 与单测全绿)。这里断言一次,下面全程用这个常量。
 */
const TWEET_ARTICLE = 'tweetArticle' as AnchorName;

/**
 * ⭐ 锚点表:语义名 → selector。**站点知识归 adapter**,底座只认名字。
 *
 * ⚠️ 走 `registerAnchorTable` 把表**推**给底座,而不是让底座 import 本模块 ——
 * 反过来就是分层倒置(`layering-direction.test.ts` 钉死的方向)。
 *
 * ⚠️ 解释不出来返回 **null 不返回空串**:空 selector 会让「锚点名打错了」
 * 表现成「查了个空、什么都没找到」,两者排查方向完全相反。
 */
let anchorsRegistered = false;
function ensureAnchorTable(): void {
  if (anchorsRegistered) return;
  anchorsRegistered = true;
  /**
   * ⚠️ `AnchorResolver` 接口只要求 `resolve`;`names()` 是**可选附加** ——
   * `listAnchorNames()`(控制台下拉用)靠 duck-typing 探它,没有就跳过。
   * 故用一个带 names 的对象字面量,再以 AnchorResolver 传入。
   */
  const table = {
    resolve: (anchor: string): string | null =>
      anchor === TWEET_ARTICLE ? 'article[data-testid="tweet"]' : null,
    names: (): string[] => [TWEET_ARTICLE],
  };
  registerAnchorTable('tweet-fetcher', table);
}

/**
 * 抓取推文元数据
 *
 * @param tweetUrl 完整 https://twitter.com/.../status/<id> 或 https://x.com/.../status/<id>
 * @returns success:true + data 或 success:false + error
 */
export async function fetchTweetData(tweetUrl: string): Promise<TweetFetchResult> {
  ensureAnchorTable();
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

    /**
     * ⭐ 把这个隐藏窗口登记成底座认识的一个「页面」。
     *
     * ⚠️ `register` 与 `bindPageHost` **必须成对** —— 只登记不绑定的话,
     * 引擎拿不到 wc,会回一个诚实但误导的 Failed「没有对应的渲染目标(已关闭?)」,
     * 看起来像页面关了,实际是没接线(见 page-hosts.ts 的告诫)。
     *
     * ⚠️ partition **必填且不猜**:本窗口刻意用默认会话(与内置浏览器的
     * `persist:webview-*` 隔离)—— 抓公开推文不需要登录态,也不该碰用户的。
     */
    const facts = pageRegistry.register({
      window: 'tweet-fetcher',
      ws: 'tweet-fetcher',
      slot: 'right',
      partition: '',
      owner: 'tweet-fetcher',
      service: 'x',
      url: tweetUrl,
      state: 'loading',
    });
    bindPageHost(facts.pageId, win.webContents);

    /**
     * 导航 + 等推文渲染,两步都交给底座。
     *
     * ⚠️ 用 `kind:'url'` 而不是语义页面名 —— 按 `control-types` 的规矩,
     * `kind:'url'` **只许 adapter 自己用**,而本模块正是 adapter:
     * 它拿到的是一个具体推文 URL,没有「语义页面」可言。
     * 也因此没有页面表给到位判据,故 `goto` 之后**显式** `ready`。
     */
    const landed = await controlEngine.goto(facts.pageId, { kind: 'url', url: tweetUrl });
    if (landed.status === 'failed') {
      return { success: false, error: landed.reason };
    }
    // ⚠️ `degraded` 不当失败也不当成功:导航到了但有缺失(如站点接管了导航),
    // 推文可能仍会渲染 —— 交给下面的 `ready` 用事实判定,别在这里替它决定。

    if (win.isDestroyed()) {
      return { success: false, error: 'BrowserWindow destroyed during navigation' };
    }

    /**
     * ⭐ 等推文 article 出现 —— 换掉原来手写的 20 × 500ms 轮询。
     * `ready` 会把「页面正在导航时注入必抛」记下来继续等,
     * 超时时如实带出最后一次异常(手写版把它当成"没渲染好"白等了一轮)。
     */
    const rendered = await controlEngine.ready(
      facts.pageId,
      { kind: 'anchorAppears', anchor: TWEET_ARTICLE },
      RENDER_TIMEOUT_MS,
    );
    if (rendered.status === 'failed') {
      return { success: false, error: rendered.reason };
    }

    // 执行 DOM 提取(⭐ 站点知识,归 adapter —— 底座不碰)
    const data = (await win.webContents.executeJavaScript(EXTRACT_TWEET_JS)) as TweetFetchData;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: String(err) };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}
