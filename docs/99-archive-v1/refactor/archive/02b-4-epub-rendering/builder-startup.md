# Builder 启动自检：refactor/epub-rendering（阶段 02b-4-epub-rendering，实例工厂型样板巩固）

## 已读输入
- ✅ 总纲 v2.3 § 5.4 + § 5.9 + § 2（同会话已读）
- ✅ CLAUDE.md（含重构期硬规则）
- ✅ 阶段目录 `docs/refactor/stages/02b-4-epub-rendering/`：
  - ✅ README.md
  - ✅ task-card.md
  - ✅ BUILDER-INSTRUCTION.md
  - ⛔️ AUDITOR-INSTRUCTION.md（按指令不读）
- ✅ BUILDER-PROMPT（同会话已读）
- ✅ 数据契约引用：`src/shared/ui-primitives.ts`（Capability + CapabilityInstance + CapabilityOptions + HostElement）
- ✅ 02b-3 样板参考：`src/capabilities/pdf-rendering/index.ts`（同模式实例工厂型）
- ✅ 修改对象：`src/capabilities/README.md`（4 段，J3 仅改"## 当前状态"段）
- ✅ 新建对象：`src/capabilities/epub-rendering/{index.ts, README.md}`（J1/J2）
- ✅ 引用对象（plugin，不修改）：`src/plugins/ebook/renderers/epub/index.ts` `export class EPUBRenderer implements IReflowableRenderer`
- ✅ 功能契约：N/A
- ✅ 目标分支：`refactor/epub-rendering`，HEAD = `b1d0b994`，工作树干净
- ✅ 派活基线 SHA：`bad4d4ea`（task-card § J4）

## 本次 task-card 完成判据复述（共 17 子项）

- **J1**：`epub-rendering/index.ts` 字节级匹配 task-card § J1
- **J1 子项**：2 行 import 顺序严格（Capability+CapabilityInstance+CapabilityOptions+HostElement / EPUBRenderer）
- **J1 子项**：`epubRenderingCreateInstance` 模块级 const，参数前缀 `_host`/`_options`
- **J1 子项**：5 字段顺序 id → schema → converters → createInstance → commands
- **J1 子项**：4 字段值严格 `undefined`（schema/converters/commands）
- **J1 子项**：createInstance = epubRenderingCreateInstance（模块级 const）
- **J1 子项**：`as CapabilityInstance` 断言保留
- **J1 子项**：无 `// eslint-disable-...` 注释
- **J2**：`epub-rendering/README.md` 字节级匹配 task-card § J2
- **J3**：`capabilities/README.md` 仅"## 当前状态"段被改；其他段字节不变
- **J3 子项**：标题 = "## 当前状态(阶段 02b-4-epub-rendering)"
- **J3 子项**：6 SHA 全嵌入（4 text-editing + 1 pdf + 1 epub）
- **J3 子项**：含三个 capability 列表
- **J4**：`git diff bad4d4ea..HEAD --stat` 含且仅含 3 文件
- **J5a**：typecheck exit 0
- **J5b**：lint exit 1 / 780=765e+15w 严格 = 02b-3 baseline
- **J5c**：lint:dirs exit 0
- **J6**：commit message `feat/docs(refactor/epub-rendering): ...`
- **J7**：`find src/capabilities -type d` 输出 4 行
- **J8**：`find src/capabilities -type f` 输出 7 行

## 契约 § B 防御代码 grep 验证

本次为基础设施类阶段，无功能契约，跳过。

## 基线确认

```bash
$ npm run typecheck   ; echo $?
EXIT=0   ✅

$ npm run lint        ; echo $?
EXIT=1
✖ 780 problems (765 errors, 15 warnings)   ✅ = 02b-3 baseline

$ npm run lint:dirs   ; echo $?
EXIT=0   ✅

$ ls src/capabilities/epub-rendering 2>&1 | head -1
ls: src/capabilities/epub-rendering: No such file or directory   ✅ task-card 假设吻合

$ grep "^export class EPUBRenderer" src/plugins/ebook/renderers/epub/index.ts
export class EPUBRenderer implements IReflowableRenderer {   ✅ class 存在
```

## 识别到的歧义/冲突

### BLOCKING

无。

### NON-BLOCKING

无（task-card 6 条预期歧义全已答 + R1~R8 全已答 + 模板 R3 已吸收 02a G1 教训）。本阶段是 02b-3 的完美姊妹，task-card 字面与 02b-3 高度同构（仅字面替换 pdf→epub / PDFRenderer→EPUBRenderer / 5 SHA→6 SHA / 等）。

## 我的下一步
- [x] 无 BLOCKING：进入执行阶段
- 计划 commit 拆分（task-card Q6 答 Builder 自决，建议 3 个）：
  - J1: `feat(refactor/epub-rendering): epubRenderingCapability 实例工厂型 capability 一阶段完成`
  - J2: `docs(refactor/epub-rendering): epub-rendering/README.md`
  - J3: `docs(refactor/epub-rendering): capabilities/README.md 同步状态(实例工厂型样板巩固)`
- 每个 J 完成后 typecheck exit 0 验证
- 完成后 J4/J5/J6/J7/J8 + 写 builder-report
