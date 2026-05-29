# 阶段 5C:paste 跨 note id 共享 bug 修复设计

> 阶段日期:2026-05-28 · main HEAD:`e201b8e6`
> 输入文档:[`2026-05-28-stage-5C-paste-id-regen-design-prompt.md`](2026-05-28-stage-5C-paste-id-regen-design-prompt.md) · [`2026-05-28-stage-5B-import-converter-design.md`](2026-05-28-stage-5B-import-converter-design.md) · [`2026-05-28-stage-5A-decision-026-amendment-summary.md`](2026-05-28-stage-5A-decision-026-amendment-summary.md) · [`2026-05-28-import-system-survey.md`](2026-05-28-import-system-survey.md) · 决议 026 修订版
> 产出:小范围 bug 修复设计;不实施代码、不改决议、不动 src/、不连 DB
> 5A/5B 拍板对齐:STRUCTURAL 5 项 `{tableRow, bulletList, orderedList, taskList, columnList}` 单点 export(5B §7.3.1)/ table 是 atom(5A)/ atom 与 PM doc 脱钩(5B §7.1.2)/ paste 不进 ingest pipeline(5B §6.1)

---

## 节 0:本期设计边界

- **不实施代码**;产出是设计文档,代码实施留下游 sub-phase(`refactor/import-system-rebuild` 分支)。
- **本期范围**:调研报告 §7.4 第 10 题 — **paste 跨 note id 共享 bug 修复**。
- **不涉及** 5B 的 content-ingest capability / batch API / 契约扩展。
- **不解决**调研报告 §6.4 一般性"inject 层 / PM plugin 双轨"问题(那留更远 sub-phase)。本期**只解 paste 入口**。
- **paste 入口与 5B ingest pipeline 字面隔离**:沿 5B §6.1 拍板 — paste 仍走原 `createNote` 单条 + 不进 `content-ingest.markdownToAtoms` / `krigBatchToAtoms` 路径。

---

## 节 1:bug 复述与影响面

### 1.1 触发链(字面源码引用)

```
用户操作:NavSide 复制 note "A" → 粘贴到同 folder
  ↓
[src/views/note/tree-operations.ts:172 pasteNote]
  ├─ noteCap().listNotes() 拿源 doc(已 assemble 含原 ULID)
  ├─ JSON.parse(JSON.stringify(src.doc))   ← 深拷贝(含全部 attrs.id)
  └─ noteCap().createNote(docCopy, targetFolderId)
  ↓
[src/platform/main/note/capability-impl.ts:162 createNote]
  ├─ injectIdsForCreate(pmDoc)
  │    [capability-impl.ts:250-278]
  │    字面规则:`if (!out.attrs.id) out.attrs.id = generateUlid()`
  │    源 doc 字面已带 ULID → 不触发新 ULID 注入
  ├─ fullCreateDiff(docWithIds, containerAtom.id)
  │    [diff-block-tree.ts:163] → dissectPmDoc(containerId, doc)
  │    [dissect-pm-doc.ts:126]:`const id = (child.attrs?.id) ?? null`
  │    blocks.push({ id: <源 ULID>, payload })
  └─ applyDiff(diff, tx)
       [capability-impl.ts:132-140]:
         tx.putAtom<'pm'>({ id: <源 ULID>, payload })
                        ↑ 显式传 id(decision 026 §4.1)
       [transaction-helpers.ts:58-71]:
         id 已存在 → `UPSERT $rid SET ... payload = $payload RETURN AFTER`
         字面**不抛错**,字面覆盖 payload + touch updatedAt
```

### 1.2 storage 层 + cardinality 层的实际后果(事前调研结论)

> 不"实施时验证"。下列结论字面源自源码检查 + 健康检查 grep。

**(a) atom UPSERT 字面不冲突**

[`transaction-helpers.ts:58-71`](../../src/storage/surreal/transaction-helpers.ts#L58) putAtom 字面 UPSERT 语义:`input.id` 存在 → `UPSERT $rid SET payload=$payload`。源 ULID atom 已在 DB 内 → 字面**覆盖** payload(paste 出的 docCopy payload 与源 doc 字面相同,覆盖无感知);`updatedAt` 字面 touch 为 now;`createdAt = createdAt OR $now` 字面保留原值。

**(b) belongsToNote 1:1 cardinality 字面违反(原子 ABC 同时挂源 note + 新 note 两条边)**

[`dissect-pm-doc.ts:171`](../../src/platform/main/note/dissect-pm-doc.ts#L171) 字面给每 block 加 `belongsToNote(subject=blockId, object=containerId)` 边。源 note `containerId=NoteX` 已有边 `(ABC → NoteX)`;paste 走 createNote 字面新 `containerId=NoteY`,字面新建边 `(ABC → NoteY)`。新边不删旧边 → 字面同一 ABC 挂 2 条 outgoing belongsToNote。

**cardinality-check 字面登记**([`cardinality-check.ts:108-109`](../../src/storage/health/cardinality-check.ts#L108)):
```ts
// belongsToNote: 每 block 字面 1 条 outgoing → 多条字面违反(数据可能 dup-id 残留)
{ predicate: 'user:krig:belongsToNote', cardinality: '1:1' as const },
```
属于 `CARDINALITY_SCAN_PREDICATES`(scan-and-warn,**不自愈**;[`cardinality-check.ts:132-155`](../../src/storage/health/cardinality-check.ts#L132) `scanCardinality`)。即:**启动期字面会 warn 一行**(`CARDINALITY_VIOLATION_ONE_TO_ONE user:krig:belongsToNote subject ABC: 2 edges`),但**不阻塞启动 / 不自动清理**。用户不看 main 进程 terminal 不会发现。

**(c) childOf 0..1 字面违反(同模式)**

容器块(含嵌套 listItem / callout / blockquote / table cell)字面挂 `childOf(blockId → parentAtomId)` 边([`dissect-pm-doc.ts:174-176`](../../src/platform/main/note/dissect-pm-doc.ts#L174))。源 note 嵌套块 "DEF" 字面挂 `(DEF → ABC)`;paste 字面新挂 `(DEF → ABC)` — **predicate / subject / object 字面三元组完全相同**,storage 层 putEdge 走 [`storage.ts`] 无 UPSERT(检查源码:每次 putEdge 字面生成新 edge.id),故 **DB 内字面有 2 条相同三元组的 childOf 边**。`cardinality-check.ts:111` 字面 scan-and-warn 同处理。

**(d) nextSibling ≤1 出 / ≤1 入 字面违反**

[`cardinality-check.ts:176-227`](../../src/storage/health/cardinality-check.ts#L176) `scanNextSiblingCardinality` 字面扫 outgoing / incoming 双向 ≤1。paste 字面给同一 atom ABC 在新 note 内新挂 `(ABC → DEF)` nextSibling 边 → 同 atom 字面挂 2 条 outgoing(源 note 的旧边仍在)。同处理:warn 不自愈。

**(e) assemble 字面双拼**

[`assemble-pm-doc.ts:302 assemblePmDoc(containerId)`](../../src/platform/main/note/assemble-pm-doc.ts#L302) 字面拉 `listEdges({ predicate: belongsToNote, object: containerId })` → 对 NoteX 字面拉到 ABC + DEF(因为旧边仍指向 NoteX);对 NoteY 同样拉到 ABC + DEF(新边)。**两 note assemble 出的 PM doc 字面共享同样的 ABC 内容**。表面看"复制正确",但底层是引用同一 atom 行 — 用户在 NoteY 上编辑改 ABC payload → [`capability-impl.ts:449 applyDiff`](../../src/platform/main/note/capability-impl.ts#L449) modified 路径走 `tx.putAtom<'pm'>({ id: ABC, payload: <新内容> })` UPSERT → **源 note NoteX 的 ABC 字面同步被改**。**字面是用户感知最直接的数据腐蚀路径**。

**(f) deleteNote 级联灾难**

[`capability-impl.ts:497`](../../src/platform/main/note/capability-impl.ts#L497) deleteNote 字面"先删所有 block atom (by belongsToNote.object=id)"。删 NoteX → `listEdges({ belongsToNote, object: NoteX })` → 命中 ABC + DEF → `tx.deleteAtom(ABC)` 字面级联删 ABC 的所有 edges(含 ABC → NoteY 那条 belongsToNote!)→ NoteY assemble 时 ABC 字面消失。**删源 note 字面静默删空 paste 出来的副本的"共享"块**。

**(g) edge 表索引膨胀 + 启动 warn 噪声**

cardinality-check 每次启动字面扫全部 belongsToNote / childOf / nextSibling → 字面打 N 行 warn。用户重复 paste 操作 → 累积成噪声日志。

### 1.3 影响入口列举

| 入口 | 文件 行号 | 是否受影响 |
|---|---|---|
| **pasteNote(单 note paste)** | [`tree-operations.ts:172-184`](../../src/views/note/tree-operations.ts#L172) | ✓ 主受害者(`createNote(docCopy)` 直接触发) |
| **pasteFolderTree(folder 树递归 paste)** | [`tree-operations.ts:218-245`](../../src/views/note/tree-operations.ts#L218) | ✓ 同模式(`createNote(docCopy)` 循环触发 + 跨子 folder 累积) |
| markdown / word import | [`markdown-import.ts:526`](../../src/views/note/markdown-import.ts#L526) | ✗ 源 PM doc 字面无 id(md-to-pm 不写 attrs.id)→ injectIdsForCreate 字面注入新 ULID → 不会共享 |
| extraction(KRIG_IMPORT) | [`extraction-import.ts`](../../src/views/note/extraction-import.ts) | ✗ atoms-to-pm 出口字面走 `ensureBlockAttrIdField` 占位 id:null + inject 补,id 字面全新 |
| 用户编辑 updateNote | [`capability-impl.ts:418`](../../src/platform/main/note/capability-impl.ts#L418) | ✗ updateNote 字面同 containerId 内操作,无 id 跨 note 共享场景 |
| ebook addReadingThoughtBlock | 走 updateNote 单 thought 容器 | ✗ 手工 generateUlid |
| backup-restore | 行级快照 | ✗ 不经契约转换,1:1 还原 |
| createEmptyDoc + createNote | [`capability-impl.ts:162`](../../src/platform/main/note/capability-impl.ts#L162) | ✗ initialDoc=null 走 emptyNoteDoc(),首段无 id 字面被 inject 补 |

**结论**:**只有 paste 路径(pasteNote / pasteFolderTree)字面命中**;其它入口字面安全。

### 1.4 为什么 buildAutoBlockIdPlugin 在 paste 路径不生效

[`build-auto-block-id-plugin.ts:94-142`](../../src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts#L94) 字面**只在 PM editor 内部生效**(`appendTransaction` 拦截 PM tr,见 plugin 注释 line 35 "PM paste 字面把 clipboard 内的 PM JSON ... 插回 doc")。

paste 走的是**完全不同的路径**:NavSide 复制 → `tree-operations.ts:180` 字面 `JSON.parse(JSON.stringify(src.doc))` 内存深拷贝 → 直接 IPC 调 `noteCap.createNote(docCopy)` → main 进程 createNote → dissect → diff → putAtom。**全程不过 PM editor**,plugin 字面无法拦截。

调研报告 §6.4 字面登记的"inject 层(capability)与 PM plugin 双轨"反模式,paste bug 是双轨字面失效的直接证据:plugin 的重复检测(seen Set)不在 capability 路径,capability `injectIdsForCreate` 的去重逻辑字面**只覆盖"id 为 null"**(line 271 `if (!out.attrs.id)`),**不覆盖"已带 id 但跨 note 共享"**。

字面修法定位:在 capability 入口(paste)新增一层"force-regen"。详节 2。

---

## 节 2:修复方案设计

### 2.1 新增 `regenerateIdsForPaste(doc)` 函数

**实施位置建议**:`src/platform/main/note/regenerate-ids-for-paste.ts`(新文件,与 `capability-impl.ts` / `dissect-pm-doc.ts` 同目录 — 字面属于 note capability 内部 helper,不外露)。

**签名**:

```ts
import type { PmPayload } from '@semantic/types';
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural'; // 5B Stage 1-2 产物
import { generateUlid } from '@shared/ulid';

/**
 * paste 路径专用 — 递归遍历 PM doc,**无条件**给所有非结构性容器 block
 * 生成新 ULID 覆盖 attrs.id,确保 paste 出的新 note 字面不与源 note 共享
 * 任何 block atom id。
 *
 * 字面规则(对齐 decision 026 §5.2 "粘贴全部生成新 id"):
 * - STRUCTURAL_CONTAINER_TYPES(5 项)字面跳过(对齐 dissect 跳层规则)
 * - inline 节点(无 attrs / 无 attrs.id 字段)字面跳过
 * - 其它字面节点:无条件覆盖 attrs.id = generateUlid()
 *   (与 injectIdsForCreate 的"if (!attrs.id)" 字面区别:本函数无条件覆盖)
 * - table cell 的 rowIndex / colIndex 字面**不变**(5A §6.1 / 5B Q2 — rowIndex
 *   作为派生信息由 dissect 期重算;paste 路径走 dissect 路径会重算,本函数不动)
 *
 * @returns 新 doc 副本(字面不可变,不动入参 doc)
 */
export function regenerateIdsForPaste(doc: PmPayload): PmPayload;
```

**算法字面伪代码**(visit 递归):

```
visit(node):
  out = { type: node.type, ...浅拷贝 attrs/marks/text, content = node.content?.map(visit) }
  if STRUCTURAL_CONTAINER_TYPES.has(node.type): return out        # 字面跳过结构性容器
  if !out.attrs || !('id' in out.attrs): return out               # 字面跳过 inline
  out.attrs.id = generateUlid()                                    # 其它:**无条件**覆盖
  return out
```

**与 5B `@semantic/types/structural.ts` 的依赖关系**:

- 字面 import `STRUCTURAL_CONTAINER_TYPES`(5 项 — 不含 `'table'`,5A 拍板 table 是 atom)
- 字面是 5B §7.3.1 集中化后的"第 6 处消费方"(5B 节 1 §7.3.1 字面登记的五处消费方 + 本期新加第六处)
- 不允许独立 hardcode 5 项 STRUCTURAL — 反模式滋生地(详节 6)

**与 `buildAutoBlockIdPlugin` 的字面区别**:

| 维度 | regenerateIdsForPaste | buildAutoBlockIdPlugin |
|---|---|---|
| 运行环境 | capability 层(纯 JSON PmPayload) | PM editor 层(PMNode + tr) |
| 跳过结构性容器 | STRUCTURAL_CONTAINER_TYPES 字面 import | 同源(本期收敛后字面同 import) |
| 何时重生成 | **无条件**覆盖 attrs.id | (A) null + (B) doc 内重复 才重生成 |
| 触发来源 | paste 入口字面调用 | 每 transaction appendTransaction 字面自动 |
| 副作用 | 返回新 doc(纯函数) | 通过 tr.setNodeMarkup 改 PM state |

字面理由:paste 入口字面**已知**所有 id 都该重生成(跨 note 复制 = 字面新副本),无须 plugin 的"先查重再决定是否重生成"逻辑;无条件覆盖更简洁、字面更难漏 case。

### 2.2 新增 `pasteAndCreateNote(srcDoc, folderId)` capability API

**位置**:

- API 类型字面登记到 [`src/capabilities/note/types.ts`](../../src/capabilities/note/types.ts) 的 `NoteCapabilityApi` 接口
- main 端字面实施于 [`src/platform/main/note/capability-impl.ts`](../../src/platform/main/note/capability-impl.ts) `pasteAndCreateNote` 函数,export 到 capability barrel
- IPC handler 字面登记到 [`src/platform/main/note/handlers.ts`](../../src/platform/main/note/handlers.ts) 新增 `NOTE_PASTE_AND_CREATE` channel
- preload 字面登记到 [`src/preload/note.ts`](../../src/preload/note.ts) 同名
- view 端 capability adapter 字面登记到 view-side 实施(具体路径同其它 noteCap 方法)

**API 签名**:

```ts
export interface NoteCapabilityApi {
  // ... 既有 API
  /**
   * paste 路径专用 — 字面对齐 decision 026 §5.2 "粘贴全部生成新 id"。
   *
   * 字面流程:regenerateIdsForPaste(srcDoc) → 走 createNote 内部路径
   * (containerAtom + hasNoteView + inFolder + dissect + diff + putAtom × N)。
   *
   * 与 createNote 的字面区别:
   * - createNote 字面假设 caller 传入的 doc 已经过 PM plugin(plugin 已重生成
   *   paste/split 重复 id)。capability 层 injectIdsForCreate 字面只覆盖 null
   *   id 注入(line 271 `if (!out.attrs.id)`)。
   * - pasteAndCreateNote 字面新增一步:无条件重生成所有 block id,**字面对
   *   capability 入口字面保证"新 note 与源 note 无 id 共享"** —— 字面让决议
   *   026 §5.2 字面规则在 capability 路径**真正落地**(不只是 plugin 路径)。
   *
   * @param srcDoc — paste 源 doc(深拷贝后字面含原 ULID)
   * @param folderId — 目标 folder(根级 = null)
   */
  pasteAndCreateNote(
    srcDoc: NoteDocEnvelope,
    folderId: string | null,
  ): Promise<NoteInfo>;
}
```

**内部实施字面骨架**:

```ts
export async function pasteAndCreateNote(
  srcDoc: NoteDocEnvelope,
  folderId: string | null = null,
): Promise<NoteInfo> {
  const pmDoc = unwrapPmDoc(srcDoc);
  const regenerated = regenerateIdsForPaste(pmDoc);
  // 字面 wrap 回 NoteDocEnvelope 走 createNote 既有路径
  return createNote(wrapPmDoc(regenerated), folderId);
}
```

**与 `createNote` 的字面关系**:

- `createNote` 字面**语义保留不变**:capability 一般创建入口(空 note / programmatic 创建 / markdown-import / extraction-import 等)字面继续走它
- `pasteAndCreateNote` 字面是 paste 入口的**独立路径**:对 srcDoc 做 regenerate 后**复用** createNote 内部全部既有逻辑(container atom + hasNoteView + inFolder + dissect + diff + putAtom + cache.set + broadcast)
- 字面**不修改** createNote 任何字面 — 字面是 wrapper

### 2.3 view 端切换

[`src/views/note/tree-operations.ts:172 pasteNote`](../../src/views/note/tree-operations.ts#L172) 字面改一行:

```ts
// 旧字面:
await noteCap().createNote(docCopy, targetFolderId);
// 新字面:
await noteCap().pasteAndCreateNote(docCopy, targetFolderId);
```

[`src/views/note/tree-operations.ts:218 pasteFolderTree`](../../src/views/note/tree-operations.ts#L218) 内 line 236 同款改:

```ts
// 旧字面:
await noteCap().createNote(docCopy, newFolderId);
// 新字面:
await noteCap().pasteAndCreateNote(docCopy, newFolderId);
```

**字面理由**:这是 paste 入口字面**唯二**调 createNote 的位置(其它入口字面与 paste 无关)。改这两点字面覆盖整个 paste 路径。

---

## 节 3:决议 026 字面遵守

### 3.1 是否需要修订决议 026?

**答案:不需要修订**。

字面理由:决议 026 §5.2(行 308-329)字面已经清晰拍板:

> Cmd+X / Cmd+C / Cmd+V 一律**生成新 ULID**,丢弃原 id(不区分 cut/copy)
>
> 字面规则:粘贴 transaction 的 `appendTransaction` 拦截时,**所有有 id 的 node** 都重新生成 ULID。

**决议字面规则已对**;5C bug 字面是"实施漂移" — 决议默认 paste 路径过 PM editor / `appendTransaction`,但 capability 层 paste(pasteNote)字面绕开 PM editor(NavSide 复制 → 内存深拷贝 → IPC createNote → dissect),plugin 字面无法拦截。

字面表述:5C **只是把决议 §5.2 字面规则在 capability paste 路径补齐**,不动决议字面。

### 3.2 决议层无字面变更

本期不修订决议 026 任何章节。字面变化全部在实施层:

- 新增 `regenerateIdsForPaste` 函数(在 capability 内部)
- 新增 `pasteAndCreateNote` API(capability 公开 API + IPC + preload)
- 改两行 view 端调用

调研报告 §6.7 字面引用决议 026 §5.2 描述 bug 是"违反决议",字面是"实施未落地决议"的别称 — 字面修法是补齐实施,不动决议。

---

## 节 4:边缘场景与决策

### 4.1 paste 内嵌套(callout 内 nested list)

**决策**:递归字面覆盖**全部嵌套层**。

字面理由:`regenerateIdsForPaste` 的 `visit` 字面 `node.content.map(visit)` 递归到任意深度。callout 内的 paragraph / bulletList / listItem 等字面全部走同一规则:STRUCTURAL_CONTAINER_TYPES 跳过(不重生成,因为它们字面不该有 id),其它字面无条件重生成。

字面行为速查:callout/listItem/paragraph → 重生成;bulletList(STRUCTURAL)→ 跳过;text/mathInline/fileLink/noteLink/hardBreak(inline 无 attrs.id)→ 跳过。

### 4.2 paste table(含 5A 拍板的 rowIndex/colIndex)

**决策**:table atom 自身 id 重生成;cell atom id 重生成;`rowIndex` / `colIndex` 字面**不变**。

字面理由:table atom 字面已是非结构性(5A 拍板,从 STRUCTURAL 移出)→ 重生成;tableCell/tableHeader → 重生成;tableRow ∈ STRUCTURAL → 跳过;`{...node.attrs}` 浅拷贝字面保留 rowIndex/colIndex/colspan/align/bookAnchor 等其它字段;dissect-pm-doc tableRow 路径字面重算 rowIndex/colIndex(5B Q2 选项 B / Stage 3),所以 paste 出来的 table 字面与源 round-trip 一致。

字面交叉点验证:5A §6.1 "tableCell.childOf → table atom" 字面成立(table atom 新 id);5B §6.1 "5C 不依赖 5B Stage 3+" 字面成立(regenerate 不动 rowIndex/colIndex)。

### 4.3 paste 大 note(导入产生的 13552 块大表)

**决策**:一次性扫全树,**不**做 lazy。

字面理由:`regenerateIdsForPaste` 字面纯 JSON in-memory(无 I/O / IPC / DB),N block × (generateUlid 微秒级 + 浅拷贝)= 13552 块 ~10-30ms 量级,远小于 createNote 内部 dissect + diff + putAtom × N 的事务时间(数秒到数十秒)。lazy 字面会让"paste 半完成时部分 atom 仍共享 id" 成"半段错误"状态,字面比原 bug 更糟。性能瓶颈在 createNote 事务路径(同 [`project_delete_note_batch_plan`](../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/project_delete_note_batch_plan.md) 大 note 单事务卡死根因),5C 不在此层优化。字面边界:实测 regenerate >100ms 字面登记 Open Question(详节 7),本期不实施。

### 4.4 paste 失败时的 id 状态

**决策**:`regenerateIdsForPaste` 后 createNote 失败 — **字面 noop**(无需 cleanup)。

字面理由:`regenerateIdsForPaste` 字面纯函数只改返回副本不动入参;IPC 边界字面再做一次 JSON 序列化字面隔离 view 端引用,view 端叠加 [`tree-operations.ts:180`](../../src/views/note/tree-operations.ts#L180) 已 `JSON.parse(JSON.stringify(src.doc))` 二次保险。createNote 失败 → [`capability-impl.ts:176`](../../src/platform/main/note/capability-impl.ts#L176) `storage.transaction` 字面回滚 → DB 零副作用;失败 throw 字面上抛 NavSide UI。regenerated doc 字面只活 main 端栈帧,函数返回字面 GC,无需 cleanup。

### 4.5 paste 内含 mathBlock / image / 等带 src 的节点

**决策**:`src` / `mediaUrl` / `imageSrc` / `bookAnchor` 等字段**保留不动**,字面仍指原 media。**不做 dedup 拷贝**。

字面理由:
- KRIG 媒体走 `media://` 协议 + content-addressed(SHA-256),同 src 字面指同一 media 对象 — 非 mutable 资源,无 copy-on-write 必要
- `regenerateIdsForPaste` 字面只动 `attrs.id`,其它 `attrs.*`(`src` / `mediaUrl` / `imageSrc` / `bookAnchor` / `linkedNoteId` / `extractionType` 等)字面通过 `{...node.attrs}` 浅拷贝**完整保留**
- 副作用边界:删源 note 字面不删 media(独立引用计数路径);`noteLink` 字面继续指原目标(用户复制 note 字面期望保留对外引用);`bookAnchor`/`pdfPage` 是 provenance 与 atom id 无关字面保留

字面边界登记:若未来字面有"paste 时换 media 实例"需求(版本控制 / 副本独立 media)→ 留独立 sub-phase,本期字面不实施。

---

## 节 5:5C 路线图(小范围,3 个 stage)

### Stage 5C.1:`regenerateIdsForPaste` 函数 + 单元测试

**依赖**:5B Stage 1-2 完成(`@semantic/types/structural.ts` 单点 export STRUCTURAL_CONTAINER_TYPES 5 项)。若 5B Stage 1-2 未完成,5C.1 字面阻塞;不允许 hardcode 5 项 STRUCTURAL(详节 6)。

**改动文件清单**:

| 文件 | 改动 |
|---|---|
| `src/platform/main/note/regenerate-ids-for-paste.ts` | **新建** — 字面实施 `regenerateIdsForPaste(doc)` 函数 + JSDoc 引用 decision 026 §5.2 |
| `src/platform/main/note/regenerate-ids-for-paste.test.ts`(若仓库有测试约定)| **新建** — 单元测试(详下表) |

**验收测试场景**(单元测试,纯 JSON in-memory,无 DB):

| # | 场景 | 期望 |
|---|---|---|
| U1 | 平铺 doc(3 个 paragraph,字面带 ULID id) | 输出 doc 3 paragraph 字面新 ULID id(全部不同于输入,字面互不相同) |
| U2 | 嵌套 callout > paragraph + bulletList > listItem > paragraph | callout / paragraph / listItem / 内层 paragraph 字面全部新 id;bulletList 字面无 id(STRUCTURAL 跳过) |
| U3 | table > tableRow > tableCell > paragraph | table 字面新 id(非 STRUCTURAL);tableRow 字面跳过(STRUCTURAL);tableCell 字面新 id;cell 内 paragraph 字面新 id |
| U4 | table cell 字面带 `attrs.rowIndex=1, colIndex=2, colspan=2, align='center'` | 输出 cell 字面新 attrs.id;**rowIndex/colIndex/colspan/align 字面不变** |
| U5 | inline 节点(text / mathInline / fileLink / noteLink / hardBreak) | 字面跳过(不修改 attrs / 不新增 id);text.text 字面保留 |
| U6 | image 字面带 `attrs.imageSrc='media://abc...'` | 输出 image 字面新 attrs.id;`imageSrc` 字面不变 |
| U7 | 入参 doc 字面不被修改(纯函数验证) | 字面深比较入参 doc === 入参 doc 原值 |
| U8 | 空 doc(content=[]) | 输出 doc 字面 type='doc' content=[];不抛错 |

**字面非阻塞**:U1-U8 纯 JSON 单元测试,不依赖 DB / PM editor / 5B Stage 3+。

### Stage 5C.2:`pasteAndCreateNote` capability API + IPC + handler

**依赖**:Stage 5C.1 完成。

**改动文件清单**:

| 文件 | 改动 |
|---|---|
| `src/capabilities/note/types.ts` | `NoteCapabilityApi` 字面新增 `pasteAndCreateNote(srcDoc, folderId)` 方法签名 |
| `src/platform/main/note/capability-impl.ts:162` 上方 | 字面新增 `pasteAndCreateNote` 函数(调用 regenerate + 走 createNote 既有路径) |
| `src/platform/main/note/capability-impl.ts` barrel export | 字面 export `pasteAndCreateNote` |
| `src/platform/main/note/handlers.ts` | 字面新增 IPC handler(channel 名建议:`NOTE_PASTE_AND_CREATE`)|
| `src/preload/note.ts`(实际路径见 preload 单点)| 字面新增 preload bridge 同名 |
| `src/preload/note.d.ts` 或同等 contextBridge 类型声明 | 字面新增类型 |
| view 端 capability adapter(NoteCapabilityApi 实施)| 字面新增 `pasteAndCreateNote` 走 IPC |

**验收测试场景**:

| # | 场景 | 期望 |
|---|---|---|
| C1 | view 端 `noteCap().pasteAndCreateNote(srcDoc, folderId)` 字面 IPC 走通 | 返回 NoteInfo;新 NoteInfo.id ≠ srcDoc 任何 block id |
| C2 | main 端 `pasteAndCreateNote` 字面调 `regenerateIdsForPaste` + `createNote` 顺序正确 | log 字面打印 "regenerate then create" 顺序;最终 atom 字面新 id |
| C3 | C1 后字面 `storage.listEdges({ predicate: belongsToNote })` 字面查询源 atom id 字面 1 条出 edge(不增加)| 字面源 note 字面 atom id 字面**仍只**指向源 container,**不新增**指向新 container 的边 |
| C4 | createNote 失败(模拟 storage.transaction throw)| `pasteAndCreateNote` 字面 throw,DB 字面零副作用,regenerate 字面纯函数无残留 |
| C5 | createNote 既有路径字面不被改动(语义保留)| `noteCap().createNote(emptyDoc, null)` 字面行为字面与改动前完全一致 |

### Stage 5C.3:view 端切换 + 端到端测试

**依赖**:Stage 5C.2 完成。

**改动文件清单**:

| 文件 | 改动 |
|---|---|
| `src/views/note/tree-operations.ts:183` | `createNote(docCopy, targetFolderId)` → `pasteAndCreateNote(docCopy, targetFolderId)` |
| `src/views/note/tree-operations.ts:236` | `createNote(docCopy, newFolderId)` → `pasteAndCreateNote(docCopy, newFolderId)` |

**字面验收端到端测试场景**(在 dev 跑 UI + SurrealDB 旁路查):

| # | 场景 | 期望 |
|---|---|---|
| E1 | 复制 1 note(含 5 paragraph)粘贴到同 folder | NavSide 字面出"副本 X";打开后两 note 字面**所有 5 个 block id 互不相同**;字面 `SELECT * FROM edge WHERE predicate='user:krig:belongsToNote' AND subject.atomId IN [<旧 ids>]` 字面只返回指向源 container 的边(不指向新 container) |
| E2 | 复制 1 note 粘贴到**不同** folder | 同 E1;额外字面 inFolder 边字面新 container → 新 folderId |
| E3 | 复制含**表格**(3 行 3 列)的 note 粘贴 | table atom 字面新 id;9 个 cell atom 字面新 id;字面 cell `attrs.rowIndex` / `colIndex` 字面 0/0,0/1,...,2/2 与源字面一致(dissect 期重算后) |
| E4 | 复制 folder 树(含 5 篇 note,每篇 5 块)粘贴 | folder 树字面递归复制;**全部 25 个 block id 字面互不相同**;字面 SELECT 查 belongsToNote 边集合字面无任何 subject 出现 2 条(belongsToNote 1:1 字面无违反) |
| E5 | E1 后**编辑**新 note 的某 block content → 保存 → 重启 → 打开源 note | 源 note 内容字面**不变**(因新 atom id 与源不同,update 字面只影响新 atom) |
| E6 | E1 后**删除**新 note(NavSide 右键 delete)| 源 note 字面**完全保留**(因 deleteNote 级联 by belongsToNote.object=新 container,字面命中新 atom 集合不命中源集合)|
| E7 | 启动期 cardinality-check 字面无 belongsToNote 违反 warn | main 进程 terminal 字面 `[storage/cardinality-check] user:krig:belongsToNote (1:1): scanned N edges, found 0 multi-edge violations` |

**字面注**:E5 / E6 / E7 字面是 bug 影响面(节 1.2 e/f/g)的字面反向验证 — 修法是否字面修对,字面看这三场景是否字面恢复正常。

---

## 节 6:与 5B 的协调点

### 6.1 字面依赖

5C Stage 5C.1 字面**依赖** 5B Stage 1-2(`@semantic/types/structural.ts` 单点 export STRUCTURAL_CONTAINER_TYPES 5 项)。

字面理由:5B §7.3.1 字面拍板 STRUCTURAL 收敛到 semantic 层单点 export,五处 import(`assemble-pm-doc.ts` / `dissect-pm-doc.ts` / `build-auto-block-id-plugin.ts` / `atoms-to-pm.ts` / `capability-impl.ts injectIdsForCreate`);5C 的 `regenerateIdsForPaste` 字面是**第六处** import 消费方;字面**不允许**第六处独立 hardcode 5 项 STRUCTURAL(详 6.3)。

### 6.2 推荐执行顺序

**推荐:5B Stage 1-2 先做,~2 天工作量,之后 5C 开工。**

5B Stage 1-2 字面只涉及:
- 新建 `src/semantic/types/structural.ts`(单文件,常量 export)
- schema 改 3 行(table NodeSpec 加 attrs.id;tableCellSpec / tableHeaderSpec 加 rowIndex/colIndex 字段)
- 5 处 import 替换(2 处既有 + 3 处独立定义改 import)
- typecheck

字面工作量小(~2 天),做完后 5C 字面有干净底盘。

**字面互斥**:5C 字面不能在 5B Stage 1-2 完成前先合 main(因没有第六处依赖目标)。

### 6.3 是否允许 5C 先于 5B Stage 1-2 完成?

**不推荐**。

字面理由:第 6 处独立定义字面违反 5A §2.7 / 5B §7.3.1 "集合内容字面一致硬契约";加新 STRUCTURAL 字面漏改一处 → 静默漂移(5B §6.3 / 5A §2.2 反复登记反模式);"事后回头收敛"是 tech debt,grep 不命中明显信号字面常被遗忘。**例外**:若总指挥字面拍板接受 tech debt 换 5C 提前上线字面允许,但本设计不推荐。

### 6.4 字面共依赖只有这一点

5C 字面**不依赖** 5B 其它任何决策:

- 不依赖 5B Stage 3 dissect rowIndex/colIndex 注入(paste 路径 regenerate 不动 rowIndex/colIndex,dissect 期重算)
- 不依赖 5B Stage 4 assemble wrapTableCells 重构(paste 出的 doc 字面与源同结构,assemble 字面同源路径)
- 不依赖 5B Stage 5-6 content-ingest capability(paste 字面不走 ingest pipeline,5B §6.1 拍板)
- 不依赖 5B Stage 7 createNotesBatch(paste 字面单条 createNote)
- 不依赖 5B Stage 8 契约 v2.1 rename tiptapContent(paste 字面不动契约层)

字面影响半径**字面非常小**。

---

## 节 7:本期发现的悬而未决问题

### 7.1 Q9:bug 期间产生的脏数据 migration 是否必要?

**背景**:节 1.2 字面登记的 bug 影响面字面是"用户已 paste 过的 note 字面已经污染 DB"(belongsToNote 1:1 违反 / childOf 重复 / nextSibling ≤1 违反)。

字面分析:
- 用户字面在 2026-05-27 字面 `rm krig-data`(详 [`project_delete_note_batch_plan`](../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/project_delete_note_batch_plan.md) 字面登记的应急止血) — 字面已**清空**当前 DB
- 当前 DB 字面无脏数据;**bug 修法上线前**用户**新**字面 paste 操作字面会产生脏数据;**上线后**字面 paste 字面无新脏数据
- 若用户字面跨上线时间点字面 paste 过(在修法上线前 paste 过)→ 字面有脏数据

**留独立 sub-phase 拍板**:是否需要 migration sub-phase 字面扫 belongsToNote / childOf / nextSibling 字面违反 → 字面"keep one drop rest"自愈?

字面候选方案:
- 方案 A:不做 migration,字面接受"上线前 paste 出来的副本字面是污染的,用户字面应重新 paste"
- 方案 B:加 migration:扫 cardinality 违反 → 字面给"重复" atom 字面 `regenerateIdsForPaste` 再字面落地新 atom(字面成本高,字面要重写 dissect 出来的边集合)
- 方案 C:加 migration:对每个违反 atom 字面"按 createdAt 降序 keep-latest" 字面自愈(与现有 `checkPredicate` keep-latest 字面同模式)— 字面会让"被 keep 的 note" 保留 atom,字面"被 drop 的 note"字面静默丢内容

**推荐方案 A**(字面与决议 026 §13.10 字面 "用户已 rm krig-data" 同思路 — 字面接受历史数据需用户字面手工处理,字面不引入 migration 复杂度)。

本期 5C 字面**不解决**,登记给未来 sub-phase 拍板。

### 7.2 Q10:`regenerateIdsForPaste` 在极端大 note(>100k block)字面性能优化

**背景**:节 4.3 字面登记"13552 block ~10-30ms 量级",字面**未实测**。

**留独立 sub-phase**:若实测 regenerate 阶段 >100ms 字面成 paste 卡顿主因,字面考虑 lazy / streaming;但字面**先有实测数据**再立 sub-phase。

字面**本期不实施**。

### 7.3 字面无其它新 open question

5C 字面是小范围 bug 修复,字面无其它待拍板问题。5B 留下的 Q5-Q8(契约 v2.2 / content-ingest 进程归属 / split cell id 保留规则 / sanitizeAtoms 兼容期)字面**与 5C 无关**,字面留 5B 下游 sub-phase。

---

## 总结(字面给调用方)

- 路径:`docs/tasks/2026-05-28-stage-5C-paste-id-regen-design.md`
- 节 1 影响面:UPSERT 不冲突表面成功,但 belongsToNote 1:1 / childOf / nextSibling 三类边字面违反 cardinality(L2 仅 warn 不自愈);assemble 字面双拼共享 atom;**副本编辑字面腐蚀源数据**;**删源 note 级联删空副本对应块**。仅 pasteNote / pasteFolderTree 命中。
- 节 4 决策:嵌套全递归;table id 全新但 rowIndex/colIndex 不变(dissect 重算);大 note 一次扫(<30ms);失败 noop 纯函数无残留;媒体 src 保留不动。
- 节 5 三 Stage 齐全:5C.1 regenerate + 8 单元;5C.2 API + IPC + 5 capability;5C.3 view 切换 + 7 端到端(含 cardinality)。
- 节 7 新 open:Q9 脏数据 migration(推荐 A 不做);Q10 极端大 note 性能(留实测)。决议 026 不需修订(字面"实施漂移")。

---

*Stage 5C Design · 2026-05-28 · 设计文档 · 不改 src / 不 commit / 不连 DB / 不动决议*
