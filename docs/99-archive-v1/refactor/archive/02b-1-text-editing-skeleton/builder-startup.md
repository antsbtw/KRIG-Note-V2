# Builder 启动自检：refactor/text-editing-skeleton（阶段 02b-1-text-editing-skeleton）

## 已读输入
- ✅ 总纲 v2.3 § 1.3 / § 5.4 / § 5.9（同会话已读）
- ✅ CLAUDE.md（含重构期硬规则段，阶段 01 已落）
- ✅ 阶段目录 `docs/refactor/stages/02b-1-text-editing-skeleton/`：
  - ✅ README.md
  - ✅ task-card.md
  - ✅ BUILDER-INSTRUCTION.md
  - ⛔️ AUDITOR-INSTRUCTION.md（按指令不读）
- ✅ BUILDER-PROMPT（同会话已读）
- ✅ 数据契约引用：`src/shared/ui-primitives.ts`（Capability 接口，阶段 01 已落，仅引用）
- ✅ 现状参考：`src/capabilities/README.md`（25 行，含 4 段：`# Capabilities` / `## 当前状态(阶段 02a-...)` / `## 设计原则` / `## 不在本目录的实现`）
- ✅ 功能契约：N/A
- ✅ 目标分支：`refactor/text-editing-skeleton`，HEAD = `0b91bf37`，工作树干净
- ✅ 派活基线 SHA：`5b478326`（用户给定 + task-card 列出，task-card § J4 强制对账标准）

## 本次 task-card 完成判据复述（共 11 子项）

- **J1**：`src/capabilities/text-editing/index.ts` 字节级匹配 task-card § J1（仅 id 字段的 textEditingCapability）
- **J2**：`src/capabilities/text-editing/README.md` 字节级匹配 task-card § J2
- **J3**：`src/capabilities/README.md` 仅"## 当前状态"段被改；其他 3 段字节不变
- **J3 子项**：修改后段含 `text-editing/` 列表项 + J1 commit SHA（前 8 位）
- **J4**：`git diff 5b478326..HEAD --stat` 含且仅含 3 个文件（双点 + 显式 SHA）
- **J5a**：`npm run typecheck` exit 0
- **J5b**：`npm run lint` exit 1，errors 765 不变 + warnings 15 不变（02b R5 已注 task-card 模板不含 disable 注释，无 02a 那种 +2 warning）
- **J5c**：`npm run lint:dirs` exit 0
- **J6**：commit message 符合 `feat/docs(refactor/text-editing-skeleton): ...`
- **J7**：`find src/capabilities -type d` = `src/capabilities` + `src/capabilities/text-editing`
- **J8**：`find src/capabilities -type f` = 3 个文件

## 契约 § B 防御代码 grep 验证

本次为基础设施类阶段，无功能契约，跳过。

## 基线确认（task-card § R6 + § J5）

```bash
$ npm run typecheck   ; echo $?
EXIT=0   ✅

$ npm run lint        ; echo $?
EXIT=1
✖ 780 problems (765 errors, 15 warnings)   ✅ 与 02a 完成时一致

$ npm run lint:dirs   ; echo $?
EXIT=0   ✅

$ ls src/capabilities/text-editing
ls: src/capabilities/text-editing: No such file or directory   ✅ task-card 假设吻合

$ ls src/capabilities/
README.md   ✅ 仅 02a 落地的 README.md
```

## 识别到的歧义/冲突

### BLOCKING

无。

### NON-BLOCKING

无（task-card 4 条预期歧义全已答 + R1~R6 全已答）。

## 我的下一步
- [x] 无 BLOCKING：进入执行阶段
- 计划 commit 拆分（task-card Q4 答 Builder 自决，建议 3 个）：
  - J1: `feat(refactor/text-editing-skeleton): textEditingCapability 最小骨架`
  - J2: `feat(refactor/text-editing-skeleton): text-editing/README.md`
  - J3: `docs(refactor/text-editing-skeleton): capabilities/README.md 同步状态`
- 每个 J 完成后 typecheck exit 0 验证
- 完成后 J4/J5/J6/J7/J8 + 写 builder-report
