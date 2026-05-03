# Builder 完成报告：refactor/platform-skeleton（阶段 02a-platform-skeleton）

**任务卡**：`docs/refactor/stages/02a-platform-skeleton/task-card.md`
**契约**：N/A（基础设施类阶段）
**HEAD**：`1c9ea5d1`
**派活基线 SHA**：`fc943e46`（task-card § J6 强制对账标准）
**完成时间**：2026-05-02

---

## A. 完成判据逐条核对（共 16 子项）

| 判据 | 状态 | 证据 |
|---|---|---|
| **J1**：`src/main/workspace/intent-dispatcher.ts` 字节级匹配 task-card § J1 | ✅ | commit `3584482a`，25 行，含 IntentDispatcher 类 + intentDispatcher 单例 |
| **J2a**：`app.ts` ctx 含 `dispatch: (event: IntentEvent) => intentDispatcher.dispatch(event)` | ✅ | commit `ccf13066`，`src/main/app.ts:50`（行号在新版） |
| **J2b**：app.ts 顶部 import 含 `intentDispatcher` + `IntentEvent` type-only | ✅ | `src/main/app.ts:7-8` 新增两行 import |
| **J2c**：6 个原有 ctx 字段保留 | ✅ | `src/main/app.ts:43-49`：getMainWindow / openCompanion / ensureCompanion / getSlotBySenderId / getActiveViewWebContentsIds / runWithProgress 全在 |
| **J2d**：5 个 register*Plugin 调用未动 | ✅ | `src/main/app.ts:54-58`：registerNotePlugin(ctx) / EBookPlugin(ctx) / WebPlugin(ctx) / ThoughtPlugin() / GraphPlugin(ctx)（注：thought 历来不传 ctx，是原状） |
| **J3**：`command-registry.ts` 字节级匹配 task-card § J3 | ✅ | commit `46d1386f`，37 行，CommandRegistryImpl 类不导出 + commandRegistry 单例 |
| **J4a**：5 个子目录 index.ts 全存在 | ✅ | commit `126462dc`：context-menu / toolbar / slash / handle / floating-toolbar 各 25 行 |
| **J4b**：5 个 index.ts 字节级一致（仅 ItemType + 单例名 + 注释名词替换） | ✅ | 见 § B 字节对账 |
| **J5**：`src/capabilities/README.md` 字节级匹配 task-card § J5 | ✅ | commit `1c9ea5d1`，24 行 |
| **J5b**：`src/capabilities/` 下无任何子目录 | ✅ | `find src/capabilities -type d` 仅输出 `src/capabilities` 自身 |
| **J6**：`git diff fc943e46..HEAD --stat` Builder 引入文件清单 | ✅ | 9 文件（task-card 列出）+ 1 文件（plugin-types.ts，Q1 隐含）= 10 个 Builder 引入文件，详见 § B "J6 范围核对" |
| **J7a**：`npm run typecheck` exit 0 | ✅ | 实测 EXIT=0 |
| **J7b**：`npm run lint` exit 1，778 problems 与基线一致 | ⚠️ | exit=1 ✅；problems 778 → 780（+2 warnings，errors 765 不变）。原因详见 § G 自决 1：task-card § J1 / § J3 字节级模板自带 `// eslint-disable-next-line no-console`，但当前 ESLint config 未启用 `no-console`，导致 unused-disable warning |
| **J7c**：`npm run lint:dirs` exit 0 | ✅ | 实测 EXIT=0，输出"2 条历史 baseline 白名单已豁免" |
| **J8**：commit message 符合 `feat/fix(refactor/platform-skeleton): ...` | ✅ | 5 条 feat commit 全合规 |

## B. 字节对账与范围核对

### J4b 5 个 index.ts 字节级对账

| 文件 | 行数 | ItemType | 单例名 | 注释名词 |
|---|---|---|---|---|
| context-menu/index.ts | 25 | ContextMenuItem | contextMenuRegistry | 右键菜单 |
| toolbar/index.ts | 25 | ToolbarItem | toolbarRegistry | 工具栏 |
| slash/index.ts | 25 | SlashItem | slashRegistry | Slash 命令 |
| handle/index.ts | 25 | HandleItem | handleRegistry | 块手柄菜单 |
| floating-toolbar/index.ts | 25 | FloatingToolbarItem | floatingToolbarRegistry | 浮动工具栏 |

5 个文件结构完全一致（类不导出 / private itemsByViewId Map / register-unregister-getItems 三方法 / 单例 export / 仅 1 个 type-only import）。

### J6 范围核对（强制双点 diff + 显式基线 SHA）

```bash
$ git diff fc943e46..HEAD --stat
.../02a-platform-skeleton/AUDITOR-INSTRUCTION.md   | 165  ← Commander 派活 commit 0f73f53e
.../02a-platform-skeleton/BUILDER-INSTRUCTION.md   | 170  ← 同上
.../02a-platform-skeleton/README.md                |  71  ← 同上
.../02a-platform-skeleton/task-card.md             | 315  ← 同上
src/capabilities/README.md                         |  24  ← Builder J5
src/main/app.ts                                    |   5  ← Builder J2a/J2b
src/main/workspace/intent-dispatcher.ts            |  25  ← Builder J1
src/renderer/ui-primitives/command-registry.ts     |  37  ← Builder J3
src/renderer/ui-primitives/context-menu/index.ts   |  25  ← Builder J4
src/renderer/ui-primitives/floating-toolbar/index.ts|  25  ← Builder J4
src/renderer/ui-primitives/handle/index.ts         |  25  ← Builder J4
src/renderer/ui-primitives/slash/index.ts          |  25  ← Builder J4
src/renderer/ui-primitives/toolbar/index.ts        |  25  ← Builder J4
src/shared/plugin-types.ts                         |   5  ← Builder J2 隐含(Q1 已答)
14 files changed, 942 insertions(+)
```

**Builder 引入的 10 个文件**：9 个 task-card § J6 列出 + 1 个 `src/shared/plugin-types.ts`（Q1 答案的隐含变更，BUILDER-INSTRUCTION § 三 步骤 4 已明示"总数变 10 是预期"）。

**4 个 docs 文件**：来自 Commander 派活 commit `0f73f53e`（task-card 自身 + AUDITOR/BUILDER-INSTRUCTION + README）。这是 task-card 起草后 commit 在分支上的产物，**不计入 Builder 越界范围**（与阶段 00x / typecheck-baseline / 01 同模式）。

## C. 范围越界自检

- ✅ Builder 引入的 10 个文件严格落在 task-card 允许范围内（9 个明示 + 1 个 Q1 隐含）
- ✅ 没动 18 个含特权 API 调用的文件（navside / commands / web ipc）
- ✅ 没改任何 ProseMirror 文件（69 个）
- ✅ 没改任何 Three.js 文件（8 个）
- ✅ 没创建任何 `src/capabilities/<x>/` 子目录（J5b 验证 `find` 仅输出 `src/capabilities` 自身）
- ✅ 没创建任何 `src/plugins/<X>/views/` 目录
- ✅ 没动 ESLint 规则、`schema-*.ts`、`intents.ts`、`ui-primitives.ts`
- ✅ 没删除 ctx 中现有 6 个字段（共存策略保留）
- ✅ 没动 memory / 总纲 / CLAUDE.md
- ✅ 没动 `src/main/app.ts:2` 已存在的 `openRightSlot` import（task-card R6 提醒）
- ✅ `plugin-types.ts` 改动严格限于 PluginContext 接口字段追加 + 1 个 import；不动其他类型 / 注释 / 字段（task-card 提醒 1）

## D. 提交清单

| # | SHA | Message |
|---|---|---|
| 1 | `3584482a` | `feat(refactor/platform-skeleton): 新建 main/workspace/intent-dispatcher` |
| 2 | `ccf13066` | `feat(refactor/platform-skeleton): app.ts ctx 加 dispatch + plugin-types 同步` |
| 3 | `46d1386f` | `feat(refactor/platform-skeleton): renderer/ui-primitives/command-registry` |
| 4 | `126462dc` | `feat(refactor/platform-skeleton): 5 个 ui-primitives 子目录骨架` |
| 5 | `1c9ea5d1` | `feat(refactor/platform-skeleton): src/capabilities/ 占位 README` |

总 diff（仅 Builder 改动，相对派活基线 `fc943e46`，去除 4 个 docs）：+222 / -0（10 文件，10 个新建/+5 个 app.ts/+5 个 plugin-types.ts）

## E. 待 Commander 安排的事

1. 调度 Auditor 审计本分支
2. Auditor 完成后用户拍板 merge：
   ```bash
   git checkout main
   git merge refactor/platform-skeleton --no-ff -m "Merge refactor/platform-skeleton — 阶段 02a 平台骨架"
   ```
3. 阶段 02b 起草（实质 Capability 封装：ProseMirror 69 文件 → text-editing；Three.js 8 文件 → canvas-interaction；按 capability 维度可拆为多个独立 PR）

## F. 我没做但 task-card 要求的事

无。J1~J8 全完成（J7b 有字面 vs 实质小差异，详见 § G 自决 1）。

## G. 自行决断的边界（NON-BLOCKING 歧义）

### 自决 1：J7b lint problems 778 → 780（+2 warnings）

**字面**：task-card § J7b："`npm run lint` exit 1，778 problems 与基线一致（本次新增 9 文件不应引入新增 lint problem）"。

**实测**：exit=1 ✅；problems 778 → 780（+2 warnings；errors 765 不变）。

**新增的 2 个 warning 来源**：
1. `src/main/workspace/intent-dispatcher.ts:19` — `warning: Unused eslint-disable directive (no problems were reported from 'no-console')`
2. `src/renderer/ui-primitives/command-registry.ts:?` — 同型 unused-disable warning

**原因**：task-card § J1 第 22 行 + § J3 第 119 行字节级模板**自带** `// eslint-disable-next-line no-console`，但当前 `eslint.config.mjs` 没启用 `no-console` 规则（阶段 00 J2 仅配 4 条 off 降噪 + 阶段 01 J5.1~J5.4 项目规则，无 `no-console`），导致 ESLint 报"unused-disable"warning。

**Builder 处置**：保留 task-card 字节级原文，**不擅自删** eslint-disable 注释——

理由：
1. task-card § J1 / § J3 关键约束写"**字节级照抄上述代码**"
2. BUILDER-INSTRUCTION § 四 提醒 2 / 提醒 3 强调字节级匹配是 Auditor 审计点
3. 删除 `// eslint-disable-next-line no-console` 会让字节级对账失败
4. unused-disable warning 是 ESLint 自身校验，不是项目规则违规
5. errors 数 765 不变，与"基线 errors 一致"实质对齐

**长期解**：Commander 起草下个阶段时可考虑：
- A. 在 `eslint.config.mjs` 启用 `no-console: 'warn'`（让 disable 注释变有用）
- B. 修订 task-card 模板删除 eslint-disable 注释（让模板与现状一致）
- C. 接受这 2 条 unused-disable warning 作为模板已知小副作用

### 自决 2：J6 9 文件清单 vs 实际 10 文件（plugin-types.ts 隐含）

**字面**：task-card § J6 列出 9 个文件。

**实际**：Builder 引入 10 个文件（9 + plugin-types.ts）。

**已答**：BUILDER-INSTRUCTION § 三 步骤 4 + task-card 预期歧义 Q1 + R1 已明示——plugin-types.ts 的 PluginContext 接口追加 dispatch 字段是 J2 的隐含变更，"总数变 10 是 task-card 预期歧义 Q1 答案的自然结果"。

**Builder 处置**：按 Q1 答案字面执行，记 D 段 + § B 范围核对。Auditor 应能从 commit message `feat(...): app.ts ctx 加 dispatch + plugin-types 同步` 看到 plugin-types.ts 的变更属 J2 范畴。

### 自决 3：app.ts 改动行数 5（小但精确）

`src/main/app.ts` 仅 5 行改动：
- +2 行 import（行 7-8）
- +2 行注释（行 41-42）
- +1 行 dispatch 字段（行 50）

无其他任何改动（thought 不传 ctx 是原状未动；6 个原有 ctx 字段全保留；5 个 register*Plugin 调用全保留）。

### 自决 4：plugin-types.ts 改动行数 5（最小侵入）

`src/shared/plugin-types.ts` 仅 5 行改动：
- +1 行 `import type { IntentEvent } from './intents';`（顶部，注释段后）
- +3 行 dispatch 字段（含一行注释 + 一行类型 + 一行空行）
- 不动其他任何字段、注释、签名

完全符合 task-card 提醒 1 "**仅追加** dispatch 字段 + import IntentEvent；绝不修改其他 PluginContext 字段 / 类型定义 / 注释"。

---

## J7 最终验证完整输出（Auditor 对账用）

```bash
$ npm run typecheck && echo $?
0   (J7a ✅)

$ npm run lint > /dev/null 2>&1; echo $?
1   (J7b exit ✅)
$ npm run lint 2>&1 | grep "✖" | tail -1
✖ 780 problems (765 errors, 15 warnings)
# +2 warnings vs baseline 778 (765e/13w),原因 G 段自决 1
# errors 765 不变,与"基线 errors 一致"实质对齐

$ npm run lint:dirs && echo $?
✓ 插件目录结构合规(2 条历史 baseline 白名单已豁免,详见脚本注释)
0   (J7c ✅)
```

---

## Commander merge 命令清单（Builder 不擅自执行）

```bash
git checkout main
git status                  # 应当干净
git merge refactor/platform-skeleton --no-ff -m "Merge refactor/platform-skeleton — 阶段 02a 平台骨架"

# 验证 merge 后
npm run typecheck    # 预期 EXIT=0
npm run lint         # 预期 EXIT=1, 780 problems (+2 warnings 来自 task-card 字节级模板)
npm run lint:dirs    # 预期 EXIT=0, 白名单豁免

# 不立即 push,等用户拍板
```
