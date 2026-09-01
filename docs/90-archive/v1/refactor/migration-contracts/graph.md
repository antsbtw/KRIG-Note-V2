# graph 插件功能契约（迁移基准）

> **版本**：v0.1（草稿，待用户 review 后定版为 v1.0）
> **建档日期**：2026-05-02
> **基线 commit**：`41792aff feat(graph/canvas): F-10 文本节点垂直对齐(top/middle/bottom)`
> **覆盖范围**：`src/plugins/graph/` 全部目录 + 关联的 `src/main/` IPC handlers
> **数据来源**：git log 中所有 `feat(graph/*)` / `fix(graph/*)` commit + memory 中所有 graph/canvas 相关 feedback/project 条目

---

## § A. 已验证的功能点

> **每条都是"明确可指向某段代码 + 用户已确认 work 的特性"**
> **审计员要求**：grep 关键代码标识能在新 PR 中找到对应实现

### A1 系列：M1.x 基础几何与变换
- **A1.1** 实例旋转（`Instance.rotation` 字段 + outer/inner 嵌套实现 bbox 中心旋转）
  - 来源：commit `9881338e` M1.x.1
  - 关键代码标识：grep `rotation` in `src/plugins/graph/canvas/`，`Instance.rotation` 字段
- **A1.2** ResizeHandlesOverlay 渲染（8 点 + 旋转 handle）
  - 来源：commit `31c8d2ed` M1.x.2
  - 关键代码标识：`ResizeHandlesOverlay`
- **A1.3** handles 拖动 + OBB hit-test + undo/redo
  - 来源：commit `93aa3dcf` M1.x.3 + 4 + 6
  - 关键代码标识：`OBB` 命中测试函数；undo 栈管理
- **A1.4** Deserialize 清洗异常 size/position（防御历史脏数据）
  - 来源：commit `a023f87b` M1.x.4
  - 关键代码标识：grep 反序列化路径中的 size/position 校验代码
- **A1.5** Magnet 旋转跟随
  - 来源：commit `a0f59bef` M1.x.5
  - 关键代码标识：magnet 旋转关联逻辑
- **A1.6** Line 连接线 press-drag-release 交互
  - 来源：commit `b6c3e4e9` M1.x.7
  - 关键代码标识：line 创建的 press-drag-release 状态机
- **A1.7** Line rewire + hit-test + hover 高亮
  - 来源：commit `b88ba7ac` M1.x.7b
  - 关键代码标识：line 重连接逻辑
- **A1.8** 单指框选 + 双指 pan/pinch zoom
  - 来源：commit `ff34ce74` M1.x.9
  - 关键代码标识：手势识别状态机
- **A1.9** 右键 ContextMenu + line 参与 Combine
  - 来源：commit `5f2c3845` M1.x.10
  - 关键代码标识：ContextMenu 触发；Combine 函数

### A2 系列：M2 文字与 Sticky 节点
- **A2.1** 文字节点完整闭环（M2.1 主线）
  - 来源：commit `3bb02e9b`
  - 关键代码标识：文字节点 PM 编辑器实例创建/销毁
- **A2.2** 编辑期隐藏 mesh + wrap + 对齐 + 颜色 + 共享 icons（M2.1.6abc）
  - 来源：commit `49209dcd`
  - 关键代码标识：编辑态切换时 mesh 隐藏逻辑；wrap 字段
- **A2.3** Inline 链接 5 协议路由到 right slot（M2.1.6d）
  - 来源：commit `c1195ffc`
  - 关键代码标识：链接点击协议路由
- **A2.4** 文字节点 handle 收紧 + 重启文字渲染白屏修复（M2.1.6a）
  - 来源：commit `23ae3c5a`
  - 关键代码标识：handle bbox 计算；重启时文字渲染初始化
- **A2.5** 渲染态行内链接（视觉 + 点击，F-6）
  - 来源：commit `769b2bff` M2.1.8
  - 关键代码标识：渲染态链接点击 hitTest
- **A2.6** Sticky 文字节点带背景（M2.2 单对象路线）
  - 来源：commit `58106116`
  - 关键代码标识：Sticky 单对象实现
- **A2.7** Sticky 渲染缺陷修补
  - 来源：commit `68f8c0fc`
  - 关键代码标识：Sticky 渲染相关 fix

### A3 系列：F-* 编号特性
- **A3.1** F-1 点阵网格底 + size_lock（Freeform 风格视觉锚点）
  - 来源：commit `91e77ea4` + `a8380a11` + `9f746a69`
  - 关键代码标识：dot grid 渲染；`size_lock` 字段
- **A3.2** F-9 Sticky 颜色调色盘（右键菜单 + Color 子菜单）
  - 来源：commit `7071f713` + `48fda74b`
  - 关键代码标识：ContextMenu 中的 Color 子菜单；Sticky 颜色字段
- **A3.3** F-10 文本节点垂直对齐（top/middle/bottom）
  - 来源：commit `41792aff`（基线）
  - 关键代码标识：vertical alignment 字段；渲染时的对齐计算
- **A3.4** F-11 EditOverlay popup zoom/pan 同步（含编辑态清 selection 解决"虚框分离"幻象）
  - 来源：commit `fab75f4d` + `b5d4db90`
  - 关键代码标识：EditOverlay 投影同步；编辑态进入时清 selection
- **A3.5** Hit-test / popup 位置与渲染共享投影（zoom 后视觉精准对齐）
  - 来源：commit `8f2f3467`
  - 关键代码标识：投影计算函数（hit-test 与渲染共用）

### A4 系列：Substance / Library
- **A4.1** Substance scale + Line2 fat lines + Inspector substance 模式
  - 来源：commit `bd6cb631`
  - 关键代码标识：Substance scale 处理；Line2 渲染
- **A4.2** Library 公式求值 params/guides 优先于 builtin
  - 来源：commit `4e1c715b`
  - 关键代码标识：`src/plugins/graph/library/` formula-eval 解析逻辑

### A5 系列：状态持久化
- **A5.1** 重启恢复上次打开的画板（activeGraphId 持久化）
  - 来源：commit `91e588c6`
  - 关键代码标识：`activeGraphId` 字段持久化与恢复
  - **注意**：本特性涉及 `WorkspaceState.activeGraphId` —— 波次 5 会迁到 `pluginStates`，但波次 3 迁移期间**保持现状**

### A6 系列：选区与 Inspector
- **A6.1** 选区清空时关 Inspector
  - 来源：commit `b3b33624`
  - 关键代码标识：selection 清空触发 Inspector 关闭

---

## § B. 已知陷阱清单

> **所有来自 memory 的"血泪教训"——迁移时这些防御代码不能丢**

- **B1** Three.js `setSize` 第三参数必须传 `true`
  - memory: `feedback_threejs_retina_setsize`
  - 防御代码标识：grep `setSize.*true` 或 `setSize\(.*,.*,\s*true\)`
  - 失守后果：Retina 屏 canvas DOM 撑成 2 倍 CSS 像素超出容器，画布只显示一部分

- **B2** 画布必须完整显示内容（fitToContent 是底线）
  - memory: `feedback_canvas_must_show_all_content`
  - 防御代码标识：grep `fitToContent` 调用点；新增几何体后必须主动 fit
  - 失守后果：用户看不到刚创建的内容

- **B3** fitToContent 必须防御 NaN/Infinity box
  - memory: `feedback_fitcontent_nan_defense`
  - 防御代码标识：grep `Number.isFinite` 在 box 4 分量上的检查
  - 失守后果：SVG label 退化几何返回 NaN box → frustum NaN → 画面空白

- **B4** 画布容器 div 必须始终渲染
  - memory: `feedback_canvas_container_must_always_render`
  - 防御代码标识：CanvasView 中容器 div 不应被 empty/canvas 状态切换
  - 失守后果：ref.current 时机错过 → mount 永远不跑 → 画板黑屏

- **B5** Sticky 单对象路线（不是双对象方案）
  - 来源：M2.2 决议
  - 防御代码标识：Sticky 创建时是单一 mesh + 背景色字段，不是 mesh + bg-mesh 组合
  - 失守后果：拖拽/旋转时背景与文字脱节

- **B6** Deserialize 必须清洗历史脏数据
  - 来源：A1.4
  - 防御代码标识：反序列化路径中对 size 异常值（NaN / 0 / 负数）的 fallback
  - 失守后果：旧画板打开后节点错乱

- **B7** Line2 用于 fat lines（非默认 Line）
  - 来源：A4.1
  - 防御代码标识：grep `Line2` 或 fat line 渲染相关
  - 失守后果：缩放时线宽不正确

- **B8** Library formula-eval 优先级（params/guides 优先于 builtin）
  - 来源：A4.2
  - 防御代码标识：formula-eval 解析顺序代码
  - 失守后果：用户自定义参数被 builtin 覆盖

---

## § C. 验收清单

> **迁移完成时必须手测过的场景**。每条覆盖至少一个 § A 特性 + 任何 § B 中"用户能感知"的陷阱。

### C1：基础渲染与显示
- [ ] **C1.1** 打开 graph 文件，画布**完整显示**所有内容（验证 B1 + B2）
- [ ] **C1.2** Retina 屏（MacBook 自带屏）下画布尺寸正确，无右下角空白（验证 B1）
- [ ] **C1.3** 新建一个节点后画板自动 fit，节点位于视野中央（验证 B2）
- [ ] **C1.4** 重启应用后自动打开上次打开的画板（验证 A5.1）
- [ ] **C1.5** 切换 NavSide 折叠/展开后画布不黑屏、不变形（验证 B4）

### C2：节点几何与变换
- [ ] **C2.1** 创建矩形/圆，拖动 8 个 resize handle 改变尺寸正确（验证 A1.2 + A1.3）
- [ ] **C2.2** 拖动旋转 handle，节点绕 bbox 中心旋转（验证 A1.1）
- [ ] **C2.3** Magnet 跟随旋转角度正确（验证 A1.5）
- [ ] **C2.4** 单指框选 / 双指 pan / pinch zoom 各自工作正常（验证 A1.8）
- [ ] **C2.5** 撤销/重做（cmd+Z / cmd+shift+Z）一系列操作正确（验证 A1.3）

### C3：Line 连接线
- [ ] **C3.1** 从一个节点拖到另一个节点创建 line（press-drag-release）（验证 A1.6）
- [ ] **C3.2** 已有 line 拖动端点重连到新节点（rewire）（验证 A1.7）
- [ ] **C3.3** Hover 经过 line 时高亮（验证 A1.7）
- [ ] **C3.4** Line 缩放时线宽不变形（fat lines，验证 B7）

### C4：文字节点
- [ ] **C4.1** 双击空白处 / 已有节点进入文字编辑态，IME 中文输入不抖动（验证 A2.1 + memory `fix_noteview_jitter`）
- [ ] **C4.2** 编辑态时下方 mesh 隐藏，仅显示 PM 编辑器（验证 A2.2）
- [ ] **C4.3** 编辑态切回渲染态，链接可点击且路由正确（验证 A2.5 + A2.3）
- [ ] **C4.4** 文字节点垂直对齐切换 top/middle/bottom 显示正确（验证 A3.3）
- [ ] **C4.5** 重启应用后文字节点立即正确渲染（无白屏）（验证 A2.4）

### C5：Sticky 节点
- [ ] **C5.1** 创建 Sticky，背景色与文字共同位移/旋转（验证 A2.6 + B5）
- [ ] **C5.2** Sticky 右键菜单 → Color 子菜单选色生效（验证 A3.2）
- [ ] **C5.3** Sticky 渲染无视觉缺陷（验证 A2.7）

### C6：右键菜单与编辑 Overlay
- [ ] **C6.1** 节点上右键弹出 ContextMenu，菜单项可正常触发（验证 A1.9）
- [ ] **C6.2** Combine 操作（含 line 参与）正确（验证 A1.9）
- [ ] **C6.3** 进入编辑态后 selection 自动清空（不出现"虚框分离"幻象）（验证 A3.4）
- [ ] **C6.4** zoom/pan 后 EditOverlay popup 位置准确，无错位（验证 A3.4 + A3.5）
- [ ] **C6.5** 选区清空时 Inspector 自动关闭（验证 A6.1）

### C7：底层视觉
- [ ] **C7.1** 点阵网格底正确显示（F-1）（验证 A3.1）
- [ ] **C7.2** size_lock 字段下节点不可改尺寸（验证 A3.1）

### C8：Library / Substance
- [ ] **C8.1** Substance 创建 + Inspector 切换到 substance 模式正常（验证 A4.1）
- [ ] **C8.2** Library 公式中自定义 params/guides 覆盖 builtin（验证 A4.2 + B8）

### C9：脏数据防御
- [ ] **C9.1** 用旧版本创建的画板（含异常 size/position 数据）打开后节点正常（验证 B6 + A1.4）

---

## § D. 不在本契约覆盖范围（声明）

> 以下功能点**不在本次迁移期间检查**，避免 Auditor 误判

- **D1** F-12 共享 ContextMenu 注册框架（commit `2f3a4149` 仅 backlog 文档，未实施代码）—— 这正是本次重构本身要做的事
- **D2** Graph labels 分支保留（memory `project_graph_labels_branch_kept`）—— SVG label 实现未充分验证，故意保留旧 ProseMirror 分支作对照，本契约不要求其工作
- **D3** WorkspaceState 中 `activeGraphId` 字段架构债（memory `project_active_resource_id_arch_debt`）—— 波次 5 处理，本次迁移保持现状
- **D4** F-7 字号/字体切换（commit `5e1d3962` 已 P2 延后）

---

## § E. Review 待补清单（草稿状态）

> **以下条目需要用户 review 时确认/补充**，定版前必须清空

- [ ] E1. 上述 § A 列表是否遗漏了用户已验证但未在 git log/memory 显式登记的特性？
- [ ] E2. § B 中 B5（Sticky 单对象路线）的具体技术细节标识是否需要补充更精确的 grep 关键词？
- [ ] E3. § C 验收清单的具体操作步骤是否需要更细化（如"如何触发 magnet"等具体路径）？
- [ ] E4. § A5.1（activeGraphId）与 § D3 的关系——是否在 Step A 阶段允许保留，Step B 也保留，等波次 5 统一处理？
- [ ] E5. 是否需要补充 NavSide（`src/plugins/graph/navside/`）相关的功能点？当前列表偏重 canvas/

---

**契约定版后**：删除 § E、把 v0.1 改为 v1.0、commit 锁定。
