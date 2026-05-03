# Auditor 审计指令 — 阶段 00x：Schema 骨架补全

> 你（Claude）现在是 Auditor。**Plan Mode 启动**，不写代码、不读 memory。读完本目录 + 全局规则 + Builder 报告后，按 AUDITOR-PROMPT § 四格式输出审计报告到 `tmp/auditor-report.md`。

---

## 一、必读输入（按顺序）

1. **本目录文件**：
   - [README.md](README.md)
   - [task-card.md](task-card.md) — 完成判据 J1~J6（你审计的对账标尺）
   - [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) — 本文件
   - **不读 BUILDER-INSTRUCTION.md**

2. **角色总规则**：[../../AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 5.2 + § 6
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出**：
   - `tmp/builder-report.md` — Builder 自检报告
   - `git diff main...refactor/schema-interop-completion` — 完整 diff
   - `git log main..refactor/schema-interop-completion --oneline` — commit 列表

## 二、本次审计要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/schema-interop-completion` |
| 审计阶段 | 重构骨架自身修复 |
| 功能契约 | **N/A** |
| 关键审计点 | A 段总纲合规 + J1~J6 对账 + 范围越界 + 类型语义合规 |

## 三、特别关注

### 关注点 1：范围严格——只动两个文件

`git diff main...refactor/schema-interop-completion --stat` **必须只**包含：
- `src/shared/types/schema-visualization.ts`
- `src/shared/types/schema-interop.ts`

**任何其他文件出现 = ❌**。包括 schema-semantic.ts、schema-representation.ts、ESLint 配置、业务代码、CLAUDE.md 等。

### 关注点 2：ViewType 必须是 `string` 别名

读 schema-visualization.ts diff 部分，确认 `ViewType` 定义：

- ✅ `export type ViewType = string;`
- ❌ `export type ViewType = 'note.editor' | 'graph.canvas' | ...;`（字面量联合，违反 task-card R1）
- ❌ `export interface ViewType {...}`
- ❌ `export enum ViewType {...}`
- ❌ `export type ViewType = string & { __brand: 'view-type' };`（brand type）

**只接受裸 `= string`**。理由：总纲 § 1.2 注册原则。

### 关注点 3：LicenseTier 必须是 3 值

```ts
export type LicenseTier = 'free' | 'pro' | 'enterprise';
```

- ✅ 完全是这 3 值（顺序无所谓）
- ❌ 多值（trial / academic / community / 等）
- ❌ enum
- ❌ string 别名（违反 task-card R2 的"声明性枚举"语义）

### 关注点 4：schema-interop.ts 的 import 仅追加 LicenseTier

读 schema-interop.ts diff，第 7 行：

- ✅ `import type { ViewType, ViewInstanceId, Bounds, LicenseTier } from './schema-visualization';`（追加 LicenseTier）
- ❌ schema-interop.ts 任何其他行被改动
- ❌ 重排 import 顺序（如把 LicenseTier 放最前）

### 关注点 5：J4 验证（自己重跑）

```bash
git checkout refactor/schema-interop-completion

# J4a: schema-interop.ts 错误清零
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "schema-interop.ts"
# 必须为空

# J4b: 总错误数应当是 4（历史 4 处保留）
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | wc -l
# 必须是 4

# 详细查看历史 4 处确认本 PR 未引入新错误
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS"
# 应只见:
#   src/main/ipc/handlers.ts(454,7): error TS18046
#   src/renderer/shell/WorkspaceBar.tsx(176,5): error TS2353
#   src/renderer/shell/WorkspaceBar.tsx(196,5): error TS2353
#   src/renderer/shell/WorkspaceBar.tsx(240,5): error TS2353
```

如果总错误数 ≠ 4，或出现非预期的错误位置 = ❌。

### 关注点 6：类型注释合规

- `ViewType` 注释必须含 "总纲 § 5.2" 引用（task-card J1b）
- `LicenseTier` 注释必须说明它是产品决策层（task-card J2b）

注释缺失或语义错位 = ❌（疑议从严）。

### 关注点 7：禁止"顺手"清理

在 diff 中检查是否有：
- 现有类型注释被"优化"（即便看起来更好）
- 现有 export 顺序被调整
- 现有空行被增删

任何与 J1~J3 无关的改动 = ❌。

## 四、审计输出（写入 `tmp/auditor-report.md`）

按 AUDITOR-PROMPT § 四格式。要点：
- B 段（功能契约保留）填"N/A"
- D 段（Step B 合规）跳过
- C 段（Step A 纯度）借用语义：C1 = "diff 仅包含 schema-visualization.ts + schema-interop.ts"
- 总评：通过 / 不通过 / 待 Builder 证明

## 五、审计纪律强提醒

- ❌ 不读 memory
- ❌ 不被 Builder 解释说服——只看代码
- ❌ 不写代码、不修复
- ✅ 疑议从严：J4 自己跑过命令对账
- ✅ 重点检查"ViewType 是否真的是 string 别名"——这是本阶段最关键的语义点

---

**记住**：本阶段产出虽小（~15 行），但它是 KRIG 重构期所有视图注册类型的基石。审计务必严格。
