# U3 · views 层二次评估（post-U1 重扫）

> **性质**：评估 + trivial 去重。**结论：views 层架构健康，U3 基本 no-op，只 1 个 trivial 活。**
> **状态**：🔶 评估完成，去重 prompt 就绪。

## 重扫判决（2026-07-22，两次亲验后）

> 探查报告有两处不准，均经亲自 grep 复核修正——不采信自述，连自己初筛也复核。

| 指标 | 结果 | 说明 |
|------|------|------|
| **跨 view import** | ✅ **零** | 7 view 互不直接 import（头号独立部署指标健康）。历史违规（note→web/data-model）已修成命令路由。代码里还留「不跨 view import」的纪律注释（grep 曾误报这些注释为 import，复核澄清）。 |
| **workspaceManager 引用** | 96 合理 + 63 已归 step2 + 类型干净 | `.get`/`.subscribe`（96）= 读自己 ws 状态，合理；`.getActiveId`（63）= 已登记 step2 的命令批量+c2；类型引用 semantic-only。 |
| **重复抽象** | 🟡 `relativeTime` **4 处**（探查报 3，实为 4） | note/ebook/web/graph-canvas-view，逐行相同实现。 |

**判决**：views「90% 跨层」是**合理下调**（view 用 capabilities/slot 本应如此），非病。U1 治完震中后
**views 无需架构大改**。U3 唯一实活 = relativeTime 去重。`.getBus`/`.update`（56）可抽象但不阻塞，归 U4+/step2。

## U3 唯一动作：relativeTime 抽 shared

**4 处**逐行相同的 `relativeTime(ts): string`：
- `views/note/tree-builder.ts:103`（**export** function——可能有外部引用，抽走时核对）
- `views/ebook/nav-side-content.tsx:61`（local）
- `views/web/nav-side-content.tsx:59`（local）
- `views/graph-canvas-view/nav-side-content.tsx:52`（local）

**治法**：抽到 `src/shared/date-utils.ts`（shared 纯 leaf，无依赖），4 处改引。
> 注意：`relativeTime` 用 `Date.now()`（非纯函数），抽到 shared 无妨（date-utils 本就是工具）。

**验收**：`grep -rn "function relativeTime" src/views/` = 0；shared/date-utils 有一份；4 处引 shared；
note tree-builder 的 export 若有外部消费方，改引 shared 或 re-export；tsc。

## U3 结案

除 relativeTime 去重外，U3 无架构工作。views 层判定**健康、可独立部署**。
剩余 `.getBus`/`.update`/`.getActiveId` 归 step2 / U4+，不在 U3。
