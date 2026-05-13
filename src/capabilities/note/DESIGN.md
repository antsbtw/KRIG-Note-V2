# note capability

> v0.2 · 2026-05-13 · L7-sub3a-2.5(note 形态升级)
>
> 配套:
> - [decision 012](../../../docs/RefactorV2/data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md) — sub-phase 2 note + folder 初版
> - [decision 016](../../../docs/RefactorV2/data-model/persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md) — sub-phase 3a-2.5 note 形态升级(本次)

## 职责

把 main 进程的 noteCapability 持久化能力(CRUD + 列表广播)封装成 renderer 端 API。
noteCapability 内部走 storage (SurrealDB Sidecar,L7-sub1 实施)。

view 通过 `requireCapabilityApi<NoteCapabilityApi>('note')` 拿 api,不直触 storage
(W5 严格态 charter § 5.4)。

## 实现位置

| 层 | 路径 | 备注 |
|---|---|---|
| Renderer 入口 | `src/capabilities/note/index.ts` | IPC 调用封装 + capabilityRegistry 注册 |
| 类型 | `src/capabilities/note/types.ts` | NoteCapabilityApi + NoteInfo + NoteDocEnvelope |
| Renderer 启动迁移 | `src/capabilities/note/migration.ts` | 清 V1 legacy localStorage 键(idempotent) |
| Main 实现 | `src/platform/main/note/capability-impl.ts` | create/list/get/update/move/delete 7 API |
| Main 工具 | `src/platform/main/note/derive-title.ts` | 从裸 PmPayload 派生 title (10 行自包含) |
| Main 工具 | `src/platform/main/note/envelope.ts` | DriverSerialized ↔ 裸 PmPayload wrap/unwrap (路径 Y) |
| Main 广播 | `src/platform/main/note/broadcast.ts` | broadcastNoteListChanged (跨模块复用) |
| IPC handlers | `src/platform/main/note/handlers.ts` | 6 ipcMain.handle (业务 IPC + 广播) |
| IPC channel | `src/shared/ipc/channel-names.ts` 加 NOTE_* 7 条 | |
| preload | `src/platform/main/preload/main-window-preload.ts` 末尾追加 | noteCreate / List / Get / Update / Move / Delete + onNoteListChanged |
| electron-api 类型 | `src/shared/ipc/electron-api.d.ts` 末尾追加 | |

## 数据模型(sub-phase 3a-2.5 形态升级)

### note = pm atom + hasNoteView 边(不再是 "pm atom = note")

sub-phase 2 字面"pm atom 就是 note";sub-phase 3a-1 引入 graph text-node 也走 pm atom domain(decision 014 §3.4)+ `hasContent` 边,**pm domain 不再唯一对应 note**。

sub-phase 3a-2.5 引入 [`user:krig:hasNoteView`](../../../docs/RefactorV2/data-model/relations/spec.md) 边(decision 016 §3.2):某 pm atom 当作 note 显示在 note 列表里 ⇔ 该 pm atom 有 1 条 `hasNoteView` 边作为 subject。

**形态对比**:

```
sub-phase 2(旧):
  note         = pm atom (domain='pm')
  graph text   = (本期不存在)
  listNotes()  = listAtoms({ domain:'pm' })

sub-phase 3a-1(P0d 落地后):
  note         = pm atom (domain='pm')
  graph text   = pm atom (domain='pm') + hasContent 边 (subject=graph-instance)
  listNotes()  = listAtoms({ domain:'pm' })  ← bug:误列 graph text-node 内容
                                              (P0d binary verify 实证 "123-abc*abc" 误列)

sub-phase 3a-2.5(本期):
  note         = pm atom (domain='pm') + hasNoteView 边 (subject=该 atom)
  graph text   = pm atom (domain='pm') + hasContent 边 (subject=graph-instance)
  listNotes()  = listEdges({ predicate:'user:krig:hasNoteView' }) → 拿 subject atom ids → getAtom 批读
                 ← 严格区分,完全隔离
```

### atom 形态(payload 不变 — pm atom 不读 view 含义)

```ts
// atom 形态 (decision 012 §3.2 路径 Y):
{
  payload: {
    domain: 'pm',
    payload: <PM doc root>,   // 裸 PmPayload (信封压缩到 capability 内部)
  }
}
```

### hasNoteView 边(本期新增)

```
predicate:    user:krig:hasNoteView
subject:      pm atom (内容)
object:       AtomRef(自身,即 subject)  // 一对一,object 即 subject 的标记
attrs:        { createdBy, createdAt }
cardinality:  一对一(单引用约束,sub-phase 3a-2.5 强制)
```

详 [decision 016 §3.2 / §3.3](../../../docs/RefactorV2/data-model/persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md)。

### view ↔ capability 边界(NoteInfo,字面不变)

```ts
{
  id: ULID,
  title: <派生自 doc.content[0]>,
  doc: NoteDocEnvelope { format:'pm-doc-json', version:'0.1', payload: <PM doc> },
  folderId: <派生自 user:krig:inFolder 边>,
  createdAt, updatedAt,
}
```

## listNotes 查询语义改变(sub-phase 3a-2.5)

**旧**(sub-phase 2):`storage.listAtoms({ domain: 'pm' })` → 所有 pm atom 都当 note 返。

**新**(sub-phase 3a-2.5):
1. `storage.listEdges({ predicate: 'user:krig:hasNoteView' })` → 拿 subject 是 note pm atom 的边
2. 从边 subject 取 atom id 集合
3. 批 `storage.getAtom` 拿 atom 数据
4. 叠加 inFolder 边查询拿 folderId
5. 返 NoteInfo[]

**核心业务价值**:graph text-node pm atom **不带 hasNoteView 边** → 不会出现在 note 列表里。Step 5.6 §6.2.4 binary verify 实证(2026-05-13):4 个 graph text-node pm atom 字面零 hasNoteView 边,4 个 hasNoteView 边都指向真正的 note pm atom(零 hasContent 入边),完全互不污染。

## deleteNote 草稿/流通分支(sub-phase 3a-2.5)

按 [decision 013 §3.5.2](../../../docs/RefactorV2/data-model/persistence/decisions/013-sub-phase-3a-graph-canvas-migration.md) + [decision 016 §3.5](../../../docs/RefactorV2/data-model/persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md)`hasBeenReferenced` 删除契约:

| 状态 | 行为 | 实施 |
|---|---|---|
| **草稿态**(`hasBeenReferenced=false`,本 sub-phase 强制单引用模式下必然) | `storage.deleteAtom(id)` → cascade 删 atom + inFolder 边 + hasNoteView 边 | sub-phase 3a-2.5 实施(草稿分支唯一路径) |
| **流通态**(`hasBeenReferenced=true`)| 仅断 hasNoteView 边,保留 atom(用户视角"note 消失",但 pm atom 留给其他 wrapper 引用)| 留 sub-phase 3a-shared-ref(单引用约束解除后);本 sub-phase 实施时 warn + 不做(防御性) |

**当前 sub-phase 实施**:草稿分支(走 storage.deleteAtom);流通分支 warn 不动 atom(防御性保护)。

```ts
// capability-impl.ts:158-178 关键字面
async function deleteNote(id) {
  const atom = await storage.getAtom(id);
  if (atom?.hasBeenReferenced) {
    console.warn(`[noteCapability.deleteNote] pm atom ${id} hasBeenReferenced=true ...`);
    return { cascadedEdges: 0 };
  }
  // 草稿态 — storage 应用层 cascade 删 inFolder + hasNoteView 边
  return await storage.deleteAtom(id);
}
```

## 单引用约束(本 sub-phase 强制)

**约束**:每个 pm atom 只被 1 个 wrapper(hasNoteView 或 hasContent)引用。

- **note pm atom**:1 条 hasNoteView 边(subject=自身)+ 0 条 hasContent 边
- **graph text pm atom**:0 条 hasNoteView 边 + 1 条 hasContent 边(subject=graph-instance,object=该 atom)

→ `hasBeenReferenced` flag 在单引用模式下永远保持 `false`(永远不会创建第 2+ 条引用边)。

**多引用模式**(跨 view 复用 / 浅引用)留 sub-phase 3a-shared-ref,前置 sub-phase 3a-tx(真原子性)。

## migration 1.2.0(本 sub-phase 落地)

[`src/storage/surreal/schema.ts:migration_1_2_0`](../../../src/storage/surreal/schema.ts):

- 给所有现有 `domain='pm'` atom **加 1 条 hasNoteView 边**(单 pm atom + 单边一对一)
- 幂等:重复 migrate 不重复加边(检查既有 hasNoteView 边)
- Step 5.6 §6.2.1 binary verify 实证:added 2(2 个 sub-phase 2 老 pm atom),幂等通过

## 边界纪律

- view ↔ capability:NoteInfo.doc = DriverSerialized 信封
- capability 内部 ↔ storage:裸 PmPayload (envelope.ts wrap/unwrap)
- title 派生自 doc.content[0] 首段文本,不存 atom payload
- folderId 派生自 user:krig:inFolder 边,不存 atom payload
- **note 身份**派生自 hasNoteView 边,不存 atom payload(sub-phase 3a-2.5 新增)
- listNotes 严格按 hasNoteView 边过滤,**禁止** 走 listAtoms domain=pm(会误列 graph text-node)

## 订阅机制

main → renderer 广播 `NOTE_LIST_CHANGED`,renderer 端走 `useAllNotes` hook
(views/note/use-notes-folders.ts):

```ts
const notes = useAllNotes();  // 首次 [] → IPC fetch → setState;后续 onListChanged 增量推
```

## sync 缓存(给 driver resolveNoteTitle 守约)

driver 的 LinkClickHandler.resolveNoteTitle 是 sync API (PM transaction commit
路径不能 await)。view 层私有缓存 `src/views/note/note-cache.ts` 启动后由 onListChanged
增量更新,resolveNoteTitle 走 `getNoteTitle(id)` 同步查 (设计师批复 L2)。

## V1 legacy 清理

启动时 `migration.ts` 清掉 V1 兼容键 `krig.notes` / `krig.folders` (decision 012 §3.6
用户拍板选项 M:V2 测试数据可丢),idempotent + 静默 no-op 兼容。
