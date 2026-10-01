# `renderer → web.dom` IPC 面 —— 设计（待拍板）

> L2 收口的最后一块：renderer 侧 18 处裸注入。
> 用户 2026-09-30 已确认消费者：**「未来还需要做很多社区论坛的对应自动化功能，所以这些肯定需要的。」**

---

## 一、⚠️ 实测先行：这 18 处不是同一种东西

把它们按**调用频率**分开，结论就变了：

| 组 | 处数 | 动作 | 频率 |
|---|---|---|---|
| **A 高频轮询** | 1 | `poll` 抽干事件队列 | ⚠️ **每 80ms**（`SYNC_POLL_MS`） |
| **B 一次性注入** | 2 | `injectSyncScript` / translate 的 CSP+element.js | 页面加载时 1 次 |
| **C 动作型** | 9 | `applyScrollDelta` / `applyClickSync` / `applyInputSync` / `applySubmitSync` / `applySelectionHighlight` / `drainQueue` … | 跟随用户操作 |
| **D 其它** | 6 | translate 剩余 / `web-rendering` 类型声明 | 低频 |

### ⭐⭐ A 组是设计的分水岭

`poll` 每 80ms 跑一次 = **12.5 次/秒 × 每个 webview**。
走 IPC 的话每次是 **renderer → main → guest → main → renderer** 四跳。
双开两个 webview 就是 **25 次/秒的 IPC 往返**，而它现在是 renderer 直接调 `<webview>`。

⚠️ **把 A 组搬上 IPC 是性能回归**，而且它换不来安全收益 ——
它注入的脚本是**写死的字面量**（读 `window.__krigSyncQueue` 并清空），
**零参数、零拼接**，根本不存在转义事故的攻击面。

> ⭐ 回到 L2 收口的初衷：要治的是
> `project-x-inject-template-escape`——**把运行时值拼进脚本文本**。
> A 组没有这个问题。为它建 IPC 是**为了整齐而付性能**。

---

## 二、建议：建 IPC 面，但**不是**为了搬走全部 18 处

### ✅ 该走 IPC 的：B + C + D（17 处）

它们都有真实收益：

| 收益 | 说明 |
|---|---|
| ⭐ 参数绑定 | C 组有 `${deltaY}` / `${event.pctY}` / `${blocksJSON}` 等**运行时值进脚本** |
| ⭐ 预注册脚本 | B 组注入的是整个 `?raw` 文件，正该登记进 `ScriptRegistry` |
| ⭐ 留痕 | 走 `web.dom` 自动获得 `trace` / `raw` 落盘，现在这些注入**一行痕迹都没有** |
| ⭐ 统一失败语义 | 现在是 `.catch(() => {})` 静默吞，走 `Result` 三态后失败说得出原因 |

### ⏸️ A 组（`poll`）留在 renderer，**并写明理由**

⚠️ 不是"偷懒"，是**判据不同**：
零参数、字面量脚本、12.5次/秒 —— 走 IPC 有成本无收益。
⭐ 但要在代码里注明「**为什么它可以不走**」，否则下一个人会以为是漏掉的。

> 判据：**注入脚本里有没有运行时值？** 有 → 必须走 web.dom；
> 没有且高频 → 可以留在 renderer，但要注明。

---

## 三、IPC 面的形状

⭐ 不是把 `WebDom` 六个方法逐个开通道 —— 那样**每加一个能力就要动通道表**
（`feedback-guard-hardcoded-list-never-grows` 的同族风险）。

```
         renderer                    main
    ┌──────────────────┐      ┌─────────────────────┐
    │ webDom.run(      │      │  WEB_DOM_INVOKE     │
    │   pageRef,       │ ───► │    ↓                │
    │   scriptId,      │      │  查 pageRef → wc    │
    │   params )       │      │    ↓                │
    │                  │ ◄─── │  domRunner.run(...) │
    │   Result<T>      │      │  (已有,不改)        │
    └──────────────────┘      └─────────────────────┘
```

**一个通道 `WEB_DOM_INVOKE`，载荷带 `op`**：

```ts
type WebDomInvoke =
  | { op: 'run';     pageRef: PageRef; scriptId: string; params?: ScriptParams }
  | { op: 'read';    pageRef: PageRef; extractId: string; params?: ScriptParams }
  | { op: 'query';   pageRef: PageRef; anchor: string }
  | { op: 'text';    pageRef: PageRef; anchor?: string }
  | { op: 'selection'; pageRef: PageRef };
```

⚠️ **`runDynamic` 不开通道。** 它是 `web.dom` 的逃生口（dev-only 排查用），
开给 renderer 就等于把「求值任意脚本」的口子重新打开 ——
`channel-names.ts` 里那条注释（控制台时代）写得很清楚：
「刻意一能力一通道，不做求值任意脚本的万能通道：那等于把 web.dom 费力关掉的注入口重新打开」。

### ⭐ `pageRef`：renderer 怎么指认一个页面

⚠️ 这是最容易做错的地方 —— 记忆里 `project-pm-panel-instance-id`
与 `project-host-broadcast-multi-ws-fanout` 都是「指认错实例」造成的。

renderer 手上有的是 `<webview>` 元素，它的 `getWebContentsId()`。
所以 `pageRef = { wcId: number }`，main 侧用它查 `pageRegistry` + `bindPageHost`。

⭐ 判据：**绝不让 main 侧"猜"是哪个页面**
（不用 activeWs、不用"最后 navigate 的那个"——
`page-registry.ts:15` 已记过那条血泪：
「底座替应用做了选择，而它没资格做：它不知道业务意图」）。

---

## 四、⚠️ 分层方向不能反

```
renderer (drivers/)                     ← 调用方
      │ IPC: WEB_DOM_INVOKE
      ↓
main/web-capability/wiring/ipc-dom.ts   ← ⭐ 新增,唯一接线点
      ↓
main/web-capability/dom (domRunner)     ← 已有,一行不改
```

⭐ 新文件只许放在 `wiring/` —— 那是本层**唯一允许碰 Electron 的目录**
（`page-boundary-guard` 钉着「除 wiring/ 外零处 Electron」）。
⚠️ `ipcMain.handle` 放进 `dom/` 会当场撞守卫，这是**对的**。

守卫要加的两条：
1. `renderer` 侧**不许** import `web-capability`（现在也没有，趁零违规立）
2. 新通道**不许**出现 `runDynamic`

---

## 五、脚本登记：B/C 组的脚本从哪来

现有 B 组注入的是 `?raw` 整文件（`sync-inject.js` / `google-translate-inject.js`），
C 组是模板字面量拼出来的小脚本。

⭐ 都要进 `ScriptRegistry`，按 `web.dom` 的既有范式：
参数一律 `JSON.stringify` 绑定，调用方只给 `scriptId` + `params`。

⚠️ 并且要过**求值守卫**（`new Function` 真解析 + 不许裸插值）——
`dom-locate-scripts.test.ts` / `mail-extract-script.test.ts` 已有现成范式，
且 `fake-dom`（jsdom 版）现在能真跑这些脚本。

---

## 六、分步与判据

| 步 | 做什么 | 判据（真机） |
|---|---|---|
| 1 | 建 `wiring/ipc-dom.ts` + 一个通道 + `pageRef` 解析 | 控制台/临时入口能 `text(pageRef)` 拿到页面文字 |
| 2 | B 组 2 处迁过来（一次性注入） | ⭐ 双开 web view 同步仍工作、翻译仍工作 |
| 3 | C 组 9 处迁过来（动作型，有运行时值） | ⭐ 滚动同步/点击同步/输入同步逐个真机验 |
| 4 | D 组 6 处 | 翻译链路完整 |
| ⏸️ | A 组 `poll` 留在 renderer + 注明理由 | —— |

⚠️ 每步都要真机验 —— 单测证明不了 webview 行为
（`project-x-collect-two-legs`：1878 条全绿而真机 payloads 直接 0）。

⭐ 步 2/3 动的是**正在用的功能**（双开同步、网页翻译），
这是本轮底座收口里**第一次改动用户每天在用的路径** —— 判据必须逐个真机过。
