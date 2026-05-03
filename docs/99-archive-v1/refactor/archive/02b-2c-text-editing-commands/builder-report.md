# Builder 完成报告：refactor/text-editing-commands（阶段 02b-2c-text-editing-commands，02b 系列收尾）

**任务卡**：`docs/refactor/stages/02b-2c-text-editing-commands/task-card.md`
**契约**：N/A（基础设施类阶段，临时引用 plugin 模式）
**HEAD**：`3ce1759a`
**派活基线 SHA**：`fe219294`（task-card § J4 强制对账标准）
**完成时间**：2026-05-02
**阶段定位**：**02b 系列收尾**

---

## A. 完成判据逐条核对（共 17 子项）

| 判据 | 状态 | 证据 |
|---|---|---|
| **J1**：`text-editing/index.ts` 字节级匹配 task-card § J1 | ✅ | commit `237c6cd0`，84 行（53 → 84，+49/-20） |
| **J1 子项**：6 段 import 顺序严格 | ✅ | `index.ts:1-15`：Capability+ConverterPair+CommandHandler / Atom / PMNode / converterRegistry / blockRegistry / 8 命令 |
| **J1 子项**：8 命令引入顺序严格 | ✅ | `index.ts:7-14`：toggleMarkCommand → applyLink → removeLink → indentBlockAt → outdentBlockAt → setTextAlign → insertInlineMath → deleteCurrentBlock |
| **J1 子项**：textEditingCommands 模块级 const，命名空间 `text-editing.<kebab-case>` | ✅ | `index.ts:51-67`：8 entry，全部 `text-editing.*` key |
| **J1 子项**：8 命令均 `as CommandHandler` 断言 | ✅ | `grep "as CommandHandler" index.ts` 输出 8 行 |
| **J1 子项**：5 字段顺序 id → schema → converters → createInstance → commands；createInstance = undefined | ✅ | `index.ts:69-83`：顺序与 task-card § J1 完全一致；`createInstance: undefined` |
| **J1 子项**：文件无任何 `// eslint-disable-...` 注释 | ✅ | `grep eslint-disable` 输出空 |
| **J2**：`text-editing/README.md` 仅"## 当前状态"段被改 | ✅ | commit `92259296`，diff +13/-9 |
| **J2 子项**：标题 = "## 当前状态(阶段 02b-2c-text-editing-commands,02b 系列收尾)" | ✅ | `text-editing/README.md:5` |
| **J2 子项**：其他 4 段字节不变 | ✅ | § B 字节对账 |
| **J3**：`capabilities/README.md` 仅"## 当前状态"段被改 | ✅ | commit `3ce1759a`，diff +9/-6 |
| **J3 子项**：标题 = "## 当前状态(阶段 02b-2c-text-editing-commands,02b 系列收尾)" | ✅ | `capabilities/README.md:5` |
| **J3 子项**：4 SHA 引用全嵌入 `256ec984 + 16ca2454 + a315e7e0 + 237c6cd0` | ✅ | `capabilities/README.md:8`，`grep -E "256ec984.*16ca2454.*a315e7e0.*237c6cd0"` 输出 1 行 |
| **J4**：`git diff fe219294..HEAD --stat` Builder 修改 3 文件 | ✅ | 3 个 Builder 文件 + 4 个 Commander 派活 docs（§ B "J4 范围核对"） |
| **J5a**：`npm run typecheck` exit 0 | ✅ | 实测 EXIT=0 |
| **J5b**：`npm run lint` exit 1，errors=765 / warnings=15 严格 = 02b-2b baseline | ✅ | 实测 `✖ 780 problems (765 errors, 15 warnings)` ——R3 吸收 02a G1 教训持续生效 |
| **J5c**：`npm run lint:dirs` exit 0 | ✅ | 实测 EXIT=0，"2 条历史 baseline 白名单已豁免" |
| **J6**：commit message 符合 `feat/docs(refactor/text-editing-commands): ...` | ✅ | 3 条全合规 |
| **J7**：`find src/capabilities -type d` 仅 2 个目录 | ✅ | `src/capabilities` + `src/capabilities/text-editing` |
| **J8**：`find src/capabilities -type f` 仅 3 个文件 | ✅ | README.md / text-editing/README.md / text-editing/index.ts |

## B. 范围核对与字节对账

### J2 字节对账（`text-editing/README.md` 其他 4 段未动）

`cat src/capabilities/text-editing/README.md` 全文实测：
- 行 1-3：`# capability.text-editing` 标题段（含短介绍） — **字节未变** ✅
- 行 5-20：`## 当前状态(阶段 02b-2c-text-editing-commands,02b 系列收尾)` 段 — **本次 J2 改动**
- 行 22-27：`## 设计原则(总纲引用)` 段 — **字节未变** ✅
- 行 29-34：`## 主要消费视图(预期)` 段 — **字节未变** ✅
- 行 36-50：`## 02b-2 之后的目录结构(预期)` 段（含 code block + 末段） — **字节未变** ✅

### J3 字节对账（`capabilities/README.md` 其他 3 段未动）

`cat src/capabilities/README.md` 全文实测：
- 行 1-3：`# Capabilities` 标题段（含短介绍） — **字节未变** ✅
- 行 5-15：`## 当前状态(阶段 02b-2c-text-editing-commands,02b 系列收尾)` 段（含 4 SHA + 跳过原因 + 临时引用模式说明） — **本次 J3 改动**
- 行 17-23：`## 设计原则` 段（4 条 § 引用） — **字节未变** ✅
- 行 25-29：`## 不在本目录的实现` 段（3 条引用） — **字节未变** ✅

### J4 范围核对（强制双点 diff + 显式基线 SHA）

```bash
$ git diff fe219294..HEAD --stat
.../02b-2c-text-editing-commands/AUDITOR-INSTRUCTION.md   | 227  ← Commander 派活 commit 0e0a8453
.../02b-2c-text-editing-commands/BUILDER-INSTRUCTION.md   | 215  ← 同上
.../02b-2c-text-editing-commands/README.md                | 110  ← 同上
.../02b-2c-text-editing-commands/task-card.md             | 299  ← 同上
src/capabilities/README.md                                |  15  ← Builder J3 (+9/-6)
src/capabilities/text-editing/README.md                   |  22  ← Builder J2 (+13/-9)
src/capabilities/text-editing/index.ts                    |  69  ← Builder J1 (+49/-20)
7 files changed, 922 insertions(+), 35 deletions(-)
```

**Builder 修改的 3 个文件**：完全匹配 task-card § J4 字面清单。**4 个 docs 文件**：来自 Commander 派活 commit `0e0a8453`（task-card 自身 + AUDITOR/BUILDER-INSTRUCTION + README）。

## C. 范围越界自检

- ✅ 仅修改 task-card 列出的 3 个文件
- ✅ 没动 `src/plugins/note/` 任何文件（capability 仅引用，不修改 plugin —— task-card 严禁顺手做第 1 条）
- ✅ 没动 5 处外部调用方（保持 02b-2b 约束）
- ✅ 没修 graph atom-bridge.ts 跨插件违规（留波次 3）
- ✅ 没尝试实现 createInstance 字段（task-card R7 + Q4 已答 = undefined）
- ✅ 没搬任何 commands/ 文件
- ✅ 没引入 AI / Thought / Markdown / Frame 等领域命令（避免跨域）
- ✅ 没创建 `text-editing/` 下其他文件
- ✅ 没创建任何 `src/capabilities/<其他>/` 子目录
- ✅ 没动业务代码 / 阶段 01/02a/02b-1/02b-2a/02b-2b 已落核心文件除 capability 内的 index.ts/README.md 外
- ✅ 没动 ESLint / tsconfig.json / package.json / schema-* / memory
- ✅ J1 字节级照抄（含中文注释字符 + 6 段 import 顺序 + 8 命令引入顺序），无 `eslint-disable-...` 注释
- ✅ J2/J3 用 Edit 精准修改，其他段字节验证

## D. 提交清单

| # | SHA | Message |
|---|---|---|
| 1 | `237c6cd0` | `feat(refactor/text-editing-commands): textEditingCapability commands 临时引用 plugin (02b 系列收尾)` |
| 2 | `92259296` | `docs(refactor/text-editing-commands): text-editing/README.md 同步状态` |
| 3 | `3ce1759a` | `docs(refactor/text-editing-commands): capabilities/README.md 同步状态` |

总 diff（仅 Builder 改动，相对派活基线 `fe219294`，去除 4 个 docs）：+71 / -35（3 文件，全为修改无新增）

## E. 待 Commander 安排的事

1. 调度 Auditor 审计本分支（**02b 系列收尾**审计）
2. Auditor 完成后用户拍板 merge：
   ```bash
   git checkout main
   git merge refactor/text-editing-commands --no-ff -m "Merge refactor/text-editing-commands — 阶段 02b-2c text-editing commands 临时引用(02b 系列收尾)"
   ```
3. **02b-3+ 起草**：下一个 capability（如 canvas-interaction / web-rendering）按相同四段式（skeleton → fields → bridge → commands）落地，textEditingCapability 已建样板
4. createInstance 留波次 3 note 整体迁移时一并抽工厂

## F. 我没做但 task-card 要求的事

无。J1~J8 全完成。

## G. 自行决断的边界（NON-BLOCKING 歧义）

无 NON-BLOCKING 歧义。task-card 5 条预期歧义（Q1~Q5）全已答；R1~R8 全已答；模板 R3 已吸收 02a G1 + 02b-1/2a/2b R5 教训。本阶段简单（3 文件改动），无字面 vs 实质分歧。**连续第四次零 NON-BLOCKING**（02b-1 / 02b-2a / 02b-2b / 02b-2c）。

### 实施观察 1：lint 严格 765e + 15w（连续第四次）

| 阶段 | lint problems | errors | warnings |
|---|---|---|---|
| 02a 完成 | 780 | 765 | 15 |
| 02b-1 完成 | 780 | 765 | 15 |
| 02b-2a 完成 | 780 | 765 | 15 |
| 02b-2b 完成 | 780 | 765 | 15 |
| **02b-2c（本阶段）** | **780** | **765** | **15** |

完全持平。task-card § J5b 严格判据"errors=765 / warnings=15"再次成立。**§ 六新纪律 5/6 + R3 吸收 02a G1 教训持续稳定生效**。

### 实施观察 2：4 SHA 嵌入 J3 README

按 task-card § J3 字面要求 + BUILDER-INSTRUCTION § 四 提醒 6：
- 02b-1 commit `256ec984`（02b-1 落地保留）
- 02b-2a commit `16ca2454`（02b-2a 落地保留）
- 02b-2b commit `a315e7e0`（02b-2b 落地保留）
- 02b-2c J1 commit `237c6cd0`（本次新嵌入）

Auditor 可通过：
```bash
grep -E "256ec984.*16ca2454.*a315e7e0.*237c6cd0" src/capabilities/README.md
```
验证 4 SHA 引用同时存在（实测命中 1 行）。

### 实施观察 3：02b 系列收尾——textEditingCapability 4/5 字段最终态

| 字段 | 状态 | 阶段 |
|------|------|------|
| `id` | ✅ `'capability.text-editing'` | 02b-1 |
| `schema` | ✅ 临时引用 `blockRegistry` | 02b-2b |
| `converters` | ✅ ConverterPair 适配 `converterRegistry` | 02b-2b |
| `commands` | ✅ 8 个命令临时引用（本阶段） | **02b-2c** |
| `createInstance` | ⏳ undefined | 留波次 3 |

**临时引用模式四段式样板成型**：skeleton（02b-1 实例化） → fields（02b-2a 占位） → bridge（02b-2b schema/converters） → commands（02b-2c）。createInstance 因 NoteEditor.tsx React 深度耦合无法临时引用，被推到波次 3 note 整体迁移——**这一发现是 02b 系列的重要副产品**，验证了"临时引用模式"的边界。

### 实施观察 4：commands 命令选择硬约束落实

task-card R6 + Q1 答案"全部 8 个引入,不允许 Builder 自决增减"严格执行：

```ts
// 8 entry 完全 = task-card 字面
'text-editing.toggle-mark': toggleMarkCommand as CommandHandler,
'text-editing.apply-link': applyLink as CommandHandler,
'text-editing.remove-link': removeLink as CommandHandler,
'text-editing.indent-block': indentBlockAt as CommandHandler,
'text-editing.outdent-block': outdentBlockAt as CommandHandler,
'text-editing.set-text-align': setTextAlign as CommandHandler,
'text-editing.insert-inline-math': insertInlineMath as CommandHandler,
'text-editing.delete-current-block': deleteCurrentBlock as CommandHandler,
```

不引入 AI / Thought / Markdown / Frame 等命令——避免 capability.text-editing 跨域。命令 key 命名空间符合总纲 § 5.5 强约束第 4 条（`text-editing.<kebab-case>`，无需 `capability.` 前缀）。

---

## J5 最终验证完整输出（Auditor 对账用）

```bash
$ npm run typecheck && echo $?
0   (J5a ✅)

$ npm run lint > /dev/null 2>&1; echo $?
1   (J5b exit ✅)
$ npm run lint 2>&1 | grep "✖" | tail -1
✖ 780 problems (765 errors, 15 warnings)   (J5b 严格 ✅ — errors=765, warnings=15)

$ npm run lint:dirs && echo $?
✓ 插件目录结构合规(2 条历史 baseline 白名单已豁免,详见脚本注释)
0   (J5c ✅)

$ find src/capabilities -type d
src/capabilities
src/capabilities/text-editing      (J7 ✅ 2 dirs)

$ find src/capabilities -type f
src/capabilities/README.md
src/capabilities/text-editing/README.md
src/capabilities/text-editing/index.ts      (J8 ✅ 3 files)
```

---

## Commander merge 命令清单（Builder 不擅自执行）

```bash
git checkout main
git status                  # 应当干净
git merge refactor/text-editing-commands --no-ff -m "Merge refactor/text-editing-commands — 阶段 02b-2c text-editing commands 临时引用(02b 系列收尾)"

# 验证 merge 后
npm run typecheck    # 预期 EXIT=0
npm run lint         # 预期 EXIT=1, 780 problems (765e/15w 持平 02b-2b baseline)
npm run lint:dirs    # 预期 EXIT=0, 白名单豁免

# 不立即 push,等用户拍板
```
