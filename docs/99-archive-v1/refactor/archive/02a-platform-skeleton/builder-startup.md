# Builder 启动自检：refactor/platform-skeleton（阶段 02a-platform-skeleton）

## 已读输入
- ✅ 总纲 v2.3 § 2 / § 5 / § 7（同会话已读）
- ✅ CLAUDE.md（含重构期硬规则段，阶段 01 已落）
- ✅ 阶段目录 `docs/refactor/stages/02a-platform-skeleton/`：
  - ✅ README.md
  - ✅ task-card.md
  - ✅ BUILDER-INSTRUCTION.md
  - ⛔️ AUDITOR-INSTRUCTION.md（按指令不读）
- ✅ BUILDER-PROMPT（同会话已读）
- ✅ 数据契约引用（仅读，不动）：
  - `src/shared/intents.ts`（IntentEvent + 4 Intent 接口）
  - `src/shared/ui-primitives.ts`（ContextMenuItem / ToolbarItem / ⋯ / CommandHandler 等）
- ✅ 现状参考：
  - `src/main/app.ts`（行 38-54 为 registerPlugins() + ctx）
  - `src/shared/plugin-types.ts`（PluginContext 接口含 6 字段，无 dispatch）
- ✅ 功能契约：N/A
- ✅ 目标分支：`refactor/platform-skeleton`，HEAD = `0f73f53e`，工作树干净
- ✅ 派活基线 SHA：`fc943e46`（用户给定，task-card § J6 对账标准）

## 本次 task-card 完成判据复述（共 16 子项）

- **J1**：`src/main/workspace/intent-dispatcher.ts` 字节级匹配 task-card § J1
- **J2a**：`src/main/app.ts` ctx 含 `dispatch: (event: IntentEvent) => intentDispatcher.dispatch(event)`
- **J2b**：app.ts 顶部 import 含 `intentDispatcher` + `IntentEvent type-only`
- **J2c**：6 个原有 ctx 字段保留（`getMainWindow` / `openCompanion` / `ensureCompanion` / `getSlotBySenderId` / `getActiveViewWebContentsIds` / `runWithProgress`）
- **J2d**：5 个 register*Plugin(ctx) 调用未动
- **J3**：`src/renderer/ui-primitives/command-registry.ts` 字节级匹配
- **J4a**：5 个子目录 `{context-menu,toolbar,slash,handle,floating-toolbar}/index.ts` 全存在
- **J4b**：5 个 index.ts 字节级一致（仅 ItemType + 单例名 + 注释名词替换）
- **J5**：`src/capabilities/README.md` 字节级匹配
- **J5b**：`src/capabilities/` 下无任何子目录
- **J6**：`git diff fc943e46..HEAD --stat` 含且仅含 9 文件（双点 + 显式 SHA）
  - 注：J2 隐含的 `src/shared/plugin-types.ts` 改动（Q1 答案）让总数变 10，G 段记录
- **J7a**：`npm run typecheck` exit 0
- **J7b**：`npm run lint` exit 1，778 problems 与基线一致
- **J7c**：`npm run lint:dirs` exit 0，白名单豁免
- **J8**：commit message 符合 `feat/fix(refactor/platform-skeleton): ...` 格式

## 契约 § B 防御代码 grep 验证

本次为基础设施类阶段，无功能契约，跳过。

## 风险预探（task-card R1~R6）

### R1 实测：基线状态

```bash
$ npm run typecheck   ; echo $?
EXIT=0   ✅
$ npm run lint        ; echo $?
EXIT=1
✖ 778 problems (765 errors, 13 warnings)   ✅ 与阶段 01 完成时一致
$ npm run lint:dirs   ; echo $?
EXIT=0
✓ 插件目录结构合规(2 条历史 baseline 白名单已豁免)   ✅
```

### R3 已实测（Commander 已做）：path alias `@shared/intents` 工作正常 ✅

### `src/main/app.ts` ctx 6 个原有字段确认

读 `src/main/app.ts:39-46` 实测：

```ts
const ctx = {
  getMainWindow,              // line 40
  openCompanion: openRightSlot,        // line 41
  ensureCompanion: openRightSlot,      // line 42
  getSlotBySenderId,                   // line 43
  getActiveViewWebContentsIds,         // line 44
  runWithProgress,                     // line 45
};
```

✅ 6 个原有字段全在，与 task-card § J2c 列表完全一致。

### `src/shared/plugin-types.ts` PluginContext 接口

实测 `src/shared/plugin-types.ts:9-34`：含 6 字段（`getMainWindow` / `openCompanion` / `ensureCompanion` / `getSlotBySenderId` / `getActiveViewWebContentsIds` / `runWithProgress`），**不含** `dispatch` 字段。

按 task-card 预期歧义 Q1 答案：J2 隐含追加 `dispatch: (event: IntentEvent) => void` + import IntentEvent。

### 缺失目录确认

```bash
$ ls src/capabilities src/renderer/ui-primitives src/main/workspace/intent-dispatcher.ts 2>&1
ls: src/capabilities: No such file or directory
ls: src/main/workspace/intent-dispatcher.ts: No such file or directory
ls: src/renderer/ui-primitives: No such file or directory
```

✅ 三个目标位置都不存在，符合 task-card "本阶段创建" 假设。

### R4 已 grep 验证（Commander 已做）：18 个含特权 API 调用文件不动 ✅
### R5：v1 单例无调用方是预期占位骨架，不擅自加调用示例 ✅
### R6：`src/main/app.ts:2` 已 import `openRightSlot`，本阶段不动 ✅

## 识别到的歧义/冲突

### BLOCKING

无。

### NON-BLOCKING

1. **J6 文件计数 9 vs 10 的字面**：task-card § J6 字面"含且仅含 9 个文件"，但 J2 隐含 plugin-types.ts 改动（Q1 已答需追加 dispatch 字段）使总数变 10。BUILDER-INSTRUCTION § 三 步骤 4 已明示"J2 隐含的 plugin-types.ts 改动让总数变 10，这是 task-card 预期歧义 Q1 答案的自然结果——record 在 G 段"。按字面记 G 段说明 9→10。
2. **R5 占位骨架 vs J7b "778 problems 与基线一致"**：v1 创建的单例（intentDispatcher / commandRegistry / 5 个 *Registry）虽在新文件中导出但无调用方，理论上 ESLint 可能触发"unused-vars"等警告。但 eslint.config.mjs 已配 `@typescript-eslint/no-unused-vars: 'off'`（阶段 00 J2 降噪），不影响 lint 错误数。预期 778 持平。

## 我的下一步
- [x] 无 BLOCKING：进入执行阶段
- 计划 commit 拆分（按 BUILDER-INSTRUCTION § 三 步骤 3）：
  - J1: `feat(refactor/platform-skeleton): 新建 main/workspace/intent-dispatcher`
  - J2: `feat(refactor/platform-skeleton): app.ts ctx 加 dispatch + plugin-types 同步`（含 plugin-types.ts dispatch 字段）
  - J3: `feat(refactor/platform-skeleton): renderer/ui-primitives/command-registry`
  - J4: `feat(refactor/platform-skeleton): 5 个 ui-primitives 子目录骨架`
  - J5: `feat(refactor/platform-skeleton): src/capabilities/ 占位 README`
- 每个 J 完成后 typecheck exit 0 验证
- 完成后 J6/J7/J8 + 写 builder-report
