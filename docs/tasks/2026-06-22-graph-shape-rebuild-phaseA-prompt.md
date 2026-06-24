# 实施指令 — Graph Shape 库重建 · 阶段 A:清空 + 统一范式(地基)

> 发令人:总指挥 · 2026-06-22
> 执行人:新对话实施者 · 验收人:总指挥
> 分支:**`feature/graph-shape-library-rebuild`**(已从干净 main 切,开篇文档已 commit;**不合 main**)
> 权威设计:[../RefactorV2/stages/L5G6c-shape-library-nocode-design.md](../RefactorV2/stages/L5G6c-shape-library-nocode-design.md)(总纲)+ [../RefactorV2/stages/L5G6b-shape-composition-text-unify-design.md](../RefactorV2/stages/L5G6b-shape-composition-text-unify-design.md)(text 统一详述)

---

## 0. 背景 + 优先级裁定(先读懂再动手)

**这是 Graph 画板的"新开始"**:现有 22 个 shape 是测试脚手架,用户拍板**全清空重建**成一个**贡献者无代码可扩展**的 shape 库(SVG 为主 + JSON 为辅;参考 Excalidraw/tldraw)。完整蓝图见 L5G6c 总纲。

**⚠️ 优先级(总指挥已裁定,别自行调换)**:
> **先做 text 统一范式(本阶段 A,地基)→ 再做 shape 构建(阶段 B:SVG 链路 + 拖动点;阶段 C:分类骨架)。**

理由:`geometry.kind` 范式是数据地基,SVG 导入器/handles/分类目录都长在它之上。范式没定就做构建 = 空中楼阁、必返工。而 text 统一本身就要求重定 shape 范式(清空 + 定范式这一刀),所以它天然是第一阶段。

**⚠️ 必经中间态(不是 bug)**:阶段 A 做完,画板会进入"**shape 库是空的、只有文字层能用**"的中间态。这是地基阶段的正常产物,阶段 C 才填回 shape。实施者别因为"Picker 空了"以为做坏了。

**⚠️ L5-G6 代码不在基线**:干净 main 上**没有** L5-G6 的 `fillTextLayer`/`isTextNodeRef 放闸`/`docHasText`/双击任意 shape 编辑等改动(那些在废弃的 `feature/L5G6-shape-inline-text` 分支,本分支不并入)。所以本阶段**不是"删 L5-G6"**,而是在干净 main(G4.5 态)上**按统一范式直接做对**——text 一开始就不立特殊类。L5-G6 的好思路(doc 挂 shape、双击进编辑、有字才出 Text 浮条)在阶段 B/C 按新范式重做,本阶段先把范式与文字层地基打好。

---

## 1. 起点勘探(总指挥已核实,省你踩点)

**新分支 = 干净 main(G4.5 文字态),关键现状:**

1. **文字渲染分叉**:[NodeRenderer.ts](../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts) `const TEXT_REF='krig.text.label'`(:43);`renderShapeInstance` 里 `ref===TEXT_REF → renderTextInstance`(:308,整框文字+自动撑高);普通 shape 无文字层。**这就是要统一的分叉**。
2. **`krig.text.label` 散在 12 文件**:`grep -rl "isTextNodeRef\|krig.text.label\|TEXT_REF\|TEXT_NODE_REF" src/`。统一 = 把"看 ref===text.label"换成"看 shape 有无 doc / geometry.kind"。
3. **22 个旧 def**:`src/capabilities/shape-library/shapes/definitions/{basic,flowchart,arrow,line,text}/`,21 parametric + 1 static-svg(label.json)。**全清空**。
4. **`ShapeDef.handles?: ShapeHandle[]` 类型有定义但零消费**([shape-library/types.ts:86,153](../../src/capabilities/shape-library/types.ts#L86))。本阶段只**定型字段范式**,接 UI 留阶段 B。
5. **formula-eval 无 px/ratio 区分**([renderers/formula-eval.ts](../../src/capabilities/shape-library/shapes/renderers/formula-eval.ts)):param unit 已有 `'ratio'|'px'|'deg'` 定义,但求值没按 unit 区分归一化。**箭头不变形的地基要在此打**。
6. **bootstrap 目录自动注册已就绪**([shapes/bootstrap.ts](../../src/capabilities/shape-library/shapes/bootstrap.ts) `import.meta.glob('./definitions/**/*.json')`)——**保留复用**,丢 JSON 进目录即注册,已是无代码加载。

---

## 2. 阶段 A 任务(逐子段;落地前可先与总指挥对齐细节)

> 每子段一组自包含绿 commit。范式以 L5G6c §2/§3.5 为准。

**A1 — ShapeDef 统一范式(类型层先行)**
- `ShapeDef` 引入 `geometry.kind`:`'svg' | 'parametric' | 'text'`(取代旧 `renderer: parametric|static-svg|custom` 的语义;字段怎么迁由实施者定,清晰即可)。
  - `parametric`:path/params/guides/handles(现状能力)。
  - `svg`:svgPath + viewBox(阶段 B 真消费,A 先留字段)。
  - `text`:无几何(纯文字框)。
- 加 `textGrows?: boolean`(文字溢出是否撑高:文字框 true / 几何 shape false=溢出可见)。
- 加 `tags?: string[]`(Picker 自由归类备用)。
- `handles` 范式按 L5G6c §3.5 定型:`{ param, axis, from, min?, max?, unit?:'px'|'ratio' }`。**本阶段只定字段 + 类型,UI 不接**。

**A2 — 文字层统一(消除分叉,核心)**
- NodeRenderer 文字渲染收成**一条路径**:任意带 `doc` 的 shape → 在其 textBox(缺省=整框)渲文字层。把现有 `renderTextInstance` 收编为通用文字层方法(给定 doc + textBox 区域 + 字体参数 → 文字 mesh),text.label 退化为 `geometry.kind:'text'` 的普通 shape 走同一路径。
- **不引入** `isTextNodeRef` 特判;现有 12 文件的 `TEXT_REF`/`isTextNodeRef` 收口为"看 geometry.kind / 有无 doc"。
- `textGrows` 决定撑不撑高(替代原 text.label 专属的自动撑高判定)。
- Sticky 背景(原 text.label 实色底)并入 shape 的 fill 渲染,别丢。
- **坐标语境一致**:文字层定位到 textBox 子区域时,Y 轴 / 原点要和几何 group 语境一致(这是 L5-G6 踩过的坑——见归档 [2026-06-22-L5G6-fix-shape-text-position-prompt.md](./2026-06-22-L5G6-fix-shape-text-position-prompt.md),那是旧分支的坐标 bug,新范式从头做时**一次做对**:加临时诊断 log 实测 textBox 求值 + slot 世界坐标,定位后删,别猜)。

**A3 — formula-eval px/ratio 区分(箭头不变形地基)**
- param/guide 求值按 unit 决定是否归一化:**`ratio` 乘 w/h;`px` 绝对不乘**。
- 目的:箭头头部用 px → 整体拉长时箭头三角保持原大小、只箭身变长(用户拍板"拉长只加长箭身")。
- 离线单测:同一公式 px vs ratio 求值结果差异 + 拉长场景箭头尺寸不变。

**A4 — 清空旧库**
- 删 `definitions/` 下 22 个旧 def(或留 1-2 个最小占位防空库崩——实施者按 A2 验收需要定;原则是阶段 A 末库基本空,阶段 C 才填)。
- bootstrap 目录扫描保留;空库 / 缺 shape 时画板 fail loud 但不崩(加载报 warn,不静默兜底)。

---

## 3. 红线(沿用 graph 系列,违反作废)

1. **W5 严格态 A 边界**:canvas-rendering 是 three 唯一位置;shape-library 0 import three(types 纯数据);node-toolbar 0 import three/pm/drivers。
2. **复用 > 重写**:bootstrap 目录扫描、path-to-three、TextRenderer/atomBridge 全复用;文字层是"收编 renderTextInstance 成通用方法",不是新造平行实现。
3. **fail loud 不兜底**:空库 / 缺 shape / 未知 geometry.kind → warn + 安全降级,**不静默吞**(对齐项目铁律)。
4. **别猜坐标系**:文字层定位加临时诊断 log 实测真实数据,定位后删(对齐"别猜看真实数据"铁律)。
5. **registry 容器零硬编码**:浮条该有哪些 section 靠 registry 声明,不在容器写 if。
6. 每 commit 自包含绿:tsc 0 / eslint 与 main 基线持平(新增 0)/ 屏障 grep 0 / 相关单测绿。
7. **不动 substance 内 label**(实质空,留后);**不接 handles UI**(本阶段只定字段,UI 是阶段 B)。

---

## 4. 验收(总指挥核 + 用户真机)

- [ ] `ShapeDef` 统一范式落地:`geometry.kind`(svg/parametric/text)+ `textGrows` + `tags` + `handles` 字段定型,tsc 绿。
- [ ] **文字层一条路径**:NodeRenderer 无 `TEXT_REF` 分叉;text.label 走 `geometry.kind:'text'` 普通 shape 通路;12 文件 `isTextNodeRef`/`TEXT_REF` 收口干净(grep 活代码 0)。
- [ ] **文字坐标正确**:带 doc 的几何 shape(造个测试矩形/圆柱 def 验)→ 文字落在 textBox 区域,**Y 轴方向对**(不跩进顶部);text.label 文字渲染无回归。
- [ ] **px/ratio 区分**:formula-eval 单测证 px 不归一化 / ratio 乘 w·h;拉长场景 px 尺寸不变。
- [ ] **空库不崩**:清空旧 def 后画板能加载、Picker 空但不报错崩溃(fail loud warn 可接受)。
- [ ] tsc 0 / eslint 新增 0 / 屏障 0 / 相关单测绿。
- [ ] 真机 npm start:画板能开,文字层能渲(总指挥环境无 GUI,留用户)。

---

## 5. 开工 checklist
- [ ] 确认在 `feature/graph-shape-library-rebuild` 分支。
- [ ] 通读 L5G6c 总纲(尤其 §2 范式 / §3.5 handles / §5 阶段)+ L5G6b(text 统一详述)。
- [ ] 复核 §1 起点勘探(行号略偏不影响逻辑)。
- [ ] 先出阶段 A 实施拆解(逐 commit + 决策点),总指挥审过再大改动;小范式调整可边做边记"偏差待确认"。
- [ ] **不合 main**;完成交:阶段 A 完成报告(对齐 graph 系列格式:逐子段 LOC/偏差/自检输出/遗留)+ 待总指挥验收。

---

## 6. 交付物
- 阶段 A 代码(A1~A4,逐 commit 自包含绿)
- 阶段 A 完成报告 `docs/RefactorV2/stages/L5G6c-phaseA-completion.md`
- 偏差走"记录待总指挥确认",别默默偏离范式
- 阶段 B(SVG 链路 + 拖动点 UI)/ 阶段 C(分类骨架)由后续 prompt 接力,本 prompt 只到阶段 A
