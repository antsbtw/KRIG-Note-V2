# Web 能力层 · 契约(总纲 + 三能力 + 数据模型)

> 立于 2026-09-09,由原 01/06/09/10/11 五篇合并而成。
> **想知道任何一个能力能做什么、数据长什么样 —— 只翻这一篇。**
>
> 配套:`02-testing.md`(验收) · `03-observability.md`(诊断维护) ·
> `09-history.md`(现状实测 / V1 移植 / 执行记录 / 推翻留档)

---

# 第一部分 · 总纲

## 1. 一句话

> **凡是在 app 里操作网页的功能,都只通过「控制 / 输入 / 输出」三个能力,
> 不直接碰 webContents、不自己 attach CDP、不自己拼注入脚本。**

## 2. ⭐ 贯穿全层的边界

> **底座只做两件事:如实呈现事实、忠实执行动作。所有判断都在应用层。**

| 底座做 | 底座不做 |
|---|---|
| 找得到页面、拿得到数据 | **不判断哪个页面「该」被操作** |
| 点了、填了,并确认真的成了 | **不判断哪个动作「危险」** |
| 如实记录发生了什么 | **不判断哪些数据「敏感」** |

## 3. 消费者(一族对等的 web 应用)

| 消费者 | 要网页干什么 | 取内容吗 | 现在走第几层 |
|---|---|---|---|
| **X** | 采集推文 / 填回复 / 发长文 | ✅ | **4 DOM** ← 该走 1 |
| **AI 对话** | 抓回答 / 填提问 | ✅ | 1 网络 ✅ |
| **网页剪藏** | 抓正文 | ✅ | **4 DOM** ← 该走 1 |
| **网页翻译** | 改响应头 / 注脚本 | ❌ **不取** | — |
| **音视频下载** | 借登录态取资源 | ✅ | 2 下载 ✅ |
| **邮件(仅阶段 0)** | 抓邮件正文 | ✅ | 4 DOM |
| **未来的专业站点** | 各行各业 | | **本层为它们而建** |

> ⚠️ **X 不是这层的主人,只是最痛的消费者。**
> 卡在第 4 层的两个(剪藏、X 主采集),恰是「一改版就失效」抱怨最多的两个。

## 4. 数据分层优先级(比三能力更根本)

```
1. 网络层    ← 正文优先走网络响应
2. 下载层    ← 附件优先走真实下载
3. Frame 层
4. DOM 层    ← 只做定位与结构辅助
5. 渲染截图  ← fallback,不是主链
```

## 5. adapter 的位置

```
  X   AI  剪藏 翻译 音视频 邮件  未来站点
  └───┴───┴───┴───┴─────┴───┐
              adapter 层     │ ← 只回答「这个站的正文在哪个接口 / 哪个锚点」
  ┌───────────────────────────┘
  │  Web 能力层:控制 · 输入 · 输出 + 诊断
  └───────────────────────────
              Electron webContents
```

**两条铁律**:

1. adapter **只做解释与增强**,不得反向定义底层模型
   —— 底座输出 `NetworkRecord`,不输出 `TweetRecord`
2. **加一个新站点 = 只写一个 adapter**,不再抄基础设施

## 6. 判据:怎么算建成了

| 判据 | 含义 |
|---|---|
| ⭐ **站点改版只改一层** | 改 adapter,不动业务、不动底座 |
| **加新站点只写 adapter** | 接第二个消费者时,新增基础设施 = **0** |
| **业务拿不到 `webContents`** | 物理上绕不过去,守卫才有牙齿 |
| **没有落地确认就不算成功** | 契约强制,不靠自觉 |
| **通道哑了会自己举手** | 不再静默失聪 |
| **站点改版可统计** | 「格式外」计数上升 = 那个站改了 |

## 7. 红线

| 红线 | 落点 |
|---|---|
| 🚦 **发布闸门**(默认关,见 §7.1) | ⚠️ **业务层**,不在底座 |
| **不要静默兜底** | 全层:三态结果契约 |
| **失败要留痕** | `web.trace` |
| **成功要对账** | 落地确认 + 分母 |
| **守卫要验证能真的失败** | 每条守卫必须故意注入违规看它变红 |

### 7.1 🚦 发布闸门(2026-09-09 由「红线」改为「闸门」)

> **程序默认不点发布**,除非**同时**满足四个条件:
> 1. 用户对**该场景**显式授权(带范围、可撤回 —— **不是全局开关**)
> 2. **可量化判据达标**(现有机制:分语言原样通过率 ≥80% 且样本 ≥50 条)
> 3. 有**速率限制与紧急停止**(失效模式必须是「停下来」,不是「继续发」)
> 4. 每次自动发布**留痕可追溯**

⚠️ **这是工程约束,不是道德律** —— 条件满足即可开闸。
**当前状态:未达标,故全部关闭。**

**分级建议**(按**可撤回性**,不一刀切):

| 动作 | 后果 | 建议 |
|---|---|---|
| 点赞 / 收藏 | 可撤销 | 达标后可自动 |
| **回复** | 对方收到通知,删了也已被看到 | 达标 + 范围内可自动 |
| **发原创推 / 长文** | 面向所有关注者,是账号的公开表达 | **建议长期保持人工** |

⚠️ **开闸前必须先补一个缺口**:现在**无从知道用户是否真的点了发布**
(`../../x/persistent-tracking-and-profiling.md` §埋点)——
连「发没发出去」都不确定,就谈不上留痕追责。

> 设计上早有准备:`x-reply-feedback-repo.ts:71` 写着
> 「放手自动的门槛 —— **可调常量**,不是硬编码的魔数」,
> `:11` 写着「把『**能不能放手**』变成**可量化判据**(分语言算),而不是靠感觉」。
> **当初的设计就不是「永不自动」,是「证明可靠之前不自动」。**

---

## 8. 通用类型(三能力共用)

```ts
// result.ts —— 三态,没有第四态
Ok<T>          { status:'ok';        value: T }
Failed         { status:'failed';    reason: string; retryable: boolean }
Degraded<T>    { status:'degraded';  value: T; missing: readonly string[] }
type Result<T> = Ok<T> | Failed | Degraded<T>
```

**不许「返回空值假装成功」。** `Degraded` 专为本仓场景:
抓了 80/100 条、喂图成功但缩略图没校验 —— 当 Ok 是撒谎,当 Failed 是冤枉。

```ts
PageId       不透明串,页面创建时分配一次,生到死不变
AnchorName   锚点语义名(由 adapter 解释成 selector)
ScriptId     预注册脚本 id
Rect         { x, y, width, height }
```

---

# 第二部分 · 控制(`web.page`)

## 9. 能力

```
find(query)                    → PageFacts[]        不排序、不筛选、不替你选
facts(pageId)                  → Result<PageFacts>
goto(pageId, target)           → Result<PageFacts>  语义目标,不收裸 URL
ready(pageId, criterion, ms)   → Result<PageFacts>
scrollUntil(pageId, stop, opt) → Result<ScrollReport>   ⭐ 新增
lease / release                → 并发占用
prepare(target, environment)   → 改变加载环境
```

## 9.1 身份模型

```ts
type PageFacts = {
  pageId: PageId;          // 不透明,生到死不变
  window; ws; slot; tabId?; partition;   // 位置(可变)
  owner; service?; url; state;           // 归属与状态
};
```

**三条不变量**:
1. `pageId` **不透明** —— 应用不解析、不构造、不从维度拼
2. `pageId` **稳定**,`wcId` 易变 —— webview 重挂后 wcId 变、pageId 不变
3. 应用**只见 pageId**,永远拿不到 `webContents`

**同一性**:「同一个浏览上下文」= 同一个 pageId。
webview 重挂 / SPA 导航 / 换 slot / 换窗口 / 拖 tab / **跨站导航** → 不变;
tab 关闭 → 销毁;新开 tab → 新建。

> ⚠️ **`partition` 必须在 facts 里**:V2 的 partition 是 per-ws
> (`persist:webview-${ws}`),而 `prepare` 剥 CSP 是**整个 partition 生效** ——
> 拿不到 partition 就回答不了「这次改动会波及哪些别的页面」。

## 9.2 `find` 的唯一铁律

**找到多个时不许自作主张挑一个。**

底座不保证「挑得对」,只保证「不替你挑」。
挑错了是应用的问题;**悄悄替你挑是底座的问题** ——
`createWebviewServiceRegistry` 的「最后 navigate 胜出」就是这么出的 bug。

## 9.3 `goto` —— 语义导航

```ts
type PageTarget =
  | { kind:'semantic'; name: string; params?: Record<string, unknown> }
  | { kind:'url'; url: string };   // ⚠️ 仅 adapter 内部可用
```

| 谁 | 做什么 |
|---|---|
| 底座 | 导航 + **处理「站点自行接管导航」** + 确认到达 |
| adapter | 提供 `semantic name → URL` 映射 |

⭐ **底座必须内建**:`loadURL` 常常**不 resolve**(站点接管了导航)。
现在 9 处只有 `x-timeline-scan.ts:313` 处理了,**收编后必须全覆盖**。

## 9.4 `ready` —— 等到位

```ts
type ReadyCriterion =
  | { kind:'anchorAppears'; anchor: AnchorName }
  | { kind:'anchorGone';    anchor: AnchorName }   // ⭐ 模态关闭判据,必须有
  | { kind:'urlIncludes';   fragment: string }
  | { kind:'custom';        script: ScriptId };
```

⚠️ **合并两份不等价实现**(取并集):多候选 selector + 注入异常重试 + 可配超时。

## 9.5 ⭐ `scrollUntil` —— 控制层最大的新增

```ts
type ScrollStop =
  | { kind:'atBottom' }                          // 连续多轮 scrollY 不变
  | { kind:'rounds';  n: number }
  | { kind:'anchorAppears'; anchor: AnchorName }
  | { kind:'custom';  script: ScriptId };

type ScrollOptions = {
  stepRatio?: number;      // 每轮滚屏高的几成(默认 0.55~0.85 抖动)
  maxRounds?: number;
  settleMs?: number;       // 每轮后等渲染
  stuckRounds?: number;    // ⭐ 连续几轮不变才算到底(默认 ≥3)
};

type ScrollReport = {
  ok: boolean;
  problems: readonly string[];   // ⭐ 空数组才算过关
  rounds: number;
  scrolledPx: number;
  reachedBottom: boolean;
  stopReason: string;
  trace: readonly RoundTrace[];  // 每轮:scrollY / docHeight / stuck / 耗时 / 是否滚的内部容器
};
```

### ⭐ 必须内建的四条血泪(`x-timeline-harvester` 注释,改动前先读)

> **实测代价**:滚动逻辑曾散在三个文件,同一 bug 修三遍,**每次都以为修好了**。
> 用户拿官网数据一核对 —— **10 天 433 条回复,库里只有 81 条(19%)**。

| # | 坑 | 约束 |
|---|---|---|
| ① | `behavior:'smooth'` 是**异步**的,调用立刻返回、滚动尚未发生,之后读 `scrollY` 读到的是**滚动前**的值 | **必须同步 `scrollBy`,滚动之后才回读** |
| ② | 站点用**虚拟列表**,滚过的元素会被从 DOM 删除,「当前 DOM 条数」不是进度(实测出现 +0 / −1) | **进度只看跨轮累计的去重 id 数** |
| ③ | 「没有新数据」≠「到底了」(时间线夹着别人的推很正常),急着停是漏数据元凶 | **只有 `scrollY` 连续多轮不变才算真到底** |
| ④ | 「见过的最旧一条」≠ 覆盖深度(站点把置顶/热门旧内容排在前面,一条 3 月的推就让判据误以为覆盖 166 天) | **日期只做显示,绝不做停止判据** |

### ⭐ 三层自校验(用户要求「包含校验方法」)

任何一层不过都要**如实标红**,不许静默:

```
A. 滚动确实发生了      scrollY 单调增长 / 最终 stuck
B. 抓到的条数 vs 分母   有基线时对账
C. 时间连续性          日期有没有大洞(洞 = 漏采信号)
```

> ⚠️ **`trace` 里绝不许出现「条数」字段**(2026-09-09 更正,执行者发现):
> 契约初稿写「每轮:scrollY / **新增数** / 耗时」—— 但**「新增数」正是血泪② 禁止的东西**。
> 本层只滚不抓,根本不知道「新增了什么」;唯一能数的只有 DOM 条数,
> 而那恰恰是「**不涨反降**」的陷阱。
>
> (现有 `x-timeline-harvester` 的 `RoundTrace` 确实有 `domArticles/cumulative/newThisRound` ——
> 但它是**滚+抓合体**的函数,那些字段属于「抓」的那一半;**拆开后它们归 `capture`**。)

### ⭐ 校验没过时返回什么态

**`Degraded`**,`missing = problems`(2026-09-09 裁定)。

理由:滚了多少是真的、`trace` 是真的,只是**不完整** ——
当 `Failed` 会让调用方**丢掉已滚出的进度**,当 `Ok` 就是「滚了个寂寞却报成功」。

> ⭐ **统一原则**(与 `tap.settle` / `check:'none'` 同源):
> **凡「做了但不完整」一律 `Degraded`;「做了且完整」才是 `Ok`;「没做成」才是 `Failed`。**

### ⭐ 必须与「捕获」解耦

现有 `harvestTimeline` 把 `loadURL + 滚动 + 捕获 + 判停` **缝死在一个函数**里,
结果「只滚不抓」「抓但不导航」「换判停规则」**全做不到**。

**拆开后**:`goto` → `scrollUntil` → `capture` 各自独立,业务自由编排。

## 9.6 `prepare` —— 改变加载环境

```ts
type PrepareTarget = { pageId } | { partition: string };
type PrepareEnvironment = { stripCSP?; headers?; userAgent?; referer? };
```

网页翻译的「剥 CSP 让 Google 脚本能跑」是唯一现有消费者。
⚠️ 底座只提供「能改」,**改不改由应用决定**,不内置策略。

---

# 第三部分 · 输入(`web.input`)

## 10. 边界:管动作,不管内容

用户已裁定:**格式不能统一**(不同网站、不同输入框各有格式)。

| 管(动作) | 不管(内容) |
|---|---|
| 怎么把文本**真的放进框里** | 该是什么格式 |
| 怎么确认**真的落地了** | 内容对不对 |
| 怎么把文件**真的喂给上传控件** | 该喂哪个文件 |
| 往**哪个作用域**填 | 哪个模态是「对的」 |

**markdown 的位置**:业务侧以 markdown 为源,**adapter 转成目标格式**
(X 发推要纯文本、X 长文要 HTML、AI 提问要纯文本)。**底座不认识 markdown。**

## 10.1 ⭐ 作用域(核心新增)

```ts
type InputScope =
  | { kind:'main' }                            // 缺省
  | { kind:'frame';  frameId: string }
  | { kind:'within'; container: AnchorName };  // ⭐ 模态 / 抽屉 / 下拉
```

**为什么必须有**:X 长文是「点 Insert → 弹菜单 → 点项 → **弹模态** →
往模态里填 → 点 Update → **等模态关闭**」——`x-article-driver` 19 处注入大半在处理这个。

没有作用域,`type` 只能「往页面上第一个匹配的框填」——**模态叠模态时会填错地方**。

```ts
type ScopeResolution =
  | { ok:true;  scopeDesc: string }
  | { ok:false; reason:'frame-not-found'|'container-not-found'|'ambiguous' };
```

⚠️ **`ambiguous` 必须报错,不许挑第一个** —— 与 `find` 同源。

## 10.2 落地确认

```ts
type LandingCheck =
  | { kind:'none' }                                 // ⚠️ 必须显式写
  | { kind:'contains'; fragment: string }
  | { kind:'exact' }
  | { kind:'anchorAppears'; anchor: AnchorName }     // 缩略图 / 转码完成
  | { kind:'custom'; script: ScriptId };

type LandingReport = {
  checked: boolean;
  landed: boolean;
  via: 'synthetic-paste'|'exec-command'|'native-setter'|'os-paste'|'unchecked';
  attempts: number;
};
```

> ⭐ `via` 是新增的:现有实现有**三级兜底**,但走了哪条只在 console。
> **出问题时这是第一条线索** —— 「填错格式」和「主路径失效降级了」是两回事。

> ⚠️ `kind:'none'` 必须显式:**不校验是明确的选择,不能是默认**
> —— 省略参数的人可能只是忘了。

**`check:'none'` 返回什么**(2026-09-09 裁定):返 **`Ok`**,
且 `checked:false / landed:false / via:'unchecked'`。

理由:调用方**显式选了不校验**,这是「按要求做完了」不是「部分失败」;
而 `Degraded` 要求 `missing` 非空,硬套会逼出一个「缺了校验」的**假 missing**。

⭐ 但**绝不许谎称 `landed:true`** —— 即使内容事实上进去了。
「没检查」和「检查过了是好的」必须分得开。

**`tap` 的 `settle` 未满足返回什么**:返 **`Degraded`**,`missing` 写明等的是什么。
理由:点**确实成功了**(不是 Failed),但下一 step 会在**脏态**上启动(不能是 Ok)
—— 这正是 `Degraded` 存在的场景。

## 10.3 动作

```ts
type TypeInput  = { pageId; anchor; text; html?; scope?; check? };
type FeedInput  = { pageId; anchor; files: string[]; scope?; check?; timeoutMs? };
type TapInput   = { pageId; anchor; scope?;
                    settle?: { anchorGone?: AnchorName; anchorAppears?: AnchorName } };
type PressInput = { pageId; key; scope? };
type HoverInput = { pageId; anchor; scope? };
type FocusInput = { pageId; anchor; scope? };
```

🚦 **`tap` 是中立原语** —— 不分等级、不设危险词表、不拒绝任何目标。
**发布闸门**(§7.1)是 **X 业务层**的规则:闸门关闭时,X 写方向代码不调 `tap` 点发布按钮。

> 证据:同一个「发送按钮」,**AI 必须自动点**(问答语义),**X 绝不能点**(发布不可撤回)。
> 差别在**业务语义**,不在按钮本身 —— 底座无从判断。

> ⭐ `settle`:某 step 中途失败(模态没关)→ 下一 step 在**脏态**上启动 → 连环失败。
> 把「点完等什么」放进模型,让脏态在**类型层面可被表达**。

⚠️ 图和视频的判据不同:图是「缩略图出现」(秒级),视频是「**转码完成**」(60s+)。
同一个 `check` 表达,**由 adapter 给不同判据**。

## 10.4 收编现成品

`web-service-base` 已有且**含落地确认,是成品**:

| 现成 | 收编为 |
|---|---|
| `focusInputBox` | `focus` |
| `pasteTextToWebview` | `type`(合成 paste + 校验 + 三级兜底) |
| `feedFilesToInput` / `feedVideoToInput` | `feed` |
| `locateSendButton` | 并入 **`web.dom` 的 `query`**(只定位不点)⚠️ 见下 |

**要补**:作用域 · `tap`/`press`/`hover` · 三态契约。

> ⚠️ **`locateSendButton` 的落点有缺口**(2026-09-09 执行者发现,已核实):
> 它返回 `{ found, enabled }`,而 `web.dom` 的 `DomAnchor` 只有
> `{ anchor, found, rect?, text? }` —— **没有 `enabled`**。
>
> 而 `enabled` 正是它的全部价值:X 侧用「发布按钮**已可点**」当
> 「内容落进了正确的框」的辅助信号。
>
> **裁定:给 `DomAnchor` 补 `enabled?: boolean`**(读 `disabled` / `aria-disabled`)——
> 它与 `found`/`rect`/`text` 同类,都是 **DOM 事实、零站点知识**。
> 记账待迁 X 时一并做(本步不改 `web.dom`,不在范围)。

> ⭐ **`web.input` 不是从零写,是收编 + 补齐** —— 四个模块里最省事的一个。
> 它内含的知识(webview 焦点隔离、DraftJS 丢行、合成 paste)**全是浏览器知识,
> 零站点知识**,且已被 AI / X 三处共用验证。

## 10.5 本轮不实现

**`frame` 分支**:实测 X / AI 现有代码**零处操作 iframe**。
保留类型位置,真遇到再补(`web.page` 届时要补 `frames()`)。

---

# 第四部分 · 输出(`web.net` / `web.dom`)

## 11. 能力

```
web.net:
  subscribe(pageId, matcher, listener) → unsubscribe   ⭐ 应用只订阅,永不 attach/detach
  waitFor / list / body / downloads

web.dom:
  read(pageId, extractId, params)  → 数据
  query / text / selection
  run(pageId, scriptId, params)    ⭐ 只接受预注册脚本 id,不接受脚本字符串
```

### 11.1 CDP:单一持有者模型

provider 装上**就不 detach**,应用**完全不碰 debugger**。
**「最后一个人关灯」这个时刻根本不存在** —— 也就无从关错灯。

⚠️ **不用引用计数**(有「最后一个走」的时刻就有关错的可能)。

**故障必须送达订阅者**(`subscribe` 签名里原本没有承载它的位置):

```ts
{ kind:'channel-failed'; pageId; reason; retryable }   // attach 失败
{ kind:'channel-lost';   pageId; reason }              // 被外部抢占 / 页面销毁
```

⚠️ **这两个 kind 不受 `matcher.kinds` 过滤** —— 否则订阅者按 kinds 过滤时
会把告警本身滤掉,**等于白做**。

### 11.2 `run` 的类型层面根治

**只接受预注册脚本 id + 参数,不接受脚本字符串。**

治的是这个事故:模板字面量吃掉 `\/` → 浏览器收到非法正则 →
整段解析失败 → **采集恒 0 一整天,而 tsc 和单测全绿**。

⚠️ 参数必须 `JSON.stringify` 后**作为绑定值**注入,**绝不拼进脚本文本**。
逃生口:`runDynamic`(**显式标注 + 仅 dev**)。

## 12. ⭐ 取数机制全集(8 种,不是 2 种)

| # | 机制 | 拿到什么 | 谁在用 |
|---|---|---|---|
| **M1** | CDP `Network` 域 | 渲染**前**原始响应体 | `web.net` · AI(Gemini) · X 6 模块 |
| **M2** | 注入 fetch/XHR hook(**SSE 属此类**) | 站点自己的请求响应 | ChatGPT / Claude |
| **M3** | `session.webRequest` | 仅**元信息**(无 body) | `web.net` · 翻译 |
| **M4** | DOM 直读 | 渲染**后**内容 | **全仓 36 文件**(其中 X 占 13 文件 / 46 处)—— 最广 |
| **M5** | 页面内主动 fetch(带登录态调站点 API) | 完整数据 | Claude / Gemini |
| **M6** | 下载管线 | 真实文件 bytes | web-download |
| **M7** | cookies 导出 | 登录态 | ytdlp |
| **M8** | postMessage 桥 | iframe/widget 内部 | Claude artifact |

> ⚠️ **M4 用得最广(全仓 36 文件),保真度却最低** —— 这正是「一改版就失效」的根源。

## 13. ⭐ 缓存三层

| 层 | 存什么 | 面向谁 | 保留 | 能重算? |
|---|---|---|---|---|
| **L-raw** | 原始响应体 / 文件 | **排查 / 回放 / 重解析** | **1 个月**(可配) | ❌ |
| **L-struct** | 解析后的领域对象 | 业务(中间态) | 会话级 | ✅ 从 L-raw |
| **L-domain** | `x_tweet` / note / … | 最终用户 | 业务规则定 | ⚠️ 部分 |

**学费背书**:`tweet_feedback` 607 条历史采纳里 **449 条(74%)正文被 TTL 删掉**
—— 因为当时**只有 L-domain**。有 L-raw 后:业务表删了,一个月内还能重建。

### 13.1 L-raw 落盘规格(用户已定)

| 项 | 决定 |
|---|---|
| 存哪 | ⭐ **硬盘**(不进 SurrealDB)—— 「未整理的数据」 |
| 默认 | ⭐ **开,不要用户干预** |
| 保留 | 1 个月 |
| 容量 | ⭐ **用户可配**:给宽松默认值(不是硬上限),用户可改、可设 `Infinity` |
| 请求头 | ⭐ **照存,参考 Chrome** —— 排查需要完整现场;不外发、不上报、清理时一并清 |
| M4 | ⭐ **也进 L-raw** |

> ⭐ **缓存层无条件、无分支地收下一切。**
> 初稿曾想「M4 不存」以省空间,被否决:那要引入分支规则
> (每个调用点判断自己属于哪类,**判断错就丢数据**),
> **存储端加判断 = 拿可靠性换空间**,而空间恰是最不稀缺的。
>
> 「不设上限」≠「不管」:底座责任从**限制**变成**让用户看得见、管得着**
> —— 占用可查、可清理、将满时告警。

> ⚠️ **「不写死上限」与「将满时告警」怎么共存**(2026-09-09 澄清):
> `maxBytes` 是**默认值不是硬上限** —— 用户可改成 `Infinity`。
> 告警线 = `maxBytes × warnRatio`;设成 `Infinity` 时**恒不告警**
> (**等于放弃告警,这是用户的选择**)。
>
> ⚠️ 真正的「**磁盘**将满」告警要读剩余磁盘空间(`statfs`),那需要 fs ——
> **属接线层,记账待做**。

### 13.2 索引:七个字段,全部与站点无关

```
时间 · host · URL · pageId · 机制(M1..M8) · HTTP 状态 · 大小
```

**为什么只有这七个**:L-raw 层**站点知识 = 零,只认 URL 和 bytes**。
这七样是 HTTP 本身的属性 + 我们自己的上下文,**任何网站都有**。

> Chrome DevTools 的 Network 面板就是这个模型 —— 它能过滤**任何**网站的请求,
> 正因为它一个网站也不「认识」。

**站点特化的索引归 adapter**:X adapter 可建 `tweetId → bodyRef` 映射,
存在 X 侧,**底座不需要知道它存在**。

```
底座    大海 + 坐标(时间 / URL / 大小)
adapter 航海图(哪片海域有什么)
```

### 13.3 索引的价值

| 现在做不到 | 有索引之后 |
|---|---|
| 排查靠猜(429 那次猜了一整天,至今未解) | **调出当时的原始响应** |
| 解析器改进**只对新数据生效** | ⭐ **拿一个月历史重跑,当场看出改没改好** |
| 业务表 TTL 删了永久丢(74% 正文) | 一个月内可重建 |

> ⭐ 第二条最值钱:把「改进解析」从**等数据攒够**变成**立刻可验证**。

---

# 第五部分 · adapter 契约

## 14. 加新站点只写这一个

| 提供什么 | 例(X) |
|---|---|
| **URL 识别** | 这个 URL 是不是我的站 |
| **语义页面表** | `compose` → `/compose/post`;`profile-posts` → `/{handle}` |
| **锚点表** | `composeBox` → selector(支持多候选)+ **是否待 spike** |
| **载荷解释** | 哪个接口是正文,怎么解析成领域对象 |
| **格式转换** | markdown → 本站要的格式(纯文本 / HTML) |

**两条铁律**:

1. adapter **只做解释与增强**,不得反向定义底层模型
2. adapter **拿不到** `webContents`、**不能** attach CDP、**不能**拼注入脚本

> 锚点**不分 Actionable / LocateOnly**(底座不做危险性判断),
> 但保留「**是否待 spike**」标记 —— X 现有 selector 表里大量
> 「待实机抓真实 data-testid」的初值,**这个不确定性必须显式**。

---

## 15. 补完状态(2026-09-09 · ⭐ 底座已补完)

| 能力 | 模块 | 状态 |
|---|---|---|
| **控制** | `web.page`:`find`/`facts`/`lease` | ✅ |
| | `ready` + `scrollUntil` | ✅ **已完成** |
| | `goto` + `prepare` | ❌ **待 adapter**(需语义页面表) |
| **输入** | `web.input`(含作用域) | ✅ **已完成** |
| **输出** | `web.net` 订阅 / 关联 / 故障广播 | ✅ |
| | `web.dom` `run` / `read` | ✅ |
| | **L-raw 落盘 + 索引** | ✅ **已完成** |
| 诊断 | `web.trace` 记录 + 探针 | ✅ |

> 验收记录见 `09-history.md` 第四部分。**全程零改现有代码**,
> `tests/x/` 512 基线始终全绿。

### 15.1 ⚠️ 但没有一条真实数据流进过新层

**接线阶段三笔记账**:

1. 接管 `net/bus.ts:483 storeBody` —— 让载荷真的流进来
2. ⭐ **启动时 `loadIndex()` 重建内存索引** —— 否则落盘的数据**查不回来**
3. `ready`/`scrollUntil` **尚未挂进 `WebPage` 接口** —— 能力建好了但调不到
4. 磁盘剩余空间告警(需 `statfs`)

> ⚠️ **第 2 条比「补个调用」严重**(2026-09-09 核实):
> `FsRawSink.loadIndex()` **有**(`wiring/fs-raw-sink.ts:98`,返回 `{ entries, badLines }`),
> 但 `RawStore` **没有任何方法能把 entries 收回去** —— 公开面
> (`put`/`body`/`query`/`entry`/`usage`/`purge*`)全是单向写入,
> 构造函数只吃 `quota`/`sink`/`now`。
> **需要新开一个 hydrate 入口**,并定「分片损坏(`badLines` 非零)时怎么办」——
> 按铁律不许静默吞。**这是设计,不是接线。**

> ⚠️ **第 3 条同样比记的重**:`page/index.ts` **压根没导出 `control.ts`**,
> 所以 `ready`/`scrollUntil` 不只是「没挂进 `WebPage`」,而是**不在包的公开面上**。
> 且 `WebPage.ready()` 的签名与 `ControlEngine.ready()` **不一致**,合并时要选一个形状。

### 15.2 ⭐⭐ 第一个真实消费者已确定:X 的「盯页作业」

用户 2026-09-09 指出:X 四种采集策略(关键词 / 常规浏览 / 盯推 / 盯人)
**共用同一个骨架** ——「**盯住一个页面,对这个页面进行操作**」。

实测验证成立:`scanRecipe` / `harvestTimeline` / `x-article-replies` 三者
**逐条同构**,唯一真差异是「URL 怎么来」和「什么时候停」。

⭐ **这正是 §9.5「必须与捕获解耦」那条的真实用例**,也解释了
`x-timeline-harvester` 文件头那句「滚动逻辑曾散在**三个文件**,同一 bug **修三遍**」
—— **那三个文件就是这三个策略**。

**分层裁定**(详见 `../../agent/Module5-02-x-pipeline.md` §1.2.2):

```
底座    goto → ready → scrollUntil → capture      只有一份实现
业务层  ① 去哪  ② 怎样算到位  ③ 什么时候停        策略 = 三个答案
```

⚠️ **「什么时候停」是判断,所以停止条件由调用方传** —— 与 §2 铁律、
§9.2 `find` 不替调用方挑同源。底座只提供「能滚、能停」。

✅ 现有 `scrollUntil(pageId, stop, options)` 的签名**正好承载第③个答案**,
形状不用改。

#### ⚠️ 对接线范围的影响

这给路线 A **增加了范围**:原本四笔债只是「让数据流进新层」,
现在还要把 X 的三处滚动**收编进 `scrollUntil`**。

⚠️ **风险不对称,顺序不可颠倒**:

| | 状态 |
|---|---|
| `scrollUntil` | 写完了、有测试,⚠️ **一条真实数据没跑过** |
| `harvestTimeline` | ⭐ **真机验证过** —— 那四条血泪是它踩出来的 |

```
① 先让 scrollUntil 跑通一条真实链路(观察窗看着)
② 与 harvestTimeline 对账 —— 同一页面、同样条数?
③ 确认等价后,才删旧实现
```

⭐ **用户 2026-09-09 定:先收一个(`keyword`)验证,不要三个一起收。**

### 15.3 ⭐ 接线要与观察窗一起做

见 `03-observability.md` §8.5。接线的验收难点是「**怎么确认数据真的流进去了**」,
观察窗就是那个答案;倒过来做只能靠临时脚本自证。

观察窗四条已定(同上 §8):开关**只控显示不控记录** · 发布版**保留记录默认不显示** ·
多窗口**每窗口一个共享只读数据** · 形态待选(浮窗 / 全浮窗 / 底部抽屉)。
