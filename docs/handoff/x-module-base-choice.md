# X 的底座继承谁？—— 两个底座并存，选错就回到老路

> 用户 2026-09-30：
> 「首先做好底座，也就是为 x 单独开浏览器的变种。
> 　也就是说 x 优先继承浏览器的功能，对吗？」

⭐ **对，方向完全对。** 但「浏览器底座」在仓里不是一个东西，也不是两个并列的东西 ——
它是**一套 L0–L6 分层模型**，目前由两段代码分别占着不同的层，另有第三段是给人用的浏览器。
不说清楚就动手，等于随机挑一个 —— 那正是 X 当年脆弱的来源。

---

## 一、⭐⭐ 更正：不是「两个底座」，是**一个分层模型的两段**

⚠️ 我最初说它们是「平行关系，不是上下层」—— **这个说法错了**。
证据只是「grep 不到互相 import」，那只证明**当前没接线**，不证明没有分层关系。

仓里有**设计文档明确写下的答案**（`09-history.md` §5.2，2026-09 决策）：

> | 现有底座 | 对应层 |
> |---|---|
> | `resolveWsWebContents` / registry | **L0** Session/Lifecycle |
> | `buildHitTestScript` | **L2** Page Runtime |
> | `pasteTextToWebview` / `feedFilesToInput` / `locateSendButton` | **L4** Interaction |
>
> **它不是竞品，是 L0+L2+L4 的一部分，而且质量不错。**
> 缺的是 **L1（网络捕获）**—— 全仓最大的重复源，和 **L3/L5/L6**。
> 所以整合方向明确：**保留并扩充 `web-service-base`，先补 L1，不推倒重来。**

### ⭐ 所以真实关系是这样

```
        L0  Session / Lifecycle   ← web-service-base（registry / resolve）
        L1  Network 网络捕获       ← web-capability（net / raw）★ 原本是空的
        L2  Page Runtime          ← 两边都有（service-base 的 hit-test；capability 的 dom/page）
        L3  Render                ← 还没做
        L4  Interaction 交互       ← web-service-base（paste / feedFiles / locateSend）
                                     + web-capability/input（收编了它的浏览器知识）
        L5  Artifact              ← 还没做
        L6  Persistence 落库       ← 还没做
```

**一套分层模型，两段代码分别占了不同的层。**
`web-capability` 是后建的，专门补 **L1** 这个最大的空洞（当时全仓 9 处 CDP 重复）。

### ⚠️ 为什么它们现在互不引用

`web-capability/index.ts` 自己写着：

> 新层独立建，**谁也不依赖它**，旧代码一行不动 —— 见 `08-migration-strategy.md` §1.1

⭐ 这是**刻意的施工策略**（「只加不改」），不是架构判断：
新层先独立建好、不动任何在跑的代码，等验证完再接线。
所以「互不引用」是**施工中途的状态**，不是终态设计。

---

## 一之二、回答你的两个猜测

### ❓「一个面向人的浏览，一个面向机器的控制输入输出？」

⚠️ **不是。** 实测 `web-service-base` 全部 7 个文件**都是机器控制**：
按坐标定位元素、注册活跃 webContents、原生右键上送坐标、
focus 输入框 + 粘贴、喂文件给 `<input type=file>`。
一个「面向人的浏览」功能都没有。

⭐ **面向人的浏览确实存在，但在第三个地方**（都不在这两者里）：

```
src/views/web/          WebTabBar · WebToolbar · WebFindBar · web-history · 书签
src/platform/main/web-download/   下载
```

→ 所以是**三样东西**，你的直觉「有一个面向人的」是对的，只是它不是这两个中的任何一个。

### ❓「它们没有上下继承关系吗？」

⭐ **有分层关系，但不是「继承」** ——
是**同一个 L0–L6 模型里的不同层**，靠注册表和接口对接，不是父类子类。

| 你的问法 | 实际 |
|---|---|
| 上下继承 | ❌ 没有 class 继承 |
| 上下分层 | ✅ **有**，L0/L2/L4 vs L1，见上表 |
| 平行无关 | ❌ 我最初说错了 |

## 二、⚠️ 一个必须知道的缺陷差异

`web-service-base/webview-registry-base.ts` 的策略是
**per-serviceKey 单例、最后 navigate 的胜出**（它自己的注释这么写）。

`web-capability/page/page-registry.ts` 的注释**点名批评了这一点**：

> 现有 bug 的根源就是 `createWebviewServiceRegistry` 的「最后 navigate 胜出」——
> 底座替应用做了选择，而它没资格做：它不知道业务意图。
> 实测后果：「日志说注入成功，但右栏框是空的」（内容落进了用户没在看的实例）。

⭐ 这与记忆里 [[project-host-broadcast-multi-ws-fanout]] / [[project-pm-panel-instance-id]]
是同一个病：**多实例下「谁是活跃的那个」由底座替业务猜。**

### ⭐ 结论：X 的「我在操作哪个页面」不能走旧 registry

新底座的做法是 `find` **如实返回全部命中，不排序、不筛选、不取第一个**，
由调用方（X）带着业务意图去选。X 重建必须走这一条。

⚠️ 但 `attachWebviewContextMenu` / `feedFilesToInput` 这些**无此缺陷**
（它们不做"谁是活跃的"判断），可以直接继承。

---

## 三、建议的继承形态

⭐ 按分层模型画（不是「两个并列的底座」）：

```
   ┌───────────────────────────────────────────────┐
   │  src/modules/x/          ← X 自己的地盘        │
   │  · 语义页面表  · GraphQL 字段路径  · 库表流程   │
   │  └─ index.ts             ⭐ 一行 self-register │
   └───────────────────────┬───────────────────────┘
                           │ 只往下用，不被任何人 import
   ─────────────────────── ↓ ───────────────────────
    L6  Persistence 落库        ← 还没做
    L5  Artifact                ← 还没做
    L4  Interaction 交互         ← web-service-base（paste/feedFiles/locateSend）
                                  + web-capability/input（收编其浏览器知识）
    L3  Render                  ← 还没做
    L2  Page Runtime            ← service-base（hit-test）+ capability（dom/page）
    L1  Network 网络捕获  ★      ← web-capability（net/raw）—— 后建，补最大空洞
    L0  Session/Lifecycle       ← web-service-base（registry / resolveWsWebContents）
   ─────────────────────────────────────────────────
            ⭐ 每一层都不认识 X（注册表模式）
```

⚠️ 图里两段代码**不是并列关系**，是**各占其层**：
`web-service-base` 占 L0/L2/L4，`web-capability` 补 L1 并在 L2/L4 上收编了浏览器知识。

**X 特有的只有三件**（判据：换成另一个网站会不会失效）：
1. 语义页面表 —— `x.home` / `x.profile` / `x.status` / `x.articles` 怎么拼 URL
2. GraphQL 载荷的字段路径 —— `SearchTimeline` / `UserByScreenName` 取哪个 key
3. X 的库表与业务流程

其余**全部继承**，一行不抄。

---

## 四、⭐ 所以「为 X 单独开浏览器的变种」怎么落地

⚠️ 不是复制一份浏览器代码改成 X 版 —— 那就是「变种」这个词最危险的读法，
也是当年 `x-write.ts` / `x-article-driver.ts` 各有一份 `clickSelector`
（一份有多候选 selector、一份没有；一份有 try、一份没有）的由来。

✅ 正确的落地是**三件小事**：

| 要提供的 | 形态 | 参考 |
|---|---|---|
| ① URL → serviceKey 识别 | 一个纯函数 | `web-service-base` 头注释：「加第三种服务只需提供 URL 识别 + 菜单项模板 + selector」 |
| ② 语义页面表 | push 给底座 | 已有 `registerPageTable(owner, resolver)` |
| ③ 锚点表 | push 给底座 | 已有 `registerAnchorTable(owner, resolver)` |

⭐⭐ ②③ 是**注册表模式**，底座不认识 X —— 这正是
`layering-direction.test.ts` 钉住的方向，X 必须走它。

---

## 五、第一步做什么（最小可验证）

⭐ 按上一轮实测「控制台可用」是最小闭环，且它**不需要任何业务逻辑**：

```
① src/modules/x/ 建目录 + index.ts 一行 self-register（此时 X 没有任何功能）
② 提供 URL 识别 + 语义页面表，push 给底座
③ 在能力控制台里：选 x.home → goto → ready → scrollUntil
   ⭐ 判据 = 真机跑通「导航到 X 首页并滚动」，零 X 业务代码
```

⚠️ 判据要**看 payloads / people 不看推文数**
（[[project-x-collect-two-legs]]：DOM 那条腿会顶着，掩盖载荷全断）。

⚠️ 且**单测证明不了 CDP 通道行为** —— 上一轮 1878 条全绿而真机 payloads 直接 0。
所以第 ③ 步必须真机验，不能拿单测交差。
