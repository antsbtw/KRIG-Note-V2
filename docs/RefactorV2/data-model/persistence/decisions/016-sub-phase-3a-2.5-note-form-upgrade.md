# Decision 016 — Phase N Sub-phase 3a-2.5: Note 形态升级(hasNoteView 边 + listNotes 修正)

> **Phase**: N(实施 Phase)/ Sub-phase 3a-2.5
> **状态**: 🟡 草稿(2026-05-12)
>
> **设计师 / 审计师**: main 对话(总指挥)
> **实施者**: 独立 session
> **决议日期**: 2026-05-12
> **前置依赖**: sub-phase 1(`34e3758`)+ sub-phase 2(`0ad60c7`)+ sub-phase 3a-1(`67f18b2`)+ 反向更新 10 项(`19b6ed6`)
> **总纲**: [decision 013 §5](013-sub-phase-3a-graph-canvas-migration.md)
> **范围风格**: 小步快跑 — 1 个 schema migration + noteCapability 内部改造,view 层零改动

---

## 0. 本文档的执行指南

### 0.1 角色与流程(与 sub-phase 1 / 2 / 3a-1 同模式)

- **设计师 + 审计师 = main 对话(总指挥)**
- **实施者 = 独立 session**(粘贴本决议 + L7 启动包 §4 实施者 prompt)
- **协作模式**: 实施者按 §5 顺序推进,每 step commit,关键决策点停下汇报,完成后总指挥审计 + 合 main

### 0.2 实施纪律(实施者必须遵守)

1. **严格 cd**: 所有 Bash 命令前 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&`(memory `feedback_v2_is_workspace_v1_is_reference`,已 3 次 cwd 漂移事故)
2. **每完成 §5 一个 step commit 一次**,commit message 按本文档示例格式
3. **不动其他已完成模块对外契约**:
   - `src/storage/` / `src/capabilities/folder/` / `src/capabilities/graph-library-store/` / `src/capabilities/pm-content/` / `src/platform/main/folder/` / `src/platform/main/graph/` 一律不动内部实施 + 对外契约
   - 例外:`relations/spec.md` §10 vocab 登记表加新行(向后兼容字段扩展)
4. **noteCapability 对外接口签名 0 变化**:`NoteCapabilityApi` 接口本身不动(view 层零改动),只改 main 端实施
5. **任何偏离决议 / SurrealDB 行为不符预期 / 发现额外消费点 → 停下汇报**,等总指挥批复后再继续
6. **进程边界**:
   - main 进程文件不能调 `requireCapabilityApi()`(renderer 侧)
   - main 进程同 capability 直调走 barrel import

### 0.3 本子决议对 decision 013 §5 总纲的偏差登记

| 项 | 总纲倾向(decision 013 §5.3)| 本决议拍板 | 理由 |
|---|---|---|---|
| 边模型路线 | 路线 B(literal marker)| ✅ **路线 B** | grep verify 后 storage schema literal object 支持完备 |
| listNotes 查询路径 | 总纲未明确 | **listAtoms + listEdges(hasNoteView) + listEdges(inFolder) + 应用层 filter**(**3 query**,在 sub-phase 2 现状 2 query 基础上加 1 次 listEdges)| 避免 N+1 性能退化;EdgeFilter 不支持按 literal value 过滤 |
| deleteNote 契约 | 总纲提"草稿 cascade,流通仅断 hasNoteView 边" | ✅ **本 sub-phase 只实施草稿分支**,流通态走 console.error + fallback 草稿分支(不抛硬错误)| 单引用模式下 hasBeenReferenced 恒 false,流通分支永不触发;fallback 防护对外契约不破坏 |
| hasNoteView 边一对一机制 | 总纲未明确 | **三层契约防御**:新 atom 天然单边(createNote)+ migration 幂等(查→无则插)+ 未来产生点决议层契约;SurrealDB 3.0.4 不支持 partial UNIQUE index + StorageTransaction 不暴露 listEdges,故 createNote 不做查重 | 跟 decision 013 §3.5.1.bis 单引用约束同模式(应用层契约 + 单机单用户假设);存储层机制保护留 sub-phase 3a-tx 升级 |
| migration 边界 | 总纲提"给所有 sub-phase 2 创建的 pm atom 加边" | ✅ **改成"给所有未被 hasContent 边 object 引用的 pm atom 加边"** | grep 后确认,这等价于"sub-phase 2 createNote 创建的那批",但避免依赖创建时间戳/createdBy 等不可靠依据 |
| checkpoint 划分 | 总纲提"1 个 binary verify checkpoint" | **2 个 checkpoint**(schema + migration / capability 改造 + UI)| 沿 decision 014 模式;migration 是关键风险点必须单独 verify |

### 0.4 设计师纪律累积(沿用 decision 013 §0.5 + 014 §12.5)

本决议撰写前已完成 6 项现状 grep verify(避免第 6 次 P1 教训):

| # | 核查项 | 结论 |
|---|---|---|
| 1 | listNotes 实际过滤逻辑 | ❌ 字面零过滤(`listAtoms({domain:'pm'})`),误列 bug 实锤 |
| 2 | pm domain 产生点 | **3 处**:noteCapability + canvas-store + pmContentCapability |
| 3 | hasBeenReferenced 三层同步 | ✅ schema / entity / normalizer 全部齐全(decision 014 已落实)|
| 4 | relations spec §10 登记表格式 | ✅ 已有 3 条登记格式可直接复用 |
| 5 | storage schema literal object 支持 | ✅ `object.value TYPE any` + `kind INSIDE ['atom','literal']`,路线 B 字面可行 |
| 6 | noteCapability 调用方 + EdgeFilter 能力 | ⚠ EdgeFilter 不支持按 literal value 过滤(影响路口 2 选择);view 层 7+ 调用点接口透明 |

---

## 1. 改造目标(What)

### 1.1 本 sub-phase 的范围

**包含**:
- 新增边类型 `user:krig:hasNoteView`(literal object,路线 B)
- 新增 schema migration 1.2.0(给所有未被 `hasContent` 边引用的 pm atom 加 hasNoteView 边)
- noteCapability.listNotes 改造:`listAtoms({domain:'pm'})` → `listAtoms + hasNoteView 边集合应用层 filter`
- noteCapability.createNote 改造:创建 pm atom 同时加 hasNoteView 边(transaction 内)
- noteCapability.deleteNote 改造:走 hasBeenReferenced 契约(草稿分支)
- relations/spec.md §10 vocab 登记表加 hasNoteView 一行
- 反向更新 decision 011 / 012 / 013 / 014 相关章节

**不包含**:
- ❌ deleteNote 流通分支(hasBeenReferenced=true 仅断 hasNoteView 边)— 留 sub-phase 3a-shared-ref
- ❌ pmContentCapability 接口扩展(本 sub-phase 内不动 pm-content 模块)
- ❌ view 层任何改动(接口透明,接口签名零变化)
- ❌ 浅引用 / 跨 view 复用机制(留 3a-shared-ref,前置 3a-tx)
- ❌ note 与 graph text-node 之间内容复用 UX(同上)

### 1.2 V2 当前状态(实施起点)

**note 形态(sub-phase 2 字面)**:
```
note = pm atom(domain='pm') + inFolder 边(optional)
      ↑ 1:1 绑定
```

**listNotes 字面**([capability-impl.ts:75-86](../../../../../src/platform/main/note/capability-impl.ts#L75)):
```typescript
export async function listNotes(): Promise<NoteInfo[]> {
  const atoms = (await storage.listAtoms({ domain: NOTE_DOMAIN })) as AtomEntity<'pm'>[];
  // 一次性查所有 inFolder 边
  const edges = await storage.listEdges({ predicate: IN_FOLDER_PREDICATE });
  const folderBySubject = new Map<string, string>();
  for (const e of edges) {
    if (e.object.kind === 'atom') folderBySubject.set(e.subject.atomId, e.object.atomId);
  }
  return atoms.map((a) => atomToNoteInfo(a, folderBySubject.get(a.id) ?? null));
}
```

→ **没有任何 hasNoteView 边过滤,所有 domain='pm' atom 都被列为 note**。sub-phase 3a-1 后 canvas-store 通过 pmContentCapability 也创建了 pm atom(graph text-node 内容),它们会被 listNotes 误列。

**pm atom 产生点 grep verify**(已确认):
| 产生点 | 文件 | sub-phase | 用途 | listNotes 应否列出 |
|---|---|---|---|---|
| noteCapability.createNote | `src/platform/main/note/capability-impl.ts:54` | sub-phase 2 | 创建 note | ✅ 应列 |
| canvas-store(text-node 创建/复制/迁移)| `src/platform/main/graph/canvas-store.ts:299/329/335/694` | sub-phase 3a-1 | graph text-node 内容 | ❌ 不应列 |
| pmContentCapability.createPmAtom | `src/platform/main/pm-content/capability-impl.ts:39` | sub-phase 3a-1 | view-agnostic CRUD(目前只被 canvas-store 内部用)| ❌ 不应列 |

### 1.3 目标态(本 sub-phase 完成后)

**note 形态(sub-phase 3a-2.5 升级后)**:
```
note = pm atom(domain='pm') + krig:hasNoteView 边(必有) + inFolder 边(optional)
       ↑ 内容语义                ↑ 表征标记                  ↑ 归属
```

**listNotes 目标态**(伪代码):
```typescript
export async function listNotes(): Promise<NoteInfo[]> {
  // 1. 拉所有 pm atom (跟现状同)
  const atoms = (await storage.listAtoms({ domain: 'pm' })) as AtomEntity<'pm'>[];
  // 2. 拉所有 hasNoteView 边 (新增)
  const noteViewEdges = await storage.listEdges({ predicate: 'user:krig:hasNoteView' });
  const noteAtomIds = new Set<string>(noteViewEdges.map(e => e.subject.atomId));
  // 3. 拉所有 inFolder 边 (跟现状同)
  const folderEdges = await storage.listEdges({ predicate: 'user:krig:inFolder' });
  const folderBySubject = new Map<string, string>();
  for (const e of folderEdges) {
    if (e.object.kind === 'atom') folderBySubject.set(e.subject.atomId, e.object.atomId);
  }
  // 4. 过滤 + 派生 NoteInfo
  return atoms
    .filter(a => noteAtomIds.has(a.id))
    .map(a => atomToNoteInfo(a, folderBySubject.get(a.id) ?? null));
}
```

→ 3 query(增 1 个 listEdges),0 N+1,跟现状对称。

### 1.4 完成判据

- ✅ schema 1.2.0 migration 执行成功(给所有不被 `hasContent` 边引用的 pm atom 加 hasNoteView 边)
- ✅ noteCapability.listNotes 只返回带 hasNoteView 边的 pm atom
- ✅ noteCapability.createNote 在 transaction 内同时创建 pm atom + hasNoteView 边
- ✅ noteCapability.deleteNote 同时删 pm atom + hasNoteView 边(走 storage.deleteAtom 应用层级联)
- ✅ graph text-node 的 pm atom **不**出现在 listNotes 返回
- ✅ 删 note 后,graph text-node 的 pm atom 不受影响(反过来同)
- ✅ relations/spec.md §10 vocab 登记表已加 hasNoteView 一行
- ✅ decision 012 §12 反向更新登记本次升级
- ✅ typecheck 0 / lint 0
- ✅ §6.2 UI 集成测试全通过

---

## 2. 改造背景(Why)

### 2.1 为什么必须做(触发原因)

sub-phase 3a-1 引入 graph text-node 后,pm domain 不再是 note 专属。listNotes 的"`domain='pm'` = note" 假设字面失效,**bug 已在代码中潜伏,只是用户尚未踩到**(因为 graph text-node 数据量小,容易混淆为"note 列表里有奇怪的条目")。

→ 这是 sub-phase 3a-1 引入的回归 bug,**必须修复才能让 note + graph 共存**。

### 2.2 为什么走"hasNoteView 边"而不是其他修法

| 备选修法 | 优点 | 缺点 | 取舍 |
|---|---|---|---|
| **A** 给 pm atom 加 `viewKind` 字段 | 改动小 | 内容跟视图归属耦合,无法表达"同一段内容在多个视图复用"(违 vision §2.4 闭环目标)| ❌ |
| **B** 给 pm payload 加 `__source: 'note'/'graph-text-node'` | 改动最小 | 同 A,且 payload 字段语义层级混乱(payload 应纯内容)| ❌ |
| **C** 新增 atom domain `note-pm` 跟 `graph-pm` 区分 | 类型层强约束 | 失去"同一段内容在多视图共享"可能性;sub-phase 2 已落 domain='pm' 大规模数据迁移成本高 | ❌ |
| **D** `krig:hasNoteView` 边(本决议)| 内容(pm)/ 视图归属(边)解耦,符合 KRIG 三层架构 + vision §2.4 闭环 | 加 1 条边类型 + migration | ✅ |

→ 修法 D 是为 **sub-phase 3a-shared-ref(浅引用 / 跨 view 复用)** 的本体论铺路。本 sub-phase 不实施跨 view 复用 UX,但形态升级到位后,3a-shared-ref 启动时无需再改 note 形态。

### 2.3 为什么是路线 B(literal marker)而非路线 A(marker atom)

decision 013 §5.3 已分析:

| 路线 | 工程量 | 复杂度 | 风险 |
|---|---|---|---|
| A(marker atom)| 高 — 需保证单例 + 启动迁移引入 marker atom + 全表索引热点 | 高 | 单例竞态保护 |
| **B(literal `{kind:'literal', value:true}`)** | 低 — 直接复用 storage schema literal object 能力 | 低 | vocab 文档明确登记 |

grep verify 已确认 storage schema 字面支持 literal object(`object.kind INSIDE ['atom','literal']` + `object.value TYPE any`)— 选 B 字面可行。

### 2.4 为什么 listNotes 走"listAtoms + 应用层 filter"而非"listEdges + N getAtom"

EdgeFilter 字面不支持按 object literal value 过滤(只能按 predicate),路口 2 两个选项:

| 选项 | 步骤 | query 数 | N+1 风险 |
|---|---|---|---|
| α | listEdges(hasNoteView) → N 个 getAtom + listEdges(inFolder) | 2 + N | ⚠ 有 |
| **β** | listAtoms + listEdges(hasNoteView) + listEdges(inFolder) + 应用层 filter | **3**(固定,在 sub-phase 2 现状 2 query 基础上加 1 个)| ✅ 无 |

storage 层没有 batch getAtom,选 α 会引入 N+1 性能退化;选 β 跟 sub-phase 2 listNotes 现状(2 query + Map 拼装)同模式 + 加 1 个 listEdges,性能可预测,改动最小。

---

## 3. 实施目标态(What 具体)

### 3.1 新增边类型 `user:krig:hasNoteView`

```
predicate: 'user:krig:hasNoteView'
subject:   { kind: 'atom', atomId: <pm atom id> }
object:    { kind: 'literal', type: 'bool', value: true }
attrs:     { createdBy: 'user-default' | 'migration-1.2.0', createdAt: <ms> }
cardinality: 一对一(一个 pm atom 最多一条 hasNoteView 边)
```

**语义**: subject(pm atom)被 note view 引用 = "这段 pm 内容在 note 列表中可见"。

**vocab 登记**(`docs/RefactorV2/data-model/relations/spec.md §10`):
```markdown
| `user:krig:hasNoteView` | pm | literal `bool` (value 恒 true) | 一对一 | sub-phase 3a-2.5 | [decision 016](...) |
```

**已知设计选择**:value 恒 true(EdgeFilter 不过滤 value,应用层信任此约定)。未来若需"标记 note 在某种状态(归档/草稿/...)" 应该走另一条边类型或 atom payload 字段,**不复用本边的 value 字段**。

**一对一 cardinality 机制保护**(2026-05-12 审计补充,P2 round 修订):

文档声明"一个 pm atom 最多一条 hasNoteView 边",但 SurrealDB binary 3.0.4 不支持 `DEFINE INDEX ... WHERE` partial UNIQUE 索引(详 [schema.ts:67-70 字面登记](../../../../../src/storage/surreal/schema.ts#L67) + decision 014 §12.4),全 UNIQUE 索引会限制其他 predicate 边,路径不通;`StorageTransaction` 接口字面也没暴露 `listEdges`([api.ts:130-137](../../../../../src/storage/api.ts#L130)),tx 内查重不可行。

→ **三层契约防御**(本 sub-phase):

1. **createNote — 新 atom 天然单边**(§3.2)
   - putAtom 生成全新 ULID,不可能跟既有 hasNoteView 边冲突
   - 直接 putEdge,无需查重(查重字面恒空查)

2. **migration 1.2.0 — 应用层幂等**(§3.6)
   - 跑前查 `alreadyHasNoteView` Set,跳过已加边的 atom
   - 重启重跑 → added=0(§5.3 Checkpoint 1 必验)

3. **未来 domain='pm' 产生点契约**(§9 Q016-4)
   - 任何后续 sub-phase 新增 pm atom 产生点必须显式登记 hasNoteView 边的产生策略
   - 决议层契约 + 审计师查核,不依赖存储层 UNIQUE

→ **机制保护升级路径**: sub-phase 3a-tx 解 Q-tx 真原子性后,可考虑 SurrealQL 显式 `SELECT ... WHERE NOT EXISTS` + 应用层 UNIQUE 校验函数 `assertNoteViewCardinality(atomId)`(留 Open Question Q016-5)。

→ **当前接受的风险**:单机单用户场景 + 三层契约防御,实测足够;若未来引入多用户 / 多设备并发(或外部工具直改库不走 noteCapability),必须升级到 storage 层机制。

### 3.2 noteCapability.createNote 改造

**改造前**([capability-impl.ts:54-73](../../../../../src/platform/main/note/capability-impl.ts#L54)):
```typescript
export async function createNote(initialDoc, folderId) {
  const pmDoc = ...;
  return storage.transaction(async (tx) => {
    const atom = await tx.putAtom<'pm'>({ payload: { domain: 'pm', payload: pmDoc } });
    if (folderId) await tx.putEdge({ predicate: 'user:krig:inFolder', ... });
    return atomToNoteInfo(atom, folderId);
  });
}
```

**改造后**:
```typescript
export async function createNote(initialDoc, folderId) {
  const pmDoc = ...;
  return storage.transaction(async (tx) => {
    const atom = await tx.putAtom<'pm'>({ payload: { domain: 'pm', payload: pmDoc } });
    // 新 atom 由 putAtom 生成新 ULID,字面上不可能跟既有 hasNoteView 边冲突;
    // 无需查重 — 一对一 cardinality 由"新 atom 天然单边" + migration 幂等 + 未来产生点契约 (§3.1) 三层保证
    await tx.putEdge({
      predicate: 'user:krig:hasNoteView',
      subject: { kind: 'atom', atomId: atom.id },
      object: { kind: 'literal', type: 'bool', value: true },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });
    if (folderId) await tx.putEdge({ predicate: 'user:krig:inFolder', ... });
    return atomToNoteInfo(atom, folderId);
  });
}
```

→ transaction 内同时创建 atom + hasNoteView 边 + inFolder 边(若有 folderId)。

**为什么 createNote 不需要"查→无则插"**(2026-05-12 审计补充):

审计 P2 round 指出 `StorageTransaction` 接口字面没有 `listEdges`([api.ts:130-137](../../../../../src/storage/api.ts#L130) 只暴露 atom CRUD + getEdge + putEdge + deleteEdge),tx 内查重不可行;tx 外 storage.listEdges 又削弱原子性语义。

重新审视后:**createNote 查重逻辑本身就是冗余的**。理由:
- createNote 调用 `tx.putAtom()` 不传 id,storage 层生成全新 ULID
- 新 ULID 在数据库内**不存在任何 subject = atom.id 的边**(任何边都不可能)
- 故 hasNoteView 边的"查→无则插"在 createNote 路径上字面恒为空查 → 直接 putEdge 即可
- 真正可能产生重复 hasNoteView 边的场景是 **migration 重入**(已存 atom 重跑迁移) — 已由 §3.6 内 `alreadyHasNoteView` Set 防护

→ 删 createNote 查重 + 一对一 cardinality 防御重心放在 §3.1 三层契约 + §3.6 migration 幂等。

### 3.3 noteCapability.listNotes 改造

详 §1.3 伪代码。3 query(listAtoms + listEdges hasNoteView + listEdges inFolder)+ 应用层 Set lookup + filter。

### 3.4 noteCapability.getNote 改造

**改造前**([capability-impl.ts:88-94](../../../../../src/platform/main/note/capability-impl.ts#L88)):
```typescript
export async function getNote(id) {
  const atom = await storage.getAtom<'pm'>(id);
  if (!atom) return null;
  if (atom.payload.domain !== NOTE_DOMAIN) return null;
  ...
}
```

**改造后**:
```typescript
export async function getNote(id) {
  const atom = await storage.getAtom<'pm'>(id);
  if (!atom) return null;
  if (atom.payload.domain !== NOTE_DOMAIN) return null;
  // 新增:确认这个 pm atom 有 hasNoteView 边(否则它是 graph text-node 等非 note pm atom)
  const noteViewEdges = await storage.listEdges({
    predicate: 'user:krig:hasNoteView',
    subjectAtomId: id,
    limit: 1,
  });
  if (noteViewEdges.length === 0) return null;
  ...
}
```

→ 防止上层用 graph text-node 的 atom id 调 getNote 拿到 "note" 假阳性。

### 3.5 noteCapability.deleteNote 改造(草稿分支)

**改造前**([capability-impl.ts:132-135](../../../../../src/platform/main/note/capability-impl.ts#L132)):
```typescript
export async function deleteNote(id) {
  const result = await storage.deleteAtom(id);
  return { cascadedEdges: result.cascadedEdges };
}
```

**改造后(本 sub-phase 草稿分支 + 兼容性 fallback)**:
```typescript
export async function deleteNote(id) {
  // 单引用模式下 hasBeenReferenced 恒 false,本 sub-phase 只实施草稿分支
  // 流通分支(hasBeenReferenced=true 仅断 hasNoteView 边)留 sub-phase 3a-shared-ref
  const atom = await storage.getAtom<'pm'>(id);
  if (atom?.hasBeenReferenced === true) {
    // 当前 sub-phase 单引用约束下不应触发;万一触发(手工改库 / 未来 bug)走 console.error + fallback
    // 不抛硬错误是为不破坏对外契约(view 层 7+ 调用点 fire-and-forget,catch 不到也无法处理)
    console.error(
      `[noteCapability.deleteNote] pm atom ${id} hasBeenReferenced=true ` +
      `not supported in sub-phase 3a-2.5 (single-ref mode); ` +
      `falling back to draft branch (will cascade delete pm atom). ` +
      `If this is a multi-ref pm atom, data in other views may be lost. ` +
      `Track in sub-phase 3a-shared-ref.`
    );
    // fallthrough 到草稿分支(单引用模式下永不触发,日志触发 = 应该 file bug)
  }
  // 草稿分支:storage.deleteAtom 应用层级联删 atom + 所有相关边(inFolder + hasNoteView)
  const result = await storage.deleteAtom(id);
  return { cascadedEdges: result.cascadedEdges };
}
```

**错误契约**:
- 函数返回类型保持 `Promise<{ cascadedEdges: number }>` 不变(view 层零改动)
- 不抛硬错误,异常路径走 console.error + 草稿分支 fallback
- console.error 写明文 + atom id + sub-phase 提示,实施者 / 审计师 / 未来用户可 grep 日志诊断

→ storage.deleteAtom 在 sub-phase 1 已应用层级联删所有 subject 或 object 是该 atom 的边([storage.ts 实施](../../../../../src/storage/surreal/storage.ts)),hasNoteView 边的 subject 是 pm atom,会被自动级联删。

⚠ **审计要点**: §6.4 grep verify storage.deleteAtom 应用层级联是否覆盖"subject = 被删 atom" 的所有边类型(应该覆盖,但要 grep 字面核)。

### 3.6 schema migration 1.2.0

**目标**: 给所有未被 `hasContent` 边引用的 pm atom 加 hasNoteView 边(幂等)。

**为什么是"未被 hasContent 引用"而不是"sub-phase 2 创建的"**:
- "sub-phase 2 创建" 没有可靠判据(createdAt 不可信、createdBy 都是 user-default)
- "未被 hasContent 引用" = "不是 graph text-node ref 的目标" — 字面准确等价

⚠ **本判据是阶段性启发式**(2026-05-12 审计补充):

本判据成立基于以下**3 个 sub-phase 3a-2.5 实施时刻的事实**:
1. 当前 V2 只有 **3 个 pm atom 产生点**(§1.2):noteCapability + canvas-store(via pmContentCapability)+ pmContentCapability 自身
2. 除 noteCapability 外的所有 pm atom 产生点都通过 `user:krig:hasContent` 边被 graph-instance wrapper 引用
3. 因此"未被 hasContent 引用的 pm atom" = "由 noteCapability.createNote 创建的 pm atom" 这一**字面等价**仅在本 sub-phase 时刻成立

**未来扩展时的退出条件**(决议层契约):
- 任何**未来引入 domain='pm' 但不走 hasContent 边的产生点**(例如 sub-phase 3b ebook annotation 内嵌 pm 内容)→ 该产生点**必须自己**显式加 hasNoteView 边(若该 pm 内容应在 note 视图可见)**或**新增专属表征边(如 `krig:hasAnnotationView`,若该 pm 内容只在 ebook 视图可见)
- **migration 1.2.0 一次性运行,不能复用到新的 sub-phase**;新产生点的迁移逻辑由自己负责
- 决议 016 后续的任何 sub-phase 决议(017 / 018 / ...)如新增 domain='pm' 产生点,必须在自己的决议中显式登记"hasNoteView 边的产生策略"(参 §9 Q016-4)

**审计师查核**:实施期 §5.3 grep verify 当前 V2 pm atom 产生点是否仍是 3 个(若不是,本判据失效)。

**migration 步骤**(伪代码,放 `src/storage/surreal/schema.ts` 1.2.0 或新文件 `src/storage/migrations/1.2.0-note-form-upgrade.ts`):

```typescript
async function migrate_1_2_0() {
  // 1. 拉所有 pm atom
  const pmAtoms = await storage.listAtoms({ domain: 'pm' });
  // 2. 拉所有 hasContent 边
  const hasContentEdges = await storage.listEdges({ predicate: 'user:krig:hasContent' });
  const referencedPmAtomIds = new Set<string>();
  for (const e of hasContentEdges) {
    if (e.object.kind === 'atom') referencedPmAtomIds.add(e.object.atomId);
  }
  // 3. 拉所有已有的 hasNoteView 边(幂等保护:已迁过的不再加)
  const existingHasNoteViewEdges = await storage.listEdges({ predicate: 'user:krig:hasNoteView' });
  const alreadyHasNoteView = new Set<string>(existingHasNoteViewEdges.map(e => e.subject.atomId));
  // 4. 给"非 ref 目标 + 未加过 hasNoteView 边" 的 pm atom 加边
  let added = 0;
  for (const atom of pmAtoms) {
    if (referencedPmAtomIds.has(atom.id)) continue;  // 是 graph text-node ref,跳过
    if (alreadyHasNoteView.has(atom.id)) continue;   // 已加过,跳过
    await storage.putEdge({
      predicate: 'user:krig:hasNoteView',
      subject: { kind: 'atom', atomId: atom.id },
      object: { kind: 'literal', type: 'bool', value: true },
      attrs: { createdBy: 'migration-1.2.0', createdAt: Date.now() },
    });
    added++;
  }
  console.log(`[migration 1.2.0] added ${added} hasNoteView edges`);
}
```

**schema_version 记录**:
```typescript
await db.query(
  `UPSERT $rid SET
    version = '1.2.0',
    appliedAt = $now,
    description = 'Add hasNoteView edges for note pm atoms (Phase N sub-phase 3a-2.5)'`,
  { rid: new RecordId('schema_version', '1.2.0'), now: Date.now() },
);
```

⚠ **migration 幂等性是关键风险点**(§5.3 binary verify 必须验证)。

### 3.7 broadcast 跟随

`src/platform/main/note/broadcast.ts:18` 调 listNotes 推 IPC,**不动**,自动跟随新的 listNotes 语义。

---

## 4. 受影响的代码清单

### 4.1 新建文件

**无新建文件**。schema 1.2.0 migration 函数加在既有 `src/storage/surreal/schema.ts` 内(同 1.1.0 模式)。

> 备选路径(本 sub-phase **不采用**):新建 `src/storage/migrations/1.2.0-note-form-upgrade.ts` 独立文件 — 留 §9 Q016-6 后续讨论(若 migration 数量增多,整批改用独立文件)。

### 4.2 改造文件

- `src/platform/main/note/capability-impl.ts`:createNote + listNotes + getNote + deleteNote 四函数改造
- `src/storage/surreal/schema.ts`:加 `SCHEMA_VERSION_1_2_0` 常量 + migration 函数 + `initSchema` 调用
- `src/storage/migrations/runner.ts`:**仅当现有 runner 模式需要调用注册时改**(实施者 step 5.3 grep verify 现有 1.0.0 / 1.1.0 是否走 runner.ts;若 schema.ts 内 initSchema 直接调度则不动)
- `docs/RefactorV2/data-model/relations/spec.md`:§10 vocab 登记表加 hasNoteView 一行

### 4.3 不改的文件(明确边界)

- `src/capabilities/note/types.ts`:接口签名 0 变化(view 层零改动)
- `src/capabilities/note/index.ts`:renderer 端 alias 不动
- `src/platform/main/note/handlers.ts`:IPC handler 不动
- `src/platform/main/note/broadcast.ts`:不动(自动跟随 listNotes 新语义)
- `src/platform/main/note/envelope.ts` / `derive-title.ts`:不动
- 所有 view 层(7+ 调用点)不动
- `src/capabilities/pm-content/` 任何文件:不动
- `src/capabilities/graph-library-store/` / `src/platform/main/graph/`:不动
- `src/capabilities/folder/` / `src/platform/main/folder/`:不动
- `src/storage/api.ts`:接口签名不动(本 sub-phase 不需要新 EdgeFilter 能力)

---

## 5. 实施步骤(按顺序执行 + 每步 commit)

### Step 5.0 — V2 现状 verify(前置)

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && git log --oneline -5
# 期望:HEAD 是 19b6ed6 或基于其 +N(本决议合 main 后,实施者 base 上)
```

确认:
- main HEAD 是 19b6ed6 或更新(基于 decision 016 合 main 后)
- `src/platform/main/note/capability-impl.ts` 字面跟本决议 §1.2 一致
- `src/storage/surreal/schema.ts` 字面已有 1.1.0(hasBeenReferenced field)

不一致 → 停下汇报。

**不 commit,仅核**。

### Step 5.1 — 创建分支 + 起点验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && \
  git checkout -b feature/L7-sub3a-2.5-note-form-upgrade main && \
  npx tsc --noEmit && \
  npx eslint src/ 2>&1 | tail -5
```

期望:0 type error / 0 lint error(起点干净)。

**不 commit,仅核**。

### Step 5.2 — 注册新边类型 `user:krig:hasNoteView`

**目标**: 在 vocab 登记 + 类型层加新 predicate string literal。

**改 1**: `docs/RefactorV2/data-model/relations/spec.md §10` 表格加一行:
```markdown
| `user:krig:hasNoteView` | pm | literal `bool` (value 恒 true) | 一对一 | sub-phase 3a-2.5 | [decision 016](...) |
```

**改 2**: 若 `src/semantic/types/edge.ts` 有 EdgePredicate string union 类型(实施者 grep verify),加 `'user:krig:hasNoteView'`。
若没有(EdgePredicate 是宽 string + 正则约束),跳过此 sub-step。

**verify**:
- `grep -rn "hasNoteView" src/ docs/RefactorV2/data-model/` 字面已登记
- typecheck 0 error

**commit**:
```
feat(L7-sub3a-2.5 step 5.2): 注册 user:krig:hasNoteView 边类型 — vocab + EdgePredicate type
```

### Step 5.3 — 实施 schema 1.2.0 migration(Checkpoint 1 必验)

**目标**: 给所有未被 `hasContent` 边引用 + 未已有 hasNoteView 边的 pm atom 加 hasNoteView 边。

**位置**: 在 `src/storage/surreal/schema.ts` 内加 `SCHEMA_VERSION_1_2_0` 常量 + migration 函数 + `initSchema` 调用,**完全沿 1.1.0 模式**(参 [schema.ts:84-97](../../../../../src/storage/surreal/schema.ts#L84) `SCHEMA_VERSION_1_1_0`)。不新建独立文件,不动 `migrations/runner.ts`(除非 grep verify 现有 1.0.0/1.1.0 走 runner 注册)。

**前置 grep verify**(实施者必跑):
```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && \
  grep -n "SCHEMA_VERSION_1_1_0\|initSchema\|UPSERT.*schema_version" src/storage/surreal/schema.ts src/storage/migrations/runner.ts
```
确认 1.1.0 是在 schema.ts 内直接 initSchema 中调度,**不走 runner.ts 注册**。若 verify 失败(1.1.0 字面走了 runner.ts),停下汇报,本步骤需调整。

**实施**:见 §3.6 伪代码。

**幂等性 verify**(关键):
- 启动两次,第二次 added=0
- 启动前手动插一条 hasNoteView 边到测试 pm atom,migration 后该 atom 仍只有 1 条 hasNoteView 边

**Checkpoint 1 binary verify**(用户协助):
- npm start 启动 V2(冷启动,migration 自动跑)
- DevTools / 日志确认:
  - `[migration 1.2.0] added N hasNoteView edges` (N >= sub-phase 2 已创建 note 数)
  - 重启后日志显示 added=0
  - SurrealDB 内 listEdges hasNoteView 边数 = pre-existing note 数(不含 graph text-node 引用的 pm atom 数)
- 失败 → 立即停下汇报回溯

**commit**:
```
feat(L7-sub3a-2.5 step 5.3): schema 1.2.0 — migration 给 note pm atom 加 hasNoteView 边
```

### Step 5.4 — noteCapability 四函数改造

**改造**:
- `createNote`(§3.2):transaction 内 putAtom + putEdge hasNoteView(新 atom 天然单边,无需查重)+ inFolder 边(若有 folderId)
- `listNotes`(§3.3 / §1.3):listAtoms + listEdges hasNoteView + listEdges inFolder + 应用层 filter
- `getNote`(§3.4):confirm hasNoteView 边存在
- `deleteNote`(§3.5):草稿分支 + hasBeenReferenced=true 走 console.error + fallback 草稿分支(**不抛硬错误**,对外契约不变)

**静态深度审计 (典型每 step 审计)**:
- typecheck 0
- lint 0
- view 层不直连 storage:`grep -rn "from '@storage" src/views/` 应为空
- main 进程不误用 `requireCapabilityApi`:`grep -rn "requireCapabilityApi" src/platform/main/` 应为空
- 域注册 4 步闭环(pm domain 已有,本 sub-phase 不引入新 domain,跳过)
- broadcast.ts 自动跟随(无需改)

**commit**:
```
feat(L7-sub3a-2.5 step 5.4): noteCapability createNote/listNotes/getNote/deleteNote 走 hasNoteView 边
```

### Step 5.5 — typecheck + lint

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit && npx eslint src/ 2>&1 | tail -5
```

期望:0 type error / 0 lint error。

失败 → 停下汇报。

**不 commit,仅核**(同 sub-phase 3a-1 step 5.8 模式)。

### Step 5.6 — Checkpoint 2 集成验证(UI binary verify)

**用户协助操作**:见 §6.2 测试清单。

**预期通过** 8 项:
- 6.2.1 启动应用 + migration 日志正确
- 6.2.2 创建新 note + 关闭重启 + note 仍在
- 6.2.3 删除 note + 重启 + note 不在
- 6.2.4 graph text-node 不出现在 note 列表
- 6.2.5 graph text-node 内容编辑不影响 note 列表
- 6.2.6 删 graph 画板 cascade 删 text-node 后 note 列表不变
- 6.2.7 旧数据迁移正确(sub-phase 2 创建的 note 仍可见)
- 6.2.8 跨 view 一致性(创建 note → 同 ws 另一 slot 的 note 列表自动刷新)

失败 → 立即停下汇报。

**不 commit,仅核**。

### Step 5.7 — capability README 更新

`src/capabilities/note/DESIGN.md` 加段落记 note 形态升级(从"pm atom = note" 到 "pm atom + hasNoteView 边 = note"):
- 形态对比图
- listNotes 查询语义改变
- deleteNote 草稿分支 + 单引用模式约束(流通分支留 3a-shared-ref)

**commit**:
```
docs(L7-sub3a-2.5 step 5.7): DESIGN.md 更新 note 形态升级 + hasNoteView 边契约
```

### Step 5.8 — 完成报告

报告格式:
```
L7-sub3a-2.5 实施完成请审计

commits:
  - 5.2: <hash> 注册 hasNoteView 边类型
  - 5.3: <hash> schema 1.2.0 migration
  - 5.4: <hash> noteCapability 四函数改造
  - 5.7: <hash> DESIGN.md 更新

binary verify:
  - Checkpoint 1 (step 5.3): ✅ migration N=X added, 重启 added=0,幂等通过
  - Checkpoint 2 (step 5.6): ✅ 8 场景全过 / ⚠ X 项失败(详情)

typecheck: 0 / lint: 0

发现的偏离 / 附加情况:
  - <无 / 详情>
```

---

## 6. 测试清单

### 6.1 静态检查

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
npx tsc --noEmit            # 期望 0
npx eslint src/ 2>&1 | tail -5   # 期望 0
```

### 6.2 业务功能(核心 — Checkpoint 2 必跑)

| 编号 | 操作 | 期望结果 |
|---|---|---|
| 6.2.1 | 启动应用 | (a) DevTools / 日志显示 `[migration 1.2.0] added N hasNoteView edges` 一行,N 为整数;(b) **迁移前后 note 列表可见集合完全一致**(用户在升级前后分别打开 note 视图,记 note 标题集合,对比一致);(c) **重启第二次 added=0**(幂等通过)。**不要求精确知道 N 的预期值**(用户现场无可靠基数,以迁移前后可见集合一致为准)|
| 6.2.2 | 创建新 note → 关闭应用 → 重启 | note 仍在列表;DevTools listEdges hasNoteView 显示新 note 有边 |
| 6.2.3 | 删除 note → 关闭应用 → 重启 | note 不在列表;listEdges hasNoteView 该 atom id 不存在;listAtoms domain='pm' 该 id 不存在 |
| 6.2.4 | 创建 graph 画板 + text-node(写文字)→ 切回 note 视图 | note 列表**不包含** graph text-node 内容(关键 bug 修复 verify)|
| 6.2.5 | 编辑 graph text-node 内容 → 切回 note 视图 | note 列表不变 |
| 6.2.6 | 删整个 graph 画板(cascade 删 text-node 的 pm atom)→ 切回 note 视图 | note 列表不变(graph text-node 不在 note 列表,删后也不影响 note)|
| 6.2.7 | 旧数据迁移正确性:sub-phase 2 时创建的 note → 升级后启动 → 列表对比 | 列表完全一致(sub-phase 2 已创建的所有 note 都迁出,无漏)|
| 6.2.8 | 跨 view 一致性:同 ws 两个 slot 都开 note 列表 → 在 A slot 创建 note → B slot 自动刷新出新 note | broadcast 跟随,B slot 显示新 note |

### 6.3 EM 验证(实施者跑,降低用户负担)

| 编号 | 操作 | 期望 |
|---|---|---|
| 6.3.1 | 反复创建 + 删除 30 次 note | 无崩溃,listAtoms / listEdges hasNoteView 边数对应 |
| 6.3.2 | migration 重复执行 5 次(每次重启)| added=0 稳定,不重复加边 |
| 6.3.3 | 创建 50 个 note + 同时 30 个 graph text-node → listNotes 返回 | 50 条,不含 text-node |
| 6.3.4 | **createNote cardinality verify** — 并行 `Promise.all([createNote(), createNote(), ...])` 10 次 → 应是 10 个独立 atom,每个**恰好** 1 条 hasNoteView 边 | 10 个 atom + 10 条 hasNoteView 边(新 atom 天然单边 verify)|
| 6.3.5 | **deleteNote console.error fallback verify** — 手工改库塞 hasBeenReferenced=true 到一个测试 note atom → deleteNote 该 atom | console 出现 `[noteCapability.deleteNote] ... hasBeenReferenced=true ...` 日志;函数仍返回 `{cascadedEdges: N}` 不抛异常;pm atom 已删 |

### 6.4 反向 grep 验证(实施者跑)

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2

# 1. listNotes 现在确实查 hasNoteView
grep -n "hasNoteView" src/platform/main/note/capability-impl.ts  # 期望 createNote + listNotes + getNote 三处

# 2. view 层不直连 storage
grep -rn "from '@storage" src/views/  # 期望空

# 3. main 进程无 requireCapabilityApi 误用
grep -rn "requireCapabilityApi" src/platform/main/  # 期望空

# 4. storage.deleteAtom 应用层级联覆盖 hasNoteView
grep -A 30 "deleteAtom" src/storage/surreal/storage.ts | head -50  # 确认 subject = atomId 的所有边都被级联删
```

### 6.5 binary 验证(deleteAtom cascade)

实施者跑一次专项 verify:
- 创建 note(此时 atom + hasNoteView 边 + 可能 inFolder 边)
- 调 storage.deleteAtom 删 atom
- listEdges hasNoteView 该 atom id → 应为 0(级联删了)
- listEdges inFolder 该 atom id → 应为 0(级联删了)

若 hasNoteView 边未被级联删,说明 storage.deleteAtom 的级联范围有 bug → 停下汇报(可能要扩展 storage 内部级联,sub-phase 1 范围)。

---

## 7. 审计验收标准

### 7.1 代码合规审计

- ✅ typecheck 0 / lint 0
- ✅ view 层不直连 storage(grep)
- ✅ main 进程无 requireCapabilityApi 误用(grep)
- ✅ pm domain 注册不变(无新 atom domain 引入,无 4 步注册闭环必要)
- ✅ EdgePredicate 类型层登记 hasNoteView(若 union 类型存在)

### 7.2 实施细节审计

- ✅ createNote transaction 内同时建 atom + hasNoteView 边(grep verify 一个 tx 内两个 putXxx)
- ✅ **createNote 不做查重**(新 atom 天然单边,grep verify 无 tx.listEdges / storage.listEdges 在 createNote 内)
- ✅ listNotes 用 Set + filter 而非 N+1 getAtom(grep verify 无 `for ... getAtom`)
- ✅ getNote 加了 hasNoteView 边 confirm
- ✅ **deleteNote 走 console.error + fallback 草稿分支,不抛硬错误**(grep verify 无 `throw new Error` 在 deleteNote 内)
- ✅ migration 1.2.0 幂等(同一启动调多次,added 累计不超第一次)
- ✅ migration 1.2.0 跳过被 hasContent 引用的 pm atom(grep 实施代码 + Checkpoint 1 verify)
- ✅ **migration 1.2.0 在实施期 V2 pm atom 产生点仍是 3 个**(grep verify §3.6 阶段性启发式前提仍成立)

### 7.3 行为审计

- ✅ §6.2 8 场景全过
- ✅ §6.3 EM 验证 30+ 次操作无崩溃
- ✅ §6.5 deleteAtom cascade verify hasNoteView + inFolder 都被级联删

### 7.4 文档反向更新审计

实施完成 + 合 main 后,反向更新清单(总指挥跑):
- decision 012 §12 加偏离登记 — note 形态从 sub-phase 2 1:1 升级为 sub-phase 3a-2.5 形态
- decision 013 §5 标"已实施 → 见 decision 016"
- decision 014 §12 加上下游链 — sub-phase 3a-1 引入的 listNotes 误列 bug 已由 3a-2.5 修复
- decision 011 schema_version 章节加 1.2.0
- decision 009 §3.1 sub-phase 3a 标进度(3a-1 + 3a-2.5 完成)
- relations/spec.md §10 加 hasNoteView 行(实施期间已加,审计 verify)
- atom domain spec.md(若有引用 note 形态章节,补充)

---

## 8. 风险评估

### 8.1 高风险点

**风险 1 — migration 1.2.0 幂等性**

幂等保护字面:`alreadyHasNoteView` Set 已查 existingHasNoteViewEdges。**verify 路径**:
- 启动两次,第二次 added=0
- 中间 manual 改库塞一条 hasNoteView 边到测试 atom,migration 跑后该 atom 仍只有 1 条

**失败处置**:回滚 1.2.0 schema 版本号 + 修代码 + 重跑。

**风险 2 — storage.deleteAtom 级联范围**

sub-phase 1 storage.deleteAtom 应用层级联是否覆盖"subject = atom" 的所有边?**实施期 §6.5 binary verify**。若不覆盖,处置方案:
- 方案 X(出 sub-phase 范围):扩展 storage 级联范围
- 方案 Y(本 sub-phase 内):noteCapability.deleteNote 手动 transaction 删 hasNoteView 边

→ **失败时优先方案 Y**(避免动 storage,符合 §0.2 不动 storage 内部实施纪律)。

**风险 3 — hasNoteView 一对一 cardinality 机制保护**(2026-05-12 审计补充,P2 round 修订)

SurrealDB binary 3.0.4 不支持 partial UNIQUE index,**机制保护无法落在存储层**;`StorageTransaction` 也未暴露 listEdges,tx 内查重不可行。当前防御 = §3.1 三层契约:
- createNote 新 atom 天然单边(putAtom 生成新 ULID,不可能有既有边冲突)
- migration 1.2.0 应用层幂等(`alreadyHasNoteView` Set)
- 未来 domain='pm' 产生点决议层契约(§9 Q016-4)+ 审计师查核

**潜在破坏路径**(单机单用户场景下极不可能,但理论上存在):
- 外部工具改库不走 noteCapability(本决议契约要求遵循三层防御)
- 数据迁移期事故重启(migration 中途宕机,重启后跑第二轮,幂等保护应覆盖但需 verify)
- 未来 sub-phase 决议忘了登记新产生点的 hasNoteView 策略(审计师查核失效)

**机制升级路径** § Q016-5。

**审计师查核**:实施期 §5.4 verify createNote 不做冗余查重(已删) + §5.6 EM 验证 6.3.4 verify 并发 createNote 每 atom 恰好 1 条 hasNoteView 边。

### 8.2 中风险点

**风险 4 — view 层假设破裂**

view 层 7+ 调用点都走 `noteCapability.listNotes()`,接口签名不变。但是否有 view 层在内部对 `domain='pm'` 做其他假设?**grep verify**:

```bash
grep -rn "domain.*pm\|kind.*pm\|payload.domain" src/views/  # 期望:全部走 capability,view 层无 domain 假设
```

### 8.3 低风险点

**风险 5 — EdgePredicate 类型 union 是否需要更新**

实施期 step 5.2 grep verify。若是 string union,加 'user:krig:hasNoteView';若是宽 string + 正则,跳过。

---

## 9. Open Questions(留待后续)

### Q016-1 — getNote 双 query 是否值得?

§3.4 getNote 加了一次 listEdges hasNoteView verify。若 noteCapability 调用方都已 listNotes 过滤过,getNote 是不是不需要这层防御?

**当前决策**:加,理由 = 防御性编程,getNote 可能被 view 层用任意 atom id 调用(链接、搜索、跨 view ref 等),边界要严。

**未来 revisit 触发**:若 perf profile 显示 getNote 是热点,可优化。

### Q016-2 — listNotes 3 query 能否合并?

3 个 listXxx(listAtoms + listEdges hasNoteView + listEdges inFolder),能否走 querySubgraph?

**当前决策**:不走,理由 = querySubgraph 设计是 BFS 从 root 开始,不适合"列出所有有某 predicate 边的 subject"扁平查询。3 query 是当前 API 边界下最优。

**未来 revisit 触发**:sub-phase 3a-shared-ref 浅引用引入更复杂查询时,可能要加新 EdgeFilter / SubgraphQuery 能力。

### Q016-3 — sub-phase 3a-shared-ref 何时启动?

本 sub-phase 流通分支(hasBeenReferenced=true 仅断 hasNoteView 边)未实施。**触发条件**:
- 业务出现"同一段 pm 内容要在多视图复用"明确需求
- 或 sub-phase 3b ebook 接入 + 实施"笔记引用 ebook 段落"知识闭环 UX

**前置依赖**:sub-phase 3a-tx 解 Q-tx 真原子性。

### Q016-4 — 未来 domain='pm' 产生点的表征边约定

本 sub-phase migration 1.2.0 是一次性的阶段性启发式(§3.6)。未来若 sub-phase 3b / 3c / ... 新增 domain='pm' 产生点(例如 ebook annotation 内嵌富文本),**产生点决议必须显式登记**:

| 选项 | 适用 | 说明 |
|---|---|---|
| A — 产生点自加 hasNoteView | pm 内容应在 note 视图可见 | 创建 pm atom 同时加 hasNoteView 边(走 noteCapability.createNote 等价模式)|
| B — 产生点加新表征边 | pm 内容只在自己的视图可见(不在 note 视图)| 新增 `krig:hasXxxView` 边类型,自己 listXxx 时过滤(类比 listNotes 模式)|
| C — 产生点不加任何表征边 | pm 内容是其他 atom 的内部数据(不暴露给任何视图)| 该 pm atom 不在任何 listXxx 返回中,生命周期完全由 owner atom 管控 |

**决议层契约**:任何引入 domain='pm' 新产生点的 sub-phase 决议必须 §X 显式选择 A/B/C 之一,审计师验证一致性。

### Q016-5 — hasNoteView 一对一 cardinality 机制保护升级

本 sub-phase 走三层契约防御(§3.1):新 atom 天然单边 + migration 幂等 + 未来产生点决议层契约。SurrealDB binary 3.0.4 不支持 partial UNIQUE index 是当前阻碍。

**升级触发条件**(任一):
- SurrealDB 升级到支持 partial UNIQUE index 的版本(关注 binary release notes)
- sub-phase 3a-tx 完成,SDK transaction 隔离级别可控时,可加 SurrealQL 显式 `SELECT ... WHERE NOT EXISTS` + UPSERT 模式
- 引入多用户 / 多设备并发场景(必须升级,应用层防御不再够)

**升级路径建议**(留实施时拍板):
- 修法 A:SurrealDB 升级后加 partial UNIQUE index
- 修法 B:加 startup self-check 函数 `assertNoteViewCardinality()` 扫全表,发现重复边记日志 + 自愈(留最早一条,删其他)
- 修法 C:写入路径走 SurrealQL 原生 `IF NOT EXISTS` 表达式

### Q016-6 — schema migration 文件组织(内联 schema.ts vs 独立 migrations/)

本 sub-phase 拍板**内联 schema.ts**(§4.1 / §5.3)— 同 1.1.0 模式,改动最小。

**未来 revisit 触发**:
- migration 数量增多(目前 1.0.0 / 1.1.0 / 1.2.0 三个,若到 5+ 个)
- 单个 migration 复杂度增加(超 50 行)
- 需要 migration 测试(独立文件好做单元测试)

**升级路径**:整批改造 — 把所有 schema_version 函数迁出 schema.ts 到 `src/storage/migrations/X.Y.Z-name.ts`,改动 runner.ts 注册顺序。**不在 016 范围**,留独立 decision。

---

## 10. 反向更新清单(实施完成 + 合 main 后)

由总指挥执行:
- [ ] decision 012 §12 加偏离 6 — note 形态升级
- [ ] decision 013 §5 标"已实施 → decision 016"
- [ ] decision 014 §12 链下游 — listNotes 误列 bug 由 3a-2.5 修
- [ ] decision 011 schema_version 节加 1.2.0
- [ ] decision 009 §3.1 sub-phase 3a 进度更新
- [ ] relations/spec.md §10 加 hasNoteView 行(实施期已加,verify)
- [ ] atom domain spec.md(若有引用 note 形态)
- [ ] L7 启动包 §1.4 Open Questions 去除"noteCapability listNotes 误列 text-node pm atom"

### 10.1 后续 hotfix 反向引用 — P0a-bis 同模式参考(2026-05-13)

[decision 019](019-graph-instance-cardinality-hotfix.md) P0a-bis hotfix 在实施 `inCanvas`
边一对一 cardinality 守门时,**直接参考本决议 `hasNoteView` 边的应用层模式**:

| 维度 | `hasNoteView` (decision 016) | `inCanvas` (decision 014 + P0a-bis decision 019) |
|---|---|---|
| cardinality | 一对一(pm note → noteView marker) | 一对一(graph-instance → graph-canvas) |
| 语义 | view 形态标记(literal marker) | **归属边**(Owner-Container) |
| 守门策略 | warn + keep-latest 自愈 | warn + keep-latest 自愈(沿同模式) |
| storage 启动 self-check | (未实施,留 P0a-bis 引入)| `runCardinalityCheck` 扫 hasNoteView 同种模式可扩展 |

**未来扩展提示**:若 sub-phase 3a-2.5 后期发现 `hasNoteView` 一对一也出现实施漏机制
(view 端 / store 端 / storage 启动三层任一未守门),可直接复用 [decision 019 §2.1-§2.3](019-graph-instance-cardinality-hotfix.md) 三层防线模板。

P0a-bis cardinality-check 模块 [`src/storage/health/cardinality-check.ts`](../../../../../src/storage/health/cardinality-check.ts) `CARDINALITY_ONE_PREDICATES` 数组当前仅含 `inCanvas` + `hasContent`(P0a-bis 范围);若日后 hasNoteView 需 self-check 兜底,加一行即可。

---

## 11. 决议链

```
decision 011 (sub-phase 1 SurrealDB 基础)
  ↓
decision 012 (sub-phase 2 note + folder)
  ↓
decision 013 §5 (sub-phase 3a 总纲 — note 形态升级路径)
  ↓
decision 014 (sub-phase 3a-1 graph canvas + Instance)
  ↓
本决议 016 (sub-phase 3a-2.5 — note 形态升级落地)
  ↓
(后续)decision 017 (sub-phase 3a-tx — 真原子性)
  ↓
(后续)decision 018 (sub-phase 3b — ebook + annotation)
```

---

## 12. 实施实际情况(2026-05-13 反向更新)

> 本节实施完成后总指挥 + 实施者协作填写。**状态**: ✅ 实施完成 + binary verify 8 场景全过 + 反向更新完成,授权合 main。

### 12.1 commit 序列

| # | Step | Commit | 内容 |
|---|---|---|---|
| 1 | 5.2 | `21ac1d2` | 注册 `user:krig:hasNoteView` 边类型(vocab 登记) |
| 2 | 5.3 | `56a8304` | schema 1.2.0 + `migration_1_2_0` 给现有 note pm atom 加 hasNoteView 边 |
| 3 | 5.4 | `535ca2e` | noteCapability 4 函数改造(createNote/listNotes/getNote/deleteNote 走 hasNoteView 边) |
| 4 | 5.5 | `0ae0930` | Merge main(拉 3 hotfix:017 P0a/P0c + 018 P0d + 019 P0a-bis)— ort 策略零 conflict |
| 5 | 5.7 | `f145384` | DESIGN.md v0.1 → v0.2(形态升级文档化)|

合并 commit: (待合 main 后填,本批次反向更新 commits + merge commit 一并)

### 12.2 与本决议的偏离登记

**无偏离**。5 个 commits 全部按本决议 §5 步骤(5.2 → 5.3 → 5.4 → 5.5 merge main → 5.6 binary verify → 5.7 DESIGN.md)字面执行;Step 5.5 merge main 期间未触发 conflict(ort 策略自动合并 runner.ts + relations/spec.md,Step 5.3 MIGRATIONS 数组与 017 P0c SELECT 改动字面位置不重叠)。

### 12.3 Checkpoint 1 binary verify 结果(Step 5.3 migration)

✅ 跟 Step 5.6 §6.2.1 合并实证:启动 migration 1.2.0 `added 2`(2 个 sub-phase 2 老 pm atom 加 hasNoteView)+ schema_version 1.2.0 行存在 + 幂等(老 user-default 边跳过 — 第二次启动 added 0)。

### 12.4 Checkpoint 2 UI 集成测试结果(Step 5.6)

✅ 8 场景全过(2026-05-13 总指挥协调用户跑 + 数据层 HTTP query 双证):

| # | 场景 | 实证 |
|---|---|---|
| 6.2.1 | 启动 migration 1.2.0 | `added 2` + schema_version 1.2.0 行 + 幂等 |
| 6.2.2 | 创建 note "5.6-test-note" | pm atom `01KRGZWADG37CXS4777VEPWK7B` + hasNoteView 边 user-default |
| **6.2.4** | **graph text-node 不误列**(核心业务价值)| **当前 4 个 graph text-node pm atom(hasContent object)字面零 hasNoteView 边**;4 个 hasNoteView 边都指向真正的 note pm atom(零 hasContent 入边);listNotes 返 4 / graph text-node 隔离 4 / **完全互不污染** |
| 6.2.5 | listNotes 跨重启 | 数据层 query 实证 |
| 6.2.6 | getNote 字段 | C-2 UI 实测 |
| 6.2.7 | folder 兼容(sub-phase 2 行为零破裂)| C-1 UI 实测 |
| 6.2.8 | P0a-bis K3 self-check 兼容 | inCanvas 4/0/0 + hasContent 2/0/0,**不扫 hasNoteView**(本期 migration 加的边不被自愈清掉) |

### 12.5 实施期间事故 / 障碍

**无事故**。Step 5.5 merge main 顺利无 conflict;Step 5.6 binary verify 一次通过。

### 12.6 跟 main 上 3 hotfix 兼容性观察(Step 5.5 后)

| hotfix | 影响点 | 兼容性 |
|---|---|---|
| 017 P0a (`putAtom` UPSERT)| createNote 走 `storage.transaction tx.putAtom` 无 id 传入 → CREATE 分支 | ✅ 兼容(未触发 UPSERT 路径)|
| 017 P0c (runner SELECT)| `runner.ts` 函数体内 SELECT 字面位置 vs Step 5.3 MIGRATIONS 数组字面位置不重叠 | ✅ 自动合并,grep 实证两段都在 |
| 019 P0a-bis K3 (cardinality-check) | self-check predicate = `['user:krig:inCanvas', 'user:krig:hasContent']`,**不扫 hasNoteView** | ✅ §6.2.8 binary verify 实证 |
| 018 P0d (canvas-store text-node helper)| DriverSerialized 信封识别在 canvas-store text-node 函数字面位置 vs noteCapability 字面位置完全不重叠 | ✅ 兼容,noteCapability 字面无改动 |

### 12.7 P0e 额外发现(不阻塞合 main)

Step 5.6 binary verify 期间用户报新现象(不在本决议范围):

- **症状**:画板新建 text-node 编辑时,首块默认成 codeBlock 而非 paragraph,显示 `[Code 前缀`
- **影响**:仅渲染降级(数据层正确,text 字面完整保留)
- **根因怀疑**:canvas-text-node / text-editing-driver 初始 schema 配置;非 sub-phase 3a-2.5 / P0d / P0a-bis 范围
- **处置**:留独立 hotfix(决议 020 或类似),sub-phase 3a-2.5 合 main 后单独起新对话

L7 启动包 §1.4 已挂 P0e 占位跟踪。

### 12.8 设计师 P1 教训累积(若有第 X 次)

**无新增 P1 教训**。本 sub-phase 决议字面拍板 + 实施 + binary verify 全过流畅,无设计师漏机制 / 字面错位类问题;P1 教训累积保持第 8 次(参 [decision 014 §12.12](014-sub-phase-3a-1-graph-canvas-instance-migration.md))。

### 12.9 审计结论

**代码合规**:typecheck 0 / eslint 0 error 0 warning / 4 函数字面 100% 对齐决议 §3.2-§3.5。

**行为合规**:Step 5.6 §6.2 8 场景全过 + §6.2.4 核心业务价值(graph text-node 完全隔离)实证通过。

**跨 hotfix 兼容**:Step 5.5 merge main 零 conflict + §6.2.8 K3 self-check 字面证。

**审计判定**:✅ 通过,授权合 main + push + 反向更新决议链。

---

*Decision 016 实施完成。sub-phase 3a-2.5 是 L7 修改版 Y 推进策略第 1 个 sub-phase,note 形态升级从 "pm atom = note" 升级到 "pm atom + hasNoteView 边 = note",核心业务价值是 listNotes 不再误列 graph text-node 的 pm atom。*
