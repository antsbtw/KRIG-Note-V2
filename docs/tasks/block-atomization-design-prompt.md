# 任务：设计 V2 block 独立化 sub-phase（决议文档级，不写代码）

> **任务性质**：决议设计任务 —— 产出 V2 决议文档 + 实施任务设计文档；**不写代码、不改 schema、不动 src/**
> **触发日期**：2026-05-21
> **触发依据**：[docs/RefactorV2/notes/atom-granularity-investigation-2026-05-21.md](../RefactorV2/notes/atom-granularity-investigation-2026-05-21.md) 调查报告
> **用户决策**：同时承接 v1.3 工程妥协 + 设计 block 独立化 sub-phase 的实施路径

---

## 0. 工作目录纪律

所有 cwd 敏感命令（git/npm/grep/find 等）每次 Bash 调用都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...` 显式指定。

V1（`/Users/wenwu/Documents/VPN-Server/KRIG-Note`）仅作参考。

---

## 1. 任务边界（严格）

**这是决议设计任务，不是实施任务。**

- ✅ 你要做：写决议文档 + 实施任务设计文档；让用户读完能拍板"启动 / 不启动 / 延后"
- ❌ 你不该做：写代码、改 PM schema、动 storage 层、改 capability、加 IPC

最终交付物 = 3 份决议/设计文档（位置见 §4）

实施代码留给**下一个独立分支**（`feature/L7-sub<N>-block-atomization`）的下一个对话。

---

## 2. 前置必读

### 2.1 调查报告（必读，是本任务的**事实底座**）

[`docs/RefactorV2/notes/atom-granularity-investigation-2026-05-21.md`](../RefactorV2/notes/atom-granularity-investigation-2026-05-21.md) —— 全文读完。

特别注意：
- §2 事实矩阵（spec ↔ 实施 对照表）
- §2.1 graph vs note 颗粒度对比表 —— **graph 早就细颗粒做对了，note 是异类**
- §3.1 历史踪迹：[three-layer.md §2.4](../00-architecture/three-layer.md)、[Canvas-As-Note-Migration.md](../10-business-design/graph/Canvas-As-Note-Migration.md) 已有的延后记录和方案草案
- §4 4 种可能性分析 —— 用户已认可"V1→V2 跨界时架构文档断裂"的结论
- §5 影响面 —— 当前哪些 feature 受限
- §6 5 个开放问题

### 2.2 上游架构文档

按顺序读完：

1. [`docs/00-architecture/three-layer.md`](../00-architecture/three-layer.md) §2.2 / §2.4 / §6.4 / §8 —— **v1.3 工程妥协 + 远期愿景的字面记载**
2. [`docs/00-architecture/charter.md`](../00-architecture/charter.md) §4 —— atom / block / blockView 三层精确定位
3. [`docs/00-architecture/vision.md`](../00-architecture/vision.md) §3.2 / §5.6 —— "图谱是稳定资产" / "修改必须落在 atom"
4. [`docs/10-business-design/graph/Canvas-As-Note-Migration.md`](../10-business-design/graph/Canvas-As-Note-Migration.md) —— **V1 时代已有的 block 级 atom + atom.meta.canvas 设计草案**（这是宝贵的设计起点）

### 2.3 现有 V2 决议体系（学习现有决议格式）

按编号读：

1. [`docs/RefactorV2/data-model/atom/spec.md`](../RefactorV2/data-model/atom/spec.md) §0 / §1 / §2 —— atom 字面定义
2. [`docs/RefactorV2/data-model/atom/decisions/`](../RefactorV2/data-model/atom/decisions/) 所有 002-005 决议 —— 学决议文档结构
3. [`docs/RefactorV2/data-model/persistence/decisions/`](../RefactorV2/data-model/persistence/decisions/) 011-024 决议 —— 重点：
   - 012 `sub-phase-2-note-folder-migration.md` —— "pm atom = note" 拍板（被本任务**升级**）
   - 016 `sub-phase-3a-2.5-note-form-upgrade.md` —— hasNoteView 边模式
   - 022 `sub-phase-022-ebook-thought-migration.md` §3.2 —— **字面引用了 "decision 030+ 大架构升级"** 但 030 不存在
   - 024（如有）

### 2.4 现有代码影响面（grep 验证）

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2

# 1. 当前 note atom 写入路径
cat src/platform/main/note/capability-impl.ts

# 2. 当前 anchor 算法
grep -n "getBlockAnchorAt\|scrollToBlockAnchor\|krig://block" src/ -r

# 3. 现有 block schema（看 attrs.id 现状）
grep -rn "attrs:" src/drivers/text-editing-driver/blocks/*/spec.ts | head -30
ls src/drivers/text-editing-driver/blocks/

# 4. thought / ebook annotation 的 BookAnchor 实现（decision 022 §1.3.1 的产物）
grep -rn "bookAnchor" src/drivers/text-editing-driver/blocks/ | head -20
grep -rn "BookAnchor\|NoteLocator\|GraphLocator" src/shared/ipc/

# 5. graph 的细颗粒 atom 模式（参考实现）
cat src/platform/main/graph/canvas-store.ts | head -100

# 6. PM transaction handling（理解新建 block 在哪里能拦截）
grep -rn "dispatchTransaction\|appendTransaction" src/drivers/text-editing-driver/ | head -20
```

### 2.5 必读的 memory

读 `/Users/wenwu/.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/MEMORY.md` 全部条目。特别注意：

- `feedback_decision_grep_verify_complete_propagation.md` —— 决议字面拍板必须 grep 6 层传播链 + SDK-policy §2.2 第 8 步永久落地
- `feedback_sdk_version_binding_policy.md` —— V2 SDK 绑定发布包,跨大版本独立 sub-phase
- `feedback_pm_internal_attr_write_must_mark_no_history.md` —— PM 非用户编辑 tr 必须 addToHistory:false
- `feedback_pm_schema_naming.md` —— PM node name 不能含短横线
- `feedback_pm_schema_autofill.md` —— block+ 容器删空会 autofill
- `feedback_strict_compliance_workflow.md` —— 严格态全谱表
- `project_decision_021_folder_view_isolation.md` / `project_sub_phase_022_ebook_thought_completed.md` —— 看历史 sub-phase 怎么走完整个流程

---

## 3. 任务目标（3 个目标，3 份文档）

### 3.1 目标 A：修复架构文档断裂（最紧迫，无代码改动）

**问题**：[调查报告 §4.1](../RefactorV2/notes/atom-granularity-investigation-2026-05-21.md) 字面证据：
- [three-layer.md §2.4](../00-architecture/three-layer.md) 字面承认"v1.2 工程妥协"
- V2 决议体系字面**未承接**这个工程妥协
- V2 实施时按"惯性"继承 v1.2 形态，但没有任何 V2 决议引用该工程妥协作为依据
- decision 022 §3.2 字面引用 `decision 030+ 大架构升级`，但 **030 不存在**

**产出 1**：`docs/RefactorV2/data-model/atom/decisions/025-atom-granularity-current-form-acknowledgment.md`（编号按现有最高 +1，先 grep 确认）

文档应包含：
- 背景：调查发现的 V1→V2 跨界断裂
- **字面承接** three-layer.md §2.4 v1.2 工程妥协 / §6.4 Block 独立化远期愿景 / §8 决策留痕
- 字面声明：**当前 V2 atom 颗粒度（note=整篇 / graph=细颗粒）是显式选择**，不是疏忽
- **字面登记** decision 026（或下个编号，见 §3.2）为 Block 独立化 sub-phase 设计文档的正式编号
- 字面登记 [Canvas-As-Note-Migration.md](../10-business-design/graph/Canvas-As-Note-Migration.md) 作为该 sub-phase 的设计起点
- 字面取消 decision 022 §3.2 的 "decision 030+ 大架构升级" 占位（改为指向 decision 026）
- 影响面分析：哪些现有决议（012 / 016 / 022）字面引用了"整篇 atom"形态，需要在 decision 026 落地时同步更新

### 3.2 目标 B：设计 block 独立化 sub-phase（核心产出）

**产出 2**：`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`（编号 grep 确认）

这是**大决议**，需要严肃讨论以下议题（每条都要给 spec ↔ 实施 对照 + 替代方案表 + 用户决策点）：

#### B.1 颗粒度边界

- block 拆 atom 是拆**顶层 block** 还是**所有 PM node**（含 list-item / table-cell / callout-paragraph）？
- inline node（text / mark）拆不拆？
- 参考 [Canvas-As-Note-Migration.md §0.3](../10-business-design/graph/Canvas-As-Note-Migration.md) 的 `{ id, type:'textBlock', content:[...], meta:{ canvas:{...} } }` 设计

#### B.2 ID 字段

- 加到哪：PM schema 的 `attrs.id`？还是独立 atom payload？
- ID 字符集：ULID（跟 atom-entity 一致）？
- 生成时机：PM transaction 拦截 + appendTransaction 自动注？还是 schema 默认值？

#### B.3 PM 操作语义

| 操作 | 决策点 |
|------|------|
| 用户敲 Enter 新建 paragraph | 谁注入 id？时机？ |
| 用户 Cmd+C / Cmd+V 复制 block | 用新 id？保留旧 id？跨 note 粘贴呢？|
| 用户在中间按 Enter 拆段 | 哪段保留原 id？ |
| 用户 backspace 合并两段 | 保留谁的 id？ |
| undo/redo | 含 id 的 transaction 怎么处理（参考 `[[pm-internal-attr-write-must-mark-no-history]]`）|

#### B.4 嵌套 block 的 id 注入

- list-item / table-cell / callout 内 paragraph：是否独立 atom？颗粒度多深？
- `containerRule` / `cascadeBoundary` 等现有 PM 概念怎么对接

#### B.5 边集设计

block 拆 atom 后能用边表达哪些关系（参考 [README.md §40-80](../data-model/README.md) "属性走边"）：

- `user:krig:contentOf` block → note（属于哪个 note）
- `user:krig:nextSibling` / `user:krig:parentOf`（顺序与层级，对比 PM 嵌套 vs 边图两种表达）
- 其他

#### B.6 URL 协议演化

- 新格式 `krig://block/<noteId>/<blockId>` 替代 `<idx>:<prefix>`
- 旧 anchor 兼容期：多长？兼容层在哪（[`build-link-click-plugin.ts:73`](../../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L73) `scrollToBlockAnchor`）？
- 已有用户笔记里的旧 `krig://block/.../248:文本前缀` 链接：自动迁移 / 兼容期内继续工作 / 直接失效？

#### B.7 迁移策略

- 已有 note 数据（每个 block 无 id）：
  - 一次性 migration script 给所有现存 block 注入 id？
  - 还是惰性迁移（用户编辑某 block 时再注 id）？
- SurrealDB schema 变更：
  - 是否新增 `block:[id]` 表（[three-layer.md §6.4](../00-architecture/three-layer.md) 字面建议）？
  - 还是 block 仍 inline 在 note atom 的 payload，只是多个 id 字段？
- ebook annotation 现存的 `bookAnchor` 塞 block.attrs 模式（[decision 022 §1.3.1](../data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md)）：拆 atom 后怎么迁？

#### B.8 容量与性能取舍

按 [调查报告 §5.3](../RefactorV2/notes/atom-granularity-investigation-2026-05-21.md) 列出的"整篇 atom 优势 vs block 级代价"：

- 写入：每按键编辑产生 N atom 写入 vs 整篇 atomic write
- 查询：listNotes 性能（现 3-query 模式怎么演化）
- 边表：1000 block × N 条边 / note 的存储与索引规模
- 编辑事务：PM step → atom 写入的映射粒度

#### B.9 影响面清单（按 SDK-policy §2.2 第 8 步前瞻 grep）

grep 所有需要同步改的位置：

```bash
# 引用 anchor 字符串的所有位置
grep -rn "krig://block\|getBlockAnchorAt\|scrollToBlockAnchor" src/

# 引用 NoteLocator / BookAnchor 的所有位置
grep -rn "NoteLocator\|BookAnchor\|GraphLocator\|pmPos" src/

# 现有 note capability 6 API
grep -rn "createNote\|updateNote\|getNote\|listNotes\|moveNote\|deleteNote" src/

# 编辑事件路径
grep -rn "onChange\|handleDocChange\|applyExternalDoc" src/views/note/ src/drivers/text-editing-driver/

# IPC + preload
grep -rn "noteUpdate\|noteGet\|noteList" src/platform/preload/ src/shared/ipc/

# 测试用例
grep -rn "createNote\|updateNote" tests/ 2>/dev/null
```

#### B.10 启动条件 / 触发条件

- 哪些 trigger 会推动这件事真正立项？（用户报告了 N 个引用失效场景 / AI 协作功能要落地 / 多设备同步 / 等）
- 工作量初估：人天 × 模块数

### 3.3 目标 C：实施任务设计文档

**产出 3**：`docs/RefactorV2/stages/block-atomization-implementation-plan.md`

按现有 sub-phase 实施模式（参考 [decision 021 / 022](../RefactorV2/data-model/persistence/decisions/) 的实施设计模式）：

- **预条件**：必须先完成 decision 025 / 026
- **分阶段**：sub-phase X.1 PM schema 改造 / X.2 storage 拆 atom + 边 / X.3 迁移 / X.4 URL 协议演化 / X.5 兼容层 / X.6 验收
- **每阶段验收硬门槛**（EM1/2/3 模式，参考 [decision 011](../data-model/persistence/decisions/011-sub-phase-1-surrealdb-infrastructure.md) 的 EM 模式）
- **分支策略**（按 [feedback_branch_module_boundary](../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_branch_module_boundary.md)）
- **回滚预案**：每阶段如何回滚
- **测试策略**：现有 [tests/](../../tests/) 模式 + 新增哪些测试

---

## 4. 输出文件清单

| # | 文件 | 性质 |
|---|------|------|
| 1 | `docs/RefactorV2/data-model/atom/decisions/025-atom-granularity-current-form-acknowledgment.md` | 承接 v1.3 工程妥协 + 注销 decision 030 占位 |
| 2 | `docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md` | 核心决议 |
| 3 | `docs/RefactorV2/stages/block-atomization-implementation-plan.md` | 实施任务设计 |

**编号**：动手前先 `ls docs/RefactorV2/data-model/atom/decisions/` 和 `ls docs/RefactorV2/data-model/persistence/decisions/` 确认现有最大编号，自动递增。

---

## 5. 工作流要求（严格遵守）

### 5.1 阶段划分

**阶段 1：读完 §2 所有前置材料**（读完一份给用户 200 字汇报）
**阶段 2：grep §2.4 代码影响面**（拿到完整影响清单）
**阶段 3：列出每个核心议题的待决策点**（给用户 AskUserQuestion，**不替用户决定关键语义**）
**阶段 4：基于用户反馈写决议草稿**（先写 025 → 用户审阅 → 再写 026 → 用户审阅 → 再写实施计划）

**不要跳过任何阶段**。

### 5.2 用户决策点（一定要 AskUserQuestion）

以下议题**必须**让用户在选项里挑，不要默认替用户决定：

- 颗粒度边界（顶层 / 全 PM node / inline）
- 嵌套 block 是否独立 atom
- 复制 / 拆分 / 合并的 ID 语义
- 旧 URL 兼容期长度
- 迁移策略（一次性 / 惰性）
- SurrealDB 新增 block 表 vs 仍 inline

### 5.3 红线

- ❌ 不要写代码（任何 src/ 改动）
- ❌ 不要改现有 spec.md 字面（修订留到下个对话）
- ❌ 不要替用户决定语义级议题
- ❌ 不要把"我推测的方案"包装成"我的拍板"
- ❌ 不要绕过 §3 的议题清单（每条都要在决议中讨论）

---

## 6. 用户对话风格提示

- 用户偏好简洁、有事实根据的回答；避免冗长前置铺垫
- 用户会指出推测和事实的边界，**主动标注"以下是推测"**
- 用户不喜欢"我建议"的句式；倾向"事实是 X，可能性 A/B/C"
- 用户在意架构原则的一致性，不轻视小漏洞
- 用户尤其在意 spec ↔ 实施 一致性 —— 任何字面矛盾都要在决议中显式登记

---

## 7. 第一步该做

1. 读这个提示词全文（已经在做）
2. 用 TodoWrite 把任务拆成阶段 todo
3. 开始阶段 1：先读调查报告全文，给用户 200 字"我从报告看到的关键决策点"
4. 等用户确认理解一致后，继续读上游架构文档
5. **不要急着写决议草稿**——议题清单先讨论清楚

---

## 8. 完成标准

3 份文档全部写完 + 用户审阅通过 + 用户拍板"启动 / 不启动 / 延后 sub-phase X"。

实施代码留给下一个对话和独立分支。
