# ⚠️ X 去掉了 `data-testid` —— tweet-block 抓不到数据（记账，未修）

> 2026-09-30 真机探针实测。**改之前就是坏的**，与 L2 收口无关。
> 用户已同意：先记账，继续底座收口，不打断。

## 实测证据（Electron BrowserWindow 真机跑，不是推断）

```
loadURL reject: (无)
落地 URL     : https://x.com/elonmusk/status/1519480761749016577
 1s article=false  <article>数=4  正文长=823 | Elon Musk @elonmusk Next I'm buying Coca-Cola...
15s article=false  <article>数=4  正文长=857 | （15 秒内一直如此）
```

再查一层：

```
全页 [data-testid] 元素数: 0        ⭐ 整页一个都没有
是登录墙吗            : false       不是要登录
第一个 article 的属性  : ["class"]   只剩 class
第一个 article 的文本  : Elon Musk @elonmusk Next I'm buying Coca-Cola... 8:56 PM · Apr 27
```

## ⭐ 结论

**页面加载完全正常，推文内容全在** —— 作者、handle、正文、时间戳都在 `<article>` 里。
X 只是把**未登录视图的 `data-testid` 全部去掉了**，所有钩子没了。

## ⚠️ 这不是 L2 收口造成的

旧版判据一模一样：`document.querySelector('article[data-testid="tweet"]') !== null`。
区别只在报错话术：

| | 报什么 |
|---|---|
| 旧版 | `Tweet page did not render in time` ← ⚠️ 把「X 改版」说成「页面没渲染好」 |
| 新版 | `等待判据 anchorAppears(tweetArticle) 超时(10000ms)` + 最后一次注入异常 |

⭐ 这恰好是 L2 收口想治的病:**旧话术把人指向完全错误的方向**（去查网络/超时），
而真因是站点改版。

⚠️ 同时印证 `feedback-search-community-before-sixth-guess`：
**平台侧改动不可能从自家代码推断出来**。我一开始怀疑自己的 `urlIncludes` 判据和
超时设置 —— 全错，探针一次说清。**卡住就去真机看，别在自己代码里绕。**

## 影响面：光改判据没用

`article[data-testid="tweet"]` 全仓 3 处（另一处是注释举例）：

| 位置 | 用途 | 修了才有用？ |
|---|---|---|
| `tweet-fetcher/fetcher.ts:97` | 锚点表（等元素出现） | 必须改 |
| `tweet-fetcher/extract-script.ts:287` | **提取脚本本体** | ⭐ **必须一起改**，否则等到了也抓不到 |
| `shared/types/x-service-types.ts:236` | X 模块 selector 表 | X 已删，是遗留 |

## 将来怎么修（未开工）

⭐ 改成**不依赖 `data-testid`** 的定位：`<article>` + 结构/语义特征
（探针实测：第一个 `<article>` 的 innerText 就是完整推文，含作者/handle/正文/时间）。

⚠️ 两处必须**同一批**改并真机验，否则会出现「等到了但抓不到」的半好状态。

⚠️ 也要先问一句**要不要修**：`tweet-fetcher` 头注释自述是
「临时 capability 实现（用户红线"避免临时能力长期化"）」，只服务 tweet-block 一个消费者。

## 判据（将来验收用）

note 里 `/` → 「X Post」→ 粘推文链接 → 点「Fetch」→
卡片填出**作者名 / @handle / 正文**。失败时看 DevTools Console 的
`[tweetBlock] fetch failed:` 那一行。
