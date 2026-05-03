# Freeform 对齐 Backlog

M1 验收通过后,对照 macOS Freeform 整理出的体验缺口清单。**不在 M1 范围**;
这是 M2+ / v1.x 的迭代源。

记录原则:
- 用户主观测过有体感差距的项 > 社区调研项(避免大杂烩)
- 每项标:优先级(P0/P1/P2)+ 实现复杂度估算 + 阻塞性

## 总览

| 编号 | 标题 | 优先级 | 复杂度 | 关键词 |
|---|---|---|---|---|
| F-1 | 点阵网格底 | P0 | 小 | 视觉锚点 / 对齐辅助 |
| F-3 | Line 顶级化 + 三态 toggle | P0 | 中 | 直线/箭头/连接器 |
| F-5 | Shape 浮条 Fill/Stroke/Text | P0 | 中 | 单击快速,双击高级 |
| F-2 | 文本三件套 Text/Sticky/Table | P0 | 中-大 | SVG path 路径,复用 NoteView |
| F-6 | 渲染态行内链接(标识 + 点击) | **P0** | 中 | SVG link 视觉 + hit-rect overlay |
| F-4 | Note 引用节点 | P1 | 中 | 画板与 note 系统打通 |
| F-8 | Group / Ungroup | P1 | 中 | 多对象关系,context menu 入口 |
| F-9 | Sticky 颜色调色盘 | P1 | 小 | 浮条 / Inspector 7 色选择(对齐 Freeform) |
| F-10 | 文本节点垂直对齐 | P1 | 小 | Text/Sticky vertical-align: top/middle/bottom |
| F-12 | 共享 ContextMenu 注册框架 | P1 | 中 | NoteView/Canvas 复用 + 注册式 contributions |
| F-7 | 字号 / 字体切换 | P2 | 大 | 跨 NoteView + 画板,需新 mark |

**实施依赖**:
- F-3 改 toolbar 顶级 → F-2 文本三件套依赖 toolbar 已重组完
- F-2 复用 backup 分支的 SVG 路径方案 → F-5 的 Text 子菜单挂这个
- **F-6 依赖 F-2 文字节点已落地**(M2.1 已完成),作为 M2.1 功能补完接做
- F-1 / F-3 / F-5 相互独立,可并行

**核心差异化**(不只是抄 Freeform):
- F-2 文本节点 = SVG path 序列化 + ProseMirror 编辑,**碾压 Freeform 文本能力**
- F-4 Note 引用 = 画板嵌入 note,**画板成为 note 的视图**(KRIG 核心抽象)
- 不做 Freeform 的 `📎` 附件、Scenes 场景书签等(F-4 已替代附件;Scenes 是 P2 边缘)

## 视觉 / 画板底

### F-1 点阵网格底(P0,小)
- 现状:画板纯黑背景,无视觉锚点
- Freeform:浅灰小点阵(间距约 24px),提供视觉对齐参考
- 实现:SceneManager 加一层 InstancedMesh 或 shader plane,zoom 时密度自适应
  (zoom 太小时点会糊在一起 → 切换到稀疏版)
- 价值:对齐辅助 + 减少"空旷无定位"感

## 交互

### F-8 Group / Ungroup(P1,中)

- **动机**:用户经常想把"自己组合的几个对象"绑成一个整体 — 一起拖动 / resize /
  rotate / 选中,需要时再拆开.对齐 Figma / Freeform / PowerPoint 的 group 模型
- **不要混淆**:Group 是**用户主动组合多对象的关系**;Sticky 是**单对象**(M2.2
  已实现的文字节点带背景);substance 是**系统/库提供的预设类**.三者正交,不要
  互相借用实现路径
- **现状**:M2.1 之前用 substance 体系勉强模拟过组合,但 substance 不能 ungroup
  (它是 class,不是关系);M2.1 后画板已能多选,但缺"绑成一体"的关系层
- **方案**:
  - **数据**:Instance 加 `group_id?: string` 字段;同 group 的 instance 共享一个 id
  - **交互**:
    - 多选 + 右键 / Cmd+G → Group(分配新 group_id,选区 instance 全部打上)
    - Group 选中 → 单击任一成员等价选中整个 group(选区 = 同 group_id 的所有 instance)
    - 右键 group / Cmd+Shift+G → Ungroup(清掉 group_id)
    - 双击 group → 进入 group 内编辑(Figma 风格;v1.x 再做,v1 直接 Ungroup 后改)
  - **持久化**:序列化天然支持(Instance 字段);反序列化无特殊处理
- **关键文件**:
  - `src/plugins/graph/library/types.ts` — Instance 加 group_id 字段
  - `src/plugins/graph/canvas/interaction/InteractionController.ts` — 选区
    扩展(单击成员选整 group);拖动 / resize / rotate 时 group 内同步变换
  - `src/plugins/graph/canvas/ContextMenu.tsx` — 加 Group / Ungroup 菜单项
- **复杂度**:中.~200 行,主要在 InteractionController 选区 / 变换协调
- **价值**:常用功能;P1 不紧急,M2.x 中后期排

## 工具栏 / Toolbar

### F-4 Note 引用节点(P1,中)
- 不做 Freeform 的 `📎` 附件按钮 — KRIG 用 note 管资产,画板自造附件存储
  会让数据分散
- 改为画板可插入"note 引用节点":显示被引 note 的标题 + 缩略 / 摘要,
  双击跳到该 note 查看完整内容(含 note 内的附件)
- 类似 Notion 的 "page mention" 或 Obsidian 的 "embed note"
- Toolbar 入口可以与 [A] / [≡] / [#] 同级,记号 `[📄] Note Ref`,
  也可以放在 Picker 的特殊类目
- 价值:画板与 note 系统打通,体现 KRIG 的"知识图谱视角是对 note 的呈现"
  核心理念

### F-3 Line 提到 toolbar 顶级 + 三态 toggle 设计(P0,中)
- 现状:line 埋在 Picker 的 Line 类目下(3 种:straight / elbow / curved),
  入口太深
- **对齐 Freeform 三态 toggle**:toolbar 上是一个胶囊容器,容器内 3 个 icon:
  ```
  [ /  ↗  ↪ ]
   直线 箭头 连接器
  ```
  当前激活态用蓝色高亮。点 toolbar 这个胶囊先选 line 模式,再去画布画
- **三态语义**:
  - **`/` 直线**(Plain Line):两端任意,无箭头。用于画分隔 / 批注 / 划重点
  - **`↗` 箭头**(Arrow):两端任意,但默认起点无 arrow / 终点 arrow。
    强调方向性,不绑 shape
  - **`↪` 连接器**(Connector):两端必须吸附 shape magnet(= M1.x.7 当前实现)。
    强调"连接"语义
- **关键区分:自由线只需直线,connector 才需要 elbow/curved**
  - 自由线(plain / arrow):用户自己控制起终点,要绕路自己拖鼠标 →
    **路径只用直线**,不需要 elbow / curved
  - connector:两端绑 magnet 自动算路径,绕开 shape 时需要 elbow,
    或表达"柔性连接"用 curved → **必须三种路径可选**
- **每态选中后 toolbar 浮 sub-popover**(对应 Freeform 的 4 张截图):
  - 直线选中 → Stroke Style:线型 4 种(实/短虚/点/长虚)+ 线宽 + 颜色
  - 箭头选中 → Line Ends:起点 / 终点的箭头形状(各一个下拉,
    支持 none / arrow / triangle / diamond / oval / stealth — 已在
    `LineStyle.arrow` 接口里有)
  - **连接器选中** → Connection Style:3 种路径形状(直 / 阶梯 / 曲线
    = straight / elbow / curved)— **仅这一态有这个选项**
- **统一数据模型**:line 实例加两个属性,取代当前的 `ref` 区分:
  - `lineKind: 'plain' | 'arrow' | 'connector'`
  - `pathStyle: 'straight' | 'elbow' | 'curved'` — **仅当 lineKind='connector' 时有效**
  - 配合 `style_overrides.arrow.{begin, end}`(已有)调端头
  - `endpoints` 字段仅 connector 用;plain / arrow 用 position + size
- 复杂度:中。需要:
  - toolbar 三态胶囊组件(对齐 Freeform UI)
  - 每态 sub-popover(可复用现有 FloatingInspector 模式)
  - plain / arrow 走 mousedown-drag-mouseup 自由路径(不绑 magnet)
  - connector 沿用 M1.x.7 press-drag-release 模式
  - 统一 `LineRenderer.renderLine` 接受 lineKind + pathStyle
- 价值:**最高频的画板原子,入口必须顶级**;Freeform 的三态设计极简,
  我们直接照搬

### F-2 文本节点三件套:Text / Sticky / Table(P0,中-大)
- Freeform toolbar 上有三件:`[A]` 文字框(透明)、`[≡]` 便签(不透明背景文本块)、
  `[#]` 表格(透明)。每件都是"可放置在画布的文本容器"
- Freeform 的硬伤:**文本表达力弱**(无公式、无富格式、无链接)
- KRIG 的优势:**NoteView 是 ProseMirror 富文本编辑器**,已支持公式、链接、
  TOC、任意 block;直接复用即可碾压 Freeform
- 实现方向:画布上添加一个"文本节点",其内容编辑走嵌入式 NoteView 子树
  (不是新写一个简陋编辑器);三个变种区分:
  - Text:无背景 + 无边框,纯文字
  - Sticky:浅黄背景 + 圆角(类便签),有边框
  - Table:复用 ProseMirror table 节点
- **参考实现 — 两代方案对比**:
  - **v1**(`feature/graph-labels` 分支):CSS2DRenderer + 内嵌 ProseMirror DOM。
    优点:富文本能力直接复用;缺点:文字与 shape 布局不在同一坐标系,
    zoom / 对齐困难(已废弃)
  - **v2**(`backup/before-pg-refactor-2026-04-28` 分支):**SVG 路径**。
    `Atom[] → atomsToSvg(opentype.js)→ SVG <path> → Three.js SVGLoader
    → ShapeGeometry → Mesh`。文字成为真正的 Three.js geometry,
    与 shape 共享渲染管线,zoom 矢量完美;**这是正解**
  - 关键文件(v2):
    - `src/lib/atom-serializers/svg/blocks/textBlock.ts` —
      PM textBlock → SVG <path>
    - `src/lib/atom-serializers/svg/text-to-path.ts` — opentype.js
      字体 outline 化 + 字符级中英 / 字重 / italic 字体切换
    - `src/lib/atom-serializers/svg/blocks/mathInline.ts` /
      `mathBlock.ts` — 数学公式 SVG 序列化
    - `src/plugins/graph/rendering/contents/SvgGeometryContent.ts` —
      消费方:SVGLoader 解析 + 三级缓存(SVG 字符串 → ShapeGeometry +
      Material 共享)
    - `src/plugins/graph/rendering/labels/*` — 6 种 label 布局策略
      (inside-center / above / below / left / right / inside-top)
- **编辑 / 展示双模式**:
  - 展示态:SVG → Three mesh(不可交互,只渲染)
  - 编辑态:用户双击 → 浮一个 ProseMirror DOM 编辑器在 mesh 上方,
    blur 时把 doc 重新序列化为 SVG 替换 mesh
  - 类似 PowerPoint / Keynote 的"文字框双击进入编辑"模式
- **三级缓存**(性能):L1 atoms→SVG / L2 SVG→Geometry+Material / L3 mesh 每次新建
- **浮动 toolbar 风格**:对齐 Freeform 的"轻量图标条"(B / 对齐 / 列表 /
  字号 / 颜色),**但能力扩展到 NoteView 全部 inline marks**(公式 / 链接 /
  代码 等)。toolbar 跟随当前选区浮在节点上方,blur 即消失
- 复杂度:中-大,涉及"画板节点宿主一个 ProseMirror 实例"的架构问题
  (focus 切换、selection 隔离、序列化路径打通)
- 价值:**这是 KRIG vs Freeform 的核心差异化卖点**

(其他 toolbar 项待补)

## Inspector / 属性面板

### F-5 Shape 选中浮条:Fill / Stroke / Text 三图标(P0,中)
- Freeform 设计:shape 选中后,**节点下方浮一个胶囊容器**,内含 3 个图标:
  ```
  [ ●  /  Aa ]
   Fill Stroke Text
  ```
  点任一图标 → 浮 sub-popover 改对应属性,与 line 三态完全同款交互
- **Stroke sub-popover**(截图):
  - 5 种笔触:⊘ 无 / ─ 实线 / 短虚 / 点线 / 长虚
  - 粗细数字调节(3 pt)
  - 颜色块 + 调色盘按钮
- **Fill / Text** 同理(待对照截图细化)
- **vs 当前 KRIG 的 FloatingInspector**:
  | | Freeform 浮条 | 当前 FloatingInspector |
  |---|---|---|
  | 默认 | 节点下 3 图标,紧凑 | 右侧浮层,全套属性铺开 |
  | 改属性 | 点图标 → sub-popover | 面板上直接改 |
  | 优势 | 不挡画板,聚焦当前操作 | 一目了然 |
  | 劣势 | 改多属性要多次点 | 占屏幕,遮挡视图 |
- **建议混合模式**(KRIG 独有):
  - **单击节点** → 节点下方浮"快速浮条"(Freeform 风格,3 图标 sub-popover)
  - **双击节点** → 当前的 FloatingInspector(高级模式,所有属性 + 数学坐标 X/Y/W/H)
  - 用户高频操作走快速浮条;需要精确数值或一次改多属性时双击进高级
- 复杂度:中。需要:
  - 新建 ShapeQuickBar 组件(浮在节点下方,跟随节点位置 / zoom)
  - 3 个 sub-popover(Fill / Stroke / Text)— Stroke 可借鉴 line 的 Style popover
  - Text 子菜单:对接 F-2 文本节点的 inline 编辑入口

## 选中态 / Handles

(待补)

## 其他

### F-6 渲染态行内链接:视觉标识 + 点击路由(P0,中)

- **现状**(M2.1.6d 后):行内链接(B / I / U / 🔗)在**编辑态**完全工作 —
  LinkPanel 创建,linkClickPlugin handleClick 走 5 协议 right slot 路由
- **硬伤**:**渲染态(SVG mesh)完全不显示链接** —
  - atomsToSvg 把文字转成 ShapeGeometry,**link mark 在转 SVG 时被丢弃**
  - 用户在画板上看不到"哪段文字是链接"(无下划线 / 无颜色)
  - 无法点击 — mesh 是几何不是 DOM,没有 click 监听
  - 必须双击进编辑态才能点链接 → 用户不知道链接存在的话根本进不去
- **方案**:atomsToSvg 时给每段 link 文字记录 `{ start, end, href, bbox }`
  元数据,渲染层多做两件事:
  1. **视觉**:link 段落加 underline path + 链接色(`#7aa2f7` 之类)
     — text-to-path.ts 已有 underline 钩子,需要打通到 link mark
  2. **可点击**:Canvas 加一层透明 hit-rect overlay(InstancedMesh 或 mesh.userData)
     监听 raycast click → 调和 NoteView 同样的 link 路由(可复用
     `link-click.ts` 里的 `openNoteInRightSlot / openWebInRightSlot /
     openEbookInRightSlot` 三个 helper)
- **关键文件**:
  - `src/lib/atom-serializers/svg/blocks/textBlock.ts` — 加 link mark 处理
  - `src/lib/atom-serializers/svg/text-to-path.ts` — underline + 颜色应用
  - `src/plugins/graph/canvas/scene/TextRenderer.ts` — 接收 link bbox 元数据
  - 新建 `src/plugins/graph/canvas/scene/LinkHitOverlay.ts` — 透明 hit-rect
    + raycast → 复用 link-click 的 5 协议 dispatch
- **依赖**:link-click.ts 的三个 `openXxxInRightSlot` helper 抽到独立模块
  (M2.1.6d 留在 plugin 内部,F-6 时提取到共享层)
- **复杂度**:中。3 文件改动 + 1 新文件,~200 行
- **价值**:没有这个,M2.1 文字节点的链接功能在画板上等于不存在 —
  P0 不能拖
- **何时做**:M2.1.7(端到端 PoC)之后立刻接,**作为 M2.1 的功能补完**;
  不放 M2.2

### F-9 Sticky 颜色调色盘(P1,小)

- **现状**(M2.2):Sticky 创建时背景色硬编码 `#FFEB99`(黄),用户无法改色
- **Freeform 对齐**:浮条点 BG 圆 → 弹 7 色调色盘(粉/红/橙/黄/绿/蓝/灰),
  点选立即改色
- **方案**:
  - **数据层免费**:已用 `Instance.style_overrides.fill` 字段,改色等于改这个值
  - **UI**:浮动浮条(M2.4 阶段)加"Sticky 模式"颜色按钮;点开 popover 7 色
    swatches;点选后 `nr.update({ ...inst, style_overrides: { fill: { type:'solid', color: NEW } } })`
  - **配色**:7 色+对应深色文字配对(亮色用 `#222` 字,暗色用 `#eee` 字),
    NodeRenderer 已经按"有 BG → '#222'",简单扩展为按色亮度选 fg
- **复杂度**:小.UI 1 个 popover + 7 个 swatch button
- **价值**:Sticky 完整体验必备
- **何时做**:**M2.4 浮条阶段** — 浮条是统一入口,顺手做;不单独排里程碑

### F-10 文本节点垂直对齐(P1,小)

- **现状**:Text / Sticky 文字始终顶对齐(从 atom-serializers 顶部开始画)
- **Freeform Sticky**:文字默认垂直居中,小节点视觉更平衡
- **方案**:
  - **数据**:Instance 加 `text_valign?: 'top' | 'middle' | 'bottom'` 字段
    (默认 'top';Sticky 创建时预设 'middle')
  - **渲染**:atomsToSvgWithLinks 加 option;计算总文字高度后,根据 valign
    在 viewBox 顶部留 0 / (h-textH)/2 / (h-textH) 偏移
  - **InlineToolbar**:加 3 按钮(top / middle / bottom),对齐 Freeform Aa→
    Align Top/Middle/Bottom 三选项
- **复杂度**:小.~50 行,主要是 atom-serializers 加 valign 偏移
- **价值**:Sticky 视觉对齐 Freeform 的关键缺口

### F-12 共享 ContextMenu 注册框架(P1,中)

- **现状**:NoteView ContextMenu 内置 30+ 条件 + actions(Cut/Copy/Paste +
  thought + frame + mark + 学习/AI 等),完全 plugin 内部硬编码;
  Canvas ContextMenu 是另一个独立组件(items 注入式),F-9 加 Sticky 颜色
  也直接挂 Canvas 内的 buildContextMenuItems
- **问题**:
  - 两个 ContextMenu 视觉风格不同(虽然 F-9 已对齐了 NoteView 的胶囊样式)
  - 注册分散:Canvas 加新菜单项(如 F-8 Group / F-10 valign / Combine)
    都要改 buildContextMenuItems;NoteView 同样硬编码 30+ 条件,加新功能
    都要动这个文件
  - 跨 view 的"通用项"(Copy / Delete / 添加标注 等)没法共享
- **方案**(对齐 NavSide / WorkMode / Protocol 等已有注册体系):
  - 抽 `src/shared/ui/ContextMenu` 共享组件 — 接 items[] + onClose,纯视觉
  - 加 `contextMenuRegistry` 单例:`register(viewType, contributor)`,
    contributor 接 context(选区 / inst / view 等)返回 ContextMenuItem[]
  - 各 plugin 注册自己的 contributors(canvas → Sticky color / Combine /
    Delete;note → Cut/Copy/Paste / mark / thought 等)
  - 通用项(Copy / Delete)抽到 framework 层注册一次,跨 view 复用
- **触发**:NoteView 和 Canvas 各自 contextmenu 事件 → 收集所有注册的
  contributor → merge items → 渲染共享组件
- **复杂度**:中.~300-400 行,要拆 NoteView 现有 30+ 项到 contributors
- **价值**:加新 view(family-tree / mindmap)时菜单贡献是注册一处即可;
  通用项跨 view 一致
- **何时做**:M3 共享 UI 层重构期(画板与 note 共享语义层那条线)

### F-7 字号 / 字体切换(P2,大)

- **现状**:画板文字节点和 NoteView 都没有"改字号"/"改字体"的能力
  - 字号靠 heading levels(H1/H2/H3 的 textBlock attr)做"语义大小"
  - 字体硬编码:CJK→Noto SC,西文→Inter,等宽→JetBrains Mono(font-loader.ts)
- **为什么 M2.1 不做**:
  - **NoteView 一致性优先**(三层架构 §2):画板和 NoteView 共享 atom 语义层,
    画板独有 fontSize / fontFamily mark 会破契约 — 同一份 atom 在 NoteView
    打开会丢字段
  - 字号场景已被 heading 大致覆盖
  - 中文用户切字体诉求小;切了画板渲染层(opentype.js)还要预加载 font 包,
    体积/复杂度都涨
- **方案**(若做):
  1. **NoteView 加 mark**:`fontSize`(数值 px / 关键字 sm/md/lg)+ `fontFamily`
     (keyword:serif/sans/mono/handwriting)
  2. **atomsToSvg 支持**:text-to-path.ts pickFontForChar 加 fontFamily 维度;
     fontSize 直接传 opentype.js getPath 的 fontSize 参数
  3. **font 包按需加载**:多字体不全部预加载,用户切到才 fetch
  4. **InlineToolbar 加按钮**:NoteView FloatingToolbar + 画板 InlineToolbar
     都加,共享 LinkPanel 模式
- **复杂度**:大。NoteView mark 注册 + serializer + 3 个 toolbar 同步 + 字体
  按需加载架构
- **价值**:nice-to-have,不是核心功能断点
- **替代轻量方案**:加"标题级别切换"按钮(H1/H2/H3)— heading 已支持,30 分钟
  改动,不破契约;若用户反馈足够覆盖字号需求,F-7 可不做

(其余条目待补)

---

## 优先级图例

- **P0**:核心体验断点,M1 验收不影响但下一阶段必修
- **P1**:有则更好,可放 v1.1
- **P2**:nice-to-have,v1.5+

## 复杂度图例

- **小**:1 文件 / <100 行
- **中**:跨文件 / 100-300 行
- **大**:涉及架构调整 / 300+ 行
