# Builder 启动自检：refactor/shape-library（阶段 02b-5-shape-library，资源访问型 capability 首次落地）

## 已读输入
- ✅ 总纲 v2.3 § 5.4 + § 5.9 + § 2（同会话已读）
- ✅ CLAUDE.md（含重构期硬规则）
- ✅ 阶段目录 `docs/refactor/stages/02b-5-shape-library/`：
  - ✅ README.md
  - ✅ task-card.md
  - ✅ BUILDER-INSTRUCTION.md
  - ⛔️ AUDITOR-INSTRUCTION.md（按指令不读）
- ✅ BUILDER-PROMPT（同会话已读）
- ✅ 数据契约引用：`src/shared/ui-primitives.ts`（Capability + SchemaContribution=unknown）
- ✅ 02b-3/02b-4 样板参考：`src/capabilities/{pdf-rendering, epub-rendering}/index.ts`（实例工厂型对比）
- ✅ 修改对象：`src/capabilities/README.md`（4 段，J3 仅改"## 当前状态"段）
- ✅ 新建对象：`src/capabilities/shape-library/{index.ts, README.md}`（J1/J2）
- ✅ 引用对象（plugin，不修改）：
  - `src/plugins/graph/library/shapes/registry.ts:export const ShapeRegistry`
  - `src/plugins/graph/library/substances/registry.ts:export const SubstanceRegistry`
- ✅ 功能契约：N/A
- ✅ 目标分支：`refactor/shape-library`，HEAD = `4f190c06`，工作树干净
- ✅ 派活基线 SHA：`9e9c7a9a`（task-card § J4）

## 本次 task-card 完成判据复述（共 18 子项）

- **J1**：`shape-library/index.ts` 字节级匹配 task-card § J1
- **J1 子项**：3 行 import 顺序严格（Capability / ShapeRegistry / SubstanceRegistry）
- **J1 子项**：`shapeLibrarySchema` 模块级 const，聚合对象 `{ shapes, substances }`
- **J1 子项**：5 字段顺序 id → schema → converters → createInstance → commands
- **J1 子项**：schema = shapeLibrarySchema（模块级 const 引用，不内联）
- **J1 子项**：3 字段值严格 `undefined`（converters/createInstance/commands）
- **J1 子项**：无 `// eslint-disable-...` 注释
- **J1 子项**：shapeLibrarySchema 不需要 as 断言
- **J2**：`shape-library/README.md` 字节级匹配 task-card § J2
- **J2 子项**：含资源访问型 vs 实例工厂型设计差异表
- **J3**：`capabilities/README.md` 仅"## 当前状态"段被改；其他段字节不变
- **J3 子项**：标题 = "## 当前状态(阶段 02b-5-shape-library)"
- **J3 子项**：7 SHA 全嵌入（4 text-editing + 1 pdf + 1 epub + 1 shape）
- **J3 子项**：含三种 capability 形态分类说明（**资源访问型(首次落地)**）
- **J3 子项**：含插件 capability 化进度（ebook 全 + graph 首个 + note 1 个）
- **J4**：`git diff 9e9c7a9a..HEAD --stat` 含且仅含 3 文件
- **J5a**：typecheck exit 0
- **J5b**：lint exit 1 / 780=765e+15w 严格 = 02b-4 baseline
- **J5c**：lint:dirs exit 0
- **J6**：commit message `feat/docs(refactor/shape-library): ...`
- **J7**：`find src/capabilities -type d` 输出 5 行
- **J8**：`find src/capabilities -type f` 输出 9 行

## 契约 § B 防御代码 grep 验证

本次为基础设施类阶段，无功能契约，跳过。

## 基线确认

```bash
$ npm run typecheck   ; echo $?
EXIT=0   ✅

$ npm run lint        ; echo $?
EXIT=1
✖ 780 problems (765 errors, 15 warnings)   ✅ = 02b-4 baseline

$ npm run lint:dirs   ; echo $?
EXIT=0   ✅

$ ls src/capabilities/shape-library 2>&1 | head -1
ls: src/capabilities/shape-library: No such file or directory   ✅ task-card 假设吻合

$ grep "^export const ShapeRegistry" src/plugins/graph/library/shapes/registry.ts
export const ShapeRegistry = new ShapeRegistryImpl();   ✅
$ grep "^export const SubstanceRegistry" src/plugins/graph/library/substances/registry.ts
export const SubstanceRegistry = new SubstanceRegistryImpl();   ✅
```

## 识别到的歧义/冲突

### BLOCKING

无。

### NON-BLOCKING

无（task-card 6 条预期歧义 Q1~Q6 全已答；R1~R8 全已答；模板 R3 已吸收 02a G1 + 02b-1/2a/2b/2c/3/4 R5 教训）。本阶段是 capability 第三种形态（资源访问型）首次落地，task-card 字面已字节级给出 J1 模板（含 3 行 import + 模块级 const + 5 字段顺序）。

## 我的下一步
- [x] 无 BLOCKING：进入执行阶段
- 计划 commit 拆分（task-card Q6 答 Builder 自决，建议 3 个）：
  - J1: `feat(refactor/shape-library): shapeLibraryCapability 资源访问型 capability 首次落地`
  - J2: `docs(refactor/shape-library): shape-library/README.md`
  - J3: `docs(refactor/shape-library): capabilities/README.md 同步状态(资源访问型首次落地)`
- 每个 J 完成后 typecheck exit 0 验证
- 完成后 J4/J5/J6/J7/J8 + 写 builder-report
