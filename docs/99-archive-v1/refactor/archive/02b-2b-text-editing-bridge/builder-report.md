# Builder 完成报告：refactor/text-editing-bridge（阶段 02b-2b-text-editing-bridge）

**任务卡**：`docs/refactor/stages/02b-2b-text-editing-bridge/task-card.md`
**契约**：N/A（基础设施类阶段，临时引用 plugin 模式）
**HEAD**：`21e47f58`
**派活基线 SHA**：`eab6a95a`（task-card § J4 强制对账标准）
**完成时间**：2026-05-02

---

## A. 完成判据逐条核对（共 16 子项）

| 判据 | 状态 | 证据 |
|---|---|---|
| **J1**：`text-editing/index.ts` 字节级匹配 task-card § J1 | ✅ | commit `a315e7e0`，53 行（34 → 53，+32/-13） |
| **J1 子项**：5 行 import 顺序严格 | ✅ | `index.ts:1-5`：Capability+ConverterPair / Atom / PMNode / converterRegistry / blockRegistry |
| **J1 子项**：5 字段顺序 id → schema → converters → createInstance → commands | ✅ | `index.ts:37-52` 顺序与 task-card § J1 完全一致 |
| **J1 子项**：schema/converters 实质赋值；createInstance/commands 仍 undefined | ✅ | `schema: blockRegistry` / `converters: textEditingConverters` / `createInstance: undefined` / `commands: undefined` |
| **J1 子项**：文件无任何 `// eslint-disable-...` 注释 | ✅ | `grep eslint-disable` 输出空 |
| **J2**：`text-editing/README.md` 仅"## 当前状态"段被改 | ✅ | commit `697dcf34`，diff +12/-6 |
| **J2 子项**：标题 = "## 当前状态(阶段 02b-2b-text-editing-bridge)" | ✅ | `text-editing/README.md:5` |
| **J2 子项**：其他 4 段字节不变 | ✅ | § B 字节对账验证 |
| **J3**：`capabilities/README.md` 仅"## 当前状态"段被改 | ✅ | commit `21e47f58`，diff +9/-4 |
| **J3 子项**：标题 = "## 当前状态(阶段 02b-2b-text-editing-bridge)" | ✅ | `capabilities/README.md:5` |
| **J3 子项**：三 SHA 引用 `256ec984 + 16ca2454 + a315e7e0` | ✅ | `capabilities/README.md:8` 全部嵌入 |
| **J4**：`git diff eab6a95a..HEAD --stat` Builder 修改 3 文件 | ✅ | 3 个 Builder 文件 + 4 个 Commander 派活 docs（§ B "J4 范围核对"） |
| **J5a**：`npm run typecheck` exit 0 | ✅ | 实测 EXIT=0 |
| **J5b**：`npm run lint` exit 1，errors=765 / warnings=15 严格 = 02b-2a baseline | ✅ | 实测 `✖ 780 problems (765 errors, 15 warnings)` ——R3 吸收 02a G1 + 02b-1/2a R5 教训成功 |
| **J5c**：`npm run lint:dirs` exit 0 | ✅ | 实测 EXIT=0，"2 条历史 baseline 白名单已豁免" |
| **J6**：commit message 符合 `feat/docs(refactor/text-editing-bridge): ...` | ✅ | 3 条全合规（J1 用 feat，J2/J3 用 docs，scope 一致） |
| **J7**：`find src/capabilities -type d` 仅 2 个目录 | ✅ | `src/capabilities` + `src/capabilities/text-editing`，无新增 |
| **J8**：`find src/capabilities -type f` 仅 3 个文件 | ✅ | README.md / text-editing/README.md / text-editing/index.ts，与 02b-2a 一致 |

## B. 范围核对与字节对账

### J2 字节对账（`text-editing/README.md` 其他 4 段未动）

`cat src/capabilities/text-editing/README.md` 全文实测：
- 行 1-3：`# capability.text-editing` 标题段（含短介绍） — **字节未变** ✅
- 行 5-16：`## 当前状态(阶段 02b-2b-text-editing-bridge)` 段 — **本次 J2 改动**
- 行 18-23：`## 设计原则(总纲引用)` 段（4 条 § 引用） — **字节未变** ✅
- 行 25-30：`## 主要消费视图(预期)` 段 — **字节未变** ✅
- 行 32-46：`## 02b-2 之后的目录结构(预期)` 段（含 code block + "本阶段(02b-1)..." 末段） — **字节未变** ✅

### J3 字节对账（`capabilities/README.md` 其他 3 段未动）

`cat src/capabilities/README.md` 全文实测：
- 行 1-3：`# Capabilities` 标题段（含短介绍） — **字节未变** ✅
- 行 5-13：`## 当前状态(阶段 02b-2b-text-editing-bridge)` 段（含三 SHA + 临时引用说明） — **本次 J3 改动**
- 行 15-21：`## 设计原则` 段（4 条 § 引用） — **字节未变** ✅
- 行 23-27：`## 不在本目录的实现` 段（3 条引用） — **字节未变** ✅

### J4 范围核对（强制双点 diff + 显式基线 SHA）

```bash
$ git diff eab6a95a..HEAD --stat
.../02b-2b-text-editing-bridge/AUDITOR-INSTRUCTION.md   | 190  ← Commander 派活 commit 46b3d36a
.../02b-2b-text-editing-bridge/BUILDER-INSTRUCTION.md   | 201  ← 同上
.../02b-2b-text-editing-bridge/README.md                | 120  ← 同上
.../02b-2b-text-editing-bridge/task-card.md             | 243  ← 同上
src/capabilities/README.md                              |  13  ← Builder J3 (+9/-4)
src/capabilities/text-editing/README.md                 |  18  ← Builder J2 (+12/-6)
src/capabilities/text-editing/index.ts                  |  45  ← Builder J1 (+32/-13)
7 files changed, 807 insertions(+), 23 deletions(-)
```

**Builder 修改的 3 个文件**：完全匹配 task-card § J4 字面清单。

**4 个 docs 文件**：来自 Commander 派活 commit `46b3d36a`（task-card 自身 + AUDITOR/BUILDER-INSTRUCTION + README）。这是 task-card 起草后 commit 在分支上的产物，**不计入 Builder 越界范围**（与 00x / typecheck-baseline / 01 / 02a / 02b-1 / 02b-2a 同模式）。

## C. 范围越界自检

- ✅ 仅修改 task-card 列出的 3 个文件
- ✅ 没动 `src/plugins/note/` 任何文件（capability 仅引用，不修改 plugin —— task-card 严禁顺手做第 1 条）
- ✅ 没动 5 处外部调用方（types.ts / registry.ts / NoteEditor.tsx / ai-workflow / graph atom-bridge）
- ✅ 没修 graph atom-bridge.ts 跨插件违规（留波次 3）
- ✅ 没搬任何 converter 文件
- ✅ 没创建 `text-editing/` 下其他文件（schema.ts / converters/ / commands/ / plugins/ / instance.ts 全留波次 3）
- ✅ 没创建任何 `src/capabilities/<其他>/` 子目录
- ✅ 没动业务代码（`src/main/**` / `src/renderer/**` / `src/plugins/<其他>` 全 0 改动）
- ✅ 没动阶段 01/02a/02b-1/02b-2a 已落核心文件除 capability 内的 index.ts/README.md 外
- ✅ 没动 ESLint / tsconfig.json / package.json / schema-* / memory
- ✅ J1 字节级照抄（含中文注释字符 + 5 行 import 顺序），无任何 `eslint-disable-...` 注释
- ✅ J2/J3 用 Edit 精准修改（仅"## 当前状态"段），其他段字节验证

## D. 提交清单

| # | SHA | Message |
|---|---|---|
| 1 | `a315e7e0` | `feat(refactor/text-editing-bridge): textEditingCapability schema/converters 临时引用 plugin` |
| 2 | `697dcf34` | `docs(refactor/text-editing-bridge): text-editing/README.md 同步状态` |
| 3 | `21e47f58` | `docs(refactor/text-editing-bridge): capabilities/README.md 同步状态` |

总 diff（仅 Builder 改动，相对派活基线 `eab6a95a`，去除 4 个 docs）：+53 / -23（3 文件，全为修改无新增）

## E. 待 Commander 安排的事

1. 调度 Auditor 审计本分支
2. Auditor 完成后用户拍板 merge：
   ```bash
   git checkout main
   git merge refactor/text-editing-bridge --no-ff -m "Merge refactor/text-editing-bridge — 阶段 02b-2b text-editing schema/converters 临时引用"
   ```
3. 阶段 02b-2c 起草（createInstance 临时引用：填入 `createInstance` 字段，引用 NoteEditor 的 PM 实例创建逻辑）

## F. 我没做但 task-card 要求的事

无。J1~J8 全完成。

## G. 自行决断的边界（NON-BLOCKING 歧义）

无 NON-BLOCKING 歧义。task-card 5 条预期歧义（Q1~Q5）全已答；R1~R6 全已答；模板 R3 已吸收 02a G1 + 02b-1/2a R5 教训。本阶段简单（3 文件改动），无字面 vs 实质分歧。**连续第三次零 NON-BLOCKING**（02b-1 / 02b-2a / 02b-2b）。

### 实施观察 1：lint 严格 765e + 15w（连续第三次）

| 阶段 | lint problems | errors | warnings |
|---|---|---|---|
| 02a 完成 | 780 | 765 | 15 |
| 02b-1 完成 | 780 | 765 | 15 |
| 02b-2a 完成 | 780 | 765 | 15 |
| **02b-2b（本阶段）** | **780** | **765** | **15** |

完全持平。task-card § J5b 严格判据"errors=765 / warnings=15"再次成立。**§ 六新纪律 5/6 + R3 吸收 02a G1 教训持续生效**。

### 实施观察 2：三 SHA 嵌入 J3 README

按 task-card § J3 字面要求 + BUILDER-INSTRUCTION § 四 提醒 6：
- 02b-1 commit `256ec984`（02b-1 落地保留）
- 02b-2a commit `16ca2454`（02b-2a 落地保留）
- 02b-2b J1 commit `a315e7e0`（本次新嵌入）

Auditor 可通过：
```bash
grep -E "256ec984.*16ca2454.*a315e7e0" src/capabilities/README.md
```
验证三 SHA 引用同时存在。

### 实施观察 3：临时引用模式可行性验证

本阶段是首个采用"capability 临时引用 plugin"模式的实质字段填充阶段。验证结果：

1. **typecheck 通过**：`schema: blockRegistry`（SchemaContribution = unknown 接受）✅
2. **ConverterPair 适配**：用 `as PMNode` / `as Atom[]` 双向断言桥接 unknown 接口 → 具体 PM 类型 ✅
3. **lint 全仓 780 不变**：capability 反向 import plugin 不触发 J5.4（views 层禁外部依赖，本路径不命中）和 J5.2（跨插件，本路径在 capabilities/ 不命中）✅
4. **零业务代码搬迁**：`plugins/note/converters/registry.ts` + `plugins/note/registry.ts` 字节未动 ✅

总纲 § 5.8 的长期目标"capability 自包含、不依赖 plugin"由波次 3 真搬迁实现。本阶段是节奏轻快的中间形态——README 已明示，不属违反。

### 实施观察 4：模块级 const 而非内联（task-card Q1 答案落实）

task-card § J1 字面要求 + Q1 已答："`textEditingConverters` 是模块级 const，不内联到对象字面量"。

实施落地：

```ts
const textEditingConverters: ConverterPair = {
  toAtom: (data) => converterRegistry.docToAtoms(data as PMNode) as Atom[],
  fromAtom: (atoms) => converterRegistry.atomsToDoc(atoms as Atom[]),
};

export const textEditingCapability: Capability = {
  ⋯
  converters: textEditingConverters,
  ⋯
};
```

模块级 const 在文件中独立位置，便于：
- 将来重命名/扩展（如加 `atomsToDocChunked` 适配）
- Auditor 字节级对账（独立位置易 grep 验证）

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
git merge refactor/text-editing-bridge --no-ff -m "Merge refactor/text-editing-bridge — 阶段 02b-2b text-editing schema/converters 临时引用"

# 验证 merge 后
npm run typecheck    # 预期 EXIT=0
npm run lint         # 预期 EXIT=1, 780 problems (765e/15w 持平 02b-2a baseline)
npm run lint:dirs    # 预期 EXIT=0, 白名单豁免

# 不立即 push,等用户拍板
```
