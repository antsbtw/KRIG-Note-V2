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
[tweetBlock] fetch failed: 等待判据 anchorAppears(tweetArticle) 超时(10000ms);最后一次注入异常: ...
```
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
