# L7 持久化下一阶段启动包(总指挥 + 实施者协作模板)

> **创建日期**: 2026-05-12(sub-phase 3a-1 完成 + 反向更新 10 项合 main 之后)
> **当前 V2 main HEAD**: `19b6ed6`
> **本文档目的**: 为下一次开 Claude Code 新对话(主对话 = 总指挥角色)准备启动包。包含上下文还原、推进策略选择、总指挥 + 实施者两个角色 prompt、启动检查清单。

---

## 0. 本文档的使用方式

**下次开新对话时**:

1. **你(用户)在新对话里**:粘贴 §3 "总指挥启动 prompt" 作为新主对话的第一条消息,主对话进入总指挥角色
2. **总指挥分析当前状态 + 拍板推进策略后**:你启动**第二个独立 Claude Code 对话**作为实施者
3. **实施者对话**:粘贴总指挥给的具体 sub-phase 实施 prompt(由总指挥按 §4 模板生成)
4. **协作**:你作为人肉路由,把实施者汇报粘给总指挥,把总指挥批复粘回给实施者

→ 这套协作模式已经在 sub-phase 2 / 3a-1 跑过 2 轮,熟。

---

## 1. 当前持久化进度全景(上下文还原)

### 1.1 已完成的 sub-phase

```
sub-phase 1   SurrealDB 基础设施           ✅ merge 34e3758  (sub-phase 1)
sub-phase 2   note + folder 迁移            ✅ merge 0ad60c7  (sub-phase 2)
sub-phase 3a  总纲 (decision 013)           ✅ merge 281d74b  (decision 013)
sub-phase 3a-1 graph 容器 + Instance 子决议  ✅ merge 574adfa  (decision 014)
sub-phase 3a-1 实施                         ✅ merge 67f18b2  (sub-phase 3a-1 实施)
反向更新 10 项                              ✅ merge 19b6ed6  (反向更新)
```

### 1.2 已迁到 SurrealDB 的模块(可用)

- ✅ note(笔记 — pm domain)
- ✅ folder(文件夹 — folder domain,note + graph 共享)
- ✅ graph 容器 + Instance(画板 — graph-canvas + graph-instance domain)
- ✅ pm content(view-agnostic pm atom,通过 pmContentCapability 管理)

### 1.3 未迁到 SurrealDB 的模块(走旧 localStorage / 磁盘 JSON)

- ⏳ graph 其他节点类型(sticky / connector / image — Library + ShapeDef 注册路径,未持久化形态)
- ⏳ ebook(书架 / 书 / 进度 / 书签 — 磁盘 JSON)
- ⏳ annotation(电子书标注 — 磁盘 JSON)
- ⏳ vocab(生词本 — 磁盘 JSON)
- ⏳ media(媒体文件 metadata — 磁盘 JSON,实际二进制不一定迁)
- ⏳ inspector(浮窗位置等 UI 局部状态 — localStorage)
- ⏳ workspace(workspace 框架壳 — localStorage)

### 1.4 未解的关键 Open Questions

- ~~**Q-tx**(继承 sub-phase 1):`storage.transaction()` 真原子性未解 — sub-phase 1 X3a 退化(`7d828a6`)~~ **✅ 已修 sub-phase 3a-tx**([decision 020](../data-model/persistence/decisions/020-sub-phase-3a-tx-true-atomicity.md),2026-05-13;路径 1 SDK 原生 `beginTransaction()` 真原子性 + 5 个调用站点透明受益 + binary verify 12 PASS + Checkpoint 1/2 全 PASS + 17 → 23 故障注入 PASS)
- ~~**Q-shared-folder-ux**~~ ✅ **已解决 decision 021**(sub-phase 021 folder 视图隔离完成,2026-05-13):folder atom 通过 `user:krig:folderForView` 边表达 view 归属(note + graph 各自独立 folder 树),Q7 弱保护(含资源 folder 删除前 window.confirm)+ clearAll 一次性 migration 重置数据库。详 [decision 021](../data-model/persistence/decisions/021-sub-phase-021-folder-view-isolation.md)。**Q7 字面登记**:弱处理仅含资源 folder 删除前弹框,回收站完整设计留 decision 023。**Q-shared-folder-ux 历史描述**(供追溯):note / graph / 未来 ebook **共享 folder 树**(decision 014 §2.3 字面拍板 + canvas-store.ts:756 注释),用户在 note 模式建的文件夹,在 graph 模式也可见,但**内含 note 在 graph 模式不可见**,易引发误删("看着是空文件夹,实际有 note")。根因:共享语义层 + 视图内容隔离,缺"跨视图删除保护 + 内容指示"UX。decision 021 走"数据模型层根治"路径(用户 §0.5 P0 字面拍板)。

  **用户 2026-05-13 拍板核心两点**(sub-phase 3a-tx 收尾对话末段,作为 decision 021 起点):

  1. **各视图 folder 归自己管 + 显示规则**:每个视图(note / graph / future ebook)有自己的 folder 树;显示规则:每个视图只显示自己的 folder + 自己的文档;folder 功能(样式 / 创建 / 递归删除)所有视图一致。

  2. **数据模型层解决,不是视图层补丁**:folder 作为 atom(点),通过关系(边)或属性(payload 字段)区分视图归属;具体路径(属性 vs 边)留 decision 021 实施层决定。

  **未来 decision 021 范围**(待启动新对话单独撰写):
  - 数据模型加 folder ↔ view 归属字段或边类型(技术路径属性 vs 边待拍板)
  - schema migration:现有共享 folder 数据怎么归属(待拍板)
  - 各 view `listFolders` / `listResources` 按归属过滤
  - `deleteFolder` cascade 模式 1 不变(沿 [decision 020 §7.5](../data-model/persistence/decisions/020-sub-phase-3a-tx-true-atomicity.md) 的"递归删除关联实体")
  - 视图隔离落地后,"误删跨视图 folder" 风险根除(用户根本看不到非己建 folder);但 Q7 仍含"含资源 folder 删除前弹窗 + 回收站",留 decision 021 一并讨论

  **第 13 次设计师教训**(本对话过程,2026-05-13):总指挥讨论方案 C 时反复用 "L1/L2/L3 抽象分层" 术语(语义层 / 视图层 / 关系层),但 V2 项目 L0-L7 字面是 stages 阶段命名(L0 platform / L2 shell+tabs / L3 workspace / L4 slot registry / L5 note / L7 持久化),**不是抽象层级**。术语错用会污染 KRIG 项目术语体系。**纪律升级**:使用项目术语必须 grep 实证字面,不允许从编程社区 / 训练数据带入"看起来通用"的术语;跟第 9 / 11 / 12 次教训同型("实证字面而不靠记忆")。**落点**:本教训登记在 decision 021 §0.6,反向更新 SDK-version-binding-policy §2.2 加"项目术语必须 grep 实证"作为第 5 步证据(留 decision 021 撰写时落地,不在本对话推进)。
- ~~**Q7**~~ 🟡 **部分解决 decision 021**(sub-phase 021 弱处理,2026-05-13):含资源 folder 删除前 `window.confirm` 弹框确认(`preview.resources > 0 || preview.folders > 0` 触发),3 caller R3 字面各自实施(canvas-commands.ts:102 + note-commands.ts delete-by-tree-id + tree-operations.ts:108 deleteSelected 多选逐个 confirm)。**未实施部分**:回收站(trash domain + undo)留 **decision 023** 一并讨论。详 [decision 021 §5.5](../data-model/persistence/decisions/021-sub-phase-021-folder-view-isolation.md#step-55--q7-弱保护含资源-folder-删除前弹框)。
- **Q-orphan-surreal-d-state**(sub-phase 3a-1 暴露):sub-phase 1 防御链对内核 D-state 孤儿 surreal 进程无效,只能重启 mac 根治
- **F1 audit 发现**(sub-phase 3a-1):§6.3.5 读路径自愈端到端 binary verify 未跑(代码已实施,但人为插脏边 → 自愈端到端未验证)
- ~~**noteCapability listNotes 误列 text-node pm atom**(sub-phase 3a-1 暴露)~~ **✅ 已修**([decision 016](../data-model/persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md) sub-phase 3a-2.5,note 形态从 "pm atom = note" 升级到 "pm atom + `user:krig:hasNoteView` 边 = note";binary verify §6.2.4 实证:4 个 graph text-node pm atom 字面零 hasNoteView 边 + 4 个 hasNoteView 边都指向真 note pm atom,完全互不污染)
- **P0e — canvas-text-node 编辑器首块默认 codeBlock 而非 paragraph**(2026-05-13 sub-phase 3a-2.5 binary verify 期间用户报):画板新建 text-node 编辑时,首块默认成 codeBlock 而非 paragraph,显示 `[Code 前缀`。**仅渲染降级**(数据层正确,text 字面完整保留)。**根因怀疑**:canvas-text-node / text-editing-driver 初始 schema 配置;**非 sub-phase 3a-2.5 / P0d / P0a-bis / 017 任一范围**。**处置**:留独立 hotfix(决议 020 或类似),单独起新对话
- **Q-P3 — Electron before-quit 不 await 是 land mine**([decision 017](../data-model/persistence/decisions/017-storage-persistence-hotfix.md) §9):[`platform/main/index.ts:109-111`](../../../src/platform/main/index.ts#L109) 同步 `shutdownStorageSync()`,[`storage/surreal/client.ts:260`](../../../src/storage/surreal/client.ts#L260) 300ms `setTimeout` SIGKILL 在主进程退出后实际不执行;`db.close()` 不 await。小数据量实测 graceful Cmd+Q 后跨重启完整保留(RocksDB SIGTERM 默认 fsync WAL,300ms 够),但**写量大 + macOS launchd 立刻收割** 时可能踩。修法方向:`before-quit` 改 `event.preventDefault()` + await + `app.quit()`,或 `serverProcess.unref()`,或等 embedded 模式
- ~~**P0d — text-node pm content 被空 doc 覆盖跨重启丢文字**(sub-phase 3a-1 范围,2026-05-13 binary verify 期间新发现)~~ **✅ 已修**([decision 018](../data-model/persistence/decisions/018-canvas-text-node-doc-sync-hotfix.md),4 处形态对齐 + binary verify 场景 ① 三层实证 PASS;canvas-store `incomingDocToPmPayload` / `instanceAtomToObject` 两端识别 DriverSerialized 信封 + `InteractionController` 新建初始化空 DriverSerialized + types.ts TextNodeAtoms unknown[] → unknown 类型契约对齐)
- ~~**P0a-bis — sub-phase 3a-1 inCanvas cardinality 漏机制**(2026-05-13 binary verify 期间用户截图实证)~~ **✅ 已修**([decision 019](../data-model/persistence/decisions/019-graph-instance-cardinality-hotfix.md),三层防线 K1-K7 + binary verify 4 场景 PASS;view 端 client id 走 ULID + store 守门 + storage 启动 self-check + inCanvas 升级归属边语义)
- **Q-2 inFolder cardinality self-check 扩展**(P0a-bis decision 019 §9 留位):decision 014 line 704 字面 inFolder 一对一约束,但 P0a-bis cardinality-check 仅扫 inCanvas + hasContent(超范围)。触发条件:发现 inFolder 撞库 bug 实证或 sub-phase 3b ebook 接入触发新归属场景。实施成本:[`src/storage/health/cardinality-check.ts`](../../../src/storage/health/cardinality-check.ts) `CARDINALITY_ONE_PREDICATES` 加一行 `'user:krig:inFolder'`

### 1.5 设计师纪律累积教训(必须遵守,详 decision 013 §0.5)

| 次 | sub-phase | P1 教训类型 |
|---|---|---|
| 1 | sub-phase 2 | 没核 V2 capability 在哪个进程 |
| 2 | decision 013 | 没核 SurrealDB schema 约束 |
| 3 | decision 014 前 | 没核 folder 模块导出 + 进程边界 |
| 4 | decision 014 实施期 | 没核 sub-phase 2 deleteFolder cascade scope |
| 5 | decision 014 实施期 | 没核 AtomEntity 字段集 + normalizer |
| 6 | decision 014 §3.5.3 / canvas-store.createInstance | 设计 "view 端预生成 client id 推给 storage" 模式时,没核 sub-phase 1 putAtom 契约支不支持;字面注释"storage putAtom 允许传 id"是设计师一厢情愿,实际 UPDATE-only(由 [decision 017](../data-model/persistence/decisions/017-storage-persistence-hotfix.md) 改 UPSERT 修复)|
| 7 | decision 014 §3.3 line 388 cardinality | 决议字面拍板"inCanvas cardinality 一对一",但实施 view + store + storage 三层全部漏机制保证;P0a UPSERT 修法揭露(由 [decision 019](../data-model/persistence/decisions/019-graph-instance-cardinality-hotfix.md) 三层防线补完)|
| 8 | decision 014 §3.4 pmContentCapability / canvas-store text-node helper | sub-phase 3a-1 写决议时没核实 view 端 driver 演化路径;view 端 DriverSerialized 信封透传契约与 canvas-store helper 函数(`incomingDocToPmPayload` / `instanceAtomToObject`)字面期望旧 PmPayload 数组形态错位 → 写空 doc → 重启丢文字(由 [decision 018](../data-model/persistence/decisions/018-canvas-text-node-doc-sync-hotfix.md) 4 处形态对齐修复)|
| 14 | decision 021 §0.6 | 启动包 / 总纲文档字面"X / Y / 未来 Z 共享 ABC"混述现状 vs 未来计划,grep verify 后才知 ebook 现状是独立 JSON 树未接 atom(由 decision 021 §0.6 登记)|
| 15 | decision 021 §0.7 | 决议字面假设 `storage.clearAll()` API 存在 + `EdgeFilter` 支持 objectLiteralValue,自审 grep 命中两项均不存在;LiteralValue 字面三字段 `{kind, type, value}` 决议初版漏 type 字段(由 decision 021 §0.7 登记)|
| 16 | decision 021 §10.B-1 / §11.3 | 决议 §0.4 grep verify 接口签名变更时只 grep `listFolders` 漏 `createFolder`(同样改签名),Step 5.2 typecheck 实跑 7 TS2554 而非预期 4(由 decision 021 §11.3 登记)|
| 17 | decision 021 §10.B-2 / §11.4 | 决议字面拍板 caller / capability / IPC 直接传播路径但完全没考虑 broadcast / useAllFolders hook 等间接传播,Step 5.3 实施期不得不临时拍板"方案 C 按 view 分别广播 2 次 + hook 加 viewType 入参"(由 decision 021 §11.4 登记)|
| 18 | decision 021 §10.C-1 / §11.5 | 决议 §1.1 字面拍板 `FolderViewType` 归 capability 层但 V2 既有 `FolderInfo` SSOT 在 shared/ipc 层 + W5 lint 禁止 shared/ipc 反向 import @capabilities/,Step 5.4 触发 lint error(由 decision 021 §11.5 登记)|
| 19 | decision 021 §10.B-3 / §11.6 | 决议字面"既有 5 API 签名不动"字面写死 = N,Step 5.5 Q7 实施需新增 `previewDeleteFolder` 8th API,字面叙述前瞻性不足(由 decision 021 §11.6 登记)|
| 20 | decision 021 §10.C-2 / §11.7 | 决议字面"跨 2 view UI 复用"语义不明(UX 一致 vs 代码共用 helper),实施期按"代码复用"实施触发 V2 W5 + @views/* + lib/ 3 层 lint 禁止,3 caller R3 重复实施成唯一字面合规路径(由 decision 021 §11.7 登记)|

**纪律**:
- 涉及"已实施模块自动支持新需求"假设 → 必须 grep 代码字面行为验证
- 加 schema field 时 → 三层同步(schema DEFINE / entity 接口 / normalizer)
- 决议预设 checkpoint binary verify 模型(非每 step 单独 verify)
- "不动已完成模块" 本意 = "不改对外契约 + atom CRUD 语义",允许向后兼容字段扩展
- **拍板 cardinality 约束时 → 三层防线必须同步登记落地点**(view 端 id 全局唯一 + store putEdge 守门 + storage 启动 self-check),不是只写"cardinality: 一对一"一行(详 [decision 019 §2.1-§2.3](../data-model/persistence/decisions/019-graph-instance-cardinality-hotfix.md))
- **跨层透传契约(view ↔ capability ↔ storage)必须拍板字面登记两端形态**;实施期间形态变更 → decision 必须同步反向更新;读写两端 helper 函数必须 grep 实证两端形态一致(详 [decision 014 §12.12](../data-model/persistence/decisions/014-sub-phase-3a-1-graph-canvas-instance-migration.md))

### 1.6 实施者纪律累积教训(必须遵守,详 memory `feedback_v2_is_workspace_v1_is_reference`)

**cwd 漂移事故已发生 4 次**:
- git push 错仓库
- npm install 装到 V1
- npm start & 启 V1(复合命令陷阱)
- decision 017 hotfix 排查期 `git checkout main && git checkout -b ...` 链断 cwd 漂移到 V1(zsh 默认 cwd 在 V1,前一条 `cd V2 &&` 已被前次命令终止;补救:每条 Bash 调用独立 `cd V2 &&` 前缀,不依赖 session cwd)

**纪律**:
- 任何 Bash 调用前 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&` 显式指定
- 复合命令(`&` / `>` / pipe / heredoc / chain)前 `cd` 一定要在 `&&` 最前
- 不确定时先 `pwd`

**完成报告字面纪律(2026-05-13 sub-phase 021 Step 5.8 总指挥审计触发第 21 次教训追加,详 [decision 021 §11.8](../data-model/persistence/decisions/021-sub-phase-021-folder-view-isolation.md))**:
- **完成报告字面 "X commit" 必须 `git log feature ^main` 字面 verify**(沿"严格 cd"同型字面纪律,本次扩展到"严格 git log verify")
- **完成报告字面跨段一致性自校验**:首段总述 / table 矩阵 / 完成判据 / 偏离汇总字面**字面互相核对**,任一段修订时其他段字面同步
- 字面 commit 数 mismatch 必须**字面立即纠正**,不等总指挥审计发现
- 跟决议 020 §11.4 第 11 次教训"决议字面 grep verify 双向核对"同型升级 — "双向核对"模式扩展

---

## 2. 下阶段推进策略 — 修改版 Y(总指挥已拍板)

按主对话 2026-05-12 末尾分析,下阶段不追求"全 9 store 迁完",而是推**3 个最关键 sub-phase**让 KRIG 三大核心模块的知识闭环真正打通,预估 1 周:

### 2.1 推进计划

| 顺序 | sub-phase | 内容 | 工程量 | 触发 |
|---|---|---|---|---|
| ~~**1**~~ | ~~**sub-phase 3a-2.5**(note 形态升级)~~ **✅ 已完成**(2026-05-13,[decision 016](../data-model/persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md))| 加 `krig:hasNoteView` 边 → noteCapability 走"pm atom + hasNoteView 边"模型,修 `listNotes` 误列 graph text-node pm atom 风险 | 0.5-1 天(实际)| 当前已暴露 bug,binary verify 8 场景全过 |
| **2** | **sub-phase 3a-tx**(真原子性)| 评估 surrealdb-js 3.x SDK 原生 transaction API,或应用层补偿模式,解 Q-tx;前置 sub-phase 3a-shared-ref | 1-2 天 | 系统稳定性基础 |
| **3** | **sub-phase 3b**(ebook + annotation 迁移)| ebook 书架 / 进度 / 书签 / 标注 迁 SurrealDB,接 atom/edge 体系,让"阅读 → 笔记"知识闭环数据互通 | 2-3 天 | KRIG 三大核心模块共享 atom |

### 2.2 推完后状态

KRIG 三大核心模块(note / graph / ebook + annotation)全在 SurrealDB,**vision.md §2.4 知识图谱闭环的数据基础已完成**。

剩余 sub-phase(sticky / connector / vocab / media / inspector / workspace)作为**已知架构债登记**,留**业务真需要时再触发**(例如要做"画板加连线"功能时启动 connector 持久化 sub-phase)。

### 2.3 暂不推的 sub-phase + 理由

| sub-phase | 推迟理由 |
|---|---|
| 3a-2 sticky 节点 | sticky 业务功能可用(走旧路径),不影响 vision 闭环 |
| 3a-3 connector 连接线 | 同上,且 connector 涉及新边类型 `krig:connects`,设计需要预留 |
| 3a-4 image / media node | 走旧 media 路径,无功能阻碍 |
| 3a-shared-ref(浅引用)| 依赖 sub-phase 3a-tx 解 Q-tx,且单引用模式已经满足 sub-phase 3a-1 业务 |
| 4-x(vocab / media / inspector / workspace)| 辅助性 store,不接 atom/edge 不影响 vision |

---

## 3. 总指挥启动 prompt(新对话第一条消息)

```
你现在进入 KRIG-Note V2 持久化推进项目的"总指挥"角色(主对话身份,设计 + 审计 + 决策三位一体)。

## 项目背景

KRIG-Note V2 是知识管理 + 知识图谱工具的重构版本,目标是 vision.md §2.4 描述的"知识图谱(机器)↔ KR图(人)双向闭环"。当前正在推进持久化迁移(分多个 sub-phase),把原来散在 9 个独立 store(localStorage + 磁盘 JSON)的数据统一到 SurrealDB + atom/edge 体系。

## 当前进度

已完成:sub-phase 1(SurrealDB 基础设施)/ sub-phase 2(note + folder)/ sub-phase 3a-1(graph 容器 + Instance + pmContentCapability)/ 多轮决议(011 / 012 / 013 / 014)/ 反向更新 10 项。

V2 main HEAD: 19b6ed6(请用 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && git log --oneline -5` 验证)

## 接下来要做

按上一轮主对话拍板的"修改版 Y"策略,推 3 个最关键 sub-phase 让 KRIG 三大核心模块(note / graph / ebook)的知识闭环真正打通:

1. **sub-phase 3a-2.5**(note 形态升级 + hasNoteView 边)— 修当前已暴露的 noteCapability listNotes 误列 text-node pm atom 风险
2. **sub-phase 3a-tx**(真原子性)— 评估 surrealdb-js 3.x SDK 原生 transaction API,或应用层补偿模式,前置 sub-phase 3a-shared-ref
3. **sub-phase 3b**(ebook + annotation 迁移)— 让"阅读 → 笔记"闭环数据互通

完成后,KRIG 三大核心模块全在 SurrealDB,vision 闭环目标的数据基础完成。剩余 sub-phase(sticky / connector / vocab / media / inspector / workspace)作为已知架构债,留业务真需要时再触发。

## 启动包必读文档

请先读以下文档建立完整上下文:

1. **本对话上下文文档**(必读):
   - `docs/RefactorV2/notes/L7-next-phase-kickoff.md`(本启动包,含本 prompt + 实施者 prompt 模板 + 启动检查清单)

2. **设计师纪律 + 累积教训**(必读):
   - `docs/RefactorV2/data-model/persistence/decisions/013-sub-phase-3a-graph-canvas-migration.md` §0.5(5 次 P1 教训累积纪律)
   - `docs/RefactorV2/data-model/persistence/decisions/014-sub-phase-3a-1-graph-canvas-instance-migration.md` §12(实施实际情况 + 偏离登记 + 事故 + 教训)
   - User memory `feedback_v2_is_workspace_v1_is_reference`(cwd 漂移事故 3 次纪律)

3. **路径相关决议**(按推进顺序选读):
   - sub-phase 3a-2.5 启动前 → 读 decision 013 §5(note 形态升级路径)
   - sub-phase 3a-tx 启动前 → 读 decision 011 §12(transaction 真原子性 X3a 退化历史)+ decision 013 §3.5.1.bis
   - sub-phase 3b 启动前 → 扫现状 `src/views/ebook/` + `src/platform/main/ebook/` + 现有磁盘 JSON

4. **总规范基线**(随时查阅):
   - `docs/RefactorV2/data-model/atom/spec.md`(atom domain 体系)
   - `docs/RefactorV2/data-model/relations/spec.md`(边一等公民 + krig vocab 登记表 §10)
   - `docs/RefactorV2/data-model/persistence/decisions/008-storage-layer-interface.md`(view/capability/storage 调用边界)
   - `docs/RefactorV2/data-model/persistence/decisions/009-migration-strategy.md`(sub-phase 拆分进度)

## 你的工作纪律

### 设计师纪律(写决议前必做)

1. **不假设"已实施模块自动支持新需求"**:任何"x 走已实施的 y 自然支持"假设,grep 验证已实施代码字面行为
2. **加 schema field 三层同步**:schema DEFINE / entity 接口 / normalizer 都要核
3. **决议预设 checkpoint binary verify 模型**:非每 step 单独 verify
4. **"不动已完成模块" 实质 = 不改对外契约**,允许向后兼容字段扩展

### 审计师纪律(实施者完成报告时必做)

1. typecheck + lint 复核(主对话独立跑,不只信实施者报告)
2. grep view 层不直连 storage
3. grep 域注册 4 步闭环
4. main 进程不能用 renderer 的 `requireCapabilityApi`
5. UI 集成测试清单交给用户跑,反馈后判断通过/补丁

### cwd 严格纪律(所有 Bash 调用)

- 任何 Bash 命令前 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&` 显式指定
- 复合命令(& / > / pipe / heredoc / chain)前 cd 一定在 && 最前
- 不确定时先 pwd
- 已有 3 次 cwd 漂移事故,不要侥幸

### 用户协作纪律

- 破坏性操作(merge / push / 删分支 / 改环境)前必须用户显式确认
- 用户拍板"M / MP / N" 等格式精确传达选项

## 启动第一步

请先做以下事:

1. 读 `docs/RefactorV2/notes/L7-next-phase-kickoff.md`(本启动包)
2. 读 decision 013 §0.5 + decision 014 §12(累积纪律)
3. 用 git log 确认 V2 main HEAD 是 19b6ed6
4. 问用户:"启动包已读,确认推进策略 = 修改版 Y(3 个 sub-phase),从 sub-phase 3a-2.5 起。第一步:写 decision 016 sub-phase 3a-2.5 子决议草稿。开始?"

等用户确认后,启动 decision 016 撰写流程。
```

---

## 4. 实施者启动 prompt 模板(每个 sub-phase 实施时由总指挥定制)

下面是**模板骨架**,总指挥在每个 sub-phase 实施启动时按本模板填空给实施者:

```
你是 KRIG-Note V2 项目 sub-phase {{X}} 的实施者。

## 任务

按 `docs/RefactorV2/data-model/persistence/decisions/{{XXX-decision-filename}}.md` 决议文档执行 {{sub-phase 简述}}。

## 关键约束(决议 §0.2 必读)

1. **工作目录**: `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
   - ⚠ 不是 `/Users/wenwu/Documents/VPN-Server/KRIG-Note`(那是 V1,只做参考,不修改)
   - 所有 Bash 命令前 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&` 显式指定 cwd
   - 涉及 git / npm / find / rm 等 cwd 敏感命令尤其要小心(已 3 次事故,memory `feedback_v2_is_workspace_v1_is_reference`)
   - 复合命令(& / > / pipe / heredoc)前 cd 一定要在 && 最前

2. **分支**: 创建并停留在 `feature/L7-sub{{X}}-{{shortname}}`,不合 main(合并由总指挥决定)

3. **每完成一个 §5 步骤 commit 一次**,commit message 按决议示例格式

4. **任何偏离决议 / SurrealDB 行为不符预期 / 发现额外消费点 / 重大架构选择 → 停下汇报**,等总指挥批复后再继续

5. **进程边界**:
   - main 进程文件不能调 `requireCapabilityApi()`(那是 renderer 侧)
   - main 进程同 capability 直调走 `import { ... } from '@platform/main/{{module}}'` 这种 barrel

6. **{{sub-phase 特定约束}}**:
   - {{比如:单引用约束 / hasBeenReferenced 兜底 / 等}}

7. **不动其他已完成模块**:
   - `src/capabilities/note/` / `src/capabilities/folder/` / `src/capabilities/graph-library-store/` / `src/capabilities/pm-content/` / `src/storage/` 一律不动
   - 允许通过 barrel 消费它们的对外 API,**禁止修改内部实施 + 对外契约**
   - 例外:决议显式说明的"必要向后兼容扩展"(类似 sub-phase 3a-1 加 hasBeenReferenced 模式)允许,但需 commit message 显式登记 + 等总指挥反向更新清单

8. **不动 view 渲染逻辑**:
   - `src/views/{{relevant}}/` view 透明
   - 渲染层 / 编辑器 capability 不动

## 起步

读完决议 §0 + §1 + §3 后,从 §5 Step 5.0 开始({{V2 现状 verify}}),确认实际目录结构跟决议 §1.2 一致后再开始 Step 5.1。

每完成 §5 一个步骤,commit 后报告进度:"Step 5.X 完成,commit XXXX,下一步进入 Step 5.Y"。

## 完成判据

所有 §5 步骤完成 + §6 测试清单通过 → 报告 "L7-sub{{X}}-{{shortname}} 实施完成请审计",等总指挥审计 + 合并。

## 总指挥协作模式

总指挥(主对话)负责:
- 设计 / 决议 / 复审 / 审计 / UI 集成测试反馈
- 合 main / push / 反向更新决议

你(实施者)负责:
- 严格按决议执行
- 停下汇报关键决策点
- 提供完整测试报告

开工前先报告:
"已读完决议 {{XXX}},准备启动。下一步 Step 5.0 V2 现状 verify。"

等总指挥确认后开始。
```

---

## 5. 启动检查清单(总指挥新对话首次启动时跑一遍)

### 5.1 环境确认

```bash
# 1. 当前 V2 main HEAD 是否 19b6ed6
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && git log --oneline -5

# 2. 工作区是否干净
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && git status

# 3. typecheck + lint 起点是否通过
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx eslint src/ 2>&1 | tail -5

# 4. 没有 D-state 孤儿 surreal 进程
ps aux | grep surreal | grep -v grep
# 期望:只有 V1 的 8532 端口 surreal,没有 V2 的 8533 D-state 孤儿
# 如有 8533 孤儿:让用户重启 mac
```

### 5.2 文档基线确认

```bash
# 必读文档存在
ls docs/RefactorV2/notes/L7-next-phase-kickoff.md
ls docs/RefactorV2/data-model/persistence/decisions/013-sub-phase-3a-graph-canvas-migration.md
ls docs/RefactorV2/data-model/persistence/decisions/014-sub-phase-3a-1-graph-canvas-instance-migration.md
```

### 5.3 用户对齐

确认推进策略:
- 修改版 Y(推 3 个 sub-phase: 3a-2.5 / 3a-tx / 3b)
- 还是其他?

如用户确认,启动 sub-phase 3a-2.5 (decision 016) 撰写。

---

## 6. 三个 sub-phase 各自的设计提示

### 6.1 sub-phase 3a-2.5 — note 形态升级(decision 016)

**核心目标**: 加 `krig:hasNoteView` 边 + noteCapability 改用"pm atom + hasNoteView"模型,修 listNotes 误列 text-node pm atom 风险。

**设计要点**:
- 引入新边类型 `user:krig:hasNoteView`(subject = pm atom,object = literal marker '__note-view__' 或 marker atom — 二选一,参 decision 013 §5.3 路线 A vs B)
- migration:给所有 sub-phase 2 创建的 pm atom 加一条 hasNoteView 边(幂等)
- noteCapability.listNotes 改成"查 hasNoteView 边 → 拉 pm atom"
- noteCapability.createNote 同步加 hasNoteView 边
- noteCapability.deleteNote 走 hasBeenReferenced 契约(草稿 cascade,流通仅断 hasNoteView 边)
- 反向更新 decision 012 §12 标"已升级"

**风险**:
- migration 影响所有现有 note(虽然只是加一条边)
- 跟 graph text-node pm atom 在 listNotes 隔离的边界要明确
- hasNoteView 边的"幂等性":同一 pm atom 不应有 2+ 条 hasNoteView 边

**预估工程量**: 0.5-1 天 + 1 个 binary verify checkpoint(单 schema migration + 1 套 IPC verify)

### 6.2 sub-phase 3a-tx — 真原子性(decision 017)

**核心目标**: 解 Q-tx,把 sub-phase 1 X3a 退化的 transaction 改回真原子性。

**设计要点(待 verify)**:
- 候选路径 1:`surrealdb-js` 3.x SDK 是否有原生 transaction API(实施者首先 verify)
- 候选路径 2:应用层补偿模式(记录已做操作 → 失败时反向)
- 候选路径 3:单点串行更新器(队列化所有写操作)

**风险**:
- 改 transaction 实施会影响所有 capability(note / folder / graph-library-store / pm-content),回归测试范围广
- SurrealDB 3.0.4 binary 行为可能跟 SDK 文档不一致(决议必须 binary verify)
- 改动小但回归大,需要细心测试每个已迁 capability 的事务路径

**预估工程量**: 1-2 天 + 2 个 checkpoint(transaction 单元 verify + 全 capability 回归 verify)

### 6.3 sub-phase 3b — ebook + annotation 迁移(decision 018)

**核心目标**: ebook(书架 + 进度 + 书签 + 标注)迁 SurrealDB,接 atom/edge 体系,让 ebook 跟 note / graph 共享 atom 模型。

**设计要点(待 V2 现状梳理后定)**:
- 新 atom domain:`ebook`(书条目)+ `ebook-bookmark`(书签 — 可能与 annotation 合并)+ `ebook-annotation`(标注 / 高亮)— **形态待梳理后定**
- 边类型:
  - `user:krig:inFolder`(书归属 folder,跟 note + graph 共享)
  - `user:krig:annotates`(标注 → ebook atom,新边类型)
  - 可能的 `user:krig:cites`(笔记引用 ebook 段落,知识闭环关键)
- 改造 `src/capabilities/ebook-library/`(类比 graph-library-store 改造)
- 启动时清旧磁盘 JSON(`~/Library/Application Support/KRIG Note V2/krig-data/ebook/`)

**风险**:
- ebook 数据形态复杂(PDF / EPUB / 等格式各异),metadata schema 设计是关键
- annotation 跟 ebook 的关系(annotation 是 ebook 的子节点 / 独立 atom?)需要拍板
- ebook 二进制文件(PDF 本体)是否迁 SurrealDB?(推荐:metadata 迁 SurrealDB,文件留磁盘,通过 ebook atom 引用)

**预估工程量**: 2-3 天 + 3 个 checkpoint(schema + book CRUD + annotation 链路)

---

## 7. 协作模式回顾(已跑过 2 轮,熟)

```
┌────────────────────────────────┐
│ 用户(人肉路由 + 决策最终拍板)   │
└────────┬─────────────┬─────────┘
         │             │
         ↓             ↓
┌─────────────┐   ┌─────────────┐
│ 总指挥对话    │   │ 实施者对话    │
│ (主)        │ ← │ (独立 session)│
│             │ → │             │
│ - 写决议     │   │ - 严格按决议  │
│ - 复审拍板   │   │   实施代码    │
│ - 审计      │   │ - 每 step commit│
│ - 反向更新   │   │ - 停下汇报    │
│ - 合 main   │   │ - 完成报告    │
└─────────────┘   └─────────────┘
```

每个 sub-phase 的完整闭环:

```
1. 总指挥:撰写决议 0XX(独立分支)
2. 总指挥:用户复审(多轮 P1/P2 修订)
3. 总指挥:用户授权合 main → push
4. 用户:启动新实施者 session,粘贴实施者 prompt(本文档 §4 模板)
5. 实施者:开工前确认报告 → 用户转告总指挥
6. 总指挥:批准 → 用户转告实施者
7. 实施者:按 §5 steps 推进,每 step commit
8. 实施者:遇关键决策 → 停下汇报 → 用户转给总指挥
9. 总指挥:批复 → 用户转回
10. 实施者:全部完成 → 报告 "请审计"
11. 总指挥:静态校验 + 实施细节审计
12. 用户:跑 §6.2 UI 集成测试 → 反馈给总指挥
13. 总指挥:通过则用户授权合 main + push
14. 总指挥:反向更新所有上下游决议链
15. 进入下一个 sub-phase
```

---

## 8. 应急情况处置

### 8.1 D-state 孤儿 surreal 进程

如启动前发现 8533 端口有 D-state(UE)的 surreal 进程:
- `pkill -f 'surreal.*8533'` 对 D-state **无效**(SIGKILL 不响应)
- **唯一根治** = 重启 mac
- 用户必须协助重启,工作前保存所有文件
- 不能绕过(走"独立 node 脚本"会偏离决议 + 留临时文件风险)

### 8.2 cwd 漂移

如实施者在 Bash 跑漏了 cd:
- 立即停下汇报
- 主对话核 V1 状态是否干净(git status / branch / log / lsof)
- 如 V1 无损害 → 继续在 V2 重做漏的步骤
- 如 V1 有损害 → 用户决定回滚 V1

### 8.3 决议字面 vs 现状冲突

如实施者发现决议字面跟 V2 现状不符:
- 立即停下汇报,**不自行决定**
- 总指挥按"先核实现状 + 再批复修订"流程(吸取第 5 次 P1 教训)
- 决议修订内容反向更新到决议 §12 偏离登记

---

## 9. 完成判据(整个修改版 Y 推完后)

- ✅ sub-phase 3a-2.5 合 main + push
- ✅ sub-phase 3a-tx 合 main + push,Q-tx 解决
- ✅ sub-phase 3b 合 main + push
- ✅ 所有上下游决议反向更新
- ✅ V2 跑通"创建 note + 创建 ebook 标注 + 笔记里引用 ebook 段落 + 重启 + 数据保留 + 跨视图查询 'X 在哪些地方被引用了'"完整闭环 UX
- ✅ atom domain 列表:`pm / folder / graph-canvas / graph-instance / ebook / ebook-annotation / 等`(具体由 3b 决议拍板)
- ✅ krig vocab 边类型登记:`inFolder / inCanvas / hasContent / hasNoteView / annotates / 等`

→ KRIG 三大核心模块(note / graph / ebook)的知识闭环数据基础完成。vision §2.4 目标达成 60-70%。剩余 30-40%(graph 节点类型多样化 + 协作 + AI 推断 + 跨模块复杂查询)留后续 Phase 推进。

---

## 10. 后续(超出本启动包范围)

修改版 Y 完成后,可能的后续 phase(留**业务需要时再触发**,不预先规划):

- **sub-phase 3a-shared-ref**:浅引用 / 跨 view 复用(Q-tx 已解后启动)
- **sub-phase 3a-X**(sticky / connector / image 节点):graph 节点类型多样化
- **sub-phase 4**:剩余 stores(vocab / media / inspector / workspace)迁 SurrealDB
- **sub-phase 5+**:协作 / 实时同步 / AI 推断边 / 跨模块查询语言 / 等(进入新 Phase)

---

*本启动包版本结束。下次新对话开启时,粘贴本文档 §3 总指挥启动 prompt 即可。*
