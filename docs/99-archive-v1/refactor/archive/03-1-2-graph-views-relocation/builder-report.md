# Builder 完成报告：refactor/graph-views-relocation

**任务卡**：`docs/refactor/stages/03-1-2-graph-views-relocation/task-card.md`
**契约**：N/A（基础设施类阶段）
**HEAD**：`620022fc759f0e4878e60cff5b47275eac8b6f61`
**完成时间**：2026-05-03 07:22

## A. refactor-card 完成判据逐条核对
- [✅] J1：`git mv src/plugins/graph/canvas/CanvasView.tsx src/plugins/graph/views/canvas/CanvasView.tsx` 执行成功 —— 证据：commit `0c55c277`
- [✅] J1 子项：旧位置不存在 —— 证据：`ls src/plugins/graph/canvas/CanvasView.tsx` 返回 `No such file`
- [✅] J1 子项：新位置存在 —— 证据：`src/plugins/graph/views/canvas/CanvasView.tsx`
- [✅] J1 子项：git rename 追踪成立 —— 证据：commit `0c55c277` 显示 `rename ... (100%)`
- [✅] J2：`git mv src/plugins/graph/canvas/ui src/plugins/graph/views/canvas/ui` 执行成功 —— 证据：commit `b845bb71`
- [✅] J2 子项：旧 `canvas/ui` 不存在 —— 证据：`ls src/plugins/graph/canvas/ui` 返回 `No such file`
- [✅] J2 子项：新 `views/canvas/ui` 含 6 文件 —— 证据：`find src/plugins/graph/views/canvas -type f` 含 6 个 ui 文件
- [✅] J3：5 个文件 import 路径调整完成（22 处） —— 证据：commit `620022fc`（`22 insertions(+), 22 deletions(-)`）
- [✅] J3.1：`renderer.tsx` 1 处调整 —— 证据：`./canvas/CanvasView` → `./views/canvas/CanvasView`
- [✅] J3.2：`views/canvas/CanvasView.tsx` 13 处调整 —— 证据：该文件 diff 仅 import 路径变化
- [✅] J3.3：`views/canvas/ui/Inspector/FloatingInspector.tsx` 1 处调整 —— 证据：`../../../library/types` → `../../../../library/types`
- [✅] J3.4：`views/canvas/ui/LibraryPicker/LibraryPicker.tsx` 4 处调整 —— 证据：shapes/substances/interaction/types 四行路径变化
- [✅] J3.5：`views/canvas/ui/LibraryPicker/preview-svg.ts` 3 处调整 —— 证据：shapes/substances/types 三行路径变化
- [✅] J3.6：`views/canvas/ui/{ContextMenu,Toolbar,dialogs}` 0 处调整 —— 证据：对应 3 文件仅 rename、内容 0/0
- [✅] J4：`git diff 83f21f64..HEAD --stat` 严格 8 文件改动 —— 证据：`8 files changed, 22 insertions(+), 22 deletions(-)`
- [✅] J5a：`npm run typecheck` exit 0 —— 证据：`tc: 0`
- [✅] J5b：`npm run lint` exit 1 且 warnings=15 —— 证据：`✖ 781 problems (766 errors, 15 warnings)`
- [✅] J5c：`npm run lint:dirs` exit 0 —— 证据：`dirs: 0`
- [✅] J6：commit message 符合 `refactor(refactor/graph-views-relocation): ...` 格式 —— 证据：`0c55c277` / `b845bb71` / `620022fc`
- [✅] J7：`find src/plugins/graph/canvas -type f` 不含 CanvasView.tsx 或 ui/ 文件 —— 证据：输出仅 scene/interaction/edit/persist/combine
- [✅] J8：`find src/plugins/graph/views/canvas -type f` 含 9 文件 —— 证据：03-1-1 已有 2 + 本阶段新增 7

## B. 契约 § B 防御代码迁移后核对
> 本次为基础设施类阶段，无功能契约，跳过。

## C. 范围越界自检
- [✅] 我没有"顺手"修改 refactor-card 范围之外的任何文件
- [✅] 我没有改动任何已有 useEffect/hook/事件监听器逻辑
- [✅] 我没有重命名任何已有业务标识符
- [✅] 我没有删除任何注释或防御代码

## D. 提交清单
- commit `0c55c277`: refactor(refactor/graph-views-relocation): git mv CanvasView.tsx → views/canvas/
- commit `b845bb71`: refactor(refactor/graph-views-relocation): git mv ui/ → views/canvas/ui/
- commit `620022fc`: refactor(refactor/graph-views-relocation): 调整 5 个文件 import 路径(22 处)
- 总 diff 行数（Builder 实质改动，`83f21f64..HEAD`）：`8 files changed, 22 insertions(+), 22 deletions(-)`

## E. 待 Commander 安排的事
1. 调度 Auditor 审计本分支
2. 按审计规则核对 22 处路径调整是否与 task-card § J3 完全一致

## F. 我没做但 card 要求的事（如有）
1. 无。

## G. 自行决断的边界（NON-BLOCKING 歧义）
1. 歧义：J4 在文字描述中同时出现 `e22e8517`（派活基线）与“立卡 SHA..HEAD”（实质改动口径）。
   我的处理：按 task-card 与本阶段指令采用 `83f21f64..HEAD` 做 J4 主核验，并补充 `e22e8517..HEAD --stat` 仅作历史链参考。
   理由：沿用 03-1-1 之后的“实质改动口径”，避免把立卡文档提交计入 Builder 改动范围。
