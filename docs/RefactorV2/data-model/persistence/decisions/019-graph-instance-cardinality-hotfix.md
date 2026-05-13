# Decision 019 — Graph Instance Cardinality Hotfix (P0a-bis)

> **Phase**: N(实施 Phase)/ Hotfix(sub-phase 3a-1 cardinality 漏机制补完)
> **状态**: ✅ **实施完成,等总指挥静态复核 + binary verify**(commits `82d7f68` + `27595aa` + `8198f56` + `0fd3dda` + `4cd12f6` + 本决议)
> **设计师 / 审计师**: 总指挥(main)
> **诊断 + 实施**: `fix/graph-instance-cardinality` 分支(基于 main `f7f908d`)
> **决议日期**: 2026-05-13
> **暴露日期**: 2026-05-13(decision 017 P0a UPSERT 修法落地后,用户截图实证同一 instance `i-001` 出现在两个画板)
>
> ## TL;DR
>
> decision 017 P0a 修法把 `putAtom` 改 UPSERT 后,**揭露**(不是引入)sub-phase 3a-1
> 漏的 cardinality 机制:`inCanvas` 边在 decision 014 §3.3 line 388 **字面**拍板
> "一对一(一个 Instance 只在一个画板内)",但实施层 view + store + storage 三层
> 全部漏机制保证 → 同一个 instance atom `i-001` 出现在两个画板。
>
> **根因**:[`NodeRenderer.nextInstanceId`](../../../../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts#L257)(修复前)用 `byId.size + 1` 的 per-NodeRenderer counter 生成 `i-001` / `i-002`;NodeRenderer 是 per-canvas 实例 → counter 跨画板碰撞 → atom 表撞库。P0a 修法前 (UPDATE 抛 not found) 隐藏漏;P0a 修法后 (UPSERT 存在则更新) 化为可见(覆盖 + 一对多 inCanvas 边)。
>
> **修法三层防线 + 文档化 + 未来路径登记**:
>
> | 编号 | 修法 | commit |
> |---|---|---|
> | **K1** | view 端 client id 改 ULID 全局唯一 | `27595aa` |
> | **K2** | store `createInstance` 加 inCanvas 一对一守门 keep-latest | `8198f56` |
> | **K3+K4** | storage 启动 cardinality-check 扫 inCanvas + hasContent + 自愈(合并历史污染清理)| `0fd3dda` |
> | **K6** | inCanvas 升级归属边语义 + 三层防线落地点文档化 | `4cd12f6` |
> | **K7** | §9 留 `referencedIn` 边接口给 sub-phase 3a-shared-ref | 本决议 §9 |
>
> 同时附 ulid 抽到 `@shared/ulid` 准备(commit `82d7f68`):capability 跨层 import storage 违反 decision 008 §4 边界,故抽 shared。
>
> 本 hotfix 不动 P0d fix 分支(5 commits 未合 main),不动 sub-phase 3a-2.5 分支(3 commits 未合 main),不动 017 已合 main 的 7 commits。

---

## 0. 执行指南

### 0.1 角色与流程

```
sub-phase 3a-1 实施已完成(main HEAD f7f908d,含 017 P0a/P0c 已合)
    ↓ 用户截图实证:i-001 同时显示在两个画板
排查对话(P0a-bis session)
    ↓ 起 fix/graph-instance-cardinality(基于 main f7f908d)
    ↓ 读 InteractionController + canvas-store + storage + runner + decision 014/013
    ↓ grep client id 生成路径(NodeRenderer.nextInstanceId + 3 调用点)
    ↓ 根因 100% 闭合 + K1 修法 A/B 候选利弊
    ↓
总指挥(批复)
    ↓ Q1 拍板 A — view 端 ULID 替换;Q2 拍板 A2 — 抽 @shared/ulid;
    ↓ Q3 拍板 warn + keep-latest;Q4 拍板 K3+K4 合并,缩范围 inCanvas+hasContent
    ↓
排查对话(P0a-bis session)
    ↓ 6 commit 顺序实施(commit 1-6)
    ↓ 写本决议 019
    ↓ 报"P0a-bis hotfix 实施完成请审计"
    ↓
总指挥
    ↓ 静态复核 + 协调用户跑 binary verify 4 场景
    ↓ 通过 → 合 main + push → 反向更新决议链 014 / 016 / 017
    ↓
sub-phase 3a-2.5 实施者 / P0d fix 实施者(恢复)
    ↓ merge main 拉 cardinality 修复 → 继续推进
```

### 0.2 实施纪律(本次已遵守)

1. 起独立分支 `fix/graph-instance-cardinality` 基于 main `f7f908d`
2. **不在** P0d fix 分支(`fix/canvas-text-node-doc-sync`)上做(避免污染 P0d 5 commits)
3. **不在** sub-phase 3a-2.5 分支上做(避免违反分支按模块切纪律)
4. 每个 K 一个 commit,commit message 按 KRIG-Note V2 规范
5. 所有 Bash 命令显式 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&`(memory `feedback_v2_is_workspace_v1_is_reference` 已记 4 次 cwd 漂移事故)

---

## 1. 问题字面描述 + 实证证据

### 1.1 用户截图实证症状

同一个 text-node 同时显示在两个不同画板里。

### 1.2 数据库查询实证(2026-05-13)

**inCanvas 边表**:
```
i-001 → canvas 01KRFWE7002HR3YEZN15PT3SJ4 (title="123")  createdAt 11:00:11
i-001 → canvas 01KRFWER9B5ZB4CZEBARXGWZAH (title="456")  createdAt 06:45:50
```

**atom 表 i-001 当前 payload**:
```
ref='krig.basic.octagon' (实际形态)
updatedAt 06:45:50 (被覆盖时间)
```

→ atom 表只有 1 个 `i-001`,但 inCanvas 边有 2 条(分别指向两个画板)。业务层:同一个 instance 出现在两个画板。

### 1.3 根因实证三层

**view 端** — [`NodeRenderer.nextInstanceId`](../../../../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts#L257)(修复前):

```ts
nextInstanceId(prefix = 'i'): string {
  let n = this.byId.size + 1;
  while (this.byId.has(`${prefix}-${pad(n)}`)) n++;
  return `${prefix}-${pad(n)}`;
}
```

- counter 起步于 `this.byId.size` — `byId` 是 **per-NodeRenderer 实例**
- NodeRenderer 是 **per-canvas 实例**(每个 canvas 各一个 NodeRenderer)
- canvas A 空画板 → byId.size=0 → 生成 `i-001`
- 切到 canvas B 空画板 → byId.size=0 → 又生成 `i-001`(同名)

**调用点 grep**(NodeRenderer.nextInstanceId 全部 3 处):
- [InteractionController.placeInstance:715](../../../../../src/capabilities/canvas-rendering/interaction/InteractionController.ts#L715)
- [InteractionController 画 line:845](../../../../../src/capabilities/canvas-rendering/interaction/InteractionController.ts#L845)
- [combine.ts 合 substance:149](../../../../../src/capabilities/canvas-rendering/combine.ts#L149)

→ 3 处都拿撞库的短 id。

**store 端** — [`canvas-store.createInstance`](../../../../../src/platform/main/graph/canvas-store.ts#L301)(修复前):

```ts
async function createInstance(canvasId, inst, targetId): Promise<void> {
  const created = await storage.putAtom<'graph-instance'>({
    id: targetId ?? undefined,
    payload: { domain: INSTANCE_DOMAIN, payload },
  });
  await storage.putEdge({ predicate: IN_CANVAS_PREDICATE, ... });  // 不查既有边
  ...
}
```

→ 直接 putEdge inCanvas,**没有 cardinality 守门**。

**storage 启动** — 无 cardinality self-check。

### 1.4 P0a UPSERT 揭露而非引入

decision 017 P0a 把 putAtom 改 UPSERT(`createdAt = createdAt OR $now`)后语义正确:存在则更新,不存在则新建。问题不在 putAtom,而在它接受的 id 不全局唯一。

- **P0a 修法前**(UPDATE-only 抛 not found):view 端 `i-001` 撞库 → 第二次画板创建时 storage 抛 "Atom not found" → 写入失败,业务层看到 P0a 现象(shape 跨重启丢)
- **P0a 修法后**(UPSERT 存在则更新):view 端 `i-001` 撞库 → 第二次画板创建时 storage 覆盖 atom payload + 写新 inCanvas 边 → 业务层看到 i-001 出现在两个画板(P0a-bis 现象)

P0a 修法把"写入失败"换成"撞库覆盖",**揭露**了 sub-phase 3a-1 设计师 P1 第 7 次教训:**决议字面拍板 cardinality 一对一,但实施漏机制**。

---

## 2. 修法拍板 + 工程量

### 2.1 K1 — view 端 client id 改 ULID 全局唯一

**拍板**:方案 A(view 端 ULID 替换),非方案 B(canvas prefix)。

**理由**:
- 与 decision 006 (id-generation) / 008 (storage 接口) / 014 (atom id 全局唯一) 字面契约真正对齐
- 修一处 `NodeRenderer.nextInstanceId` 内部 = 自动覆盖 3 个调用点,零外部接口改动
- ULID 前 10 字符是毫秒时间戳 Base32,log 输出可读性其实不差(同时段创建的 instance id 共享前缀,肉眼可分组)
- 跨 canvas / 进程 / 设备(多用户阶段)天然安全

**ulid 抽离路径**:方案 A2(抽到 `@shared/ulid` + `@storage/ulid` re-export 兼容),非 A1(canvas-rendering 直接 import `@storage/ulid`)。

理由:
- decision 008 §4 字面"Capability 层允许 import StorageAPI",ulid 不属于 StorageAPI(它是 storage 内部 id 生成工具)→ A1 字面踩边界
- `src/shared/` 已有 types / constants / event-bus / ipc 模式,加 ulid 干净扩展
- canvas-rendering 当前 0 命中 `import @storage`,首次跨层 import 必须走 `@shared`

**实施(commit `82d7f68` + `27595aa`)**:

1. 新建 [`src/shared/ulid.ts`](../../../../../src/shared/ulid.ts)
2. 改造 [`src/storage/ulid.ts`](../../../../../src/storage/ulid.ts) 为 re-export(兼容现有 `@storage/ulid` import,目前仅 storage.ts:32 内部)
3. [`NodeRenderer.nextInstanceId`](../../../../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts#L257) 改 `generateUlid()` + 删 prefix 参数 + 删 pad helper

### 2.2 K2 — store `createInstance` 加 inCanvas 一对一守门

**拍板**:warn + keep-latest 自愈,非 strict throw。

**理由**:
- K1 (ULID 全局唯一) 之后此守门理论不触发(新 instance id 不可能撞既有边)→ 作为诊断窗口 + 防御未来违约
- strict throw 会让用户操作失败,与 P0a UPSERT 容错风格不一致
- 沿 decision 014 line 735 / decision 016 hasNoteView 现有一对一边自愈模式,与 KRIG vocab 体系一致

**实施(commit `8198f56`)**:

[`canvas-store.createInstance`](../../../../../src/platform/main/graph/canvas-store.ts#L301)putAtom 之后 putEdge 之前:

```ts
const existingInCanvas = await storage.listEdges({
  predicate: IN_CANVAS_PREDICATE,
  subjectAtomId: created.id,
});
if (existingInCanvas.length > 0) {
  console.warn(`[graph/canvas-store] inCanvas cardinality violation on instance ${created.id}: ...`);
  for (const e of existingInCanvas) { await storage.deleteEdge(e.id); }
}
await storage.putEdge({ predicate: IN_CANVAS_PREDICATE, ... });
```

注意:必须 await 清理后再 put 新边(不能用 fire-and-forget),否则短暂期会有 2 条边触发 K3 self-check 误报。

### 2.3 K3+K4 — storage 启动 cardinality-check + 历史污染清理(合并)

**拍板**:K3+K4 合并到 startup self-check;**范围缩到 inCanvas + hasContent**,不扫 inFolder(超 P0a-bis 范围,留 §9 Q-2)。

**实施(commit `0fd3dda`)**:

新建 [`src/storage/health/cardinality-check.ts`](../../../../../src/storage/health/cardinality-check.ts):
- 扫描 predicate ∈ `['user:krig:inCanvas', 'user:krig:hasContent']`
- 按 `subject.atomId` 分组,count > 1 标违反
- 按 `createdAt` 降序 + id 字典序降序兜底 keep-latest
- 异步删多余边,失败 warn 不中断

挂到 [`initStorage`](../../../../../src/storage/index.ts#L28) 收尾(`runMigrations` 之后,业务 IPC 之前)。

**日志格式**:
- 单条违反 warn:`[storage/cardinality-check] <predicate> violation on subject <id>: <N> edges; keep <id> (createdAt <t>), dropping <N-1> stale edges`
- 总体 log:`[storage/cardinality-check] <predicate>: scanned N edges, found M violations, cleaned K stale edges`

**K3+K4 合并的现场效果**:用户首次启动新代码,self-check 自动清当前 `i-001` 跨两 canvas 的污染(留 `createdAt` 较晚那条:`i-001 → "456" 06:45:50`,删较早的 `i-001 → "123" 11:00:11`)。

**⚠ 用户感知**:keep-latest 实际清掉的是较早画板 `"123"` 的边,跟用户可能的"`i-001` 应该属于较早的画板"主观预期相反。这是 P0a-bis 自愈的预期效果,用户操作历史回不来,需手动重做较早画板的 instance。

### 2.4 K6 — inCanvas 边语义升级文档(归属边)

**实施(commit `4cd12f6`)**:

- [`relations/spec.md`](../../relations/spec.md) §10 表 inCanvas 行 cardinality 改 "一对一(归属边,P0a-bis 机制化保证)"
- 新增 §10.1 inCanvas 归属边语义小节
- decision 014 §3.3 inCanvas 字面块后加 P0a-bis 反向更新(归属语义 + 三层防线落地点)
- decision 014 §12.9 P0a-bis 实施登记 + §12.10 P1 第 7 次教训累积

**关键文档语言**:
- 用 "归属" / "container" / "contained in" 描述
- **避免**用 "owner" 字眼(歧义大;v1 单机单用户 `createdBy='user-default'`,Owner-Editor 区分无意义)

### 2.5 K7 — §9 留 `referencedIn` 边接口

未来扩展路径登记,详 §9。

---

## 3. 验证清单

### 3.1 静态合规验证(实施者已跑)

- ✅ typecheck 0 错(`npx tsc --noEmit`,4 次 commit 后逐次跑过)
- ✅ commit 顺序符合批复字面 6 commits
- ✅ commit message 引用 commit hash 与 git log 一致
- ✅ 不动 P0d fix 分支 + sub-phase 3a-2.5 分支 + 017 已合 main commits

### 3.2 binary verify(等总指挥协调用户跑)

**场景 ①** — 启动 V2 后 cardinality-check 自愈日志:
```
[storage/cardinality-check] user:krig:inCanvas: scanned 2 edges, found 1 violations, cleaned 1 stale edges
```
+ 违反详情 warn 含 `subject i-001, keep <ULID-newer>, dropping 1 stale edge`

**场景 ②** — 启动后 query 数据库:
```
SELECT * FROM edge WHERE predicate = 'user:krig:inCanvas' AND subject.atomId = 'i-001';
```
返 1 条记录(指向 `"456"` 画板,createdAt 06:45:50)。

**场景 ③** — 跨画板创建 shape 验证 K1:
- 用户在画板 A 创建 shape + 切到画板 B 创建 shape
- query atom 表两个 instance 都是 ULID 格式(26 字符,不再是 `i-001`)
- query inCanvas 边表各只有 1 条记录指向各自画板

**场景 ④** — 重启 V2:
```
[storage/cardinality-check] user:krig:inCanvas: scanned N edges, found 0 violations, cleaned 0 stale edges
```
(数据已清,无新污染)

---

## 4. 实施 commit 链

| 序 | commit | 范围 | 内容 |
|---|---|---|---|
| 1 | `82d7f68` | K1 准备 | 抽 ulid 到 `@shared/ulid` + `@storage/ulid` re-export |
| 2 | `27595aa` | K1 | `NodeRenderer.nextInstanceId` 改 `generateUlid` + 清 prefix 参数 + 删 pad helper |
| 3 | `8198f56` | K2 | `canvas-store.createInstance` 加 inCanvas 一对一守门 keep-latest 自愈 |
| 4 | `0fd3dda` | K3+K4 | `storage/health/cardinality-check.ts` startup self-check + 历史污染清理 |
| 5 | `4cd12f6` | K6 | `relations/spec.md` §10.1 + decision 014 §3.3 + §12.9 + §12.10 反向更新 |
| 6 | (本 commit) | 决议 019 | 本决议 |

---

## 5-8. (留空,本决议不涉及)

---

## 9. Open Questions

### Q-1 未来 sub-phase 3a-shared-ref 引入 `referencedIn` 边(届时定名)

**触发条件**:用户需要"画板 B 引用画板 A 已有 instance,不改变归属"。

**字面接口预留**:

```
predicate: 'user:krig:referencedIn'   (暂定名,实施时再拍)
subject:   AtomRef(graph-instance atom)   ← 与 inCanvas 同 subject 类型
object:    AtomRef(graph-canvas atom)
cardinality: 一对多(一个 instance 可被多个 canvas 引用)
attrs:     { createdBy, createdAt }
```

**与 inCanvas 对照**:

| 边 | cardinality | 含义 | 删除规则 |
|---|---|---|---|
| `inCanvas` | 一对一 | **归属**(诞生于此 canvas)| 删归属 canvas → cascade 删 instance + 所有 `referencedIn` 边 |
| `referencedIn` | 一对多 | **引用**(可在多 canvas 显示)| 删引用 canvas → 只删该画板的 `referencedIn` 边,不动 instance / `inCanvas` 边 |

**前置依赖**:
- sub-phase 3a-tx(真原子性):多边写入需事务
- `hasBeenReferenced` flag 切换路径(decision 013 §3.5.1.bis):pm atom 出现第 2+ 条 `hasContent` 边时置 true

**当前 sub-phase 不引入此边**(避免死代码占位),仅本节登记接口。

### Q-2 `inFolder` cardinality self-check 扩展

decision 014 line 704 字面"`inFolder` 一对一约束",但本次 P0a-bis cardinality-check **不扫**(超范围)。

**触发条件**:
- 发现 inFolder 撞库 bug 实证(目前无)
- sub-phase 3b ebook 接入触发新归属场景

**实施成本**:`cardinality-check.ts` 加一行 `'user:krig:inFolder'` 到 `CARDINALITY_ONE_PREDICATES` 即可。

### Q-3 cardinality 约束升级到 storage 层

应用层 self-check 是单机单用户场景 OK 方案,**未来多用户 / 多设备并发场景**应升级到 storage 层 SurrealQL 显式约束:
- `SELECT ... WHERE NOT EXISTS` 模式 putEdge 前置守门
- partial UNIQUE index(等 SurrealDB 升级支持)

**前置依赖**:sub-phase 3a-tx 真原子性。

---

## 10. 反向更新清单(等总指挥指示)

| # | 文件 | 更新内容 | 状态 |
|---|---|---|---|
| 1 | [`decision 014 §3.3`](014-sub-phase-3a-1-graph-canvas-instance-migration.md#33-边类型规范) | inCanvas 升级归属边语义 + 三层防线落地点 | ✅ commit `4cd12f6` |
| 2 | [`decision 014 §12.9 + §12.10`](014-sub-phase-3a-1-graph-canvas-instance-migration.md#129-后续-hotfix--p0a-upsert-揭露-incanvas-cardinality-漏机制2026-05-13-p0a-bis) | P0a-bis 实施登记 + P1 第 7 次教训累积 | ✅ commit `4cd12f6` |
| 3 | [`decision 016 §10`](016-sub-phase-3a-2.5-note-form-upgrade.md) | hasNoteView 一对一同模式参考(本决议引用) | 待总指挥指示 |
| 4 | [`decision 017 §12`](017-storage-persistence-hotfix.md) | 链下游:P0a UPSERT 修法揭露 cardinality 漏,P0a-bis 补完 | 待总指挥指示 |
| 5 | [`decision 018 §12`](018-canvas-text-node-doc-sync-hotfix.md)(P0d fix 分支)| 链下游:P0d binary verify 时暴露 P0a-bis,P0d 恢复路径 | 待 P0d 合 main 后 |
| 6 | [`relations/spec.md §10.1`](../../relations/spec.md) | inCanvas 归属边语义新增小节 | ✅ commit `4cd12f6` |
| 7 | L7 启动包 | 加 P0a-bis 已知 bug 占位 → 修后清掉 | 待总指挥指示 |

---

## 12. 实施实际情况(填写于实施后)

### 12.1 commit 序列(共 6 个)

| # | commit | 范围 |
|---|---|---|
| 1 | `82d7f68` | K1 准备:抽 ulid 到 `@shared/ulid` |
| 2 | `27595aa` | K1:`NodeRenderer.nextInstanceId` 改 ULID |
| 3 | `8198f56` | K2:inCanvas 一对一守门 |
| 4 | `0fd3dda` | K3+K4:cardinality-check 自愈 |
| 5 | `4cd12f6` | K6:文档化(spec + decision 014) |
| 6 | (本 commit) | K7 + 决议 019 |

### 12.2 与本决议的偏离登记

**无偏离**:6 个 commit 全部按总指挥批复字面执行,顺序 + 范围 + 策略 + 文档语言全部对齐。

### 12.3 实施期间事故 / 障碍

**无事故**。

- `npx tsc --noEmit` 在每个代码 commit(1/2/3/4)后跑过,0 错
- decision 018 文件不在 main 分支(在 P0d fix 分支 5 commits 内),反向更新 §10 表第 5 行标"待 P0d 合 main 后"
- ulid re-export 不破坏现有 `@storage/ulid` import(grep verify 仅 storage.ts:32 内部一处)
- cardinality-check 模块改写一次(初版自拼 SurrealQL `DELETE edge:$id` 有问题,改走 `storage.deleteEdge(e.id)` 公开 API 复用 RecordId 绑定)

### 12.4 设计师 P1 教训累积(参 decision 014 §12.10)

详 [decision 014 §12.10](014-sub-phase-3a-1-graph-canvas-instance-migration.md#1210-设计师-p1-教训累积第-7-次)。

**核心沉淀**:决议字面拍板 cardinality 约束(一对一 / 一对多)**是契约,不是注释**。三层防线(view 端 id 全局唯一 + store 端 putEdge 守门 + storage 启动 self-check)必须在拍板时同步登记落地点,而非只写一行 "cardinality: 一对一"。

cardinality 约束的实施成本远小于事后排查的成本。

### 12.5 审计结论(等总指挥填)

待总指挥静态复核 + 协调 binary verify 4 场景后填。
