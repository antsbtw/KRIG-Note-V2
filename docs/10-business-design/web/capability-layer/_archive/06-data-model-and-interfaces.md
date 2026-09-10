# 06 · 数据模型与调用接口(先定契约,后写实现)

> 属于 **Web 能力层**(`01-web-capability-contract.md` 是总纲)。
> **本文只定契约,不含实现。** 契约定稿前不写一行移植代码。
>
> ⚠️ 本文经 2026-09-07 多轮推翻重写。被证否的方案保留在 §8「推翻留档」——
> **错因比结论有用**,免得后来者再走一遍。

---

## 0. 一条贯穿全文的边界

> **底座只做两件事:如实呈现事实、忠实执行动作。所有判断都在应用层。**

这条是用户在本轮多次纠正后确立的,推翻了三处越界设计(详见 §8)。
它决定了下面每一个接口的形状:

| 底座做 | 底座不做 |
|---|---|
| 找得到页面、拿得到数据 | **不判断哪个页面「该」被操作** |
| 点了、填了,并确认真的成了 | **不判断哪个动作「危险」** |
| 如实记录发生了什么 | **不判断哪些数据「敏感」** |

---

## 1. 核心模型:页面是对象,不是参数

### 1.1 现在的病:身份被反复重新回答

```
pasteTweet('x', text, targetWcId)
pasteReply('x', url, text, targetWcId)
extractTweetAt('x', x, y, targetWcId)
```

`targetWcId` 一路透传,**每个函数都要重新处理一遍身份问题** ——
所以它一天能踩两次(记忆 `project-ws-instance-isolation-invariant`)。

### 1.2 ⭐ 关键洞察:这是在模拟人的操作流程

人操作时**从不需要「找页面」这一步**:

```
看着某个窗口 → 在它上面做事 → 看结果
```

**「我在哪儿操作」和「我操作什么」从不分离** —— 人的注意力本身就是那个句柄。
人不会「填了一条推,然后不知道填哪去了」。

而「日志说注入成功,右栏框是空的」这个 bug,正是因为**把这两件事拆开了**:
业务说「往 X 填」,底座事后猜是哪个 X。**猜的这一步,人根本没有。**

### 1.3 采用:先持有对象,再对它说话

```
页面 = find(条件)          ← 唯一一次确定身份
页面.goto('compose')
页面.type(锚点, 文本)
页面.confirm()
```

**身份只在获取时确定一次,后续操作不再问「哪个」。**

### 1.4 页面对象的身份

```
pageId      不透明串,页面创建时分配一次,生到死不变
            ── 应用只用它、不解析它、不从维度拼它

PageFacts   { pageId, window, ws, slot, tabId?, partition, owner, service?, url, state }
            ── 位置和状态都是可查、可变的属性
```

**为什么身份必须不透明**(初版拼维度方案已被证否,见 §8.1):

| 需求 | 怎么满足 |
|---|---|
| tab 从左栏拖到右栏 | 改 facts 的 slot,**pageId 不变**,trace / 订阅不断 |
| 同 ws 三个 tab | 三个 pageId,天然分开,**无需预先想到 tab 这一维** |
| **加一个没想到的维度** | **加一个 facts 字段,身份不动** |

⭐ 最后一条是判据:**好的抽象不要求把维度全想全** ——
想全了它对,想漏了它也不塌,因为身份本就不由维度拼出。

> ⭐ **`partition` 为什么是身份事实的一部分**(2026-09-08 补,步 1 执行者提出):
>
> V2 的 partition 是 **per-ws** 的(`persist:webview-${workspaceId}`,
> AI / X / Mail 三个 Host 都在用;翻译另有专用 `persist:webview-translate`)。
>
> 两个硬需求逼出这个字段:
> 1. `prepare` 要挂 `webRequest`,**必须知道页面在哪个 partition** —— 否则挂不上
> 2. 剥 CSP 是**整个 partition 生效**的,`facts` 拿不到 partition 就
>    **回答不了「这次 prepare 会波及哪些别的页面」**
>
> 它与 `window` / `ws` / `slot` 同类:**都是页面的位置事实**,可查、可变、不参与身份。
> 加它不违反 §1.3 的原则(身份仍是不透明串)。

### 1.5 三条不变量

1. **`pageId` 不透明** —— 应用不解析、不构造、不依赖内部结构
2. **`pageId` 稳定,`wcId` 易变** —— webview 重挂后 `wcId` 变、`pageId` 不变
   (V2 里 view 卸载会 `clearXHostWcId`、重挂拿新 wcId,**这是常态**)
3. **应用只见页面对象**,永远拿不到 `wcId` / `webContents`

### 1.6 同一性边界(避免 trace 断裂)

判据:**「同一个浏览上下文」= 同一个 pageId。**

| 事件 | pageId |
|---|---|
| webview 重挂 / SPA 导航 / 换 slot / 换窗口 / 拖 tab | **不变** |
| 跨站导航(X → google) | **不变**,`service` 字段跟着变 |
| tab 关闭 / webview 销毁 | 销毁 |
| 新开 tab | 新建 |

> 跨站不换 id:否则「同一标签页里从 X 跳到 google」会在 trace 里断成两截,
> 反而看不清经过。

---

## 2. find:底座唯一的「找」,且不替你选

### 2.1 契约

```
find(条件) → PageFacts[]
    条件是**事实性**的:{ ws?, slot?, window?, owner?, service?, urlIncludes? }
    ⚠️ 如实返回全部命中,不排序、不筛选、不替调用方挑
```

### 2.2 ⭐ 唯一的铁律:多个时不许自作主张

**底座不保证「挑得对」,只保证「不替你挑」。**

挑错了是应用的问题;**悄悄替你挑是底座的问题。**

这正是现有 bug 的根源 —— `createWebviewServiceRegistry` 的
「最后 navigate 胜出」是**底座替应用做了选择**,而它没资格做:它不知道业务意图。

后果有实测记录(`x-host-registry.ts` 注释):

> 用户同时开了内置浏览器 X 和 AI-view X,发推注入会打到「最后 navigate 的」那个
> ——内容落进了用户没在看的实例,表现「日志说注入成功,但右栏框是空的」

### 2.3 「多个候选」归应用处理

同一时刻 x.com 可能开在:AI view 右栏 / 内置浏览器 / 别的 ws / 别的窗口。

**底座不判断哪个「该」被操作** —— 它只如实说
「有这些,各自的 ws / slot / owner / url 是什么」。

应用自己挑,因为**只有它知道自己要什么**。X 写方向自然写成:

```
find({ ws, slot, owner: 'x-service' }) → 恰好一个 → 对它做事
                                       → 零个或多个 → 应用自己决定怎么办
```

它自己保证唯一性。

> 💡 `owner` 字段用于区分「X 服务的页面」和「浏览器里恰好停在 x.com 的 tab」——
> 两者不是同一类东西。但**怎么用这个区分仍是应用的事**
> (例:剪藏就是要操作浏览器 tab,那完全合理)。

### 2.4 状态不参与身份

| | 参与「是哪个」吗 |
|---|---|
| 身份(pageId) | — |
| 位置(ws / slot / window) | ✅ 可作为 find 条件 |
| **状态**(loading / 卡住 / 停在别的 URL) | ❌ 只影响「现在能不能做事」 |

状态是 `ready()` 的返回,不是 find 的筛选条件 ——
否则页面一 loading 身份就变了,又回到老问题。

---

## 3. 五个能力的调用接口

> 命名用 `web.*` 本名,不用 `BC-*` 前缀(§8.3)。
> 与 V2 已有的 `[L1] Window alive` 形状天然不冲突,且名字自解释。

### 3.1 `web.page` — 控制:找到它、去哪儿、等它好

```
find(条件)                   → PageFacts[]        // §2,不替你选
facts(pageId)                → PageFacts          // 位置 + 状态快照
goto(pageId, 目标)            → Arrived | Failed
    目标是**语义**: 'compose' | 'notifications' | { custom }
    ⚠️ 不接受裸 URL —— URL 是 adapter 的知识
ready(pageId, 判据, timeout)  → Ready | Timeout
lease(pageId, 用途, ttl)      → Lease | Busy       // 并发占用
release(lease)               → void
prepare(目标, 环境)           → Done | Failed      // 改变加载环境
    目标: pageId | partition
    环境: { 响应头改写?, userAgent?, referer?, 剥CSP? }
```

**`prepare` —— 第四类动作**(网页翻译暴露出来的):
既不是「取内容」也不是「往里放东西」,而是**在页面加载之前改变规则**。

现在全仓只有翻译在用(`web-translate-handler.ts` 剥 CSP / X-Frame-Options,
让 Google `element.js` 能在页面里跑)。接专业站点时很可能再用到 ——
某站 CSP 挡住注入、需要改 UA / referer 才能正常加载。

> ⚠️ 按 §0 边界:**底座只提供「能改」,改不改、改什么由应用决定。**
> 剥 CSP 是有安全代价的操作(翻译现在把它限制在专用 partition),
> 这个权衡属于应用层,底座不内置策略、也不替应用判断哪些站「可以」剥。

**为什么 `goto` 收语义不收 URL**:站点改版时变的是 URL,
不变的是「我要去发推页」。这是「改版只改一层」的直接兑现。

### 3.2 `web.net` — 输出:网络捕获

```
subscribe(pageId, 匹配, listener) → unsubscribe
    ⭐ 应用只订阅,永不 attach/detach —— 通道由底座独占
waitFor(pageId, 匹配, timeout)   → NetworkRecord | Timeout
list(pageId, 过滤)                → NetworkRecord[]
body(bodyRef)                    → bytes | Failed
downloads(pageId)                → DownloadRecord[]
```

**采用 V1 的单一持有者模型**(见 `04` §2):provider 装上就不 detach,
应用碰不到 debugger,**「最后一个人关灯」这个时刻不存在**。

**要补 V1 缺的**:attach 失败时订阅者必须收到明确错误(V1 只 `console.warn`,
订阅者会安静等一个永不到来的载荷)。

⭐ **故障怎么送达订阅者**(2026-09-08 补,步 2 执行者提出):
`subscribe` 的签名里原本**没有承载这个错误的位置** —— 规格不自洽。
定为 `NetworkEvent` 的两个新 kind:

```
{ kind: 'channel-failed', pageId, reason, retryable }   // attach 失败
{ kind: 'channel-lost',   pageId, reason }              // 通道被外部抢占 / 页面销毁
```

⚠️ **这两个 kind 不受 `matcher.kinds` 过滤** —— 否则订阅者按 kinds 过滤时
会把告警本身滤掉,等于白做。**故障通知必须无条件送达。**

`waitFor` 收到它们要**立刻返回 `Failed`,不干等到超时** ——
这正是「安静等一个永不来的载荷」的解药。

### 3.3 `web.dom` — 输入+输出:页面读取与脚本

```
read(pageId, 提取id, 参数)  → 数据 | Failed
query(pageId, 锚点名)       → DomAnchor | null
text(pageId, 锚点名?)       → string
selection(pageId)           → SelectionState | null
run(pageId, 脚本id, 参数)   → 结果 | Failed
```

⭐ **`run` 只接受预注册脚本 id + 参数,不接受脚本字符串。**

这是转义事故(`project-x-inject-template-escape`:模板字面量吃掉 `\/`,
采集恒 0 一整天,tsc 单测全绿)的**类型层面根治** ——
调用方给不了原始字符串,就拼不出坏脚本。

> 逃生口:排查工具(payload-inspector / spike)需要动态脚本 →
> 单独的 `runDynamic`,**显式标注 + 仅 dev**。

### 3.4 `web.input` — 输入:在选定页面上施加动作

```
focus(pageId, 锚点)         → Done | Failed     // 激活任意输入框
type(pageId, 锚点, 文本)     → Landed | Failed   // 含落地确认
feed(pageId, 锚点, 文件[])   → Landed | Failed   // 含接住确认
tap(pageId, 锚点)           → Done | Failed     // 点任意可点元素
press / scroll / hover      → Done | Failed
```

**`tap` 是单一中立原语** —— 不分等级、不设词表、不拒绝任何目标(§8.2)。

🔴 **写方向红线不在这一层。** 「绝不程序点发布」是 **X 业务层**的规则:
X 的写方向代码**从不调用 `tap` 去点发布按钮**。

> 这与现状一致且已被验证:`webview-input.ts` 提供 `locateSendButton`(只定位),
> AI 侧有自己的 `clickSendButton`(问答语义要自动发),X 侧没有。
> **同一个「发送按钮」,AI 点得、X 点不得** —— 差别在业务语义,不在按钮本身。
> 底座无从判断,也不该判断。

`focus` / `type` / `feed` **收编 V2 现有实现**
(`focusInputBox` / `pasteTextToWebview` / `feedFilesToInput`,均含落地确认,是成品)。

### 3.5 `web.trace` — 横切:诊断与维护

```
// 诊断:只观察,不干预
lifecycle(event) / network(event) / degradation(record)

// 维护:做决策
health(能力名) → { alive, 指标, 问题[] }
```

**底座不内置任何过滤策略**(§8.4)。记什么、记多少、留多久,
**由调用方以参数给定** —— 敏感数据判断是应用层的事。

`degradation(record)` 直接用可靠性纲领 §3 已定的结构,不重新发明。

---

## 4. 数据模型

### 4.1 V1 的可直接采用(实测站点特化为 0)

`BrowserState` · `FrameState` · `NetworkRecord` · `NetworkEvent` ·
`DownloadRecord` · `DomAnchor` · `PageResourceLease` · `Rect` / `SelectionState`

**要改的**:

1. `pageId` 改为**不透明串**(§1.4);位置/状态进 `PageFacts`
   (在 V1 `BrowserState` 基础上补 `window` / `slot` / `tabId` / `owner`;
   `partition` V1 本就有,保留)
2. 新增 `DegradationRecord`(可靠性纲领 §3 已定)

### 4.2 统一结果契约(V1 没有,本仓必须有)

V1 各接口失败表达不统一(有的返 `null`,有的 `console.warn`)。
按可靠性纲领铁律一,**全层统一三态**:

```
Ok(值)                   成了,且已确认
Failed(原因, 可否重试)    明确失败
Degraded(值, 缺了什么)    部分成功 —— 调用方必须显式处理,不许当 Ok
```

**没有第四态,特别是不许「返回空值假装成功」。**

`Degraded` 是为本仓真实场景设的:抓了 80/100 条、
喂图成功但缩略图没校验 —— 现在这些要么被当成功要么被当失败,**两种都错**。

---

## 5. adapter 契约:加新站点只写这一个

一个 adapter 只需提供四样:

| 提供什么 | 例(X) |
|---|---|
| **URL 识别** | 这个 URL 是不是我的站 |
| **语义页面表** | `compose` → `/compose/post` |
| **锚点表** | `composeBox` → selector(支持多候选)+ 是否待 spike |
| **载荷解释** | 哪个接口是正文,怎么解析成领域对象 |

**两条铁律**:

1. adapter **只做解释与增强**,不得反向定义底层模型
   —— 底座输出 `NetworkRecord`,不输出 `TweetRecord`
2. adapter **拿不到** `webContents`、**不能** attach CDP、**不能**拼注入脚本

> 锚点**不再分 Actionable / LocateOnly**(§8.2)—— 底座不做危险性判断。
> 但保留「**是否待 spike**」标记:X 现有 selector 表里大量
> 「待实机抓真实 data-testid」的初值,这个不确定性必须显式。

---

## 6. 定契约的顺序

| 序 | 定什么 | 状态 |
|---|---|---|
| 1 | 页面对象模型 + 身份(§1) | ✅ 已定 |
| 2 | `find` 语义:不替你选(§2) | ✅ 已定 |
| 3 | 三态结果契约(§4.2) | ✅ 已定 |
| 4 | 命名 `web.*`(§3) | ✅ 已定 |
| 5 | 各能力接口签名细化 | 待细化 |
| 6 | adapter 契约细化 | 待细化 |

**硬阻塞已全部解除**,可以进 `04` 的移植。

---

## 7. 验收:契约怎么算定稿

不靠「看起来合理」,靠**能不能表达真实场景**:

| 场景 | 考什么 |
|---|---|
| 同 ws 双栏各开一个 X,往右栏填字 | find 条件够不够 |
| **同 ws 内置浏览器开三个 tab** | ⭐ **身份模型(初版死在这)** |
| **tab 从左栏拖到右栏** | ⭐ **pageId 稳定(trace / 订阅不许断)** |
| 内置浏览器的 x.com 与 AI view 的 X 同时开着 | `owner` 事实够不够应用自己挑 |
| campaign 外部敲入、界面没人守 | 应用能否表达「我就要模糊匹配」 |
| notification-watch 常驻时跑 profile 采集 | `web.net` 订阅模型(现有实现**会哑**) |
| **网页翻译:剥 CSP + 注入脚本,不取任何内容** | `prepare` 够不够;不取内容的消费者能否表达 |

> **七个场景都能清楚表达 = 契约可定稿。**
> ⚠️ 初版身份方案**死在第 2 个场景**上 —— 这套验收有牙齿,不是走过场。

---

## 8. 推翻留档(错因比结论有用)

### 8.1 ❌ 身份不能由维度拼出

初版:`pageId = ${windowId}:${wsId}:${slot}:${serviceId}`。

**一个反例打穿**:内置浏览器有 tab(`src/views/web/data-model.ts` 的
`tabs: WebTab[]`)。同 ws 开三个标签页 → **三个 tab 算出同一个 id**。
**要治的病在方案自身复发。**

**错因**:

1. **拿故障史倒推维度 = 给已知的坑各配一把钥匙,不是建模** ——
   下一个没出过事的坑(tab)必然漏掉。这种方法造出来的东西
   **永远只够到上一次事故为止**。
2. **把「身份」和「位置」混进一个 id** —— 位置会变,位置一变身份就变,
   trace 断、订阅断、租约失效。这恰是身份最不该有的性质。

> 附带更正:「V1 模型对不上 V2」不准确。V1 对不上的是**绑定方式**
> (一个 wc 一个 page),它的**身份哲学**(不透明 id + 位置进 state)是对的。

### 8.2 ❌ 底座不做「危险动作」判定

曾提议:底座内置危险词表(publish / send / post / submit),`tap` 命中默认拒绝;
后又改为三级(L0 无副作用 / L1 可撤回 / L2 不可撤回)。

**用户裁定:这是应用层的事,底座不做。**

**证据支持用户**:`webview-input.ts:15` ——
同一个「发送按钮」,**AI 必须自动点(问答语义),X 绝不能点(发布不可撤回)**。
差别在业务语义,不在按钮本身。词表想从**按钮名字**推断危险性,
而危险性根本不在名字里:`send` 在两个业务里答案相反。

自证时刻:我问「点赞算 L1 还是 L2」—— **这个问题在底座层没有答案**,
问出来本身就说明越界了。

**删除**:selector 分类、`tap` 的 `Refused`、红线的类型闸 / 运行时闸。
**保留**:守卫闸,但守的对象改为「X 业务代码不得出现点发布的调用」。

### 8.3 ❌ 不用 `BC-*` 前缀

提 `BC-*` 只为避开 V2 已有的 `[L1] Window alive`。
但加前缀只躲开冲突,没解决「名字不说话」——
`BC-Net` 得先知道 BC = Browser Capability 才读得懂。

改用 `web.page` / `web.net` / `web.dom` / `web.input` / `web.trace`:
形状与 `[L1]` 天然不冲突、自解释、与目录对应。
`web.` 前缀也呼应定位:**它是 web 能力层,不是 X 的、不是 AI 的**。

### 8.4 ❌ 敏感数据策略不归底座

曾把它列为「阻塞 BC-Trace 接口形状」的硬阻塞。
**用户裁定:应用层考虑。** 底座如实记录传进来的东西,
过滤策略作为**参数**由调用方给,不内置规则。

### 8.5 ❌ `resolve` 这个问法本身就错

曾设计「多个候选的消解顺序」(精确匹配 → 取可见的 → 记 degradation)。

**用户点破**:这是在模拟人的操作流程,而**人从不需要 resolve** ——
人先看着一个窗口,再在它上面做事,身份和动作从不分离。

于是改为**页面对象化**(§1.3):先持有,再说话。
「多个候选」这个困境**从一开始就不该出现** ——
出现了说明获取时信息不够,那是**应用要补**,不是底座去猜。

且原方案第 2 步「取用户可见的那个」**其实也是策略**,同样越界。
最终:底座 `find` 如实返回全部,**不排序不筛选不替你选**。

---

## 9. 对 `04` 移植清单的影响

`04-v1-port-assessment.md` 需调整一处:

V1 的 `bindWebContentsPage(webContents) → pageId` 假设**一个 wc 一个 page**,
与本文的对象化模型不同 —— **那部分要重写,不能直搬**。

`main-service.ts`(751 行,48 处站点特化)本就判定为「不搬,仅参考」,
影响可控。**core / network 的核心文件(约 950 行)不受影响,仍可直搬。**
