# L5-G5 设计 — Graph 节点浮条(Freeform 风格 · 注册式 section 组合)

> v0.1 · 2026-06-20 · 设计先行(用户拍板:design-first 后再实现)
>
> 配套:
> - 业务规格:[../../10-business-design/graph/canvas/Canvas.md](../../10-business-design/graph/canvas/Canvas.md) §3.4 Inspector / §3.5 选中态
> - 上游决策:G4 中 FloatingInspector 被摘掉时留的 "v1.1+ 走 V1/Freeform 风格 shape 边缘跟随浮条"([GraphCanvasView.tsx:56](../../../src/views/graph-canvas-view/GraphCanvasView.tsx#L56),commit `5833c17e`)
> - 数据契约:[shape-library/types.ts](../../../src/capabilities/shape-library/types.ts) `FillStyle / LineStyle / ArrowStyle`
> - 投影工具:[canvas-rendering/scene/SceneManager.ts](../../../src/capabilities/canvas-rendering/scene/SceneManager.ts) `worldToScreen / projectMeshToScreenAABB`
> - 文字命令先例:[text-editing/types.ts](../../../src/capabilities/text-editing/types.ts) `getFocusedInstanceId` + 跨 view toggleMark/setHeading
>
> **本文件用途**:把"shape 属性编辑"从固定 Format Shape 浮窗,重做成一个 **Freeform 风格、贴选中框、按节点类型注册 section 的通用浮条**。目标不是只服务 canvas,而是给**任意 Graph view(canvas / family-tree / knowledge / mindmap)**一套统一的图形操作底座。

---

## 0. 一句话目标

选中一个节点 → 选中框**正下方居中**浮出一条 pill 工具条 → 条上的 button 由**该节点类型注册声明**(数量不限,按需要多少给多少)→ 点 button 展开对应面板(Fill 色板 / Line 线型 / Text 文字 / Type 字体字号 / …)→ 改属性,节点实时更新。

参考视觉:macOS Freeform 的 shape 浮条(用户提供截图)。

---

## 1. 核心设计:为什么是"注册式 section",不是写死三个

固定三段(Fill/Line/Text)只够 canvas 的矩形/圆。但:

- **line 节点**没有 fill,有 arrow 端点样式 → 该显示 `Line + Arrow`,不显示 Fill
- **纯文字节点**没有 fill/line 的几何意义,只有 Text + Font → 显示 `Text + Font`
- **family-tree 的 person 节点**(只读 view)→ 可能 0 个可编辑 section,或只读展示一个 "ⓘ 信息" section
- **knowledge / mindmap 节点**未来可能要 `Fill + Link + Icon`

所以浮条本体是个**容器 + registry**:容器只负责"贴选中框、排布 button、管面板互斥、收 ESC";**具体有哪几个 button、各是什么** 由节点类型在注册表里声明,**数量无上限**(上面"2/3/4"只是举例,不是约束)。新增一种节点 / 一种 section,**只注册不改容器**。

```
┌─ NodeToolbar 容器(锚定 + 互斥 + 键盘) ─────────────┐
│   读 registry.resolve(node) → SectionDef[]            │
│   ┌──────────────────────────────────────────┐       │
│   │ [●Fill] [╱Line] [Aa Text] [𝐅Font] …       │ ← 由 │
│   └──────────────────────────────────────────┘  注册 │
│            ▲ 展开当前 section 的面板                   │
└───────────────────────────────────────────────────────┘
```

---

## 2. 决策记录(用户已拍板)

| # | 决策点 | 选定 | 说明 |
|---|---|---|---|
| **G5-1** | 浮条归属层 | **独立共享组件** | 不放 canvas-rendering(family-tree 只读不该被迫带编辑浮条),不放单个 view。抽成可被 canvas-rendering / 各 graph view 共同 import 的共享件。见 §4.1 物理归属 |
| **G5-2** | 锚定方式 | **选中框下方居中 + 跟随** | 对齐 Freeform / 用户截图。bbox 屏幕坐标由 SceneManager.worldToScreen 算,viewport 变换时持续推流重定位 |
| **G5-3** | 首版 section | **Fill + Line + Text + Type** | Fill/Line 数据层已就绪;Text 纯复用 note;Type(字体字号)独立 |
| **G5-4** | Text 接法 | **纯复用 note PM 命令** | B/I/U/对齐/列表 走 text-editing 既有 mark/命令,对整文字节点 doc 生效。**不引入任何 note 没有的新概念**,note 复用菜单原则不破 |
| **G5-4b** | **字体/字号接法(方案 B,用户拍板)** | **独立 Type section,不并进 Text** | 字号/字体族是 note **原生没有**的画板专属能力。**与 Text 物理分离**:Text=复用 note 零新造;Type=画板新数据字段(text_size/text_font)+ 渲染管线扩展(§5.4)。两者互不污染,这是用户明确要求 |
| **G5-5** | button 组合机制 | **registry 注册,数量无上限** | 节点类型 → SectionDef[]。容器零硬编码 section 清单 |
| **G5-6** | 字体打包清单(用户拍板) | **中:Noto Sans SC(黑)+ Noto Serif SC(宋);西:Inter(Sans)+ Serif 衡线体 + JetBrains Mono + 手写/装饰体** | 已装 Inter/NotoSansSC/JetBrainsMono;需新打包 Noto Serif SC / 西文 Serif / 手写体。详见 §5.4 |
| **G5-7** | 首版交付 | **先出本设计文档,审完再实现** | 本文 |

---

## 2b. 交付实况 + 验收后修订(v0.4,2026-06-20 总指挥验收)

实施已完成(分支 `feature/L5G5-node-floating-toolbar`,6 commit),总指挥逐条核对真实代码/运行,**代码层验收通过**。三处与设计字面的差异,经用户拍板定案:

### G5-4 签名变更:`runNodeStyleCommand(instanceId, cmd)` → `(doc, cmd)`(**改设计不改代码**)

- **根因(实地核验)**:画板文字节点平时只渲染为 SVG mesh,**无挂载 EditorView**;text-editing driver 的 instanceId 路由依赖 `instanceRegistry`,而它**只登记活跃 view 实例** → 对未编辑节点 `instanceRegistry.get(id)` 返回空,**原 instanceId 签名物理上跑不通**。
- **定案**:设计当时的 instanceId 签名是 good-faith 但事实不成立的假设。driver 暴露 **headless 纯函数** `runNodeStyleCommand(doc, cmd): DriverSerialized|null`(进 doc → 出新 doc,不碰状态),PM 机械全关在 `@drivers`,node-toolbar 边界不破。功能比原设计**更强**(不进编辑态即可改整节点)。坚持原签名需引入隐藏 view 或改 note 核心 instance-registry,代价/风险不值,**否决**。
- **代价(已补缓解)**:纯函数把"取 doc/写回/刷新"责任移给 view。已补两条:① **view 落地四步契约**写进 [node-toolbar/DESIGN.md](../../../src/capabilities/node-toolbar/DESIGN.md)(family-tree 接入照做);② null 静默改 `console.warn`(fail loud 留痕)。undo 走画板 G4 快照栈(与 note 字符级 PM undo 粒度不同,对画板场景合理)。

### G5-6 字体:license 确认 + 本期只上已装 3 种(管线已就绪)

- **license 已核**:四款拟打包字体全部 **SIL OFL 1.1**(开源、可商用、可嵌入分发):**LXGW 文楷**(中文手写/楷,~19MB,可选 Lite ~8MB)/ **Noto Serif SC**(中文宋,~10MB)/ **Source Serif 4**(西文衡线)/ **Caveat**(西文手写)。
- **现状**:`chooseFontKey` 的 `fontFamily` 覆盖管线 + CJK 强制中文 fallback **已接好并单测锁定**;但 .ttf 二进制**未打包**(沙箱抓不到字体文件)。Type 下拉本期只列「默认/Sans/Mono」。
- **落地动作(待真机)**:下载 4 个 OFL .ttf → 放 `src/lib/atom-serializers/svg/fonts/` → [fonts/index.ts](../../../src/lib/atom-serializers/svg/fonts/index.ts) 加 `?url` import + FONT_URLS → font-loader 接选择逻辑 → type section 下拉加选项。纯接线,无难点。

### G5-9 通用性:本期用 mock 单测验 registry,真接入待 family-tree 立项

- family-tree view 尚未立项 → 用 mock 节点类型单测 registry 契约(6 例硬验收过)。真 family-tree 接入时按 §7 通用性项复验。

### 仍待真机回归(总指挥环境无 GUI)

§7 视觉项(浮条贴选中框下方居中 / 拖缩转跟随 / 改样式实时更新)需 `npm start` 肉眼确认 —— 用户晚点测。

---

## 3. 浮条结构(对齐用户截图 4 态)

### 3.1 主条(collapsed)

pill 容器,横排若干 trigger button + 分隔符。截图里是 `[●填充圆] [╱描边斜线] [Aa]`,我们扩成可注册任意个。

每个 trigger button 视觉 = section 的 `icon`(可以是当前值的预览,如 Fill 显示当前填充色的圆点、Line 显示当前线型斜线)。

### 3.2 展开面板(每个 section 一个,互斥)

点 trigger → 主条下方浮出该 section 的面板,带 anchor 三角指向 trigger。同时只允许一个面板展开(再点别的 trigger 切换,点空白 / ESC 收)。

四个首版面板,严格对齐截图:

**Fill 面板**(截图 2)
```
○白 ●灰 ●黑 ●青 ●粉 ●紫
●红 ●橙 ●黄 ●绿 ●蓝 ●深蓝
[      No Fill      ]  [🌈自定义]
```
→ 写 `instance.style_overrides.fill`({ type:'none'|'solid', color, transparency })

**Line 面板**(截图 3)
```
[⊘无] [╱实线] [┄虚线(选中)] [···点线] [╱粗]
[≡]  [ 1 pt ▲▼ ]            [■黑] [🌈]
```
→ 写 `instance.style_overrides.line`({ type, color, width, dashType })
→ dashType 已有 5 值:solid / dash / dot / dashDot / longDash([shape-library/types.ts:101](../../../src/capabilities/shape-library/types.ts#L101))

**Text 面板**(截图 4 上半,**纯复用 note**)
```
[𝐁加粗(选中)] [𝐼斜体] [U̲下划线]   [■黑文字色] [🌈]
[对齐 ▾]                              [≔列表]
```
→ 全部走 note 既有 PM mark/命令(toggleMark bold/italic/underline、文字色、对齐、列表),对整文字节点 doc 生效(G5-4)
→ **这里没有字号、没有字体族**——note 原生模型就没有,刻意不放,保持复用纯净

**Type 面板**(字体 + 字号,**画板专属,独立 section**,G5-4b)
```
[ 字体 ▾ Noto Sans SC ]      字体族下拉(§5.4 清单,中英文分组)
[  字号  16 pt  ▲▼  ]        自由磅值(新建默认 16,对齐 note 正文,§5.4b)
```
→ 写 instance 新字段 `text_font` / `text_size`(note 没有的画板专属属性),渲染管线按此重渲染(§5.4)

> **为什么 Text 和 Type 分两个 trigger**(用户拍板方案 B):Text 的每一项都是 note 白拿的;Type 的字号/字体是 note 根本不存在、画板要新造的东西。物理分开 → Text 复用菜单零污染,Type 的新数据模型/渲染改动全收敛在自己 section。截图里 Freeform 把字号塞进 Text 面板,我们**故意不那样**,因为底层模型不同源。

---

## 4. 架构

### 4.1 物理归属(G5-1=独立共享件)

```
src/capabilities/node-toolbar/            ★ 新建共享 capability
├── types.ts             SectionDef / SectionContext / NodeToolbarApi / ToolbarAnchor
├── registry.ts          sectionRegistry(注册 section)+ nodeBindingRegistry(节点类型→section ids)
├── NodeToolbar.tsx       容器:锚定 + button 排布 + 面板互斥 + 键盘
├── sections/
│   ├── fill/index.tsx        Fill 面板(读写 style_overrides.fill)
│   ├── line/index.tsx        Line 面板(读写 style_overrides.line)
│   ├── text/index.tsx        Text 面板(纯复用 note PM 命令:B/I/U/对齐/列表)
│   └── type/index.tsx        Type 面板(画板专属:字体族 + 字号 → instance.text_font/text_size)
├── index.ts             capabilityRegistry.register + 内置 section 注册
├── styles.css
└── DESIGN.md
```

为什么是 capability 而不是 src/components:它要 `requireCapabilityApi`(改 instance 走 canvas-rendering host;改文字走 text-editing),有自己的注册表和生命周期 → 对齐 V2 既有 capability 模式(参考 graph-library-store / shape-library 双导出 + register)。

### 4.2 数据契约(registry 三件套)

```ts
// 一个 section 长什么样(纯声明,不绑定具体节点)
interface SectionDef {
  id: string;                 // 'fill' | 'line' | 'text' | 'type' | 插件自定义
  icon: (ctx: SectionContext) => ReactNode;   // trigger 视觉(可读当前值预览)
  Panel: FC<SectionContext>;  // 展开面板
  visibleWhen?: (ctx: SectionContext) => boolean;  // 运行时再过滤(如 line 选中才显 arrow)
}

// 容器给 section 的上下文(section 只认这个,不认具体 view)
interface SectionContext {
  node: NodeSnapshot;         // { id, kind, ref, style_overrides, text_font?, text_size?, doc? } —— view-agnostic 快照
  patchStyle: (patch: Partial<StyleOverrides>) => void;   // 改 fill/line/arrow(走 host.updateInstance)
  patchInstance: (patch: Partial<NodeSnapshot>) => void;  // 改 text_font/text_size 等画板专属字段
  runTextCommand: (cmd: TextNodeStyleCommand) => void;    // 改文字 mark(走 text-editing,Text section 用)
  close: () => void;
}

// 节点类型 → 它要哪几个 section(这是"注册式组合"的核心,数量无上限)
nodeBindingRegistry.register({
  match: (node) => node.kind === 'shape' && !isLine(node) && !isText(node),
  sections: ['fill', 'line'],          // 普通 shape:Fill + Line
});
nodeBindingRegistry.register({
  match: (node) => isLine(node),
  sections: ['line', 'arrow'],         // line:Line + Arrow(无 Fill)
});
nodeBindingRegistry.register({
  match: (node) => isText(node),
  sections: ['fill', 'text', 'type'],  // 文字节点:Fill(底色)+ Text(复用 note)+ Type(画板字体字号)
});
```

> **关键解耦**:section 只认 `SectionContext`(node 快照 + 两个回调),完全不知道自己跑在 canvas 还是 family-tree。view 接入时只需提供"怎么把选中节点变成 NodeSnapshot""patchStyle/runTextCommand 怎么落地"。

### 4.3 view 接入面(canvas 为首个消费者)

```
GraphCanvasView
  ├─ 订阅 host.onSelectionChange → 单选时拿 instance
  ├─ 订阅 host.onViewportChange → 重算 bbox 屏幕坐标(锚点)
  ├─ <NodeToolbar
  │     anchor={bboxScreenRect}                    // §5.1 锚点
  │     node={toSnapshot(instance)}
  │     onPatchStyle={(p) => host.updateInstance(id, { style_overrides: merge(p) })}
  │     onPatchInstance={(p) => host.updateInstance(id, p)}            // text_font / text_size
  │     onTextCommand={(c) => textEditing.runNodeStyleCommand(id, c)}  // §5.3 Text 复用 note
  │  />
```

family-tree 之后接入:提供只读 NodeSnapshot,nodeBindingRegistry 给 person 节点绑 0 个可编辑 section(或只读信息 section)→ 浮条要么不出,要么只展示。

---

## 5. 需要新增/扩展的底层能力(实现前置)

| # | 能力 | 现状 | 要做 |
|---|---|---|---|
| **5.1** | 选中 bbox 的屏幕坐标 + viewport 持续推流 | SceneManager 已有 `worldToScreen` / `projectMeshToScreenAABB`;Host 有 `onViewportChange` / `onSelectionChange` | Host 增一个 `getSelectedScreenAABB(): {x,y,w,h}\|null`,view 在 selection/viewport 变化时拉,定位浮条 |
| **5.2** | style 改动走现有 updateInstance | Host 已有 `updateInstance(id, patch)`,Fill/Line 即 `style_overrides` patch | 0 改动,直接用。Undo 也复用 G4 的快照栈 |
| **5.3** | (Text)对指定文字节点的整 doc 改 mark | text-editing 有 `getFocusedInstanceId` + 跨 view toggleMark/setHeading 先例,但那是"当前聚焦实例" | text-editing 增 `runNodeStyleCommand(instanceId, cmd)`:对指定(未必聚焦的)文字节点 doc 应用 **bold/italic/underline/textColor/align/list** —— 内部全选 + apply mark + 写回 instance.doc + 触发 SVG 重渲染。**只复用 note 已有 mark/命令,不含字号字体**(那归 §5.4) |
| **5.4** | (Type)字体族 + 自由字号 | **管线已大半就绪**:`text-to-path.ts` 的 `font.getPath(text,x,y,fontSize)` 本就接受任意 fontSize;`chooseFontKey` 已能按 CJK/bold/italic 选字体;已装 Inter/NotoSansSC/JetBrainsMono | 三件改动:**① 字号透传**——`atomsToSvg(doc, {baseFontSize})` 把节点 `text_size` 一路传到 textToPath(现写死 `FONT_SIZE=14`,[svg/index.ts:14](../../../src/lib/atom-serializers/svg/index.ts#L14));**② 字体族入口**——`chooseFontKey` 加 `fontFamily` 入参覆盖(用户选 Serif/Mono/手写时优先于自动选);**③ 打包新字体**——见下表;**④ instance 加 `text_font`/`text_size` 字段** + canvas-text-node 展示态读取 |

#### §5.4 字体打包清单(G5-6 用户拍板)

| 字体 | 用途 | 状态 | 体积 |
|---|---|---|---|
| Inter(Sans,西文)| 默认正文 | ✅ 已装(Reg/Bold/Italic)| — |
| Noto Sans SC(黑体,中文)| 中文默认 | ✅ 已装(Reg/Bold)| — |
| JetBrains Mono(等宽)| 代码/技术 | ✅ 已装 | — |
| **Noto Serif SC(宋体,中文)** | 中文报刊正式 | 🆕 打包 | ~10MB |
| **西文 Serif(衡线体)** | 西文正式(如 Source Serif / Lora)| 🆕 打包 | ~几百 KB |
| **西文手写/装饰体** | 标题/涂鸦(如 Caveat)| 🆕 打包 | ~几百 KB |
| **中文手写体** | 中文标题/手书感(如 LXGW 文楷/马善政等可商用)| 🆕 打包(用户拍板装)| ~10MB |

> ⚠️ 中文字体大(每套 ~10MB):Noto Serif SC + 中文手写体合计再 +~20MB。用户已确认全装。字体下拉按"中英文各分组"呈现,选中后 chooseFontKey 用 fontFamily 覆盖 + CJK 字符仍走对应中文字体(西文字体没中文字形,必须 fallback)。中文手写体具体选型(LXGW 文楷 / 其他可商用)实施时定,license 必须 SIL OFL 或同等可商用。

#### §5.4b 字号默认值(用户拍板:对齐 note)

note 正文根字号 = **16px**([pm-host.css:9](../../../src/drivers/text-editing-driver/pm-host.css#L9));画板文字节点当前写死 `FONT_SIZE = 14`(偏小,非有意)。引入 `text_size` 后:

| 场景 | 默认值 | 理由 |
|---|---|---|
| **新建文字节点** | **16**(对齐 note 正文)| 文字节点复用 note PM 体系,字号也对齐,体验统一;现 14 是随手值 |
| **老画板已存节点**(无 text_size 字段)| **14**(sanitize 兜底)| 不动用户已有画板视觉;对齐 G3/G4 schema 兼容做法 |

> 大字标题不靠改默认值,靠用户用 Type 面板调 pt(Freeform 那种 72pt 大默认是"独立大字标签"思维,我们文字节点定位更接近画板便签/正文)。

> §5.3 若评估发现 text-editing.Host 当前只能操作"已聚焦的活跃实例",则首版 Text 退化为"点 Text 组 → 自动进入该节点编辑态 + 全选 → 面板按钮走既有聚焦命令";完整的"不进编辑态直接改"留 5.3 完成后。**绝不**让 node-toolbar 直接 import text-editing 内部 PM/driver(W5 严格态 A 边界)。Type section 走 instance 字段不依赖 5.3,可独立推进。

---

## 6. 分阶段实施(实现时拆 commit,本文不实现)

```
G5.1  node-toolbar capability 骨架 + registry(SectionDef / nodeBindingRegistry)+ 空容器
G5.2  锚定:Host.getSelectedScreenAABB + view 接入,浮条贴选中框下方居中跟随(先放假 button)
G5.3  Fill section + Line section(数据层就绪,纯 UI + patchStyle)
G5.4  text-editing.runNodeStyleCommand 前置(§5.3,只复用 note mark)
G5.5  Text section(B/I/U/对齐/列表,走 5.4 命令,纯复用 note)
G5.6  字体管线扩展(§5.4):atomsToSvg baseFontSize 透传 + chooseFontKey fontFamily 入口 + instance text_font/text_size 字段
G5.7  打包新字体(Noto Serif SC / 西文 Serif / 手写体)+ Type section(字体下拉 + 字号)
G5.8  canvas view 全量接入 + 互斥/ESC/键盘 + 视觉打磨对齐 Freeform
G5.9  (后续)family-tree 只读接入验证 registry 通用性
```

> G5.6/G5.7(Type)与 G5.4/G5.5(Text)相互独立,可并行;Text 走 PM mark,Type 走 instance 字段 + 渲染管线,两条线不交叉——正是方案 B 物理分离的好处。

每 commit 自包含 typecheck 0 + lint 0 + 屏障 grep(node-toolbar 0 import three / 0 import prosemirror / 0 运行时 import @drivers)。

---

## 7. 验收清单(实现阶段用)

- [ ] 选中普通 shape → 浮条出现在选中框正下方居中,显示 `Fill + Line` 两个 button
- [ ] 拖动 / 缩放 / 旋转节点 + pan/zoom 画布 → 浮条实时跟随选中框
- [ ] 选中 line → 浮条显示 `Line + Arrow`,不显示 Fill(registry 生效)
- [ ] 选中文字节点 → 浮条显示 `Fill + Text + Type`(三个独立 trigger)
- [ ] Fill 面板:14 色 + No Fill + 自定义取色 → 节点填充立即变
- [ ] Line 面板:5 线型 + pt 调整 + 颜色 → 节点描边立即变
- [ ] Text 面板:B/I/U + 对齐 + 列表 + 文字色 → 整节点文字立即变(不需先双击进编辑);**面板内无字号/字体**(确认与 note 复用边界一致)
- [ ] Type 面板:换字体(中:黑/宋;西:Sans/Serif/Mono/手写)→ SVG 按字体重渲染;调字号(自由 pt)→ 文字立即缩放
- [ ] 中文节点选西文字体 → 中文字符仍用对应中文字体(fallback 不丢字)
- [ ] 同时只展开一个面板;ESC / 点空白收起;多选时浮条不出(或显批量子集)
- [ ] **通用性证明**:family-tree(或一个 mock 节点类型)注册不同 section 组合,浮条按声明渲染,容器零改动

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| §5.3 text-editing 改整 doc mark 接口比预期重(PM 实例非聚焦时不可操作) | 先做 5.3 前置子任务评估;不行就首版退化为"点 Text → 进编辑态全选"(§5 注),完整态留后续。绝不走违规 import |
| **中文字体打包使 app 体积明显增大**(Noto Serif SC + 中文手写体合计 +~20MB,用户已确认全装) | 字体作为 `?url` 资源懒加载(font-loader 已是按需 loadFont,不全量进内存,不占启动内存);打包进 app bundle 体积涨可接受 |
| 西文字体无中文字形,中文节点选西文字体会丢字 | chooseFontKey 保持"CJK 字符强制走中文字体"的 fallback;fontFamily 覆盖只作用于该字体覆盖的字符集 |
| Type 的 text_size/text_font 是 instance 新字段,老画板数据没有 | deserialize sanitize 给默认值(text_size 默认沿用现 FONT_SIZE=14,text_font 默认 auto);对齐 G3/G4 的 schema 兼容做法 |
| 锚定在旋转节点上 bbox 抖动 | 用 projectMeshToScreenAABB(已为旋转 OBB 设计);浮条贴 AABB 底边中点 |
| registry 通用性只在 canvas 验证、family-tree 时才暴露契约不足 | G5.9 显式拿 family-tree(或 mock)跑一遍 registry,作为通用性硬验收 |
| 与 G4 残留的 FloatingInspector 代码并存混乱 | node-toolbar 上线后,删除 ui/floating-inspector(已 dead code,view 未引用) |

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-06-20 | v0.1 | 初稿;registry 三件套契约(SectionDef + nodeBindingRegistry + SectionContext);7 commit 分阶段;通用性以 family-tree 接入为硬验收 |
| 2026-06-20 | v0.2 | 用户复审两点修订:① 删除"2/3/4 个"上限暗示——registry section **数量无上限**;② **Font 拆出为独立 Type section(方案 B)**——Text 纯复用 note(B/I/U/对齐/列表,无字号字体),Type 是画板专属(字体族 + 自由字号),物理分离保 note 复用菜单零污染;新增 §5.4 字体管线(atomsToSvg baseFontSize 透传 + chooseFontKey fontFamily 入口 + instance text_font/text_size 字段);字体打包清单(G5-6 用户拍板:中文黑体 Noto Sans SC + 宋体 Noto Serif SC;西文 Inter/Serif 衡线体/JetBrains Mono/手写体);分阶段拆到 G5.9,Text 线与 Type 线独立可并行 |
| 2026-06-20 | v0.4 | 实施完成 + 总指挥验收(详见 §2b)。代码层逐条核对通过(typecheck 0 / 屏障 grep 0 / 21 测试全绿 / registry 容器零硬编码 / Text 防污染 / 字号默认 16 真落地)。三处定案:① **G5-4 签名 instanceId→doc 改设计不改代码**(根因:画板文字节点无挂载 EditorView,instanceId 路由不到 doc;headless 纯函数更强且边界不破;补 view 落地四步契约 + null console.warn);② **G5-6 字体 license 已核全 OFL**(LXGW 文楷/Noto Serif SC/Source Serif 4/Caveat),管线就绪,.ttf 待真机下载打包;③ **G5-9 mock 验通用性**,真接入待 family-tree 立项。真机视觉回归待用户测 |
| 2026-06-20 | v0.3 | 用户拍板两个收尾值:① **字号默认 16**(对齐 note 正文 16px,§5.4b)——新建文字节点 16,老画板无 text_size 字段 sanitize 兜底 14(不动已有视觉);查实画板现写死 14 比 note 正文 16 还小,非有意;② **中文手写体确认打包**(再 +~10MB,Noto Serif SC + 中文手写体合计 +~20MB,字体懒加载不占启动内存);中文手写体选型实施时定,license 必须可商用(SIL OFL 同等)|
