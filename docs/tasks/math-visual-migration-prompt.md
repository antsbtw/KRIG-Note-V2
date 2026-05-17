# 新对话提示词:V1 → V2 迁移 math-visual(交互式函数图 Block)

> 整段复制粘贴给新对话的 Claude(在 V2 工作目录 `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2` 启动新对话后)。

---

请把 V1 的 `math-visual` 子模块完整迁移到 V2,保持它是独立 PM 节点(name=`mathVisual`),交互能力等价于 V1。**Mafs + mathjs SDK 走新建 `math-rendering` capability 单点屏障**(对齐 `code-editing` capability 模式);全屏走 L2 FullscreenOverlay 体系**独立 id + 独立 Component**(共用机制,不共用 id)。

## 这是什么

V1 `math-visual` 是一个**交互式函数图 Block**:用户在 PM doc 内插入一块画布,定义函数 `f(x) = x^2`,画布实时绘出曲线;支持多函数、参数滑块、关键点标注、切线/法线/积分/特征点(全屏模式)、滚轮缩放 + 拖拽平移、可选坐标轴样式。

不是数学公式渲染(那是 `math-block` / `math-inline`,已迁完);**math-visual 是函数 → 曲线**,介于 GeoGebra 简化版 + Desmos 之间。

## V1 文件位置

V1 绝对路径:`/Users/wenwu/Documents/VPN-Server/KRIG-Note/src/plugins/note/blocks/math-visual/`

| V1 文件 / 子目录 | LOC | 作用 |
|---|---|---|
| `index.ts` | 79 | BlockDef + nodeSpec(attrs + parseDOM/toDOM)+ slashMenu 注册 |
| `types.ts` | 189 | 数据类型(FunctionEntry / Parameter / Annotation / TangentLine / NormalLine / IntegralRegion / FeaturePoint / CanvasConfig / AxisConfig / MathVisualData)+ 默认值 + 色板 |
| `view.ts` | 127 | PM NodeView 工厂(React createRoot 桥接 + PM ↔ React 双向同步 + atom 节点 stopEvent / selectNode / destroy) |
| `MathVisualComponent.tsx` | 404 | 主组件(inline)— Mafs 画布 + 函数管理 + 参数滑块 + 标注 + 全屏按钮 + Settings 面板 |
| `latex-to-mathjs.ts` | 436 | LaTeX 公式 → mathjs 表达式转换 + 函数定义域端点提取 |
| `utils.ts` | 186 | 数学辅助(createEvalFn / detectDiscontinuities / buildSegments / extractParameters / detectPlotType / numericalDerivative) |
| `components/` | ~1000 | 9 个子组件:SmartGrid / FunctionRow / ParameterSlider / RangeInput / InlineEndpoints / FullscreenErrorBoundary / SettingsPanel / KaTexHelpers / StylePopover |
| `fullscreen/MathVisualFullscreen.tsx` | 790 | 全屏主组件(左右双面板 + 9 类工具) |
| `fullscreen/LeftPanel.tsx` | 351 | 左面板:函数列表 / 参数面板 / 标注列表 |
| `fullscreen/RightPanel.tsx` | 364 | 右面板:工具切换 + 选中元素属性编辑 |
| `fullscreen/shared.tsx` | 343 | 全屏共享 UI |
| `fullscreen/math-utils.ts` | 192 | 数学计算(导数 / 积分 / 极值检测) |
| `fullscreen/tools/` | ~800 | 9 个工具:AnnotationTool / TangentTool / NormalTool / IntegralTool / FeatureTool / RiemannTool / EndpointMarkers / HoverCoords / LegendOverlay |

**总规模:~3500 LOC**(直迁后可能减;不要为减而硬减,**功能等价优先**)。

## V1 外部依赖

| 依赖 | V1 版本 | V2 状态 | 行动 |
|---|---|---|---|
| `mafs` | `^0.21.0` | **未装** | `npm i mafs@^0.21.0`(画布核心,无替代) |
| `mathjs` | `^15.2.0` | **未装** | `npm i mathjs@^15.2.0`(表达式求值) |
| `mafs/core.css` | (随 mafs) | 未装 | 跟着 mafs 进来,在 capability Host 内 import 一次 |
| `katex` | `^0.16.44` | **已装** `^0.16.45` | 复用,无需补 |

**V1 还引了 `../../help-panel/math-visual` 的 `showMathVisualPanel`** — V2 help-panel 体系已迁(`src/slot/interaction-registries/help-panel-registry/`),**迁完后调用走 V2 registry,不直 import V1 path**(`help-panel-types.ts:13` 已 mark "math-visual 待迁")。

## V2 现状(任务起点)

- **V2 atom-serializer 已留占位**:`src/lib/atom-serializers/svg/index.ts:203` 有 `case 'mathVisual': return '[Diagram]'`。功能完全未迁。
- **V2 math-block / math-inline 已迁**(纯 KaTeX 渲染),跟 math-visual 是不同节点。V1 的 `sourceLatex` / `sourceAtomId` 字段是为"mathBlock 公式拖入 math-visual"准备的,本任务 Phase 3 可评估,**第一版可暂不接 UI 入口,字段保留即可**。
- **L2 FullscreenOverlay 已有**(memory `project_l2_fullscreen_overlay_done`):`fullscreenOverlayRegistry` + `fullscreenOverlayController` + L2 Binding。code block 的 `text-editing.fullscreen.code` overlay id 已注册 CodeFullscreenPanel(参考实现,**不要复用此 id**)。
- **`text-editing` capability 已存在**:`src/capabilities/text-editing/`(已注册 PM commands / slash menu items / fullscreen-overlays)— math-visual 的 overlay 注册、slash menu 项、命令都加进 text-editing capability(对齐 mermaid / code 已有模式)。
- **同型 SDK capability 样板**:`src/capabilities/code-editing/`(CM6 单点屏障,Phase 1A 已合 main `64eefbe`)— `math-rendering` 完全照搬其结构。

## 任务关键决议

### D1 — Mafs + mathjs 走新建 `math-rendering` capability(SDK 单点屏障)

**对齐 `feedback_sdk_version_binding_policy`** + `code-editing` capability 模式。

`src/capabilities/math-rendering/` 目录结构(参考 `src/capabilities/code-editing/`):

```
src/capabilities/math-rendering/
├── README.md
├── index.ts                     capability 注册 + 模块级 export
├── types.ts                     对外类型(MathRenderingApi / MathHostProps / 等)0 import mafs/mathjs
├── host/
│   ├── MathHost.tsx             Mafs 画布 React Host(把 Mafs 内部所有 import 收敛在此)
│   └── mafs-style.ts            mafs/core.css 一次性 import + 任何自定义样式覆盖
└── compute/
    ├── evaluator.ts             createEvalFn / extractParameters / numericalDerivative(走 mathjs)
    ├── discontinuity.ts         detectDiscontinuities + buildSegments
    ├── latex-converter.ts       LaTeX → mathjs(从 V1 latex-to-mathjs.ts 直迁)
    └── plot-detect.ts           detectPlotType(y-of-x / vertical-line / parametric / polar)
```

**对外 API(types.ts)**:

```ts
export interface MathRenderingApi {
  Host: ComponentType<MathHostProps>;              // 画布 React Host
  evaluate(expression: string, scope: Record<string, number>): number;  // mathjs 单点求值
  createEvalFn(expression: string): (x: number, scope?: Record<string, number>) => number;
  extractParameters(expression: string): string[];
  numericalDerivative(fn: (x: number) => number, x: number, h?: number): number;
  detectDiscontinuities(fn: (x: number) => number, domain: [number, number], step: number): number[];
  buildSegments(fn: (x: number) => number, domain: [number, number], discontinuities: number[]): Segment[];
  detectPlotType(expression: string): { plotType: PlotType; expression: string };
  latexToMathjs(latex: string): { expression: string; endpoints?: EndpointInfo[] };
}
```

**ESLint 屏障**(完成本任务时**必须新增**到 `eslint.config.js`,对齐 `@codemirror/*` 屏障):

```js
// driver / view / 其他 capability 禁止直 import mafs / mathjs,走 requireCapabilityApi('math-rendering')
{ group: ['mafs', 'mafs/*'], message: 'Mafs 单点屏障:driver/view 禁直 import mafs,走 capability' }
{ group: ['mathjs'], message: 'mathjs 单点屏障:同上' }
// 例外:src/capabilities/math-rendering/ 内允许 import
```

**注意**:capability `Host` 不是 Mafs 组件的 1:1 包装 — V1 `MathVisualComponent.tsx` 用了 Mafs 的多个原始组件(`Mafs / Plot / Point / Line` + SmartGrid 自定义子组件)。capability 的 `MathHost` 应该接受**配置数据**(函数列表 / domain / range / canvas 配置 / 标注 / 工具叠加项),内部决定如何拼装 Mafs 元件;driver 侧只传"画什么",capability 内决定"怎么画"。具体 API shape 在 Phase 1 实施时确定 — 这是 **doc 没说清的设计点,新对话必须先停下问用户**。

### D2 — 全屏走 L2 体系,独立 overlay id

- 注册 overlay id `text-editing.fullscreen.math-visual` 到 `src/capabilities/text-editing/ui/fullscreen-overlays.ts`
- Component 独立:`MathVisualFullscreenPanel`(不复用 `CodeFullscreenPanel`)
- 共用 L2 机制:`fullscreenOverlayRegistry.register` + `fullscreenOverlayController.show` + L2 Binding
- 模式对齐 code-block 全屏:`menu-context.ts` 存 `MathVisualFullscreenContext = { instanceId, nodePos }`;Panel mount 时 `getCtx` 拿数据,unmount cleanup 走 `lastValueRef` 写回 PM(memory `feedback_react_unmount_child_cleanup_order`)

### D3 — driver 内 math-visual block 仍是独立 PM 节点

`src/drivers/text-editing-driver/blocks/math-visual/` 内含:
- `spec.ts` — PM nodeSpec(BlockSpec)
- `node-view.ts` — React createRoot 桥接 PM(参考 V1 view.ts)
- `MathVisualComponent.tsx` — inline 主组件(消费 `requireCapabilityApi('math-rendering').Host`)
- `components/` — 子组件(FunctionRow / ParameterSlider / RangeInput / InlineEndpoints / SettingsPanel / StylePopover / KaTexHelpers / FullscreenErrorBoundary)— 这些**不用 Mafs / mathjs 直 import**,只组合 UI;数学计算走 capability
- `fullscreen/` — 全屏 Panel + LeftPanel / RightPanel / shared / tools(消费同一 capability Host)

driver 内 0 import `mafs` / `mathjs`,全走 capability。

## 任务范围与 Phase 拆分

**做"完整 math-visual 迁移"**,分 4 个 Phase 让 commit 粒度可控。

### Phase 1A — `math-rendering` capability(SDK 屏障)
**分支**:`feature/math-rendering-capability`

- 装 SDK:`npm i mafs@^0.21.0 mathjs@^15.2.0`(commit lock 文件)
- 建 `src/capabilities/math-rendering/` 目录 + index.ts + types.ts
- 迁 V1 `utils.ts` + `latex-to-mathjs.ts` → capability `compute/` 子目录(改成 export 函数,内部 import mathjs;不在 driver 暴露)
- 实现 `MathHost` 组件(把 Mafs 画布封装,接受 props.data = MathVisualData;onChange 回写)
- 在 `eslint.config.js` 加 `mafs` / `mathjs` 屏障(driver / view / 其他 capability 禁 import,capability 内允许)
- typecheck + lint 全绿;capability 独立可测(写最小 demo:capability 内一个 dev page 验 Host 渲个 x² 即可,合 main 前删 dev page)

**Phase 1A commit 后测试清单**:capability 注册成功 / Host 能 render Mafs 画布 / 函数表达式求值正确(写小段测试代码或 dev page 验)

### Phase 1B — Inline NodeView(无全屏,功能 60%)
**分支**:`feature/math-visual-inline`(从 Phase 1A 子分支合到总分支 `feature/math-visual` 后切)

- 建 `src/drivers/text-editing-driver/blocks/math-visual/` 目录
- 迁 `types.ts` 到 driver(纯类型,无 SDK 依赖;driver 用)
- 迁 V1 `components/` 各子组件(参考 V1 components/ 内 9 个组件;0 import Mafs / mathjs)
- 迁 V1 `MathVisualComponent.tsx` → 消费 `requireCapabilityApi('math-rendering').Host`(把 Mafs 渲染委托给 capability;component 只管状态 + 子组件组合)
- 迁 V1 `view.ts` → `node-view.ts`(React createRoot 桥接 PM,**全屏按钮先 disable 占位**,Phase 2 启用)
- 迁 V1 `index.ts` → `spec.ts`(BlockSpec)+ 注册到 driver blocks index
- slashMenu 注册:命令 `text-editing.slash-insert-math-visual` + driver api `insertMathVisualAtSelection` + menu 项 "Function Graph" 📈
- typecheck + lint 全绿,inline 画布可见、函数可编辑、参数滑块可拖、标注可加

**Phase 1B commit 后测试清单**:slash 插入 / 默认 x² 曲线绘出 / 改表达式实时刷新 / 添函数 / 删函数 / 调参数滑块 / 加标注 / 改坐标范围 / 改画布高度 / Settings 切坐标轴 / 角度单位 / 拖拽 + 滚轮缩放 / 复制粘贴 doc 内 math-visual / undo redo / 其他 block(mermaid / code / image 等)无回归

### Phase 2 — Fullscreen 全屏体系(交互工具,功能 95%)
**分支**:`feature/math-visual-fullscreen`(从总分支切)

- 迁 V1 `fullscreen/` 全部:MathVisualFullscreen / LeftPanel / RightPanel / shared / math-utils
- 迁 V1 `fullscreen/tools/` 9 件:AnnotationTool / TangentTool / NormalTool / IntegralTool / FeatureTool / RiemannTool / EndpointMarkers / HoverCoords / LegendOverlay
- 改造为 V2 L2 体系:
  - 注册 overlay id `text-editing.fullscreen.math-visual` 到 `src/capabilities/text-editing/ui/fullscreen-overlays.ts`
  - 新增 `src/drivers/text-editing-driver/blocks/math-visual/fullscreen/menu-context.ts`(`MathVisualFullscreenContext = { instanceId, nodePos }`,模式对齐 `code-block/fullscreen/menu-context.ts`)
  - inline 全屏按钮启用 → `setMathVisualFullscreenContext(...)` + `fullscreenOverlayController.show('text-editing.fullscreen.math-visual')`
  - Panel cleanup 用 `lastValueRef` 写回 PM(memory `feedback_react_unmount_child_cleanup_order`)
- `fullscreen/math-utils.ts` 内的计算函数若涉及 mathjs,**移到 capability `compute/`**;driver 只调 API
- 9 类工具内的画布元素仍走 Mafs(`<Point />` `<Line />` 等),但 import 收敛在 capability(若 V1 工具内直 import Mafs 组件,需重设计:capability `MathHost` 接受 `tools={ tangent: [{...}], normal: [...] }` 形式的配置,内部生成对应 Mafs 子元素)— **这是 Phase 2 实施时的关键设计点,先停下问用户**

**Phase 2 commit 后测试清单**:全屏按钮打开 overlay / 切线工具点切点产生切线 / 法线 / 积分区间显示 + 数值 / 特征点自动检测 + 手动加 / Riemann sum 可调 N / endpoint markers / hover 坐标提示 / legend overlay / Esc 关闭 / × 关闭 / cleanup 写回 PM / mermaid 全屏 + code 全屏不回归

### Phase 3 — help-panel(功能 100%)
**分支**:`feature/math-visual-helppanel`(从总分支切)

- help-panel 注册:走 V2 `src/slot/interaction-registries/help-panel-registry/`(`help-panel-types.ts:13` 已 mark 待迁)
- 注册 panel id 例如 `text-editing.help.math-visual`,内容对齐 V1 帮助文案
- inline `?` 按钮或全屏 `?` 按钮 → 弹 help panel
- **跨 block 拖入 mathBlock 公式**:**评估优先级**;如果 V2 没现成 block-to-block drag 抽象,本 Phase 跳过(`sourceLatex` / `sourceAtomId` 字段保留,UI 入口单独 PR 做)
- typecheck + lint 全绿

**Phase 3 commit 后测试清单**:`?` 按钮 → help-panel 显示;内容对齐 V1;无回归

## 不在范围内

- ❌ 完全重写画布渲染(不切 Mafs → Three.js 之类;Mafs 够用,Phase 4+ 才考虑)
- ❌ 跨 block 拖入 UI(如果 V2 没现成机制,Phase 3 跳过;字段数据保留)
- ❌ 服务端持久化 / 协同(Phase 4+)
- ❌ 自定义颜色 picker(用 V1 6 色 cycle)
- ❌ 公式渲染器替换(KaTeX 沿用)
- ❌ 移动端触控优化(V1 也未做)
- ❌ 共用 code-block 的 overlay id / Component(决议 D2 拍板:共用 L2 机制,独立 id + Component)

## 硬约束(对齐项目 memory)

1. **V2 是工作目录**(`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`)。所有 cwd 敏感命令每次 Bash 都显式 `cd /...V2`,不能跑到 V1。memory: `feedback_v2_is_workspace_v1_is_reference`
2. **分支策略**:4 个 Phase 4 个子分支(`feature/math-rendering-capability` / `feature/math-visual-inline` / `feature/math-visual-fullscreen` / `feature/math-visual-helppanel`),合到总分支 `feature/math-visual`(从 main 切);**合 main 必须用户显式授权**。memory: `feedback_merge_requires_explicit_ok`
3. **绝不主动 push**。任何 `git push` 都要等用户显式指令。
4. **每次 commit 后给"请验证"测试清单**(可执行的操作 + 期望结果)。memory: `feedback_implementation_test_checklist`
5. **遇到 doc 没说清的决策必须停下问**(particular:`math-rendering` capability API shape / Mafs 子组件如何收敛 / 工具系统在 capability 内的暴露形式 / help-panel API / 跨 block drag)。memory: `feedback_strict_compliance_workflow`
6. **SDK 版本绑定**:Mafs `0.21` / mathjs `15` 拍板后绑定 package.json;跨大版本升级独立 PR。memory: `feedback_sdk_version_binding_policy`
7. **React Component unmount cleanup 顺序**:全屏 Panel 内嵌 Mafs / 子 React 树 unmount 时,父 cleanup 不要走子的 imperative API(已 destroy 拿空);改用 `lastValueRef` + onChange 镜像。memory: `feedback_react_unmount_child_cleanup_order`
8. **PM atom block 防误删**:`stopEvent` 拦截 Backspace/Delete(对齐 V1 `view.ts:104-114`),只放行 ArrowUp / ArrowDown
9. **ESLint 屏障**:`mafs` / `mathjs` 屏障在 Phase 1A 同 commit 内加上;driver / view / 其他 capability 违规 import 会编译失败
10. **代码风格**:V2 的 CLAUDE.md;**不要为减 LOC 而硬减**,V1 ~3500 LOC 迁完后 V2 同量级正常,功能等价优先

## 验收(每 Phase 跑一遍)

- `npm run typecheck` 全绿
- `npm run lint` 全绿(`--max-warnings 0`,含 mafs/mathjs 屏障)
- `npm start` 启动正常
- 本 Phase 测试清单全过
- 已合 main 的功能(mermaid / codeBlock / image / audio / video / 各 list / callout / toggle 等)无回归

## V1 → V2 路径映射速查表

| V1 路径 | V2 目标路径 |
|---|---|
| `src/plugins/note/blocks/math-visual/utils.ts` | `src/capabilities/math-rendering/compute/`(拆分到 evaluator / discontinuity / plot-detect) |
| `src/plugins/note/blocks/math-visual/latex-to-mathjs.ts` | `src/capabilities/math-rendering/compute/latex-converter.ts` |
| `src/plugins/note/blocks/math-visual/types.ts` 内"渲染相关" | 部分进 `src/capabilities/math-rendering/types.ts`,部分留 driver |
| (V1 内嵌 Mafs 渲染逻辑) | 抽到 `src/capabilities/math-rendering/host/MathHost.tsx` |
| `src/plugins/note/blocks/math-visual/index.ts` | `src/drivers/text-editing-driver/blocks/math-visual/spec.ts` |
| `src/plugins/note/blocks/math-visual/view.ts` | `src/drivers/text-editing-driver/blocks/math-visual/node-view.ts` |
| `src/plugins/note/blocks/math-visual/MathVisualComponent.tsx` | `src/drivers/text-editing-driver/blocks/math-visual/MathVisualComponent.tsx` |
| `src/plugins/note/blocks/math-visual/types.ts` 内"数据相关" | `src/drivers/text-editing-driver/blocks/math-visual/types.ts` |
| `src/plugins/note/blocks/math-visual/components/*` | `src/drivers/text-editing-driver/blocks/math-visual/components/*` |
| `src/plugins/note/blocks/math-visual/fullscreen/*` | `src/drivers/text-editing-driver/blocks/math-visual/fullscreen/*` |
| `src/plugins/note/blocks/math-visual/fullscreen/math-utils.ts` | 计算部分进 `src/capabilities/math-rendering/compute/`,UI 部分留 driver |
| `src/plugins/note/help-panel/math-visual` | 走 V2 `src/slot/interaction-registries/help-panel-registry/`(Phase 3) |

## 工作流建议

1. **先完整读一遍** V1 `math-visual/` 全部源,理清模块边界(画布渲染 / 函数管理 / 工具系统 / 数据流)
2. **Phase 1A 优先停下问 capability API shape**:Mafs 子组件如何在 capability Host 内组合(尤其切线 / 法线 / 积分 / 标注等需要在 Mafs 内放 `<Line>` `<Point>` `<Plot>` 的工具叠加项)—— 这是关键设计点,提前对齐避免后期返工
3. **Phase 1A 实施按层次**:install SDK → 屏障 → capability types/index → compute/* → host/MathHost → ESLint 屏障 → 验
4. **Phase 1B 先做最小 PoC**:能 slash 插入 + 默认 x² 曲线渲出来 + 改表达式实时刷新 — 验证 capability 接通的关键里程碑
5. **Phase 2 整体先迁 fullscreen 框架**,工具一个个加 commit;memory `feedback_react_unmount_child_cleanup_order` 必须在第一个 commit 内验证 cleanup 路径
6. **Phase 3 先评估** V2 是否有 block-to-block drag 抽象,没有就 Phase 3 只做 help-panel

## 参考已有 memory

- `feedback_v2_is_workspace_v1_is_reference` — V2 是工作目录
- `feedback_merge_requires_explicit_ok` — 合 main 必须授权
- `feedback_implementation_test_checklist` — 给可执行测试清单
- `feedback_strict_compliance_workflow` — 遇问就停问
- `feedback_react_unmount_child_cleanup_order` — Mafs / React 子树 unmount cleanup 顺序
- `feedback_sdk_version_binding_policy` — Mafs / mathjs 绑定 + capability 单点屏障原则
- `feedback_decision_grep_verify_complete_propagation` — capability API 拍板前 grep 全链路确认
- `project_l2_fullscreen_overlay_done` — 全屏体系 — 本任务共用此机制
- `project_cm6_elk_capability_done` — code-editing 是同型样板 capability,可直接照搬结构
- `project_code_block_cm6_done` — mermaid CodeFullscreenPanel 是全屏 Panel 模板

## 一定要确认的事

开干前请回复确认:
- [ ] 我已完整读完 V1 math-visual 全部源(顶层 + components + fullscreen,~3500 LOC)
- [ ] 我理解 4 个 Phase 拆分(capability → inline → fullscreen → helppanel)
- [ ] 我理解 capability 单点屏障原则 + L2 共用机制独立 id 原则
- [ ] 我理解 SDK 绑定(Mafs 0.21 / mathjs 15)
- [ ] 我会在 commit 后给测试清单,合前等用户授权,不主动 push
- [ ] 我会在 doc 没说清时停下问(尤其 capability API shape / Mafs 工具叠加 / help-panel API / 跨 block drag)

如有疑问(SDK 版本兼容 / capability API 边界 / cleanup 路径 / 数据迁移 / 跨 block 入口),**先问再动手**。

---

(提示词到此结束)
