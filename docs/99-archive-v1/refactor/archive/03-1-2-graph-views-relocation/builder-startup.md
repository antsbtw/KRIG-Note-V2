# Builder 启动自检：refactor/graph-views-relocation

## 已读输入
- ✅ 总纲 v2.3
- ✅ CLAUDE.md（重构期硬规则段）
- ✅ refactor-card：`docs/refactor/stages/03-1-2-graph-views-relocation/task-card.md`
- ✅ 阶段说明与执行指令：`docs/refactor/stages/03-1-2-graph-views-relocation/README.md`、`docs/refactor/stages/03-1-2-graph-views-relocation/BUILDER-INSTRUCTION.md`
- ✅ 功能契约：N/A（基础设施类阶段）
- ✅ 03-1-1 已落对象：`src/plugins/graph/views/canvas/index.ts`、`src/plugins/graph/views/canvas/README.md`、`src/plugins/graph/views/README.md`
- ✅ 目标分支状态：当前在 `refactor/graph-views-relocation`，HEAD = `83f21f64`

## 本次 refactor-card 完成判据复述
- J1：`git mv src/plugins/graph/canvas/CanvasView.tsx src/plugins/graph/views/canvas/CanvasView.tsx` 成功。
- J1 子项：旧位置 `canvas/CanvasView.tsx` 不存在，新位置 `views/canvas/CanvasView.tsx` 存在，git status 显示 rename。
- J2：`git mv src/plugins/graph/canvas/ui src/plugins/graph/views/canvas/ui` 成功。
- J2 子项：旧 `canvas/ui/` 不存在，新 `views/canvas/ui/` 含 6 文件。
- J3：5 个文件 import 路径调整严格按规则表（共 22 处）。
- J3.1：`src/plugins/graph/renderer.tsx` 调整 1 处。
- J3.2：`views/canvas/CanvasView.tsx` 调整 13 处。
- J3.3：`views/canvas/ui/Inspector/FloatingInspector.tsx` 调整 1 处。
- J3.4：`views/canvas/ui/LibraryPicker/LibraryPicker.tsx` 调整 4 处。
- J3.5：`views/canvas/ui/LibraryPicker/preview-svg.ts` 调整 3 处。
- J3.6：`views/canvas/ui/{ContextMenu,Toolbar,dialogs}` 0 处调整。
- J4：以立卡 SHA `83f21f64..HEAD` 对账，严格 8 文件改动（1 修改 + 7 rename）。
- J5a：`npm run typecheck` exit 0。
- J5b：`npm run lint` exit 1 且 warnings 必须严格 15（errors 可有小幅波动）。
- J5c：`npm run lint:dirs` exit 0。
- J6：commit message 符合 `refactor(refactor/graph-views-relocation): ...` 规范。
- J7：`find src/plugins/graph/canvas -type f` 不含 CanvasView.tsx 与 ui/ 文件。
- J8：`find src/plugins/graph/views/canvas -type f` 含 9 文件（已有 2 + 本阶段新增 7）。

## 契约 § B 防御代码 grep 验证
本次为基础设施类阶段，无功能契约，跳过。

## 基线确认
- `npm run typecheck` → `tc: 0` ✅
- `npm run lint` → `lint: 1` ✅
- `npm run lint 2>&1 | grep "✖" | tail -1` → `✖ 781 problems (766 errors, 15 warnings)` ✅
- `npm run lint:dirs` → `dirs: 0` ✅
- `src/plugins/graph/canvas/CanvasView.tsx` 存在 ✅
- `src/plugins/graph/canvas/ui` 下 5 个子目录存在 ✅
- `src/plugins/graph/views/canvas/index.ts` 存在 ✅
- `src/plugins/graph/views/canvas/CanvasView.tsx` 不存在 ✅

## 识别到的歧义/冲突（如有，分级）
### BLOCKING（无法继续，已写入 tmp/builder-blockers.md，会话停止）
- 无。

### NON-BLOCKING（按 card 字面 + 总纲推断后继续，记录在最终报告 G 段）
1. J4 在 BUILDER-INSTRUCTION 与 task-card 中同时出现“基线 SHA/立卡 SHA”描述。处理：按 task-card 立卡 SHA `83f21f64..HEAD` 做实质改动对账，并补充 `e22e8517..HEAD` 作为历史链参考。

## 我的下一步
- [x] 无 BLOCKING：进入执行阶段，完成后写 `tmp/builder-report.md`
- [ ] 有 BLOCKING：会话结束，等 Commander 处理 `tmp/builder-blockers.md`
