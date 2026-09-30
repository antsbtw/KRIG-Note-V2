# 建 X 之前：分层底座到底完成到哪一步？

> 用户 2026-09-30 三问：
> ① 如果这些分层函数有问题，或者抽象不够，要先优先考虑，你觉得呢？
> ② 6 层中只发现 4 层的函数和操作，为什么少了两层？
> ③「后建，专门补 9 处 CDP 重复」这部分工作完成了吗？

⭐ 三个问题都查了实测答案。**结论：②不是问题，③没完成，①因此成立。**

---

## ③ 先回答最硬的：CDP 收口**没有完成**

⚠️ 实测（2026-09-30，全仓 grep `debugger.attach` / `debugger.sendCommand`）：

| 位置 | 状态 | 说明 |
|---|---|---|
| `web-capability/wiring/electron-input.ts` | ✅ 正当 | **唯一该有的收口处** |
| `ai/interceptor.ts:388` `startGeminiCDPLegacy` | ⚪ **死代码** | 自述「已无调用方」，**已核实**：全仓零调用 + `ai-gemini-migration.test.ts` 守卫锁死 |
| `web-service-base/webview-file-input.ts:206` | 🔴 **活的重复** | 自己 attach、自己 `DOM.getDocument/querySelector/setFileInputFiles` |

### ⭐ 所以真实状态是

- **AI 那条腿迁完了**（走 `netBus` / `bodyProvider`，旧实现降级为带守卫的死代码）
- **X 那条腿连同 X 一起被删了**（所以"重复"看着少了，不是因为收口，是因为消费者没了）
- **`webview-file-input.ts` 这条还在**，且它是 L4 的一部分

⚠️ 更要紧的是：**`feedFilesToInput` / `feedVideoToInput` 现在零消费者** ——
唯一的调用方是 X（发推喂图/喂视频），X 删了它就悬空了。

> ⭐ 它不是"没用的代码"，是**下一步 X 一定会用的代码**，
> 且它内含一条血泪（`project-ws-instance-isolation-invariant`）：
> 「已被别处 attach 就复用且末尾不 detach —— 一个 wc 只允许一个 debugger client，
> 抢别人的会掐掉 AI 的 SSE 拦截器」。
> **这条约束必须在收口时保住**，否则 X 一接上就掐 AI。

---

## ② 为什么只看到 4 层？—— 因为另外两层**从未动工**，不是丢了

⭐ 仓里有明确记载（`09-history.md` §1，V1 实测 7623 行）：

| 层 | 状态 | 行数 |
|---|---|---|
| L0 Core | ✅ 真实现 | 343 |
| L1 Network | ✅ 真实现 | 1029 |
| L6 Persistence | ✅ 真实现 | 2103 |
| **L2 Runtime** | ❌ **7 行空壳** | 7 |
| **L3 Render** | ❌ 7 行空壳 | 7 |
| **L4 Interaction** | ❌ **7 行空壳** | 7 |

三个空壳文件的原文都是：

```ts
/** ... abstractions live here.
 *  Concrete implementations are intentionally deferred. */
export {};
```

> ⚠️ 原文自己点破了：`README.md` 说 Phase 0-5「已完成」，
> 准确说是 **L0/L1/L6 完成，L2/L3/L4 从未动工** —— README 汇总口径太宽。

### ⭐ 结论：少的两层是 **L3 Render** 和 **L5 Artifact**，它们是**故意缓建**的

- **L3 Render**（截图 / 渲染态）—— 文档写明「本次不做」
- **L5 Artifact**（站点适配产物）—— V1 那 2959 行被判定「是 adapter，非底座，不搬」

⭐ 这两层的共同点：**它们是给"专业网站服务"铺路的**（文档原话），
X 的采集/回复**用不到**。所以缺它们**不影响 X 重建**。

⚠️ 但要记住：**L3 将来一定会用到** —— X Articles 的「呈现态截图发布」
（`project-x-articles-impl`：table 可调、发布时截图）就是 L3 的活。
现在没有，将来做 Articles 时要么补 L3，要么又在 X 里写一份。

---

## ① 所以「先把底座弄好」成立吗？—— ⭐ 成立，但只该做**一件**

⚠️ 「抽象不够就先补」是对的方向，但**不能变成"把 L2–L6 都建完再说"** ——
那是另一个半年工程，而 X 现在连一行代码都没有。
本仓的教训恰恰是**先建一堆没有消费者的抽象**（L1 建好后 X 那边没接上就被删了）。

### ✅ 建 X 之前该做的，只有一件

**把 `webview-file-input.ts` 的 CDP 收口到 `web-capability`。**

判据（三条都成立才值得做）：
1. ⭐ **它是活的重复**（不是死代码），且是**最后一处**
2. ⭐ **X 马上就要用它**（发推喂图/喂视频走路线 B）
3. ⭐ **它带着一条会伤到 AI 的约束**（debugger 单客户端），
   收口时把约束一起搬进去，比留在原地各写一份安全

### ⏸️ 不该现在做

| 事 | 为什么先不做 |
|---|---|
| 建 L3 Render | X 采集/回复用不到；做 Articles 时再补 |
| 建 L5 Artifact | 被判定是 adapter 非底座 |
| 建 L6 Persistence | X 自己有库表，不走通用落库 |
| 重构 L0 registry 的「最后 navigate 胜出」 | ⭐ **X 不用它就行**（走 `page-registry.find`），改它会动 AI/Mail |

⚠️ 最后一条特别说明：L0 那个缺陷（底座替业务猜"谁是活跃的"）**确实存在**，
但 AI/Mail 现在跑得好好的，X 只要**不用**旧 registry 就绕开了。
**"绕开"比"重构"便宜得多，且不动在跑的东西。** 等 X 稳定后再回头统一。

---

## ⭐ 建议的下一步顺序

```
① webview-file-input CDP 收口  ← 唯一的底座债，且 X 马上要用
      ↓ 真机验证不掐 AI 的 SSE
② src/modules/x/ 建目录 + 一行 self-register
      ↓
③ push 语义页面表 → 控制台跑 goto/ready/scrollUntil（零业务代码）
```

⚠️ ① 必须**真机验**：单测证明不了 CDP 通道行为
（上一轮 1878 条全绿而真机 payloads 直接 0 —— `project-x-collect-two-legs`）。
判据是「X 喂文件能成 **且** AI 的 SSE 不断」。
