# 90-archive — 已完成任务归档

> **性质**：只读。这里的文档记录**当时怎么做的**，不记录**现在是什么样**。
> 想知道系统现状，看 [00-architecture/](../00-architecture/) 和 [10-business-design/](../10-business-design/)。

## 为什么归档

工作目录里堆了 480+ 份一次性任务文档（prompt / handoff / delivery / 阶段单 / verify 报告），
淹没了真正需要长期维护的设计文档。归档后 `docs/` 顶层只剩三类活文档：

| 目录 | 性质 |
|---|---|
| [00-architecture/](../00-architecture/) | 架构纲领，长期维护 |
| [10-business-design/](../10-business-design/) | 各模块业务设计，随功能演进 |
| [20-module-governance/](../20-module-governance/) | 模块边界治理专项（纲领 + 问题清单） |
| [reference/](../reference/) | 速查表 |

## 内容

| 子目录 | 数量 | 来源 | 内容 |
|---|---|---|---|
| [tasks/](tasks/) | 125 | `docs/tasks/` | 一次性任务文档：`*-prompt.md`（交新对话执行的工单）、`*-handoff.md`（跨对话交接）、`*-delivery.md`（交付报告）。有日期的覆盖 2026-05-28 ~ 2026-07-27，另有 24 份无日期早期文档 |
| [refactor-v2/](refactor-v2/) | 212 | `docs/RefactorV2/` | V2 重构全套：`stages/` 阶段设计单与完成报告（L0 ~ L5G7）、`data-model/` 数据模型决策（001 ~ 028）、`audit/` 分层审计、`notes/` 逐条 verify 报告 |
| [refactor-v1/](refactor-v1/) | 6 | `docs/refactor/` | V2 早期 refactor 尝试（pdf-viewer-adapter + 两个 capability 提升阶段），已被 refactor-v2 取代 |
| [module-governance-units/](module-governance-units/) | 20 | `docs/20-module-governance/units/` | 模块治理逐单元工单（U1 ~ U5、S1 ~ S5、step2），全部已交付验收 |
| [v1/](v1/) | 125 | `docs/99-archive-v1/` | V1 仓库历史归档：`refactor/` 全套（00-总纲 + 4 PROMPT + 14 stages + archive）、`evaluation/` 历史评估报告 |

## 注意事项

- **代码注释仍引用本目录**。约 26 处 `src/` 注释指向 `90-archive/tasks/` 下的设计文档
  （如 `context-menu-registry-handoff.md`、`cm6-elk-capability-refactor.md`、
  `2026-05-30-data-layer-reliability-design.md`）。移动时已同步改路径，**删除前先 grep**。
- **内部相对链接已按新层级修正**（672 处）。归档前就已失效的链接（380 处，多为指向 V1 仓库
  或已删除文件）保持原样未修。
- **不要在这里新增文档**。新的任务文档写在别处；完成后再挪进来。
