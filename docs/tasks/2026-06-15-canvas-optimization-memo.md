# Canvas 优化 — 候选方向备忘(待总指挥独立考虑后定方向)

> 日期：2026-06-15
> 状态：**记录供总指挥独立思考，方向未定**。X 集成核心(读/写/媒体/Articles)已合 main，下一步定为 Canvas，但「Canvas 优化」具体指哪个待定。
> 本文件只盘点候选 + 现状，不下结论。

---

## 背景：四个相关但不同的方向

「Canvas 优化」可能指下面几个之一/组合。它们**共享同一底层能力(note → 视觉渲染)**，但入口、重点、工作量差很远。总指挥独立考虑时按此区分。

### A. note block 拖进 Canvas 变可调 shape
- **是什么**：把 note 的 block 拖到 Graph 画布上，成一个文字 shape，可调布局/样式。总指挥最早提的设想。
- **现状(已核实)**：note→canvas 拖拽**基本不存在**（`canvas-rendering/types.ts` 仅提及，无实现）。要新做拖拽链路。
- **价值**：把 note 内容搬上画布做自由编排，是「note→视觉态」的一个出口。

### B. Canvas 文字 shape 渲染升级（渲全 block）
- **是什么**：canvas 文字节点现在用 `atomsToSvg`（`src/lib/atom-serializers/svg/index.ts`）**只渲 5 类 block**（段落/标题/列表/公式/代码）；table/image/callout/引用等全是 ASCII 占位（`[Table]`/`[Image]`，见 `unknownAtomLabel` index.ts:191）。升级 = 扩成完整 note 渲染器。
- **现状(已核实)**：占位确凿。扩 atomsToSvg 要手搓 table/image/容器渲染（重，且与真实 NoteView 样式可能两套）。
- **价值**：所有 canvas 文字 shape 显示都受益；也是 X 长图、问AI 的共享地基。

### C. X 长图（note → 竖向长图发 X）
- **是什么**：整篇 note 渲成一张竖向长图发 X。设计见 `docs/tasks/2026-06-12-x-note-to-longimage-design.md`。
- **现状**：设计已存档（路线 A 扩 atomsToSvg vs 路线 B 真实 NoteView 离屏 capturePage）。Articles 跑通后紧迫性降低（长文已能原生发）。
- **价值**：另一种发布形态。与 A/B 共享渲染底层。

### D. Graph 画布本身的交互/性能/布局
- **是什么**：与 note→视觉无关，纯 Graph 画布的操作体验/渲染性能/布局算法优化。
- **现状**：未细查，需总指挥指明具体痛点。

---

## A/B/C 的共性（关键）
A、B、C 都依赖「**note → 视觉渲染**」这层能力（atomsToSvg 或真实 NoteView 离屏渲染）。这正是 [[project-block-serialization-layering]] 里「先复用后抽象」要长出的第二/三消费者。**若做 B(渲全 block)，A 和 C 会顺带受益** —— B 可能是性价比最高的地基。但 B 的实现路线（扩 atomsToSvg 手搓 vs 复用真实 NoteView 离屏截图）本身是个需要 spike 的架构选择（长图设计文档 §路线A/B 有对比）。

## 现状已核实的代码事实
- canvas 文字 shape 渲染：`src/lib/atom-serializers/svg/index.ts`（`atomsToSvg`，5 类 block + 占位）
- canvas 渲染能力：`src/capabilities/canvas-rendering/`（Three.js Host + scene/NodeRenderer + TextRenderer）
- canvas 视图：`src/views/graph-canvas-view/`
- note→canvas 拖拽：无
- 长图设计：`docs/tasks/2026-06-12-x-note-to-longimage-design.md`

## 下一步
总指挥独立考虑后，指明「Canvas 优化」具体是 A/B/C/D 哪个（或组合 + 优先级），再由总指挥写实施/设计 prompt。
