# 10 · 底座补完规格(控制 / 输出 / 输入)

> 属于 **Web 能力层**(`01-web-capability-contract.md` 是总纲)。
> 用户 2026-09-09 定:「**先完善底座的构建**」,再到具体业务对象(X / Google / Reddit)。
>
> **本文只定规格,不含实现。** 三份契约定完,底座才算齐。

---

## 0. 底座现状:三个缺口(实测)

| 能力 | 模块 | 状态 |
|---|---|---|
| **控制** | `web.page` | 🟡 `find`/`facts`/`lease` ✅;**`goto` / `ready` / `prepare` 只有签名** |
| **输出** | `web.net` / `web.dom` | 🟡 实现了,但**零落盘**(纯内存,进程一关就没) |
| **输入** | `web.input` | ❌ **整个模块不存在** |
| 诊断 | `web.trace` | 🟡 实现了,未落盘 |

**补完 = 3 个方法 + 1 个模块 + 落盘。**

---

## 1. 控制:补完 `goto` / `ready` / `prepare`

### 1.1 为什么这三个至今没实现

它们**都需要真 webContents**(步 1 是纯逻辑核心,有意不碰)。
但 `goto` 还卡在另一件事上:**它收语义目标,而语义→URL 是 adapter 的知识**。

### 1.2 `goto` —— 语义导航

```
goto(pageId, target) → Arrived | Failed
    target: { kind: 'semantic', name: 'profile-posts', params?: {...} }
          | { kind: 'url', url: string }        ← ⚠️ 仅 adapter 内部可用
```

**分工**:

| 谁 | 做什么 |
|---|---|
| **底座** | 拿到 URL 后:导航 + **处理「站点自行接管导航」** + 确认到达 |
| **adapter** | 提供 `semantic name → URL` 的映射表 |

⭐ **底座必须内建的一条**(现在 9 处各写各的,只有 1 处做对):

> `loadURL` 常常**不 resolve** —— 站点自己接管了导航。
> 只有 `x-timeline-scan.ts:313` 处理了这个,其余 8 处没有。
> **收编后必须全覆盖**:`loadURL` 失败不等于导航失败,要继续等元素。

### 1.3 `ready` —— 等到位

```
ready(pageId, criterion, timeoutMs) → Ready | Timeout
    criterion: { anchor: '锚点名' }        // 某元素出现
             | { anchorGone: '锚点名' }    // 某元素消失(模态关闭)
             | { urlIncludes: string }
             | { custom: 预注册判据id }
```

⭐ **`anchorGone` 是必须有的**,不是可选:
X 发长文的每一步都要等「模态**关闭**」才能进下一步,
现在 `x-article-driver` 自己写了 `waitForSelectorGone`。

⚠️ **合并两份不等价实现**(`x/refactor-02` §1.4):

| | article-driver | write.ts |
|---|---|---|
| 多候选 selector | ❌ | ✅ 逗号分隔 |
| 注入异常重试 | ❌ | ✅ |
| 默认超时 | `DEFAULT_WAIT_MS` | 写死 6000 |

**收编时取并集**:多候选 + 重试 + 可配超时。

### 1.4 ⭐ `scrollUntil` —— 新增,控制层缺的最大一块

用户举的例子直接需要它:

> 控制 —— 跳转到 profile-post,**往下滚动**,从最新到约定位置

```
scrollUntil(pageId, stopWhen, options) → Result<ScrollReport>
    stopWhen: { atBottom: true }              // 滚到底
            | { rounds: n }                   // 滚 n 轮
            | { anchorAppears: '锚点名' }      // 出现某元素
            | { custom: 预注册判据id }
    options:  { stepRatio?, maxRounds?, settleMs? }
    报告:     { rounds, scrolledPx, reachedBottom, stopReason }
```

**必须内建的三条经验**(`x-timeline-harvester.ts` 注释里的血泪):

1. ⚠️ **不能用 `behavior:'smooth'`** —— 它是异步的,调用立刻返回、滚动尚未发生,
   紧接着回读 `scrollY` 读到的是**滚动前**的值 = 等于没测量
2. ⚠️ **`scrollY` 连续多轮不变才算到底** —— 一轮不变不算
3. ⚠️ **主文档滚不动时要找内部滚动容器**(`scrollHeight > clientHeight + 400`)

> ⭐ **必须与「捕获」解耦。** 现有 `harvestTimeline` 把
> `loadURL + 滚动 + 捕获 + 判停` **缝死在一个函数**里 ——
> 结果「只滚不抓」「抓但不导航」「换判停规则」全做不到。
> 拆开后:`goto` → `scrollUntil` → `capture` 各自独立,业务自由编排。

### 1.5 `prepare` —— 改变加载环境

```
prepare(target, environment) → Done | Failed
    target: { pageId } | { partition }
    environment: { stripCSP?, headers?, userAgent?, referer? }
```

现在只有网页翻译在用(剥 CSP 让 Google 脚本能跑)。
⚠️ 按 `06` §0:**底座只提供「能改」,改不改由应用决定**,不内置策略。

---

## 2. 输出:L-raw 落盘

规格见 `09`(已定:硬盘 / 默认开 / 1 个月 / 容量用户可配 / 请求头照存 / M4 也进)。
本节只定**索引**,即 `09` §6 待定项 a。

### 2.1 ⭐ 索引:七个字段,全部与站点无关

```
时间       什么时候抓的            (范围查)
host       域名                    (不是「站点知识」,就是 URL 的一部分)
URL        完整地址                (前缀 / 子串匹配)
pageId     哪个页面上下文抓的       (关联 web.page)
机制       M1/M2/M4/M5/M6/M8      (排查时区分来源)
状态       HTTP 状态码
大小       bytes
```

**为什么只有这七个**:L-raw 层「**站点知识 = 零,只认 URL 和 bytes**」(`09` §2.2)。
这七样是 **HTTP 本身的属性 + 我们自己的上下文**,任何网站都有。

> Chrome DevTools 的 Network 面板就是这个模型 ——
> 它能过滤**任何**网站的请求,正因为它一个网站也不「认识」。

### 2.2 站点特化的索引归 adapter

```
L-raw 索引    "x.com/…/UserByScreenName,昨天下午,200,45KB"   ← 底座建,通用
adapter 索引  "tweetId → bodyRef" / "这是画像,粉丝数在 legacy.followers_count"  ← X 的知识
```

**同一条缓存,X adapter 解得出画像,Reddit adapter 看不懂 —— 但两者都能被同一套索引找到。**

adapter 可在 L-raw 之上建自己的二级索引,**底座不需要知道它存在**。

### 2.3 索引的价值(为什么值得做)

| 现在做不到 | 有索引之后 |
|---|---|
| 排查靠猜(429 那次猜了一整天,至今未解) | **调出当时的原始响应,看站点到底返回了什么** |
| 解析器改进**只对新数据生效** | ⭐ **拿一个月历史重跑,当场看出改没改好** |
| 业务表 TTL 删了永久丢(74% 正文) | 一个月内可重建 |

> ⭐ 第二条最值钱:它把「改进解析」从**等数据攒够**变成**立刻可验证**。

---

## 3. 输入:`web.input`(整个模块)

### 3.1 收编已有的三个成品

`web-service-base` 已有,**含落地确认,是成品**:

| 现成 | 收编为 |
|---|---|
| `focusInputBox` | `focus` |
| `pasteTextToWebview` | `type`(合成 paste + 落地校验 + 兜底) |
| `feedFilesToInput` / `feedVideoToInput` | `feed`(喂文件 + 接住确认) |
| `locateSendButton` | 并入 `query`(**只定位不点**) |

### 3.2 ⭐ 作用域:主页面 / frame / 模态(用户点出的缺口)

用户明确要求定义:**「主页面、弹出子页面、子页面的子页面的输入」**。

我原设计**全部假设作用在主文档上** —— 这是个真缺口。X 的实际情况:

| 场景 | 在哪 |
|---|---|
| 发推 compose 框 | **弹出层**(模态) |
| 长文 Insert 菜单 → 弹模态 → 填内容 → 点 Update | **模态里的模态** |
| 回复框 | 有时内联、有时弹层 |

**`x-article-driver` 19 处注入,大半在处理这套。**

```
所有输入动作都接受可选作用域:
    scope: { kind: 'main' }                    // 主文档(默认)
         | { kind: 'frame', frameId }          // 某 iframe
         | { kind: 'within', anchor: '锚点名' } // 某容器内(模态)
```

⭐ **`within` 是关键**:它让「往**这个模态**里的输入框填字」可以精确表达,
而不是「往页面上第一个匹配的框填字」—— 后者在模态叠模态时会填错地方。

### 3.3 ⚠️ 脏态防护(现有代码踩出来的)

`x-article-driver.ts:377` 记着:

> 某 step 中途失败(如模态没关)→ 下一 step 在**脏态**(模态还开着 / 菜单还弹着)上启动 → 连环失败

**底座应提供**:`ready(pageId, { anchorGone })` 让调用方能确认"上一步真收尾了"。
**但「什么算脏态」是 adapter 的知识** —— 底座只提供判据能力,不判断。

### 3.4 完整接口

```
focus(pageId, anchor, scope?)          → Done | Failed
type(pageId, anchor, text, scope?)     → Landed | Failed    // 含落地确认
feed(pageId, anchor, files[], scope?)  → Landed | Failed    // 含接住确认
tap(pageId, anchor, scope?)            → Done | Failed      // 中立原语
press(pageId, key, scope?)             → Done | Failed
hover(pageId, anchor, scope?)          → Done | Failed
```

🔴 **`tap` 是中立的** —— 不分等级、不设词表、不拒绝任何目标(`06` §8.2)。
「绝不程序点发布」是**业务层**的规则,不在底座。

---

## 4. 补完顺序

| 序 | 做什么 | 为什么这个顺序 |
|---|---|---|
| **1** | `web.input`(§3) | 收编现成品,**风险最低**;X 写方向全靠它 |
| **2** | 控制的 `ready` + `scrollUntil`(§1.3/1.4) | ⭐ `scrollUntil` 是采集类业务的地基 |
| **3** | 控制的 `goto` + `prepare`(§1.2/1.5) | 依赖 adapter 契约(语义页面表) |
| **4** | L-raw 落盘 + 索引(§2) | 独立,可与 1-3 并行 |

> `goto` 排在后面是因为它**需要先定 adapter 契约**(语义名 → URL 表),
> 而那属于「具体业务对象」阶段。前三项都不需要。

---

## 5. 验收(沿用 `07` 的四类 + 双通道)

每项都要:
- **AI 验**:契约测试 + ⭐ **故障注入先红后绿**
- **人验**:验收台面板能看见(`07` §3.5.4)

特别的:

| 项 | 必须能红的注入 |
|---|---|
| `scrollUntil` | 改用 `smooth` → 测量失效,必须红 |
| `ready` | 去掉多候选 → 容错失效,必须红 |
| `type` 作用域 | 模态叠模态时填错层,必须红 |
| L-raw 索引 | 存了但查不回来,必须红 |

---

## 6. 待用户确认

1. **补完顺序**(§4:input → ready/scrollUntil → goto/prepare → 落盘)认可吗?
2. **`scrollUntil` 作为独立原语**(与捕获解耦)认可吗?
   这是拆开现有 `harvestTimeline` 的关键。
3. **输入的三种作用域**(main / frame / within)够用吗?
   还有没有 X 或别的站会遇到、这三种表达不了的?
