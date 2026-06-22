# 实施指令 — L5-G6 Shape 内嵌文字(PPT 模型)

> 发令人:总指挥 · 2026-06-20
> 执行人:新对话实施者 · 验收人:总指挥
> 前置:L5-G5 节点浮条已完成验收(分支 `feature/L5G5-node-floating-toolbar`,代码层通过)。本段在其之上。

---

## 0. 背景 + 一句话目标

**用户实测发现**:选中纯 shape(圆柱)浮条只出 Fill+Line,双击 shape 不能打字。查清根因——KRIG 当前是 **substance 模型**(带文字 = shape + 独立 text-label 组合),不是 PPT 模型(shape 自带文字)。**用户拍板:改成 PPT 模型。**

**目标**:**双击任意 shape → 在其 textBox 区域内打字(复用 canvas-text-node PM 编辑)→ 选中带文字的 shape,浮条出 Fill / Line / Text / Type 四项 → 改样式实时生效。**

> 这是产品模型变更(substance → PPT),不是 bug 修。范围以本 prompt 为准,实施前与总指挥确认设计文档。

---

## 1. 关键事实(已核实,省你踩点)

**好消息——文字管线/双击/textBox 都已就绪,本段是"解耦 + 放闸 + registry 加规则",非从零造:**

1. **文字渲染管线成熟**:`TextRenderer` + `atomBridge`(canvas-text-node)已能把 `instance.doc`(PM JSON)渲染成 SVG mesh,且 G5 已接好 `baseFontSize`/`fontFamily` 透传。当前**只对 `ref === 'krig.text.label'` 生效**(写死在 [NodeRenderer.ts:308](../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts#L308))。
2. **shape 自带文字区域**:`EvaluatedPath.textBox {l,t,r,b}`(已求值的世界坐标区域)**每个 shape 都有**([shape-library/types.ts:258](../../src/capabilities/shape-library/types.ts#L258));圆柱的 textBox 已避开顶部椭圆。**文字往哪放 = 白拿,不用算。**
3. **双击已拿到目标**:`InteractionController.handleDoubleClick`([:337](../../src/capabilities/canvas-rendering/interaction/InteractionController.ts#L337))已算出 instanceId + 屏幕坐标 + size。**view 端 [GraphCanvasView.tsx:250](../../src/views/graph-canvas-view/GraphCanvasView.tsx#L250) 用 `isTextNodeRef` 把非文字节点挡掉了** —— PPT 模型要放开这道闸。
4. **instance.doc 字段所有 instance 通用**(不限 text.label,[canvas-rendering/types.ts:101](../../src/capabilities/canvas-rendering/types.ts#L101))——shape 存文字无需新字段。
5. **浮条 registry 现状**:`kind==='shape'→[fill,line]` / `kind==='text'→[fill,text,type]`([node-toolbar/index.ts:57](../../src/capabilities/node-toolbar/index.ts#L57))。view 端 `resolveKind` 只认 `krig.text.label` 为 text([GraphCanvasNodeToolbar.tsx:44](../../src/views/graph-canvas-view/GraphCanvasNodeToolbar.tsx#L44))。

---

## 2. 红线(沿用 G5,违反作废)

1. **W5 严格态 A 边界**:canvas-rendering 仍是 three 唯一位置;node-toolbar 0 import three/pm/drivers;PM 机械全关 @drivers(复用 G5 的 `runNodeStyleCommand` headless 纯函数 + canvas-text-node enterEdit)。
2. **复用 > 重写**(charter §6.5):文字渲染/编辑/浮条全有现成件,**解耦复用,别造平行实现**。text.label 的渲染分支应抽成"任意 shape 可叠加的文字层",不是给每个 shape 复制一遍。
3. **registry 容器零硬编码不破**:浮条该有 Text/Type 靠 registry 规则 + view 端 resolveKind 判定,**不在容器里写 if shape**。
4. 每 commit 自包含绿(tsc 0 / eslint 0 warn / 屏障 grep 0 / 相关单测)。

---

## 3. 实施拆解(建议;实施前出设计文档与总指挥对齐)

> **G6.0 先出设计文档** `docs/RefactorV2/stages/L5G6-shape-inline-text-design.md`,定清下面每点的方案 + 决策点,总指挥审过再动代码。

**G6.1 — shape 文字渲染层解耦(NodeRenderer)**
- 把 text.label 专属的文字 SVG mesh 渲染([NodeRenderer.ts:478-500](../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts#L478) 那段)抽成"给定 doc + textBox 区域 → 叠加文字 mesh"的通用方法。
- 正常 shape 渲染(evaluate→path-to-three)后,**若 `inst.doc` 非空 → 在 `evaluatedPath.textBox` 区域叠加文字层**(用 textBox 的 l/t/r/b 定位 + 作为 wrap 宽度)。
- 决策点:文字超出 textBox 怎么办(裁剪 / 溢出 / 自动缩小)?text.label 是整节点即文字框,shape 是文字只占 textBox 子区域 —— 注意区分。

**G6.2 — 双击任意 shape 进编辑(放闸)**
- [GraphCanvasView.tsx:250](../../src/views/graph-canvas-view/GraphCanvasView.tsx#L250) 去掉 `isTextNodeRef` 拦截(或改成"line 类除外"):双击任意非 line shape → `canvas-text-node.enterEdit`,但 EditOverlay 的挂载区域/尺寸用 **shape 的 textBox**(不是整节点 bbox),否则文字框会覆盖整个圆柱含顶部椭圆。
- 决策点:line 类、无 textBox 的 shape 双击行为(应忽略或给个默认中心区域)。
- 编辑结束 onExit → 写回 `instance.doc`(复用 G4.5 既有回写链)。

**G6.3 — 浮条 registry 加"带文字的 shape"规则**
- view 端 `resolveKind`:shape 节点**若 `inst.doc` 非空(已有文字)→ 浮条该出 Fill+Line+Text+Type**。两条路任选(设计里定):
  - A:resolveKind 对"有 doc 的 shape"返回新 kind(如 `'shape-with-text'`),registry 绑 `[fill,line,text,type]`;
  - B:registry binding 的 `match` 直接读 `node.doc` 决定 sections(更贴 registry 本意,无需新 kind)。
- **空 shape(无文字)仍只 Fill+Line**(对的,别改);双击打了字之后再选,才出 Text/Type。或:Text/Type 常驻(点了就进编辑态打字)—— 决策点,设计里定哪种更顺。

**G6.4 — Text/Type 落地到 shape 的 doc**
- 复用 G5 的 runTextCommand 四步契约(取 inst.doc → runNodeStyleCommand → updateInstance{doc} → 刷新)。shape 的 doc 与 text.label 的 doc 同构(PM JSON),**理论上零改动复用**——但要测 shape 的 doc 经 headless 改 mark 后能正确重渲染到 textBox 层(G6.1 的渲染层要吃 doc 变化)。

**G6.5 — 验收 + 真机**

---

## 4. 需要警惕的真实难点(别低估)

| 难点 | 说明 |
|---|---|
| **文字层 vs 图形几何的叠加顺序/坐标系** | text.label 是"整节点=文字";shape 是"图形 mesh + 文字 mesh 叠在 textBox 子区域"。z-order、textBox 局部坐标系、旋转时文字跟随,都要对。 |
| **EditOverlay 区域** | 双击圆柱进编辑,PM 编辑框应贴 textBox(避开顶部椭圆),不是整 bbox。enterEdit 的 mount 区域要传 textBox。 |
| **空 shape 打字后的状态流转** | 空圆柱(无 doc)→ 双击 → 打字 → 有 doc → 选中浮条多出 Text/Type。这个"从 2 项变 4 项"的实时切换要顺。 |
| **substance 内的 text-label** | 本段做 shape 内嵌文字;substance(组合件)里的 text-label 子节点是另一回事,**本段不碰**,设计里划清边界别混。 |
| **撤销** | shape 打字/改样式走画板 G4 快照栈(对齐 G5 决策),确认与几何操作 undo 一致。 |

---

## 5. 验收对接

- 分支 `feature/L5G6-shape-inline-text`(从 G5 分支或 main 切,设计里定),**不合 main**。
- 交:① 设计文档 L5G6;② 完成报告 L5G6-completion(对齐 G5 格式:逐子段 LOC/偏差/决策变更/自检输出/遗留);③ 偏差走"记录待总指挥确认",别默默偏离。
- 总指挥按下面硬验收逐条核(你自测也按这个):
  - [ ] 双击空圆柱 → 在 textBox 区域(避开顶椭圆)进 PM 编辑 → 打字 → Esc → 文字渲染在圆柱内
  - [ ] 选中带文字的圆柱 → 浮条出 **Fill+Line+Text+Type 四项**
  - [ ] 选中空圆柱 → 仍只 **Fill+Line**(没回归)
  - [ ] Text 改 B/I/对齐 + Type 改字号字体 → 圆柱内文字实时变
  - [ ] line 类 / 文字节点 / substance 行为无回归
  - [ ] registry 容器仍零硬编码(判定在 resolveKind/match,非容器)
  - [ ] tsc 0 / eslint 0 warn / 屏障 grep 0 / 相关单测绿
  - [ ] 真机 npm start 视觉确认(总指挥环境无 GUI,留用户)

---

## 6. 开工前 checklist
- [ ] 通读本 prompt + L5-G5 设计 v0.4(§2b 交接) + node-toolbar/DESIGN.md(runTextCommand 契约)
- [ ] 先出 L5G6 设计文档,总指挥审过再动代码
- [ ] 确认在 feature/L5G6 分支
- [ ] 跑 npm start 确认基线:双击圆柱当前确实不能打字(复现用户现象)

完成回总指挥对话,交设计 + 分支 + completion。
