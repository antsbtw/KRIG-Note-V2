# 阶段 B4a — 统一 blockquote / list 的递归模型（①② 设计冲突）

> 指挥交接 prompt。完成后由指挥（另一对话）验收。**依赖 B2+B3 已合并。风险最高——这不是简单合并，是①②语义冲突的取舍，会改变 AI 提取输出结构。**

## 背景（必读）

- `docs/00-architecture/import-to-note-convergence.md`（阶段 B）
- `docs/00-architecture/krig-markdown-dialect-spec.md`

**这是 B 阶段最险的一批**，因为 blockquote/list 在 ①② 是**设计冲突、方向相反**（不是谁包含谁）：

- **blockquote**：① 是 **inline-only**（`> text` → blockquote>paragraph>inline，不支持内嵌 code/math，`result-parser.ts:152-189`）；② 是 **递归任意 block**（剥 `>` 后递归 markdownToProseMirror，内可含 code/math/heading，`md-to-pm.ts:288-305`，CommonMark 兼容）。
- **list**：**恰好反过来**——① 的 listItem **支持内嵌 block**（math/code/image/table，`result-parser.ts:557-683` collectListItemContent + `blocks-to-pm-doc.ts:237-256` 递归）；② 是 **单行简单**（逐行剥标记→单 paragraph，无嵌套，`md-to-pm.ts:328-359`）。

统一意味着**至少一侧的输出结构要变**，直接触碰对应路径（blockquote 变→影响两条路径；list 变→影响两条路径）。这是回归红线。

## 目标

把 blockquote + list 收进 markdownCore，统一成**唯一递归模型**。但**采哪套语义需指挥先拍板**（见下）。

## 第一步：先出方案，不要直接改（硬要求）

先做**调研 + 方案**，产出一份「blockquote/list 统一方案」交指挥拍板，**方案通过前不改代码**：

1. blockquote 采「① inline-only」还是「② 递归任意 block」？（倾向 ② CommonMark 兼容，但要评估：AI 提取的 blockquote 变递归后，现有 AI 输出的 blockquote 节点结构变不变？多数 AI blockquote 是纯文本→输出不变，但要确认。）
2. list 采「① 支持内嵌 block」还是「② 单行」？（倾向 ① 更强，但要评估 ② 那两条路径——文件导入/剪藏的 list 变成支持嵌套后，普通单行 list 输出变不变？）
3. 递归如何进核而不破坏「核纯 sync」——blockquote/list 内容递归调 markdownCore 是 sync 的（无 async），可行；但要确认无循环递归风险（② 已有防缩进无限递归的处理 `trimStart`，参考）。
4. 给出每类的「改动前后输出结构对比」+「哪条路径会受影响 + 如何验回归」。

**把方案发给指挥**，指挥拍板采哪套语义后，再进第二步实现。

## 第二步：实现（方案通过后）

按拍板的语义把 blockquote+list 进核，①② 都改调核。递归内容调 markdownCore（sync）。

## 铁律边界

1. 核纯 sync（递归调核仍 sync，无 async）。
2. 只碰 blockquote + list（含 bullet/ordered/task）。其余 block（B1/B2/B3 已做）不碰。
3. **输出结构变更必须显式**：哪套语义赢、哪条路径的输出会变，写清楚，且实机验回归（不能像 B1 那样"提前升级"不打招呼）。
4. **不废 ExtractedBlock**——那是 B4b。本任务只统一 blockquote/list 解析。

## 验收标准（交给指挥核对）

- [ ] **第一步方案已交指挥拍板**（有对比表 + 回归影响分析），且实现符合拍板结果。
- [ ] blockquote + list 进核，①② 都改调核，递归调核仍 sync。
- [ ] 只碰 blockquote/list；ExtractedBlock 未废。
- [ ] 契约测试覆盖：blockquote 内嵌 block（若采②）、list 内嵌 block（若采①）、task list、嵌套 list。
- [ ] **四路径回归**（blockquote/list 是高频 block，AI提取/文件导入/剪藏/Word 都要验），说明手验步骤。
- [ ] tsc 干净；测试全绿。
- [ ] 分支 `feat/markdown-core-b4a`（B3 合并后拉）；提交规范 + Co-Authored-By；**不要 push**。

## 给指挥的验收自检点

- **有没有先出方案让我拍板**（这是硬要求，直接改代码=流程违规）。
- 采的语义和我拍板一致吗；输出结构变更有没有如实说明（不许悄悄改 AI 输出）。
- 递归有没有引入 async（破核纯度）或无限递归。
- 四路径回归验没验（blockquote/list 太高频，回归影响大）。
