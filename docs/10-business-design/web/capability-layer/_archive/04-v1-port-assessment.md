# 04 · V1 Browser Capability 移植评估

> 属于 **Web 能力层**(`01-web-capability-contract.md` 是总纲)。

> 立于 2026-09-07。用户拍板:按四层抽象重构(对应 `web.page` / `web.net` / `web.dom` / `web.input`),并指路 V1 代码在
> `/Volumes/Document/VPN-Server/KRIG-Note`。
>
> 本文是**读完 V1 全部 Core/Network/Persistence 实现(约 3500 行)后**的移植清单:
> 哪些直接搬 / 哪些要改 / 哪些是 V1 特有包袱 / 哪些得从零写。
>
> **不含实现。**

---

## 0. 一句话结论

**L0/L1 是「搬」,质量很高、几乎零污染;L2/L4 是「写」,V1 那边是空的。**

这改变了工作量分布:四层里只有一半能靠移植,另一半要新建。
但新建的那一半,V2 的 `web-service-base` 已经垫了底。

---

## 1. V1 实际有什么(实测,7623 行)

| 层 | V1 状态 | 行数 | 对本次的意义 |
|---|---|---|---|
| **L0 Core** | ✅ 真实现 | 343 | **直接搬** |
| **L1 Network** | ✅ 真实现 | 1029 | **直接搬**(核心) |
| L6 Persistence | ✅ 真实现 | 2103 | 选搬(见 §4) |
| Artifact(站点适配) | ✅ 真实现 | 2959 | 不搬(是 adapter,非底座) |
| main-service(装配) | ✅ 真实现 | 751 | 参考,不直搬(见 §5) |
| **L2 Runtime** | ❌ **7 行空壳** | 7 | **从零写** |
| **L3 Render** | ❌ 7 行空壳 | 7 | 本次不做 |
| **L4 Interaction** | ❌ **7 行空壳** | 7 | **从零写**(但 V2 已有一半) |

三个空壳文件的原文都是:

```ts
/** ... abstractions live here.
 *  Concrete implementations are intentionally deferred. */
export {};
```

> ⚠️ 所以 `README.md` 说 Phase 0-5「已完成」,准确说是
> **L0/L1/L6 完成,L2/L3/L4 从未动工**。这和 `Defuddle 对比分析.md` §3.2
> 自己列的「已设计未实现:L2 Runtime / L3 Render / L4 Interaction 全是 stub」**一致** ——
> 是 README 的汇总口径太宽。

---

## 2. ⭐ 关键收获:V1 的 CDP 方案比我上一轮的设计好

`03-three-capabilities-design.md` 里设计的是**引用计数**(最后一个订阅者走才 detach)。
V1 用的是**单一持有者 + 只订阅**,更稳:

```ts
// response-body-provider.ts:78
attach(webContents, bus) {
  if (attachedWebContents.has(webContents.id)) return;  // 每 wc 只装一次
  attachedWebContents.add(webContents.id);
  if (!dbg.isAttached()) dbg.attach('1.3');             // 已被别人装了就复用
  ...
  dbg.on('detach', onDetach);                           // 被抢占 → 收得到
  webContents.once('destroyed', () => { ... });         // 只在页面销毁时清理
}
```

**为什么这比引用计数强**:

| | 引用计数(我的设计) | 单一持有者(V1) |
|---|---|---|
| 「最后一个走关灯」时刻 | 存在 → 可能关错 | **不存在** |
| 业务方碰不碰 debugger | 碰(attach/detach) | **完全不碰,只 subscribe** |
| 被外部抢占 | 要额外检测 | `dbg.on('detach')` 天然收到 |

X 现在那 8 处「A 结束时 detach,把共用的 B 掐掉」的问题,
**在这个模型下根本不可能发生** —— 因为业务方压根没有 detach 这个动作。

> **决定:废弃 `03-three-capabilities-design.md` §2 的引用计数设计,采用 V1 方案。**

### 2.1 但 V1 也留了一个坑

`attach()` 失败时只 `console.warn` 就 `return`,**订阅者不会收到任何通知** ——
它们会安静地等一个永远不来的载荷。这正是本仓铁律「不要静默兜底」要禁的形态。

**移植时必须改**:attach 失败 → 该页面的订阅者收到明确错误(fail loud)。

---

## 3. 污染度实测:L0/L1 干净,L6/main-service 不干净

按设计文档决策 4(站点适配不进底层),逐文件数站点特化关键词
(`claude|chatgpt|gemini|anthropic`):

| 文件 | 命中数 | 判断 |
|---|---|---|
| `types/browser-state.ts` | **0** | 🟢 纯净 |
| `types/network-types.ts` | **0** | 🟢 纯净 |
| `core/page-registry.ts` | **0** | 🟢 纯净 |
| `core/lease-manager.ts` | **0** | 🟢 纯净 |
| `network/network-event-bus.ts` | **0** | 🟢 纯净 |
| `network/session-capture.ts` | 1 | 🟡 一处噪音名单 |
| `main-service.ts` | **48** | 🔴 装配层,站点特化重 |
| `persistence/trace-writer.ts` | **61** | 🔴 站点特化重 |

> **这是本次评估最好的消息**:L0/L1 的核心 5 个文件**站点特化为 0**,
> 说明 V1 真的守住了「通用网页对象先于站点对象」这条原则。**可以直接搬。**

### 3.1 那 1 处污染要处理

`session-capture.ts` 和 `response-body-provider.ts` 各有一份硬编码噪音名单:

```
'google-analytics.com', 'play.google.com/log', '/gen_204?',
'api-iam.intercom.io/messenger/web/ping', 'connect.facebook.net',
's-cdn.anthropic.com/images/',   ← 明显为 Claude 页面调的
```

**移植处理**:提成可配置项。底层只保留通用规则
(`NOISY_RESOURCE_TYPES = font/image/ping` 这类按 resourceType 过滤),
站点相关的噪音名单由 adapter 注入。

---

## 4. 逐块移植判定

### 4.1 直接搬(改动极小)

| V1 文件 | 行数 | 处理 |
|---|---|---|
| `types/browser-state.ts` | 64 | 直搬 |
| `types/network-types.ts` | 56 | 直搬 |
| `types/core-types.ts` | 41 | 直搬 |
| `core/page-registry.ts` | 180 | 直搬 |
| `core/lease-manager.ts` | 84 | 直搬 |
| `core/lifecycle-monitor.ts` | 29 | 直搬 |
| `core/state-service.ts` | 37 | 直搬 |
| `network/network-event-bus.ts` | **460** | 直搬(核心) |

**小计约 950 行**,这是 L0+L1 的骨架。

`network-event-bus.ts` 值得单独说 —— 它解决了一个我没想到的难题:
**webRequest 的 requestId 和 CDP 的 requestId 是两套编号**。
它用 `findCanonicalRequestId`(URL + method + resourceType + 10s 内时间就近)
把两者配对,并做了 `xhr→fetch`、`mainframe/subframe→document` 的类型归一。
这是实打实踩出来的经验,自己写必然重踩。

### 4.2 搬但要改

| V1 文件 | 行数 | 要改什么 |
|---|---|---|
| `network/session-capture.ts` | 341 | 噪音名单外置;`will-download` 接 V2 的 media store |
| `network/response-body-provider.ts` | 228 | ⭐ attach 失败要 fail loud(§2.1);噪音名单外置 |

### 4.3 选搬:L6 Persistence

`trace-writer.ts` **2103 行,站点特化 61 处** —— 不能直搬。

但它承载的能力是设计文档 §3.4 要的「数据可回溯到哪一层」,
而且和本仓可靠性纲领(留痕/对账)同源。

**建议**:只搬**通用骨架**(`writeLifecycle` / `writeNetwork` /
`writeResponseBody` / trace 目录结构),**站点特化部分全部不搬**
(`getConversationRaw` / `getConversationKind` 这类是 adapter 的事)。
估计能砍到 300-400 行。

### 4.4 不搬

| V1 | 为什么 |
|---|---|
| `artifact/*`(2959 行) | 是 Claude/ChatGPT/Gemini 的 adapter,不是底座。V2 已有对应的 `ai/extractors/`(且注释标明就是从这搬的) |
| `main-service.ts`(751 行) | 装配层,48 处站点特化;V2 的装配环境(多 window / per-ws partition / slot)与 V1 完全不同,照搬会带错模型 |
| L3 Render | 本次不做 |

---

## 5. ⚠️ 移植的最大风险:V1 的 pageId 模型对不上 V2

V1 的 `bindWebContentsPage(webContents, input) → pageId`
假设的是「一个 webContents 一个页面」。

**V2 的现实复杂得多**(见记忆 `project-ws-instance-isolation-invariant`、
`project-host-broadcast-multi-ws-fanout`):

- 多 window × 多 workspace × 左右双 slot
- per-ws partition(`persist:webview-${ws}`)
- 同一 ws 可能同时有 AI / X / Mail 三个 webview
- 广播扇出问题:一个事件被 N 个实例各消费一次

**所以 `pageId` 怎么定义,是移植的第一个设计决策**,不能照抄 V1。

候选:`pageId = ${windowId}:${wsId}:${slot}:${serviceId}`,
但需要对照 V2 现有的 `x-host-registry` / `webview-registry-base` 的既有模型再定。

> 这一条我建议**作为移植的第一个待办单独处理**,因为 L0 的 page-registry
> 和 L1 的 `resolvePageId` 全都依赖它。定错了后面全歪。

---

## 6. L2 / L4:从零写,但不是从零开始

### 6.1 L4 Interaction — V2 已有一半

V1 是空的,但 V2 的 `web-service-base` 已有成品:

| 需求 | V2 现状 |
|---|---|
| `type()` 填文本 | ✅ `pasteTextToWebview`(**含落地校验 + 兜底**) |
| 喂文件 | ✅ `feedFilesToInput` / `feedVideoToInput`(**含落地确认**) |
| `click()` | 🟡 `locateSendButton` 只定位不点(红线) |
| `waitFor()` | 🔴 两份不等价实现,要统一 |
| `scroll` / `hover` / `press` | 🔴 无 |

**所以 L4 = 收编 `web-service-base` 现有的 + 补齐缺的 + 红线三道闸。**

### 6.2 L2 Runtime — 真的要从零

`eval` / `query` / `getText` / `getHTML` / `getSelection` / `locateSections`
V1 V2 都没有通用实现,只有 46+ 处散落的裸 `executeJavaScript`。

**这是消除注入重复的落点**,也是转义事故(`project-x-inject-template-escape`)
的根治处 —— 脚本预注册 + 参数分离。

---

## 7. 修正后的实施顺序

| 步 | 内容 | 性质 | 依赖 |
|---|---|---|---|
| **0** | **定 `pageId` 模型**(对齐 V2 多窗口/多 ws/双 slot) | 设计 | 无 |
| **1** | 搬 L0(types + core,约 640 行) | 移植 | 步 0 |
| **2** | 搬 L1(event-bus + session-capture + body-provider,约 1030 行);**attach 失败改 fail loud** | 移植+改 | 步 1 |
| **3** | 接第一个消费者验证 | 验证 | 步 2 |
| **4** | 写 L2 Runtime(收 46+ 处注入) | 新建 | 步 2 |
| **5** | L4 收编 `web-service-base` + 补齐 + 红线三道闸 | 新建+收编 | 步 4 |
| **6** | 选搬 L6 trace 骨架 | 移植+砍 | 步 2 |

### 7.1 步 3 用谁验证?

我建议 **AI 对话**,而不是 X。理由:

- AI 是**已经走网络层**的消费者(`ai/interceptor.ts` hook fetch / CDP),
  接 L1 是**同层替换**,风险最低
- X 主采集现在走 DOM(第 4 层),接 L1 是**换层**,同时改了两件事,
  出问题分不清是移植的锅还是换层的锅
- 设计文档 §9.1:AI 页面是**验证样本**,正合适

X 排在 AI 之后接 —— 那时 L1 已被验证过,X 换层才是单一变量。

> ⚠️ 这一条与我上一轮说的「先接 X」不同。读完 V1 代码后我改了主意:
> AI 接 L1 是同层替换,X 接 L1 是换层,**先做风险低的那个**。

---

## 8. 已定

| # | 决定 | 落在哪 |
|---|---|---|
| 1 | ✅ **身份模型**:不透明 `pageId` + 位置进 `PageFacts`;**页面对象化** | `06` §1(初版拼维度方案已证否) |
| 2 | ✅ **步 3 用 AI 验证**(同层替换,风险低),X 排其后(换层) | 本文 §7.1 |
| 3 | ✅ **trace 纳入,且提前到步 2.5** 与 `web.net` 同期 | `05` §5 / §7 |
| 4 | ✅ 命名 `web.page` / `web.net` / `web.dom` / `web.input` / `web.trace` | `06` §8.3 |

**本文无待确认项。**

> ⚠️ §5 那段「V1 的 pageId 模型对不上 V2」仍然成立,但**结论已升级**:
> 不是「换一种拼法」,而是**身份根本不该由维度拼出**(见 `06` §8.1)。
> V1 的 `bindWebContentsPage`(一个 wc 一个 page)要重写,不能直搬;
> **core / network 核心约 950 行不受影响,仍可直搬。**
