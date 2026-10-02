# Web 能力层：**获取网页内容的方法必须齐备**

> 用户 2026-10-02：
> 「我们的 web 能力层应该具备**所有获取网页内容的能力**才对，如果没有，就构建它，
> 　这样未来获取各个社区、论坛、开放媒体的内容都是可以的。」
>
> 以及前一句（本文的直接起因）：
> 「这就是你在整个几次构建中存在最大的问题，要**充分利用几种方法**获取数据，
> 　而不是单独依赖 CDP。」

---

## 〇、这不是 X 的问题，是能力层的定位问题

⚠️ 我重建 X 时只建了**一条腿**（CDP `getResponseBody`），而记忆
`project-x-collect-two-legs` 早就记着「采集有**载荷 + DOM 两条腿**，
载荷断了 DOM 会顶着」—— 重建时丢了。

⭐ 判据不是「X 能不能采」，而是：
**换一个社区/论坛/开放媒体，这层能不能直接用？**

---

## 一、⭐ 2026-10-02 实测定论（先说结论，免得下一个人重走）

| 验证的事 | 结论 | 证据 |
|---|---|---|
| CDP 能不能看见 X 的 GraphQL | ✅ **能** | `diag-cdp-graphql: POST HomeTimeline type=xhr` |
| webRequest 能不能看见 | ✅ **能** | `diag-webrequest-graphql: op=HomeTimeline method=POST` |
| 「CDP 拦不到流式响应」 | ⚠️ **不准确** | 拦不到的是 `getResponseBody`；`Network.dataReceived` 能拿分块 |
| 之前为什么一条都没捕到 | ⭐ **竞态** | `capture-start` 与 `page-created` 同一秒，而 `HomeTimeline` 早已发完 |

⭐ 所以 CDP 这条腿**本身是好的**，问题在「什么时候装上」。
✅ 已加「捕获中重载」解竞态。

⚠️ **但这不构成「不需要第二条腿」的理由** —— 单点依赖本身就是缺陷：
一条腿断了没有对照，就无法区分「站点没发」和「我们没收到」。
这次排查花了七轮，根因正是**没有第二个视角可以互证**。

---

## 二、获取方法全景（搜社区得到，不是自己琢磨）

### M1　CDP Network（`getResponseBody`）── ✅ 已有

`net/body-provider.ts`。

- **能拿**：完整响应体
- **拿不到**：WebSocket / SSE / Stream 响应（社区确认）
- **代价**：要 attach debugger，与 DevTools 争用通道

### M2　CDP Network（`dataReceived` 流式分块）── ❌ 缺

- **能拿**：分块到达的数据，**不管走 fetch / WebSocket / chunked**
- **为什么要**：M1 拿不到的那一类，正好由它补
- **代价**：要自己拼装分块，且只有部分事件带 body

### M3　webRequest 元数据 ── ✅ 已有

`wiring/webrequest-side.ts`。

- **能拿**：URL / method / 请求头 / 状态码 / 时间
- **拿不到**：**响应体**（Electron 的 webRequest 不给）
- **⭐ 真正价值**：与 M1 关联配对（CDP 与 webRequest 是两套编号），
  以及**作为对照视角** —— 这次正是靠它证明「CDP 没漏」

### M4　⭐⭐ 页面内 XHR / fetch 钩子 ── ❌ 缺（业界公认最可靠）

在页面上下文覆写 `XMLHttpRequest.prototype.open/send` 与 `window.fetch`，
在**响应回到站点自己代码之前**截一份。

- **能拿**：**一切**走 XHR/fetch 的响应，含流式（在 reader 上分叉）
- **⭐ 为什么最可靠**：请求在页面里发出，我们在页面里接 ——
  不经过任何浏览器层的拦截机制，没有通道争用、没有编号配对、没有竞态
- **代价**：
  - 必须在**站点脚本之前**注入（`document_start` 语义），晚了就钩不住
  - 站点改版/反爬可能检测原型被改（X 目前不检测）
  - 注入的脚本要走 `script-registry` 预注册，不许拼串
    （`project-x-inject-template-escape` 的教训）

### M5　静态抓取（无浏览器 HTTP）── ❌ 缺

直接 HTTP 请求 + 解析 HTML/JSON/RSS。

- **能拿**：论坛/博客/RSS/开放 API 这类**不需要登录态和 JS 渲染**的内容
- **⭐ 为什么要**：大多数社区论坛属于这一类，**开浏览器是浪费**
  （一个 webview 几百 MB，而一次 HTTP 请求几 KB）
- **代价**：拿不到 JS 渲染后的内容；要自己处理编码/重定向/限流

### M6　DOM 读取 ── ⚠️ 声明了但**全仓零实现**

`dom/web-dom.ts` 声明了 `read` / `query` / `text` / `selection`，
但 **`grep "implements WebDom"` 零命中**，只有 `run` 真落地了。

- **⭐ 为什么非补不可**：它是**载荷断了之后的兜底**
  （`project-x-collect-two-legs`：「载荷断了 DOM 会顶着」）
- ⚠️ 现在的状态是**最坏的**：接口上有、调了必然失败，
  而失败原因是「底座没实现」不是调用方的错，**排查方向完全被带偏**

### M7　Service Worker 注入 ── ❌ 缺（优先级最低）

- **能拿**：请求级拦截，连 `navigator.sendBeacon` 都能接
- **代价**：要改 CSP、要注册 SW，侵入性最强
- ⚠️ 除非 M4 被站点封掉，否则不值得

---

## 三、⭐ 实施优先级（按「缺了会怎样」排，不按难度）

| 序 | 方法 | 理由 |
|---|---|---|
| **1** | **M4 页面内钩子** | 唯一能提供**独立第二视角**的方法；这次七轮排查的根因就是没有它 |
| **2** | **M6 DOM 读取** | 已声明零实现，**空头承诺比没有更坏**；且它是载荷断了的兜底 |
| 3 | M5 静态抓取 | 论坛/RSS 的主路径，与浏览器那条完全独立 |
| 4 | M2 CDP 流式 | 补 M1 的盲区；但 M4 落地后重要性下降 |
| 5 | M7 Service Worker | 只在 M4 被封时才需要 |

---

## 四、⚠️ 设计约束（从已有教训来，不可商量）

1. **方法之间必须能互相印证**，不是「择一使用」
   —— 这次正是靠 M1/M3 双诊断才排除了「CDP 漏了」这个猜想。
   ⭐ 新方法接入时，第一件事是让它能**与现有方法对照**。

2. **每条腿各自留痕，不合并计数**
   —— `CaptureSession` 的三态（captured / noBody / bodyLost）是范例：
   合成一个数就分不清成因。

3. **注入脚本一律走 `script-registry` 预注册，参数靠 `JSON.stringify` 绑定**
   —— `project-x-inject-template-escape`：拼串被求值吃掉，
   采集恒 0 而 tsc/单测全绿。

4. **底座不认识任何站点**
   —— X 的页面表/选择器在 `modules/x/`，能力层只提供机制。
   社区论坛接入时写自己的表，一行底座代码都不该改。

5. **声明了就必须实现，否则删掉**
   —— M6 那种「接口有、零实现」是本仓反复出现的形态
   （`recordRequestStart` 零调用、`ready`/`scrollUntil` 掉出公开面、
   `wireWebRequestSide` 零调用、`registerPageIdLookup` 零调用）。

---

## 五、下一步

⭐ 先做 **M4（页面内 XHR/fetch 钩子）** —— 它同时满足两件事：
给 X 一条独立的腿，也给未来的社区论坛一条通用的腿。

⚠️ 做之前先把**临时诊断删掉**（`diag-request` / `diag-cdp-graphql` /
`diag-webrequest-graphql` / `pageid-lookup-miss`）——
它们已经完成使命，留着会刷屏。
