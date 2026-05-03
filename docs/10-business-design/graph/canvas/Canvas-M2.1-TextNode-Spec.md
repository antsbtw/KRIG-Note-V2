# Canvas M2.1 — 文字节点设计

> ⚠️ **架构过渡态说明(2026-05-01 重要补充)**
>
> 本 spec 设计的 `Instance.doc?: Atom[]` 字段是**过渡架构** — 用 instance 作为顶层
> 抽象,doc 字段嵌一段 atoms 表达"画板上一个文字框"。
>
> **长期目标**(详见 [Canvas-As-Note-Migration.md](../Canvas-As-Note-Migration.md)):
> 画板与 note **共享同一份语义层 atom[]**(平等视图,渲染管线各自独立),
> note.doc_content 直接是 Atom[],画板的形状 / 文字框 / 线条都是 atom 元素,视图特
> 性挂在 `atom.meta.canvas` 命名空间。NoteView 打开同一份 note 看到流式段落 + 占位
> 行;CanvasView 打开看到图形 + 文字框。
>
> **不在 M2.1 实施长期目标**的理由:M2.1 已落地代码(M2.1.1-M2.1.4)建立在
> Instance.doc 抽象上,扔掉重写成本 ≈ 5-6 天;过渡架构验收后获得"文字节点能用"红
> 利,M3 阶段(M2.5 之前)再做架构迁移,M2.1 代码作为新架构的"事实样板"对照重写。
>
> **本 spec 的 Atom 定义仍正确**:NoteView 同源 Atom[] 形态、共享 schema /
> converter / NodeView 的所有决策不变,只是承载它们的"容器"在 M3 后从 instance.doc
> 升级为顶层 note.doc_content。
>
> ---
>
> **范围**:M2 第一个迭代,在画板上加"文字节点"(对齐截图一/二的 Freeform 风格)。
> 文字节点的语义内容 = NoteView 完全同型号 `Atom[]`,与 NoteView 共享语义层。
>
> **依据**:
> - [KRIG-Three-Layer-Architecture.md](../../KRIG-Three-Layer-Architecture.md) — 顶层架构(语义/转换/可视化)
> - [Canvas-As-Note-Migration.md](../Canvas-As-Note-Migration.md) — **Canvas/Note 共享语义层架构升级**(M3 工作,M2.5 之前完成)
> - [Canvas-M2-Spec.md](./Canvas-M2-Spec.md) — M2 总 spec
> - [Canvas-M2-Code-Diff.md](./Canvas-M2-Code-Diff.md) — M2 spec vs 代码现状对照
> - 蓝本:`commit 68df38a5`(v1.3 实施)中 `src/plugins/graph/rendering/edit/` 的
>   **可视化层裁剪经验**(可视化层 UI 设计参考,**schema 部分不参考**,该实现违反
>   原则 1 自建 schema,本 spec 修正)
>
> **非范围**:Sticky / Table 节点(留 M2.2);emoji / tofu 兜底(留 v1.x);多选
> 批量改属性(留 M2.4 浮条阶段);**渲染态行内链接(视觉标识 + 可点击)
> 留 M2.1.8(F-6,P0,作为 M2.1 功能补完;详见
> [Freeform-Alignment-Backlog.md](./Freeform-Alignment-Backlog.md) F-6)**;
> **架构升级(Canvas/Note 共享语义层)留 M3**。

---

## 0. 总览与三层对应

### 0.1 三层架构对应

```
┌─────────────────────────────────────────────────────────────────┐
│ 可视化层(Visualization Layer)                                   │
│                                                                  │
│  ┌────────────────────────────┐  ┌─────────────────────────┐    │
│  │ 文字节点·展示态             │  │ 文字节点·编辑态(临时)   │    │
│  │  TextRenderer              │  │  EditOverlay (DOM popup) │    │
│  │  → Three.js Mesh           │  │  + GraphEditor (PM)      │    │
│  │  (与 shape 同坐标系)       │  │  + 裁剪版 Slash/InlineBar│    │
│  └────────────┬───────────────┘  └────────────┬─────────────┘    │
│               ↑ 异步重生成                     ↕ blur/Cmd+Enter   │
└───────────────┼────────────────────────────────┼─────────────────┘
                │                                │
┌───────────────┴────────────────────────────────┴─────────────────┐
│ 转换层(Translation Layer)                                       │
│                                                                  │
│  展示路径:                                                       │
│   atoms (持久化态) → atomsToDoc (NoteView 复用) → PMDoc          │
│                  → 提取 children 转 PM JSON → atomsToSvg → SVG   │
│                                                                  │
│  编辑路径:                                                       │
│   atoms (持久化态) → atomsToDoc (NoteView 复用) → PMDoc          │
│   PMDoc (用户改完) → docToAtoms (NoteView 复用) → atoms         │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────────┐
│ 语义层(Semantic Layer)— 与 NoteView 100% 共享                  │
│                                                                  │
│  Instance.doc: Atom[]                                            │
│   ├ Atom = src/shared/types/atom-types.ts 的 Atom 接口          │
│   │  { id, type, content, parentId, order, links, from,         │
│   │    frame, meta: { createdAt, updatedAt, dirty, ... } }      │
│   ├ 扁平存储,parentId 关联(对齐 NoteView)                      │
│   └ schema 来源:src/plugins/note/registry.ts blockRegistry      │
│                  (registerAllBlocks 后的全 30+ block + 全 marks) │
└──────────────────────────────────────────────────────────────────┘
```

### 0.2 用户视角(对齐截图)

| 态 | 视觉 | 交互 |
|---|---|---|
| **未编辑(展示)** | 文字 + 蓝色矩形选中边框 + 左右 2 个蓝色 resize handle + 底下 1 个绿色 rotation handle(图一) | 单击选中;拖左右把手改宽;拖绿色把手旋转;Delete 删除;**双击**进入编辑态 |
| **编辑(临时)** | 节点 mesh 隐藏;原位浮一个深灰圆角胶囊 popup(可输文字)+ popup 上方浮一条圆角胶囊 toolbar(`B / 对齐 / 列表 / 字号 / 颜色 / ···`)(图二) | 输文字;选区出 inline-toolbar;`/` 出 slash menu 选 block 类型;Cmd+Enter 提交;Esc 取消;blur(点 backdrop)提交 |

### 0.3 历史调研结论(避免再次错判)

| 误判路线 | 修正 |
|---|---|
| ~~走 `feature/graph-labels` CSS2D + DOM 路线~~ | 该分支 DOM/WebGL 对齐有问题,已废 |
| ~~走 `backup/before-pg-refactor` SvgGeometryContent 只读路线~~ | 那条只有展示,无编辑器 |
| ~~走 `commit 68df38a5` 自建 graphSchema 路线~~ | 该实现"与 NoteView schema **平行实现,不依赖 Note 模块**"违反三层架构原则 1(共用 Atom 是义务)。**本 spec 仅参考其可视化层 UI 设计(EditOverlay / SlashMenu / InlineToolbar / MathPopover),schema 部分不抄** |

**正解(本 spec)**:
- **语义层**:复用 NoteView 的 `Atom` 类型 + `blockRegistry.buildSchema()`(全 30+ block / 全 marks)
- **转换层**:复用 NoteView 的 `converterRegistry.atomsToDoc()` / `docToAtoms()`,**不另写**
- **可视化层**:画板独立设计(对齐原则 5),编辑器 UI 裁剪 NoteView 全套到画板场景的子集

---

## 1. 语义层

### 1.1 Instance.doc 字段定义

```ts
// src/plugins/graph/library/types.ts
import type { Atom } from '../../../shared/types/atom-types';

export interface Instance {
  id: string;
  type: InstanceKind;
  ref: string;
  position?: { x: number; y: number };
  size?: { w: number; h: number };
  rotation?: number;
  endpoints?: [InstanceEndpoint, InstanceEndpoint];
  params?: Record<string, number>;
  style_overrides?: { ... };
  props?: Record<string, unknown>;

+ /** 文字节点的语义内容(仅 ref === 'krig.text.label' 时生效).
+  *  类型 = NoteView 同源 Atom (src/shared/types/atom-types.ts).
+  *  扁平存储,parentId 关联,与 NoteView 数据完全互通. */
+ doc?: Atom[];
}
```

**关键**:`Atom` 直接从 `src/shared/types/atom-types.ts` import,**画板不另起类型定义**。

### 1.2 Schema 来源(共用,不另起)

| 项 | 来源 |
|---|---|
| Schema 实例 | `blockRegistry.buildSchema()`(`src/plugins/note/registry.ts`)|
| Block 注册 | `registerAllBlocks()`(`src/plugins/note/blocks/index.ts`)— 全 30+ block 全部生效 |
| NodeView 工厂 | `blockRegistry.buildNodeViews()`— 全部生效(画板节点编辑态可正常显示 KaTeX / 图片占位 / table 等) |
| 转换层 | `converterRegistry.atomsToDoc()` / `docToAtoms()`(`src/plugins/note/converters/registry.ts`)|

**画板 schema 与 NoteView schema 是同一个实例**(单例模式,首次访问时 `registerAllBlocks` 已调,内存中只有一份)。

### 1.3 跨视图共享保证

按三层架构 §2.3"Atom 独立性原则",画板 text 节点的 doc 字段:

| 跨视图操作 | 行为 |
|---|---|
| 复制 NoteView 一段含 image / table / mathBlock / column-list 的内容 → 粘到画板 text 节点 | **完整保留全部 Atom 字段**(含 from / frame / links / meta);schema 不识别会触发 NoteView 既有的 fallback 路径(转 paragraph) |
| 复制画板 text 节点 → 粘到 NoteView | 完整保留;NoteView 渲染所有 block 类型 |
| 用户在画板上改了文字节点 → 同源 atom 是否同步到 NoteView? | **不同步**(三层架构 §2.4 的 v1.2 阶段处置:每个视图持有自己的 atom 副本,内联存储)。投影模型是 v3+ 远期愿景,M2.1 不实施 |

### 1.4 持久化(画板 graph.json 的 schema 升级)

`schema_version: 2 → 3`:
- 新增字段 `instance.doc`(可选;`Atom[]` 类型,直接 `JSON.stringify`)
- 老画板 deserialize 兼容:`doc` 字段缺失时 fallback 到空数组 `[]`(展示态显示空文字框)

`sanitizeInstance` 加白名单分支:
- `doc` 是数组且每元素含 `id` + `type` + `content` 时通过
- 否则丢弃整个 `doc` 字段并 console.warn(防御历史脏数据,沿用 M1.x.4 风格)

### 1.5 与三层架构原则的对齐自检

| 原则 | 本 spec 是否违反 | 备注 |
|---|---|---|
| 1. 语义层不知道可视化层 | ✅ 不违反 | doc 字段不含任何画板特有视图属性(画板的 position / size / style_overrides 在 Instance 上,不在 atom 上)|
| 2. 可视化层不直接通信 | ✅ 不违反 | 画板与 NoteView 通过 atom-types.ts 共享语义 |
| 3. 编辑态与展示态共享语义 | ✅ 不违反 | 画板内 text 节点的展示态 mesh / 编辑态 popup 共享同一份 `instance.doc` |
| 4. 新视图只增加可视化层 | ✅ 不违反 | 不动 NoteView schema,不动 NoteView converter,只在 graph 模块加可视化代码 |
| 5. 视图独立设计编辑能力 | ✅ 不违反 | 画板编辑器 UI(EditOverlay / SlashMenu / InlineToolbar)是 NoteView 全套的**裁剪子集**,符合"共用 Atom 是义务,共用编辑器是选项"|

---

## 2. 转换层

### 2.1 编辑路径(画板 text 节点 ↔ PM doc)

```ts
// 进入编辑态:Atom[] → PM doc
import { converterRegistry } from '@/plugins/note/converters/registry';
import { blockRegistry } from '@/plugins/note/registry';
import { registerAllBlocks } from '@/plugins/note/blocks';

// 一次性初始化(模块级)
registerAllBlocks();
const schema = blockRegistry.buildSchema();

// 进入编辑态时
const docJson = converterRegistry.atomsToDoc(instance.doc ?? []);
const pmDoc = schema.nodeFromJSON(docJson);

// ... 用户编辑 ...

// 退出编辑态时(commit):PM doc → Atom[]
const newAtoms = converterRegistry.docToAtoms(view.state.doc);
handleInstanceUpdate(instance.id, { doc: newAtoms });
```

**关键**:画板**不另写** atom-bridge / schema / converter。**全部复用** NoteView 已有
转换层。这是三层架构原则 4 的直接落地("不修改其他视图的转换层")。

### 2.2 展示路径(画板 text 节点 → SVG mesh)

`atomsToSvg(atoms)` 消费的 Atom **不是** NoteView 同源 Atom,而是 PM JSON 嵌套形态
(`src/lib/atom-serializers/types.ts`)。需要中间转换:

```ts
async function renderTextInstance(instance: Instance): Promise<THREE.Object3D> {
  // 1. 持久化态 Atom[](扁平,有 parentId)→ PM doc JSON(嵌套)
  const docJson = converterRegistry.atomsToDoc(instance.doc ?? []);

  // 2. 提取 doc.content(序列化器需要的形态)
  const pmJsonAtoms = (docJson.content ?? []) as SerializerAtom[];

  // 3. PM JSON → SVG mesh(沿用 backup `SvgGeometryContent.render`)
  return await textRenderer.render(pmJsonAtoms);
}
```

### 2.3 不识别 block 的处理(展示态降级)

`atomsToSvg` 当前只覆盖 `textBlock` / `mathBlock` / `mathInline` / `bulletList` /
`orderedList`。其他 block(`image` / `video` / `table` / `column-list` / `frame-block` /
`callout` / `blockquote` / `toggle-list` / `code-block` / `external-ref` / `tweet` / etc.)
**不渲染时不抛错,降级显示**:

| 不识别 block | 展示态行为 |
|---|---|
| `image` / `video` / `audio` / `tweet` | 显示一行灰字 `📷 [图片]` / `🎬 [视频]` 占位,字号 11,颜色 `#888` |
| `code-block` | 显示等宽字体提取出的代码文字(可能截断到首 40 字符)+ 灰底 |
| `table` / `column-list` / `frame-block` | 显示一行灰字 `📊 [表格]` / `▥ [多列]` 占位 |
| `callout` / `blockquote` / `toggle-list` | 取内层 textBlock 文字渲染,加左侧细条视觉提示 |
| `external-ref` | 显示标题(若有)或灰字占位 |

**实现**:在 `atom-serializers/svg/index.ts` 的 `renderAtom` switch 增加 `default` 分支
渲染降级 SVG path。**所有 atom 数据原样保留**(只影响视觉),不丢内容。

### 2.4 编辑态对未渲染 block 的处理

进入编辑态时,PM 用全套 schema + 全套 NodeView 渲染。所以即使展示态降级显示
"📊 [表格]",**双击进入编辑态时用户能看到完整的 table** 并编辑(只要画板节点尺寸够)。
退出编辑态后回展示态,table 又降级成灰字。

这是符合三层架构 §3.4 的"编辑/展示双态共享语义"原则:数据没变,只是渲染策略不同。

---

## 3. 可视化层(展示态)

### 3.1 TextRenderer

新建 `src/plugins/graph/canvas/scene/TextRenderer.ts`,**搬 backup 分支
`SvgGeometryContent.ts` 一字不改**。

接口:
```ts
class TextRenderer {
  async render(atoms: SerializerAtom[]): Promise<THREE.Object3D>;
  getBBox(rendered: THREE.Object3D): THREE.Box3;
  dispose(rendered: THREE.Object3D): void;
}
```

三级缓存(backup 已实现):
- L1:`atoms` JSON → SVG 字符串(`atom-serializers/svg/index.ts` LRU 1000)
- L2:SVG 字符串 → `ShapeGeometry[] + MeshBasicMaterial`(本类静态字段,LRU 500)
- L3:Mesh 不缓存(每次 `new Mesh`,共享 L2 引用)

### 3.2 NodeRenderer 集成

`NodeRenderer.ts` 创建节点 mesh 时识别文字节点:

```ts
if (instance.ref === 'krig.text.label') {
  // 1. atom 转换:NoteView Atom[] → PM JSON children
  const docJson = converterRegistry.atomsToDoc(instance.doc ?? []);
  const pmJsonAtoms = (docJson.content ?? []);

  // 2. SVG mesh
  const textGroup = await textRenderer.render(pmJsonAtoms);

  // 3. 套 outer/inner 嵌套(M1.x.1):outer.position = bbox 中心,inner = textGroup,offset -size/2
  // 4. 加隐形 hit-area 矩形(透明 mesh 覆盖整个 size,用于 hit-test)
  // 5. size 自动从 SVG bbox 算出(若 size 未指定);用户拖左右 handle 改宽,wrap 由内容自动算
}
```

**对齐保证**:textGroup 完全在 Three.js 世界坐标系,与 shape mesh **同坐标系、同
camera、同 frustum**。zoom / pan / rotation 操作天然一致,**无 DOM/WebGL 双轨问题**。

### 3.3 异步渲染时机

`atomsToSvg` 是 async(等 opentype.js 加载字体)。新建 instance 时:
- mesh 第一帧用占位矩形(对齐 backup `fallbackSvg`),保证 bbox 不为空
- atomsToSvg resolve 后填入真 mesh,触发 `dispatchChange()` 让 RAF 重绘
- 撞 [feedback_canvas_must_show_all_content] 风险:占位矩形保证 fitToContent 不算偏

### 3.4 NaN 防御

继承 [feedback_fitcontent_nan_defense]。`atomsToSvg` reject 时回退到 `extractPlainText`
+ 简单矩形 SVG。每个 ShapeGeometry 出来后 `computeBoundingBox()` + 4 分量
`Number.isFinite` 检查,不 finite 跳过该 unit。

---

## 4. 可视化层(编辑态)

### 4.1 模块结构

```
src/plugins/graph/canvas/edit/
├── EditOverlay.ts              # 主入口:enter(target) / exit(commit)
├── edit-overlay.css            # 浮窗样式(深灰圆角胶囊,对齐图二)
└── pm/
    ├── editor.ts               # GraphEditor:NoteView schema + 裁剪 plugins
    ├── plugins.ts              # 编辑器 plugin 清单(NoteView 子集 + graph 自有)
    ├── slash-menu.ts           # `/` 命令面板(画板裁剪版)
    ├── inline-toolbar.ts       # 选区浮 mark 按钮(画板裁剪版)
    └── math-popover.ts         # 公式 tex 输入弹窗(picked from 68df38a)
```

**注意**:**没有** `pm/schema.ts`(用 NoteView 的);**没有** `pm/atom-bridge.ts`(用
NoteView 的 converterRegistry)。

可视化层裁剪原则(对齐三层架构原则 5):
- **复用** NoteView 的 schema / NodeView 工厂 / converter
- **裁剪** plugin 清单(去掉画板场景不需要的)
- **重写** UI 浮层(SlashMenu / InlineToolbar — 自己设计画板专属体验)
- **不接** HandleMenu / ContextMenu / AskAIPanel

### 4.2 EditOverlay 主流程(参考 68df38a)

```ts
class EditOverlay {
  enter(target: { id, atoms /* NoteView Atom[] */, screenX, screenY, anchorOffsetY? }) {
    // 1. backdrop(fixed inset:0, z:1000),点空白处 = exit(commit=true)
    // 2. popup(absolute, 屏幕坐标,深灰圆角胶囊)
    // 3. popup 内挂 GraphEditor(EditorView + 裁剪 plugins + 完整 NodeView)
    // 4. popup 级 keydown 拦截 Esc / Cmd+Enter(capture 阶段,优先于 PM keymap)
    // 5. popup 级 keydown 阻止冒泡(防 GraphView 全局 Backspace/Delete 删节点)
    // 6. setTimeout(0) editor.focus()
  }
  exit(commit: boolean) {
    // commit=true → editor.getAtoms() → 回调
    // commit=false → 丢弃 → 回调 null
  }
}
```

### 4.3 GraphEditor:基于 NoteView schema 的 PM 编辑器

```ts
import { blockRegistry } from '@/plugins/note/registry';
import { registerAllBlocks } from '@/plugins/note/blocks';
import { converterRegistry } from '@/plugins/note/converters/registry';

let initialized = false;

class GraphEditor {
  private view: EditorView | null = null;

  constructor(mount: HTMLElement, initialAtoms: Atom[] /* NoteView 同源 */) {
    if (!initialized) {
      registerAllBlocks();
      converterRegistry.initConverters?.();
      initialized = true;
    }

    const schema = blockRegistry.buildSchema();
    const docJson = converterRegistry.atomsToDoc(initialAtoms);
    const pmDoc = schema.nodeFromJSON(docJson);

    const state = EditorState.create({
      schema,
      doc: pmDoc,
      plugins: buildGraphPmPlugins(schema),  // 裁剪版,见 §4.4
    });

    this.view = new EditorView(mount, {
      state,
      nodeViews: blockRegistry.buildNodeViews(),  // 全套 NodeView 复用
    });
  }

  getAtoms(): Atom[] {
    if (!this.view) return [];
    return converterRegistry.docToAtoms(this.view.state.doc);
  }
}
```

### 4.4 plugin 清单(NoteView 全套裁剪)

参考 [graph-labels 分支 NodeEditorPopup](../../../src/plugins/graph/components/NodeEditorPopup.tsx)
的 plugin 清单做基线(它已确认"接全套 NoteView plugin 是 v1.2 短期权宜"),按三层架构
原则 5 进一步裁剪到画板场景:

```ts
function buildGraphPmPlugins(schema: Schema): Plugin[] {
  return [
    // ── NoteView 复用 ──
    history(),
    buildInputRules(schema),                      // # / ## / ### / - / 1.
    keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
    keymap({ /* mark Mod-b/i/u, heading Mod-Alt-1/2/3, list Tab/Shift-Tab */ }),
    keymap(baseKeymap),
    slashCommandPlugin(),                         // 复用 NoteView 的(SlashMenu UI 自己换)
    linkClickPlugin(),
    pasteMediaPlugin(),                           // image / video paste
    smartPastePlugin(),                           // markdown paste
    blockSelectionPlugin(),
    indentPlugin(),
    ...blockRegistry.buildBlockPlugins(),         // 各 block 自带的 plugin
    blockHandlePlugin(),                          // M1 范围保留(节点尺寸够时显示)
    renderBlockFocusPlugin(),
    headingCollapsePlugin(),
    columnCollapsePlugin(),
    blockFramePlugin(),                           // 复用 frame 框定能力
    dropCursor({ color: '#8ab4f8', width: 2 }),
    gapCursor(),

    // ── 画板自有 ──
    buildInlineToolbarPlugin(),                   // 取代 NoteView FloatingToolbar(裁剪版)
  ];
}
```

**不接** NoteView 的:
- `thoughtPlugin`(graph 没 thought 锚点)
- `titleGuard`(graph 没 noteTitle)
- `vocabHighlight` / `fromPageDecoration`(note 特定)
- `aiSync`(依赖 note 的 AI 流程)
- `containerKeyboardPlugin`(画板 popup 内不需要 host-level 键盘行为)

### 4.5 UI 浮层(画板独立设计)

#### SlashMenu(画板裁剪版)

输 `/` 触发,垂直列表展示。**slash items 来源**:
- `blockRegistry.getSlashItems()` 全套
- 在画板**裁剪**:运行时过滤掉对画板节点意义不大的项:
  - 砍 `Add Thought`(画板没 thought)
  - 砍 `Note Link`(M2.5 才接,本阶段先不显示)
  - 砍 `External Ref`(画板节点不该 inline 嵌外部网页)
  - 保留 Heading / List / Math / Code / Image / Table / Callout / Quote / Frame 等

#### InlineToolbar(画板裁剪版,对齐图二)

选区非空浮出。按钮(参考 68df38a 自有实现 + NoteView FloatingToolbar 字段挑选):

| 图标 | 功能 |
|---|---|
| **B** | bold |
| *I* | italic |
| U | underline |
| <> | code |
| ∑ | 选区文字 → mathInline |
| 🔗 | 加链接(简化:文本 input 浮一个小弹窗) |
| `···` | 显式打开 FloatingInspector(M2.4 接通) |

**不接** NoteView FloatingToolbar 的:颜色 / 高亮 / 字号 / 字体(画板 v1 走快捷键 + 默认值;高级属性留 v1.x)

#### MathPopover(KaTeX tex 编辑)

完整搬 68df38a 的 `pm/math-popover.ts`(独立浮窗 + 实时 KaTeX 预览 + Cmd+Enter 提交)。

### 4.6 触发路径

```
InteractionController.handleDoubleClick
   ├ hitTest 命中 instance,且 instance.ref === 'krig.text.label'
   ├ → CanvasView.onTextEditStart(instanceId)
   ├ → mesh.visible = false
   ├ → HandlesOverlay 隐藏
   └ → editOverlay.enter({
         id: instanceId,
         atoms: instance.doc ?? [],
         screenX/screenY: worldToScreen(instance.position),
       })
   ↓
[用户输入]
   ↓
EditOverlay.exit(commit) → onExit(target, atoms | null)
   ├ commit=true: handleInstanceUpdate(id, { doc: atoms }) → NodeRenderer.update(异步重生成 mesh)
   ├ commit=false: 不动 doc,只清理
   ├ scheduleSave() (1s 防抖)
   ├ mesh.visible = true
   └ HandlesOverlay 重建(因 size 可能变了)
```

---

## 5. 可视化层(选中态辅助)

### 5.1 HandlesOverlay 改造

文字节点选中时显示 **左右 2 resize + 1 rotation**:

```ts
// HandlesOverlay 渲染时判断
if (instance.ref === 'krig.text.label') {
  // 仅 W、E 2 个 resize handle + 顶部 1 个 rotation handle
  // N/S/4 角不画(高度由内容决定)
} else if (isLine(instance)) {
  // 现有逻辑:2 个 endpoint handle
} else {
  // 现有逻辑:8 resize + 1 rotation
}
```

### 5.2 hit-test 隐形矩形

文字节点 SVG path 仅覆盖 glyph,glyph 之间空白处点不中。
**方案**:在 NodeRenderer 给文字节点加隐形矩形 hit-area(透明 mesh 覆盖整个 size,加在 inner 最底层),用于 hit-test 但不参与视觉渲染。

---

## 6. Toolbar 接通

[Toolbar.tsx](../../../src/plugins/graph/canvas/ui/Toolbar/Toolbar.tsx) 的
`onAddText?` 占位 prop 接通:

```ts
// CanvasView
const handleAddText = useCallback((anchorRect: DOMRect) => {
  setAddMode({ ref: 'krig.text.label', kind: 'text' });
}, []);

<Toolbar onAddText={handleAddText} ... />
```

addMode 进入后:
- 光标变 crosshair
- 用户点画布 → `placeInstance({ ref: 'krig.text.label', position, doc: [] })`
- 创建空 text instance + 自动选中 + **直接进入编辑态**(对齐 Freeform "新建即编辑")

---

## 7. 实施阶段

| 子阶段 | 内容 | 工时 |
|---|---|---|
| **M2.1.1** | Instance.doc 字段类型扩展 + sanitize 白名单 + schema_version v3 | 0.25 天 |
| **M2.1.2** | TextRenderer(搬 backup `SvgGeometryContent`)+ NodeRenderer 路由 + atomsToDoc 转换桥 + 隐形 hit-area | 0.5 天 |
| **M2.1.3** | `atom-serializers/svg` 增 unrecognized block 降级路径(占位 SVG path) | 0.25 天 |
| **M2.1.4** | EditOverlay + GraphEditor(用 NoteView schema + converter)+ 裁剪 plugin 清单 + Toolbar 接通 | 0.75 天 |
| **M2.1.5** | InlineToolbar / SlashMenu / MathPopover(参考 68df38a + 裁剪) | 0.5 天 |
| **M2.1.6** | InteractionController 双击触发 + HandlesOverlay 文字节点分支 | 0.25 天 |
| **M2.1.7** | 端到端 PoC + 验收(中英 / heading / list / 公式 / NoteView 互通) | 0.5 天 |
| **合计** | | **3 天** |

实施约束:M2.1 全程在 `feature/graph-canvas-m2-text` 子分支
(对齐 [Code-Diff §6.2](./Canvas-M2-Code-Diff.md#62-分支策略对齐-feedback_branch_module_boundary))。

> 工时上调说明(2.75 → 3 天):增加 M2.1.3 unrecognized block 降级路径(从纯文字
> fallback 改为按类型显示占位图标),保证未渲染 block 在画板上仍有合理视觉。

---

## 8. 验收清单

| # | 操作 | 预期 |
|---|---|---|
| 1 | Toolbar `[A]` → 画布点击 | 创建空 text instance,自动进入编辑态(光标已就位) |
| 2 | 输 "Hello 世界 🌍" → Cmd+Enter | 提交;mesh 显示矢量 SVG 文字(中英三段渲染);emoji 显示 tofu(M2.1 暂不解决) |
| 3 | 双击文字节点 | mesh 隐藏 + popup 浮出,光标在末尾 |
| 4 | 输 `# H1` 后空格 | 转 H1 |
| 5 | 输 `- ` 后写文字 | 进入 bullet list |
| 6 | 选中文字 → 点 `B` | bold 应用 |
| 7 | 选中文字 → 点 `∑` | 转为 mathInline 节点(KaTeX 渲染) |
| 8 | 输 `/` | slash menu 出现,选 "Math Block" → math-popover 出 |
| 9 | math-popover 输 tex `\frac{a}{b}` → Enter | KaTeX 渲染嵌入文档 |
| 10 | Esc | popup 关闭,内容回滚 |
| 11 | 点 backdrop | popup 关闭,内容提交 |
| 12 | 选中文字节点 → 拖左/右 handle | 节点宽度变;高度由内容自动算 |
| 13 | 选中文字节点 → 拖 rotation handle | 节点旋转 |
| 14 | 重启应用 → 重打开画板 | doc 完整恢复(含 list / math / 任意 block) |
| 15 | NoteView 复制一段 markdown(含 list + 公式 + image) → 粘到画板 text 节点 | **全部 atom 字段保留**(image 在画板展示态显示 `📷 [图片]` 占位,**双击编辑态**能看到 image NodeView) |
| 16 | 画板 text 节点 → 复制 → 粘到 NoteView | **全部 atom 字段保留**,NoteView 完整渲染 |
| 17 | zoom 至 50x / 0.05x | 文字矢量保真不糊 |
| 18 | 验证 NoteView 改了同 schema 后画板天然受益(零回归测试) | NoteView 加新 block 类型不需改画板代码,展示态降级路径自动兜底 |

---

## 9. 风险与避坑

| 风险 | 缓解 |
|---|---|
| `atomsToSvg` 是 async,首帧 mesh 为空导致 fitToContent 算偏 | 首帧用占位矩形;atomsToSvg resolve 后再替换 |
| 文字节点透明区域点不中 | 隐形 hit-area 矩形 |
| popup 内 keydown 冒泡到 GraphView 全局快捷键 | popup 级 keydown 在 capture 阶段拦截 Esc/Cmd+Enter,bubble 阶段 stopPropagation 全部 |
| 同时双击两个文字节点 | EditOverlay.enter 内:已激活时先 exit(commit) 再 enter 新的 |
| 编辑期间用户拖动画布 | backdrop 屏蔽画布交互;blur 时 popup 自然提交 |
| 粘贴含未知 block 的 atom | NoteView converter 已自带 fallback(转 paragraph);**画板展示态降级**(占位图标)+ **atom 完整保留** |
| **schema 演化:NoteView 加新 block 类型** | 画板**零代码改动**自动支持(仅展示态可能显示降级占位,直到 atomsToSvg 加新 case);这是三层架构的红利 |
| Atom 类型分歧:NoteView Atom(扁平 + parentId)vs 序列化器 Atom(PM JSON 嵌套) | 转换层 §2.2 已说明 pipeline:`Atom[] → atomsToDoc → docJson.content → atomsToSvg`;不混用 |
| GraphEditor 内的 blockRegistry 与 NoteEditor 是同一个单例 — 卸载时不能 destroy registry | 编辑器 destroy 只动 view 实例,不动 schema / registry / converter |

---

## 10. 与三层架构的精确映射(自检表)

| 三层架构概念 | 本 spec 对应 |
|---|---|
| 语义层(Atom)| `Instance.doc: Atom[]`(NoteView 同源)|
| 语义层持久化 | 画板 `graph.json` 的 `instances[].doc` 字段 |
| 语义层共享性 | 画板 ↔ NoteView 双向粘贴 100% 无损 |
| 转换层(读·展示态) | `atomsToDoc` + `atomsToSvg` 两步串联 |
| 转换层(读·编辑态) | `atomsToDoc` + `schema.nodeFromJSON` |
| 转换层(写·编辑态) | `docToAtoms`(commit 时) |
| 可视化层(展示态) | TextRenderer mesh(Three.js Group)|
| 可视化层(编辑态) | EditOverlay popup + GraphEditor + 画板自有 SlashMenu/InlineToolbar/MathPopover |
| 视图独立编辑能力(原则 5) | 画板裁剪 NoteView plugin 清单(去 thought/title/aiSync 等);UI 浮层重做(去 HandleMenu/ContextMenu/AskAIPanel,SlashMenu/InlineToolbar 重写);**核心 schema 与 NoteView 共享** |
| 编辑/展示双态共享语义(原则 3) | 同一份 `instance.doc` 驱动两种渲染;切换走"提交 → 重生成 mesh"流水线 |
| 不修改其他视图(原则 4) | 画板**零代码改动** NoteView;仅 import NoteView 公开 API |

---

## 11. 参考资料

### 关键依赖

- [KRIG-Three-Layer-Architecture.md](../../KRIG-Three-Layer-Architecture.md)
- [src/shared/types/atom-types.ts](../../../src/shared/types/atom-types.ts) — 语义层 Atom
- [src/plugins/note/registry.ts](../../../src/plugins/note/registry.ts) — schema / NodeView 来源
- [src/plugins/note/converters/registry.ts](../../../src/plugins/note/converters/registry.ts) — converter 来源
- [src/plugins/note/blocks/index.ts](../../../src/plugins/note/blocks/index.ts) — `registerAllBlocks`
- [src/lib/atom-serializers/svg/](../../../src/lib/atom-serializers/svg/) — 展示态序列化器(已现成)

### 蓝本(可视化层 UI 参考)

- `commit 68df38a5`(2026-04-26)— `src/plugins/graph/rendering/edit/`:
  - **参考**:`EditOverlay.ts` / `pm/math-popover.ts` / `pm/inline-toolbar.ts` / `pm/slash-menu.ts` / `pm/nodeviews.ts`(KaTeX NodeView)
  - **不参考**:`pm/schema.ts`(违反原则 1 自建 schema)/ `pm/atom-bridge.ts`(违反原则 1 自建 atom 形态)/ `pm/plugins.ts`(基于自建 schema,需重写为基于 NoteView schema)
- backup 分支 `SvgGeometryContent.ts`(展示态 SVG → mesh 完整移植)

### 内部 spec

- [Canvas.md](./Canvas.md) — Canvas v1 spec(M1)
- [Canvas-M2-Spec.md](./Canvas-M2-Spec.md) — M2 总 spec
- [Canvas-M2-Code-Diff.md](./Canvas-M2-Code-Diff.md) — 现状对照
- [Freeform-Alignment-Backlog.md](./Freeform-Alignment-Backlog.md) — backlog

### 相关 KRIG memory

- [feedback_canvas_must_show_all_content] — fitToContent 是底线
- [feedback_threejs_retina_setsize] — Retina setSize 第三参数
- [feedback_fitcontent_nan_defense] — NaN 防御
- [feedback_canvas_container_must_always_render] — 容器始终渲染
- [project_graph_labels_branch_kept] — graph-labels 分支保留作对照
- [feedback_branch_module_boundary] — 分支按模块切
- [project_two_atom_layers] — note 是语义本身,各 view 是同一 note 的不同呈现

---

**文档版本**:v0.2(按三层架构纠正,Atom schema 100% 与 NoteView 共享)
**编写日期**:2026-04-30
**前置条件**:Canvas-M2-Spec.md / Canvas-M2-Code-Diff.md 已落
**蓝本**:NoteView schema/converter + 68df38a 可视化层 UI 设计 + backup SvgGeometryContent
