# 阶段 03-1-2:graph CanvasView + ui/ 搬移到 views/canvas/(波次 3.1 第二子阶段)

> **状态**:待执行
> **目标分支**:`refactor/graph-views-relocation`(已由 Commander 从 main 切出)
> **类型**:Step A 行为保持迁移(纯文件搬移 + import 路径调整,代码内部行为零改动)
> **功能契约**:N/A
> **派活基线 SHA**:`e22e8517`(main HEAD,含 03-1-1 存档)

---

## 阶段目标

继 03-1-1(ViewDefinition 骨架)之后,**首次执行 Step A 实质文件搬移**——将 graph 视图主体(CanvasView.tsx)和纯 UI 组件(ui/)从 `plugins/graph/canvas/` 搬入目标态目录 `plugins/graph/views/canvas/`,达成总纲 § 5.8 "视图层归 views/" 目标。

**核心命题**:用 `git mv` 保留 history blame 链,纯调整 import 路径,**代码内部行为零改动**(§ 2.2 Step A 字面要求)。

> **重要范围限定**:本阶段仅搬"纯视图代码"(CanvasView.tsx + ui/)——**不动**已 capability 化的 scene/ + interaction/(留 03-1-4 真搬迁)、ProseMirror 违规的 edit/(留 03-1-3)、persist/ + combine.ts(留 03-1-4)。

按总纲 § 2.2 + § 5.8。

## 阶段产出(按 task-card 完成判据 J1~J5 验证)

1. **J1** `git mv src/plugins/graph/canvas/CanvasView.tsx → src/plugins/graph/views/canvas/CanvasView.tsx`
2. **J2** `git mv src/plugins/graph/canvas/ui → src/plugins/graph/views/canvas/ui`(6 文件全套)
3. **J3** 调整 5 个文件的 import 路径(renderer.tsx + CanvasView.tsx + 3 个 ui/ 文件)
4. **J4** 范围对账(双点 diff,严格 8 文件改动:1 修改 + 7 重命名带改动)
5. **J5** typecheck=0 / lint warnings=15 严格不变 / lint:dirs=0

## Commander 起步前的现状探查 + 实测(按 § 六纪律 1+2+4)

### 1. 搬移范围精确盘点(已 grep + 实测)

| 类型 | 文件 | 数量 | 命运 |
|---|---|---|---|
| 视图主体 | `canvas/CanvasView.tsx`(1147 行)| 1 | 搬入 `views/canvas/` |
| ui/Inspector/ | `FloatingInspector.tsx` | 1 | 搬入 |
| ui/LibraryPicker/ | `LibraryPicker.tsx` + `preview-svg.ts` | 2 | 搬入 |
| ui/Toolbar/ | `Toolbar.tsx` | 1 | 搬入 |
| ui/ContextMenu/ | `ContextMenu.tsx` | 1 | 搬入 |
| ui/dialogs/ | `CreateSubstanceDialog.tsx` | 1 | 搬入 |
| **入口** | `plugins/graph/renderer.tsx` | 1 | 修改 import 路径 |
| **小计** | | **8 文件** | |

### 2. 不搬范围(按 03-1 子阶段路径图严格隔离)

| 子目录 | 留给哪个子阶段 | 原因 |
|---|---|---|
| `canvas/scene/` (6 文件 Three.js)| 03-1-4 真搬迁 | 已 capability 化(02b-6 临时引用 capability.canvas-interaction)|
| `canvas/interaction/` (2 文件)| 03-1-4 真搬迁 | 已 capability 化(02b-6 临时引用)|
| `canvas/edit/` (5 文件)| 03-1-3 违规处理 | 直接 import prosemirror-* 违规 § 1.3 规则 A |
| `canvas/persist/` (1 文件)| 03-1-4 真搬迁 | 暂未 capability 化 |
| `canvas/combine.ts` | 后续 | 未明确归宿 |
| `library/` | 已 02b-5 capability.shape-library | 独立目录,不动 |

### 3. capability.canvas-interaction 引用路径不受影响(已 grep)

```bash
$ grep "@plugins/graph/canvas" src/capabilities/canvas-interaction/index.ts
import { SceneManager } from '@plugins/graph/canvas/scene/SceneManager';
import { InteractionController } from '@plugins/graph/canvas/interaction/InteractionController';
import { NodeRenderer } from '@plugins/graph/canvas/scene/NodeRenderer';
import { HandlesOverlay } from '@plugins/graph/canvas/scene/HandlesOverlay';
```

→ capability 用 path alias 引用 `scene/` + `interaction/`——这两个目录**本阶段不搬**,故 capability 文件**零改动**。

### 4. 实测(已在 git worktree 内完成,清理后留 0 痕迹)

实测步骤:
1. `git worktree add -b probe/03-1-2-test /tmp/krig-test-03-1-2 main`
2. `git mv` CanvasView.tsx + ui/ 搬入 `views/canvas/`
3. `sed` 修改 5 个文件的 import 路径(详见 task-card § J3 路径调整规则表)
4. `npm run typecheck` → exit 0
5. `npm run lint` → warnings=15 严格不变
6. `npm run lint:dirs` → exit 0
7. `git diff --stat` → 8 文件改动(1 修改 + 7 重命名),+23/-22 行
8. 清理 worktree + 删除 probe 分支

实测结果:
- ✅ typecheck=0
- ✅ lint warnings=15 严格不变(errors 数受 ESLint cache 影响,Builder 主工作树跑出来应为 766)
- ✅ lint:dirs=0
- ✅ 8 文件改动符合预期
- ✅ 7 文件 git rename 检测成功(history blame 链保留)

## 与 03-1-1 对比

| 阶段 | 类型 | 改动文件数 | 风险 |
|---|---|---|---|
| 03-1-1 | 纯新建 ViewDefinition + 2 README | 3 文件 | 极低 |
| **03-1-2(本阶段)** | **git mv 8 文件 + import 路径调整** | **8 文件** | **中** |
| 03-1-3 | edit/ ProseMirror 违规处理 | 待估 | 中-高 |
| 03-1-4 | scene/interaction/persist 真搬迁 | 待估 | 高 |

## 03-1 全貌(完整 Step A 4 子阶段路径图)

| 子阶段 | 任务 | 状态 |
|---|---|---|
| 03-1-1 | ViewDefinition 骨架 | ✅ 完成(merge `d69c4740`) |
| **03-1-2** | **CanvasView + ui/ 搬移到 views/canvas/(本阶段)** | **⏳ 待执行** |
| 03-1-3 | edit/GraphEditor.ts ProseMirror 违规处理 | ⏸️ 后续 |
| 03-1-4 | scene/interaction/persist 真搬迁(Step B) | ⏸️ 后续 |

## 本阶段相关文件

| 文件 | 用途 | 角色 |
|------|------|------|
| [README.md](README.md) | 阶段总览(本文件) | 全员参考 |
| [task-card.md](task-card.md) | 任务卡:J1~J5 + 路径调整规则表 | Builder 必读 |
| [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) | Builder 派活指令 | Builder 读 |
| [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) | Auditor 审计指令 | Auditor 读 |

## 全局引用

| 文件 | 角色 |
|------|------|
| [docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 2.2 + § 5.8 | 全员必读 |
| [src/plugins/graph/canvas/CanvasView.tsx](../../../../src/plugins/graph/canvas/CanvasView.tsx) | 搬移源 |
| [src/plugins/graph/canvas/ui/](../../../../src/plugins/graph/canvas/ui/) | 搬移源 |
| [src/plugins/graph/renderer.tsx](../../../../src/plugins/graph/renderer.tsx) | import 修改对象 |
| [src/plugins/graph/views/canvas/index.ts](../../../../src/plugins/graph/views/canvas/index.ts) | 03-1-1 已落 ViewDefinition,本阶段不动 |

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备(含现状探查 + 实测) | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |
