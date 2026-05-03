# Canvas M2 — Spec 与现有代码差异对照

> 配套 [Canvas-M2-Spec.md](./Canvas-M2-Spec.md) 使用。
>
> 把 M2 spec 计划项与 `feature/graph-canvas-m1` 分支当前已实现的代码做一遍**逐项核对**,
> 找出三类:
> - 🟢 **已完整实现**:M2 计划其实是已完成项,spec 里的"新增"措辞要改成"接通"
> - 🟡 **部分实现**:核心通路有,差 UI / 字段 / 个别交互,M2 工作量需缩减
> - 🔴 **完全缺失**:按 spec 原计划走
>
> 盘点日期 2026-04-30,基于 Explore agent 对源码的精确扫描。
> **本文不修改 Canvas-M2-Spec.md**,仅作为修订前的事实对照。最终修订意见见 §6。

---

## 1. 关键意外发现(影响 M2 工作量估算的三件事)

### 1.1 `atomsToSvg` 渲染管线已完全实现

**地点**:[src/lib/atom-serializers/svg/](../../../src/lib/atom-serializers/svg/)

- ✅ `atomsToSvg(atoms): Promise<string>` —
  [src/lib/atom-serializers/svg/index.ts](../../../src/lib/atom-serializers/svg/index.ts)
- ✅ 5 字体预加载:Inter Regular/Bold/Italic + Noto Sans SC Regular/Bold +
  JetBrains Mono Regular(放在
  [src/lib/atom-serializers/svg/fonts/](../../../src/lib/atom-serializers/svg/fonts/))
- ✅ `pickFontForChar` + `splitByFont` 字符级字体分段(CJK 探测 + bold/italic 字重映射 +
  code mark 切等宽)— [text-to-path.ts](../../../src/lib/atom-serializers/svg/text-to-path.ts)
- ✅ MathJax-full 公式 SVG 序列化(`fontCache='none'`,纯 path 输出) —
  [mathjax-svg.ts](../../../src/lib/atom-serializers/svg/mathjax-svg.ts)
- ✅ blocks 覆盖:`textBlock` / `mathBlock` / `mathInline` / `bulletList` / `orderedList`
- ✅ marks 覆盖:bold / italic / underline / code(strike-through 由调用方自己生成 path)
- ✅ L1 LRU(SVG 字符串 cache,容量 1000) — [lru.ts](../../../src/lib/atom-serializers/lru.ts)
- ✅ Promise-based 字体懒加载 cache(L2 等价)

**但是**(关键):
- ❌ **零消费者**:全仓 `grep atomsToSvg` 仅命中定义文件,无任何 import
- ❌ **emoji 字体未加载**(Twemoji/Noto Color Emoji 都没集成)
- ❌ **缺字符 tofu 兜底缺失**:opentype 拿不到 glyph 时静默返回空 path,会出现"看不见的字"
- ❌ **L3 mesh 缓存未做**(还停留在 SVG 字符串层)

**对 M2.4 影响**:**工作量从 2.5–3 天降到 ~1.25 天**。原因:M2.4 要做的事从"全部从零实现 SVG path 管线"
变成"接通已有 serializer + 补 emoji + tofu + L3 mesh 缓存 + 编辑态浮 ProseMirror"。

### 1.2 Line ref 命名一开始就统一了,**不需要"老 schema 迁移"**

[src/plugins/graph/library/shapes/definitions/line/](../../../src/plugins/graph/library/shapes/definitions/line/)
直接就是 `krig.line.straight` / `krig.line.elbow` / `krig.line.curved` 三个 ref,**M1 从未存在过**
"三个独立 line shape 各自命名空间"的状态。

**对 M2.2 影响**:Spec §2.3 的 "deserialize 兼容映射" 章节描述错了,改为:
- 现状:`ref` 是 `'krig.line.straight' | 'krig.line.elbow' | 'krig.line.curved'`
- 拟选:升级时只需把 ref 字段降级为只剩 `'krig.line'`,新增 `lineKind` + `pathStyle` 即可
  (本质上就是把 path 维度从 ref 移到独立字段,这是规范化而非破坏性迁移)
- 现已是 `schema_version: 2`(persist/serialize.ts),M2 升 v3

### 1.3 schema_version 已经是 v2,不是 v1

[persist/serialize.ts](../../../src/plugins/graph/canvas/persist/serialize.ts) 写得很清楚:
- v1:`viewBox{x,y,w,h}`(已弃用,deserialize 还能容错读)
- v2(现行):`view{centerX, centerY, zoom}`(无量纲,Freeform 风格)

**对 M2 整体影响**:Canvas-M2-Spec.md §7.5 写"从 M1 的 v1 升到 v2"**事实错误**。
应改为"v2 → v3"(M2 增加 `gridVisible` / `text` / `note_ref` 等新字段时,顺便升 v3)。

---

## 2. M2.1 网格底 — 真实差距(0.5 天估算 ✅ 仍准)

| Spec 计划 | 现状 | 差距 |
|---|---|---|
| `GridBackground.ts` plane + shader | 🔴 完全没有 | 全做 |
| Toolbar `▦` 视图开关 | 🔴 没有 | 全做 |
| `viewBox.gridVisible` 持久化 | 🔴 没有(view 字段无 gridVisible) | 加字段 + 升 schema |

**结论**:0.5 天估算正确,**无需修订**。

唯一细化:Toolbar 当前 [Toolbar.tsx](../../../src/plugins/graph/canvas/ui/Toolbar/Toolbar.tsx)
`+ 新建` / `Open` / `🔄` 三个按钮还是 `opacity:0.3` disabled 占位,本次顺便清理掉
(对齐 [feedback_branch_module_boundary] 的"不留半完成实现"原则)。

---

## 3. M2.2 Line 三态 — 70% 已实现

### 3.1 已完整(🟢)

| Spec 项 | 现状 |
|---|---|
| 三个 path 风格 ref | ✅ `krig.line.{straight,elbow,curved}` 各 JSON 定义齐全 |
| press-drag-release 创建 | ✅ `tryStartDrawingLine` / `updateDrawingLine` / `tryFinishDrawingLine` (InteractionController) |
| magnet 16px 半径起手 | ✅ 同上 |
| addMode 落空取消 | ✅ 同上 |
| Rewire(拖端点重连) | ✅ `startRewire` / `updateRewiring` / `finishRewiring` / `cancelRewire` |
| 端点 handle 显示 | ✅ `lineEndpointHandles` 圆形 mesh |
| Hover 高亮(`#4A90E2`) | ✅ `setLineHighlight(group, on)` |
| OBB hit-test 旋转后选中 | ✅ M1.x.4 |
| magnet 旋转跟随 | ✅ M1.x.5 |
| Arrow marker 数据模型 | ✅ `style_overrides.arrow.{begin,end}` 6 种(none/arrow/triangle/diamond/oval/stealth) |
| Stroke color/width 数据 | ✅ `style_overrides.line.{color,width,dashType}` |

### 3.2 部分(🟡)

| Spec 项 | 现状 | 缺口 |
|---|---|---|
| Toolbar Line 顶级三态胶囊 | 🔴 line 仍埋在 LibraryPicker 的 Line 类目下 | UI 全做 |
| `lineKind` 字段(plain/arrow/connector) | 🔴 不存在 | schema 升级 |
| 自由 plain line(不绑 magnet) | 🔴 现在 `tryStartDrawingLine` 强制 magnet 起手,落空就退出 addMode | 需要新增 free-line 创建分支 |
| Arrow marker UI(8 种 dropdown) | 🔴 数据模型有,Inspector 完全没接 | UI 全做(数据模型已通) |
| Stroke dash UI(solid/dashed/dotted) | 🔴 `dashType` 字段在,但 Inspector 不暴露,LineRenderer 也未消费 | UI 全做 + LineRenderer 接 dashType |
| connector elbow 中段 waypoint handle | 🔴 完全没有 | 全做 |
| connector curved 中点控制柄 | 🔴 完全没有 | 全做 |

### 3.3 工作量修订

| 子任务 | Spec 估 | 修订估 | 原因 |
|---|---|---|---|
| M2.2a 数据模型迁移 | 0.25 天 | 0.25 天 | 不变(改 ref 拆出 lineKind/pathStyle) |
| M2.2b LineToolToggle.tsx | 0.25 天 | 0.25 天 | 不变 |
| M2.2c plain/arrow 自由创建 | 0.25 天 | 0.5 天 | **上调**:现 `tryStartDrawingLine` 强制 magnet,要分两条路径(connector 走老逻辑、line/arrow 走新自由路径) |
| M2.2d sub-popover 三态 | 0.5 天 | 0.5 天 | 不变 |
| M2.2e elbow midpoint + curved 控制柄 | 0.25 天 | 0.5 天 | **上调**:这是真新增,需要新 handle 类型 + 拖动逻辑 + waypoints 字段持久化 |

**M2.2 合计**:1.5 天 → **2 天**(微调)。

---

## 4. M2.3 Shape 浮条 — 共享原子组件已基本现成

### 4.1 已完整(🟢)

| Spec 项 | 现状 |
|---|---|
| Inspector Position(X/Y/W/H) | ✅ |
| Inspector Fill(no fill / solid + color) | ✅ |
| Inspector Line color + width slider | ✅(width 是数字 step=0.5,**不是离散 preset** — 与 spec §3.2.3 略有出入,但更精细) |
| 多选触发 Combine | ✅(已移到右键菜单,M1.x.10) |
| 选中 + handles 不弹 Inspector(默认隐藏) | ✅(M1.x UX 决策已落地) |

### 4.2 部分(🟡)

| Spec 项 | 现状 | 缺口 |
|---|---|---|
| `ShapeQuickBar.tsx` 浮条本身 | 🔴 完全没有 | 全做 |
| 三个 sub-popover(Fill/Stroke/Text) | 🔴 没有 | 全做(Fill/Stroke 字段可大量复用 FloatingInspector 当前实现) |
| `···` 显式溢出按钮进 Inspector | 🔴 没有 | 配套做 |
| 多选"Mixed"降级 | 🔴 现 Inspector 多选时只显 Combine 提示,不允许批量改属性 | 数据流改造(批量 update) |
| Stroke dash UI | 🔴 数据模型有,UI 没 | 同 §3.2 缺口 |
| Inspector 加 Arrow / Opacity / Gradient | 🟡 注释明确"v1.1" | 浮条 v1 砍 gradient,opacity 留 v1.1 |
| 共享原子组件抽出 | 🔴 当前 FloatingInspector 直接写 `<input type="color">` 等,没抽 ColorSwatch / StrokeStyleSelector | 重构抽 atom |

### 4.3 工作量修订

| 子任务 | Spec 估 | 修订估 | 原因 |
|---|---|---|---|
| M2.3a ShapeQuickBar 容器 + 位置策略 | 0.25 天 | 0.25 天 | 不变 |
| M2.3b 三个 sub-popover | 0.5 天 | 0.5 天 | 字段抄 Inspector 即可 |
| M2.3c 多选 Mixed 降级 | 0.25 天 | 0.5 天 | **上调**:现在多选完全不允许改属性,要把 update 通路改成批量 |
| M2.3d 共享组件抽取 | 0.25 天 | 0.5 天 | **上调**:Inspector 当前没抽 atom,这次顺便重构(否则 quickbar/inspector 有色板/笔触选择两套实现,违反 §3.2.5 决议) |

**M2.3 合计**:1.25 天 → **1.75 天**(上调)。

> **强提醒**:M2.3d 与 M2.2d 的 Stroke / Endpoints / PathStyle popover 共用同一组
> 原子(`ColorSwatch` / `StrokeStyleSelector` / `MarkerSelector`),建议把 M2.3d 提到
> M2.2d 之前做,后续 popover 直接享受成果 — 改动对工作量是节省,不是增加。

---

## 5. M2.4 文本节点 — 序列化管线现成,工作量大幅缩水

### 5.1 已完整(🟢)

| Spec 项 | 现状 |
|---|---|
| opentype.js 字体加载 | ✅ Inter + Noto Sans SC + JetBrains Mono 共 6 字体 |
| 字符级字体分段 | ✅ pickFontForChar + splitByFont |
| Atoms → SVG 序列化 | ✅ `atomsToSvg(atoms)` 主入口 |
| MathJax 公式 → SVG path | ✅ mathjax-svg.ts(已禁 fontCache 共享) |
| L1 SVG cache LRU | ✅ 容量 1000,带 hits/misses/hitRate stats |
| 富文本 marks(B/I/U/code) | ✅ |
| Block 类型(text/math/list) | ✅ |

### 5.2 部分(🟡)/ 完全缺失(🔴)

| Spec 项 | 现状 | 缺口 |
|---|---|---|
| 三级缓存 L2(ShapeGeometry+Material) / L3(整段 mesh) | 🔴 只 L1 | 加 L2 / L3 |
| Twemoji emoji 兜底 | 🔴 没有 | 加 emoji 资源 + 分段降级 emoji 走 image plane |
| Tofu(`□`)缺字符兜底 | 🔴 没有,静默返回空 path | 加 fallback 渲染 |
| NaN ShapeGeometry 防御 | 🔴 没在 serializer 这层做 | 在消费端(SvgGeometryContent)加 |
| `instance.type === 'text'` schema | 🔴 现仅 'shape' / 'substance' | 升级 |
| `TextNodeRenderer.ts`(SVG → Mesh) | 🔴 没有(`SvgGeometryContent.ts` 在 spec 列了但实际未建) | 全做 |
| Text 节点 Library 入口 | 🔴 现有 [text shape definitions](../../../src/plugins/graph/library/shapes/definitions/text/) 但实现未通 | 通管线 |
| Sticky 变种 | 🔴 没有 | 全做 |
| 编辑态浮 ProseMirror | 🔴 没有 | 全做 |
| 编辑态精简 toolbar | 🔴 没有 | 全做 |
| `atomsToSvg` 真正接通 Canvas | 🔴 zero consumer | 接 |

### 5.3 工作量修订

| 子任务 | Spec 估 | 修订估 | 原因 |
|---|---|---|---|
| M2.4a 字体加载 + 分段 + tofu | 0.5 天 | 0.25 天 | **下调**:5 字体已加载,只补 emoji + tofu |
| M2.4b atomsToSvg | 0.75 天 | 0 | **删**:已实现 |
| M2.4c L2/L3 缓存 + NaN 防御 | 0.5 天 | 0.5 天 | 不变 |
| M2.4d TextNodeRenderer | 0.5 天 | 0.75 天 | **微调**:含接通 atomsToSvg + SVGLoader → ShapeGeometry → Mesh |
| M2.4e 编辑态浮 ProseMirror + camera 同步 + toolbar | 0.5 天 | 1 天 | **上调**:这是真硬骨头,DOM/WebGL 坐标同步 + blur 序列化 + IME |
| M2.4f Sticky 变种 | 0.25 天 | 0.25 天 | 不变 |

**M2.4 合计**:2.5–3 天 → **2.75 天**(中位略降)。

> **强提醒**:`text` 已经有 [shape definitions](../../../src/plugins/graph/library/shapes/definitions/text/),
> 但 LibraryPicker 显示的应该只是占位(数据通路没接)。M2.4 第一步建议先改一个最小 PoC:
> **取一段固定 atoms → atomsToSvg → SVGLoader → ShapeGeometry → 拼到 mesh** 跑通端到端,
> 再去做编辑态。PoC 通过证明 §1.1 发现的"零消费者"管线可用,再往后投入。

---

## 6. M2.5 Note 引用节点 — 无变化,2 天估算 ✅

代码搜索未发现任何 `note_ref` / `NoteRefRenderer` / `referenced_in_graphs` 痕迹。
按原 spec 走,2 天估算保留。

唯一小细节:`instance.type` 在
[persist/serialize.ts](../../../src/plugins/graph/canvas/persist/serialize.ts)
当前只允许 `'shape' | 'substance'`,加 `'text'` / `'note_ref'` 时务必同步更新
**`sanitizeInstance` 中的 type 白名单**(否则反序列化会被钳为 default)。

---

## 7. 其他 spec 不准的细节(给 Canvas-M2-Spec.md 修订条目)

按重要度排序:

### 7.1 §0.1 表格新增列"实际进度"

```diff
| 编号 | 标题 | 优先级 | 复杂度 | M2 阶段 | 实际进度 |
|---|---|---|---|---|---|
| F-1 | 点阵网格底 | P0 | 小 | M2.1 | 🔴 全新 |
| F-3 | Line 顶级化 + 三态 toggle | P0 | 中 | M2.2 | 🟡 70%(数据模型 + 创建/rewire/handle 已通,差三态 UI + dash + waypoint) |
| F-5 | Shape 浮条 | P0 | 中 | M2.3 | 🟡 30%(Inspector 已有 Fill/Line 字段可复用) |
| F-2 | 文本节点 | P0 | 中-大 | M2.4 | 🟡 40%(atomsToSvg 完整但零消费者) |
| F-4 | Note 引用节点 | P1 | 中 | M2.5 | 🔴 全新 |
```

### 7.2 §6.1 总工时修订

| 阶段 | 原估 | 修订估 | 备注 |
|---|---|---|---|
| M2.1 | 0.5 天 | 0.5 天 | — |
| M2.2 | 1.5 天 | 2 天 | 上调(plain/arrow 自由路径 + waypoint) |
| M2.3 | 1.25 天 | 1.75 天 | 上调(批量 update + atom 抽出) |
| M2.4 | 2.5–3 天 | 2.75 天 | atomsToSvg 已现成抵消大部分上调 |
| M2.5 | 2 天 | 2 天 | — |
| **合计** | **7.75–8.25 天** | **9 天** | 微调 |

### 7.3 §2.3 line 数据模型 — 改"迁移"措辞

原 spec:
> 老格式由 deserialize 兼容映射

实际:line ref 一开始就是统一命名,M2 是把 path 维度从 ref 字段移到独立 `pathStyle` 字段,
不存在"老 schema 兼容"问题,直接把 ref 全量改写到 `'krig.line'`。

### 7.4 §7.5 schema_version

原 spec:`v1 → v2`。**事实错误**。改为 `v2 → v3`。

### 7.5 §8 模块结构

应改:
```diff
+# atom-serializers/svg 已存在(M1 期间预先建好,M2 接通即可),不需要 cherry-pick
-+src/lib/atom-serializers/svg/      # M2.4 复用 v2 backup 分支(从 backup/before-pg-refactor-2026-04-28 cherry-pick)
+src/lib/atom-serializers/svg/      # 已存在 — M2.4 仅需补 emoji 字体 + tofu + L2/L3 cache
 +├── blocks/
 +│   ├── textBlock.ts
 +│   ├── mathInline.ts
 +│   └── mathBlock.ts
+└── (现有结构保持,仅增 fonts/Twemoji.svg + 在 text-to-path 加 tofu fallback)
-+├── text-to-path.ts                  # opentype.js + 字体分段
-+└── fonts/                           # 预加载字体资源
```

### 7.6 §11 待办新增

```
- [ ] M2 启动前先把 Toolbar 占位按钮(`+ 新建` / `Open` / `🔄`)清理掉,
      避免和 §3.2.2 新增按钮(线条三态胶囊 + ▦ 网格)在同一条 toolbar 里混乱
- [ ] M2 启动前先把 atomsToSvg 的"零消费者"事实写进 project memory
      (避免后人误以为这是死代码删掉)
- [ ] M2.4 PoC 先行(单条固定 atoms 端到端跑通 SVG → mesh),通过再投编辑态
- [ ] Cmd+Z/Cmd+Shift+Z 已实现但 toolbar 没按钮,这点 spec 没漏,但代码注释"留 v1.1
      显示"和 spec 决议(快捷键替代,不显示)有出入,需要选定一种作为最终
```

### 7.7 §6.4 风险点新增

```
| Toolbar 占位按钮(Open / 新建 / SlotToggle)与 M2 新增按钮的视觉冲突 | 启动 M2 前清理占位 |
| atomsToSvg 接通后 marks 不全(strikethrough 当前由调用方画 path,Canvas 上无调用方 → 实际不支持) | M2.4 启动前列清单确认 marks 覆盖 |
| Combine 当前对 line 的限制("两端 instance 都必须 selected"才打包)与浮条 / 多选改属性矛盾 | 一并放宽到 line 单独可被打包 |
```

---

## 8. 迭代顺序建议(2026-04-30 修订)

### 8.1 修订背景

用户指出 toolbar 顶级会同时挂"文本三件套(`[A]` Text / `≡` Sticky / `田` Table)+ Shape
入口 + 线条三态胶囊 + 网格开关"等多组按钮,**toolbar 信息密度翻倍**;原排序
(M2.1 网格 → M2.2 Line → M2.3 浮条 → M2.4 文本 → M2.5 Note Ref)的问题是把最难、
最容易反复改 toolbar 的 Line 三态放在文本三件套之前做,等文本三件套做时又要重排
toolbar 一次。

同时用户对"M2.3d 共享原子抽取"的必要性提出质疑。核对
[FloatingInspector.tsx](../../../src/plugins/graph/canvas/ui/Inspector/FloatingInspector.tsx)
后确认:`NumField` / `ColorField` / `Section` / `Row` 这套通用控件**284–343 行已存在**,
内部封装了 commit-on-blur、Enter/Esc 处理、color picker 整合等关键逻辑;
它们是 module-private,改成 `export function` 即可被浮条复用,**工时 5 分钟级,不需要
单独拎一个阶段**。

真正要"抽"出来的 `StrokeStyleSelector`(笔触 4 种 dash)和 `MarkerSelector`
(arrow 8 种端头)Inspector **当前根本没有**(代码注释明确"v1 不做"),不是抽,是
**现做**;它们应该在 F-3 Line 三态阶段产出,因排序上 F-3 在 F-5 之后,F-5 浮条届时
直接共享即可。

### 8.2 修订后的 M2 排序

| 阶段 | 内容 | 工时 | 备注 |
|---|---|---|---|
| **M2.0** | Toolbar 重排 + 4 图标占位(`[A]` / Shape / `≡` / `田`)+ 清理旧占位(`+ 新建` / `Open` / `🔄`) | 0.25 天 | **杠杆动作**:布局先一次性敲定,后面 M2.4/M2.5/M2.6 不再推倒重来 |
| **M2.1** | F-2 Text + Sticky 节点 | 2.75 天 | 含 atomsToSvg 接通 PoC + 编辑态浮 ProseMirror;复用 5 字体 + L1 LRU |
| **M2.2** | F-2 Table 节点 | 0.25–0.5 天 | 二选一:**方案 A** toolbar 按钮先到位,点击弹"v1.5 上线"提示(0.25 天);**方案 B** 走 markdown table 兜底(0.5 天,补 tableBlock serializer) |
| **M2.3** | F-1 网格底 | 0.5 天 | 纯 shader plane;Toolbar `▦` 切换;`view.gridVisible` 持久化 |
| **M2.4** | F-5 Shape 浮条 | 1.5 天 | 顺手 export Inspector 现有 NumField/ColorField/Section/Row 给浮条复用(5 分钟级);Stroke dash UI 留 M2.5 共产出 |
| **M2.5** | F-3 Line 三态 | 2 天 | 产出 `StrokeStyleSelector`(4 种 dash)+ `MarkerSelector`(8 种端头);M2.4 浮条回头吃这两个共享原子 |
| **M2.6** | F-4 Note 引用 | 2 天 | 与画板核心解耦低,放最后独立验收 |
| **合计** | | **9.25–9.5 天** | 比原 9 天估多 0.25–0.5 天,M2.0 toolbar 先期投入是值的 |

### 8.3 排序判断的 3 条理由

按 ROI 排序,核心判断是**先做最便宜的脚手架,再做最常用的能力,最难最复杂的放最后**。

1. **M2.0 Toolbar 占位先行 = 脚手架最便宜**:
   现 [Toolbar.tsx](../../../src/plugins/graph/canvas/ui/Toolbar/Toolbar.tsx) 上
   `+ 新建` / `Open` / `🔄` 三个 `opacity:0.3` 占位 + 单一 `+ 添加`,M2 之后会塞
   `[A] / Shape / ≡ / 田 / 线条三态胶囊 / ▦ 网格`,**toolbar 信息密度翻倍**。
   先把 4 个文本/shape 图标的位置、间距、激活态视觉跑通,后面塞线条三态时不会推倒
   重来。

2. **M2.1 Text + Sticky 比 Line 三态门槛低**(虽然两者复杂度都不算小):
   - `atomsToSvg` 已完整(5 字体 + 字符级回退 + MathJax + L1 LRU),零消费者等着接
   - Sticky = Text + 黄色矩形背景 + padding,~0.25 天
   - 唯一硬骨头是编辑态浮 ProseMirror 与 Three camera 同步(M2.1e)~1 天
   - **而 Line 三态要同时改 7 个点**:三态胶囊 UI + lineKind/pathStyle 字段拆分 +
     plain/arrow 自由路径(现强制 magnet)+ 8 种 marker dropdown + dash UI +
     elbow waypoint + curved 控制柄
   - **用户体感 ROI**:M1 画板现在没文字节点等于半瘫;Line 已有 connector + rewire +
     arrow 数据模型 + hover 高亮,M1 状态已能用,延后不影响日常画板

3. **M2.5 Line 三态 / M2.6 Note Ref 放最后**:
   - Line 三态产出的 `StrokeStyleSelector` + `MarkerSelector` 是 M2.4 浮条的依赖,
     但顺序上反着做也行 — 浮条 v1 先 ship Color/Width/对齐,dash + marker 等 M2.5
     完成时一次回填补上,不阻塞验收
   - Note Ref 依赖 NoteView readonly 模式 + `referenced_in_graphs` 反查通道,与
     画板核心交互解耦,放最后可独立验收不阻塞前面

### 8.4 附:schema 升级时机

不论排序如何,**M2.1 启动时一次性升 `schema_version` v2 → v3**,把所有新字段
(gridVisible / instance.type='text'|'note_ref' / lineKind / pathStyle / waypoints /
endpoints_marker / instance.doc / instance.note_id)一次加齐,deserialize 兼容钳制
统一处理。**避免 M2.1 / M2.3 / M2.5 / M2.6 各自升一次 schema,reentry 风险高**。

### 8.5 旧版排序(留作对照,不再采用)

1. ~~M2.3 共享原子抽取~~ — 现 Inspector 已有 NumField / ColorField,只需 export,
   不需要单独阶段
2. ~~M2.1 网格底 + M2.2 Line 三态先做~~ — Line 三态太复杂且要反复改 toolbar,
   不适合放前面
3. ~~M2.4 文本节点先 PoC~~ — PoC 思路保留,但已并入 M2.1 第一天的工作
4. ~~M2.5 Note Ref 放最后~~ — 这条保留,顺序上变成 M2.6

---

**文档版本**:v0.1
**编写日期**:2026-04-30
**目的**:Canvas-M2-Spec.md 修订前的事实对照单
