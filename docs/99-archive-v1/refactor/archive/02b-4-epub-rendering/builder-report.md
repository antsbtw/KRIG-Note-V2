# Builder 完成报告：refactor/epub-rendering（阶段 02b-4-epub-rendering，实例工厂型样板巩固）

**任务卡**：`docs/refactor/stages/02b-4-epub-rendering/task-card.md`
**契约**：N/A（基础设施类阶段，临时引用 plugin 模式）
**HEAD**：`7857812d`
**派活基线 SHA**：`bad4d4ea`（task-card § J4 强制对账标准）
**完成时间**：2026-05-02
**阶段定位**：**实例工厂型 capability 样板巩固**（连续第二次）

---

## A. 完成判据逐条核对（共 17 子项）

| 判据 | 状态 | 证据 |
|---|---|---|
| **J1**：`epub-rendering/index.ts` 字节级匹配 task-card § J1 | ✅ | commit `7f8a9a2b`，53 行 |
| **J1 子项**：2 行 import 顺序严格 | ✅ | `index.ts:1-2`：Capability+CapabilityInstance+CapabilityOptions+HostElement / EPUBRenderer |
| **J1 子项**：`epubRenderingCreateInstance` 模块级 const，参数前缀 `_host`/`_options` | ✅ | `index.ts:30-36` |
| **J1 子项**：5 字段顺序 id → schema → converters → createInstance → commands | ✅ | `index.ts:38-52` |
| **J1 子项**：4 字段值严格 `undefined`（schema/converters/commands） | ✅ | `index.ts:42 / 45 / 51` 显式 `undefined` |
| **J1 子项**：createInstance = epubRenderingCreateInstance（模块级 const） | ✅ | `index.ts:48` 引用模块级 const，未内联 |
| **J1 子项**：`as CapabilityInstance` 断言保留 | ✅ | `index.ts:34` `new EPUBRenderer() as CapabilityInstance` |
| **J1 子项**：文件无任何 `// eslint-disable-...` 注释 | ✅ | `grep eslint-disable` 输出空 |
| **J2**：`epub-rendering/README.md` 字节级匹配 task-card § J2 | ✅ | commit `857dc874`，50 行，含 7 段 |
| **J3**：`capabilities/README.md` 仅"## 当前状态"段被改 | ✅ | commit `7857812d`，diff +11/-5 |
| **J3 子项**：标题 = "## 当前状态(阶段 02b-4-epub-rendering)" | ✅ | `capabilities/README.md:5` |
| **J3 子项**：6 SHA 全嵌入 | ✅ | text-editing 4 SHA + pdf 1 SHA + epub 1 SHA：`256ec984` / `16ca2454` / `a315e7e0` / `237c6cd0` / `add19d46` / `7f8a9a2b` |
| **J3 子项**：含三个 capability 列表 | ✅ | `capabilities/README.md:7-19`：text-editing / pdf-rendering / epub-rendering |
| **J4**：`git diff bad4d4ea..HEAD --stat` 含且仅含 3 个 Builder 文件 | ✅ | 3 个 Builder 文件 + 4 个 Commander 派活 docs（§ B） |
| **J5a**：`npm run typecheck` exit 0 | ✅ | 实测 EXIT=0 |
| **J5b**：`npm run lint` exit 1，errors=765 / warnings=15 严格 = 02b-3 baseline | ✅ | 实测 `✖ 780 problems (765 errors, 15 warnings)` |
| **J5c**：`npm run lint:dirs` exit 0 | ✅ | 实测 EXIT=0，"2 条历史 baseline 白名单已豁免" |
| **J6**：commit message 符合 `feat/docs(refactor/epub-rendering): ...` | ✅ | 3 条全合规（J1 用 feat，J2/J3 用 docs） |
| **J7**：`find src/capabilities -type d` 输出 4 行 | ✅ | `src/capabilities` + 3 个 capability |
| **J8**：`find src/capabilities -type f` 输出 7 行 | ✅ | 根 README + 3 capability 各 2 文件 |

## B. 范围核对

### J4 范围核对（强制双点 diff + 显式基线 SHA）

```bash
$ git diff bad4d4ea..HEAD --stat
.../02b-4-epub-rendering/AUDITOR-INSTRUCTION.md   | 230  ← Commander 派活 commit b1d0b994
.../02b-4-epub-rendering/BUILDER-INSTRUCTION.md   | 214  ← 同上
.../02b-4-epub-rendering/README.md                | 141  ← 同上
.../02b-4-epub-rendering/task-card.md             | 303  ← 同上
src/capabilities/README.md                        |  16  ← Builder J3 (+11/-5)
src/capabilities/epub-rendering/README.md         |  50  ← Builder J2(新建)
src/capabilities/epub-rendering/index.ts          |  53  ← Builder J1(新建)
7 files changed, 1002 insertions(+), 5 deletions(-)
```

**Builder 改动的 3 个文件**：完全匹配 task-card § J4 字面清单。**4 个 docs 文件**：来自 Commander 派活 commit `b1d0b994`。

### J3 字节对账（`capabilities/README.md` 其他 3 段未动）

`cat src/capabilities/README.md` 全文实测：
- 行 1-3：`# Capabilities` 标题段（含短介绍） — **字节未变** ✅
- 行 5-29：`## 当前状态(阶段 02b-4-epub-rendering)` 段（含 3 capability 列表 + 6 SHA + 形态分类 + ebook 全 capability 化说明 + 临时引用模式说明） — **本次 J3 改动**
- 行 31-37：`## 设计原则` 段（4 条 § 引用） — **字节未变** ✅
- 行 39-43：`## 不在本目录的实现` 段（3 条引用） — **字节未变** ✅

## C. 范围越界自检

- ✅ 仅改 task-card 列出的 3 个文件（2 新建 + 1 修改）
- ✅ 没动 `src/plugins/ebook/` 任何文件（capability 仅引用 EPUBRenderer 类，不修改 plugin —— task-card 严禁顺手做第 1 条）
- ✅ 没动 `plugins/ebook/renderers/epub/foliate-js.d.ts` 类型声明
- ✅ 没动 `plugins/ebook/components/EBookView.tsx` 等视图入口
- ✅ 没动 `plugins/ebook/renderers/index.ts` createRenderer 工厂
- ✅ 没动 02b-text-editing / 02b-pdf-rendering 已落 capability 文件（仅更新 capabilities/README.md）
- ✅ 没创建 `epub-rendering/` 下其他文件（renderer.ts 等留波次 3）
- ✅ 没创建任何 `src/capabilities/<其他>/` 子目录
- ✅ 没动业务代码 / 阶段 01/02a/02b-* 已落核心文件除 capabilities/README.md 外
- ✅ 没动 ESLint / tsconfig.json / package.json / schema-* / memory
- ✅ J1 字节级照抄（含中文注释字符 + 2 行 import + 参数前缀 _），无 `eslint-disable-...` 注释
- ✅ J2 字节级照抄（7 段全部对齐）
- ✅ J3 用 Edit 精准修改（仅"## 当前状态"段），其他段字节验证

## D. 提交清单

| # | SHA | Message |
|---|---|---|
| 1 | `7f8a9a2b` | `feat(refactor/epub-rendering): epubRenderingCapability 实例工厂型 capability 一阶段完成` |
| 2 | `857dc874` | `docs(refactor/epub-rendering): epub-rendering/README.md` |
| 3 | `7857812d` | `docs(refactor/epub-rendering): capabilities/README.md 同步状态(实例工厂型样板巩固)` |

总 diff（仅 Builder 改动，相对派活基线 `bad4d4ea`，去除 4 个 docs）：+114 / -5（3 文件，2 新建 + 1 修改）

## E. 待 Commander 安排的事

1. 调度 Auditor 审计本分支
2. Auditor 完成后用户拍板 merge：
   ```bash
   git checkout main
   git merge refactor/epub-rendering --no-ff -m "Merge refactor/epub-rendering — 阶段 02b-4 epub-rendering 实例工厂型样板巩固"
   ```
3. **02b-5+ 起草**：下一个 capability（按形态分类样板：shape-library 实例工厂型 / canvas-interaction 复合型 / web-rendering 复合型 等）

## F. 我没做但 task-card 要求的事

无。J1~J8 全完成。

## G. 自行决断的边界（NON-BLOCKING 歧义）

无 NON-BLOCKING 歧义。task-card 6 条预期歧义（Q1~Q6）全已答；R1~R8 全已答；模板 R3 已吸收 02a G1 + 02b-1/2a/2b/2c/3 R5 教训。本阶段简单（3 文件改动），无字面 vs 实质分歧。**连续第六次零 NON-BLOCKING**（02b-1 / 02b-2a / 02b-2b / 02b-2c / 02b-3 / 02b-4）。

### 实施观察 1：lint 严格 765e + 15w（连续第六次）

| 阶段 | lint problems | errors | warnings |
|---|---|---|---|
| 02a 完成 | 780 | 765 | 15 |
| 02b-1 完成 | 780 | 765 | 15 |
| 02b-2a 完成 | 780 | 765 | 15 |
| 02b-2b 完成 | 780 | 765 | 15 |
| 02b-2c 完成 | 780 | 765 | 15 |
| 02b-3 完成 | 780 | 765 | 15 |
| **02b-4（本阶段）** | **780** | **765** | **15** |

完全持平。task-card § J5b 严格判据"errors=765 / warnings=15"再次成立。**§ 六新纪律 5/6 + R3 吸收 02a G1 教训持续稳定生效**。

### 实施观察 2：6 SHA 嵌入 J3 README

按 task-card § J3 字面要求 + BUILDER-INSTRUCTION § 四 提醒 7：
- text-editing 4 SHA: `256ec984` / `16ca2454` / `a315e7e0` / `237c6cd0`
- pdf-rendering 1 SHA: `add19d46`
- epub-rendering 1 SHA: `7f8a9a2b`（本次）

Auditor 可通过：
```bash
grep -c "256ec984\|16ca2454\|a315e7e0\|237c6cd0\|add19d46\|7f8a9a2b" src/capabilities/README.md
# 预期 ≥ 6
```

### 实施观察 3：实例工厂型样板巩固——连续两次落地

本阶段是 02b-3 的完美姊妹，验证形态分类样板可稳定复用：

| 维度 | 02b-3 pdf-rendering | **02b-4 epub-rendering** |
|---|---|---|
| 形态 | 实例工厂型（首次） | **实例工厂型（巩固）** |
| 字段 | id + createInstance + 3 undefined | **同 02b-3** |
| 复杂度 | 一阶段完成 3 文件 | **同 02b-3** |
| import 数量 | 2 行 | **2 行** |
| 工厂 const 行数 | 7 行（const + body） | **7 行** |
| capability 字段顺序 | id → schema → converters → createInstance → commands | **完全相同** |
| README 段数 | 6 段 | **7 段（多"实现差异对比"）** |

**架构决策完全沿用 02b-3**：参数前缀 `_` / 模块级 const / `as` 断言 / 4 字段 `undefined` / 临时引用模式。**仅字面替换**：pdf→epub / PDFRenderer→EPUBRenderer / pdfjs-dist→foliate-js / IFixedPageRenderer→IReflowableRenderer / 5 SHA→6 SHA。

### 实施观察 4：EPUBRenderer 内部实现差异完全被封装

EPUBRenderer 与 PDFRenderer 实现差异（README 表格列出）：
- import 方式：动态 `await import('foliate-js/view.js')` vs 静态 `import * as pdfjsLib from 'pdfjs-dist'`
- 类型声明：`foliate-js.d.ts`（11 行 ambient module）vs 无独立 .d.ts
- Web Component：`customElements.define('foliate-view', View)` vs 无

但 capability 文件 `epub-rendering/index.ts` 仅 `new EPUBRenderer()`——**完全不感知**这些差异。这正是临时引用模式的隔离价值（task-card R8）：实现细节封装在类内，capability 接口对调用方稳定。Builder 在 capability 代码中**未处理**任何 foliate-js / customElements 细节。

### 实施观察 5：ebook 插件全部 capability 化里程碑

完成本阶段后，ebook 插件的两个渲染器都已对应 capability 化（仍是临时引用，真搬迁推到波次 3）：

| 插件渲染器 | Capability | 状态 |
|---|---|---|
| `plugins/ebook/renderers/pdf` | `capability.pdf-rendering` | ✅ 02b-3 |
| `plugins/ebook/renderers/epub` | `capability.epub-rendering` | ✅ **02b-4** |

ebook 插件成为首个全部 capability 化的 plugin（按 capability 维度，而非整个 plugin 搬迁）。

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
src/capabilities/epub-rendering
src/capabilities/text-editing                (J7 ✅ 4 dirs)

$ find src/capabilities -type f
src/capabilities/README.md
src/capabilities/pdf-rendering/README.md
src/capabilities/pdf-rendering/index.ts
src/capabilities/epub-rendering/README.md
src/capabilities/epub-rendering/index.ts
src/capabilities/text-editing/README.md
src/capabilities/text-editing/index.ts        (J8 ✅ 7 files)
```

---

## Commander merge 命令清单（Builder 不擅自执行）

```bash
git checkout main
git status                  # 应当干净
git merge refactor/epub-rendering --no-ff -m "Merge refactor/epub-rendering — 阶段 02b-4 epub-rendering 实例工厂型样板巩固"

# 验证 merge 后
npm run typecheck    # 预期 EXIT=0
npm run lint         # 预期 EXIT=1, 780 problems (765e/15w 持平 02b-3 baseline)
npm run lint:dirs    # 预期 EXIT=0, 白名单豁免

# 不立即 push,等用户拍板
```
