# Atom 颗粒度调查报告(2026-05-21)

> 调查触发:用户在位置记忆 feature 实施过程中发现 `krig://block/<noteId>/<idx>:<前30字>` anchor 不稳,追溯到 V2 atom 颗粒度可能存在设计与实施不一致。
>
> 调查者:claude(本报告由 Agent 调查产出)
>
> 范围:纯事实调查,**不含决策建议**。

---

## 1. 触发问题(背景)

V2 当前 anchor 体系:[`src/drivers/text-editing-driver/api.ts:823`](../../../src/drivers/text-editing-driver/api.ts#L823) `getBlockAnchorAt` 字面:

```ts
// heading 节点 → encodeURIComponent(text.slice(0, 60))
// 其他 block  → `${idx}:${encodeURIComponent(text.slice(0, 30))}`
```

→ anchor 由"block 顺序索引 + 文本前 30 字"算出,**block 没有独立稳定 id**。用户编辑后,idx 改 / 前 30 字改 → anchor 漂移。

向上追问:**为什么 block 没有稳定 id?**

→ 因为 V2 实施层 `noteCapability.createNote` ([`src/platform/main/note/capability-impl.ts:54`](../../../src/platform/main/note/capability-impl.ts#L54)) 字面把**整篇 PM doc** 作为**单个 pm atom 的 payload**写入 SurrealDB:

```ts
const atom = await tx.putAtom<'pm'>({
  payload: { domain: NOTE_DOMAIN, payload: pmDoc },  // pmDoc 是整个 { type: 'doc', content: [...] }
});
```

→ 一篇 note 在 storage 层 = **1 行 atom**,内含上千个 block 的嵌套 JSON。block 本身既不是 atom,也没有自己的 id 字段(PM schema 字面只为部分 block 注册了 `attrs.id`,大部分 block 字面无 id)。

向上追问:**spec 层是怎么定义的?**

→ [`docs/RefactorV2/data-model/atom/spec.md`](../data-model/atom/spec.md) §0.1 字面:"Atom = V2 语义层的**最小**实体"。§2.2 字面:

> "pm atom = 最小单元(如 `{ type: 'text', text: 'hello' }`)。block = pm atom 的组合形态(如 textBlock / mathBlock / bulletList)。Block 自身可嵌套 block。"

→ spec 字面把"最小 pm atom"定义为 inline 级(text 节点),block 是组合形态。这跟实施层"整篇 doc = 1 atom"在字面颗粒度上**不一致**。

但用户提醒:不要急着判定"漏洞"。可能性至少 4 种(本报告 §4 逐一摆证据)。

---

## 2. 事实矩阵:spec ↔ 实施 对照表

| 维度 | spec 字面 | 实施字面 | 字面一致? |
|---|---|---|---|
| **pm atom 颗粒度** | [atom/spec.md §0.1](../data-model/atom/spec.md):"Atom = 语义层的**最小**实体"<br>[atom/spec.md §2.2](../data-model/atom/spec.md):"pm atom = 最小单元(如 `{type:'text', text:'hello'}`)"<br>[charter.md §4.1](../../00-architecture/charter.md):atom 例子 `{type:'text', text:'hello'}` 和 `{type:'mathInline', attrs:{latex}}`<br>[charter.md §4.2](../../00-architecture/charter.md):"block = atom 的语义组合形态" | [`note/capability-impl.ts:54-66`](../../../src/platform/main/note/capability-impl.ts#L54):整个 PM doc 作为单 atom payload(`payload.payload = {type:'doc', content:[...]}`)<br>[decision 012 §3.2 路径 Y](../data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md):字面拍板 "**pm atom = note**" | ❌ |
| **block 之间关系表达** | [README.md §40-80](../data-model/README.md):"边是一等公民,所有属性走边"<br>[charter.md §4.2](../../00-architecture/charter.md):"block 跨视图共享(同一份 block 数据,Note 视图渲染成滚动文本流,Graph 视图渲染成节点 label)" | block 不是独立 atom → 无 atom id → 边只能指向 atom 整体(整篇 note),**无法指向某 block**<br>[decision 022 §3.2](../data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) 字面承认:"**block 是 atom-level 子结构,不能被边直接引用(decision 030+ 大架构升级才能解)**" | ❌ |
| **边的范围** | [spec.md §4.1 走法 B](../data-model/atom/spec.md):"所有非本体属性走边"<br>[decision 003 §3.4 局限性](../data-model/atom/decisions/003-naming-conventions.md):"简单场景变得很重:仅显示'这是一个圆,标签是 Alice'也需要查 1 个 atom + 至少 1 条 edge" | 边都建在 atom 层(`subject: { kind: 'atom', atomId }`)。Edge 不支持 subject = block | ❌(局限) |
| **跨 atom 引用机制** | [spec.md §4.3 第一波核心边集](../data-model/atom/spec.md):`user:linksTo` / `*:prov:wasDerivedFrom` 等 atom→atom 边<br>[charter.md §4.2](../../00-architecture/charter.md):"跨视图共享(同一份 block 数据...)" | 实施已有 `user:krig:hasContent` 边([decision 013 §3.3](../data-model/persistence/decisions/013-sub-phase-3a-graph-canvas-migration.md))从 wrapper atom 指向 content pm atom — 但**只能指 pm atom 整体**,不能指 block | ⚠ 部分一致 |
| **atom 唯一性(id 字段)** | [atom/spec.md §1.2](../data-model/atom/spec.md):"atom 实体 = atom 数据 + 存储层包裹的元属性(id / 时间戳等)" | [`semantic/types/atom-entity.ts`](../../../src/semantic/types/atom-entity.ts) `AtomEntity.id: string`(ULID)— 每 atom 有 id;**但 atom 内的 block 字面无 id**(PM schema 字面只为部分 block 注册了 `attrs.id`) | ⚠ atom 层一致, block 层无 |
| **编辑事件粒度** | [vision.md §5.6](../../00-architecture/vision.md):"修改必须最终落在 atom"<br>[vision.md §3.2](../../00-architecture/vision.md):"图谱内容应该是稳定的资产;视图应该是廉价的、可丢弃的" | [`note/capability-impl.ts:122-132`](../../../src/platform/main/note/capability-impl.ts#L122) `updateNote(id, doc)` 整篇 PM doc 整体覆盖写入。编辑一个字 = 替换整 atom payload | ⚠ vision "stable asset" vs 实际"整篇 atomic write" |
| **block-anchor 引用** | three-layer.md §6.4 中长期演化路径字面:"Block 独立化 — 各视图通过 blockId 引用语义层" | [`api.ts:823`](../../../src/drivers/text-editing-driver/api.ts#L823) 用 `idx + 前30字` 算 anchor(不稳)<br>[`thought-types.ts:57-64`](../../../src/shared/ipc/thought-types.ts#L57) `NoteLocator { pmPos: integer, anchorType, text }` 走 PM 位置 + 冗余文本 | ❌ |

### 2.1 对比 graph 颗粒度作参照

| 维度 | note(整篇 1 atom) | graph(每节点 1 atom) |
|---|---|---|
| atom 数 | 1 / note | 1 / shape + 1 / text-node + 0..1 pm content atom |
| 边引用 | 边只能指 note 整体 | 边可精确指某节点(`{ kind:'atom', atomId: nodeId }`) |
| Thought anchor | `NoteLocator { pmPos, anchorType, text }`(位置+冗余文本) | `GraphLocator { nodeId }`(直接 atom id) |
| 编辑后 anchor 漂移 | 是(idx+文本前30字会变) | 否(nodeId 是 ULID 不变) |
| 跨 view 引用 | 不能精确引用 note 内某段 | 可以精确引用 graph 内某节点 |

→ graph 的 atom 颗粒度跟 spec 字面("最小实体")一致 / note 的 atom 颗粒度跟 spec 字面**不一致**。两者**在同一项目内并存**。

---

## 3. 历史踪迹(找到的相关决议、commit、文档)

### 3.1 找到的相关决议

#### A. spec / 架构层的字面记载

| 文档 | 节 | 字面摘要 |
|---|---|---|
| [atom/spec.md §0.1](../data-model/atom/spec.md) | "Atom 是什么" | "Atom = V2 语义层的**最小**实体" |
| [atom/spec.md §2.2](../data-model/atom/spec.md) | "Block — pm Atom 的语义组合类型" | "pm atom = 最小单元(如 `{type:'text', text:'hello'}`)。block = pm atom 的组合形态" |
| [charter.md §4.1-4.4](../../00-architecture/charter.md) | "block 与 atom 的精确定位" | atom = `{type:'text', text:'hello'}` 等;block = atom 组合;block 跨视图共享是设计意图 |
| [three-layer.md §2.2](../../00-architecture/three-layer.md) | "Atom:语义层的最小单元" | "Atom = ProseMirror node JSON 形态" |
| [three-layer.md §2.4](../../00-architecture/three-layer.md) | "Atom 物理形态:当前 vs 长期愿景" | **核心:字面承认"当前形态(v1.2 阶段,工程妥协):Atom 内联在各视图自己的表里,没有独立的语义实体"**<br>**字面拍板"v1.3 阶段不实施投影模型与版本图——保持 v1.2 现状(atom 内联)"**<br>**字面登记"长期目标作为本规范的'远期愿景'登记,未来由专项工作推进"** |
| [three-layer.md §6.4](../../00-architecture/three-layer.md) | "中长期演化路径" | "**Block 独立化(spec v1.0 / v1.1 提过的方向)**— SurrealDB 增加 `block:[id]` 表 — 各视图通过 blockId 引用语义层,而不是 inline 存 Atom[] — 实现真正的'跨视图 Block 复用'和'修改一处自动同步多视图'— 不阻塞 v1.3,但是**语义层落地的最终形态**" |
| [three-layer.md §8 决策留痕](../../00-architecture/three-layer.md) | "决策表" | "Block 独立化 — 长期方向(v1.0 / v1.1 提过),不阻塞 v1.3 — 2026-04-25"<br>"投影模型(每个视图持有自己的 atom 投影) — **远期愿景**,不阻塞 v1.3 — 2026-04-25"<br>"v1.3 阶段不实施投影模型 / 版本图 — **工程妥协**,保留 atom 内联现状 — 2026-04-25" |

#### B. V2 持久化决议层的字面记载

| 文档 | 节 | 字面摘要 |
|---|---|---|
| [decision 012 §3.2](../data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md) | "Note atom 形态" | **字面拍板"路径 Y:pm atom = note"**(整篇 doc 作为单 atom payload)<br>title 字段不存 payload 内,从 `content[0]` 派生<br>**未列举"block 拆 atom"作为替代方案被拒绝** — 该决议直接采用整篇路径,**没有取舍讨论** |
| [decision 016 §2.2 修法对比表](../data-model/persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md) | "为什么走 hasNoteView 边而不是其他修法" | 列出 A/B/C/D 4 种修法对比,**全部围绕"如何区分 pm atom 用途"**,**没有"block 拆 atom"的取舍** |
| [decision 016 §2.2 修法 D 拍板理由](../data-model/persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md) | 同上 | "为 **sub-phase 3a-shared-ref(浅引用 / 跨 view 复用)** 的本体论铺路" — 复用颗粒度仍是"pm atom 整篇",不涉及 block |
| [decision 013 §3.4 pmContentCapability](../data-model/persistence/decisions/013-sub-phase-3a-graph-canvas-migration.md) | "view-agnostic pm atom" | 引用 memory `project_two_atom_layers` 哲学:"atom 是语义本身,各 view 是同一 atom 的不同呈现" — **设计层强调"atom 跨 view 复用",但实施层 pm atom 的"atom"仍是整篇 doc 而非 block** |
| [decision 022 §3.2](../data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) | "annotation = thought PM block(本决议拍板)" | **关键!字面承认 atom 颗粒度局限**:<br>"**block 是 atom-level 子结构,不能被边直接引用(decision 030+ 大架构升级才能解)**"<br>"24 种 PM block attrs 都要加 optional bookAnchor 字段" — **绕过 atom 颗粒度限制,把 block 元数据塞 attrs.bookAnchor**<br>"~~跟用户拍板'1 book = 1 thought 聚合'完全一致~~"(优点表) |
| [decision 022 §1.3.1](../data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) | "数据模型 4 层 + BookAnchor schema" | 把 bookAnchor 元数据(pageNum / rect / cfi / color / type) **塞 PM block 的 attrs 字段**,而非作为独立 atom — **明显的"颗粒度不够细 → 走 block 内字段"权宜模式** |

#### C. V1 时代的相关讨论(可能性 C 证据)

| 文档 | 节 | 字面摘要 |
|---|---|---|
| [Canvas-As-Note-Migration.md](../../10-business-design/graph/Canvas-As-Note-Migration.md) | 全文(状态:架构决议草案 2026-05-01) | "M2.1 文字节点开发期间不实施,作为 M2.1 验收后、M2.5 Note Ref 之前的专项工作推进"<br>**字面设计了"block 级 atom + atom.meta.canvas 视图特性"模型** — 这是 atom 颗粒度方案,但**未在 V2 中实施** |
| [Canvas-As-Note-Migration.md §0.3](../../10-business-design/graph/Canvas-As-Note-Migration.md) | "一图概括" | atom 例子:`{ id, type:'textBlock', content:[...], meta:{ canvas:{...} } }` — **每 block 一 atom 颗粒度,有独立 id** |
| [Canvas-As-Note-Migration.md:9](../../10-business-design/graph/Canvas-As-Note-Migration.md) | 顶部 | "依据:KRIG-Three-Layer-Architecture.md §2.4 长期愿景'投影模型'的具体落地" |

### 3.2 找到的相关 commit

| commit | 描述 |
|---|---|
| `0ad60c7` Merge sub-phase 2 | feature/L7-sub2-note-folder-migration 完成,确立"pm atom = note"形态 |
| `9c5ae22` (step 5.2) | semantic/types 加 folder domain — 跟 note 同模式,业务实体粒度 |
| `b8093d9c` Merge sub-phase 3a-2.5 | note 形态升级 hasNoteView 边(仍是 pm atom = 整篇,不动 block 颗粒度) |
| `67f18b2` Merge sub-phase 3a-1 | graph-instance domain — 每节点 1 atom(跟 note 颗粒度对比鲜明) |
| `ac69e3b5` Merge sub-phase 022 | ebook + thought 4 层 atom 模型 — thought 也是整篇 PM doc 1 atom + bookAnchor 塞 block.attrs |

**commit messages 字面 0 处讨论"block 是否应为独立 atom"**或"atom 颗粒度延后"。

### 3.3 **未找到**的踪迹(同样重要)

- ❌ **未找到**专门讨论"为什么 note 整篇按一个 atom 存而不是按 block 拆"的决议。decision 012 §3.2 直接拍板"路径 Y:pm atom = note",**未列举 block 拆 atom 作为替代方案被拒绝**
- ❌ **未找到** decision 030(decision 022 字面提到的"decision 030+ 大架构升级")的实际文档。`docs/RefactorV2/data-model/persistence/decisions/` 字面最高编号是 024
- ❌ **未找到** `docs/RefactorV2/notes/L7-next-phase-kickoff.md` 列出的待启动 sub-phase 中包含"block 颗粒度升级"或"atom 形态重做"
- ❌ **未找到** vision.md 字面讨论 atom 颗粒度(grep "颗粒|粒度|granularity" 0 命中)
- ⚠ **找到的踪迹是**:[Canvas-As-Note-Migration.md](../../10-business-design/graph/Canvas-As-Note-Migration.md) 字面引用 [three-layer.md §2.4](../../00-architecture/three-layer.md) 的"投影模型",**作为长期愿景登记**,**但 V2 实施期间未启动**

---

## 4. 4 种可能真相的证据

### 4.1 可能性 A:故意延后

**证据**:
- ✅ [three-layer.md §2.4](../../00-architecture/three-layer.md) **字面承认是工程妥协**:"当前形态(v1.2 阶段,工程妥协):Atom 内联在各视图自己的表里,没有独立的语义实体"
- ✅ [three-layer.md §2.4](../../00-architecture/three-layer.md) **字面登记延后**:"**不实施**投影模型与版本图——保持 v1.2 现状(atom 内联)。长期目标作为本规范的'远期愿景'登记,未来由专项工作推进"
- ✅ [three-layer.md §6.4](../../00-architecture/three-layer.md) **字面登记中长期演化路径**:"Block 独立化(spec v1.0 / v1.1 提过的方向) — 不阻塞 v1.3,但是**语义层落地的最终形态**"
- ✅ [three-layer.md §8](../../00-architecture/three-layer.md) **决策留痕表字面登记**:"v1.3 阶段不实施投影模型 / 版本图 — 工程妥协,保留 atom 内联现状 — 2026-04-25"
- ✅ [decision 022 §3.2](../data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) **字面承认局限**:"block 是 atom-level 子结构,不能被边直接引用(**decision 030+ 大架构升级才能解**)"
- ✅ [Canvas-As-Note-Migration.md](../../10-business-design/graph/Canvas-As-Note-Migration.md) 已有完整的 block 级 atom 设计草案,**M2.1 不实施** + 留 M3 专项工作

**反证 / 不足**:
- ⚠ three-layer.md 章节是 V1 时代写的(2026-04-25 日期 + 引用 spec v1.0 / v1.1 / v1.2 / v1.3 阶段命名,这是 V1 GraphView Spec 的版本号),写完后**V2 重构启动**(2026-05-11)。V2 的 data-model/decisions/ 系列**没有任何文档继承"投影模型"或"block 独立化"延后定位**
- ⚠ V2 时代的决议(012 / 016 / 022)**未明确引用** three-layer.md §2.4 的"v1.3 工程妥协"作为延后理由。decision 022 §3.2 字面提"decision 030+ 大架构升级"但**没有指向 three-layer.md §2.4 / Canvas-As-Note-Migration.md 等已有延后记载**
- ⚠ "故意延后"在文档系统中的连续性**断裂**:V1→V2 跨界时,"block 独立化是远期愿景"这件事**没在 V2 决议体系里重新登记**

### 4.2 可能性 B:措辞歧义

**证据**:
- ⚠ [atom/spec.md §0.1](../data-model/atom/spec.md) "Atom = V2 语义层的**最小**实体" — "最小"二字可解读为"atom 类型族中的最小",而不是"颗粒度最细"
- ⚠ V2 data-model 的核心抽象是"按 **domain** 分类",`folder` / `ebook` / `graph-canvas` / `thought` 等 domain 都是"按业务实体颗粒"。从 domain 视角看,**整篇 pm doc = 一个 pm domain atom 是合理的形态**(跟 folder = 一个 folder atom 同模式)
- ⚠ [decision 003 §3.2](../data-model/atom/decisions/003-naming-conventions.md) "走法 B"判定字段是否进 payload 的规则:"脱掉这个字段,atom 还是同一个本体吗?" — 这套判定**默认 atom 边界已经定**,不解决"atom 边界本身怎么划"的问题

**反证 / 不足**:
- ❌ [atom/spec.md §2.2](../data-model/atom/spec.md) 字面拍板:"pm atom = **最小单元**(如 `{ type: 'text', text: 'hello' }`)" — **直接用 inline 级例子**,不是模糊措辞
- ❌ [charter.md §4.1](../../00-architecture/charter.md) atom 例子 `{type:'text', text:'hello'}` 和 `{type:'mathInline', attrs:{latex:'x^2+1'}}` — **都是 inline 级**,与"按 domain 分类"的整篇粒度解读冲突
- ❌ [charter.md §4.2](../../00-architecture/charter.md) "block 跨视图共享(同一份 block 数据,Note 视图渲染成滚动文本流,Graph 视图渲染成节点 label)" — **block 跨视图共享是 charter 的设计意图**,但实施层"整篇 pm doc = 一个 atom"使 block 不能跨 view 引用,**两者不能同时成立**
- ❌ "措辞歧义"无法解释:为什么 graph-instance 走"每节点 1 atom"颗粒度,而 note 走"整篇 1 atom"颗粒度,**同一项目内并存**?

### 4.3 可能性 C:历史决议已记录

**证据**:
- ⚠ [Canvas-As-Note-Migration.md](../../10-business-design/graph/Canvas-As-Note-Migration.md) 是 **V1 时代** 已有的完整决议草案,字面登记"M3 独立工作"延后,**这是已记录的决议**
- ⚠ [three-layer.md §2.4 + §6.4 + §8](../../00-architecture/three-layer.md) 字面已登记"block 独立化 / 投影模型作为远期愿景, v1.3 不实施" — **这是已记录的决议**

**反证 / 不足**:
- ❌ V2 重构的决议系统(`docs/RefactorV2/data-model/atom/decisions/` 和 `docs/RefactorV2/data-model/persistence/decisions/`)字面**未引用上述 V1 时代决议作为延后依据**。当前 V2 实施层的"整篇 doc = 1 atom"是 [decision 012 §3.2](../data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md) 字面拍板,**没有"延后到未来 sub-phase"的对话** — 该决议直接采用整篇,未列替代方案
- ❌ V2 实施期间(2026-05-11 至今),**未找到任何新决议**把"block 拆 atom"列入待启动 sub-phase。[L7-next-phase-kickoff.md](L7-next-phase-kickoff.md) 字面只提到 graph-other-nodes / vocab / media / inspector / workspace / trash 等待迁模块,**未提"note atom 颗粒度升级"**

### 4.4 可能性 D:真 gap(无记录)

**证据**:
- ✅ V2 决议系统字面没有"为什么选整篇粒度"的取舍记录 — [decision 012 §3.2](../data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md) 直接拍板,无对比表
- ✅ V2 决议系统字面没有把 V1 时代的"block 独立化远期愿景"承接进来作为延后理由
- ✅ V2 持久化的 24 个决议(`011`-`024`)字面只提了一次"block 是 atom-level 子结构, 不能被边直接引用 (decision 030+ 大架构升级才能解)"(在 [decision 022 §3.2](../data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) 路径 2 缺点表) — **但 decision 030 实际不存在**,是占位的"未来某个决议"

**反证 / 不足**:
- ⚠ [three-layer.md](../../00-architecture/three-layer.md) 和 [Canvas-As-Note-Migration.md](../../10-business-design/graph/Canvas-As-Note-Migration.md) 字面有**清晰的延后记载**(可能性 A 的证据),只是 **V1 → V2 跨界时没在 V2 决议系统里重新登记**。这不是"完全无记录",而是"记录在 V1 时代/上层架构文档,未在 V2 决议体系承接"

---

## 5. 影响面(事实层,不评价好坏)

### 5.1 当前受限的 feature

| feature | 当前实施位置 | 当前如何实现 | 哪些场景会失败 |
|---|---|---|---|
| **跨 note 引用某段** | [`api.ts:823`](../../../src/drivers/text-editing-driver/api.ts#L823) `getBlockAnchorAt`<br>[`build-link-click-plugin.ts:73`](../../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L73) `scrollToBlockAnchor` | `krig://block/<noteId>/<idx>:<前30字>` URL,基于 PM doc 顺序索引 + 文本前 30 字 | 用户编辑 → idx 改 / 前 30 字改 → anchor 漂移 |
| **Thought 标注某 note 段** | [`thought-types.ts:57`](../../../src/shared/ipc/thought-types.ts#L57) `NoteLocator { pmPos, anchorType, text }` | 走 PM doc 整数位置 + 冗余文本 | 编辑后 pmPos 漂移;text 冗余字段需要同步刷新 |
| **Thought 标注某 ebook 段** | [`thought-types.ts:83`](../../../src/shared/ipc/thought-types.ts#L83) `BookLocator { pageNum, rect, cfi, ... }` | 走物理坐标(PDF rect / EPUB cfi) | 不依赖 atom 颗粒度;但 [decision 022 §1.3.1](../data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) 字面要把 BookAnchor **塞 thought PM doc 的 block.attrs** — block 没有独立 id,attrs.bookAnchor 是"内联在 block JSON 里"的元数据,**该 block 在 thought doc 内移动 / 复制 / 删除 → bookAnchor 跟着内容跑,但 block 自身无稳定 id** |
| **Thought 标注 graph 节点** | [`thought-types.ts:95`](../../../src/shared/ipc/thought-types.ts#L95) `GraphLocator { nodeId }` | **走 atom id 直接引用**(因 graph node 是独立 atom) | 不漂移(nodeId 是 ULID) |
| **AI 标注某段** | (未实施 V2 全部,部分见 thought) | 当前借 thought 系统 | 同 thought,note 内段标注会漂移 / graph 节点标注稳定 |
| **关系图谱节点指向某段** | (vision 描述但未落地) | n/a | 受 atom 颗粒度限制(边只能指 atom 整体,即整篇 note) |
| **多设备协作冲突合并粒度** | (未实施) | n/a | 整篇 atom 互斥 — 两人各编辑一段无法 cell-level merge,需整篇 last-write-wins 或文本三方合并 |
| **滚动位置记忆** | (前置对话提到正在做) | 用 `krig://block/<noteId>/<idx>:<前30字>` anchor | 编辑后漂移(本调查的触发原因) |

### 5.2 设计原则被限制的表达

| 原则 | 字面来源 | 当前 block 级是否能表达 |
|---|---|---|
| "属性走边" | [README.md §40-80](../data-model/README.md) | ❌ block 级属性无法走边(block 不是 atom) — 走 block.attrs |
| "block 跨视图共享" | [charter.md §4.2](../../00-architecture/charter.md) "同一份 block 数据,Note 视图渲染成滚动文本流,Graph 视图渲染成节点 label" | ❌ 当前 graph node label 走的是 `graph-instance` + `hasContent` 边指向**独立 pm atom**, 不是直接复用 note 内的某 block |
| "atom 跨 view 复用" | memory `project_two_atom_layers` "atom 是语义本身,各 view 是同一 atom 的不同呈现"(decision 013 §3.4 引用) | ⚠ 部分可表达:整 pm atom 可被 graph wrapper 通过 hasContent 边引用,但仍是"整篇 doc 颗粒度"不是 block 颗粒度 |
| "图谱是稳定资产" | [vision.md §3.2](../../00-architecture/vision.md) "图谱内容应该是稳定的资产" | ⚠ atom 层稳定(有 ULID),但 block 层不稳定(无 id,靠 PM 位置+文本) |
| "修改必须最终落在 atom" | [vision.md §5.6](../../00-architecture/vision.md) | ⚠ 字面成立(编辑确实落到 pm atom 的 payload),但**修改粒度是整篇 atom**,非细粒度 block |

### 5.3 当前实施的合理性(不评价对错,只列事实)

**整篇 atom 颗粒度的字面优势**:
- 写入简单:[`note/capability-impl.ts:127`](../../../src/platform/main/note/capability-impl.ts#L127) `updateNote(id, doc)` 字面 1 行 `storage.putAtom` 调用
- SurrealDB 一行 storage 操作(无需 JOIN 拼装)
- 跟 [decision 016 §2.4](../data-model/persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md) `listNotes` 的 "3 query + 0 N+1" 模式契合
- PM 文档结构在 atom payload 内保持完整(PM schema 不需要"虚拟根" — 整篇 doc 自然是 root)

**block 级 atom 颗粒度的字面代价(decision 003 §3.4 字面承认)**:
- "简单场景变得很重"
- 写入碎(一篇 1000 block 的 note = 1000 atom + N 条 child/order 边)
- 查询要拼装 tree(需按顺序还原)
- 边表数量爆炸(每 block 至少 1 条 belongsToNote / order 边)
- 编辑事务复杂(PM 编辑产生大量 step,要分摊到多 atom 写入)
- 协作合并复杂(每 block 一个 conflict 单元)

→ 整篇 vs block 级,**字面是两种不同的工程选择**,各有优劣。本调查不评价孰优孰劣。

---

## 6. 开放问题(必须用户决策)

1. atom 颗粒度该不该下沉到 block?取决于产品定位 — KRIG 是否要把 [vision.md §3.2](../../00-architecture/vision.md) "图谱是稳定资产"的承诺**实施到 block 级**,还是 atom 级就够。
2. 如果下沉,新旧引用如何兼容?现有 `krig://block/<noteId>/<idx>:<前30字>` anchor 字面格式是否要演化?
3. 历史决议有没有第三方记录我没找到?如 V2 团队对话 / Slack / 用户讨论 — 本调查只覆盖了 `docs/` 和 commit history。
4. 如果不下沉,是否要在 V2 决议系统里**显式登记**这个延后(把 [three-layer.md §2.4](../../00-architecture/three-layer.md) 的 v1.3 工程妥协拍板**承接到 V2 体系**),让未来对话不再撞同一问题?
5. 当前 `decision 030+ 大架构升级` 是占位提及([decision 022 §3.2](../data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md)),没有实际文档。是否需要把它定型为正式 sub-phase 项目?

---

## 7. 不在本报告范围(守住边界)

- 我未决定要不要改架构
- 我未写代码
- 我未改设计文档
- 我未立 sub-phase
- 这些都等用户读完报告后决策

---

## 附录 A:调查方法

### A.1 阶段 1 — 已读文档清单(按顺序)

| # | 文档 | 关键收获 |
|---|---|---|
| 1 | [docs/RefactorV2/data-model/README.md](../data-model/README.md) | Atom + 边设计哲学 + Phase 推进表 + sub-phase 进度 |
| 2 | [docs/RefactorV2/data-model/atom/spec.md](../data-model/atom/spec.md) | "Atom = 最小实体" + "pm atom 最小单元 / block 是组合形态" 字面定义 |
| 3 | atom decisions 002/003/004/005 | 没找到 atom 颗粒度取舍讨论 — 全部在讨论"属性走边"/"V1 字段迁移"/"text-block 拆 paragraph+heading" |
| 4 | persistence spec.md / atom-entity.md / edge-entity.md | atom 实体壳 + edge subject 必须 atom |
| 5 | persistence decisions 011-024 (24 个) | decision 012 §3.2 "pm atom = note" 关键拍板;decision 016 §2.2 注没"block 拆 atom"取舍;decision 022 §3.2 字面承认 block 不能边直接引用 |
| 6 | [relations/pm-note.md + 子文档样例](../data-model/relations/pm-note.md) | block 通过 PM schema 注册 — block 不是 atom 是 PM node type |
| 7 | [docs/00-architecture/three-layer.md](../../00-architecture/three-layer.md) | **关键发现**:§2.4 字面承认 v1.2 是"工程妥协" + Block 独立化是"远期愿景" |
| 8 | [docs/00-architecture/vision.md](../../00-architecture/vision.md) | KRIG 愿景未字面讨论"颗粒度" — atom 层是稳定资产,但未拍板 atom 是哪级颗粒 |
| 9 | [docs/00-architecture/charter.md](../../00-architecture/charter.md) | §4 字面 atom + block + blockView 三层精确定位 — atom 例子是 inline 级 |
| 10 | [docs/10-business-design/graph/Canvas-As-Note-Migration.md](../../10-business-design/graph/Canvas-As-Note-Migration.md) | V1 时代已有"block 级 atom + atom.meta.canvas"完整设计草案,未在 V2 实施 |

### A.2 阶段 2 — grep 代码关键证据

```bash
# putAtom 调用 — 都是按业务实体颗粒
grep -rn "putAtom\|getAtom\|listAtoms" src/platform/main/note/ src/platform/main/graph/ src/platform/main/pm-content/

# 边类型 — 全部 atom → atom 或 atom → literal
grep -rn "'user:krig:" src/

# anchor 算法 — idx + 文本前 30 字
src/drivers/text-editing-driver/api.ts:823 getBlockAnchorAt

# Note 形态字面 — 整篇 pm doc
src/platform/main/note/capability-impl.ts:54 createNote

# Thought anchor — note 走 pmPos+text / graph 走 nodeId(对比)
src/shared/ipc/thought-types.ts:57-117
```

### A.3 阶段 4 — git log 关键查询

```bash
git log --oneline --all | grep -iE "atom|颗粒|投影"
# 0 处 commit message 讨论"block 是否应为独立 atom"或"atom 颗粒度延后"
```

---

*报告完*
