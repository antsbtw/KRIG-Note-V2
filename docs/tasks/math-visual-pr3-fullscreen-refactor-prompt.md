# PR3 启动 prompt — math-visual 全屏重构 + 架构合一

> 新对话从这份文档开始。读完 §1-§3 就能接上上下文,§4 是执行计划,§5 是测试 + 收尾标准。

---

## 1. 你是谁,在做什么

V2 项目 (`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`) 的 math-visual block 改造第三步。

**已完成的 PR**:
- **PR1**(已合 main `0325af54`,已 push) — 容器 9:6 锁比例 + hover-only UI + 宽度档位 sm/md/lg/full
- **PR2**(commit `de5a10eb` 在 `feature/math-visual-implicit` 分支,**不合 main,作参考**) — inline 加隐式方程 F(x,y)=0 + displayExpression + ExpressionDialog + 曲线 label

**本次 PR3 目标**:
全屏面板 (`fullscreen/LeftPanel.tsx` + `RightPanel.tsx` + `MathVisualFullscreenPanel.tsx`) 完整重构,
**统一逻辑层** + **拆区块组件**,消除 PR2 暴露的"两套渲染"架构债务。

**PR4(下一轮,不在本次范围)**:
inline (`MathVisualComponent.tsx`) 重写为"全屏的子集" — 复用 PR3 抽出的区块组件。
**当前 main 上的 inline 仍是 PR1 状态**(没有隐式方程、没有 ExpressionDialog、没有 label)。

---

## 2. 必读上下文

按顺序读这几个:

### 2.1 项目工作约定
- **CLAUDE.md** (项目根) — 分支策略、提交规范
- **`/Users/wenwu/.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/MEMORY.md`** — 全部历史教训
- 特别注意以下几条记忆(直接 Read 看):
  - `feedback_v2_is_workspace_v1_is_reference.md` — V2 是工作目录 / V1 仅参考 / **每个 Bash 调用必须 cd /...V2**
  - `feedback_v2_cwd_drift_again.md` — cwd 漂移已 7+ 次,任何 Bash/Read 都要绝对路径
  - `feedback_merge_requires_explicit_ok.md` — commit / merge 都需要用户显式确认,不要擅自合并
  - `feedback_branch_module_boundary.md` — 一个模块一条 feature 分支
  - `feedback_implementation_test_checklist.md` — 每个交付必须给逐项测试清单
  - `project_math_visual_pr2_reference_pr3_plan.md` — 三步重构总规划(本 PR 的上位决议)

### 2.2 PR2 参考实现 (本次要参考但不 cherry-pick)
分支 `feature/math-visual-implicit`,关键文件:
- `src/capabilities/math-rendering/types.ts` — 加了 `ImplicitCurve` / `PlotType: 'implicit'` / `MathHostProps.onLabelMove` / `Curve.label & labelPos`
- `src/capabilities/math-rendering/compute/plot-detect.ts` — 加 `implicit` 识别 + `displayExpression` 字段
- `src/capabilities/math-rendering/compute/evaluator.ts` — 加 `makeImplicitFn` + `extractParameters` 排除 'y'
- `src/capabilities/math-rendering/compute/marching-squares.ts` — 新文件,marching squares 算法
- `src/capabilities/math-rendering/host/MathHost.tsx` — `renderCurve` 加 implicit 分支 + label 渲染(默认位置算法)
- `src/drivers/text-editing-driver/blocks/math-visual/types.ts` — FunctionEntry 加 `displayExpression?` / `labelPos?`
- `src/drivers/text-editing-driver/blocks/math-visual/components/ExpressionDialog.tsx` — 新文件,LaTeX live preview modal
- `src/drivers/text-editing-driver/blocks/math-visual/components/FunctionRow.tsx` — 删 inline editing,改触发 dialog
- `src/drivers/text-editing-driver/blocks/math-visual/MathVisualComponent.tsx` — 接 ExpressionDialog + 隐式路由
- `src/drivers/text-editing-driver/pm-host.css` — `.mv-add-dialog-*` 系列样式

**查看 PR2 diff**: `git diff main feature/math-visual-implicit -- src/drivers/text-editing-driver/blocks/math-visual/ src/capabilities/math-rendering/`

### 2.3 全屏现状(本次要重构的对象)
- `src/drivers/text-editing-driver/blocks/math-visual/fullscreen/MathVisualFullscreenPanel.tsx` — 全屏面板 shell
- `src/drivers/text-editing-driver/blocks/math-visual/fullscreen/LeftPanel.tsx` — **重点**,含函数列表 + 工具栏 + 参数滑块 + 导出
- `src/drivers/text-editing-driver/blocks/math-visual/fullscreen/RightPanel.tsx` — 画布右栏
- `src/drivers/text-editing-driver/blocks/math-visual/fullscreen/LegendOverlay.tsx` — 图例
- `src/drivers/text-editing-driver/blocks/math-visual/fullscreen/menu-context.ts`
- `src/drivers/text-editing-driver/blocks/math-visual/fullscreen/FullscreenErrorBoundary.tsx`

LeftPanel 当前直接复制了 inline 的"函数管理"逻辑(`updateFunction` / `addFunction` / `removeFunction` / `updateParameter`),
内部还有独立的 `FunctionCard` 组件(inline editing input,**不走 ExpressionDialog**,**没有 displayExpression**,**不支持隐式方程**)。
全屏额外功能(inline 没有):
- 工具栏 7 件(移动 / 框选 / 标注 / 切线 / 法线 / 积分 / 极值)
- 参数动画播放/暂停
- 导出 PNG / SVG
- 标题输入(暂未启用)

---

## 3. 用户的核心诉求

(原话保留,作为决议基准)

> "我觉得 inline 是全屏的延伸,全屏完成后,inline 呈现在小空间内即可。不应该两套独立的系统。"

> "目前的构建方法有问题,两套渲染函数。"

**含义**:
- 全屏是"完整功能版",inline 是"压缩呈现版"
- 函数管理逻辑必须 SSOT(单一真相源)
- PR3 先把全屏做对、做完整;PR4 再让 inline 复用全屏的区块

---

## 4. PR3 执行计划

### 4.1 分支
新分支 `feature/math-visual-fullscreen-refactor` 从 main 切出(**不是从 PR2 分支切**)。

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git checkout main
git pull origin main  # 确保最新
git checkout -b feature/math-visual-fullscreen-refactor main
```

### 4.2 实施阶段(每阶段单独 commit,等用户验证后再继续下一阶段)

#### Phase 1 — capability 端补齐隐式方程支持
**目标**: 把 PR2 capability 端改动 1:1 搬过来 (不带 driver 端改动)。
**改动文件**(5 个,基本就是 cherry-pick PR2 的 capability 部分):
- `src/capabilities/math-rendering/types.ts` — `ImplicitCurve` / `PlotType` / `displayExpression` 返回字段 / `Curve.label & labelPos` / `MathHostProps.onLabelMove`
- `src/capabilities/math-rendering/compute/plot-detect.ts` — 加 implicit 识别 + displayExpression
- `src/capabilities/math-rendering/compute/evaluator.ts` — `makeImplicitFn` + extractParameters 排除 'y'
- `src/capabilities/math-rendering/compute/marching-squares.ts` — 新文件
- `src/capabilities/math-rendering/host/MathHost.tsx` — renderCurve 加 implicit 分支 + label 默认位置算法
- `src/capabilities/math-rendering/index.ts` — 注册 makeImplicitFn 等

**关键提醒**:
- 直接看 `git show feature/math-visual-implicit -- <文件>` 拿改动内容
- **不要 cherry-pick commit** — 因为 PR2 commit 含 driver 改动,会和后续阶段冲突。手动 apply 改动到对应文件即可。
- **label 渲染保留 PR2 的"无 MovablePoint 默认位置算法"路线**(用户已确认不要拖动)
- Phase 1 完成后,inline 仍是 main 状态(只能走 y-of-x),全屏仍是旧 LeftPanel — 但 capability 已经能接 implicit。**先 commit + 等用户验证 capability 类型检查通过**。

#### Phase 2 — 抽 `useFunctionManagement` hook
**目标**: 把"函数 CRUD + plotType detect + 参数提取"逻辑抽进一个共享 hook。

**新建文件**: `src/drivers/text-editing-driver/blocks/math-visual/hooks/useFunctionManagement.ts`

**hook API 设计**:
```ts
function useFunctionManagement(data: MathVisualData, onChange: (d: MathVisualData) => void) {
  return {
    // CRUD
    addFunction: (expr: string) => void;        // 内部 detectPlotType + 提取参数
    updateFunction: (id: string, updates: Partial<FunctionEntry>) => void;
    removeFunction: (id: string) => void;
    updateParameter: (name: string, value: number) => void;
    insertFromHelp: (expr: string) => void;     // 兼容 help-panel
    // 派生数据
    fns: FunctionEntry[];
    parameters: Parameter[];
    // 当前所有 fn 编译后的求值结果(供画板和工具消费)
    compiledFns: CompiledFn[];
    curves: Curve[];
  };
}
```

hook 内部统一实现 displayExpression / detectPlotType / extractParameters / 隐式方程 / curves[] 拼装等。

Phase 2 完成后:
- LeftPanel 改用 `useFunctionManagement` 替代自己写的 `updateFunction/addFunction/...`
- inline `MathVisualComponent` **暂时不动**(PR4 才迁)
- 全屏内部 FunctionCard 仍是旧 inline-editing 实现 — 下一阶段改

**commit 提示**: `refactor(math-visual): 抽 useFunctionManagement hook 统一函数 CRUD`

#### Phase 3 — 拆区块组件
**目标**: LeftPanel 拆成可复用区块,inline 未来能挑用其中一部分。

**新建文件**(都在 `fullscreen/sections/` 子目录):
- `FunctionListSection.tsx` — 函数列表 + 添加按钮(走 ExpressionDialog) + 点击行编辑(走 ExpressionDialog)
- `ParametersSection.tsx` — 参数滑块 + 动画播放(动画当前在 LeftPanel 内,移过来)
- `ToolbarSection.tsx` — 7 件工具按钮(移动 / 框选 / 标注 / 切线 / 法线 / 积分 / 极值)
- `ExportSection.tsx` — PNG / SVG 导出三按钮
- `TitleSection.tsx` — 标题输入(如果有)

每个 section 接收 hook 返回值 + 必要回调 props,**不再持有自己的状态副本**。

LeftPanel.tsx 改造为"组合 sections":
```tsx
function LeftPanel({ data, onChange, ...全屏专属 props }) {
  const fnMgmt = useFunctionManagement(data, onChange);
  return (
    <div className="mv-fullscreen-left">
      <FunctionListSection {...fnMgmt} />
      <ParametersSection {...fnMgmt} animating={...} onStartAnimation={...} />
      <ToolbarSection toolMode={...} onToolChange={...} />
      <ExportSection onExport={...} onExportSvg={...} />
    </div>
  );
}
```

**FunctionListSection 必须复用 ExpressionDialog** — 不要重写"添加函数 modal"。Dialog 组件已经在
`src/drivers/text-editing-driver/blocks/math-visual/components/ExpressionDialog.tsx`(从 PR2 搬过来,
也可以 Phase 1 时一并搬到 main)。

**commit 提示**: `refactor(math-visual): 全屏 LeftPanel 拆为 sections + 复用 ExpressionDialog`

#### Phase 4 — 全屏功能验证 + 隐式方程接通
**目标**: 全屏面板使用统一架构后,验证所有 V1 功能不退化 + 隐式方程也能在全屏里画。

**验证清单**(每条都要测,这是回归面):
- 全屏 8 工具(移动/框选/标注/切线/法线/积分/极值/导出) 全部仍可用
- 动画播放/暂停 — 参数变化时画板更新
- 函数添加(走 ExpressionDialog)、编辑(走 ExpressionDialog)、删除、可见性切换、颜色 popover
- 隐式方程 `x^2+y^2=1` 全屏内能添加 + 显示
- 参数滑块 `a*x^2+b*y^2=1` — a/b 滑块出现
- y-of-x 导数按钮按 plotType 隐藏(implicit/parametric/polar/vertical-line 不显示)
- 全屏退出后回到 inline,inline 仍是 main 行为(不要 PR4 提前迁)

#### Phase 5 — 收尾
- 类型检查 `npx tsc --noEmit -p .` 零错
- 跑 `npm start` 手动验证全套清单
- **写一份测试清单给用户**(逐项操作 + 期望结果,见 [[feedback_implementation_test_checklist]])
- **等用户验证 OK 后再请求 commit + merge + push**
- 更新 MEMORY.md 加 `project_math_visual_pr3_done.md` 记录:hook API / sections 目录结构 / PR4 注意事项

### 4.3 不要做的事

- ❌ **不要碰 inline `MathVisualComponent.tsx`** — PR4 才迁。Phase 4 应保证 inline 仍是 main 行为(隐式不可用 / 没有 ExpressionDialog / 旧 FunctionRow inline editing)
- ❌ **不要 cherry-pick PR2 commit** — PR2 commit 含 inline 改动会污染 main 的 inline。手动 apply capability 部分,driver 部分按 Phase 2/3 重新设计
- ❌ **不要做 label 拖动** — PR2 用户已确认不要(默认位置算法即可)
- ❌ **不要合并到 main 之前自作主张** — 每个 phase commit 后等用户验证。最终 merge 必须用户显式确认

---

## 5. 验证 + 收尾标准

### 5.1 类型检查
```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
npx tsc --noEmit -p . 2>&1 | grep -E "(math-rendering|math-visual)" | head -10
# 输出为空 = 通过
```

### 5.2 测试清单格式(Phase 5 给用户)
```
| # | 操作 | 期望结果 |
|---|------|---------|
| 1 | 全屏入口:点 ⛶ 按钮 | 进入全屏 |
| 2 | 全屏内点 + 添加函数 | 弹 ExpressionDialog... |
| ... | ... | ... |
```

要覆盖:
- 全屏 8 工具回归
- 动画
- 函数 CRUD(ExpressionDialog)
- 隐式方程
- 参数滑块
- inline 不退化(切回 inline 后仍是旧行为)
- L2 fullscreen overlay 出入切换正常

### 5.3 commit 提交规范
对齐项目 CLAUDE.md 风格:
```
refactor(math-visual): <短描述>

- 改动 1
- 改动 2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### 5.4 Memory 记录
PR3 完成后写 `project_math_visual_pr3_done.md`:
- hook 路径 + API + 内部职责
- sections/ 目录结构 + 各 section 边界
- 几个偏离 / 难点 / 教训
- PR4 需要注意什么(inline 复用哪些 section、保留什么独有逻辑、紧凑 hover 布局策略)

---

## 6. 开始前快速对齐(给新对话用户)

新对话第一句给用户的话(参考):

> 我读完了 docs/tasks/math-visual-pr3-fullscreen-refactor-prompt.md。
> 计划五阶段:Phase 1 capability 端补齐(从 PR2 参考分支搬实现)→ Phase 2 抽 useFunctionManagement hook → Phase 3 拆 sections → Phase 4 隐式 + 回归验证 → Phase 5 收尾。
> 每个 phase 单独 commit,等你验证后才下一个 phase。最终 merge 需要你显式 OK。
>
> 现在开始 Phase 1 (capability 端搬隐式方程支持)。先看 PR2 分支的 capability 改动:
> `git diff main feature/math-visual-implicit -- src/capabilities/math-rendering/`

然后用户回复"好"或具体指示后再动手。

---

## 7. 参考文件路径速查

| 角色 | 路径 |
|---|---|
| inline 入口 | `src/drivers/text-editing-driver/blocks/math-visual/MathVisualComponent.tsx` |
| inline 函数行(PR2 已改) | `src/drivers/text-editing-driver/blocks/math-visual/components/FunctionRow.tsx` |
| PR2 dialog | `src/drivers/text-editing-driver/blocks/math-visual/components/ExpressionDialog.tsx`(在 PR2 分支) |
| 全屏 shell | `src/drivers/text-editing-driver/blocks/math-visual/fullscreen/MathVisualFullscreenPanel.tsx` |
| 全屏左栏(主战场) | `src/drivers/text-editing-driver/blocks/math-visual/fullscreen/LeftPanel.tsx` |
| 全屏右栏 | `src/drivers/text-editing-driver/blocks/math-visual/fullscreen/RightPanel.tsx` |
| capability 主入口 | `src/capabilities/math-rendering/index.ts` |
| MathHost(渲染) | `src/capabilities/math-rendering/host/MathHost.tsx` |
| plotType 检测 | `src/capabilities/math-rendering/compute/plot-detect.ts` |
| evaluator | `src/capabilities/math-rendering/compute/evaluator.ts` |
| marching squares(PR2 新文件) | `src/capabilities/math-rendering/compute/marching-squares.ts`(在 PR2 分支) |
| PM NodeView | `src/drivers/text-editing-driver/blocks/math-visual/node-view.ts` |
| 类型 | `src/drivers/text-editing-driver/blocks/math-visual/types.ts` |
| CSS | `src/drivers/text-editing-driver/pm-host.css`(搜 `mv-` 前缀) |

---

**Good luck.** 严格按阶段推进,每步等用户验证。
