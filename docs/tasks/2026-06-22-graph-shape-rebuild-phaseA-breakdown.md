# 阶段 A 实施拆解 — Graph Shape 库重建(清空 + 统一范式)

> 实施者出,**待总指挥审过再大改动**(对齐 prompt §5 开工 checklist)。
> 权威:[L5G6c 总纲](../RefactorV2/stages/L5G6c-shape-library-nocode-design.md) · [L5G6b text 统一](../RefactorV2/stages/L5G6b-shape-composition-text-unify-design.md) · [实施 prompt](./2026-06-22-graph-shape-rebuild-phaseA-prompt.md)
> 基线:tsc 0(已核)/ 干净 main G4.5 态 / 分支 `feature/graph-shape-library-rebuild`

---

## 0. 勘探结论(已核实,影响范式的两点)

1. **`renderer` 字段消费者仅 4 处**:`parametric.ts`(求值 gate)、`preview-svg.ts`(Picker 缩略图)、`smoke/run.ts`(smoke gate)、types。迁 `geometry.kind` 面可控。
2. **⭐主进程 `canvas-store.ts` 看不到 `geometry.kind`**:它不 import shape-library(shape-library 是渲染侧 capability,靠 `import.meta.glob` + `window.__krig`)。**持久化层只能靠 Instance 自身字段**判定。

**总指挥两项拍板(2026-06-22):**
- **P-store**:doc 用**属性**表达、**拆 hasContent 边**——纳入阶段 A。对齐 note「文档本体零边/属性化去边」([[edge-layering]])。doc 写进 `GraphInstancePayload.doc`,canvas-store 五处 `TEXT_LABEL_REF` 边逻辑全拆。
- **P-textframe**:**全清空,A 末 Picker 完全空**(不留文字框占位 def)。

**P-textframe 的连带后果(实施者标记"待确认"):** 库全空后,A2 文字层统一**无法在本阶段真机验证**(没 shape 可挂 doc)。→ A2 验收改靠:① 离线单测(NodeRenderer 文字层方法给定 doc+textBox 输出 mesh 结构)② 临时测试 def(`__fixtures__` 下造一个带 doc 的几何 shape,只在单测/手测注册,不进 `definitions/` 目录、不进 Picker)。**这是 P-textframe 的必然代价,非偷工**;若总指挥希望 A 末能真机验文字层,需回退到"留 1 个 textframe 占位 def"。

---

## 1. 范式定型(A1 决策,落地前定死)

### geometry.kind 字段迁移方案

`ShapeDef` 新增 `geometry: { kind: 'svg' | 'parametric' | 'text'; ... }`,**取代** `renderer: RendererKind`。迁移映射:

| 旧 `renderer` | 新 `geometry.kind` | 几何载荷 |
|---|---|---|
| `parametric` | `parametric` | `path` / `params` / `guides` / `handles`(现状能力,平移到 geometry 内或保留顶层——见下) |
| `static-svg`(仅 label) | 删(text.label 整个删) | — |
| (新) | `svg` | `svgPath: string` + `viewBox`(B 真消费,A 留字段) |
| (新) | `text` | 无几何 |

**字段放置决策(待确认 D1):** 两种摆法——
- **(a) geometry 收口几何载荷**:`geometry: { kind, path?, params?, guides?, handles?, svgPath?, viewBox? }`。语义最干净,但改动面大(parametric.ts / 所有求值读 `shape.geometry.path`)。
- **(b) geometry 只放 kind + 新增 svg 字段,parametric 载荷保持顶层**:`geometry: { kind }` + 顶层保留 `path/params/guides/handles`,新增顶层 `svgPath?`。改动最小、平移风险低,但 kind 与载荷分离略松。

**实施者建议 (b)**:阶段 A 是地基,改动越小越稳;`kind` 作单一判定锚点足够,载荷归位可留阶段 B/C 重构。**请总指挥拍 (a)/(b)。**

新增字段(两方案都加):
- `textGrows?: boolean` — 文字溢出撑高(文字框 true / 几何 shape false)。
- `tags?: string[]` — Picker 自由归类备用。
- `handles` 范式补 `unit?: 'px' | 'ratio'`(类型已有 `ShapeHandle`,补 unit 字段;§3.5)。
- `ShapeCategory` 暂保留(`'basic'|'geometry'|'arrow'|...`),分类目录是阶段 C,A 不动枚举值除非清库需要。

---

## 2. 逐 commit 拆解(每条自包含绿)

### Commit A1 — ShapeDef 统一范式(类型层先行)
**改:** `shape-library/types.ts`
- 加 `GeometryKind = 'svg' | 'parametric' | 'text'`;`ShapeDef.geometry: { kind: GeometryKind; svgPath?; viewBox? }`(按 D1 定最终形)。
- 删 `renderer: RendererKind`(或暂保留为 deprecated 过渡——A1 一刀删,下游同 commit 改完才绿)。
- 加 `textGrows?`、`tags?`;`ShapeHandle` 补 `unit?: 'px'|'ratio'`。
- `RendererKind`/`svg_string`/`implementation`/`AspectKind` 按 kind 范式清理(static-svg/custom 语义并入 kind)。

**连带同 commit 改(否则 tsc 不绿):**
- `parametric.ts`:`shape.renderer !== 'parametric'` → `shape.geometry.kind !== 'parametric'`。
- `smoke/run.ts`:`renderer === 'static-svg'/'custom'` 跳过 → 改 `geometry.kind !== 'parametric'` 跳过。
- `preview-svg.ts`:`renderer === 'static-svg'/'custom'` → `geometry.kind`。
- `index.ts`:删 `RendererKind` re-export(若删该类型)。

**自检:** tsc 0;`npx vitest run`(shape-library 相关单测)绿;smoke 仍能跑(此时库还在,见 A4 才清)。

---

### Commit A2 — 文字层统一(消除分叉,核心)
**改:** `canvas-rendering/scene/NodeRenderer.ts` + 12 文件 `TEXT_REF`/`isTextNodeRef` 收口。

**判定信号统一(实施者定,对齐勘探):**
- **渲染/交互侧**(有 ShapeDef 可查):`shape.geometry.kind === 'text'` ∨ `inst.doc !== undefined` → 走文字层。
- **canvas-text-node atomBridge**:`isTextNodeRef(ref)` 语义改为不依赖魔法字符串——但该函数靠 ref 无 ShapeDef。**收口为:删 `isTextNodeRef`,改判 `inst.doc !== undefined`**(双击编辑入口 / atomBridge 注入触发都用此)。

具体动作:
1. **NodeRenderer**:删 `const TEXT_REF`;`renderShapeInstance` 里 `inst.ref === TEXT_REF` 分支 → 改判 `shape.geometry.kind === 'text' || inst.doc !== undefined`。把 `renderTextInstance` **收编为通用文字层方法** `fillTextLayer(inst, shape, group, textBox)`:任意带 doc 的 shape,在其 textBox(缺省整框)渲文字 mesh 层,叠加在几何层之上(几何 shape 先渲 path,再叠文字层)。
2. **textGrows**:`adaptTextNodeSizeToContent` 撑高判定从"是 text 节点"改读 `shape.textGrows`(替代 ref 专属自动撑高)。
3. **Sticky 背景**:原 text.label `style_overrides.fill` 实色底,并入 shape 的 fill 渲染路径(几何层 fill mesh),别丢。
4. **坐标语境一致**(L5-G6 踩过的坑):文字层定位到 textBox 子区域时,Y 轴/原点与几何 group 一致。**加临时诊断 log 实测 textBox 求值 + slot 世界坐标,定位后删**(对齐"别猜看真实数据")。
5. **12 文件收口**(逐处,语义见勘探表):
   - `canvas-rendering/types.ts`:5 处 JSDoc「仅 ref==='krig.text.label'」改「带 doc 的 shape」。
   - `HandlesOverlay.ts`:`isTextNodeRef` → `inst.doc !== undefined`(4-handle 判定)。
   - `InteractionController.ts:728`:placeInstance 初始化空 doc 的 `ref === 'krig.text.label'` → 改判 placed shape 的 `geometry.kind === 'text'`(经 api 查 ShapeDef)。
   - `Host.tsx:258`:atomBridge 注入后刷新 text 实例 → 遍历 `inst.doc !== undefined`。
   - `canvas-text-node/{types,index,atom-bridge}.ts`:删 `isTextNodeRef` export + 实现。
   - `GraphCanvasNodeToolbar.tsx`:`resolveKind` 的 `inst.ref === TEXT_NODE_REF` → `inst.doc !== undefined`(或 api 查 geometry.kind);删本地 `TEXT_NODE_REF`。
   - `GraphCanvasView.tsx:250`:双击编辑 gate `atomBridge.isTextNodeRef(ref)` → `inst.doc !== undefined`。
   - substance JSON / DESIGN.md / README.md / atom.ts JSDoc:含 `krig.text.label` 的注释/数据按 A3 持久化范式 + 清库一并清(person.json / text-card.json / sticky-note.json 的 label 子组件实质空,留后,但注释更新)。

**屏障:** `grep -rn "isTextNodeRef\|TEXT_REF\|TEXT_NODE_REF" src/`(排除 .vite 产物)活代码 0。

**自检:** tsc 0;离线单测(见 §0 fixtures)验文字层方法;诊断 log 删净。

---

### Commit A3 — 持久化 doc 边→属性(canvas-store + semantic schema)
**改:** `semantic/types/atom.ts` + `platform/main/graph/canvas-store.ts`

1. **semantic schema**:`GraphInstancePayload` 加 `doc?: unknown`(DriverSerialized 信封);更新 JSDoc(删「doc 不在 payload / 走 hasContent 边」,改「doc 内联属性,文档本体零边」)。
2. **canvas-store 五处拆边**:
   - 读(`instanceAtomToObject:222`):删「查 pmAtom + 拼 doc」,改 `instance.doc = payload.doc`。
   - `incomingInstanceToPayload`:加透传 `inst.doc`(原注释"不带 doc"作废)。
   - `createInstance:347`:删 pm atom + hasContent 边创建。
   - `updateInstance:375`:删 pm atom upsert + 边创建。
   - `deleteInstanceWithCascade:409`:删「单引用 pm 删除」(doc 随 instance payload 走,storage cascade 自动)。
   - `duplicate:767`:删 pm 深拷贝 + 新边(`{ ...instP }` spread 已带 doc)。
   - `incomingDocToPmPayload` / `getPmAtomIdForInstance` / `TEXT_LABEL_REF` / `HAS_CONTENT_PREDICATE`(若仅此处用)→ 删除或保留(hasContent 边是否别处用?**实施前 grep 确认 `HAS_CONTENT_PREDICATE` 唯一消费点**;若 graph 专用则删)。

**待确认 D2(历史数据):** 总指挥已授权「不考虑历史数据,可删掉重来」(L5G6b §0)。旧画板存量里 doc 在 pm atom + hasContent 边——本刀后**新写走内联,旧边数据成孤儿**。处理:(a) 不管(存量可丢,Graph 是新开始);(b) 加一次性读时兼容(旧边有则拼回 doc)。**实施者建议 (a)**(对齐"存量可丢",不留兼容包袱),但若你本机有在用画板想保数据,选 (b)。**请拍。**

**自检:** tsc 0;canvas-store 相关单测(若有)绿;`HAS_CONTENT_PREDICATE`/`TEXT_LABEL_REF` 屏障 grep 0(若全删)。

---

### Commit A4 — formula-eval px/ratio 区分(箭头不变形地基)
**改:** `shape-library/shapes/renderers/formula-eval.ts`(+ parametric.ts 传递 unit 上下文)
- param/guide 求值按 `unit` 决定归一化:`ratio` 乘 w/h;`px` 绝对不乘。
- 当前 `buildEnv` 把 param 直接塞 `params[name]`,求值时不区分 unit。需:求值环境记每个 param 的 unit,handle/guide 用 px param 时不乘几何尺寸。
- **目的**:箭头头部 px → 拉长只加长箭身、三角不变形。
- **离线单测**(`formula-eval.test.ts` 或扩 smoke):同一公式 px vs ratio 求值差异 + 拉长场景(w 变大)箭头 px 尺寸不变。

**待确认 D3(实现细节):** unit 信息怎么进求值环境?param 已知 unit(`ShapeParam.unit`),但 `evalFormula(formulaValue)` 收到的是裸值——px param 引用时,值本身已是绝对数,关键是**公式里别再 `*w`**。这取决于 def 怎么写(`hL = headLenPx` 直接用 vs `hL = w * headLen`)。阶段 A 无箭头 def(已清空),故 A4 = **打通求值器对 px unit 的"不归一化"支持 + 单测证明**,真箭头 def 留阶段 C。**确认 A4 范围 = 地基能力 + 单测,不含真 def?**

**自检:** tsc 0;formula-eval 单测绿。

---

### Commit A5 — 清空旧库(22 def)
**改:** 删 `definitions/{basic,flowchart,arrow,line,text}/` 下 22 个 JSON。
- bootstrap 目录扫描**保留**(`import.meta.glob` 不变,空目录/无 JSON 时注册 0 个)。
- 空库 fail loud:`index.ts` 自诊断 `shapes: 0` 时 **warn 不崩**;NodeRenderer 渲染未知 ref/缺 shape 已有 warn 路径(`shape not found`),确认不静默吞。
- 未知 `geometry.kind` → warn + 安全降级(不崩)。
- substance def 引用 `krig.text.label` 子组件(person/text-card/sticky-note)→ 该 ref 已删,需同步处理:子组件实质空(prompt §7「不动 substance 内 label,实质空留后」)——**保留 substance def 但其 label 子组件渲染时 skip(已 skip,见 NodeRenderer:412)**;清库后该 skip 分支判定从 `comp.ref === TEXT_REF` 改 `compShape == null`(ref 已不存在,api.shapes.get 返 null,自然 skip)。**确认:substance 不动,仅让悬空 label ref 走 null-skip。**

**自检:** tsc 0;启动自诊断 `shapes: 0`(或仅 substance 引用残留)warn;画板加载空库不崩(单测 + 留真机)。

---

## 3. 红线核对(prompt §3,逐条对齐)
1. **W5 边界**:canvas-rendering 是 three 唯一位置;shape-library 0 import three(types 纯数据);A2 文字层方法在 NodeRenderer 内(canvas-rendering),不外溢。✅
2. **复用 > 重写**:bootstrap 扫描 / path-to-three / TextRenderer / atomBridge 全复用;文字层是"收编 renderTextInstance",非新造。✅
3. **fail loud 不兜底**:空库/缺 shape/未知 kind → warn + 降级,不静默。✅
4. **别猜坐标系**:A2 文字层定位加临时诊断 log 实测,定位后删。✅
5. **registry 零硬编码**:本阶段不接浮条 section(handles UI 留 B);resolveKind 收口不引入新硬编码 if。✅
6. **每 commit 自包含绿**:tsc 0 / eslint 新增 0 / 屏障 grep 0 / 相关单测绿。✅
7. **不动 substance label / 不接 handles UI**:A5 substance 走 null-skip 不改结构;handles 仅定 unit 字段。✅

---

## 4. 待确认清单(请总指挥拍)
- **D1**:geometry 字段摆法 (a) 收口几何载荷 vs (b) 只放 kind + 顶层保留载荷。实施者建议 **(b)**。
- **D2**:旧画板 doc 边存量 (a) 不管(存量可丢) vs (b) 读时兼容拼回。实施者建议 **(a)**。
- **D3**:A4 范围 = px unit 求值地基 + 单测(无真箭头 def)。确认?
- **A2 真机验证代价**(P-textframe 连带):库全空 → 文字层统一只能单测 + fixtures 验,本阶段无真机文字层。接受?(否则需留 1 textframe 占位)
- **commit 顺序**:A1(类型)→ A2(文字层)→ A3(持久化)→ A4(formula)→ A5(清库)。A5 放最后(清库前文字层/持久化都还能借现有 def 验)。可否?

---

## 5. 交付
- A1~A5 逐 commit(自包含绿)
- 完成报告 `docs/RefactorV2/stages/L5G6c-phaseA-completion.md`(逐子段 LOC/偏差/自检输出/遗留)
- 偏差走"记录待总指挥确认"
- 不合 main
