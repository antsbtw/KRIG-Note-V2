# 先把底座做完 —— 用户拍板（2026-09-30）

> 用户原话：
> 「我不能接受你的这个观点，不要因为时间长就放弃，底座没有做好，
> 　后面的问题越来越多，修改起来就更麻烦。
> 　以前是意识不到，现在发现了就应该优先处理。」

## ⭐ 我错在哪（记下来，别再犯）

我用**时间成本**论证「不要先建 L2–L6」。这个论证本身就是造成现状的那一条：
X 当年就是在不完整的底座上快速建起来的，然后花了几天推倒。

⚠️ **「代价大」不是跳过地基的理由** —— 它恰恰是地基没做好时必然出现的症状。

### 但有一条担忧是真的，要分开看

| | |
|---|---|
| ❌ 无效 | 「要花半年」—— 撤回 |
| ⚠️ 仍然成立 | **L1 建得很好，X 始终没接上，然后 X 被删了** |

⭐ 所以真正的问题不是「建不建」，而是 **「怎么知道一层真的建完了」**。
L1 的失败不是抽象做错了，是**从来没有被一个真实消费者验证过**。

→ 本计划的核心机制：**每一层都必须由一个真实消费者接上，才算完成。**

---

## 一、实测：底座的真实欠账（2026-09-30）

### ⭐⭐ L2 Runtime 是最大的一笔，而且比文档记的更糟

文档说「46+ 处裸注入」。**实测 69 处，分布在 25 个文件**
（`grep executeJavaScript`，已排除 `web-capability` 自身）：

| 类别 | 处数 | 代表 |
|---|---|---|
| A 提取类 | 22 | AI 各厂 extractor · 网页剪藏 · 邮件 |
| B 驱动类 | 23 | `web-sync-driver` 15 · `web-translate-driver` 6 |
| C 输入/定位 | 8 | `web-service-base`（input · file-input · element-locate） |
| D 其他 | 13 | `tweet-fetcher` · `web-shortcuts` · `web-rendering` |

⚠️ **X 已经不在仓里了，这 69 处全是别人的** ——
说明它从来不是"X 的问题"，是全仓的问题。

⭐ 抽样验证它们确实是**同一件事写了多遍**：
`tweet-fetcher` 手写「轮询 10 秒等 `article[data-testid=tweet]` 渲染」，
而 `web-capability/page` 已经有 `ready` / `scrollUntil` 做同一件事。

### ⭐ 已有一笔债是前人写下来却没还的

`tweet-fetcher/fetcher.ts` 头注释原文：

> ⚠️ 临时 capability 实现（用户红线"避免临时能力长期化"）
> · 本模块仅服务 tweet-block 一个消费者，不接受新功能扩展
> · **Phase D browser-capability 正式化后，本能力被吸收为 "DOM scraping" 子能力**

→ 这正是用户说的「以前是意识不到」的反例：**当时就意识到了，只是没还**。

### 其余各层

| 层 | 状态 | 欠账 |
|---|---|---|
| L0 Session | ✅ 有（`web-service-base`） | ⚠️ 「最后 navigate 胜出」缺陷（见下） |
| **L1 Network** | ✅ 建完，AI 已接 | 🔴 **`webview-file-input` 仍自己 attach CDP**（最后一处活的重复） |
| **L2 Runtime** | 🔴 **69 处散落** | **最大一笔** |
| L3 Render | ❌ 未动工 | 做 X Articles「呈现态截图」时要用 |
| L4 Interaction | 🟡 一半（`web-service-base` 有 paste/feedFiles） | 与 L2 一起收 |
| L5 Artifact | ❌ 未动工 | 被判定是 adapter 非底座 |
| L6 Persistence | ❌ 未动工 | X 有自己的库表 |

---

## 二、⭐ 顺序：按「谁在流血」排，不按层号排

⚠️ 不按 L0→L6 顺序做。判据是**三条同时成立**：
① 是活的重复（不是死代码）② 有真实消费者能立刻验证 ③ 修了能防住已发生过的事故。

### 第 1 步：L1 收尾 —— CDP 唯一收口

**做什么**：`webview-file-input.ts` 的 `debugger.attach` + `DOM.*` 收进 `web-capability`。

- 消费者验证：AI（现成的，SSE 必须不断）
- ⭐ 必须一起搬的约束：「已被别处 attach 就复用且末尾不 detach」
  （`project-ws-instance-isolation-invariant`：一个 wc 只允许一个 debugger client，
  抢别人的会**掐掉 AI 的 SSE 拦截器**）
- 判据：**真机** —— AI 的 SSE 不断 + 喂文件能成

### 第 2 步：L2 Runtime —— 69 处收口（最大一笔）

**⭐ 不是一次收 69 处**，按「同一件事」分批，每批必须有真实消费者当场验：

| 批 | 收什么 | 消费者 | 防住什么事故 |
|---|---|---|---|
| 2a | **轮询等元素**（`ready`/`waitFor`） | tweet-fetcher（note 在用） | 各写一份、超时策略不一 |
| 2b | **提取类注入**（22 处） | AI extractor · 邮件 · 剪藏 | ⭐ **转义事故**（见下） |
| 2c | **驱动类注入**（23 处） | web-sync · translate | 同上 |
| 2d | **输入/定位**（8 处） | AI writer（X 将来用） | 与 L4 一起 |

⭐⭐ **2b/2c 防的是已经发生过的事故**：
`project-x-inject-template-escape` —— 模板字面量里 `\/` 被求值吃掉 →
浏览器收到非法正则 → **整段解析失败、采集恒 0，而 tsc 和单测全绿**。
L2 收口后「参数一律 `JSON.stringify` 绑定、绝不拼进脚本文本」在**类型层面**消灭这类事故。

### 第 3 步：L4 Interaction 补齐

`web-service-base` 已有一半（paste / feedFiles / locateSend），补齐 + 三道红线闸门守卫。
⭐ 红线：**绝不程序点发布**（用户反复确认过的）。

### ⏸️ L3 / L5 / L6 —— 有消费者时再建

⚠️ 不是"不重要"，是**现在没有消费者能验证它建对了** ——
这正是 L1 栽过的坑（建好了、没人接、然后消费者被删了）。

- **L3 Render**：做 X Articles「呈现态截图发布」时立刻要用 → 那时建
- **L5 Artifact**：被判定是 adapter 非底座
- **L6 Persistence**：X 有自己的库表

---

## 三、⭐⭐ 防止重蹈 L1 覆辙的三条硬规矩

1. **每一层必须由真实消费者接上才算完成** ——
   「建好了但没人用」= **未完成**，不许记为完成
2. **旧实现当场删或降级为带守卫的死代码** ——
   `startGeminiCDPLegacy` 是正面样板：注释写明 + 守卫锁死零调用。
   ⚠️ 留着两份平行实现 = 下次有人改错那份
3. **每批收口后真机验一次** ——
   ⚠️ 单测证明不了 CDP / 注入的运行时行为：
   `project-x-collect-two-legs` 实测 **1878 条全绿而真机 payloads 直接 0**

---

## 四、X 怎么办

⭐ X 排在底座之后，但**不是干等**：

- 第 1/2 步的消费者全是现成的（AI · 邮件 · 剪藏 · tweet-fetcher · driver）
- X 重建时**直接用收好口的底座**，不再各写一份 ——
  这正是当年 `x-write.ts` 与 `x-article-driver.ts` 各有一份 `clickSelector`
  （一份有多候选 selector、一份没有；一份有 try、一份没有）的**根治**

⚠️ 记账：本计划把 X 往后推了。这是用户明确拍板的取舍 ——
**「底座没有做好，后面的问题越来越多，修改起来就更麻烦」**。
