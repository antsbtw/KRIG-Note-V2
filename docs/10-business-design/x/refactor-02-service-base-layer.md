# X 服务基础层 · 控制 / 输入 / 输出

> 立于 2026-09-07。承接 `refactor-01-capability-inventory.md`。
> 用户拍板:「这个是 x 服务的基础层,控制、输入、输出。这层稳健了,功能才能够得以实现。」
>
> **本文只定义三部分的内容边界与契约,不写实现,不改代码。**

---

## 0. 为什么是这三部分

上面 38 项业务能力(采集/判断/回复/发布/入向/活动),不管哪一条,
落到 X 上都只做三件事:

| | 一句话 | 回答的问题 |
|---|---|---|
| **控制** | 我操作的是哪个 X 页面,它现在是什么状态 | 「去哪个页面、操作哪个窗口」 |
| **输入** | 我往 X 里放什么(文字/文件/点击) | 「填写哪些内容」 |
| **输出** | 我从 X 里取出什么,以及怎么确认真成了 | 「确认」 |

业务层只该说**「我要什么」**,基础层负责**「怎么拿到 / 怎么放进去 / 怎么证明成了」**。

现状是反的:业务模块各自实现基础动作,于是同一个坑要修 N 遍。
下面每一节先给**实测证据**,再给**契约定义**。

---

## 1. 控制层 —— 操作哪个窗口、它在什么状态

### 1.1 职责

| 子项 | 内容 |
|---|---|
| **定位** | 从 wsId / wcId 找到正确的 X webContents |
| **导航** | 去某个 X 页面,并保证「真的到了」 |
| **就绪** | 页面元素/数据到位了没有 |
| **生命周期** | 页面被销毁 / 被别人抢走 / 无人值守时怎么办 |
| **并发仲裁** | 多个业务同时要用同一个 X 页面时谁先谁后 |

### 1.2 ✅ 实测现状:定位已经收口了,而且收得不错

[x-webcontents.ts](../../../src/platform/main/x/x-webcontents.ts) 已经是一个**合格的控制层雏形**:
三个入口语义清晰(带 poll / 不带 poll / 无人值守),fail loud,注释写清了为什么。

**16 个模块走它,只有 3 处裸抓 wc**:

| 模块 | 裸抓处 | 判断 |
|---|---|---|
| `x-drag-drop.ts` | 1 | ⚠️ 待查是否合理 |
| `x-timeline-handlers.ts` | 2 | ⚠️ god-hub 顺手抓 |
| `x-timeline-scan.ts` | 1 | ⚠️ 待查 |

> **结论:定位这一项不用重做,只要把 3 处漏网的收进来 + 加守卫禁止裸抓。**
> 这是整个基础层里**唯一已经接近达标**的部分。

### 1.3 ❌ 实测现状:导航 9 处各写各的,且行为不一致

| 位置 | 处理「X 自行接管导航」 |
|---|---|
| [x-timeline-scan.ts:313](../../../src/platform/main/x/x-timeline-scan.ts) | ✅ catch 后继续等元素 |
| x-write.ts:171 / 240 | ❌ |
| x-article-driver.ts:604 | ❌ |
| x-parent-tweet.ts:56 | ❌ |
| x-timeline-harvester.ts:278 | ❌ |
| x-article-replies.ts:252 | ❌ |
| x-payload-inspector.ts:179 | ❌ |
| x-author-timeline-spike.ts:261 | ❌ |
| x-timeline-handlers.ts:271 | ❌ |

**同一个坑修了 1 处,还开着 8 处。**

### 1.4 ❌ 实测现状:就绪判断有两份不等价实现

| | [x-article-driver.ts:84](../../../src/platform/main/x/x-article-driver.ts) | [x-write.ts:106](../../../src/platform/main/x/x-write.ts) |
|---|---|---|
| 多候选 selector(容错 X 改版) | ❌ | ✅ 逗号分隔顺序命中 |
| 注入异常重试 | ❌ 无 try | ✅ catch 后重试 |
| 默认超时 | `DEFAULT_WAIT_MS` | 写死 6000 |

「容错 X 改版」这个能力**只有一半代码有**。

### 1.5 控制层契约(建议)

```
locate(wsId | wcId, 用途)        → wc | 明确错误      // 已有,补 3 处漏网
navigate(wc, url)                → 到达 | 明确错误    // 内含 X 接管导航处理
waitReady(wc, 判据, timeout)     → 就绪 | 超时        // 多候选 + 重试,统一
release(wc)                      → 释放占用           // 见 §3.4 并发仲裁
```

**铁律候选**:
- 业务模块**不得**直接 `webContents.getAllWebContents()` / `fromId`
- 业务模块**不得**直接 `wc.loadURL`
- 「到达」不等于「就绪」,两者必须分开表达

---

## 2. 输入层 —— 往 X 里放什么

### 2.1 职责

| 子项 | 内容 |
|---|---|
| **定位元素** | 往哪个框填 —— selector 的单一来源 |
| **注入文本** | 合成 paste 事件(记忆:OS Cmd+V 送不达、execCommand 丢行) |
| **喂文件** | 图/视频走 DataTransfer 喂 `<input type=file>`(路线 B) |
| **模拟交互** | 点击、滚动、聚焦 |
| **脚本封装** | `executeJavaScript` 的安全包装 |

### 2.2 ⚠️ 实测现状:selector 注册表存在,但被 9 个模块绕过

[x-service-types.ts](../../../src/shared/types/x-service-types.ts) 里的 `XServiceSelectors`
写得很认真 —— 注释详尽、标了哪些待 spike、标了写方向红线。

**但只有 4 个模块用它**:`x-article-driver` / `x-extract-tweet` / `x-drag-drop` / `x-write`

**另外 9 个模块硬编码 `data-testid`,共 33 处**:

| 模块 | 硬编码处数 |
|---|---|
| `x-author-timeline-spike` | 8 |
| `x-drag-drop` | 6 |
| `x-self-account` | 4 |
| `x-parent-tweet` | 4 |
| `x-capture-monitor` | 4 |
| `x-timeline-scan` | 2 |
| `x-article-driver` | 2 |
| `x-timeline-harvester` / `x-extract-tweet` / `x-article-replies` | 各 1 |

> X 一改版,改注册表**不管用** —— 还得去 9 个文件里翻。
> 注册表存在却被绕过,比没有注册表更危险:它给人一种「已经收口了」的错觉。

### 2.3 ⚠️ 实测现状:46 处裸注入,血教训只守住了 1 处

`executeJavaScript` 全模块 **46 次,散在 13 个文件**:

| 模块 | 注入处数 |
|---|---|
| `x-article-driver` | 19 |
| `x-timeline-scan` / `x-drag-drop` | 各 5 |
| `x-author-timeline-spike` | 4 |
| 其余 9 个模块 | 各 1-2 |

记忆 `project-x-inject-template-escape` 记的事故:
**模板字面量吃掉 `\/` → 浏览器收到非法正则 → 整段解析失败 → 采集恒 0 一整天,
而 tsc 和单测全绿。**

守卫 `inject-script-evaluates.test.ts` 只覆盖了出事的那一处。
**另外 45 处仍可能重蹈覆辙。**

### 2.4 输入层契约(建议)

```
sel(名字)                        → selector          // 唯一来源,禁止硬编码
inject(wc, 脚本, 参数)           → 结果 | 明确错误    // 参数化传值,不拼字符串
typeText(wc, 目标, 文本)         → 落地确认           // 合成 paste
feedFile(wc, 目标, 路径[])       → 落地确认           // 路线 B
click(wc, 目标)                  → 明确错误           // 🔴 见下方红线
```

**铁律候选**:
- 🔴 **写方向红线**:`click` 永不作用于发布按钮。这条应从「各模块自觉」
  **升级为基础层强制** —— 发布按钮 selector 只允许用于**定位与校验**,
  基础层对它的 click 请求直接拒绝。这是全模块最重要的一条约束,
  现在却靠 9 处注释在维持。
- 注入脚本的参数**必须**参数化传入,不得字符串拼接
- 守卫必须**真 eval 再 parse**,覆盖全部 46 处(不是 1 处)

---

## 3. 输出层 —— 从 X 取什么,以及怎么确认

### 3.1 职责

| 子项 | 内容 |
|---|---|
| **DOM 读取** | 从渲染后的页面抓(X 想显示的那部分) |
| **载荷捕获** | CDP 拦 GraphQL 原始 JSON(渲染前的全集) |
| **解析归一** | 原始载荷 → 领域对象 |
| **落地确认** | ⭐ 我做的事**真的成了吗** |
| **完整性** | 抓全了吗?分母是多少? |

### 3.2 ❌ 实测现状:CDP 序列在 8 个模块里各抄了一遍

同一段「attach → on(message) → Network.enable → getResponseBody → off → detach」,
逐字重复 8 次:

`x-notifications` · `x-notification-watch` · `x-capture-monitor` · `x-article-replies`
· `x-author-profile` · `x-timeline-harvester` · `x-payload-inspector`
(+ `x-drag-drop` 走 DOM 侧)

### 3.3 ⭐ 由此发现一个**潜在真 bug**(本轮新发现,尚未实证)

8 处的 attach 失败处理**不一致**,而且共享模型有漏洞:

| 模块 | attach 失败时 |
|---|---|
| `x-notifications` | `catch { /* 已被 attach */ }` → 继续,**共用** |
| `x-notification-watch` | `catch { /* 已被 attach,共用 */ }` → 继续 |
| `x-article-replies` | `catch { /* 已被 attach,共用即可 */ }` → 继续 |
| `x-author-profile` | `catch { /* 已被别处 attach,共用即可 */ }` → 继续 |
| `x-timeline-harvester` | `catch { /* 已被 attach,共用即可 */ }` → 继续 |
| `x-payload-inspector` | `console.warn` → 继续 |
| **`x-capture-monitor`** | **`return { error: ... }` → 直接失败** |

**漏洞在于**:「共用」的前提是先 attach 的那位**还没走**。
[x-author-profile.ts:160](../../../src/platform/main/x/x-author-profile.ts) 的注释已经意识到一半:

> ⚠️ 只在**本函数 attach 的**时候才 detach:别人先 attach 的话
>   detach 会把人家的监听一起掐掉(harvester/notification-watch 都在用)

但反过来的情况**没人处理**:
**先 attach 的 A 结束时会 `detach()`,把正在「共用」的 B 一起掐掉。**
B 的 `attached=false`,它不会重连,只会**静默地再也收不到任何载荷** ——
不报错、不重试,表现为「采集突然变 0」。

而 `x-capture-monitor` 在同样情况下会 `return error` —— 同一个场景,
一个静默失效,一个明确失败。**这正是「看着成功实际没做」的典型形态。**

> ⚠️ 状态:**代码推断,未实证**。需要构造并发场景验证
> (例:notification-watch 常驻期间跑一次 author-profile 采集,看 watch 是否哑掉)。
> 记忆 `project-x-translate-rate-limited` 里那个「失败形态是一上来 5 连败、
> 且夹在密集拉取之间」的未解现象,与此模式**形似**,值得一并查。

### 3.4 由此得出:并发仲裁必须是基础层的事

CDP 只有一个 debugger 通道,而现在 8 个模块各自 attach/detach。
**谁在用、还剩谁在用,没有任何人知道。**

这不是靠「各模块小心一点」能解决的 —— 必须由基础层统一持有通道、
引用计数、最后一个走的人才 detach。

### 3.5 输出层契约(建议)

```
readDom(wc, 提取脚本)            → 数据 | 明确错误
capture(wc, 接口匹配, 期间)      → 载荷[] | 明确错误   // 引用计数,统一 attach/detach
parse(载荷, 类型)                → 领域对象 | 明确错误  // 解析失败不静默丢
confirm(wc, 判据)                → 真成了 | 明确失败   // ⭐ 强制
count(捕获, 分母)                → 采集率              // 完整性
```

**铁律候选**:
- ⭐ **「不确认就是失败」**:任何写动作没有 `confirm` 就不算成功。
  这是用户「不接受看着成功实际没做」在基础层的落点 ——
  从各模块自觉**升级为契约强制**。
- CDP 通道由基础层独占,业务模块不得自行 attach/detach
- 解析失败**不得**静默丢弃(记忆:`judge-parse-no-silent-drop`)
- 采集类动作必须能报出**分母**(记忆:`x-capture-monitor` 的验证哲学)

---

## 4. 三层之间的边界

```
        业务层(38 项能力)
              │  只说「我要什么」
    ┌─────────┴─────────┐
    │   X 服务基础层     │
    │                   │
    │  控制 ── 哪个页面、什么状态、谁在用
    │    │              │
    │  输入 ── 放进去     │  输出 ── 取出来 + 确认真成了
    └─────────┬─────────┘
              │  唯一对 X 的接触面
           X (webview)
```

**判据**:X 改版时,**只有这一层需要改**。
这是检验分层是否成立的唯一标准 —— 如果 X 改版还要动业务层,说明层没分对。

---

## 5. 现状总评分

| 层 | 现状 | 差距 |
|---|---|---|
| **控制·定位** | 🟢 已收口(16/19) | 补 3 处漏网 + 加守卫 |
| **控制·导航** | 🔴 9 处各写 | 行为不一致,8 处缺 X 接管处理 |
| **控制·就绪** | 🔴 2 份不等价 | 容错能力只有一半代码有 |
| **控制·并发** | 🔴 **不存在** | CDP 通道无人仲裁,疑似真 bug |
| **输入·selector** | 🟡 注册表存在但被绕过 | 9 模块 33 处硬编码 |
| **输入·注入** | 🔴 46 处裸调 | 血教训守卫只覆盖 1 处 |
| **输入·红线** | 🟡 靠注释维持 | 应升级为基础层强制拒绝 |
| **输出·CDP** | 🔴 8 处逐字重复 | attach 冲突处理不一致 |
| **输出·确认** | 🔴 各自定义 | 应升级为契约强制 |

> **唯一及格的是「控制·定位」** —— 而它恰好是唯一一个**被专门收口过**的
> (决策 2,删掉全局回退改 fail loud)。这说明:收口是有效的,只是还没做完。

---

## 6. 待用户拍板

1. **三层的边界认可吗?** 尤其「并发仲裁」放在控制层、「落地确认」放在输出层。
2. **§3.3 那个 CDP detach 疑似 bug**,要不要**先查证**?
   我倾向先查 —— 如果成立,它可能是若干「突然不工作」的共同病根,
   且会直接影响输出层怎么设计。
3. 三层的**动手顺序**。我倾向 控制 → 输出 → 输入(输入的红线最敏感,放最后,
   前两层稳了再动它)。

---

## ⬆️ 后续:本文结论已升级为通用 Web 能力层

2026-09-07,用户拍板:「控制/输入/输出」不是 X 专属,而是
**所有 web 应用(网页 / 网页衍生的内容网站)的共同能力**。

故本文之后的设计已迁到 **`../web/capability-layer/`**:

| 文档 | 内容 |
|---|---|
| `01-web-capability-contract.md` | **总纲**:三个能力、消费者全景、判据、红线 |
| `02-consolidation-analysis.md` | 六套读取路径现状实测 |
| `03-three-capabilities-design.md` | 三个能力的契约设计 |
| `04-v1-port-assessment.md` | V1 代码移植判定 |
| `05-observability-and-maintenance.md` | 诊断 + 维护模块 |

**X 在新格局里的定位:能力层的消费者之一**(且是最痛的一个),
不是它的主人。X 专属内容仍留本目录(`refactor-01` 功能清单 + 本文)。
