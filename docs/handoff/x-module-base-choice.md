# X 的底座继承谁？—— 两个底座并存，选错就回到老路

> 用户 2026-09-30：
> 「首先做好底座，也就是为 x 单独开浏览器的变种。
> 　也就是说 x 优先继承浏览器的功能，对吗？」

⭐ **对，方向完全对。** 但落地前必须先解决一件事：
**仓里有两个「浏览器底座」，它们的能力互补、且新的那个刻意修了旧的一个缺陷。**
不说清楚就动手，等于随机挑一个 —— 那正是 X 当年脆弱的来源。

---

## 一、两个底座实测对照（2026-09-30）

| | `web-capability/` | `web-service-base/` |
|---|---|---|
| 行数 | 6683 | 908 |
| 定位 | **能力层**：page/input/net/dom/raw/trace | **服务生命周期层**：webview 挂载与识别 |
| 依赖 | 只 `electron`/`node:*`，业务零引用 | 只 `electron` |
| 现有消费者 | （X 拆掉后）AI 的注入脚本登记 | **AI · Mail 在用** |
| 谁引用谁 | —— | **互不引用，是平行关系，不是上下层** |

### 各自独有的能力（互补，不是替代）

```
只有 web-capability 有：      只有 web-service-base 有：
  page.goto / ready             attachWebviewContextMenu   原生右键 + 坐标上送
  page.scrollUntil              resolveWsWebContents       按 guest wcId 精确定位
  net 载荷捕获（CDP+webRequest）  buildHitTestScript         坐标 → DOM 元素定位
  raw 原始留痕                   focusInputBox / pasteText  发布原语
  trace 诊断                     feedFilesToInput           喂真实文件给 <input file>
  page 租约 / 身份
```

⭐ **所以不是「二选一」，是「各取所需」** ——
X 的采集要 `web-capability`（滚动 + 载荷），
X 的右键提取 / 填回复框要 `web-service-base`（坐标定位 + 合成 paste + 喂文件）。

---

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

```
        src/modules/x/                    ← X 自己的地盘
        ├─ x-pages.ts      语义页面表（x.home / x.profile / x.status / x.articles）
        ├─ x-payload/      X GraphQL 字段路径解析
        ├─ ...
        └─ index.ts        ⭐ 一行 self-register
             │
      ┌──────┴───────────────────┐
      ↓ 采集/滚动/载荷            ↓ 挂载/右键/填框/喂文件
  web-capability              web-service-base
  （page·net·raw·trace）       （registry·菜单·hit-test·paste）
        └────────── 都不认识 X ──────────┘
```

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
