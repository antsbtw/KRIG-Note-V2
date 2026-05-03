# Canvas 与 Note · 共享语义层架构升级

> **范围**:把"画板"从独立资源(`graph_canvas` 表 + 独立 store + 独立 IPC)
> **降为与 NoteView 共享同一份语义层 atom 数据**。Canvas 与 Note **是两个平等视
> 图**,各自有完全独立的渲染管线 — 仅在语义层(atom 存储格式)统一,**渲染层完
> 全不共享**(NoteView 走 PM DOM 文本流,CanvasView 走 SVG → Three.js 几何 mesh)。
>
> **依据**:[KRIG-Three-Layer-Architecture.md](../KRIG-Three-Layer-Architecture.md)
> §2.4 长期愿景"投影模型"的具体落地。
>
> **状态**:架构决议草案(2026-05-01)。**M2.1 文字节点开发期间不实施**,作为
> M2.1 验收后、M2.5 Note Ref 之前的专项工作推进。

---

## 0. 决策摘要

### 0.1 一句话决议

> **Canvas 和 Note 是两个平等视图,共享语义层 atom[] 存储格式,渲染管线完全独立。**
>
> 同一份 atom 数据被 NoteView 用 ProseMirror DOM 渲染为文本流,被 CanvasView 用
> SVG → Three.js mesh 渲染为图形 + 文字框。每个视图持有自己的
> `atom.meta.<viewKey>` 子字段表达视图特性,**meta 是视图独有的,但 atom 内容、id、
> parentId、type 完全共享**。

### 0.2 三个关键事实

1. **资源统一**:画板和 note 是平等视图,共享同一份资源(同一个 id / title /
   atom[])。NavSide 资源列表是单一 note 列表
2. **数据共享**:atom 是一等公民,被多视图共享(只有存储格式相同,渲染管线各自独立)
3. **视图特性正交**:每个视图自己持有渲染必需的元数据,**挂在
   `atom.meta.<viewKey>`**(对齐三层架构 §2.3 命名空间隔离)

### 0.3 一图概括

```
┌─────────────────────────────────────────────────────────────────┐
│ 语义层(单一真实来源 · NoteView 同源)                           │
│                                                                  │
│  note 表 (id, title, doc_content: Atom[])                        │
│   ├ doc_content = [                                              │
│   │   { id, type: 'textBlock', content: [...], meta: {           │
│   │       canvas: { position, size, ... }                        │
│   │   } },                                                       │
│   │   { id, type: 'canvasShape', meta: {                         │
│   │       canvas: { position, size, shapeRef, params, ... }      │
│   │   } },                                                       │
│   │   { id, type: 'canvasLine', meta: {                          │
│   │       canvas: { endpoints, pathStyle, ... }                  │
│   │   } },                                                       │
│   │   ...                                                        │
│   │ ]                                                            │
└────────┬────────────────────────────────────────────────────────┘
         │
         ├── NoteView 打开                        ├── CanvasView 打开
         │   ↓                                    │   ↓
         │ 不读 meta.canvas                        │ 读 atom.type + meta.canvas
         │ 按 atom.type 渲染:                     │ 按 type 分发:
         │ - textBlock → 段落                     │ - textBlock → SVG 文字 mesh
         │ - canvasShape → 占位行 [Shape]         │ - canvasShape → 几何图形
         │ - canvasLine → 占位行 [Line]           │ - canvasLine → 线条 mesh
         │                                        │
         ↓                                        ↓
   线性笔记视图                            画板视图
   (atom 内容流式呈现)                    (atom 按 meta.canvas 定位为空间网络)
```

---

## 1. 数据模型

### 1.1 `AtomMeta` 字段扩展

当前([atom-types.ts](../../src/shared/types/atom-types.ts) §35):

```ts
export interface AtomMeta {
  createdAt: number;
  updatedAt: number;
  nodeIds?: string[];
  dirty: boolean;
}
```

升级:

```ts
export interface AtomMeta {
  createdAt: number;
  updatedAt: number;
  nodeIds?: string[];
  dirty: boolean;

  // ── per-view 视图特性(各视图命名空间隔离) ──
  canvas?: CanvasAtomMeta;
  // timeline?: TimelineAtomMeta;    // 未来 TimelineView
  // mindmap?: MindMapAtomMeta;      // 未来 MindMapView
  // kanban?: KanbanAtomMeta;        // 未来 KanbanView
}

/**
 * Canvas 视图独有的渲染元数据
 *
 * 仅 CanvasView 读取;NoteView 等不识别.
 * 每个视图按自己的命名空间放数据,互不干扰(对齐三层架构 §2.3).
 */
export interface CanvasAtomMeta {
  /** 在画板上的位置(世界坐标) */
  position?: { x: number; y: number };
  /** 在画板上的大小(覆盖 shape 默认 viewBox) */
  size?: { w: number; h: number };
  /** 旋转(度数,顺时针) */
  rotation?: number;
  /** shape 引用(仅 type='canvasShape' 用):krig.basic.roundRect / krig.line.elbow / ... */
  shapeRef?: string;
  /** 用户调整的 shape 参数 */
  shapeParams?: Record<string, number>;
  /** 样式覆盖(覆盖 shape default_style) */
  styleOverrides?: {
    fill?: { type?: 'none' | 'solid'; color?: string; transparency?: number };
    line?: { type?: 'none' | 'solid'; color?: string; width?: number; dashType?: string };
    arrow?: { begin?: string; end?: string };
  };
  /** 仅 type='canvasLine' 用:两端连接的 atom + magnet */
  endpoints?: [
    { atomId: string; magnet: string },
    { atomId: string; magnet: string },
  ];
  /** 仅 type='canvasLine' / connector 用:路径风格 */
  pathStyle?: 'straight' | 'elbow' | 'curved';
  /** 仅 type='canvasLine' / elbow connector 用:用户拖出的拐角 */
  waypoints?: Array<{ x: number; y: number }>;
}
```

### 1.2 新 atom type 清单

| atom.type | NoteView 渲染 | CanvasView 渲染 | 说明 |
|---|---|---|---|
| `textBlock` / `bulletList` / `mathBlock` / ... | 正常段落 / 列表 / 公式 | SVG 文字 mesh(用 meta.canvas.position 定位) | 完全复用 NoteView 已有 block,加 meta.canvas 决定空间位置 |
| `canvasShape`(新) | 占位行 `[Shape: roundRect]` | 几何图形 mesh(用 meta.canvas.shapeRef + params) | 画板上的图形(矩形/椭圆/流程图等) |
| `canvasLine`(新) | 占位行 `[Line]` | 线条 mesh(用 meta.canvas.endpoints) | 画板上的连线 |
| `canvasSubstance`(新) | 占位行 `[Substance: family.person]` | 复合图形(展开 components) | 画板上的 substance 实例 |
| `noteRef`(M2.5)| 行内链接 `[[Note Title]]` | 引用节点 mesh(显示 note 标题 + 摘要) | 画板嵌入另一篇 note |

### 1.3 用户在画板上"放一个矩形"的最终数据

```jsonc
// note.doc_content
[
  {
    "id": "atom-001",
    "type": "canvasShape",
    "content": [],           // 形状本身无文字内容
    "meta": {
      "createdAt": ..., "updatedAt": ..., "dirty": false,
      "canvas": {
        "position": { "x": 100, "y": 80 },
        "size": { "w": 160, "h": 60 },
        "rotation": 0,
        "shapeRef": "krig.basic.roundRect",
        "shapeParams": { "r": 0.15 },
        "styleOverrides": {
          "fill": { "color": "#a8c7e8" }
        }
      }
    }
  }
]
```

NoteView 看到这个 atom 不识别 type → 降级为 `[Shape: roundRect]` 一行(对齐
M2.1.3 已实现的 unrecognized block 降级路径)。
CanvasView 看到 → `meta.canvas.shapeRef` 拿 shape 定义 + `meta.canvas.position/size`
摆位 → 渲染圆角矩形 mesh。

### 1.4 用户在画板上"放一个文字框"的最终数据

```jsonc
// note.doc_content
[
  // 容器 atom:画板上一个文字框 = 一组 textBlock atoms,共享同一个 parentId(text-frame)
  // 或:文字框作为容器 atom 自身,内部 textBlock 通过 parentId 关联
  {
    "id": "atom-002",
    "type": "textFrame",       // 新 atom type:画板上的文字框容器
    "meta": {
      "createdAt": ..., "updatedAt": ..., "dirty": false,
      "canvas": {
        "position": { "x": 200, "y": 120 },
        "size": { "w": 200, "h": 40 },
        "rotation": 0,
      },
    },
  },
  {
    "id": "atom-003",
    "type": "textBlock",
    "parentId": "atom-002",     // 通过 parentId 关联到 textFrame
    "order": 0,
    "content": [
      { "type": "text", "text": "测试" },
    ],
    "meta": { ... },
  },
  {
    "id": "atom-004",
    "type": "textBlock",
    "parentId": "atom-002",
    "order": 1,
    "content": [
      { "type": "text", "text": "正常" },
    ],
    "meta": { ... },
  },
]
```

NoteView 看到:
- `textFrame` 不识别 → 降级
- 两个 textBlock(parentId 指向 textFrame)→ NoteView 不知道 textFrame 是什么,这两
  个 textBlock 显示为顶层段落

→ 在 NoteView 视角看见 "测试" 和 "正常" 两个独立段落。

CanvasView 看到:
- `textFrame` → 创建一个文字节点 mesh,从 meta.canvas 拿位置 / 大小
- 两个 textBlock(parentId='atom-002')→ 是 textFrame 的内容,通过 atomsToSvg
  渲染成 SVG mesh,塞到 textFrame 容器

→ 在 CanvasView 视角看见一个文字框,里面有两行 "测试 / 正常"。

### 1.5 view-specific 表(画板视口 / user_substances)

不是所有视图特性都适合挂 atom.meta — **画板级**(不属于任何单 atom 的)需要单独表:

```sql
-- 画板视口 / user_substances 等 per-note 视图状态
CREATE TABLE canvas_meta (
  noteId        STRING PRIMARY KEY,    -- 关联 note 表
  view_center_x FLOAT,
  view_center_y FLOAT,
  zoom          FLOAT,
  user_substances JSON,                -- 用户创建的 SubstanceDef 列表
  schema_version INT
);
```

NoteView 不读 canvas_meta;CanvasView 加载 note 时同步读 canvas_meta 拿视口 + user_substances。

---

## 2. 当前 vs 目标对照

### 2.1 数据存储

| 项 | 当前(M1 + M2.1 过渡态) | 目标(本 spec) |
|---|---|---|
| 资源表 | `note` + `graph_canvas` 两张表 | 仅 `note` 表 + `canvas_meta` 辅助表 |
| 画板 title | `graph_canvas.title` | `note.title` |
| 画板内容 | `graph_canvas.doc_content`(结构化 JSON: `{instances, view, user_substances}`)| `note.doc_content`(Atom[])+ `canvas_meta`(视口 + user_substances) |
| 画板上的形状 | `Instance` 类型(`{ id, type, ref, position, size, ... }`)| `canvasShape` 类 atom(meta.canvas 字段) |
| 画板上的文字 | `Instance.doc: Atom[]`(M2.1 过渡设计)| `textFrame` atom + 子 textBlock atoms |

### 2.2 IPC 通道

| 当前 | 目标 |
|---|---|
| `graphCreate / graphLoad / graphSave / graphRename / graphDelete / graphList` | `noteCreate(view: 'graph')` / `noteLoad / noteSave / noteRename / noteDelete / noteList` |
| `graphFolderCreate / graphFolderRename / ...` | 复用 NoteView 的文件夹通道 |

NoteView 的 IPC 通道增加一个**可选 view variant 参数**(`view: 'note' | 'graph' | ...`),
画板创建时 `view='graph'`,普通笔记 `view='note'`。

### 2.3 NavSide

| 当前 | 目标 |
|---|---|
| GraphPanel(画板列表)+ NotePanel(笔记列表),并存 | 单一 NotePanel,note 列表项含 view 标识(画板用画板图标,笔记用笔记图标) |
| 画板和笔记不能跨拖动 / 互转 | 画板和笔记可在 NavSide 互拖到对方文件夹;view 在 note.view 字段切换(用户主动) |

### 2.4 视图切换

```
画板 note 在 NoteView 打开 → 看到 atom 流式列表(textBlock 显示文字,canvasShape 显示占位)
画板 note 在 CanvasView 打开 → 看到画板(textFrame 显示文字框,canvasShape 显示图形)

[切换视图] 按钮:从 NoteView 顶部 toolbar 一键切到 CanvasView,反之亦然
```

---

## 3. 与 ebook / web view 的关系

ebook / web 当前也是独立资源(对齐 graph 形态)。本 spec **不动 ebook / web**:
- ebook 的 doc_content 是 PDF 二进制 / EPUB 文件,**不是 atom[]**,与 note 共享语义层不适用
- web 的内容是外部网页快照,同理

**只有数据形态本质是 atom[] 的视图(graph / 未来的 timeline / mindmap / kanban)**
才走"视图变体"路线;ebook / web 保持独立资源。

→ note 表的 `view` 字段允许的值:`'note' | 'graph' | 'timeline' | 'mindmap' | 'kanban'`(都是 atom-based 视图)。

---

## 4. NoteView 渲染画板 note 的契约

NoteView 加载某个 note 时,对每个 atom:
- **type 已识别**(textBlock / bulletList / mathBlock / ...):正常渲染
- **type 未识别**(canvasShape / canvasLine / canvasSubstance / textFrame 等画板独有):
  - 降级为一行灰字占位,内容由 atom-serializers 已实现的 [unknownAtomLabel](../../src/lib/atom-serializers/svg/index.ts) 决定(M2.1.3 阶段已写)
  - 例:`[Shape: roundRect]` / `[Line]` / `[Frame]`
- **textBlock + parentId 指向 textFrame**:NoteView 不识别 textFrame → 把这些 textBlock
  当顶层段落渲染(parentId 信息丢失)

→ NoteView 的代码改动量:**0**。降级路径已在 atomsToSvg 实现,NoteView 自己的渲染
  对未知 type 的 fallback 已有(空段落)。M2.1.3 的 unknownAtomLabel 是给 atomsToSvg
  用的(画板展示态),NoteView 编辑态本身有自己的 fallback。

---

## 5. 实施分阶段(估 3 天)

### M3.1.1 — atom-types.ts 升级(0.25 天)

- 加 `AtomMeta.canvas?: CanvasAtomMeta`
- 加 `CanvasAtomMeta` 接口定义
- 加 atom type 常量(`canvasShape` / `canvasLine` / `canvasSubstance` / `textFrame`)

### M3.1.2 — note schema 加 view 字段 + canvas_meta 表(0.5 天)

- note 表加 `view: 'note' | 'graph' | ...`(默认 'note')
- 新建 `canvas_meta` 表
- 数据库 schema migration

### M3.1.3 — IPC 通道改造(0.5 天)

- noteCreate/Load/Save 等加 view 字段处理
- canvas_meta IPC handlers
- 删除 graph_canvas 相关 IPC(标记 deprecated 一段时间)

### M3.1.4 — NavSide 合并(0.5 天)

- GraphPanel 删除,合并到 NotePanel
- NotePanel 列表项按 note.view 显示不同图标
- 支持 note.view 切换(右键菜单)

### M3.1.5 — Canvas 渲染层适配(0.75 天)

- NodeRenderer:从 note.doc_content(Atom[])反推 canvas 拓扑
  - 遍历 atoms,按 atom.type 分发到 renderShape / renderLine / renderTextFrame
  - 从 atom.meta.canvas 取 position / size / 等
- serialize:画板修改时,把 NodeRenderer 当前状态序列化为 note.doc_content
- M2.1 写的 EditOverlay / GraphEditor 适配新 atom 形态(textFrame + 子 textBlock)

### M3.1.6 — 数据迁移(0.25 天)

- 已有 graph_canvas 记录迁移到 note 表 + canvas_meta 表
- 旧 instances 转换为 atom 数组(`Instance` → `canvasShape` 等)
- 验证迁移幂等

### M3.1.7 — 验收(0.25 天)

- 画板 note 在 NoteView 打开能看到降级占位
- 画板 note 在 CanvasView 打开能看到图形 + 文字框
- 视图切换 toolbar 按钮正常
- 已有 M1 / M2 画板数据完整保留

---

## 6. 关键风险

| 风险 | 缓解 |
|---|---|
| 用户已有 M1 + M2.1 画板数据迁移失败 | M3.1.6 迁移脚本写完后,先在备份数据上跑一次,完整 round-trip 验证 |
| NoteView 看到大量未识别 atom 时性能问题 | atomsToSvg 已有 LRU cache;NoteView fallback 路径性能可接受(简单空段落) |
| atom.meta 字段膨胀(各视图都加自己的 meta)| 命名空间隔离(meta.canvas / meta.timeline 等),不冲突;字段大小可控(单 atom 几十字节) |
| Atom.parentId 跨 textFrame 关联,docToAtoms / atomsToDoc round-trip 是否保真 | converterRegistry 已内建 parentId 处理,验证一遍即可 |
| view 切换时编辑状态丢失 | 切换前自动 save;NoteView/CanvasView 切换是 view 级别,内容保持一份 |

---

## 7. 时机 — 为什么不在 M2.1 里改

M2.1 已经投入 4 个子阶段(M2.1.1 ~ M2.1.4)的代码,核心抽象是 `Instance.doc`。
本 spec 的目标抽象是 `note.doc_content[i].meta.canvas` — 完全不同的数据契约。

**两条路**:
- 立刻改:扔掉 M2.1 已写代码,先做架构迁移(2-3 天),再重写 M2.1 在新架构上(同等工时 2-3 天)= 总 5-6 天
- M2.1 验收后改:M2.1 在过渡架构上完成(剩 ~1 天 PoC + 验收),验收通过获得"文字
  节点能用"红利,然后专项 3 天做架构迁移,M2.1 已落地代码作为迁移目标的"参考实现"
  对照修改 = 总 4 天

**选择第二条**:
- M2.1 已写代码不浪费 — 它是新架构里 CanvasView "如何渲染 textFrame"的事实样板
- 用户能尽早用上文字节点(对当前迭代节奏不冲击)
- 架构迁移作为独立 milestone(M3),与 M2.1 / M2.2 / M2.5 等迭代解耦

**M3 必须在 M2.5(Note Ref 节点)之前完成** — Note Ref 的核心是"画板节点引用一篇
note",如果画板自己就是 note,引用通路只有一条 noteId;否则 M2.5 设计两套引用通
路(noteId / canvasId),后期再合是更大代价。

---

## 8. 与三层架构的精确映射

| 三层概念 | 本 spec 对应 |
|---|---|
| 语义层 | `note.doc_content: Atom[]`(单一真实来源)|
| 转换层(NoteView 读) | `converterRegistry.atomsToDoc()` (NoteView 已有) |
| 转换层(NoteView 写) | `converterRegistry.docToAtoms()` (NoteView 已有) |
| 转换层(CanvasView 读) | atom.type 分发渲染:textBlock → atomsToSvg → mesh;canvasShape → ShapeRegistry → mesh;... |
| 转换层(CanvasView 写) | NodeRenderer 状态 → atom[](按 type 写回 doc_content + meta.canvas) |
| 可视化层(NoteView)| 展示 / 编辑器 |
| 可视化层(CanvasView)| 展示 / 编辑器(EditOverlay)|
| 视图独立编辑能力(原则 5)| Note 用 NoteEditor + 全套 plugin;Canvas 用 EditOverlay + 裁剪 plugin |
| 视图协作通过语义层(原则 2)| 画板内容改 → 写 atom → NoteView 重读自动更新 |

---

## 9. 决策留痕

| 决策 | 结论 | 日期 |
|---|---|---|
| 画板与 note 共享语义层(共享 atom)| 采纳 | 2026-05-01 |
| 视图特性走 atom.meta.<viewKey> 命名空间隔离 | 采纳(对齐三层架构 §2.3)| 2026-05-01 |
| ebook / web 不走视图变体路线(数据形态非 atom)| 采纳(保持独立资源)| 2026-05-01 |
| 选 立场 A(canvasShape 等新 atom type)而非 立场 B(meta 表达画板特性 + atom type 不变)| 采纳:atom.type 显式区分能让 NoteView fallback 路径精确,且 type 是已有概念,扩展成本低 | 2026-05-01 |
| M2.1 不实施本 spec,作为 M3 独立工作 | 采纳:保护当前 M2.1 已落地代码的红利 | 2026-05-01 |
| 必须在 M2.5(Note Ref 节点)之前完成 | 采纳:避免两套引用通路 | 2026-05-01 |

---

## 10. Open Questions

### 10.1 textFrame 还是用 parentId 表达?

本 spec §1.4 用 `textFrame` atom + 子 textBlock(parentId 关联)表达画板上的文字框。
另一种方案是 textBlock 直接挂 `meta.canvas.position`,无 textFrame 容器 — 但这样多
行文字框就变成多个独立的 atom,失去"它们属于同一个文字框"的语义,后续操作(整个
文字框拖动 / 删除)不便。

**推荐 textFrame 容器方案**(§1.4),但留待 M3.1.1 实施时复核。

### 10.2 canvasShape 是 block 还是新增一个 group?

PM schema 中的 atom 都属于 'block' 或 'inline' group。canvasShape 在 NoteView 里不
应该出现(只有 fallback 占位行),技术上还是 'block' 方便,但语义上它是"画板独有"。

**推荐 group='block'**(简化:NoteView 看到 group='block' 但 type 不识别 →fallback)。

### 10.3 多 view 共享时,meta 是否要冲突解决?

如果 atom.meta.canvas.position 在多个画板里出现(同一个 atom 被多个画板引用),哪个
画板的 position 算数?

**短期**:画板内的 atom 是画板独有的(在该画板里创建),meta.canvas 与 noteId 隐式
绑定。不存在多画板共享同一 atom 的情况。
**长期**(投影模型):atom.meta.canvas 升级为 `meta.canvas[noteId]`,每个画板各自的
位置(三层架构 §2.4 投影模型的精确落地)。

---

**文档版本**:v0.1(架构决议草案)
**编写日期**:2026-05-01
**前置依赖**:[KRIG-Three-Layer-Architecture.md](../KRIG-Three-Layer-Architecture.md)
**实施 milestone**:M3(M2.1 验收后,M2.5 Note Ref 之前)
