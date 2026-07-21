# 第 2 步 · 总体规划 —— 治理推进蓝图

> **输入**：`problems.md`（U1~U5）。**输出**：从哪到哪 / 抽象点 / 规范化点 / 分步顺序 / 验收判据。
> **状态**：🔶 规划中（2026-07-21）。第 3 步据此逐单元出细化文档 + prompt。

## 一、从哪到哪（目标态）

**现状**：上层（views/capabilities/slot/workspace/shared）互相纠缠，核心因跨层抓全局单例
`workspaceManager`（330 次）+ 一处循环。无法独立部署。

**目标态**（对照四层架构 [[module-boundary-governance]] §〇）：
- 每个「可视化端(L0~L5)」**自包含**——只吃**注入**的 ws 上下文，不抓任何全局单例。
- 依赖流单向干净：`views → capabilities → semantic → storage`（纵向）；跨层只准上调下。
- **完整性判据（全仓 grep 归零）**：`workspaceManager.getActiveId` = 0；capabilities/ 抓
  workspaceManager = 0；slot/ 运行时抓 workspaceManager = 0；shared 抓 @capabilities|@drivers = 0；
  workspace/ 抓 @shell = 0。
- **可独立部署验证**：对每个治好的模块跑「关模块隔离测试」——喂假 ctx 能单独跑/测。

## 二、抽象点（要新建的抽象，不只是改依赖）

| 抽象 | 为什么要新建 | 服务于 |
|------|-------------|--------|
| **A1. ws 上下文源 + 注入通道** | 替代「抓全局 workspaceManager」。窗口根唯一源 → React Context（组件）+ command ctx（命令）两路分发 | U1（+U2/U3） |
| **A2. command handler 统一签名 `handler(ctx)`** | 命令从「无参纯函数抓全局」→「收注入 ctx」。规范化 L4 command 接口 | U1（宽改，用户拍板） |
| **A3. 楼长/房客拆分** | workspace-manager 劈成：楼长（全局 ws 注册表→主进程）+ 房客（我这个 ws→窗内）。见多窗口 §12.0 | U1 深化 + 多窗口 |

## 三、规范化点（统一约定，非新建抽象）

| 规范 | 内容 |
|------|------|
| **N1. 无必选模块 import 智能插件** | Gemma 单向被依赖铁律（[[module-boundary-governance]] §〇）。趁 Gemma 未实现定死 |
| **N2. shared 纯 leaf** | shared 不 import 任何 app-specific（capabilities/drivers）。类型下沉或内联 |
| **N3. 静态资产不跨层 import** | 资产走 prop 注入 / shared 常量，不硬 import 别层（如 logo） |

## 四、分步顺序（依赖关系 + 串并行）

```
U1 震中依赖注入 ★主刀·前置 ─┬─→ U2 循环(回边随 U1 自动断,仅收尾正向边)
  (含 A1/A2/A3)              └─→ U3 views 二次评估(U1 消 54 次 workspace 抓取后重扫剩余耦合)

U4 shared 纯 leaf   ─── 独立,可与 U1 并行(不碰 workspaceManager)
U5 logo 资产        ─── 独立小疥癣,任意时候捎带
N1 Gemma 铁律       ─── 定原则即可(无代码,Gemma 未实现),纳入评审 checklist
```

**关键**：U1 是总前置——它一做，U2 自动断、U3 大幅缓解。U4/U5/N1 独立并行。
**建议推进序**：U1（主刀，最大投资）→ U2 收尾 → U3 二次评估 → U4/U5 穿插并行。

## 五、每步验收判据（第 3 步细化时逐条落）

| 单元 | 验收判据（grep 归零 + 隔离测试） |
|------|--------------------------------|
| U1 | `grep workspaceManager.getActiveId` src/ = 0；capabilities/ 无 workspaceManager import；改后的模块喂假 ctx 可单测 |
| U2 | slot/ 无运行时 workspaceManager import（type-only 除外）；workspace↔slot 无运行时环 |
| U3 | views 跨层 import 数显著下降；剩余耦合逐条判定「合理下调 vs 仍需抽象」 |
| U4 | shared/ 无 @capabilities/@drivers import |
| U5 | workspace/ 无 @shell import |

## 六、与多窗口的关系

U1（依赖注入）**= 多窗口 step1**（[[multi-window-process-isolation]] §12.1.1）。**治理与多窗口在 U1
这一刀上合一**：治好震中，既是「模块可独立部署」的主刀，也是多窗口「解耦 L2/L3」的第一步。
U1 完成后，多窗口的「套壳」（step2/3）才有干净的内部可套。

## 七、归档候选（治理完成后核对是否失效）

治理成功标志 = 旧文档过时可归档。完成 U1~U5 后逐一核对：
- `module-boundary-governance.md` — 违规清单部分（治好则失效，四层架构图保留）
- `multi-window-process-isolation.md` §11/§12.1.1 — 与 U1 重叠部分
- 待第 3/4 步实际完成后再定，勿提前归档。
