# 阶段 00：ESLint 工具链 Bootstrap

> **状态**：待执行
> **目标分支**：`refactor/eslint-bootstrap`（已由 Commander 从 main 切出，HEAD=`bd390c70`）
> **类型**：基础设施类前置波次（不写任何项目规则，只装工具链）
> **功能契约**：N/A
> **前置依据**：阶段 01 Builder 探查发现仓库无 ESLint，触发 BLOCKING。本阶段解 BLOCKING 后，阶段 01 重启执行。

---

## 阶段目标

为整个 KRIG-Note 仓库装入 ESLint + TypeScript 类型检查的可运行工具链。**不写任何项目规则**——规则是阶段 01 的工作。本阶段产物：

- 一个能跑的 `npm run lint`（哪怕只是默认推荐规则）
- 一个能跑的 `npm run typecheck`
- 一份最小可运行的 ESLint 配置（flat 风格）
- TypeScript path 别名扩展到 `tools/**/*`
- 根目录 `tmp/` 入 `.gitignore`

完成后阶段 01 即可基于此基础写 5 条项目规则。

## 阶段产出（按 task-card J0~J5 完成判据验证）

1. **J0** 装 ESLint + 必要 plugin（devDependency 入 package.json）
2. **J1** 加 `lint` / `typecheck` script 到 package.json
3. **J2** 创建最小可运行 `eslint.config.mjs`（flat 风格）
4. **J3** 扩展 `tsconfig.json` `include` 至 `tools/**/*`
5. **J4** 将根目录 `tmp/` 加入 `.gitignore`
6. **J5** 验证：`npm install` 成功 + `npm run lint` 不报错运行 + `npm run typecheck` 不报错运行

## 本阶段相关文件

| 文件 | 用途 | 角色 |
|------|------|------|
| [README.md](README.md) | 阶段总览（本文件） | 全员参考 |
| [task-card.md](task-card.md) | 任务卡：J0~J5 + 完成判据 + 严禁顺手做 + 风险 | Builder 必读 |
| [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) | Builder 派活指令（自包含） | Builder 读 |
| [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) | Auditor 审计指令（自包含） | Auditor 读（执行完才用） |

## 全局引用

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

## 下一阶段

`docs/refactor/stages/01-contracts/`（波次 1：项目规则定义）—— 本阶段 merge 到 main 后重启 01。01 阶段 task-card 不变，但 Builder 重启时仓库已具备 ESLint 工具链，J5 系列判据将不再 BLOCKING。

## 设计原则（为什么把工具链 bootstrap 单独成阶段）

> 工具链选型与项目规则是两件正交的事：
> - 工具链：装哪个 ESLint 主版本、flat vs legacy、用什么 plugin
> - 项目规则：禁止 import 哪些 API、目录禁建什么
>
> 两件事独立提交（两个 PR），未来想替换 ESLint 时只改 00 阶段成果，不污染 01 的规则定义。这与总纲 § 5.8 "底层引擎与视图分离"是同构思想——工具链是底层、规则是上层。
