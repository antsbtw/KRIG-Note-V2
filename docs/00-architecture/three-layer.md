# KRIG 三层架构 · 顶层设计规范

> Architecture Spec v1.0 · 2026-04-25
>
> 修订作者：wenwu + Claude
>
> 本规范是 KRIG 的**顶层架构设计**，定义所有视图（Note / Graph / 未来视图）共同遵循的语义/可视化分层模型。
>
> 所有视图的具体设计文档（如 `KRIG_GraphView_Spec_v1.x.md`）都是本规范的实例。

---

## 0. 本文档的角色

### 0.1 在 KRIG 文档体系中的位置

```
KRIG 文档体系（按抽象层次）

  ┌─ 顶层规范 ─────────────────────────────────────┐
  │ KRIG-Three-Layer-Architecture.md（本文档）      │
  │   └─ 定义语义/转换/可视化三层模型               │
  │                                                  │
  │ 视图层级定义.md                                  │
  │   └─ 定义 L0~L5 物理层级（应用/窗口/Shell/...） │
  └──────────────────────────────────────────────────┘
                       ↑
                       │ 引用
                       ↓
  ┌─ 语义层规范 ───────────────────────────────────┐
  │ Ai-Design/KRIG-Atom体系设计文档.md              │
  │   └─ 定义 Atom 的具体形态                       │
  │ note/Schema-Reference.md                         │
  │   └─ Block 类型清单                             │
  └──────────────────────────────────────────────────┘
                       ↑
                       │ 引用
                       ↓
  ┌─ 视图规范（各视图的具体实例） ─────────────────┐
  │ graph/KRIG_GraphView_Spec_v1.x.md                │
  │ note/Block-框定渲染-需求文档.md                  │
  │ note/Paste-Module-Design.md                      │
  │ thought/...                                      │
  │ ebook/...                                        │
  │ web/...                                          │
  └──────────────────────────────────────────────────┘
```

### 0.2 与其他规范的关系

| 文档 | 关系 |
|------|------|
| [视图层级定义.md](视图层级定义.md) | **物理层级**（Application/Window/Shell/Workspace/Slot/View），从用户感知角度划分 |
| 本文档 | **语义层级**（语义/转换/可视化），从数据流向角度划分 |
| [Ai-Design/KRIG-Atom体系设计文档.md](Ai-Design/KRIG-Atom体系设计文档.md) | 语义层最小单元 Atom 的具体定义（被本文档引用） |
| [graph/KRIG_GraphView_Spec_v1.2.md](graph/KRIG_GraphView_Spec_v1.2.md) | Graph 视图的具体设计（应符合本文档的三层模型） |

物理层级（L0~L5）与语义层级**正交**：一个 View（L5）实例，是某个可视化层的具体落地。

### 0.3 何时应该读本文档

- 设计新视图时（Timeline / Kanban / Mindmap / BPMN ...）
- 增加新 Block 类型时
- 设计跨视图能力时（如 Note ↔ Graph 数据互通）
- 修订已有视图的架构时

---

## 1. 三层模型总览

### 1.1 一图概括

```
┌─────────────────────────────────────────────────────┐
│ 可视化层（Visualization Layer）                      │
│                                                       │
│   ┌──────┐  ┌───────┐  ┌─────┐         ┌──────┐    │
│   │ Note │  │ Graph │  │ ... │   ...   │ 其它 │    │
│   └──┬───┘  └───┬───┘  └──┬──┘         └──┬───┘    │
└──────┼──────────┼─────────┼────────────────┼────────┘
       ↕          ↕         ↕                ↕
┌──────┴──────────┴─────────┴────────────────┴────────┐
│ 转换层（Translation Layer，每个视图自带 adapter）     │
│                                                       │
│   ┌──────┐  ┌───────┐  ┌─────┐         ┌──────┐    │
│   │ 转换1 │  │ 转换2 │  │ ... │   ...   │ 转换n │    │
│   └──┬───┘  └───┬───┘  └──┬──┘         └──┬───┘    │
└──────┼──────────┼─────────┼────────────────┼────────┘
       ↕          ↕         ↕                ↕
┌──────┴──────────┴─────────┴────────────────┴────────┐
│ 语义层（Semantic Layer）                              │
│                                                       │
│   Atom：内容的最小单元（与可视化无关）                │
│   - block 类型：textBlock / mathBlock / codeBlock... │
│   - mark 类型：bold / italic / link...                │
│   - 关系类型：（待定，见 § 7 Open Questions）         │
└──────────────────────────────────────────────────────┘
```

### 1.2 三层定义（一句话版）

| 层 | 定义 | 例子 |
|----|------|------|
| **语义层** | 内容是什么（与"怎么显示"无关） | "x² + 1 是抛物线" 这件事 = 一个 textBlock + 一个 mathBlock |
| **转换层** | 把语义投影成某种可视化形态（双向） | 把 atom 数组转换为 ProseMirror DOM；把 atom 数组转换为 SVG |
| **可视化层** | 用户看到/操作的具体表现 | Note 的滚动文本流、Graph 的节点网络 |

### 1.3 为什么是三层（不是两层 / 四层）

**两层不够**：直接 "语义 ↔ 可视化" 会让每个视图重复做转换工作，且不同视图之间难以协作。**转换层把"如何投影"显化**，让转换工作可复用、可独立测试。

**四层多余**：`语义 → 中间形态 → 转换 → 可视化` 这种层叠不会带来明显收益，反而增加调试难度。三层是"刚好够用"的最简模型。

### 1.4 各层的权责边界

| 该层做 | 该层不做 |
|--------|----------|
| **语义层**：定义内容数据形态（Atom）；持久化（SurrealDB） | 不知道任何可视化层的存在；不参与渲染 |
| **转换层**：消费 atom[] 输出可视化形态；处理可视化层修改回写到 atom[] | 不持有视图状态（光标、选区、缩放等）；不直接和其他可视化层通信 |
| **可视化层**：提供用户可操作的视图；管理视图本地状态 | 不直接读写 SurrealDB；不知道其他可视化层的存在 |

### 1.5 数据流向

```
读路径（语义 → 可视化）：
  SurrealDB → 语义层（Atom[]） → 转换层 → 可视化层

写路径（可视化 → 语义）：
  可视化层（用户操作） → 转换层 → 语义层（Atom[]） → SurrealDB
```

→ **数据流向的不变量**：
- 可视化层之间不直接传数据
- 跨视图协作必须通过语义层中转

---

## 2. 语义层（Semantic Layer）

### 2.1 定义

语义层存储的是**内容本身**，与"内容如何被用户看到"完全无关。它的核心特性：

- **不可观测的数据结构**：用户从不直接看见语义层（看到的都是某种可视化形态）
- **跨视图共享**：同一份语义内容可被任意可视化层消费
- **持久化是它的唯一物理形态**：SurrealDB 中存储的就是语义层数据

### 2.2 Atom：语义层的最小单元

**Atom = ProseMirror node JSON 形态**：`{ type, content?, attrs?, marks?, text? }`

具体类型在 [Ai-Design/KRIG-Atom体系设计文档.md](Ai-Design/KRIG-Atom体系设计文档.md) 中定义。本规范不重复列举 Block 类型清单。

**Atom 的关键属性**：

| 属性 | 说明 |
|------|------|
| **平坦性** | Atom 数组平铺存储，不强求树形（嵌套通过 `content` 字段实现） |
| **不可变性** | 同一份 Atom 数据被多个可视化层消费时，每个视图持有自己的副本，互不影响。修改通过转换层写回语义层后，其他视图按需重新读取 |
| **类型可扩展** | 增加新 Block 类型 = 在 `blockRegistry` 注册一个新 BlockDef，语义层模型不变 |

### 2.3 Atom 独立性原则

**关键原则**：Atom 是一等公民，**不知道任何视图存在**。视图特性（位置、颜色、时间属性等）**不挂在 Atom 上**，而是挂在视图自己的引用记录（"索引格式"，详见 § 4）。

```
✗ 反例（违反原则 1）：
  Atom: { type, content, views: { graph: { position }, timeline: { date } } }
                                  ↑ Atom 知道有哪些视图

✓ 正例：
  Atom: { type, content }                                ← Atom 干净

  Graph 节点表: { atomRef, position, color, ... }        ← 视图特性在视图自己的索引上
  Timeline 索引: { atomRef, date, ... }
```

→ Atom 永远是被指向的，从不主动指向任何东西。新视图加入不需要修改 Atom schema。

### 2.4 Atom 物理形态：当前 vs 长期愿景

**当前形态（v1.2 阶段，工程妥协）**：

```
Note 视图的语义内容    → note.doc_content（Atom[] inline）
Graph 视图的节点 label → graph_node.label（Atom[] inline）
Graph 视图的边 label   → graph_edge.label（Atom[] inline）
Thought 的内容         → thought.doc_content（Atom[] inline）
```

→ Atom 内联在各视图自己的表里，**没有独立的语义实体**。每个视图持有自己的 atom 副本，互不共享。

**长期愿景：投影模型（Projection Model）**

把 Atom 升级为一等公民独立存储（spec v1.0 / v1.1 GraphView 提过的"独立 block 实体"），并进一步引入"投影"概念：

```
语义层（Atom 独立存储）：
  atom 表: { id, type, ... }                       ← Atom 是身份/标识，可携带"原始/默认内容"

各视图通过自己的"投影记录"引用 Atom：
  Note 投影:  { atomRef, content: [...] }          ← Note 视图持有的内容版本
  Graph 节点: { atomRef, content: [...], position } ← Graph 视图持有的内容版本 + 视图特性
  Timeline:   { atomRef, content: [...], date }    ← 同上

每个视图引用同一个 Atom，但持有自己的"投影"。
"投影"包含：视图对该 atom 的内容表达 + 视图特性。
```

**投影模型的产品哲学**：

> "对大部分用户而言，多视图就是同一个概念的不同可视化形态。"
>
> 用户在 Note 里看到的"NavSide 是侧边栏，宽度 224px"和在 Graph 节点里看到的"NavSide"，**是同一个概念的两种表达**。每个视图持有自己合适的表达——Note 详细，Graph 简短——互不干扰。
>
> 用户**不需要理解版本概念**。"投影"是开发者视角的术语，用户视角是"多视图"。

**版本演化（远期愿景）**：

在投影模型基础上，可以进一步引入"版本图"——记录思维的演化过程：

- 用户**主动按钮**（类似 git commit）创建语义层新 Atom，与原 Atom 建立"derived from"关系
- 多版本共存，版本间通过语义关系（refines / summarizes / contradicts / supplements）连接
- 知识库本身是**演化的笔记网**，新想法是新节点，旧想法保留作为历史
- 这是 Niklas Luhmann 卡片盒（Zettelkasten）/ Andy Matuschak evergreen notes 的精神延续

**为什么这是 KRIG 的差异化方向**：

- 普通笔记工具：单一权威版本（修改即覆盖）
- 版控笔记工具：可回退的版本日志（版本是"备份"）
- **KRIG 投影模型 + 版本图**：版本即知识，互有语义关系（**几乎无成熟产品**）

**实施代价**（充分提示）：

| 项 | 代价 |
|---|---|
| Block 独立化（投影模型前置） | 需要重构 SurrealDB schema 和各视图的存取层 |
| 投影模型 | 需要为每个视图设计"索引格式 + 适配器"，并迁移现有数据 |
| 版本图（按主动按钮触发） | 需要"创建新版本"的 UI、版本树查询、引用更新策略 |
| 总工程量 | 预计专项 2~3 个月，超出任何单一视图的工作范围 |

**v1.3 阶段的处置**：

- **不实施**投影模型与版本图——保持 v1.2 现状（atom 内联）
- v1.3 现状是工程妥协：每个视图自己存 atom 副本，跨视图修改互不影响（实际上也无机会触发——内联的 atom 在不同视图就是不同副本）
- 长期目标作为本规范的"远期愿景"登记，未来由专项工作推进
- 现有视图（Note / Graph）的工作不被这个愿景阻塞

### 2.5 关系（Relation）的归属问题

> 这是一个 **Open Question**（详见 § 7.1）。

当前 v1.2 GraphView 中"边"的属性（source/target/type/label）存储在 `graph_edge` 表。本规范暂不强行规定关系是否属于语义层，留待后续讨论。

---

## 3. 可视化层（Visualization Layer）

### 3.1 定义

可视化层是**用户实际看到和操作的视图**。一个可视化层 = 一种"投影方式"：把同一份 Atom 数据用某种特定形态呈现给用户。

**可视化层的关键特性**：

- 持有视图本地状态（光标、选区、滚动位置、缩放、选中节点等）—— 这些不属于语义层
- 通过自己的转换层与语义层通信
- 和其他可视化层**互不知晓**

### 3.2 Note：线性叙述视图

**职责**：把 Atom 数组渲染为可编辑的线性文本流。

**当前实现**：

| 组件 | 角色 |
|------|------|
| `note.doc_content`（DB） | 语义层物理形态 |
| `converters/registry.ts`（atomsToDoc / docToAtoms） | **Note 的转换层**：Atom ↔ ProseMirror Doc 双向转换 |
| `NoteEditor` (ProseMirror EditorView + 全套 plugin/UI) | 可视化层：编辑态 |
| `BlockRenderer`（如有 readonly 渲染需求） | 可视化层：展示态（暂未独立实现） |

**Note 视图本地状态**：光标、选区、滚动位置、生词高亮、Thought 锚点等。

**评价**：Note 视图**已完整符合三层模型**。本规范不要求重构 Note。

### 3.3 Graph：拓扑结构视图

**职责**：把 Atom（节点 label / 边 label）+ 节点关系 + 几何布局，渲染为可交互的图谱网络。

**当前实现（v1.2）**：

| 组件 | 角色 |
|------|------|
| `graph_node.label / graph_edge.label`（DB） | 语义层物理形态（Atom[] inline） |
| `graph_node.position / graph_edge.source/target` | Graph **可视化层独有**的属性（不属于语义层） |
| `NodeContentRenderer`（v1.2 用 readonly ProseMirror） | **Graph 编辑态的转换层**（仅复用 Note 的 schema） |
| `BasicEngine`（Three.js 几何 + 交互） | 可视化层：编辑态主体 |
| 待建：SVG 序列化器 | **Graph 展示态的转换层**（v1.3 工作） |

**Graph 视图本地状态**：节点位置、视口缩放/平移、选中节点、撤销栈、悬停态、拖拽态等。

**Graph 独有属性**（**属于可视化层，不属于语义层**）：

- 节点的几何位置（x, y）
- 节点的外形（圆 / 矩形 / 颜色）
- 边的弧度、视觉样式
- 视口的缩放级别、平移偏移

**评价**：Graph 视图**部分符合三层模型**：语义层（label = Atom[]）已对齐 Note，但**展示态的转换层（atom → SVG）尚未实现**——这是 v1.3 阶段补足的核心工作。

### 3.4 编辑态 vs 展示态：可视化层内部的两种形态

同一个可视化层（如 Graph），在用户**编辑**时与**仅展示**时，可以使用不同的渲染策略：

| 维度 | 编辑态 | 展示态 |
|------|--------|--------|
| 渲染 | DOM + ProseMirror | SVG |
| 用户能做什么 | 输入、删除、格式化、Slash 命令 等 | 仅观看 |
| 尺寸 | 动态（输入时可撑大） | 固定（编辑提交时锁定） |
| 性能 | 每节点一个 ProseMirror 实例 | 静态 SVG，开销极低 |
| 大图谱场景 | 不适用（性能受限） | 适用（可显示数百节点） |

**关键点**：编辑态和展示态共享**同一份语义内容**（Atom[]），只是渲染输出不同。用户从展示态进入编辑态（如双击节点）时：

```
1. 当前展示态 SVG → 隐藏
2. 编辑态 ProseMirror → 显示，初始化为同一份 atom[]
3. 用户编辑 → atom[] 修改
4. 提交 → 新 atom[] 通过转换层重新生成 SVG
5. 编辑态隐藏，新展示态 SVG 显示
```

→ 编辑/展示双态切换是 v1.3 GraphView 的核心交互。

### 3.5 视图独立的编辑能力

**关键原则**：**每个可视化层有自己独立的编辑入口和能力，不必复用其他视图的编辑器全套**。

具体到 Graph：

| 维度 | Note 怎么做 | Graph 怎么做 |
|------|-------------|---------------|
| 内容 schema | 全套 Block 类型 | **可裁剪**：节点/边 label 内可能不需要 columnList、frameBlock 等容器类 Block |
| Slash 菜单 | 完整 | **可裁剪**：节点 label 不需要 "Add Thought"、复杂表格等命令 |
| Floating Toolbar | 完整 | **可裁剪**：节点 label 选区行为简化 |
| Handle Menu | 完整 | **不需要**：图谱节点没有"块手柄拖动到笔记某行"概念 |
| Context Menu | 完整 | **可定制**：图谱有自己的右键菜单（编辑节点 / 创建关系 / 删除节点） |

**为什么可以这样**：Note 和 Graph 是**平等的可视化层**，不是"Graph 复用 Note 的编辑器"。语义层共用就够了，编辑交互各自设计。

→ 这意味着 v1.2 阶段把 Note 全套 4 个 React UI（SlashMenu / FloatingToolbar / HandleMenu / ContextMenu）原封不动接到 Graph 节点编辑器是**短期权宜之计**，长期 Graph 应该有**为图谱场景设计的精简编辑器**。

### 3.6 未来视图

本规范保留未来扩展空间。任何符合"消费 Atom + 提供视图状态"的新视图都可加入：

| 候选视图 | 职责 |
|----------|------|
| **TimelineView** | 时间维度的语义层投影（按 Atom 的时间属性排列） |
| **MindMapView** | 层级树形的语义层投影 |
| **KanbanView** | 状态分组的语义层投影（按 Atom 的状态字段聚类） |
| **BPMNView** | 流程图视图（Atom 之间有"先后"关系时） |

**新视图的接入步骤**（参考 § 6 落地路径）：

1. 设计该视图的转换层：Atom ↔ 该视图的可视化形态
2. 在视图层级 L5 注册新视图类型
3. 写该视图的具体 spec（参照 GraphView Spec 的形式）

---

## 4. 转换层（Translation Layer）

### 4.1 定义

转换层 = **每个可视化层和语义层之间的双向适配器**。

> 注意：本规范**不**把转换层定义为"视图之间的转换"（如 note ↔ graph 的直接翻译）。转换层的方向永远是**视图 ↔ 语义层**，不是视图 ↔ 视图。

### 4.2 转换层的双向接口

每个可视化层应该有自己的一对函数：

```typescript
// 读：语义层 → 该视图的可视化形态
viewFromAtoms(atoms: Atom[], options?: ViewOptions): ViewRepresentation;

// 写：该视图的修改 → 语义层
viewToAtoms(rep: ViewRepresentation): Atom[];
```

**已实现的转换层**：

| 视图 | 读（atom → view） | 写（view → atom） |
|------|-------------------|---------------------|
| Note 编辑态 | `atomsToDoc(atoms)` | `docToAtoms(doc)` |
| Graph 编辑态 | NoteContentRenderer 内部（v1.2） | ProseMirror state → JSON content |
| Graph 展示态（SVG） | **待建（v1.3 工作）** | N/A（展示态不写回） |

### 4.3 视图之间的"协作"如何实现

按三层模型，视图之间**不直接通信**。如果两个视图需要"协作"（如 Graph 的节点 label 和 Note 的某段文字共享内容），必须通过语义层：

```
Note 视图 → Note 转换层 → 语义层 (atom[]) → Graph 转换层 → Graph 视图
```

**Q**：v1.2 § 4.5 提的 hostNoteId（Graph 绑定一个 Note 作为宿主）算不算违反此原则？

**A**：按本规范的解读，**hostNoteId 不是"Graph 引用 Note"**，而是**"Graph 视图和 Note 视图绑定到同一份语义实体"**——即语义层中存在一个 `host` 实体，Note 视图把它投影为一篇文档，Graph 视图把它投影为一张图谱。两个视图通过共享语义实体协作，不直接通信。

→ v1.2 GraphView Spec 中关于 hostNoteId 的章节应按此解读修订（在 v1.3 中调整）。

### 4.4 转换的"非完美"性

不是所有可视化层都能 100% 双向无损：

- Note 编辑态 ↔ atom[]：**双向无损**（atomsToDoc / docToAtoms 互逆）
- Graph 展示态（SVG）：**单向**（atom → SVG，SVG 不写回）—— 因为 SVG 是"展示快照"
- 未来 TimelineView 编辑态 ↔ atom[]：可能**部分有损**（如时间线只关心 Atom 的时间属性，其他属性原样保留）

**原则**：每个视图的转换层在自己的 spec 中**明确说明双向能力**：

- 读路径：Atom 的哪些字段被消费 / 忽略
- 写路径：是否有损 / 如何处理无法表达的字段

---

## 5. 设计原则

> 这是 KRIG 设计新视图、修改架构、判断"是否走偏"的判定依据。

### 原则 1：语义层不知道可视化层

语义层（Atom 定义、SurrealDB schema）不出现任何 "Note"、"Graph" 等视图特定字段。

**反例（违反）**：在 atom 上加 `displayInGraph: true` 字段。

**正例**：视图特定属性（如 Graph 节点的几何位置）属于该视图自己的表（`graph_node.position`），不污染 atom。

### 原则 2：可视化层不直接通信，走转换层 + 语义层

视图之间的协作通过共享语义实体实现，不互相调用方法。

**反例（违反）**：Graph 视图直接调 `noteEditor.insertText()`。

**正例**：用户从 Note 选中文字"提取到图谱"——Note 视图从自身转换层得到 Atom[]，写到语义层；Graph 视图监听语义层变化或主动加载，建一个新节点。

### 原则 3：编辑态和展示态共享语义不共享 DOM

同一份 Atom 数据可以有多种渲染形态，但它们**都基于同一份语义**，不是各存一份。

**反例（违反）**：节点 label 同时存 `atom[]` 和 `svg` 两份；用户改了 atom，svg 没跟着更新——数据腐化。

**正例**：atom 是唯一权威源；svg 是从 atom 算出来的（要么实时计算，要么缓存到 DB 但**改 atom 时强制同步重算 svg**）。

### 原则 4：新视图只增加可视化层节点，不修改语义层 / 转换层契约

接入新视图（如 TimelineView）时：
- ✅ 增加一个新的可视化层模块
- ✅ 写一份该视图的转换层（Atom ↔ TimelineRepresentation）
- ❌ 不修改 Atom 的核心 schema
- ❌ 不修改其他视图的转换层

→ 这条原则保证 KRIG 是**开放扩展、封闭修改**的（OCP 原则在产品架构上的体现）。

### 原则 5：视图独立设计自己的编辑能力

可视化层之间**平等独立**。每个视图为自己的使用场景设计编辑入口、操作集、UI surface。**共用 Atom 是义务，共用编辑器是选项**。

**反例（违反）**：Graph 节点编辑器全盘复刻 NoteView 的编辑能力（包括与图谱场景无关的 Thought 锚点、生词高亮等）。

**正例**：Graph 节点编辑器复用 Atom schema、ProseMirror 渲染管线，但定制自己的 Slash 菜单、右键菜单、键盘快捷键，去掉与图谱场景无关的功能。

---

## 6. 当前 KRIG 在三层模型中的位置

### 6.1 现状对照（2026-04-25）

| 视图 | 语义层 | 转换层 | 可视化层 | 评价 |
|------|--------|--------|----------|------|
| **Note** | ✅ note.doc_content (Atom[]) | ✅ atomsToDoc / docToAtoms | ✅ NoteEditor (ProseMirror) + plugins | **完整符合三层模型** |
| **Thought** | ✅ thought.doc_content | ✅ 沿用 Note 的转换层 | ✅ ThoughtEditor (NoteEditor variant) | **完整符合**（Thought = Note 的变种） |
| **Graph** 编辑态 | ✅ graph_node.label / graph_edge.label (Atom[]) | ⚠️ NoteContentRenderer（v1.2，复用 Note 转换层） | ⚠️ BasicEngine + 节点编辑器全套接 NoteView UI | **部分符合**：编辑器接得过满，违反原则 5 |
| **Graph** 展示态 | ✅ 同上 | ❌ **未实现** | ⚠️ 当前编辑器即展示，无独立展示态 | **缺转换层**：v1.3 要做的核心工作 |
| **EBookView** | N/A（电子书是外部资源） | N/A | ✅ EBookView | **不属于三层模型**（不是 Atom 的视图） |
| **WebView** | N/A | N/A | ✅ WebView | **不属于三层模型** |

### 6.2 已完成的工作（不需要重构）

- **Note 转换层** (`atomsToDoc` / `docToAtoms`)：双向无损
- **Atom schema 定义**（blockRegistry + 各 BlockDef）
- **Note 编辑可视化层**（NoteEditor + 4 个 React UI + 全套 plugin）
- **Graph 编辑态语义对齐**（v1.2 把 GraphNode.label / GraphEdge.label 改为 Atom[]）

### 6.3 短期工作（v1.3 阶段，本规范的具体落地）

- **Graph 展示态转换层**：写一个 `Atom[] → SVG` 序列化器
  - 详见独立文档 `note/Block-SVG-Serialization-Spec.md`（待写）
  - 基于"光谱式 vs 纯 SVG"讨论的结论：核心 Block 走纯 SVG，未支持 Block 走占位降级
- **Graph 编辑态裁剪**（按原则 5）：从"接全套 NoteView UI"改为"为图谱场景设计的精简编辑器"
  - 详见 `graph/KRIG_GraphView_Spec_v1.3.md`（待写）
- **Graph 编辑/展示双态切换**：用户双击 SVG 节点 → 进入编辑态；提交 → 回到展示态

### 6.4 中长期演化路径

- **Block 独立化**（spec v1.0 / v1.1 提过的方向）
  - SurrealDB 增加 `block:[id]` 表
  - 各视图通过 blockId 引用语义层，而不是 inline 存 Atom[]
  - 实现真正的"跨视图 Block 复用"和"修改一处自动同步多视图"
  - 不阻塞 v1.3，但是语义层落地的最终形态
- **新视图引入**（按业务需求节奏）
  - TimelineView / MindMapView / KanbanView / BPMNView 等
  - 每个新视图按本规范设计，独立增加一个柱子（图 § 1.1）
- **关系语义层显化**（见 § 7.1 Open Question）

### 6.5 不打算做的事（明确拒绝）

- ❌ **可视化层之间的直接通信桥**（如设计一个 noteToGraph() 直接函数）
  - 违反原则 2，新视图加入时维护成本爆炸
- ❌ **Atom 上加视图特定字段**
  - 违反原则 1
- ❌ **Graph 编辑器无脑全盘复刻 NoteView**
  - 违反原则 5（v1.2 阶段做得有点过满，v1.3 应裁剪）

---

## 7. Open Questions

### 7.1 关系（Relation）是否属于语义层

**问题**：当前 v1.2 GraphView 中节点之间的边（source / target / type / label / 弧度等）存储在 `graph_edge` 表。这是 Graph 的可视化层独有？还是应该提升到语义层？

**两种立场**：

- **立场 A：边属于 Graph 可视化层**
  - 边只在 Graph 视图里有意义，其他视图（Note / Timeline）不消费
  - 当前实现就是这样
- **立场 B：边属于语义层**
  - "概念之间的关系"是知识本身的一部分，不只是 Graph 视图的属性
  - 未来 TimelineView 也可能消费"先后关系"，MindMapView 消费"父子关系"
  - 应在语义层独立 `relation:[id]` 表，被多视图引用

**待用户决策**：本规范暂不强行规定，留待具体场景出现（如 TimelineView 立项）时讨论。

### 7.2 转换层的形态：函数集 vs Plugin 系统

**问题**：转换层是简单的纯函数（atomsToDoc / atomsToSVG），还是应该有自己的 Plugin / 中间件机制？

**当前**：函数集形态（atomsToDoc 等）。

**未来可能**：当转换逻辑变复杂（如条件式转换、用户可配置的转换规则），是否需要 Plugin 化？

**待具体需求出现时再决策**。

### 7.3 三层模型 vs 视图层级（L0~L5）的精确映射

**视图层级定义.md** 的 L5 = View 层是物理层级。本规范的"可视化层"是语义层级。两者关系：

- 一个 L5 View 实例 = 一个**可视化层**的具体落地（含编辑态和/或展示态）
- 两者**正交**：L5 是用户感知的层级（应用 → 窗口 → ... → View），三层是数据流向的层级（语义 → 转换 → 可视化）
- 不冲突，也不互相替代

**待补**：未来如果出现"一个 L5 View 内含多个可视化层"的场景（不太可能），需要进一步澄清。

---

## 8. 决策留痕

| 决策 | 结论 | 日期 |
|------|------|------|
| 三层架构（语义/转换/可视化） | 采纳，作为 KRIG 顶层设计规范 | 2026-04-25 |
| 转换层是"每视图一个 adapter"，不是"视图间总线" | 采纳（用户 2026-04-25 提的图） | 2026-04-25 |
| Note 已符合三层模型，不重构 | 采纳 | 2026-04-25 |
| Graph 编辑态共用 Note schema，编辑器各自设计 | 采纳（原则 5） | 2026-04-25 |
| Graph 展示态用 SVG 序列化器实现 | 采纳，作为 v1.3 工作 | 2026-04-25 |
| Block 独立化 | 长期方向（v1.0 / v1.1 提过），不阻塞 v1.3 | 2026-04-25 |
| **Atom 独立性原则**：视图特性挂在视图自己的索引上，不挂在 Atom 上 | 采纳（原则 1 的具体落地） | 2026-04-25 |
| **投影模型**（每个视图持有自己的 atom 投影） | **远期愿景**，不阻塞 v1.3 | 2026-04-25 |
| **版本图**（用户主动按钮创建新版本，版本间有语义关系） | **远期愿景**，KRIG 知识表达的差异化方向 | 2026-04-25 |
| v1.3 阶段不实施投影模型 / 版本图 | 工程妥协，保留 atom 内联现状 | 2026-04-25 |
| 关系是否在语义层 | 待定（Open Question 7.1） | 2026-04-25 |

---

## 附录 A：术语表

| 术语 | 定义 |
|------|------|
| **Atom** | 语义层最小单元，形态为 ProseMirror node JSON |
| **Block** | Atom 中 group='block' 的类型（如 textBlock / mathBlock）；本规范中 "Atom" 是更广义的术语，"Block" 是 Atom 的一个子集 |
| **可视化层 / View** | 同义。用户实际看到的视图（Note / Graph / 未来视图） |
| **转换层 / Adapter** | 同义。视图与语义层之间的双向适配器 |
| **编辑态 / Edit Mode** | 用户可输入修改的视图形态（DOM + ProseMirror） |
| **展示态 / Display Mode** | 仅展示的静态视图形态（如 SVG） |
| **语义同源** | 两个视图绑定到同一份语义实体（如 hostNoteId 表达的关系） |
| **投影 / Projection** | 视图对 Atom 的具体表达——含视图特定内容 + 视图特性。一个 Atom 可被多视图投影（远期愿景） |
| **索引格式** | 视图内部组织对 Atom 的引用 + 视图特性的数据结构（如 `graph_node` 表是 Graph 的索引格式） |
| **版本图** | Atom 演化的语义网络。用户主动创建新版本时，旧版本保留，版本间通过语义关系连接（远期愿景） |

## 附录 B：与各 spec 的引用关系

```
本规范（KRIG-Three-Layer-Architecture.md）
    │
    ├─ 引用：Ai-Design/KRIG-Atom体系设计文档.md（Atom 定义）
    ├─ 引用：视图层级定义.md（L0~L5 物理层级）
    │
    └─ 被引用：
        ├─ graph/KRIG_GraphView_Spec_v1.3.md（视图实例）
        ├─ note/Block-SVG-Serialization-Spec.md（转换层实例）
        ├─ 未来 timeline/... / mindmap/... / kanban/... 等
```

---

*KRIG Architecture Spec · v1.0 · 2026-04-25*
