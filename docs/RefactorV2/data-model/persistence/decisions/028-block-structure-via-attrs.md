# Decision 028 — 文档结构属性化：去边,结构靠 atom 属性

> **状态**：架构方案已定（2026-06-08），分阶段实施待启动。
> **修订**：取代 [Decision 026](./026-block-atomization-sub-phase-design.md) §6 的**边集结构模型**
> （belongsToNote / childOf / nextSibling 三类边）。026 的 atom 拆分粒度（§3）保留不变。
> **触发**：长笔记新建 image 后「重加载位置错乱」——根因是结构边大面积重复损坏。

---

## 一、问题与根因

### 1.1 现象

一篇正常长笔记（数百 block）新建/编辑 image 后，**重启重新打开,块顺序错乱、位置对不上**。
image 的内容（src）其实存对了,坏的是**顺序**。

### 1.2 根因链（实测定位）

现状用三类**关系边**表达文档结构（Decision 026 §6）：

| 边 | 语义 | 作用 |
|----|------|------|
| `belongsToNote` | block → note | 归属 |
| `childOf` | child → parent | 层级（树） |
| `nextSibling` | block → block | **顺序（链表）** |

**脆弱性**：文档的「顺序 + 层级」= 几百条边必须**全部正确且无冗余**。任何一条边写错/写重/没删,
整篇结构就坏（nextSibling 链分叉 → 顺序乱；childOf 重复 → 树乱）。而且**损坏会累积、不可逆**。

**直接根因**：`putEdge`（transaction-helpers.ts）**不幂等** —— 无 id 时 `generateUlid() + CREATE`,
每次 put 同一条逻辑边都产生**新随机 id 的新行**,SurrealDB 不去重 → 重复边累积。`applyDiff` 的
`tx.putEdge` 不带 id,走的就是这条 → 每次保存把同一条 nextSibling/childOf 边重新 CREATE → 越积越多。
叠加 OCC 冲突半写（事务部分失败未回滚）→ 损坏加速。

**雪上加霜**：cardinality-check 对 childOf/nextSibling **只告警不自愈** → 坏边永久留存。

### 1.3 架构层面的判断

这不是「修个 putEdge bug」能根治的。**根本矛盾：用「一堆独立的关系边」表达「一个文档的线性
结构」,把本该原子的东西(文档=有序块树)拆成了几百个可独立失败的写操作。** 治本要从架构消除
「结构靠边」这个脆弱性来源。

---

## 二、新模型：文档本体零边（结构靠属性）+ 关系层按需建边

### 2.1 核心

**文档本体的「顺序 + 层级 + 归属」不再用关系边,改成每个 block atom 自己的属性。
原始文档 dissect 出来 = 一堆带属性的 atom,零边。**（关系边按需另建,见下方核心原则。）

| 原边 | 新属性 | 含义 |
|------|--------|------|
| `belongsToNote` | `noteId` | 该 block 属于哪篇笔记（**归属是本体固有事实,非关系**） |
| `childOf` | `parentId` | 父 block 的 id（顶层块为 null） |
| `nextSibling` | `order` | 同级内的**字典序排位**（见 §2.3） |

**assemble**：拉同 `noteId` 的所有 atom → 按 `parentId` 建树 → 同级按 `order` 字典序排序 → 重建
中间结构容器（bulletList/tableRow 等,规则同现状）。**纯属性计算,零边遍历。**

#### 核心原则：文档本体零边,关系层按需建边（用户拍板 2026-06-08）

> **一个原始文档,不应该包含任何边关系。** 边只在**需要关系化**时才创建 —— 比如要持久化这篇文档
> 与其他文档的某些关系,或按某种分析模型组织文档的内在联系时,**才**真正构建边。

分两层:

| 层 | 内容 | 何时存在 | 表达 |
|----|------|---------|------|
| **文档本体**(原始文档) | 所有 block + 结构(顺序/层级/归属)+ 内容 | **导入/创建即完整,零边** | **纯 atom 属性**(order/parentId/noteId) |
| **关系层** | 双链 / 引用 / 主题归类 / 标签 / 跨文档关系… | **按需创建**(有分析/关联需求时) | **边** |

要点:

- **连「归属」(noteId)也是属性,不是边** —— 「这个块属于这篇文档」是文档本体的**固有事实**,
  不是「关系」。归属用属性,文档本身就完整自洽,**一条边都不需要**。
- **边是叠加在文档之上的可选关系层**,不是「拆解文档必然产生的副产品」。原始文档 dissect 出来
  就是一堆带属性的 atom,**干干净净,零边**。边由用户/分析**有意建立**,文档不依赖它而存在。
- **边的不可靠性不再威胁文档** —— 因为结构已由属性兜底。所以反而可以**放心地用边、多样化建边**
  支持快速关系查询(「这个主题下所有块」「引用了这个块的所有地方」用边查 O(查边),比拉 atom
  过滤属性快)。边从「错误的结构表达」中解放,回归「关系表达」本职。

> 这统一了「文档本体属性化」与「关系层多边化」:不是砍边,是把边从文档结构里剥离,变成文档之上
> 按需叠加的关系层。文档可靠 + 快;关系灵活 + 多维。

### 2.2 为什么这是最优解（对比方向 A 单一 JSON）

| | 方向 A：结构整存为单一 JSON 字段 | **本方案：分散 atom 属性** |
|---|---|---|
| 结构存哪 | note 容器的一个 JSON（整棵树） | 每个 atom 的 parentId/order/noteId 属性 |
| 块内容 | per-atom | per-atom |
| 改一个块位置 | **重写整个结构 JSON**（失去增量） | **只 putAtom 那一个块**（保留增量） |
| 原子性 | 结构整体原子写 | 每 atom 独立写,靠 putAtom 幂等 |
| 图谱能力 | 块仍是 atom | 块仍是 atom（不变） |

**本方案 = 方向 A「结构不用边」的内核 + 保留 atom 增量/图谱优势。** 关键：复用 **putAtom 的幂等
写入**（UPSERT 按 id 覆盖,已证可靠 —— image src 就是这么存对的）,结构信息搭它的便车,从根上
绕开「边不幂等 + 边链易断」。

### 2.x 收益：可靠性 + 性能 + 简洁(一举三得)

去边不只修可靠性,**增删改查全链路同时提速 + 简化**(因为不再做边查询/边写入/拓扑排序)：

| 操作 | 现状(边模型) | 新方案(属性) | 收益 |
|------|------------|------------|------|
| **读 / 打开**(assemble) | 拉 belongsToNote 边 → 拉 block atom → 拉 nextSibling 边 → 拉 childOf 边 → **拓扑排序链表**重建顺序 | `listAtomsByAttribute(noteId)` 一次拉 atom → 按 order 排序 + parentId 分组(纯内存) | 少 3 类边查询 + 去拓扑排序;**打开慢的一大主因消除** |
| **写 / 保存**(applyDiff) | putAtom **+ putEdge(几百条)+ deleteEdge** | **只 putAtom**,零边写 | 少写几百条边;无「边不幂等累积」 |
| **删**(deleteNote) | 级联删所有 belongsToNote 边 | 直接 deleteAtom(级联自动) | 更简单 |
| **改顺序**(拖/插块) | 删旧 nextSibling 边 + 建新边(易半写/重复) | 改一个 atom 的 order(字典序取中点) **O(1) 一次 putAtom** | 增量 + 幂等 |

> 通常架构改造要在「可靠性 / 性能 / 简洁」间权衡;本方案三者同向 —— 因为脆弱性的根源(结构靠边)
> 同时也是性能负担(边查询 + 拓扑排序)和复杂度负担。拔掉它,三个都改善。

### 2.3 order：字典序 rank（Lexicographic Rank）

顺序用**字符串字典序**表达,不用整数序号:

- 形如 `"A0000000" < "A0000001" < ... < "B0000000"`,字符串比较天然有序。
- **插入中间 = 取两端中点**：`A000` 与 `A001` 之间插入 → `A0005`,**O(1),只写新块,不重排其他块**。
- 无浮点精度问题（对比 fractional indexing 的浮点方案）。
- 调试友好（字符串可视化有序）。
- 项目无现成 rank 库,字典序最轻量。

> 对比整数序号：整数插入中间要把后续全部 +1（重写 N 个 atom）→ 又回到「写放大」,且并发改序号易撞。
> 字典序避免这个问题。dissect 初次生成时按顺序分配递增 rank;运行时插入取中点。

### 2.4 parentId 与结构容器跳层

Decision 026 §3 的「结构性容器不拆 atom」（bulletList/orderedList/taskList/columnList/tableRow）
**保留**。`parentId` 沿用现状 childOf 的**跨层语义**：

- listItem 的 parentId 跳过 bulletList,指向上层真实块（或 noteId 顶层）
- tableCell 的 parentId 跳过 tableRow,指向 table atom
- assemble 时按 parentId 建树后,再用现有 `applyRebuildRules`/`assembleTable` 重建中间容器壳（逻辑不变,
  只是输入从「childOf 边」变成「parentId 属性」）

---

## 三、改动面

| 文件 / 模块 | 改动 | 量 |
|------------|------|-----|
| `dissect-pm-doc.ts` | 删边累积,改写 noteId/parentId/order 到 atom attrs | 中 |
| `assemble-pm-doc.ts` | 删 topologicalSortSiblings/childOf 分组,改按 order 排序 + parentId 建树 | 中 |
| `diff-block-tree.ts` | dissect 输出改属性形式,边 diff → 纯 atom 属性 diff | 小 |
| `capability-impl.ts` | deleteNote 级联改 atom 级联（不依赖 belongsToNote 边） | 小 |
| `cardinality-check.ts` | childOf/nextSibling/belongsToNote 边扫描 → 改属性唯一性扫描（或直接删该检查） | 小 |
| storage API | 新增 `listAtomsByAttribute`（按 noteId 查 atom）支持 | 中 |
| migration | 新增 `028-block-structure-attrs.ts`：旧边 → 属性 backfill | 中 |
| 测试 | dissect/assemble/diff round-trip 单测 | 中 |

**总量 ~800–1000 行。** 调研确认：**graph / search / thought / ebook 均不依赖这三类结构边**
（graph 用自己的 inCanvas 边,thought 用 blockId 属性,ebook 用 bookAnchor 属性）→ **无硬依赖阻塞**。

---

## 四、迁移

- 机制：沿现有 `src/storage/migrations/` flag 文件式一次性脚本（参考 023-note-title-cache）。
- 流程：每篇 note → 旧 `assemblePmDoc`（用边拼装,得正确结构）→ 重新 dissect 成属性形式 →
  批量 putAtom（幂等,可中断重跑）+ 删除该 note 所有旧结构边。
- **兼容期**：迁移前 assemble 仍能读旧边模式（向后兼容）,迁移失败可回滚。
- **顺带修复**：迁移用旧 assemble 的「keep-latest 去重」逻辑读出**正确顺序**,写成属性 →
  **自动修复现有重复边导致的损坏笔记**。

---

## 五、分阶段实施计划（每阶段独立可验证）

> 大重构,改文档存储核心。分阶段、每阶段 commit + 验证,出问题只回退一阶段。

- **Phase 0 — 属性字段就位**：block atom 加 noteId/parentId/order attr（schema/dissect 写入,但 assemble
  仍读边）。零行为变化,双写过渡。
- **Phase 1 — assemble 读属性**：assemble 改为优先按属性建树排序（属性缺失 fallback 旧边）。验证 round-trip。
- **Phase 2 — diff/写入只写属性**：applyDiff 不再写结构边,只 putAtom（带属性）。新数据零结构边。
- **Phase 3 — 迁移 + 清边**：跑迁移脚本,旧笔记边 → 属性,删所有结构边。修复损坏笔记。
- **Phase 4 — 清理**：删 dissect 的边生成、assemble 的边读取、cardinality 的边检查等死代码。

---

## 六、待思考 / 风险

- order 字典序 increment / midpoint 的精确算法（取中点的字符串运算,避免退化）。
- `listAtomsByAttribute(noteId)` 的查询性能（需 SurrealDB 索引 noteId 字段）。
- Phase 1 双读（属性优先 + 边 fallback）的过渡期一致性。
- 迁移 round-trip 校验：迁移后 assemble 出的 doc 必须与迁移前逐块相等（可加 hash 比对作为迁移验收）。
- belongsToNote 改属性后,listNotes 的「按 hasNoteView 反查」路径要适配。
