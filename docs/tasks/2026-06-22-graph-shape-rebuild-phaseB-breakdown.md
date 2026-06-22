# 阶段 B 实施拆解 — SVG 链路 + 拖动点 handles UI

> 实施者出,**待总指挥审过再大改动**(对齐 phaseB-prompt §5 开工 checklist)。
> 权威:[L5G6c §3.1 SVG / §3.5 handles](../RefactorV2/stages/L5G6c-shape-library-nocode-design.md) · [phaseB-prompt](./2026-06-22-graph-shape-rebuild-phaseB-prompt.md) · [phaseA 完成报告](../RefactorV2/stages/L5G6c-phaseA-completion.md)
> 基线:阶段 A 已验收(tsc 0 / 屏障 0);分支 `feature/graph-shape-library-rebuild`(不合 main)

---

## 0. 起点勘探补充(实施者亲核,行号校准)

阶段 A 留好的接入点都在;额外发现 3 个影响拆解的真实细节:

1. **`pathToThree` 自带最小 SVG d parser,只认 `M/L/A/Q/C/Z`**([path-to-three.ts:89 `parseSvgPathD`])。真实 SVG 常用 `H/V/S/T` + 相对(小写)命令 → 直接喂会丢段/错。**→ 决策 SVG1(d 命令覆盖)。**
2. **`HandleKind` + `handlePositions` 是固定 9 点集**([HandlesOverlay.ts:249]),param 拖点位置是**每 shape 由 `handle.from` 公式动态求值**的、数量可变 → 不能塞进固定 Map,需动态子组(复用 `makeHandleMesh` + group transform,但单独管理 list)。**架构已想清,非决策,记做法。**
3. **Picker 分类硬编码闭集**:`SHAPE_ORDER: ShapeCategory[] = ['basic','arrow','flowchart','line','text']`([library-picker/index.tsx:257]),默认 `activeCategory='basic'`;`ShapeCategory` 是闭合 union。`__b_probe__` 测试 category 要显示需处理。**→ 决策 PROBE(probe 落哪个 category)。**

---

## 1.0 决策已拍(总指挥 2026-06-22)
- **SVG1 = (b) 导入时归一化** ✅:svg-to-shapedef 把 H/V/S/T/相对 归一化成 M/L/C/Q/A/Z 绝对,渲染层 pathToThree 不动。
- **PROBE = (a) 借 basic category** ✅:probe 件用 `category:'basic'`,Picker 直接可见,零改 union;验收后移 `__fixtures__`/删。
- **B2.3 = 降级 backlog** ✅:本阶段只做 B2.1/B2.2 拖点;浮条「形状参数」section 留阶段 C。
- **HV1 = 单轴 `'x'|'y'`**(实施者附议,采纳)· **HV2 = 黄方点**(PlaneGeometry 方块 + 黄填蓝边,区别 resize 白圆/rotate 绿圆)。

## 1. 待决策点(已全部拍定,见 §1.0)

- **SVG1 — d 命令覆盖**:真实 SVG 的 `d` 含 `H/V/S/T`/相对命令,现 parser 只认 6 个绝对命令。
  - (a) **扩 `parseSvgPathD` 支持 H/V/S/T + 相对**(canvas-rendering 内,渲染更通用,改动中);
  - (b) **svg-to-shapedef 导入时归一化**成 M/L/C/Q/A/Z 绝对(shape-library 内,parser 不动);
  - (c) **A 仅认 6 命令子集,其余 fail loud 拒绝**(最小,但很多现成 SVG 进不来)。
  - 实施者建议 **(b)**:归一化在导入器(无代码核心该处理脏 SVG),渲染层不动、风险隔离。**请拍。**
- **PROBE — 测试 probe 落点**:`__b_probe__` category 不在闭合 `ShapeCategory`。
  - (a) **probe 用现有 `basic` category**(Picker 直接可见,零改 union/SHAPE_ORDER;probe 混进 basic,验收后移除);
  - (b) **加 `__b_probe__` 进 union + SHAPE_ORDER**(更隔离,但动闭集 + 验收后要回退)。
  - 实施者建议 **(a)**:probe 是临时验机制 fixture,借 basic 最省、验收后删干净不留痕。**请拍。**
- **HV1 — handle 轴**:`'x'|'y'` 单轴 vs `'xy'` 自由。prompt 建议先单轴。实施者**附议单轴**(箭头 headLen 单轴够,自由拖留后)。
- **HV2 — 拖点视觉**:区别 resize(白圆)/rotate(绿圆)。实施者建议 **黄色方点**(色相 + 形状双区分;`makeHandleMesh` 现做圆,param 用 PlaneGeometry 方块 + 黄填蓝边)。
- **B2.3 — 浮条「形状参数」section 是否本阶段做**:prompt 说若拖点够用可降级 backlog。实施者建议 **本阶段只做拖点(B2.1/B2.2),B2.3 浮条 section 记 backlog**(拖点是核心诉求,浮条数字微调是锦上添花,且 registry section 接入面大,留阶段 C 与真 shape 一起更稳)。**请拍是否接受降级。**

---

## 2. 逐 commit 拆解(每条自包含绿)

### B1 — SVG 为主链路

**B1.1 `svg-to-shapedef` 导入器(新件,shape-library 内,0 import three)**
- `parseSvgToShapeDef(svg: string, meta: { id, category, name }): ShapeDef | null`。
- 用 `DOMParser`(浏览器 API,非 three)解析:取所有 `<path d>`(多 path 合并成一条 d,或 fail-loud 多 path 留后)、读 `viewBox`(无则由 path bbox 估)、算 magnets(bbox N/S/E/W)、textBox 默认整框。
- d 命令按 SVG1 决策处理(建议 (b) 归一化)。
- **fail loud**:渐变/滤镜/位图/`<image>`/`<text>`/无 path → warn + 返 null(不静默吞)。
- 离线单测:正常 svg → ShapeDef 正确;脏 svg(渐变/无 path)→ null + warn。

**B1.2 evaluate 支持 svg kind**
- `evaluateShape` 对 `kind:'svg'`:`EvaluatedPath { d: svgPath, width:ctx.width, height:ctx.height, magnets:bbox 算, textBox:整框 }`(透传 path,不走公式)。
- NodeRenderer svg 分支:删 A 留的跳过 warn,调 evaluate → pathToThree(复用)。
- 离线单测:svg kind evaluate 出非空 d + magnets。

**B1.3 SVG 文件运行期加载(无代码工作流)**
- bootstrap 扩 glob 扫 `definitions/**/*.svg`(`{ as:'raw'/query:'?raw' }` 拿字符串)→ `parseSvgToShapeDef`(文件名约定 category/name)→ register;可选同名 `.json` sidecar 覆盖 textBox/magnets(SV1=a 默认 + b 可选)。
- 空/坏 svg fail-loud warn 不崩。
- **验收 + M3 欠条**:丢测试 `.svg` 进 `definitions/`(PROBE 决策落点)→ Picker 出现 → 拖入渲染正确 → 双击打字文字层正常(**还 M3**)。

### B2 — 拖动点 handles UI

**B2.1 handle 求值 + 绘制(HandlesOverlay 扩展)**
- 选中 shape 带 `handles` → 每个 handle 按 `from` 公式(复用 `evalFormula`/`buildEnv`)求值出 shape-local 位置,按 `axis` 定位 → overlay-local px(× zoom,相对 bbox 中心)→ 画拖点(HV2 黄方点)。
- 动态 list(数量随 handles 变)+ 像素恒定 + 跟随节点旋转(复用 group transform / `makeHandleMesh` 模式)。
- hitTest 加 `'param'` 命中(返回 `{ kind:'param', handleIdx }`;现 hitTest 返 HandleKind,需扩返回带 idx —— 决策点:扩 hitTest 返回结构 or 单开 paramHitTest。实施者建议单开 `paramHitTest` 不动现有 hitTest 签名,降回归面)。

**B2.2 handle 拖动落地(InteractionController 扩展)**
- `paramHitTest` 命中 → `startParamDrag(node, handleIdx, world)`(pushHistory + 快照 param/size/rotation,对齐 startResize)。
- mousemove `applyParamDrag`:world delta 去 rotation → shape-local → 按 axis + unit 反算新 param(px 绝对 / ratio÷refDim,复用 scaleParam 逆运算),夹 min/max → `updateInstance({params})` → 重渲 + handle 同步。
- mouseup 清状态 + `onInstancesChange`(undo 对齐 resize)。
- **别猜坐标**:反算加临时诊断 log 实测后删(红线 4)。
- 离线单测:给定 handle from/axis/unit + world delta → 反算 param 值正确(纯函数抽出 `reverseParamFromDrag`,可 node 测,不碰 three)。

**B2.3 浮条「形状参数」section** — 按 B2.3 决策(实施者建议降级 backlog,记决策)。

**B2 验收**:probe 箭头 def(headLen **px unit**)→ 选中出黄拖点 → 拖点改箭头 → 整体拉长**箭头三角原像素不变形**。

---

## 3. 红线核对(prompt §3)
1. W5:svg-to-shapedef 在 shape-library(0 three,DOMParser 是 web API 非 three);HandlesOverlay/InteractionController 扩展在 canvas-rendering 内。✅
2. 复用 > 重写:svg 渲染复用 pathToThree;拖点复用 HandlesOverlay group transform + makeHandleMesh + InteractionController 拖动生命周期,不另造 overlay。✅
3. fail loud:脏 SVG / 未知 handle param → warn 降级不静默;R8/R9 不删通用件、健康检查零噪音。✅
4. 别猜坐标:handle 求值 + 拖动反算加临时诊断 log 实测后删。✅
5. registry 零硬编码:B2.3 若做,section 靠 registry 声明(否则降级 backlog)。✅
6. 每 commit 自包含绿:tsc 0 / eslint 新增 0 / 屏障 0 / 单测绿。✅
7. probe 测试件:验收后移 `__fixtures__` 或删(记决策)。✅

---

## 4. 交付
- B1.1~B1.3 + B2.1~B2.2(+ B2.3 视决策)逐 commit 自包含绿
- 完成报告 `docs/RefactorV2/stages/L5G6c-phaseB-completion.md`(逐子段 LOC/偏差/自检/遗留 + **M3 欠条兑现确认**)
- 偏差走"记录待总指挥确认";阶段 C(分类骨架 + 首批真 shape + substance 重建)后续接力
