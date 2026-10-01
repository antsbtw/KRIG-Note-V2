# ✅ 已结：翻译链路改走 IPC —— 真机验证通过（2026-10-01）

> **结论：翻译正常工作。** 用户 2026-10-01 真机确认「这个弹出翻译了」。
> 下面保留原排查记录，因为过程里有两条值得复用的教训。

---

## ⭐ 真因:日志记在了人看不到的地方,不是代码坏了

2026-09-30 真机失败 → 我请用户给一行 Console 报错 → 拿不到 →
查了**四轮静态证据**(端到端链路实跑通过、handler 注册时机对、
preload 暴露了、脚本进了 bundle)仍定不了因。

⚠️ **障碍不在用户,在我把日志放错了进程**:
调用方的 `console.warn` 打在 **renderer**,只存在于那个 webview 的 DevTools;
而人看的是**启动终端**。
⭐ 于是「我加了日志」与「人能看到日志」是两回事 ——
正是 `feedback-maintainability-over-feature-completion` 的同一种形态:
**记了,但记在人看不到的地方。**

修法(d06e925c):
· 失败在**主进程**也打一行(其中 toIpc 那条路径此前**完全不出声**)
· 启动时报一次脚本表 —— ⭐「成功路径也要留痕」,
  不是等出事才查,而是平时就把判断依据摆出来

## ⭐ 启动自检当场排除了一个假说

```
[web.dom ipc] 已就绪 —— 脚本表共 22 个,其中 renderer.* 12 个:
  renderer.sync-inject, renderer.translate-strip-csp, renderer.translate-mount, …
```
12 个全在、名字全对 → 「脚本没登记上」**证否**,一行日志顶四轮推断。

## ⚠️ 我差点误读「没有报错」

那次日志里零条 `[web.dom ipc] 失败`,但也**零条 translate 痕迹** ——
我没把它当成「修好了」,而是追问「是真好了还是没触发」。
⭐ 判据:日志里只有 `active chatgpt webview`,没有 translate 的 attach。
用户确认后才确定是真好了。
**「没有报错」≠「成功」—— 要先确认那条路径真的走到了。**

---

## 原排查记录(保留)

## 症状（截图实证）

右栏 web view：
- ✅ 「自动检测 → 中文」widget **出来了**
- ❌ 正文**没译**（仍是英文）
- ❌ 背景**没跟暗色**（左栏暗、右栏亮）

## ⭐ 关键线索：走新路径的全败，没走的那个成功了

| 步骤 | 路径 | 结果 |
|---|---|---|
| Step 4 `element.js` | **旧路径**（刻意未迁，见 `translate-driver.ts` 的说明） | ✅ widget 出来了 |
| Step 1 剥 CSP | 新 IPC | ❌ |
| Step 3 挂载壳 | 新 IPC | ❌ |
| Step 5 暗色 meta | 新 IPC | ❌ |

→ 指向 **IPC 链路本身**，不是某个脚本写错。
⭐ 且 Step 5 的脚本与旧版**逐字节相同**（已对比），所以不是脚本内容问题。

## ⚠️ 已排除的（都是真机实跑，别再查一遍）

| 假说 | 结论 |
|---|---|
| guest 的 wcId 在 main 侧查不到 | ❌ **证否**：`webContents.fromId(guest wcId)` 查得到，`type = webview` |
| 对 guest `executeJavaScript` 不行 | ❌ **证否**：成功 |
| 整条链路机制有问题 | ❌ **证否**：端到端复刻（renderer → IPC → main → fromId → 注入 guest）返回 `{"status":"ok","value":"DARK_APPLIED"}` |
| handler 没注册 / 注册太晚 | ❌ `registerWebDomIpc()` 在 `whenReady` 内、建窗口之前 |
| `webDomRun` 没进 preload | ❌ 在 preload bundle 里 |
| 三个脚本没进 main bundle | ❌ 三个标记都在 |

## ⭐ 下一步只差一样：Console 那一行

```
[translate-driver] renderer.translate-strip-csp 失败: ←这后面就是答案
```

它会是三者之一，各自处置完全不同：

| 报错 | 含义 |
|---|---|
| `未注册的脚本 id: renderer.xxx(可用: …)` | main 侧 registry 没登记上 |
| `脚本 xxx 执行失败: …` | 脚本到了页面但被拒（CSP / 时序） |
| `wc#N 不存在或已销毁` | pageRef 指认问题（但上面已证否一半） |

⚠️ 取日志要开**那个 webview 的** DevTools，与宿主窗口的 Console 是分开的；
`translate-driver` 跑在 renderer 进程，宿主窗口 Console 也要看一眼。

## ⭐ 一个值得记的收益

**这次能「只差一行日志」，本身就是本轮收口的成果。**
改之前这两个症状只会是「翻译不工作」，而 `sync-driver` 有
**26 处 `.catch(() => {})`、零 `console.warn`** —— 一个字都不会有。

## 回退方案（若急用翻译）

```bash
git revert d1279840        # 只回 2b(翻译)
```
⚠️ IPC 面（步 1）与 2a（sync 内核）**不受影响**，可以留着 —— 它们与翻译无关。

## 相关

- 设计：`docs/handoff/web-dom-ipc-surface-design.md`
- 步 1：`fcac61a5` · 2a：`83f56fa2` · 2b：`d1279840`
