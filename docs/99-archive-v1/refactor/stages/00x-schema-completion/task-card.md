# 任务卡：refactor/schema-interop-completion（阶段 00x-schema-completion）

> **状态**：草稿
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 6 配套数据模型四层
- 数据模型设计：[docs/evaluation/2026-05-02-DataModel-Architecture-Design.md](../../../evaluation/2026-05-02-DataModel-Architecture-Design.md)
- 前置依据：[tmp/builder-blockers.md](../../../../tmp/builder-blockers.md) B1（schema-interop.ts 2 处缺类型）

## 本次范围

**重构骨架自身补全：补足 schema 体系中两个缺失的类型**

`src/shared/types/schema-interop.ts` 在 commit `5878d1e4` 入仓时未跑 typecheck，存在两个缺失：

- 引用了 `schema-visualization.ts` 未导出的 `ViewType` 类型
- 使用了完全未定义的 `LicenseTier` 类型

本阶段补全这两个类型定义，**仅修 schema 骨架，不动任何业务代码**。

## 本分支只做

### J1：在 `schema-visualization.ts` 新增 `ViewType` 类型导出

文件 [src/shared/types/schema-visualization.ts](../../../../src/shared/types/schema-visualization.ts) 当前导出的类型不含 `ViewType`，但 schema-interop.ts:7 明确 `import type { ViewType, ViewInstanceId, Bounds } from './schema-visualization'`。

**新增定义**（在 `WorkspaceId` / `ViewInstanceId` 类型附近，约第 18~20 行后）：

```ts
/**
 * View 类型标识符——命名空间形如 `<plugin>.<view>`
 * 例：'note.editor' / 'note.thought' / 'graph.canvas' / 'graph.family-tree'
 *      / 'web.chatgpt' / 'web.claude' / 'ebook.pdf' / 'ebook.epub'
 *
 * 详见总纲 § 5.2 概念三元组（Plugin → View → Capability）。
 */
export type ViewType = string;
```

**关键约束**：
- 目前 ViewType 用 `string` 别名而非 `'note.editor' | 'graph.canvas' | ...` 字面量联合——理由：总纲 § 1.2 注册原则要求"插件加载是注册制"，硬编码联合违反开闭原则
- 类型仅是别名（type alias），不是 brand type 或 nominal type
- **不得使用** `enum`、`const enum`、interface 形式
- 类型注释**必须包含**总纲 § 5.2 引用

### J2：定义 `LicenseTier` 类型并被 schema-interop.ts 导入

`schema-interop.ts:72` 使用 `tier: LicenseTier` 但未 import 也未定义。

**Builder 自决**（NON-BLOCKING）：定义放在 `schema-visualization.ts` 还是 `schema-interop.ts` 自身。Commander 倾向放在 **schema-visualization.ts**（与 ViewType 同文件，因为两者都属于"视图层"概念，license tier 控制视图可见性）。

**新增定义**（按 Commander 倾向放在 schema-visualization.ts ViewType 之后）：

```ts
/**
 * License Tier — 视图/能力的授权层级
 * 用于 ViewTypeRegistration.tier 控制哪些视图对哪些用户可见。
 *
 * v1 为最小定义,实际授权策略由各发行版决定。
 */
export type LicenseTier = 'free' | 'pro' | 'enterprise';
```

**关键约束**：
- 字面量联合 `'free' | 'pro' | 'enterprise'`——这三个是行业惯例值，本身**就是声明性枚举**，不是开闭原则违反（License 层级不是动态注册项，它是产品决策）
- 不使用 enum
- 类型注释必须说明它是产品决策层

### J3：在 schema-interop.ts 添加 `LicenseTier` 的 import

修改 [src/shared/types/schema-interop.ts:7](../../../../src/shared/types/schema-interop.ts) 现有的 import 语句：

```ts
// 改前：
import type { ViewType, ViewInstanceId, Bounds } from './schema-visualization';

// 改后（追加 LicenseTier）：
import type { ViewType, ViewInstanceId, Bounds, LicenseTier } from './schema-visualization';
```

**关键约束**：
- 仅修改这一行 import
- 不动 schema-interop.ts 其他任何代码

## 严禁顺手做

- ❌ **不修改任何业务代码**（`src/main/**`、`src/renderer/**`、`src/plugins/**`）
- ❌ **不修复**仓库历史 type 错误（`WebkitAppRegion` / `view.webContents`）—— 那归 [fix-tasks/typecheck-baseline.md](../../fix-tasks/typecheck-baseline.md)
- ❌ **不修改** schema-semantic.ts / schema-representation.ts —— 本次只补 visualization + interop
- ❌ **不重命名** schema 文件、不调整目录结构
- ❌ **不补足** schema-interop.ts 中其他可能存在的 TODO 或不完整定义（除非阻塞 J1~J3）
- ❌ **不顺手** 优化已有类型注释、不重排导出顺序
- ❌ **不动** package.json、tsconfig.json、ESLint 配置（那归阶段 00）
- ❌ **不擅自做** merge / push（列命令交回 Commander）

## 完成判据

- [ ] **J1a**: `src/shared/types/schema-visualization.ts` 新增 `export type ViewType = string;`
- [ ] **J1b**: `ViewType` 类型注释包含"详见总纲 § 5.2"等字样
- [ ] **J2a**: `src/shared/types/schema-visualization.ts` 新增 `export type LicenseTier = 'free' | 'pro' | 'enterprise';`
- [ ] **J2b**: `LicenseTier` 类型注释说明它是产品决策层
- [ ] **J3a**: `src/shared/types/schema-interop.ts:7` import 列表追加 `LicenseTier`
- [ ] **J3b**: schema-interop.ts 其他行未变（仅第 7 行改 import）
- [ ] **J4a**: 运行 `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "schema-interop.ts"` 输出为空（schema-interop.ts 错误数 = 0）
- [ ] **J4b**: 运行 `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | wc -l` 输出 ≤ 4（仓库历史 type 错误 4 处保留，不归本 PR 修，将由 fix/typecheck-baseline 处理）
- [ ] **J5**: `git diff main...HEAD --stat` 仅包含两个文件：`src/shared/types/schema-visualization.ts` + `src/shared/types/schema-interop.ts`
- [ ] **J6**: 所有 commit message 符合 CLAUDE.md 格式（建议 `fix(refactor): schema-interop 补足 ViewType / LicenseTier 类型`）

## 已知风险

- **R1**：`ViewType` 的别名定义 `= string` 看起来"过宽"。Builder 可能想用字面量联合"更严格"——**禁止**。理由：总纲 § 1.2 注册原则要求插件加载是注册制，硬编码联合违反开闭原则。Commander 已决，无歧义
- **R2**：`LicenseTier` 当前用 3 值字面量联合是 v1 最小定义。如果 Builder 觉得"应该更复杂"想加更多层（trial / academic 等）——**禁止扩展**，本次仅 v1 最小可用。后续按需独立 PR
- **R3**：本 PR merge 后 schema-interop.ts 的 2 处错误清零，但仓库总 type error 仍有 4 处（历史债）。这是**预期行为**，归 [fix-tasks/typecheck-baseline.md](../../fix-tasks/typecheck-baseline.md) 处理。J4b 判据保留 ≤ 4 用于验证本 PR 没引入新 error

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认（已答）

1. **`LicenseTier` 放在 schema-visualization.ts 还是 schema-interop.ts？** —— **Commander 答**：放 schema-visualization.ts（与 ViewType 同文件，理由见 J2）
2. **`ViewType` 用 `string` 别名 vs 字面量联合？** —— **Commander 答**：`string` 别名（见 R1）
3. **`LicenseTier` 是否要拓展更多值？** —— **Commander 答**：不（见 R2）
4. **是否要顺便修复 schema-interop.ts 中其他可能的不完整定义？** —— **Commander 答**：不。"严禁顺手做"段已禁

## Builder 完成后

- 写报告到 `tmp/builder-report.md`（按 BUILDER-PROMPT § 五格式）
- 在聊天中输出："builder-report 就绪：tmp/builder-report.md"
- **不做** merge / push（列命令给 Commander）

## 备注

本次为**重构期骨架修复**——schema 骨架是阶段 01+02 后续所有重构 PR 都要 import 的契约文件。骨架不自洽，下游全错。所以本 PR 走完整 Builder + Auditor 流程。
