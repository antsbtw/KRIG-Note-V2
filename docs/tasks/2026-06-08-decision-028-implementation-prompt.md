# 实施任务：Decision 028 — 文档结构属性化（去结构边）

> **角色**：你是负责本任务的工程负责人。独立、安全、分阶段地完成 Decision 028 的实施。
> **总指挥下达（2026-06-08）**。本 prompt 自包含 —— 不依赖任何历史对话上下文即可执行。

---

## 0. 一句话目标

把「文档的顺序/层级/归属」从**关系边**（`belongsToNote` / `childOf` / `nextSibling`）改成
**block atom 的属性**（`noteId` / `parentId` / `order`），让文档本体**零结构边**。
**这会根治「长笔记新建 image 后重加载位置错乱 + 数据损坏」这个可用性 bug。**

---

## 1. 必读（开工前）

按顺序读完,理解架构与现状,再动手：

1. **架构决策（权威方案）**：
   `docs/RefactorV2/data-model/persistence/decisions/028-block-structure-via-attrs.md`
   —— 这是本任务的**唯一权威设计**。所有实现以它为准。
2. **被修订的旧设计**：
   `docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`
   （尤其 §3 拆分粒度【保留】、§6 边集结构【被 028 取代】）
3. **现状核心代码**（要改的）：
   - `src/platform/main/note/dissect-pm-doc.ts` —— PM doc → atom + 边
   - `src/platform/main/note/assemble-pm-doc.ts` —— atom + 边 → PM doc
   - `src/platform/main/note/diff-block-tree.ts` —— old/new doc → atom/边增删
   - `src/platform/main/note/capability-impl.ts` —— `applyDiff` / `updateNote` / `getNote` / `deleteNote`
4. **存储层**：
   - `src/storage/api.ts` —— `AtomFilter`（要扩 `noteId` 过滤）
   - `src/storage/surreal/storage.ts` —— `listAtoms` 实现（加 noteId where）
   - `src/storage/surreal/transaction-helpers.ts` —— `putAtomViaTx`（已 UPSERT 幂等,确认即可）
   - `src/storage/migrations/runner.ts` + `src/storage/migrations/023-note-title-cache.ts`（migration 模板）
   - `src/storage/health/cardinality-check.ts` —— 结构边的 cardinality 扫描（要适配/移除）

---

## 2. 不可违反的铁律

1. **以 028 文档为唯一权威**。文档与本 prompt 冲突时,以 028 文档为准；若你认为文档有误,**停下来问总指挥**,不要自行偏离。
2. **分阶段（§4），每阶段独立 commit + 由人实测验证后才进下一阶段**。绝不一次性大爆改。
3. **每阶段保证向后兼容 / 可回退**。尤其迁移前,旧 assemble 路径必须仍能读旧数据。
4. **数据迁移是高危操作**。迁移前要有 round-trip 校验（迁移后 assemble 出的 doc 必须与迁移前逐块相等,加 hash 比对作为验收）。迁移失败可回滚。
5. **026 的 atom 拆分粒度不动**（结构性容器 bulletList/orderedList/taskList/columnList/tableRow 不拆 atom；跨层 parentId 跳层语义沿用旧 childOf）。
6. **关系边（双链/引用/graph inCanvas/hasNoteView/inFolder 等）不动**。本任务只动**结构边**三类：belongsToNote / childOf / nextSibling。
7. **不打补丁**：不要去给 putEdge 加幂等、不要给 cardinality 加自愈来"缓解"——028 是根治方案,结构边将被整体移除,补丁是浪费。
8. **诊断纪律**：排查用临时 `[DIAG]` 日志或离线脚本验证真实数据,**定位后立即删除诊断**。不靠推断下结论（见 §6 排查规范）。
9. **commit 规范**：在 main 上先开分支；commit message 以 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` 结尾；每阶段 `typecheck + lint` 必须全绿。

---

## 3. 目标数据模型（来自 028 §2）

每个 block atom 的 payload.attrs 增加三个字段,**结构完全由属性表达,零结构边**：

| 字段 | 替代 | 含义 |
|------|------|------|
| `noteId` | belongsToNote 边 | 该 block 属于哪篇笔记（顶层归属,本体固有事实） |
| `parentId` | childOf 边 | 父 block 的 atom id；顶层块为 null（跨结构容器跳层,语义同旧 childOf） |
| `order` | nextSibling 边 | 同级内排序键 —— **字典序 rank**（lexicographic） |

- **order = 字典序字符串**（如 `"a0" < "a1" < ... `）。插入中间取两端中点（O(1),不重排其他块）。dissect 初次按顺序分配递增 rank。**实现/复用一个 lexrank 工具**（生成初始序列 + 取中点 + 末尾追加）；优先找现有,无则新建 `src/platform/main/note/lexrank.ts` 并写单测。
- **assemble**：`listAtoms({ domain:'pm', noteId })` 一次拉本笔记所有 atom → 按 `parentId` 建树 → 同级按 `order` 升序排 → 用现有 `applyRebuildRules` / `assembleTable` 重建中间容器壳（这部分逻辑**不变**,只改"输入来源从边变属性"）。
- **关系边按需**：原始文档 dissect 出来零结构边。关系边由独立功能（双链等）另建,不在本任务。

---

## 4. 分阶段实施（每阶段：实现 → typecheck/lint → 人实测 → commit）

> 每阶段结束**停下来**,把验证清单交给总指挥/用户在 app 实测,通过后才继续。

### Phase 0 — 字段就位（双写过渡,零行为变化）
- block atom schema/dissect 增加写入 `noteId` / `parentId` / `order` 三属性，**但保留现有边生成**（双写）。
- assemble **仍读边**（不变）。
- 加 `listAtomsByNote`（或扩 `AtomFilter.noteId`）storage API + SurrealDB 索引 `payload.payload.attrs.noteId`。
- 验收：typecheck/lint 绿；新建/编辑笔记行为**完全不变**（属性只是多写了,没人读）。dump 一篇笔记确认 atom 上带了正确的 noteId/parentId/order。

### Phase 1 — assemble 改读属性（属性优先,边 fallback）
- assemble 改为**优先按属性**建树排序；属性缺失（旧数据）则 fallback 旧边逻辑。
- 验收：**round-trip** —— 打开多篇笔记（含嵌套列表/表格/容器/图片）,顺序层级与改前**逐块一致**。重点测之前会错乱的长笔记+image 场景。

### Phase 2 — 写入只写属性（停写结构边）
- `applyDiff` 不再 putEdge/deleteEdge 结构边；diff 改为纯 atom 属性 diff（order/parentId/noteId 变化 = atom modified）。
- `deleteNote` 级联改为按 noteId 查 atom 删（不依赖 belongsToNote 边）。
- 验收：新建/改顺序/插块/删块/新建 image → 重启后**位置正确、image 存住**（根治目标场景）；dump 确认新写入**零结构边**。

### Phase 3 — 迁移 + 清旧边
- 新增 `src/storage/migrations/0xx-block-structure-attrs.ts`（注册进 `runner.ts` 的 `MIGRATIONS`,新 version 号）：
  每篇 note → 旧 `assemblePmDoc`（用边,带 keep-latest 去重得**正确顺序**）→ 重新 dissect 成属性形式 → 批量 putAtom（幂等可重跑）+ **删除该 note 所有结构边**（belongsToNote/childOf/nextSibling）。
- **迁移即修复**：用旧 assemble 的去重读出正确序 → 写成属性 → 现有损坏笔记（重复边导致的错乱）被自动修正。
- 迁移内置 round-trip 校验：迁移后 assemble 的 doc 与迁移前 hash 比对,不一致则 warn + 不删该 note 的边（保守,留人工）。
- 验收：迁移后 cardinality-check 不再报结构边违反；损坏的老笔记顺序恢复；全库 dump 抽查结构边数→0。

### Phase 4 — 清理死代码
- 删 dissect 的结构边生成、assemble 的边 fallback、diff 的边处理、cardinality-check 的结构边扫描（belongsToNote/childOf/nextSibling 三类）。
- 验收：typecheck/lint 绿；全量回归（新建/编辑/导入/image/嵌套/表格/重启）无回归。

---

## 5. 关键风险与对策（必看）

| 风险 | 对策 |
|------|------|
| order 字典序取中点退化（频繁中插字符串变长/无法再分） | lexrank 用足够基数（如 base-62 + 多字符）；写单测覆盖"连续中插 1000 次"；必要时 Phase 后续加"局部重排"兜底 |
| parentId 跨结构容器跳层算错 → 树乱 | 严格沿用旧 childOf 的跳层语义（dissect-pm-doc 现有逻辑）；round-trip 校验兜底 |
| `listAtomsByNote` 无索引 → 全表扫描慢 | Phase 0 就建 SurrealDB 索引；验证大库查询延迟 |
| 迁移把正确数据写坏（不可逆） | 迁移前旧 assemble 仍可读（Phase 1 fallback 在）；round-trip hash 校验；失败不删边、保守留人工；先在副本/测试库验证 |
| Phase 1 双读不一致 | 属性优先 + 边 fallback 的判定要清晰（atom 有 order 字段就走属性,否则走边） |
| listNotes 的"按 hasNoteView 反查 container"路径 | hasNoteView 是关系边,**不动**；listNotes 不受本任务影响,确认即可 |

---

## 6. 排查规范（踩坑教训,务必遵守）

- **不要靠读代码推断根因**。怀疑某处 → 加最小 `[DIAG]` 日志 / 写离线 round-trip 脚本 / 直接 dump 数据库真实数据,**用真实数据定位**,再下结论。定位后立即删诊断。
- **dump 数据库 > 看 diff**。排查存储问题时,直接查 DB 真实 atom/边状态（三时点：写前/写后/重开后）比看内存 diff 更可靠。
- **区分"笔记大"与"数据坏"**：性能慢 ≠ 数据损坏；用 cardinality-check / dump 确认是哪种。
- **新笔记 vs 老笔记对照**：怀疑数据损坏时,用全新笔记隔离实验（新的正常→老的坏 = 数据问题；新老都坏 = 代码问题）。
- **fail loud,不要兜底掩盖**：异常/缺字段优先 throw 暴露,不要 silent fallback 把真 bug 藏起来。

---

## 7. 交付标准（全部满足才算完成）

- [ ] Phase 0–4 全部 commit + 人实测通过,main 与 origin 同步。
- [ ] **根治验证**：长笔记新建 image → 重启 → 位置正确、image 存住、无 `nextSibling 2 heads` / `CARDINALITY_VIOLATION` 刷屏。
- [ ] 迁移修复了现有损坏笔记（顺序恢复）。
- [ ] 全库结构边（belongsToNote/childOf/nextSibling）数 → 0。
- [ ] 回归：新建/编辑/导入/嵌套列表/表格/容器/图片/重启 全部正常。
- [ ] typecheck + lint 全绿;无残留 `[DIAG]` 诊断。
- [ ] 028 文档若实施中有偏差/补充,同步更新文档（保持文档=事实来源）。

---

## 8. 起步指令

1. 读完 §1 全部材料。
2. 先做 §3 的 lexrank 工具 + 单测（独立、可先验证,风险最低）。
3. 进 Phase 0。每阶段做完停下来,把验收清单交人实测。
4. 有任何架构层面的疑问（不只是实现细节）→ 停下来问总指挥,不自行偏离 028。
