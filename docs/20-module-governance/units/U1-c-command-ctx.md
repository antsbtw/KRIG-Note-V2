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

## 拆分（据判定）

- **U1-c1**：Bucket A 命令处理器 ctx 注入（~40 处，一个模式）。**抽象 A2**：command handler 加 ctx
  参数、`commandRegistry.execute` 注入 wsId。低风险，先打。
- **U1-c2-inject**：可注入陷阱（link-click / note-bridge / context-menu，~10 处）。各自机制：
  context-menu 走 context.custom 带 wsId；link-click/note-bridge 绑注册时 wsId。
- **U1-c2-defer**：`ai-sync ×2` + `keymap 兜底`（3 处）——**不改，标 TODO**，留多窗口 step2 随
  「全局 active 概念消亡」一起重构。**⚠️ 多窗口 step2 勿忘这 3 处。**

## 抽象 A2 决策（command ctx 注入机制，c1 前先定）

探查给三选项，倾向 **Option B**：扩展 handler 签名带可选 ctx —
`type CommandHandler = (args, ctx?) => unknown`；`execute(id, args, ctx)` 注入 wsId。
清晰、集中、一处改 registry。（Option A 包装器到处样板；Option C 首参约定不一致。）待 c1 prompt 前定死。

## 验收判据

- c1：`grep workspaceManager.getActiveId src/**/*-commands.ts` = 0；command ctx 机制就位；tsc。
- c2-inject：link-click/note-bridge/context-menu 不再 getActiveId；tsc；右键/链接/锚点功能冒烟。
- c2-defer：3 处保留但加 `// TODO(multi-window-step2): 全局 active 概念消亡后重构` 标记。
- **U1 完成总判据**：`grep workspaceManager.getActiveId src/` 仅剩 3 处 defer（带 TODO）。
