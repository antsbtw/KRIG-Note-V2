# 实施 Prompt：X 集成 阶段 2.5-a（发送前确认弹窗）

> 交接日期：2026-06-10
> 交接人：总指挥（上一对话）
> 验收人：总指挥
> 路线图：[`docs/tasks/2026-06-10-x-integration-roadmap.md`](./2026-06-10-x-integration-roadmap.md)
> 前置已完成：阶段 0/1（`50c01d58`）、阶段 2（`03e57326`，已验收已 push）于分支 `docs/x-integration-design`

---

## 0. 你的任务边界（只做 2.5-a）

**做这一件事**：在"发推/回复"注入 X 框**之前**，弹一个**发送前确认弹窗**，让用户预览将要发送的内容、确认后才注入。

**不要做**：2.5-b 图片/视频上传、阶段 3 Article、阶段 4 仿 X 预览。看到留 TODO 即可。

**为什么要这个**（动机，别做歪）：阶段 2 现在是「转换后直接盲注入 X 框」+ 一堆 `window.alert/confirm`。用户发出去前看不到"降级后到底长啥样"（markdown 标记被去掉、链接被改写、字数）。2.5-a 给用户一个**预览 + 确认**的关口，降低误发。**仍然不程序自动发布**（写方向红线不变）——确认弹窗只到"注入 X 框"，发布还是用户在 X 上点。

---

## 1. 现状（已核实，照着改）

发送主流程在 `src/views/x/send-to-x.ts`：
- `sendToX()`（`:61`）：取 note 选区/整篇 markdown → `markdownToTweetText`（`:85`）转纯文本 → 超长用 `window.confirm`（`:94`）→ `ensureXVisible` → `pasteTweet`/`pasteReply` 注入 → `window.alert` 告知。
- `startReplyDraft()`（`:143`）：回复入口。
- 降级：`fallbackToClipboard()`（`:50`）注入失败复制剪贴板 + alert。

**插入点**：在 `markdownToTweetText` 得到 `text` 之后、`pasteTweet/pasteReply` 注入之前，加确认弹窗。用户取消 → 直接 return（不注入、不消费 pending reply）。

**现成可复用的弹窗机制**（别用 `window.confirm`，别造新轮子）：
- `src/views/note/ask-ai-popup/`（问 AI 的弹窗面板，最接近的范例 —— 一个浮层 + 内容 + 确认/取消）
- `src/slot/frame-bindings/PopupBinding.tsx`、`src/slot/triggers/popup-controller.ts`（项目的 popup 控制机制）
- 先**读 ask-ai-popup 怎么实现的**（弹出/定位/关闭/确认回调），照同样的模式做 X 发送确认弹窗。

---

## 2. 弹窗要展示什么（内容设计）

确认弹窗至少包含：
1. **将发送的纯文本预览**（`markdownToTweetText` 的结果，所见即所发——这正是 X 框里会出现的内容）
2. **字数 / 超限提示**（复用 `checkTweetLength`，超 280 标红提示，但仍允许继续——X 那边会拦）
3. **发送类型**：普通推 vs 回复；若回复，显示回复给谁（`peekPendingXReply()` 的 `preview/tweetUrl`）
4. **整篇 vs 选区**（`usedWholeDoc` 那个信息）
5. **操作**：「填入 X」（确认）/「取消」
6. **（可选，加分）允许在弹窗里临时编辑这段文本**再填入——但**不要**回写 note，只改这次要发的内容。拿不准就先不做，留 TODO。

确认 → 走原有 `ensureXVisible` + `pasteTweet/pasteReply` 注入逻辑（不变）。
取消 → return，不注入，不 `consumePendingXReply`。

---

## 3. 铁律（沿用，违反即返工）

> **【写方向红线】** 弹窗只到「填入 X 框」。**绝不**在确认后程序点 X 的发布/回复按钮。文案要让用户明白"填入后还要自己在 X 点发布"。

> **【铁律 1｜复用不造轮子】** 用项目现成 popup 机制（ask-ai-popup 模式），不要新引入 Modal 库，不要继续堆 `window.confirm`。本阶段顺手把 `sendToX` 里的 `window.alert/confirm` 收敛进统一弹窗体验（至少发送确认这条主路径）。

> **【铁律 4｜fail loud】** 注入失败仍走 `fallbackToClipboard`（剪贴板 + 明示降级），不变。弹窗不能吞掉失败。

> **【铁律 5｜扇出守卫】** 若确认弹窗涉及命令/广播，沿用 `x-commands.ts` 模块级单订阅 + `getActiveId` 守卫模式。弹窗本身是 renderer UI，注意别在多 XView 实例里重复挂。

> **【不污染 AI】** 这是 X 专属 UI，别动 ask-ai-popup 本身（可参考、可抽公共，但抽公共要确保 AI 那边不回归——和阶段 2 抽 writer 同样的纪律）。**若选择抽公共弹窗组件，必须实测 AI 问 AI 弹窗未回归。**

---

## 4. 需你定的策略点（拿不准列出来问总指挥，别硬写）

- **弹窗里要不要支持临时编辑文本**（§2.6）？建议先只读预览 + 确认/取消，编辑留 TODO。
- **弹窗定位**：居中浮层 vs 贴着触发位置（ask-ai-popup 怎么定位就怎么来）。
- **是否一并替换 `startReplyDraft` 那条路径的 alert**，还是先只做 `sendToX` 主路径。建议主路径先做，回复路径文案统一。

---

## 5. 交付物与验收清单（自检，总指挥据此验收）

**质量门禁（与阶段 2 同标准）**：
- [ ] `npm run typecheck` 0 错
- [ ] `npm run lint` 无新增告警（基线 10 个 pre-existing：4 error 在 `src/views/note/*-import.ts` 的 content-ingest import + 6 warning，本期不得新增）
- [ ] `npx vitest run` —— **务必全量跑并如实报数**。已知基线：`tests/storage/bulk-delete-perf-verify.test.ts` 有 8 个 **flaky** 失败（测试间 SurrealDB 状态串扰，单独跑全过，与 X 无关）。**报数时把它和你的真实结果分开写，不要笼统说"全绿"**（上一阶段就栽在这——别重蹈）。
- [ ] 应用启动无新增控制台报错

**功能自检**（无 GUI 的话说明哪些只能总指挥实机验）：
- [ ] 发普通推：确认弹窗正确显示预览/字数/类型，确认→填入，取消→不填入
- [ ] 回复：弹窗显示"回复给谁"，取消时 pending reply 未被消费
- [ ] 超长：弹窗标红提示，仍可继续
- [ ] 注入失败仍降级剪贴板 + 明示

**架构自检**：
- [ ] 用了项目现成 popup 机制，没堆 `window.confirm`、没引新库（铁律 1）
- [ ] 写方向红线：确认后只填入不发布
- [ ] 若抽了公共弹窗组件，AI 问 AI 弹窗实测未回归
- [ ] fail loud 不变（铁律 4）

**交回总指挥时请附**：
1. 改动文件清单（新增/修改 + 一句话职责）
2. 弹窗实现方案（复用了 ask-ai-popup 的什么、有没有抽公共、AI 是否回归）
3. §4 策略点你的决定
4. 自验录屏/截图（确认弹窗 + 取消路径 + 失败降级）；无 GUI 则明确列出待总指挥实机验的点
5. **如实的测试报数**（你的真实通过数 + 那 8 个 flaky 单列）

---

## 6. 红线（踩了直接返工）

- ❌ 确认后程序自动点 X 发布（写方向最高红线）
- ❌ 继续用 `window.confirm/alert` 当确认弹窗 / 引入新 Modal 库（违反铁律 1）
- ❌ 改坏 ask-ai-popup 导致 AI 问 AI 回归
- ❌ 测试报数笼统说"全绿"而不全量复核（上阶段教训）
- ❌ 超范围做 2.5-b / 阶段 3
- ❌ 凭记忆写 —— 先读 `send-to-x.ts` 和 `ask-ai-popup/` 真实代码

有架构判断拿不准（弹窗用 PopupBinding 还是自建、要不要抽公共、编辑功能做不做）——**停下来在交付说明里列问题**让总指挥定。
