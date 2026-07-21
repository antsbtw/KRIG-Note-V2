# 第 1 步 · 问题具体化 —— 完整问题清单

> **组织原则**：按**「可独立优化的单元」**分组（不按违规类型散列）——每个单元 = 一刀能治、
> 可单独出 prompt、可单独验收的一块。每条带 file:line 证据 + 影响范围 + 严重度。
> **数据来源**：全仓 import 依赖体检（2026-07-21，[[module-boundary-governance]] §一）。
> **状态**：🔶 编写中（U2 循环顺序待探查回填）。

## 严重度图例
🔴 HIGH（阻塞其他工作 / 剥夺可独立部署）· 🟠 MED（明确违规，可局部治）· 🟡 LOW（小疥癣，捎带修）

---

## 单元总览

| 单元 | 名称 | 严重度 | 影响范围 | 一句话 |
|------|------|--------|----------|--------|
| **U1** | 震中：workspaceManager 全局单例 → 依赖注入 | 🔴 | ~35 文件 / 330 次抓取 | 治它消大半违规；一切工作的前置 |
| **U2** | workspace ↔ slot 循环依赖 | 🟠 | workspace + slot | ✅ 定案：回边=U1 实例，U1 做完自动断，无需先断 |
| **U3** | views 是 god-consumer（90% 跨层） | 🔴 | views 全层 | 最纠缠；U1 治后需二次评估剩余耦合 |
| **U4** | shared 不是纯 leaf（反依赖上层） | 🟠 | shared/ipc | 独立小切口 |
| **U5** | workspace 抓 shell 静态资产（logo） | 🟡 | 1 文件 | 独立小疥癣 |

---

## U1 · 震中：workspaceManager → 依赖注入 🔴

**问题**：全局单例 `workspaceManager`（`src/workspace/workspace-state/workspace-manager.ts`）被 import
**330 次**、跨所有层被抓：views(42) / capabilities(5,❌违规) / shell(3) / slot(1,❌违规)。
模块**反向依赖全局单例** → **无法独立部署/测试**。这是全仓最大连接枢纽 = 震中。

**含子问题**（原 V1 归入此单元，因同根）：
- capabilities(L4) 抓 workspace(L3) 单例：text-editing 5 文件直接 import —
  `handle-menu/items.tsx:32`、`HandleFormatSubmenu.tsx:22`、`link-panel/LinkPanel.tsx:19`、
  `color-picker/HandleColorSubmenu.tsx:19`、`commands/register-pm-commands.ts:19`。
- L5 视图/命令 `getActiveId()` 60+ 处调用（note-commands 18、ebook 15、ai/x/thought/web…）。

**治法**：依赖注入 —— 模块不再抓全局，改「被动接收 ws 上下文」（详细设计已在
[[multi-window-process-isolation]] §12.1.1：窗口根唯一源 + React Context / command ctx 两路分发）。
**完整性判据**：全仓 `grep workspaceManager.getActiveId` = 0；capabilities/ 下 import workspaceManager = 0。

## U2 · workspace ↔ slot 循环依赖 🟠

**问题**：
- 正向 workspace→slot：`workspace-manager.ts` import `WorkspaceBus`/`SlotUpdateSource` from `@slot/workspace-bus`
- 回边 slot→workspace：`@slot/keymap-registry/keymap-listener.ts:44` **运行时** import workspaceManager 单例
- → 闭环，两者谁都拆不出、无法独立部署。

**✅ 顺序已定案（grep 实测 2026-07-21）**：**回边就是 U1 的一个实例**——
- 运行时回边**唯一一处** = `keymap-listener.ts:44` `workspaceManager.getActiveId()` + `:46` `.get(wsId)`
  = 又一个「伸手抓全局问 active」。→ **U1 依赖注入一做，keymap-listener 收注入 wsId，此 import 消失，回边自动断。**
- 其余 slot→workspace 全是 `import type`（`workspace-bus.ts:20`、`slot-control.ts:18` 抓 WorkspaceManager
  类型）→ 编译期擦除，**不构成运行时循环**。
- 正向边 workspace→slot：`workspace-manager.ts:19 import { WorkspaceBus }`（runtime，但**单向合理**——
  workspace 用 slot 的 bus）；`:18 import type SlotUpdateSource`（type-only）。
- **结论：不需要「先断 V2 再动主刀」。顺序 = 先 U1，U2 是 U1 的副产品（回边随 U1 消失）。**
  正向 WorkspaceBus 依赖属「workspace-manager 拆分」时一并处理（getBus 归楼长还是留窗内，见多窗口 §12.0）。

## U3 · views god-consumer 🔴

**问题**：views(L5) **90% 跨层 import**（371 总 import，335 跨层），reaches
slot(152)/capabilities(124)/workspace(54)/shared(35)/shell(5)。views 直接编排过多业务逻辑、
经单例 import 抓一切 → 非良好分解。

**治法**：U1 治后需**二次评估**——getActiveId 注入化会消掉 54 次 workspace 抓取的大部分；
剩余 slot/capabilities 的高耦合是否合理（views 本就该调下层）还是仍有可抽象点，待 U1 后重扫。

## U4 · shared 非纯 leaf 🟠

**问题**：`shared/ipc/electron-api.d.ts:22` import `@capabilities/note/types`；`:37` 与
`shared/ipc/x-types.ts:9` import `@drivers/...`。shared 本应纯 leaf，却反依赖上层。

**治法**：把 shared 反依赖的 capability/driver 类型**下沉或内联**，让 shared 回归纯 leaf。
**判据**：shared/ import @capabilities|@drivers = 0。

## U5 · workspace 抓 shell 资产 🟡

**问题**：`workspace/workspace-instance/view-switcher-frame/ViewSwitcherFrame.tsx:18` 硬编码
`import logoUrl from '@shell/assets/logo.jpeg'` → L3 抓 L2 静态资产。

**治法**：logo 改 **prop 注入 / shared 常量**，不硬 import @shell。
**判据**：@shell import 在 workspace/ 下 = 0。

---

## 地基（无问题，不动）

✅ storage / semantic（L0）零违规、纯 leaf；platform（L0 调所有层，符合预期）；drivers（leaf）。
→ 治理**不碰地基**，只治上层纠缠（U1~U5）。
