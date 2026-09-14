# Web 能力层 · 历史(现状实测 / V1 移植 / 执行记录 / 推翻留档)

> 由原 02(现状实测)/ 04(V1 移植评估)/ 08(迁移策略与执行记录)合并而成。
> **规格看 `01-contract.md`,本篇只留「怎么走到今天的」。**
>
> ⚠️ 本篇的价值在于**错因**:被证否的方案和踩过的坑都留着,
> 防止后来者重走一遍。原始分篇存于 `_archive/`。

---

# 第一部分 · 现状实测(六套读取路径)


> 属于 **Web 能力层**(`01-contract.md` 是总纲)。

> 立于 2026-09-07。读完 `docs/10-business-design/web/browser-capability/` 全 14 篇(5116 行)后写。
> 用户命题:「把整个网页内容提取和交互做一个好的抽象,
> 为后面构建各种各样的专业网站的贴心服务能力。」
>
> **本文是分析,不含实现。**

---

## 0. 最重要的一条:设计已经存在,而且比我这几轮写的都好

`browser-capability/` 那批文档回答的正是本命题,且格局更大。核心论断:

> KRIG 需要的不是「提取网页内容」,而是「**掌控浏览器中的数据、交互、渲染与落库过程**」。

本重构前三轮(`../../x/refactor-01`、`../../x/refactor-02`、本目录当时的 03,现并入本篇)是在给 X **建专属基础层**。按这批文档的决策 6:

> 底层能力模型必须首先服务于**通用网页**,而不是首先服务于某几个个性化页面。

**我的方向是对的,但对象错了。** X 不该有专属基础层,X 应该是通用底座的一个消费者。

---

## 1. ⚠️ 先纠正一个会误导决策的事实

`README.md` 的状态表写着 Phase 0-5 基础设施「✅ 已完成」,
`Defuddle-vs-Browser-Capability-对比分析.md` §3.1 甚至列出了具体实现文件。

**逐个查证,这些文件在本仓一个都不存在:**

| 文档声称「已实现」 | 本仓实际 |
|---|---|
| `network/session-capture.ts` | ❌ |
| `network/network-event-bus.ts` | ❌ |
| `network/response-body-provider.ts` | ❌ |
| `core/page-registry.ts` | ❌ |
| `core/lease-manager.ts` | ❌ |
| `core/lifecycle-monitor.ts` | ❌ |
| `persistence/trace-writer.ts` | ❌ |
| `types/capability-interfaces.ts` | ❌ |

`find src -ipath "*browser*capab*"` → **空**。

全仓 9 处 `browser-capability` 引用**全是注释里的历史出处**,形如
「V1 `plugins/browser-capability/artifact/extract-turn.ts` 移植」。

> **结论:那个「已完成」是 V1 的完成状态,不是 V2 的。**
> V1 仓库不在本机(`~/Documents/VPN-Server/` 下只有 KRIG-Note-V2)。
> V2 只把几个**提取器**单独移植了过来,**底座本身从未搬迁**。
>
> ⚠️ 这条必须先说清楚,否则会照着「基础设施已完成」去排后续工作,
> 而实际上**地基是空的**。这正是 `feedback-dont-guess-look-at-real-data` 说的:
> 别信文档的自述,去看真实数据。

---

## 2. 现状:五套读取路径,各走各的

用户点名的四类(AI 对话 / 网页提取 / 网页翻译 / 音视频下载),加上 X,实测如下:

| 消费者 | 取内容的方式 | 抽象程度 | 代码位置 |
|---|---|---|---|
| **网页剪藏** | DOM 注入 Defuddle | 🟢 **有引擎注册表** | `content-extraction/engine.ts` |
| **AI 对话** | 注入 fetch hook(ChatGPT/Claude)+ CDP(Gemini) | 🟡 一个类里三家硬编码 | `ai/interceptor.ts` 368 行 |
| **X** | DOM 注入 ×46 + CDP ×8 | 🔴 全散着 | `x/` 13 文件 |
| **网页翻译** | webRequest 剥 CSP 头 + 注入 Google 脚本 | 🟡 单一用途,自成一路 | `ipc/web-translate-handler.ts` |
| **音视频下载** | 导出 cookies → 喂给外部 yt-dlp 二进制 | 🟡 不碰页面,另一条路 | `ytdlp/downloader.ts` |
| (推文 DOM) | DOM 注入 | ⚪ **自称临时,等着被吸收** | `tweet-fetcher/` |

### 2.1 ⚠️ 「四条技术路径」是**过时的结论**(2026-09-09 更正)

本节初稿(2026-09-07)沿用了 `data-acquisition-capability-survey.md` §2.1 的
**四条路径**说法。**后续实测发现是 8 种**,见 `01-contract.md` §12。

**当时漏掉的 4 种**:

| 漏的 | 是什么 | 谁在用 |
|---|---|---|
| **M2 注入 fetch/XHR hook** | ⭐ **SSE 属于这一类**(不是独立机制,是这条路拦到的一种流形态) | ChatGPT / Claude 提取 |
| **M5 页面内主动 fetch** | 带登录态调站点自己的 API | Claude(`/api/organizations/`)· Gemini |
| **M6 下载管线** | `will-download`,真实文件 bytes | web-download · 附件 |
| **M8 postMessage 桥** | iframe / widget 内部数据 | Claude artifact |

**错因**(值得记):
初稿把「X 的能力勘查文档」列的四条**当成了全仓的全集** ——
但那份文档回答的是「**X** 能拿到什么」,不是「**全仓**在用什么」。
ChatGPT/Claude 的注入 hook、下载管线、postMessage 桥都不在 X 的视野里,
于是被整体漏掉。

> ⚠️ 与 `feedback-check-sample-contains-phenomenon` 同源:
> **拿一个消费者的调研当全局结论。** 后来逐个 grep 全仓才补全成 8 种。

**当时的判断仍然成立的部分**:这四条(现 M4/M1/M7/M3)确实**各写各的、没人统一**,
且 CDP 那条「9 处各 attach」正是后来 `web.net` 要治的病灶。

### 2.2 唯一做对了的样板

[content-extraction/engine.ts](../../../../src/platform/main/content-extraction/engine.ts) 的 `ExtractionEngine` 注册表:

```
registerExtractionEngine / setActiveEngine / getActiveEngine
```

[capture.ts](../../../../src/platform/main/content-extraction/capture.ts) 的注释:

> 具体「webview → FullPageResult」在各 `*-engine.ts`(当前 defuddle-engine)。
> 换/加引擎只动 engine 注册,本文件零改动 —— **不把链路锁死在 Defuddle 一家**。

**这正是 browser-capability 设计想要的形状**(provider 可替换、顶层不绑实现),
只不过它只覆盖了「整页剪藏」一个场景,而且只走 DOM 一层。

---

## 3. 按设计文档的分层优先级重新审视现状

设计文档 §3.1 定的优先级:

```
1. 网络层      ← 正文优先走网络响应
2. 下载层      ← 附件优先走真实下载
3. Frame 层
4. DOM 层      ← 只做定位与结构辅助
5. 渲染截图层  ← fallback,不是主链
```

对照实测:

| 消费者 | 现在走第几层 | 应该走第几层 | 差距 |
|---|---|---|---|
| 网页剪藏 | **4 DOM** | 1 网络 → 4 DOM 辅助 | 正文靠 DOM,页面一改版就失效 |
| AI 对话 | 1 网络 ✅ | 1 网络 | 🟢 **方向对**(hook fetch / CDP) |
| X 主采集 | **4 DOM** | 1 网络 | X 自己的勘查文档已证明载荷字段远比 DOM 全 |
| X 通知/回复关系 | 1 网络 ✅ | 1 网络 | 🟢 方向对 |
| 音视频 | 2 下载 ✅ | 2 下载 | 🟢 方向对 |

> **两个最痛的消费者(网页剪藏、X 主采集)都卡在第 4 层。**
> 而它们恰好是「页面一改版就失效」抱怨最多的两个 —— 这不是巧合。
>
> X 的能力勘查文档 §2.4 早已实测:GraphQL 载荷 **1751 个字段路径**,
> 而 DOM 只能拿到十几个字段,且 `in_reply_to` 这类关键关系字段
> **DOM 层根本不渲染**。设计文档说「DOM 只做定位与结构辅助」,
> X 的实测数据是这条原则最有力的证据。

---

## 4. 回答用户的命题:还能不能进一步抽象?

**能,而且四类消费者的共性比看上去大得多。**

### 4.1 把四类拆成「能力格子」看

| | 定位页面 | 网络捕获 | DOM 读取 | 交互 | 下载 | 落库 |
|---|---|---|---|---|---|---|
| AI 对话 | ✅ | ✅ hook/CDP | ✅ 辅助 | ✅ 填问题 | — | ✅ Note |
| 网页剪藏 | ✅ | ❌ **该有没有** | ✅ 主 | — | ⚪ 图片 | ✅ Note |
| 网页翻译 | ✅ | ✅ **webRequest** | ✅ 注入 | — | — | — |
| 音视频 | ⚪ cookies | — | — | — | ✅ 主 | ✅ media |
| X | ✅ | ✅ CDP | ✅ 主 | ✅ 填推 | ⚪ 媒体 | ✅ 库 |

**没有一列是只有一家用的。** 每个格子至少两家,多数三家以上。
这是「可以抽象」的直接证据 —— 不是猜的,是数出来的。

### 4.2 现在的重复,具体是什么

| 重复的东西 | 重复次数 | 现状 |
|---|---|---|
| CDP attach/enable/getBody/detach | **9 处** | 逐字重复,冲突处理还不一致(疑似真 bug) |
| 「poll 等 selector 出现」 | ≥4 处 | 底座 2 份 + X 2 份,行为不等价 |
| 「导航并等就绪」 | **9 处** | 只有 1 处处理了「X 接管导航」 |
| 注入脚本的转义安全 | **46+ 处** | 血教训守卫只覆盖 1 处 |
| 「落地确认」 | 各自定义 | 底座做对了,X 各模块自觉 |

### 4.3 抽象之后,「专业网站贴心服务」意味着什么

用户的目标是**将来能给各种专业网站做贴心服务**。这要求的正是设计文档 §3.2:

> **站点适配是上层插件,不是底层能力。**

即:加一个新网站(比如某个学术库、某个电商、某个政务系统),
**不该再写一套 CDP + 一套导航 + 一套注入**,而应该只写一个 adapter,
回答「这个站的正文在哪个接口 / 哪个 selector」。

**现在加一个新站要抄多少东西?** 按上表:CDP 序列 1 套、导航 1 套、
等待 1 套、注入安全 1 套、落地确认 1 套 —— **五套,全是可复用的。**
这就是抽象的收益,也是不抽象的代价。

---

## 5. 建议的整合路线

### 5.1 定位:不是新建,是「把 V1 的底座补回来,并接上五个现有消费者」

设计文档已经给了完整的 L0-L6 分层、数据模型、接口草案。
**不需要重新设计,需要的是**:

1. 确认哪些还适用(V1 设计于 2026-04,V2 已有 `web-service-base`)
2. 按本仓真实消费者重排优先级
3. 一次接一个消费者,每接一个就删掉一份重复

### 5.2 与已有 `web-service-base` 的关系

`web-service-base/` 是 V2 自己长出来的,9 个导出,**全部落在写方向**
(定位 / 注册 / 右键 / 填字 / 喂文件)。按 browser-capability 分层:

| 现有底座 | 对应层 |
|---|---|
| `resolveWsWebContents` / registry | **L0** Session/Lifecycle |
| `buildHitTestScript` | **L2** Page Runtime |
| `pasteTextToWebview` / `feedFilesToInput` / `locateSendButton` | **L4** Interaction |

> **它不是竞品,是 L0+L2+L4 的一部分,而且质量不错。**
> 缺的是 **L1(网络捕获)**—— 全仓最大的重复源,和 **L3/L5/L6**。
>
> 所以整合方向明确:**保留并扩充 `web-service-base`,
> 先补 L1,不推倒重来。**

### 5.3 优先级建议(按「消除重复的收益」排)

| 序 | 做什么 | 收益 | 依据 |
|---|---|---|---|
| **1** | **L1 网络捕获底座**(含 body provider 抽象 + 事件总线 + 引用计数) | 一次消除 9 处 CDP 重复;修掉疑似 detach bug;X/AI 同时受益 | §4.2 最大重复源 |
| **2** | **L2 Runtime 收口**(统一 eval/query/waitFor,注入安全内建) | 消除 46+ 处裸注入;转义事故类型层面消灭 | 血教训 |
| **3** | **接 X**(X 是最痛的消费者,拿它验证最狠) | X 重构的基础层直接落在通用底座上 | 本轮起点 |
| **4** | **接网页剪藏**(把正文从 DOM 层提到网络层) | 剪藏抗改版能力质变 | §3 差距表 |
| **5** | L3/L5/L6(截图 / artifact / 落库) | 为「专业网站服务」铺路 | 设计文档 Phase 3 |

**为什么 L1 排第一**:它既是重复最多的(9 处),又是唯一一个
**能同时服务全部五个消费者**的,还顺带修掉一个疑似真 bug。

**为什么 X 排第三而不是第一**:X 是**验证样本**不是**架构中心**
(设计文档 §9.1 对 AI 页面的原话,同样适用于 X)。
先有通用能力,再拿 X 验证;反过来会让 X 的特殊性污染底层模型。

---

## 6. 需要用户拍板的

### 6.1 ⭐ 范围:X 重构 vs 网页能力底座

这是本轮最大的岔路:

| 选项 | 内容 | 代价 |
|---|---|---|
| **A. 先做底座** | 按 §5.3 从 L1 开始,X 作为第 3 步接入 | X 的痛要多等一阵;但只做一遍 |
| **B. X 先自救** | 按 `09-history.md` 建 X 专属基础层,底座另排期 | X 快;但违反决策 6,将来要二次重构 |
| **C. 折中** | L1 直接建在通用位置,但**只先接 X**,其余消费者后续接 | 兼顾;风险是「只接一家」容易被 X 特殊性带偏 |

我建议 **C**,理由:L1 放通用位置满足决策 6,先接一家控制风险,
且 X 恰好是**用量最大的样本**(M4 DOM 注入 13 模块 46 处 + M1 CDP 5 模块),能把接口压出来。
但要守住一条 —— **X 的特殊性只能进 adapter,不能进 L1 模型**。

### 6.2 V1 代码还能拿到吗?

设计文档说 V1 的 L0/L1 已实现且验证过。**如果 V1 仓库还能访问,
应该先去读那份实现** —— 比从零写省事,也省得重踩它踩过的坑。
本机 `~/Documents/VPN-Server/` 下没有,需要用户指路。

### 6.3 那批文档的状态标记要不要先更正?

`README.md` 和对比分析里的「✅ 已完成」在 V2 语境下是**误导**。
建议加一行说明(「以下状态属 V1,V2 未迁移」),
否则下一个接手的人会照着空地基排工期 —— 我这轮差点就这么干了。

---

## 7. 一句话

**现在是五套读取路径各自演化;设计文档早就说清了该怎么合;
差的不是设计,是「把 V1 的地基搬过来并接上」这件工程。**


---

# 第二部分 · V1 移植评估


> 属于 **Web 能力层**(`01-contract.md` 是总纲)。

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

`09-history.md` 里设计的是**引用计数**(最后一个订阅者走才 detach)。
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

> **决定:废弃 `09-history.md` §2 的引用计数设计,采用 V1 方案。**

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
| **5** | L4 收编 `web-service-base` + 补齐 + 🚦 闸门守卫 | 新建+收编 | 步 4 |
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
| 1 | ✅ **身份模型**:不透明 `pageId` + 位置进 `PageFacts`;**页面对象化** | `01-contract.md` §1(初版拼维度方案已证否) |
| 2 | ✅ **步 3 用 AI 验证**(同层替换,风险低),X 排其后(换层) | 本文 §7.1 |
| 3 | ✅ **trace 纳入,且提前到步 2.5** 与 `web.net` 同期 | `03-observability.md` §5 / §7 |
| 4 | ✅ 命名 `web.page` / `web.net` / `web.dom` / `web.input` / `web.trace` | 本篇第四部分 |

**本文无待确认项。**

> ⚠️ §5 那段「V1 的 pageId 模型对不上 V2」仍然成立,但**结论已升级**:
> 不是「换一种拼法」,而是**身份根本不该由维度拼出**(见 `01-contract.md` §8.1)。
> V1 的 `bindWebContentsPage`(一个 wc 一个 page)要重写,不能直搬;
> **core / network 核心约 950 行不受影响,仍可直搬。**


---

# 第三部分 · 迁移策略与执行记录


> 属于 **Web 能力层**(`01-contract.md` 是总纲)。
> 用户 2026-09-08 定:
> 「**新模块完成前,原来的代码先不动**,等测试通过,再逐个功能迁移 ——
>  比如先迁移 AI 工作模式,验收通过再迁移其他,这样逐个来。」
>
> 分工:**用户 = 决策者;本对话 = 总指挥(写 prompt + 验收);
> 新对话 = 执行者(写代码)。**

---

## 0. ⚠️ 开工前必须知道的两件事(2026-09-08 实测)

### 0.1 全仓基线不是全绿

```
npx vitest run          → 109 文件 / 1049 用例
                          7 文件失败 / 2 用例失败
npx vitest run tests/x/ → 40 文件 / 512 用例  全绿 ✅
```

**失败分两类,都与本次重构无关,但必须先立档,否则会被误当成「我改坏了」**:

| 失败 | 性质 | 处置 |
|---|---|---|
| 5 个文件加载失败(`scenario-6/7/9/11`、`create-notes-batch`、`parse-chrome-bookmarks`)<br>`TypeError: Cannot read properties of undefined (reading 'getPath')` | 测试环境缺 Electron `app` mock,**不是产品代码问题** | 存量问题,不在本次范围 |
| `slot-resource-guard` 2 条 | **行号漂移**:清单记 `SocialView.tsx:54` / `XInboxView.tsx:469`,实际已移到 `:55` / `:482` | 存量问题;⚠️ 但它证明**守卫是活的** |

> ⭐ 第二条恰恰说明本仓守卫**真的会红**(`feedback-verify-guard-can-fail` 要的就是这个)。
> 迁移中要沿用这个范式。

**基线口径(执行者必读)**:
- **`tests/x/` 512 条必须始终全绿** —— 这是硬红线
- 全仓那 7 个失败**开工前先截图存档**,收尾时逐条比对,**数量不许增加**

### 0.2 ⚠️ AI 提取链路没有守卫测试

实测:`grep -rln "interceptor|SSECapture|extract-turn|full-extraction" tests/` → **零命中**。

`ai/interceptor.ts`(368 行)、`ai/extractors/`(7 文件)**一条测试都没有**。

**这直接影响迁移顺序**:原计划「先迁 AI(同层替换,风险低)」——
风险低是对的(它本来就走网络层),**但没有安全网**。

> **对策(见 §3 步 0):迁移 AI 之前,先给现有 AI 提取补一层「行为快照」测试。**
> 不是为了测新代码,是为了**证明迁移前后行为一致**。
> 没有这个,「AI 验收通过」就只能靠人工点几下,不可回归。

---

## 1. 核心策略:双轨并行,只加不改

用户定的原则,展开成三条可执行的:

### 1.1 新层独立建,旧代码一行不动

```
新:  src/platform/main/web-capability/     ← 新建,谁也不依赖它
旧:  src/platform/main/x/  ai/  ...        ← 一行不改,照常跑
```

**判据**:新层建完时,`git diff` 应该**只有新增文件**,零处修改。
此时 app 行为与开工前**完全一致**(因为没人调用新层)。

### 1.2 迁移 = 换调用方,不是搬代码

一个消费者的迁移,只做一件事:**把它的调用从旧路径改到新层**。

```
迁移前: ai/interceptor.ts 自己 attach CDP
迁移后: ai/interceptor.ts 改调 web.net.subscribe(...)
```

**旧实现留在原地不删** —— 直到该消费者验收通过、观察一段时间后才清理。

### 1.3 逐个消费者,一次一个

```
AI → (验收) → X → (验收) → 剪藏 → (验收) → 翻译 / 邮件
```

**每个之间必须有验收关口**,不许并行推进两个。

---

## 2. 为什么是这个顺序

| 序 | 消费者 | 为什么 | 风险 |
|---|---|---|---|
| 1 | **AI 对话** | **同层替换**(它本来就走网络层),单一变量 | ⚠️ 无守卫 → 先补(步 0) |
| 2 | **X** | 用量最大(M4 ×46 处 + M1 ×5 模块);**有 512 条守卫兜底** | 换层(DOM→网络)= 两个变量,故排在 AI 后 |
| 3 | **网页剪藏** | 从 DOM 提到网络层,收益大 | 正文质量要人读着对 |
| 4 | 翻译 / 邮件 | 用量小,`prepare` 的验证 | 低 |

> ⭐ **X 排第二不是第一**,尽管它最痛。
> 因为 X 的迁移同时改两件事(接新层 + 换数据层),
> 出问题分不清是移植的锅还是换层的锅。
> **先让 AI 把新层跑通,X 再上,变量才单一。**

---

## 3. 分步计划(每步一个 prompt,给一个新对话)

| 步 | 交给谁 | 做什么 | 验收关口 |
|---|---|---|---|
| **0** | 执行者 A | ⭐ **给现有 AI 提取补行为快照测试**(不改产品代码) | 新测试全绿;`tests/x/` 512 仍全绿 |
| **1** | 执行者 B | 建 `web.page`(V1 types+core 移植,身份按 `01-contract.md` 重写) | 契约测试 + 页面清单面板 |
| **2** | 执行者 C | 建 `web.net`(V1 network 移植 + attach 失败 fail loud) | ⭐ 三条故障注入**先红后绿** |
| **2.5** | 执行者 C | `web.trace` 骨架 + 健康探针 | 掐 CDP → 探针 N 秒内红 |
| **3** | 执行者 D | ⭐ **迁移 AI**(改调用方,旧实现留着) | 步 0 的快照测试**全部仍绿** |
| **4** | 执行者 E | `web.dom`(收编注入) | 全部预注册脚本过求值测试 |
| **5** | 执行者 F | `web.input`(收编 `web-service-base`)+ 红线守卫 | 红线守卫先红后绿 |
| **6** | 执行者 G | **迁移 X** | 512 条**仍全绿** + 双栏填字进对栏 |
| **7** | 执行者 H | 迁移剪藏 / 翻译 / 邮件 | 各自行为不劣化 |
| **8** | 执行者 I | 清理旧实现 | 全绿 + KNOWN_DEBT 清零 |

**步 0-2.5 是「只加不改」,步 3 起才动调用方。**

---

## 4. 总指挥的验收职责(本对话)

每步执行者交回后,**总指挥必须做四件事**,缺一不可:

| # | 做什么 | 为什么 |
|---|---|---|
| 1 | **跑测试**,对照基线(`tests/x/` 512 全绿;全仓失败数不增) | 不采信自述 |
| 2 | **读 `git diff` 逐个核**,确认没动不该动的 | 记忆 `feedback-grep-shared-edge-before-delete`:验收 git diff 逐个核,别采信自述 |
| 3 | ⭐ **故意注入违规,看守卫红** | `feedback-verify-guard-can-fail`:没红过的守卫是假保证 |
| 4 | **对照 `02-testing.md` 的验收表逐条打勾**,人验那一列交给用户 | 双通道缺一不可 |

> ⚠️ **总指挥不接受「我跑了,通过了」** —— 必须自己跑、自己看 diff。
> 这是本仓反复强调的:不接受「看着成功实际没做」。

---

## 5. 给执行者的 prompt 模板

每个 prompt 必须含以下七段。**缺任何一段,执行者大概率会跑偏**(前几轮的教训)。

```markdown
## 1. 你的任务(一句话)
<只做这一件事,别顺手做别的>

## 2. 必读(按顺序,别跳)
- docs/10-business-design/web/capability-layer/01-web-capability-contract.md  ← 总纲
- docs/10-business-design/web/capability-layer/06-data-model-and-interfaces.md ← 契约
- docs/10-business-design/web/capability-layer/07-acceptance-and-testing.md    ← 验收
- <本步相关的其他文档>
- ⚠️ 用户记忆里的相关条目(每条对应一次真实事故)

## 3. 铁律(违反即返工)
- **只加不改**:本步只新增文件,`git diff` 不许出现对旧文件的修改(步 3 起例外,见任务)
- **不要静默兜底**:`?? []`、默认值、catch 吞异常 —— 每一个都掩盖过真 bug
- **守卫必须验证能真的失败**:写完故意注入违规看它变红,红过再改回来
- **底座不做判断**:不判断哪个页面该操作、哪个动作危险、哪些数据敏感
- <本步专属铁律>

## 4. 边界(明确不要做什么)
- 不改 <具体文件/目录>
- 不删任何现有实现
- 不「顺手优化」看着不顺眼的代码

## 5. 验收标准(逐条可验)
- [ ] `npx vitest run tests/x/` → 512 全绿
- [ ] 全仓失败数不超过基线 7 个文件 / 2 用例
- [ ] <本步 07 里的具体验收条目>
- [ ] <人验:面板上能看到什么>

## 6. 交付物
- 代码 + 新增测试
- **一份自查报告**:逐条对照验收标准,写明「怎么验的、结果是什么」
- ⚠️ 如果有做不到的,**明说**并解释,不许含糊过去

## 7. 协作方式
- 拿不准的**先问再做**,不要猜着做
- 发现设计文档有错 → **指出来**,别将错就错
- 每完成一个可验证的小步就报告一次,不要憋大招
```

---

## 6. ⭐ 步 0 的 prompt(可直接使用)

```markdown
## 1. 你的任务
给现有 AI 对话提取链路补一层**行为快照测试**,为后续迁移提供安全网。
**不改任何产品代码。**

## 2. 背景
Web 能力层重构即将迁移 AI 提取(第一个消费者)。但实测发现:
`ai/interceptor.ts`(368 行)和 `ai/extractors/`(7 文件)**一条测试都没有**
(`grep -rln "interceptor|SSECapture|extract-turn|full-extraction" tests/` 零命中)。

没有安全网,「迁移后行为一致」就无法证明,只能靠人工点几下,不可回归。

## 3. 必读
- docs/10-business-design/web/capability-layer/07-acceptance-and-testing.md §0(测试哲学)
- src/platform/main/ai/interceptor.ts
- src/platform/main/ai/extractors/*.ts
- 记忆:`project-chatgpt-extract-stale-cache`(提取轮次对不准的真实事故)

## 4. 铁律
- ⚠️ **不改产品代码**:`git diff` 只许出现 `tests/` 下的新增文件
- 测试要测**行为**不测实现 —— 迁移后实现会变,测试不该跟着改
- 不要为了让测试好写而放宽断言

## 5. 要覆盖什么
优先级从高到低:
1. **三家提取器的解析**:喂真实载荷样本(可从 `userData/x-payload-survey/`
   或自己抓一份),断言解析出的结构正确
2. **多轮对话取最后一轮**:`project-chatgpt-extract-stale-cache` 记录的事故 ——
   缓存冻结导致重复拿旧的那一轮
3. **代码块/公式等特殊内容不丢**:记忆 `project-markdown-import-unify` 提到过
4. 边界:空回答、超长回答、流式未结束

## 6. 验收标准
- [ ] 新测试全绿,且**每条都验证过能真的失败**(故意改坏被测逻辑看它红,再改回来)
- [ ] `npx vitest run tests/x/` → 512 全绿(没碰到 X)
- [ ] 全仓失败数不超过基线(7 文件 / 2 用例)
- [ ] `git diff --stat` 显示**只有 tests/ 下的新增**

## 7. 交付
代码 + 自查报告(逐条写明怎么验的、结果如何)。
做不到的明说,别含糊。
```

---

## 6.5 步 0 验收记录(2026-09-08 · 已通过)

交付:`tests/ai/` 6 文件 / **120 用例**,产品代码**零修改**(`git diff` 空)。
总指挥独立复核:`tests/ai/ + tests/x/` → **632 = 512 + 120** 全绿,基线未劣化。

### 6.5.1 ⚠️ 三笔必须记账的缺口(别靠记忆)

| # | 缺口 | 证据 | 何时还 |
|---|---|---|---|
| 1 | **「多轮取最后一轮」ChatGPT 侧未覆盖** | 总指挥把 `chatgpt-full-extraction.ts:285` 的 `children[children.length-1]` 改成 `children[0]`(**正是该事故形态**)→ **120 条全绿,一条没红** | **步 4** 建 `web.dom` 时,解析逻辑重新归置后自然可测 |
| 2 | **ChatGPT 10 个内部函数够不着** | 未导出;含「私用区 marker widget 还原」(防 `▤url▤` 乱码进 Note) | 同上。**不为测试加 export** —— 那是把测试需求泄漏进产品,且破坏本步「只加不改」 |
| 3 | ⭐ **取数层完全没有网** | 本步只覆盖「载荷 → 结构化 → markdown」;**「载荷怎么拿到的」(CDP attach / hook cache / 实时 fetch)零覆盖** | **步 3 的主要风险**,见下 |

### 6.5.2 ⭐ 缺口 3 直接决定步 3 怎么验收

**步 3 迁移 AI,换掉的正是取数层 —— 而被换掉的那部分恰恰没有网。**

所以步 3 的验收**不许**以「`tests/ai/` 120 条全绿」为依据(它们测的是换下游,不是换的那层)。
必须靠:

- **C 类故障注入**:掐 CDP / 让 attach 失败 → 订阅者必须收到 `Failed`,不是静默等
- **人验**:网络监视面板上**看得见** AI 对话的载荷进来

> 这条是步 0 执行者主动提出的,判断准确,**记账避免后续误以为「兜住了」**。

### 6.5.3 总指挥 prompt 的一处错误(留档)

我在步 0 prompt §4 写「extractors 对 electron 只有 `import type`」——
**只查了 electron 依赖,没查其他值 import**。实际 `claude-extract-turn.ts`
顶层有值 import `mediaStore`(`../../media/media-store-impl`),**加载即炸**。

执行者用 mock 绕开并标为「迁移时要还的债」,判断正确:
**媒体存储耦合进解析器,正是 `web.dom` 该切开的。**

> 教训:给执行者的「已验证事实」必须**逐个模块**核,不能从一个样本外推
> —— 与 `feedback-check-sample-contains-phenomenon` 同源。

---

## 6.6 步 1 验收记录(2026-09-08 · 已通过)

交付:`src/platform/main/web-capability/`(6 文件 / 668 行)+
`tests/web-capability/`(6 文件 / **67 用例**)。产品代码**零修改**(`git diff` 空)。

总指挥独立复核:`web-capability + ai + x` → **699 = 512 + 120 + 67** 全绿。

### 6.6.1 缺陷注入复核(总指挥亲自做,不采信自述)

| 注入 | 结果 |
|---|---|
| `find` 只返回最后一个(**「最后 navigate 胜出」等价物**) | **7 条红** ✅ |
| **复活拼维度身份** `${window}:${ws}:${slot}:${service}` | ⭐ **13 条红** ✅ 含哨兵「同 ws 三个 tab」+ 源码守卫 |

> ⭐ **被否决的方案回不来了** —— 这正是设 §7 那条哨兵的目的。
> 执行者另做了 11 次注入(facts 返空值、release 顶掉别人租约、
> destroy 不回收租约、wcId 塞进 PageFacts),各自精确红。

### 6.6.2 ⭐ 规格修正:`PageFacts` 补 `partition`(执行者发现)

**当时的 06(现并入 `01-contract.md`)原本不自洽**:`prepare` 的目标写的是 `pageId | partition`(§3.1),
但 `PageFacts` 字段表(§1.4)里**没有 partition**。

**总指挥已核实,这不是纸面问题**:

| 事实 | 证据 |
|---|---|
| V2 的 partition 是 **per-ws** | `ai-extraction/Host.tsx:227` / `x-extraction/Host.tsx:223` 都是 `persist:webview-${workspaceId}` |
| 剥 CSP **整个 partition 生效** | `web-translate-handler.ts:35` `session.fromPartition(...).webRequest.onHeadersReceived` |

→ 不给 `facts` 暴露 partition,就**回答不了「这次 prepare 会波及哪些别的页面」**。

**裁定:采纳,`01-contract.md` §1.4 已补 `partition` 字段**(它与 window/ws/slot 同类,
都是位置事实,可查可变、不参与身份 —— 不违反不透明原则)。

### 6.6.3 主动偏离 V1:租约改惰性回收(裁定:保留)

V1 `lease-manager.ts` 用 60s `setInterval` 扫过期租约;执行者改为**惰性回收**,
理由是记忆 `project-graceful-shutdown`:**常驻 timer 没人停会吊住事件循环,
让进程不肯退**。

**裁定:保留惰性版本。** 理由:
- 行为等价(执行者用可控时钟验证过)
- 免掉一个 `dispose()` 接进 `before-quit` 的义务 —— 那正是该记忆里的坑
- 本层将来会被多消费者共用,**少一个常驻 timer 就少一处退出路径的风险**

### 6.6.4 执行者的守卫自检抓到自己的 bug(值得留档)

`02-testing.md` §0.2 写「守卫比对源码前先剥注释,踩过两次」。
执行者第一版 `stripComments` **只剥整行注释、漏了行尾注释**(`const a = 1; // wcId`),
**自检用例当场红**,已修。

且该自检**反向锁住**「注释里必须仍有 `wcId`」—— 否则守卫就是空转的。

> 这是 `feedback-verify-guard-can-fail` 想要的效果:**守卫自己也要被守。**

---

## 6.7 步 2 验收记录(2026-09-08 · 已通过)

交付:`web-capability/net/`(6 文件)+ 测试增至 **144 用例**(步1 67 → +77)。
产品代码**零修改**。总指挥复核:`web-capability + ai + x` → **776 = 512 + 120 + 144** 全绿。

### 6.7.1 ⭐ 命脉注入复核(总指挥亲自做)

| 命脉 | 我怎么注入的 | 结果 |
|---|---|---|
| **1. A 结束不掐掉 B** | 让 `unsubscribe` 顺手清掉同页面所有订阅(**= X 那 8 处的等价形态**) | **红** ✅ 「B 之后仍收到载荷」当场失败 |
| **2. attach 失败要响** | 退回 V1「只 `console.warn`」 | ⭐ **4 条红,且测试真的挂了 5.02s 超时** |

⭐⭐ **命脉 2 是本步最硬的证据**:注入后 `waitFor` **真的吊在那里等到超时** ——
这就是「安静地等一个永远不来的载荷」的**现场复现**;还原后 0ms 返回 `Failed`。

> 我第一次注入命脉 1 时打偏了(去调 mock 上不存在的 `dbg.detach()`),
> 测试没红。**没有就此下结论**,而是去读了测试与 mock,
> 找到真正的接缝(`unsubscribe`)重注一次才见红 ——
> 记忆 `feedback-check-sample-contains-phenomenon`:
> **别拿不含该现象的样本论证该现象缺失。**

执行者另做 7 次注入(去归一化、去时间窗、关联静默丢、body 返空、不封顶、不隔离)各自红。

### 6.7.2 两处规格修正(执行者提出,均已核实并采纳)

**① `01-contract.md` §3.2 缺「故障怎么送达订阅者」的位置**

契约要求「attach 失败订阅者收到明确错误」,但 `subscribe` 签名里**没有承载它的地方**。
定为两个 `NetworkEvent` kind:`channel-failed` / `channel-lost`,
且 ⚠️ **不受 `matcher.kinds` 过滤** —— 否则订阅者按 kinds 过滤会把告警本身滤掉,等于白做。
**已补进 `01-contract.md` §3.2。**

**② `02-testing.md` §2.2 第 3 条本步做不完**

它要「探针 N 秒内报不健康」,但同文档第 375 行写明**探针属步 2.5 的 `web.trace`**。
步 2 只能做前半截(订阅者收到 `channel-lost`),后半截的数据源正是这个事件。
**已在 `02-testing.md` §2.2 标注依赖关系。**

### 6.7.3 ⚠️ 范围提醒:`web.net` 只是半条链路

**总线 / 关联 / 故障广播 / 内存管理**都好了且可测,但**载荷入口没接**:
- CDP provider **没跑过真 webContents**
- webRequest 侧**完全没接**(需要真 session,属接线)

### 6.7.4 ⚠️ mock 清单 —— 接线时必须重验

最关键一条(执行者单列):
**「真 `webContents.debugger` 的 attach 失败到底是抛异常还是返回?」**
本步假设**抛 `Error`**;若 Electron 实际是返回而非抛出,
**命脉 2 的链路在真环境不成立**。

> 这条必须在**步 3 接线时第一个验**。
> 记忆 `feedback-dont-guess-look-at-real-data`:别靠读代码脑补,拿真实数据定根因。

---

## 6.8 步 2.5 验收记录(2026-09-08 · 已通过)

交付:`web-capability/trace/`(5 文件)+ 测试增至 **195 用例**(步2 144 → +51)。
产品代码**零修改**。复核:`web-capability + ai + x` → **827 = 512 + 120 + 195** 全绿。

### 6.8.1 ⭐⭐ 本轮最值钱的一件事:注入抓到了执行者自己的假保证

执行者报告(总指挥已复核确认):

> 「有响应但拿不到 body 不算捕获」这条 —— **第一次注入没红**。
> 我在灌完 20 条无 body 响应后推进了 6 分钟,「零捕获」是被**时间窗顺带遮出来**的,
> 那条测试对这个缺陷**零区分力**。去掉时间推进后重新注入 → 红了。

**总指挥独立复现**:注入「有响应就算捕获」(把 `event.bodyRef !== undefined` 改成 `true`)
→ 修好后的测试**精确红 1 条**,正是那条。

> ⭐ **这是本轮第二次「不做注入就会交付自我感觉良好、实际空转的守卫」**
> (第一次是步 0 的「多轮取最后一轮」)。
> 印证 `feedback-verify-guard-can-fail`:**没红过的守卫是假保证。**
>
> 更要紧的是它揭示了一种**测试自欺的具体形态**:
> **断言成立的原因不是被测逻辑,而是测试自己布置的另一个条件。**
> 造场景时要问一句:**「如果被测逻辑是错的,这条断言还会成立吗?」**

### 6.8.2 命脉注入复核(总指挥亲自做)

| 注入 | 结果 |
|---|---|
| 去掉「有订阅者 + 零捕获」判定 | ⭐ **6 条红**,含端到端那条(接真 bus + 真 provider) |
| 「有响应就算捕获」 | **1 条精确红**(§6.8.1) |

执行者另守了**反向面**:零订阅者时零捕获**不许误报** ——
「天天误报的探针等于没有探针」。这条很重要,不然探针会被人为忽略。

### 6.8.3 三处判断(均已核实源码,采纳)

**① 三态契约在本层没落点** —— `health()` 返回「不健康」是**成功地报告了不健康**,
硬套三态会让接口难用而不更安全。sink 接真 fs 后「写盘失败」才是真会失败的,接口已预留。**采纳。**

**② 没接 `diagnostics-bus`,且建议先别接** —— 总指挥核实两条事实:

| 事实 | 证据 |
|---|---|
| `markAlive` 每次调用都 `console.log` 一行 | `diagnostics-bus.ts:32` —— **探针持续查询会刷屏** |
| `health-check` IPC 硬接线到 `L0`…`L5` | `ipc/health-check.ts:35-41` —— **坐实命名冲突是真问题** |

**采纳**:接线时写**单向适配**(只在 `alive:false` 时调一次 + 去重),不双向耦合。

**③ ⚠️⚠️ 探针是拉取式,接线时必须有人定期查**

`02-testing.md` §2.5 要「N 秒内变不健康」,但**推送式要常驻 timer**,
违反 `project-graceful-shutdown`(Ctrl+C 后 app 不退)。

**代价:没人调 `health()` 就没人知道坏了 —— 探针会白做。**

> ⭐ **这条必须写进步 3 及之后所有接线 prompt。**
> 探针建好 ≠ 探针在工作。**「谁来查、多久查一次」是接线的必答题。**

### 6.8.4 本步未做(依赖真运行时,已记账)

- `03-observability.md` §4.2 的「重新 attach」**只做了留痕没做动作**(需真 webContents)
- 「连续 N 次失败 → `markFailed`」依赖 §6.8.3② 的对接决定,未做

---

## 6.9 步 3 中途裁定(2026-09-08)

### 6.9.1 ⭐ 步 2 遗留疑问已实测消解:假设全部成立

执行者写了独立 Electron probe app(**真 Electron 40.6.0,非 mock**),实测输出:

```
attach-1-normal:         OK, no throw
isAttached-after-1:      true
attach-2-duplicate:      THREW: TypeError / Debugger is already attached to the target
attach-3-badversion:     THREW: Requested protocol version is not supported
detach-callback-argc:    2
detach-callback-args:    ["<object>","target closed"]
isAttached-after-detach: false
attach-4-destroyed:      THREW: Object has been destroyed
```

| 步 2 的假设 | 实测 |
|---|---|
| attach 失败**抛异常** | ✅ 三种失败形态全部抛 |
| 抛的是 `Error`(有 `.message`) | ✅ `TypeError`,`instanceof Error` 为真 |
| `detach` 回调 `args[1]` 是 reason | ✅ argc=2,`args[1] === "target closed"` |
| `isAttached()` 反映真实状态 | ✅ |

⭐ **命脉 2 那条链路(attach 失败 → `channel-failed` → 订阅者立刻 `Failed`)在真环境成立** ——
步 2 那个 5002ms 的证据**不是纸上谈兵**。`09-history.md` §6.7.4 的悬案**结案**。

**顺带证实**:「已被别人 attach」正是最常见的失败形态,**且确实抛** ——
这就是 X 那 8 处全写 `try { attach } catch { /* 共用即可 */ }` 的原因。

### 6.9.2 ⚠️ 环境坑:`ELECTRON_RUN_AS_NODE=1`(将来还会遇到)

执行者前 5 次尝试全失败,现象是 `app undefined` / `Cannot find module 'electron'`。

**真因**:shell 环境里有 `ELECTRON_RUN_AS_NODE=1` —— 它让 Electron 退化成纯 Node,
`require('electron')` 于是命中 **npm launcher 包**(返回二进制路径字符串)而非内部 API。

**解法**:`env -u ELECTRON_RUN_AS_NODE ...`,一次就过。

> ⚠️ **后续任何需要真机跑 Electron 的验证都要先清这个变量**(步 6 迁 X 会再用到),
> 否则**极容易误判成「Electron 装坏了」** —— 现象与真实损坏一模一样。

### 6.9.3 裁定:Gemini 迁移走 **A(SSECapture 内部换实现)**,不走 B

用户初始倾向 B(彻底),总指挥查代码后建议 A,**用户同意**。

**决定性证据**(`ai-sync-orchestrator.ts:161`):

> 取 records —— **gemini 走 main 端缓存,claude/chatgpt 走 page-cache**

orchestrator 里是一个 **`serviceId === 'gemini' ? ... : ...` 的三元分叉,两边形状不同**。
B 要让 orchestrator 直接持 `pageId`,**就得动这个分叉** ——
而 claude/chatgpt 那一支**本步根本不该动**(它们走注入 hook,属步 4 `web.dom`)。

| | A | B |
|---|---|---|
| diff 面 | `interceptor.ts` 内部 | 扩散 3 文件 |
| 碰 claude/chatgpt 共用代码 | ❌ 不碰 | ⚠️ **要碰三元分叉** |
| 同时改的变量 | 1(取数方式) | 2+(方式 + 时机,上面还有 1.5s 轮询) |
| 出问题归因 | 范围清楚 | 三个文件里找 |
| `tests/ai/` 120 条 | 天然不受影响 | 可能被迫改 = **违规信号** |

> ⭐ **「彻底做完免得留后患」的直觉没错,但它指向步 8 不是步 3。**
> `09-history.md` §1.2 本就预设「先并存,后清理」——
> A 不是留尾巴,是**把清理放回它该在的位置**。
> B 等于把步 8 提前到步 3,而此刻 `web.net` **连一次真实载荷都没跑通过**。

### 6.9.4 A 的附加条件(补上 B 想解决的那点)

A 的风险是「壳子还在、内部换了,**看不出来**」。故要求:

⭐ **Gemini 的载荷必须能证明是经 `web.net` 到达的,而不是旧路径悄悄兜底。**

形式自定(日志标记 / 探针计数 / 测试断言),但**必须能被人和 AI 分别验证**。

> 这样 A 的「保守」只体现在 **diff 面**,不体现在**可验证性**上。

---

## 6.10 步 3/4 验收记录(2026-09-08 · 均已通过)

### 6.10.1 步 3(AI-Gemini 迁移)

- A 方案边界**守住**:`git diff --stat src/platform/main/ai/` **只有 `interceptor.ts`**,
  orchestrator 零改动
- 注入「退回自己 attach」→ **精确红 1 条**(迁移守卫有效)
- ⭐ 「谁来查探针」已答:`wiring/health-watch.ts`,60s 一轮、
  **只在健康状态翻转时发声**(不刷屏)、`unref` + `before-quit` 配套 `stopHealthWatch()`
  —— 记忆 `project-graceful-shutdown` 那条铁律落实到位

> ⚠️ **总指挥操作失误留档**:复核时我用 `git checkout <file>` 还原注入,
> **把执行者未提交的步 3 改动一起丢了**,靠 `/tmp` 备份恢复(校验 166 insertions 一致)。
> **教训:在未提交的工作区做注入实验,只能用 `cp` 备份还原,绝不能用 `git checkout`。**

### 6.10.2 步 4(`web.dom` + ChatGPT/Claude 注入)⭐ 两笔债已还清

总指挥**亲自注入复核**(不采信自述):

| 债 | 注入 | 结果 |
|---|---|---|
| **①「多轮取最后一轮」** | 在新位置 `parsers/chatgpt-payload.ts:251` 把 `children[children.length-1]` 改成 `children[0]` | ⭐ **2 条红** |
| **②「marker widget 还原」** | 让 `unwrapWidgets` 直接返回原文(乱码会进 Note) | ⭐ **7 条红** |

> ⭐⭐ **这是本轮最完整的一次闭环**:
> 步 0 时同样的注入(债①)**120 条全绿一条没红** ——
> 那笔债当场被记下,`09-history.md` §6.5.1 写明「步 4 还」;
> 现在同一注入**红了 2 条**。**记账 → 还账 → 亲自验收**,链路走通了。

**其他实测**:`interceptor.ts` 的 `executeJavaScript` **归零**(29 → 0 于该文件);
`ai/parsers/` 新目录(纯解析层,与 `web.dom` 分离);全量 **911 全绿**。

### 6.10.3 拆解析层的裁定(B 方案,已采纳)

执行者问「拆解析层算不算迁移必需」。**总指挥核实后裁定:算。**

**决定性数据**(总指挥逐个函数分类):
`chatgpt-full-extraction.ts` 的 12 个内部函数里,
**只有 2 个碰 `wc`**(`readCache` / `fetchConversationLive`),**其余 10 个是纯函数**。

尤其债① 的 `walkMapping` —— **入参普通对象、出参数组、零 `wc` 接触**,
它测不了的唯一原因是**没导出**,而没导出的唯一原因是**和取数函数挤在同一文件**。

> **拆分不是「为还债做的额外工程」,而是这个文件本来就该是两个文件。**
> 步骤 prompt 里「无顺手优化」禁的是**无关的美化**,不是迁移路径上的必要拆分。
> 这次拆分恰好落在迁移必经的那个函数上 —— **不是顺手,是顺路。**

附加约束(已执行):只拆 ChatGPT 一个文件、**行为一字不改**
(判据 `tests/ai/` 120 条不改且全绿)、拆与迁分段可核。

### 6.10.4 待补的人验

- ✅ ChatGPT 提取真机跑通,正文**无 `▤url▤` 乱码方块**(marker 还原正常)
- ⏳ **Claude 提取待验** —— 建议挑**带 artifact 的对话**(那条链路动过 `artifactHook` 注入方式)

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 执行者「顺手」改了旧代码 | 铁律「只加不改」+ 总指挥核 `git diff` |
| 执行者为了变绿改测试 | 铁律 + 总指挥对照基线 |
| 迁移后行为悄悄变了 | 步 0 的行为快照(AI)、512 条守卫(X) |
| 新层设计有错,到步 6 才发现 | 步 3 接 AI 就是**第一次真实检验**;那时改还便宜 |
| 上下文过长导致遗忘早期决定 | **每步一个新对话**,prompt 自带必读清单 |
| 总指挥采信执行者自述 | §4 四条职责,**必须自己跑、自己看 diff** |

---

## 8. 待用户确认

1. **分步计划(§3 九步)** 认可吗?粒度合适还是该合并/拆分?
2. **步 0 先补 AI 测试** —— 认可吗?
   它会让第一步慢一点,但没有它,步 3 的「验收通过」没有依据。
3. **prompt 模板(§5 七段)** 有要加的吗?
4. 执行者用**新对话**还是**subagent**?
   我建议新对话:上下文独立、你能随时看到它在做什么。


---



---

# 第四部分 · 底座补完(2026-09-09 起)

## 1. `web.input` 验收记录(已通过)

交付 `web-capability/input/`(4 文件)+ `wiring/electron-input.ts`,
**1201 行产品代码 / 72 条新测试**;现有文件**零修改**。

总指挥复核:`ai + web-capability + x` → **997 全绿**;
`git diff` 只含开工前就在途的 X phase-B 改动(逐字节一致)。

### 1.1 ⭐⭐ 本轮最值钱:三次「注入不红」都是真缺口

执行者做了 **15 次缺陷注入**,其中 **3 次零红** —— 而每一次都暴露了一条假保证:

| 注入 | 为什么没红 | 补了什么 |
|---|---|---|
| 锚点解释失败静默兜底 | 「喂不存在的锚点 → Failed」**成立的原因不是被测逻辑**:未登记锚点被当成 CSS selector 用,查不到元素才失败。**「锚点没登记」和「元素不在页面」混成同一个 Failed** | 断言失败原因含「无法解释成 selector」,且两者 `retryable` 不同(前者 false 要改锚点表,后者 true 可等) |
| 掏空 `evalScoped` 的失败翻译 | 作用域测试只验脚本层返回 `AMBIGUOUS` **标记串**,没测引擎在不在听 —— **标记串是 truthy,掏空后被当成功放行** | 补引擎层用例 + 反向锁(唯一命中的容器要正常工作,防退化成「一律失败」也能绿) |
| 参数裸拼(复刻转义事故) | 循环变量 `build` **根本没用上**,9 次迭代跑的是同一个函数;另一循环只把 nasty 喂给 `container`,而 bug 在 `anchor` 参数上 | 每个 builder 的每个字符串入参都吃 nasty + 反向锁「脚本里不许出现裸拼形态」 |

> ⭐ **三次都是同一形态**:**断言成立的原因不是被测逻辑**
> (与 §6.8.1 记的那次同源)。
> **没有注入,这三条会以「全绿」的样子交付。**
>
> 这是「守卫必须验证能真的失败」这条铁律第 **4** 次证明自己 ——
> 前三次分别在步 0(多轮取最后一轮)、步 2.5(零捕获被时间窗遮住)、本步。

### 1.2 总指挥独立注入复核

| 注入 | 结果 |
|---|---|
| **把发布闸门搬进底座**(`tap` 拒绝含 publish/发布 的锚点) | **4 条红** ✅ 底座中立性守住 |

### 1.3 「收编」方式:搬移不是包装(执行者判断,采纳)

**硬约束不是偏好**:既有守卫 `page-boundary-guard.test.ts` 扫整个
`web-capability/`(除 `wiring/`),**禁 `from 'electron'`**。
而 `webview-input.ts` 第一行就 `import { clipboard, type WebContents } from 'electron'`
—— 新层去调它 = electron 被拖进能力层 = **当场撞守卫**。

故:逻辑搬进 `input/`(纯字符串 + 纯编排),Electron 那截进 `wiring/electron-input.ts`,
与 `web.dom` 的 `ElectronDomRunner` 同构。**旧文件一字未改,三家消费者照常跑。**

### 1.4 三处规格问题(执行者提出,已核实并修入 `01-contract.md`)

| # | 问题 | 裁定 |
|---|---|---|
| ① | §10.4 把 `locateSendButton` 派给 `query`,但 `query` 是 `web.dom` 的能力;且 `DomAnchor` **没有 `enabled` 字段**,而 `enabled` 正是它的全部价值 | **给 `DomAnchor` 补 `enabled?`** —— 与 found/rect/text 同类,都是 DOM 事实。记账待迁 X 时做 |
| ② | `check:'none'` 该返 Ok 还是 Degraded,契约没说 | **返 `Ok`** + `checked:false/landed:false/via:'unchecked'`;`Degraded` 要求 `missing` 非空,硬套会逼出假 missing。⭐ 但**绝不许谎称 landed:true** |
| ③ | `tap` 的 `settle` 未满足是什么态,契约没说 | **返 `Degraded`** —— 点确实成功了(非 Failed),但下一 step 会在脏态启动(非 Ok) |

> 这是执行者第 **7** 次指出规格问题,**七次全部被采纳**。

### 1.5 ⚠️ 一处主动偏离,待真机验证

`tap` 用 `.click()` 而非完整鼠标序列。

现有代码两者都有:`clickSelector` 用 `.click()`,`mouseClickSelector` 用完整序列
(注释写明「X 表格网格按钮等需 hover + full mouse 序列才提交,光 `.click()` 不行」)。

执行者的处理:`tap` = `.click()`,完整鼠标进入序列放进 `hover`,
调用方需要时 `hover` + `tap`。
**理由**:「这个按钮需不需要完整序列」是**站点知识**,底座不该内置。

⚠️ **代价**:X 表格网格那个场景要写成两步,**行为未在真机验证过等价**。
若实测不等价,需给 `tap` 加 `via:'mouse-sequence'` 选项 ——
**那时该由 adapter 传,不该底座猜**。

### 1.6 ⚠️ mock 清单(接线时必须重验)

与 §6.7.3 同一形态:**核心逻辑好了且可测,但真实入口一次没跑过。**

| mock | ⚠️ 风险 |
|---|---|
| **合成 paste 的「站点接住」** | ⭐ 高 —— 「DraftJS 认不认这个合成事件」**测不了**,只能真机验 |
| **`osPaste`** | ⭐ 高 —— webview 焦点隔离导致 OS 粘贴打不进 guest,**正是这条兜底存在的理由,而它恰恰验不了** |
| **`setFileInputFiles`** | ⭐ 高 —— 「已被别处 attach 就复用不 detach」(护着 AI 的 SSE 通道)**零覆盖** |
| `evaluate` | 中 —— 脚本文本真求值,但跑在 fake DOM 不是 Chromium |

### 1.7 本步未做(有意)

`frame` 作用域(prompt 明令,留类型位置且**传进来是明确 Failed 不是静默当 main**)·
`check:{kind:'custom'}`(需接线层把 `ScriptId` 转给 `domRunner`,本轮无消费者,
**明确返 Failed 说清依赖,不做半吊子**)· 接消费者 · 发布闸门 · `scrollUntil`。

### 1.8 ⚠️ 基线数字更正

prompt 里我写的 `tests/ai/ 120` / `web-capability 195` 是**步 4 期的旧值**。
实际开工前基线:**`ai/ 146` · `web-capability/ 267` · `x/ 512`**。

> 教训:**每步 prompt 的基线必须现测,不能沿用上一步的数字。**


## 2. 控制补完(`ready` + `scrollUntil`)验收记录(已通过)

交付 `page/control-types.ts` · `page/scroll-scripts.ts` · `page/control.ts` ·
`wiring/electron-control.ts`(**651 行 / 56 条测试**);现有文件零修改。

总指挥复核:**1053 全绿**(512 + 146 + 395);`git diff` 与开工前快照一致。

### 2.1 ⭐ 四条血泪逐条注入(执行者 17 次,总指挥复核 2 次)

| 血泪 | 注入 | 执行者 | 总指挥复核 |
|---|---|---|---|
| ① `smooth` 异步 | 改用 `behavior:'smooth'` | 5 红 | ✅ **5 红** |
| ② 虚拟列表条数不涨反降 | 脚本回读 article 计数判停 | 3 红 | — |
| ③ 「没新数据」≠「到底」 | `stuck >= 1` 就停 | 3 红 | ✅ **3 红** |
| ④ 日期不是覆盖深度 | 加 `olderThan` 判据 | 2 红 | — |

⭐ **血泪① 的测试是行为测试不是字符串扫描**:假页面把 `smooth` 模拟成真异步
(下一轮才生效),断言「一轮后回读到的是**滚动后**位置」——
注入后必然落空。**这比 grep 源码强得多。**

⚠️ **血泪④ 注入时 `tsc` 完全沉默** —— 加一个类型分支、写一段日期比较,
编译器毫无意见。**这正是它必须靠源码守卫钉住的原因。**

### 2.2 ⭐ 又一次「注入零红 → 真缺口」(第 5 次)

注入 14(吞掉停止判据探针异常)**零红**。

**原因**:测试写成「脚本里含 `querySelector` 就抛」,但**滚动脚本和初始位置回读脚本
本身也含 `querySelectorAll`**(要找内部滚动容器)—— 于是它们**先炸了**,
根本走不到探针。**断言成立的原因不是被测逻辑。**

**修法**:只对锚点探针脚本(含 `#end`)抛,并加两条自检 ——
断言滚动确实跑过 1 轮、且失败发生在「第 1 轮」而非白滚满 5 轮。修完后精确红 1 条。

> 这是本轮第 **5** 次证明「守卫必须验证能真的失败」。
> 前四次:步 0 · 步 2.5 · `web.input`(3 次) · 本步。

### 2.3 ⭐ 三处测试助手的 bug(被自己的测试抓到)

值得留档 —— 它们都是「**假页面不像真页面**」:

| # | 问题 | 后果 |
|---|---|---|
| 1 | 内部容器高度写死 `10_000` | 连「短文档」也永远有个能滚的容器 → 永远不 stuck,**「到底」测不出来** |
| 2 | `mainUnscrollable` 封顶写成 `0` | 「滚不动」被模拟成「**被拽回顶部**」,`scrolledPx` 成负数 |
| 3 | 用 `throwTimes = 9999` 冒充「一直抛」 | 可控时钟下 `ready` 真轮询了 **15320 次**跑完了它 → **场景根本没造出来** |

> ⭐ 第 3 条尤其典型:测试**看起来**在测「一直抛到超时」,
> 实际测的是「抛完之后判据不满足」。已改成 `Infinity`。

### 2.4 两处规格问题(已核实并修入 `01-contract.md`)

**① ⭐ 契约的 `trace` 注释与血泪② 自相矛盾**

契约初稿写 `trace: // 每轮:scrollY / **新增数** / 耗时` ——
但**「新增数」正是血泪② 禁止的东西**:本层只滚不抓,唯一能数的只有 DOM 条数,
而那恰是「不涨反降」的陷阱。

执行者的处理:`RoundTrace` 只记 `scrollY/docHeight/stuck/elapsedMs/usedContainer`,
并加守卫钉死「trace 里不许出现条数字段」。**已修契约。**

> ⚠️ 若不修,**下一个执行者照着契约写就会重踩血泪②**。

**② `ScrollReport` 校验没过时返回什么态**

裁定:**`Degraded`**(`missing = problems`)。滚了多少是真的、trace 是真的,
只是不完整 —— 当 `Failed` 丢掉已滚进度,当 `Ok` 是「滚了个寂寞却报成功」。

⭐ **由此确立统一原则**(与 `tap.settle` / `check:'none'` 同源):
**凡「做了但不完整」一律 `Degraded`。**

### 2.5 一处主动偏离(采纳)

`rounds` 判据超过 `maxRounds` 时返回 **`Failed`,不静默截断**。

现有实现里两者是同一个循环上限,不存在冲突;拆成「停止判据」与「安全阀」后,
`{kind:'rounds', n:100}` 配 `maxRounds:50` 就有歧义 ——
**静默截断 = 「我要 100 轮,它给了 50 轮还说成功」**,正是本仓明令禁止的形态。

### 2.6 ⚠️ 未搬的一条现有行为(记账)

现有实现在 `stuck % 3 === 0` 时**额外等 3 秒催懒加载**
(`x-timeline-harvester.ts:352`)。执行者**没搬**,理由:
它把「等多久」写死在底座里,而**这是站点特性**(X 深处懒加载慢),
调用方用 `settleMs` 表达即可。

⚠️ **代价**:真机上若因此**提前判到底**,需要加回来或调大 `stuckRounds`。

### 2.7 ⚠️ mock 清单 + 记账

| mock | 风险 |
|---|---|
| **滚动模型** | ⭐ 高 —— 「`scrollBy` 在真 X 上到底滚不滚得动」验不了 |
| **内部滚动容器** | ⭐ 高 —— 真页面 `querySelectorAll('div')` 可能上千个,`+400` 阈值挑没挑对**只有真机知道** |
| `settleMs` / 轮询 | 中 —— **懒加载补货需要真等**,可控时钟下完全没验 |

**记账**:`ready`/`scrollUntil` **尚未挂进 `WebPage` 接口**
(`page/web-page.ts` 是现有文件,改它会破「逐字节一致」)—— **接线时必须做这一步**。


## 3. L-raw 落盘 + 索引 验收记录(已通过)⭐ 底座补完

交付 `raw/`(3 文件)+ `wiring/fs-raw-sink.ts`,**705 行 / 60 条测试**;
`net/bus.ts` 一字未碰。总指挥复核:**1113 全绿**(512+146+455)。

### 3.1 索引形态:按天分片 JSONL 追加写(执行者方案,采纳)

先用真实数字估量:一个月约 6000~60000 条索引 ≈ **12MB**。

| 方案 | 问题 |
|---|---|
| 单文件全量重写 | 一天上千次写 12MB —— **不可接受** |
| 单文件追加 | 写 O(1),但清理要重写整个 12MB,**重写中途崩 = 索引全毁** |
| ⭐ **按天分片 + 追加** | 写 O(1);清理 = **删掉整个分片**,不重写、崩了也只影响那天 |

**没上 SQLite**:§13.1 明确「存硬盘,不进 SurrealDB」,
再引数据库依赖与「不要把逻辑搞复杂影响可靠性」相悖。
**代价说明白**:按非时间字段查要扫分片 —— 可接受,
排查本就是「先圈时间,再按 host/URL 找」,**与 Chrome DevTools 同款**。

### 3.2 总指挥独立注入复核

| 注入 | 结果 |
|---|---|
| ⭐⭐ **加「M4 不存」分支**(§13.1 明令禁止的那个) | **13 条红** ✅ |
| ⭐⭐ **清理条件写反**(该留的清掉) | **4 条红** ✅ |

> ⭐ 第一条证明「**缓存层无条件收下一切**」这条原则**已被机器强制**,
> 不再靠人记得。第二条护住的是唯一会**永久删数据**的操作。

⚠️ 我第一次注入「清理写反」时改错了位置(pattern 没匹配上),
测试全绿 —— **没有就此下结论**,而是定位到 `raw-store.ts:272` 精确改
`>=` → `<=` 才见红。**与 `feedback-check-sample-contains-phenomenon` 同源。**

### 3.3 ⭐ 又一次「注入零红 → 真缺口」(第 6 次)

注入 6(JSONL 少写换行,两条黏一行)**只红 2 条**,而「全部读回来」和
两条端到端「重启」测试**照样绿**。

**原因**:那些测试写的记录**落在不同天的分片里,每片只有一行** ——
「两条黏成一行」在**一行一片**的场景里根本不会发生。
**断言成立的原因与被测逻辑无关。**

**修法**:「全部读回来」改成覆盖跨分片 + **同分片多条**;
新增「同一天写 25 条,重启后一条不少」,并自检**它们确实在同一个分片里**
(否则又是空转)。重跑 → **4 红**。

> ⭐ 这正是真实形态:**一天几百上千个响应全进同一分片,
> 少一个换行,这一整天的索引就全毁了。**

### 3.4 两处规格问题(已核实并修)

**① ⭐ `03-observability.md` §4.4 与 `01-contract.md` §13.1 直接冲突**

| | §4.4 | §13.1 |
|---|---|---|
| 请求头 | 「默认不落盘」 | ⭐ 「**照存**,参考 Chrome」 |
| 响应体 | 「默认关闭」 | ⭐ 「**默认开**,不要用户干预」 |

**两处都是「用户已裁定」的口吻,结论却相反。**

**裁定**:两者都成立,但**适用范围不同** ——
§4.4 只管 `web.trace` 的 `rawSnippet`(诊断记录里**夹带**的片段),
§13.1 管 **L-raw 本身**(就是原始数据)。
**少存一点,前者仍能说明问题,后者就废了。** 已在 §4.4 加范围说明。

**② 「不写死上限」与「将满告警」需要默认值才成立**

`maxBytes` 是**默认值不是硬上限**(默认 8GiB,可改可设 `Infinity`);
设 `Infinity` 时**恒不告警 = 用户主动放弃告警**(有测试锁住,
防「无限上限却天天告警」)。
⚠️ 真正的「**磁盘**将满」告警要读 `statfs` —— **属接线层,记账**。

### 3.5 一处主动偏离(采纳)

**`put()` 在 sink 写失败时,连内存索引也不写** —— 要么都成、要么都不成。

**理由**(执行者):若只写内存不写盘,会出现
「本次会话查得到、**重启后查不到**」—— 而这一层的全部价值就是**跨重启找得回**。
**半成功比明确失败更难排查。**

**总指挥认可**:`Failed` 是可见的,而「以为存了、其实没存」不可见 ——
后者正是本仓一半守卫要防的形态。

### 3.6 ⚠️ mock 清单 + 三笔记账

| ⚠️ 风险 | 说明 |
|---|---|
| ⭐ **最高:一条真实载荷都没流进来过** | 本步只建仓库,**没接 `net/bus.ts:483 storeBody`** |
| ⭐ **高:重启后 `query()` 是空的** | `loadIndex()` 能读回,但**没有人调它重建内存索引** —— 接线时必须补 |
| 中 | 落盘根目录用真 `app.getPath('userData')` 未验;多 wc 并发 `appendFileSync` 原子性未验 |

**记账三条**(接线阶段必做):
1. 接管 `storeBody` —— 让载荷真的流进来
2. **启动时 `loadIndex()` 重建内存索引** —— 否则落盘的数据查不回来
3. 磁盘剩余空间告警(需 `statfs`)

---

# ⭐ 底座补完完成(2026-09-09)

三个能力全部就位:

| 能力 | 模块 | 状态 |
|---|---|---|
| **控制** | `web.page` + `ready`/`scrollUntil` | ✅(`goto`/`prepare` 待 adapter) |
| **输入** | `web.input` | ✅ |
| **输出** | `web.net` + `web.dom` + **L-raw** | ✅ |
| 诊断 | `web.trace` | ✅ |

**全程零改现有代码**,基线 `tests/x/` 512 始终全绿。

⚠️ **但没有一条真实数据流进过新层** —— 接线是下一阶段。
