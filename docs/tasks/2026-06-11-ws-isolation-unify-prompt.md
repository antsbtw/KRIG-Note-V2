# 实施 Prompt：ws 实例隔离 —— 统一收口（剩余 3 处 + 底座合一）

> 交接日期：2026-06-11
> 交接人：总指挥
> 验收人：总指挥
> 关联记忆：`memory/project-ws-instance-isolation-invariant.md`
> 前置：AI 侧（`90d67095`）、X 发推/回复已按 ws 定向且实机验证通过。本任务把**剩余 3 处**同款 bug 一次收口干净，bug 家族彻底了结。

---

## ★ 总指挥裁定（2026-06-11，针对你调查后提的 7 决策 —— 以此为准，照此动手）

你的调查很到位，尤其**纠正了 SSE 现状**（已核实属实）：Claude/ChatGPT 的 SSE 走 guest page-cache + `resolveAIWebContents(targetWcId)` 读，**已按 ws 正确**；真正还全局的只有 **Gemini（main 端 CDP 缓存）+ captureManager 生命周期**。基于此裁定：

| 决策 | 裁定 | 说明 |
|---|---|---|
| 1 工厂落点 | 按你文档倾向（web-service-base 出公共 ws-host-registry 工厂） | renderer 侧合一 + main 侧 resolver 泛化 |
| 2 **fail loud 统一** | **统一为 fail loud** | X 的 `requireXWebContents`（`x-write.ts:103-105`）**删掉回退全局 active 那段**，未命中返 error。**但 poll 等待逻辑必须保留**（覆盖切 X 的 1-3s 窗口）。⚠️ 改 X 行为 → §A 必须实机验。 |
| 3 ② X extract 透传 | 按你倾向，纯透传 | `x-extract-tweet.ts:92` 改用 `getXHostWcId(wsId)`（命令侧 `x-commands.ts:106` 现成），收口，爆破半径最小 |
| 4 **③ Gemini SSE** | **选 A：per-ws manager 池，现在彻底清零** | 用户拍板"现在不想留尾巴"。见下方 §B 风险对冲——**A 唯一红线：绝不碰坏 Claude/ChatGPT 的 SSE** |
| 5 X Host 登记时机 | 保持现状（X 是 AIView 外挂、AI 是 Host 自内聚），不顺手重构 | 只在 registry 工厂层合一，守爆破半径 |
| 6 旧全局函数 | 业务零调用后删 `getActiveXWebContents`；`getActiveAIWebContents` 若仅底座 detect 用则 @deprecated | track/subscribeAttach 保留 |
| 7 其余 | 按你文档倾向 | — |

### §A 决策 2 改 X 行为 → 必须实机验（无 GUI 则明确列给总指挥）
X 发推 / X 回复 / X 提取推文，在"切到 X 的 1-3s 窗口内"和"正常态"都要验仍正常（poll 保留是关键）。未命中要明确报错不静默。

### §B 决策 4 选 A 的风险对冲（最高优先，A 的成败在此）
**A 的处境**：ai-sync 当前 `AI_SYNC_ENABLED=false`，所以 **A 改完你自己实机验不了 Gemini 多 ws**（功能是关的）。这是已知代价（用户接受盲提）。因此 A 必须靠**结构性保证**而非实机验来兜底：

1. **绝对红线：A 不得改坏 Claude/ChatGPT 的 SSE。** captureManager 里 `geminiResponses`/`geminiDebuggerAttached`/`startGeminiCDP` 是 **Gemini 专属字段**（已核 `interceptor.ts:31-32,57`），Claude/ChatGPT 不碰它们。改 per-ws 池时，**Claude/ChatGPT 的 SSE 路径（guest page-cache，已正确）尽量零改动或仅随工厂签名透传**——任何会动到两家的改法，停下来问总指挥。
2. **回归证明**：Claude/ChatGPT 的"问 AI + 提取整页对话"**实机验通过**（这两家能验，是 A 没伤及它们的实证）。Gemini 因 ai-sync 关无法实机验 → 在交付说明里**明确标注"Gemini per-ws SSE 为盲提、待开 ai-sync 时实机验"**，并说清代码上为什么应当正确。
3. **生命周期**：per-ws manager 池要处理 ws 销毁时 detach CDP / 清缓存（别泄漏 debugger）。`subscribeAttach`/`track` 是 track 新 webview 的命脉，**保留**，只改"按 ws 持有 manager + 读对应 ws 的缓存"。

---

## 0. 背景：这是同一个 bug 家族的最后清扫

**bug 模式**（同一个错误反复出现）：代码判断"当前要操作哪个 webview"时，靠 main 侧全局单例 `getActive(serviceKey)` —— **"最后 navigate 的那个胜出"，不绑 workspace**。多 ws / 多实例时会取错实例（"日志说成功，但用户看的框是空的"）。

**已修**：AI 问答/发推/提取（`90d67095`）、X 发推/回复。各自建了 renderer 侧 `Map<wsId,wcId>` registry（`ai-host-registry.ts` / `x-host-registry.ts`，**两者几乎一字不差**），操作时按活跃 ws 取 wcId、IPC 透传、main `webContents.fromId` 精确定位。

**本任务收口剩余 3 处**（均已核实现状）：

| # | 遗留 | 现状（已核实） | 严重度 |
|---|---|---|---|
| ① | **底座下沉 + 两套 registry 合一** | AI/X 各一份 `Map<wsId,wcId>`（代码几乎相同）；每个调用点手动传 wcId；main `getActive` 仍是全局 bug 根源 | 架构债，从根上治 |
| ② | **X extract-tweet 收口** | `src/platform/main/x/x-extract-tweet.ts:92` 仍用 `getActiveXWebContents`（全局 active），同款 bug 没修齐 | 真 bug，冷门路径 |
| ③ | **SSE manager 仍全局** | `SSECaptureManager`（`src/platform/main/ai/interceptor.ts`）经 `subscribeAttach` 跟随全局 active 偷听 AI 回复流；多 ws 时**注入打到 A、偷听可能截 B** → 提取对话内容错位 | 真 bug，当前 `AI_SYNC_ENABLED=false` 未暴露，**开 ai-sync 前必须先收口** |

---

## 1. 动手前必做：调查先行（这是架构改动，别上来就写）

下沉牵动面比单点修复大。**先读、先出方案、再动手**（项目铁律：别猜，看真实数据）：

1. 读 `src/platform/main/web-service-base/webview-registry-base.ts`（全局 `getActive` 根源）。
2. 读 `ai-host-registry.ts` + `x-host-registry.ts`（确认两者可合一，差异只有变量名）。
3. 读 AI Host / X Host 的 `getWebContentsId()` + 登记时机（dom-ready/navigate 登记、卸载 clear）。
4. 读 ② `x-extract-tweet.ts:92`、③ `interceptor.ts` 的 `subscribeAttach` 用法 + `getSSECaptureScript` 注入时机。
5. **产出一份下沉设计方案写进交付说明**（见 §2 的决策点），**总指挥确认后再大动**。若方案分歧大，先只列方案、等拍板。

---

## 2. 设计决策（先定，写进交付说明让总指挥确认）

1. **底座下沉的形态**：把"按 wsId 登记/查 guest wcId"做成 `web-service-base` 的公共能力（renderer + main 两侧），AI/X 都改用它，删掉两份重复 registry。
   - 关键问题：renderer 侧 registry（`Map<wsId,wcId>`）和 main 侧（`webContents.fromId` + fail-loud resolver）怎么组织成一套可复用 API？是否需要 per-service 命名空间（AI 的 X、内置浏览器的 X 要分得开）？
   - **倾向**：renderer 侧出一个 `createWsHostRegistry(tag)` 工厂（AI/X 各 new 一个实例，或带 service 维度共用一个）；main 侧把 AI 的 `resolveAIWebContents` 泛化成 `resolveWsWebContents(serviceId, targetWcId)`。具体形态你定，拿不准列出来问。
2. **fail loud 是否统一**：AI 侧未命中 **fail loud**（不回退全局）；X 侧当前是**回退全局 + warn**。下沉后建议**统一为 fail loud**（回退全局正是 bug 根源）。但这会改变 X 的行为 —— **必须实测 X 发推/回复/extract 在 fail loud 下仍正常**，否则保留差异并说明。由总指挥拍板。
3. **③ SSE manager 怎么按 ws**：偷听器要和"定向注入的同一个实例"绑定。SSE 是 main 侧、按 wc 注入脚本的——下沉后让它也按 wsId→wcId 取目标 wc 注入/读取。注意 `subscribeAttach`（track 新 webview）这条 SSE 还要用，别误删；只改"读哪个实例的缓存"为按 ws。
4. **旧全局函数清理**：`getActiveAIWebContents` / `getActiveXWebContents` 收口后若业务零调用，删掉或 `@deprecated`；底座 track/subscribeAttach 仍需保留。

---

## 3. 铁律（违反即返工）

> **【最高·防回归】** 这次同时碰 AI + X 两条已跑通的链路 + SSE。**改完必须确保 AI 问答/提取、X 发推/回复/extract 全部不回归**。无 GUI 则在交付说明**逐条列出需总指挥实机验的点**，不得声称"应该没问题"。
> **【调查先行】** §1 必做；下沉方案先让总指挥确认再大动。
> **【fail loud】** 收口后未命中一律明确报错，不静默回退全局（回退=没修）。
> **【别猜看真数据】** 3 处现状自己再核一遍（§0 表已核但代码会变）。
> **【爆破半径】** 只做"按 ws 定向 + 底座合一"。不顺手重构问答/发推业务逻辑、不改 SSE 偷听的解析逻辑本身、不动与本 bug 无关的代码。

---

## 4. 验收清单（自检，总指挥据此审计）

**质量门禁**：
- [ ] `npm run typecheck` 0 错
- [ ] `npm run lint` 无新增（基线 10 个 pre-existing，本期不得新增）
- [ ] `npx vitest run` **全量跑、如实报数**。已知 `tests/storage/bulk-delete-perf-verify.test.ts` 8 个 **order-dependent flaky**（与本期无关，单跑全过）；真实结果与 flaky **分开写**，不得笼统"全绿"。
- [ ] 应用启动无新增控制台报错

**功能自检**（无 GUI 则列出待总指挥实机验）：
- [ ] **回归基线（单 ws）**：AI 问答/提取、X 发推/回复/提取推文 一切如旧
- [ ] 多 ws：A 操作只打到 A 的实例（AI 问答 + X 发推 + X 提取 都验）
- [ ] ③ SSE：多 ws 下"提取整页对话"截到的是当前 ws 的回复（若 ai-sync 仍关，说明走静默路径、不影响，并说明怎么验证 SSE 取实例已按 ws）
- [ ] 任一未命中 → fail loud 报错（不静默回退）

**架构自检**：
- [ ] AI/X 两份 registry 已合并为一套底座能力，无重复代码
- [ ] ② x-extract-tweet 已按 ws 定向（不再 getActiveXWebContents）
- [ ] ③ SSE manager 读取实例已按 ws（subscribeAttach/track 保留）
- [ ] fail loud 统一（或保留差异并说明理由）
- [ ] 旧全局函数已清理/标注

**交回总指挥时请附**：
1. 改动文件清单（+ 一句话职责）
2. **下沉设计方案**：底座 API 形态、AI/X 怎么改用、删了哪些重复
3. 3 处遗留逐条处理说明（② X extract 怎么拿 wsId、③ SSE 怎么按 ws）
4. fail loud 是否统一、X 行为有无变化
5. **回归怎么保证**：能自测的 + 必须实机验的，分开列清（这次面大，列详细）
6. 如实测试报数（真实通过数 + 8 flaky 单列）
7. memory 更新（3 项遗留标"已收口"或剩余说明）

---

## 5. 红线

- ❌ 未命中静默回退全局 `getActive`（等于没修）
- ❌ 改坏 AI 问答/提取 或 X 发推/回复/extract（回归）
- ❌ 误删 SSE 的 `subscribeAttach`/`track`（那是 track 新 webview 用的，只改"读哪个实例"）
- ❌ 顺手重构业务逻辑 / 动无关代码（超爆破半径）
- ❌ 测试笼统"全绿"不全量复核
- ❌ 凭记忆改 —— 先读 §1 列的所有真实文件，下沉方案先让总指挥确认

下沉方案、fail loud 统不统一、SSE 按 ws 的具体改法 —— 任一拿不准，**停下来在交付说明里列问题**让总指挥定，别闷头大改。
