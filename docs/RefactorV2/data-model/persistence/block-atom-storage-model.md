# Block Atom 存储模型可视化(L7 sub-phase 落地态)

> ⚠️ **结构模型已变更(Decision 028,2026-06-08)**:本文档描述的「3 条结构边
> (belongsToNote / childOf / nextSibling)表达归属/层级/顺序」**已被取代** —— 改用 block atom
> 属性 `noteId` / `parentId` / `order`(字典序 rank)表达,**三条结构边已删除**。
> assemble 改为 `listAtoms({ noteId })` + 按 parentId 建树 + order 排序,零边遍历。
> 详见 [Decision 028](decisions/028-block-structure-via-attrs.md)。本文 §2「三条边」部分仅作历史参考。
>
> **状态**:✅ 已实施(feature/L7-block-atomization,2026-05-21;结构边部分 028 已废止)
> **代码依据**:
>   - [`src/platform/main/note/capability-impl.ts`](../../../src/platform/main/note/capability-impl.ts) — createNote / getNote / updateNote / deleteNote
>   - [`src/platform/main/note/dissect-pm-doc.ts`](../../../src/platform/main/note/dissect-pm-doc.ts) — PM doc → atom + edge
>   - [`src/platform/main/note/assemble-pm-doc.ts`](../../../src/platform/main/note/assemble-pm-doc.ts) — atom + edge → PM doc
> **决议依据**:[decision 026](decisions/026-block-atomization-sub-phase-design.md)
>
> 本文档把 L7 sub-phase 落地后的 storage 模型用 **ASCII 图 + 真实例子** 完整画一遍,
> 给后续读者一个具象参照(不再去翻 14 节决议)。

---

## 0. 三个核心问题速答

| 问题 | 速答 |
|---|---|
| **每个 block 对应一个 atom 吗?** | 不完全。叶子 + 叶子级容器(22 类 NodeSpec)= 1 atom;结构性容器(6 类)= 0 atom |
| **文档结构(归属/层级/顺序)怎么表达?** | ~~3 条边~~ → **block atom 属性**(Decision 028):`noteId`(归属)+ `parentId`(层级)+ `order`(字典序排序)。**零结构边。** |
| **note atom 怎么建立?** | createNote 走 5 步:container atom + hasNoteView 边 + (inFolder 边) + dissect → applyDiff + cache |

详见 §1 / §2 / §3 全图。

---

## 1. block ↔ atom 对应关系(3 类 28 NodeSpec)

### 1.1 类别速查表

```
┌─────────────────────────────────────────────────────────────────────┐
│  PM NodeSpec(28 类 group='block'/'inline')                          │
├──────────────────────────────┬─────────┬────────────────────────────┤
│  类别                        │ 1 atom? │ 字面成员                   │
├──────────────────────────────┼─────────┼────────────────────────────┤
│  ① 叶子 block                │   ✅    │ paragraph / heading /       │
│     (纯内容,无嵌套)         │         │ horizontalRule /            │
│                              │         │ codeBlock / mathBlock /     │
│                              │         │ mathVisual / image /        │
│                              │         │ fileBlock /                 │
│                              │         │ audioBlock / videoBlock /   │
│                              │         │ htmlBlock / tweetBlock /    │
│                              │         │ externalRef / unknown       │
│                              │         │ (共 14 个)                  │
├──────────────────────────────┼─────────┼────────────────────────────┤
│  ② 叶子级容器                │   ✅    │ table * / listItem /        │
│     (用户会单独标注/引用    │         │ taskItem / tableCell /      │
│      的容器)                │         │ tableHeader / callout /     │
│                              │         │ blockquote / column /       │
│                              │         │ toggleList                  │
│                              │         │ (共 9 个)                   │
│                              │         │ * table 2026-05-28 5A 修订   │
│                              │         │ 从 ③ 上移(详 §1.3)          │
├──────────────────────────────┼─────────┼────────────────────────────┤
│  ③ 结构性容器                │   ❌    │ tableRow / bulletList /     │
│     (用户不单独引用,        │   0 atom│ orderedList / taskList /    │
│      纯 PM 结构骨架)        │   跳过  │ columnList                  │
│                              │         │ (共 5 个)                   │
│                              │         │ ⚠ 5A 修订: table 不再属于   │
│                              │         │  本类(已上移到 ②)           │
├──────────────────────────────┼─────────┼────────────────────────────┤
│  ④ inline 节点               │   ❌    │ text / hardBreak /          │
│     (atom 内 PM JSON 一部分)│         │ fileLink(inline)/          │
│                              │         │ noteLink / mathInline       │
│                              │         │ (共 5 个,嵌在 ①/② 的     │
│                              │         │  payload.content 内)       │
└──────────────────────────────┴─────────┴────────────────────────────┘
```

### 1.2 字面识别机制([dissect-pm-doc.ts:49](../../../src/platform/main/note/dissect-pm-doc.ts#L49))

```ts
// 2026-05-28 5B Stage 1-2 收敛:STRUCTURAL_CONTAINER_TYPES 集中到 semantic 层单点 export,
// 五处消费方 import 不重定义(详 5B 设计 §7.3.1).
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';

// (semantic/types/structural.ts:23 字面定义 5 项 — 不含 'table',5A 修订)
export const STRUCTURAL_CONTAINER_TYPES = new Set<string>([
  'tableRow',
  'bulletList',
  'orderedList',
  'taskList',
  'columnList',
]);

function shouldGenerateAtom(node: PmPayload): boolean {
  if (STRUCTURAL_CONTAINER_TYPES.has(node.type)) return false;
  if (node.attrs === undefined) return false;
  return 'id' in node.attrs;   // ← Stage 1 给 22 NodeSpec 加了 attrs.id 字段(table 含)
}
```

**字面判定**:
- 命中 `STRUCTURAL_CONTAINER_TYPES` → 跳过,**0 atom**
- 没有 `attrs` 或 `attrs` 内无 `id` 字段(inline 节点)→ 跳过
- 其它(22 NodeSpec)→ **1 atom**

### 1.3 5A 修订 — table 上移为 atom(2026-05-28)

decision 026 §3 原拍板"table 不拆 atom",2026-05-28 5A 修订**字面撤销**该字面,
table 字面上移为叶子级容器(②),走 atom 化路径:

| 修订前(decision 026 原稿) | 修订后(5A 字面拍板) |
|---|---|
| table 字面属于 ③ 结构性容器 | table 字面属于 ② 叶子级容器,1 atom |
| STRUCTURAL_CONTAINER_TYPES 6 项含 'table' | **5 项** {tableRow, bulletList, orderedList, taskList, columnList},**不含 'table'** |
| tableCell.childOf → table 父字面无目标 | tableCell.childOf → table atom(目标字面存在) |
| 表格定位走 PM tree 嵌套 | tableCell.attrs.rowIndex / colIndex (0-based) 字面承载(详 §6.1)|

字面理由(5A §6.1):
- table **整表用户单独引用语义存在**(拖动、跨表引用、编辑表格属性)
- 与生产 PDF-Note-Atom 契约 §4.7 字面对齐(契约顶层 atom 字面有 table)
- tableCell.childOf 字面有目标可指(跨过 tableRow 中间层)

实施在 5B Stage 1-4 字面落地:
- Stage 1: tableNodeSpec.attrs.id + tableCell/Header.rowIndex/colIndex 加字段
- Stage 2: STRUCTURAL_CONTAINER_TYPES 五处消费方 import 收敛到 @semantic/types/structural
- Stage 3: dissect 期 rowIndex/colIndex 注入(Q2 选项 B)
- Stage 4: assemble 端 assembleTable 算法 + STRUCTURAL_REBUILD_RULES 注册式

→ 详 [decision 026 §3.1 修订附记](decisions/026-block-atomization-sub-phase-design.md) +
  [5A 拍板汇总](../../../tasks/2026-05-28-stage-5A-decision-026-amendment-summary.md)。

---

## 2. 三条边的职责分离

### 2.1 `user:krig:belongsToNote` — 归属边

> "我属于哪个 note?"

**规则**:每个 block atom **正好 1 条 outgoing**,object 永远指向 **note container atom**,**不管嵌套多深**。

```
所有 block 都直接挂 container,层级关系**完全扁平化**:

  ┌──────────────────────────────┐
  │   note container (空 doc)    │ ← payload = { type:'doc', content:[] }
  └──────────────────────────────┘
         ▲    ▲     ▲     ▲     ▲
         │    │     │     │     │
       belongsToNote (每 block 各 1 条)
         │    │     │     │     │
    ┌────┴┐ ┌─┴──┐ ┌┴───┐ ┌┴───┐ ┌┴────┐
    │ A  │ │ B  │ │ C  │ │ D  │ │ E   │
    │顶层│ │顶层│ │嵌套│ │嵌套│ │更深 │
    └────┘ └────┘ └────┘ └────┘ └─────┘
```

**为什么扁平**?── 让 `listEdges(belongsToNote, object=noteId)` **一次查询**拿到整篇 note 的全部 block atom,O(1) 复杂度。嵌套关系另外用 childOf 边表达,职责分离。

### 2.2 `user:krig:childOf` — 嵌套边

> "我嵌在哪个容器 atom 里?"

**规则**:**只在嵌套时生成**(顶层 block 无 childOf),object 指向**最近的"非结构性"祖先 atom**。

```
PM tree 嵌套结构:                  storage childOf 边:

  doc                              (顶层 D 无 childOf,顶层 T 无 childOf)
  ├─ paragraph D ────────────────  D: 无 childOf
  ├─ bulletList            <-- 结构性容器,0 atom -->
  │  ├─ listItem L1 ─────────────  L1: 无 childOf(bulletList 跳过 → 直挂顶层)
  │  │  └─ paragraph P1 ─────────  P1.childOf → L1
  │  └─ listItem L2 ─────────────  L2: 无 childOf
  │     └─ paragraph P2 ─────────  P2.childOf → L2
  ├─ table T ────────────────────  T: 无 childOf
  │  └─ tableRow R         <-- 结构性容器,0 atom -->
  │     ├─ tableCell C1 ─────────  C1.childOf → T(跨过 tableRow 跳层!)
  │     │  └─ paragraph PC1 ─────  PC1.childOf → C1
  │     └─ tableCell C2 ─────────  C2.childOf → T
  │        └─ paragraph PC2 ─────  PC2.childOf → C2
  └─ callout K ──────────────────  K: 无 childOf
     └─ paragraph PK ────────────  PK.childOf → K
```

**字面跨层跳过机制**([dissect-pm-doc.ts:107-145](../../../src/platform/main/note/dissect-pm-doc.ts#L107)):
- 递归下行时遇到结构性容器(bulletList / tableRow 等),把其 children **直接提升一层**给祖先处理
- 所以 `tableCell.childOf` 字面指向 `table atom` 而不是 `tableRow`(tableRow 0 atom 不存在)
- 同理 `listItem.childOf` 字面指向**外层最近的非结构性父**(顶层 listItem 字面无 childOf,因为它直挂 note container — 而 container 不算 childOf 的合法 object)

### 2.3 `user:krig:nextSibling` — 顺序边

> "我后面紧跟着谁?"

**规则**:**同一父下的兄弟**之间拉单向链表,每个 atom 字面**最多 1 outgoing + 1 incoming**。

```
PM tree 顺序:                      storage nextSibling 链(分组建链):

  doc                              顶层链:    D → T → K
  ├─ paragraph D                              (3 条 atom 在 doc 顶层)
  ├─ table T                       
  │  ├─ tableCell C1               table T 内链:  C1 → C2
  │  └─ tableCell C2                            (跨过 tableRow,T 内 sibling = cell 列表)
  └─ callout K                     
     ├─ paragraph PK1              callout K 内链: PK1 → PK2
     └─ paragraph PK2              
                                   C1 内链:       PC1(单 child 无链)
                                   C2 内链:       PC2(单 child 无链)
```

**字面意图**:
- nextSibling 链 + childOf 边一起 → 拓扑还原原 PM doc 的**顺序 + 嵌套**
- 同层 sibling 各自独立成链;**跨层 atom 之间字面不互相牵手**
- 第一个 sibling 无 incoming,最后一个 sibling 无 outgoing

---

## 3. note atom 创建流程(createNote 5 步)

[capability-impl.ts:140-185](../../../src/platform/main/note/capability-impl.ts#L140) 字面流程:

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: putAtom container atom                                 │
│  ──────────────────────────────────────────────                 │
│  payload = { type:'doc', content:[] }   ← 永远是空 doc          │
│  storage 字面生成 ULID → 这就是 noteId                          │
│                                                                 │
│  ⚠ container atom 不装任何内容,只是"挂边的锚点"                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: putEdge hasNoteView                                    │
│  ──────────────────────────────────────────────                 │
│  predicate: user:krig:hasNoteView                               │
│  subject:   { kind:'atom', atomId: noteId }                     │
│  object:    { kind:'literal', type:'boolean', value: true }     │
│                                                                 │
│  这是 marker 边,告诉 listNotes "此 pm atom 字面是 note 容器"   │
│  (区分于 graph text-node 的 pm atom,那个没 hasNoteView 边)    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 3(可选): putEdge inFolder                                 │
│  ──────────────────────────────────────────────                 │
│  若 createNote(_, folderId) 传了 folderId:                      │
│    predicate: user:krig:inFolder                                │
│    subject:   { kind:'atom', atomId: noteId }                   │
│    object:    { kind:'atom', atomId: folderId }                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: dissectPmDoc → fullCreateDiff → applyDiff              │
│  ──────────────────────────────────────────────                 │
│  initialDoc 字面拆解为:                                          │
│    blocks[]:           N 个 block atom payload                  │
│    belongsEdges[]:     N 条边(每 block → noteId)              │
│    nextSiblingEdges[]: N-1 条边(顶层 sibling 链)              │
│    childOfEdges[]:     M 条边(嵌套 block)                     │
│                                                                 │
│  全部包在 storage.transaction(原子写入):                       │
│    for atom: tx.putAtom(...)                                    │
│    for edge: tx.putEdge(...)                                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 5: pmDocCache.set(noteId, docWithIds)                     │
│  ──────────────────────────────────────────────                 │
│  in-memory cache(Map<atomId, PmPayload>)                       │
│  后续 getNote(noteId) 字面 O(1) 命中,绕开 assemble             │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                返回 NoteInfo { id, doc, folderId, ... }
```

---

## 4. 完整存储 snapshot 三例

### 4.1 简单 note(2 段 paragraph)

**用户在 NoteView 看见**:

```
hello
world
```

**storage 实际存了什么**:

```
─────────────────── atom 表(3 行) ───────────────────
ulid-CONTAINER  payload.domain = 'pm'
                payload.payload = { type:'doc', content:[] }
                                          ↑ 注意!永远是空

ulid-P1         payload.domain = 'pm'
                payload.payload = {
                  type: 'paragraph',
                  attrs: { id: 'ulid-P1', isTitle: true, indent: 0, bookAnchor: null },
                  content: [ { type:'text', text:'hello' } ]
                }

ulid-P2         payload.domain = 'pm'
                payload.payload = {
                  type: 'paragraph',
                  attrs: { id: 'ulid-P2', isTitle: false, indent: 0, bookAnchor: null },
                  content: [ { type:'text', text:'world' } ]
                }

─────────────────── edge 表(4 行) ───────────────────
hasNoteView    subj=ulid-CONTAINER  obj=literal(true)
belongsToNote  subj=ulid-P1         obj=ulid-CONTAINER
belongsToNote  subj=ulid-P2         obj=ulid-CONTAINER
nextSibling    subj=ulid-P1         obj=ulid-P2
```

**字面观察**:
- 3 atom + 4 edge(P1/P2 各 1 条 belongsToNote + 1 条 nextSibling + 1 条 hasNoteView marker)
- container atom payload 字面空 doc,所有内容都在 P1/P2 自己的 payload 里
- 没有 childOf 边(无嵌套)

### 4.2 含 callout 嵌套

**用户看见**:

```
段落 A
[Callout: ❓ 重要]
  段落 B
段落 C
```

**storage**:

```
─────────────────── atom 表(5 行) ───────────────────
ulid-CONTAINER   payload = { type:'doc', content:[] }
ulid-A           payload = { type:'paragraph', attrs:{ id:'ulid-A', ... }, content:[{type:'text',text:'段落 A'}] }
ulid-K           payload = { type:'callout',   attrs:{ id:'ulid-K', emoji:'❓', ... }, content:[] }
                                                                                    ↑ 容器型,content 永远空
ulid-B           payload = { type:'paragraph', attrs:{ id:'ulid-B', ... }, content:[{type:'text',text:'段落 B'}] }
ulid-C           payload = { type:'paragraph', attrs:{ id:'ulid-C', ... }, content:[{type:'text',text:'段落 C'}] }

─────────────────── edge 表(8 行) ───────────────────
hasNoteView    subj=ulid-CONTAINER  obj=literal(true)

belongsToNote  subj=ulid-A          obj=ulid-CONTAINER   ┐
belongsToNote  subj=ulid-K          obj=ulid-CONTAINER   │ 4 条都直挂 container
belongsToNote  subj=ulid-B          obj=ulid-CONTAINER   │ (扁平化!)
belongsToNote  subj=ulid-C          obj=ulid-CONTAINER   ┘

childOf        subj=ulid-B          obj=ulid-K            ← B 嵌在 K 里

nextSibling    subj=ulid-A          obj=ulid-K            ┐ 顶层链:A → K → C
nextSibling    subj=ulid-K          obj=ulid-C            ┘
                                                          (B 在 K 内单 child,无 nextSibling)
```

**字面观察**:
- 5 atom + 8 edge
- B 同时有 belongsToNote(扁平,挂 container)和 childOf(嵌套,挂 K)
- A 和 C 通过 nextSibling 经过 K **跳过 B**(因 B 不在顶层 sibling 链)
- K 是叶子级容器,**payload.content 永远空**,内部 paragraph 由 childOf 边重建

### 4.3 含 table(展示结构性容器跳层)

**用户看见**:

```
┌──────┬──────┐
│ cell1│ cell2│
├──────┼──────┤
│ cell3│ cell4│
└──────┴──────┘
```

**PM doc 树结构**:`doc > table > tableRow > tableCell > paragraph`(4 层)

**storage**:

```
─────────────────── atom 表(9 行) ───────────────────
ulid-CONTAINER  payload = { type:'doc', content:[] }
ulid-T          payload = { type:'table', attrs:{ id:'ulid-T', ... }, content:[] }
ulid-C1         payload = { type:'tableCell', attrs:{ id:'ulid-C1', ... }, content:[] }
ulid-C2         payload = { type:'tableCell', attrs:{ id:'ulid-C2', ... }, content:[] }
ulid-C3         payload = { type:'tableCell', attrs:{ id:'ulid-C3', ... }, content:[] }
ulid-C4         payload = { type:'tableCell', attrs:{ id:'ulid-C4', ... }, content:[] }
ulid-P1         payload = { type:'paragraph', attrs:{ id:'ulid-P1', ... }, content:[{type:'text',text:'cell1'}] }
ulid-P2         payload = { type:'paragraph', attrs:{ id:'ulid-P2', ... }, content:[{type:'text',text:'cell2'}] }
ulid-P3..P4     (同 P1/P2 模式)

                ⚠ tableRow 字面 0 atom — 字面被跳过!

─────────────────── edge 表(16 行) ───────────────────
hasNoteView    subj=ulid-CONTAINER  obj=literal(true)

belongsToNote  subj=ulid-T          obj=ulid-CONTAINER
belongsToNote  subj=ulid-C1         obj=ulid-CONTAINER   ┐
belongsToNote  subj=ulid-C2         obj=ulid-CONTAINER   │ 全部直挂 container
belongsToNote  subj=ulid-C3         obj=ulid-CONTAINER   │ (tableRow 不存在,
belongsToNote  subj=ulid-C4         obj=ulid-CONTAINER   │  cells/paragraphs
belongsToNote  subj=ulid-P1         obj=ulid-CONTAINER   │  都跟 table 平级
belongsToNote  subj=ulid-P2         obj=ulid-CONTAINER   │  挂 container)
belongsToNote  subj=ulid-P3         obj=ulid-CONTAINER   │
belongsToNote  subj=ulid-P4         obj=ulid-CONTAINER   ┘

childOf        subj=ulid-C1         obj=ulid-T   ← ⚠ 跨过 tableRow!cell.childOf 直接指 table
childOf        subj=ulid-C2         obj=ulid-T
childOf        subj=ulid-C3         obj=ulid-T
childOf        subj=ulid-C4         obj=ulid-T
childOf        subj=ulid-P1         obj=ulid-C1   ← cell 内 paragraph 挂 cell
childOf        subj=ulid-P2         obj=ulid-C2
childOf        subj=ulid-P3         obj=ulid-C3
childOf        subj=ulid-P4         obj=ulid-C4

nextSibling    subj=ulid-C1         obj=ulid-C2   ┐ table 内 cell 链(4 cell 拉一条线)
nextSibling    subj=ulid-C2         obj=ulid-C3   │ ⚠ 跨 row 拉链(因 row 不存在)
nextSibling    subj=ulid-C3         obj=ulid-C4   ┘
```

**字面观察**:
- 9 atom(0 个 tableRow!即使原 PM tree 字面 4 层)+ 16 edge
- tableRow **完全不存在于 storage**,assemble 时由代码硬编码规则重建
- `nextSibling: C1→C2→C3→C4` 字面**跨 row 拉成一条线**,assemble 时按 2 列字面切回 [C1,C2] / [C3,C4] 两行

---

## 5. assemble(读时拼装)的反向逻辑

[assemble-pm-doc.ts](../../../src/platform/main/note/assemble-pm-doc.ts) 把上面 storage 状态**还原回**完整 PM doc:

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: listEdges(belongsToNote, object=noteId)               │
│         → 拿到此 note 全部 block atom id                       │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: batch getAtom(每个 block id)                          │
│         → 拿到 N 个 block atom 的 payload                      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 3: listEdges(childOf, subject 在 block ids 范围内)       │
│         → 拼出嵌套树(谁挂谁)                                  │
│  Step 4: listEdges(nextSibling, subject 在 block ids 范围内)   │
│         → 拼出顺序链(同层 sibling 的链表)                     │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 5: 拓扑排序 + 跨层 wrapper 重建                          │
│  ──────────────────────────────────────────────                 │
│  - 按 childOf 分组:每个父 atom 字面持有自己的 children 列表    │
│  - 按 nextSibling 在每组内排序                                  │
│  - 遇 listItem → 字面套 bulletList/orderedList wrapper          │
│  - 遇 tableCell → 字面按 cell 在 table 内排列分组到 tableRow    │
│  - 遇 column → 字面套 columnList wrapper                        │
│  - 重建后得到完整 PM doc tree                                   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                返回完整 PmPayload(type='doc', content=[...])
```

**字面**结构性容器的复活规则在 [assemble-pm-doc.ts](../../../src/platform/main/note/assemble-pm-doc.ts) 字面 `wrapChildren` / `buildPmNode` 函数,硬编码 3 种重建模式:

| storage 现状 | assemble 字面重建 |
|---|---|
| listItem 字面带 `_assemblyHints.listType='bullet'` | 套 `bulletList > listItem` |
| listItem 字面带 `_assemblyHints.listType='ordered'` | 套 `orderedList > listItem` |
| tableCell / tableHeader 字面挂同一 table 父 | 按位置切组,套 `tableRow > tableCell` |
| column 字面挂同一 container | 套 `columnList > column` |

---

## 6. 关键设计观察(背后哲学)

### 6.1 container atom 是"骨架",不装内容

```
container atom.payload = { type:'doc', content:[] }   ← 字面永远空
```

字面**所有内容都在 block atom 里**,container 只为以下两点存在:
1. 被 `hasNoteView` 边标记(让 listNotes 知道哪些 pm atom 是 note 容器)
2. 被 `belongsToNote` 边指向(让 listEdges 一次查全篇 block)

### 6.2 结构性容器是"虚的"(5A 修订后 5 类)

tableRow / bulletList / orderedList / taskList / columnList 这 **5 类**
字面**在 storage 里完全不存在**(0 atom),只在 PM 渲染时由 assemble 字面**临时
重建**包裹层。这是 sub-phase 的**最大简化**(决议 026 §3.1.2):
- 大幅减少 atom + 边数量(100×10 table 字面省 100 个 tableRow atom + 100 条 childOf)
- 用户语义层从不引用"第 3 行整行",所以 tableRow 不需要 ID
- 代价:assemble 时需硬编码重建规则(5B Stage 4 实施: 4 种 STRUCTURAL_REBUILD_RULES
  + assembleTable 独立路径,详 §1.3 / [@semantic/types/structural](../../../src/semantic/types/structural.ts) 单点)

**2026-05-28 5A 修订**: `table` 字面**从本集合移除**,上升为叶子级容器(② 1 atom)。
理由: table 整表用户单独引用语义存在(拖动 / 跨表引用 / 编辑表格属性) + 与生产
PDF-Note-Atom 契约 §4.7 顶层 atom 字面对齐。详 §1.3。

### 6.3 belongsToNote 扁平 + childOf 嵌套 — 职责分离

```
belongsToNote 解决: "这个 block 属于哪个 note?"     → 扁平,全挂 container
childOf       解决: "这个 block 嵌在哪个 block 里?" → 嵌套,挂最近非结构祖先
nextSibling   解决: "这个 block 后面跟着谁?"        → 同层兄弟拉链
```

字面**3 条边互不重叠**,各管一件事。listNotes 用 belongsToNote 一查到底;
渲染嵌套用 childOf;渲染顺序用 nextSibling。

### 6.4 reading-thought 复用同一模型

字面 D-10([deviations 日志](../../notes/block-atomization-deviations-2026-05-21.md))拍板:
ebook 的 reading-thought 也是个 pm container atom(payload 字面空 doc),
只是**没有 hasNoteView 边**,而是被 `hasReadingThought` 边指向。
block atom 模型字面**完全复用**(同一份 assemble / dissect / diff 代码),
仅 container 身份 marker 不同。

---

## 7. 相关代码索引

| 文件 | 字面职责 |
|---|---|
| [`src/platform/main/note/capability-impl.ts`](../../../src/platform/main/note/capability-impl.ts) | createNote / getNote / updateNote / deleteNote 主流程 |
| [`src/platform/main/note/assemble-pm-doc.ts`](../../../src/platform/main/note/assemble-pm-doc.ts) | atom + edge → PM doc(读时拼装 + 跨层 wrapper 重建) |
| [`src/platform/main/note/dissect-pm-doc.ts`](../../../src/platform/main/note/dissect-pm-doc.ts) | PM doc → atom + edge(写时拆解 + 跨层跳过) |
| [`src/platform/main/note/diff-block-tree.ts`](../../../src/platform/main/note/diff-block-tree.ts) | oldDoc vs newDoc → added/modified/removed/edges 增量 |
| [`src/platform/main/note/pm-doc-cache.ts`](../../../src/platform/main/note/pm-doc-cache.ts) | 进程内 in-memory cache |
| [`src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts`](../../../src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts) | PM appendTransaction 注 ULID + 去重(split/paste) |

---

## 8. 相关决议 / 文档索引

- [decision 025](decisions/) — 工程妥协承接(v1.3 → block 独立化)
- [decision 026](decisions/026-block-atomization-sub-phase-design.md) — 核心设计(14 节)
- [实施计划](../../stages/block-atomization-implementation-plan.md) — 9 Stage 任务设计
- [完成报告](../../notes/block-atomization-completion-report-2026-05-21.md) — 实施落地态
- [偏离日志](../../notes/block-atomization-deviations-2026-05-21.md) — D-01 至 D-15
- [relations/spec.md §10](../relations/spec.md) — 3 个新 predicate 登记

---

*Block Atom Storage Model · 2026-05-21*
