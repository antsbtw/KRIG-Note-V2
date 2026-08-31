# 实施 Prompt：ws 实例隔离收口（AI 侧 getActive 按 ws 定向）

> 交接日期：2026-06-10
> 交接人：总指挥（上一对话）
> 验收人：总指挥
> 关联记忆：`memory/project-ws-instance-isolation-invariant.md`
> X 侧已有范本：`src/capabilities/x-extraction/x-host-registry.ts`（这次照它抄）

---

## 0. 这不是加功能，是修一个潜伏的正确性 bug

**先认清性质**：本任务修复一个**多 workspace 下取错 webview 实例**的真实 bug，碰的是 **AI 问答核心链路**（注入提问 / 抓取回复）。回归风险高于普通功能开发。**慢就是快**：先调查清波及面，再动手；改完务必防 AI 回归。

**bug 本质**：`createWebviewServiceRegistry` 的 `getActive(serviceKey)` 是**全局单例、"最后 navigate 胜出"、不绑 ws**（`src/platform/main/web-service-base/webview-registry-base.ts:64`）。当用户开多个 workspace、每个都挂了 AI view（或同时开内置浏览器 + AI view 同服务），`getActiveAIWebContents(serviceId)` 可能返回**另一个 workspace / 另一个实例**的 webContents → 提问注入到错的实例 / 抓取抓到错的对话。典型表现（X 侧实测过同款）：**"日志说注入成功，但用户在看的那个框是空的"**。

**X 已局部治好**（发推/回复用 `x-host-registry` 的 `Map<wsId,wcId>` 按活跃 ws 定向）。本任务把同一范式收口到 **AI 侧**。

---

## 1. 已核实的波及面（照这个改，但你要自己再验一遍）

`getActiveAIWebContents(serviceId)` 真实调用点 **6 处 / 3 文件**：

| 文件 | 行 | 用途 |
|---|---|---|
| `src/platform/main/ai/handlers.ts` | 43 | IPC handler 取 wc |
| `src/platform/main/ai/ai-sync-orchestrator.ts` | 94, 141 | AI-sync 注入/抓取 |
| `src/platform/main/ai/ask-orchestrator.ts` | 68, 222, 278 | 问 AI 的 paste+send / 提取 |

定义在 `src/platform/main/ai/webview-registry.ts:36`，底层是 `web-service-base` 的全局 `getActive`。

**动手前必做（铁律：别猜，看真实数据）**：自己 grep 复核这 6 处仍准确（代码可能已变），并**读懂每一处的调用上下文**——它当前怎么拿到（或拿不到）当前 ws？哪些在 IPC handler 里（renderer 能传 wsId 下来）、哪些在深层 orchestrator（要把 wsId 一路传进去）。

---

## 2. 现成范本（照抄 X，不要另起炉灶）

### 2.1 X 的 registry（直接参考结构）
`src/capabilities/x-extraction/x-host-registry.ts`：renderer 侧 `Map<wsId, wcId>` + `register/clear/get`。注释里把 bug 现象、修法、归属理由都写清了——**读它**。

### 2.2 X Host 已暴露 `getWebContentsId()`，AI Host 还没有
- X Host：`src/capabilities/x-extraction/Host.tsx:111` 有 `getWebContentsId()`。
- AI Host：`src/capabilities/ai-extraction/Host.tsx` **没有**，但**已经拿到 `workspaceId`**（:40，当前 `void` 掉没用）。
- **所以 AI 侧第一步**：照 X Host 给 AI Host 补 `getWebContentsId()`，AIView（per-ws，已知自己的 wsId）在 dom-ready / url 变化时把 `(wsId → guest wcId)` 登记进一个 **AI 版 host-registry**（仿 x-host-registry，建在 `src/capabilities/ai-extraction/`）。

### 2.3 定向注入
把 6 处 `getActiveAIWebContents(serviceId)` 改为**按当前活跃 ws 取对应 wcId → 取该 wc**。wsId 来源：
- IPC handler 层（handlers.ts）：renderer 调用时带上 wsId（仿 X 发推怎么传的）。
- 深层 orchestrator：把 wsId 作为参数一路传进去，**不要在深层再去 `workspaceManager.getActiveId()` 兜底**（那又回到全局猜测）。wsId 应从调用源头（renderer 命令）显式带下来。

---

## 3. 设计决策（动手前先定，写进交付说明让总指挥确认）

这几处你要给出方案，**拿不准就先在交付说明里列出来问总指挥，别闷头改**：

1. **要不要把 X 和 AI 的 host-registry 抽成一个公共 `web-service-base` registry？**
   - 倾向：**先不抽，AI 照 X 各建一份**。理由：抽公共要同时改两边、扩大回归面；且两边生命周期细节可能有差异。先让 AI 跑通、和 X 对称，将来真有第三个再抽。但你若发现两者几乎一模一样，可提议抽 —— 由总指挥拍板。
2. **fallback 策略**：当某 ws 的 wcId 没登记（registry 没命中）怎么办？
   - **必须 fail loud**（项目铁律）：明确报错"当前 workspace 的 AI 实例未就绪"，**不要**静默回退到全局 `getActive`（那等于没修）。
3. **`getActiveAIWebContents` 这个全局函数留不留？**
   - 改完若无人用，删掉（避免后人误用又踩坑）；若过渡期仍需，加 `@deprecated` 注释指向新接口。

---

## 4. 铁律（违反即返工）

> **【最高·防 AI 回归】** 这是改 AI 核心链路。改完**必须实测**：问 AI（paste+send）、提取整页对话、AI-sync 仍正常。无 GUI 则在交付说明里**明确列出所有需总指挥实机验的点**，不得声称"应该没问题"。
> **【别猜看真数据】** 6 处调用点自己复核；wsId 怎么传进每一处要读真实上下文，不靠脑补。
> **【fail loud】** registry 没命中 → 明确报错，不静默回退全局。
> **【对称 X】** AI 侧实现与 `x-host-registry` 范式对称，便于将来统一。
> **【最小爆破半径】** 只改"按 ws 定向取实例"这一件事。不顺手重构 orchestrator、不改问答逻辑本身、不动 X 侧已跑通的代码。

---

## 5. 验收清单（自检，总指挥据此验收）

**质量门禁（与近期同标准）**：
- [ ] `npm run typecheck` 0 错
- [ ] `npm run lint` 无新增（基线 10 个 pre-existing：4 error 在 `src/views/note/*-import.ts`、6 warning，**本期不得新增**）
- [ ] `npx vitest run` —— **全量跑、如实报数**。已知基线 `tests/storage/bulk-delete-perf-verify.test.ts` 有 8 个 **order-dependent flaky**（SurrealDB 跨测串扰，单跑全过，与本期无关）；报数时把真实结果和这 8 个 flaky **分开写**，不得笼统"全绿"。
- [ ] 应用启动无新增控制台报错

**功能自检**（无 GUI 则列出待总指挥实机验）：
- [ ] 单 ws：问 AI / 提取对话 / AI-sync 一切如旧（**回归基线**）
- [ ] 多 ws：开 2 个 workspace 各挂 AI view，在 ws-A 问 AI，内容注入到 **A 的** AI 框（不串到 B）
- [ ] 同时开内置浏览器 + AI view 同服务时，AI 操作打到 AI view 实例而非浏览器实例
- [ ] registry 未命中时 fail loud 报错（不静默）

**架构自检**：
- [ ] 6 处 `getActiveAIWebContents` 全部改为按 ws 定向（或复核后说明哪处确实无需改、为什么）
- [ ] wsId 从源头显式传入，深层无 `getActiveId()` 兜底猜测
- [ ] 与 x-host-registry 范式对称
- [ ] 没动 X 侧已跑通代码 / 没改问答逻辑本身

**交回总指挥时请附**：
1. 改动文件清单（+ 一句话职责）
2. **6 处调用点的处理逐条说明**：每处 wsId 怎么拿到的、改成什么
3. §3 三个设计决策的方案（或留给总指挥的问题）
4. **AI 回归怎么保证的**：你能自测的 + 必须总指挥实机验的，分开列清
5. 如实测试报数（真实通过数 + 8 个 flaky 单列）

---

## 6. 红线

- ❌ registry 没命中时静默回退全局 `getActive`（等于没修，违反 fail loud）
- ❌ 在深层 orchestrator 用 `workspaceManager.getActiveId()` 兜底猜 ws（要从源头传）
- ❌ 改坏单 ws 下 AI 问答/提取/sync（回归）
- ❌ 顺手重构问答逻辑 / 动 X 侧代码（超出爆破半径）
- ❌ 测试笼统报"全绿"不全量复核（前阶段栽过）
- ❌ 凭记忆改 —— 先读 `x-host-registry.ts`、AI/X 两个 Host.tsx、3 个 orchestrator 真实代码

有架构判断拿不准（抽不抽公共 registry、wsId 传参路径、全局函数留不留）——**停下来在交付说明里列问题**让总指挥定。
