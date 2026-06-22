# L5-G6c 阶段 A 完成报告 — 清空 + 统一范式(地基)

> 执行人:实施对话 · 验收人:总指挥 · 日期:2026-06-22
> 分支:`feature/graph-shape-library-rebuild`(**不合 main**)
> 权威:[L5G6c 总纲](./L5G6c-shape-library-nocode-design.md) · [L5G6b text 统一](./L5G6b-shape-composition-text-unify-design.md) · [实施 prompt](../../tasks/2026-06-22-graph-shape-rebuild-phaseA-prompt.md) · [拆解+裁决](../../tasks/2026-06-22-graph-shape-rebuild-phaseA-breakdown.md)
> 状态:**A1~A5 全绿,待总指挥核 + 用户真机**

---

## 0. 总览

阶段 A(地基)5 子段全部落地,逐 commit 自包含绿。总指挥 3 条强制修正(M1/M2/M3)+ 2 条补红线(R8/R9)全部兑现。

| commit | 子段 | 净 LOC | 自检 |
|---|---|---|---|
| `49520db3` | A1 ShapeDef 统一范式 geometry.kind | +58/-… (types 58 改) | tsc 0 / eslint 0 |
| `a6cfc6a7` | A2 文字层统一 fillTextLayer | NodeRenderer 收编 + 12 文件收口 | tsc 0 / eslint 0 / 4 单测 |
| `6866ee9a` | A3 doc 边→属性 + migration 1.6.0(M2) | canvas-store -208 行净减 | tsc 0 / eslint 0 / 4 单测 |
| `3dea30b8` | A4 formula-eval px/ratio 区分 | formula-eval +33 | tsc 0 / eslint 0 / 6 单测 |
| `2c6336aa` | A5 清空 22 旧 def | -22 JSON / 库空 | tsc 0 / eslint 0 / 66 单测 |

**全量自检(HEAD):** tsc `0` · eslint(本刀触碰文件)`0`(全仓 10 个 pre-existing 问题均在未触碰文件 pdf-viewer/views-note/thought,非本刀新增,符合「与 main 基线持平」)· 屏障 grep(活代码 `isTextNodeRef`/`TEXT_REF`/`.renderer`)`0` · 相关单测 `66/66 绿`。

---

## 1. 逐子段

### A1 — ShapeDef 统一范式 `geometry.kind`(`49520db3`)
- `ShapeDef.geometry: { kind:'parametric'|'svg'|'text'; svgPath?; viewBox? }` 取代 `renderer: RendererKind`。
- **D1=(b)**(总指挥拍):`kind` 作单一判定锚点,parametric 载荷 `path/params/guides/handles` 保留顶层不下沉(改动最小,完全收口留阶段 B)。
- 加 `textGrows?` / `tags?`;`ShapeHandle` 补 `unit?:'px'|'ratio'`(§3.5,阶段 A 定字段、UI 留 B)。
- 删 `RendererKind`/`svg_string`/`static-svg`/`custom` 语义;`svg` kind 留 `svgPath` 字段待阶段 B 消费。
- 连带迁移:`parametric.ts`/`smoke/run.ts`/`preview-svg.ts` 的 renderer 判定 → `geometry.kind`;22 个 def JSON `renderer`→`geometry` 平移(存活供 A2-A4 验证,A5 清)。

### A2 — 文字层统一(`a6cfc6a7`)
- NodeRenderer:`renderTextInstance` 收编为通用 `fillTextLayer(inst, innerGroup, region, autogrow)`。任意带 doc 的 shape / `geometry.kind:'text'` 走一条文字层路径,不再 `ref==='krig.text.label'` 特判。
  - 几何 shape 带 doc → 在 `evalPath.textBox` 子区域叠文字层(contentSlot 平移到 `(tb.l,tb.t)`,坐标语境与几何 group 一致);文字框走整框 region;`autogrow` 读 `shape.textGrows`(文字框 true / 几何 shape false 溢出可见)。Sticky 背景并入文字框 fill 渲染。
- 判定信号统一为 `inst.doc !== undefined`(12 文件收口):Host atomBridge 刷新、HandlesOverlay 4-handle、InteractionController placeInstance + resolveDefaultSize、GraphCanvasNodeToolbar resolveKind、GraphCanvasView 双击编辑、canvas-rendering/types.ts 5 处 JSDoc。
- 删 `canvas-text-node.atomBridge.isTextNodeRef`(types/index/atom-bridge)+ NodeRenderer `TEXT_REF` + HandlesOverlay 本地 helper;substance text 子组件 skip 改判 `geometry.kind:'text'`。
- 离线验收:`tests/capabilities/shape-library-text-unify.test.ts`(geometry.kind 求值 + textBox 子区域语境 + 缺省整框 fallback,4 例)。

### A3 — doc 边→属性内联 + migration 1.6.0(`6866ee9a`,含 M2)
- `GraphInstancePayload` 加 `doc?:unknown`(DriverSerialized 信封内联)。
- canvas-store 5 处拆边:读(`payload.doc` 直读)/ `incomingInstanceToPayload`(doc 透传)/ create/update/delete/duplicate 去 pm atom + hasContent 边逻辑;删死代码 `getPmAtomIdForInstance`/`incomingDocToPmPayload` + 本地 `PM_DOMAIN`/`HAS_CONTENT_PREDICATE`/`TEXT_LABEL_REF`(canvas-store 净减 208 行)。
- **migration_1.6.0(M2)**:graph-scoped 把存量 `hasContent` 边 doc 迁回 `payload.doc` + 删孤儿边 + 删悬空 pm atom;幂等;清后 cardinality-check 零 hasContent 噪音(R9)。
- 离线验收:`tests/storage/migration-1.6.0-graph-doc-inline.test.ts`(in-memory 真跑:内联/边删/孤儿 pm 删/graph-scoped/幂等,4 例)。

### A4 — formula-eval px/ratio 区分(`3dea30b8`)
- `EvalEnv` 加 `paramUnits`;新增 `scaleParam(name, refDim, env)` — `ratio` 返 `value×refDim` / `px` 返绝对值;`buildEnv` 从 `ShapeParam.unit` 填(缺省 ratio,兼容老 def);未知 param fail loud。
- 导出 `scaleParam`(barrel + 顶层 index)供阶段 B handles 反算拖动复用。
- **D3**(总指挥拍):本阶段只做求值地基 + 单测,真箭头 def 留阶段 C。
- 离线验收:`tests/capabilities/shape-library-formula-px-ratio.test.ts`(px 不乘 / ratio 乘 / 拉长 px 不变形 / ratio 反证等比变形 / 无 unit 兜底 / 未知 param 抛错,6 例)。

### A5 — 清空 22 旧 def(`2c6336aa`)
- 删 `definitions/{basic14/flowchart4/arrow3/line3/text1}` 共 22 个;保留 `definitions/.gitkeep` + bootstrap glob(无代码加载)。
- bootstrap:0 shape 注册显式 warn(fail loud);NodeRenderer `geometry.kind:'svg'`(B 未实现)→ warn + 跳过。
- substance def 按 §7 不动 → frame/label 子组件 ref 悬空,渲染 `compShape==null` null-skip(空库不崩)。

---

## 2. 总指挥裁决兑现核对

| 编号 | 裁决 | 兑现 |
|---|---|---|
| **M1** | hasContent predicate 绝不删 | ✅ A3 只拆 canvas-store 5 处 doc 用法;predicate 定义 + `cardinality-check.ts` + `atom-entity.ts` 一字未动(git diff 证空) |
| **M2** | 清孤儿边(不选"不管") | ✅ migration_1.6.0 一次性 graph-scoped 迁移 + 清孤儿边/pm;4 例单测含幂等 |
| **M3** | A2 真机验证欠条 | ✅ 见 §3 欠条;真机文字层验证顺延阶段 C |
| **D1** | (b) geometry 只放 kind | ✅ A1 |
| **D3** | A4 仅 px 地基 + 单测 | ✅ A4 |
| **R8** | 不删通用 predicate(删边先 grep) | ✅ 已全仓 grep `user:krig:hasContent`(7 文件)核实跨能力消费,仅删 graph 那批边实例 |
| **R9** | 健康检查零新噪音 | ✅ migration 清孤儿后 cardinality-check 扫不到残留 hasContent 边 |

---

## 3. 偏差 / 欠条(待总指挥确认)

1. **【M3 欠条】A2 真机文字层验证顺延阶段 C**:P-textframe 全清空 → 本阶段库空、无真 shape 可挂 doc,文字层 SVG mesh 渲染(及 textBox 子区域 Y 轴方向)**无法真机验证**。已用离线单测(geometry.kind 求值 + textBox 子区域语境 + fillTextLayer region 推导)+ 代码注释固化坐标不变量替代。**真机文字层落地 + 视觉验收 → 阶段 C(填回首批 shape 后)。**

2. **【偏差待确认】诊断 log 实测改为离线单测**:prompt A2 要求「文字层定位加临时诊断 log 实测真实数据后删」。因 P-textframe 全清空后本阶段无可渲染的带 doc 几何 shape,运行期诊断 log 无数据可打 → 改为**离线单测验 textBox 子区域求值 + 代码注释固化 contentSlot→(tb.l,tb.t) 平移不变量**。坐标语境一致性的**真机实测**随 M3 欠条一并落阶段 C。**这是 P-textframe 的必然连带,非省略诊断纪律。**

3. **【遗留】substance def 因清库而实质停用**:person/text-card/sticky-note 的 frame(`krig.basic.rect`/`roundRect`)+ label(`krig.text.label`)子组件 ref 在 A5 后悬空,渲染全 null-skip → substance 渲染空(不崩)。prompt §7「不动 substance 内 label」已遵守(未改 substance def),但「清空 shape 库」连带使其 frame 也悬空。**substance 重建/对齐留阶段 C(填回 shape)或后续 substance 专项;当前空库中间态可接受。**

4. **【环境】`bulk-delete-perf-verify.test.ts` 失败与本刀无关**:该 perf 测起真 rocksdb sidecar,因端口残留 DB(`atom:blk_0 already exists`)失败;stash 本刀改动后**同样失败**,确认 pre-existing 环境 flake,非 A 引入。

---

## 4. 自检输出(HEAD)

```
tsc --noEmit -p tsconfig.json   → exit 0(0 错误)
eslint(本刀触碰文件)            → exit 0(0 问题)
eslint . --max-warnings 0       → 10 问题,全在未触碰文件(pdf-viewer/views-note/thought),pre-existing,新增 0
屏障 grep(活代码 isTextNodeRef/TEXT_REF/.renderer in shape-library+canvas)→ 0
vitest(shape-library + canvas + migration 相关)→ 66/66 绿
  · shape-library-text-unify.test.ts        4
  · shape-library-formula-px-ratio.test.ts  6
  · migration-1.6.0-graph-doc-inline.test.ts 4
  · 既有 node-toolbar / migration-028 等回归 绿
```

---

## 5. 阶段 A 末态 + 阶段 B/C 交接

**当前态(地基已稳):**
- ShapeDef 统一范式 `geometry.kind` 落地;文字层一条路径(`fillTextLayer`);doc 内联属性(零边);px/ratio 求值地基 + `scaleParam`;库空但 bootstrap 扫描在位、fail-loud 不崩。
- **必经中间态**:Picker 空、shape 库空、substance 实质停用 —— 阶段 C 填回。

**阶段 B 接力(SVG 链路 + 拖动点 UI):**
- `geometry.kind:'svg'` 渲染(NodeRenderer 已留 fail-loud 占位)→ 实现 `svg-to-shapedef` + 走 path-to-three。
- handles UI 接通:复用 A4 `scaleParam` 反算拖动(px/ratio 各自);浮条「形状参数」section(registry hasParams 派生)。
- toolbar `resolveKind` 完整 registry hasText 派生(A2 暂用 `inst.doc!==undefined` 直判)。

**阶段 C 接力(分类骨架 + 首批 + M3 欠条):**
- 建 basic/geometry 目录 + 首批 shape(矩形/文字框/多边形/箭头 px 不变形)。
- **兑现 M3 欠条**:真机文字层渲染 + textBox 坐标 Y 轴方向视觉验收(加临时诊断 log 实测后删)。
- substance def 对齐/重建。
