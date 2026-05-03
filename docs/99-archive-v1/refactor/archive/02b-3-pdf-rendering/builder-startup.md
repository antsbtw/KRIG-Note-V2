# Builder 启动自检：refactor/pdf-rendering（阶段 02b-3-pdf-rendering，实例工厂型 capability 首次落地)

## 已读输入
- ✅ 总纲 v2.3 § 5.4 + § 5.9 + § 2（同会话已读）
- ✅ CLAUDE.md（含重构期硬规则）
- ✅ 阶段目录 `docs/refactor/stages/02b-3-pdf-rendering/`：
  - ✅ README.md
  - ✅ task-card.md
  - ✅ BUILDER-INSTRUCTION.md
  - ⛔️ AUDITOR-INSTRUCTION.md（按指令不读）
- ✅ BUILDER-PROMPT（同会话已读）
- ✅ 数据契约引用：`src/shared/ui-primitives.ts`（Capability + CapabilityInstance + CapabilityOptions + HostElement）
- ✅ 修改对象：`src/capabilities/README.md`（4 段，J3 仅改"## 当前状态"段）
- ✅ 新建对象：`src/capabilities/pdf-rendering/{index.ts, README.md}`（J1/J2）
- ✅ 引用对象（plugin，不修改）：`src/plugins/ebook/renderers/pdf/index.ts` `export class PDFRenderer implements IFixedPageRenderer`
- ✅ 功能契约：N/A
- ✅ 目标分支：`refactor/pdf-rendering`，HEAD = `de0b1e5a`，工作树干净
- ✅ 派活基线 SHA：`c0d0851b`（task-card § J4）

## 本次 task-card 完成判据复述（共 17 子项）

- **J1**：`pdf-rendering/index.ts` 字节级匹配 task-card § J1
- **J1 子项**：2 行 import 顺序严格（Capability+CapabilityInstance+CapabilityOptions+HostElement / PDFRenderer）
- **J1 子项**：`pdfRenderingCreateInstance` 模块级 const，参数前缀 `_host`/`_options`
- **J1 子项**：5 字段顺序 id → schema → converters → createInstance → commands
- **J1 子项**：4 字段值严格 `undefined`（schema/converters/commands）
- **J1 子项**：createInstance = pdfRenderingCreateInstance（模块级 const）
- **J1 子项**：`as CapabilityInstance` 断言保留
- **J1 子项**：无 `// eslint-disable-...` 注释
- **J2**：`pdf-rendering/README.md` 字节级匹配 task-card § J2
- **J3**：`capabilities/README.md` 仅"## 当前状态"段被改；其他段字节不变
- **J3 子项**：标题 = "## 当前状态(阶段 02b-3-pdf-rendering)"
- **J3 子项**：5 SHA 全嵌入（text-editing 4 SHA + pdf-rendering 1 SHA）
- **J3 子项**：含两种 capability 形态分类说明
- **J4**：`git diff c0d0851b..HEAD --stat` 含且仅含 3 文件
- **J5a**：typecheck exit 0
- **J5b**：lint exit 1 / 780=765e+15w 严格 = 02b-2c baseline
- **J5c**：lint:dirs exit 0
- **J6**：commit message `feat/docs(refactor/pdf-rendering): ...`
- **J7**：`find src/capabilities -type d` 输出 3 行
- **J8**：`find src/capabilities -type f` 输出 5 行

## 契约 § B 防御代码 grep 验证

本次为基础设施类阶段，无功能契约，跳过。

## 基线确认

```bash
$ npm run typecheck   ; echo $?
EXIT=0   ✅

$ npm run lint        ; echo $?
EXIT=1
✖ 780 problems (765 errors, 15 warnings)   ✅ = 02b-2c baseline

$ npm run lint:dirs   ; echo $?
EXIT=0   ✅

$ ls src/capabilities/pdf-rendering 2>&1 | head -1
ls: src/capabilities/pdf-rendering: No such file or directory   ✅ task-card 假设吻合

$ grep "^export class PDFRenderer" src/plugins/ebook/renderers/pdf/index.ts
export class PDFRenderer implements IFixedPageRenderer {   ✅ class 存在
```

## 识别到的歧义/冲突

### BLOCKING

无。

### NON-BLOCKING

无（task-card 5 条预期歧义全已答 + R1~R7 全已答 + 模板 R3 已吸收 02a G1 教训）。

## 我的下一步
- [x] 无 BLOCKING：进入执行阶段
- 计划 commit 拆分（task-card Q5 答 Builder 自决，建议 3 个）：
  - J1: `feat(refactor/pdf-rendering): pdfRenderingCapability 实例工厂型 capability 一阶段完成`
  - J2: `docs(refactor/pdf-rendering): pdf-rendering/README.md`
  - J3: `docs(refactor/pdf-rendering): capabilities/README.md 同步状态(实例工厂型首次落地)`
- 每个 J 完成后 typecheck exit 0 验证
- 完成后 J4/J5/J6/J7/J8 + 写 builder-report
