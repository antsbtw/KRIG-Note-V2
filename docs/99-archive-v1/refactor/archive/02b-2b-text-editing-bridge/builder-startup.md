# Builder 启动自检：refactor/text-editing-bridge（阶段 02b-2b-text-editing-bridge）

## 已读输入
- ✅ 总纲 v2.3 § 2 + § 5.4 + § 5.8（同会话已读）
- ✅ CLAUDE.md（含重构期硬规则，阶段 01 已落）
- ✅ 阶段目录 `docs/refactor/stages/02b-2b-text-editing-bridge/`：
  - ✅ README.md
  - ✅ task-card.md
  - ✅ BUILDER-INSTRUCTION.md
  - ⛔️ AUDITOR-INSTRUCTION.md（按指令不读）
- ✅ BUILDER-PROMPT（同会话已读）
- ✅ 数据契约引用：`src/shared/ui-primitives.ts`（Capability + ConverterPair，仅引用）
- ✅ 修改对象（02b-2a 已落）：
  - `src/capabilities/text-editing/index.ts`（34 行，5 字段 = id + 4 undefined 占位）
  - `src/capabilities/text-editing/README.md`（5 个段）
  - `src/capabilities/README.md`（4 个段）
- ✅ 引用对象（plugin 内现有单例，不修改）：
  - `src/plugins/note/converters/registry.ts:326` `export const converterRegistry`
  - `src/plugins/note/registry.ts:222` `export const blockRegistry`
- ✅ 功能契约：N/A
- ✅ 目标分支：`refactor/text-editing-bridge`，HEAD = `46b3d36a`，工作树干净
- ✅ 派活基线 SHA：`eab6a95a`（task-card § J4 强制对账标准）

## 本次 task-card 完成判据复述（共 16 子项）

- **J1**：`text-editing/index.ts` 字节级匹配 task-card § J1
- **J1 子项**：5 行 import 顺序严格（Capability+ConverterPair / Atom / PMNode / converterRegistry / blockRegistry）
- **J1 子项**：5 字段顺序 id → schema → converters → createInstance → commands
- **J1 子项**：schema = blockRegistry / converters = textEditingConverters / createInstance = undefined / commands = undefined
- **J1 子项**：文件无任何 `// eslint-disable-...` 注释
- **J2**：`text-editing/README.md` 仅"## 当前状态"段被改
- **J2 子项**：标题 = "## 当前状态(阶段 02b-2b-text-editing-bridge)"
- **J2 子项**：其他 4 段字节不变
- **J3**：`capabilities/README.md` 仅"## 当前状态"段被改；其他段字节不变
- **J3 子项**：标题 = "## 当前状态(阶段 02b-2b-text-editing-bridge)"
- **J3 子项**：三 SHA 引用 `02b-1 256ec984 + 02b-2a 16ca2454 + 02b-2b <J1>`
- **J4**：`git diff eab6a95a..HEAD --stat` 含且仅含 3 文件
- **J5a**：`npm run typecheck` exit 0
- **J5b**：`npm run lint` exit 1，errors=765 / warnings=15 严格 = 02b-2a baseline
- **J5c**：`npm run lint:dirs` exit 0
- **J6**：commit message 符合 `feat/docs(refactor/text-editing-bridge): ...` 格式
- **J7**：`find src/capabilities -type d` 仅 2 dirs
- **J8**：`find src/capabilities -type f` 仅 3 files

## 契约 § B 防御代码 grep 验证

本次为基础设施类阶段，无功能契约，跳过。

## 基线确认

```bash
$ npm run typecheck   ; echo $?
EXIT=0   ✅

$ npm run lint        ; echo $?
EXIT=1
✖ 780 problems (765 errors, 15 warnings)   ✅ = 02b-2a baseline

$ npm run lint:dirs   ; echo $?
EXIT=0   ✅

$ wc -l src/capabilities/text-editing/index.ts
34   ✅ 02b-2a 落地态(id + 4 undefined)

$ grep export src/plugins/note/{registry.ts,converters/registry.ts} | grep -E "(blockRegistry|converterRegistry)"
src/plugins/note/registry.ts:222:export const blockRegistry = ...
src/plugins/note/converters/registry.ts:326:export const converterRegistry = ...
✅ 两个单例都存在
```

## 识别到的歧义/冲突

### BLOCKING

无。

### NON-BLOCKING

无（task-card 5 条预期歧义全已答 + R1~R6 全已答 + 模板 R3 已吸收 02a G1 教训）。

## 我的下一步
- [x] 无 BLOCKING：进入执行阶段
- 计划 commit 拆分（task-card Q4 答 Builder 自决，建议 3 个）：
  - J1: `feat(refactor/text-editing-bridge): textEditingCapability schema/converters 临时引用 plugin`
  - J2: `docs(refactor/text-editing-bridge): text-editing/README.md 同步状态`
  - J3: `docs(refactor/text-editing-bridge): capabilities/README.md 同步状态`
- 每个 J 完成后 typecheck exit 0 验证
- 完成后 J4/J5/J6/J7/J8 + 写 builder-report
