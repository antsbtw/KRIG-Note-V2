# L5-G6c 阶段 C 完成报告 — 分类骨架 + Basic 最小集 + substance 重建 + 真机欠条

> 执行人:实施对话 · 验收人:总指挥 + **用户真机** · 日期:2026-06-22
> 分支:`feature/graph-shape-library-rebuild`(A/B 之上;**不合 main**)
> 权威:[L5G6c §4 分类清单](./L5G6c-shape-library-nocode-design.md) · [phaseC-prompt](../../tasks/2026-06-22-graph-shape-rebuild-phaseC-prompt.md) · [phaseC 拆解+决策](../../tasks/2026-06-22-graph-shape-rebuild-phaseC-breakdown.md)
> 状态:**代码层 C1~C3 全绿,待总指挥代码核 + 用户真机(C4:A/B/C 欠条总兑现)**

---

## 0. 总览

阶段 C(机制变产品 + 还清真机欠条)代码层 3 commit 全绿。C-D1~C-D4 决策拍定后落地。**C4 是用户真机验收(总指挥环境无 GUI)**,代码层已具备全部兑现条件。

| commit | 子段 | 要点 |
|---|---|---|
| `397aa9b1` | C1 分类骨架 | ShapeCategory + Picker SHAPE_ORDER + bootstrap 加 `geometry` |
| `7f84246f` | C2 Basic 最小集 | 7 真 shape(恢复 proven 5 + arrow 转正 + 新文字框)+ geometry svg star |
| `4be8f0da` | C3 substance 重建 | 5 substance ref 指新 shape,解悬空、不再 null-skip |

**全量自检(HEAD):** tsc `0` · eslint(shape-library + canvas-rendering 触碰目录)`0` · 单测 `103/103 绿`(A+B+C 全回归)· `krig.text.label` 活代码屏障 `0` · W5 守住。

---

## 1. 决策落地(实施者拍 + 总指挥确认 C-D3)
- **C-D1 文字框 id = `krig.basic.text`** ✅(geometry.kind:'text' + textGrows:true,归 basic;substance label 改指它;不复活已删 `krig.text.label`)。
- **C-D2 Basic 最小集 = 7 个** ✅:`basic.rect` / `basic.roundRect`(圆角 handle)/ `basic.ellipse` / `basic.text`(文字框)/ `arrow.right`(px handle 不变形)/ `line.straight` / `line.elbow`(bend handle)。涵盖 substance 全依赖 + 截图 Basic 核心 + 全 kind(parametric/text)验证。
- **C-D3 svg shape = `krig.geometry.star`**(总指挥拍 geometry 分类)✅:五角星 svg,验真机 SVG 链路 + 给空 Geometry 1 个验证件;Geometry 真内容仍留 D。
- **C-D4 加 `geometry` 枚举** ✅。

---

## 2. 逐子段

### C1 — 分类骨架(`397aa9b1`)
- `ShapeCategory` 加 `'geometry'`;Picker `SHAPE_ORDER` 加(count>0 才显,空分类不崩——既有逻辑);bootstrap `KNOWN_CATEGORIES` 加(svg 文件名约定校验)。
- 改动极小(枚举 + 两处常量),无 Picker 主体重写(复用分组 UI)。

### C2 — Basic 最小集 7 真 shape + svg star(`7f84246f`)
- 从 `49520db3` 恢复 proven 新范式 def(A1 已迁 geometry.kind):`basic/rect`、`basic/roundRect`、`basic/ellipse`、`line/straight`、`line/elbow`(零重写,proven 几何)。
- `arrow/right`:B 的 probe 箭头转正(headLenPx px handle,不变形)。
- `basic/text`(C-D1 新):geometry.kind:'text' + textGrows:true(取代已删 krig.text.label)。
- `geometry/star.svg`(C-D3):bootstrap 运行期解析为 `krig.geometry.star`。
- 离线验收:`shape-library-basic-set.test.ts`(读真 def 文件,10 例:6 parametric evaluate / text kind null / arrow px 不变形 / roundRect handle / star svg 缩放)。

### C3 — substance 重建(`4be8f0da`)
- person/text-card/sticky-note 的 label+dates `krig.text.label` → `krig.basic.text`;frame(roundRect/rect)+ parent-link/spouse-line(line.elbow/straight)随 C2 恢复自然解悬。
- 5 substance 全 shape 子组件 ref 现解析到已注册 def → 展开渲染不再全 null-skip。
- 离线验收:`shape-library-substance-rebuild.test.ts`(7+1 shape id 注册 / 5 substance 全 ref 解析 / 无 krig.text.label 残留,4 例)。

---

## 3. A/B/C 真机欠条状态(C4 — 用户 npm start 兑现)

> 代码层全部具备兑现条件;真机视觉验收**留用户**(总指挥环境无 GUI)。

| 欠条 | 来源 | 代码层状态 | 真机验(用户) |
|---|---|---|---|
| 文字层落 textBox(几何 shape 双击打字) | A2 / M3 | ✅ fillTextLayer + basic.text + rect/roundRect 带 textBox;单测证 textBox 子区域求值 | ⬜ 双击 shape 打字落 textBox、避开斜边/圆 |
| 箭头拖点不变形 | B2 | ✅ arrow.right px handle;单测证拉长三角恒定 | ⬜ 拖黄点 + 整体拉长看三角不变形 |
| SVG 拖入渲染 | B1 | ✅ geometry.star.svg + evaluate svg kind + pathToThree;单测证缩放 | ⬜ Picker Geometry 拖 star 入画板渲染 |
| substance 渲染回归 | A5 遗留 / C3 | ✅ 5 substance ref 解悬;单测证全 ref 解析 | ⬜ sticky/person 拖入渲染回归 |
| 分类面板 Basic/Geometry | C1 | ✅ 枚举 + SHAPE_ORDER | ⬜ Picker 显示 Basic/Geometry 分类 |

---

## 4. 偏差 / 遗留(待总指挥确认)

1. **【C4 真机验收留用户】**:本阶段重头(A/B/C 欠条总兑现)是用户 `npm start` 真机核(§3 表 ⬜ 项)。代码层离线单测覆盖数据链(103 绿),但**文字落 textBox 的视觉精度 / 箭头拖动手感 / SVG 渲染观感**需真机。若文字落 textBox 真机偏 → 加诊断 log 实测后删(红线 6,留 C4 真机环节)。

2. **【probe fixture】**:B 验收时总指挥已移 `__fixtures__`,C 不动;arrow.right 已是 probe 转正的独立 def(probe fixture 仅供单测,不进 Picker)。

3. **【Geometry 仅 1 个 svg star】**:C-D3 决策只放 1 个验证件,Geometry 真内容(多边形等)留阶段 D —— 符合用户「不一次铺 Geometry」拍板。

4. **【环境】`bulk-delete-perf-verify.test.ts`**:沿 A/B,pre-existing rocksdb 环境 flake,与本刀无关。

---

## 5. 自检输出(HEAD)

```
tsc --noEmit                    → exit 0
eslint(shape-library + canvas-rendering 触碰目录)→ exit 0
krig.text.label 活代码屏障       → 0(substance 改指 krig.basic.text;仅注释留历史)
W5:canvas-rendering 0 运行时 import shape-library(全 import type + requireCapabilityApi)
vitest(A+B+C 全回归)→ 103/103 绿
  · shape-library-basic-set.test.ts          10(C2:7 def + svg star)
  · shape-library-substance-rebuild.test.ts   4(C3:5 substance ref 解析)
  · shape-library-svg-import.test.ts         18(B 回归)
  · shape-library-formula-px-ratio.test.ts   15(A4+B2 回归)
  · shape-library-text-unify.test.ts          4(A2 回归)
  · migration-1.6.0-graph-doc-inline.test.ts  4(A3 回归)
  · 其余既有回归 绿
```

---

## 6. 阶段 C 末态 + 主线收口

**当前态(主线收口):** Graph shape 库重建主线达成 ——
- 机制全通:geometry.kind 范式(A)/ 文字层统一(A)/ doc 内联(A)/ px-ratio(A)/ SVG 链路(B)/ 拖点 handles(B)。
- 库可用:Basic 最小集 7 shape + 1 svg + 分类骨架;substance 5 个回归。
- 无代码可扩展:丢 .json(parametric)或 .svg(geometry)进 `definitions/<category>/` 即进库。

**留阶段 D / 后续专项:**
- Geometry/Objects/Animals/… 真内容铺(C 只 1 个 star 验证件)。
- line/connector 重梳(L5G6b §6 #2:连线带 doc / 关系 vs 节点)。
- B2.3 浮条「形状参数」section(registry hasParams 派生,B 降级的 backlog)。
- 真机若发现坐标/视觉偏差 → 对应阶段回修。
- **合 main 时机**:graph 系列阶段验收节奏,整条线稳(含真机)后再议。
