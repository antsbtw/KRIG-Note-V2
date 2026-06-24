# 修复指令 — L5-G6 shape 内嵌文字位置错(跩进顶椭圆)

> 发令人:总指挥 · 2026-06-22 · 执行人:L5-G6 原实施者(熟悉 G6.1 坐标系)· 验收人:总指挥
> 分支:继续 `feature/L5G6-shape-inline-text`(未合 main),修复 commit 接在后面。

---

## 0. 现象 + 已确诊根因(总指挥已查真实代码,别再从头猜)

**现象**(用户真机):双击圆柱打字,文字"测试打字"跩到圆柱**左上角、压在顶椭圆里**,不是落在柱身中部。对比 Freeform:文字应落在柱身矩形区(避开上下椭圆)。

**已确诊(不是 shape 定义问题,别去改 shape JSON)**:
- 圆柱 [cylinder.json](../../src/capabilities/shape-library/shapes/definitions/basic/cylinder.json) 的 `textBox: { l:0, t:"ry", r:"w", b:"y1" }` **定义正确**——`t=ry`(避顶椭圆)/`b=y1`(避底椭圆)。
- parametric renderer [parametric.ts:46-51](../../src/capabilities/shape-library/shapes/renderers/parametric.ts#L46) **正确求值** textBox 公式成数字。
- **真 bug 在 [NodeRenderer.fillTextLayer](../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts)(G6.1 解耦)的 Y 轴定位**:它的 `svgGroup.scale.y=1` + `svgGroup.position.set(offsetX, offsetY, ...)` 定位逻辑是按 **text.label 的 innerGroup 语境**调好的(text.label 文字显示正常);shape 复用时,slot 挂在 **path-to-three 几何 group**(`out.group`,原点 shape 左上、path y-down、且经 SceneManager frustum Y 翻转,变换层级与 text.label 的 wrapForRotation(innerGroup) 不同)。两条路坐标语境不一致 → 同样的 `offsetY=tb.t(=ry,正数)` 在 shape group 里方向/基准错 → 文字被顶到顶部椭圆。

---

## 1. 任务:让 shape 内嵌文字正确落在求值后的 textBox 区域

**只修渲染坐标,一处修复所有 shape 受益**(textBox 求值是通用的)。验收用圆柱(textBox 明显避开椭圆),但矩形/圆等也要顺带不回归。

### 修复要点
1. **统一 fillTextLayer 的坐标语境**:让 shape 路与 text.label 路的"offsetX/offsetY → 世界位置"换算一致。核心是搞清 text.label 的 contentSlot(挂 innerGroup,offset 按整节点左上)和 shape 的 slot(挂 out.group 几何 group)在 Y 朝向 + 原点上的差,把 shape 的 offsetY 换算到与 text.label 同语境。
2. **验证 Y 朝向**:`offsetY=tb.t` 必须让文字**向下**避开顶椭圆(往柱身中段走),不是向上。若 shape 几何 group 是 path y-down 而 text.label slot 是 y-up,需对 shape slot 的 offsetY 做对应翻转 / 基准平移(如 `size.h - tb.b` 之类),以实测为准。
3. **不破 text.label**:text.label 文字当前显示正常,改动后必须**回归验证 text.label 仍正常**(独立文字节点打字、撑高、对齐都不变)。

### 红线
- **不改任何 shape JSON 的 textBox 定义**(它们是对的)。
- 不重写 fillTextLayer 整体,只修坐标换算那几行(scale.y / position.set / offset 计算)。
- 别猜坐标系——加临时诊断 log 打印 textBox 求值结果 + slot 世界坐标实测,定位后删(对齐项目「别猜看真实数据」铁律)。
- 每 commit 自包含绿(tsc 0 / lint 0 / 屏障 / 单测)。

---

## 2. 验收(总指挥核 + 真机)
- [ ] 圆柱内打字 → 文字落在**柱身中段 textBox 区域,避开上下椭圆**(对齐 Freeform)
- [ ] 矩形/圆/其它 shape 内打字 → 文字落在各自 textBox 区(不回归)
- [ ] **text.label 独立文字节点无回归**(打字/撑高/对齐照旧)
- [ ] 文字溢出 textBox 仍可见(不裁不缩,D-A 不变)
- [ ] 旋转 shape → 文字跟随(slot 在几何 group 内,本应自动)
- [ ] tsc 0 / lint 0 warn / 屏障 grep / 单测绿
- [ ] 真机 npm start 视觉确认(总指挥无 GUI,留用户)

## 3. 交付
- 修复 commit 接在 `feature/L5G6-shape-inline-text` 后,不合 main。
- 完成报告补一节「文字位置修复:坐标系统一」(根因 + 改了哪几行 + text.label 回归确认)。
- 加 1 个单测锁 textBox 坐标换算(若可纯函数测),或在完成报告说明为何只能真机验。
