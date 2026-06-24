# L5-G6b 梳理 — Shape 组成重梳:统一模版 → 分类逐个整理

> 缘起:用户实测 L5-G6(shape 内嵌文字)后判定「感觉独立建立了一套文字框,和独立文字框脱离了」。
> 复盘根因 = **数据模型层 text 三套并存**(shape.doc 内嵌 / 独立 text.label 节点 / substance 内 label),
> 渲染/判定/概念三处分叉。
> **用户拍板执行路线(2026-06-21):**
> 1. **不用考虑历史数据,可以删掉重来** → 走最干净的统一,不为存量迁移让步。
> 2. **先统一模版,然后分类逐个整理 shape** → 两阶段:① 定 ShapeDef 统一组成范式 ② 按分类把 22 个 shape 逐个对齐。
> 状态:**梳理 v0.3(统一模版 → 分类整理两阶段);已并入 [L5G6c](./L5G6c-shape-library-nocode-design.md) 阶段 A**(本文件作 text 统一的详述参考)
> **⚠️ 2026-06-22 定位更新**:Graph 决定从干净 main 重建 shape 库([L5G6c](./L5G6c-shape-library-nocode-design.md) 为总纲,新分支 `feature/graph-shape-library-rebuild`)。本文件的「text 统一成一套」**= L5G6c 阶段 A 的内容**,不再单独实施;保留作该阶段的详细论证。
> 关联:[L5G6c 总纲](./L5G6c-shape-library-nocode-design.md) · [L5G6-shape-inline-text-design.md](./L5G6-shape-inline-text-design.md)(L5-G6 内嵌文字,代码不并入,留历史参考)

---

## 0. 用户的三个问题(本梳理回答 #3,梳理 #1,#2 留下一刀)

1. shape 分几个部分? → §2 现状 + §3 统一范式
2. 线条如何表示? → §6 下一刀(本轮不动)
3. text 主体放在哪些地方? → §2.2 现状三套 + §3 统一成一套

---

## 1. 现状全貌:22 个 shape,5 分类

| 分类 | shape(共 22) | renderer |
|---|---|---|
| **basic**(11) | rect roundRect ellipse triangle diamond pentagon hexagon octagon trapezoid parallelogram cylinder | parametric |
| **flowchart**(4) | process decision document terminator | parametric |
| **arrow**(3) | right left-right bent | parametric |
| **line**(3) | straight elbow curved | parametric(无 fill,无 textBox) |
| **text**(1) | label | **static-svg**(唯一异类) |

17/22 已带 `textBox`(line 3 个 + text.label + 个别无)。

---

## 2. 现状:一个 shape 模板(ShapeDef)由什么组成

```
ShapeDef(模板,纯 JSON)
├── id / category / name / source        ← 标识
├── renderer: parametric|static-svg|custom ← 怎么画(现状不统一:21 parametric + 1 static-svg)
├── viewBox / aspect                      ← 基准尺寸 + 缩放规则
├── params / guides                       ← 形状参数(圆柱顶盖高)+ 中间量
├── path / svg_string / implementation    ← 几何本体(三选一,看 renderer)
├── magnets                               ← 连线吸附点(归一化 0..1)
├── handles                               ← 可拖参数手柄
├── textBox                               ← 文字框区域(公式求值)  ← 文字往哪放
└── default_style: { fill, line, arrow }  ← 默认样式
```

一个 Instance(画板节点)= `ref→ShapeDef` + `position/size/rotation/params/style_overrides/doc`。

### 2.1 一个 shape 渲染时的层(NodeRenderer)
```
几何层:path → fill mesh(z=0) + stroke mesh(z=0.01)
文字层:doc  → SVG text mesh(z=0.02,定位 textBox)   ← L5-G6 加
magnets:不渲染,仅吸附
```

### 2.2 问题 #3:text 现状三套并存(脱离感根源)

| 套 | 表示 | 渲染分支 | 现状 |
|---|---|---|---|
| **A 内嵌** | 普通 shape 的 `Instance.doc` | `renderShapeInstance` + `fillTextLayer`(textBox 子区,不撑高) | L5-G6 刚加 |
| **B 独立框** | `ref:'krig.text.label'` 独立 Instance | `renderTextInstance`(整框,自动撑高,**另一条路径**) | G4.5 既有 |
| **C substance label** | component `binding:'label'` | renderSubstanceInstance **skip**(没渲) | 实质空(grep 无真实使用) |

**脱离 = A 与 B 是两条独立代码做同一件事**:渲染分叉(两个分支)、判定分叉(`isTextNodeRef` 散在 12 文件 28 处)、概念分叉(用户脑中"文字"有两种东西)。

---

## 3. 阶段一:先统一模版(ShapeDef 范式)

> 用户路线第一步。定一个**所有 shape 共用的组成范式**,消除 text.label 的"特殊类"地位。存量可丢 → 不留妥协。

### 3.1 统一主张

> **一个 shape = 几何层(可空)+ 文字层(doc,可空),没有"文字类节点"这个特殊种。**
> 文字永远是 `Instance.doc`;渲染永远走 `renderShapeInstance` + `fillTextLayer`;
> 编辑永远是双击 → EditOverlay(canvas-text-node,唯一入口)。
> **删掉 `krig.text.label` 这个 ref 和它的全部特判**(存量可丢,直接删 def + 删 `renderTextInstance` + 删 28 处 `isTextNodeRef`)。

"独立文字框"退化为:**一个无填充、无边框、textBox=整框、文字自动撑高的普通 shape**(Picker 里仍叫"文字框",但底层就是个 shape def,和"矩形"平级)。

### 3.2 统一后的 ShapeDef 范式(模板组成定型)

```
ShapeDef(统一范式)
├── 标识:id / category / name / source
├── 几何:renderer + (path|svg_string|implementation) + viewBox/aspect + params/guides
│        └─ 纯文字框 = 无几何(path 空 / fill,line = none)
├── 锚点:magnets(吸附)+ handles(拖参)
├── 文字:textBox(文字框区,缺省 = 整框 {0,0,w,h})
│        + textGrows?: boolean  ← 新增:文字溢出是否撑高节点
│                                  (文字框 true / 几何 shape false=溢出可见,L5-G6 D-A)
└── 样式:default_style { fill, line, arrow }
```

**关键收口点:**
- **renderer 统一倾向**:text.label 是唯一 static-svg,删它后 **21 个全 parametric**。是否把 renderer 收成单一 parametric(+ 极少数 custom)留 §3.4 拍。
- **adaptHeight 不再绑 ref**:绑 `textGrows`(模板声明)。`fillTextLayer` 读 shape 的 `textGrows` 决定撑不撑高,不再判 `isTextNodeRef`。
- **textBox 缺省 = 整框**:无 textBox 字段的 shape,文字默认填整节点(等于原 text.label 行为),无需每个 def 都写。

### 3.3 阶段一改动盘点(删特殊类,存量可丢)

| 动作 | 落点 |
|---|---|
| **删** `renderTextInstance` 整个方法 | [NodeRenderer.ts](../../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts):440 段 |
| **删** `TEXT_REF` 分支 → renderShapeInstance 成唯一通路 | NodeRenderer:308 |
| `fillTextLayer` 的 adaptHeight 改读 shape `textGrows`(不读 ref) | NodeRenderer |
| Sticky 背景(原 text.label bgFill)并入 shape fill 渲染 | NodeRenderer |
| **删** `isTextNodeRef` 全部特判(12 文件 28 处)→ 改"看 shape 有无几何 / 有无 doc" | Host/HandlesOverlay/InteractionController/canvas-text-node/GraphCanvasView/GraphCanvasNodeToolbar/canvas-store/semantic-atom |
| `resolveKind` 不再返回 `'text'` kind(全归 shape,浮条走 L5-G6 hasText) | GraphCanvasNodeToolbar |
| ShapeDef 类型加 `textGrows?: boolean` | shape-library/types.ts |
| **删/改** `label.json`:要么删(存量可丢),要么改成 `fill:none/line:none/textGrows:true` 的普通 basic shape("文字框") | shapes/definitions/text/label.json |

**保留不动**:`canvas-text-node`(EditOverlay + atom-bridge + docHasText)—— 本就 view-agnostic 与 ref 无关,统一后成**唯一**文字编辑入口。

### 3.4 阶段一待拍点
- **P1** renderer 是否收成单一 parametric(删 static-svg 这条路)?还是保留 static-svg/custom 给未来异形?
- **P2** "文字框"这个 Picker 入口:删 text.label 后,用一个 `fill:none/line:none/textGrows:true` 的 basic shape(如 `krig.basic.textframe`)替代?还是干脆让用户"拖矩形→去掉边框填充"?
- **P3** `textGrows` 放 ShapeDef 字段(显式)vs 用"无几何 path"隐式判定?建议显式字段(清楚)。

---

## 4. 阶段二:分类逐个整理 22 个 shape

> 用户路线第二步。模版范式(阶段一)定了之后,按分类把每个 def 过一遍、按新范式对齐(补 textBox / 定 textGrows / 统一 renderer / 核 magnets)。

逐分类整理清单(每个 def 一条,过新范式):

| 分类 | shape | 整理动作(阶段二逐个核) |
|---|---|---|
| **basic**(11) | rect roundRect ellipse triangle diamond pentagon hexagon octagon trapezoid parallelogram cylinder | 核 textBox 是否避开斜边/尖角(三角/菱形/梯形的文字框该内缩);textGrows=false(几何定死,溢出可见) |
| **flowchart**(4) | process decision document terminator | 同上;decision(菱形)textBox 内缩;document 底波浪 textBox 避开 |
| **arrow**(3) | right left-right bent | 箭头的 textBox 在箭身矩形区,避开箭头尖 |
| **line**(3) | straight elbow curved | #2 下一刀:连线要不要带 doc(线上标签)?本轮先不加 textBox |
| **text→basic** | label → textframe | 阶段一已处理:删/改成无边框文字框;textGrows=true |

**整理产物**:每个 def 补齐 `textBox`(缺省整框)+ `textGrows`,renderer 对齐范式,逐个有离线快照/单测自验(对齐 shape-library smoke 既有套路)。

---

## 5. 代价 / 风险(存量可丢后)

| 项 | 评估 |
|---|---|
| 存量迁移 | **零**(用户授权删掉重来) |
| 回归面 | 28 处 `isTextNodeRef` 删净 + renderTextInstance 删除 → 独立文字框走 shape 通路要全测(双击/撑高/Sticky背景/序列化);中等,单测 + 真机兜 |
| Sticky 背景 | 原 text.label 实色背景并入 shape fill,别丢 |
| 收益 | 模版范式统一 + 文字一套 + 脱离感消除;阶段二把 22 个 shape 拉齐,后续 substance 文字 / 线上文字都复用此范式 |

---

## 6. 留给下一刀(#1 / #2)

- **#1 shape 分几部分**:阶段一后 = 几何层 + 文字层两层清晰。几何层要不要再拆(多 path / 多子形)留后议。
- **#2 线条如何表示**:line 现状两种存在 —— shape 边框(`style_overrides.line` 属性)vs 独立连接线(`category:'line'` Instance,无 fill/text/doc)。待梳理:连线要不要带 doc(线上标签)?连线是"节点"还是"关系"?关系到 [[edge-layering]]。**本轮不动,记此为下一刀。**

---

## 7. 待拍(实施前)

1. **阶段一范式**:删 `krig.text.label` 特殊类、删 `renderTextInstance`、`textGrows` 字段定型 —— 确认走 U2 干净删?
2. **§3.4 P1/P2/P3**:renderer 是否收单一 / "文字框"入口怎么留 / textGrows 显式还是隐式?
3. **阶段二节奏**:模版统一(阶段一)单独一批 commit 验收后,再开阶段二分类整理?还是合并?(建议分两批,阶段一是地基,先稳)

拍了我出**阶段一实施拆解**(逐 commit 自包含绿,红线沿用 L5-G6:复用 fillTextLayer / W5 / registry 零硬编码 / 不破 line/substance),再动代码。
