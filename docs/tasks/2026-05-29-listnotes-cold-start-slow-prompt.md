# Fix: NavSide listNotes 冷启动 30s+ 不返 / lazy loading 架构

> 重启 App 后 NavSide 加载笔记列表卡死 30s+,用户字面"对一个应用而言是不可接受的"。本期目标 = listNotes 冷启动改 lazy + 按需加载架构。

---

## 0. 角色 / 工作纪律

你是本 PR 实施 subagent. **strict mode**:

1. 只动本 prompt §3 / §4 列的文件,**不擅自重构**周边代码
2. **每条 Bash 必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**(V2 cwd 漂移已 16+ 次事故)
3. **memory 必读**:
   - `feedback_surrealdb_4x_no_type_thing` — 新 SQL 函数必 grep verify
   - `feedback_surrealdb_inside_not_in` — IN vs INSIDE
   - `feedback_filter_single_vs_batch_mutex` — filter 字段互斥纪律
   - `feedback_strict_compliance_workflow` — strict 4 条
   - `feedback_v2_is_workspace_v1_is_reference` — V2 工作 V1 只读
   - `feedback_no_fallback_bandaid_fixes` — 先 log 定位真因再针对性修
   - `feedback_diag_log_before_speculation` — 跨模块 bug 先 log 再说
   - `project_word_import_pipeline_hardening_done` — listNotes 雪崩修过一轮
   - `project_block_atomization_done` — L7 后 note container + N 个 block atom 模型
   - `feedback_module_push_pull_both` — push-only 通道冷启动 race
4. sandbox 拦截 `git commit/push`/`npm start` 等 → 停手汇报,**禁** `--dangerouslyDisableSandbox`
5. 发现非本 prompt 范围的 bug → **登记到汇报里**,不擅自修
6. **禁止**用 fallback / 兜底绕过未诊断根因(`feedback_no_fallback_bandaid_fixes`)

---

## 1. 背景:为什么现在做

### 1.1 现象

用户字面贴出对比截图:

**退出前**:NavSide 字面展开,大量 note 字面渲染,某个 note "里程碑 4 — Session 持久化" 字面打开渲染完毕。

**重启后 30s**:
- NavSide 字面**只有 20 个文件夹**(顶层 10-business-design + agent/ai/block/code/ebook/...) 字面显示
- **note 列表完全空**
- 中间区域字面 "笔记加载中或已删除"

**字面证据**:数据没丢(文件夹结构都在 → folder 表正常),但 listNotes IPC 字面 30s+ 不返。

**用户判定**:"对于一个应用而言是不可接受的"。

### 1.2 一级根因(初判,实施期 verify)

候选(按概率排序,prompt 不下结论,实施期 grep + log 字面 verify):

| 候选 | 字面证据 / 判定方法 |
|---|---|
| **listNotes 串行 assemble PM doc** | L7 后字面每个 note = container atom + N 个 block atom + 边表 → 92 个 note × ~345 block atom + ~794 edge = **几万次 atom 读 + edge 查询**,串行字面 30s+ |
| **title cache miss** | migration 023 字面引入 title cache 但 markdown 导入路径可能没填(创建 atom 时未 derive 入 attrs.title) |
| **broadcastNoteListChanged 启动期反复触发** | App 启动期间多个 store 各自订阅 LIST_CHANGED,每次广播都跑 listNotes |
| **冷启动 race** | App start → SurrealDB 起 → migration 跑 → schema verify → listNotes,中间任一卡 30s |
| **NavSide 渲染 92 个 note 慢** | React 虚拟化未配,92 个 DOM 节点+ 12 分钟前 relativeTime 派生算 |

**本期 Phase 1 字面**:加 log 定位真因(字面对照 [[feedback_diag_log_before_speculation]] + [[feedback_no_fallback_bandaid_fixes]])。

### 1.3 用户字面提议的修法方向

用户字面提议(本 prompt 字面采纳,不擅自偏离):

1. **启动方法有问题**,不可能等待全部文件都加载到内存才展示
2. 可以考虑**先加载 NavSide,以及退出前的 note**
3. **优先加载用户点击的文件**

**字面解读**:

| 用户提议 | 字面实施方向 |
|---|---|
| (1) 不全量加载 | listNotes 改 metadata-only(title + folderId + updatedAt),**不 assemble doc** |
| (2) 先 NavSide + 退出前 note | NavSide 列表数据 = metadata(快) → 首屏渲染; 退出前 activeNoteId 字面持久化(workspaceManager 已支持),启动后立刻 getNote(activeNoteId) 拉 doc |
| (3) 用户点击的文件优先 | NavSide click → setActiveNote → useEffect[activeNoteId] → 拉 doc(本架构已有,但要确保不被冷启动批量 IO 阻塞) |

**字面落地**:listNotes 改 lazy(只返 metadata),getNote 单点拉 doc。

### 1.4 不在本期范围(登记)

- **NavSide 渲染 92+ 节点慢**(React 虚拟化未配)→ 本期 metadata-only 后字面渲染应快,若仍慢另立 PR
- **broadcastNoteListChanged 启动期反复触发** → 性能优化候选,本期 metadata-only 后字面影响下降,若仍慢另立 PR
- **migration 023 title cache 填充**(若发现 markdown 导入未填) → 看 Phase 2 诊断结果

---

## 2. 决议偏离登记

本期**不**破已知决议;若实施期发现需破 decision XXX,字面登记。

---

## 3. 实施范围

### Phase 1: 加诊断 log(只读 + log,不动业务)

字面对照本次 PR D 实施纪律([[feedback_diag_log_before_speculation]] + 4 轮诊断手法):

**log 点 1**:`src/storage/surreal/...` listNotes 实现入口 + 出口
- 入口字面 `[DIAG-coldstart] listNotes ENTER t=${Date.now()}`
- 出口字面 `[DIAG-coldstart] listNotes EXIT count=${n} elapsedMs=${...}`
- 中间字面每 10 个 note 进度 log

**log 点 2**:assemblePmDoc 入口 + 出口
- 入口字面 `[DIAG-coldstart] assemble ENTER noteId=${id}`
- 出口字面 `[DIAG-coldstart] assemble EXIT noteId=${id} elapsedMs=${...} blockCount=${...}`

**log 点 3**:`buildNoteInfo` / title 派生入口
- 字面 `[DIAG-coldstart] deriveTitle noteId=${id} cacheHit=${bool} elapsedMs=${...}`

**log 点 4**:NavSide 首屏渲染 + 首次拿到 list
- renderer 字面 `[DIAG-coldstart] NavSide useAllNotes received N=${notes.length}`

**log 点 5**:启动 race 候选
- main 字面 `[DIAG-coldstart] migration 023 check start/end`
- main 字面 `[DIAG-coldstart] storage layer ready`
- main 字面 `[DIAG-coldstart] first listNotes IPC handler fire`

**Phase 1 完成后**:用户字面重启 App 复现,贴日志给主对话。**字面禁止猜真因**,看完日志再判。

### Phase 2: 根据日志判真因 → 拍板修法

**字面预期路径**:

- **如果 listNotes 真的是串行 assemble doc 慢**:改 listNotes 只返 metadata(title + folderId + updatedAt + createdAt),**不 assemble doc**。doc 在 getNote 单点拉。
- **如果 title cache miss**:改 markdown 导入路径在 createNotesBatch 字面填 container.attrs.title
- **如果是别的源**:字面对应修

**字面禁止**:**不擅自加 retry / 兜底 / 缓存层** 绕过真因 → 字面对照 [[feedback_no_fallback_bandaid_fixes]]。

### Phase 3: 实施 + V5 复现验证

- 拍板后实施(单 commit 或 2 commit,视改动量)
- 字面要求:重启 App **首屏 NavSide 笔记列表 < 3s 字面渲染**(用户提议 "不可能等待全部文件都加载到内存才展示")
- 点笔记后单 note 加载时间字面 < 1s(getNote 单点 IO)

### Phase 4: 移诊断 log + commit + 等合 main 授权

字面对照 [[feedback_merge_requires_explicit_ok]]: commit 是用户独立授权,push / 合 main 独立授权。

### Phase 5: memory 更新

- 真因登记 memory(若发现新模式 → 新 memory file;若 [[project_word_import_pipeline_hardening_done]] 字面"雪崩修复"路径仍漏 → 字面更新)
- 字面写 cold-start 架构契约(metadata-only listNotes + lazy doc IO)

### 3.4 反对策:**禁止**

- ❌ **不要**改 storage.ts 加全局 cache 兜底(架构债)
- ❌ **不要**改 createNotesBatch 拆批解决 listNotes 慢(跟创建路径无关)
- ❌ **不要**用 worker thread 转移 IO(架构债 + 不解决真因)
- ❌ **不要**给 listNotes 加 timeout 然后 fallback 空列表(字面违反 [[feedback_no_fallback_bandaid_fixes]])
- ❌ **不要**碰 NavSide 渲染层加虚拟化(metadata-only 后字面应快;若仍慢另立 PR)

---

## 4. 文件清单(预估,Phase 1 调研后字面 verify)

| 文件 | 改动 |
|---|---|
| `src/platform/main/note/capability-impl.ts` | listNotes 改 metadata-only(if 真因确认)|
| `src/platform/main/note/handlers.ts` | LIST IPC handler 可能改返 type |
| `src/views/note/use-notes-folders.ts` | renderer 端 hook 类型可能调整 |
| `src/shared/ipc/electron-api.d.ts` | 类型签名 |
| 可能涉及 `src/storage/surreal/storage.ts` listAtoms 调用 | 性能优化 |
| `docs/RefactorV2/data-model/persistence/decisions/XXX.md` | metadata-only contract decision 字面登记 |
| `MEMORY.md` + 新 memory file | cold-start 架构契约 |

---

## 5. 实施步骤

1. `cd /V2 && git checkout -b fix/listnotes-cold-start-slow main`(用户预先切, sandbox 拦你就报)
2. 读 `src/platform/main/note/capability-impl.ts` 字面 listNotes 实现
3. 读 `src/views/note/use-notes-folders.ts` 字面 renderer hook
4. 读 `migrations/023-note-title-cache.ts` 字面 cache 策略
5. 加 Phase 1 §3 字面 5 个 log 点
6. 等用户重启 App 复现 + 贴日志
7. 拍板 Phase 2 修法
8. 实施 Phase 3
9. **V5 实测**:用户字面跑 `npm start` 重启 App,贴日志,**字面验证首屏 < 3s**
10. 移诊断 log
11. 拆 commit 待用户合 main 授权

---

## 6. 风险 + 已知坑

### 6.1 metadata-only 后 NoteView 切笔记慢

字面影响:点笔记 → getNote IPC → assemble doc → 字面 1s+(L7 92 个 block atom)。

**字面缓解**(本期):

- getNote 单 note assemble 字面 < 1s(用户字面接受)
- 如果实测 > 1s, 加诊断 log 看 assemble 慢在哪(pmDocCache miss?atom IO 慢?)

**字面不在本期范围**(若需):

- 按需 lazy load block atom(分页 doc 加载) → 复杂,另立 PR

### 6.2 退出前 activeNoteId 持久化路径

workspaceManager 字面已持久化 activeNoteId(用户提议 (2) 字面已实现一半)。本 PR 字面要求:

- App 启动后,if persisted activeNoteId → 立刻 getNote 拉 doc
- 字面字面避免 listNotes 阻塞 activeNote 加载

字面 verify:看 `src/workspace/workspace-state/...` activeNoteId 字面读取路径。

### 6.3 title cache 字面填充路径

migration 023 字面引入 container.attrs.title cache。验证:

- markdown 导入路径(createNotesBatch + createSingleNoteFromDrafts)字面是否 set attrs.title
- 字面看 `capability-impl.ts:649 const title = deriveTitleFromDrafts(...)` + `containerPayloadWithTitle(title)` → 字面有

→ 如果有,title cache 命中,deriveTitle 字面 O(1) 不 assemble doc;listNotes 慢 ≠ title cache miss

→ 实施期字面 verify(Phase 1 log 字面给答案)

### 6.4 与 PR D (本期上游)关系

- PR D = fix/transaction-occ-retry 字面修 markdown 导入 OCC spam(skipOnChange:true)
- 本 PR = fix/listnotes-cold-start-slow 字面修重启 30s
- 字面独立 PR,字面无依赖
- 用户字面在 PR D 上观察 V5 复现时发现本 bug

---

## 7. 完成后汇报模板(向主对话)

```
fix/listnotes-cold-start-slow 完成汇报:

一、产出
- N commit(列 hash + 描述)
- 文件(按 §4 清单)

二、Phase 1 诊断结果
- (字面 log 出真因)
- 字面排除候选: ...

三、Phase 2 拍板修法
- (字面规格)

四、Phase 3 实施
- listNotes 字面改 metadata-only
- ...

五、验收
- V1 typecheck: PASS / FAIL
- V2 现有 tests: PASS / FAIL
- V3 npm start 实测: 重启后首屏 < 3s
- V4 单 note 加载: getNote < 1s
- V5 用户字面复现确认无丢数据

六、关键决策 + 教训
- 决策(列出本期偏离 prompt 的拍板)
- 教训 memory(列建议新增/更新的 memory)

七、剩余债 + 下游 PR
- (NavSide 渲染虚拟化 / broadcastNoteListChanged 节流 / ...)

八、等待指挥拍板
- 合 main: git merge fix/listnotes-cold-start-slow --no-ff
- push: git push origin main
```

---

## 8. Self-Contained Check

新会话 subagent 不必跑额外调研,本 prompt 已含:

- ✅ 现象(用户字面截图描述)
- ✅ 初判候选(5 个,Phase 1 verify)
- ✅ 用户字面提议修法方向(3 条)
- ✅ Phase 化实施步骤
- ✅ 反对策(禁止的修法)
- ✅ 风险 + 已知坑
- ✅ 汇报模板

唯一外部依赖:

- `git checkout -b fix/listnotes-cold-start-slow main` — 主对话或用户预切
- `npm start` 实测复现 — 用户跑(sandbox)
- 用户字面贴日志判 Phase 1

---

*Prompt 文档 · 2026-05-29 · fix/listnotes-cold-start-slow · 字面基于 PR D 实测发现*
