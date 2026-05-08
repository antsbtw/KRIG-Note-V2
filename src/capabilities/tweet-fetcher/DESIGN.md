# tweet-fetcher capability ⚠️ 临时

> ⚠️ ⚠️ ⚠️ **临时 capability** ⚠️ ⚠️ ⚠️
>
> - **仅服务 tweet-block 一个消费者**(NodeView Fetch 按钮)
> - **不接受新功能扩展**(任何"顺手加点别的 scraping"必须走 Phase D browser-capability 通道,
>   而非在本 capability 上加 method)
> - **Phase D browser-capability 正式化后**,本 capability 被吸收为 DOM scraping 子能力
>
> 用户红线:**避免临时能力长期化**(L5-B3.18 设计 v0.2 拍板)。

## 定位

Tweet 元数据抓取能力。基于隐藏 BrowserWindow + DOM scraping 实现。

view install 路径:`install: ['tweet-fetcher']`(W5 严格态:view 走 requireCapabilityApi 间接路由)。

## 对外面孔

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TweetFetcherApi } from '@capabilities/tweet-fetcher/types';

const tweetFetcher = requireCapabilityApi<TweetFetcherApi>('tweet-fetcher');

const result = await tweetFetcher.fetchTweetData(
  'https://twitter.com/user/status/1234567890',
);
if (result.success && result.data) {
  console.log(result.data.authorName, result.data.text);
} else {
  console.warn('fetch failed:', result.error);
}
```

## 装配关系

```
view/driver (tweet-block NodeView Fetch 按钮)
  ↓ requireCapabilityApi<TweetFetcherApi>('tweet-fetcher')
  ↓ 或 driver 模块级 import @capabilities/tweet-fetcher(W5-A 允许)
capability.tweet-fetcher (本目录)
  ↓ 调 window.electronAPI.fetchTweetData (preload contextBridge)
  ↓ IPC TWEET_FETCH_DATA
main/tweet-fetcher/handlers.ts (URL 域防呆 — 仅 https://twitter.com|x.com)
  ↓ 调
main/tweet-fetcher/fetcher.ts (BrowserWindow + loadURL + 轮询渲染 + executeJavaScript)
main/tweet-fetcher/extract-script.ts (EXTRACT_TWEET_JS — DOM scraping 注入脚本)
```

## W5 严格态 A 边界

- View 侧(强制):走 `requireCapabilityApi('tweet-fetcher')` 间接路由
- Driver/slot 侧(允许):可直 import `@capabilities/tweet-fetcher`(模块级 export)
  作为临时允许项,跟现有 capability 一致(对齐 audit 2026-05-08 § 5.2)

## 安全约束

- **URL 域白名单**(main/handlers.ts):仅 `https://twitter.com` / `https://x.com` 域
  (含 www.)— 防 file:// / about: / 自定义协议越权
- BrowserWindow 安全配置:`nodeIntegration: false` + `contextIsolation: true`
- finally 兜底 destroy BrowserWindow,无内存泄漏

## 失败模式

- 网络断 / Twitter 反爬 → success:false + error('Failed to load URL...')
- SPA 没渲染好(轮询 10 秒超时)→ success:false + 'Tweet page did not render in time'
- Twitter 改 data-testid 选择器 → 字段缺失但 success:true(部分降级)
- BrowserWindow 创建失败(打包 / 沙盒)→ success:false + error

任一情况都不影响 NodeView 主流程(Browse Tab iframe 仍能用)。

## 跟踪 Phase D 吸收

| 时机 | 动作 |
|---|---|
| 本 capability 创建(L5-B3.18)| ⚠️ banner + DESIGN.md 临时标识 + 不扩展约束 |
| L5-B3.18 完工后 | 单独 audit 检查临时性是否被破坏 |
| Phase D browser-capability 设计 | 把本 capability 列为"被吸收对象"  |
| Phase D 落地 | 1) 在 browser-capability 内实现 DOM scraping 子能力;
                2) tweet-fetcher capability id 改 alias 或直接 deprecate;
                3) tweet-block 切到 browser-capability 消费;
                4) 删 src/platform/main/tweet-fetcher / src/capabilities/tweet-fetcher 整目录 |

## 不允许扩展的项目(明确登记)

以下任何需求**禁止**在本 capability 加 method:
- ❌ Twitter 用户主页抓取(整个 timeline)
- ❌ Twitter 搜索结果抓取
- ❌ 其他社交平台 scraping(Mastodon / Bluesky / 等)
- ❌ 通用 DOM scraping 框架
- ❌ 视频/图片下载(走 ytdlp / mediaStore)

以上需求一律走 Phase D browser-capability 通道。本 capability 维持 1 个 method 直到被吸收。

## npm 依赖

无外部 npm 依赖(用 Electron 内置 BrowserWindow + executeJavaScript)。
