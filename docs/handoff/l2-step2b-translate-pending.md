# ⚠️ 未结：翻译链路改走 IPC 后，三个脚本真机失败（待调试）

> 2026-09-30 真机验证发现。用户决定：**先按大框架走完，后面再细调**。
> 本文件是待办记录，**不是结论** —— 真因未定。

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
