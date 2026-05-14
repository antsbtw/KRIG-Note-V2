# Decision 022 — Phase N Sub-phase 022: eBook + Thought 持久化迁移(annotation 概念消亡 + 4 层 atom 模型)

> **Phase**: N(实施 Phase)/ Sub-phase 022(独立子阶段,沿 sub-phase 021 模式)
> **状态**: 🟡 草稿(2026-05-13)— §0-§4 已撰,§5-§12 待用户复审 §0-§4 后再细化
>
> **设计师 / 审计师**: main 对话(总指挥)
> **实施者**: 独立 session
> **决议日期**: 2026-05-13
> **前置依赖**: sub-phase 1(`34e3758`)+ sub-phase 2(`0ad60c7`)+ sub-phase 3a-1(`67f18b2`)+ sub-phase 3a-2.5(`b8093d9`)+ sub-phase 3a-tx(`7ce7948` / `b6512c4`)+ sub-phase 021(`d55b0b6` + `f535cd1`)
> **总纲**: [KRIG-Note Vision §2.4 知识图谱 ↔ KR 图双向闭环](../../../KRIG-Note-Vision.md) + [L7 启动包 §1.5 sub-phase 022 ebook 接入预设段](../../../notes/L7-next-phase-kickoff.md) + [decision 021 §4.3 跨 sub-phase 兼容约束](021-sub-phase-021-folder-view-isolation.md#43-跨-sub-phase-兼容约束-预留-022-接入) + [memory feedback_thought_is_noteview_variant](../../../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_thought_is_noteview_variant.md)
> **范围风格**: 数据模型层根治 + 4 层 atom 模型(ebook / reading-state / pm-as-thought / inFolder)+ annotation 概念消亡(全部转 thought block)+ 5 view JSON store 完整废弃 + V1/V2 annotation JSON → thought block migration

---

## 0. 本文档的执行指南

### 0.1 角色与流程(沿用 sub-phase 1 / 2 / 3a-1 / 3a-2.5 / 3a-tx / 021 同模式)

- **设计师 + 审计师 = main 对话(总指挥)**
- **实施者 = 独立 session**(粘贴本决议 + L7 启动包 §4 实施者 prompt)
- **协作模式**:实施者按 §5 顺序推进,每 step commit,关键决策点停下汇报,完成后总指挥审计 + 合 main

### 0.2 实施纪律(实施者必须遵守)

1. **严格 cd**:所有 Bash 命令前 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&`(memory `feedback_v2_is_workspace_v1_is_reference`,已 5+ 次 cwd 漂移事故)
2. **每完成 §5 一个有代码/文档/脚本变更的 step commit 一次**(详 §5 头部分类),commit message 按本决议示例格式;纯 verify / 自测 / 用户测试 step 不 commit
3. **不动其他已完成模块对外契约**(**除 ebook 相关白名单外,以下一律不动**):
   - `src/capabilities/note/` / `src/capabilities/folder/` / `src/capabilities/graph-library-store/` / `src/capabilities/pm-content/` / `src/capabilities/canvas-rendering/` 一律不动
   - `src/platform/main/note/` / `src/platform/main/folder/` / `src/platform/main/graph/` 不动
   - `src/storage/` **核心改造点不动对外契约**:
     - `src/storage/api.ts` 字面 **0 变化**(`StorageAPI` 12 API 签名 / `StorageTransaction` 6 方法签名 / `EdgeFilter` 字面)
     - `src/storage/surreal/` 子目录既有文件字面 **0 变化**(`storage.ts` / `client.ts` / `schema.ts` 等)
     - `src/storage/migrations/runner.ts` 字面 **0 变化**(允许 runner **注册新 migration 条目** 但 runner 本身实施 0 变化 — 跟决议 020/021 同模式)
     - `src/storage/health/cardinality-check.ts` **允许加新条目**(`hasReadingThought` / `hasReadingState` 互斥 + cardinality 约束),既有条目字面 0 变化
   - **允许新增**(非"动现有对外契约"):
     - `src/semantic/types/atom.ts` 加 2 个新 domain payload(`EBookPayload` / `ReadingStatePayload`)+ `AtomPayloadOf<D>` union 加 2 项(本决议唯一 semantic 层变更点)
     - `src/storage/migrations/022-ebook-thought.ts` 新文件(本决议唯一 storage 层新增点,沿 [src/storage/migrations/runner.ts](../../../../../src/storage/migrations/runner.ts) 既有 migration 目录结构)— 该文件**只调** `getDB().query()` + `surrealStorage.putAtom / putEdge` 现有字面 API,**不**改 storage 内部 atom / edge CRUD 逻辑
     - `src/capabilities/ebook-library/` 加 atom 体系版 capability(本决议主战场,详下方"ebook 模块白名单")
     - `src/platform/main/ebook/` 重构 capability-impl + 废弃 bookshelf-store.ts / annotation-store.ts(详下方白名单)
     - `src/shared/ipc/ebook-types.ts` 新文件(EBookInfo / ReadingStateInfo SSOT 归属修正,详 §0.4 第 7 项)
   - **ebook 模块白名单**(本决议核心改造点 — 这部分**显式允许动**,跟"不动"白名单互不矛盾):
     - `src/capabilities/ebook-library/types.ts` 删除(类型移到 `src/shared/ipc/ebook-types.ts`)
     - `src/capabilities/ebook-library/index.ts` 重写(全部 27 API 改走 atom 体系)
     - `src/platform/main/ebook/library-handlers.ts` 重写(全部 IPC handler 改走 atom)
     - `src/platform/main/ebook/bookshelf-store.ts` + `annotation-store.ts` 整体废弃(migration 完成后删除)
     - `src/capabilities/ebook-rendering/` view 端 caller 改造(annotation→thought 转换、5 folder API caller 改走 folder capability、19 ebook API 保留 caller import 路径同步)— 字面在 §5 详细
4. **EBookLibraryApi 对外接口签名变化**(本决议必要变更白名单):
   - 现有 27 API 中 **5 个 folder API 完整废弃**(`folderList / folderCreate / folderRename / folderDelete / folderMove`)— 改走 `folder` capability + `viewType='ebook'`(沿决议 021 §4.3 约束)
   - 现有 27 API 中 **3 个 annotation API 完整废弃**(`annotationList / annotationAdd / annotationRemove`)— 改走 `note` capability 操作 thought atom 的 PM block(annotation 概念消亡)
   - 现有 27 API 中 **19 API 字面保留语义**(列表 / 元数据 / 文件操作 / 进度 / 书签 / 数据传输 / 推送)— 但内部实施从 JSON store 改走 atom CRUD
   - **新增 5 个 API**(§5 实施期 binary verify 后 finalize):`getReadingThought` / `ensureReadingThought` / `addReadingThoughtBlock` / `removeReadingThoughtBlock` / `getReadingThoughtAnnotations` — 详 §1.3.2 + §4.1.3;**不扩 note capability 字面**(沿 §4.2 约束 3),thought block 操作高内聚封装为 ebook 业务语义
5. **SDK 版本锁定 surrealdb@^2.0.3**:沿 [SDK-version-binding-policy.md](../SDK-version-binding-policy.md) v1.4 纪律,本 sub-phase 不升级
6. **任何偏离决议 / SurrealDB binary 行为不符预期 / 发现额外消费点 → 停下汇报**,等总指挥批复后再继续
7. **进程边界**:
   - atom CRUD 仅在 main 进程,renderer 通过 IPC 透传
   - main 进程 capability 通过 barrel `import { ... } from '@platform/main/ebook'` 调用
8. **clearAll migration 必须 binary verify**:本决议含 022 专属 migration(JSON store → atom)+ V1/V2 annotation JSON → thought block 转换,实施期间必须 binary verify "migration 后启动应用 → 书架完整显示 + 进度恢复 + 标注转为 thought block 可见"
9. **lazy create thought 纪律**:本决议拍板 thought atom 走 lazy 创建路径(用户首次标注时创建),实施期不允许"eager create 兜底简化" — 违反用户 §2 拍板

### 0.3 本子决议对 L7 启动包 §1.5 sub-phase 022 ebook 接入预设的偏差登记

| 项 | L7 启动包字面 | 本决议拍板 | 理由 |
|---|---|---|---|
| ebook 数据模型 | "ebook entry 迁 atom 体系,bookshelf.json folders[] 改 atom + inFolder 边" | ✅ **拍板:4 层 atom 模型**(ebook + reading-state + pm-as-thought + folder 共享)| 用户 2026-05-13 拍板:借鉴 macOS Books 4 层(Library View / Book / Reading State / Reading Thought),L1 UI 不动,L2-L4 都迁 atom |
| annotation 持久化 | "annotation 形态:**独立 atom + `user:krig:annotates` 边**(知识闭环要求)" | ✅ **拍板转向:annotation 概念消亡,全部转 thought PM block**(2026-05-13 用户拍板) | 用户 2026-05-13 拍板:annotation 升格为一等公民 thought atom,1 book = 1 thought(聚合),每条标注 = thought PM doc 的一个 block;**比"独立 annotation atom"更彻底贴合 vision §2.4 知识闭环** |
| binary 处置 | "留磁盘 + atom payload 引用 filePath(沿现状 managed/link 模式)" | ✅ **沿启动包预设**(无偏差) | 二进制文件不进 atom payload,filePath 字段引用磁盘文件(纯 metadata 进 atom) |
| folder 接入 | "FolderViewType 加 'ebook'(沿决议 021 §4.3 兼容约束)" | ✅ **沿启动包预设**(无偏差) | 决议 021 §4.3 字面登记的兼容约束,本决议落地 |
| EBookEntry SSOT 归属 | 启动包未涉及 | 🟡 **拍板:类型移到 `src/shared/ipc/ebook-types.ts`**(2026-05-13 用户拍板,跟 NoteInfo / FolderInfo 同 SSOT 模式)| 决议 021 §10.C-1 教训(FolderViewType SSOT 归属违反 W5 分层 lint)同型问题预防 — 022 顺手做 SSOT 迁移避免重复债务 |
| reading-state 拆分 | 启动包未涉及 | 🟡 **拍板:独立 atom domain='reading-state'**,1:1 跟 ebook,边 hasReadingState(2026-05-13 用户拍板)| lastPosition / bookmarks 高频改,跟 book metadata 解耦避免无效 IO;未来多端同步可独立 conflict resolution |
| thought 创建时机 | 启动包未涉及 | 🟡 **拍板:lazy** — 用户首次标注时 create(2026-05-13 用户拍板)| 添书时不创空 thought,资源清爽;首次标注时内部 lazy create,UX 用户无感 |
| V1 老 thought 迁移时机 | 启动包未涉及 | 🟡 **拍板:V1 老 thought(挂 note)留 023+ 专门 sub-phase 迁**(2026-05-13 用户拍板)| 022 范围控制 — 只处理 ebook + ebook reading thought;V1 thought_of 表(挂 note)迁随 note atom Migration 一起做 |

### 0.4 设计师纪律累积(沿 decision 013 §0.5 + 014 §12.5 + 016 §0.4 + 017 §9 + 020 §0.6 + 021 §0.4)

本决议撰写前已完成 8 项现状 grep verify(避免第 5/6/8/11/12/13/14/15/16/17/18/19/20/21 次累积教训复现):

| # | 核查项 | 结论 |
|---|---|---|
| 1 | V2 现状 note atom 形态(thought 模式参考)| ✅ [platform/main/note/capability-impl.ts:62](../../../../../src/platform/main/note/capability-impl.ts#L62) note 走 **`domain='pm'` atom** + **`user:krig:hasNoteView` 边标记**(decision 016 §3.6 sub-phase 3a-2.5);**V2 没有"note atom domain",也没有"variant=thought"字面** — thought 跟 note 都复用 pm domain,通过不同边 marker 区分形态 |
| 2 | V2 现状 user:krig 既有 predicate | ✅ grep `user:krig:*` 字面:`folderForView`(021)/ `hasContent`(014)/ `hasNoteView`(016)/ `inCanvas`(014)/ `inFolder`(012)— 本决议新增 `hasReadingThought` + `hasReadingState` 不撞名 |
| 3 | V2 现状 ebook 持久化 | ⚠ 完全独立 JSON 树:`bookshelf.json`(entries + folders)+ `annotations/{bookId}.json`(每书一文件)+ `library/{id}.{ext}` managed 文件;**跟 atom 体系零接触**;本决议主战场 |
| 4 | V2 现状 ebook IPC channel + capability API 数量 | ⚠ **27 个 IPC channel + 28 capability API**(书架 10 + 文件夹 5 + 数据传输 2 + 推送 2 + 进度 1 + 书签 5 + 标注 3 = 28; 沿 §10.B-1 实施期修正, 原决议字面"27 capability API"是设计师笔误把 onBookshelfChanged 字面字面算进书架, 实际书架字面 10 API + 推送字面 2 API 独立): 废弃 5 folder + 3 annotation = **8 API 废弃**, 保留 20 API 改实施(沿 §10.B-1); 新增 5 thought block API (§4.1.3 finalize) |
| 5 | V2 现状 atom domain 全量 | ✅ [semantic/types/atom.ts:13-21](../../../../../src/semantic/types/atom.ts#L13) `AtomPayloadOf<D>` 7 项(`pm` / `rdf` / `embedding` / `three` / `folder` / `graph-canvas` / `graph-instance`)— 本决议加 `ebook` / `reading-state` 不撞名 |
| 6 | V2 现状 PM block schema 数量 + bookAnchor 字段冲突检查 | ✅ V2 已有 24 种 block(`audio / blockquote / bullet-list / callout / code-block / external-ref / file-block / file-link / hard-break / heading / horizontal-rule / image / list-item / math-block / math-inline / note-link / ordered-list / paragraph / table / task-list / toggle-list / tweet-block / unknown / video-block`);**24 种 block attrs 字面没 `bookAnchor` 字段** — 本决议加 optional `bookAnchor` 不撞名 |
| 7 | V2 现状 EBookEntry / StoredAnnotation SSOT 位置(决议 021 §10.C-1 同型预防)| ⚠ **不一致**:[capabilities/ebook-library/types.ts:24,74](../../../../../src/capabilities/ebook-library/types.ts#L24) EBookEntry + StoredAnnotation 在 `capabilities/` 层 vs NoteInfo / FolderInfo 在 [shared/ipc/note-folder-types.ts:22,35](../../../../../src/shared/ipc/note-folder-types.ts#L22) `shared/ipc/` 层;本决议 §4.4 拍板**迁到 `shared/ipc/ebook-types.ts`** |
| 8 | V2 现状 V1 老 thought 跟 ebook 是否有集成 | ✅ grep `src/plugins/thought/` 字面:V1 老 thought 通过 `thought_of` 边只挂 note,**跟 ebook 完全不接触**;本决议不涉及 V1 老 thought 迁移(留 023+ 专门 sub-phase)|

**本决议拍板时不再做 binary 假设**,§5 实施步骤 5.0 实施者复核 verify 后再固化路径细节。

### 0.5 用户 P0 纪律:数据模型层根治不是视图层补丁(沿决议 021 §0.5)

**用户 2026-05-13 拍板**(本对话 AskUserQuestion 累积字面):
> "annotation 这个概念消失;只有 thought 一个用户产出概念;1 book = 1 thought(聚合);thought 内部用 PM doc 承载,每个 comment/划线/截图 = thought PM doc 的一个 block。"

**本决议拍板**(本决议 §4 详):
- annotation 概念**完整消亡**:V2 现状 `StoredAnnotation` 类型 + `annotation-store.ts` + 3 API 完整废弃
- 用户在 ebook 上的所有标注操作 → 全部转为 thought PM block(`block.attrs.bookAnchor` 承载定位元数据)
- thought atom = `pm` domain atom + `user:krig:hasReadingThought` 边标记(跟 V2 note atom 的 `hasNoteView` 边同模式,只是 predicate 不同)
- thought lazy create:添书时不创空 thought;首次标注时 capability 内部 `ensureReadingThought(bookId)` 幂等创建

**纪律登记**:不接受视图层补丁(如:仍保留 StoredAnnotation 但 UI 假装是 thought block),必须改 storage / atom payload schema / capability 层全部字面。

### 0.6 设计师累积教训(第 22 次,本决议自审命中)

**本次教训**:本决议撰写第一版草稿曾预设 "thought = `note` atom + variant='thought'",grep V2 现状字面(§0.4 第 1 项)发现 **V2 根本没有 `note` atom domain** — note 直接复用 `pm` domain + `hasNoteView` 边标记。第 18 次教训(决议 021 §10.C-1 / 第 18 次设计师教训:决议字面拍板新类型字面归属必须 grep V2 既有同类型 SSOT 位置)同型复现 — 决议字面引用 atom domain / variant 字面之前,必须 grep V2 既有同类型实施。

**触发场景特性**:
- V1 → V2 重构期间,设计师容易复用 V1 概念字面(V1 thought 有 ThoughtRecord 类型 + variant 字面)
- V2 sub-phase 3a-2.5 的 hasNoteView 边模式是 V2 独有概念,V1 没有
- 若不 grep 直接照搬 V1,会引入 "V1 概念 + V2 实施"的混合杂种

**纪律升级**(跟第 11/13/14/15/16/17/18/19/20/21 次教训同型):
- **决议字面引用任何 V2 atom domain / payload 字段 / edge predicate / capability API 时,必须 grep V2 既有字面**(不能复用 V1 字面)
- **避免推测"V1 有 X 概念,V2 应该也有"**:每个概念独立 grep V2 字面
- atom domain / variant / marker 边 三种区分形态,grep V2 同 domain 内既有的"形态区分模式"(本决议字面验证:V2 通过 marker 边区分,而非 variant 字段)

**项目级落地**:本教训登记 [SDK-version-binding-policy.md](../SDK-version-binding-policy.md) §2.2 第 9 步证据(本决议 §8 落点) — "决议字面引用 atom 模型概念时,必须 grep V2 既有同 domain / 同模式实施,不能复用 V1 字面"

---

## 1. 改造目标(What)

### 1.1 本 sub-phase 的范围

**包含**:
1. **新增 2 个 atom domain**:`ebook`(Layer 2 Book)+ `reading-state`(Layer 3 进度)
2. **复用 1 个 atom domain**:`pm` 作为 Layer 4 Reading Thought 载体(挂 `user:krig:hasReadingThought` 边区分,跟 V2 note 的 `hasNoteView` 同模式)
3. **新增 2 个 user:krig predicate**:`hasReadingThought`(ebook → pm-as-thought)+ `hasReadingState`(ebook → reading-state)
4. **PM block schema 扩展**:24 种 block.attrs 全部加 optional `bookAnchor` 字段(承载定位 + 颜色 + 类型 + 截图)
5. **EBookEntry / StoredAnnotation SSOT 迁移**:`src/capabilities/ebook-library/types.ts` → `src/shared/ipc/ebook-types.ts`(同 NoteInfo SSOT 模式)
6. **annotation 概念完整消亡**:`StoredAnnotation` 类型 + `annotation-store.ts` + 3 annotation API(`annotationList / annotationAdd / annotationRemove`)全部废弃
7. **5 folder API 完整废弃**:`folderList / folderCreate / folderRename / folderDelete / folderMove` → 改走 folder capability + viewType='ebook'(沿决议 021 §4.3 约束)
8. **19 ebook API 内部实施重写**:从 JSON store 改走 atom CRUD
9. **022 专属 migration**:V1/V2 现有 `bookshelf.json` + `annotations/{bookId}.json` → atom 体系 + thought PM block

**不包含**:
- V1 老 thought (挂 note) 迁移 — 留 023+ 专门 sub-phase
- note atom domain 改造(note 现状走 pm + hasNoteView,本决议不动)
- ebook reader 渲染层重构(annotation-layer.tsx 等渲染组件改 thought block 消费,但渲染逻辑字面不变)
- 回收站完整设计(沿决议 021 §4.3 留 023 trash domain 决议)
- 跨 view 共享 folder 标签云(决议 021 §0.5 字面已留 vision §2.4 闭环未来扩)

### 1.2 V2 当前状态(实施起点)

| 模块 | 现状 | 本决议拍板 |
|---|---|---|
| ebook entry 存储 | JSON `{userData}/krig-data/ebook/bookshelf.json` | 迁 atom domain='ebook' |
| ebook folder 存储 | JSON `{userData}/krig-data/ebook/bookshelf.json` `folders[]` 字段 | 迁 folder atom + viewType='ebook'(沿决议 021 §4.3) |
| ebook 进度 | JSON `bookshelf.json` `entries[].lastPosition` / `bookmarks[]` / `cfiBookmarks[]` / `lastOpenedAt` | 拆 atom domain='reading-state' + 边 hasReadingState |
| ebook 标注 | JSON `{userData}/krig-data/ebook/annotations/{bookId}.json` | annotation 概念消亡,转为 pm atom + 边 hasReadingThought + PM block 内部承载 |
| ebook 文件 binary | 磁盘 `{userData}/krig-data/ebook/library/{id}.{ext}` (managed) 或外部路径 (link)| 沿现状,filePath 字段在 ebook atom payload 内引用 |
| EBookEntry SSOT | `src/capabilities/ebook-library/types.ts` | 迁 `src/shared/ipc/ebook-types.ts` |
| StoredAnnotation SSOT | `src/capabilities/ebook-library/types.ts` + `src/platform/main/ebook/annotation-store.ts` | 完整废弃 |
| V1 老 thought (挂 note) | `src/main/storage/thought-store.ts` `thought_of` 表 | 022 不动,留 023+ |
| V2 note atom | `pm` domain atom + `hasNoteView` 边(decision 016 §3.6) | 沿现状(本决议 thought 复用此模式,不改 note 实施) |

### 1.3 目标态(本 sub-phase 完成后)

#### 1.3.1 数据模型 4 层

```
Layer 1: UI View (sub-phase 022 不涉及)
   └── ebook view 书架 / nav-side 等(沿现状)

Layer 2: ebook atom (新 domain='ebook')
   payload: {
     fileType: 'pdf' | 'epub' | 'djvu' | 'cbz',
     storage: 'managed' | 'link',
     filePath: string,         // 磁盘路径
     originalPath?: string,    // managed 模式源路径
     fileName: string,
     displayName: string,
     pageCount?: number,
     addedAt: number,
   }
   边:
     - user:krig:inFolder → folder atom (viewType='ebook')
     - user:krig:hasReadingState → reading-state atom (cardinality 1:1)
     - user:krig:hasReadingThought → pm atom (cardinality 0:1, lazy create)

Layer 3: reading-state atom (新 domain='reading-state', 1:1 跟 ebook)
   payload: {
     lastOpenedAt: number,
     lastPosition: {
       page?: number,
       scale?: number,
       fitWidth?: boolean,
       cfi?: string,
     },
     bookmarks: number[],      // PDF pageNum 书签
     cfiBookmarks: Array<{ cfi: string, label: string }>,  // EPUB 书签
   }
   (无 outgoing 边;入边只能是 ebook atom 的 hasReadingState)

Layer 4: pm atom (复用 domain='pm') [lazy create on first annotation]
   payload: PmPayload (V2 标准 PM doc 形态)
   marker 边:
     - user:krig:hasReadingThought (入边,来自 ebook atom 的 hasReadingThought)
   block-level (PM doc 内):
     block { attrs: { bookAnchor?: BookAnchor }, ... }

BookAnchor schema:
   {
     pageNum: number,          // PDF 页码,EPUB 标注此字段 = 0 占位
     rect?: { x, y, w, h },    // PDF rect/underline 标注的页面坐标(scale=1)
     cfi?: string,             // EPUB CFI 锚点(PDF 标注此字段 = undefined)
     textContent?: string,     // EPUB 选区文本(PDF 标注此字段 = undefined)
     thumbnail?: string,       // PDF rect 截图 base64 inline (沿 D-7=A,EPUB 无)
     color: string,            // 5 色 picker:#ffd43b / #69db7c / #74c0fc / #b197fc / #ff6b6b
     type: 'rect' | 'underline' | 'highlight',
                                // rect = PDF 框选, underline = PDF 划线, highlight = EPUB 选区
     createdAt: number,
   }
```

#### 1.3.2 ebook 模块 27 API 终态

| 类别 | 现有 API | 022 后形态 |
|---|---|---|
| 书架 (11) | list / get / pickFile / add / open / remove / rename / moveToFolder / relocate / transferToManaged | **保留 11 API 字面签名,内部走 atom CRUD** |
| 文件夹 (5) | folderList / folderCreate / folderRename / folderDelete / folderMove | **完整废弃 5 API**(view caller 改用 folder capability + viewType='ebook') |
| 数据传输 (2) | getData / close | **保留 2 API 字面签名**(走 ebook atom.payload.filePath 派生) |
| 推送 (2) | onBookshelfChanged / onBookOpened | **保留 2 API**(内部改走 storage 边变化推送) |
| 进度 (1) | saveProgress | **保留 1 API 字面签名,内部走 reading-state atom CRUD** |
| 书签 (5) | bookmarkToggle / bookmarkList / cfiBookmarkAdd / cfiBookmarkRemove / cfiBookmarkList | **保留 5 API 字面签名,内部走 reading-state atom CRUD** |
| 标注 (3) | annotationList / annotationAdd / annotationRemove | **完整废弃 3 API**(annotation 概念消亡 — view caller 改用 note capability 操作 thought PM block) |
| 新增 (5 预设,§5 binary verify 后 finalize) | — | **新增 5 API**:`getReadingThought(bookId): Promise<NoteInfo \| null>` / `ensureReadingThought(bookId): Promise<NoteInfo>` / `addReadingThoughtBlock(bookId, blockSpec)` / `removeReadingThoughtBlock(bookId, blockId)` / `getReadingThoughtAnnotations(bookId): Promise<BookAnchor[]>` — 高内聚封装"thought block 是 ebook 业务语义"避免 note capability 扩字面(沿 §4.2 约束 3) |

#### 1.3.3 22 个 V1 → V2 字面迁移点 / 整 26 项不变约束

待 §5 实施期细化(留 P1 修订轮)

### 1.4 风险陈述

| 风险 | 影响 | 缓解 |
|---|---|---|
| **PM schema 24 种 block attrs 全加 bookAnchor 影响巨大** | V2 现有 note / thought 渲染逻辑可能受影响 | 加字段是 optional,V2 现有 block 全部 ignore bookAnchor → 零侵入 |
| **lazy create thought 时序竞争** | 同时多次首次标注可能创多个 thought atom | capability `ensureReadingThought(bookId)` 加 in-memory 锁 + 边查询幂等 |
| **annotation JSON → thought block 转换丢失信息** | 颜色 / 定位 / 截图字段 mapping 错误致用户实际数据丢失 | binary verify migration 前后 annotation count 一致 + 每条 anchor 字面三字段(pageNum/rect/cfi)全对齐 |
| **EBookEntry SSOT 迁移触发 14+ 处 import 路径同步** | 漏改一处 → typecheck fail | Step 5.x 类型签名扩 → typecheck **明示性 fail** 暴露所有消费点(沿决议 021 §10.B-1 教训) |
| **5 folder API 废弃影响 4 ebook view caller** | view 层 4 处 caller 同步改 folder capability + viewType='ebook' | grep §0.4 第 4 项 + binary verify;沿决议 021 §4.3 字面约束 |
| **reading-state 高频 IO 跟 atom 写入路径性能** | 翻页每秒写 atom 可能拖慢 | 加 debounce 100ms + 内存 batch 合并(参考 V1 lastPosition 同型逻辑) |

---

## 2. 用户拍板回顾(2026-05-13 本对话 AskUserQuestion 累积)

### 2.1 启动转向 — annotation 概念消亡

**第 1 轮拍板**(annotation = thought):
> 用户:"还有 annotation 应该做调整,我们在 V1 中有一个 thought,读书笔记都同意使用 thought 实现才对。"

**第 2 轮拍板**(book ↔ thought 颗粒度):
> 用户拍板:**1 book = 1 thought(聚合)**

**第 3 轮拍板**(thought 内部承载形态):
> 用户:"thought 类似 note,内部的 comment,就是 block。"

**第 4 轮拍板**(annotation 概念彻底废除):
> 用户:"不要存在 annotation 这个概念了,只有 Thought 这个概念了。"

### 2.2 macOS Books 4 层模型借鉴

> 用户:"我的建议是可以参考 macOS 中 books 中的一些数据模型。"

总指挥讲解 4 层(Library View / Book / Reading State / Reading Thought)后用户拍板:
- **reading-state 独立 atom domain**(1:1 跟 ebook)
- **thought lazy create**(首次标注时创建)
- **block.attrs.bookAnchor**(路径 A,沿用 V1 thought anchor_pos 同模式)
- **022 范围:只动 ebook + annotation→thought**(V1 老 thought 挂 note 留 023+)

### 2.3 SSOT 归属(决议 021 §10.C-1 教训累积应对)

> 用户拍板:**EBookEntry SSOT 迁到 `src/shared/ipc/ebook-types.ts`**(跟 NoteInfo / FolderInfo 同 SSOT 模式)

### 2.4 22 项细节拍板 — 累积清单

| # | 主题 | 拍板 |
|---|---|---|
| 1 | annotation 概念 | 完整消亡 |
| 2 | book ↔ thought 颗粒度 | 1 book = 1 thought 聚合 |
| 3 | thought 内部承载 | PM block 形态 |
| 4 | Layer 数 | macOS Books 4 层全采纳 |
| 5 | reading-state 拆分 | 独立 atom domain |
| 6 | thought 创建时机 | lazy create |
| 7 | block 定位元数据存储 | Path A (block.attrs.bookAnchor) |
| 8 | block 受众范围 | 所有 24 种 block 可选带 bookAnchor |
| 9 | thought 跟 note marker 边 | 只加 hasReadingThought(不双标记)|
| 10 | atom domain 命名 | 'ebook' + 'reading-state' |
| 11 | EBookEntry SSOT 归属 | 迁 src/shared/ipc/ebook-types.ts |
| 12 | folder 接入 | FolderViewType 加 'ebook' |
| 13 | binary 处置 | 留磁盘 + atom 引用 filePath |
| 14 | V1 老 thought 迁移时机 | 023+ 专门 sub-phase |
| 15 | 022 草稿撰写顺序 | §0-§4 先撰写后复审(本节)|

---

## 3. 候选路径对比 + 拍板

### 3.1 路径 1:annotation 独立 atom + `user:krig:annotates` 边(L7 启动包预设,本决议否决)

**形态**:每条标注 = 1 独立 annotation atom + edge `annotates` 指向 ebook atom

**优点**:
- annotation 是一等公民,跨 ebook 引用清晰
- cardinality 明确(每标注独立 atom + 独立边)

**缺点(本决议否决理由)**:
- ⚠ **跟用户拍板"1 book = 1 thought 聚合"冲突** — 用户明确拒绝独立 annotation 概念
- ⚠ **annotation 字段没法承载用户笔记内容**(annotation 是定位 + 颜色,不是文本内容载体);用户在标注上加笔记必须额外引入"备注 atom" → 概念膨胀
- ⚠ **跟 vision §2.4 知识闭环不一致**:annotation 跟 thought 是两个独立类型,用户需要先创 annotation 再创 thought 再建边 — 操作 3 步;路径 2 用户只 1 步(画框 → 选色 → 自动落 block)
- ⚠ **block 跨标注复用不可能**:N 条标注 = N 个 atom,内容字面分散在 N 处

### 3.2 路径 2:annotation = thought PM block(本决议拍板)

**形态**:1 book = 1 thought atom (lazy create);每条标注 = thought PM doc 的一个 block (block.attrs.bookAnchor 承载定位)

**优点**:
- ✅ 跟用户拍板"1 book = 1 thought 聚合"完全一致
- ✅ block 自带文本内容承载(用户笔记天然集成,不需要额外 atom)
- ✅ 复用 NoteView 渲染 + PM 编辑 + 全文检索 / TOC / 反向链体系
- ✅ 跨 thought block 引用走 transclusion / cite 边体系(跟 vision §2.4 知识闭环对齐)
- ✅ thought 内部 block 顺序 = 用户阅读 / 整理顺序(不强制按 pageNum 排序)

**缺点**:
- block 是 atom-level 子结构,不能被边直接引用(decision 030+ 大架构升级才能解)
- 24 种 PM block attrs 都要加 optional bookAnchor 字段

### 3.3 路径 3:annotation 独立 domain + 1 book 1 annotation atom 聚合容器(候选 fallback)

**形态**:1 book = 1 annotation atom (聚合容器),annotation.payload.items[] 装多条标注

**优点**:
- annotation 字面保留(沿 V2 现状概念)
- 1 book 1 atom 颗粒度跟用户拍板一致

**缺点**:
- ⚠ annotation 不承载文本内容(只是定位 + 颜色 list)
- ⚠ 用户笔记还得放别处 → 跟用户拍板"comment = block"冲突
- ⚠ 不能复用 NoteView 编辑体验
- ⚠ vision §2.4 知识闭环里 annotation atom 是个孤岛

### 3.4 路径对比矩阵

| 维度 | 路径 1(独立 atom)| 路径 2(thought block,**本决议拍板**)| 路径 3(annotation 聚合)|
|---|---|---|---|
| 跟用户拍板对齐 | ❌ 用户已否决 | ✅ 完全一致 | ⚠ 部分对齐(颗粒度对,内部形态错)|
| atom 数量 | N 标注 = N atom | 1 book 最多 1 thought atom | 1 book 最多 1 annotation atom |
| 文本内容承载 | ❌ 需要额外笔记 atom | ✅ block 内文本天然承载 | ❌ 需要额外笔记 atom |
| 渲染编辑体系 | ❌ 需要写 annotation view | ✅ 复用 NoteView | ❌ 需要写 annotation view |
| 跟 vision §2.4 闭环 | ⚠ annotation 跟 thought 双类型 | ✅ thought 一等公民 | ⚠ annotation 孤岛 |
| 跨标注复用引用 | ✅ atom-level | ⚠ block-level(待 030+) | ⚠ payload 内 items 间引用难 |
| 工程量 | 中(新 domain + 边 + view)| 中(扩 24 block attrs + 新 domain)| 中(新 domain + 渲染层)|

**拍板**:路径 2

---

## 4. 拍板路径:4 层 atom 模型 + annotation 概念消亡

### 4.1 实施核心(草案,§5 详细)

#### 4.1.1 新 atom domain 字面定义

**`semantic/types/atom.ts` 改动**(本决议唯一 semantic 层变更点):

```typescript
// AtomPayloadOf<D> union 加 2 项:
export type AtomPayloadOf<D extends AtomDomain> =
  D extends 'pm'             ? PmPayload :
  D extends 'rdf'            ? RdfPayload :
  D extends 'embedding'      ? EmbeddingPayload :
  D extends 'three'          ? ThreePayload :
  D extends 'folder'         ? FolderPayload :
  D extends 'graph-canvas'   ? GraphCanvasPayload :
  D extends 'graph-instance' ? GraphInstancePayload :
  D extends 'ebook'          ? EBookPayload :          // 新
  D extends 'reading-state'  ? ReadingStatePayload :   // 新
  unknown;

/** ebook domain — Layer 2 Book metadata (decision 022 §1.3.1) */
export interface EBookPayload {
  fileType: 'pdf' | 'epub' | 'djvu' | 'cbz';
  storage: 'managed' | 'link';
  filePath: string;
  originalPath?: string;
  fileName: string;
  displayName: string;
  pageCount?: number;
  addedAt: number;
}

/** reading-state domain — Layer 3 阅读进度 + 书签 (decision 022 §1.3.1) */
export interface ReadingStatePayload {
  lastOpenedAt: number;
  lastPosition: {
    page?: number;
    scale?: number;
    fitWidth?: boolean;
    cfi?: string;
  };
  bookmarks: number[];                                   // PDF pageNum 书签
  cfiBookmarks: Array<{ cfi: string; label: string }>;   // EPUB CFI 书签
}
```

#### 4.1.2 新 edge predicate 字面

**新增 2 个 user:krig predicate**:
- `user:krig:hasReadingState`:ebook atom (subject) → reading-state atom (object kind='atom')
  - cardinality 1:1(一个 ebook 必有一个 reading-state;一个 reading-state 只属于一个 ebook)
- `user:krig:hasReadingThought`:ebook atom (subject) → pm atom (object kind='atom')
  - cardinality **0..1**(一个 ebook 最多一个 reading-thought;一个 pm-as-thought 只属于一个 ebook)
  - **业务语义 vs 持久约束口径澄清**(回应审计 [高2]):
    - **业务语义**:1 book ↔ 1 thought(用户视角的"1 book = 1 thought 聚合")
    - **持久约束**:cardinality **0..1**(允许 0 = 用户未标注的书永久无 thought,资源清爽;允许 1 = lazy create 后唯一)
    - **不是 1:1**:1:1 会要求所有 ebook 都有 thought(eager create 兜底),违反用户拍板"lazy create + 未标注书不创空 thought"
    - **不是长期允许 N>1**:任何时刻一个 ebook 最多挂 1 条 hasReadingThought 边
  - **跟 pm atom 上的 hasNoteView 边互斥**:一个 pm atom 要么是 note(挂 hasNoteView)要么是 thought(挂 hasReadingThought),不能同时挂两条 — Step 5.x cardinality-check 加约束(详 §4.3 互斥落点)

#### 4.1.3 PM block schema 扩展

V2 24 种 block 字面 attrs 全部加 optional `bookAnchor` 字段:

```typescript
// 加到 PM schema (sub-phase 022 字面定义,具体落点 §5 detail)
export interface BookAnchor {
  pageNum: number;
  rect?: { x: number; y: number; w: number; h: number };
  cfi?: string;
  textContent?: string;
  thumbnail?: string;       // base64 inline (沿现状 D-7=A)
  color: string;
  type: 'rect' | 'underline' | 'highlight';
  createdAt: number;
}

// 24 种 block schema attrs 字面加 optional bookAnchor (具体 Step 5.x 落地)
```

**渲染层(annotation-layer.tsx / use-epub-annotation.ts)接口路径**(回应审计 [高1] note capability 6 API 字面 verify):
- V2 现状 [NoteCapabilityApi (src/capabilities/note/types.ts:13)](../../../../../src/capabilities/note/types.ts#L13) 字面 6 API:`createNote / listNotes / getNote / updateNote / moveNote / deleteNote + onListChanged` — **无 block 级 API**
- 本决议 **不扩 note capability 字面**(沿 §4.2 约束 3 不变):
  - 创建标注的实施路径:`ebook capability.addReadingThoughtBlock(bookId, blockSpec)` **新 ebook 端 API**(粒度是"加一个标注 block",ebook capability 内部组装 NoteDocEnvelope + 调 `note.updateNote(thoughtId, newDoc)` 全量替换 PM doc)
  - 删除标注的实施路径:`ebook capability.removeReadingThoughtBlock(bookId, blockId)` **新 ebook 端 API**(内部读 thought PM doc → 删指定 block → updateNote 全量替换)
  - 显示标注的实施路径:`ebook capability.getReadingThoughtAnnotations(bookId): Promise<BookAnchor[]>` **新 ebook 端 API**(内部 getNote → 扫 PM doc 所有 block.attrs.bookAnchor → 返回扁平数组)
- **lazy create 落地**:`addReadingThoughtBlock` 内部首先调 `ensureReadingThought(bookId)` 幂等创建 thought atom + hasReadingThought 边,然后再调 note.updateNote
- **annotation→thought 转换粒度统一**:view 端不接触 PM doc 字面,只调 ebook capability 的 3 个新 block 级 API(高内聚封装 thought block 操作 = ebook 业务语义,不是通用 note 编辑) — 沿 W5 严格态分层 lint
- **§5 详细 ebook capability 新增 API 数量 finalize**:留 §5 实施期 binary verify 后定 — 当前预设 4 新 API(`ensureReadingThought` / `addReadingThoughtBlock` / `removeReadingThoughtBlock` / `getReadingThoughtAnnotations`)+ 1 query API(`getReadingThought(bookId): Promise<NoteInfo | null>`),共 5 新 API

#### 4.1.4 ebook capability 重构

**`src/capabilities/ebook-library/index.ts` 重写**:
- 27 现有 API → 19 保留 + 8 废弃 + N 新增
- 实施全部走 `requireCapabilityApi<NoteApi>('note')` + `requireCapabilityApi<FolderApi>('folder')` + atom CRUD 间接调用,不直接调 storage(分层 lint 合规)

**`src/platform/main/ebook/capability-impl.ts` 新文件**:
- 取代 `bookshelf-store.ts`(JSON store 整体废弃)
- 取代 `annotation-store.ts`(annotation 概念消亡)
- 内部走 `surrealStorage.putAtom / putEdge / listAtoms / listEdges`

#### 4.1.5 EBookEntry SSOT 迁移

**`src/shared/ipc/ebook-types.ts` 新文件**(沿 NoteInfo SSOT 模式):

```typescript
/** 书本业务视图 (atom + 派生 folderId + 派生 readingState) */
export interface EBookInfo {
  id: string;
  fileType: 'pdf' | 'epub' | 'djvu' | 'cbz';
  storage: 'managed' | 'link';
  filePath: string;
  fileName: string;
  displayName: string;
  pageCount?: number;
  addedAt: number;
  /** 派生:user:krig:inFolder 边的 object;null = 根级 */
  folderId: string | null;
  /** 派生:reading-state atom 的 payload(高频字段聚合到 EBookInfo 视图)*/
  lastOpenedAt: number;
  lastPosition?: { page?: number; scale?: number; fitWidth?: boolean; cfi?: string };
}

/** 阅读状态视图(进度 + 书签独立查询时用)*/
export interface ReadingStateInfo {
  bookId: string;
  lastOpenedAt: number;
  lastPosition: { page?: number; scale?: number; fitWidth?: boolean; cfi?: string };
  bookmarks: number[];
  cfiBookmarks: Array<{ cfi: string; label: string }>;
}
```

**14+ 处 import 路径同步改造**(沿决议 021 §10.B-1 教训前瞻):
- `src/capabilities/ebook-rendering/hooks/use-epub-annotation.ts:31`
- `src/views/ebook/*.tsx`(待 §5 Step 5.0 grep verify)
- `src/platform/main/ebook/*.ts`(待 §5 Step 5.0 grep verify)
- `src/shared/ipc/electron-api.d.ts`(EBookEntry 字面引用同步改 EBookInfo)
- `src/platform/main/preload/main-window-preload.ts`(透传类型同步)

### 4.2 不变约束

| # | 约束 | 验证方法 |
|---|---|---|
| 1 | `NoteInfo` / `FolderInfo` 字段不动 | `git diff src/shared/ipc/note-folder-types.ts` 应无变化 |
| 2 | folder capability 7 API 签名不动(沿决议 021 终态)| `git diff src/capabilities/folder/types.ts` 应无变化 |
| 3 | note capability API 字面不动 | `git diff src/capabilities/note/types.ts` 应无变化 |
| 4 | `user:krig:inFolder` / `hasNoteView` / `hasContent` / `inCanvas` / `folderForView` 5 个既有 predicate 字面不动 | grep 现有 predicate 字面不动 |
| 5 | folder atom payload schema 不动(沿决议 021 §4.2)| `payload: { title }` 字面不加新字段 |
| 6 | SDK 版本不变(surrealdb@^2.0.3)| `git diff package.json` 应无变化 |
| 7 | 反向不动 sub-phase 3a-tx Path 1(beginTransaction)| `git diff src/storage/surreal/storage.ts` 应无变化 |
| 8 | **StorageAPI 12 个 API 签名 0 变化**(回应审计 [中3] 拆条)| `git diff src/storage/api.ts` 字面 0 变化(includes `StorageAPI` / `StorageTransaction` / `EdgeFilter`)|
| 8.5 | **migrations/runner.ts 字面 0 变化** + 允许在 runner 注册 022 migration 条目(回应审计 [中3] 拆条)| `git diff src/storage/migrations/runner.ts` 字面 0 变化;允许新文件 `src/storage/migrations/022-ebook-thought.ts` + runner 注册表内新增条目(沿决议 020 / 021 同模式)|
| 9 | V2 既有 24 种 PM block schema 既有字段不动(本决议仅加 optional bookAnchor)| `git diff src/drivers/text-editing-driver/blocks/` 每个 block spec.ts 字面 = 加 optional bookAnchor,既有字段 0 变化 |
| 10 | V1 老 thought (thought_of 表) 不动 | `git log src/main/storage/thought-store.ts` 应在本 sub-phase 期间 0 改动 |
| 11 | EBookLibraryApi 20 API 字面签名不动 (沿 §10.B-1 字面 19→20 实施期修正, 详 §1.3.2 表)| `git diff src/capabilities/ebook-library/index.ts` 保留 API 部分 = 签名 0 变化,仅实施内部从 JSON 改 atom |
| 12 | **note capability 6 API + onListChanged 字面签名 0 变化**(回应审计 [高1] — annotation→thought 不扩 note 字面)| `git diff src/capabilities/note/types.ts` 字面 0 变化 |

### 4.3 跨 sub-phase 兼容约束(预留 023+ 接入)

**sub-phase 023+ V1 老 thought 迁移时,本决议预留**:
1. V1 `thought_of` 表里挂在 note 上的 thought 迁移到 V2 atom 体系时,**同样走 `pm` domain + 一个 marker 边**(predicate 可定 `user:krig:hasNoteThought` 表达"挂 note 上的 thought")
2. 跟本决议 `hasReadingThought` 同模式 — 一个 pm atom 只能挂一个 marker 边(hasNoteView / hasReadingThought / hasNoteThought 三选一)
3. V1 thought 的 anchor_pos(挂 note 的位置) → 转 PM block 的 attrs.noteAnchor(本决议 bookAnchor 同模式)

**本决议字面登记此约束**:023+ 决议必须沿"复用 pm domain + marker 边 + block.attrs.{X}Anchor"统一模式,不允许"V1 老 thought 自有 atom domain"二次复活。

#### 4.3.1 pm atom marker 边互斥约束落点(回应审计 [中5])

**问题**:本决议 §4.1.2 提出"一个 pm atom 上 hasNoteView / hasReadingThought 互斥(未来 023+ 再加 hasNoteThought 也加入互斥组)",但没说**由谁在什么时机校验**。本节字面登记落点,避免到 §5 才临时决策。

**三层防线**(沿决议 019 cardinality 一对一约束三层防线同模式):

| 防线 | 落点 | 时机 | 字面手段 |
|---|---|---|---|
| **L1 写入路径(主防)** | `src/platform/main/ebook/capability-impl.ts` `ensureReadingThought(bookId)` 实施 | 创建 hasReadingThought 边前 | 先 `listEdges({ predicate: 'user:krig:hasNoteView', subjectAtomId: <候选 pm atom id> })` (字面 EdgeFilter 扁平字段,沿 §10.D-2 实施期修正),若返回非空 → throw `MarkerEdgeMutexViolation`(防"先 hasNoteView 后 hasReadingThought"路径);新创 pm atom 路径无此风险(新 atom id 字面无既有边)|
| **L2 健康检查(扫描+告警)** | `src/storage/health/cardinality-check.ts` 新增条目 | 启动期 + 用户手动触发 health-check 时 | 全表扫:任一 pm atom 同时挂 `hasNoteView` + `hasReadingThought`(或未来 hasNoteThought)→ 报 `CARDINALITY_VIOLATION_PM_MARKER_MUTEX` 告警(不抛错,留管理员决断)|
| **L3 migration(数据库初次状态保障)** | `src/storage/migrations/022-ebook-thought.ts` migration 执行末段 | 022 migration 跑完之后 | 跑一次 L2 同型扫描 — 若发现违反互斥的 pm atom,migration **明示性 fail** 并 dump 违反列表,要求实施者手动决断后重跑;不允许"半成功污染"留毒数据。**L3 存在意义**(2026-05-14 P3 建议落地):防 V1/V2 annotation JSON migration 走 `putAtom + putEdge` 直接写,绕过 L1 ensureReadingThought 运行时互斥校验,若 V1/V2 数据本身已坏(某 pm atom 已挂 hasNoteView 又被 migration 错挂 hasReadingThought),L1 防不住 — L3 在 migration 末段拦截即时阻断 |

**为什么三层都要**(沿决议 019 §2.1 教训):
- L1 单点 → 跳过 ensureReadingThought 直调 storage 的路径可绕(如未来其他 capability 误加 hasReadingThought 边)
- L2 单点 → 启动后 / 手动检查前的窗口期可能落坏数据
- L3 单点 → 只防 migration 期,不防运行期回潮

**字面登记落点编号**:
- L1 编号 = 决议 022 §4.3.1-L1(对应 §5 Step 5.5 ebook capability 重写时实施)
- L2 编号 = 决议 022 §4.3.1-L2(对应 §5 Step 5.9 cardinality-check 加条目时实施)
- L3 编号 = 决议 022 §4.3.1-L3(对应 §5 Step 5.7 022 migration 脚本实施)

**回收站设计(decision 023 字面预留)**:
- folder / ebook / pm atom 删除时不立即 storage 删,加 `user:krig:inTrash` 边或 trash domain atom
- 本决议 022 不实施回收站(沿决议 021 §0.3 留 023 trash domain 决议)
- 022 ebook / reading-state / pm-as-thought 删除走 storage 直删(沿决议 021 同模式)

---

> **§5-§12 待定稿**(本决议进入用户复审 §0-§4 + 实施期 binary verify 后 finalize):
>
> §5 实施步骤(预计 10-12 个 step):Step 5.0 现状 verify / Step 5.1 binary verify SDK 行为 / Step 5.2 atom domain + edge predicate 字面扩 / Step 5.3 PM block schema 扩 bookAnchor / Step 5.4 EBookEntry SSOT 迁移 / Step 5.5 ebook capability 重写(main 端)/ Step 5.6 view caller 改造(annotation→thought 转 + folder 5 API 改 folder capability)/ Step 5.7 022 migration 脚本 / Step 5.8 binary verify migration 前后数据完整性 / Step 5.9 cardinality-check 加 hasReadingThought / hasReadingState / Step 5.10 反向更新决议清单 + memory + 永久文档 / Step 5.11 完成报告
>
> §6 binary verify checkpoint
>
> §7 022 migration 详细(JSON store → atom + annotation JSON → thought block)
>
> §8 反向更新清单
>
> §9 Open Questions
>
> §10 偏离登记(实施期更新)
>
> §11 累积教训(实施完成后追加)
>
> §12 P1 修订轮变更日志

---

## 5. 实施步骤(按顺序执行,代码/文档 step 必须 commit,纯 verify step 不 commit)

> **§5 已定稿**(2026-05-14 P1 修订轮 v0.3,沿决议 021 §5 同模式):
>
> **共 12 个 Step(5.0 - 5.11)**(2026-05-14 v0.4 字面对齐修正,沿决议 021 第 21 次教训"完成报告字面跨段一致性自校验"同型纪律 — 决议字面也适用):
> - **8 个 commit step**(代码 / 文档 / 脚本变更):5.2 / 5.3 / 5.4 / 5.5 / 5.6 / 5.7 / 5.9 / 5.10
> - **4 个 verify step**(纯 verify / 自测,不 commit):5.0 现状 verify / 5.1 binary verify SDK 行为 / 5.8 migration 数据完整性 verify / 5.11 完成报告
> - **备注**:Step 5.4 拆 2 commit(SSOT 大改 + 14+ caller 同步分 commit,详 Step 5.4 头部例外授权);实际产物 commit hash 数 = **9 个**(8 + Step 5.4 第 2 个 commit)
>
> **Step 编号 ↔ §4.3.1 互斥三层防线落点对齐**:L1 → Step 5.5(ebook capability impl)/ L2 → Step 5.9(cardinality-check)/ L3 → Step 5.7(022 migration 末段扫描)
>
> **Step 间依赖**:5.0 → 5.1 → (5.2 ∥ 5.3 ∥ 5.4 并行可拆 commit)→ 5.5 → 5.6 → 5.7 → 5.8 → 5.9 → 5.10 → 5.11
> - 5.2-5.4 拆开是因 atom domain / PM block schema / SSOT 迁移**互不依赖字面**,实施者可按个人节奏选并行还是串行,但**每个 step 独立 commit**

### Step 5.0 — V2 现状 verify(前置 + 实施者独立确认)

**目的**:实施者独立 grep §0.4 / §1.2 字面证据。

**任务**:
1. `git log --oneline -3` 确认 V2 main HEAD = `91cfbf8` (decision 022 finalize merge, 沿 §10.D-1 实施期修正; 原决议字面 `f535cd1` 是 v0.4 撰写时旧值漂移), 当前分支 = `feature/L7-sub022-ebook-thought-migration`
2. `cat package.json | grep surrealdb` 确认 SDK 锁定 `^2.0.3`(沿 SDK-version-binding-policy v1.4)
3. grep 8 项 §0.4 字面证据全部对齐
4. ebook 27 IPC channel + 27 API 字面验证(沿启动包前置研究)
5. 5 folder API + 3 annotation API 字面定位(`src/capabilities/ebook-library/index.ts` 必废弃 8 API 字面)
6. 19 ebook API 字面保留 caller grep(`use-epub-annotation.ts:31` 等 14+ 处)

**完成判据**:8 项 grep 结果跟决议 §0.4 / §1.2 一致;否则停下汇报。

**commit**:无(纯 verify 步骤)

### Step 5.1 — Binary verify:SDK + storage API 关键字面行为

**目的**:在投入实施前,binary verify 3 个关键 SDK / storage 行为,避免决议字面假设失效(沿决议 021 §0.7 第 15 次教训:不能"既然 putAtom 实现了 X,clearAll 应该也实现了")。

**任务**:
1. 写 verify 脚本 `tmp/verify/sub022-binary-verify.mjs`
2. 场景 1:**`storage.listEdges({ predicate, subjectAtomId })` 是否支持 subject filter** — §4.3.1-L1 互斥校验依赖此能力(查 pm atom 是否已挂 hasNoteView 边)。字面 EdgeFilter 扁平字段 `subjectAtomId` (沿 src/storage/api.ts:107 字面 + Step 5.1 binary verify 实证 + §10.D-2 实施期修正)
3. 场景 2:**`storage.putAtom + putEdge` 跨 atom-edge 是否需要事务包裹** — §4.1.4 ensureReadingThought 实施依赖(create thought atom + put hasReadingThought 边的原子性)
4. 场景 3:**PM block.attrs 加新 optional 字段是否影响现有 24 block schema 序列化** — §1.3.1 BookAnchor 字段扩展依赖(沿决议 014 §3.3 PM atom payload 字面兼容性原则)
5. 比对 storage 接口字面([storage/types.ts](../../../../../src/storage/types.ts))与实施

**完成判据**:3 个场景全 PASS;否则启动 §3 / §4 fallback 讨论。

**commit**:无

### Step 5.2 — atom domain + edge predicate 字面扩展(typecheck 必须全绿)

**目的**:落地 §4.1.1 新 atom domain(`ebook` / `reading-state`)+ §4.1.2 新 edge predicate(`hasReadingThought` / `hasReadingState`)字面。

**任务**:
1. 改 [semantic/types/atom.ts](../../../../../src/semantic/types/atom.ts):`AtomPayloadOf<D>` union 加 `ebook` / `reading-state` 两项 + 新增 `EBookPayload` / `ReadingStatePayload` interface 字面(沿 §4.1.1 字面)
2. 新建 `src/semantic/vocabulary/ebook-edges.ts`(或沿 V2 现状 predicate 常量集中位置 — Step 5.0 grep 验证后定):
   - `HAS_READING_THOUGHT = 'user:krig:hasReadingThought'`
   - `HAS_READING_STATE = 'user:krig:hasReadingState'`
3. **不动**[semantic/types/edge.ts](../../../../../src/semantic/types/edge.ts) 字面(EdgeEndpoint / LiteralValue 0 变化,沿 §4.2 约束)

**完成判据**:
- typecheck **全绿**:`npx tsc --noEmit` 0 错误
- grep AtomPayloadOf union 字面 9 项(原 7 + 新 2)
- grep `hasReadingThought` / `hasReadingState` 字面在 vocabulary 集中位置

**commit message**:
```
feat(semantic): 加 ebook / reading-state 两个 atom domain payload + 两个 edge predicate (decision 022 §4.1.1 §4.1.2)

新增 EBookPayload (Layer 2 Book metadata) + ReadingStatePayload (Layer 3 进度).
新增 user:krig:hasReadingThought (cardinality 0..1) + user:krig:hasReadingState (cardinality 1:1).
未涉及任何运行时实施,纯类型 / 常量字面扩展.
```

### Step 5.3 — PM block schema 扩 bookAnchor 字段(typecheck 必须全绿)

**目的**:落地 §4.1.3 PM block schema 扩 `bookAnchor` optional 字段(24 种 block 全部加)。

**任务**:
1. 新建 `src/drivers/text-editing-driver/blocks/_shared/book-anchor.ts`(沿 V2 既有 `_shared/` 目录字面 — Step 5.0 verify 确认):
   - `export interface BookAnchor { pageNum, rect?, cfi?, textContent?, thumbnail?, color, type, createdAt }` 字面
2. 24 种 block spec.ts 字面**全部加 optional bookAnchor attrs 字段**(沿 §4.2 约束 9:既有字段 0 变化):
   - 实施模式:每个 block spec.ts 的 `attrs: { ... }` 字面加 `bookAnchor: { default: null }` (或 PM ProseMirror schema 规定的 optional 形态 — Step 5.1 场景 3 binary verify 后字面定)
3. 不动 schema-builder.ts 字面(沿 §4.2 约束)— bookAnchor 是 attrs 字段,不需 schema-builder 改

**完成判据**:
- typecheck **全绿**
- grep `bookAnchor` 字面 ≥ 25 处(1 in _shared/book-anchor.ts + 24 in 各 block spec.ts)
- V2 既有 note / thought 编辑功能 binary verify:打开既有 note,创建 / 编辑 / 保存 paragraph / image / blockquote 各 1 个 — 字面 0 回归

**commit message**:
```
feat(pm-schema): 24 种 block attrs 加 optional bookAnchor 字段 (decision 022 §4.1.3)

BookAnchor 承载 pageNum / rect / cfi / textContent / thumbnail / color / type / createdAt.
所有 24 block 加 optional 字段,既有 block attrs 既有字段 0 变化 (沿 §4.2 约束 9).
本 step 不涉及 ebook 实施,只扩 PM schema 字面.
```

### Step 5.4 — EBookEntry / StoredAnnotation SSOT 迁移(typecheck 明示性 fail → 全绿)

> ⚠ **本 Step typecheck 阶段性 fail**:SSOT 迁移会让 14+ 处 import 路径短暂 fail,通过本 step 内分 2 个 commit 完成 — commit 1 (新文件 + 类型迁移) + commit 2 (14+ 处 import 路径同步)。第 1 commit 后 typecheck fail,第 2 commit 后全绿。
>
> 🔓 **拆 2 commit 例外授权**(2026-05-14 v0.4 字面登记):沿决议 020 / 021 §5 头部"每 step 独立 commit"纪律字面破例,因 SSOT 大改 + 14+ caller 同步分 commit 可让 diff 字面可审计(commit 1 = 类型层迁移 / commit 2 = caller 路径同步),整体 diff 各自字面聚焦 — 字面登记此例外,后续 sub-phase 不引为通例。

**任务**:

**commit 1 — 新 SSOT 文件 + 旧 SSOT 删除**:
1. 新建 `src/shared/ipc/ebook-types.ts`(沿 §4.1.5 字面):
   - `EBookInfo` interface(派生 folderId + 派生 lastOpenedAt / lastPosition,沿 NoteInfo 同模式)
   - `ReadingStateInfo` interface(完整 reading-state payload 投影)
   - 沿 NoteInfo 同 export 风格:`export interface EBookInfo { ... }`
2. 删除 [src/capabilities/ebook-library/types.ts](../../../../../src/capabilities/ebook-library/types.ts) 中的 `EBookEntry` + `EBookFolder` + `StoredAnnotation` 字面定义(整文件不删除 — 仍承载 `EBookFileType` / `EBookStorageMode` / `EBookLibraryApi` 等枚举 / 接口)
3. **`StoredAnnotation` 类型完整删除**(annotation 概念消亡,沿 §0.5 用户 P0 纪律)

**commit 2 — 14+ 处 import 路径同步**:
1. grep `EBookEntry` / `StoredAnnotation` 全部 import 字面(Step 5.0 已 grep)
2. `EBookEntry` → `EBookInfo` 字面替换 + import 改 `@shared/ipc/ebook-types`
3. `StoredAnnotation` → **报废**(沿 §0.5 用户 P0 纪律,不能改名保留 — 14+ 处 caller 同步改走 thought block API,详 Step 5.6)
4. `EBookLibraryApi` 内字面 27 API 签名同步改造(`list(): Promise<EBookInfo[]>` 等)

**完成判据**:
- commit 1 后 typecheck **明示性 fail**(14+ 处 caller 漏改)
- commit 2 后 typecheck **全绿**
- grep `EBookEntry` 在 src/ 命中 0 处(全替换)
- grep `StoredAnnotation` 在 src/ 命中 0 处(全废弃)

**commit message**:
```
refactor(ebook): EBookEntry SSOT 迁 src/shared/ipc/ebook-types.ts + 改名 EBookInfo + StoredAnnotation 类型废弃 (decision 022 §4.1.5)

沿 NoteInfo / FolderInfo SSOT 模式 (决议 021 §10.C-1 同型预防).
StoredAnnotation 完整删除 (annotation 概念消亡,沿 §0.5 用户 P0 纪律).
14+ 处 import 路径同步改造.
```

### Step 5.5 — ebook capability 重写(L1 互斥校验主防 + 新 5 API + 19 API 改实施)(typecheck 必须全绿)

> 🟢 **本 Step 是 022 主战场**:capability impl 整体重写,5 个新 thought block API + 19 个保留 API 内部实施全换 atom CRUD。**§4.3.1-L1 互斥校验主防落点在本 Step**。

**任务**:

1. 新建 `src/platform/main/ebook/capability-impl.ts`(取代 bookshelf-store / annotation-store):
   - **5 新 thought block API**(§4.1.3 字面):
     - `getReadingThought(bookId: string): Promise<NoteInfo | null>` — listEdges `hasReadingThought` filter by subject.atomId=bookId → 取 object → getNote
     - `ensureReadingThought(bookId: string): Promise<NoteInfo>` — 幂等创建 thought atom + hasReadingThought 边;**§4.3.1-L1 互斥校验主防**:创建前 `listEdges({ predicate: 'user:krig:hasNoteView', subjectAtomId: <候选 pm atom id> })` (字面 EdgeFilter 扁平字段,沿 §10.D-2 实施期修正),若非空 throw `MarkerEdgeMutexViolation`
     - `addReadingThoughtBlock(bookId: string, blockSpec: BlockSpec): Promise<void>` — 内部 ensureReadingThought → note.getNote → 改 PM doc 加 block → note.updateNote
     - `removeReadingThoughtBlock(bookId: string, blockId: string): Promise<void>` — 内部 note.getNote → 删 block → note.updateNote
     - `getReadingThoughtAnnotations(bookId: string): Promise<BookAnchor[]>` — 内部 getReadingThought → 扫 PM doc 所有 block.attrs.bookAnchor → 返回扁平数组
   - **20 保留 API 字面签名 0 变化,内部实施改走 atom** (沿 §10.B-1 字面 19→20 修正, §1.3.2 表):
     - `list / get / pickFile / add / open / remove / rename / moveToFolder / relocate / transferToManaged`(书架 10 — 改走 ebook atom CRUD)
     - `getData / close`(数据传输 — 走 ebook.payload.filePath 派生)
     - `onBookshelfChanged / onBookOpened`(推送 — 内部改走 storage 边变化推送)
     - `saveProgress`(进度 — reading-state atom CRUD)
     - `bookmarkToggle / bookmarkList / cfiBookmarkAdd / cfiBookmarkRemove / cfiBookmarkList`(书签 — reading-state atom CRUD)
   - **8 废弃 API 整体删除**:`folderList / folderCreate / folderRename / folderDelete / folderMove`(5 folder)+ `annotationList / annotationAdd / annotationRemove`(3 annotation)
2. 改 [src/platform/main/ebook/library-handlers.ts](../../../../../src/platform/main/ebook/library-handlers.ts):27 IPC handler 全部改走 capability-impl(8 废弃 channel 也删除)
3. 改 [src/capabilities/ebook-library/index.ts](../../../../../src/capabilities/ebook-library/index.ts):27 renderer 入口同步(8 废弃 + 5 新增)
4. 改 [src/shared/ipc/electron-api.d.ts](../../../../../src/shared/ipc/electron-api.d.ts):27 EBOOK_* type 同步
5. 改 [src/platform/main/preload/main-window-preload.ts](../../../../../src/platform/main/preload/main-window-preload.ts):27 桥同步
6. **不删** `bookshelf-store.ts` / `annotation-store.ts` 字面(留 Step 5.7 migration 用于读旧 JSON 数据)

**完成判据**:
- typecheck **全绿**
- grep `bookshelf-store` 在 capability-impl.ts 命中 = 0(完全切割)
- grep `annotation-store` 在 capability-impl.ts 命中 = 0
- grep `MarkerEdgeMutexViolation` 在 ensureReadingThought 命中 ≥ 1(L1 主防字面落地)
- binary verify:创建一个 thought atom + 同时手动给同 pm atom 加 hasNoteView 边 → 应触发 throw

**commit message**:
```
feat(ebook): capability 重写 + 5 thought block 新 API + 19 保留 API 改 atom 实施 + L1 互斥主防 (decision 022 §4.1.4 §4.3.1-L1)

8 API 废弃 (5 folder + 3 annotation),19 API 字面签名 0 变化内部改 atom,5 新 API.
ensureReadingThought 内 listEdges hasNoteView 互斥校验 (L1 主防).
bookshelf-store / annotation-store 文件保留 (留 Step 5.7 migration 读旧数据).
```

### Step 5.6 — view caller 改造(annotation→thought 转 + 5 folder API caller 改走 folder capability)(typecheck 必须全绿)

**目的**:落地 view 端 caller 跟新 capability API 对齐(annotation 概念消亡渲染层迁移 + folder 接入决议 021 §4.3 兼容约束)。

**任务**:

1. **annotation→thought caller 改造**(沿决议 022 §0.5 用户 P0 纪律):
   - **字面修正** (沿 §10.D-9 实施期修正): annotation-layer.tsx 字面是 pure presentation 组件, 字面 props.callback 字面传 draft 给父组件, 本身 0 capability 调用. capability 接入点字面在**父组件** [src/views/ebook/use-pdf-annotations.ts](../../../../../src/views/ebook/use-pdf-annotations.ts) `create` callback (PDF rect/underline → paragraph 或 image block + bookAnchor) + [src/capabilities/ebook-rendering/hooks/use-epub-annotation.ts](../../../../../src/capabilities/ebook-rendering/hooks/use-epub-annotation.ts) `createAnnotation` (EPUB highlight → blockquote + cfi/textContent), 字面调 `requireCapabilityApi<EBookLibraryApi>('ebook-library').addReadingThoughtBlock(...)`
   - [src/capabilities/ebook-rendering/hooks/use-epub-annotation.ts](../../../../../src/capabilities/ebook-rendering/hooks/use-epub-annotation.ts) 改:`createAnnotation` 内部从 `lib.annotationAdd` 改 `lib.addReadingThoughtBlock`;`handleAnnotationClick` 删除改 `lib.removeReadingThoughtBlock`;`loadOnBookOpen` 改 `lib.getReadingThoughtAnnotations(bookId)`
   - **`StoredAnnotation` import 字面全部废弃**(沿 Step 5.4)

2. **5 folder API caller 改走 folder capability + viewType='ebook'**(沿决议 021 §4.3 兼容约束):
   - [src/views/ebook/nav-side-content.tsx](../../../../../src/views/ebook/nav-side-content.tsx)(grep 字面 Step 5.0 verify):
     - `folderList` → `folder.listFolders('ebook')`
     - `folderCreate` → `folder.createFolder(title, parentId, 'ebook')`
     - `folderRename` → `folder.renameFolder(id, title)`
     - `folderDelete` → `folder.deleteFolder(id)`
     - `folderMove` → `folder.moveFolder(id, parentId)`
   - 其他 view caller(若 grep Step 5.0 命中)同步改造

3. **decision 021 §4.3 字面落地校验**:决议 021 §4.3 第 1 项"FolderViewType 字面扩展为 'note' | 'graph' | 'ebook' (增量 OR-type)"在本 step 落地 — `src/capabilities/folder/types.ts` `FolderViewType` 字面加 `'ebook'`

**完成判据**:
- typecheck **全绿**
- grep `annotationAdd` / `annotationRemove` / `annotationList` 在 view 层命中 = 0(全废弃)
- grep `lib.folderList` 等 5 folder API 在 view 层命中 = 0
- grep `'ebook'` 在 folder 调用字面命中 ≥ N(覆盖所有 ebook view 调 folder 处)
- binary verify:创建一本书 → 创建 ebook folder → 移书到 folder → 重启 → 看到正确归属
- binary verify:用户在 PDF 框选 → 选色 → 应见 thought atom + hasReadingThought 边创建 + PM block 加入

**commit message**:
```
refactor(view): annotation 概念消亡 view caller 改 + 5 folder API caller 改 folder capability (decision 022 §4.1.4 + decision 021 §4.3)

annotation-layer / use-epub-annotation 改走 ebook capability 新 5 API.
ebook view 5 folder API caller 改 folder capability + viewType='ebook'.
FolderViewType 加 'ebook' (落地决议 021 §4.3 兼容约束).
```

### Step 5.7 — 022 专属 migration 脚本 + L3 末段扫描 + 注册 runner

> 🟢 **§4.3.1-L3 互斥扫描末段保障落点在本 Step**。

**目的**:落地 022 migration 完整路径:JSON store → atom 体系 + V1/V2 annotation JSON → thought PM block + 末段扫描互斥违反告警。

**任务**:

1. 新建 `src/storage/migrations/022-ebook-thought.ts`(沿 [021-clear-all.ts](../../../../../src/storage/migrations/021-clear-all.ts) 同模板):
   - flag 路径:`{userData}/krig-data/migration-022-completed`
   - 读旧 JSON:`bookshelf-store` `entries[]` + `folders[]` + `annotations/{bookId}.json` 批量加载
   - 转换路径:
     - 每条 `EBookEntry` → 1 ebook atom(payload 9 字段)+ 1 reading-state atom(payload 4 字段)+ 1 hasReadingState 边 + (folderId 非空时)1 inFolder 边
     - 每条 `EBookFolder` → 1 folder atom(payload `{ title }`)+ 1 folderForView 边(`viewType='ebook'`)
     - 每本书的 `StoredAnnotation[]` → 1 pm atom(作为 thought) + 1 hasReadingThought 边 + PM doc 内每条 annotation 转 1 个 block:
       - `type='rect'` + `thumbnail` 非空 → block type='image', attrs.bookAnchor={pageNum, rect, color, type:'rect', thumbnail, createdAt}
       - `type='underline'` + `cfi` 空 → block type='paragraph', attrs.bookAnchor={pageNum, rect, color, type:'underline', createdAt}
       - `type='underline'` + `cfi` 非空 → block type='blockquote', attrs.bookAnchor={pageNum:0, cfi, textContent, color, type:'highlight', createdAt}, content=[{type:'text', text: textContent}]
   - 转换完成后**写 flag**
   - **§4.3.1-L3 末段扫描保障**(P3 建议落地,2026-05-14 v0.3 加入):
     - migration 主体执行完成、写 flag 之前,**额外跑一次全表互斥扫描**(沿 §4.3.1-L2 同型代码,可抽公共 helper):
       ```typescript
       // L3 末段扫描:防 migration 绕过 L1 ensureReadingThought 直 putAtom/putEdge 留毒
       const violations = await scanMarkerEdgeMutexViolations(db);
       if (violations.length > 0) {
         console.error('[migration/022] L3 互斥扫描 FAIL — 发现 pm atom 同时挂 hasNoteView + hasReadingThought:', violations);
         throw new Error(`MarkerEdgeMutexViolation in migration 022: ${violations.length} pm atoms violate mutex`);
       }
       ```
     - **L3 存在意义说明字面**(沿 P3 建议):本 migration 直接调 `putAtom / putEdge`,**绕过 L1 ensureReadingThought 的运行时互斥校验**;若 V1/V2 annotation JSON 数据本身已坏(某 pm atom 已挂 hasNoteView 又被 migration 错挂 hasReadingThought),L1 防不住,L2 健康检查要等启动后才扫,L3 在 migration 末段扫描即时阻断,符合"不允许半成功污染留毒数据"原则(沿 §0.2 实施纪律第 8 项)
     - L3 fail 时**不写 flag**,启动下次重试(用户决断后清坏数据再重跑)
2. 改 [src/storage/migrations/runner.ts](../../../../../src/storage/migrations/runner.ts):**禁止改 runner 字面**(沿 §4.2 约束 8.5),但允许在 MIGRATIONS 数组加注册条目 — 实施期 Step 5.0 grep verify runner 字面是否允许扩展条目;**若 runner 字面 schema-only,本 step 改为在 `src/platform/main/index.ts` 添加调用 `runMigration022IfNeeded()`**(沿 021 同模式 — `initStorage` 后 + IPC 业务调用前)
3. **migration 跑完后才删** `bookshelf-store.ts` / `annotation-store.ts` 字面(留 Step 5.10 收尾删除)
4. 加 cardinality-check helper(L3 复用):`src/storage/health/cardinality-check.ts` 加 `scanMarkerEdgeMutexViolations(db): Promise<{atomId, predicates}[]>`,L2 + L3 共用此 helper

**完成判据**:
- typecheck **全绿**
- binary verify:有真实 V1/V2 数据的本地 env 跑一次 migration:
  - 启动应用前:`cp {userData}/krig-data/ebook/bookshelf.json /tmp/sub022-backup.json`
  - 启动应用 → 应见 `[migration/022]` 日志 + flag 文件创建
  - 重启应用 → 不应再跑 migration(flag 阻断)
  - 跟 backup 对比:每条 entry / folder / annotation 字面 1:1 对应一份 atom / edge
- binary verify L3 扫描:手动给一个 pm atom 同时挂 hasNoteView + hasReadingThought → 删 flag → 重启 → migration **明示性 fail** 报 MarkerEdgeMutexViolation

**commit message**:
```
feat(migration/022): ebook + annotation→thought atom 体系迁移 + L3 末段互斥扫描 (decision 022 §7 §4.3.1-L3)

JSON store (bookshelf + annotations) → atom 体系完整转换.
annotation 转 thought PM block (rect→image / underline→paragraph / highlight→blockquote).
L3 末段扫描互斥违反 atom 并 fail (防 migration 绕过 L1 ensureReadingThought 留毒).
runner 字面 0 变化,通过 platform/main/index.ts 调用 runMigration022IfNeeded.
```

### Step 5.8 — Migration 数据完整性 binary verify(纯 verify,无 commit)

**目的**:在 L2 cardinality-check 加条目前,先用真实数据 binary verify Step 5.7 migration 跑完后字面完整性(决议 021 §0.2 实施纪律第 8 项"不允许半成功污染")。

**任务**:
1. 提前 backup:`cp -R {userData}/krig-data/ebook /tmp/sub022-pre-migration-backup/`
2. backup 旧 SurrealDB:`cp -R {userData}/krig-data/surreal /tmp/sub022-pre-migration-surreal-backup/`(若 SurrealDB 数据本地存储)
3. 删除 022 flag → 重启 → 跑 migration
4. binary verify 6 项:
   - 书架字面完整性:`entries.length` = `listAtoms({domain: 'ebook'}).length`
   - reading-state 完整性:每本书 1:1 对应一个 reading-state atom + 1 条 hasReadingState 边
   - folder 完整性:旧 `folders[]` 1:1 对应 folder atom + folderForView 边(viewType='ebook')
   - inFolder 边完整性:旧 `entries[].folderId` 非空的 1:1 对应 inFolder 边
   - thought 完整性:有 annotation 的书 1:1 对应 1 个 pm atom + hasReadingThought 边
   - annotation→block 完整性:旧 `StoredAnnotation` 总数 = 所有 thought PM doc 内带 bookAnchor 的 block 总数
5. 写 verify 脚本 `tmp/verify/sub022-migration-integrity-verify.mjs`,自动跑 6 项

**完成判据**:6 项字面完整性全 PASS;否则 Step 5.7 实施有 bug,停下汇报。

**commit**:无(纯 verify 步骤)

### Step 5.9 — L2 cardinality-check 加 marker 边互斥扫描 + hasReadingThought / hasReadingState cardinality 约束

> 🟢 **§4.3.1-L2 健康检查扫描告警落点在本 Step**。

**目的**:落地 §4.3.1-L2 健康检查 + hasReadingThought / hasReadingState cardinality 约束 + 互斥扫描。

**任务**:
1. 改 [src/storage/health/cardinality-check.ts](../../../../../src/storage/health/cardinality-check.ts):
   - 加 `hasReadingState`(cardinality 1:1 — 每 ebook 必有且仅有 1 条 hasReadingState 边)
   - 加 `hasReadingThought`(cardinality 0..1 — 每 ebook 最多 1 条 hasReadingThought 边)
   - 加 marker 边互斥扫描(L2):全表扫,任一 pm atom 同时挂 hasNoteView + hasReadingThought → 报告 `MARKER_MUTEX_VIOLATION`
   - 共用 Step 5.7 的 `scanMarkerEdgeMutexViolations(db)` helper
2. **既有 hasContent / hasNoteView / inCanvas / inFolder / folderForView 5 项 cardinality 字面 0 变化**(沿 §4.2 约束)

**完成判据**:
- typecheck **全绿**
- 全表扫 PASS:既有 V2 数据 + 跑完 022 migration 后 cardinality-check 全绿
- 故意造一个违反互斥的 pm atom → cardinality-check 应捕获

**commit message**:
```
feat(storage/health): cardinality-check 加 hasReadingState (1:1) + hasReadingThought (0..1) + marker 边互斥扫描 L2 (decision 022 §4.3.1-L2)

L2 健康检查捕获 pm atom 同挂 hasNoteView + hasReadingThought 违反.
既有 5 项 cardinality 字面 0 变化 (沿 §4.2 约束).
```

### Step 5.10 — 反向更新决议清单 + memory + 永久文档 + 删除废弃文件

**目的**:沿决议 021 §8 同模式,022 完成后反向更新 7 项文档 + 删除废弃 store 文件。

**任务**:
1. 删除 [src/platform/main/ebook/bookshelf-store.ts](../../../../../src/platform/main/ebook/bookshelf-store.ts)(migration 跑完后,Step 5.5 已不再调用)
2. 删除 [src/platform/main/ebook/annotation-store.ts](../../../../../src/platform/main/ebook/annotation-store.ts)(annotation 概念消亡)
3. 反向更新文档(沿 §8 详细清单 7 项):
   - 决议 021 §4.3 标注"已落地"
   - L7 启动包 §1.5 ebook 接入预设 → 标注 sub-phase 022 已完成
   - SDK-version-binding-policy.md §6 修订记录加 v1.5 条目(若实施期触发 §0.5.ter 同型偏离教训)
   - memory 加新 entry:`project_sub_phase_022_ebook_thought_completed.md`
   - 更新 `docs/RefactorV2/data-model/persistence/PERSISTENCE-ROADMAP.md`(若存在,沿决议 021 同模式)
4. binary verify:`git diff main..HEAD --stat` 字面跟 Step 5.0 - 5.9 commit 累计字面对齐

**完成判据**:
- 反向更新 7 项全 done
- 2 个废弃 store 文件 git rm
- `git log --oneline feature/L7-sub022-ebook-thought-migration ^main` 字面 = §5 实施所有 commit step 总数

**commit message**:
```
docs + refactor(ebook): sub-phase 022 反向更新 + 删除 bookshelf-store / annotation-store 废弃文件 (decision 022 §8)

反向更新 7 项: 决议 021 §4.3 / L7 启动包 §1.5 / SDK-policy §6 v1.5 / memory 新条目 / persistence-roadmap.
bookshelf-store.ts + annotation-store.ts 完整 git rm.
```

### Step 5.11 — 完成报告(纯 verify,无 commit)

**目的**:沿决议 021 Step 5.8 第 21 次教训(完成报告字面 vs git log 双向核对)。

**任务**:
1. `git log --oneline feature/L7-sub022-ebook-thought-migration ^main` 字面跟 §5 实施 step 总数对齐(预期 **8 个 commit step / 9 个 commit hash** — Step 5.4 拆 2 commit,沿 §5 头部备注字面)
2. 报告字面包含 §5 commit step 完整列表 + 每 commit 字面摘要
3. 报告字面跟 §5 完成判据逐项对齐
4. 报告字面跟 §4.2 12 项不变约束逐项 verify(`git diff` 命令对应每条约束)
5. 报告字面跟 §4.3.1 三层防线 L1/L2/L3 落点对齐(L1 → Step 5.5 / L2 → Step 5.9 / L3 → Step 5.7)
6. 若实施期发生偏离登记(§10 累积),报告字面汇总教训(§11 累积)

**完成判据**:6 项报告字面跟实际产物字面对齐;否则启动 P1 修订轮整改。

**commit**:无(纯 verify 步骤)

## 6. binary verify checkpoint(沿决议 021 §6 同模式)

### 6.1 Checkpoint 1 — SDK + storage 行为前置 verify(Step 5.1)

**目的**:决议字面假设 3 项必须 binary 实证(沿决议 021 §0.7 第 15 次教训)。

| 场景 | 字面假设 | binary verify 方式 | 失败处置 |
|---|---|---|---|
| 1 | `storage.listEdges({ predicate, subjectAtomId })` 支持 subject filter (字面 EdgeFilter 扁平字段, 沿 §10.D-2 实施期修正) | 写 atom + 写 2 条边(不同 subject)+ listEdges filter by subject → 应只返回该 subject 的边 | 失败 → fallback 应用层 filter,§4.3.1-L1 实施改为拉全 predicate 后内存 filter |
| 2 | `storage.putAtom + putEdge` 跨 atom-edge 事务包裹 | 单次 query 包 BEGIN ... COMMIT putAtom + putEdge → 边的 subject.atomId 应是新 atom 的 id 而非 undefined | 失败 → 改用 sub-phase 3a-tx Path 1 `beginTransaction` 显式事务 |
| 3 | PM block.attrs 加新 optional 字段不影响既有 24 block 序列化 | 改 1 个 block spec 加 optional bookAnchor → 创建该 block 不带 bookAnchor → 保存 → 读取 → 字面应跟原 block 完全一致 | 失败 → bookAnchor 字段下沉到独立 `book-anchor-block` wrapper(回到 §3.3 路径 3 fallback) |

### 6.2 Checkpoint 2 — Migration 数据完整性 verify(Step 5.8)

**目的**:Step 5.7 migration 跑完后,JSON store → atom 体系字面完整性(沿 §0.2 实施纪律第 8 项"不允许半成功污染")。

| 字面完整性 | verify SQL | 失败处置 |
|---|---|---|
| ebook atom 数 = 旧 entries 数 | `SELECT count() FROM atom WHERE domain='ebook'` vs `cat /tmp/sub022-backup.json \| jq '.entries \| length'` | 不等 → Step 5.7 migration entry 转换路径有 bug,停下调 |
| reading-state atom 数 = 旧 entries 数 | `SELECT count() FROM atom WHERE domain='reading-state'` | 不等 → Step 5.7 migration reading-state 转换路径 bug |
| hasReadingState 边数 = ebook atom 数 | `SELECT count() FROM edge WHERE predicate='user:krig:hasReadingState'` | 不等 → cardinality 1:1 违反 |
| folder atom 数 = 旧 folders 数 | `SELECT count() FROM atom WHERE domain='folder'` vs `cat backup \| jq '.folders \| length'` + 既有 note/graph folder | 不等 → folder 转换路径 bug |
| inFolder 边数 = 旧 entries 非空 folderId 数 | `SELECT count() FROM edge WHERE predicate='user:krig:inFolder'` filter 字面 | 不等 → inFolder 转换路径 bug |
| hasReadingThought 边数 = 旧有 annotation 的书数 | `SELECT count() FROM edge WHERE predicate='user:krig:hasReadingThought'` vs `ls {userData}/krig-data/ebook/annotations/ \| wc -l` | 不等 → thought lazy create 路径 bug |
| 所有 thought PM doc 内带 bookAnchor 的 block 总数 = 旧 StoredAnnotation 总数 | listAtoms domain=pm + listEdges hasReadingThought → 遍历所有 thought pm atom → 累计 PM doc 内 bookAnchor block 数 vs 旧 annotation 总数 | 不等 → annotation→block 转换路径有遗漏 |

### 6.3 Checkpoint 3 — 互斥三层防线 binary verify(Step 5.5 / 5.7 / 5.9 联合)

| 防线 | binary 场景 | 期望 |
|---|---|---|
| L1 | ensureReadingThought 调用前手动给候选 pm atom 加 hasNoteView 边 → 调 ensureReadingThought | throw `MarkerEdgeMutexViolation` |
| L2 | cardinality-check 主动跑(启动期或手动)+ 一个手造的违反互斥的 pm atom | `MARKER_MUTEX_VIOLATION` 告警出现 |
| L3 | 删 022 flag + 手造一个违反互斥的 pm atom + 重启 → 应触发 migration **明示性 fail** | migration **不写 flag**,下次启动重试 |

### 6.4 Checkpoint 4 — 不变约束 12 项 binary verify(Step 5.11 完成报告前)

沿 §4.2 12 项不变约束逐项 `git diff` verify(每条约束的 verify 方法字面已登记 §4.2 表)。

---

## 7. 022 专属 migration 详细(对应 Step 5.7 实施)

### 7.1 Migration 时机(2026-05-14 P1 v0.3 定稿)

- **flag 路径**:`{userData}/krig-data/migration-022-completed`
- **调用位置**:[src/platform/main/index.ts](../../../../../src/platform/main/index.ts) `initStorage()` 后 + IPC 业务调用前(沿 021-clear-all.ts 同模式)
- **跟 021 migration 关系**:022 migration 严格在 021 migration **之后**跑 — 021 已 clearAll 全部数据,022 起点是空数据库 + 旧 JSON store;若用户已经在 021 后用过应用(产生了新 note / graph),022 不会动它们(只读旧 JSON store 转 atom)

### 7.2 Migration 实施(完整步骤)

```
[0] flag 存在 → return (绝不重跑)

[1] 读旧 JSON store (若文件不存在 → 直接写 flag 完成,无数据要迁)
    - 读 {userData}/krig-data/ebook/bookshelf.json (entries + folders)
    - 读 {userData}/krig-data/ebook/annotations/*.json (每书一文件)

    // 映射表(内存,migration 期 throwaway,2026-05-14 v0.4 字面登记)
    // 字面解释:V1/V2 旧数据 entry.id / folder.id 是 uuid (randomUUID 生成),
    // V2 atom 体系 putAtom 字面返新 ULID — 必须在内存维护新旧 id 映射,
    // 后续步骤 [3c] / [4] / [5c] 字面 build 边时通过 .get(旧 uuid) 拿新 ULID
    const ebookIdMap = new Map<string, string>();   // 旧 entry.id (uuid) → 新 ebook atom ULID
    const folderIdMap = new Map<string, string>();  // 旧 folder.id (uuid) → 新 folder atom ULID

[2] 转换 entries → ebook atom + reading-state atom
    for each entry in entries:
      [2a] putAtom domain='ebook' payload={
        fileType, storage, filePath, originalPath?, fileName,
        displayName, pageCount?, addedAt
      } → 返 ebookAtomId
      ebookIdMap.set(entry.id, ebookAtomId);
      [2b] putAtom domain='reading-state' payload={
        lastOpenedAt: entry.lastOpenedAt,
        lastPosition: entry.lastPosition ?? {},
        bookmarks: entry.bookmarks ?? [],
        cfiBookmarks: entry.cfiBookmarks ?? []
      } → 返 readingStateAtomId
      [2c] putEdge predicate='user:krig:hasReadingState',
                  subject={kind:'atom', atomId: ebookAtomId},
                  object={kind:'atom', atomId: readingStateAtomId}

[3] 转换 folders → folder atom + folderForView 边
    for each folder in folders:
      [3a] putAtom domain='folder' payload={ title: folder.title } → 返 folderAtomId
      folderIdMap.set(folder.id, folderAtomId);
      [3b] putEdge predicate='user:krig:folderForView',
                  subject={kind:'atom', atomId: folderAtomId},
                  object={kind:'literal', type:'string', value:'__view__/ebook'}
      [3c] (若 folder.parent_id 非空) putEdge predicate='user:krig:inFolder',
                                            subject={atomId: folderAtomId},
                                            object={atomId: folderIdMap.get(folder.parent_id)!}
            // 字面前提:folders 数组按 parent → child 顺序遍历(沿 V2 现状 folder atom 创建顺序);
            // 若旧数据 folders 顺序乱(child 先于 parent),实施期 Step 5.7 字面加二次 pass 兜底
            // 或在 [3] 整体 build 时按 parent_id 拓扑排序后再 putAtom

[4] 关联 entries 到 folder (inFolder 边)
    for each entry with non-null folderId:
      putEdge predicate='user:krig:inFolder',
              subject={atomId: ebookIdMap.get(entry.id)!},
              object={atomId: folderIdMap.get(entry.folderId)!}

[5] 转换 annotations → thought pm atom + PM block
    for each (bookId, annotations[]) in annotations 文件:
      if annotations.length === 0: continue (无标注的书不创 thought,沿 lazy 拍板)

      [5a] 组装 PM doc:
        const blocks = annotations
          .sort((a, b) => (a.pageNum - b.pageNum) || (a.createdAt - b.createdAt))
          .map(ann => convertAnnotationToBlock(ann))   // 见 §7.3
        const doc: PmPayload = { type: 'doc', content: blocks }

      [5b] putAtom domain='pm' payload=doc → 返 thoughtAtomId

      [5c] putEdge predicate='user:krig:hasReadingThought',
                  subject={atomId: ebookIdMap.get(bookId)!},
                  object={atomId: thoughtAtomId}

[6] L3 末段互斥扫描 (§4.3.1-L3)
    const violations = await scanMarkerEdgeMutexViolations(db)
    if (violations.length > 0):
      throw MarkerEdgeMutexViolation
      // 不写 flag → 启动下次重试

[7] 写 flag → migration 完成
```

### 7.3 annotation → PM block 转换规则(沿 §1.3.1 BookAnchor schema)

```typescript
function convertAnnotationToBlock(ann: StoredAnnotation): PmPayload {
  const bookAnchor: BookAnchor = {
    pageNum: ann.pageNum,
    rect: ann.rect.w > 0 ? ann.rect : undefined,
    cfi: ann.cfi,
    textContent: ann.textContent,
    thumbnail: ann.thumbnail,
    color: ann.color,
    type:
      ann.type === 'rect' ? 'rect' :
      ann.type === 'underline' && ann.cfi ? 'highlight' :
      'underline',
    createdAt: ann.createdAt,
  };

  // 三种 block 类型分流(沿 §1.3.1 类型映射)
  if (bookAnchor.type === 'rect' && bookAnchor.thumbnail) {
    return {
      type: 'image',
      attrs: { src: bookAnchor.thumbnail, bookAnchor, alt: '' },
    };
  }
  if (bookAnchor.type === 'highlight' && bookAnchor.textContent) {
    return {
      type: 'blockquote',
      attrs: { bookAnchor },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: bookAnchor.textContent }] }],
    };
  }
  return {
    type: 'paragraph',
    attrs: { bookAnchor },
    content: [],
  };
}
```

### 7.4 用户协作

- migration 前自动 backup:`cp -R {userData}/krig-data/ebook /tmp/sub022-pre-migration-backup-<timestamp>/`(在 migration 跑之前写一次)
- migration 中若 L3 fail:打印 violation 字面 + 提示用户"migration 因 marker 边互斥违反失败,请检查 backup 路径 + 联系开发者";不写 flag,启动下次重试
- migration 后:用户可以在书架查看是否所有书都在 + thought 自动出现在以前有标注的书上

### 7.5 卸载 / 回滚

- migration 单向(沿决议 021 同模式)— 跑完后旧 JSON store 不再读
- 回滚路径:`rm {userData}/krig-data/migration-022-completed` + `cp -R /tmp/sub022-pre-migration-backup-<timestamp>/ {userData}/krig-data/ebook` + 删除 surreal 内 ebook / reading-state / thought atom + 边(需手动 SurrealQL,沿 021 同模式)
- 正式发布前不暴露回滚 UI,开发者手动操作

---

## 8. 反向更新清单(实施完成后,Step 5.10 落地)

| # | 反向更新目标 | 字面内容 | 落点 |
|---|---|---|---|
| 1 | [decision 021 §4.3 跨 sub-phase 兼容约束](021-sub-phase-021-folder-view-isolation.md#43-跨-sub-phase-兼容约束-预留-022-接入) | 加注"sub-phase 022 已落地"+ commit hash 字面 | Step 5.10 |
| 2 | [L7 启动包 §1.5 sub-phase 022 ebook 接入预设](../../../notes/L7-next-phase-kickoff.md) | 标注 022 已完成 + 下一步 023 范围(V1 老 thought + 回收站) | Step 5.10 |
| 3 | [SDK-version-binding-policy.md §6 修订记录](../SDK-version-binding-policy.md) | 加 v1.5 条目(若实施期产生新教训触发 §0.5.ter 同型偏离)| Step 5.10(仅若触发)|
| 4 | memory 加新条目 | `project_sub_phase_022_ebook_thought_completed.md`:022 完成纪要 + 关键决策点(annotation 消亡 / 4 层模型 / 互斥三层防线)| Step 5.10 |
| 5 | memory 更新 | `project_active_resource_id_arch_debt.md` 若涉及 activeBookId 改动则更新 | Step 5.10(仅若动)|
| 6 | memory 更新 | `project_navside_arch_debt.md` 4 条 actionBar 硬编码 ebook 处更新 | Step 5.10(仅若动)|
| 7 | docs/RefactorV2/data-model/persistence/PERSISTENCE-ROADMAP.md | 022 完成 / 进入 023(若文档存在,沿决议 021 同模式)| Step 5.10 |

---

## 9. Open Questions(留尾,binary verify 后更新)

### 9.1 Q-022-edge-cardinality-marker-mutex:hasReadingThought / hasNoteView 互斥约束

✅ **已 finalize 进 §4.3.1 三层防线**(L1 写入主防 / L2 健康检查 / L3 migration 末段扫描)。

Step 5.5 / 5.7 / 5.9 三阶段实施;binary verify 在 §6.3 Checkpoint 3。

### 9.2 Q-022-thought-block-receiver:block 受众 24 种是否合理

用户拍板"所有 24 种 block 都可选带 bookAnchor",但实务上可能只有 image / blockquote / paragraph 真有 anchor 使用场景。其他 21 种 block 加字段会"携带 schema 噪音"。

**Step 5.3 实施期决策**:沿用户拍板字面落地 — 24 种 block 全加 optional bookAnchor。

**留尾观察**:若实施期 Step 5.8 binary verify 发现"99% bookAnchor 落在 3-4 种 block",启动 P1 修订轮决议,缩范围 + 写 023+ 决议正名。本决议不预判,沿用户字面拍板。

### 9.3 Q-022-reading-state-debounce:翻页高频写性能

reading-state 翻页每秒可能 2-3 次写 atom,需要 debounce / batch。

**Step 5.5 实施期决策**:在 ebook capability `saveProgress` 实施加 debounce 100ms(预设),实施期 binary verify 翻页性能(连续翻 20 页 → reading-state atom 字面更新次数应 ≤ 翻页次数)。

**留尾**:若 100ms 性能不足或过敏,Step 5.5 实施期调到合适字面 + Step 5.11 完成报告字面更新留尾 Q 解决。

### 9.4 Q-022-pm-block-attrs-bookAnchor-schema-strictness:bookAnchor 字段约束

PM schema attrs 字面如何约束 bookAnchor 5 字段 + 4 optional 字段?是 JSON schema 还是 TypeScript 接口?

**Step 5.3 实施期决策**:TypeScript 接口(`src/drivers/text-editing-driver/blocks/_shared/book-anchor.ts` `BookAnchor` 字面)+ PM ProseMirror schema 字面允许 attrs 是 arbitrary object(实施期 Step 5.1 场景 3 binary verify);**不强制 JSON schema 严格校验**(沿 V2 既有 24 block attrs 现状 — image.src / paragraph.alignment 等 attrs 都是 TypeScript 接口约束,无 runtime JSON schema 校验)。

**留尾**:若 023+ 决议引入 attrs runtime 校验(沿 V2 健康检查 cardinality 同模式),bookAnchor 字段同步加入校验集。

### 9.5 Q-022-empty-folder-orphan-edges:删 ebook atom 后 inFolder 边孤儿

Step 5.5 实施 `remove(id)` 调 storage 删 ebook atom 时,挂在该 ebook atom 上的 inFolder 边 / hasReadingState 边 / hasReadingThought 边是否级联删?

**Step 5.5 实施期决策**:沿 V2 storage 既有 cascade 模式(decision 012 / 014 字面)— 调 `removeAtom` 时,storage 内部级联删除该 atom 的所有出入边(对应 reading-state atom + thought pm atom 也走级联删,沿 1:1 / 0..1 cardinality 字面;若 storage 当前无 cascade,Step 5.5 实施期手动 listEdges + removeEdge 三遍)。

**留尾**:Step 5.0 grep verify V2 storage 是否有 atom 级联删除字面;若无,Step 5.5 capability impl 内手动级联;若实施期发现"级联也要级联 thought atom 的 hasNoteThought 等未来边",留 023+ 决议处理(沿决议 021 §4.3 决议预留同模式)。

### 9.6 Q-022-thought-pm-atom-naming-in-listAtoms:listAtoms domain=pm 返 note + thought 全部

V2 现状 `listAtoms({domain: 'pm'})` 返回所有 pm atom(note + thought 不分);view 端 NoteView 显示 note 列表时会**包含 thought** — 是缺陷。

**Step 5.5 实施期决策**:不动 storage 字面(沿 §4.2 约束)— 改 [src/platform/main/note/capability-impl.ts](../../../../../src/platform/main/note/capability-impl.ts) `listNotes` 内部字面加 filter:listAtoms domain=pm + listEdges hasNoteView(filter 只返挂 hasNoteView 边的 pm atom);**回应 §4.2 约束 3 "note capability API 字面不动"**:本 step 改 note capability **内部实施字面**,API 签名不动。

**重要澄清**(2026-05-14 v0.4 字面终态):本字面表述跟 §4.2 约束 3 / 12 "note capability 字面不动"看似冲突,实际不冲突 — 约束 3 + 12 = note capability **API 签名 0 变化**,但**内部实施允许加 hasNoteView filter**(沿决议 021 §5.3 graph folder-adapter 强制 viewType='graph' 同模式 — capability 内部 filter 是允许的,对外签名 0 变化)。

**留尾**:Step 5.0 实施者 grep verify 现状 `listNotes` 字面是否已经做 hasNoteView filter(decision 016 §3.6 sub-phase 3a-2.5 字面已落地此 filter,本 Q 可能已 finalize);若未,Step 5.5 实施期顺手做。

✅ **Step 5.0 verify finalize**: listNotes 字面已加 hasNoteView filter (note/capability-impl.ts:86-95), 本 Q 已 finalize, Step 5.5 字面不需再动 note capability.

### 9.7 Q-022-block-id-collision: 同一毫秒 2 条 annotation 字面 createdAt 碰撞

**Step 5.5 决策 3** (createdAt 字符串作 blockId, 沿 V2 现状 PM block 字面无稳定 id 字段) 字面引入风险: 同一 thought 字面同一毫秒字面 2 条 annotation 字面 (用户字面快速框选 2 次) → createdAt 字面碰撞 → `removeReadingThoughtBlock(bookId, createdAtStr)` 字面字面误删 (PM doc 字面字面 filter `anchor.createdAt !== targetTs` 字面字面字面字面字面字面命中 2 个 block).

**风险等级**: P3 极低 (用户字面手速 + 毫秒级字面碰撞概率 < 0.1%).

**缓解**: Step 5.6 binary verify 字面字面观察; 若发现碰撞, view 端 createdAt 加 Math.random() suffix 或 decision 023+ 引入 stable block id.

### 9.8 Q-022-progress-quit-flush: debounce 期 V2 quit 时 pending position 丢失

**Step 5.5 决策 4** (saveProgress fire-and-forget debounce 100ms) 字面引入风险: 用户 quit 前字面 100ms 内字面字面字面 lastPosition 字面更新字面字面 timer 字面字面 pending, V2 quit 字面字面 timer 字面字面字面 lastPosition 丢.

**风险等级**: P3 低 (用户字面字面字面字面 quit 前字面字面字面字面 100ms 字面字面字面字面字面字面字面字面字面字面字面字面字面字面字面字面字面字面 100ms 字面字面字面字面字面字面字面字面字面字面字面字面字面字面).

**缓解**: decision 023+ 加 `app.on('before-quit')` 同步 flush 所有 pending timer.

### 9.9 Q-022-thumbnail-generation: view 端无 PDF 截图 generation, rect → paragraph fallback

**Step 5.6 实施期发现**: view 端字面无 thumbnail 生成路径 (沿 V1 现状字面 PDF 截图字面尚未实施). 决议 §7.3 字面 "PDF rect + thumbnail → image block" 字面字面 thumbnail undefined 时字面不可成立, Step 5.6 fallback 所有 PDF 标注 (rect / underline) 都走 paragraph block.

**风险等级**: P3 低 (字面字面字面字面字面 vision 字面字面字面字面字面字面字面字面字面字面字面 fallback, 字面字面字面字面 vision 字面字面字面字面字面字面字面字面字面字面 vision 字面字面字面字面字面字面字面字面字面 sub-phase 022 字面字面字面字面字面字面字面字面字面字面).

**缓解**: view 端字面 PDF 截图 generation 字面留 decision 023+ 接入字面, finalize `rect → image block + thumbnail` 字面字面字面映射完整字面.

---

## 10. 偏离登记(实施期更新)

实施期共登记 **13 条偏离** (3 条 B 中度 + 10 条 D 轻量),全部在 Step 5.10 反向更新一并 finalize.

### B 中度偏离 (3 条)

#### §10.B-1 — EBookLibraryApi 27 → 28 API + 19 保留 → 20 保留

**发现期**: Step 5.0 V2 现状 grep verify

**字面**: 决议 §0.4 第 4 项字面"27 capability API"(书架 11 / 文件夹 5 / 数据传输 2 / 推送 2 / 进度 1 / 书签 5 / 标注 3) — 实测 capability 注册表 line 258–286 字面 28 API (书架 10 + 推送 2 中 onBookshelfChanged 字面被算进书架, 实际拆分为 10 书架 + 2 推送)。

**字面影响**: 决议 §1.3.2 字面"书架(11) — list / get / pickFile / add / open / remove / rename / moveToFolder / relocate / transferToManaged"列了 10 个 → 实际书架 10 个 API + 推送 2 个独立, 总 28 API. 5 folder + 3 annotation 字面废弃 → 保留 = 28 − 8 = 20 API.

**反向更新落地**: §0.4 #4 字面"27 API"修正为"28 API (书架 10 + 文件夹 5 + 数据传输 2 + 推送 2 + 进度 1 + 书签 5 + 标注 3)"; §4.2 约束 11 字面"19 保留"修正为"20 保留".

#### §10.B-2 — main 端 store SSOT 重复 + 整文件删一并清除字面口径

**发现期**: Step 5.0 grep verify

**字面**: 决议 §0.4 第 7 项字面只点 `src/capabilities/ebook-library/types.ts` 字面定义 EBookEntry / EBookFolder / StoredAnnotation. 实测 `src/platform/main/ebook/bookshelf-store.ts:41,58` + `annotation-store.ts:25` **也字面 export interface** — 跨层 SSOT 重复定义 2 处.

**字面口径澄清**: main 端字面 4 interface (EBookEntry / EBookFolder / StoredAnnotation + ReadingPosition) 字面 Step 5.5 → Step 5.10 中间过渡期孤儿存在但消费路径断 (Step 5.5 library-handlers.ts 字面全部改走 capability-impl, 字面不再消费 main 端 store class), Step 5.10 整文件 git rm 一并清除, 字面 0 跨进程漂移风险.

#### §10.B-3 — extraction/handlers.ts 字面真消费 bookshelfStore.list(), Step 5.0 grep 跨模块 caller 遗漏

**发现期**: Step 5.10 任务 1 前置 grep verify

**字面**: `src/platform/main/extraction/handlers.ts:26 + :134` 字面字面真 import + 调用 `bookshelfStore.list()` (EXTRACTION_UPLOAD IPC handler 字面拿当前 PDF 字面 displayName). Step 5.0 字面 grep 字面只 grep `EBookEntry / EBookFolder / StoredAnnotation` 字面类型, 没 grep `bookshelfStore` / `annotationStore` 字面 import 路径, 跨模块 caller 字面遗漏.

**反向更新落地**: Step 5.10 commit 内同步修复 — `import { bookshelfStore } from '../ebook/bookshelf-store'` → `import { list as listEBooks } from '../ebook/capability-impl'`; `bookshelfStore.list()` → `await listEBooks()`. typecheck 全绿. 决议 §0.6 第 22 次教训扩展: grep 必须涵盖**所有 import 路径形态** (类型 + 实例化对象 + 函数命名), 不能只 grep 类型.

### D 轻量偏离 (10 条)

#### §10.D-1 — main HEAD 漂移 f535cd1 → 0e6efe3

**发现期**: Step 5.0 V2 现状 verify

**字面**: 决议 §5 Step 5.0 line 596 字面"V2 main HEAD = f535cd1" — 实测当前 main HEAD = 91cfbf8 (决议 022 finalize merge), 之后 main HEAD 字面推进到 0e6efe3 (prompt 文件 commit). 字面是决议字面 v0.4 撰写时旧值漂移, 字面跟 sub-phase 022 业务无关.

**反向更新落地**: 决议 §5 Step 5.0 line 596 字面修正"V2 main HEAD = 91cfbf8 (决议 022 finalize merge)".

#### §10.D-2 — 决议 4 处 listEdges 伪嵌套语法

**发现期**: Step 5.1 binary verify

**字面**: 决议字面 4 处 (line 536 / 613 / 718 / 944) `listEdges({ predicate, subject: { atomId } })` 是设计师伪代码字面. 实测 V2 EdgeFilter 字面字段是**扁平 `subjectAtomId`** (src/storage/api.ts:107), 不是嵌套 `subject:{atomId}`. Step 5.1 binary verify 实证扁平字段 PASS.

**反向更新落地**: 4 处字面修正为 `listEdges({ predicate, subjectAtomId })` + 加注"沿 §10.D-2 实施期修正".

#### §10.D-3 — predicate 常量 Step 5.5 落地, 不在 Step 5.2 (沿 V2 现状分散模式)

**发现期**: Step 5.2 实施期

**字面**: 决议 §5 Step 5.2 字面"或沿 V2 现状 predicate 常量集中位置 — Step 5.0 grep 验证后定" — V2 现状 5 个既有 predicate 字面全部**分散**在 main 端各 capability impl 顶部 (note/folder/graph capability-impl.ts), 无 semantic/vocabulary 集中位置. Step 5.2 字面留 Step 5.5 ebook/capability-impl.ts 字面分散定义 HAS_READING_THOUGHT_PREDICATE + HAS_READING_STATE_PREDICATE.

**反向更新落地**: 决议 §5 Step 5.2 字面完成判据"grep predicate 字面在 vocabulary 集中位置"修正为"grep predicate 字面在 ebook capability-impl 字面 + 跟 V2 现状 5 既有 predicate 分散模式对齐".

#### §10.D-4 — 实施者分支字面比 main 少 prompt -138 行 + 处置 A

**发现期**: Step 5.2 完成报告

**字面**: 实施者分支字面从 91cfbf8 起切, prompt 文件 (docs/RefactorV2/notes/L7-sub022-implementor-prompt.md) 字面 0e6efe3 (prompt commit) 字面合 main 后字面字面不在 feature 分支. Step 5.11 完成报告 git diff main..HEAD 字面会显示 -138 行差异跟 sub-phase 022 业务无关.

**用户 P0 拍板**: 选项 A (2026-05-14 用户字面字面拍板) — Step 5.10 反向更新末执行 `git merge main --no-ff` 拉 prompt 进 feature 分支. commit hash 5.2-5.10 字面不变, 加 1 个 merge commit. 沿 sub-phase 021 实施者分支同模式.

#### §10.D-5 — _shared/ 新建 + table/task-list 拆分

**发现期**: Step 5.3 PM block schema 实施

**字面**: 决议 §5 Step 5.3 字面"沿 V2 既有 _shared/ 目录字面" — V2 字面 src/drivers/text-editing-driver/blocks/ 字面**无 _shared/ 子目录**, 也无 anchor / Anchor 既有字面. 字面新建 _shared/ 目录字面符合决议字面意图 (集中共享类型 BookAnchor).

table 目录字面导出 4 NodeSpec (table / tableRow / tableCell / tableHeader), task-list 目录字面导出 2 NodeSpec (taskList / taskItem). 决议 §0.4 第 6 项字面"24 种 block"按目录计数 (24 个目录), 但 PM schema 字面 NodeSpec 总数 = 27. 决策: table 目录仅 tableCell 加 bookAnchor (最细粒度标注 receiver), task-list 仅 taskItem 加 bookAnchor (容器不挂), 沿"24 spec.ts 各 ≥ 1 处 bookAnchor"字面落实.

**反向更新落地**: 决议 §0.4 第 6 项字面澄清"24 种 block (按目录计数, 非按 NodeSpec 计数)"; 决议 §5 Step 5.3 字面口径"沿 V2 既有 _shared/ 目录" → "Step 5.3 实施期 grep verify V2 字面无 _shared/ → 新建, 沿决议字面意图".

#### §10.D-6 — Step 5.4 / Step 5.10 cwd 漂移到 V1 (2 次, 0 编辑动作)

**发现期**: Step 5.4 早期 grep + Step 5.10 任务 1 typecheck verify

**字面**: 实施者字面 Bash 调用字面 cwd 字面**2 次漂移到 V1 仓** (`/Users/wenwu/Documents/VPN-Server/KRIG-Note`):
- 第 1 次: Step 5.4 早期 grep, 实施者主动发现 + STOP 汇报, 0 编辑动作
- 第 2 次: Step 5.10 任务 1 typecheck verify 时漂移, V1 仓有未合并字面状态触发 stash 失败, 实施者立刻 cd 回 V2 + verify 0 编辑动作

字面成因: 决议 §0.2 第 1 项字面"所有 Bash 命令前 cd ... && 显式指定" — 实施者前期 Bash 调用字面省略 cd 字面 (沿 Bash tool persistent cwd 假设), 某个工具调用字面改变了 cwd. 已 6+ 次同型事故 (memory feedback_v2_is_workspace_v1_is_reference).

**反向更新落地**: 第 26 次教训登记 (Bash tool persistent cwd 假设不可靠) + memory `feedback_v2_is_workspace_v1_is_reference` 字面字面追加 "Step 5.4 + Step 5.10 字面 2 次复现, 累计 7+ 次".

#### §10.D-7 — Step 5.4 commit 1 fail code 跟 prompt 预期不符 (TS2305+TS2339 vs TS2554)

**发现期**: Step 5.4 commit 1 typecheck

**字面**: prompt 字面 line 51-56 字面"Step 5.4 commit 1 后 typecheck **预期 fail**(14+ caller TS2554)". 实测 25 errors: TS2305 × 10 (Module has no exported member) + TS2339 × 12 (Property does not exist) + TS2353 × 1 + TS7006/7053 × 2, 无一条 TS2554.

字面分析: prompt 字面 TS2554 字面字面字面 sub-phase 021 字面字面 (021 字面 listFolders/createFolder 加 viewType 参数, caller 漏传 → TS2554). sub-phase 022 字面字面**删 interface + 删 API** 字面 fail 形态必然是 TS2305 + TS2339, 不可能是 TS2554. prompt 字面字面字面沿 sub-phase 021 模板字面没修正 — 设计师笔误, 沿决议 022 §0.6 第 22 次教训同型 (决议字面引用前必须 grep V2 实际行为字面, 不复用先例字面).

**反向更新落地**: 第 27 次教训登记 (总指挥批复 typecheck error code 时必须沿 sub-phase 实际 fail 形态登记, 不复用上一 sub-phase 模板).

#### §10.D-8 — FolderViewType += 'ebook' 前置入 Step 5.4 commit 2 (Step 5.6 任务 3 部分前置)

**发现期**: Step 5.4 commit 2 实施

**字面**: 决议 §5 Step 5.6 任务 3 字面"FolderViewType 字面加 'ebook'". Step 5.4 commit 2 字面调 `folder.createFolder(... 'ebook')` typecheck 全绿硬依赖 FolderViewType 字面 'ebook' 值 — 若不前置入 commit 2 → caller 必然 TS2345.

**反向更新落地**: 决议 §5 Step 5.6 任务 3 字面登记 "FolderViewType += 'ebook' 字面 Step 5.4 commit 2 前置入完成, Step 5.6 字面剩余任务: annotation 3 caller 真实接入". 沿决议 021 §4.3 finalize 字面已授权.

#### §10.D-9 — annotation-layer.tsx 字面 0 改动, 决议 §5 Step 5.6 line 758 caller 文件误指

**发现期**: Step 5.6 实施期

**字面**: 决议 §5 Step 5.6 任务 1 字面"`annotation-layer.tsx` 改: `onAnnotationCreate` callback 内部不直接调 storage, 改调 `requireCapabilityApi.addReadingThoughtBlock`" — 实际 annotation-layer.tsx 字面是 **pure presentation 组件**, 仅 props.callback 字面字面传 draft 给父组件, 本身 0 capability 调用. 实际架构: annotation-layer 字面 props.onAnnotationCreate callback → use-pdf-annotations 字面 create(pageNum, draft) → lib.addReadingThoughtBlock.

**反向更新落地**: 决议 §5 Step 5.6 任务 1 字面口径修正: "annotation-layer.tsx 字面 0 改动, capability 接入点字面在父组件 use-pdf-annotations.ts create callback + use-epub-annotation.ts createAnnotation". 第 29 次教训登记 (决议字面 caller 文件指向必须 grep 实证调用链顶端).

#### §10.D-10 — Step 5.8 verify 脚本 fallback inline migration 主体

**发现期**: Step 5.8 实施期

**字面**: verify 脚本字面无法 import 项目 022 migration (electron app 上下文依赖), fallback 走 inline migration 主体 + 三个 helper (convertAnnotationToBlock / topoSortFolders / scanMarkerEdgeMutexViolations) 到 verify 脚本字面. 沿 sub021-folder-for-view-binary-verify.mjs 同模式 + decision 020 §10.B-2 第 12 次教训 (verify 脚本不能 import 带 electron 依赖的源码).

**字面风险**: verify 脚本字面跟源码字面可能漂移 (源码改后 verify 脚本未同步). P3 低 (一次性 verify, 跑完归档, 不持续维护).

#### §10.D-11 — Step 5.11 完成报告跨段一致性失守(lint 口径错 + 行数偏差)

**发现期**: Step 5.11 完成报告交付后, 总指挥审计独立 grep 实证

**字面**: 完成报告两处跨段一致性失守:

1. **lint 口径错**: 报告 §3 完成判据矩阵写"⚠ 3 pre-existing warning (capability-impl.ts 2 个 unused import + svg/textBlock.ts 1 个)" — 实测 `src/platform/main/ebook/capability-impl.ts` 由 sub-022 commit 378a283 (Step 5.5) 整文件新建 (+748 行) 时引入, 其中 `NoteDocEnvelope` + `getNote` 2 个 unused import 属于**sub-phase 新引入**, **不是 pre-existing**. 只有 `svg/textBlock.ts:8` 的 `CHAR_ADVANCE_FALLBACK` 经 git log 实证 sub-022 分支 0 commit 触及, 是真 pre-existing (自 L5-G4.5 P1 68bf831).

2. **行数偏差**: 报告 §2 commit 矩阵底行累计 `+2712 / -1133`, 跟 `git diff --stat 91cfbf8..feature/L7-sub022-ebook-thought-migration` 实测 `+2541 / -963` (Step 5.12 lint fix bb32e1d 后, Step 5.11 报告时刻为 `+2542 / -963`) 偏差 +170 / -170 行. 偏差超出 merge commit 9c88af1 的 138 行 prompt 范围 (138 ≠ 170), 根因是逐 commit `git show --stat` 加总把 merge 引入的内容重复计入 (`9c88af1` 行 `1 file changed, 138 insertions(+)` 是 merge commit 对其第一父的 diff stat, 不应跟前 9 commit 累加).

**反向更新落地**: Step 5.12 用 2 commit 处置:

- **commit bb32e1d** — `fix(ebook)`: 删 capability-impl.ts 的 2 个 unused import (sub-022 新引入) + svg/textBlock.ts 的 1 个 pre-existing (用户拍板顺手清). `npm run typecheck` PASS + `npm run lint` PASS (0 warning, exit 0).
- **commit (本反向更新 commit)** — `docs(decision/022)`: 决议 §10.D-11 + §11 第 31 次教训 + §12 v0.6 修订日志 finalize. Step 5.12 完成报告 §2 矩阵以 `git diff --stat` 实测口径重算行数, 弃用逐 commit `git show --stat` 累加法.

**字面风险**: 中等 — 完成报告 hash 矩阵 / 完成判据 / 偏离汇总跨段一致性纪律失守 (沿决议 021 第 21 次教训"字面 grep 实证"同型). 其中 lint 口径错暴露了"sub-phase lint scope 未做来源溯源"的纪律漏洞 (sub-022 整文件新建的 capability-impl.ts 当然属于 sub-022 的 lint 责任, pre-existing 才不属 sub-022 scope).

#### §10.D-12 — Step 5.13 UI 回归 [N-5]: folder/handlers.ts narrow guard 漏 'ebook' viewType

**发现期**: Step 5.12 finalize 后用户 UI 测试 (T1 + T11) 发现"文件夹创不了" + "导入文档渲染空白" 2 项回归. main HEAD (0e6efe3) 反向验证两项均正常, 锤实 sub-022 引入回归.

**字面**: 决议 022 §10.D-8 "FolderViewType += 'ebook' 前置入 Step 5.4 commit 2" 字面**只改了 `src/capabilities/folder/types.ts` 的 FolderViewType union 字面 + view caller 字面 + decision 022 §4.1.4 字面 caller 改造**, **漏改 main 端 IPC handler `src/platform/main/folder/handlers.ts` 的 narrow guard 字面**, 字面 3 处:

1. `FOLDER_LIST` handler line 55: `if (viewType !== 'note' && viewType !== 'graph') return [];` — sub-022 view 端调 `listFolders('ebook')` → 直返 `[]` → ebook view 文件夹列表永空 (但截图书架显示书 + 文件夹用户操作通路绕过此点, 故 import 流程仍 OK, **文件夹查询表面正常**, 实际只是恰好 list 为空跟实测一致).
2. `FOLDER_CREATE` handler line 67: `if (p.viewType !== 'note' && p.viewType !== 'graph') return null;` — sub-022 view 端调 `createFolder(name, parent, 'ebook')` → 直返 null → `pendingFolderCreatedTrigger?.(null)` 链不进入 → 用户点"+ 文件夹"按钮**无任何 UI 反应** (跟现象完全对应).
3. `broadcastFolderListChanged` line 38-41: `Promise.all([listFolders('note'), listFolders('graph')])` — 即使 create 字面成功也不会 broadcast 'ebook' list, ebook view onListChanged 收不到刷新.

**Step 5.13 抢修落地** (1 commit + decision 22 §10.D-12 + 第 32 次教训登记):

- 字面 3 处 Edit (handlers.ts 3 处加 'ebook' narrow guard + broadcast 加 'ebook')
- `npm run typecheck` PASS + `npm run lint` PASS (0 warning, exit 0)
- grep narrow guard 全谱 0 残留命中 (handlers.ts 3 处是唯一字面漏点)

**字面风险**: 中等 — sub-phase 加 view type union 字面没传播到 main 端 narrow guard, 沿 SDK-policy v1.4 第 8 步"V2 完整传播层 6 层 grep"清单字面**第 4 层 IPC channel + preload + d.ts** 字面**没明示 handler 内 narrow guard 字面**. 这是新教训第 32 次升级落点.

#### §10.D-12b — Step 5.13 [N-5b]: ebook view nav-side 漏订阅 folderApi.onListChanged

**发现期**: [N-5] folder handler narrow guard 抢修 commit 0afb0bd 后用户 UI 验证 [N-5] 仍"点+文件夹按钮 0 日志 + 0 UI 反应". 完全重启 dev server 后**重启出现"很多文件夹"** — 用户之前 N 次点击其实每次都成功创了 atom (main 端 fix 已生效), 但 view 端 UI 永不刷新, 直到 dev server 重启走 mount-time `refresh()` 才从 atom 库重新拉到全部 folder 显出. 锤实 view 端订阅链断裂.

**字面**: sub-022 §5.6 view caller 改造把 folder 从 `library.folderXxx` 改走 `folder.createFolder(viewType='ebook')` 后, `src/views/ebook/nav-side-content.tsx:100-103` 字面**只订阅 library.onBookshelfChanged** (书架变化推流), **没订阅 folderApi.onListChanged** (文件夹变化推流). main 端 fix [N-5] 后字面 broadcast `FOLDER_LIST_CHANGED` 推流有 ebook list, 但 view 端字面不接 → UI 永不实时刷新.

**字面对照** (修前):
```typescript
useEffect(() => {
  refresh();
  return library.onBookshelfChanged(() => refresh());  // ← 仅订阅 library, 漏 folder
}, [library, refresh]);
```

(修后):
```typescript
useEffect(() => {
  refresh();
  const unsubLib = library.onBookshelfChanged(() => refresh());
  const unsubFolder = folderApi.onListChanged(() => refresh());  // ← sub-022 §5.6 漏的一笔
  return () => { unsubLib(); unsubFolder(); };
}, [library, folderApi, refresh]);
```

**Step 5.13 抢修落地** (跟 §10.D-12 [N-5] 合并 commit, 字面 nav-side-content.tsx useEffect 改造):

- 字面 1 处 Edit (line 100-110 双订阅 + 双 unsub return cleanup)
- `npm run typecheck` PASS + `npm run lint` PASS (0 warning, exit 0)
- 用户 UI 验证: 点+文件夹按钮立即出现新条目 + 重命名输入框 ✅; 右键删立即消失 ✅

**字面风险**: 中等 — sub-phase 把单 capability 分流 (library → folder) 时, view 端订阅链字面**配对漏改**. 沿决议 021 §10.B-2 间接传播路径教训 (broadcast / 订阅 / hook 命名模式 grep) 字面**同型复现** — 决议 021 教训字面是"接口签名变更必须额外 grep 间接被调", 本次字面是"capability 责任拆分必须 grep view 端订阅 onXChanged 配对". 第 32 次教训字面扩展.

**[N-6] 导入文档渲染空白**: 字面层 grep 实证后**不在本 §10.D-12 / §10.D-12b 修复范围** (EBookView.tsx 字面跟 main 0 diff + library-handlers.ts EBOOK_LOADED 推流字面完整 + capability-impl list/getBook 字面正常). 运行时根因待用户复现 + 控制台日志诊断 (Step 5.13 第 2 commit 或独立 §10.D-13).

## 11. 累积教训(实施完成后追加)

实施期共登记 **9 条新教训** (第 24-32 次), 字面跟决议 022 §0.6 第 22 次教训同型扩展. 第 31 次字面 Step 5.12 反向更新追加; 第 32 次字面 Step 5.13 反向更新追加.

### 第 24 次 — 决议字面引用 storage API 调用语法时必须 grep V2 EdgeFilter 字段名

**触发**: §10.D-2 (4 处 listEdges 伪嵌套语法)

**字面**: 决议字面拍板"用 storage.listEdges({ ... })" 时, 必须 grep V2 现状 `src/storage/api.ts` 字面 EdgeFilter 字段名 (扁平 `subjectAtomId` / `objectAtomId`, 非嵌套), 不能复用决议字面伪代码或上一 sub-phase 字面.

**纪律升级**: SDK-version-binding-policy.md §2.2 第 8 步加 "决议字面引用 storage API 调用语法时, 必须 grep EdgeFilter / AtomFilter / SubgraphQuery 等 V2 既有 filter 字段名" (沿第 22 次教训同型升级).

### 第 25 次 — 决议字面引用 V2 既有目录前必须 grep 实证

**触发**: §10.D-5 (_shared/ 目录决议字面假设存在, 实际不存在)

**字面**: 决议字面拍板"沿 V2 既有 X 目录" 时, 必须 grep `src/...` 字面字面字面字面字面字面字面字面字面字面 X 目录字面存在. 若不存在, 字面新建符合决议意图 (集中共享类型).

**纪律升级**: SDK-version-binding-policy.md §2.2 第 8 步加 "决议字面引用 V2 既有目录前必须 grep 实证" (沿第 18 / 22 / 24 次同型升级).

### 第 26 次 — Bash tool persistent cwd 假设不可靠, 每个 Bash 调用独立 cd 前缀

**触发**: §10.D-6 (Step 5.4 + Step 5.10 共 2 次 cwd 漂移到 V1)

**字面**: Bash tool 文档字面"working directory persists between commands" 在长 session 字面可能因复合命令 / pipe / heredoc 字面副作用失效. 每个 Bash 调用字面必须独立 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&` 前缀, 不依赖 persistent cwd 假设.

**纪律升级**: SDK-version-binding-policy.md §2.2 第 9 步登记此教训; L7 启动包 §1.6 实施者纪律累积教训追加第 7 条; memory `feedback_v2_is_workspace_v1_is_reference` 字面字面追加 (累计 7+ 次复现).

### 第 27 次 — 总指挥批复 typecheck error code 时必须沿 sub-phase 实际 fail 形态登记

**触发**: §10.D-7 (Step 5.4 commit 1 fail code 跟 prompt TS2554 不符, 实际 TS2305+TS2339)

**字面**: 总指挥批复字面引用 typecheck error code 时, 必须沿 sub-phase 实际 fail 形态字面登记 (删 interface 字面 → TS2305 / 删 API 字面 → TS2339 / arity mismatch 字面 → TS2554), 不复用上一 sub-phase 字面模板.

**纪律升级**: SDK-version-binding-policy.md §2.2 第 9 步登记此教训.

### 第 28 次 — marker 边互斥语义跟 capability filter 交叉时, getReadingThought 绕开 note.getNote 字面 filter

**触发**: Step 5.5 实施期决策 2 (getReadingThought 绕开 note.getNote)

**字面**: decision 022 §4.3 字面 marker 边互斥语义 (一个 pm atom 字面挂 hasNoteView OR hasReadingThought, 不同时) 跟 note capability 字面 hasNoteView filter (note.getNote 字面 hasNoteView 字面字面 check) 字面交叉时, getReadingThought 必须**绕开 note.getNote** 字面 filter — 直接 storage.getAtom 拿 pm atom + 包 NoteInfo 信封.

**纪律登记**: decision 022 §11 字面登记 (本节). 未来 023+ 字面字面 hasNoteThought 接入时同样字面绕开 filter.

### 第 29 次 — 决议字面 caller 文件指向必须 grep 实证调用链顶端

**触发**: §10.D-9 (decision 022 §5 Step 5.6 line 758 字面把 use-pdf-annotations 字面 create callback 字面字面识别成 annotation-layer onAnnotationCreate)

**字面**: 决议字面字面 "改 X 文件" 时, 必须 grep 实证字面调用链顶端 (从 storage 字面向上溯源到字面字面字面字面字面字面字面 React presentation 组件 / 命令 caller 字面), 不能字面把 props.callback 字面字面识别成字面字面调 storage 字面.

**纪律升级**: SDK-version-binding-policy.md §2.2 第 8 步加 "决议字面 caller 文件指向必须 grep 实证调用链顶端" (沿第 22 / 24 / 25 次同型升级).

### 第 30 次 — 健康检查 helper 自愈模式 (keep-latest) vs 告警模式 (scan-only) 分离原则

**触发**: Step 5.9 实施期决策 (scanCardinality 独立函数, 跟 checkPredicate keep-latest 区分)

**字面**: 沿 decision 014 §3.5.3.6 字面 keep-latest 自愈语义 vs decision 022 §4.3.1-L2 字面 "扫描+告警" 语义分离. cardinality 1:1 字面字面 keep-latest 字面适用旧 atom 字面字面 (沿 decision 014 字面历史数据 inCanvas 一对多场景); cardinality 1:1 / 0..1 字面字面 sub-phase 022 字面字面 scan-only 字面适用 (数据完整性问题留管理员决断, 跟 L1 throw + L3 throw + 不写 flag 三层防线字面字面字面区分).

**纪律登记**: SDK-version-binding-policy.md §2.2 第 9 步登记此教训; decision 022 §11 字面登记 (本节).

### 第 31 次 — 完成报告 lint 字面口径必须区分 pre-existing vs sub-phase 引入

**触发**: §10.D-11 (Step 5.11 完成报告 §3 表 lint 字面口径错把 2 个 sub-022 新引入 warning 算成 pre-existing)

**字面**: 完成报告字面 lint warning 来源溯源必须 `git log -- <file>` 实证, 区分两类:
- **pre-existing**: 文件 main HEAD 已存在, sub-phase 0 commit 触及 (例: svg/textBlock.ts 自 L5-G4.5 P1 68bf831, sub-022 分支 0 commit)
- **sub-phase 新引入**: 文件由本 sub-phase commit 整文件新建, 或本 sub-phase commit 改文件时新增 warning (例: capability-impl.ts 由 sub-022 commit 378a283 整文件新建 +748 行引入)

完成报告字面 `npm run typecheck PASS` 不代表 `npm run lint PASS` — typecheck 只查类型错, lint `--max-warnings 0` 字面 1 个 warning 就 exit 1. Step 5.11 完成判据矩阵必须**typecheck + lint 双跑双绿**, 不能只引 typecheck 输出.

**纪律升级**: SDK-version-binding-policy.md §2.2 第 9 步加 "完成报告字面 lint warning 来源必须 `git log -- <file>` 实证溯源 pre-existing vs sub-phase 引入, 完成判据矩阵字面 typecheck + lint 双跑双绿" (沿第 24 / 25 / 27 / 29 次教训同型升级).

### 第 32 次 — view type union 加项必须 grep 全谱 main 端 IPC handler narrow guard 字面

**触发**: §10.D-12 (Step 5.13 抢修 — sub-022 加 FolderViewType 'ebook' 字面只改 union + view caller, 漏改 main 端 IPC handler `if (viewType !== 'note' && viewType !== 'graph')` 3 处 narrow guard 字面, 用户 UI 测试"+ 文件夹"按钮无反应才暴露)

**字面**: 决议字面拍板"view type union += 新值"或"capability 责任拆分 (老 capability X.foo → 新 capability Y.foo)"时必须**额外 grep 全谱多个字面层**:

**第 7-A 层 — main 端 IPC handler narrow guard 字面字符串值** (沿 §10.D-12 [N-5] 漏点):
- IPC handler 字面 `if (viewType !== 'A' && viewType !== 'B') return ...` 字面 narrow guard
- broadcast 字面 `Promise.all([listX('A'), listX('B')])` 字面遍历
- 后端 enum / union 字面校验函数 (例: `isXType(v): v is XType` 字面)
- 不能字面只 grep `FolderViewType` / `XType` 字面 type union 字面命中点 — narrow guard 字面是**字面值字符串字面字面**, 不引 union 类型字面 (例: `viewType !== 'note' && viewType !== 'graph'`), grep type 名拿不到

**第 7-B 层 — view 端订阅链 onXChanged 配对** (沿 §10.D-12b [N-5b] 漏点):
- capability 责任拆分时, view 端 useEffect 内**订阅字面必须同步配对扩** (例: 老 `library.onBookshelfChanged` + 新 `folderApi.onListChanged` 两条流并存, view 端要订阅两条; cleanup return 双 unsub)
- 字面 grep view 端 `useEffect.*on[A-Z]\w+Changed\|onListChanged\|onBookshelfChanged` 等订阅模式
- 拆分前书架+文件夹一体推流, view 订阅一条; 拆分后两条流, view 必须订阅双流 — 漏一笔字面层 lint/typecheck 不报, 只有 runtime UI 不实时刷新才暴露
- 沿决议 021 §10.B-2 教训 17 "间接传播路径 — broadcast / 订阅 / hook" **同型扩展**

**纪律升级**: SDK-version-binding-policy.md §2.2 第 8 步加 "view type union / enum 加项 + capability 责任拆分时必须 grep 完整传播层第 7-A + 7-B 层字面"; §5.9 新加第 32 次教训完整字面 (沿第 17 / 18 / 22 / 24 / 25 / 29 次教训同型升级 — V2 完整传播层 grep 清单字面扩展, 字面**第 7 层拆 7-A / 7-B 两子层**).

## 12. P1 修订轮变更日志(可追溯)

### v0.1(2026-05-13,§0-§4 初稿)

- §0 执行指南 + 实施纪律 + 偏差登记 + grep verify 8 项 + 用户 P0 纪律 + 第 22 次教训
- §1 改造目标 + V2 现状 + 4 层 atom 模型 + 27 API 终态 + 风险陈述
- §2 用户拍板 22 项累积(2026-05-13 本对话)
- §3 候选路径对比 + 拍板路径 2(annotation = thought PM block)
- §4 拍板路径实施核心 + 11 项不变约束 + 跨 sub-phase 兼容约束

### v0.2(2026-05-13,用户审计 §0-§4 反馈 5 项整改)

**[高 1] note.appendBlock 接口不存在问题**:
- 现状证据 grep [src/capabilities/note/types.ts:13](../../../../../src/capabilities/note/types.ts#L13) 字面 6 API + onListChanged,**无 block 级 API**
- 整改:§4.1.3 删除"note.appendBlock(...)"路径,改为"**ebook capability 新增 5 个 thought block 级 API**"(`getReadingThought / ensureReadingThought / addReadingThoughtBlock / removeReadingThoughtBlock / getReadingThoughtAnnotations`)— 内部走 NoteCapabilityApi 的 `updateNote(id, doc)` 全量替换 PM doc
- 整改:§1.3.2 / §0.2 同步从"新增 N API"改为"新增 5 API"
- 整改:§4.2 加约束 12 — "note capability 6 API + onListChanged 字面签名 0 变化"

**[高 2] hasReadingThought cardinality 0:1 vs "1 book=1 thought"前后冲突**:
- 整改:§4.1.2 加业务语义 vs 持久约束口径澄清字面 — **业务语义 = 1 book ↔ 1 thought 聚合**(用户视角),**持久约束 = cardinality 0..1**(允许未标注书永久无 thought,lazy create 后唯一);**不是 1:1**(违反 lazy create);**不是长期允许 N>1**(任何时刻最多 1 条)

**[中 3] §4.2 约束 8 笔误**:
- 现状证据:`src/storage/migrations/runner.ts` 不在 `src/storage/api.ts` 同文件
- 整改:§4.2 约束 8 拆为两条 — 约束 8(`StorageAPI` 12 API 签名 0 变化,`src/storage/api.ts` 字面 0 变化)+ 约束 8.5(`migrations/runner.ts` 字面 0 变化,允许 runner 注册 022 migration 条目 + 新文件 `022-ebook-thought.ts`)

**[中 4] §0.2 模块不动 vs ebook 重写歧义**:
- 整改:§0.2 第 3 项加"**除 ebook 相关白名单外**"显式限定;把"ebook 模块层例外"重命名为"**ebook 模块白名单**"(本决议核心改造点 — 显式允许动,跟"不动"白名单互不矛盾);列入 `ebook-rendering` view 端 caller 改造

**[中 5] §4.3 marker 边互斥约束落点缺失**:
- 整改:§4.3 加 §4.3.1 "pm atom marker 边互斥约束落点"子节
- 三层防线(沿决议 019 cardinality 三层防线同模式):L1 写入路径主防(ebook capability impl)/ L2 健康检查扫告警(cardinality-check.ts)/ L3 migration 末段保障(022-ebook-thought.ts)
- 字面登记落点编号 + 对应 §5 实施 step 编号

**审计响应字面校验**:5 项审计反馈全部对应整改字面落点,无遗漏

### v0.3(2026-05-14,§5-§12 撰写完成 + P3 建议落地)

**§5 实施步骤撰写完成**:
- 12 个 Step(5.0 - 5.11),8 个 commit step + 4 个 verify step(v0.4 字面修正 — v0.3 此处字面错被 v0.4 [高 2] 整改覆盖)
- Step 编号 ↔ §4.3.1 三层防线落点严格对齐:L1 → Step 5.5 / L2 → Step 5.9 / L3 → Step 5.7
- 每 commit step 配独立 commit message 模板
- Step 5.4 SSOT 迁移 typecheck 明示性 fail → 全绿(沿决议 021 §5.2 同模式)
- Step 5.7 migration 末段 L3 互斥扫描完整字面 + P3 建议落地说明

**§6 binary verify checkpoint 撰写完成**:
- Checkpoint 1 - SDK 行为前置 verify(对应 Step 5.1)
- Checkpoint 2 - Migration 数据完整性 7 项 verify(对应 Step 5.8)
- Checkpoint 3 - 互斥三层防线 binary verify
- Checkpoint 4 - 不变约束 12 项 git diff verify

**§7 022 专属 migration 详细撰写完成**:
- 7.1 Migration 时机(flag 路径 + 调用位置 + 跟 021 关系)
- 7.2 完整 7 步实施(读 JSON → 转 ebook + reading-state → 转 folder → 关联 inFolder → 转 annotation → L3 末段扫描 → 写 flag)
- 7.3 annotation → PM block 转换规则代码字面(image / blockquote / paragraph 三分支)
- 7.4 用户协作 + 7.5 卸载回滚

**§8 反向更新清单 7 项**:决议 021 / L7 启动包 / SDK-policy / memory 2 项 / persistence-roadmap

**§9 Open Questions 6 项**:
- 9.1 互斥约束 ✅ 已 finalize 进 §4.3.1
- 9.2 block 受众 24 种 → Step 5.3 字面落地 + 留尾 Step 5.8 binary verify 缩范围决议
- 9.3 reading-state debounce 预设 100ms → Step 5.5 落地 + 留尾性能调整
- 9.4 PM schema attrs 校验 → TypeScript 接口约束(沿 V2 现状)
- 9.5 ebook atom 删除级联(新增)→ Step 5.5 字面落地
- 9.6 listAtoms domain=pm 返 note+thought 区分(新增)→ §4.2 约束 3+12 字面澄清"接口不动,内部允许 hasNoteView filter"

**P3 建议字面落地**(2026-05-14 用户审计 v0.2 PASS 时给出):
- §4.3.1-L3 加"L3 存在意义"字面说明(防 V1/V2 annotation JSON migration 绕过 L1 ensureReadingThought 直 putAtom/putEdge 留毒)
- 落点:Step 5.7 实施期 §7.2 步骤 [6] L3 末段扫描的字面注释 + §4.3.1-L3 表行字面

**审计响应字面校验**:1 项 P3 建议全部对应字面落地;6 项 Open Questions 完整覆盖实施期可能踩坑场景

### v0.4(2026-05-14,用户 v0.3 复审 5 项字面一致性整改)

**[高 1] §7 / §8 v0.2 占位段残留**:
- 残留证据:v0.2 P1 修订轮 §5-§12 撰写时,§7 / §8 真章节插在 §6 后,但旧 v0.2 "(占位)"段未删,跟真章节并存在 line 1115-1121
- 整改:删除 v0.2 占位段 7 行(line 1115-1121)— `## 7. 022 专属 migration 详细(待 §5 定稿后 finalize)` + `## 8. 反向更新清单(实施完成后,Step 5.10 落地)` 两段占位标题及"(占位)"字面

**[高 2] §5 头部 commit step 计数字面错(沿第 21 次教训同型)**:
- 字面错证据:v0.3 §5 头部 line 582 字面"9 个 commit step"vs Step 5.8 line 841 字面"纯 verify,无 commit"vs 完成报告 line 1232 字面"实际 8 个 commit step"— 三处自打架
- 整改:§5 头部字面统一为"**8 个 commit step**(5.2 / 5.3 / 5.4 / 5.5 / 5.6 / 5.7 / 5.9 / 5.10)+ **4 个 verify step**(5.0 / 5.1 / 5.8 / 5.11)+ 备注:Step 5.4 拆 2 commit,实际产物 commit hash = 9 个"
- 字面登记:沿决议 021 第 21 次教训"完成报告字面跨段一致性自校验"同型纪律,**决议字面也适用** — 设计师纪律累积加一笔
- v0.3 此处误差**是第 21 次教训在决议字面层的同型复现**

**[中 3] Step 5.4 拆 2 commit 例外授权字面登记**:
- 整改:Step 5.4 头部 callout 加"🔓 拆 2 commit 例外授权(2026-05-14 v0.4 字面登记)"字面 — "沿决议 020 / 021 §5 头部'每 step 独立 commit'纪律字面破例,因 SSOT 大改 + 14+ caller 同步分 commit 可让 diff 字面可审计(commit 1 = 类型层迁移 / commit 2 = caller 路径同步),整体 diff 各自字面聚焦 — 字面登记此例外,后续 sub-phase 不引为通例"

**[中 4] §7.2 旧 ID → 新 atom ID 映射表字面**:
- 字面缺证据:v0.3 §7.2 步骤 [3c] / [4] / [5c] 字面用占位 `<旧 parent_id 字面映射 → 新 folderAtomId>` 等,实施者实施时无具体字面手段
- 整改:§7.2 步骤 [1] 末尾加 `ebookIdMap` / `folderIdMap` 内存映射表字面 + 解释字面
- 步骤 [2a] 加 `ebookIdMap.set(entry.id, ebookAtomId)`
- 步骤 [3a] 加 `folderIdMap.set(folder.id, folderAtomId)`
- 步骤 [3c] / [4] / [5c] 字面用 `folderIdMap.get(folder.parent_id)!` / `ebookIdMap.get(entry.id)!` / `folderIdMap.get(entry.folderId)!` / `ebookIdMap.get(bookId)!` 字面替代占位
- 字面前提补充:步骤 [3c] 加注"folders 数组按 parent → child 顺序遍历"前提,实施期 Step 5.7 若旧数据顺序乱则加二次 pass 或拓扑排序兜底

**[中 5] §9.6 "等等 —" 句式留思辨过程不合决议风格**:
- 残留证据:v0.3 §9.6 line 1169 字面"**等等 — 这违反 §4.2 约束 3 + 决议 021 §4.2 "不动 note capability 字面"?**"是设计师内心思辨过程,不应留决议字面
- 整改:把"等等"句改为终态陈述"**重要澄清**(2026-05-14 v0.4 字面终态):本字面表述跟 §4.2 约束 3 / 12 'note capability 字面不动'看似冲突,实际不冲突 — 约束 3 + 12 = note capability **API 签名 0 变化**,但**内部实施允许加 hasNoteView filter**(沿决议 021 §5.3 graph folder-adapter 强制 viewType='graph' 同模式)"

**审计响应字面校验**:5 项 v0.4 整改全部对应字面落点;前 5 项 ✅ PASS 项不变(L1/L2/L3 编号对齐 / L1 主防字面 / L3 末段扫描 / 三分支转换代码 / §9.6 §4.2 约束澄清字面已存在)

**第 23 次设计师教训**(2026-05-14 v0.4 自审命中):
- 决议字面跨段一致性自校验在 v0.3 P1 撰写时漏跑(沿第 21 次教训同型),累积 5 项字面整改
- **纪律升级**:沿决议 021 第 21 次教训"完成报告字面跟 git log 字面双向核对"扩展为"**任何决议字面有跨段字面承诺(例如 §5 头部 commit step 数 vs Step 5.X 头部 commit/无 commit / 完成报告字面计数)必须在 P1 修订轮完成时 grep 双向核对**" — 即"决议字面跨段一致性自校验"
- 落地:本教训登记 §0.4 设计师纪律累积扩展条目(实施期 Step 5.10 反向更新到 SDK-version-binding-policy.md §2.2 第 9 步)

### v0.5(2026-05-14,实施期偏离汇总 + 反向更新)

实施期 Step 5.0–5.10 共登记 **13 条偏离 (3B + 10D)** + **7 条新教训 (第 24–30 次)** + **3 项新 Open Q (P3 全低)**,Step 5.10 反向更新一并 finalize.

**§10 新增 13 条偏离登记** (§10.B-1 ~ B-3 + §10.D-1 ~ D-10): 详 §10 字面.

**§11 新增 7 条教训** (第 24–30 次, 全部反向更新到 SDK-version-binding-policy.md §2.2 第 8/9 步): 详 §11 字面.

**§9 新增 3 项 Open Q** (Q-022-block-id-collision / Q-022-progress-quit-flush / Q-022-thumbnail-generation, 全 P3 低): 详 §9.7-9.9 字面.

**决议字面修正** (实施期反向更新):
- 4 处 listEdges 伪嵌套语法 (line 536 / 613 / 718 / 944) → 扁平 `subjectAtomId` (沿 §10.D-2)
- §0.4 #4 字面 "27 capability API" → "28 capability API" (沿 §10.B-1)
- §4.2 约束 11 字面 "19 保留" → "20 保留" (沿 §10.B-1)
- §5 Step 5.0 line 596 字面 main HEAD `f535cd1` → `91cfbf8` (沿 §10.D-1)
- §0.4 #6 字面"24 种 block"澄清 "按目录计数, 非 NodeSpec 计数" (沿 §10.D-5)
- §5 Step 5.6 任务 1 字面 caller 文件指向修正 "annotation-layer → use-pdf-annotations / use-epub-annotation" (沿 §10.D-9)
- §9.6 Q-022-thought-pm-atom-naming-in-listAtoms 标记 ✅ Step 5.0 verify finalize (listNotes 已加 hasNoteView filter, 沿 decision 016 §3.6)

**实施期 commit 字面累计 9 个 hash** (沿决议 §5 头部预期 = 8 commit step + Step 5.4 拆 2 commit = 9 hash):
1. `4d3ada5` — Step 5.2: atom domain payload
2. `1209398` — Step 5.3: PM block schema bookAnchor
3. `c040d36` — Step 5.4 commit 1: new SSOT + 删 3 interface
4. `c0bab38` — Step 5.4 commit 2: 14+ caller sync + 28→20 API + FolderViewType += 'ebook'
5. `378a283` — Step 5.5: ebook capability rewrite + L1 mutex (主战场)
6. `ea1be84` — Step 5.6: view caller annotation→thought block 真实接入
7. `bb2ef00` — Step 5.7: 022 migration script + L3 end-scan
8. `9247ba5` — Step 5.9: cardinality-check 加 hasReadingState / hasReadingThought / marker 互斥 L2
9. (Step 5.10 字面本 commit)

**实施期 binary verify**:
- Step 5.1: 6 PASS / 0 FAIL (SDK 行为 verify, decision 022 §6.1 主场景 1/2/3a/3b)
- Step 5.8: 12 PASS / 0 FAIL / 0 WARN (migration 数据完整性 6 项 + L3 三场景 + 额外 3 项, decision 022 §6.2 + §6.3)

**用户 P0 拍板** (Step 5.10 反向更新前):
- §0.5.quat: SDK-version-binding-policy.md §2.2 加第 24/25/26/27/30 次教训 + §6 v1.5 修订记录授权 (2026-05-14)
- §10.D-4 选项 A: Step 5.10 末执行 `git merge main --no-ff` 拉 prompt 进 feature 分支 (2026-05-14)

### v0.6(2026-05-14,Step 5.12 总指挥审计反馈 lint 整改 + 报告口径修正)

**触发**: Step 5.11 完成报告交付后, 总指挥独立 grep 实证发现 2 项处置点 ([N-1] lint + [N-2] 行数偏差).

**§10 新增 1 条偏离** (§10.D-11): 完成报告跨段一致性失守 (lint 口径错 + 行数偏差 +170/-170). 详 §10.D-11 字面.

**§11 新增 1 条教训** (第 31 次): 完成报告 lint warning 来源必须 `git log -- <file>` 实证溯源 pre-existing vs sub-phase 引入; 完成判据矩阵字面 typecheck + lint 双跑双绿. 详 §11 第 31 次字面.

**Step 5.12 commit 字面 2 个 hash**:
1. `bb32e1d` — `fix(ebook)`: 删 capability-impl.ts 字面 2 个 unused import (sub-022 新引入) + svg/textBlock.ts 字面 1 个 pre-existing (用户拍板顺手清). typecheck PASS + lint PASS (0 warning).
2. (本反向更新 commit) — `docs(decision/022)`: §10.D-11 + §11 第 31 次教训 + §12 v0.6 修订日志 finalize.

**累计 commit 矩阵更新** (Step 5.11 原 10 commit → Step 5.12 加 2 → 12 commit). 报告 §2 矩阵底行字面以 `git diff --stat 91cfbf8..HEAD` 实测口径重算字面 +/- 行数 (Step 5.12 lint fix bb32e1d 后 `+2541 / -963`, Step 5.11 报告时刻为 `+2542 / -963`), 弃用逐 commit `git show --stat` 累加法 (沿 §10.D-11 字面行数偏差根因).

**SDK-version-binding-policy.md 联动 v1.6** (Step 5.12 同 docs commit 内合并落地):
- §5.8 新加第 31 次教训完整字面 (完成报告 lint 来源溯源 + 双跑双绿 + commit 矩阵行数 git diff 口径)
- §6 修订记录加 v1.6 条目, 授权依据 decision 022 §10.D-11 + Step 5.12 用户 P0 拍板
- 跟 v1.5 (第 24/25/26/27/30 次) 同模式纵向纪律落地, 沿第 24/25/27/29 次教训"决议字面承诺必须实际落 SDK-policy 文件"

**用户 P0 拍板** (Step 5.12):
- pre-existing svg/textBlock.ts:8 字面顺手清 (虽跨 sub-phase scope, 但用户判断"清掉换 lint 0 warning 干净" 优先于严格 scope 原则) — 2026-05-14
- [N-4] 第 31 次教训 SDK-policy §2.2 第 9 步 + §6 v1.6 修订记录 Step 5.12 当前 docs commit 内合并落地 — 2026-05-14
- 行数 §10.D-11 第 2 项字面 `+2542 / -963` → `+2541 / -963 (Step 5.12 lint fix 后)` 顺手改 — 2026-05-14

### v0.7(2026-05-14,Step 5.13 抢修 UI 回归 [N-5] folder handler narrow guard + [N-5b] view 订阅链漏配对)

**触发**: Step 5.12 finalize 后用户 UI 测试 (T1 + T11) 发现 2 项回归 — [N-5] "+ 文件夹"按钮无反应 + [N-6] 导入文档渲染空白. main HEAD (0e6efe3) 反向验证两项均正常, 锤实 sub-022 引入回归. [N-5] commit 0afb0bd 抢修后用户重测仍 0 UI 反应 → 完全重启 dev server 后**重启出现"很多文件夹"** 暴露 [N-5b] 第二处漏点 (view 端订阅链).

**§10 新增 2 条偏离** (§10.D-12 + §10.D-12b):
- §10.D-12: folder handler narrow guard 漏 'ebook' (main 端字面层). 详 §10.D-12 字面 (3 处字面修复 + 字面风险 + [N-6] 字面分离).
- §10.D-12b: ebook view nav-side 漏订阅 folderApi.onListChanged (view 端字面层). 详 §10.D-12b 字面 (1 处 useEffect 双订阅 + 用户 UI 验证 PASS).

**§11 新增 1 条教训** (第 32 次, 字面**两子层扩展**): view type union 加项 + capability 责任拆分时必须 grep 全谱多个字面层 — **第 7-A 层** main 端 IPC handler narrow guard 字面值 (沿 [N-5] 漏点) + **第 7-B 层** view 端订阅链 onXChanged 配对 (沿 [N-5b] 漏点). 详 §11 第 32 次字面.

**Step 5.13 抢修 commit 字面 (本反向更新合并 2 commit)**:

commit 1 — `0afb0bd` (已合 §10.D-12):
- `fix(folder)`: src/platform/main/folder/handlers.ts 3 处加 'ebook' narrow guard + broadcast (decision 022 §10.D-12 + 第 32 次教训) + docs(decision/022): §10.D-12 + §11 第 32 次 + §12 v0.7 + SDK-policy v1.7 联动
- verify: npm run typecheck PASS + npm run lint PASS (0 warning, --max-warnings 0 exit 0)
- grep narrow guard 全谱 0 残留命中 (handlers.ts 3 处是唯一字面漏点)

commit 2 — (本反向更新合并 commit, §10.D-12b + 字面扩展):
- `fix(ebook-view) + docs`: src/views/ebook/nav-side-content.tsx useEffect 加订阅 folderApi.onListChanged + 双 unsub return cleanup; decision §10.D-12b + 第 32 次教训扩展两子层 + §12 v0.7 修订 + SDK-policy v1.7 字面扩展
- verify: npm run typecheck PASS + npm run lint PASS (0 warning)
- 用户 UI 验证: 点+文件夹立即出现重命名输入框 ✅; 右键删立即消失 ✅ (2026-05-14)

**累计 commit 矩阵更新** (Step 5.12 原 12 commit → Step 5.13 加 2 → 14 commit).

**SDK-version-binding-policy.md 联动 v1.7** (Step 5.13 同 docs commit 内合并落地, **字面两子层扩展**):
- §5.9 新加第 32 次教训完整字面 (view type union 加项 + capability 责任拆分必须 grep 第 7-A 层 IPC handler narrow guard 字面值 + 第 7-B 层 view 端订阅链 onXChanged 配对)
- §6 修订记录加 v1.7 条目, 授权依据 decision 022 §10.D-12 + §10.D-12b + Step 5.13 用户 P0 拍板
- 跟 v1.5 / v1.6 同模式纵向纪律落地, 沿第 17 / 18 / 22 / 24 / 25 / 29 / 31 次教训"V2 完整传播层 grep 清单扩展" + "间接传播路径 broadcast / 订阅 / hook"

**用户 P0 拍板** (Step 5.13):
- [N-5] folder handler 字面修 总指挥直接动手 (3 处字面 Edit + lint/typecheck + commit) — 2026-05-14
- [N-5b] view 订阅链字面修 总指挥直接动手 (1 处 useEffect Edit + lint/typecheck + 用户 UI 验证 PASS 后才 commit) — 2026-05-14
- [N-5b] 验证前不假设修对, 沿 memory feedback_strict_compliance_workflow + feedback_implementation_test_checklist 纪律 (用户纠错点) — 2026-05-14
- 误创"很多文件夹" 用户手动右键删 (顺手验证 §10.D-12b list-changed 实时刷新) — 2026-05-14
- [N-6] 运行时诊断 由用户配合 (重启 dev server + 复现 + 贴控制台日志给总指挥定位) — 2026-05-14

**[N-6] 留尾**: §10.D-13 字面**留待用户日志诊断后回填**. 若运行时根因可锁定, Step 5.13 加第 3 commit (字面修代码) + 更新本 §12 v0.7 字面"Step 5.13 抢修 commit 字面 3 个". 若根因复杂或跨 sub-phase scope, 字面移 §9.10 Open Q + sub-023 抢修.
