# Decision 026 — Block 独立化 sub-phase 设计(核心决议)

> **类型**:核心设计决议(纯文档,不写代码)
> **决议日期**:2026-05-21
> **前置依赖**:[`decision 025`](../../atom/decisions/025-atom-granularity-current-form-acknowledgment.md)(承接 v1.3 工程妥协 + 注销 decision 030 占位)
> **后续依赖**:[`block-atomization-implementation-plan.md`](../../../stages/block-atomization-implementation-plan.md)(实施任务设计)
> **设计起点**:[Canvas-As-Note-Migration.md](../../../../10-business-design/graph/Canvas-As-Note-Migration.md)(V1 时代已有完整草案)
> **用户决策**:本对话 8 项 AskUserQuestion 累积拍板

---

## 0. 本决议为何存在

### 0.1 上游触发

[调查报告 §1](../../../notes/atom-granularity-investigation-2026-05-21.md) 字面:用户在位置记忆 feature 实施过程中发现 `krig://block/<noteId>/<idx>:<前30字>` anchor 不稳,追溯到 V2 atom 颗粒度设计与实施不一致。

[`decision 025`](../../atom/decisions/025-atom-granularity-current-form-acknowledgment.md) 已字面承接 v1.3 工程妥协 + 登记 block 独立化为远期愿景。**本决议拍板 block 独立化的具体设计**。

### 0.2 本决议范围(用户拍板)

| 范围 | 字面拍板 |
|---|---|
| ✅ block 拆 atom 颗粒度边界 | 全部 PM block(group='block' 的所有 node) |
| ✅ block id 字段位置 | PM schema `attrs.id`,storage atom.id 同步 |
| ✅ Copy/Paste 语义 | 粘贴全部生成新 id |
| ✅ Split/Merge 语义 | Split 上半保留/下半新;Merge 保留上方 |
| ✅ 嵌套 block 表达(parentId / 边) | 详 §6 |
| ✅ 边集设计(belongsToNote / nextSibling / etc) | 详 §6 |
| ✅ URL 协议演化 | 详 §7 |
| ✅ 迁移策略 | 一次性 migration script |
| ✅ SurrealDB schema | 不增独立 `block:[id]` 表,沿 atom 表 |
| ✅ PM ↔ atom 转换时机 | 读时拼装/写时拆解 + capability 层 in-memory PM-doc 缓存 |
| ✅ 容量与性能取舍 | 详 §9 |
| ✅ 影响面清单 | 详 §10 |
| ✅ 启动条件 | 详 §11 |
| ❌ 投影模型(语义层 vs PM 渲染层彻底分离) | **不在本 sub-phase 范围**(用户拍板,留更远未来) |
| ❌ 跨 note Block 共享 / 多视图 Block 复用 | 不在本 sub-phase(decision 026 完成后由更下游 sub-phase 推进) |
| ❌ 实施代码 | 不在本决议(留 [`block-atomization-implementation-plan.md`](../../../stages/block-atomization-implementation-plan.md)) |

### 0.3 设计原则(本决议遵循)

- **不替用户决定语义级议题** — 所有语义决策来自用户 AskUserQuestion 累积(§3-§7 每节明示用户拍板时间)
- **每条决议给替代方案对比表** — 字面登记被拒方案及理由
- **字面证据导向** — 引用 spec / 决议 / 代码字面位置
- **架构一致性** — 优先复用 V2 已有模式(graph-instance / folder / hasContent 边),不引入新抽象

---

## 1. 改造目标(What)

### 1.1 一句话目标

把 note 域的 `pm atom = 整篇 PM doc` 升级为 `pm atom = 单 block`(对齐 graph-instance 模式),给每个 block 稳定 ULID,让边能直接指向 block。

### 1.2 完成判据(高层)

- ✅ 一篇 N-block note 在 storage 层 = N 个 pm atom + 至少 N-1 条顺序边 + 1 条 belongsToNote 边/atom + 嵌套边(if any)
- ✅ 每个 block 在 PM `attrs.id` 持有稳定 ULID,与 atom.id 同步
- ✅ 跨 note 引用 URL 升级为 `krig://block/<noteId>/<blockId>`(blockId 是 atom.id)
- ✅ 用户深度编辑 note(增/删/改/拆/合 block)后,既有 anchor / thought 标注 / 引用 **不再漂移**
- ✅ 已有 V2 note 数据一次性 migration 通过,无丢失

### 1.3 不变约束(本 sub-phase 不打破)

- ❌ 不改 [atom/spec.md §0.1 / §2.2](../../atom/spec.md) "Atom = 语义最小单元 / pm atom = 最小单元" 字面定义
- ❌ 不动 graph-instance / folder / ebook 等已实施 domain
- ❌ 不引入新 atom domain(仍用现有 `pm` domain)
- ❌ 不引入投影模型(语义层 vs 渲染层分离留更远未来)
- ❌ 不增 SurrealDB 独立 `block:[id]` 表(用户拍板与 three-layer §6.4 字面差异已在 decision 025 §2.2 登记)

---

## 2. 改造背景(Why)

### 2.1 spec ↔ 实施 字面冲突

[`atom/spec.md §2.2`](../../atom/spec.md) 字面:

> pm atom = **最小单元**(如 `{ type: 'text', text: 'hello' }`)
> block = pm atom 的组合形态

[`src/platform/main/note/capability-impl.ts:54-66`](../../../../../src/platform/main/note/capability-impl.ts#L54) 字面:

```ts
const atom = await tx.putAtom<'pm'>({
  payload: { domain: NOTE_DOMAIN, payload: pmDoc },  // pmDoc 是整个 { type: 'doc', content: [...] }
});
```

→ spec 字面"最小单元 = inline 级",实施字面"整篇 doc = 1 atom",**颗粒度字面冲突**。

本决议**部分对齐** spec ↔ 实施:
- block 拆 atom 之后,**block-level** 是 atom 颗粒度边界(用户拍板"全部 PM block")
- inline(text / mark)**不拆**,仍嵌套在 block atom 的 PmPayload.content 内
- 这是工程可行性 + spec 字面意图的折中(详 §3 颗粒度边界)

### 2.2 受限 feature 列表

[`decision 025 §5.3`](../../atom/decisions/025-atom-granularity-current-form-acknowledgment.md) 字面登记的代码影响清单 + [调查报告 §5.1](../../../notes/atom-granularity-investigation-2026-05-21.md)字面:

| feature | 当前实施 | 受限场景 |
|---|---|---|
| 跨 note 引用某段 | `krig://block/<noteId>/<idx>:<前30字>` | 编辑后 idx / 前 30 字变化 → 漂移 |
| Thought 标注某 note 段 | `NoteLocator { pmPos, anchorType, text }` | 编辑后 pmPos 漂移 |
| Thought 标注 ebook 段 | 走 BookLocator + bookAnchor 塞 block.attrs | block 无稳定 id,attrs 跟 block 走但 block 自身无 id |
| Thought 标注 graph 节点 | `GraphLocator { nodeId }` | **不漂移**(对比鲜明)|
| 关系图谱节点指向某段 | n/a | 受 atom 颗粒度限制(边只能指 atom 整体)|
| 滚动位置记忆 | `krig://block/<noteId>/<idx>:<前30字>` | 编辑后漂移(调查报告触发原因)|

### 2.3 接受的代价

按调查报告 §5.3 字面整理,block-level atom 颗粒度的代价(本 sub-phase 接受):

- **写入碎**:一篇 1000 block 的 note = 1000 atom + N 条 child/order 边 → 由读时拼装/写时增量 diff 缓解(详 §8)
- **查询要拼装 tree**:由 capability 层 in-memory PM-doc 缓存缓解(详 §8.4)
- **边表数量爆炸**:每 block 至少 1 条 belongsToNote / nextSibling 边 → 由子图索引(atom/spec.md §4.4)解决(留更远未来)
- **编辑事务复杂**:PM step → atom 写入的映射粒度,由 capability 层 diff 算法封装(详 §8.3)
- **协作合并复杂**:多设备协作场景每 block 一个 conflict 单元,但**对单设备场景反而更细粒度**(本 sub-phase 不深入协作场景)

---

## 3. 颗粒度边界(用户拍板:叶子及叶子级容器)

### 3.1 字面拍板

**颗粒度边界**:**叶子 block + 叶子级容器拆 atom;结构性容器(用户从不单独引用的中间层)不拆**

(2026-05-21 审计后修订 — 原拍板 "全部 PM block" 经容量评估改为本规则,详 §3.2 拍板理由)

#### 3.1.1 拆 atom 的 block 类型

| 类型 | 字面 | 拆理由 |
|---|---|---|
| paragraph / heading / horizontalRule / hardBreak | 叶子文本块 | 用户标注 / 引用直接命中 |
| codeBlock / mathBlock / mathVisual | 叶子代码/数学块 | 同 |
| image / fileBlock / fileLink / audioBlock / videoBlock / htmlBlock / tweetBlock | 叶子媒体块 | 6 个已有 atomId 占位 |
| externalRef | 叶子引用块 | 同 |
| **listItem / taskItem** | 叶子级容器(列表项) | 用户标注"清单项" / thought 直接挂 item |
| **table** *(2026-05-28 修订:从 §3.1.2 上移)* | 叶子级容器(表格根)| 用户可单独引用整表(拖动 / 跨表引用 / 编辑表格属性);与生产 PDF-Note-Atom 契约 §4.7 顶层 atom 字面一致;tableCell 通过 childOf 边指向 table atom — 详 §6.1 |
| **tableCell / tableHeader** | 叶子级容器(单元格)| 用户标注表格某格;rowIndex / colIndex 走 attrs(详 §6.1);tableHeader 与 tableCell 同模式拆 atom(详 §3.1.2 注 1)|
| **callout** | 叶子级容器(callout 整体)| 用户标注 callout 内部段时,attach 在 callout 容器层 |
| **blockquote** | 叶子级容器(引用块) | blockquote PM schema 字面 `content: 'block+'`,可含多 paragraph;用户标注引用块整体 attach 在 blockquote 层(同 callout 模式)|
| **column** | 叶子级容器(多列布局中的列)| column 持有用户语义("第二列");用户标注"第二列内容"attach 在 column 层 |
| toggleList | 折叠容器 | 用户引用"折叠摘要" |
| unknown | 未识别 | 字面保留(防御性) |

#### 3.1.2 不拆 atom 的 block 类型(结构性容器)

> **(2026-05-28 修订:决策拍板 table 是 atom)** — 原"table 不拆"字面已撤销。table 上移到 §3.1.1 叶子级容器清单(用户可单独引用整表 — 拖动 / 跨表引用 / 编辑表格属性 / 与生产 PDF-Note-Atom 契约 §4.7 顶层 atom 字面一致)。本节字面只保留**真正的中间层结构性容器**。

| 类型 | 字面 | 不拆理由 |
|---|---|---|
| **tableRow** | 表格行 | 用户从不单独引用行;row 边界信息由 tableCell.attrs.rowIndex / colIndex 承载(详 §6.1);assemble 端按 rowIndex 分组重建 tableRow 包裹 |
| **bulletList / orderedList / taskList** | 列表容器 | 用户从不单独引用列表本身;listItem 通过 childOf 直接指向最近的 block-atom 父(若 list 在 paragraph 后即直接挂顶层 doc) |
| **columnList** | 多列容器 | 同 list 容器思路;只拆 column,不拆 columnList |

> **注 1**: 关于 tableHeader 是否拆 atom — 字面歧义可能存在(tableHeader 介于"行"和"单元格"之间)。**(2026-05-28 拍板)**:tableHeader 与 tableCell 同模式拆 atom(都是叶子级单元格),走同款 `attrs.rowIndex / colIndex`(rowIndex=0 字面对应表头行)。实施任务设计 Stage 1 仅做 grep verify(已无歧义)。
>
> **(2026-05-28 修订附记)** 实施层 STRUCTURAL_CONTAINER_TYPES 集合应从 6 项 `{table, tableRow, bulletList, orderedList, taskList, columnList}` 字面降为 **5 项** `{tableRow, bulletList, orderedList, taskList, columnList}`。该集合在仓库内字面散落三处(`assemble-pm-doc.ts` / `dissect-pm-doc.ts` 通过 import 复用 / `build-auto-block-id-plugin.ts` / `atoms-to-pm.ts`),**三处必须保持同步**作为契约;集中化怎么实施留 §13.8 + sub-phase 5B 决定,但**集合内容字面一致**是本决议的硬契约。

#### 3.1.3 inline 节点不拆(group='inline')

- text / mathInline / codeInline / **noteLink** / fileLink(inline 形态)/ mention

→ inline 节点仍嵌套在所属 block atom 的 `PmPayload.content` 字段内。

#### 3.1.4 字面容量影响

按本规则,100 行 × 10 列 table 的 atom 负载 **(2026-05-28 修订:决策拍板 table 是 atom,"不拆"措辞已删)**:

- 1 table atom(根容器,**拆为 atom**,attrs.id=ULID,PM JSON `content=[]`)
- 0 tableRow atom(**不拆**;row 边界信息走 tableCell.attrs.rowIndex / colIndex,assemble 端按 rowIndex 分组重建 tableRow 包裹)
- 100×10 = 1000 tableCell atom(每 cell `attrs.id=ULID` + `attrs.rowIndex` 0-99 整数 + `attrs.colIndex` 0-9 整数)
- 每 cell 内 ≥1 paragraph atom → 1000 paragraph atom
- **合计:1001 atom + 1 belongsToNote(table→note) + 1000 childOf(cell→table) + 1000 belongsToNote(cell→note) + ~3000 nextSibling(cell 内 paragraph + cell 排序 + table 与同级排序)**

(原"全部 PM block"拍板:1101 atom + 1100 childOf 边 + tableRow 100 atom — 现砍掉 tableRow 中间层,但保留 table atom。本字面估算与 §3.4 例 3 字面 1:1 一致 — 决策已拍板 table 是 atom。)

### 3.2 替代方案对比

| 方案 | 字面颗粒度 | 优点 | 缺点 | 拍板理由 |
|---|---|---|---|---|
| A. 仅顶层 block | doc.content 直接子节点 | 模型简洁;迁移代价中等 | list-item / table-cell 无独立 id,无法被 thought / anchor 精确指向 | ❌ 不满足"thought 标注列表项 / 单元格" |
| B. 全部 PM block(2026-05-21 原拍板)| 所有 group='block' node | 颗粒度最细 | 结构性容器(tableRow / 3 list 容器 / columnList)拆 atom 无用 + 一张大表负载爆炸 | ❌ 审计后修订,改为 D |
| C. 顶层 + 列表项 + cell | 仅 paragraph/heading + listItem + tableCell | 折中复杂度 | callout 内段标注无法 attach 在 callout 层 | ❌ 中间方案,被 D 覆盖 |
| **D. 叶子及叶子级容器(本决议最终拍板)**| 叶子块 + 叶子级容器(listItem / tableCell / callout / column)| 用户可标注的每个层级都有 id;砍掉结构性中间层 | childOf 边可能跨多层 PM 节点(tableCell → table)| ✅ 用户拍板(审计后,2026-05-21) |
| E. inline 也拆(text / mark) | atom/spec.md §2.2 字面落地 | spec 字面最严 | 一段 hello world 拆 11+ atom;工程不可行 | ❌ 用户排除 |

### 3.3 childOf 边拼装规则(跨层处理)

按 §3.1 拍板,childOf 边**不一定指向 PM 父节点**,而是指向**最近的拆 atom 的祖先**:

- tableCell.childOf → table atom(跳过 tableRow / tableHeader)
- listItem.childOf → 最近的拆 atom 的祖先(若 list 在 doc 顶层即直接挂 note 容器;若在 callout 内即挂 callout 的 child paragraph;若嵌套 list 即挂上层 listItem)
- callout 内的 paragraph.childOf → callout atom

拼装时(decision 026 §8.1 assemble-pm-doc),capability 层需要**手工构造**跳过的中间层(在 PM tree 中重建 tableRow / list 容器)— 用 PM schema 的默认 content rule 推断或代码硬编码常见模式:

| 父 atom | 中间层规则 |
|---|---|
| table atom | 按 cells 顺序还原成 tableRow → tableCell 嵌套 |
| listItem atom 接父 | 找到最近 list 类型(bulletList / orderedList / taskList)上下文,套上 wrapper |
| callout 内部 paragraph | 直接放 callout.content |

→ 实施细节复杂度提示:**Stage 2 assemble 函数需要处理中间层重建**(沿 PM schema autofill 路径或代码内置规则)。详 [`block-atomization-implementation-plan.md`](../../../stages/block-atomization-implementation-plan.md) Stage 2。

**用户拍板**:**方案 D**(审计后修订,2026-05-21;详 §3.2 对比表 + §12.2 第二轮拍板)。

### 3.4 字面颗粒度规则

具体实施时,block-level atom 的 PM JSON 形态:

```ts
// 例 1:顶层 paragraph(无嵌套)
{
  domain: 'pm',
  payload: {
    type: 'paragraph',
    attrs: { id: '<ULID>', isTitle: false, bookAnchor: null },
    content: [
      { type: 'text', text: 'hello world', marks: [...] }
    ]
  }
}

// 例 2:listItem(嵌套场景 — listItem 内 paragraph 是另一个独立 atom)
{
  domain: 'pm',
  payload: {
    type: 'listItem',
    attrs: { id: '<ULID>' },
    content: []   // 内部 paragraph 已拆为另一 atom,通过 childOf 边关联(详 §6)
  }
}

// 例 3:table(嵌套场景 — table / tableCell / cell 内 paragraph 都是独立 atom;tableRow 不是 atom)
// (2026-05-28 修订注:本例字面与 §3.1.4 容量估算"1 table atom"字面 1:1 一致 — 决策已拍板 table 是 atom)
{
  domain: 'pm',
  payload: {
    type: 'table',
    attrs: { id: '<ULID>' },
    content: []   // 同上;tableCell 通过 childOf 边关联 table atom(跳过 tableRow);
                  // row 边界信息走 cell.attrs.rowIndex / colIndex(详 §6.1)
  }
}
```

**容器 block(listItem / tableCell / callout / column / blockquote / **table** 等)的 `content` 字段 = 空数组**,内部嵌套通过 `user:krig:childOf` 边表达(详 §6.3)。

**叶子 block(paragraph / heading / codeBlock / mathBlock / image 等)的 `content` 字段 = inline 数组**(沿 PM 原形态)。

> **(2026-05-28 修订注 — PM schema 一致性)**: 当前实施 `src/drivers/text-editing-driver/blocks/table/spec.ts` 的 `tableNodeSpec` 字面**完全不声明 attrs**(无 id 字段),与本节例 3 字面 `attrs: { id: '<ULID>' }` 不对齐。5B 实施时必须给 table NodeSpec 补 `attrs: { id: { default: null } }`(与 tableCell / tableHeader 同模式),否则 §6.1 跳层规则字面无目标。

---

## 4. ID 字段位置(用户拍板:PM attrs.id + atom.id 同步)

### 4.1 字面拍板

每个 block-level atom:
- atom.id = ULID(storage 层生成,跟 graph-instance / folder 同模式)
- PM schema 在该 block 的 `attrs` 加 `id: { default: null }` 字段
- **atom.id == PM attrs.id**(双向同步,capability 层负责一致性)

### 4.2 替代方案对比

| 方案 | id 在哪 | 优点 | 缺点 | 拍板理由 |
|---|---|---|---|---|
| **A. PM schema attrs.id**(沿用现有 6 个媒体 block atomId 占位模式) | PM 层 | PM tr 自然携带 id;copy/paste/split/merge 在 PM 层直接定语义 | 增加 PM schema 表面积(叶子+叶子级容器约 18 个 block 加 id 字段,详 §3.1.1)| 用户原选选项 1,后被反问触发架构讨论 |
| B. 独立 atom payload(无 PM 字段) | storage 层(atom.id);PM doc 不持有 id | PM schema 不污染 | PM 编辑→atom 映射需复杂 reconciliation;copy/split 时关联难维护 | ❌ 字面落地难 |
| **C. 双轨同步**(本决议,实质等价 A)| PM `attrs.id` + atom.id 字面同步 | 渲染、anchor、storage 各有 id 直读;graph-instance 同模式 | 同一概念两份字段,需 invariant 保证不漂移 | ✅ 用户拍板反问后等价于此(用户字面:"block=atom,atom 走 atom 表") |

**用户拍板**:**方案 C / 等价 A**(本对话 AskUserQuestion 2 + 反问澄清,2026-05-21)。

### 4.3 字面规则

- PM block schema 在 attrs 加 `id: { default: null }`(沿用 [image/spec.ts:43](../../../../../src/drivers/text-editing-driver/blocks/image/spec.ts#L43) 6 个媒体 block 已有占位)
- 新建 block 时,**PM appendTransaction** 拦截:发现 `attrs.id === null` 的 node → 注入新 ULID(用 `@semantic/id` 或新建 `block-id-generator`)
- atom.id == 该 block 的 PM `attrs.id`(invariant)
- capability 写回 storage 时,从 PM doc 抽 block,attrs.id 作为 atom.id 写入

### 4.4 已有 atomId 占位字段的复用

字面证据(grep): 6 个媒体 block 已有 `atomId: { default: null }` 占位:

- [image/spec.ts:43](../../../../../src/drivers/text-editing-driver/blocks/image/spec.ts#L43)
- audioBlock / videoBlock / htmlBlock / tweetBlock / mathVisual

**字面建议**:本 sub-phase 实施时,**统一字段名为 `id`**(不用 `atomId`,因为现在 PM 层不区分 atom 与 block,等价),并把 6 个媒体 block 的旧 atomId 字段**字面迁移**到 `id`(migration 脚本同步处理)。

---

## 5. PM 操作语义(用户拍板逐项)

### 5.1 用户敲 Enter 新建 paragraph

**场景**:用户在末尾按 Enter,PM 新建一个空 paragraph。

**id 注入时机**:
- PM `appendTransaction` 拦截 → 扫描新建的 node → 注入新 ULID 到 attrs.id
- 该 transaction 标记 `addToHistory: false`(参考 [`feedback_pm_internal_attr_write_must_mark_no_history`](../../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_pm_internal_attr_write_must_mark_no_history.md))
- 实施细节留 [`block-atomization-implementation-plan.md`](../../../stages/block-atomization-implementation-plan.md)

**字面要求**:新 block 在 dispatchTransaction 退出前必须已有 id。

### 5.2 Copy/Paste(用户拍板:粘贴全部生成新 id;携运语义留未来)

**字面拍板**(本对话 AskUserQuestion 3 + 审计拍板 2,2026-05-21):

- Cmd+C 复制 block → clipboard 持有 PM JSON(含原 id)
- Cmd+X / Cmd+C / Cmd+V 一律**生成新 ULID**,丢弃原 id(不区分 cut/copy)
- 同 note 内 Cmd+C / Cmd+V 来回剪贴 = 创建新副本,**不是移动**(对应 substance instance 模式 — 每实例独立 ULID)

**字面规则**:粘贴 transaction 的 `appendTransaction` 拦截时,**所有有 id 的 node** 都重新生成 ULID。

**字面后果**:
- 用户复制 block A 到剪贴板,删除原 A,粘贴 → 得到 A',A.id 已废弃。**A 上的所有 thought 标注 / 跨 note 引用全部失效**
- 设计意图清晰:复制 = 创建新副本,不承诺保持引用稳定

**审计登记的"携运"场景**(用户原意"剪切+粘贴到 note B" 应保留 id):
- 本 sub-phase **不支持** "Cmd+X → Cmd+V" 的 id 保留语义(简化拍板)
- 用户"携运"场景由两条路覆盖:
  1. **drag-drop 操作**(未来 sub-phase):走"移动"语义,保留 id;实施时引入"移动指令" API,与 clipboard 路径区分
  2. **指令式 API**(未来 sub-phase):moveBlock(blockId, targetNote, targetPos) — 保留 id 跨 note 搬运
- 本 sub-phase **不引入** clipboard cut/copy 区分(避免本期复杂度爆炸)
- decision 026 §13 Open Questions 新增条目 13.6 字面登记携运 sub-phase 待启动

### 5.3 Split(用户拍板:上半保留 / 下半新 id)

**字面场景**:paragraph A "hello world" 中间按 Enter,拆成 A1 "hello" + A2 " world"。

**字面拍板**(本对话 AskUserQuestion 4,2026-05-21):

- A1 保留原 A.id(语义:"原 block 是上半部分")
- A2 生成新 ULID
- A2 上无原 A 的 thought 标注 / anchor(因为 A 现在等价 A1)

**字面规则**:`appendTransaction` 拦截 split tr,识别"原 node 拆成两个" pattern,**保留上方 attrs.id**,下方 attrs.id 重新生成。

**实施细节**:PM split 在 `editor-view-builder.ts:142` 的 dispatchTransaction 路径展开,具体 hook 点留实施任务设计。

### 5.4 Merge(用户拍板:保留上方 id)

**字面场景**:paragraph A1 "hello" 后跟 paragraph A2 " world",光标在 A2 开头按 Backspace → 合并为 A1 "hello world"。

**字面拍板**(本对话 AskUserQuestion 4,2026-05-21):

- 合并后 block 用 A1.id
- A2.id 废弃(A2 上的 thought 标注 / anchor 失效)

**字面规则**:`appendTransaction` 拦截 merge tr,识别"两 node 合并" pattern,**保留上方 attrs.id**,storage 层 deleteAtom(A2.id)。

### 5.5 用户 backspace 在空 block 删除

**字面场景**:用户在空 paragraph 上按 Backspace → 删除该 block + 光标移到上一个 block 末尾。

**字面规则**:storage.deleteAtom(blockId),级联删除该 atom 上的 belongsToNote / nextSibling 等所有边(沿 [decision 016 §3.5](016-sub-phase-3a-2.5-note-form-upgrade.md) deleteAtom 级联模式)。

### 5.6 Undo/Redo(2026-05-21 审计后修订)

**字面规则**:
- 用户编辑动作产生的 PM tr → `addToHistory: true`(默认)
- 内部 id 注入 / 重新生成 tr → `addToHistory: false`(沿 [`feedback_pm_internal_attr_write_must_mark_no_history`](../../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_pm_internal_attr_write_must_mark_no_history.md))

**Undo 语义:PM history 精确回滚 + storage 通过 diff 路径自然恢复**

PM 内置 history 插件字面持久化 transaction 完整 attrs(包括 attrs.id),所以 undo 字面恢复原 doc 状态 — id 字面保留原值:

| 操作 | 原状态 | merge 后 | undo merge 后(PM doc 字面)|
|---|---|---|---|
| A1 "hello" + A2 " world" | A1.id=X, A2.id=Y | A1.id=X(merged "hello world")| A1.id=X "hello" + A2.id=Y " world" |
| A1.id=X 拆成 A1.id=X "hello" + A2.id=Z " world" | — | — | undo split 后 A1.id=X "hello world",Z 字面消失 |

**Storage 状态恢复**(capability 层 diff 路径):

undo merge 时:
1. PM doc 从 "A1.id=X merged" 字面变回 "A1.id=X + A2.id=Y"
2. capability.updateNote 触发,diff 算法发现:
   - A1.id=X 内容修改 → modified
   - A2.id=Y 在 newDoc 有但 storage 无(merge 时已删)→ **added 路径**重建 atom
   - nextSibling 边重建(X → Y)
3. **A2.id=Y 字面恢复**,但 **storage 中 A2 原来挂的 thought 边 / 跨 note 引用** 已在 merge 时级联删,**不能恢复**
4. 用户感知: doc 内容字面回滚,但 A2 上原有的 thought 标注**永久失效**(用户拍板接受 — 与 §5.6 "undo 是反向新操作" 不同的真实语义)

**Undo split 同模式**(对称):
1. PM doc 从 "A1.id=X + A2.id=Z" 变回 "A1.id=X"(原 A1)
2. diff 发现 A2.id=Z 在 newDoc 无 → removed 路径删 atom + 边
3. A2 上的 thought 边在 storage 已级联删

**字面对称性**:undo split = undo 的过程跟 split 的反方向同算法路径(diff 自然处理);undo merge = added 路径自然恢复 A2.id;**不需在 appendTransaction 拦截 history transaction**。

**实施提示**(留 [`block-atomization-implementation-plan.md`](../../../stages/block-atomization-implementation-plan.md) Stage 2 验收):
- diff 算法字面对 added / modified / removed 三路径处理后,undo/redo 自然 work
- `appendTransaction` 区分 user transaction vs history transaction 仅用于"是否重新注入 id" — history transaction(`tr.getMeta('history$')`)已携带原 attrs.id,**不重新注入**

---

## 6. 嵌套与边集设计

### 6.1 嵌套表达:childOf 边 + 顺序 + 跨结构性容器跳层

**字面规则**(用户拍板 §3.1 后修订 + Canvas-As-Note-Migration.md §1.4 设计起点对齐):

拆 atom 的容器 block(listItem / tableCell / tableHeader / callout / column / blockquote)**不**在 PM JSON `content` 内嵌套子 block(content 为空数组),通过 `user:krig:childOf` 边表达:

```
listItem atom A
  ↑ user:krig:childOf
paragraph atom B(listItem A 的子段落)
```

**结构性容器跳层规则**(§3.1 拍板"tableRow / 3 list 容器 / columnList 不拆"的必然推论;**2026-05-28 修订:table 已升为 atom,跳层规则对象不变 — 仍跳过 tableRow**):

childOf 边的 object 是**最近的拆 atom 的祖先**,跳过结构性中间层。具体场景:

| 字面 PM tree | childOf 边目标 |
|---|---|
| paragraph 在 doc 顶层 | belongsToNote 边到 note 容器(无 childOf)|
| paragraph 在 callout 内 | childOf → callout atom |
| paragraph 在 listItem 内 | childOf → listItem atom |
| listItem 在 bulletList 内,bulletList 在 doc 顶层 | childOf → note 容器(跳过 bulletList);belongsToNote → note 容器 |
| listItem 在 bulletList 内,bulletList 在 callout 内 | childOf → callout atom(跳过 bulletList);belongsToNote → note 容器 |
| listItem 嵌套(inner list 在 outer listItem 内)| 内 listItem.childOf → 外 listItem |
| tableCell 在 tableRow 内,tableRow 在 table 内 | tableCell.childOf → table atom(跳过 tableRow)*(2026-05-28 修订:决策拍板 table 是 atom — 此规则字面成立,childOf 有目标可指)* |
| tableHeader 同 tableCell 同模式 | tableHeader.childOf → table atom |
| column 在 columnList 内,columnList 在 doc 顶层 | column.childOf → note 容器(跳过 columnList)|

**(2026-05-28 新增 — tableRow 边界信息表达)**:

tableRow 既然不是 atom,row 边界信息**必须由 tableCell 自身承载**:

- `tableCell.attrs.rowIndex`: number(0-based 整数,字面对应该 cell 所属 row 在 table 内的位置)
- `tableCell.attrs.colIndex`: number(0-based 整数,字面对应该 cell 所属 col 在 row 内的位置)
- `tableHeader.attrs.rowIndex / colIndex`: 同款字面;rowIndex=0 字面对应表头行(若有表头)

**assemble 端拼装算法**(实施留 5B,本节字面登记规则):

1. 拉 childOf 边 → 拿到所有"父 = table atom A"的 tableCell / tableHeader 列表
2. 按 `attrs.rowIndex` 升序分组 → 每组就是一个 row 的 cells
3. 组内按 `attrs.colIndex` 升序排序 → 重建 tableRow PM node(`type:'tableRow', content:[cell0, cell1, ...]`)
4. 所有 tableRow node 按 rowIndex 升序 push 到 table atom 的 PM `content` 里
5. table atom 仍是 PM node,字面 `attrs.id` 走 atom.id;参与顶层 nextSibling 链(table 与同级其他 block 排序)

**字面理由**:
- rowIndex / colIndex 是 cell 自带的语义信息(用户标注"第 3 行第 5 列"直接命中);assemble 不依赖 nextSibling 启发式还原 row 边界
- 与生产 PDF-Note-Atom 契约 §4.7 顶层 `table` atom 字面对齐(契约内部走 tiptapContent 子树,适配层 atoms-to-pm 负责扁平 cell + rowIndex 标注的转换 — 留 5B/5C 实施)
- 此规则**从 Open Question 升格为已拍板契约**(详 §13.9)

**capability 层拼装时重建中间层**(详 [`block-atomization-implementation-plan.md`](../../../stages/block-atomization-implementation-plan.md) Stage 2):

- 从 storage 读 atom + childOf 边 → 知道"哪些 listItem 属于 callout A"
- 拼装时按 PM schema 规则**重新插入中间 wrapper**:`callout > bulletList > listItem` 而非 `callout > listItem`
- 重建规则用代码硬编码常见模式(table / list / columnList);未识别模式 fallback 走 PM schema content rule autofill(沿 [`feedback_pm_schema_autofill`](../../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_pm_schema_autofill.md))

**字面理由**:
- 结构性容器不拆 atom 减少存储负载(§3.1.4 字面估算)
- childOf 边跨层语义统一(每 atom 只挂一条 childOf,不会因中间层增加多条)
- 与 graph-instance 的 `inCanvas` 边模式对齐(单层 belongsTo,无中间层)

### 6.2 顺序表达:nextSibling 边 + order 字段

兼顾 ordering 表达,两种方案二选一:

| 方案 | 形态 | 优点 | 缺点 |
|---|---|---|---|
| **A. nextSibling 边(本决议推荐)** | A —[nextSibling]→ B —[nextSibling]→ C | 顺序明确;插入/删除局部修改边 | 排序需遍历链表,1000 block 一次 O(n) |
| B. order 字段 attrs | 每 block 有 `order: number` | 排序 O(1) | 中间插入需要重排所有 order,易撞 |
| C. 混合 | 短期 order + 长期重排为 nextSibling | 折中 | 复杂度高 |

**本决议拍板**:方案 A(nextSibling 边)— 与 storage 层"边一等公民"哲学对齐,且 listNotes / openNote 都是整篇拼装,O(n) 遍历不是瓶颈。

**字面边定义**:

```ts
{
  predicate: 'user:krig:nextSibling',
  subject: AtomRef(atomId=block-A),
  object: AtomRef(atomId=block-B),
  attrs: {
    createdBy: 'user-default',
    createdAt: ...
  }
}
```

Cardinality:
- 每 atom 最多 1 条 outgoing nextSibling(下一个唯一)
- 每 atom 最多 1 条 incoming nextSibling(上一个唯一)
- 第一个 block 无 incoming;最后一个 block 无 outgoing

### 6.3 归属表达:belongsToNote 边

block atom 归属于哪个 note 用 `user:krig:belongsToNote` 边表达(新增 predicate,沿 vocabulary `krig`)。

**字面定义**:

```ts
{
  predicate: 'user:krig:belongsToNote',
  subject: AtomRef(atomId=block-A),
  object: AtomRef(atomId=note-A),
  attrs: { ... }
}
```

**与 `hasNoteView` 边的关系**(沿 [decision 016 §3.3](016-sub-phase-3a-2.5-note-form-upgrade.md)):

- **当前 V2**(decision 016):note 是带 `hasNoteView` 边的 pm atom
- **block 拆 atom 后**(本决议):
  - `note` 仍然是带 `hasNoteView` 边的 pm atom,但其 `payload.payload = { type: 'doc', content: [] }`(空容器,所有 block 拆出)
  - 每 block atom 通过 belongsToNote 边指向 note atom
- listNotes 仍走 `hasNoteView` 边(不变)
- 读 note 内容 = listAtoms(belongsToNote.object = noteId) + 拓扑排序(nextSibling 链)+ 嵌套展开(childOf)

### 6.4 完整边集字面登记

本 sub-phase 新增 predicate:

| Predicate | 用途 | Cardinality | 字面位置 |
|---|---|---|---|
| `user:krig:belongsToNote` | block atom → note atom | 每 block 1 条 outgoing | 本决议新增 |
| `user:krig:nextSibling` | block atom → block atom | 每 atom 最多 1 条 outgoing + 1 条 incoming | 本决议新增 |
| `user:krig:childOf` | 嵌套 block 之子 → 嵌套 block 之父 | 每 atom 最多 1 条 outgoing | 本决议新增 |

**复用既有 predicate**(decision 012 / 016 / 022 已有):

| Predicate | 用途 | 本决议是否动 |
|---|---|---|
| `user:krig:inFolder` | note → folder | 不动 |
| `user:krig:hasNoteView` | pm atom 标识为 note | 不动(note atom 仍带该边)|
| `user:krig:hasContent` | graph text-node → pm atom | 不动(graph-instance 还在用)|

### 6.5 字面证据:已有 graph-instance / hasContent 边的对照

graph-instance 字面已有相似模式([decision 013 §3.3](013-sub-phase-3a-graph-canvas-migration.md)):

- 画板内每节点 1 atom(graph-instance domain)
- `user:krig:inCanvas` 边表达节点归属画板(类似本决议的 belongsToNote)
- `user:krig:hasContent` 边表达节点 → pm atom 内容引用

本决议 block 模型与 graph-instance 模式**字面对齐**(架构一致性):

| graph-instance | block(本决议) |
|---|---|
| 画板内 instance atom | block-level pm atom |
| `inCanvas` 边 | `belongsToNote` 边 |
| graph-canvas atom(容器) | note pm atom(容器,payload 空 doc)|
| 画板内位置 = instance.payload.position | block 内顺序 = `nextSibling` 边 |
| 嵌套(暂无) | `childOf` 边 |

---

## 7. URL 协议演化(用户拍板:旧 URL 直接废弃)

### 7.1 字面拍板

**旧 URL 格式**:`krig://block/<noteId>/<idx>:<前30字>` 或 `krig://block/<noteId>/<heading text 前60字>`(grep `getBlockAnchorAt`)

**新 URL 格式**:`krig://block/<noteId>/<blockId>`(blockId 是 PM attrs.id == atom.id)

**兼容策略**(本对话 AskUserQuestion 7,2026-05-21):**直接废弃**,旧 URL 点击丢出"错误:请重新复制链接"提示。

### 7.2 替代方案对比

| 方案 | 字面 | 优点 | 缺点 | 拍板理由 |
|---|---|---|---|---|
| **A. 直接废弃**(本决议)| 旧 URL 失效 + 错误提示 | 实现最简,无双套解析 | 用户旧引用断 | ✅ 用户拍板;V2 用户体量小,影响可控 |
| B. 兼容层 + 渐进 migration | 解析旧 URL → 反查 block → 改写为新 URL(读时迁移)| 用户旧引用平滑迁移 | 双套解析代码;maintenance 税 | ❌ 用户排除 |
| C. 一次性 migration 重写所有旧 URL | 启动时 scan 所有 doc 改写 URL | 用户旧引用保留 | 启动慢一次;实施需 grep 所有可能位置 | 部分采纳(下方 §7.3)|

### 7.3 字面规则

- **旧 anchor 算法** [`getBlockAnchorAt`](../../../../../src/drivers/text-editing-driver/api.ts#L823) **删除**(decision 026 实施时)
- **旧 anchor 解析** [`scrollToBlockAnchor`](../../../../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L73) **替换**为新格式解析
- **旧 URL 兼容**:
  - 字面检测旧 URL 格式(含 `:`)→ 输出错误日志 + 弹 UI 提示"链接已失效,请重新复制"
  - **不**做反向查 block 兼容(用户拍板 A)
- **一次性 migration 同步重写**(本决议字面引入):
  - 既有 note 内部如果有旧 URL 引用(其他笔记 / 自身),migration 脚本扫描 + **保留旧 URL 字面**(因为旧 idx + 前 30 字反查 block 不可靠)
  - 用户打开旧 URL 时弹错误提示
- **新 URL 生成**:`getBlockIdAt(pos)` capability API 取代 `getBlockAnchorAt`,直接返回 PM attrs.id

---

## 8. PM ↔ atom 转换 + 缓存(用户拍板:capability 层 in-memory)

### 8.1 字面拍板

PM 组织树 ↔ atom 集合 转换时机(本对话 AskUserQuestion 6,2026-05-21):

- **读时拼装**:capability.getNote(id) 一次性 listAtoms + listEdges + 拓扑排序 + 嵌套展开 → 拼装出完整 PM doc
- **写时拆解**:NoteView dispatchTransaction → onChange(DriverSerialized) → capability.updateNote(id, doc) → diff 出增量 atom / edge 写入
- **中间态缓存**:capability 层 in-memory `Map<noteId, PmDoc>` 缓存,updateNote 后同步更新

### 8.2 替代方案对比(中间态缓存)

| 方案 | 字面 | 优点 | 缺点 | 拍板理由 |
|---|---|---|---|---|
| **A. capability 层 in-memory cache**(本决议)| Map<noteId, PmDoc> | 实现简单;仅 main 进程生命周期,重启无需一致性 | cache invalidation 需 capability 主动维护(updateNote 后写回 cache) | ✅ 用户拍板 |
| B. SurrealDB 物化视图(磁盘缓存) | `note_pm_doc_cache` 表 | cold start 不重拼 | 多一层不一致风险;事务原子需保证 | ❌ 用户排除 |
| C. 不缓存 | 每次 listAtoms 拼 | 简单 | 1000 block note 性能未知 | ❌ 用户排除(YAGNI 反向考虑) |
| D. 不拍板,留独立 sub-phase | 默认无缓存 + 文档登记未来工作 | 解耦 | v1 性能可能不及格 | ❌ 用户排除 |

**用户拍板**:方案 A(本对话 AskUserQuestion 6,2026-05-21)。

### 8.3 capability 层 diff 算法(写时拆解)

写时拆解的字面伪代码:

```ts
async function updateNote(noteId: string, newDoc: PmDoc) {
  const oldDoc = cache.get(noteId) ?? await assemblePmDoc(noteId);
  const diff = diffBlockTree(oldDoc, newDoc);

  // diff 结果分类:
  //   added:    新建的 block(没有 attrs.id,或 id 不在 storage)
  //   modified: 内容变化但 id 一致的 block
  //   removed:  storage 有但 newDoc 不存在的 block
  //   reordered: nextSibling 边变化

  await storage.transaction(async (tx) => {
    for (const a of diff.added)    await tx.putAtom(...);
    for (const m of diff.modified) await tx.putAtom({ id: m.id, ... });
    for (const r of diff.removed)  await tx.deleteAtom(r.id);
    for (const e of diff.edges)    await tx.putEdge(...) / tx.deleteEdge(...);
  });

  cache.set(noteId, newDoc);
}
```

实施细节由 [`block-atomization-implementation-plan.md`](../../../stages/block-atomization-implementation-plan.md) 展开。

### 8.4 cache invalidation 规则

- 进程生命周期内:cache 由 capability 自管;updateNote / deleteNote 同步更新
- 跨进程:不在本 sub-phase 范围(本 sub-phase 假设单进程)
- 多窗口同 note 编辑:**当前 V2 已字面假设单窗口编辑同 note**(broadcast.ts 模式),本 sub-phase 不动

---

## 9. 容量与性能取舍

### 9.1 写入

| 维度 | 当前(整篇 atom)| 目标(block atom)| 性能预估 |
|---|---|---|---|
| 单字编辑 | 整篇 putAtom(1 次写入,payload N KB)| diff + 单 block putAtom(1 次写入,payload <1 KB)| 字面**更快**(diff 增量) |
| 整篇替换 | 整篇 putAtom | N 次 putAtom + M 条边 | 字面**更慢**(碎写)|
| 边写入 | 0(无 block 边)| N-1 条 nextSibling + N 条 belongsToNote + 嵌套 childOf | 新增 O(N) 边写入 |
| 事务性 | 单 atom 原子 | 整个 diff 走 storage.transaction(原子)| 字面同 |

### 9.2 查询

| 维度 | 当前(整篇 atom)| 目标(block atom)| 性能预估 |
|---|---|---|---|
| `getNote(id)` cold | 1 次 getAtom | 1 次 getAtom(note 容器) + 1 次 listAtoms(belongsToNote subject) + 1 次 listEdges + 拓扑排序 | 字面**更慢**(O(N) 工作)|
| `getNote(id)` warm(cache hit) | n/a | O(1) cache 读 | 字面**更快**(cache 缓解)|
| `listNotes()`(decision 016 3-query)| 不变 | 不变(只列 note 容器,不拉 block)| 字面同 |
| anchor 跳转 | O(N) PM doc 遍历(idx 算)| O(1) attrs.id 查 | 字面**更快** |

### 9.3 边表数量

- 1000 block note → 999 条 nextSibling + 1000 条 belongsToNote + ~200 条 childOf(估)= 约 2200 条边/note
- 100 篇 note → 22 万条边
- decision 011 sub-phase 1 已字面建索引(predicate + subjectAtomId / objectAtomId);本 sub-phase **不动 storage 索引**
- 性能压测留实施任务设计

### 9.4 PM step → atom 写入的映射

PM tr 一次可能改多个 block(如 bulk paste / replace all)。capability 层 diff 算法把整个 newDoc 比 oldDoc,**不依赖 PM step 粒度**。

→ PM step 不直接映射 atom 写入,**doc 终态差异 → atom diff**,简化模型。

---

## 10. 影响面清单(SDK-policy §2.2 第 8 步前瞻 grep)

### 10.1 直接影响位置(grep 字面)

| 类别 | 位置 | 影响性质 |
|---|---|---|
| **anchor 算法** | [`src/drivers/text-editing-driver/api.ts:823`](../../../../../src/drivers/text-editing-driver/api.ts#L823) `getBlockAnchorAt` | 重写:返回 `attrs.id` 而非 idx+前30字 |
| | [`src/drivers/text-editing-driver/api.ts:1184`](../../../../../src/drivers/text-editing-driver/api.ts#L1184) `scrollToBlockAnchor` 入口 | 重写:按 attrs.id 查 node |
| | [`src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts:73`](../../../../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L73) `scrollToBlockAnchor` | 重写 |
| | [`src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts:162`](../../../../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L162) `krig://block/{id}/{anchor}` 路由 | 新格式解析 + 旧格式错误提示 |
| | [`src/capabilities/text-editing/ui/link-panel/LinkPanel.tsx`](../../../../../src/capabilities/text-editing/ui/link-panel/LinkPanel.tsx) | URL 显示更新 |
| **note capability** | [`src/platform/main/note/capability-impl.ts:55-83`](../../../../../src/platform/main/note/capability-impl.ts#L55) `createNote` | 加默认 paragraph 时注入 attrs.id |
| | [`src/platform/main/note/capability-impl.ts:86-104`](../../../../../src/platform/main/note/capability-impl.ts#L86) `listNotes` | 不变(hasNoteView 边过滤)|
| | [`src/platform/main/note/capability-impl.ts:106-120`](../../../../../src/platform/main/note/capability-impl.ts#L106) `getNote` | 加拼装逻辑(read time assembly)|
| | [`src/platform/main/note/capability-impl.ts:122-133`](../../../../../src/platform/main/note/capability-impl.ts#L122) `updateNote` | 加 diff + 拆解逻辑 |
| | [`src/platform/main/note/capability-impl.ts:158-180`](../../../../../src/platform/main/note/capability-impl.ts#L158) `deleteNote` | 级联删所有 belongsToNote 子 atom + 边 |
| **PM block schemas** | 28 个 blocks 目录(`src/drivers/text-editing-driver/blocks/`,grep 字面)| 拆 atom 范围按 §3.1 字面规则:叶子及叶子级容器加 `id` 字段;结构性容器(table / tableRow / 3 list 容器 / columnList)不拆但仍需保留 schema 兼容 — 详 §3.1.1 与 §3.1.2 拆分清单 |
| | 6 个媒体 block 已有 `atomId: null` 占位 | 字面迁移到 `id` 字段(migration 处理)|
| **PM transaction handling** | [`src/drivers/text-editing-driver/editor-view-builder.ts:142`](../../../../../src/drivers/text-editing-driver/editor-view-builder.ts#L142) `dispatchTransaction` | 加 appendTransaction(自动注 id + split/merge 拦截)|
| **Thought NoteLocator** | [`src/shared/ipc/thought-types.ts:57`](../../../../../src/shared/ipc/thought-types.ts#L57) `NoteLocator { pmPos, anchorType, text }` | 升级为 `NoteLocator { blockId, offset?, preview? }`(对齐 GraphLocator)。⚠ **Stage 4 实施时字面扩展 preview 字段**(用户 2026-05-21 拍板,字面 UI 显示用,不参与定位)— 字面是字面对决议 §10.1 "取代旧的 pmPos + 冗余 text" 字面的扩展,详 [Stage 4 EM4 verify](../../../notes/block-atomization-em4-verify-2026-05-21.md) §"preview 字段(用户 2026-05-21 拍板)"。 |
| | 约 10 处 NoteLocator 使用点(2026-05-21 grep 字面,实施时复 grep 校准)| 字面同步 |
| **Thought view** | [`src/views/thought/`](../../../../../src/views/thought/) | 走新 NoteLocator,锚点不漂移 |
| **ebook bookAnchor** | 24 种 PM block attrs.bookAnchor | 字面保留(decision 022 字面不动),但 thought→ebook 标注语义可由 blockId 直接表达更稳 |
| **IPC types** | [`src/shared/ipc/electron-api.d.ts:266-269`](../../../../../src/shared/ipc/electron-api.d.ts#L266) `noteList / noteGet / noteCreate / noteUpdate` | API 签名不变(NoteDocEnvelope 形态不变,内部携带 attrs.id)|
| **IPC handlers** | `src/platform/preload/` | 不变 |
| **NoteView** | [`src/views/note/NoteView.tsx`](../../../../../src/views/note/NoteView.tsx) | 不变(仍以 DriverSerialized 形态)|
| **note-commands** | [`src/views/note/note-commands.ts`](../../../../../src/views/note/note-commands.ts) | Copy Link 命令逻辑改 |
| **note-link plugin** | [`src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts`](../../../../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts) | URL 路由改 |
| **migration** | `src/storage/migration/` 新增 V2 → block 拆 atom migration | 一次性脚本 + schema version bump |

### 10.2 决议层影响清单(decision 026 实施时同步)

承自 [decision 025 §5.2](../../atom/decisions/025-atom-granularity-current-form-acknowledgment.md):

| 决议 | 字面影响 |
|---|---|
| [decision 012 §3.2](012-sub-phase-2-note-folder-migration.md) | "路径 Y: pm atom = note" → 加历史注释,引向 decision 026 |
| [decision 016 §1.3](016-sub-phase-3a-2.5-note-form-upgrade.md) | hasNoteView 边语义保留,挂在 note 容器 atom 上(不动)|
| [decision 022 §1.3.1 / §3.2](022-sub-phase-022-ebook-thought-migration.md) | bookAnchor 字面保留;§3.2 "decision 030+" 占位由本决议承接 |
| [`atom/spec.md §2.5`](../../atom/spec.md) | V2 当前实现对齐说明同步更新 |

### 10.3 三层架构文档影响

| 文档 | 字面追加 |
|---|---|
| [three-layer.md §2.4](../../../../00-architecture/three-layer.md) | 追加 "V2 通过 decision 025 / 026 承接 v1.2 工程妥协" |
| [three-layer.md §6.4](../../../../00-architecture/three-layer.md) | 追加 "V2 落地选择 'block = atom' 同表模型,与本节字面 '增 block:[id] 表' 略有差异(详 decision 025 §2.2)" |
| [three-layer.md §8](../../../../00-architecture/three-layer.md) | 追加 2026-05-21 决策行 |

### 10.4 跨 X 复用语义明示

| 跨复用维度 | 字面后果 |
|---|---|
| **跨 view 的 block 复用**(同 block id 被 NoteView + GraphView 引用)| **不在本 sub-phase 范围**;留更远未来 |
| **跨 note 的 block 引用**(note A 引用 note B 的某 block)| 本 sub-phase 完成后**可通过 blockId 实现**;UI 入口留更远未来 sub-phase |
| **跨设备协作**(多人编辑同 note)| **不在本 sub-phase 范围**;假设单设备 |

---

## 11. 启动条件 / 触发条件

### 11.1 启动条件(本 sub-phase 何时该立项)

| Trigger | 字面 |
|---|---|
| ✅ **用户报告了 N 个引用失效场景** | 已触发(本对话调查报告 §1)|
| ✅ **滚动位置记忆 feature 受限** | 已触发(调查报告 §5.1)|
| ⚠ Thought 标注 note 段功能受限 | 部分触发(decision 022 字面 thought 实施完成,但 bookAnchor 漂移问题留 030+)|
| ⏳ AI 协作功能(AI 标注某段)落地 | 未触发(vision §5.2 但未排期)|
| ⏳ 多设备同步 / 共享笔记 | 未触发 |
| ⏳ 跨 note 块引用 UI(双链)| 未触发(对齐 Obsidian / Logseq 模式) |

→ 当前 trigger 数 = 2 已触发 + 1 部分触发 = **足以立项**。

### 11.2 工作量初估(2026-05-21 审计后调整)

| 阶段 | 估时(下限-上限)|
|---|---|
| Stage 1:PM schema 改造(28 blocks 评估 + 叶子/叶子级容器加 id 字段 + appendTransaction 拦截 + skipOnChange meta)| 1.5 - 2 天 |
| Stage 2:note capability 改造(read 拼装含跨层重建中间 wrapper + write 拆解 + diff + in-memory cache)| 2 - 3 天 |
| Stage 3:边集落地(belongsToNote / nextSibling / childOf 三 predicate)| 0.5 天 |
| Stage 4:Locator 升级(NoteLocator: pmPos → blockId)+ thought view 适配 | 1 - 1.5 天 |
| Stage 5:URL 协议演化(getBlockAnchorAt 改 → getBlockIdAt;旧 URL 错误提示)| 0.5 天 |
| Stage 6:一次性 migration script(已有 note 数据拆 atom)+ 备份 round-trip 测试 | 1 - 1.5 天 |
| Stage 7:典型场景测试(create / edit / split / merge / copy-paste / undo)| 1 天 |
| Stage 8:性能压测(1000 block note read/write/cache)+ 不达标处理决策 | 0.5 - 1 天 |
| Stage 9:验收 + 文档反向更新 | 0.5 - 1 天 |
| **总计** | **8.5 - 12 天** |

**buffer 来源**(沿 sub-phase 022 实际经验):
- diff 算法 / 跨层中间 wrapper 重建是 Stage 2 主要不确定性 → +1 天
- migration 备份 round-trip 排查 → +0.5 天
- 性能不达标处理 → +0.5 天
- thought NoteLocator 实际使用点字面校准 → +0.5 天

详 [`block-atomization-implementation-plan.md`](../../../stages/block-atomization-implementation-plan.md)。

### 11.3 前置完成项

- [`decision 025`](../../atom/decisions/025-atom-granularity-current-form-acknowledgment.md) 已合 main
- 本决议(026)已合 main
- 实施任务设计已合 main

### 11.4 风险陈述

| 风险 | 缓解 |
|---|---|
| 1000-block note 性能差(read/write 各 O(N)) | capability 层 in-memory cache(本决议 §8)+ 性能压测验证(Stage 8)|
| migration 失败导致已有数据无法读取 | migration 写完先在备份数据上跑一次完整 round-trip 验证;失败回滚到 schema v1 |
| PM schema 改造影响 28 个 blocks 目录(按 §3.1 实际加 id 约 18 个叶子+叶子级容器),潜在 bug 面大 | Stage 1 改完先 typecheck 全绿 + 各 block 渲染冒烟测试 |
| appendTransaction id 注入与 history 交互复杂(undo/redo / split/merge) | 实施前先列穷尽场景表,逐一覆盖 |
| 旧 URL 用户突然失效 → 用户报怨 | 字面在 README / Release Note 公告;V2 是开发期,用户基数有限 |
| 约 24 种 PM block.attrs.bookAnchor 现有数据迁移路径不变(实施前 grep `bookAnchor` 字面位置复核数字)| bookAnchor 字段 schema 保留;迁移仅拆 block 颗粒度,不动 bookAnchor 字段 |
| undo merge 后 A2.id 重建,但 A2 原有的 thought 标注 / 跨 note 引用**永久失效** | §5.6 字面承认;用户拍板接受。可在 UI 层弹 toast"撤销后部分标注不可恢复",提示用户;留实施任务设计 Stage 7 测试场景 T6 验收 |

---

## 12. 决策留痕

### 12.1 第一轮拍板(决议初稿,2026-05-21 设计阶段)

| 决策 | 结论 | 用户拍板时机 |
|---|---|---|
| 颗粒度边界:全部 PM block(group='block')— **审计后修订,见 §12.2** | 已修订 | AskUserQuestion 1,2026-05-21 |
| sub-phase 范围:只解 atom 颗粒度,不解投影模型 | 采纳 | AskUserQuestion 2 + 反问澄清,2026-05-21 |
| ID 字段位置:PM `attrs.id` + atom.id 双轨同步(等价"block = atom")| 采纳 | AskUserQuestion 2 + 反问澄清,2026-05-21 |
| Copy/Paste 语义:粘贴全部生成新 id(v1)| 采纳 | AskUserQuestion 3,2026-05-21 |
| Split/Merge 语义:Split 上半保留/下半新;Merge 保留上方 | 采纳 | AskUserQuestion 4 + 字面例子澄清,2026-05-21 |
| 嵌套表达:childOf 边(容器 block 内 content 为空数组)— **审计后增补跨层规则,见 §6.1** | 增补 | 2026-05-21 |
| 顺序表达:nextSibling 边(非 order 字段)| 采纳(本决议字面拍板)| 2026-05-21 |
| 归属表达:belongsToNote 边(block atom → note 容器 atom)| 采纳(本决议字面拍板)| 2026-05-21 |
| SurrealDB schema:不增独立 block 表,block-level atom 仍走 `atom` 表 | 采纳 | AskUserQuestion 5 + 反问澄清,2026-05-21 |
| PM ↔ atom 转换:读时拼装/写时拆解 + capability 层 in-memory PM-doc 缓存 | 采纳 | AskUserQuestion 6,2026-05-21 |
| URL 协议演化:旧 URL 直接废弃,点击丢错误提示 | 采纳 | AskUserQuestion 7,2026-05-21 |
| 迁移策略:一次性 migration script | 采纳 | AskUserQuestion 8,2026-05-21 |

### 12.2 第二轮拍板(审计后修订,2026-05-21 同日)

审计报告 §3 指出 5 个值得二次确认的设计点。用户拍板修订:

| 决策(修订)| 修订前 | 修订后 | 拍板来源 |
|---|---|---|---|
| 颗粒度边界 | "全部 PM block" | **叶子 + 叶子级容器拆;结构性容器(table/tableRow/3 list 容器/columnList)不拆**(详 §3.1)| 审计 AskUserQuestion 1 |
| childOf 边规则 | "指向 PM 父节点" | **指向最近的拆 atom 祖先,跨结构性容器跳层**(详 §6.1)| §3.1 拍板推论 |
| 携运语义 | 未登记 | **本 sub-phase 不引入 cut/copy 区分**;携运场景留 drag-drop 或未来 sub-phase(详 §5.2)| 审计 AskUserQuestion 2 |
| undo merge 语义 | "A2 重新生成 id" | **PM history 精确回滚 + storage 走 added 路径自然重建**(详 §5.6)| 审计 AskUserQuestion 3 |
| 总估时 | 8.5 天 | **8.5-12 天区间(30-40% buffer)**(详 §11.2)| 审计 AskUserQuestion 4 |
| 冷启动 race 防御 | 未登记 | **appendTransaction 加 setMeta('skipOnChange', true) 防御 + Host onChange handler 过滤**(详实施计划 Step 1.4)| 审计 AskUserQuestion 5 |

### 12.3 审计偏差修复字面登记

| 偏差 | 修复 |
|---|---|
| §10.1 "24+ blocks" 不精确 | 改为"28 个 blocks 目录"(grep 字面)|
| §10.1 "18 处 NoteLocator" 不精确 | 改为"约 10 处(2026-05-21 grep 字面,实施时复 grep 校准)" |
| Stage 4 EM4 描述歧义("A 下移 100 位")| 详实施计划 §5.4 字面改"A 的 PM pos 下移但 attrs.id 不变" |
| decision 025 §5.3 "atomId 占位"事实来源 | 加脚注"此事实由审计阶段补 grep 发现" |

---

## 13. Open Questions(本决议未拍板,留实施任务设计)

### 13.1 PM schema attrs.id 字段是否统一命名

6 个媒体 block 已有 `atomId` 占位,新增字段统一用 `id`?还是保留 `atomId` 以兼容?

**临时默认**:统一用 `id`,migration 时把 atomId 重命名为 id。

**留实施任务设计验证**。

### 13.2 split/merge 时 marks(bold / link 等)的归属

paragraph A = "hello **world**"(world 是 bold)中间拆分 → A1 = "hello" / A2 = " **world**"(bold 跟着 world 走)。这个语义无歧义,但实施时需测。

**临时默认**:沿用 PM 默认 split 行为,marks 跟内容走。

### 13.3 nextSibling 链断裂时的修复策略

如果某 block atom 被外部脚本删除(non-cascade)或 storage 异常,nextSibling 链可能断裂。read 时拼装应如何 fallback?

**临时默认**:read 时遇到链断裂 → console.error + 把残余 block 按 atomId 字典序 append 到末尾。决议 026 §5 风险类项,留实施任务设计 verify 阶段处理。

### 13.4 cache 内存上限

100 篇 1000-block note = 100 个 PM doc cache,内存占用未知。是否需要 LRU eviction?

**临时默认**:v1 全 cache,不 evict;实施时性能压测后决定。

### 13.5 跨进程 / 多窗口编辑同 note

当前 V2 字面假设单窗口编辑同 note。block 拆 atom 后,多窗口同 note 编辑应该 cache 怎么同步?

**临时默认**:本 sub-phase 不解(沿当前 V2 假设);未来多窗口 sub-phase 启动时再决议。

### 13.6 携运(保留 id)语义的实施方案(2026-05-21 审计后新增)

用户场景:在 note A 选中段落 → 搬到 note B(不留原稿)→ 期望 note A 上原指向该段的引用**自动跟着搬到 note B**。

**临时默认**:本 sub-phase **不实施携运**;clipboard 路径(Cmd+X/V)一律新 id;携运需走专门 API(未来 sub-phase)。

**可考虑的未来方案**(留独立 sub-phase 讨论):
- A. drag-drop "移动" 语义:走 moveBlock API,保留 id + 跨 note belongsToNote 边重定向
- B. clipboard cut/copy 区分:clipboard 写入时记 source = cut/copy;粘贴端按 source 决定 id 策略
- C. 显式 UI 入口:右键菜单 "搬运到其他笔记" → 走 moveBlock API

**字面承接条件**:本 sub-phase 完成后,decision 026 §6 的 belongsToNote / nextSibling / childOf 边集为携运提供了"修改归属"的底层能力(改 belongsToNote.object 即跨 note 搬运)。未来 sub-phase 仅需在 UI 层加入口。

### 13.7 tableHeader 拆 atom 的最终确认(2026-05-21 审计后新增)

§3.1.1 / §3.1.2 注 1 字面拍板"tableHeader 临时与 tableCell 同模式拆 atom,tableRow 不拆"。但 tableHeader 在 PM schema 字面介于"行"与"单元格"之间,可能存在字面歧义。

**临时默认**(§3.1.1):tableHeader 加 id 字段,与 tableCell 同处理。

**实施任务设计 Stage 1 验证项**:
1. grep `src/drivers/text-editing-driver/blocks/table/header.spec.ts`(或对应文件)确认 tableHeader 的 PM `content` 规则
2. 若 tableHeader.content === 'tableCell+' 或类似,确认 childOf 边目标:tableHeader 内的 tableCell.childOf → table atom(跳过 tableRow 和 tableHeader)?还是 tableCell.childOf → tableHeader atom?
3. 决议:Stage 1 实施时若发现矛盾,回头修订 decision 026 §3.1 / §6.1

**留实施任务设计 verify 阶段处理**。

### 13.8 中间层重建的硬编码扩展机制(2026-05-21 审计后新增)

§6.1 字面拼装规则"代码硬编码常见模式 + fallback PM schema autofill"。

**潜在未来约束**:未来引入新的结构性容器 block 类型(如 grid / flexbox / layout)时,需要同步更新 capability 层硬编码重建规则,否则 fallback 路径可能 autofill 出错。

**实施任务设计要登记**(留 Stage 2 实施):
1. 把硬编码规则抽到一个集中可扩展的位置(如 `assemble-pm-doc.ts` 顶部的 `STRUCTURAL_REBUILD_RULES` 常量)
2. 未来引入新结构性容器 block 时,**必须**在 commit message 或决议字面登记同步更新该常量
3. 当前 v1 字面登记 3 类(table / 3 list / columnList)的规则

**留实施任务设计 Stage 2 处理**。

### 13.9 tableCell 跨 row 拼装实施(2026-05-28 新增 — 已拍板,非 Open Question)

**背景**: 调研报告 [`2026-05-28-import-system-survey.md §6.9`](../../../../tasks/2026-05-28-import-system-survey.md) 字面指出 `src/platform/main/note/assemble-pm-doc.ts:128` 代码自陈"字面登记到 decision 026 §13 待补充",但 §13.1-13.8 实际未登记此条目。本节字面补登。

**(2026-05-28 拍板)**:
- tableRow 不是 atom(§3.1.2)
- row 边界信息通过 `tableCell.attrs.rowIndex`(0-based 整数)+ `tableCell.attrs.colIndex`(0-based 整数)表达(§6.1 新增段)
- assemble 端按 rowIndex 分组、组内按 colIndex 排序重建 tableRow 包裹(§6.1 算法 1-5 步)
- tableHeader 同款字面(rowIndex=0 字面对应表头行)
- table 是 atom,childOf 边目标存在(§3.1.1 / §3.1.4 / §3.4 / §6.1)

**实施位置**(留 5B):
- `src/drivers/text-editing-driver/blocks/table/spec.ts:76-85` tableNodeSpec 补 `attrs: { id: { default: null } }`
- `src/drivers/text-editing-driver/blocks/table/spec.ts` tableCell / tableHeader attrs 加 `rowIndex: { default: 0 }, colIndex: { default: 0 }`
- 3 处 STRUCTURAL_CONTAINER_TYPES 集合(`assemble-pm-doc.ts` / `build-auto-block-id-plugin.ts` / `atoms-to-pm.ts`)字面去掉 `'table'`(降为 5 项)
- `assemble-pm-doc.ts` wrapTableCells 改算法:按 rowIndex 分组(替代 v1 简化"全塞单 row")
- `dissect-pm-doc.ts` 当走到 PM tree 内 tableRow 时,对其 children 字面注入 `attrs.rowIndex / colIndex`(rowIndex 由 PM tree 内 tableRow 在 table 内的位置推导,colIndex 由 cell 在 tableRow 内的位置推导);table 字面生成 atom(走 shouldGenerateAtom = true 路径,因为 STRUCTURAL 集合已不含 table)
- `atoms-to-pm.ts` table case 适配:若契约入侧 `table.content.tiptapContent` 携带 tableRow / cell 嵌套子树,扁平化为顶层 table atom + 多个 cell atom(并写 rowIndex / colIndex);留 5B/5C 实施

**字面状态**: 不再是 Open Question,**是已拍板契约**。

### 13.10 DB 历史数据 migration(2026-05-28 新增 — 真正 Open Question,留独立 sub-phase)

**背景**: 当前 DB 内已存"裸顶层 tableCell"老数据(决议拍板 v1 简化的字面后果 — table 不是 atom 时 cells 通过 belongsToNote 直挂 container)。本 sub-phase 5A 拍板修订后,该形态字面与新决议不兼容。

**(2026-05-28 拍板)**: 本 sub-phase **不实施 migration**(用户已 `rm krig-data`,生产无老数据需要迁移)。

**未来若再遇老数据**(包括从老备份恢复 / 跨设备同步老快照 / 其他持久化通道引入),走独立 migration sub-phase:

1. 扫所有 `belongsToNote` 边的 tableCell / tableHeader 顶层 atom(无 childOf → table)
2. 按 nextSibling 链推断 row 边界(启发式:连续 cells 字面同属一行 — 字面下限是按 ULID 字典序兜底,字面上限是按 PDF 原始位置 / 用户原始输入位置)
3. 新建 table atom + 给各 cell 写 attrs.rowIndex / colIndex
4. 重新写 childOf 边(cell → table)
5. 删除原 cell 的"裸 belongsToNote 顶层"边(保留语义边)
6. 不可恢复字面登记: 启发式可能拼错 row 边界 → migration 日志字面保留所有 cell 原始 nextSibling 链,允许用户手工修正

**字面状态**: Open Question,留未来独立 sub-phase 启动时决议。**依赖**: 本 5A 拍板字面落地 + 5B 实施完成。

---

## 14. 后续工作指引

读者按顺序读:

1. **本决议(026)** — 知道 block 独立化的具体设计
2. **[`block-atomization-implementation-plan.md`](../../../stages/block-atomization-implementation-plan.md)** — 知道如何分阶段实施
3. 实施前再读 `feedback_decision_grep_verify_complete_propagation` memory,确认 6 层传播链 grep 完整性

---

*Decision 026 · v1.0 · 2026-05-21*
