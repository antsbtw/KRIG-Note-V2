# SDK 版本绑定纪律(项目级永久规则)

> **状态**: 🟢 永久生效
> **首次制定**: 2026-05-13(由 decision 020 sub-phase 3a-tx 首次拍板,见 §0.5)
> **制定者**: 用户 P0 拍板 + 总指挥落地
> **生效范围**: KRIG-Note V2 所有外部 SDK 依赖的版本选型决策
> **修订流程**(两类区分,详 §7):
> - **规则正文(§1 - §3 / §5)修订**:**必须**独立决议 + 用户授权,不允许在业务决议内"顺带改"
> - **§4 锁定版本登记表更新**:**允许**在"显式声明 SDK 版本变更 / 新增绑定"的业务决议内进行(典型场景:某 sub-phase 锁定新 SDK / 升级 SDK patch / 跨 major 升级 sub-phase),需在该决议 §8 反向更新清单明确登记本表更新

---

## 1. 适用范围

所有 KRIG-Note V2 引入的外部 SDK / 库依赖的版本选型决策,包括但不限于:

- **数据库**:surrealdb / 未来的 sqlite / 等
- **桌面壳**:electron
- **编辑器**:prosemirror-* / codemirror / 等
- **图形 / 三维**:three / 等
- **AI**:@anthropic-ai/sdk / openai / 等
- **构建链**:vite / typescript / esbuild / 等
- **核心运行时依赖**:react / zustand / 等

---

## 2. 核心规则(硬性)

### 2.1 SDK 版本选定后绑定发布包

- 任何 SDK 主版本号(major)选定后,**绑定到 KRIG-Note 发布包**
- 跨大版本(major)升级**必须**走独立 sub-phase,**不允许**在其他业务决议内"顺带升级"
- 同 major 内的 minor / patch 升级允许在常规依赖更新流程内进行(走依赖维护 sub-phase 或独立 patch commit,记录在 commit message)

### 2.2 拍板"用 SDK X 版本的某 API"前必须 grep 字面证据

- 涉及 SDK API 选型的决议,撰写时**必须**满足以下四步证据:
  1. **实证当前锁定版本**:`grep "<sdk-name>" package.json`(或读 lockfile / `npm ls <sdk-name>`)
  2. **实证 API 字面存在于该版本的类型定义**(以下任选一种,以已安装依赖的实际 types 入口为准):
     - 读 `node_modules/<sdk>/package.json` 的 `"types"` / `"typings"` / `"exports": { ... "types": ... }` 字段,定位实际 `.d.ts` 入口,再 grep 目标 API
     - 用 IDE / `tsc --traceResolution` 查看 TS 实际解析到的类型文件,grep 目标 API
     - `find node_modules/<sdk> -name '*.d.ts' | xargs grep "<api-name>"` 兜底全扫(适用于无 dist / 类型在根目录的 SDK)
     - 若 SDK 无类型定义(JS-only):必须读源码 `.js` 字面实证,**禁止只看 `@types/<sdk>` 第三方类型**(可能与实际行为不一致)
  3. **行为 / 边缘语义实证**(若决议涉及):必须 binary verify,参 decision 020 §3.5 模式;不只信类型声明,不只信公开文档
  4. **API 可执行链路实证**(若决议字面要求"verify 脚本直接 import 项目内模块"调 SDK API,2026-05-13 v1.2 新增,见 [decision 020 §11.5 第 12 次教训](decisions/020-sub-phase-3a-tx-true-atomicity.md)):必须 `grep -A 5 "^import" <目标模块>` 跟踪 import 链到底层依赖,实证 verify 脚本运行上下文兼容(typical:纯 node 脚本 vs electron renderer / main vs worker / DOM env)
     - 若 import 链含 electron / `window` / DOM / app context / IPC 等运行时上下文依赖,verify 脚本必须**重新设计**(stub / 解耦 / 字面 copy 改造主体),不能字面"直接 import"
     - 反例(decision 020 §10.B-2):storage.ts → client.ts → `import { app } from 'electron'`,纯 node 脚本 import 失败,改 import 解耦模块 `transaction-helpers.ts`
  8. **V2 完整传播层 6 层 grep 前瞻验证**(2026-05-13 v1.4 新增,见 [decision 021 §0.5.ter](decisions/021-sub-phase-021-folder-view-isolation.md#05ter-用户-p0-授权step-57-顺手改-sdk-version-binding-policymd-22-第-8-步--6-修订记录-v142026-05-13-实施期反向更新)):决议字面拍板涉及"新类型字面归属 / 接口签名变更 / 跨层复用方案 / API 不变约束 / 跨 view 资源复用"任一时,必须**前瞻 grep V2 完整传播层 6 层清单**:
     1. **view caller 真消费点**(grep API 在 src/views/ 全部使用位置;**对每个签名变更 API 独立 grep**,不要只 grep 主要 API — decision 021 §10.B-1 教训 16)
     2. **capability types.ts 接口**(@capabilities/<id>/types.ts 字面 API 列表 + 字段)
     3. **capability index.ts renderer 入口**(@capabilities/<id>/index.ts 字面 export)
     4. **IPC channel + preload + electron-api.d.ts**(channel-names.ts 字面 channel id + preload 桥 + d.ts 接口签名)
     5. **分层 lint 规则 eslint.config.js**(no-restricted-imports patterns 字面,verify 新增 import 字面合规 — decision 021 §10.C-1 / §10.C-2 教训 18/20)
     6. **V2 既有同类型 SSOT 位置**(grep 同类业务类型字面位置,如 FolderInfo / NoteInfo / PmAtomInfo 都在 shared/ipc/ — decision 021 §10.C-1 教训 18)
     - **间接传播路径**(2026-05-13 v1.4 强化,见 decision 021 §10.B-2 教训 17):接口签名变更必须额外 grep "间接被调"位置(broadcast / 订阅 / hook / hook caller — `broadcastXListChanged` / `useAllX` / `subscribe` / `onListChanged`),不能假设"既有路径会自动兼容新签名"
     - **API 总数描述前瞻**(2026-05-13 v1.4 强化,见 decision 021 §10.B-3 教训 19):决议字面对 API 总数描述不能字面写死"= N",必须**"既有 N API 签名不动" + "新增 API 允许(但必须 §10 偏离登记)"** 字面措辞
     - **"跨 X 复用"语义明示**(2026-05-13 v1.4 强化,见 decision 021 §10.C-2 教训 20):决议字面拍板"跨 view 复用 / 跨层 helper"时必须明示是"UX 一致(走重复实施模式)"还是"代码共用 helper 函数(走 lib/ + 字面登记新跨层依赖)",不能字面歧义
- **不允许**靠模糊记忆 / 公开文档 / 上版本经验 / 训练数据假设拍板 SDK API
- 教训来源:[decision 020 §0.6 第 9 次设计师教训](decisions/020-sub-phase-3a-tx-true-atomicity.md) + [decision 020 §11.5 第 12 次教训](decisions/020-sub-phase-3a-tx-true-atomicity.md) + [decision 021 §11.3-§11.7 第 16-20 次教训](decisions/021-sub-phase-021-folder-view-isolation.md#113-第-16-次设计师教训决议-grep-自审必须对每个变更-api-独立-grep10b-1-触发)

### 2.3 实施期间不得擅自升级 SDK 主版本

- 实施者在 sub-phase 实施期间发现 SDK 行为不符预期时,**必须停下汇报**
- 不得自行决定"换一个版本试试"或"我先升级 SDK 跑一下"
- 总指挥拍板是否需要新独立 sub-phase 升级 SDK

### 2.4 跨大版本升级流程

跨 major 升级触发条件(任一即可):
- 当前版本有 SDK 字面 / binary 行为致命 bug,无 patch 修复
- 当前版本不再被上游维护(EOL)
- 新版本引入业务必需的新 API,无可行替代

跨大版本升级流程:
1. **独立决议**(decision XXX-sdk-name-major-upgrade)
2. **完整回归 verify**(本 sub-phase 同等深度,所有依赖该 SDK 的 capability + storage + 工具链)
3. **重打发布包测试**(打包后实跑,不只 dev 验证)
4. **反向更新**所有依赖该 SDK 的决议字面 + 本文档 §4 锁定版本表

---

## 3. 设计师 / 实施者纪律(操作层)

### 3.1 设计师(决议撰写期)

- 撰写决议前必须 grep 当前依赖版本 + 拍板 API 字面证据
- 决议字面**必须**登记本决议涉及的 SDK 版本依赖(例 decision 020 §0.5 / §4.4)
- 决议 §8 反向更新清单必须含本文档 §4 锁定版本表更新

### 3.2 实施者(实施期)

- Step 5.0 / 5.1 现状 verify 步骤必须复跑设计师的 grep(独立确认,不只信决议字面)
- 发现 SDK 行为不符决议字面 / 引入新版本 / 修改 package.json 中 SDK 字段时**必须停下汇报**
- commit message 涉及 SDK 字段变更时,必须显式登记(`feat(deps): bump surrealdb 2.0.3 → 2.0.4 (patch)`)

### 3.3 审计师(决议复审 + 实施完成审计)

- 复审决议时,核 §SDK 版本登记字段是否齐全
- 审计实施时,`git diff package.json package-lock.json` 必须明确预期(本 sub-phase 不应改 / 应该改 patch level / 等)

---

## 4. 当前已锁定版本登记表

| SDK | 锁定 major | 当前基线版本 | package.json range | 锁定决议 | 锁定日期 | 备注 |
|---|---|---|---|---|---|---|
| surrealdb | 2 | 2.0.3 | `^2.0.3` | [decision 020](decisions/020-sub-phase-3a-tx-true-atomicity.md) | 2026-05-13 | `beginTransaction()` API 在 2.x 字面已支持;**允许** caret range 自动到 < 3.0.0 的 minor/patch(2.1.x / 2.2.x 等);**禁止** 3.x 升级(独立 sub-phase)|
| emoji-mart | 5 | 5.6.0 | `^5.6.0` | (无 decision-XXX,见 §6 v1.8 备注) | 2026-05-15 | `feature/callout-as-container` emoji picker Notion 风格升级。**仅装核心包**,不装 `@emoji-mart/react`(其 peer 字面 `^16.8 \|\| ^17 \|\| ^18` 不含 19,但源码 20 行只用 useRef/useEffect 实测兼容;V2 改走手写 React wrapper 调 `new Picker({ref, data, theme, onEmojiSelect, ... })`,绕开 peer 字面冲突 + 不被 3 年未更新的官方包装阻塞)。**允许** caret 到 < 6.0.0;**禁止** 6.x 升级(独立 sub-phase)|
| @emoji-mart/data | 1 | 1.2.1 | `^1.2.1` | (同上) | 2026-05-15 | emoji-mart 5.x 配套数据集;`{ data }` prop 字面传入 Picker;1.x 内部数据 schema 与 emoji-mart 5.x 锁定。**允许** caret 到 < 2.0.0;**禁止** 2.x 升级(独立 sub-phase)|

**列字段语义**:
- **锁定 major**:不可跨越的硬版本号。跨此 major 升级必须独立决议(§2.4 流程)。
- **当前基线版本**:撰写锁定决议时的实测验证版本;后续 minor/patch 升级需要 commit message 显式登记基线版本变化(`feat(deps): bump <sdk> baseline X.Y.Z → X.Y.Z+1 (patch)`),但 §4 表"当前基线版本"列**不必每次更新**(避免文档高频改动),只在新 sub-phase 决议锁定时同步刷新。
- **package.json range**:实际 `package.json` 字面值;range 允许的升级范围必须与"锁定 major"一致(caret `^X.Y.Z` 允许 `< X+1.0.0`;tilde `~X.Y.Z` 仅 patch)。

> **维护说明**:本表由"显式声明 SDK 版本变更 / 新增绑定"的业务决议 §8 反向更新流程维护(详 §7)。同 major 内 minor/patch 升级允许走常规依赖更新流程(不强制改本表)。**新增 SDK 绑定 / 跨 major 升级必须改本表**。

---

## 5. 教训登记

### 5.1 第 9 次设计师教训(2026-05-13,decision 020)

> 拍板涉及外部依赖版本时,要意识到该选择会绑定到发布包,跨大版本升级是独立 sub-phase 不能合并。

**起因**:L7 启动包字面"surrealdb-js 3.x SDK"是设计师从模糊记忆出发的笔误,grep `package.json` 才发现 V2 装的是 2.0.3。

**教训详细**:[decision 020 §0.6](decisions/020-sub-phase-3a-tx-true-atomicity.md)。

### 5.2 第 12 次设计师教训(2026-05-13,decision 020 §11.5)

> 决议 §5 / §6 字面 verify / 实施任务必须 grep import 链确认可执行性;不只验证"API 字面存在",还要验证"API 可在 verify 上下文跑起来"。

**起因**:decision 020 §5.5 / §6.1 字面要求"直接调 V2 `SurrealStorage.transaction(fn)`",但 storage.ts → client.ts → `import { app } from 'electron'`,纯 node 脚本 import 失败。实施者 Step 5.5 才发现。

**纪律升级**:§2.2 加第 4 步"API 可执行链路实证"(2026-05-13 v1.2)。

**教训详细**:[decision 020 §11.5](decisions/020-sub-phase-3a-tx-true-atomicity.md)。

### 5.3 第 24 次设计师教训(2026-05-14,decision 022 §10.D-2)

> 决议字面引用 storage API 调用语法时, 必须 grep V2 EdgeFilter / AtomFilter / SubgraphQuery 等 V2 既有 filter 字段名 (扁平 `subjectAtomId` 等), 不能复用决议字面伪代码或上一 sub-phase 字面 (沿第 22 次教训同型升级).

**起因**: decision 022 §10.D-2 — 决议字面 4 处 (line 536 / 613 / 718 / 944) `listEdges({ predicate, subject: { atomId } })` 是设计师伪代码字面, 实测 V2 EdgeFilter 字面字段是扁平 `subjectAtomId` (src/storage/api.ts:107). Step 5.1 binary verify 实证扁平字段 PASS.

**纪律升级**: §2.2 第 8 步加 "决议字面引用 storage API 调用语法时, 必须 grep EdgeFilter / AtomFilter / SubgraphQuery 等 V2 既有 filter 字段名".

**教训详细**: [decision 022 §10.D-2](decisions/022-sub-phase-022-ebook-thought-migration.md).

### 5.4 第 25 次设计师教训(2026-05-14,decision 022 §10.D-5)

> 决议字面引用 V2 既有目录前必须 grep 实证 (沿第 18 / 22 / 24 次同型升级).

**起因**: decision 022 §10.D-5 — 决议 §5 Step 5.3 字面 "沿 V2 既有 `_shared/` 目录字面", 实测 V2 字面 `src/drivers/text-editing-driver/blocks/` 字面**无 `_shared/` 子目录**, 字面新建符合决议字面意图.

**纪律升级**: §2.2 第 8 步加 "决议字面引用 V2 既有目录前必须 grep 实证".

**教训详细**: [decision 022 §10.D-5](decisions/022-sub-phase-022-ebook-thought-migration.md).

### 5.5 第 26 次设计师教训(2026-05-14,decision 022 §10.D-6)

> Bash tool persistent cwd 假设不可靠, 每个 Bash 调用独立 cd 前缀.

**起因**: decision 022 §10.D-6 — 实施者字面 Bash 调用字面**2 次漂移到 V1 仓** (Step 5.4 早期 grep + Step 5.10 任务 1 typecheck verify), 累计 sub-phase 022 字面 7+ 次同型事故 (memory `feedback_v2_is_workspace_v1_is_reference`). Bash tool 文档字面 "working directory persists between commands" 在长 session 字面可能因复合命令 / pipe / heredoc 字面副作用失效.

**纪律升级**: §2.2 第 9 步登记此教训; 每个 Bash 调用字面字面**必须独立 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&` 前缀**, 不依赖 persistent cwd 假设; L7 启动包 §1.6 实施者纪律累积教训追加第 7 条 (沿决议 022 反向更新).

**教训详细**: [decision 022 §10.D-6](decisions/022-sub-phase-022-ebook-thought-migration.md).

### 5.6 第 27 次设计师教训(2026-05-14,decision 022 §10.D-7)

> 总指挥批复 typecheck error code 时必须沿 sub-phase 实际 fail 形态登记, 不复用上一 sub-phase 模板.

**起因**: decision 022 §10.D-7 — prompt 字面字面 "Step 5.4 commit 1 后 typecheck 预期 fail (14+ caller TS2554)", 实测 25 errors: TS2305 × 10 + TS2339 × 12 + TS2353 × 1 + TS7006/7053 × 2, 无一条 TS2554. TS2554 字面字面 sub-phase 021 字面 (加 viewType 参数, caller 漏传), sub-phase 022 字面字面**删 interface + 删 API** 字面 fail 形态必然是 TS2305 + TS2339. prompt 字面沿 021 模板字面没修正 — 设计师笔误.

**纪律升级**: §2.2 第 9 步登记此教训; 总指挥批复字面引用 typecheck error code 时, 必须沿 sub-phase 实际 fail 形态字面登记 (删 interface → TS2305 / 删 API → TS2339 / arity mismatch → TS2554).

**教训详细**: [decision 022 §10.D-7](decisions/022-sub-phase-022-ebook-thought-migration.md).

### 5.7 第 30 次设计师教训(2026-05-14,decision 022 Step 5.9)

> 健康检查 helper 自愈模式 (keep-latest) vs 告警模式 (scan-only) 分离原则, 沿 decision 014 + 022 双 sub-phase 实证.

**起因**: decision 022 Step 5.9 实施期决策 — scanCardinality 独立函数 (跟 checkPredicate keep-latest 区分). 沿 decision 014 §3.5.3.6 字面 keep-latest 自愈语义 (`inCanvas` / `hasContent` 一对一适用旧 atom 字面字面字面历史数据自愈) vs decision 022 §4.3.1-L2 字面 "扫描+告警" 语义 (`hasReadingState` / `hasReadingThought` 字面 sub-phase 022 字面留管理员决断, 跟 L1 throw + L3 throw+不写 flag 三层防线区分).

**纪律升级**: §2.2 第 9 步登记此教训; 健康检查 helper 字面字面字面字面字面 sub-phase 设计意图字面字面字面字面字面**自愈 vs 告警**字面字面字面字面字面字面字面字面字面字面字面字面字面字面字面字面字面字面字面字面 (沿决议 022 §11 第 30 次教训).

**教训详细**: [decision 022 §11 第 30 次](decisions/022-sub-phase-022-ebook-thought-migration.md).

### 5.8 第 31 次设计师教训(2026-05-14,decision 022 §10.D-11 Step 5.12 反向更新)

> 完成报告 lint 字面口径必须区分 pre-existing vs sub-phase 引入,完成判据矩阵 typecheck + lint 双跑双绿.

**起因**: decision 022 §10.D-11 — Step 5.11 完成报告 §3 完成判据矩阵字面把 capability-impl.ts 字面 2 个 unused import 算成 "3 pre-existing warning", 实测 `git log -- capability-impl.ts` 字面该文件由 sub-022 commit 378a283 整文件新建 (+748 行) 引入, 2 个 unused import 属**sub-phase 新引入**, 不是 pre-existing. 只有 svg/textBlock.ts:8 经 `git log` 实证 sub-022 分支 0 commit 触及, 是真 pre-existing. 同时报告 §2 commit 矩阵底行字面用逐 commit `git show --stat` 累加法把 merge commit 9c88af1 的 138 行重复计入, 跟 `git diff --stat 91cfbf8..HEAD` 实测口径偏差 +170/-170 行.

**纪律升级**: §2.2 第 9 步登记此教训; 完成报告字面 lint warning 来源溯源必须 `git log -- <file>` 实证, 区分 pre-existing (文件 main HEAD 已存在 + sub-phase 0 commit 触及) vs sub-phase 新引入 (本 sub-phase commit 整文件新建或改文件时新增 warning); 完成判据矩阵字面**typecheck PASS + lint PASS (--max-warnings 0 exit 0) 双跑双绿**, 不能只引 typecheck 输出代替 lint; 完成报告字面 commit 矩阵行数累计字面以 `git diff --stat <merge-base>..HEAD` 实测口径为准, 弃用逐 commit `git show --stat` 累加法 (避免 merge commit 重复计入).

**教训详细**: [decision 022 §11 第 31 次](decisions/022-sub-phase-022-ebook-thought-migration.md).

### 5.9 第 32 次设计师教训(2026-05-14,decision 022 §10.D-12 + §10.D-12b Step 5.13 反向更新)

> view type union / enum 加项 + capability 责任拆分时必须 grep 全谱**两子层**: main 端 IPC handler narrow guard 字面值 + view 端订阅链 onXChanged 配对.

**起因**: decision 022 Step 5.13 抢修期连续暴露 2 处字面漏点:

1. **§10.D-12 (第 7-A 层 — main 端 IPC handler narrow guard 字面值)**: sub-022 §10.D-8 字面"FolderViewType += 'ebook'"字面只改 `src/capabilities/folder/types.ts` 的 union 字面 + view caller 字面 + capability-impl 字面, **漏改 main 端 IPC handler `src/platform/main/folder/handlers.ts` 字面 3 处 narrow guard**: `FOLDER_LIST` (`if (viewType !== 'note' && viewType !== 'graph') return [];`) / `FOLDER_CREATE` (同型) / `broadcastFolderListChanged` (`Promise.all([listFolders('note'), listFolders('graph')])` 字面遍历漏 'ebook'). narrow guard 字面是**字面值字符串字面**, 不引 union 类型字面, grep type 名拿不到.

2. **§10.D-12b (第 7-B 层 — view 端订阅链 onXChanged 配对)**: §10.D-12 抢修 commit 0afb0bd 后用户 UI 验证仍 0 反应, 完全重启 dev server 出现"很多文件夹"暴露 — sub-022 §5.6 view caller 把 folder 从 `library.folderXxx` 改走 `folder.createFolder(viewType='ebook')` 时, `src/views/ebook/nav-side-content.tsx:100-103` 字面**只订阅 library.onBookshelfChanged**, **没订阅 folderApi.onListChanged**. main 端 fix 后 broadcast `FOLDER_LIST_CHANGED` 字面有但 view 端字面不接 → UI 永不实时刷新, 只有冷启动 mount-time refresh() 才从 atom 库重新拉到. 沿 decision 021 §10.B-2 教训 17"间接传播路径 broadcast / 订阅 / hook"**同型扩展** — 决议 021 教训字面是"接口签名变更必须额外 grep 间接被调", 本次字面是"capability 责任拆分必须 grep view 端订阅 onXChanged 配对".

**纪律升级**: §2.2 第 8 步登记此教训; view type union / enum 加项 + capability 责任拆分时必须**额外 grep 全谱两子层**:

- **第 7-A 层 — main 端 IPC handler 字面值校验**: 字面 grep `!== '<type-name-A>'` + `!== '<type-name-B>'` 字面字符串模式 + `Promise.all([listX('A'), listX('B')])` 字面遍历 + `isXType(v): v is XType` 字面 narrow function. 不能字面只 grep type 名拿命中.

- **第 7-B 层 — view 端订阅链 onXChanged 配对**: 字面 grep view 端 useEffect 内 `on[A-Z]\w+Changed\|onListChanged\|onBookshelfChanged` 等订阅模式. capability 责任拆分时 (老 capability X.foo → 新 capability Y.foo), view 端**订阅必须同步配对扩**: 老 `X.onXChanged` + 新 `Y.onYChanged` 两条流并存, view 要订阅两条; cleanup return 双 unsub. 漏一笔字面层 lint/typecheck 不报, 只有 runtime UI 不实时刷新才暴露.

完整传播层 grep **第 7 层拆 7-A / 7-B 两子层** (沿 v1.4 字面 6 层清单字面扩展).

**教训详细**: [decision 022 §10.D-12 + §10.D-12b + §11 第 32 次](decisions/022-sub-phase-022-ebook-thought-migration.md).

---

## 6. 修订记录

| 日期 | 版本 | 修订内容 | 修订决议 |
|---|---|---|---|
| 2026-05-13 | v1.0 | 首次制定(由 decision 020 触发) | [decision 020](decisions/020-sub-phase-3a-tx-true-atomicity.md) |
| 2026-05-13 | v1.1 | 用户 P3 修订:消除"禁止顺带改 vs §4 必改"矛盾(§7 分两类);§2.2 API 证据采集通用化;§4 表列字段口径统一 | [decision 020](decisions/020-sub-phase-3a-tx-true-atomicity.md) |
| 2026-05-13 | v1.2 | sub-phase 3a-tx 实施期 §10.B-2 偏离 + 第 12 次教训反向更新:§2.2 加第 4 步"API 可执行链路实证";§5 加 5.2 第 12 次教训 | [decision 020 §10.B-2 + §11.5](decisions/020-sub-phase-3a-tx-true-atomicity.md) |
| 2026-05-13 | v1.4 | sub-phase 021 实施期 5 个偏离(§10.B-1/B-2/B-3/C-1/C-2)+ 第 16-20 次教训累积反向更新:§2.2 加第 8 步"V2 完整传播层 6 层 grep 前瞻验证"(view caller / capability types / capability index / IPC+preload+d.ts / 分层 lint / 同类型 SSOT 位置 + 间接传播路径 + API 总数前瞻 + "跨 X 复用"语义明示)。授权依据:[decision 021 §0.5.ter 用户 P0 授权](decisions/021-sub-phase-021-folder-view-isolation.md#05ter-用户-p0-授权step-57-顺手改-sdk-version-binding-policymd-22-第-8-步--6-修订记录-v142026-05-13-实施期反向更新) | [decision 021 §11.3-§11.7](decisions/021-sub-phase-021-folder-view-isolation.md) |
| 2026-05-14 | v1.5 | sub-phase 022 实施期 13 偏离 (3B + 10D) + 第 24/25/26/27/30 次教训累积反向更新: §2.2 第 8 步加 "决议字面引用 storage API 调用语法 grep EdgeFilter 字段名" + "决议字面引用 V2 既有目录前必须 grep 实证" (沿第 24/25 次); §2.2 第 9 步加 "Bash tool persistent cwd 假设不可靠每 Bash 独立 cd 前缀" + "typecheck error code 沿 sub-phase 实际 fail 形态" + "健康检查 helper 自愈 vs 告警分离" (沿第 26/27/30 次). 授权依据: decision 022 §0.5.quat 用户 2026-05-14 P0 授权 (沿 sub-phase 021 §0.5.ter 同模式) | [decision 022 §11 第 24-27 + 30 次](decisions/022-sub-phase-022-ebook-thought-migration.md) |
| 2026-05-14 | v1.6 | sub-phase 022 Step 5.12 总指挥审计反馈 + 第 31 次教训反向更新: §5.8 新加第 31 次教训字面 "完成报告 lint 字面口径必须区分 pre-existing vs sub-phase 引入, 完成判据矩阵 typecheck + lint 双跑双绿, commit 矩阵行数以 `git diff --stat <merge-base>..HEAD` 实测口径为准弃用逐 commit 累加法"; §2.2 第 9 步同步登记. 授权依据: decision 022 §10.D-11 + Step 5.12 用户 2026-05-14 P0 拍板 (沿 v1.5 同模式) | [decision 022 §10.D-11 + §11 第 31 次](decisions/022-sub-phase-022-ebook-thought-migration.md) |
| 2026-05-14 | v1.7 | sub-phase 022 Step 5.13 UI 回归 [N-5] folder handler narrow guard + [N-5b] view 订阅链漏配对 + 第 32 次教训反向更新 (**字面两子层扩展**): §5.9 新加第 32 次教训字面 "view type union / enum 加项 + capability 责任拆分时必须 grep 全谱两子层 — 第 7-A 层 main 端 IPC handler narrow guard 字面值 + 第 7-B 层 view 端订阅链 onXChanged 配对"; §2.2 第 8 步同步登记 + 完整传播层 grep 清单字面**第 7 层拆 7-A / 7-B 两子层** (沿 v1.4 字面 6 层清单字面扩展). 授权依据: decision 022 §10.D-12 + §10.D-12b + Step 5.13 用户 2026-05-14 P0 拍板 (沿 v1.5 / v1.6 同模式) | [decision 022 §10.D-12 + §10.D-12b + §11 第 32 次](decisions/022-sub-phase-022-ebook-thought-migration.md) |
| 2026-05-15 | v1.8 | §4 表新增 2 行:`emoji-mart@5.6.0` + `@emoji-mart/data@1.2.1`(`feature/callout-as-container` sprint emoji picker Notion 风格升级)。**无 decision-XXX 决议文档支撑**(前端 UI sprint,用户 P0 授权"走轻量登记":SDK policy §3.1 字面新增 SDK 绑定必须改 §4 表 + 走业务决议 §8 反向更新流程,本次为前端 UI sprint 例外授权,仅登记 §4 表 + §6 修订记录,不开 decision-XXX)。**字面证据**:`npm view emoji-mart peerDependencies` = 空(0 peer 冲突);`@emoji-mart/react@1.1.1` 源码 20 行 grep 实证只用 `useRef`/`useEffect`(React 16.8+ 基础 hook,19 100% 保留),包 3 年未更新 peer 字面 `^16.8 \|\| ^17 \|\| ^18` 不含 19;V2 决策走手写 React wrapper 调 `new Picker({ ref, data, theme, ... })` 绕开 peer 字面冲突。授权依据:2026-05-15 用户 P0 拍板 "走轻量登记 + caret range" | (无 decision-XXX;sprint 完工 commit hash 见 §4 备注) |

---

## 7. 修订流程(两类区分,正式登记)

本文档的修订分**两类**,触发条件 / 授权流程不同:

### 7.1 规则正文修订(§1 / §2 / §3 / §5 / §7 自身)

**触发**:核心规则 / 适用范围 / 操作纪律 / 修订流程本身的修改。

**流程**:
1. **必须**独立决议(decision XXX-policy-revision)
2. 用户 P0 授权
3. 决议合 main 时同步落地本文档修订
4. **不允许**在业务 sub-phase 决议内"顺带改"规则正文

### 7.2 §4 锁定版本登记表更新(允许在业务决议内进行)

**触发(任一)**:
- 某 sub-phase 决议**显式**锁定新 SDK 绑定(新增表一行)
- 某 sub-phase 决议**显式**触发跨 major 升级(改"锁定 major"列 + 加修订记录)
- 某 sub-phase 决议**显式**刷新基线版本(改"当前基线版本"列;非强制)

**流程**:
1. 业务决议 §8 反向更新清单**必须明确**登记本表更新
2. 决议合 main 时同步落地 §4 表 + §6 修订记录(若涉及跨 major 升级)
3. 同 major 内 minor / patch 升级**允许**走常规依赖更新流程(commit message 登记即可,不强制改本文档)

### 7.3 §6 修订记录维护

无论 §7.1 / §7.2 类型,只要本文档有任何字面修改,**必须**追加 §6 修订记录一行(日期 / 版本号 / 修订内容 / 触发决议)。版本号约定:
- 规则正文修订(§7.1) → 主版本号 +1(v1.0 → v2.0)
- §4 表 + 操作微调(§7.2 / §6 自身)→ 次版本号 +1(v1.0 → v1.1)

---

*本文档是 KRIG-Note V2 项目级永久规则,跨 sub-phase / 跨决议 / 跨对话生效。修订流程详 §7。*
