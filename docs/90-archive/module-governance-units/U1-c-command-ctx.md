# U1-c · 命令/纯函数改注入（含 c2 陷阱判定）

> **单元**：U1 依赖注入第三步（最大一刀）——非组件的 ~38 文件 getActiveId 改注入。
> **前置**：U1-a（注入链）、U1-b（组件类）已交付。
> **状态**：🔶 已排查+判定，待出 c1 / c2-inject prompt。

## 地形（探查 2026-07-21，校准后）

> 探查报 80 个「getActiveId 出现」含注释/示例/已处理组件；**净待处理 ~38 文件**，分三桶：

- **Bucket A 命令处理器（~40 调用点，集中在 `*-commands.ts`）** → 低风险机械，统一模式。
- **Bucket B 组件已处理**（U1-b 覆盖）/ 少量纯函数参数穿透。
- **Bucket C 陷阱集成（12 处）** → 需逐个判定「注入 vs 归多窗口重构」，见下。

## ⭐ c2 陷阱逐个判定（防给旧世界观打补丁）

判定沿根本分界线（单窗口世界观 vs 跨窗口）：

| 陷阱 | 判定 | 理由 |
|------|------|------|
| `ai-sync-integration.ts:87 reconcileForActive` | ⚠️ **归多窗口 step2** | 追「全局 active ws 切换」决定 start/stop；多窗口下无「全局 active 切换」，每窗自己的 ai-sync 天然绑自己 ws |
| `ai-sync-integration.ts:137 handleAppendTurn` | ⚠️ **归多窗口 step2** | 校验 `activeId !== active.workspaceId`（防 active 切走）；多窗口下概念消失 |
| `keymap-listener.ts:44 fallbackActiveViewId` | ⚠️ **归多窗口 step2** | 全局 active 兜底；已优先 DOM `[data-view-id]` 取，兜底逻辑随多窗口变 |
| `link-click-integration.ts:46/56 onOpenNote/getCurrentNoteId` | ✅ **可注入** | 响应具体窗口内点链接，wsId 确定 |
| `note-bridge.ts:71/96 onAnchorClick 等` | ✅ **可注入** | 响应具体窗口内点锚点；注意优先 `getFocusedInstanceId()`，getActiveId 是兜底 |
| `ebook/epub/web context-menu（~8 处）` | ✅ **可注入** | 右键在具体窗口触发；已用 `contextMenuController.getState().context.custom`，wsId 塞进 context |

**判定价值**：拦下 3 处「给即将消失的『全局 active』概念精心接线」的白费功+埋债。同 U1-b shell 陷阱
规律——有些点不是改注入，是属于要重构的旧结构。

## ⭐⭐ 关键收敛（2026-07-21，看真实 command 系统 + 深层讨论后）

**规律浮现**：凡依赖「每窗口独立性」才能正确做的注入，现在做 = 打补丁，该随多窗口 step2 做。
三例同此模式：c2-defer（追全局 active，概念消失）/ **U1-c1 批量 40 命令（正确注入依赖每窗口
独立注册）** / U1-b shell 3点（tab 残骸）。→ **U1 的边界 = 「不依赖多窗口就能解耦」的部分**；
依赖窗口独立性的天然归 step2。这不是 U1 没做完，是 U1 边界本就到这（自洽「先解耦内部再套壳」）。

**为何 40 命令批量注入归 step2**（看真实代码得出）：
- 现状 `CommandHandler=(...args)=>unknown` + `execute(id,...args)` + **80 个 execute 调用点** +
  40 注册点。探查建议 Option B（`handler(args,ctx)`）会牵连 **80 调用点全改**、driver 层无 Context 拿不到 wsId → **否决**。
- 正解 = **方案乙：注册时闭包捕获本窗口 wsId**（command 每窗口 renderer 各注册一遍 → 注册时机所在
  窗口 = 执行时所属窗口 → 闭包 wsId 天然正确，execute/80 调用点**一行不改**）。
- **但方案乙依赖「每窗口独立注册 + 注册时能拿到本窗 Context」= 多窗口 step2 才就位**。单窗口下
  注册时机与 Provider 对不齐 → 现在批量做要打补丁。→ **批量迁移归 step2。**

## 拆分（据收敛修订）

- **U1-c1（轻量·现在做）**：只建 **A2 接口**（`CommandContext={wsId}` + `registerWsCommand` 工厂，
  方案乙）+ **1~2 个命令试水**（如 note-view.create-note 走通新注册器，验证+立范本）。
  **不强制迁 40 命令。**
- **U1-c1-batch（归 step2）**：40 命令批量走 registerWsCommand（每窗口独立注册就位后照范本迁）。
- **U1-c2-inject**：可注入陷阱（link-click / note-bridge / context-menu，~10 处）——待评估是否也
  依赖窗口独立性（context-menu 走 context.custom 可能现在可做；link-click/note-bridge 待判）。
- **U1-c2-defer**：`ai-sync ×2` + `keymap 兜底`（3 处）——不改标 TODO，归 step2。

**⚠️ 多窗口 step2 待办清单**：40 命令批量注入 + c2-defer 3处 + U1-b shell 3点删。

## 验收判据

- c1：`grep workspaceManager.getActiveId src/**/*-commands.ts` = 0；command ctx 机制就位；tsc。
- c2-inject：link-click/note-bridge/context-menu 不再 getActiveId；tsc；右键/链接/锚点功能冒烟。
- c2-defer：3 处保留但加 `// TODO(multi-window-step2): 全局 active 概念消亡后重构` 标记。
- **U1 完成总判据**：`grep workspaceManager.getActiveId src/` 仅剩 3 处 defer（带 TODO）。
