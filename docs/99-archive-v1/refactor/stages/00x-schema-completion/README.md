# 阶段 00x：Schema 骨架补全

> **状态**：待执行
> **目标分支**：`refactor/schema-interop-completion`（待 Builder 从 main 切出）
> **类型**：重构骨架自身缺陷修复（重构机制内）
> **功能契约**：N/A
> **前置依据**：阶段 00 Builder 探查 [tmp/builder-blockers.md](../../../../tmp/builder-blockers.md) B1：`schema-interop.ts` 引用未定义的 `ViewType` / `LicenseTier`

---

## 命名说明：为什么是 "00x" 不是 "00a"

阶段 00 主线是 ESLint Bootstrap。本阶段是与之**并行**的另一个修复分支（修 schema 骨架自身缺陷），不是 00 的子阶段。"00x" 表示"与 00 同级、可并行 merge、互不依赖"。同期还有 [`fix-tasks/typecheck-baseline.md`](../../fix-tasks/typecheck-baseline.md) 修历史 type 债——三件事并行后才能让阶段 01 重启。

## 阶段目标

补全 `src/shared/types/schema-visualization.ts` 与 `src/shared/types/schema-interop.ts` 中**重构期产出但定义缺失**的两个类型：

- `ViewType`（在 schema-visualization.ts 应导出，schema-interop.ts 已 import 但 import 失败）
- `LicenseTier`（在 schema-interop.ts 已使用但完全未定义，整个仓库未导出）

完成后 `npx tsc --noEmit` 在 `src/shared/types/schema-interop.ts` 上的 2 处错误清零。

## 阶段产出

按 [task-card.md](task-card.md) 完成判据 J1~J4 验证：

1. **J1** `schema-visualization.ts` 新增 `ViewType` 类型导出
2. **J2** schema 体系内某文件新增 `LicenseTier` 类型定义并被 schema-interop.ts 导入
3. **J3** `npx tsc --noEmit` 在 schema-interop.ts 错误数 = 0
4. **J4** `git diff main...HEAD` 仅含 `src/shared/types/schema-*.ts` 改动

## 本阶段相关文件

| 文件 | 用途 | 角色 |
|------|------|------|
| [README.md](README.md) | 阶段总览（本文件） | 全员参考 |
| [task-card.md](task-card.md) | 任务卡：J1~J4 + 完成判据 + 严禁顺手做 | Builder 必读 |
| [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) | Builder 派活指令（自包含） | Builder 读 |
| [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) | Auditor 审计指令（自包含） | Auditor 读 |

## 全局引用

| 文件 | 角色 |
|------|------|
| [docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 6 配套数据模型四层 | 全员必读 |
| [docs/evaluation/2026-05-02-DataModel-Architecture-Design.md](../../../evaluation/2026-05-02-DataModel-Architecture-Design.md) | Builder 设计补全时参考 |
| [BUILDER-PROMPT.md](../../BUILDER-PROMPT.md) / [AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md) | 角色规则 |

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备 | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |

## 与其他阶段的关系

```
main (bd390c70)
 │
 ├── refactor/eslint-bootstrap     ← 阶段 00（已建分支，被 B1 阻塞中）
 ├── refactor/schema-interop-completion ← 阶段 00x（本阶段，新建）
 └── fix/typecheck-baseline        ← 历史 type 债清理（fix-tasks/typecheck-baseline.md）
                                       三个分支并行,merge 顺序无所谓
                                              ↓
                                       三个全部 merge 到 main 后
                                              ↓
                                       阶段 01-contracts 重启
```

## 设计原则（为什么不和历史 type 债一起修）

> 本阶段的 2 处错误是**重构期产出本身的缺陷**——schema 骨架在 commit 5878d1e4 入仓时未跑 typecheck。与 `WebkitAppRegion` / `view.webContents` 等仓库历史 type 债**性质完全不同**。
>
> 混在一起修会让未来 git log 上的 commit 同时承载两类语义：A）补重构骨架；B）清历史债。重构纯净度优先于"省一个 PR"。
