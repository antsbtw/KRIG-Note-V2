# Builder 启动自检：refactor/graph-view-definition-skeleton

## 已读输入
- ✅ 总纲 v2.3
- ✅ CLAUDE.md（重构期硬规则段）
- ✅ refactor-card：`docs/refactor/stages/03-1-1-graph-view-definition-skeleton/task-card.md`
- ✅ 阶段说明与执行指令：`docs/refactor/stages/03-1-1-graph-view-definition-skeleton/README.md`、`docs/refactor/stages/03-1-1-graph-view-definition-skeleton/BUILDER-INSTRUCTION.md`
- ✅ 功能契约：N/A（基础设施类阶段）
- ✅ 数据契约与引用对象：`src/shared/ui-primitives.ts`、`src/capabilities/canvas-interaction/index.ts`、`src/capabilities/shape-library/index.ts`
- ✅ 目标分支状态：当前在 `refactor/graph-view-definition-skeleton`，HEAD = `d2cf82c3`

## 本次 refactor-card 完成判据复述
- J1：新建 `src/plugins/graph/views/canvas/index.ts`，字节级匹配 task-card § J1。
- J1 子项：仅 1 行 import `import type { ViewDefinition } from '@shared/ui-primitives'`。
- J1 子项：`graphCanvasView` 顶层 const 导出。
- J1 子项：`viewId` 为 `'graph.canvas'`。
- J1 子项：`install` 严格 2 项且顺序为 `canvas-interaction` → `shape-library`。
- J1 子项：不含 `contextMenu` / `toolbar` / `slash` / `handle` / `floatingToolbar` 字段。
- J1 子项：不含任何 `eslint-disable` 注释。
- J1 子项：不含 `as ViewDefinition` 冗余断言。
- J2：新建 `src/plugins/graph/views/canvas/README.md`，字节级匹配 task-card § J2。
- J2 子项：段落与内容结构完整（当前状态、范围限定、install 说明、contextMenu/toolbar 原因、runtime、设计原则、后续路径图）。
- J3：新建 `src/plugins/graph/views/README.md`，字节级匹配 task-card § J3。
- J3 子项：段落与内容结构完整（当前状态、与 `plugins/graph/canvas/` 关系、设计原则、临时引用模式）。
- J4：`git diff 7070566e..HEAD --stat` 仅含 3 个新增文件。
- J5a：`npm run typecheck` exit 0。
- J5b：`npm run lint` exit 1，且严格 `766 errors / 15 warnings`。
- J5c：`npm run lint:dirs` exit 0。
- J6：commit message 使用 `feat/docs(refactor/graph-view-definition-skeleton): ...` 规范。
- J7：`find src/plugins/graph/views -type d` 仅 2 行（`views` 与 `views/canvas`）。
- J8：`find src/plugins/graph/views -type f` 仅 3 行（`views/README.md`、`views/canvas/index.ts`、`views/canvas/README.md`）。

## 契约 § B 防御代码 grep 验证
本次为基础设施类阶段，无功能契约，跳过。

## 基线确认
- `npm run typecheck` → `tc: 0` ✅
- `npm run lint` → `lint: 1` ✅
- `npm run lint 2>&1 | grep "✖" | tail -1` → `✖ 781 problems (766 errors, 15 warnings)` ✅
- `npm run lint:dirs` → `dirs: 0` ✅
- `ls src/plugins/graph/views` → `No such file or directory` ✅
- `grep "ViewDefinition" src/shared/ui-primitives.ts` 命中 `export interface ViewDefinition` ✅
- `src/capabilities/canvas-interaction/index.ts` 存在 ✅
- `src/capabilities/shape-library/index.ts` 存在 ✅

## 识别到的歧义/冲突（如有，分级）
### BLOCKING（无法继续，已写入 tmp/builder-blockers.md，会话停止）
- 无。

### NON-BLOCKING（按 card 字面 + 总纲推断后继续，记录在最终报告 G 段）
1. 当前分支在基线 `7070566e` 之上已有文档提交 `d2cf82c3`（阶段目录文件）。处理：按指令继续，并在 J4/J6 中严格使用 `7070566e..HEAD` 做范围与提交核对。

## 我的下一步
- [x] 无 BLOCKING：进入执行阶段，完成后写 `tmp/builder-report.md`
- [ ] 有 BLOCKING：会话结束，等 Commander 处理 `tmp/builder-blockers.md`
