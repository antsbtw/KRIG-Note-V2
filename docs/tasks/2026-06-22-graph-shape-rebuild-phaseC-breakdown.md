# 阶段 C 实施拆解 — 分类骨架 + Basic 最小集 + substance 重建 + 真机欠条

> 实施者出,**待总指挥审过再大改动**(对齐 phaseC-prompt §7)。
> 权威:[L5G6c §4 分类清单](../RefactorV2/stages/L5G6c-shape-library-nocode-design.md) · [phaseC-prompt](./2026-06-22-graph-shape-rebuild-phaseC-prompt.md) · A/B 完成报告
> 基线:A/B 已验收;`definitions/` 现仅 `.gitkeep`,probe 已移 `__fixtures__`;分支 `feature/graph-shape-library-rebuild`(不合 main)

---

## 0. 起点勘探补充(实施者亲核)

1. **旧 def 在 A1 commit `49520db3` 已是新 `geometry.kind` 范式**(A1 迁移、A5 删):rect/roundRect/ellipse/line.straight/line.elbow/arrow.right 可**从该 commit 恢复**(proven 几何 + 已带 handle,零重写、低风险)。
2. **LineRenderer 按 ref 渲染** `krig.line.straight/elbow/curved`([LineRenderer.ts:17-19])——line def 只要 id 对、`category:'line'`,渲染走既有 ref-keyed 路径,不用新写几何。
3. **substance 现 ref**(清库后悬空):person/text-card → `krig.basic.roundRect` + `krig.text.label`;sticky → `krig.basic.rect` + `krig.text.label`;parent-link → `krig.line.elbow`;spouse-line → `krig.line.straight`。→ C2 最小集必须覆盖这些。
4. **Picker `SHAPE_ORDER`**([index.tsx:257])= 闭集 `['basic','arrow','flowchart','line','text']`,**缺 geometry** → C1 加枚举 + SHAPE_ORDER。
5. **arrow probe**(`__fixtures__/__b_probe_arrow.json`)= 已验证的 px-handle 箭头,C2 可转正为 `krig.arrow.right`(或 basic.arrow)。

---

## 1. 决策点(实施者拍,报总指挥)

- **C-D1 文字框 id** = **`krig.basic.text`**(归 basic 分类,`geometry.kind:'text'` + `textGrows:true`)。substance label/dates 子组件 + 双击新建入口改指它。(不沿用已删的 `krig.text.label`,不复活旧特殊类——对齐 R8。)
- **C-D2 Basic 最小集 = 7 个**(涵盖 substance 依赖 + 截图核心 + 全 kind 验证):
  1. `krig.basic.rect`(parametric)
  2. `krig.basic.roundRect`(parametric + 圆角 handle)
  3. `krig.basic.ellipse`(parametric,"圆")
  4. `krig.basic.text`(**新**,geometry.kind:'text',文字框)
  5. `krig.arrow.right`(parametric + **px handle**,probe 转正,category `arrow`)
  6. `krig.line.straight`(parametric,category `line`)
  7. `krig.line.elbow`(parametric + bend handle,category `line`)
  - 注:arrow 归 `arrow` 分类、line 归 `line` 分类(已有枚举);Basic 分类实际放 rect/roundRect/ellipse/text 4 个。清单覆盖 §2.3 substance 全依赖。
- **C-D3 svg shape 验真机 SVG 链路** = 额外放 **1 个 svg shape**`krig.geometry.star`(五角星,复用 probe svg 的 path,落 geometry 分类)。还 B 的 SVG 拖入真机欠条 + 顺带给空 Geometry 分类一个内容验证骨架(但 Geometry 真内容仍留 D,仅此 1 个验证件)。
  - **备选**:若总指挥嫌 geometry 分类放 1 个 svg「不够空」破坏「Geometry 留 D」边界,可改放 basic 分类。**倾向 geometry**(svg 图标天然属 geometry/objects 类,且验证「空分类能显示 1 个」)。
- **C-D4 加 `geometry` 枚举** = 确认:`ShapeCategory` 加 `'geometry'` + Picker SHAPE_ORDER 加 + 空目录占位。

---

## 2. 逐 commit 拆解(每条自包含绿)

**C1 — 分类骨架**
- `ShapeCategory` 加 `'geometry'`;Picker `SHAPE_ORDER` 加 `'geometry'`(空分类显「暂无」不崩——勘探:Picker 分组按 count 渲染,count 0 走 §index.tsx:262 已处理)。
- `definitions/{basic,geometry,arrow,line}/` 目录就位(放 def 时自然建)。
- 自检:tsc 0(枚举改连带 SHAPE_ORDER);Picker 不崩。

**C2 — Basic 最小集真 shape(C-D2 七个 + C-D3 svg)**
- 从 `49520db3` 恢复 rect/roundRect/ellipse/line.straight/line.elbow/arrow.right(已新范式),核对 + 按需微调(arrow 用 probe 的 px headLenPx handle 版本,确保不变形)。
- 新写 `krig.basic.text`(geometry.kind:'text' + textGrows:true + textBox 整框)。
- svg `krig.geometry.star.svg`(C-D3,复用 probe svg path)。
- 离线单测:每个 parametric def evaluate 出非空 d + magnets + textBox(对齐 smoke);arrow handle 不变形;text kind evaluate null(走文字层);svg evaluate 缩放正确。
- 自检:bootstrap 注册数 = 8(7 + svg);tsc/eslint/单测绿。

**C3 — substance 重建(指向新 shape)**
- person/text-card label+dates `krig.text.label` → `krig.basic.text`;frame ref 已是 rect/roundRect(C2 已恢复,自然解悬)。
- parent-link/spouse-line line ref(elbow/straight)C2 已恢复,自然解悬。
- 离线验证:5 substance 展开渲染不再全 null-skip(estimateSubstanceBbox/renderComponent 拿到非 null shape);family/person、sticky 能组装。
- 自检:tsc/eslint/单测绿;`krig.text.label` 屏障 grep 0(substance 改指新 ref)。

**C4 — 真机欠条兑现(用户 npm start)**
- 代码层全绿后,交用户真机核(§prompt §6 用户清单):拖 Basic 渲染 + 双击文字落 textBox / 箭头拖点不变形 / svg 拖入 / substance 回归 / 分类面板。
- 若文字落 textBox 真机偏 → 加诊断 log 实测后删(红线 6;A/B 攒的坐标真机验在此做实)。

---

## 3. 红线核对(prompt §5)
1. W5:shape-library 0 three(def 纯 JSON);canvas-rendering 仅 import type + requireCapabilityApi。✅
2. 复用 > 重写:Picker 分组 / bootstrap / evaluate / fillTextLayer / HandlesOverlay / LineRenderer 全复用,只填 def + 加枚举;旧 def 从 git 恢复不重写。✅
3. R8:substance 改指新 ref,不复活 `krig.text.label`,不动跨 capability 共用件。✅
4. fail loud:def 错 / 未知 kind / substance 缺 ref → warn 降级。✅
5. registry 零硬编码:分类靠枚举 + 目录扫描,不在容器写 if。✅
6. 别猜坐标:文字落 textBox 真机偏则诊断 log 实测后删。✅
7. 每 commit 自包含绿。✅

---

## 4. 交付
- C1~C4 逐 commit 自包含绿
- 完成报告 `docs/RefactorV2/stages/L5G6c-phaseC-completion.md`(逐子段 LOC/偏差/自检/遗留 + **A/B 真机欠条兑现状态**)
- 偏差走"记录待总指挥确认"
- 阶段 C 后主线收口:Basic 可用 + 机制全通 + substance 回归;Geometry/Objects 真内容 + line/connector 重梳留 D
