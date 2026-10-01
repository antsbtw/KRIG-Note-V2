# 交接：在 regression-testing-nj 上验证 L2 收口

> 给接手这台机器的对话看。分支 `feature/x-module-rebuild`，起点 `b25a7e83`。
> 仓库已 clone 到 `~/Documents/VPN-Server/KRIG-Note-V2`，依赖已装。

---

## 一、⚠️ 先知道这台机器能做什么、不能做什么（实测，别再试一遍）

| | |
|---|---|
| ✅ 能跑 | `tsc --noEmit` · `vitest run` · 离线脚本 · 读真实数据 |
| ❌ **不能** | **起 Electron 窗口 · 截图 · 点 UI** |

实测证据（2026-09-30）：

```
screencapture -x /tmp/x.png   → could not create image from display
launchctl asuser <uid> ...    → Could not switch to audit session: Operation not permitted
```

⭐ 屏幕上**有**登录着的 Aqua 会话（`ants.btw`，Sep 24 起），
但 **SSH 上下文投不进去** —— 这与 Windows 那台是同一种病
（记忆 `feedback-debug-on-mac-not-windows`：无桌面会话 → GPU 崩溃退出）。

⚠️ 所以**别尝试** `npm start` / `electron .` / `xvfb` 之类的绕法，
已经验证过是死路。GUI 部分由人在桌面上做（见 §四）。

⚠️ **PATH**：非交互 SSH 里没有 node/npm，所有命令要包一层 `zsh -lc "..."`。

---

## 二、你要做的：三件可自动化的事

```bash
cd ~/Documents/VPN-Server/KRIG-Note-V2
```

### ① 类型全检

```bash
npx tsc --noEmit
```
**预期：0 错。** 非 0 就是回归，把错误原文贴回来。

### ② 全量单测

```bash
npx vitest run
```

**预期：1768 passed；6 个测试文件加载失败。**

⚠️ 那 6 个**不是回归** —— 改动前就坏，已在 `HEAD` 复现过多次。
成因：`web-proxy/proxy-node-store.ts:28` 在 import 期调 `app.getPath('userData')`，
非 Electron 环境下 `app` 是 undefined。涉及：

```
tests/scenarios/scenario-11-full-roundtrip · scenario-6-krig-import
tests/scenarios/scenario-7-markdown-table  · scenario-9-rollback
tests/capabilities/note/create-notes-batch
tests/platform/main/bookmark/parse-chrome-bookmarks
```

⭐ **如果数字不是 1768 / 6，那才值得报。**

### ③ ⭐ 本轮真正要你验的：三条针对性守卫

```bash
npx vitest run \
  tests/web-capability/dom-locate-scripts.test.ts \
  tests/platform/main/tweet-fetcher/fetcher-uses-page-ready.test.ts \
  tests/web-capability/dom-boundary-guard.test.ts \
  tests/web-capability/input-boundary-guard.test.ts \
  tests/web-capability/ai-gemini-migration.test.ts
```

**预期全绿。** 这五个文件覆盖第 1/2 批的全部结构性断言。

---

## 三、⭐⭐ 更有价值的：帮我做「注入验证」的独立复核

⚠️ 我自己做过注入验证，但**我既是改代码的人也是验证的人** ——
本仓吃过的亏是「守卫全绿却证明不了任何东西」。
请你**独立地**故意破坏代码，看守卫是否真的变红。

每次改完记得 `git checkout -- <file>` 还原。

| # | 怎么破坏 | 该红哪条 |
|---|---|---|
| 1 | `dom/locate-scripts.ts` 里把 `replace(/\\s+/g, ' ')` 改成 `replace(/\s+/g, ' ')` | 「`\s+` 求值后仍是 `\s+`」 |
| 2 | 同文件把 `var sel = ${JSON.stringify(selector)};` 改成 `var sel = "${selector}";` | 「selector 里的引号不破坏脚本」 |
| 3 | `tweet-fetcher/fetcher.ts` 删掉 `bindPageHost(...)` 那行 | 「register 与 bindPageHost 必须成对」 |
| 4 | 同文件把 `landed.status === 'failed'` 改成 `!== 'ok'` | 「degraded 不许当失败」 |
| 5 | 在 `ai/writer.ts` 末尾加一行调用 `feedFilesToInput(...)` | 「有人调用已退役的原语」 |

⭐ **每一条都必须真的变红。** 哪条没红，就是那条守卫是假的 —— 那比代码有 bug 更值得报。

### ⚠️ 还请你复核一条我已知的假绿

`dom-locate-scripts.test.ts` 里「外部值是绑定进去的」那条：
我最初写成 `toContain('var X = 100;')`，把 `JSON.stringify(x)` 改回裸 `${x}`
**照样全绿**（数字的两种写法产出文本一模一样）。
已在注释里记下这次证否。**请看看还有没有同类的**——
断言写的是「文本长这样」而不是「性质成立」的地方。

---

## 四、GUI 部分（这台机器做不了，人在桌面做）

⚠️ 两批都**未真机验证**，判据如下。谁在桌面前谁做：

### 第 1 批：tweet-fetcher

```
note 里输入 /  → 选「X Post」→ 粘一条推文链接 → 点卡片上的「Fetch」
```
- ✅ 通过 = 卡片填出**作者名 / @handle / 正文**
- ❌ 失败 = 按钮变红叉 2 秒

⭐ **已知它会失败,且不是本次改动造成的**：
X 把未登录页面的 `data-testid` **全部去掉了**（真机探针实测：全页 0 个），
详见 `docs/handoff/x-testid-removed-tweet-fetcher-broken.md`。
所以这一批的真机验证**只需确认报错话术变好了**：

打开 DevTools Console，应看到
```
[tweetBlock] fetch failed: 等待判据 anchorAppears:tweetArticle 超时(10000ms)
```
（若等待期间注入抛过异常，末尾还会带「;最后一次注入异常: ...」；
没带 = 每轮脚本都跑通了、只是元素始终没出现 —— 正是 testid 被去掉的形态）

而**不是**旧版那句 `Tweet page did not render in time`
（旧话术把「X 改版」说成「页面没渲染好」，把人指向完全错误的方向）。

### 第 2 批：AI 单条提取

```
在 ChatGPT / Claude / Gemini 页面,对某一条回复右键 → 「提取此对话到笔记」
```
- ✅ 通过 = 取到的是**你点的那一条**，不是别条
- ⭐ 三家都要试：chatgpt 与 claude 走合并后的同一份代码；
  gemini 原本是简化版，收口后多获得了「多候选 selector 合并」能力
  （它目前只有单个 selector，理论上行为不变，但这正是该验的地方）

---

## 四½、验证结果（2026-09-30，独立复核）

### ①② 自动化部分

- `tsc --noEmit`：**0 错**
- 五个针对性守卫文件：**65/65 全绿**
- 全量单测：本机 Mac **1768 passed / 6 加载失败**（与预期一致）。
  regression-nj 上是 **1740 / 7** —— ⚠️ **环境问题不是回归**：那台的 `node_modules/electron`
  装了一半（缺 `path.txt`），`import 'electron'` 直接抛，7 个全是这一个错。
  多出来的是 `tests/ai/claude-extract-turn-pure.test.ts`：名叫 pure，却经 `locate-ordinal`
  间接加载 electron；在 Mac 上能过只因 `require('electron')` 返回路径字符串。

### ③ 注入验证：§三 的 5 条全部按预期变红

| # | 结果 | 变红的正是 |
|---|---|---|
| 1 `\\s+`→`\s+` | ✅ | 「`\s+` 求值后仍是 `\s+`」 |
| 2 selector 裸拼 | ✅ | 「selector 里的引号/反斜杠不会破坏脚本」 |
| 3 删 bindPageHost | ✅ | 「register 与 bindPageHost 必须成对」 |
| 4 `!== 'ok'` | ✅ | 「degraded 不许当失败」 |
| 5 调 feedFilesToInput | ✅ | 「退役的前提是真的没人用」 |

注入脚本会先断言替换恰好命中 1 次（防「没改成却以为守卫绿」）。

### ⚠️ 复核中发现的同类假绿（均实测：注入后仍全绿）—— 待修

| | 注入 | 为什么没红 | 同族 |
|---|---|---|---|
| **D** ✅ 已修 | 同一行先写 `'https://…'` 再调 `feedFilesToInput(…)` / 在 interceptor 调 `executeJavaScript` / 在非债文件现拼 IIFE | `input-boundary-guard.test.ts:34` 与 `dom-boundary-guard.test.ts:27` 剥注释用 `\/\/.*$`，**吃掉 URL 及其后整行**。三条都做了去掉 URL 的对照，对照组都变红 | `feedback-guard-stripper-eats-urls` 原样重犯。修法 `(^|[^:])\/\/.*$` + 给 strip 加带 URL 的自检 |
| **A** | `${JSON.stringify(x)}`→裸 `${x}`；selector→`"${selector}"` | `dom-locate-scripts.test.ts:42-58` 注释说「已改成钉性质」，**代码仍是 `toContain('var X = 100;')`**；selector 那句对 `"article"` 两种写法文本相同 | 字面量断言分不出。#2 能红全靠另一条「引号」用例 |
| **B** | `void 0 && bindPageHost(…)`；`bindPageHost('wrong', …)` | 「成对」守卫只查全文件有无 `bindPageHost(` | 第三刀（没缩到分支）+ 第五刀（看不见执行） |
| **C** | `status === 'failed' \|\| status === 'degraded'` | 只禁了 `!== 'ok'` 这一种写法，同义改写全绿 | 钉写法不钉性质 |

**D 的修法**（不是补正则）：仓里早有正确的共享版 `tests/helpers/source-scan.ts`
（字符状态机，文件头就写着这个坑），但 web-capability 的**四个**边界守卫（net/page/input/dom）
都各自手写了坏的正则版 —— net/page 也有同样的洞，只是还没踩到。
四个全部改为 import 共享版，并在各自的剥注释自检里加一条 URL 用例。
复验：E/F/H 三条原先全绿的注入**现在都变红**，对照组照旧；
反向攻击（把正则版写回 dom 守卫）→ 新自检变红。
⚠️ A/B/C 仍待修（钉字面量/钉写法的问题，不是剥注释）。

### GUI（2026-09-30，在本机 MacBook 上做）

- **第 1 批 tweet-fetcher：✅ 通过**。Console 实见
  `[tweetBlock] fetch failed: 等待判据 anchorAppears:tweetArticle 超时(10000ms)`，
  不带注入异常 = 脚本每轮都跑通、元素始终不出现，与「testid 被去掉」吻合；新话术指对了方向。
- **第 2 批 AI 单条提取：**
  - Claude：提取成功；⏳ 待补测「点**中间**某条」（点最后一条测不出错位）
  - ChatGPT / Gemini：⏳ 待测，**用纯文字对话**（避开下面那个发现）

  ⚠️ **用户 2026-09-30 决定：第 2 批这三项真机验证押后**，先把底座框架与函数抽象做完。
  这是**有意欠下的**「每批真机验一次」（硬规矩第 3 条）—— 押后期间第 2 批**不算完成**；
  后续批次若也押后，在这里逐批追加，最后**集中补验一次**，别让账散掉。

### ⭐ 新发现（不在 L2 范围，押后按 AI 逐家单独调试）

**ChatGPT 提取丢图片**：纯图片回复整轮丢失（笔记里只剩问题），用户上传的附图也丢。

- 可疑点（**读代码推断，未验证**）：图片 bytes 唯一来源是注入 fetch hook 缓存的
  `/backend-api/estuary/content`（`chatgpt-full-extraction.ts:192-203`）。
  若页面用 `<img src>` 直接加载而不走 `fetch`，hook 根本看不到 → fileMap 空 →
  纯图片回复 body 为空 → 被当空消息过滤。
- ⚠️ 连带风险：数据侧丢掉图片轮而 DOM 仍在数它 → 两边轮数错位；图片回复文字少于 12 字，
  预览匹配失效 → 退回 ordinal → **单条提取取到相邻那轮**。
- 下一步：先在 `loadChatGPTConversation` 加临时诊断（fileRefs 数 / estuary 缓存命中数 /
  每条 body 长度），真机提一次看数，**别靠猜**。与第 2 批的改动无关（它只管「点中第几条」）。
- Claude / Gemini 的图片机制各不相同，调试时逐家单独查。

---

## 四¾、复核 `75fc5c99`（第 3 批：mail 提取坐标绑定）

⭐ 注入在**独立 worktree** 里做（另一个对话同时在主工作区改代码，直接改 src 会互相踩）。

### 提交自称的三条 —— 全部成立

| 注入 | 结果 |
|---|---|
| M1 `elementFromPoint(X, Y)` 退回 `(${x}, ${y})` | ✅ 红「坐标是绑定进去的」 |
| M3 源码 `\\u00a0` 改成 `\u00a0`（转义被吃） | ✅ 红「nbsp 转义求值后仍是转义序列」 |
| M4 中心距改成边缘距（顺手统一语义） | ✅ 红「保留 mail 自己的回退语义」 |

### ⚠️ 发现

1. **🔴 NaN 坐标：这次改动把「会报错」变成了「静默取错」**（行为探针实测）
   - 改前：裸 `${NaN}` → 脚本里是 `NaN` → `elementFromPoint(NaN, …)` 抛 → 走 `__error` 如实报错
   - 改后：`JSON.stringify(NaN)` = `"null"` → `var X = null;` → 浏览器当 0 →
     **静默提取最左侧那封邮件，不报任何错**（`Infinity` 同理；`undefined` 与 `'12'` 也原样放行）
   - 坐标来自 IPC 载荷 `p.x/p.y`（`mail/handlers.ts:37`），全程无校验
   - 修法：照 `dom/locate-scripts.ts` 的 `requireNumber` —— 非有限数字就抛，不许静默
   - ⭐ 教训：**`JSON.stringify` 对数字不是安全网**，它对 NaN/Infinity 会改写值；数字的防线是**校验**不是绑定
2. **同类假绿（注入后仍全绿）**
   - M2 `var X = ${bindX}` → `${x}`：数字两种写法文本一样（与 A 同类；对有限数无害，真防线应是上面的校验）
   - M5 `box = best` → `best || list[0]`：**带外兜底取第一封**（正是提交说要防的「顺手统一」的一种），
     语义守卫只钉了两个字面量表达式，没钉「带外不取」这个性质
   - M6 `if (!box) return { __noMail: true }` → `if (false) …`：`toContain` 看不见执行（B 同类）
3. **「main 侧裸插值 = 0」—— 对活代码成立，但有一份死代码没处理**
   - `web-service-base/element-locate.ts` 的 `buildHitTestScript` 仍裸插 `${x}` `${y}` `${band}`
   - **零消费者**（仅 `web-service-base/index.ts` 再导出）→ 违反硬规矩二
     「旧实现当场删或降级为带守卫的死代码」；下一个人很可能直接拿它用
   - （我的扫描是粗扫：只看含 `function(`/`document.`/`window.` 的反引号串，嵌套模板会漏）

## 四⅞、复核 `1124aab0`（修 NaN 回归 + 5 条行为测试）

### 修复本身 —— 成立
- 上次三处假绿中 M5（带外兜底拿第一封）、M6（`if (false)` 掐 `__noMail`）**现在都红** ✅
- 删掉 `buildExtractScript` 的 isFinite → NaN 测试红 ✅；`element-locate.ts` 已删 ✅
- M2（`${bindX}`→`${x}`）仍绿 —— 可接受：有了 isFinite 之后两种写法对有限数**真的等价**

### ⚠️ 假 DOM 掩盖了四处真实浏览器差异（注入实测仍全绿）

| # | 注入 | 为什么没红 | 假 DOM 的哪一处 |
|---|---|---|---|
| N2 | `el.closest(sel)` → `el.closest(bodySel)` | selector 用错了照样命中 | `closest`/`querySelectorAll` **不看参数**，恒返回全部 |
| N3 | 带内回退改成 `box = best ? list[0] : null`（恒取第一封） | 间隙那条用例两边**打平**，断言接受 A 或 B | 用例本身区分不了「中心距最近」「边缘距最近」「恒取第一」 |
| N5 | 命中非邮件元素时 `closest(sel) \|\| el`（拿到页面空白元素当邮件） | 假 DOM **从不出现**「点中了东西、但不是邮件」—— 要么点中邮件、要么 null | 真实浏览器里点间隙的**常态**恰恰是后者 |
| F2 | 删掉 `handlers.ts` 的 isFinite | IPC 那道闸零测试 | —（有内层 isFinite 兜着，失败仍然响，低危） |

- 另：N1（`elementFromPoint(0, 0)`）红了，但**只是字面量断言**抓到的；假 `elementFromPoint`
  **忽略坐标**，行为测试从未验证「坐标真的传进去了」
- N4（中心距→边缘距）也只被字面量那条抓到，行为测试抓不到（同 N3 的打平问题）

**建议修法**：
1. **别手写假 DOM** —— 仓里已有 `tests/web-capability/helpers/fake-dom.ts`（真 selector 匹配、
   不支持的写法抛错），给它补 `elementFromPoint`（按 rect 命中）+ `closest` + `innerText`，mail 改用它。
   （与 stripComments 同一形态：共享工具在，没用上）
2. 间隙用例改成**两种语义给出不同答案**的几何，例：A=[0,100]、B=[120,130]、y=108 →
   边缘距选 A（8 vs 12），中心距选 B（58 vs 17），断言必须是 **B**
3. 补一条「点中了非邮件元素（容器外的父节点）→ 走回退」的用例

### ASI 那条提醒 —— 半对
- ✅ **求值**会被切断：以换行开头的脚本 `return ` + script 恒返回 `undefined`、不报错（Node 实测）
- ❌ 但「能被真正解析」那条**没有栽**：ASI 后孤立的表达式仍要过语法分析，语法错误照样抛
  （Node 实测 + 注入 P1 一次红 7 条）。它只验 parse，而 parse 它验对了
- 全仓其他 `new Function` 用法都带括号或只验 parse，**无其他受害者**

## 四⅞+、复核 `263aacfb`（改用 fake-dom + 补六项能力）

### 上一轮四条 —— 全部成立
- 带内回退恒取第一封 / closest 传错 selector / `closest(sel) || el` → 现在都红
- 间隙用例按「边缘距选 A、中心距选 B」重做；「closest 用对 selector」改成回退会取到另一封的布局 ✅
- 带宽 24 → 240（向 ordinal-by-point 靠拢）现在被**行为测试**抓到（「点中非邮件元素」那条），不再只靠字面量

### ⚠️ fake-dom 与真 DOM 的语义差异

| # | 差异 | 实测 | 危害 |
|---|---|---|---|
| **D1** 🔴 | 没给 `rect` 的元素默认占 **(0,0,100,20)** → 左上角出现**幻影命中区** | 邮件在 y=300、其子元素没给 rect，点 (50,10)：假 DOM 命中子元素 → `closest` 回到那封远处的邮件 → **提取成功**；真浏览器那里什么都没有 → 应为 `__noMail` | 任何带子元素的布局都会被这块幻影区干扰；**默认应不可命中**（或继承父矩形） |
| **D2** 🔴 **旧债** | 有子元素时派生 `textContent` 读的是 `attrs['__text']`，而**全仓没有任何地方写它** → 恒为 `""`；本次新增的 `innerText` 同源，也恒为 `""` | `div>span("HELLO")` 的 textContent/innerText 都是 `""`，提取 bodyText 为空 | 5ca8e99f（2026-09-09）起就在。现有测试都用**叶子**框所以没踩到；但真实 contentEditable 粘贴后必有子节点（`<p>`/`<br>`），一旦有人照真实结构建模，「contains 落地校验」会**恒报没落地** |
| D3 | 点空白处返回 `null`；真浏览器视口内至少返回 `body`/`html` | `elementFromPoint(50,500)` → null | 「点中了东西、但不是邮件」的**最常见形态**（点到 body）从不出现；现在靠 filler 用例补上了一种 |
| D4 | `[attr*=""]` / `^=""` / `$=""` 匹配**全部**；真 DOM 按规范匹配**零个** | `span[title*=""]` → 2 | 低危（边界） |
| D5 | 「上层胜出」= 文档先序遍历里后者覆盖前者 | — | ✅ 对常规流合理（子覆盖父、后兄弟覆盖前兄弟）；**不建模** z-index/定位/pointer-events，Gmail 的浮层与 tooltip 这类场景测不出，写进注释即可 |
| D6 | 命中判定四边都闭区间；真 DOM 右/下边界是开的 | — | 低危：相邻两框的共同边界靠「后者覆盖」碰巧与真实一致 |

- 属性值含逗号（`[title*=","]`）会被逗号拆分拆坏 —— 但会**抛**不会静默，可接受
- 真实 selector 含后代组合（`div.mailList tr`、`div[id^="_mail_list"] div.gWel`）：`closest` 走 `matchesSimple` **会抛** —— 同样是响的，QQ/163 的 profile 暂时没法用这套测

### ⚠️ 6 条行为测试的剩余盲区
- **Q2**：`pick(box, bodySel)` 改成 `pick(box, subjSel)` → **全绿**。测试给 body/subject selector 都传 `''`，
  正文/主题/发件人/日期四段**从未被行为测试跑到**
  - 顺带一个与本批无关的**既有语义风险**：`pick` 是 `root.querySelector(s) || document.querySelector(s)` ——
    框里没有正文时会**全页兜底**，在 Gmail 会话视图（一页多封）里可能**静默取到别封的正文**。建议单独立项看
- **X 坐标**：所有用例 x=50、矩形都从 left=0 起 → X 在行为上从未起作用；`elementFromPoint(0, Y)` 只被字面量那条抓到。
  补一个**左右并排两封**的布局即可

## 四⅞++、复核 `fac3cf35`（fake-dom 修两处 + 14 条自检）

### 修复 —— 成立
- 幻影命中区消失、`textContent` 拼子节点、`*=""` 零匹配、空白处返回 body ✅
- 把 `__text` 旧写法注回去 → 自检红 3 条 ✅；body/subject 互换、X 写死 0 → mail 行为测试红 ✅

### ① 14 条自检里的假绿（注入 fake-dom 本身，跑自检 + 全部 5 个消费者）

| # | 注入 | 结果 |
|---|---|---|
| S1 | 未布局矩形改成 `{left:0, top:30, w:1000, h:1000}`（幻影区挪到 y≥30） | **自检没红**，是 mail 那条「没给 rect 不可命中」兜住的 —— 自检只抽样原点附近 4 个点（正好是旧默认值的范围） |
| S2 | 删掉 `^=` 的判定行（`^=` 恒真） | **全绿** —— 只有正例，没有反例 |
| S3 | 删掉 `$=` 的判定行 | **全绿** —— 同上 |
| S4 | `closest` 不再按逗号拆多候选 | **全绿** —— 自检与 mail 都只用单个 selector；而**真实四家 mail selector 全带逗号** |

另：「边界含端点」那条**钉的是非真实语义** —— 真 DOM 命中区是 `[left, right)`、`[top, bottom)`，右/下边界不含。

### ② 哨兵矩形 -1e6 的风险
- **今天的消费者里无假阴**：只有 mail（带内距离回退，远处永不入选 = 正确）与 hover（算中心坐标派发事件）读几何；
  而 fake-dom 的事件对象**根本不记录 clientX/clientY**（实测为 null），所以 hover 的坐标错不错测试都看不见
- **会出问题的脚本形态**：按 `top`/`left` **升序**取第一个（哨兵永远排最前）、`Math.min` 取最上方、
  `rect.top < 0 → 需要向上滚`、拿中心坐标派发事件并断言坐标
- ⭐ **建议换思路而不是调哨兵值**：把「可命中」和「几何」拆开 ——
  `elementFromPoint` 只考虑**显式给了 rect** 的元素；未布局元素被 `getBoundingClientRect` 读取时**抛错**
  （fake-dom 自己的原则就是「不支持就抛，不许静默」）。这样测试作者被迫为读几何的脚本声明布局，
  不存在任何哨兵值能被误用

### ③ 其余与真 DOM 不符之处（均实测）
- 🔴 **`el.querySelector` / `querySelectorAll` 会返回元素自身**（从 `descendants(this)` 找，而它含自身）；
  真 DOM 只找后代。mail 的 `pick(box, bodySel)` 正走这条：容器自己匹配 bodySel 时，
  假 DOM 返回容器、真浏览器会继续往下找或落到**全页兜底**（那条已知风险）。旧债，但 mail 现在踩在上面
- `^=""` / `$=""` 仍匹配全部（只修了 `*=`）
- `elementFromPoint` 视口外也返回 body；真 DOM 视口外返回 null（低危，fake-dom 没有视口概念）

## 四⅞+++、复核 `3cb0363d`（fake-dom 第四轮）+ 是否继续加固的判断

### 修复 —— 成立
- 上轮四处（`^=`/`$=` 缺反例、`closest` 不拆逗号、`__text` 回归）重新注入 → **全红** ✅
- 「读几何即抛」落地，且当场暴露两处依赖旧行为的用例 —— 方向对了的证据

### ⚠️ 本轮新引入的两处语义错（实测）
- **R1**：`if (want === '') return false` 排在 `=` 判定**之后**、不分算子 →
  `[title=""]` 也匹配零个；真 DOM 匹配 title **恰为空**的元素（`=` 与 `*=/^=/$=` 语义不同）
- **R2**：改成 `descendantsOnly` 后，后代组合 selector 的**祖先部分**也只能在后代里找 →
  `box.querySelector('div[data-message-id] div.ii')`（box 自己带 data-message-id）返回 **null**，真 DOM 返回 `div.ii`。
  ⚠️ 这正是 **Gmail 真实 mailBody** 的写法；真 DOM 规则是「被选中的元素须是后代，但祖先匹配可以是自身甚至在外面」

### 边界开闭：不建议立项
脚本里 `Y >= r.top - 24 && Y <= r.bottom + 24` 是**脚本自己定义的带宽**，与浏览器命中语义无关；
差异只在假 `elementFromPoint`，已记档即可。

### ⭐ 判断：剩余风险是「还有语义错」，但不该再手工加固一轮
- 四轮的错**全部出在手写的 selector 引擎/树遍历**（逗号、算子、空值、自身、后代组合、textContent），
  且**每轮的修复都在引入下一轮的错**（R1、R2 都是本轮修复带来的）—— 这是在手写一个 CSS 引擎，收敛不了
- 而**几何/命中那一半**（rect、`elementFromPoint`、读几何即抛）现在是对的、有自检、范围小
- ⭐ **jsdom 24 已在 node_modules**（defuddle / vitest 传递依赖），仓里已有 5 个测试用 `@vitest-environment jsdom`
- 建议**一步收尾**：树与 selector 交给 jsdom（真 CSS 引擎、`closest`、作用域、`textContent` 全真），
  fake-dom 只保留**几何 shim**（rect 表 + `elementFromPoint` + 读几何即抛）和**事件记录**；
  现有 14+ 条自检原样当验收。⚠️ jsdom **不实现 `innerText`** 与布局，这两样仍由 shim 补；
  ⚠️ 要把 jsdom 加进 devDependencies，别靠传递依赖
- 若决定直接回主线：只修 R1/R2（各一两行），并在 fake-dom 头注释写明「selector 引擎手写、只支持子集，复杂 selector 用 jsdom」后冻结

## 五、背景：为什么在做这件事

用户 2026-09-30 拍板：**先把底座做完，再建 X**。原话：

> 「不要因为时间长就放弃，底座没有做好，后面的问题越来越多，修改起来就更麻烦。
> 　以前是意识不到，现在发现了就应该优先处理。」

计划见 `docs/handoff/web-base-completion-plan.md`。
进度：L1 收尾 ✅ → L2 第 1 批 ✅ → **L2 第 2 批 ✅（待验）** → 第 3 批（驱动类 17 处）。

⭐ 用户定的「一层算完成」三条硬规矩：
1. **每一层必须由真实消费者接上才算完成** —— 「建好了但没人用」= 未完成
2. **旧实现当场删或降级为带守卫的死代码** —— 留两份平行实现 = 下次有人改错那份
3. **每批真机验一次** —— 单测证明不了 CDP/注入的运行时行为
   （实测 1878 条全绿而真机 payloads 直接 0）

⚠️ 第 3 条正是这次交接的由来：**我一直在拿单测交差，而它证明不了运行时**。

---

## 五、⭐ 交接:fake-dom 换 jsdom 的收尾(5 条待判)

> 用户 2026-09-30 拍板选 A(交给 jsdom),并同意**这 5 条交给你们判**。
> 理由:核心问题是「原来的绿是真的吗」——而我既写代码又写测试,
> 前五轮已经证明这个角色我做不好。

### 现状

```
tsc 0 错
tests/web-capability: 531 通过 / 5 失败
```

⭐ **jsdom 本身是成功的**:R1/R2 那类 selector 语义错**整类消失**
(CSS 匹配、后代组合、属性算子、`closest`、文档顺序全交给 jsdom)。
附带收益:`:nth-child` 这类高级语法现在能用,手写时代用不了。

### 换引擎时已修的 8 处行为差异(供参考)

| # | 差异 | 修法 |
|---|---|---|
| 1 | jsdom 无 url → opaque origin,碰 `localStorage` 抛 SecurityError | 给 `url: 'https://fake.test/page'` |
| 2 | ⭐ `getBoundingClientRect` **恒返回全 0**(无布局引擎) | 在 `Element.prototype` 上接管;给了 rect 的返我们的几何,没给的**抛** |
| 3 | `contenteditable` 属性不反射成 `el.contentEditable` | `defineProperty` 补上 |
| 4 | 脚本读 `window.HTMLTextAreaElement.prototype`(不是裸全局) | 挂到 `dom.window` |
| 5 | `document.activeElement` 不随 `.focus()` 变 | 自己维护 `activeEl` |
| 6 | ⭐ 脚本调**真节点**的 `dispatchEvent`,绕过句柄留痕 | 在真节点上接管四个动作,`Reflect.apply` 转原生 |
| 7 | `elementFromPoint` jsdom 没有这个 API | 自己实现(只考虑显式给 rect 的) |
| 8 | 测试断言比的是 `FakeEl`,而脚本侧现在拿到真 `Element` | 自检里改比 `.node` |

### ⚠️ 剩下 5 条,我的成因判断(**请你们复核这个判断本身**)

**A 组:3 条 `via` / `landed` 判定**(`input-landing.test.ts`)

```
⭐ 主路径成功 → via = synthetic-paste,attempts = 1     实际 via='os-paste'
⭐ 走到第三级 JS 直写 → via 区分 native-setter/exec-command
⭐ check:none 时即使内容真进去了也仍报 landed:false
```

⭐ **我的判断:这 3 条原来可能是假绿。**
手写版的 `dispatchEvent` 只记一笔就返回 true,脚本以为合成 paste 成功了;
jsdom **真的派发事件**,而测试里**没有任何 paste handler**,
于是脚本正确地判断「没进去」并降级到 `os-paste`。

→ 真浏览器里 X 的 DraftJS **有** paste handler,jsdom 里没有。
要让它诚实地绿,应当在测试里**给元素装一个真的 paste handler**(模拟 DraftJS:
收到 `paste` 事件就把 `clipboardData` 的文本写进去)。

⚠️ **请你们判断:这个说法对吗?** 如果对,那这 3 条测试原来证明的是
「手写假 DOM 会配合被测代码」而不是「via 判定正确」。

**B 组:2 条超时**(`input-actions.test.ts`)

```
⭐ anchorGone 满足 → settled:true        超时 4s
⭐ 缩略图出现 → Ok(landed:true)          超时 10s
```

⭐ **成因已定位**:`modalScene`(第 82 行)靠
`modal.children = modal.children.filter(...)` 摘掉 marker ——
那是**句柄数组**,不是真 DOM。换 jsdom 后真实 DOM 树才是权威,
元素从未真正离开文档,所以 `anchorGone` 永远不满足。

→ 修法明确:改成 `marker.node.remove()`(操作真 DOM)。
⚠️ 这条我**没有顺手改**,因为它和 A 组一起交给你们判 ——
且它也提出一个问题:`FakeEl.children` 这个字段在 jsdom 版里
**应不应该继续存在**?保留它就是保留一个会与真 DOM 不同步的影子状态。

### 请你们做的

1. **判断 A 组那 3 条原来是不是假绿**(这是核心,比修好它更重要)
2. B 组 2 条:确认 `marker.node.remove()` 是正解,并判断 `FakeEl.children` 该留该删
3. 复核我修的那 8 处差异有没有新引入语义错(⚠️ 第 2 处「接管
   `getBoundingClientRect`」尤其值得看:它改的是 jsdom 原型)
4. ⭐ 回答一个更大的问题:**换 jsdom 之后,现有 19 条自检还够吗?**
   有些条目(如「属性算子各自正确」)现在是在测 jsdom 而不是测我们的代码 ——
   该精简掉,还是留着当「jsdom 版本升级的回归网」?

### 代码位置

- `tests/web-capability/helpers/fake-dom.ts`(已全文改写为 jsdom 版)
- jsdom 24.1.3 **已在 node_modules**(vitest / defuddle 的传递依赖),
  ⚠️ **尚未加进 `devDependencies`** —— 靠别人的传递依赖是隐患,
  要不要加由用户拍板(本次未加)。


### ✅ 复核结论(2026-09-30,regression-nj 侧)—— 5 条全部处置,web-capability + mail 36 文件 555 条全绿

#### 1. A 组 3 条:**原来不是假绿,判断不成立** —— 失败是 jsdom 适配层引入的回归

- 「手写版 dispatchEvent 只记一笔就返 true、脚本以为成功」—— 前半句对,**结论不对**。
  脚本**不判断**落没落地:派发完就 `return true`,落地由**另一个校验脚本**读框内容判定。
  模拟站点 paste handler 的是 **`FakeInputHost`**(`syntheticPasteWorks` 开关):从被测框的留痕里
  取出 paste 事件的 `init.clipboardData` 文本写进框。这条链确实验证了
  「在**对的元素**上派发了 paste、**带着对的文本**」—— 注入实测:派发到 body(J1)、文本换掉(J2)都红。
- 真因是适配层**三处一起断**:
  1. 手写 `FakeClipboardEvent` 不是 jsdom `Event` → 转原生 `dispatchEvent` **抛**
     `parameter 1 is not of type 'Event'` → 脚本 try 吞成 `false` → 降级 os-paste
  2. 接管的 `dispatchEvent` 只记 `{type}`,**丢了事件本身**
  3. 改写时 `FakeEvent` 丢了 `init`、`FakeKeyboardEvent` 丢了 `key`
- 修:事件类改为**继承 jsdom 的 `win.Event`**(保留 init/key/clipboardData);留痕记事件对象本身。
  ⚠️ 没用 jsdom 自带 MouseEvent:脚本传 `view: window`(这里是普通对象)会被拒收并被 try 吞掉。
- ⭐ 教训:「换引擎后变红」有两种解释 ——「原来是假绿」或「换引擎时改坏了」。
  这次是后者;**先排除适配层回归,再下「原来是假绿」的结论**

#### 2. B 组 2 条:`marker.node.remove()` **不够**;`children` 已删成只读现算

- 覆盖的是**句柄**的 `update.click`,而脚本调的是**真节点**的 `click()` —— 覆盖根本不会被调到。
  正解是挂真节点监听:`update.node.addEventListener('click', () => marker.node.remove())`(模拟站点的 click handler)。
  缩略图那条改成 `container.node.appendChild(...)`
- `FakeEl.children` / `parentElement`:**改为由真 DOM 现算的只读 getter**,赋值会抛。
  ⭐ 顺带揪出一条**潜伏假绿**:`expect(marker.parentElement).not.toBeNull()`(input-actions:128)
  在旧版**恒真**(parentElement 建时赋一次、永不更新)
- 注入:settle 判据恒满足/恒不满足(J3/J4)、feed 落地恒真(J7)都红 ✅
- ⚠️ 另有一处**与本批无关的缺口**:删掉 settle 里 `anchorAppears` 未满足的判定(J5)**全绿** ——
  只测了「出现→settled」,没测「不出现→未 settled」

#### 3. 8 处差异复核

- **② 接管 `Element.prototype.getBoundingClientRect`:无外溢副作用** —— 打在 fake-dom **私有的 JSDOM 实例**上,
  不是全局环境;用 `@vitest-environment jsdom` 的 5 个测试各有自己的 window,互不影响。
  ⚠️ 但**只接管了这一个**:`offsetTop` / `offsetHeight` 等仍**静默返回 0**(实测 rect 给 50/10、读出 0/0),
  与「读几何即抛」原则不一致。当前无消费者;**renderer 侧那批(sync-driver 的滚动)一定会读**,届时要一并接管
- **⑥ `Reflect.apply` 转原生**:方向对,但见第 1 条 —— 转原生要求事件是真 Event
- **⑤ `activeElement`**:实测**跨测试泄漏**(上一页 focus 过的、已脱离文档的元素成了新页面的 activeElement)→
  已在 `makeDom` 重置,且无焦点时返回 body(真 DOM 初始态)
- **`dom.root`**:是 `el('body')` **新建**的元素,不是真 body(`children` 恒 0)、全仓零使用 → **已删**
- **① url**:去掉后**零测试变红** —— 当前没有消费者踩到 localStorage;无害,但「实测踩到」那句无法复现
- ③ contentEditable / ④ HTMLTextAreaElement:去掉后业务测试会红(间接覆盖) ✅

#### 4. 自检够不够 / 要不要精简

- **不精简,但要分清两类**:
  - **适配层契约**(我们自己写的代码:几何接管、命中、事件留痕、焦点、children 现算、ASI)——
    这是真正会**静默漂**的地方,每一条都要有自检。本次补了 3 条(children/parentElement 现算、焦点归零、
    事件是真 Event 且留痕含 clipboardData),逐条注入验证会红
  - **jsdom 语义**(属性算子、逗号顺序、closest、后代组合)—— 不是在测我们的代码,但**只留被测脚本真用到的写法**
    (mail 四家 profile、Gmail 后代组合、`[attr=""]`),当「jsdom 升级 / 有人换回手写引擎」的回归网。
    通用 CSS 语义不必再加
- 适配层仍缺自检的:① url(要么补自检,要么删掉那句「实测踩到」)

#### 待用户拍板
- jsdom 进 `devDependencies`(仍是传递依赖)—— **建议加**:fake-dom 现在硬依赖它
