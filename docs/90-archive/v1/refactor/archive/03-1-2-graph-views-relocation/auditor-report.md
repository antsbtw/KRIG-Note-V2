# 审计报告：refactor/graph-views-relocation

**审计阶段**：Step A（行为保持迁移）
**功能契约**：N/A（基础设施类阶段）
**总纲版本**：v2.3（重点核对 §2.2 + §5.8）

## 总评
通过。
本分支满足 03-1-2 task-card 的 J4（立卡 SHA 口径）与 J5 关键验收，`git mv`/rename 链完整，实质改动严格收敛在 8 文件且仅为 import 路径调整。

## A. 总纲合规性
- A1 [✅] 视图层无新增违规 npm 直接 import（本阶段仅路径迁移与相对路径调整）
- A2 [✅] 无新增布局特权 API 调用（`openCompanion/closeRightSlot/openRightSlot/ensureCompanion`）
- A3 [✅] 无新增跨插件 import（`plugins/<X>` → `plugins/<Y>`）
- A4 [✅] `WorkspaceState` 无新增业务字段
- A5 [✅] Atom 无新增 view-meta 字段
- A6 [✅] `plugins/<X>/` 下无新建 `engine/runtime/lib` 目录
- A7 [✅] 未新增 ViewDefinition（03-1-1 已落文件本阶段未改）
- A8 [✅] 未新增 Capability 声明
- A9 [✅] 无菜单 command 结构变更
- A10 [✅] `shared/` 无新增 `import 'electron'`

## B. 功能契约保留
- N/A：本阶段为基础设施类 Step A 搬移，按指令不做插件功能契约逐条验收。

## C. Step A 纯度（适用）
- C1 [✅] 非 ViewDefinition 创建 + import 路径修改的代码行数为 0（实质修改发生在提交 `620022fc`，仅 5 文件 import 22 处路径改写）
- C2 [✅] 无“顺手优化”（无命名重构、注释清理、抽象提取）
- C3 [✅] useEffect/hook/event listener 数量未变（`0c55c277`、`b845bb71` 为纯 rename，`620022fc` 仅 import 行）
- C4 [✅] import 改动仅路径文本变化，无新增 npm 依赖
- C5 [✅] 无新增/删除 useState/useRef

## D. Step B 合规（如适用）
- 跳过：本阶段不是 Step B。

## E. 测试与验收
- E1 [✅] 任务卡 J1~J8 要求覆盖完整；J4 双口径已核
- E2 [✅] `npm run lint` 复跑：`exit 1`，`✖ 781 problems (766 errors, 15 warnings)`，warnings 严格=15
- E3 [✅] `npm run typecheck` 复跑：exit 0
- E4 [✅] `npm run lint:dirs` 复跑：exit 0

## 必修问题（不修无法通过）
1. 无。

## 待 Builder 证明
1. 无。

## 建议（非阻塞）
1. 后续 03-1-3/03-1-4 继续沿用“立卡 SHA 作为 J4 主口径 + 派活基线作 history 辅助口径”的双轨校验，避免把立卡文档提交混入实质改动统计。

## 证据摘要（关键命令结果）
1. 立卡 SHA 自查：`83f21f64`（与预期一致）
2. 提交链：`0c55c277`（mv CanvasView）→ `b845bb71`（mv ui）→ `620022fc`（import 22 处）
3. `git diff 83f21f64..refactor/graph-views-relocation --stat`：`8 files changed, 22 insertions(+), 22 deletions(-)`
4. `git diff 83f21f64..refactor/graph-views-relocation --name-status`：`1 M + 7 R*`，无 `D+A` 对
5. `620022fc` 明细：仅 `renderer.tsx` + `CanvasView.tsx` + `FloatingInspector.tsx` + `LibraryPicker.tsx` + `preview-svg.ts` 的 import 行变更
6. 留存目录零改动：`canvas/scene`、`canvas/interaction`、`canvas/edit`、`canvas/persist`、`canvas/combine.ts`、`library` 等 diff 输出为空
7. capability 与 03-1-1 文件零改动：`src/capabilities/**`、`views/canvas/index.ts`、`views/canvas/README.md`、`views/README.md` diff 为空
8. 结构验证：旧位置 `canvas/CanvasView.tsx` 与 `canvas/ui` 不存在；`views/canvas` 下共 9 文件（03-1-1 的 2 + 本阶段 7）

---
（报告结束，不展开讨论）
