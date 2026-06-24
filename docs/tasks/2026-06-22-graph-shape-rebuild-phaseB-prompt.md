# 实施指令 — Graph Shape 库重建 · 阶段 B:SVG 链路 + 拖动点 handles UI

> 发令人:总指挥 · 2026-06-22 · 执行人:新对话实施者 · 验收人:总指挥
> 分支:**接着 `feature/graph-shape-library-rebuild`**(阶段 A 已验收通过,见 [L5G6c-phaseA-completion.md §9](../RefactorV2/stages/L5G6c-phaseA-completion.md);**不合 main**)
> 权威:[L5G6c 总纲 §3](../RefactorV2/stages/L5G6c-shape-library-nocode-design.md)(§3.1 SVG / §3.5 handles)

---

## 0. 背景 + 本阶段定位

阶段 A 已把地基打好:`geometry.kind`(svg/parametric/text)范式定型、文字层统一、formula-eval 支持 px/ratio、旧库清空(当前 Picker 空)。

**阶段 B = 无代码库的两条核心能力接通**:
> **B1 SVG 为主链路**(贡献者丢 .svg 即成 shape,零门槛)+ **B2 拖动点 handles UI**(parametric 灵魂:箭头加拖点不变形)。

阶段 B 做完,库仍基本空(真 shape 内容是阶段 C),但**两条机制可端到端验**:丢一个测试 .svg → Picker 出现可拖入;造一个带 handle 的 parametric 测试 def → 画板拖点改形不变形。**这也顺带还上阶段 A 的 M3 欠条**(有真 shape 可挂 doc → 文字层真机可验)。

---

## 1. 起点勘探(总指挥已核实)

**B1 SVG 链路接入点:**
1. NodeRenderer `geometry.kind === 'svg'` **已留跳过点 + warn**([NodeRenderer.ts:326](../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts#L326))——阶段 B 在此接真渲染。
2. `pathToThree(evalPath)` 吃 `EvaluatedPath.d`(SVG d 字符串)([path-to-three.ts:85](../../src/capabilities/canvas-rendering/scene/path-to-three.ts#L85))——**svg shape 复用同一条渲染**,只要 evaluate 给出 `d`。
3. `shapes.evaluate` → `evaluateShape`([shape-library/shapes/renderers](../../src/capabilities/shape-library/shapes/renderers/parametric.ts))**当前只处理 parametric**,svg/text 返 null。B1 让它对 `kind:'svg'` 输出 EvaluatedPath(svgPath 当 d、viewBox 当尺寸、bbox 算 magnets/textBox)。
4. bootstrap `import.meta.glob('./definitions/**/*.json')`——**只扫 .json**。SVG 加载要么扩 glob 扫 .svg、要么导入器产出 ShapeDef。

**B2 handles UI 接入点(全复用,别另造 overlay):**
5. `HandlesOverlay`([scene/HandlesOverlay.ts](../../src/capabilities/canvas-rendering/scene/HandlesOverlay.ts)):已有 8 resize + 1 rotate handle,**像素恒定、跟随节点旋转、hitTest 完整、HandleKind 枚举**。param 拖点 = **加一种 HandleKind(如 `'param'`),进同一套绘制/hitTest**。
6. `InteractionController`([interaction/InteractionController.ts:392](../../src/capabilities/canvas-rendering/interaction/InteractionController.ts#L392)):`handleHit` 分发 resize/rotate(`startResize`/`startRotate`)。param 拖点加分支 `startParamDrag` → 拖动反算 param → `updateInstance({params})` → 重渲。**对齐现有 resize 拖动落地模式**。
7. `scaleParam(name, refDim, env)`(阶段 A 落地):px 不归一化 / ratio 乘 refDim / 未知 param throw。**handle 反算复用此语义**(px 拖绝对像素 / ratio 拖相对比例)。
8. `ShapeHandle { param, axis, from, min?, max?, unit? }`(阶段 A 定型)——B2 真消费:`from` 公式求值出 handle 屏幕位置,拖动按 axis + unit 反算 param。

---

## 2. 逐 commit 拆解(建议;实施前出细化拆解,总指挥审过再大改动)

### B1 — SVG 为主链路

**B1.1 `svg-to-shapedef` 导入器(新件,无代码核心)**
- 输入一个 SVG(字符串 / 文件)→ 输出 ShapeDef(`geometry.kind:'svg'`)。
- 提取 `<path d>`(多 path 合并或保留)、读 viewBox(无则算 bbox)、自动算 magnets(bbox N/S/E/W)、textBox 默认整框。
- **降级 fail loud**:渐变/滤镜/位图/不支持元素 → warn + 跳过或拒绝,不静默吞(红线)。
- 放 shape-library 内(纯数据转换,0 import three)。

**B1.2 evaluate 支持 svg kind**
- `evaluateShape` 对 `kind:'svg'`:svgPath → `EvaluatedPath { d: svgPath, width, height, magnets, textBox }`(不走公式求值,直接透传 path + bbox 算锚点)。
- NodeRenderer svg 分支:删跳过 warn,调 evaluate → pathToThree(复用)。

**B1.3 SVG 文件加载(无代码工作流)**
- 总指挥拍板:**运行期扫 .svg 当场解析**(贡献者丢文件即可,不跑脚本)。扩 bootstrap glob 扫 `definitions/**/*.svg` → svg-to-shapedef → register。
- 文件名约定(`<category>/<name>.svg` → category/name)+ 可选同名 `.json` sidecar 覆盖 textBox/magnets(L5G6c SV1=a 为默认 + b 可选)。
- **验收**:丢一个测试 .svg 进 `definitions/__b_probe__/` → Picker 出现 → 拖入画板渲染正确 → 双击可打字(文字层叠加,还 M3 欠条)。

### B2 — 拖动点 handles UI(parametric 灵魂)

**B2.1 handle 求值 + 绘制(HandlesOverlay 扩展)**
- HandlesOverlay 加 `'param'` HandleKind:对带 `handles` 的选中 shape,按每个 handle 的 `from` 公式求值出屏幕位置,画拖动控制点(**视觉区别 resize/rotate**——HV2:颜色/形状由实施者定,建议如黄色方点,区别 resize 白圆 / rotate 绿圆)。
- 像素恒定 + 跟随节点旋转(复用 overlay 现有机制)。

**B2.2 handle 拖动落地(InteractionController 扩展)**
- `handleHit === 'param'` → `startParamDrag(target, handleIdx, world)`。
- 拖动:屏幕位移 → 按 handle.axis(HV1:先单轴 x/y 够用)+ unit(px/ratio,复用 scaleParam 反算)→ 新 param 值,夹 min/max。
- `updateInstance({ params })` → 重渲(几何 + handle 位置同步更新)。
- 对齐 resize 拖动的 undo(画板 G4 快照栈)。

**B2.3 浮条「形状参数」section(可选,registry 零硬编码)**
- 带 handles/可调 params 的 shape,浮条出"形状参数"section(`hasParams` 派生 → registry binding,对齐阶段 A registry 模式)。**若 B2.1/B2.2 拖点已够用,此条可降级为 backlog**——实施者评估后定,记决策。

**B2 验收**:造一个带 handle 的 parametric 测试箭头 def(`definitions/__b_probe__/`,headLen 用 **px unit**)→ 选中出 param 拖点 → 拖点单独改箭头大小 → **整体拉长节点,箭头三角保持原像素不变形**(用户核心诉求)。

---

## 3. 红线(沿用 + 阶段 A 补强)

1. **W5 边界**:canvas-rendering three 唯一位置;svg-to-shapedef 在 shape-library(0 import three,纯数据);HandlesOverlay/InteractionController 扩展在 canvas-rendering 内。
2. **复用 > 重写**:SVG 渲染复用 pathToThree;handle 拖点复用 HandlesOverlay + InteractionController 拖动模式,**不另造 overlay/拖动系统**。
3. **fail loud**:SVG 解析不支持元素 / 未知 handle param → warn + 降级,不静默(R8/R9 沿用:不删通用件,健康检查零噪音)。
4. **别猜坐标**:handle 屏幕位置求值 + 拖动反算,加临时诊断 log 实测后删(对齐铁律)。
5. **registry 零硬编码**:浮条 section 靠 registry 声明。
6. 每 commit 自包含绿:tsc 0 / eslint 新增 0 / 屏障 grep 0 / 相关单测绿。
7. 真 shape 内容仍留阶段 C;本阶段只用 `__b_probe__` 测试 def/svg 验机制,**验收后是否保留 probe 由实施者定(建议留作回归 fixture 或挪 __fixtures__)**。

---

## 4. 验收(总指挥核 + 用户真机)

- [ ] **SVG 链路**:丢一个 .svg → Picker 出现 → 拖入渲染正确 → 双击打字文字层正常(**还 M3 欠条**)。
- [ ] **svg-to-shapedef**:path 提取 + bbox/viewBox/magnets/textBox 自动算;不支持元素 fail loud。
- [ ] **handle 拖点**:带 handle 的 parametric shape 选中出 param 拖点(视觉区别 resize/rotate)→ 拖动单独改参数。
- [ ] **箭头不变形(核心)**:px unit 箭头 → 整体拉长只加长箭身、三角保持原像素。
- [ ] **不破阶段 A**:文字层/范式/清空库/px-ratio 无回归;`HAS_CONTENT` 等通用件零改(R8)。
- [ ] tsc 0 / eslint 新增 0 / 屏障 0 / 相关单测绿;健康检查零新噪音(R9)。
- [ ] 真机 npm start:SVG shape 可拖、handle 可拖不变形、文字层可见(留用户)。

---

## 5. 开工 checklist
- [ ] 确认在 `feature/graph-shape-library-rebuild` 分支(阶段 A 之上)。
- [ ] 通读 L5G6c §3.1(SVG)+ §3.5(handles)+ 阶段 A 完成报告(范式 D1=b 载荷留顶层 / scaleParam 语义)。
- [ ] 复核 §1 起点勘探。
- [ ] 先出阶段 B 细化拆解(逐 commit + 决策点:HV1 单轴 / HV2 拖点视觉 / B2.3 浮条 section 是否本阶段做),总指挥审过再大改动。
- [ ] **不合 main**;完成交:阶段 B 完成报告 `L5G6c-phaseB-completion.md`(逐子段 LOC/偏差/自检/遗留 + M3 欠条兑现确认)。

---

## 6. 交付物
- B1(SVG 链路)+ B2(handles UI)逐 commit 自包含绿
- 完成报告 `docs/RefactorV2/stages/L5G6c-phaseB-completion.md`
- 偏差走"记录待总指挥确认"
- 阶段 C(分类骨架 + 首批真 shape + substance 重建)由后续 prompt 接力
