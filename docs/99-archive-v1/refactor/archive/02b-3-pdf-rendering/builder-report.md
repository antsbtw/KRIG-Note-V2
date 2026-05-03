# Builder 完成报告：refactor/pdf-rendering（阶段 02b-3-pdf-rendering，实例工厂型 capability 首次落地）

**任务卡**：`docs/refactor/stages/02b-3-pdf-rendering/task-card.md`
**契约**：N/A（基础设施类阶段，临时引用 plugin 模式）
**HEAD**：`84e57bba`
**派活基线 SHA**：`c0d0851b`（task-card § J4 强制对账标准）
**完成时间**：2026-05-02
**阶段定位**：**实例工厂型 capability 首次落地** + capability 形态分类样板

---

## A. 完成判据逐条核对（共 17 子项）

| 判据 | 状态 | 证据 |
|---|---|---|
| **J1**：`pdf-rendering/index.ts` 字节级匹配 task-card § J1 | ✅ | commit `add19d46`，53 行 |
| **J1 子项**：2 行 import 顺序严格 | ✅ | `index.ts:1-2`：Capability+CapabilityInstance+CapabilityOptions+HostElement / PDFRenderer |
| **J1 子项**：`pdfRenderingCreateInstance` 模块级 const，参数前缀 `_host`/`_options` | ✅ | `index.ts:30-36` |
| **J1 子项**：5 字段顺序 id → schema → converters → createInstance → commands | ✅ | `index.ts:38-52` |
| **J1 子项**：4 字段值严格 `undefined`（schema/converters/commands） | ✅ | `index.ts:42 / 45 / 51` 显式 `undefined` |
| **J1 子项**：createInstance = pdfRenderingCreateInstance（模块级 const） | ✅ | `index.ts:48` 引用模块级 const，未内联 |
| **J1 子项**：`as CapabilityInstance` 断言保留 | ✅ | `index.ts:34` `new PDFRenderer() as CapabilityInstance` |
| **J1 子项**：文件无任何 `// eslint-disable-...` 注释 | ✅ | `grep eslint-disable` 输出空 |
| **J2**：`pdf-rendering/README.md` 字节级匹配 task-card § J2 | ✅ | commit `a0c91b91`，49 行，含 7 段（标题 / 当前状态 / 形态对比 / 设计原则 / 主要消费视图 / 临时引用模式说明 / 与 02b-text-editing 关键差异） |
| **J3**：`capabilities/README.md` 仅"## 当前状态"段被改 | ✅ | commit `84e57bba`，diff +17/-10 |
| **J3 子项**：标题 = "## 当前状态(阶段 02b-3-pdf-rendering)" | ✅ | `capabilities/README.md:5` |
| **J3 子项**：5 SHA 全嵌入（4 text-editing + 1 pdf-rendering） | ✅ | `capabilities/README.md:10`（4 text-editing：256ec984 + 16ca2454 + a315e7e0 + 237c6cd0）+ `:14`（add19d46）|
| **J3 子项**：含两种 capability 形态分类说明 | ✅ | `capabilities/README.md:17-19`：复合型 / 实例工厂型 |
| **J4**：`git diff c0d0851b..HEAD --stat` 含且仅含 3 个 Builder 文件 | ✅ | 3 个 Builder 文件 + 4 个 Commander 派活 docs（§ B "J4 范围核对"） |
| **J5a**：`npm run typecheck` exit 0 | ✅ | 实测 EXIT=0 |
| **J5b**：`npm run lint` exit 1，errors=765 / warnings=15 严格 = 02b-2c baseline | ✅ | 实测 `✖ 780 problems (765 errors, 15 warnings)` ——R3 吸收 02a G1 教训持续生效 |
| **J5c**：`npm run lint:dirs` exit 0 | ✅ | 实测 EXIT=0，"2 条历史 baseline 白名单已豁免" |
| **J6**：commit message 符合 `feat/docs(refactor/pdf-rendering): ...` | ✅ | 3 条全合规（J1 用 feat，J2/J3 用 docs，scope 一致） |
| **J7**：`find src/capabilities -type d` 输出 3 行 | ✅ | `src/capabilities` + `src/capabilities/pdf-rendering` + `src/capabilities/text-editing` |
| **J8**：`find src/capabilities -type f` 输出 5 行 | ✅ | 根 README + 2 个 capability 各 2 文件 |

## B. 范围核对

### J4 范围核对（强制双点 diff + 显式基线 SHA）

```bash
$ git diff c0d0851b..HEAD --stat
.../02b-3-pdf-rendering/AUDITOR-INSTRUCTION.md   | 209  ← Commander 派活 commit de0b1e5a
.../02b-3-pdf-rendering/BUILDER-INSTRUCTION.md   | 201  ← 同上
.../02b-3-pdf-rendering/README.md                | 127  ← 同上
.../02b-3-pdf-rendering/task-card.md             | 287  ← 同上
src/capabilities/README.md                       |  27  ← Builder J3 (+17/-10)
src/capabilities/pdf-rendering/README.md         |  49  ← Builder J2(新建)
src/capabilities/pdf-rendering/index.ts          |  53  ← Builder J1(新建)
7 files changed, 943 insertions(+), 10 deletions(-)
```

**Builder 改动的 3 个文件**：完全匹配 task-card § J4 字面清单。**4 个 docs 文件**：来自 Commander 派活 commit `de0b1e5a`（task-card 自身 + AUDITOR/BUILDER-INSTRUCTION + README）。

### J3 字节对账（`capabilities/README.md` 其他 3 段未动）

`cat src/capabilities/README.md` 全文实测：
- 行 1-3：`# Capabilities` 标题段（含短介绍） — **字节未变** ✅
- 行 5-22：`## 当前状态(阶段 02b-3-pdf-rendering)` 段（含 2 capability 列表 + 5 SHA + 形态分类 + 临时引用说明） — **本次 J3 改动**
- 行 24-30：`## 设计原则` 段（4 条 § 引用） — **字节未变** ✅
- 行 32-36：`## 不在本目录的实现` 段（3 条引用） — **字节未变** ✅

## C. 范围越界自检

- ✅ 仅改 task-card 列出的 3 个文件（2 新建 + 1 修改）
- ✅ 没动 `src/plugins/ebook/` 任何文件（capability 仅引用 PDFRenderer 类，不修改 plugin —— task-card 严禁顺手做第 1 条）
- ✅ 没动 `plugins/ebook/components/EBookView.tsx` 等视图入口
- ✅ 没动 02b-text-editing 已落 capability 文件（仅更新 capabilities/README.md）
- ✅ 没创建 `pdf-rendering/` 下其他文件（renderer.ts 等留波次 3）
- ✅ 没创建任何 `src/capabilities/<其他>/` 子目录
- ✅ 没动业务代码 / 阶段 01/02a/02b-* 已落核心文件除 capabilities/README.md 外
- ✅ 没动 ESLint / tsconfig.json / package.json / schema-* / memory
- ✅ J1 字节级照抄（含中文注释字符 + 2 行 import + 参数前缀 _），无 `eslint-disable-...` 注释
- ✅ J2 字节级照抄（7 段全部对齐）
- ✅ J3 用 Edit 精准修改（仅"## 当前状态"段），其他段字节验证

## D. 提交清单

| # | SHA | Message |
|---|---|---|
| 1 | `add19d46` | `feat(refactor/pdf-rendering): pdfRenderingCapability 实例工厂型 capability 一阶段完成` |
| 2 | `a0c91b91` | `docs(refactor/pdf-rendering): pdf-rendering/README.md` |
| 3 | `84e57bba` | `docs(refactor/pdf-rendering): capabilities/README.md 同步状态(实例工厂型首次落地)` |

总 diff（仅 Builder 改动，相对派活基线 `c0d0851b`，去除 4 个 docs）：+119 / -10（3 文件，2 新建 + 1 修改）

## E. 待 Commander 安排的事

1. 调度 Auditor 审计本分支
2. Auditor 完成后用户拍板 merge：
   ```bash
   git checkout main
   git merge refactor/pdf-rendering --no-ff -m "Merge refactor/pdf-rendering — 阶段 02b-3 pdf-rendering 实例工厂型 capability 首次落地"
   ```
3. **02b-4+ 起草**：下一个 capability（按形态分类样板：canvas-interaction 复合型 / shape-library 实例工厂型 / web-rendering 复合型 等）

## F. 我没做但 task-card 要求的事

无。J1~J8 全完成。

## G. 自行决断的边界（NON-BLOCKING 歧义）

无 NON-BLOCKING 歧义。task-card 5 条预期歧义（Q1~Q5）全已答；R1~R7 全已答；模板 R3 已吸收 02a G1 + 02b-1/2a/2b/2c R5 教训。本阶段简单（3 文件改动），无字面 vs 实质分歧。**连续第五次零 NON-BLOCKING**（02b-1 / 02b-2a / 02b-2b / 02b-2c / 02b-3）。

### 实施观察 1：lint 严格 765e + 15w（连续第五次）

| 阶段 | lint problems | errors | warnings |
|---|---|---|---|
| 02a 完成 | 780 | 765 | 15 |
| 02b-1 完成 | 780 | 765 | 15 |
| 02b-2a 完成 | 780 | 765 | 15 |
| 02b-2b 完成 | 780 | 765 | 15 |
| 02b-2c 完成 | 780 | 765 | 15 |
| **02b-3（本阶段）** | **780** | **765** | **15** |

完全持平。task-card § J5b 严格判据"errors=765 / warnings=15"再次成立。**§ 六新纪律 5/6 + R3 吸收 02a G1 教训持续稳定生效**。

### 实施观察 2：5 SHA 嵌入 J3 README

按 task-card § J3 字面要求 + BUILDER-INSTRUCTION § 四 提醒 7：
- text-editing 4 SHA: `256ec984` / `16ca2454` / `a315e7e0` / `237c6cd0`
- pdf-rendering 1 SHA: `add19d46`

Auditor 可通过：
```bash
grep -c "256ec984\|16ca2454\|a315e7e0\|237c6cd0\|add19d46" src/capabilities/README.md
# 预期 ≥ 5
```

### 实施观察 3：实例工厂型 capability 首次落地 + 两种形态对比验证

本阶段是 **02b 系列首个非 text-editing capability** + **首个实例工厂型 capability**。落地后形成两种形态对比样板：

| 形态 | 字段填充 | 已落地 | 后续候选 |
|------|---------|--------|---------|
| **复合型** | schema + converters + commands | text-editing ✅（02b 系列收尾）| canvas-interaction / web-rendering 等 |
| **实例工厂型** | 仅 createInstance | **pdf-rendering ✅（本阶段）** | epub-rendering / shape-library / elk-layout 等 |

**关键认知验证**：
- **复合型**：依赖现有 plugin 单例（如 blockRegistry / converterRegistry / 8 命令）声明意图
- **实例工厂型**：直接包装纯 class（PDFRenderer 零 React 依赖）为 createInstance 工厂——弥补 02b 系列 createInstance 跳过的遗憾

这一对比验证了"临时引用模式"的边界（task-card R7）：纯 class 实现可临时引用 createInstance；React 深度耦合的实例创建（如 NoteEditor.tsx）不可——必须等真搬迁（波次 3）。

### 实施观察 4：参数前缀 `_host` `_options` 表明未使用

按 task-card R6 + Q1 答案，`pdfRenderingCreateInstance` 参数前缀 `_` 严格保留：

```ts
const pdfRenderingCreateInstance = (
  _host: HostElement,
  _options: CapabilityOptions,
): CapabilityInstance => {
  return new PDFRenderer() as CapabilityInstance;
};
```

ESLint 默认配置 `@typescript-eslint/no-unused-vars` 已被阶段 00 J2 设为 `'off'`,但前缀 `_` 仍是 TypeScript/ESLint 惯例（双重保险）。本阶段未使用参数（直接 `new PDFRenderer()`），未来扩展时去掉 `_` 前缀。

### 实施观察 5：实例工厂型可直接落地 createInstance 验证

`pdfRenderingCreateInstance` 工厂内一行 `new PDFRenderer() as CapabilityInstance`——比预想的更简洁。这是因为：

1. PDFRenderer 已实现 `IFixedPageRenderer` 接口（plugin 内部约定）
2. CapabilityInstance = unknown（阶段 01 故意留宽）—— 接受任何 class 实例
3. 临时引用模式无需在 capability 内复刻 PDFRenderer 的初始化逻辑

未来真搬迁（波次 3 ebook 整体迁移）时，只需把 PDFRenderer 类整体搬入 `src/capabilities/pdf-rendering/renderer.ts` + 调整 import 路径。

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
src/capabilities/pdf-rendering
src/capabilities/text-editing                (J7 ✅ 3 dirs)

$ find src/capabilities -type f
src/capabilities/README.md
src/capabilities/pdf-rendering/README.md
src/capabilities/pdf-rendering/index.ts
src/capabilities/text-editing/README.md
src/capabilities/text-editing/index.ts        (J8 ✅ 5 files)
```

---

## Commander merge 命令清单（Builder 不擅自执行）

```bash
git checkout main
git status                  # 应当干净
git merge refactor/pdf-rendering --no-ff -m "Merge refactor/pdf-rendering — 阶段 02b-3 pdf-rendering 实例工厂型 capability 首次落地"

# 验证 merge 后
npm run typecheck    # 预期 EXIT=0
npm run lint         # 预期 EXIT=1, 780 problems (765e/15w 持平 02b-2c baseline)
npm run lint:dirs    # 预期 EXIT=0, 白名单豁免

# 不立即 push,等用户拍板
```
