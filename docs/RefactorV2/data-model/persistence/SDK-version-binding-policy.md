# SDK 版本绑定纪律(项目级永久规则)

> **状态**: 🟢 永久生效
> **首次制定**: 2026-05-13(由 decision 020 sub-phase 3a-tx 首次拍板,见 §0.5)
> **制定者**: 用户 P0 拍板 + 总指挥落地
> **生效范围**: KRIG-Note V2 所有外部 SDK 依赖的版本选型决策
> **修订流程**: 修订本文档需要独立决议 + 用户授权;不允许在其他决议内"顺带改"本文档字面

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

- 涉及 SDK API 选型的决议,撰写时**必须**:
  1. `grep "<sdk-name>" package.json` 实证当前锁定版本
  2. `grep "<api-name>" node_modules/<sdk>/dist/*.d.ts` 实证 API 在当前版本字面存在
  3. 若涉及行为差异 / 边缘语义,必须 binary verify(参 decision 020 §3.5 模式)
- **不允许**靠模糊记忆 / 公开文档 / 上版本经验拍板 SDK API
- 教训来源:[decision 020 §0.6 第 9 次设计师教训](decisions/020-sub-phase-3a-tx-true-atomicity.md)

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

| SDK | 锁定 major.minor | package.json 字面 | 锁定决议 | 锁定日期 | 备注 |
|---|---|---|---|---|---|
| surrealdb | 2.0.x | `^2.0.3` | [decision 020](decisions/020-sub-phase-3a-tx-true-atomicity.md) | 2026-05-13 | `beginTransaction()` API 在 2.x 字面已支持;3.x 升级走独立 sub-phase |

> **维护说明**:本表由各 sub-phase 决议 §8 反向更新流程维护。新增 SDK 绑定 / 版本升级时,实施者 Step 5.8 必须更新本表一行 + 链锁定决议。

---

## 5. 教训登记

### 5.1 第 9 次设计师教训(2026-05-13,decision 020)

> 拍板涉及外部依赖版本时,要意识到该选择会绑定到发布包,跨大版本升级是独立 sub-phase 不能合并。

**起因**:L7 启动包字面"surrealdb-js 3.x SDK"是设计师从模糊记忆出发的笔误,grep `package.json` 才发现 V2 装的是 2.0.3。

**教训详细**:[decision 020 §0.6](decisions/020-sub-phase-3a-tx-true-atomicity.md)。

---

## 6. 修订记录

| 日期 | 版本 | 修订内容 | 修订决议 |
|---|---|---|---|
| 2026-05-13 | v1.0 | 首次制定(由 decision 020 触发) | [decision 020](decisions/020-sub-phase-3a-tx-true-atomicity.md) |

---

*本文档是 KRIG-Note V2 项目级永久规则,跨 sub-phase / 跨决议 / 跨对话生效。任何修改需独立决议 + 用户授权。*
