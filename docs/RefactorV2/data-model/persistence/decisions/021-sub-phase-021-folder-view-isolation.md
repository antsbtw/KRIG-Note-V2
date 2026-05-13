# Decision 021 — Phase N Sub-phase 021: Folder 视图隔离(数据模型层根治)

> **Phase**: N(实施 Phase)/ Sub-phase 021(独立子阶段,非 3a/3b 链上节点)
> **状态**: 🟡 草稿(2026-05-13)
>
> **设计师 / 审计师**: main 对话(总指挥)
> **实施者**: 独立 session
> **决议日期**: 2026-05-13
> **前置依赖**: sub-phase 1(`34e3758`)+ sub-phase 2(`0ad60c7`)+ sub-phase 3a-1(`67f18b2`)+ 反向更新 10 项(`19b6ed6`)+ sub-phase 3a-2.5(`b8093d9`)+ sub-phase 3a-tx(`7ce7948` / `b6512c4`)
> **总纲**: [L7 启动包 §1.4 Q-shared-folder-ux 段](../../../notes/L7-next-phase-kickoff.md) + [decision 014 §3.5.3.3 folder-adapter 共享 atom](014-sub-phase-3a-1-graph-canvas-instance-migration.md) + [decision 012 §3.1 folder atom + inFolder 边](012-sub-phase-2-note-folder-migration.md)
> **范围风格**: 数据模型层加 view 归属边 + 2 view(note + graph)listFolders / createFolder 改造 + clearAll migration + Q7 弱保护

---

## 0. 本文档的执行指南

### 0.1 角色与流程(沿用 sub-phase 1 / 2 / 3a-1 / 3a-2.5 / 3a-tx 同模式)

- **设计师 + 审计师 = main 对话(总指挥)**
- **实施者 = 独立 session**(粘贴本决议 + L7 启动包 §4 实施者 prompt)
- **协作模式**:实施者按 §5 顺序推进,每 step commit,关键决策点停下汇报,完成后总指挥审计 + 合 main

### 0.2 实施纪律(实施者必须遵守)

1. **严格 cd**:所有 Bash 命令前 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&`(memory `feedback_v2_is_workspace_v1_is_reference`,已 5 次 cwd 漂移事故)
2. **每完成 §5 一个有代码/文档/脚本变更的 step commit 一次**(详 §5 头部分类:N 个 commit step + M 个非 commit step),commit message 按本决议示例格式;纯 verify / 自测 / 用户测试 step 不 commit
3. **不动其他已完成模块对外契约**:
   - `src/capabilities/note/` / `src/capabilities/graph-library-store/` / `src/capabilities/pm-content/` 一律不动
   - `src/platform/main/note/` / `src/platform/main/graph/` `canvas-store` 核心逻辑不动(仅 `folder-adapter.ts` 改 listFolders 过滤,见 §5)
   - `src/storage/` **核心改造点不动对外契约**(`StorageAPI` 12 个 API 签名 0 变化 / `StorageTransaction` 6 方法签名 0 变化 / `EdgeFilter` 字面 0 变化 / 现有 atom / edge CRUD 实施 0 变化)
   - **允许新增**(非"动现有对外契约"):`src/storage/migrations/021-clear-all.ts` 新文件(本决议唯一 storage 层新增点,沿 [src/storage/migrations/runner.ts](../../../../../src/storage/migrations/runner.ts) 既有 migration 目录结构)— 该文件**只调** `getDB().query()` 现有字面 API,**不**改 storage 内部 atom / edge CRUD 逻辑
   - 例外(folder capability 层):`src/platform/main/folder/capability-impl.ts` 的 `listFolders / createFolder` 改造(本决议核心改造点)+ `src/capabilities/folder/types.ts` 加 `viewType` 入参
   - **澄清"不动 src/storage" 的语义边界**(2026-05-13 P1 修订轮回应审计):"不动" = 不改 src/storage 现有任何 .ts 文件内的字面;**允许**在 src/storage/migrations/ 子目录下新建 021 专属 migration 脚本(单一新文件,不动 runner / api / surreal 子目录任一既有文件)— 与 decision 020 sub-phase 3a-tx 新建 `transaction-helpers.ts` 同模式
4. **FolderCapabilityApi 对外接口签名变化白名单**:
   - `listFolders()` → `listFolders(viewType: FolderViewType)` 必须改(本决议必要变更,3 个 caller 同步改造)
   - `createFolder(title, parentFolderId)` → `createFolder(title, parentFolderId, viewType: FolderViewType)` 必须改
   - 其他 5 API 签名不动
5. **SDK 版本锁定 surrealdb@^2.0.3**:沿 [SDK-version-binding-policy.md](../SDK-version-binding-policy.md) v1.2 纪律,本 sub-phase 不升级
6. **任何偏离决议 / SurrealDB binary 行为不符预期 / 发现额外消费点 → 停下汇报**,等总指挥批复后再继续
7. **进程边界**:
   - folder 改造仅在 main 进程,renderer 通过 IPC 透传 viewType 字段
   - main 进程 capability 通过 barrel `import { listFolders, createFolder } from '@platform/main/folder'` 调用(folder-adapter 现状已合规,沿用)
8. **clearAll migration 必须 binary verify**:本决议含一次性 clearAll 重置数据库,实施期间必须 binary verify "clearAll 后启动应用 → 看到空 folder 列表 + 现有 note/graph 全部消失",避免半成功污染

### 0.3 本子决议对 L7 启动包 §1.4 Q-shared-folder-ux 总纲的偏差登记

| 项 | L7 启动包字面 | 本决议拍板 | 理由 |
|---|---|---|---|
| 范围 | "数据模型加 folder ↔ view 归属字段或边类型(技术路径属性 vs 边待拍板)" | ✅ **拍板:边表达 `user:krig:folderForView`**(2026-05-13 用户拍板) | 跟 decision 014 / 016 同型(用边表达 view 归属);未来 vision §2.4 闭环若要 folder 跨 view 共享,加多条 folderForView 边即可(属性表达不可扩) |
| 范围 view 数 | "note / graph / 未来 ebook 共享 folder 树" | ✅ **仅改 note + graph 2 view**(2026-05-13 用户拍板) | grep 现状(§1.2)字面:note + graph 现状通过 folder-adapter 共享 atom,ebook 现状独立 JSON 树未接 atom;ebook 留 sub-phase 022 接入时直接上新隔离模型 |
| migration 策略 | "schema migration:现有共享 folder 数据怎么归属(待拍板)" | ✅ **clearAll 完全重置数据库**(2026-05-13 用户拍板) | 用户现阶段 SurrealDB 数据为测试数据,clearAll 是最简洁路径;migration 启动脚本扫 folder atom 加 folderForView 边的复杂度在测试数据期不必引入 |
| Q7 范围 | "Q7 仍含'含资源 folder 删除前弹窗 + 回收站',留 decision 021 一并讨论" | 🟡 **弱处理:仅含资源 folder 删除前弹框确认**,回收站留独立决议 023 | 隔离后用户根本看不到非己建 folder,Q7 的"误删跨视图 folder"风险已根除;剩余的"删 folder 同时 cascade 删 N 资源"风险用一个轻量弹框就够,回收站完整设计(undo / trash domain)留 023 |

### 0.4 设计师纪律累积(沿 decision 013 §0.5 + 014 §12.5 + 016 §0.4 + 017 §9 + 020 §0.6)

本决议撰写前已完成 8 项现状 grep verify(避免第 5/6/8/11/12/13 次 P1 教训复现):

| # | 核查项 | 结论 |
|---|---|---|
| 1 | 现状 note 路径 listFolders 实施 | ✅ [folder/capability-impl.ts:70](../../../../../src/platform/main/folder/capability-impl.ts#L70) listFolders 全表扫 folder domain atom + 一次性查所有 inFolder 边,无 view 过滤 |
| 2 | 现状 graph 路径 listFolders 实施 | ✅ [graph/folder-adapter.ts:18-26](../../../../../src/platform/main/graph/folder-adapter.ts#L18) 直 import `@platform/main/folder` listFolders → 套 GraphFolderRecord 字段映射壳(snake_case + sort_order) → **完全共享 atom** |
| 3 | 现状 ebook 路径 listFolders 实施 | ⚠ [ebook/bookshelf-store.ts:335-339](../../../../../src/platform/main/ebook/bookshelf-store.ts#L335) **完全独立 JSON 树**(`{userData}/krig-data/ebook/bookshelf.json`),跟 atom 体系零接触 → 本决议不涉及,留 sub-phase 022 |
| 4 | krig vocab 现状边类型 | ✅ grep `user:krig:*` 字面:已用 `inFolder`(decision 012)/ `hasNoteView`(decision 016)/ `hasContent`(decision 014)/ `inCanvas`(decision 014)— 本决议新增 `user:krig:folderForView` 不撞名 |
| 5 | SurrealDB schema FoldatomViewMarker | ❌ 现状 schema 字面:`folder` domain payload 字面 `{ title: string }`(decision 012 §3.1)—**无 viewType 字段**;本决议拍板用边表达而非加 payload 字段,sub-phase 启动前 schema 字面 0 影响 |
| 6 | 3 视图 listFolders / folderList 字面消费点 | ✅ grep:`src/views/note/extraction-import.ts:177` + `src/views/note/tree-operations.ts:49,133` + `src/views/note/use-notes-folders.ts:45`(note,**3 处真消费**)+ `src/views/graph-canvas-view/nav-side-content.tsx:83`(graph,**1 处**)+ `src/views/ebook/nav-side-content.tsx:87`(ebook,**1 处** — 本决议不动)|
| 7 | **EdgeEndpoint LiteralValue 字面形态**(2026-05-13 自审命中)| ⚠ [semantic/types/edge.ts:14-21](../../../../../src/semantic/types/edge.ts#L14) 字面:`StringLiteral = { kind: 'literal'; type: 'string'; value: string }` — **必须带 `type` 字段**;本决议 §4.1 草案漏 type 字段已修正(`object: { kind: 'literal', type: 'string', value: '__view__/note' }`)|
| 8 | **`storage.clearAll()` API 是否字面存在 + `EdgeFilter` 是否字面支持 object literal filter**(2026-05-13 自审命中)| ❌ 两项**都不存在**:[storage/api.ts:21-66](../../../../../src/storage/api.ts#L21) `StorageAPI` 12 API 无 `clearAll`;[storage/api.ts:108-117](../../../../../src/storage/api.ts#L108) `EdgeFilter` 7 字段(predicate / source / vocabulary / subjectAtomId / objectAtomId / createdAtRange / limit / offset / orderBy / orderDirection)**无 `objectLiteralValue`**;现状只能拉全 predicate 字面后应用层 filter 。第 15 次教训登记(§0.7)|

**本决议拍板时不再做 binary 假设**,§5 实施步骤 5.0 实施者复核 verify 后再固化路径细节。

**§0.4 第 8 项触发的本决议字面修正**:
- **§4.1 草案**:`createFolder` 写边的 `object` 字面加 `type: 'string'`,完整形态 `{ kind: 'literal', type: 'string', value: viewMarker }`
- **§7 clearAll migration**:废弃 `storage.clearAll()` 调用(API 不存在),改用"实施期 main 端启动早期直接调 [client.ts](../../../../../src/storage/surreal/client.ts) `getDB().query('BEGIN TRANSACTION; DELETE atom; DELETE edge; COMMIT TRANSACTION;')` **单次 query 内的多语句事务脚本**(沿 sub-phase 3a-tx 路径 1 同模式 — 单次 query 内 BEGIN/COMMIT 字面在 decision 020 §3.5.bis 场景 1/3/5 中已 binary verify 跨语句原子)+ 错误处理。术语澄清:不是"单 SQL 语句",而是"单次 query 调用承载的多语句事务脚本"。
- **§4.1 listFolders 草案**:应用层 filter object.kind === 'literal' && object.value === viewMarker(决议字面已对齐,§0.4 第 8 项发现已无后续影响);未来若性能差,留 Q-021-storage-listEdges-literal-filter 启动扩 EdgeFilter 接口 sub-phase

### 0.5 用户 P0 纪律:数据模型层根治不是视图层补丁

**用户 2026-05-13 拍板**(sub-phase 3a-tx 收尾对话末段):
> "数据模型层解决,不是视图层补丁;folder 作为 atom(点),通过关系(边)或属性(payload 字段)区分视图归属;具体路径(属性 vs 边)留 decision 021 实施层决定。"

**本决议拍板**(本决议 §4 详):
- 走 **边表达** `user:krig:folderForView`(folder atom → ViewType literal '__view__/note' 或 '__view__/graph')
- 一个 folder atom 可以挂多条 folderForView 边(将来 vision §2.4 闭环若要"标签云式 folder 跨 view 共享")
- 视图 listFolders 必须过滤 folderForView 边 = 当前 viewType,无 folderForView 边的 folder atom 默认所有视图都不可见(避免 migration 后的孤儿 folder)

**纪律登记**:不接受视图层补丁(如:UI 加 view tab 但底层仍共享数据 + 删除时仅前端隐藏),必须改 storage / capability 层 listFolders 查询字面。

### 0.5.bis 用户 P0 授权:本决议顺手改 SDK-version-binding-policy.md §2.2 正文(2026-05-13 P1 修订轮)

**审计触发**:决议 021 第一版草稿 §8 + Step 5.7 字面要给 [SDK-version-binding-policy.md](../SDK-version-binding-policy.md) §2.2 加第 6 / 7 步规则正文(承载第 14 / 15 次设计师教训)。按 policy §7.1 字面("规则正文 §1-§3 / §5 修订必须独立决议 + 用户 P0 授权,不允许业务决议内'顺带改'"),需用户显式授权。

**用户 2026-05-13 P1 修订轮拍板**(本对话 AskUserQuestion 字面):
> 选项:**"021 顺手改 + 本对话补授权落点(推荐)"**

**授权范围**(本决议字面登记):
- 授权 **decision 021** 在 §8 反向更新清单 + Step 5.7 一并修改 SDK-version-binding-policy.md §2.2(第 6 / 7 步规则正文增加)
- 修改内容:第 6 步加"启动包 / 总纲文档字面区分现状 vs 未来计划"(承载第 14 次教训);第 7 步加"决议引用 storage API / 类型字段前必须 grep 真实接口字面 + LiteralValue 字面三字段 `{ kind, type, value }` 缺一不可"(承载第 15 次教训)
- 同步要求:policy §6 修订记录表加 v1.3 条目,指向 decision 021

**为什么满足 policy §7.1 合规**:
- 独立决议:✅ decision 021 是 sub-phase 021 独立决议,非业务 sub-phase 决议内"顺带改"
- 用户 P0 授权:✅ 本节字面登记,跟 §0.5 "数据模型层根治"P0 字面同标准

**纪律登记**:本次授权**仅本决议范围有效**;未来若再有决议要改 SDK-policy 规则正文,**仍需独立 P0 授权**,不允许引用本节作为通用授权先例。

### 0.6 设计师累积教训(第 14 次:启动包字面描述未来意图而非现状)

**本次教训**:L7 启动包 §1.4 字面"note / graph / 未来 ebook 共享 folder 树"读起来像是"3 个 view 现状全部共享",但 grep 现状字面(§0.4 第 3 项)发现 ebook 现状是**独立 JSON 树**,跟 atom 完全没接触。"共享 folder 树"只描述 sub-phase 3b 接入计划,**未现状真实状态**。

总指挥若按启动包字面拍板"021 处理 3 view 共享拆分",会引入 ebook 一边迁 folder atom 一边书条目还在 JSON 的中间态复杂度。**实证**:本对话 §1.4 第 1 轮 AskUserQuestion 拍板"3 view 全部隔离"后,grep verify 后第 2 轮纠正到"仅改 note + graph 2 view"(用户拍板新选项)。

**纪律升级**(跟第 11/13 次教训同型):
- **启动包 / 任意文档字面描述涉及"现状 + 未来计划"混述时,grep 实证哪些是现状哪些是未来计划**
- 文档字面"X / Y / 未来 Z 共享 ABC" → 必须区分"X / Y 现状共享 ABC" + "未来 Z 接入 ABC"两层
- 实证手段:grep 当前实施代码 + 查相关 capability 跳转字面,不能只读总纲文档字面

**项目级落地**:本教训登记 [SDK-version-binding-policy.md](../SDK-version-binding-policy.md) §2.2 "项目术语必须 grep 实证"段后追加"启动包 / 总纲文档字面区分现状 vs 未来计划"作为第 6 步证据。

---

### 0.7 设计师累积教训(第 15 次,2026-05-13 决议自审命中)

**本次教训**:本决议 §3 / §4 / §7 草案字面假设 `storage.clearAll()` API 存在 + `EdgeFilter` 支持 objectLiteralValue filter,自审 grep [src/storage/api.ts:21-117](../../../../../src/storage/api.ts#L21) 发现**两项均不存在**。第 5/11 次教训复现:"假设已实施模块自动支持新需求 → 必须 grep 代码字面行为验证"。

**触发场景特性**:
- decision 020 §3.5.ter binary verify 实证"单语句 BEGIN/COMMIT 字面跑通 OCC 语义",**容易让设计师推测"clearAll 也是单语句"**
- LiteralValue 字面在 [semantic/types/edge.ts:14](../../../../../src/semantic/types/edge.ts#L14) 明确含 `type` 字段,**但本决议第一版草案漏掉**(只写 `{ kind: 'literal', value }`)→ 跟 sub-phase 3a-1 P0a 三层防线漏掉 cardinality 一对一约束同型(decision 019 §2.1)

**纪律升级**(跟第 11/13/14 次教训同型):
- **决议字面引用任何 storage API / 类型字段时,必须 grep 真实接口字面**(decision 020 §0.6 第 9 次教训"grep package.json + .d.ts 字面证据" → 扩展到"grep 项目内 storage API 字面 + 语义层类型字段")
- **避免推测"既然 putAtom 实现了 X,clearAll 应该也实现了"**:每个 API 独立验证
- LiteralValue 字面三字段 `{ kind, type, value }` 缺一不可,后续决议引用 EdgeEndpoint literal 形态必须**完整字面 type 字段**

**项目级落地**:本教训跟第 14 次一起登记 [SDK-version-binding-policy.md](../SDK-version-binding-policy.md) §2.2 第 6 / 7 步证据(本决议 §8 落点)。

---

## 1. 改造目标(What)

### 1.1 本 sub-phase 的范围

**包含**:
- 引入新边类型 [`user:krig:folderForView`](§4.1):subject = folder atom,object = view literal marker(`'__view__/note'` 或 `'__view__/graph'`)
- 改造 [folder/capability-impl.ts](../../../../../src/platform/main/folder/capability-impl.ts) `listFolders` / `createFolder`:加 `viewType` 入参 + 过滤逻辑 / 写边逻辑
- 改造 [folder/types.ts](../../../../../src/capabilities/folder/types.ts) FolderCapabilityApi:`listFolders / createFolder` 签名加 viewType,新增 `FolderViewType` 类型
- 改造 [folder/handlers.ts](../../../../../src/platform/main/folder/handlers.ts):FOLDER_LIST / FOLDER_CREATE handler 透传 viewType
- 改造 [folder/index.ts](../../../../../src/capabilities/folder/index.ts):renderer 入口 + capability registry 同步
- 改造 [folder-adapter.ts](../../../../../src/platform/main/graph/folder-adapter.ts):graph 路径 listFolders / createFolder 强制 'graph' viewType
- 改造 [shared/ipc/electron-api.d.ts](../../../../../src/shared/ipc/electron-api.d.ts) + preload:folderList / folderCreate 签名同步
- 4 处 caller 改造(note 3 处 + graph 1 处)pass `viewType` 字面
- 一次性 clearAll migration 脚本(本决议提供)+ §5 Step 5.6 启动时执行
- Q7 弱保护:`deleteFolder` 前判断含资源数 + UI 弹框(本决议 §5.5)
- 反向更新 decision 012 / 014 / 016 / 020 / pm-content README / folder DESIGN / L7 启动包

**不包含**:
- ❌ ebook view folder 改造(留 sub-phase 022,本决议字面不涉及 `ebook-library` 任一 capability / store)
- ❌ folder atom 跨视图共享(将来 vision §2.4 加多条 folderForView 边即可,本决议设计上预留)
- ❌ 回收站(trash domain / undo)— 留独立 decision 023
- ❌ folder 排序持久化(sort_order 仍由 folder-adapter 生成,decision 014 §3.5.3.4)
- ❌ folder cascade 语义变更(沿 decision 020 §7.5 Path Y 整子树删除)
- ❌ ebook 自有 JSON folder 树改造

### 1.2 V2 当前状态(实施起点)

**核心字面证据(§0.4 grep verify 6 项)**:

| 模块 | 文件 | 行 | 现状 |
|---|---|---|---|
| folder capability main | [folder/capability-impl.ts](../../../../../src/platform/main/folder/capability-impl.ts) | 70-86 | `listFolders` 全表扫 folder domain atom + 一次性查所有 inFolder 边,**无 view 过滤** |
| folder capability main | [folder/capability-impl.ts](../../../../../src/platform/main/folder/capability-impl.ts) | 49-67 | `createFolder` 写 folder atom + (可选)putEdge inFolder,**无 folderForView 边** |
| folder capability renderer | [folder/index.ts](../../../../../src/capabilities/folder/index.ts) | 22-32 | `createFolder(title, parentFolderId)` / `listFolders()` 签名 |
| folder types | [folder/types.ts](../../../../../src/capabilities/folder/types.ts) | 23-29 | `FolderCapabilityApi` 7 API,无 viewType |
| graph folder-adapter | [graph/folder-adapter.ts](../../../../../src/platform/main/graph/folder-adapter.ts) | 18-26 | 直 import `@platform/main/folder` 的 listFolders / createFolder / renameFolder / moveFolder / deleteFolder |
| graph IPC handler | [graph/library-handlers.ts](../../../../../src/platform/main/graph/library-handlers.ts) | 39-50, 102, 105-112 | GRAPH_CANVAS_CREATE / GRAPH_FOLDER_LIST / GRAPH_FOLDER_CREATE handler **直调 canvasStore.folderList()** / `canvasStore.folderCreate()`(canvasStore 内部走 folder-adapter)|
| ebook folder | [ebook/bookshelf-store.ts](../../../../../src/platform/main/ebook/bookshelf-store.ts) | 333-389 | `folderList / folderCreate / folderRename / folderDelete / folderMove` **5 个独立 JSON 实施**,与 atom 零接触 — **本决议不涉及** |
| krig vocab 已登记 | (grep `user:krig:*`)| - | `inFolder / hasContent / hasNoteView / inCanvas`,本决议新增 `folderForView` |

**caller 字面(4 处真消费)**:

| view | 文件 | 行 | 现状字面 |
|---|---|---|---|
| note | [src/views/note/extraction-import.ts](../../../../../src/views/note/extraction-import.ts) | 177 | `folderCap().listFolders()` |
| note | [src/views/note/tree-operations.ts](../../../../../src/views/note/tree-operations.ts) | 49, 133 | `folderCap().listFolders()`(×2 处)|
| note | [src/views/note/use-notes-folders.ts](../../../../../src/views/note/use-notes-folders.ts) | 45 | `folder.listFolders()` |
| graph | [src/views/graph-canvas-view/nav-side-content.tsx](../../../../../src/views/graph-canvas-view/nav-side-content.tsx) | 83 | `library.folderList()`(走 graph-library-store → IPC → canvasStore → folder-adapter)|

### 1.3 目标态(本 sub-phase 完成后)

**新 folder 数据模型**:

```
folder atom (domain='folder', payload={title})
  ├─ user:krig:inFolder edge (subject=this folder, object=parent folder atom)  -- 嵌套结构,沿 decision 012
  └─ user:krig:folderForView edge (subject=this folder, object=view marker)    -- view 归属,本决议新增
       └─ object 形态:literal '__view__/note' 或 '__view__/graph'
       └─ 一个 folder atom 可以挂多条 folderForView 边(将来跨 view 共享场景)
       └─ 0 条 folderForView 边的 folder atom = "孤儿"(所有视图都不可见,启动时清理)
```

**新 capability 接口**:

```typescript
// folder/types.ts(新增)
export type FolderViewType = 'note' | 'graph';   // ebook 留 sub-phase 022

// folder/types.ts(改造)
export interface FolderCapabilityApi {
  createFolder(
    title: string,
    parentFolderId: string | null,
    viewType: FolderViewType,   // 本决议新增,必传
  ): Promise<FolderInfo | null>;
  listFolders(viewType: FolderViewType): Promise<FolderInfo[]>;   // 本决议新增 viewType 入参,必传
  // 其他 5 API 签名不动:getFolder / renameFolder / moveFolder / deleteFolder / onListChanged
}
```

**新 caller 字面**:
```typescript
// note view
folder.listFolders('note')      // 4 个 caller 全部加 'note' 字面
folder.createFolder(title, parentId, 'note')

// graph view
library.folderList()            // 内部 IPC → canvasStore.folderList() → folder-adapter 强制传 'graph'
library.folderCreate(title, parentId)  // 内部强制 'graph'
```

**clearAll 启动 migration**(§7 详):
- 启动时,本决议代码加一次性 migration 检测 + 执行
- 执行内容:wipe SurrealDB (DELETE atom; DELETE edge;)
- 标记位:写一个 `migration-021-completed` flag 文件到 userData/krig-data/,避免重复执行

### 1.4 风险陈述

| 风险 | 影响 | 缓解 |
|---|---|---|
| **clearAll 误用**(用户已在 V2 录入正经数据)| 数据全部丢失 | 1. 用户在 §0.5 + AskUserQuestion 显式拍板"测试数据,可重置";2. §5 Step 5.6 启动 migration 前 console.warn 显式告知;3. migration flag 写入后绝不重跑 |
| **clearAll 与 sub-phase 3a-tx OCC 冲突**(决议 020 §3.5.ter)| migration SQL 失败 | clearAll 跑在 V2 启动早期,无其他并发事务;binary verify §6.1 单独验 |
| **2 view caller 改造不完整**(漏 grep 字面)| listFolders / folderList 调用编译错误 | §5 Step 5.0 实施者复 grep 6 项确认 4 caller 字面;TypeScript 编译期间 errors 暴露漏改 |
| **folder-adapter 内 listFolders 字面期望"返全 folder"**(decision 014 §3.5.3.3)| 改成传 'graph' 后 adapter 内部行为可能错位 | §5 Step 5.3 改 folder-adapter listFolders 字面**显式传 'graph'**,语义对齐 |
| **graph-library-store IPC channel 改字段**(graphFolderCreate 加 viewType)| 跨 IPC 边界增加字段 | 本决议拍板:graph 路径 IPC channel **不**加 viewType,viewType 字面在 main 端 folder-adapter 内部硬编 'graph';renderer 透明 |
| **note view 4 caller 漏传 viewType**(TypeScript 兜底)| TypeScript 编译错误 | §5 Step 5.4 改完所有 caller 字面后 typecheck;CI 拦截漏改 |
| **Q7 弹框 UX 在 deleteFolder 链上**(已含资源 cascade)| 弹框逻辑需要含资源数预查 | §5.5 加 deleteFolder 前 listEdges(inFolder, object=folderId) 计数 + UI 弹框 |

---

## 2. Q-shared-folder-ux 历史 + 用户拍板回顾

### 2.1 Q-shared-folder-ux 起源

**Q-shared-folder-ux** 由 [L7 启动包 §1.4](../../../notes/L7-next-phase-kickoff.md) 在 sub-phase 3a-tx 收尾对话末段(2026-05-13)首次记录:

> note / graph / 未来 ebook **共享 folder 树**(decision 014 §2.3 字面拍板 + canvas-store.ts:756 注释),用户在 note 模式建的文件夹,在 graph 模式也可见,但**内含 note 在 graph 模式不可见**,易引发误删("看着是空文件夹,实际有 note")。
>
> **根因**:共享语义层 + 视图内容隔离,缺"跨视图删除保护 + 内容指示"UX。

### 2.2 用户 2026-05-13 拍板核心两点(sub-phase 3a-tx 收尾对话)

1. **各视图 folder 归自己管 + 显示规则**:每个视图(note / graph / future ebook)有自己的 folder 树;显示规则:每个视图只显示自己的 folder + 自己的文档;folder 功能(样式 / 创建 / 递归删除)所有视图一致。

2. **数据模型层解决,不是视图层补丁**:folder 作为 atom(点),通过关系(边)或属性(payload 字段)区分视图归属;具体路径(属性 vs 边)留 decision 021 实施层决定。

### 2.3 本决议 2026-05-13 后续 5 点拍板细化

1. **顺序**:021 先 / 022 后(021 拍 folder 视图隔离模型 + 现有 folder 处理,022 ebook 接入新模型)
2. **范围**:仅改 note + graph 2 view(ebook 留 022,现状独立 JSON 树未接 atom)
3. **数据模型表达**:边表达 `user:krig:folderForView`(对齐 decision 014 / 016 同型边)
4. **现有 folder migration**:完全 clearAll 重置数据库(用户现阶段为测试数据)
5. **Q7 范围**:弱处理,仅含资源 folder 删除前弹框确认(回收站留独立 decision 023)

---

## 3. 候选路径对比 + 拍板

### 3.1 路径 1:边表达 `user:krig:folderForView`(本决议拍板)

**实施核心**:
```typescript
// 新边类型 user:krig:folderForView
edge:
  predicate: 'user:krig:folderForView'
  subject: AtomRef(atomId=<folder atomId>)
  object: LiteralMarker('__view__/note' 或 '__view__/graph')
  attrs: { createdBy: 'user-default', createdAt: ... }
```

**listFolders 改造**:
```typescript
async function listFolders(viewType: FolderViewType): Promise<FolderInfo[]> {
  // 一次性查所有 folderForView 边,按 subject 索引
  // ⚠ EdgeFilter 字面不支持 objectLiteralValue (§0.4 第 8 项),只能应用层 filter
  const viewMarker = `__view__/${viewType}`;
  const allViewEdges = await storage.listEdges({
    predicate: 'user:krig:folderForView',
  });
  const folderIdsInView = new Set(
    allViewEdges
      .filter((e) => e.object.kind === 'literal' && e.object.value === viewMarker)
      .map((e) => e.subject.atomId)
  );
  // 拉对应 atom + inFolder 边(parentId)
  const atoms = (await storage.listAtoms({ domain: 'folder' })) as AtomEntity<'folder'>[];
  const inViewAtoms = atoms.filter((a) => folderIdsInView.has(a.id));
  // ... 沿 §4.1
}
```

**优点**:
- ✅ 跟 decision 014 / 016 同型(`inCanvas` / `hasNoteView` 都用边表达 view 归属 / 容器归属)
- ✅ folder atom 不动 payload,schema 0 变更(只加新边类型登记)
- ✅ 跨 view 共享 folder 预留扩展性(同一 folder atom 可挂多条 folderForView 边)
- ✅ migration 干净:clearAll 后新创建的 folder 直接走新路径

**风险**:
- ⚠ `storage.listEdges` EdgeFilter **字面不支持** `objectLiteralValue` filter(§0.4 第 8 项确认),只能应用层 filter — folder 量大时性能差(O(N folderForView 边));留 Q-021-storage-listEdges-literal-filter 业务真撞性能时启动扩接口 sub-phase
- ⚠ 4 caller 改造工程量(note 3 处 + graph 1 处)
- ⚠ 老共享 folder 数据全部 clearAll(用户拍板可接受)

### 3.2 路径 2:atom payload 加 `viewType` 字段(候选 fallback A)

**实施核心**:
```typescript
// folder atom payload 扩展
{
  payload: {
    domain: 'folder',
    payload: { title: string, viewType: 'note' | 'graph' }   // 加新字段
  }
}
```

**优点**:
- ✅ listFolders 查询简单:`storage.listAtoms({ domain: 'folder' }).filter(a => a.payload.payload.viewType === viewType)`
- ✅ 单 SQL 查询,性能好(WHERE viewType=...)

**风险**:
- ❌ folder 不可跨 view 共享(payload 字段是单值)— vision §2.4 闭环未来扩展性差
- ❌ schema 字段加法(payload.viewType)— 现有 folder atom 全部要 migration(clearAll 后无影响)
- ❌ 跟 decision 014 / 016 用边表达 view 归属的模式不一致,引入两种表达手法

### 3.3 路径 3:两套独立 folder domain(候选 fallback B)

**实施核心**:
```typescript
// 两个 domain
{ payload: { domain: 'note-folder', payload: { title } } }
{ payload: { domain: 'graph-folder', payload: { title } } }
```

**优点**:
- ✅ listFolders 查询最简单:`storage.listAtoms({ domain: 'note-folder' })`

**风险**:
- ❌ 完全失去跨 view 共享可能(两个不同 domain)
- ❌ inFolder 边的 subject 现状字面是 note / graph atom,object 是 folder atom — 现在 object 变成 note-folder / graph-folder,跨 domain 关系跳跃
- ❌ folder 通用业务逻辑(create / rename / move / delete)代码要复制 2 份

### 3.4 路径对比矩阵

| 维度 | 路径 1 边表达(拍板) | 路径 2 payload 字段 | 路径 3 双 domain |
|---|---|---|---|
| 跟 decision 014 / 016 模式一致 | ✅ 一致 | ❌ 不一致 | ❌ 不一致 |
| 跨 view 共享扩展性 | ✅ 多边支持 | ❌ 单值约束 | ❌ 完全不支持 |
| schema 改造面 | 加新边 predicate | 加 payload 字段 | 加新 domain |
| caller 改造面 | 4 处 + viewType 入参 | 4 处 + viewType 入参 | 4 处 + capability 拆 2 套 |
| 查询性能 | edge 查询 + 索引 | atom 单查询 + filter | atom 单查询 |
| migration 复杂度 | clearAll 后无影响 | clearAll 后无影响 | clearAll 后无影响 |
| 跟 ebook sub-phase 022 接入兼容 | ✅ 加 '__view__/ebook' marker | ⚠ payload 加 'ebook' 值 | ❌ 加第 3 个 domain |

**拍板**:**路径 1 边表达**(用户 2026-05-13 拍板),跨 view 共享扩展性 + 跟现有边表达模式一致是决定性因素。

---

## 4. 拍板路径:边表达 `user:krig:folderForView`

### 4.1 实施核心(草案,§5 详细)

**新边类型登记**:

| 字段 | 值 | 说明 |
|---|---|---|
| predicate | `user:krig:folderForView` | krig vocab 新条目 |
| subject | AtomRef(atomId=<folder atom id>) | folder atom |
| object | LiteralMarker('__view__/note' 或 '__view__/graph') | view 归属标记 |
| attrs | `{ createdBy, createdAt }` | 沿 inFolder 边格式 |
| cardinality | 0-N(允许 0 表示孤儿不可见,允许 N 表示跨 view 共享)| 单 view 视角下:0 或 1 条匹配 |

**FolderViewType 类型字面**:
```typescript
// src/capabilities/folder/types.ts
export type FolderViewType = 'note' | 'graph';
// future sub-phase 022 加 | 'ebook'
```

**`listFolders(viewType)` 实施(草案)**:
```typescript
async function listFolders(viewType: FolderViewType): Promise<FolderInfo[]> {
  // 1. 查 folderForView 边 (EdgeFilter 字面不支持 objectLiteralValue,见 §0.4 第 8 项 + §3.1)
  //    应用层 filter object.kind/type/value
  const viewMarker = `__view__/${viewType}`;
  const allViewEdges = await storage.listEdges({
    predicate: 'user:krig:folderForView',
  });
  const folderIdsInView = new Set(
    allViewEdges
      .filter(
        (e) =>
          e.object.kind === 'literal' &&
          e.object.type === 'string' &&
          e.object.value === viewMarker,
      )
      .map((e) => e.subject.atomId)
  );

  // 2. 拉 atom + inFolder 边(parentId)
  const atoms = (await storage.listAtoms({ domain: 'folder' })) as AtomEntity<'folder'>[];
  const inViewAtoms = atoms.filter((a) => folderIdsInView.has(a.id));

  const parentEdges = await storage.listEdges({ predicate: 'user:krig:inFolder' });
  const parentBySubject = new Map<string, string>();
  for (const e of parentEdges) {
    if (e.object.kind === 'atom') {
      parentBySubject.set(e.subject.atomId, e.object.atomId);
    }
  }
  return inViewAtoms.map((a) => atomToFolderInfo(a, parentBySubject.get(a.id) ?? null));
}
```

**`createFolder(title, parentFolderId, viewType)` 实施(草案)**:
```typescript
async function createFolder(
  title: string,
  parentFolderId: string | null,
  viewType: FolderViewType,
): Promise<FolderInfo> {
  const payload: FolderPayload = { title };
  const viewMarker = `__view__/${viewType}`;
  return storage.transaction(async (tx) => {
    const atom = await tx.putAtom<'folder'>({
      payload: { domain: 'folder', payload },
    });
    // 加 folderForView 边 (LiteralValue 字面带 type 字段,见 §0.4 第 7 项)
    await tx.putEdge({
      predicate: 'user:krig:folderForView',
      subject: { kind: 'atom', atomId: atom.id },
      object: { kind: 'literal', type: 'string', value: viewMarker },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });
    if (parentFolderId) {
      await tx.putEdge({
        predicate: 'user:krig:inFolder',
        subject: { kind: 'atom', atomId: atom.id },
        object: { kind: 'atom', atomId: parentFolderId },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
    return atomToFolderInfo(atom, parentFolderId);
  });
}
```

### 4.2 不变约束

| # | 约束 | 验证方法 |
|---|---|---|
| 1 | `FolderInfo` 字段不动 | `git diff src/shared/ipc/note-folder-types.ts` 应无变化 |
| 2 | `deleteFolder / moveFolder / renameFolder / getFolder / onListChanged` 签名不动 | `git diff src/capabilities/folder/types.ts` 仅 listFolders / createFolder + FolderViewType |
| 3 | ebook-library / ebook bookshelf-store 任一字面不动 | `git diff src/capabilities/ebook-library/ src/platform/main/ebook/` 应无变化 |
| 4 | `user:krig:inFolder` 边语义不动 | grep 现有 inFolder 路径字面不动 |
| 5 | folder atom payload schema 不动 | `payload: { title }` 字面不加新字段 |
| 6 | SDK 版本不变(surrealdb@^2.0.3) | `git diff package.json` 应无变化 |
| 7 | 反向不动 sub-phase 3a-tx Path 1(beginTransaction)| `git diff src/storage/surreal/storage.ts` 应无变化 |

### 4.3 跨 sub-phase 兼容约束(预留 022 接入)

**sub-phase 022 ebook 接入时,本决议预留**:
1. `FolderViewType` 字面扩展为 `'note' | 'graph' | 'ebook'`(增量 OR-type)
2. 4 个 ebook caller(views/ebook/nav-side-content.tsx + 3 个其他)改用 folder capability + 传 'ebook'
3. ebook-library `folderList / folderCreate / folderRename / folderDelete / folderMove` 5 API **完整废弃**(取代为 folder capability + viewType='ebook')
4. ebook bookshelf-store `folders[]` JSON 字段废弃,改用 ebook atom + folderId 派生自 inFolder 边(跟 note / graph 同模式)

**本决议字面登记此约束**:022 决议必须按此接入路径,不允许"ebook 自有 folder 模型"二次复活。

---

## 5. 实施步骤(按顺序执行,代码/文档 step 必须 commit,纯 verify step 不 commit)

> **§5 待定稿**(本决议进入用户复审 + 实施期 binary verify 后 finalize):路径 1 实证可行后,实施步骤按下述顺序推进。
>
> **共 9 个 Step(5.0 - 5.8)**:
> - **代码 / 文档 / verify 脚本变更 step,必须 commit**(6 个):5.2(类型 + capability 签名扩展)/ 5.3(main 端 listFolders+createFolder 改造)/ 5.4(graph folder-adapter 强制 'graph')/ 5.5(4 caller + IPC + Q7 弹框)/ 5.6(clearAll migration 脚本 + flag)/ 5.7(反向更新)
> - **纯 verify / 自测 / 用户测试 step,不 commit**(3 个):5.0 现状 verify / 5.1 binary verify SDK listEdges literal 行为 / 5.8 完成报告
>
> ⚠ §5 详细实施步骤待用户复审 §0-§4 后再细化(P1 修订轮)

### Step 5.0 — V2 现状 verify(前置 + 实施者独立确认)

**目的**:实施者独立 grep §0.4 / §1.2 字面证据。

**任务**:
1. `git log --oneline -3` 确认 V2 main HEAD = `b6512c4`,当前分支 = `feature/L7-sub021-folder-view-isolation`
2. `cat package.json | grep surrealdb` 确认 SDK 锁定 `^2.0.3`(沿 SDK-version-binding-policy)
3. grep 6 项 §0.4 字面证据全部对齐

**完成判据**:6 项 grep 结果跟决议 §0.4 / §1.2 一致;否则停下汇报。

**commit**:无(纯 verify 步骤)

### Step 5.1 — Binary verify:SDK listEdges 是否支持 literal object filter

**目的**:验证 `storage.listEdges({ predicate, ... })` 返回的 edges 字面是否含 `object.kind === 'literal'` 字面,并能否在应用层 filter。

**任务**:
1. 写 verify 脚本 `tmp/verify/sub021-folder-for-view-binary-verify.mjs`
2. 场景:create folder atom + putEdge folderForView (object kind='literal', value='__view__/note') + listEdges + 字面检查 object.kind / object.value
3. 比对 storage 接口字面([storage/types.ts](../../../../../src/storage/types.ts))与实施

**完成判据**:listEdges 字面 PASS;否则启动 §3.5 fallback 讨论。

**commit**:无

### Step 5.2 — types + capability 接口签名扩展(typecheck **明示性 fail**)

> ⚠ **本 Step typecheck 不要求全绿**:类型签名加 `viewType` 后,4 caller 处必然 TS2554 报错,这是设计上预期 — 留到 Step 5.3 一并修。本 Step commit 后**允许且必须**带 TS 错误进入 Step 5.3。

**任务**:
1. 改 [folder/types.ts](../../../../../src/capabilities/folder/types.ts):加 `FolderViewType` 类型;`createFolder` / `listFolders` 签名加 viewType 入参
2. 改 [folder/index.ts](../../../../../src/capabilities/folder/index.ts):renderer 入口签名同步
3. 改 [shared/ipc/electron-api.d.ts](../../../../../src/shared/ipc/electron-api.d.ts):folderList / folderCreate 签名同步
4. 改 [main-window-preload.ts](../../../../../src/platform/main/preload/main-window-preload.ts):folderList / folderCreate 桥透传 viewType

**完成判据**:
- types / 入口签名字面齐 + 4 处接口字面一致
- **预期 typecheck 失败**:`npx tsc --noEmit 2>&1 | grep TS2554 | wc -l` ≥ 4(4 个 caller 漏传 viewType)
- 不允许其他类型错误(若有非 TS2554 / 非 4 caller 的错,停下汇报)

**commit message**:
```
feat(folder): types + capability 签名扩展 viewType 入参 (decision 021 §4.1)

加 FolderViewType ('note' | 'graph'),listFolders / createFolder 必须传 viewType。
TypeScript 错误 4 处 (4 caller 漏传 viewType) 是设计上预期,留 Step 5.3 一并修。
ebook viewType 未加,留 sub-phase 022 (§4.3 兼容约束)。
```

### Step 5.3 — caller + main 端实施一并落地(typecheck 必须全绿)

> 🟢 **本 Step 是 Step 5.2 后唯一 typecheck 全绿成立的 step** — 5.2 签名扩 + 5.3 caller + main 端 + handler 一并改完,TS 错误全清。
>
> **2026-05-13 P1 修订轮回应审计**:原 Step 5.2 / 5.3 编排把 caller 修推到 5.5,造成 5.3 typecheck 完成判据不可成立。本轮重排 — caller 改 + main 端实施合并到本 Step,**两个 commit 但同一原子推进单元**。

**任务**:
1. **caller 改造**(原 Step 5.5 任务,提前):
   - note 3 caller 改造:`folder.listFolders('note')` / `folder.createFolder(title, parentId, 'note')`
     - [src/views/note/extraction-import.ts:177](../../../../../src/views/note/extraction-import.ts#L177)
     - [src/views/note/tree-operations.ts:49,133](../../../../../src/views/note/tree-operations.ts#L49)
     - [src/views/note/use-notes-folders.ts:45](../../../../../src/views/note/use-notes-folders.ts#L45)
     - (其他 grep 出现处一并字面对齐)
   - graph caller 字面 0 改动(走 folder-adapter,本步 Step 5.4 处理)
2. **main 端实施**:
   - 改 [folder/capability-impl.ts](../../../../../src/platform/main/folder/capability-impl.ts) `listFolders` / `createFolder` 实施按 §4.1 草案
   - 改 [folder/handlers.ts](../../../../../src/platform/main/folder/handlers.ts):FOLDER_LIST / FOLDER_CREATE handler 透传 viewType 入参

**完成判据**:
- `npx tsc --noEmit` **全绿**(0 errors)
- verify 脚本(Step 5.1)继续 PASS
- 注:Step 5.4(folder-adapter 强制 'graph')需在本 step 后做,但本 step typecheck 全绿前提是 folder-adapter 现有字面已暂时兼容(可加 `as FolderViewType` cast 临时容错,Step 5.4 立刻替换为正式 'graph' 字面)

**commit message**:
```
feat(folder/main + caller): listFolders + createFolder viewType 实施 + 4 caller 字面修
(decision 021 §4.1 + 2026-05-13 P1 修订轮 Step 编排)

main 端:
- listFolders(viewType): 查 folderForView 边过滤后返 atom
- createFolder(title, parentId, viewType): 写 folder atom + folderForView 边 + (可选) inFolder 边
- IPC handler 透传 viewType

caller:
- note 3 caller 改 'note' viewType
- graph caller 字面 0 改 (folder-adapter 处理,Step 5.4)

typecheck 全绿 (Step 5.2 引入的 TS2554 错误全清)。
```

### Step 5.4 — graph folder-adapter 强制 'graph' viewType

**任务**:
1. 改 [graph/folder-adapter.ts](../../../../../src/platform/main/graph/folder-adapter.ts):listFolders / createFolder 包装层强制传 'graph'
2. 删除 Step 5.3 中(若有)`as FolderViewType` 临时 cast,替换为字面 'graph'
3. graph 路径 IPC channel 字段**不**加 viewType(renderer 透明)
4. canvasStore.folderList / folderCreate 字面对齐

**完成判据**:typecheck 通过 + nav-side-content.tsx 字面 0 改动(graph 路径透明)+ 无临时 cast 残留

**commit message**:
```
feat(graph/folder-adapter): 强制 'graph' viewType (decision 021 §1.1)

main 端 folder-adapter 内部硬编 viewType='graph',renderer IPC 字面透明。
nav-side-content.tsx caller 字面 0 改动。
删除 Step 5.3 临时 cast,替换为字面 'graph'。
```

### Step 5.5 — Q7 弱保护(含资源 folder 删除前弹框)

> **2026-05-13 P1 修订轮回应审计**:原 Step 5.5 含 caller 改造 + Q7 双任务,caller 已提前到 Step 5.3,本 Step 仅留 Q7 弱保护单一职责。

**任务**:
1. main 端:`folder/capability-impl.ts` 新增 `previewDeleteFolder(id)` method 或 `deleteFolder` 加 dry-run 入参,返 `{ folders, resources }` 计数
2. renderer 端弹框组件:NavSide / nav-side-content 集成 — `deleteFolder` 触发前调 `previewDeleteFolder` → 弹框确认含资源数 → 确认后才走真删除
3. 跨 2 view UI 复用(note nav-side + graph nav-side 同一弹框 UX)

**完成判据**:typecheck 全 PASS + UI 弹框集成测试通过(Step 5.7 用户跑)

**commit message**:
```
feat(folder + UI): Q7 弱保护 含资源 folder 删除前弹框 (decision 021 §5.5)

deleteFolder 前 main 端返 previewCount {folders, resources},
UI 弹框确认含资源数后才删。
回收站完整设计 (trash domain + undo) 留 decision 023。
```

### Step 5.6 — clearAll migration 脚本 + flag

**任务**:
1. 新建 `src/storage/migrations/021-clear-all.ts`:启动时检测 `userData/krig-data/migration-021-completed` flag,若不存在则执行 clearAll
2. clearAll 实施:单次 `db.query()` 承载多语句事务脚本 `BEGIN TRANSACTION; DELETE atom; DELETE edge; COMMIT TRANSACTION;`(沿 sub-phase 3a-tx 路径 1 同模式,decision 020 §3.5.bis 单次 query 内的 BEGIN/COMMIT 已 binary verify 跨语句原子;**术语澄清**:不是"单 SQL 语句",是"单次 query 内的多语句事务脚本")
3. 写 flag 文件:成功后写空文件标记 migration 完成
4. 集成到启动 sequence:`src/platform/main/index.ts` startup 流程,放在 storage 初始化后、IPC 注册前

**完成判据**:
- 删 flag 文件 + 启动应用 → 看到所有 folder / note / graph 清空(原数据已重置)
- 再启动一次 → flag 已存在,migration 不重跑
- 用户拍板"测试数据,可重置"已记录(§0.5)

**commit message**:
```
feat(migration/021): clearAll 一次性 migration + flag (decision 021 §1.3 + §0.5)

启动时检测 migration-021-completed flag,若不存在则 clearAll (DELETE atom; DELETE edge)。
flag 写入后绝不重跑。
用户拍板可重置 (§0.5)。
```

### Step 5.7 — 反向更新决议清单 + memory + 永久文档

**任务**:见 §8 反向更新清单,逐项落地。

**完成判据**:
- 7 个决议反向更新完成(012 / 014 / 016 / 020 / 022 占位 / L7 启动包 §1.4 + §6.3 + §2.1)
- 更新 SDK-version-binding-policy.md §2.2 加"启动包字面区分现状 vs 未来计划"作为第 6 步证据(§0.6 教训)

**commit message**:
```
docs: sub-phase 021 完成后反向更新决议链 + 第 14 / 15 次教训

- decision 012 §3.1 folder atom schema 注释加 folderForView 边
- decision 014 §3.5.3.3 folder-adapter 标"21 后强制 'graph' viewType"
- decision 016 / 020 加 21 完成参考
- L7 启动包 §1.4 Q-shared-folder-ux 标"已解决 decision 021"
- SDK-version-binding-policy §2.2 加第 6 步"现状 vs 未来计划区分"
  + 第 7 步"storage API / LiteralValue 字面 grep 实证"
```

### Step 5.8 — 完成报告

**任务**:实施者向总指挥提交完成报告:
- §5 commit step(6 个:5.2 / 5.3 / 5.4 / 5.5 / 5.6 / 5.7)commit hash 列表
- §6 Checkpoint 1 / 2 实跑结果(PASS / FAIL / WARN 矩阵)
- §10 偏离登记(若有任何偏离决议字面的情况)
- 集成测试 通过截图

**等待**:总指挥审计 + UI 集成测试用户反馈 + 拍板合 main。

---

## 6. binary verify checkpoint(待 §5 定稿后 finalize)

### 6.1 Checkpoint 1 — SDK listEdges literal object filter 行为(Step 5.1)

**前置**:写 `tmp/verify/sub021-folder-for-view-binary-verify.mjs` 5 场景

| # | 场景 | 期望 |
|---|---|---|
| 1 | putEdge {predicate, subject:atom, object:literal} + listEdges {predicate} | edges[0].object.kind = 'literal',value 匹配 |
| 2 | 多条 folderForView 边(不同 atomId,object literal 各异) | 全部返回 |
| 3 | filter object.value === '__view__/note' | 字面过滤 PASS |
| 4 | 删 folderForView 边 + listEdges | 被删条目不在结果 |
| 5 | folder atom 0 条 folderForView 边时,listFolders('note') 返空 | PASS |

**关键门槛**:5 场景全 PASS。任一 FAIL → STOP + 设计审查会签(可能改 storage 接口或走路径 2 fallback)。

### 6.2 Checkpoint 2 — 完整 capability 集成 verify(Step 5.5 后)

**任务**:Step 5.5 完成后,跑完整 capability 集成 verify(类似 decision 020 §6.2)

(详细矩阵 §5 定稿后补)

---

## 7. clearAll migration 详细(已定稿)

### 7.1 Migration 时机

启动时,在 storage 初始化后、IPC 注册前,执行:

```typescript
// src/platform/main/index.ts(伪代码)
await initStorage();
await runMigration021IfNeeded();   // 本决议新增
registerAllIpcHandlers();
```

### 7.2 Migration 实施

> ⚠ **§0.4 第 8 项自审命中**:`StorageAPI` 字面**无 `clearAll`** 方法,本决议不引入新接口(避第 5/11 次教训"假设已实施模块自动支持新需求")。改用 [client.ts](../../../../../src/storage/surreal/client.ts) `getDB().query()` 跑**单次 query 承载的多语句事务脚本**(BEGIN ... COMMIT 包 DELETE),沿 sub-phase 3a-tx Path 1 同模式;decision 020 §3.5.bis 场景 1/3/5 已 binary verify "单次 db.query() 内 BEGIN/COMMIT 跨语句原子"。**术语澄清**:不是"单 SQL 语句",是"单次 query 调用承载的多语句事务脚本"。

```typescript
// src/storage/migrations/021-clear-all.ts
import path from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { app } from 'electron';
import { getDB } from '@storage/surreal/client';

const FLAG_PATH = path.join(
  app.getPath('userData'),
  'krig-data',
  'migration-021-completed',
);

export async function runMigration021IfNeeded(): Promise<void> {
  if (existsSync(FLAG_PATH)) return;  // 已执行,绝不重跑

  console.warn(
    '[migration/021] sub-phase 021 folder 视图隔离启动 — clearAll 重置数据库\n' +
    '用户拍板:测试数据可重置 (decision 021 §0.5)\n' +
    '现有 folder / note / graph atom + 所有边将被清除',
  );

  // ⚠ StorageAPI 无 clearAll,走 client.ts getDB() 直跑 SurrealQL
  // 单语句 BEGIN ... COMMIT 实证 sub-phase 3a-tx 单语句原子 (decision 020 §3.5.ter)
  const db = getDB();
  await db.query('BEGIN TRANSACTION; DELETE atom; DELETE edge; COMMIT TRANSACTION;');

  // 写 flag
  writeFileSync(FLAG_PATH, '', 'utf-8');
  console.warn('[migration/021] clearAll 完成,migration-021-completed flag 写入');
}
```

### 7.3 用户协作

用户启动后看到 console.warn 提示,确认数据已重置(由总指挥告知预期)。

### 7.4 卸载 / 回滚

如果用户实际不想 clearAll(临时改主意):
- 实施者**禁止**自动改成 migration 脚本(走 grep folder atom 加 folderForView 边的路径)
- 必须由总指挥独立设计审查 + 字面登记替代 migration 决议

---

## 8. 反向更新清单(实施完成后,Step 5.7 落地)

| 决议 / 文档 | 章节 | 更新内容 |
|---|---|---|
| [012 sub-phase 2](012-sub-phase-2-note-folder-migration.md) | §3.1 folder atom schema 注释 | 加"folder 多挂一条 folderForView 边表达 view 归属(decision 021)" |
| [014 sub-phase 3a-1](014-sub-phase-3a-1-graph-canvas-instance-migration.md) | §3.5.3.3 folder-adapter | 加"sub-phase 021 后:folder-adapter listFolders / createFolder 强制传 'graph' viewType" |
| [016 sub-phase 3a-2.5](016-sub-phase-3a-2.5-note-form-upgrade.md) | §0.3 cardinality 注释 | 加 folderForView 与 hasNoteView 协同 |
| [020 sub-phase 3a-tx](020-sub-phase-3a-tx-true-atomicity.md) | §7 故障注入 | 加"createFolder + folderForView 边" 新故障点 CF6 + 落点登记 |
| `src/capabilities/folder/DESIGN.md` | 全文 | 更新 folderCapabilityApi 签名 + folderForView 边语义 |
| `src/capabilities/pm-content/README.md` | (若有 folder 引用) | 字面更新 |
| `docs/RefactorV2/notes/L7-next-phase-kickoff.md` | §1.4 Q-shared-folder-ux + §1.5 设计师教训表(第 14 次 / 第 15 次) | 标"已解决 decision 021" + 加第 14 / 15 次教训 |
| `docs/RefactorV2/data-model/persistence/SDK-version-binding-policy.md` | §2.2 第 6 / 7 步 + §6 修订记录 v1.3 | 第 6 步加"启动包 / 总纲文档字面区分现状 vs 未来计划"(第 14 次);第 7 步加"决议引用 storage API / 类型字段前必须 grep 真实接口字面 + LiteralValue 字面三字段 `{ kind, type, value }` 缺一不可"(第 15 次);§6 加 v1.3 修订记录指向 decision 021。**授权依据**:§0.5.bis 用户 2026-05-13 P0 显式授权 |
| `docs/RefactorV2/data-model/relations/krig-vocab.md`(若存在) | folderForView 条目 | 新增登记 |
| **决议 022 占位**(若已起草) | §0 前置依赖 | 加"decision 021 必须先合 main",§1 ebook folder 接入路径明确"走新隔离模型" |

---

## 9. Open Questions(留尾,binary verify 后更新)

### 9.1 Q-021-edge-cardinality:folderForView 边 cardinality 约束

**问题**:同 folder atom 是否允许多条 folderForView 边(跨 view 共享)?

**当前拍板**(§4.1):允许多条(预留 vision §2.4 闭环跨 view 共享 folder 场景)。

**Open**:目前 caller 不创建跨 view 共享场景,UI 层暂不暴露"跨 view 共享 folder"功能。需要专门 sub-phase 启动时再设计 cardinality-check 兼容(参 decision 019 cardinality-check.ts)。

### 9.2 Q-021-orphan-folder:0 条 folderForView 边的 folder atom

**问题**:如果未来 schema 错误或代码 bug 导致某 folder atom 0 条 folderForView 边,会"所有视图都不可见"形成孤儿 — 怎么发现 + 修复?

**当前拍板**:Step 5.6 clearAll 后理论不会出现;未来加 storage health-check 扫"folder atom + 0 条 folderForView 边" → warn。留独立 hotfix。

### 9.3 Q-021-storage-listEdges-literal-filter:接口是否扩字面 filter

**问题**:`storage.listEdges` 现状字面是否支持 `objectLiteralValue` 入参 filter?如果不支持,只能应用层 filter 拉全 folderForView 边再过滤,O(N) 性能。

**当前拍板**:§5 Step 5.1 binary verify SDK 行为后再决定;若需要扩接口,作为本决议偏离登记 + 反向更新 decision 008 storage interface。

### 9.4 Q-021-q7-trash-design:回收站完整设计

**问题**:回收站(trash domain + undo)留独立 decision 023,触发条件?

**当前拍板**:用户业务真用 Q7 弹框觉得"删了想恢复" → 拍板启动 023。Sub-phase 021 内不实施。

### 9.5 Q-021-ebook-022-compat:022 接入路径

**问题**:022 ebook 接入新 folder 模型时,具体路径?

**当前拍板**(§4.3):022 决议必须按此接入:
1. ebook bookshelf-store.ts:folders[] JSON 字段废弃
2. ebook-library folderList / folderCreate / folderRename / folderDelete / folderMove 5 API 完整废弃
3. ebook 4 caller 改用 folder capability + 'ebook' viewType
4. FolderViewType 扩展 'note' | 'graph' | 'ebook'

---

## 10. 偏离登记(实施期更新)

> 实施期间任何偏离本决议字面的情况(SDK 行为意外 / 额外消费点 / 路径调整等)由实施者在此登记,总指挥反向更新决议正文。

**预期偏离类型分级**:
- **类型 A**(storage.listEdges literal filter 行为不符 §6.1):严重,STOP + 设计审查
- **类型 B**(发现新 caller):中等,可能影响 §5.5
- **类型 C**(typecheck / lint 暴露 implicit any / unsafe cast):低,实施期修复 + 登记

(待实施期补充)

---

## 11. 累积教训(实施完成后追加)

### 11.1 第 14 次设计师教训(§0.6 已登记)

启动包 / 总纲文档字面描述涉及"现状 + 未来计划"混述时,必须 grep 实证哪些是现状哪些是未来计划。字面"X / Y / 未来 Z 共享 ABC" → 必须区分"X / Y 现状共享 ABC" + "未来 Z 接入 ABC"两层。本对话 2026-05-13 第一轮 AskUserQuestion 字面把 ebook 当作"现状共享 folder",grep verify 后(第 2 轮)更正到"ebook 现状独立 JSON 树未接 atom"。

**纪律升级**:本教训跟第 11/13 次教训同型(实证字面而不靠记忆),登记 SDK-version-binding-policy.md §2.2 第 6 步。

### 11.2 第 15 次设计师教训(§0.7 已登记)

决议字面引用 storage API / 类型字段时假设存在,自审 grep 命中两项不存在:`storage.clearAll()` API 字面无;`EdgeFilter` 字面无 `objectLiteralValue` filter;LiteralValue 字面三字段必须完整(`type` 字段被遗漏)。复现第 5/11 次教训("假设已实施模块自动支持新需求 → 必须 grep 验证")。

**纪律升级**:决议引用 storage API / 语义层类型字段前,grep 真实接口字面;每个 API 独立验证不推测;LiteralValue 形态完整字面 `{ kind, type, value }` 缺一不可。登记 SDK-version-binding-policy.md §2.2 第 7 步。

### 11.3 实施完成后追加教训(占位)

(实施者 §5 完成后,任何过程中暴露的设计盲点 / 实施陷阱在此追加)

---

*本决议草稿版本结束。等总指挥审计 + 用户复审 P1 / P2 修订后 finalize。*

---

## 12. P1 修订轮变更日志(可追溯)

### v0.2(2026-05-13,用户审计反馈 4 项)

**审计反馈 4 项**(用户 2026-05-13 复审反馈):

| # | 严重度 | 反馈 | 修复 |
|---|---|---|---|
| 1 | 高 | `src/storage` "一律不动" vs Step 5.6 新建 `src/storage/migrations/021-clear-all.ts` 硬冲突 | §0.2 第 3 条澄清 "不动" 语义边界:不改现有 .ts 字面;允许 migrations/ 子目录新建专属脚本(沿 decision 020 transaction-helpers.ts 同模式)|
| 2 | 高 | Step 5.2 typecheck **预期失败**(caller TS2554)与 Step 5.3 完成判据 "typecheck 通过" **不可同时成立** | Step 5.2 完成判据改 "typecheck 明示性 fail"(预期 TS2554 ≥ 4 处);Step 5.3 把 caller 改提前合并,本 Step 后 typecheck 全绿;Step 5.5 单一职责留 Q7 弱保护 |
| 3 | 中 | clearAll 语义术语前后不一("单语句" vs 实际 BEGIN ... COMMIT 多语句事务串) | 3 处字面统一为 "单次 query 调用承载的多语句事务脚本",sub-phase 3a-tx §3.5.bis 场景 1/3/5 已 binary verify |
| 4 | 中 | 对 SDK-policy §2.2 改正文按 policy §7.1 需独立决议 + 用户 P0 授权 | 加 §0.5.bis 用户 2026-05-13 P0 显式授权落点;§8 反向更新清单同步登记授权依据指向 §0.5.bis;policy §6 修订记录 v1.3 落地由 Step 5.7 commit |

**字面 commit hash**:由本对话 P1 修订轮 commit 落地,沿决议示例 commit message 格式。

**未来 P2 修订轮预留**:实施期 §10 偏离登记 / 跨 sub-phase 反向更新等 P2 级反馈到达时,本节追加 v0.3 段。
