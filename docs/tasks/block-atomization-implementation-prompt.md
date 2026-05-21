# 任务：实施 block 独立化 sub-phase(`feature/L7-block-atomization` 分支)

> **任务性质**:**代码实施任务**(改 src/ + 测试 + migration)
> **触发日期**:2026-05-21
> **前置依赖**:
>   - [`docs/RefactorV2/data-model/atom/decisions/025-atom-granularity-current-form-acknowledgment.md`](../RefactorV2/data-model/atom/decisions/025-atom-granularity-current-form-acknowledgment.md)(承接 v1.3 工程妥协)
>   - [`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`](../RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md)(核心设计 14 节)
>   - [`docs/RefactorV2/stages/block-atomization-implementation-plan.md`](../RefactorV2/stages/block-atomization-implementation-plan.md)(9 Stage 实施计划)
> **设计起点参考**:[Canvas-As-Note-Migration.md](../10-business-design/graph/Canvas-As-Note-Migration.md)(V1 时代草案)
> **设计 commit**:`5c0311fc` / merge commit `947c9961`(2026-05-21,已合 main)

---

## 0. 工作目录纪律(必读)

所有 cwd 敏感命令(git/npm/grep/find/rm 等)**每次** Bash 调用都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...` 显式指定。

V1(`/Users/wenwu/Documents/VPN-Server/KRIG-Note`)**仅作参考,不动**。

读 `/Users/wenwu/.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_v2_cwd_drift_again.md` 看历史 7 次 cwd 漂移事故。

---

## 1. 任务边界(严格)

**这是代码实施任务,不是决策任务。**

- ✅ 你要做:按实施计划 9 Stage 顺序执行,改 src/ + 测试 + migration
- ❌ 你不该做:重新讨论已拍板的设计(全部由 decision 025 / 026 字面拍板)/ 自行扩展范围 / 跳过 Stage
- ❌ 你不该做:把 sub-phase 范围之外的事顺手做了(如优化性能 / 重构其他模块 / 改无关 capability)

最终交付:
- 9 Stage 全部 EM 通过 commit 到 `feature/L7-block-atomization` 分支
- 完成验收报告写在 `docs/RefactorV2/notes/block-atomization-completion-report-<YYYY-MM-DD>.md`
- 用户审计通过后合 main

---

## 2. 前置必读(按顺序读完再动手)

### 2.1 设计层(决策依据)

1. **`docs/RefactorV2/stages/block-atomization-implementation-plan.md`** — 9 Stage 完整任务设计(这是你的工作手册)
2. **`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`** — 14 节核心设计;
   - 特别注意 §3.1.1 / §3.1.2 颗粒度拆分清单(叶子+叶子级容器 vs 结构性容器)
   - §3.3 childOf 边拼装规则(跨层处理)
   - §5 PM 操作语义(create/copy/split/merge/undo)
   - §6 嵌套与边集(belongsToNote / nextSibling / childOf)
   - §8 PM ↔ atom 转换(读时拼装/写时拆解 + in-memory cache)
   - §13 Open Questions(8 个,实施过程中遇到对应场景按字面默认处理 + 必要时反向更新决议)
3. **`docs/RefactorV2/data-model/atom/decisions/025-atom-granularity-current-form-acknowledgment.md`** — 工程妥协承接条款 + 反向更新清单(decision 022 §3.2 占位等)

### 2.2 上下文文档

4. **`docs/RefactorV2/notes/atom-granularity-investigation-2026-05-21.md`** — 调查报告(理解触发背景)
5. **`docs/00-architecture/three-layer.md` §2.4 / §6.4 / §8** — 长期愿景理解(本 sub-phase 是 v1.3 工程妥协→投影模型路径的一步落地)
6. **`docs/10-business-design/graph/Canvas-As-Note-Migration.md`** — V1 时代草案参考(设计起点)

### 2.3 现有 V2 模式(学习已实施的同模式)

7. **`docs/RefactorV2/data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md`** — 学 sub-phase 实施 commit 节奏
8. **`docs/RefactorV2/data-model/persistence/decisions/013-sub-phase-3a-graph-canvas-migration.md`** — graph-instance 细颗粒 atom 模式(本 sub-phase 直接对照)
9. **`docs/RefactorV2/data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md`** — sub-phase 实施完整流程参照(含审计与反向更新)
10. **`docs/RefactorV2/data-model/persistence/spec.md`** + `atom-entity.md` + `edge-entity.md` + `surreal-schema.md` — storage 层契约
11. **`src/storage/api.ts`** + `src/storage/surreal/` — storage 层调用接口
12. **`src/semantic/types/`** — Atom / Edge / AtomEntity 类型定义

### 2.4 必读 memory(每条都关系本 sub-phase 实施细节)

读 `/Users/wenwu/.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/MEMORY.md` 全部,特别:

- `feedback_decision_grep_verify_complete_propagation.md` — 决议字面拍板必须 grep 6 层传播链(实施前重 grep 影响面)
- `feedback_pm_internal_attr_write_must_mark_no_history.md` — PM 非用户编辑 tr 必须 `addToHistory:false`(Stage 1 appendTransaction 关键)
- `feedback_pm_schema_naming.md` — PM node name 不含短横线
- `feedback_pm_schema_autofill.md` — block+ 容器删空会 autofill(Stage 2 拼装时关键)
- `feedback_pm_dom_at_pos_text_node.md` — domAtPos 返 text node 需 parentElement 兜底
- `feedback_strict_compliance_workflow.md` — 严格态全谱表
- `feedback_branch_module_boundary.md` — 一个模块一条 feature 分支
- `feedback_v2_cwd_drift_again.md` — 每 Bash 调用都 cd /V2
- `feedback_no_fallback_bandaid_fixes.md` — bug 排查必须先 log 定位真因
- `feedback_implementation_test_checklist.md` — 实施完成后必须给可执行测试清单
- `feedback_merge_requires_explicit_ok.md` — 不擅自 merge / push
- `feedback_module_event_bus_subscribe_race.md` — 启动期事件竞态(Stage 1 cold start race 防御)
- `feedback_use_sync_external_store_stable_ref.md` — Stage 2 in-memory cache 设计参考

### 2.5 现有代码影响面(grep 重新验证)

实施前**必须**先 grep 一遍当前 src/ 影响面(可能跟决议 026 §10.1 字面有偏差 — 实施前复 grep 校准):

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2

# 1. 当前 anchor 算法位置
grep -rn "getBlockAnchorAt\|scrollToBlockAnchor\|krig://block" src/

# 2. NoteLocator 使用点(决议预估约 10 处,复 grep 校准)
grep -rn "NoteLocator\|pmPos" src/

# 3. 当前 28 个 block schemas + atomId 占位
ls src/drivers/text-editing-driver/blocks/
grep -rn "atomId\|attrs:" src/drivers/text-editing-driver/blocks/*/spec.ts | head -30

# 4. note capability 现状
cat src/platform/main/note/capability-impl.ts

# 5. storage API
cat src/storage/api.ts | head -100

# 6. NoteView 编辑事件路径
grep -rn "onChange\|handleDocChange\|applyExternalDoc" src/views/note/ src/drivers/text-editing-driver/

# 7. IPC + preload
grep -rn "noteUpdate\|noteGet\|noteList" src/platform/preload/ src/shared/ipc/

# 8. ebook bookAnchor 现状
grep -rn "bookAnchor" src/drivers/text-editing-driver/blocks/ | head
```

Grep 结果对照 decision 026 §10.1 字面清单 — 偏差(数量/位置)→ 实施前**告诉用户**,**不擅自调整决议**。

---

## 3. 实施流程(严格按 9 Stage 顺序)

### 3.1 起点验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2

# 1. 确认 main 是干净的 + 含 decision 025/026
git checkout main && git status --short
git log --oneline -5  # 应有 commit 947c9961 / 5c0311fc

# 2. 创实施分支
git checkout -b feature/L7-block-atomization main

# 3. typecheck + lint 全绿
npm run typecheck
npm run lint
```

### 3.2 Stage 顺序

按实施计划 §2-§10 字面顺序:

| Stage | 主交付 | 必须 EM 全过才进下一 Stage |
|---|---|---|
| 1 | PM schema 改造 + appendTransaction id 注入 + skipOnChange 防御 | EM1 |
| 2 | note capability 改造(read 拼装 + write 拆解 + diff + in-memory cache) | EM2 |
| 3 | 三 predicate 字面落地 + cardinality 检查 | EM3 |
| 4 | NoteLocator 升级 + thought view 适配 | EM4 |
| 5 | URL 协议演化(getBlockAnchorAt → getBlockIdAt) | EM5 |
| 6 | 一次性 migration script + 备份 round-trip | EM6 |
| 7 | 8 个典型场景测试 | EM7 |
| 8 | 性能压测(P95 5 项指标) | EM8 |
| 9 | 验收 + 文档反向更新 | EM9 |

### 3.3 Commit 节奏(沿决议 022 模式)

- **每个 Stage 内多次 commit**(沿 Step 粒度,每 Step 1 commit)
- **每个 Stage 完成 EM 后**额外 1 commit 写 EM verify 报告(verify-only,无代码)
- **不合 main**(沿 [[branch-module-boundary]])
- **全部 9 Stage 完成 + EM 全过**后停下,通知用户审计
- 用户审计通过 → 用户字面 OK → 才合 main + push(沿 [[merge-requires-explicit-ok]])

### 3.4 偏离登记纪律

按 decision 022 §0.2 模式:

- 实施期间若发现**字面证据**跟决议 026 不一致(如 PM schema 关系 / storage API 行为):
  1. **停下**,不擅自改实施方向
  2. 在 commit message 字面登记"§X.Y 偏离登记"
  3. 写入 `docs/RefactorV2/notes/block-atomization-deviations-<YYYY-MM-DD>.md`
  4. 完成报告时汇总
- 偏离类型:
  - **事实纠错**(决议字面与代码行为冲突)→ 反向更新决议
  - **临时妥协**(实施层选择跟决议略不同)→ 字面登记理由
  - **新发现 Open Question**(决议未覆盖)→ 字面登记 + 临时默认处理

---

## 4. 关键实施细节(决议字面已拍板,这里只列易踩坑)

### 4.1 颗粒度拆分清单(decision 026 §3.1)

实施 Stage 1.2 必须**严格按字面**:

**加 `id` 字段**(叶子 + 叶子级容器):
- paragraph / heading / horizontalRule / hardBreak(纯叶子文本)
- codeBlock / mathBlock / mathVisual / image / fileBlock / fileLink / audioBlock / videoBlock / htmlBlock / tweetBlock / externalRef(叶子内容)
- listItem / taskItem / tableCell / tableHeader / callout / column / blockquote / toggleList / unknown(叶子级容器)

**不加 `id`**(结构性容器):
- table / tableRow / bulletList / orderedList / taskList / columnList

(共 28 blocks 评估,约 22 加 / 6 不加)

### 4.2 appendTransaction id 注入防御(决议 026 §5.1 + 实施 §2.3 Step 1.4)

```ts
// 关键 2 条 meta 必须同时设置
tr = tr.setMeta('addToHistory', false);   // 不进 history
tr = tr.setMeta('skipOnChange', true);    // 防御冷启动 N atom 写入 race
```

Host onChange handler 必须**字面检查** `tr.getMeta('skipOnChange')` → true 则不发 IPC。

### 4.3 childOf 边跨层规则(决议 026 §3.3 + §6.1)

childOf 边**不一定指向 PM 父节点**,而是指向**最近的拆 atom 的祖先**:

- tableCell.childOf → table atom(跳过 tableRow / tableHeader)
- listItem 在 doc 顶层的 bulletList 内 → childOf → note 容器(跳过 bulletList);belongsToNote → note 容器
- callout 内 paragraph → childOf → callout atom

Stage 2 拼装时**capability 层必须手工重建中间层**(沿 PM schema 默认 content rule 推断或代码硬编码常见模式)。

### 4.4 undo merge 语义(决议 026 §5.6)

- PM history **精确回滚**(含 attrs.id)
- storage 走 added 路径**自然恢复** A2 atom(diff 算法识别 "newDoc 有但 storage 无" → added)
- **A2 上原有的 thought 边 / 跨 note 引用永久失效**(用户拍板接受)
- Stage 7 测试 T6 必须 verify 这个语义

### 4.5 不在本 sub-phase 范围(决议 026 §0.2)

- ❌ 投影模型(语义层 vs PM 渲染层彻底分离)
- ❌ 跨 note Block 共享 / 多视图 Block 复用
- ❌ 携运语义(cut/copy 区分)— 留未来 sub-phase(decision 026 §13.6)
- ❌ 完整 unit test 覆盖率
- ❌ 性能深度优化(若 Stage 8 不达标字面登记留独立 sub-phase)

---

## 5. 用户决策点(实施前必须 AskUserQuestion)

实施过程中若遇到**决议未覆盖**的语义级议题,**必须 AskUserQuestion** 不替用户决定。已知触发点:

1. **决议 026 §13.7 tableHeader 拆分确认** — Stage 1 grep table schema 后,若发现 tableHeader.content === 'tableCell+' 跟 tableRow 同性质,**确认是否仍按字面拍板**(临时默认拆,跟 tableCell 同模式)
2. **决议 026 §13.3 nextSibling 链断裂修复策略** — Stage 2 拼装函数遇到链断裂时按字面 fallback(console.error + 字典序 append),实施 verify 阶段确认
3. **决议 026 §13.4 cache 内存上限** — Stage 8 性能压测后若超 200MB,**询问用户**是否本 sub-phase 加 LRU eviction 还是留独立 sub-phase
4. **新发现的 Open Question** — 实施期间发现决议未覆盖的语义问题,**全部** AskUserQuestion

---

## 6. 完成判据(全部满足才汇报"sub-phase 完成")

- ✅ Stage 1-9 全部 EM 通过
- ✅ 8 个测试场景(T1-T8)通过
- ✅ 性能 5 项指标过(或字面登记不达标项 + 留独立 sub-phase)
- ✅ 文档反向更新清单完成(decision 022 §3.2 注销 / atom/spec.md §2.5 同步 / three-layer §2.4 §6.4 §8 追加)
- ✅ memory 字面登记 `project_block_atomization_done.md`
- ✅ 偏离登记(若有)归档 `docs/RefactorV2/notes/block-atomization-deviations-<YYYY-MM-DD>.md`
- ✅ 完成报告 `docs/RefactorV2/notes/block-atomization-completion-report-<YYYY-MM-DD>.md`
- ✅ commit 全部在 `feature/L7-block-atomization` 分支(未合 main)
- ❌ **未** commit 前 Release Note 公告旧 URL 失效(留合 main 时用户操作)

---

## 7. 红线(绝不可碰)

- ❌ 不要重新讨论已拍板的设计(全部由 decision 025 / 026 拍板)
- ❌ 不要写 src/ 之外的"顺手优化"代码
- ❌ 不要擅自 merge 或 push(沿 [[merge-requires-explicit-ok]])
- ❌ 不要跳 Stage 顺序(Stage 1 EM 未过不进 Stage 2)
- ❌ 不要 --no-verify / --no-gpg-sign 等绕过 hook
- ❌ 不要 force push / reset --hard 等破坏性操作
- ❌ 不要碰位置记忆代码(`feature/note-position-memory` 分支)
- ❌ 不要碰 V1 仓库

---

## 8. 第一步该做

1. **读这个提示词全文**(已经在做)
2. **读 §2 全部前置文档**(每读一份给用户 200 字汇报关键发现)
3. **§2.5 grep 重新验证影响面**,跟决议 026 §10.1 字面对比,偏差告诉用户
4. **用 TodoWrite 把 9 Stage + 各 Step 写成 todo list**
5. **§3.1 起点验证**(确认 main 干净 + 创建分支)
6. **Stage 1 Step 1.1 起步**

不要跳过任何环节。

---

## 9. 实施期间用户对话风格

- 用户偏好简洁、有事实根据的回答
- 用户会盯偏离登记的真实性(不要把"我推测"包装成"决议拍板")
- 用户会查 commit message 字面与代码改动的一致性
- 用户在意"决议是否真落地"vs"我以为落地了"的区别(详二轮审计经验)
- 不要"我建议"的句式;倾向"事实是 X,可能性 A/B/C"

---

## 10. 完成后下一步(给用户的提示)

实施完成 + 用户审计通过 + 合 main 后,**下一对话**重做位置记忆 feature:

- 位置记忆基于 block id(`attrs.id`)而非 `<idx>:<前30字>` anchor
- 字面 schema 升级到 `NoteViewedPosition { topBlockId: string; selectionPos: number }`
- 位置记忆代码当前在 `feature/note-position-memory` 分支留着,届时**重做不复用**(取消 anchor 路径)
- 实施细节是更小的 feature,不需要新 sub-phase 决议

---

*Block Atomization Implementation Prompt · v0.1 · 2026-05-21*
