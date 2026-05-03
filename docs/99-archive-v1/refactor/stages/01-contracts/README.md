# 阶段 01：契约定型（波次 1）

> **状态**：待执行（task-card 已修订 v2，等 Builder 重启）
> **目标分支**：`refactor/contracts`（待 rebase 到最新 main）
> **类型**：基础设施类子波次（不动业务代码）
> **功能契约**：N/A
> **前置依赖**：阶段 00-eslint-bootstrap / 00x-schema-completion / typecheck-baseline 三个均已 merge 到 main

---

## 阶段目标

为整个 KRIG-Note 分层重构建立"宪法层"自动化护栏。完成后，任何后续 PR 一旦违反规则会被 eslint 自动拦截或脚本检查阻止。

## 阶段产出（5 项主任务，12 条完成判据）

按 [task-card.md](task-card.md) 完成判据 J1~J5.5 + J5b + J6 + J7a~J7c 验证。

1. **J1** CLAUDE.md 追加"重构期硬规则"段落（10 条禁令）
2. **J2** `src/shared/intents.ts`（IntentEvent 类型骨架）
3. **J3** `src/shared/ui-primitives.ts`（ViewDefinition / Capability / 五大菜单项类型）
4. **J4** `tools/lint/pure-utility-allowlist.ts`（纯工具白名单）
5. **J5** ESLint 项目规则 5 条 + 目录检查脚本：
   - **J5.1** 修改 `eslint.config.mjs` 加布局特权 API 禁令（error）
   - **J5.2** 跨插件 import 禁令（error）
   - **J5.3** `src/shared/**` 禁 import electron（error）
   - **J5.4** 视图层禁外部依赖（warn，波次 3 升 error）
   - **J5.5** `tools/lint/check-plugin-dirs.sh` 脚本 + `npm run lint:dirs`

## 本阶段相关文件

| 文件 | 用途 | 角色 |
|------|------|------|
| [README.md](README.md) | 阶段总览（本文件） | 全员参考 |
| [task-card.md](task-card.md) | 任务卡：J1~J5 + 完成判据 + 严禁顺手做 + 风险 | Builder 必读 |
| [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) | Builder 派活指令（自包含） | Builder 读 |
| [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) | Auditor 审计指令（自包含） | Auditor 读（执行完才用） |

## 全局引用（顶层宪法 + 通用角色规则）

| 文件 | 角色 |
|------|------|
| [docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 | 全员必读 |
| [CLAUDE.md](../../../../CLAUDE.md) | 全员必读 |
| [BUILDER-PROMPT.md](../../BUILDER-PROMPT.md) | Builder 必读 |
| [AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md) | Auditor 必读 |
| [COMMANDER-PROMPT.md](../../COMMANDER-PROMPT.md) | Commander 自读 |

## 阶段流转状态

| 阶段 | 状态 | 时间 |
|------|------|------|
| Commander 准备 | ✅ 完成 | 2026-05-02 |
| Builder 执行 | ⏳ 待启动 | — |
| Auditor 审计 | ⏳ 待 Builder 完成 | — |
| 用户拍板 merge | ⏳ 待审计 | — |

> Builder 完成后写 `tmp/builder-report.md`；Auditor 完成后写 `tmp/auditor-report.md`。
> 整阶段完成 + merge 到 main 后，本目录作为历史档案永久保留。

## 下一阶段

`docs/refactor/stages/02-...`（波次 2：建中间层）—— 由 Commander 在本阶段验收后起草。
