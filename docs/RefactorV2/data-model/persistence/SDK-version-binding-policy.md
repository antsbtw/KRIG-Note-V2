# SDK 版本绑定纪律(项目级永久规则)

> **状态**: 🟢 永久生效
> **首次制定**: 2026-05-13(由 decision 020 sub-phase 3a-tx 首次拍板,见 §0.5)
> **制定者**: 用户 P0 拍板 + 总指挥落地
> **生效范围**: KRIG-Note V2 所有外部 SDK 依赖的版本选型决策
> **修订流程**(两类区分,详 §7):
> - **规则正文(§1 - §3 / §5)修订**:**必须**独立决议 + 用户授权,不允许在业务决议内"顺带改"
> - **§4 锁定版本登记表更新**:**允许**在"显式声明 SDK 版本变更 / 新增绑定"的业务决议内进行(典型场景:某 sub-phase 锁定新 SDK / 升级 SDK patch / 跨 major 升级 sub-phase),需在该决议 §8 反向更新清单明确登记本表更新

---

## 1. 适用范围

所有 KRIG-Note V2 引入的外部 SDK / 库依赖的版本选型决策,包括但不限于:

- **数据库**:surrealdb / 未来的 sqlite / 等
- **桌面壳**:electron
- **编辑器**:prosemirror-* / codemirror / 等
- **图形 / 三维**:three / 等
- **AI**:@anthropic-ai/sdk / openai / 等
- **构建链**:vite / typescript / esbuild / 等
- **核心运行时依赖**:react / zustand / 等

---

## 2. 核心规则(硬性)

### 2.1 SDK 版本选定后绑定发布包

- 任何 SDK 主版本号(major)选定后,**绑定到 KRIG-Note 发布包**
- 跨大版本(major)升级**必须**走独立 sub-phase,**不允许**在其他业务决议内"顺带升级"
- 同 major 内的 minor / patch 升级允许在常规依赖更新流程内进行(走依赖维护 sub-phase 或独立 patch commit,记录在 commit message)

### 2.2 拍板"用 SDK X 版本的某 API"前必须 grep 字面证据

- 涉及 SDK API 选型的决议,撰写时**必须**满足以下四步证据:
  1. **实证当前锁定版本**:`grep "<sdk-name>" package.json`(或读 lockfile / `npm ls <sdk-name>`)
  2. **实证 API 字面存在于该版本的类型定义**(以下任选一种,以已安装依赖的实际 types 入口为准):
     - 读 `node_modules/<sdk>/package.json` 的 `"types"` / `"typings"` / `"exports": { ... "types": ... }` 字段,定位实际 `.d.ts` 入口,再 grep 目标 API
     - 用 IDE / `tsc --traceResolution` 查看 TS 实际解析到的类型文件,grep 目标 API
     - `find node_modules/<sdk> -name '*.d.ts' | xargs grep "<api-name>"` 兜底全扫(适用于无 dist / 类型在根目录的 SDK)
     - 若 SDK 无类型定义(JS-only):必须读源码 `.js` 字面实证,**禁止只看 `@types/<sdk>` 第三方类型**(可能与实际行为不一致)
  3. **行为 / 边缘语义实证**(若决议涉及):必须 binary verify,参 decision 020 §3.5 模式;不只信类型声明,不只信公开文档
  4. **API 可执行链路实证**(若决议字面要求"verify 脚本直接 import 项目内模块"调 SDK API,2026-05-13 v1.2 新增,见 [decision 020 §11.5 第 12 次教训](decisions/020-sub-phase-3a-tx-true-atomicity.md)):必须 `grep -A 5 "^import" <目标模块>` 跟踪 import 链到底层依赖,实证 verify 脚本运行上下文兼容(typical:纯 node 脚本 vs electron renderer / main vs worker / DOM env)
     - 若 import 链含 electron / `window` / DOM / app context / IPC 等运行时上下文依赖,verify 脚本必须**重新设计**(stub / 解耦 / 字面 copy 改造主体),不能字面"直接 import"
     - 反例(decision 020 §10.B-2):storage.ts → client.ts → `import { app } from 'electron'`,纯 node 脚本 import 失败,改 import 解耦模块 `transaction-helpers.ts`
- **不允许**靠模糊记忆 / 公开文档 / 上版本经验 / 训练数据假设拍板 SDK API
- 教训来源:[decision 020 §0.6 第 9 次设计师教训](decisions/020-sub-phase-3a-tx-true-atomicity.md) + [decision 020 §11.5 第 12 次教训](decisions/020-sub-phase-3a-tx-true-atomicity.md)

### 2.3 实施期间不得擅自升级 SDK 主版本

- 实施者在 sub-phase 实施期间发现 SDK 行为不符预期时,**必须停下汇报**
- 不得自行决定"换一个版本试试"或"我先升级 SDK 跑一下"
- 总指挥拍板是否需要新独立 sub-phase 升级 SDK

### 2.4 跨大版本升级流程

跨 major 升级触发条件(任一即可):
- 当前版本有 SDK 字面 / binary 行为致命 bug,无 patch 修复
- 当前版本不再被上游维护(EOL)
- 新版本引入业务必需的新 API,无可行替代

跨大版本升级流程:
1. **独立决议**(decision XXX-sdk-name-major-upgrade)
2. **完整回归 verify**(本 sub-phase 同等深度,所有依赖该 SDK 的 capability + storage + 工具链)
3. **重打发布包测试**(打包后实跑,不只 dev 验证)
4. **反向更新**所有依赖该 SDK 的决议字面 + 本文档 §4 锁定版本表

---

## 3. 设计师 / 实施者纪律(操作层)

### 3.1 设计师(决议撰写期)

- 撰写决议前必须 grep 当前依赖版本 + 拍板 API 字面证据
- 决议字面**必须**登记本决议涉及的 SDK 版本依赖(例 decision 020 §0.5 / §4.4)
- 决议 §8 反向更新清单必须含本文档 §4 锁定版本表更新

### 3.2 实施者(实施期)

- Step 5.0 / 5.1 现状 verify 步骤必须复跑设计师的 grep(独立确认,不只信决议字面)
- 发现 SDK 行为不符决议字面 / 引入新版本 / 修改 package.json 中 SDK 字段时**必须停下汇报**
- commit message 涉及 SDK 字段变更时,必须显式登记(`feat(deps): bump surrealdb 2.0.3 → 2.0.4 (patch)`)

### 3.3 审计师(决议复审 + 实施完成审计)

- 复审决议时,核 §SDK 版本登记字段是否齐全
- 审计实施时,`git diff package.json package-lock.json` 必须明确预期(本 sub-phase 不应改 / 应该改 patch level / 等)

---

## 4. 当前已锁定版本登记表

| SDK | 锁定 major | 当前基线版本 | package.json range | 锁定决议 | 锁定日期 | 备注 |
|---|---|---|---|---|---|---|
| surrealdb | 2 | 2.0.3 | `^2.0.3` | [decision 020](decisions/020-sub-phase-3a-tx-true-atomicity.md) | 2026-05-13 | `beginTransaction()` API 在 2.x 字面已支持;**允许** caret range 自动到 < 3.0.0 的 minor/patch(2.1.x / 2.2.x 等);**禁止** 3.x 升级(独立 sub-phase)|

**列字段语义**:
- **锁定 major**:不可跨越的硬版本号。跨此 major 升级必须独立决议(§2.4 流程)。
- **当前基线版本**:撰写锁定决议时的实测验证版本;后续 minor/patch 升级需要 commit message 显式登记基线版本变化(`feat(deps): bump <sdk> baseline X.Y.Z → X.Y.Z+1 (patch)`),但 §4 表"当前基线版本"列**不必每次更新**(避免文档高频改动),只在新 sub-phase 决议锁定时同步刷新。
- **package.json range**:实际 `package.json` 字面值;range 允许的升级范围必须与"锁定 major"一致(caret `^X.Y.Z` 允许 `< X+1.0.0`;tilde `~X.Y.Z` 仅 patch)。

> **维护说明**:本表由"显式声明 SDK 版本变更 / 新增绑定"的业务决议 §8 反向更新流程维护(详 §7)。同 major 内 minor/patch 升级允许走常规依赖更新流程(不强制改本表)。**新增 SDK 绑定 / 跨 major 升级必须改本表**。

---

## 5. 教训登记

### 5.1 第 9 次设计师教训(2026-05-13,decision 020)

> 拍板涉及外部依赖版本时,要意识到该选择会绑定到发布包,跨大版本升级是独立 sub-phase 不能合并。

**起因**:L7 启动包字面"surrealdb-js 3.x SDK"是设计师从模糊记忆出发的笔误,grep `package.json` 才发现 V2 装的是 2.0.3。

**教训详细**:[decision 020 §0.6](decisions/020-sub-phase-3a-tx-true-atomicity.md)。

### 5.2 第 12 次设计师教训(2026-05-13,decision 020 §11.5)

> 决议 §5 / §6 字面 verify / 实施任务必须 grep import 链确认可执行性;不只验证"API 字面存在",还要验证"API 可在 verify 上下文跑起来"。

**起因**:decision 020 §5.5 / §6.1 字面要求"直接调 V2 `SurrealStorage.transaction(fn)`",但 storage.ts → client.ts → `import { app } from 'electron'`,纯 node 脚本 import 失败。实施者 Step 5.5 才发现。

**纪律升级**:§2.2 加第 4 步"API 可执行链路实证"(2026-05-13 v1.2)。

**教训详细**:[decision 020 §11.5](decisions/020-sub-phase-3a-tx-true-atomicity.md)。

---

## 6. 修订记录

| 日期 | 版本 | 修订内容 | 修订决议 |
|---|---|---|---|
| 2026-05-13 | v1.0 | 首次制定(由 decision 020 触发) | [decision 020](decisions/020-sub-phase-3a-tx-true-atomicity.md) |
| 2026-05-13 | v1.1 | 用户 P3 修订:消除"禁止顺带改 vs §4 必改"矛盾(§7 分两类);§2.2 API 证据采集通用化;§4 表列字段口径统一 | [decision 020](decisions/020-sub-phase-3a-tx-true-atomicity.md) |
| 2026-05-13 | v1.2 | sub-phase 3a-tx 实施期 §10.B-2 偏离 + 第 12 次教训反向更新:§2.2 加第 4 步"API 可执行链路实证";§5 加 5.2 第 12 次教训 | [decision 020 §10.B-2 + §11.5](decisions/020-sub-phase-3a-tx-true-atomicity.md) |

---

## 7. 修订流程(两类区分,正式登记)

本文档的修订分**两类**,触发条件 / 授权流程不同:

### 7.1 规则正文修订(§1 / §2 / §3 / §5 / §7 自身)

**触发**:核心规则 / 适用范围 / 操作纪律 / 修订流程本身的修改。

**流程**:
1. **必须**独立决议(decision XXX-policy-revision)
2. 用户 P0 授权
3. 决议合 main 时同步落地本文档修订
4. **不允许**在业务 sub-phase 决议内"顺带改"规则正文

### 7.2 §4 锁定版本登记表更新(允许在业务决议内进行)

**触发(任一)**:
- 某 sub-phase 决议**显式**锁定新 SDK 绑定(新增表一行)
- 某 sub-phase 决议**显式**触发跨 major 升级(改"锁定 major"列 + 加修订记录)
- 某 sub-phase 决议**显式**刷新基线版本(改"当前基线版本"列;非强制)

**流程**:
1. 业务决议 §8 反向更新清单**必须明确**登记本表更新
2. 决议合 main 时同步落地 §4 表 + §6 修订记录(若涉及跨 major 升级)
3. 同 major 内 minor / patch 升级**允许**走常规依赖更新流程(commit message 登记即可,不强制改本文档)

### 7.3 §6 修订记录维护

无论 §7.1 / §7.2 类型,只要本文档有任何字面修改,**必须**追加 §6 修订记录一行(日期 / 版本号 / 修订内容 / 触发决议)。版本号约定:
- 规则正文修订(§7.1) → 主版本号 +1(v1.0 → v2.0)
- §4 表 + 操作微调(§7.2 / §6 自身)→ 次版本号 +1(v1.0 → v1.1)

---

*本文档是 KRIG-Note V2 项目级永久规则,跨 sub-phase / 跨决议 / 跨对话生效。修订流程详 §7。*
