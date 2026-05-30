# 数据层可靠性设计 — 写库操作中断/崩溃恢复

> **状态**: 设计草稿(2026-05-30,供用户决策做多大)
> **范围**: 只调研 + 设计,不改 src/、不 commit
> **前置事实来源**: decision 020(transaction 真原子性)+ memory `project_delete_note_batch_plan` + `project_surreal_defensive_startup` + 全仓写库入口 grep 实证
> **核心矛盾**: **原子性(包一个大事务)vs 不卡死(分批小事务)** —— 分批后单事务原子性丢失,需要 intent-log + sweeper 补回"逻辑原子性"

---

## 0. 前置确认(已实证,作为设计前提)

| # | 事实 | 实证位置 |
|---|------|---------|
| 1 | `storage.transaction(fn)` 是**真原子事务**:`db.beginTransaction()` → fn → `commit()`;任何错误 → `cancel()` 回滚。commit 返回前崩溃 = 整体回滚无半状态 | `src/storage/surreal/storage.ts:483-510`;decision 020 §3.5.bis 场景 11/13b binary verify PASS |
| 2 | SurrealDB 是 **OCC(乐观并发)**:并发写同一 atom,第二个 commit 报 `Transaction conflict ... can be retried`。单机单用户概率极低,本设计不处理 | decision 020 §3.5.ter |
| 3 | `deleteAtom` 应用层级联:先 `SELECT id FROM edge WHERE subject.atomId=$id OR object.atomId=$id` → `DELETE edge ...` → `DELETE atom`。**无 RELATE 原生 cascade,字符串外键自管** | `storage.ts:199-226`;`transaction-helpers.ts:89-115` |
| 4 | 启动序列:`initStorage()` → `initSurrealDB()` → `runMigrations(getDB())` → `runCardinalityCheck()`。**sweeper 的天然挂载点 = runCardinalityCheck 之后、业务 IPC 之前** | `src/storage/index.ts:29-33`;`client.ts:253-262` |
| 5 | **当前无任何 pending/intent/status 状态字段**。atom 上唯一状态标志是 `hasBeenReferenced`(单引用模式恒 false)。`deletionPending` 只存在于未实施的 plan 文档 | grep 全仓:`src/semantic/types/atom-entity.ts` 无 status 字段 |
| 6 | SurrealDB 无官方事务硬上限,但 RocksDB 单 tx 把全部 write batch 缓在内存;6100 块 note 单事务 ≈ 18000 query 串行 await,实测**卡死**(broadcast 不发,UI"点删没反应") | memory `project_delete_note_batch_plan`;issue #6327(2M rows DELETE crash RocksDB) |

---

## 1. 写库操作全景表

> 列:入口函数、文件:行、是否包事务、单事务 vs 多独立事务、写量级、中断风险评级。
> 评级判据见 §2。

### 1.1 note capability(`src/platform/main/note/capability-impl.ts`)

| 入口 | 行 | 包事务? | 事务结构 | 写量级 | 风险 |
|------|----|---------|---------|--------|------|
| `createNote` | 211 | ✅ 单事务 | container atom + hasNoteView 边 + (opt) inFolder 边 + N 个 block atom/边 | 小篇 OK;**导入大篇时 N 大** | 🟡→🔴(大篇创建同样卡死,见 §2.4) |
| `updateNote` | 516 | ✅ 单事务 | `applyDiff(diff)` + container putAtom | diff 量级(增量,通常小);**整篇重排时 diff 可达全篇块数** | ✅→🔴(极端重排) |
| `moveNote` | 534 | ✅ 单事务 | N×deleteEdge + 1×putEdge(inFolder) | N≈0-1 | ✅ 安全 |
| `deleteNote` | 553 | ✅ 单事务 | **for belongsEdges: deleteAtom** + container deleteAtom | **= note 块数**(6100 块实测卡死) | 🔴 单事务过大卡死 |
| `createNotesBatch` | 603 | ✅ 单事务 | 整批 N 篇全部 putAtom/putEdge | **= Σ(每篇块数)**;有 >500 篇 `console.warn` 但**不拦截** | 🔴 批量×大篇 = 双重放大 |

### 1.2 folder capability(`src/platform/main/folder/capability-impl.ts`)

| 入口 | 行 | 包事务? | 事务结构 | 写量级 | 风险 |
|------|----|---------|---------|--------|------|
| `createFolder` | 62 | ✅ 单事务 | folder atom + folderForView 边 + (opt) inFolder 边 | 2-3 步 | ✅ 安全 |
| `renameFolder` | 219 | ❌ 直调 | 单 putAtom | 1 步 | ✅ 安全(单语句原子) |
| `moveFolder` | 237 | ✅ 单事务 | N×deleteEdge + 1×putEdge | N≈0-1 | ✅ 安全 |
| `previewDeleteFolder` | 291 | ✅ 单事务 | 只读(BFS 计数) | 读 | ✅ 安全 |
| **`deleteFolder`** | 307 | ✅ 单事务 | BFS 收集整棵子树所有 folder + 所有内含资源(pm/graph-canvas/thought)→ **逐个 deleteAtom** | **= Σ(子树全部资源的级联 edge + atom)**。若子树含大 note → 同 deleteNote 卡死 + 更大 | 🔴 单事务过大卡死(最严重,聚合多篇) |

### 1.3 ebook capability(`src/platform/main/ebook/capability-impl.ts`)

| 入口 | 行 | 包事务? | 事务结构 | 写量级 | 风险 |
|------|----|---------|---------|--------|------|
| `createEBookAtomPair` | 168 | ✅ 单事务 | ebook atom + reading-state atom + hasReadingState 边 | 3 步 | ✅ 安全 |
| `deleteEBook` | 289 | ✅ 单事务 | deleteAtom(reading-state) + N×deleteAtom(thought) + deleteAtom(ebook) | N≈thought 数(小) | ✅ 安全(thought 量小) |
| `moveToFolder` | 318 | ✅ 单事务 | N×deleteEdge + putEdge | N≈0-1 | ✅ 安全 |
| `ensureReadingState`(fallback) | 409 | ✅ 单事务 | reading-state atom + 边 | 2 步 | ✅ 安全 |
| `getOrCreateReadingThought` | 595 | ✅ 单事务 | pm atom + hasReadingThought 边 | 2 步 | ✅ 安全 |
| `saveProgress`/`rename` 等 | 236/311/346/374/433… | ❌ 直调 | 单 putAtom(reading-state/ebook payload) | 1 步 | ✅ 安全(单语句) |

### 1.4 thought capability(`src/platform/main/thought/capability-impl.ts`)

| 入口 | 行 | 包事务? | 事务结构 | 写量级 | 风险 |
|------|----|---------|---------|--------|------|
| `createThought` | 99 | ✅ 单事务 | pm atom + anchor/source 边 | 数步 | ✅ 安全 |
| `deleteThought` | 306(直调) | ❌ 直调 deleteAtom | 单 deleteAtom 级联 | thought block 量(小) | ✅ 安全 |
| 其余 putAtom | 282 等 | ❌ 直调 | 单 putAtom | 1 步 | ✅ 安全 |
| 其它 2 处 transaction | 313/340 | ✅ 单事务 | 边维护 | 小 | ✅ 安全 |

### 1.5 graph canvas(`src/platform/main/graph/canvas-store.ts`)— ⚠ 全部裸写,无事务

| 入口 | 行 | 包事务? | 事务结构 | 写量级 | 风险 |
|------|----|---------|---------|--------|------|
| `createInstance` | 312 | ❌ **裸串行** | putAtom(instance) + N×deleteEdge + putEdge + putAtom(pm) + putEdge | 数步 | 🟡 多独立写,中途崩 = 半状态(悬空边/孤儿 atom) |
| `updateInstance` | 363 | ❌ **裸串行** | putAtom + putAtom(pm) + putEdge | 数步 | 🟡 同上 |
| `deleteInstanceWithCascade` | ~400 | ❌ **裸串行** | deleteAtom(pm) + deleteAtom(instance) | 2-数步 | 🟡 同上 |
| `persistCanvas` | 522/570/632/704 | ❌ **裸串行** | 多 putAtom(canvas/instance/pm) + 多 putEdge + 多 deleteEdge | **= 画板全部节点** | 🟡→🔴 大画板半状态 + 可能卡 |

> **关键发现**:graph canvas 写库**完全不走 `storage.transaction`**,是一串独立单语句写。这些操作本身单语句原子,但**操作之间**无原子性 —— 中途崩溃留半状态(已写的 atom + 没写的边 = 悬空引用)。decision 020 §1.2 列出的 5 个事务调用站点不含 graph canvas,说明它在 transaction 启用前后都是裸写。

### 1.6 migration / backup / health(非用户路径,登记备查)

| 入口 | 文件 | 包事务? | 风险 |
|------|------|---------|------|
| migration 022 ebook-thought | `migrations/022-ebook-thought.ts` | ❌ 裸 putAtom/putEdge 循环 | 🟡 migration 中途崩留半迁移(但 backup-store 有 `.pre-restore` 回滚兜底) |
| migration 023 title-cache | `migrations/023-note-title-cache.ts` | ❌ serial putAtom | ✅ 幂等回填,重跑安全 |
| backup restore | `backup/backup-store.ts:115` | — | 走 surreal import,独立机制 |
| cardinality self-heal | `health/cardinality-check.ts:79` | ❌ deleteEdge | ✅ 自愈幂等 |

### 1.7 view 层入口(renderer → IPC → 上述 capability)

| 入口 | 文件 | 调用模式 | 风险 |
|------|------|---------|------|
| `deleteSelected` | `views/note/tree-operations.ts:100` | **for 循环逐个 deleteOne**(deleteNote / deleteFolder),每项独立 IPC + 独立事务 | 🟡 批次半完成:崩在第 M 项,前 M-1 已删后面没删 |
| `pasteNote`/`pasteFolderTree` | 同文件 193/197/265 | for 循环逐篇 createNote | 🟡 批次半完成(同上) |
| `importMarkdownBatch` | renderer | → `createNotesBatch`(单事务) | 见 1.1(批量整体原子,但大批卡死) |

---

## 2. 中断风险三分类

### 2.1 ✅ 类 A —— 单事务安全(commit 前崩 = 全回滚)

判据:**包在单个 `storage.transaction` 内**,且**写量级有界小**(≤ 数十步)。

成员:`createNote`(小篇)、`updateNote`(小 diff)、`moveNote`、`createFolder`、`renameFolder`、`moveFolder`、`previewDeleteFolder`、全部 ebook 事务、全部 thought 事务、`deleteEBook`、`deleteThought`、各类单 putAtom 直调。

这些**不需要任何额外可靠性机制**,decision 020 已覆盖。

### 2.2 🟡 类 B —— 批次/多步半完成(N 个独立写,无跨步原子性)

判据:**多个独立事务/裸写顺序执行**,中途崩溃留前半已写、后半未写。

成员:
- **`deleteSelected`**(view 层 for 循环逐篇 deleteNote/deleteFolder)
- **`pasteNote`/`pasteFolderTree`**(for 循环逐篇 createNote)
- **graph canvas 全部写**(createInstance/updateInstance/deleteInstanceWithCascade/persistCanvas 裸串行)
- migration 022(裸循环)

后果:悬空边、孤儿 atom、删一半的批次。单机场景影响中等(数据可见性错乱而非丢失全部),但破坏图谱可信度。

### 2.3 🔴 类 C —— 单事务过大卡死

判据:**包在单事务内 + 写量级 = 用户文档块数,可达数千**。

成员:
- **`deleteNote`**(= note 块数,6100 块实测卡死)
- **`deleteFolder`**(= 子树聚合资源,可含多个大 note,最严重)
- **`createNotesBatch`**(= Σ 每篇块数,批量×大篇双重放大;有 warn 无拦截)
- **`createNote` / `updateNote` 极端态**(超大篇导入 / 全篇重排)
- **`persistCanvas` 大画板**(节点数大时)

后果:RocksDB 单 tx write batch 内存累积 + SDK 单 websocket 串行往返 → 进程卡死 / OOM,broadcast 不发,UI 假死。

### 2.4 核心矛盾:类 C 的两难

> **包一个大事务** → 原子性满分,但**卡死**(类 C 现状)。
> **拆成分批小事务** → 不卡死,但**每批独立提交,跨批崩溃 = 半完成**(降级成类 B)。

解法 = **分批小事务 + intent-log + sweeper**:用持久化的"意图日志 + 进度游标"在应用层把 N 个小事务重新绑成一个**逻辑原子操作**。崩溃后 sweeper 读 intent 续完(或回滚)未完成的逻辑操作。

---

## 3. intent-log + sweeper 体系设计

### 3.1 intent 记录的存储

**方案:新建独立 `intent` 表(不复用 atom)。**

理由:
- intent 是**运维元数据**,不是知识语义,塞进 atom 会污染 `listAtoms`/图谱查询、撑大业务表、误入 backup 语义快照。
- intent 生命周期独立(done 后可清理 / 归档),与 atom 的"永久知识"语义冲突。
- 独立表可单独 `DEFINE INDEX ON intent FIELDS status`,sweeper 扫描走索引,O(pending 数) 而非全 atom 扫。

> 替代方案(最小档可用):在 container atom 的 `payload.deletionPending=true` 打标(plan 文档原方案)。优点零新表;缺点只能表达"删除 pending"一种意图,无法承载导入/通用长写,且污染 atom payload。**完整档用独立表,最小档可先用 payload 标记。**

### 3.2 intent 表结构(完整档)

```
DEFINE TABLE intent SCHEMAFULL;
DEFINE FIELD op          ON intent TYPE string;    -- 'delete-note' | 'delete-folder' | 'import-batch' | ...
DEFINE FIELD targetId    ON intent TYPE string;    -- 主目标 atom id(note id / folder root id)
DEFINE FIELD status      ON intent TYPE string;    -- 'pending' | 'committing' | 'done'(done 后清理)
DEFINE FIELD cursor      ON intent TYPE object;    -- 分批游标:{ phase, lastBatchOffset, totalBatches, deletedCount }
DEFINE FIELD payload     ON intent TYPE option<object>; -- op 特定数据(import: 待写 drafts 摘要 / 批次清单)
DEFINE FIELD createdAt   ON intent TYPE number;
DEFINE FIELD updatedAt   ON intent TYPE number;
DEFINE INDEX intent_status ON intent FIELDS status;
```

**关键不变式**:**游标推进必须与那一批的数据写入在同一个小事务里持久化**。即每批小事务 = `{ 删/写这批数据 + UPDATE intent.cursor }`,两者同 commit。这样崩溃恢复时,intent.cursor 必然反映"已确实落库的进度",不会重删/漏删。

### 3.3 各操作如何接 intent

#### A. 单篇大 note 删除(`deleteNote` 重写)— 类 C → 可靠分批

```
1. [小事务] 标 intent: INSERT intent { op:'delete-note', targetId:id, status:'pending', cursor:{deleted:0} }
            同事务给 container atom 标 payload.deletionPending=true(让 UI 立即隐藏,见 §5)
2. [循环] while 还有 belongsToNote.object=id 的 block:
     [小事务/批] SELECT VALUE subject.atomId ... LIMIT BATCH
                 DELETE (SELECT id FROM edge WHERE 涉及这批) RETURN BEFORE
                 DELETE (SELECT id FROM atom WHERE id INSIDE $batch) RETURN BEFORE
                 UPDATE intent SET cursor.deleted += $n, updatedAt=now     ← 同事务推进游标
3. [小事务] 删 container atom + container 自己的边 + DELETE intent(status→done 即删行)
4. [校验] SELECT count() FROM edge WHERE belongsToNote.object=id 必须 0;否则留 pending 报错
```

#### B. 批量删除(`deleteSelected` / `deleteFolder` 子树)— 类 B/C → 批次 intent

- `deleteSelected`:开 1 条 `op:'delete-batch'` intent,payload 存待删 id 清单 + cursor 存"已删到第几项";每删完一项推进 cursor(项内若是大 note 走 A 的子分批)。崩溃后 sweeper 从 cursor 续删剩余项。
- `deleteFolder`:子树 BFS 收集后,**不再包一个大事务**;改为 `op:'delete-folder'` intent + 资源清单 payload + 分批删(同 A 的批循环,但跨多篇/多资源)。每批推进 cursor。

#### C. 导入(`createNotesBatch`)— 已单事务原子,是否还需 intent?

**分析:小批不需要,大批需要降级为分批 + intent。**
- 现状单事务:N 篇全成功 or 全回滚 —— 逻辑原子性**已满足**,功能正确。
- 问题只在**量级**:批量×大篇会卡死(类 C)。
- 结论:**导入的"原子性"不靠 intent,靠"要么不拆、要么拆了用 intent 补"**:
  - 篇数 + 总块数在阈值内 → 维持现状单事务(类 A,不动)。
  - 超阈值 → 必须分批写,此时**单事务原子性丢失**,需 `op:'import-batch'` intent:payload 存批次清单,cursor 存"已成功写入第几批";崩溃后 sweeper 选择**回滚**(删掉已写的部分批次,导入"全有或全无"语义比"半截导入"更符合用户预期)而非续写(续写需要保留全部源数据,成本高)。
  - 另一层:**>500 篇直接禁止**(§4),把"超大导入"挡在 intent 之前,降低 intent 触发面。

#### D. graph canvas(类 B)— 优先补事务,而非 intent

graph canvas 裸写应**先包进 `storage.transaction`**(decision 020 已支持,零新机制),把类 B 直接升级成类 A。只有当画板节点数也能爆量(类 C)时才需要 intent。**建议第一步只补事务,intent 留后。**

### 3.4 sweeper:启动扫描续完/回滚

**挂载点**:`src/storage/index.ts` `initStorage()` 内,`runCardinalityCheck()` 之后、任何业务 IPC handler 注册可用之前(`src/platform/main/index.ts:78` `await initStorage()` 之后即可)。与 `project_surreal_defensive_startup` 的"启动防御"同一阶段。

**流程**:
```
sweepPendingIntents():
  intents = SELECT * FROM intent WHERE status != 'done'   ← 走 intent_status 索引
  for it of intents:
    switch it.op:
      'delete-note' / 'delete-folder' / 'delete-batch':
          从 it.cursor 续删剩余(复用 §3.3.A/B 的批循环),完成后删 intent
      'import-batch':
          回滚:按 it.payload 批次清单删掉已写部分(cursor 指示写到哪),删 intent
  log "[sweeper] resolved N intents"
```

**幂等性**:sweeper 复用同一批删/写逻辑 + 同一 intent 游标,可被重复中断重复运行(每次从最新 cursor 续);删除天然幂等(再删已删的返 0)。

**与 cardinality-check 顺序**:sweeper **先于** cardinality-check 跑更稳(先清掉半状态再做一致性自愈),或紧随其后。建议 sweeper 在 cardinality 之前(因为半状态可能正是 cardinality 误判源)。

### 3.5 "分批 + intent 补逻辑原子性"的保证链

1. 每批数据写 + 游标推进 = **同一小事务**(decision 020 保证该小事务本身原子)。
2. 任一时刻崩溃,DB 里 intent.cursor 必然 = "已确实落库的进度"(因为游标和数据同 commit)。
3. sweeper 读 cursor,从断点续(删/回滚),最终把逻辑操作推到 done。
4. UI 侧靠 `deletionPending` 标记(删除场景)或 intent 存在(导入场景)避免向用户暴露半状态。

> 这就是用"小事务的物理原子性 + intent 游标的持久化进度 + 启动 sweeper 的最终一致"组合出**逻辑原子性**,代价是放弃"瞬时全有全无"换"最终全有全无 + 不卡死"。

---

## 4. >500 篇导入禁止 —— 拦截层与文案

**维度区分(用户拍板)**:**禁"篇数过多",但必须支持"单篇块数大"**。两者不同维度,拦截只针对篇数。

**拦截位置**(双层):
1. **renderer 入口(主拦,UX 友好)**:`importMarkdownBatch`(及 Word/其它导入入口)在调 IPC 前先判 `items.length`。
   - `> 500`:**硬禁止**,弹框 `本次导入 ${n} 篇,超过单次上限 500 篇。请分批导入(建议每次 ≤ 200 篇)。`不发 IPC。
   - `200 < n ≤ 500`:**软警告**,弹框确认 `本次导入 ${n} 篇,数量较大可能耗时较久,确认继续?`。
2. **capability 兜底(防绕过)**:`createNotesBatch`(`capability-impl.ts:603`)把现有 `items.length > 500` 的 `console.warn`(614-619 行)**升级为 throw**:`throw new Error('BatchTooLarge: ${n} > 500 notes per batch')`,返回 `{ notes:[], failures:[{index:-1, error:'BatchTooLarge'}] }`。防止任何 caller(未来 API / 脚本)绕过 renderer 拦截。

> 注:500 是篇数阈值;**单篇块数不设上限**,由 §5 分批删 + §3.3.C 分批导入承载。

---

## 5. 单篇大 note 分批删除算法

### 5.1 分批大小

- **BATCH = 1000 块**(plan 文档实测 6100 块分 7 批可行;DB 端人工清理用过 500/批)。可设环境/常量,默认 1000。
- 配套 `SURREAL_MEMORY_THRESHOLD=2gb`(spawn env,`client.ts:196`)做 OOM 兜底(PR #5221/#5704)。

### 5.2 让 note 立即从 UI 消失(pending-delete 标记)

- Step 1 小事务里给 container atom 写 `payload.deletionPending=true`(或独立 intent + UI 查 intent)。
- `listNotes` / NavSide 读侧过滤掉 `deletionPending=true` 的 container → 用户点删**立即**看到消失,后台慢慢删块。
- broadcast 在 Step 1 后立即发一次(UI 刷新),不等全删完。

### 5.3 算法(deleteNote 重写,对齐 plan 文档 + §3.3.A)

```
deleteNote(id):
  atom = getAtom(id); if !atom return
  [tx1] putAtom container { ...payload, deletionPending:true }
        INSERT intent { op:'delete-note', targetId:id, status:'pending', cursor:{deleted:0} }
  broadcastNoteListChanged()         ← UI 立即隐藏
  loop:
    batch = SELECT VALUE subject.atomId FROM edge
            WHERE predicate=belongsToNote AND object.atomId=id LIMIT 1000
    if batch empty: break
    [tx_batch] DELETE (SELECT id FROM edge WHERE subject.atomId INSIDE $batch
                       OR (object.kind='atom' AND object.atomId INSIDE $batch)) RETURN BEFORE
               DELETE (SELECT id FROM atom WHERE id INSIDE $batch) RETURN BEFORE
               UPDATE intent SET cursor.deleted += array::len($batch)
               assert deleted atoms == batch.length else throw(留 pending)
  [tx_final] deleteAtom(container)   ← 级联删 hasNoteView/inFolder/belongsToNote 残边
             DELETE intent
  verify: SELECT count() FROM edge WHERE belongsToNote.object=id == 0
  return { cascadedEdges }
```

### 5.4 storage 层需要的新出口

现 `StorageTransaction` 只有 6 个高层方法(get/put/deleteAtom/Edge),无原生 SQL 出口。分批删要走 `DELETE (SELECT ...) RETURN BEFORE` 子查询。两个选择:
- **(推荐)storage 层新增高层 API** `bulkDeleteAtomsAndEdges(atomIds: string[]): Promise<{atoms:number; edges:number}>`,内部走子查询 SQL —— 对齐 capability 边界,不暴露裸 SQL 给 capability。
- (备选)给 tx 接口加 `query(sql, vars)` 出口 —— 破坏 decision 020 §4.2 "6 方法签名 0 变化"约束,不推荐。

---

## 6. 工程量拆解(sub-phase)

> 依赖顺序 + 每个可独立交付。建议分支 `fix/note-batch-delete`(模块边界,见 `branch-module-boundary`)起,后续可拆。

### SP-1 storage 层 bulk delete API(地基,无 intent)
- 改 `src/storage/surreal/storage.ts`:新增 `bulkDeleteAtomsAndEdges(ids)`(子查询 SQL + RETURN BEFORE 自校验)。
- 风险:低(纯新增,不动现有)。依赖:无。**先做。**

### SP-2 deleteNote 分批 + deletionPending 标记 + 读侧过滤(痛点 1)
- 改 `note/capability-impl.ts:deleteNote`(分批循环走 SP-1)。
- 改 `listNotes`/读侧过滤 `deletionPending`。
- broadcast 提前。
- 风险:中(改核心删除路径,需走 plan 测试清单 6 用例)。依赖:SP-1。

### SP-3 intent 表 + migration + sweeper(可靠性核心)
- 新 migration:`DEFINE TABLE intent` + index。
- 新 `sweepPendingIntents()`,挂 `initStorage` 末尾。
- deleteNote 接 intent(游标 + sweeper 续删)。
- 风险:中(新表 + 启动序列改动,需故障注入测试"删除中 kill app → 重启续完")。依赖:SP-2。

### SP-4 deleteFolder 分批 + intent(痛点级联,最严重)
- `deleteFolder` 子树资源改分批 + `op:'delete-folder'` intent。
- `deleteSelected` 批次 intent(可选,或先靠逐项 deleteNote 各自的 intent 兜底)。
- 风险:中高(子树语义复杂)。依赖:SP-1/SP-3。

### SP-5 createNotesBatch 分批 + >500 拦截(导入)
- renderer 拦截 + capability throw(§4)。
- 超阈值分批写 + `op:'import-batch'` intent(回滚语义)。
- 风险:中。依赖:SP-3。可与 SP-4 并行。

### SP-6 graph canvas 补事务(类 B 清零)
- `canvas-store.ts` 的 createInstance/updateInstance/deleteInstanceWithCascade/persistCanvas 包进 `storage.transaction`。
- 风险:低中(decision 020 已支持,只是没用)。依赖:无,可独立先做(与 SP-1 并行)。

**推荐起步顺序**:SP-1 → SP-2(立刻解 6100 块删不掉的痛点)→ SP-3(补可靠性)。SP-6 可作为低风险并行小项随时插入。SP-4/SP-5 在体系成型后接。

---

## 7. 最小可行 vs 完整体系(决策对比)

### 档位 A — 最小可行(只修两个痛点)

**范围**:SP-1 + SP-2(deleteNote 分批 + deletionPending payload 标记)+ SP-5 的 >500 拦截。**不建 intent 表**,用 atom `payload.deletionPending` 标记 + 一个轻量 `sweepPendingDeletions()`(只扫 `deletionPending=true` 的 container,续删块)。

| 维度 | 评估 |
|------|------|
| 工程量 | ~2-3 天(SP-1 + SP-2 + payload sweeper + 拦截) |
| 收益 | 解决 6100 块删不掉(痛点 1)+ 禁超大导入(痛点 2);崩溃后能续删单篇 |
| 风险 | 低中;不引入新表/新概念,改动局部 |
| 缺口 | **只覆盖删除**;批量删/导入/graph canvas 半状态不解决;deletionPending 污染 atom payload;表达力弱(只一种意图) |

### 档位 B — 完整 intent-log 体系

**范围**:SP-1~SP-6 全做。独立 intent 表 + 通用 sweeper,统一覆盖删除/批量删/导入/未来长写。

| 维度 | 评估 |
|------|------|
| 工程量 | ~6-9 天(对齐 decision 020 工程量量级 + 测试) |
| 收益 | 通用逻辑原子性层;一次建好,删除/导入/graph/未来协作长写都复用;类 B/C 全清零 |
| 风险 | 中;新表 + 启动序列 + 多入口改造,需完整故障注入回归(每 op 一组 kill-app 测试) |
| 缺口 | 不处理 OCC 并发冲突(单机场景不需要,decision 020 §9.4 已留 Open Q) |

### 推荐

**分阶段落地 = 先 A 后 B**:先做 SP-1+SP-2 立刻止血(用户最痛的 6100 块删不掉),**但 deletionPending 直接用独立 intent 表实现(SP-3 提前)而非 atom payload** —— 这样最小档的工作量不浪费,天然长成完整档。即:**起步做 SP-1 → SP-3(intent 表)→ SP-2(deleteNote 接 intent),三步即得"可靠的单篇大删 + 通用地基";SP-4/5/6 按需续接。** 避免先做 payload 标记再推倒重来。

---

## 8. Open Questions / 风险登记

1. **OCC 并发冲突**:分批删期间用户又编辑同 note?单机单用户概率低,但 sweeper 续删与用户操作可能撞。建议 deletionPending 的 note 在 UI 锁编辑。(decision 020 §9.4 Q-tx-occ-retry 关联)
2. **intent 表进 backup?** 建议 backup 排除 intent(运维态不是知识),restore 后由 sweeper 重新评估;或 restore 后直接清 intent(restore 本身是干净快照)。
3. **sweeper 失败**:sweeper 自身崩溃 → intent 留 pending,下次启动重试(幂等保证安全)。需 log 告警避免静默堆积。
4. **graph canvas 是否需 intent**:当前节点数量级未知;先补事务(SP-6),量级爆了再接 intent。
5. **BATCH 大小调优**:1000 是经验值,需在目标机器实测内存/耗时曲线定档。
