# 实施指令 — Graph Shape 库重建 · 阶段 C:分类骨架 + 首批真 shape + substance 重建 + 真机欠条

> 发令人:总指挥 · 2026-06-22 · 执行人:新对话实施者 · 验收人:总指挥 + **用户真机**
> 分支:**接着 `feature/graph-shape-library-rebuild`**(阶段 A/B 已验收,见 [phaseA §9](../RefactorV2/stages/L5G6c-phaseA-completion.md) / [phaseB §9](../RefactorV2/stages/L5G6c-phaseB-completion.md);**不合 main**)
> 权威:[L5G6c 总纲 §4 分类清单](../RefactorV2/stages/L5G6c-shape-library-nocode-design.md)

---

## 0. 背景 + 本阶段定位

阶段 A(地基:geometry.kind 范式 / 文字层统一 / px-ratio)+ 阶段 B(SVG 链路 / 拖动点 handles)已验收。**当前库空(Picker 仅 `.gitkeep`)**。

**阶段 C = 把机制变成可用产品 + 还清所有真机欠条**:
> ① 分类骨架(对齐截图 Basic/Geometry/…)② **首批真 shape = Basic 最小集**(用户拍板)③ substance 重建指向新 shape(用户拍板)④ **真机视觉验收**(用户 npm start——A/B 攒的欠条在此兑现)。

**这是用户终于能 `npm start` 看到完整效果的阶段。** A/B 的"无真机文字层 / 箭头不变形仅数据层证 / SVG 拖入未真机"欠条,C 填回真 shape 后全部可真机验。

---

## 1. 用户拍板(2026-06-22,本阶段范围锚点)

- **首批真 shape = 只 Basic 最小集**(矩形 / 圆 / 文字框 + 1 个箭头)。**不一次铺 Geometry 内容**(Geometry 建空骨架,内容留阶段 D)。
- **substance 并进 C:重建 5 个 substance 的 frame/label 子组件指向新 Basic shape**,让 family/sticky 重新能渲染。

---

## 2. 起点勘探(总指挥已核实)

1. **ShapeCategory 枚举**([types.ts:19](../../src/capabilities/shape-library/types.ts#L19))= `'basic'|'arrow'|'flowchart'|'line'|'text'`。**缺 `'geometry'`**——分类骨架要加(对齐截图)。
2. **Picker 分类分组 UI 已就绪**([library-picker/index.tsx](../../src/capabilities/canvas-rendering/ui/library-picker/index.tsx)):左分类 / 右 3-col 网格,`activeCategory` 默认 basic;`listByCategory` 已有。**填 def 进目录即显示,Picker 主体不重写**。
3. **substance 5 def + 它们引用的 ref**(grep 实证,清库后悬空,C 要重建指向):
   | substance | frame ref | label ref | line ref |
   |---|---|---|---|
   | family/person | `krig.basic.roundRect` | `krig.text.label` ×N | — |
   | library/text-card | `krig.basic.roundRect` | `krig.text.label` | — |
   | library/sticky-note | `krig.basic.rect` | `krig.text.label` | — |
   | family/parent-link | — | — | `krig.line.elbow` |
   | family/spouse-line | — | — | `krig.line.straight` |
   **⚠️ 故 Basic 最小集必须涵盖 substance 依赖**:`rect` / `roundRect` / 文字框(取代 `krig.text.label`)/ line `elbow`+`straight`,否则 substance 重建缺 ref。
4. substance bootstrap/registry 已有([substances/bootstrap.ts](../../src/capabilities/shape-library/substances/bootstrap.ts))——复用。
5. **`krig.text.label` 已在阶段 A 删**。substance 的 `label` 子组件要改指向新文字框 shape(见 §3 决策)。

---

## 3. 落地前需实施者拍 + 报总指挥的决策点

| 编号 | 决策 | 建议 |
|---|---|---|
| **C-D1** "文字框" shape 的 id/ref | 旧 `krig.text.label` 删了。新文字框 shape 用什么 id?`krig.basic.text` / `krig.text.box` / 沿用 `krig.text.label`?substance label 子组件 + 双击新建文字框入口都指它。 | 建议 `krig.basic.text`(归 basic 分类,geometry.kind:'text',textGrows:true);substance label 改指它 |
| **C-D2** Basic 最小集清单 | 用户说"矩形/圆/文字框+1箭头",但 substance 依赖还需 roundRect + line(elbow/straight)。最小集 = ?建议:**rect / roundRect / ellipse(圆)/ text(文字框)/ arrow(带handle,svg或parametric)/ line.straight / line.elbow**(7 个,涵盖 substance 依赖 + 截图 Basic 核心 + 验证全 kind)。 | 建议上述 7 个;line 归 line 分类 |
| **C-D3** 各 shape 用 parametric 还是 svg | rect/ellipse/roundRect/arrow 走 parametric(可调/带 handle);文字框 text kind;**是否放 1 个 svg shape 验真机 SVG 链路**? | 建议:几何走 parametric,**额外放 1 个 svg shape(如截图某图标)真机验 B 的 SVG 链路**(还 B 的 SVG 拖入欠条) |
| **C-D4** Geometry 分类骨架 | 加 `'geometry'` 到 ShapeCategory + 建空目录 + Picker 显示空分类(不崩)。内容留 D。 | 确认 |

---

## 4. 逐 commit 拆解(建议;实施前出细化拆解,总指挥审过再大改动)

**C1 — 分类骨架**
- ShapeCategory 加 `'geometry'`(对齐截图;其余截图分类 Objects/Animals/… 留 D,不急着加枚举)。
- Picker 分类列表显示 Basic + Geometry(空分类不崩,显"暂无")。
- `definitions/{basic,geometry,line}/` 目录就位(line 已有目录概念)。

**C2 — Basic 最小集真 shape(C-D2 清单)**
- 按新范式写 def:`geometry.kind` + textBox + textGrows + (arrow 带 handles+px)。
- 文字框 shape(C-D1):geometry.kind:'text' + textGrows:true。
- 含 1 个 svg shape(C-D3)验真机 SVG 链路。
- 每个 def 离线快照/单测(对齐 shape-library smoke):evaluate 出可渲染 d + magnets + textBox。
- **箭头用 px handle**(还 B 的不变形真机欠条:真机拖点 + 拉长验三角不变形)。

**C3 — substance 重建(指向新 shape)**
- 5 个 substance 的 frame/label/line 子组件 ref 改指 C2 新建的 shape(roundRect/rect/文字框/line)。
- label 子组件 `krig.text.label` → C-D1 新文字框 ref。
- 验证 family/person、sticky-note、text-card 重新能渲染(substance 展开渲染不再全 null-skip)。

**C4 — 真机欠条兑现 + 验收**
- 用户 npm start 真机核(总指挥环境无 GUI):
  - 拖 Basic shape 入画板渲染正确;双击打字文字落 textBox(避开圆柱/圆等几何);
  - 箭头拖点 → 三角独立变 + 整体拉长不变形(B 核心诉求真机确认);
  - SVG shape 拖入渲染正确;
  - substance(sticky/person)渲染回归;
  - 分类面板 Basic/Geometry 显示。

---

## 5. 红线(沿用 A/B,违反作废)

1. **W5 边界**:shape-library 0 import three;canvas-rendering 走 requireCapabilityApi(仅 import type)。
2. **复用 > 重写**:Picker 分组 UI / bootstrap 扫描 / evaluate / fillTextLayer / HandlesOverlay 全复用,只填 def + 加分类枚举。
3. **R8 不删通用件**:substance 重建别动跨 capability 共用件;`krig.text.label` 已删,改指新 ref 即可,别复活旧特殊类。
4. **fail loud**:def 格式错 / 未知 kind / substance 缺 ref → warn + 降级,不静默。
5. **registry 零硬编码**:分类/section 靠声明,不在容器写 if。
6. **别猜坐标**:文字落 textBox 真机若偏,加诊断 log 实测后删(A/B 攒的坐标真机验在此做实)。
7. 每 commit 自包含绿:tsc 0 / eslint 新增 0 / 屏障 grep 0 / 相关单测绿。

---

## 6. 验收(总指挥代码层 + 用户真机)

**总指挥代码层:**
- [ ] ShapeCategory 加 geometry;Picker 显示 Basic/Geometry 分类(空不崩)。
- [ ] Basic 最小集 def 按新范式落地(geometry.kind/textBox/textGrows/arrow handles);各 def 离线单测绿。
- [ ] 含 1 个 svg shape;文字框 shape(geometry.kind:'text')。
- [ ] substance 5 个 ref 重建指向新 shape;展开渲染不再全 null-skip(单测/离线验)。
- [ ] tsc 0 / eslint 新增 0 / 屏障 0 / 单测绿;R8 通用件零改。

**用户真机(本阶段重头,A/B 欠条兑现):**
- [ ] 拖 Basic shape 渲染 + 双击打字落 textBox。
- [ ] **箭头拖点不变形(B 核心诉求真机确认)**。
- [ ] SVG shape 拖入渲染。
- [ ] substance(sticky/person)渲染回归。

---

## 7. 开工 checklist
- [ ] 确认在 `feature/graph-shape-library-rebuild`(A/B 之上)。
- [ ] 通读 L5G6c §4 分类清单 + A/B 完成报告(范式 / scaleParam / handles / svg-to-shapedef)。
- [ ] 复核 §2 起点勘探(尤其 substance ref 表)。
- [ ] 先出阶段 C 细化拆解(逐 commit + C-D1~C-D4 决策),总指挥审过再大改动。
- [ ] **不合 main**;完成交:阶段 C 完成报告 `L5G6c-phaseC-completion.md`(逐子段 LOC/偏差/自检/遗留 + **A/B 真机欠条兑现确认**)。

---

## 8. 交付物
- C1~C4 逐 commit 自包含绿
- 完成报告 `docs/RefactorV2/stages/L5G6c-phaseC-completion.md`(含 A/B 真机欠条兑现状态)
- 偏差走"记录待总指挥确认"
- **阶段 C 后 Graph shape 库重建主线收口**:Basic 可用 + 机制全通 + substance 回归。Geometry/Objects/… 真内容 + line/connector 重梳(L5G6b §6 #2)留阶段 D / 后续专项。
