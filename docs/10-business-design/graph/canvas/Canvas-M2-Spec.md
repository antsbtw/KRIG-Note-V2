# Canvas M2 迭代设计 — Freeform 体验对齐

> **范围**:M1(里程碑 1)17 项验收已通过后的第一阶段迭代。本文聚焦把
> [Freeform-Alignment-Backlog.md](./Freeform-Alignment-Backlog.md) 中的 5 个
> P0/P1 项落到 spec 级,补齐 [Canvas.md](./Canvas.md) §3 UI 与 §4 数据模型,
> 以及 §7 实施分阶段。
>
> **不是**:推翻 M1 已实现的 Toolbar / LibraryPicker / FloatingInspector /
> 选中态 / Line 创建/rewire,这些都保留。本文只**新增**和**改造**。
>
> **方法**:每个 backlog 项 → 业界做法对照(F-1..F-5 5 家产品)→ KRIG 决议
> → 数据模型 → UI 字段 → 验收清单 → 实施拆分。
>
> **调研声明**:本环境 WebSearch/WebFetch 不可用,横向对照来自既有产品认知
> (macOS Freeform / PowerPoint / Figma / FigJam / tldraw / Excalidraw /
> Lucidchart / draw.io / Miro / Whimsical / Notion / Obsidian Canvas /
> Heptabase / Logseq / Tana),非实时抓取。条目级置信度在子节点中标注;
> 进入实现前,关键参数(如 tldraw GRID_STEPS / Obsidian Canvas file 节点
> 字段)建议联网二次校对。

---

## 0. 总览与依赖

### 0.1 M2 范围(5 个 backlog 项)

| 编号 | 标题 | 优先级 | 复杂度 | M2 阶段 |
|---|---|---|---|---|
| F-1 | 点阵网格底 | P0 | 小 | M2.1 |
| F-3 | Line 顶级化 + 三态 toggle | P0 | 中 | M2.2 |
| F-5 | Shape 浮条 Fill/Stroke/Text | P0 | 中 | M2.3 |
| F-2 | 文本节点 Text/Sticky(Table 延后) | P0 | 中-大 | M2.4 |
| F-4 | Note 引用节点 | P1 | 中 | M2.5 |

### 0.2 实施依赖图

```
M2.1 网格底     ─┐
                 ├── 各自独立,M2.1/M2.2/M2.3 可并行
M2.2 Line 三态  ─┤
                 │
M2.3 Shape 浮条 ─┘
                 ↓
M2.4 文本节点  ── 依赖 M2.3 的 Text 子菜单字段对齐(浮条上的"Aa"按钮要能跳到文本节点编辑态)
                 ↓
M2.5 Note 引用 ── 依赖 atom/note 系统已稳定(已具备),与 M2.4 文本节点共享"小尺寸退化为标题卡"的渲染策略
```

### 0.3 与 M1 的关系

- M1 已建的基础设施**全部保留**:Toolbar / LibraryPicker / FloatingInspector /
  resize+rotate handles / OBB hit-test / Cmd+Z 撤销 / line 创建 / rewire / magnet
  跟随。
- M2 只新增组件 + 局部改造:
  - 新增:`GridBackground.ts` / `LineToolToggle.tsx` / `ShapeQuickBar.tsx` /
    `TextNodeRenderer.ts` / `NoteRefRenderer.ts`
  - 改造:Toolbar 加 Line 三态胶囊 + 网格开关;Picker 移除 Line 类目(顶级化后);
    Inspector 增 Substance Override 区(M1.6 已加,本文不改)

### 0.4 v1 范围严格剪裁(对齐 KRIG 哲学)

按 [feedback_branch_module_boundary] 与 [feedback_canvas_must_show_all_content],
本文不引入下列功能(即使 backlog 提及):

- **Table 节点**(F-2 一部分)→ 延后到 M3
- **Gradient / Pattern fill** → v1.3
- **Sketched style / Compound stroke** → v1.3
- **协同 / Yjs CRDT** → v2+
- **Variants 自定义 shape** → v1.5+(走 OWL ontology 路线)

---

## 1. M2.1 — 点阵网格底(F-1)

### 1.1 业界对照

| 产品 | 类型 | 间距 | LOD | 实现 |
|---|---|---|---|---|
| Freeform | dot | ~20pt | 低 zoom 抽稀,高 zoom 不加密 | native(推测) |
| FigJam | dot | 视觉恒定 | 0.25/0.5/1/2x 切档 | WebGL |
| **tldraw** | **dot** | base 8px,GRID_STEPS 3 级 | 屏幕间距 < 8px 切下一档,smoothstep 淡入淡出 | SVG `<pattern>` + `<rect>` 覆盖,pan 改 pattern 偏移 |
| Excalidraw | line | 20px 固定 | 无(zoom 极小变密糊) | Canvas 2D 每帧画线 |

**结论**:tldraw 的"多级 spacing + smoothstep 淡入淡出"是最成熟方案,直接借鉴其
LOD 思路,但实现技术换成 Three.js plane + fragment shader(不引入 SVG 层与
canvas 坐标系脱钩问题)。

### 1.2 KRIG 决议

| 项 | 决议 |
|---|---|
| 视觉 | 点阵(dot),不用 line / cross |
| 间距 | base S₀ = 40 world units;LOD 三级:S₀ / 5·S₀ / 25·S₀ |
| 颜色 | `#3a3a3a`(深色主题画板上的柔和点),alpha 0.45 |
| LOD 切换 | 屏幕间距 < 8px → 上调一级;两级之间用 `smoothstep` 交叉淡入(避免跳变) |
| zoom-to-cursor 协同 | 网格不存 world position,shader 仅读 `uCameraXY` + `uZoom`;zoom-to-cursor 改 camera,shader 自动跟齐 |
| 用户开关 | Toolbar 视图组加 `▦` 切换图标,默认开启;状态存到画板 view 字段(`viewBox.gridVisible`),per-graph 独立 |
| NaN 防御 | shader 端 `clamp(uZoom, 1e-4, 1e6)`,对齐 [feedback_fitcontent_nan_defense] |

### 1.3 实现技术

**单 plane + fragment shader**(zero draw call growth)。

- `GridBackground.ts`(~80 行):`PlaneGeometry(2,2)` + `ShaderMaterial`,挂在 scene
  最底层,depth 写 false。
- shader(~60 行):
  ```glsl
  // 伪码
  vec2 worldXY = (vUv - 0.5) * uViewportWorldSize + uCameraXY;
  float a1 = dotMask(worldXY, S0);          // 主层
  float a2 = dotMask(worldXY, 5.0 * S0);    // 次层(zoom 极小时露出)
  float blend = smoothstep(threshold-0.5, threshold+0.5, log2(uZoom));
  float a = mix(a1, a2, blend);
  gl_FragColor = vec4(uGridColor, a * uGridAlpha);
  ```
- 接入 SceneManager:`SceneManager.attachBackground(grid)`,在 RAF 回调里更新 uniforms。

### 1.4 验收

- [ ] 默认开启,深色画板上看到柔和深灰点阵
- [ ] 滚轮缩放时网格保持视觉密度恒定(不抽不堵)
- [ ] zoom 至 0.05x(下界)与 50x(上界)均不黑屏 / 不糊
- [ ] zoom-to-cursor 时网格中心跟随光标
- [ ] Toolbar `▦` 切换可隐藏 / 显示
- [ ] 关闭画板再打开,网格开关状态恢复

### 1.5 实施拆分(0.5 天)

- M2.1a:`GridBackground.ts` + shader + 挂载 SceneManager — 0.25 天
- M2.1b:Toolbar 视图组加 `▦` toggle + `viewBox.gridVisible` 序列化 — 0.25 天

---

## 2. M2.2 — Line 顶级化 + 三态 toggle(F-3)

### 2.1 业界对照

| 产品 | 入口 | plain/arrow/connector 区分 | sub-popover | 路径 |
|---|---|---|---|---|
| Freeform | 顶级单图标 + popover 4 preset | 不分(只是几何线) | Stroke / Stroke Style / Endpoints | 仅直线 + bezier |
| **PowerPoint** | Shapes 内 6 preset 平铺 | **plain 不绑,connector 绑 connection point** | Line + Arrows(begin/end type 各 6 marker)| straight / elbow / curved |
| FigJam | 顶级 Connector 按钮,胶囊 2 态 | **强制 magnet** | Stroke + start/end caps | Elbowed / Curved |
| draw.io | 左侧 + hover-shape 出 4 向蓝箭头 | 强制 magnet 但可断 | edgeStyle 6 种 + ~14 种 marker | orthogonal/curved/straight/isometric |
| Miro | 顶级 line tool + 浮条三态胶囊 | 非强制吸附 | line type / weight / start-end caps | straight / elbow / curved |

**结论**:PPT 的 plain/connector 双轨语义 + Miro 的三态胶囊 + Freeform 的 4 卡片
sub-popover 是 KRIG 的最佳混合。**强制 magnet 不学**(违反 KRIG 自由画板直觉),
**14 种 marker 不学**(过载),**默认 elbow 不学**(用户切换)。

### 2.2 KRIG 决议

#### 2.2.1 三态命名

`line` / `arrow` / `connector`(不用 plain — 用户读不懂"plain";line 的语义就是
"无端点装饰的几何线")。

#### 2.2.2 Toolbar 视觉

```
Toolbar(M2):
┌────────────────────────────────────────────────────────────────────┐
│ ‹ ›  画板标题   [+ 添加]  [─][↗][↪]  [↶][↷]  [🔍][↔][▦]  [+][Open][×] │
│                  │       │        │       │            │
│                  │       │        │       │            网格开关(M2.1)
│                  │       │        撤销/重做(M1.x.6)
│                  │       Line 三态胶囊(M2.2,新)
│                  Picker 入口(M1)
└────────────────────────────────────────────────────────────────────┘
```

胶囊容器内 3 个图标(28×28 px,蓝色高亮当前激活):

| 图标 | 态 | 语义 |
|---|---|---|
| `─` | line | 无端点装饰的几何线段 |
| `↗` | arrow | 末端单箭头(默认),起点可改 |
| `↪` | connector | 两端可吸附 shape magnet,移动 shape 自动重路由 |

#### 2.2.3 sub-popover(每态独立)

| 卡片 | line | arrow | connector |
|---|---|---|---|
| **Stroke** | color / width(0.5–20pt 数字)/ opacity 0–100% | 同 | 同 |
| **Stroke Style** | solid / dashed / dotted | 同 | 同 |
| **Endpoints** | 隐藏(强制 none/none) | start: none/arrow/triangle/diamond/circle-filled/circle-open/square/bar(8 选 1,默认 none);end: 同(默认 arrow)| 双端各 8 种 marker |
| **Path Style** | 隐藏 | 隐藏 | straight / elbow / curved 三选一(默认 straight) |

#### 2.2.4 创建手势(统一)

**press-drag-release**(对齐 Freeform / PPT / Miro)。

- 用户点 toolbar `─` / `↗` / `↪` 任一态 → 进入对应 addMode(光标 crosshair)
- mousedown:
  - `line` / `arrow`:任意位置 mousedown 即起手(无吸附要求)
  - `connector`:**必须在某 shape 的 magnet 16px 半径内**(沿用 M1.x.7),
    未命中则取消 addMode
- mousemove:预览跟随
  - `connector` 模式下,所有候选 shape 显示 magnet 蓝点
- mouseup:
  - `line` / `arrow`:落到任意位置即创建(不绑 magnet)
  - `connector`:落到 magnet 内 → 创建带 endpoints 的 line;落空 → 取消

#### 2.2.5 选中态

| 态 | 选中 handle | 中段编辑 |
|---|---|---|
| line | 2 端点 handle(M1.x.7b 已实现) | 无 |
| arrow | 2 端点 handle | 无 |
| connector / straight | 2 端点 handle(rewire) | 无 |
| connector / elbow | 2 端点 + **每个拐角处的黄色菱形 handle**(可拖动改拐角位置)| 拖菱形 handle 改 elbow 拐角(M2.2 新)|
| connector / curved | 2 端点 + 1 个中点控制柄 | 拖中点改曲率(M2.2 新) |

### 2.3 数据模型(扩 M1 schema)

`instances[].ref` 是 line 时,新增字段:

```jsonc
{
  "id": "i-002",
  "type": "shape",
  "ref": "krig.line",                // M1: krig.line.straight/elbow/curved 三个 shape
                                     // M2: 改为统一 "krig.line",由 lineKind 区分
  "lineKind": "connector",           // 'line' | 'arrow' | 'connector'(新)
  "pathStyle": "elbow",              // 'straight' | 'elbow' | 'curved',仅 connector 读(新)
  "stroke": {                        // 沿用 style_overrides.stroke
    "color": "#888",
    "width": 1.5,
    "dash": "solid"                  // 'solid'|'dashed'|'dotted'(新)
  },
  "endpoints_marker": {              // 新,line 类型独有
    "begin": "none",
    "end": "arrow"
  },
  "endpoints": [                     // 仅 connector 写(M1 已有)
    { "instance": "i-001", "magnet": "S" },
    { "instance": "i-003", "magnet": "N" }
  ],
  "waypoints": [                     // 仅 elbow connector 用户拖出的拐角(M2 新)
    { "x": 320, "y": 240 }
  ],
  "position": { "x": 100, "y": 100 },// 仅 line / arrow 用(没有 endpoints 时)
  "size": { "w": 200, "h": 0 }       // 仅 line / arrow 用
}
```

**迁移**:M1 数据中 `ref: 'krig.line.straight'` 等老格式由 deserialize 兼容映射到
`{ ref: 'krig.line', lineKind: 'connector', pathStyle: 'straight' }`(M1 实际只支持
connector 形态,迁移成本低)。

### 2.4 验收

- [ ] Toolbar 显示 Line 三态胶囊,当前激活态蓝色高亮
- [ ] 点 `─` → addMode → 任意点拖任意点 → 创建 plain line(无箭头,不绑 shape)
- [ ] 点 `↗` → addMode → 任意点拖任意点 → 创建 arrow line(末端默认箭头)
- [ ] 点 `↪` → addMode → 必须 magnet 起手,落空取消(M1 行为保留)
- [ ] connector 选中后 sub-popover 出现 Path Style 选项;line/arrow 选中无该选项
- [ ] arrow 选中后能改 begin/end marker(8 种)
- [ ] connector + elbow 模式下,中段拐角拖动改路径
- [ ] M1 已有 line 实例正确迁移到新 schema(打开旧画板不报错)

### 2.5 实施拆分(1.5 天)

- M2.2a:数据模型迁移 + deserialize 兼容 — 0.25 天
- M2.2b:Toolbar 三态胶囊组件(LineToolToggle.tsx) — 0.25 天
- M2.2c:line/arrow 创建手势(任意点起手,不绑 magnet) — 0.25 天
- M2.2d:每态 sub-popover(StrokePopover / EndpointsPopover / PathStylePopover) — 0.5 天
- M2.2e:elbow 中段菱形 handle + curved 中点控制柄 — 0.25 天

---

## 3. M2.3 — Shape 选中浮条:Fill / Stroke / Text(F-5)

### 3.1 业界对照

| 产品 | 位置 | 图标 | 多选策略 | 与完整面板关系 |
|---|---|---|---|---|
| **Freeform** | 节点下方跟随 | Fill / Border / Text | 显示交集,异类灰显 | 浮条 = 简化子集,长按进右侧 Format 抽屉 |
| Keynote | **不用浮条**,只有右侧 Format 面板 | — | — | — |
| PPT Web | 节点上方 mini toolbar(Office 经典)| 7-8 项(Fill/Outline/Font/B/I/U/对齐)| 显示通用 | mini toolbar 是 ribbon 高频项快捷入口 |
| Figma | **屏幕右侧固定**(不浮条) | Fill / Stroke / Effects / Layout | "Mixed" 占位 | 没有"浮条"概念 |
| FigJam | 节点下方胶囊浮条 | 5 项(Color/Border/Text size/Align/Emoji)| 显示通用 | 没有完整面板 |
| tldraw | **屏幕底部居中**或左侧 | Color/Fill style/Dash/Size/Font(离散 preset)| 显示交集,差异显 "—" | 唯一面板 |

**结论**:KRIG 已选定"单击浮条 + 双击 Inspector"混合(类 Freeform / FigJam),
本文进一步细化字段。**关键避坑**:用户难自发现"双击进高级",必须在浮条尾部加
显式溢出按钮(`···`)进 FloatingInspector。

### 3.2 KRIG 决议

#### 3.2.1 触发与位置

| 操作 | 行为 |
|---|---|
| 单击节点 | 显示选中边框 + handles(M1 行为)+ **下方浮 ShapeQuickBar**(M2 新) |
| 双击节点 | 关闭浮条 + 打开 FloatingInspector(M1 行为) |
| 浮条上点 `···` | 显式打开 FloatingInspector(浮条不关) |
| 多选(Shift-click)| 浮条仍显,字段降级:同质显当前值,异质显 "Mixed" 占位 |

**位置策略**:
- 默认贴节点 bbox 下方 12px(对齐 Freeform / FigJam)
- bbox 距画布底 < 60px → 翻到节点上方
- bbox 贴左右边 → 浮条向中间偏移(不出视口)
- 节点拖动时浮条跟随;zoom/pan 时浮条尺寸保持屏幕像素恒定(不跟节点缩放)

#### 3.2.2 浮条结构

```
┌─────────────────────┐
│ [●] [─] [Aa]   [···]│ ← 28×28 圆角图标 + 右侧溢出按钮
└─────────────────────┘
   Fill Stroke Text   More
```

#### 3.2.3 三个 sub-popover 字段

##### Fill popover

```
┌──────────────────────────────────┐
│ ○ No fill   ● Solid               │
├──────────────────────────────────┤
│ [■][■][■][■][■][■][■][■]  [+]    │ ← 8 色 swatch + 自定义
├──────────────────────────────────┤
│ Opacity: ──────●──── 80%          │
└──────────────────────────────────┘
```

字段:`fill.kind: 'none' | 'solid'`,`fill.color: string`,`fill.opacity: 0-100`。
**v1 不做 gradient / image / pattern**(对齐 Freeform 简洁路线)。

##### Stroke popover

```
┌──────────────────────────────────┐
│ Style:                            │
│ ⊘ ── ┄┄ ┈┈                        │ ← 4 种(none/solid/dashed/dotted)
├──────────────────────────────────┤
│ Width: [0.5][1][2][4][8] pt       │ ← 离散 preset(避免 slider 精度问题)
├──────────────────────────────────┤
│ [■][■][■][■][■][■][■][■]  [+]    │
├──────────────────────────────────┤
│ Opacity: ──────●──── 100%         │
└──────────────────────────────────┘
```

字段:`stroke.kind: 'none' | 'solid' | 'dashed' | 'dotted'`,`stroke.width`,
`stroke.color`,`stroke.opacity`。**不做 cap/join**(放 FloatingInspector)。

##### Text popover(对所有节点的 label)

```
┌──────────────────────────────────┐
│ Size: [12][16][20][24][32] pt     │ ← 离散字号
├──────────────────────────────────┤
│ [B] [I] [U] [S]                   │
├──────────────────────────────────┤
│ [←] [↔] [→]                       │ ← 对齐 3 项
├──────────────────────────────────┤
│ [■][■][■][■]                      │ ← 文字色
├──────────────────────────────────┤
│ [• 列表] [1. 列表]                 │
└──────────────────────────────────┘
```

字段:`text.size`,`text.bold`,`text.italic`,`text.underline`,`text.align`,
`text.color`,`text.list`。**v1 砍字体下拉**(放 Inspector;字体回退见 M2.4)。

#### 3.2.4 多选

| 节点组合 | 浮条字段 |
|---|---|
| 同类型 shape 多选(全 rect) | 全部字段正常,异质值 "Mixed" |
| 异类型 shape 多选(rect + ellipse) | 全部字段正常,异质值 "Mixed" |
| shape + line 混选 | shape-only 字段(Fill / Text)灰显 + tooltip "Line has no fill";Stroke 正常 |
| 全 line | 浮条仅显示 Stroke + Endpoints 简化版,隐藏 Fill / Text |

**禁止"整体隐藏浮条"**(否则多选编辑断手)。

#### 3.2.5 与 FloatingInspector 的共享

**共享(必须)**:`ColorSwatch` / `ColorPicker` / `StrokeStyleSelector`(4 种笔触)/
`NumberStepper`(pt/字号)/ `AlignToggleGroup` / `PopoverShell`(z-index/动画/dismiss
统一)/ `updateInstance(id, patch)` action(数据流唯一,避免双源不同步)。

**不共享**:浮条胶囊容器与 Inspector 卡片是两套形态,独立实现。

#### 3.2.6 避坑速记

- (a)Retina 下浮条用 `transform: translate3d` 防模糊
- (b)节点删除时浮条立即 unmount,不等动画
- (c)popover 内点击 `stopPropagation`,不冒泡到画布触发"取消选中"(Freeform 早期版踩过)
- (d)浮条 portal 渲染,避免被 mesh 的 z-index 压
- (e)选中切换时 popover 必须关闭并重置(不要 stale)

### 3.3 数据模型

无新字段,完全复用 `instance.style_overrides`(M1 已有的 fill / stroke / text 子结构)。

### 3.4 验收

- [ ] 单击 shape → 节点下方浮 3 图标胶囊 + 选中边框 + handles 同时显示
- [ ] 单击 line → 浮条只显 Stroke + Endpoints,Fill/Text 不显
- [ ] 点 Fill 图标 → 弹 popover,改色 → mesh 立即变色
- [ ] 点 Stroke 图标 → 弹 popover,改 dash → mesh 立即更新
- [ ] 点 Text(Aa)图标 → 弹 popover(label-bearing 节点;若节点无 label 则该图标灰显)
- [ ] 点 `···` → FloatingInspector 打开(浮条不关)
- [ ] 双击节点 → 浮条收 + Inspector 开
- [ ] Shift-click 多选 → 浮条字段正确降级("Mixed"/灰显)
- [ ] 节点贴画布底 → 浮条翻到上方
- [ ] 拖动节点时浮条跟随,zoom 时浮条尺寸不变
- [ ] 浮条与 Inspector 改值后双向同步(改一边,另一边重开后看到新值)

### 3.5 实施拆分(1.25 天)

- M2.3a:`ShapeQuickBar.tsx` 容器 + 位置策略(下方/翻转/边界)— 0.25 天
- M2.3b:Fill / Stroke / Text 三个 sub-popover — 0.5 天
- M2.3c:多选降级("Mixed" 占位 + 灰显) — 0.25 天
- M2.3d:与 FloatingInspector 数据流统一 + 共享组件抽取 — 0.25 天

---

## 4. M2.4 — 文本节点 Text / Sticky(F-2)

> Table 延后到 M3,理由见 §0.4。

### 4.1 业界对照

| 产品 | 渲染 | zoom 保真 | 编辑切换 | 富文本 |
|---|---|---|---|---|
| Freeform | native Text Kit(DOM 等价) | 矢量 | 双击 | B/I/U/对齐/列表/链接 |
| Figma | WebGL + glyph atlas(zoom 重栅格化) | 视觉无糊 | 双击 | B/I/U/列表/链接 |
| **tldraw** | **DOM `<div contenteditable>` 叠加 canvas**(CSS transform 跟随 camera) | DOM 天然矢量 | 双击 | 极简(size/align/color) |
| Excalidraw | DOM textarea 编辑 + canvas 2D `fillText` 展示 | 按 dpr 重绘 | 双击 | 无富文本 |
| Notion | DOM(非画板) | n/a | inline | 全套 |

**业界主流(tldraw / Figma / Excalidraw)都没用 opentype.js → SVG path 路线**。

KRIG 选这条是少有人走的路:
- **优点**:文字成为真正的 Three.js geometry,与 shape 共享渲染管线,zoom 矢量完美;
  可参与 3D 合并 / 挤出 / 特效;**KRIG 与 Freeform 的核心差异化**(NoteView 富文本能力直接复用)
- **缺点**:字体回退要自己实现(opentype.js 不会自动 fallback)

`backup/before-pg-refactor-2026-04-28` 分支的方案直接借鉴。

### 4.2 KRIG 决议

#### 4.2.1 三件套范围

| 件 | M2 范围 | 备注 |
|---|---|---|
| Text | ✅ 做 | 透明背景,纯文字 |
| Sticky | ✅ 做 | 浅黄背景,圆角,有轻微阴影 |
| Table | ❌ 延后 M3 | M2 内 Sticky / Text 节点可手输 markdown table 兜底 |

#### 4.2.2 三件套视觉规范

| 字段 | Text | Sticky |
|---|---|---|
| 背景 | 透明 | `#FFF59D`(经典黄,备选 5 色:黄/粉/蓝/绿/紫)|
| 边框 | 无(选中态显蓝色 ring) | 无 |
| 阴影 | 无 | `0 2px 6px rgba(0,0,0,0.12)` |
| padding | 8 world units | 16 world units |
| 默认尺寸 | auto-grow(随内容) | 200×200(固定,内容溢出 → 字号自动缩到 min 12pt;再溢出 → 滚动 mask) |
| 字号 | 16(默认) | 18(默认,稍大于 Text 表达"备忘录"语感) |

#### 4.2.3 渲染管线(沿用 v2 backup 分支方案)

```
Atom[] (PM doc)
  ↓ atomsToSvg(opentype.js)
SVG <path> 字符串
  ↓ SVGLoader(Three.js)
ShapeGeometry + Material
  ↓ Mesh 拼接
Three.js Group(节点 mesh)
```

关键源文件参考(v2 backup 分支):
- `src/lib/atom-serializers/svg/blocks/textBlock.ts`
- `src/lib/atom-serializers/svg/text-to-path.ts`(opentype.js 字体 outline 化 + 字符级中英 / 字重 / italic 切换)
- `src/lib/atom-serializers/svg/blocks/mathInline.ts` / `mathBlock.ts`
- `src/plugins/graph/rendering/contents/SvgGeometryContent.ts`(消费方)
- `src/plugins/graph/rendering/labels/*`(6 种 label 布局)

#### 4.2.4 字体回退策略(opentype.js + CJK + emoji)

opentype.js 一次只能加载一个字体,**必须自己分段**。

**分级降级**:
1. **预加载 3 份字体**:
   - `Inter`(拉丁)
   - `Noto Sans SC subset`(中文常用 3500 字)
   - `Twemoji SVG`(emoji,因 opentype.js 不支 COLR/CBDT 彩色 emoji)
2. **运行时分段**:字符串按 Unicode 区间切片 → 每段 `font.charToGlyph(c).unicode === 0`
   判断是否在该字体内 → 不在则降级到下一字体。
3. **emoji 兜底**:走 Twemoji SVG 直接当 image plane 拼到 mesh 队列(不走 path 序列化)。
4. **缺字符兜底**:全部字体都没该 glyph → 渲染成 `□`(tofu),不要静默丢失。
5. **三级缓存**(性能):
   - L1:glyph path 内存 cache(key = `${fontHash}:${codepoint}`)
   - L2:ShapeGeometry + Material 缓存(key 同上)
   - L3:整段 mesh 缓存(key = `string_hash + size + font_stack_hash`)
   - 上线后监测 L3 命中率,**< 30% 就要怀疑 key 设计错了**(v2 踩过)
6. **NaN 防御**(继承 [feedback_fitcontent_nan_defense]):每个 ShapeGeometry 出来后
   `computeBoundingBox()` + 4 分量 `Number.isFinite` 检查,不 finite 用占位矩形 fallback,
   防止 frustum NaN 黑屏。

#### 4.2.5 编辑/展示双模式

| 态 | 渲染 | 交互 |
|---|---|---|
| 展示态 | SVG → Three.js mesh | 不可输入,只可拖动 / 选中 / 改属性 |
| 编辑态 | 浮一个 ProseMirror DOM 编辑器在 mesh 上方(CSS transform 同步 camera) | 输入文字,blur + 200ms 防抖 → 重新序列化为 SVG 替换 mesh |

**切换**:
- 双击节点 → 进入编辑态(对齐 Freeform / tldraw 共识)
- Cmd+Enter 或单击空白 → 退出编辑态
- Esc → 退出且回滚未保存改动

**焦点设计**:
- Tab **不切节点**(避免与正文 Tab 缩进冲突)
- Enter 换行
- Cmd+Enter 退出编辑

#### 4.2.6 编辑态浮 toolbar

```
┌────────────────────────────────────┐
│ [B] [I] [Link] | [Size▾] | [← ↔ →] | [■] │  ← 跟随节点顶部浮动
└────────────────────────────────────┘
```

字段:`B / I / Link / Size / 对齐 / 颜色`,**精简版 NoteView toolbar**。

砍掉的(放 `/` slash menu,v3+):heading / list / code / quote / math / image。

#### 4.2.7 与 ProseMirror / NoteView 的关系

- 文本节点的内容**就是一段 PM doc**(atom 列表),与 NoteView 同 schema
- 因此公式 / 链接 / 富格式天然支持(只要 SVG 序列化覆盖到对应 atom 类型)
- v2 backup 分支已有 `mathInline.ts` / `mathBlock.ts`,M2 直接复用

### 4.3 数据模型

`instances[].type === 'text'`(新增第三种 type,与 `'shape'` `'line'` 平级):

```jsonc
{
  "id": "i-005",
  "type": "text",                   // 新增 type
  "ref": "krig.text" | "krig.sticky", // 区分 Text / Sticky
  "position": { "x": 100, "y": 100 },
  "size": { "w": 200, "h": 200 },   // Sticky 固定;Text 用作 wrap 宽度上限
  "doc": [                          // PM doc(atom 列表)
    { "type": "paragraph", "content": [{ "type": "text", "text": "Hello 世界 🌍" }] }
  ],
  "style_overrides": {
    "fill": { "color": "#FFF59D" }, // Sticky 用
    "text": { "size": 18, "color": "#222" }
  }
}
```

### 4.4 验收

- [ ] Picker 内 Text 类目下显示 Text / Sticky 两个 entry
- [ ] 单击 Text 添加 → 画布点击 → 实例化空 Text 节点(默认进编辑态,光标已就位)
- [ ] 输入 "Hello 世界 🌍" → 中英 emoji 三段渲染都正确
- [ ] 输入未覆盖 glyph 的字符 → 显示 `□`(不静默丢失)
- [ ] 编辑态浮 toolbar 出现在节点顶部,字段对齐 §4.2.6
- [ ] B/I/Link/Size/对齐/颜色 任一改 → 序列化后 SVG mesh 立刻更新
- [ ] zoom 至 50x → 文字不糊(矢量保真)
- [ ] zoom 至 0.05x → 文字不糊
- [ ] Sticky 默认黄色背景 + 阴影
- [ ] Sticky 内容溢出 → 字号自动缩到 12pt;再溢出 → 滚动 mask
- [ ] Cmd+Enter 退出编辑;Esc 退出且回滚
- [ ] 节点重启后内容完整恢复(doc 反序列化正确,字体回退一致)

### 4.5 实施拆分(2.5–3 天)

- M2.4a:opentype.js 字体加载 + 分段降级 + tofu 兜底 — 0.5 天
- M2.4b:`atomsToSvg` 序列化器(textBlock + paragraph + 行内 marks) — 0.75 天
- M2.4c:三级缓存 + NaN 防御 — 0.5 天
- M2.4d:`TextNodeRenderer.ts`(SVG → ShapeGeometry → Mesh) — 0.5 天
- M2.4e:编辑态浮 ProseMirror + 跟随 camera + toolbar — 0.5 天
- M2.4f:Sticky 变种(黄底 + 阴影 + 字号自适应) — 0.25 天

---

## 5. M2.5 — Note 引用节点(F-4)

### 5.1 业界对照

| 产品 | 节点视觉 | 双击 | 标题同步 | 反链 | 持久化 |
|---|---|---|---|---|---|
| Notion sub-page | 行内 icon + title | 跳子页 | 自动 | 有 | block 引用 |
| Notion page mention | 内联 @link | 跳页 | 自动 | 有 | inline atom |
| **Obsidian Canvas file** | **完整 markdown 内联渲染**,小尺寸退化标题卡 | 进 edit;Ctrl+点跳主视图 | 自动 | 1.6+ 算 | `{type:"file", file:"path"}` |
| Heptabase card | 标题 + 正文前几行 | 节点内全屏展开 | 自动 | 有(card library) | 整个产品就是 card on whiteboard |
| Logseq whiteboard | 页/块引用缩略卡 | 跳 page | 自动 | 有 | 块 ref |
| Tana node embed | inline 节点镜像 | 跳源 / 原地双向编辑 | 自动 | 强 | atom id |
| Freeform 附件 | 文件 icon + 名 | 关联 app 打开 | **不同步**(快照副本) | 无 | 内嵌副本 |

**结论**:Obsidian Canvas 是 KRIG 最接近的对标,但:
- **数据模型更干净**:Obsidian 用 path 字符串(rename 全 vault 重写),KRIG 用 atom id(rename 零成本)
- **不做内嵌编辑**:Obsidian 让 canvas 变 second editor,KRIG 坚持画板 = view,编辑回主 NoteView
- **反链是一等公民**:Obsidian 1.6 才补,KRIG 直接复用 derived_from 通道

### 5.2 KRIG 决议

#### 5.2.1 是否走 Substance 路线

**不走**。`note_ref` 是单独一类 instance,在 `instance.type` 上加 `'note_ref'` 与
`'shape'` / `'line'` / `'text'` 平级。

理由:substance 是"OOP 类的视觉规约"(标准化 fill / stroke / 标签布局),
note_ref 的视觉**完全由被引 note 决定**(标题 + 摘要动态),不存在"一个 substance
配多种实例"的复用关系。

#### 5.2.2 视觉(双态自适应)

```
大尺寸(>= 240×120):                    小尺寸(< 240×120):
┌─────────────────────────────┐        ┌────────────────┐
│ 📄 红楼梦人物关系考据         │        │ 📄 红楼梦人物... │
├─────────────────────────────┤        │   2026-04-30    │
│ 红楼梦中,贾宝玉与林黛玉的    │        └────────────────┘
│ 关系是全书核心。从第三回     │            标题卡退化
│ "金玉相会"开始,作者用大量    │
│ 笔墨刻画两人...              │
│                              │
│ [More 3 paragraphs]          │
└─────────────────────────────┘
   完整 NoteView readonly 渲染
```

- **大尺寸**:复用现有 `NoteView` 组件,readonly 模式,内嵌画布上方
- **小尺寸**:退化为标题卡(标题 + 修改时间 + 前 1 行摘要),节省屏幕空间
- **阈值**:240×120(可调)
- **图标**:左上角 `📄`(对齐 Obsidian)
- **选中边框**:与 shape 一致(蓝色 ring + 8 resize handle + 1 rotation handle)

#### 5.2.3 双击行为

- **双击** → 跳转到主 NoteView(替换当前画板,原画板可后退)
- **Cmd/Ctrl + 双击** → 在 right-slot 打开(画板与 note 并排显示)
- **单击 `📄` 图标** → 在 right-slot 打开(更直觉的入口,对齐 Obsidian "Open as new tab")
- **不**做"节点内编辑模式" — 编辑成本高(ProseMirror+IME+TOC 都要),与画板"移动/选择"语义打架

#### 5.2.4 持久化

```jsonc
{
  "id": "i-006",
  "type": "note_ref",               // 新增 type
  "ref": "krig.note_ref",
  "note_id": "note-xyz-123",        // 指向 note atom 的 id(不是 path,不是快照)
  "position": { "x": 100, "y": 100 },
  "size": { "w": 320, "h": 200 }
}
```

标题 / 摘要 / 修改时间 **全部运行时从 atom 读**,**不存快照**。

#### 5.2.5 重命名 / 删除处理

| 事件 | 处理 |
|---|---|
| 被引 note 标题改 | 自动同步(标题运行时 read,无需迁移逻辑) |
| 被引 note 内容改 | 自动同步(下一次渲染走最新 doc) |
| 被引 note 删除 | 节点变 broken 态:渲染区显 "📄 [原标题] · 已删除"(灰字),保留几何;不级联删 |
| 用户清理 broken | 右键 / 浮条 "清理失效引用",批量动作 |

#### 5.2.6 反向链接(v1 内做)

复用 `derived_from` 通道。给 note atom 加虚拟字段:

```ts
note.referenced_in_graphs: GraphId[]  // 从所有 graph.instances 反查得出(运行时计算 / 索引)
```

- NoteView 右栏新增"被引"区,列出"出现在以下画板":[画板 A] [画板 B]...
- 点击跳到该画板,自动选中对应 note_ref 节点
- 是 KRIG"画板 = note 的视图"叙事的核心证据,**不可省略**

#### 5.2.7 拖入手势(分阶段)

| 手势 | 阶段 | 实现 |
|---|---|---|
| NavSide note 拖到画板 | M2.5 | 已有 dnd-kit,扩 drop target;拖到画布即创建 note_ref |
| 画板内 `@` 命令 → note picker | M2.5 | 复用 NavSide 搜索 |
| Toolbar Picker 内"Note Ref"分类 + 搜索 | M2.5 | 沿用 LibraryPicker UI,加 note 搜索分类 |
| 命令面板"Insert note ref" | M3 | 全局命令面板 |

### 5.3 数据模型

新增 `instance.type === 'note_ref'`(见 §5.2.4)。

note atom 加 derived 字段:

```ts
// 不存,运行时计算或独立索引表
type NoteRefIndex = {
  [noteId: string]: GraphId[]
}
```

### 5.4 验收

- [ ] NavSide 拖一篇 note 到画板 → 创建 note_ref 节点(默认 320×200,显示完整 NoteView)
- [ ] 拖小到 < 240×120 → 退化为标题卡
- [ ] 拖大回去 → 恢复完整渲染
- [ ] 改源 note 标题 → 节点标题自动同步(无需重启)
- [ ] 改源 note 内容 → 节点内容下次渲染同步
- [ ] 删除源 note → 节点变 broken("已删除"灰字),不级联删
- [ ] 双击节点 → 主视图切到该 note
- [ ] Cmd+双击 → right-slot 打开该 note
- [ ] 单击 `📄` 图标 → right-slot 打开
- [ ] 在画板内 `@` → note picker 弹出 → 选 note → 创建 note_ref
- [ ] Toolbar Picker 内"Note Ref"分类显示最近 note 列表 + 搜索
- [ ] NoteView 右栏"被引"区显示"出现在以下画板"列表
- [ ] 点击"被引"列表项 → 跳到该画板,自动选中 note_ref
- [ ] 重启应用 → note_ref 节点完整恢复(note_id 关联生效)

### 5.5 实施拆分(2 天)

- M2.5a:`note_ref` instance type + 持久化(serialize/deserialize) — 0.25 天
- M2.5b:`NoteRefRenderer.ts`(大尺寸 NoteView readonly 嵌入 + 小尺寸标题卡) — 0.75 天
- M2.5c:NavSide 拖入 + Toolbar Picker"Note Ref"分类 + `@` 命令 — 0.5 天
- M2.5d:反向链接索引 + NoteView 右栏"被引"区 — 0.5 天

---

## 6. 总实施计划与里程碑

### 6.1 阶段拆分

| 阶段 | 内容 | 时间 |
|---|---|---|
| **M2.1** | 点阵网格底 | 0.5 天 |
| **M2.2** | Line 三态 toggle + sub-popover + waypoints | 1.5 天 |
| **M2.3** | Shape 浮条 Fill/Stroke/Text + 多选降级 | 1.25 天 |
| **M2.4** | 文本节点 Text/Sticky(SVG path + opentype + 编辑态) | 2.5–3 天 |
| **M2.5** | Note 引用节点 + 反向链接 | 2 天 |
| **合计** | | **7.75–8.25 天** |
| 用户验证(全 §1.4 / §2.4 / §3.4 / §4.4 / §5.4 验收清单) | | 0.5 天 |

### 6.2 分支策略(对齐 [feedback_branch_module_boundary])

- 分支:`feature/graph-canvas-m2`(从 main 切出,M1 已合)
- M2.1 ~ M2.5 子任务在分支内连续 commit,**不中途合 main**
- 每个 M2.x 完成跑一次相关验收;**全 5 项过才合 main**
- M2.4 因复杂度偏大,可切子分支 `feature/graph-canvas-m2-text` 隔离(开发完合回 m2 主分支)

### 6.3 与 family-tree(里程碑 2 原计划)的关系

按 [Canvas.md §7](./Canvas.md#7-v1-实施分阶段里程碑-1) 原排期,M1 通过后应进入
family-tree variant。M2(本文)是**插队**,理由:

1. **F-1/F-3/F-5 是核心体验断点**:M1 验收已暴露(网格底空旷 / line 入口太深 /
   shape 改属性走右上 Inspector 太重),用户已有体感差距
2. **F-2/F-4 是差异化卖点**:文本富文本 + note 引用是 KRIG vs Freeform/Obsidian
   Canvas 的核心区分,先做出来才能验证 KRIG 叙事
3. **family-tree 等 variant 必然消费这些底层能力**(line 三态 / 浮条 / 文本节点),
   先把 Canvas 打磨好再做 variant 更稳

如果时间紧,可只做 **M2.1 + M2.2 + M2.3**(3.25 天),把 M2.4 / M2.5 留到 family-tree
M2 之间;但建议一次性推完,避免回头打补丁。

### 6.4 风险点

| 风险 | 缓解 |
|---|---|
| M2.4 字体回退踩坑(emoji 静默丢失 / L3 cache 命中率低 / 退化几何 NaN) | 三件套防御齐全(tofu fallback + cache key 监测 + isFinite 检查);按 v2 backup 分支既有教训 |
| M2.4 编辑态浮 ProseMirror 与 Three camera 同步 | tldraw 已验证 CSS transform 跟随 camera matrix 可行,直接照搬 |
| M2.5 反向链接索引性能(画板多时反查慢) | v1 用运行时遍历 + 内存索引,数据量过大时再做持久化索引 |
| M2.2 elbow 中段菱形 handle 与 line rewire 端点 handle 的命中冲突 | 优先级:waypoint > endpoint > line body;hit-test 半径分别 8/6/4 |
| M2.3 浮条 popover 与 FloatingInspector 同时打开时遮挡 | 浮条 popover 打开时 Inspector 自动让位(右移或半透明);单一时刻只能一个聚焦 |

### 6.5 测试计划骨架

新建 `M2-Test-Plan.md`(对齐 [M1-Test-Plan.md](./M1-Test-Plan.md) 风格):

```
Test M2.1   网格底默认开 + zoom 不糊
Test M2.1b  网格 toggle 切换 + 状态恢复
Test M2.2a  Line 三态切换 + 创建手势
Test M2.2b  arrow marker 8 选 1
Test M2.2c  connector elbow + waypoint 拖动
Test M2.3a  单击 shape 浮条出现 + 字段正确
Test M2.3b  浮条 vs Inspector 双向同步
Test M2.3c  多选 "Mixed" 降级
Test M2.4a  Text 中英 emoji 渲染 + tofu 兜底
Test M2.4b  Sticky 字号自适应 + 阴影
Test M2.4c  编辑态浮 toolbar + Cmd+Enter / Esc
Test M2.5a  NavSide 拖 note → note_ref 节点
Test M2.5b  小/大尺寸自适应切换
Test M2.5c  源 note 标题改 → 节点同步
Test M2.5d  反向链接 NoteView 右栏"被引"区
```

每条 Test 需明确入口、预期、失败迹象(对齐 M1-Test-Plan 模板)。

---

## 7. 数据模型变更总览

### 7.1 instance.type 扩展

| 旧(M1) | 新(M2) |
|---|---|
| `'shape'` / `'substance'` | 加 `'text'` / `'note_ref'`(line 仍归 shape,通过 lineKind 区分) |

### 7.2 instance 字段总览(M2 版)

```ts
type Instance = {
  id: string
  type: 'shape' | 'substance' | 'text' | 'note_ref'  // M2 新增 text / note_ref
  ref: string                                         // shape: krig.basic.X / krig.line / krig.text / krig.sticky / krig.note_ref
  position?: Vec2                                     // shape / line / arrow / text / note_ref(connector 不读)
  size?: Vec2                                         // 同上
  rotation?: number                                   // 度数(M1.x.1)
  params?: Record<string, number>                     // shape 参数(M1)
  props?: Record<string, any>                         // substance props(M1)
  style_overrides?: StyleOverrides                    // M1 已有
  doc?: AtomList                                      // M2 新:type='text' 时存 PM doc
  note_id?: string                                    // M2 新:type='note_ref' 时存被引 note id
  // line 特有(M2 重构)
  lineKind?: 'line' | 'arrow' | 'connector'
  pathStyle?: 'straight' | 'elbow' | 'curved'         // 仅 connector 读
  endpoints?: [Endpoint, Endpoint]                    // 仅 connector 写
  endpoints_marker?: { begin: MarkerType, end: MarkerType }  // 仅 line / arrow 读
  waypoints?: Vec2[]                                  // 仅 elbow connector
}
```

### 7.3 viewBox 字段扩展

```ts
type ViewBox = {
  x: number; y: number; w: number; h: number
  gridVisible?: boolean    // M2 新:网格底开关 per-graph
}
```

### 7.4 derived note 字段(虚拟,不持久化)

```ts
type Note = {
  ...
  // 虚拟字段(运行时反查得出 / 独立索引表)
  referenced_in_graphs?: GraphId[]
}
```

### 7.5 schema_version 提升

从 M1 的 `schema_version: 1` 升到 `schema_version: 2`。

deserialize 时:
- 老 schema 的 `ref: 'krig.line.straight' / 'krig.line.elbow' / 'krig.line.curved'`
  自动迁移到 `{ ref: 'krig.line', lineKind: 'connector', pathStyle: 'straight' | 'elbow' | 'curved' }`
- 老 schema 无 `instance.doc / note_id / lineKind / waypoints` 等新字段,deserialize
  按缺省处理

---

## 8. 模块结构变更

```diff
src/plugins/graph/canvas/
├── CanvasView.tsx
├── scene/
│   ├── SceneManager.ts
│   ├── pan-zoom.ts
+   ├── GridBackground.ts          # M2.1 新
│   └── render.ts
├── interaction/
│   ├── InteractionController.ts
│   ├── magnet-snap.ts
│   └── add-mode.ts
├── ui/
│   ├── Toolbar/
│   │   ├── Toolbar.tsx
+   │   └── LineToolToggle.tsx     # M2.2 三态胶囊
│   ├── LibraryPicker/...
│   ├── Inspector/
│   │   ├── FloatingInspector.tsx
│   │   ├── ...(M1)
+   │   └── shared/                # M2.3 抽出共享原子组件
+   │       ├── ColorSwatch.tsx
+   │       ├── ColorPicker.tsx
+   │       ├── StrokeStyleSelector.tsx
+   │       ├── NumberStepper.tsx
+   │       ├── AlignToggleGroup.tsx
+   │       └── PopoverShell.tsx
+   ├── ShapeQuickBar/              # M2.3 浮条
+   │   ├── ShapeQuickBar.tsx
+   │   ├── FillPopover.tsx
+   │   ├── StrokePopover.tsx
+   │   └── TextPopover.tsx
+   ├── LinePopover/                # M2.2 三态各自 sub-popover
+   │   ├── StrokePopover.tsx       # 复用 shared
+   │   ├── EndpointsPopover.tsx
+   │   └── PathStylePopover.tsx
+   ├── TextNode/                   # M2.4 文本节点
+   │   ├── TextNodeRenderer.ts     # SVG → Mesh
+   │   ├── EditingOverlay.tsx      # 浮 ProseMirror 编辑器
+   │   └── EditingToolbar.tsx      # 编辑态精简 toolbar
+   ├── NoteRef/                    # M2.5 note 引用
+   │   ├── NoteRefRenderer.ts      # 大尺寸 NoteView + 小尺寸标题卡
+   │   ├── NotePickerOverlay.tsx   # @ 命令 / Picker 分类
+   │   └── BrokenRefPlaceholder.tsx
│   └── dialogs/
│       └── CreateSubstanceDialog.tsx
├── persist/
│   ├── serialize.ts                # M2 加 text / note_ref / lineKind / waypoints
│   ├── deserialize.ts              # M2 加迁移逻辑(schema_version 1 → 2)
│   └── note-binding.ts
├── api/...
├── register.ts
└── index.ts

+src/lib/atom-serializers/svg/      # M2.4 复用 v2 backup 分支(从 backup/before-pg-refactor-2026-04-28 cherry-pick)
+├── blocks/
+│   ├── textBlock.ts
+│   ├── mathInline.ts
+│   └── mathBlock.ts
+├── text-to-path.ts                  # opentype.js + 字体分段
+└── fonts/                           # 预加载字体资源
+    ├── inter.woff
+    ├── noto-sans-sc-subset.woff
+    └── twemoji.svg
```

---

## 9. 与既有 KRIG 模块的关系

- **Library**:line 三态共用同一个 shape `krig.line`(M2 替换 M1 的三个 line shape);
  Text / Sticky 各占一个 shape(`krig.text` / `krig.sticky`);Note Ref 占一个虚拟
  shape(`krig.note_ref`,无 magnet)
- **NoteView**:M2.5 note_ref 节点直接复用 NoteView(readonly 模式);M2.4 文本节点
  共享 ProseMirror schema 但不复用整个 NoteView 容器(画板上文本节点与文档级 note
  是不同 IO 边界)
- **NavSide**:M2.5 拖入手势扩展 NavSide 现有 dnd-kit drop target
- **substance**:M2 范围内不改 substance 模型(M1.x.10 已建)
- **Atom 系统**:Note Ref 与 NoteView 都依赖 `note.referenced_in_graphs` 虚拟字段,
  这是 KRIG 知识图谱叙事的核心证据(画板↔note 闭环)

---

## 10. 参考资料

### 调研依据(本次未联网,基于既有产品认知)

- [macOS Freeform 用户指南](https://support.apple.com/guide/freeform/welcome/mac)
- [Microsoft PowerPoint Format Shape](https://support.microsoft.com/en-us/office/format-a-shape-or-other-graphic-effects-cf1bb2d3-cdc0-4d50-a14f-9e83fbcadb45)
- [Figma / FigJam Help](https://help.figma.com/)
- [tldraw GitHub](https://github.com/tldraw/tldraw)(GRID_STEPS / TextShapeUtil)
- [Excalidraw GitHub](https://github.com/excalidraw/excalidraw)
- [Lucidchart Help](https://help.lucid.co/)
- [draw.io GitHub](https://github.com/jgraph/drawio)
- [Obsidian Canvas](https://obsidian.md/canvas) + [JSON Canvas spec](https://jsoncanvas.org/)
- [Heptabase whiteboard](https://heptabase.com/)
- [Logseq whiteboard](https://logseq.com/)
- [Tana docs](https://tana.inc/docs)
- [Notion page mention / sub-page](https://www.notion.so/help)

### 内部 spec

- [Canvas.md](./Canvas.md) — Canvas v1 spec(M1)
- [Freeform-Alignment-Backlog.md](./Freeform-Alignment-Backlog.md) — backlog 来源
- [M1-Test-Plan.md](./M1-Test-Plan.md) — M1 测试模板(M2-Test-Plan 对齐)
- [Library.md](../library/Library.md) — Shape + Substance 资源库
- [family-tree.md](../family-tree/family-tree.md) — Canvas 之后的下一个 variant

### KRIG 关键 memory

- [feedback_canvas_must_show_all_content] — fitToContent 是底线
- [feedback_threejs_retina_setsize] — Retina setSize 第三参数
- [feedback_canvas_container_must_always_render] — 容器始终渲染
- [feedback_fitcontent_nan_defense] — NaN 防御
- [feedback_branch_module_boundary] — 分支按模块切
- [feedback_variants_inherit_basic] — 变种继承 basic
- [project_graph_architecture] — Library + Canvas + Variants 三组件
- [project_b3_pattern_spec_decisions] — Pattern 11 决议(对 M2.5 反向链接有借鉴)

---

## 11. 待办与风险登记

- [ ] M2 全程在 `feature/graph-canvas-m2` 分支推进,M2 完成前不合 main
- [ ] M2.4 启动前先做一个最小 PoC(单个汉字 + emoji 走完 SVG path → mesh 全流程),
      验证 opentype.js + Twemoji + Three.js SVGLoader 链路可行;PoC 通过再正式开发
- [ ] M2 期间发现的新 backlog 项(超出 F-1..F-5 的)记入
      [Freeform-Alignment-Backlog.md](./Freeform-Alignment-Backlog.md) 的"(待补)"区,
      不在 M2 内做
- [ ] 实现前对 tldraw GRID_STEPS / Obsidian Canvas file 节点字段做一次联网二次校对
      (本文调研基于训练知识,精确数值需核对)

---

**文档版本**:v0.1(M2 spec 草案,基于 M1 17 项验收已通过的前提)
**编写日期**:2026-04-30
**前置文档**:Canvas.md v1 / Freeform-Alignment-Backlog.md v1
