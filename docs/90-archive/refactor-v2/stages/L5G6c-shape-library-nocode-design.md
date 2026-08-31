# L5-G6c 设计 — 无代码 Shape 库:框架先行,分类填充

> 缘起:L5-G6 内嵌文字暴露"text 三套并存"脱离感 → 用户决定重梳 shape 组成。复盘升级为
> **重建 shape 库**:现有 22 个 shape 是测试脚手架,**全清空重来**;库要设计成**贡献者无代码可扩展**
> (参考 Excalidraw/tldraw 式 Shapes 面板:Basic / Geometry / Objects / Animals / Nature / Food / Symbols)。
>
> **用户拍板(2026-06-21):**
> 1. **无代码形态 = 两条都要:SVG 为主(海量图标零门槛)+ JSON 为辅(少数可参数化几何)。**
> 2. **节奏 = 先搭框架,shape 留空慢慢填**(重机制、轻内容)。
> 3. **分类 = 先 Basic + Geometry 两类,其余后扩。**
> 4. 现有 shape 全清空;text 统一成 shape 的一个属性(承接 [L5G6b](./L5G6b-shape-composition-text-unify-design.md))。
> 5. **拖动点(handles)= 一等公民,框架阶段就接通**;**箭头固定像素、拉长只加长箭身**(2026-06-22 追加,见 §3.5)。
>
> **⚠️ 基线(2026-06-22 拍板):Graph 新开始,从干净 main 切新分支 `feature/graph-shape-library-rebuild`。**
> L5-G6 内嵌文字那 7 commit(`feature/L5G6-shape-inline-text`)**不并入**——其文字思路(doc 挂 shape、fillTextLayer、双击编辑)被本设计的统一范式吸收重做,旧分支留作历史参考。
> **不合 main**(同 G5/G6/G7 节奏,阶段验收后再议)。
>
> 状态:**设计 v0.3 待拍**(不动代码;v0.3 更新基线为新分支)

---

## 0. 一句话目标

把 shape 库从「21 个手写公式 JSON + 1 个 static-svg 空壳」重建成:

> **一个贡献者不写一行代码,丢一个 .svg(或填一个 JSON 模板)进目录,就能给库加一个 shape。**
> shape 统一范式 = 几何层(SVG path / 参数化公式)+ 文字层(doc 挂 textBox)+ 样式 + 吸附点。

---

## 1. 现状地基盘点(哪些现成可复用)

| 能力 | 现状 | 用于无代码库 |
|---|---|---|
| **目录自动注册** | `bootstrap.ts` 用 `import.meta.glob('./definitions/**/*.json', {eager})` 扫所有 JSON 注册 | ✅ **直接复用** — 丢 JSON 进目录即自动进库,零改代码 |
| **parametric renderer** | `evaluateShape` 求值 path 公式 + magnets + textBox → EvaluatedPath | ✅ 复用(JSON 为辅那条) |
| **static-svg renderer** | **空壳**:`svg_string` 字段有定义,但 `evaluateShape` 不处理(返回 null),smoke 跳过 | ❌ **要真实现**(SVG 为主那条的核心) |
| **path-to-three** | 吃 EvaluatedPath.d(SVG d 字符串)→ THREE mesh,支持 M/L/A/Q/C/Z | ✅ 复用(SVG 解析出 d 后同一条渲染) |
| **textBox/fillTextLayer** | L5-G6 已建:doc 渲到 textBox 子区域 | ✅ 复用(文字层统一) |
| **22 个旧 def** | 测试脚手架 | 🗑️ 全清空 |

**结论**:无代码"加载链"已存在(目录扫描);要搭的是**"SVG → ShapeDef"这条解析链** + **统一范式** + **分类骨架**。

---

## 2. 统一 ShapeDef 范式(承接 L5G6b 阶段一)

```
ShapeDef(统一范式 v2)
├── 标识:id / name / category / tags? / source
├── 几何(二选一,这就是"两条都要"):
│   ├── kind:'svg'      → svgPath: "M…L…Z"(贴 SVG 抽出的 path)+ viewBox
│   └── kind:'parametric'→ path/params/guides(公式驱动,可调参数)
│   └── kind:'text'(隐式)→ 无几何(纯文字框)
├── 锚点:magnets(吸附点;svg kind 可自动算 N/S/E/W)
├── 拖点:handles(参数化几何专属;画板上的拖动控制点 → 改 param → 重渲;见 §3.5)
├── 文字:textBox(缺省 = 整框)+ textGrows?(溢出撑高:文字框 true / 几何 shape false)
└── 样式:default_style { fill, line, arrow }
```

**统一收口**:
- **renderer 字段语义重定为 `geometry.kind`**(svg / parametric / text),取代旧 `renderer: parametric|static-svg|custom`。
- **text 不再是特殊类**(L5G6b):删 `krig.text.label` + `renderTextInstance` + 28 处 `isTextNodeRef`;"文字框" = 一个 `geometry.kind:'text'`、`fill/line:none`、`textGrows:true` 的普通 shape。
- **文字层统一**:任何 shape 带 `doc` → fillTextLayer 渲到 textBox,一条路径。

---

## 3. 无代码构建机制(本设计核心)

### 3.1 路 A —— SVG 为主(零门槛,海量图标)

> 贡献者画好/下载一个 SVG,放进 `definitions/<category>/<name>.svg` + 一个**极简同名 meta**(或全自动),系统解析成 ShapeDef。

**链路(要搭)**:
```
贡献者丢 icon.svg → 构建期/运行期 svg-to-shapedef:
  ① 提取 <path d="…">(多 path 合并 / 保留)
  ② 读 viewBox(没有则算 bbox)
  ③ 自动算 magnets(bbox 的 N/S/E/W 四点)
  ④ textBox 默认整框(可被 meta 覆盖)
  ⑤ 包成 ShapeDef { geometry:{kind:'svg', svgPath, viewBox}, … }
→ bootstrap 扫目录注册(复用现有)
```

**门槛**:贡献者只需会画/导出 SVG(Figma/Illustrator/手画)。代价:SVG 不可参数化(顶盖高度这种调不了);复杂 SVG(渐变/滤镜/位图)需在导入器里降级或拒绝 + fail loud。

**待定 SV1**:meta 怎么给?(a) 纯文件名约定(`objects/cup.svg` → category=objects, name=cup,全自动零 meta);(b) 同名 `.svg` + `.json` sidecar(只在要覆盖 textBox/magnets 时写)。建议 **(a) 为默认 + (b) 可选覆盖**。

### 3.2 路 B —— JSON 模板(参数化,少数几何)

> 需要可调参数的几何体(圆柱顶盖、箭头头宽、流程图框)走 parametric JSON,= 现状能力保留。

**门槛**:要懂 path 公式语法(OOXML 17 op)。**只给少数核心几何用**,不要求贡献者掌握。

### 3.3 Picker 混排

两种来源(svg / parametric)在 Picker 里**按 category 混排**(用户无感来源差异),如截图 Basic 一排里方/圆/箭头/线混着。

### 3.4 贡献者工作流(目标态)
```
加一个 Objects 类图标:
  1. 准备 cup.svg
  2. 丢进 src/.../definitions/objects/cup.svg
  3. 刷新 → Picker 的 Objects 分类出现 cup,可拖入画板、可双击打字
  (零代码、零 import、零注册)
```

### 3.5 拖动点(handles)—— parametric 路线的灵魂(一等公民)

> 用户实测发现:箭头(矩形箭身 + 三角箭头)整体缩放时三角会变形。根因 = 纯 SVG 顶点全是死的归一化坐标,等比拉伸必变形。**解法 = 给可调几何加拖动点(handle),单独控制某部分,且能"固定像素"。** 这正是 parametric 存在的理由(SVG 救不了),用户拍板**框架阶段就接通**。

**现状缺口(已勘探)**:`ShapeDef.handles?: ShapeHandle[]` 类型**有定义**,但 ① 所有 def 都没填 handles ② `renderers/` 无任何代码消费 handles ③ 画板交互层无拖点 UI ④ 浮条无"形状参数"入口 —— **从数据到 UI 整条链是断的**。截图浮条只有 `● ✕ Aa`(Fill/Line/Text)正印证此洞。

**要接通的整条链**:
```
JSON: handles:[{ param:'headLen', axis:'x', from:…, min:…, max:… }]
  → 求值:handle 当前屏幕位置 = f(param 当前值)
  → 画板:在该位置画一个拖动控制点(区别于 resize/rotate handle,如黄色点)
  → 拖动:屏幕位移 → 反算新 param 值(夹在 min/max)
  → updateInstance({ params }) → 重渲 → 几何更新
```
(截图里那个**绿色点**是已有的某种控制点雏形,但未驱动 param。)

**箭头固定像素(用户拍板「拉长只加长箭身」)**:
- 现状 `arrow/right.json` 的 `headLen` 是 **ratio**(`hL = w × headLen`)→ 拉长箭身时箭头按比例变长 = **变形根源**。
- 改:箭头尺寸用 **px(绝对像素)** —— `hL = headLenPx`(不乘 w)。整体拉长 → `w` 变大、`hL` 不变 → 箭身 `= w - hL` 变长,**箭头三角保持原大小不变形**。
- 范式要求:**param 的 unit 支持 `px`(绝对)和 `ratio`(相对)两种**;`guides`/`path` 按 unit 决定乘不乘 w/h。`ShapeParam.unit` 已有 `'ratio'|'px'|'deg'`,formula-eval 要正确区分(px 不归一化)。

**handle 范式定型(阶段 A 定字段,阶段 B 接 UI)**:
```
ShapeHandle {
  param: string          // 拖动改哪个 param
  axis: 'x' | 'y'        // 沿哪个轴拖(或 'xy' 自由,待定)
  from: FormulaValue     // 手柄初始位置(公式,如 'x1' = 箭身/箭头分界)
  min?, max?: FormulaValue
  unit?: 'px' | 'ratio'  // 决定不变形:px 调绝对像素
}
```

**浮条第四入口**:带 handles / 可调 params 的 shape,浮条出"形状参数"section(对齐 L5-G6 registry:`hasParams` 派生标记 → binding 加 section)。空 shape / SVG shape 无此入口。

---

## 4. 分类清单(独立清单,先 Basic + Geometry)

> 参考截图分类:Basic / Geometry / Objects / Animals / Nature / Food / Symbols。
> **第一批只立 Basic + Geometry 骨架**,其余分类**先建空目录占位**,内容后填。

### 4.1 第一批(本轮做骨架,shape 内容慢慢填)

| 分类 | 计划 shape(截图参考;先空目录,逐个填) | 来源 | 优先 |
|---|---|---|---|
| **Basic** | 矩形 rect、圆角矩形 roundRect、圆 ellipse、三角 triangle、菱形 diamond、直线 line、箭头 arrow、文字框 textframe | 多数 parametric(可调)+ 文字框 text | ★ 先做 1-2 个验证范式 |
| **Geometry** | 五边形 pentagon、六边形 hexagon、八边形 octagon、梯形 trapezoid、平行四边形 parallelogram、星形 star | parametric / svg | ★ 验证多边形 |

### 4.2 后扩分类(先建空目录,不填)

| 分类 | 内容方向 | 来源 |
|---|---|---|
| Objects | 杯子/灯泡/书/工具… | SVG 为主 |
| Animals | 猫/狗/鸟… | SVG 为主 |
| Nature | 树/叶/山/云… | SVG 为主 |
| Food | 苹果/咖啡… | SVG 为主 |
| Symbols | 心/星/箭头组/标记… | SVG 为主 |
| Flowchart | process/decision/document/terminator | parametric(可调) |
| Line | straight/elbow/curved | parametric(line 特殊,见 L5G6b §6 #2) |

> Flowchart / Line 不在截图 Basic/Geometry 里但功能需要,归后扩,沿用 parametric。

---

## 5. 实施阶段(框架先行)

> 节奏 = 先搭框架,shape 留空慢慢填(用户拍板)。每阶段自包含绿。

> **起点说明**:从干净 main 切,**L5-G6 内嵌文字代码不在基线里**(`renderTextInstance`/`isTextNodeRef`/`fillTextLayer` 在干净 main 是 G4.5 旧态:text.label 走 `renderTextInstance` 整框,普通 shape 无文字层)。所以阶段 A 不是"删 L5-G6",而是**在干净 main 上按统一范式直接做对**(text 一开始就不立特殊类)。

**阶段 A — 清空 + 统一范式(地基)**
- 清空 22 个旧 def(测试脚手架);ShapeDef 类型改 `geometry.kind`(svg/parametric/text)范式 + `textGrows` + `tags?` + `handles` 字段定型(§3.5)。
- **文字统一**:不立 `krig.text.label` 特殊类;NodeRenderer 文字渲染统一成"任意带 doc 的 shape → 渲到 textBox"一条路径(把干净 main 的 `renderTextInstance` 收编成通用文字层,text.label 退化为 `geometry.kind:'text'` 的普通 shape);`isTextNodeRef` 特判一开始就不引入。
- formula-eval 区分 param unit:**px 不归一化 / ratio 乘 w·h**(箭头不变形地基)。
- 保留 bootstrap 目录扫描(已是无代码加载)。
- 验收:库空了也不崩;画板能加载(空库);文字统一走单一文字层路径;px/ratio 求值单测绿。

**阶段 B — SVG 为主链路 + 拖动点接通(无代码核心 + parametric 灵魂)**
- B1 SVG:实现 `svg-to-shapedef`(path 提取 + 自动 bbox/viewBox/magnets/textBox);`geometry.kind:'svg'` 渲染走 path-to-three(复用);文件名约定加载 + 可选 sidecar 覆盖。
- B2 **handles 接通(一等公民)**:求值 handle 屏幕位置 → 画板画拖动控制点 UI(区别 resize/rotate)→ 拖动反算 param(夹 min/max,px/ratio 各自)→ updateInstance({params}) → 重渲;浮条加"形状参数"section(`hasParams` 派生 → registry binding)。
- 验收:① 丢一个 .svg 进 objects/ → Picker 出现 → 拖入可渲染可打字;② 箭头 shape 拖箭头 handle → 三角独立变,整体拉长 → 箭头固定像素不变形。

**阶段 C — 分类骨架 + 第一批 shape**
- 建 Basic / Geometry 目录 + 其余分类空目录占位。
- Basic 填 1-2 个(矩形 + 文字框)验证全链路;Geometry 填 1 个多边形;**箭头 def 用 handles + px 验证不变形**。
- Picker 按 category 混排(svg/parametric 无感)。
- 验收:截图式分类面板出现,Basic/Geometry 可用,箭头可拖不变形,其余分类空占位不崩。

**阶段 D —(后续,非本轮)** 逐分类逐个填 shape;line/connector 重梳(L5G6b §6 #2)。

---

## 6. 待拍(实施前)

1. **范式 P**:`geometry.kind`(svg / parametric / text)统一范式 + 删 text 特殊类 + textGrows + tags —— 确认?
2. **SV1**:SVG 加载 meta = 纯文件名约定(全自动)为默认 + sidecar JSON 可选覆盖 —— 确认?
3. **SVG 导入器位置**:构建期(import.meta.glob 时把 .svg 也扫进来当场解析)还是预生成(脚本把 .svg → .json)?建议**运行期扫 .svg 当场解析**(贡献者连跑脚本都不用,丢文件即可)。待拍。
4. **分类骨架**:先 Basic + Geometry 实做,其余空目录占位 —— 确认?
5. **阶段节奏**:A(清空+范式)→ B(SVG 链路 + 拖动点)→ C(分类骨架+首批) 分批验收,还是合并?建议分批,A 是地基先稳。
6. **handles 已拍**(✅ 一等公民 + 箭头固定像素);余待定:**HV1** handle axis 支持 `'xy'` 自由拖还是只 `'x'/'y'` 单轴?(建议先单轴够用)**HV2** 拖动点视觉(颜色/形状,区别 resize/rotate handle)留实现期定。

拍了我出**阶段 A 实施拆解**(逐 commit 自包含绿,红线沿用 L5-G6:复用 fillTextLayer/bootstrap/path-to-three、W5 边界、registry 零硬编码、fail loud 不兜底),再动代码。

---

## 7. 关联文档
- [L5G6b 梳理](./L5G6b-shape-composition-text-unify-design.md) — text 统一成一套(本设计阶段 A 含此)
- [L5G6 内嵌文字](./L5G6-shape-inline-text-design.md) — PPT 模型(已实施,本设计在其上)
- [[edge-layering]] — line/connector 重梳的边分层(L5G6b §6 #2 下一刀)
