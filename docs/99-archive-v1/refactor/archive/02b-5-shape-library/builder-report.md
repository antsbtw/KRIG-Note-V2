# Builder 完成报告：refactor/shape-library（阶段 02b-5-shape-library，资源访问型 capability 首次落地）

**任务卡**：`docs/refactor/stages/02b-5-shape-library/task-card.md`
**契约**：N/A（基础设施类阶段，临时引用 plugin 模式）
**HEAD**：`ea39bf1c`
**派活基线 SHA**：`9e9c7a9a`（task-card § J4 强制对账标准）
**完成时间**：2026-05-02
**阶段定位**：**资源访问型 capability 首次落地**（KRIG capability 三种形态样板齐备）

---

## A. 完成判据逐条核对（共 18 子项）

| 判据 | 状态 | 证据 |
|---|---|---|
| **J1**：`shape-library/index.ts` 字节级匹配 task-card § J1 | ✅ | commit `0f2b115a`，60 行 |
| **J1 子项**：3 行 import 顺序严格 | ✅ | `index.ts:1-3`：Capability / ShapeRegistry / SubstanceRegistry |
| **J1 子项**：`shapeLibrarySchema` 模块级 const，聚合对象 `{ shapes, substances }` | ✅ | `index.ts:39-42` |
| **J1 子项**：5 字段顺序 id → schema → converters → createInstance → commands | ✅ | `index.ts:44-59` |
| **J1 子项**：schema = shapeLibrarySchema（模块级 const 引用，不内联） | ✅ | `index.ts:48` 引用模块级 const |
| **J1 子项**：3 字段值严格 `undefined`（converters/createInstance/commands） | ✅ | `index.ts:51 / 54 / 57` 显式 `undefined` |
| **J1 子项**：文件无任何 `// eslint-disable-...` 注释 | ✅ | `grep eslint-disable` 输出空 |
| **J1 子项**：shapeLibrarySchema 不需要 as 断言（直接赋值） | ✅ | `index.ts:48` `schema: shapeLibrarySchema,` 无 `as` 断言；typecheck 通过 |
| **J2**：`shape-library/README.md` 字节级匹配 task-card § J2 | ✅ | commit `654ae88a`，76 行 |
| **J2 子项**：含资源访问型 vs 实例工厂型设计差异表 | ✅ | `README.md:23-31`：5 维度对比表（模式 / 调用方使用 / 字段载体 / 实例化 / 资源生命周期） |
| **J3**：`capabilities/README.md` 仅"## 当前状态"段被改 | ✅ | commit `ea39bf1c`，diff +18/-10 |
| **J3 子项**：标题 = "## 当前状态(阶段 02b-5-shape-library)" | ✅ | `capabilities/README.md:5` |
| **J3 子项**：7 SHA 全嵌入 | ✅ | text-editing 4 + pdf 1 + epub 1 + shape 1：`256ec984` / `16ca2454` / `a315e7e0` / `237c6cd0` / `add19d46` / `7f8a9a2b` / `0f2b115a` |
| **J3 子项**：含三种 capability 形态分类说明（**资源访问型(首次落地)**） | ✅ | `capabilities/README.md:25-28` |
| **J3 子项**：含插件 capability 化进度 | ✅ | `capabilities/README.md:30-33`：ebook 全 + graph 首个 + note 1 个 |
| **J4**：`git diff 9e9c7a9a..HEAD --stat` 含且仅含 3 个 Builder 文件 | ✅ | 3 个 Builder 文件 + 4 个 Commander 派活 docs（§ B） |
| **J5a**：`npm run typecheck` exit 0 | ✅ | 实测 EXIT=0 |
| **J5b**：`npm run lint` exit 1，errors=765 / warnings=15 严格 = 02b-4 baseline | ✅ | 实测 `✖ 780 problems (765 errors, 15 warnings)` |
| **J5c**：`npm run lint:dirs` exit 0 | ✅ | 实测 EXIT=0，"2 条历史 baseline 白名单已豁免" |
| **J6**：commit message 符合 `feat/docs(refactor/shape-library): ...` | ✅ | 3 条全合规（J1 用 feat，J2/J3 用 docs，scope 一致） |
| **J7**：`find src/capabilities -type d` 输出 5 行 | ✅ | `src/capabilities` + 4 个 capability |
| **J8**：`find src/capabilities -type f` 输出 9 行 | ✅ | 根 README + 4 capability 各 2 文件 |

## B. 范围核对

### J4 范围核对（强制双点 diff + 显式基线 SHA）

```bash
$ git diff 9e9c7a9a..HEAD --stat
.../02b-5-shape-library/AUDITOR-INSTRUCTION.md   | 263  ← Commander 派活 commit 4f190c06
.../02b-5-shape-library/BUILDER-INSTRUCTION.md   | 222  ← 同上
.../02b-5-shape-library/README.md                | 155  ← 同上
.../02b-5-shape-library/task-card.md             | 355  ← 同上
src/capabilities/README.md                       |  28  ← Builder J3 (+18/-10)
src/capabilities/shape-library/README.md         |  76  ← Builder J2(新建)
src/capabilities/shape-library/index.ts          |  60  ← Builder J1(新建)
7 files changed, 1149 insertions(+), 10 deletions(-)
```

**Builder 改动的 3 个文件**：完全匹配 task-card § J4 字面清单。**4 个 docs 文件**：来自 Commander 派活 commit `4f190c06`。

### J3 字节对账（`capabilities/README.md` 其他 3 段未动）

`cat src/capabilities/README.md` 全文实测：
- 行 1-3：`# Capabilities` 标题段（含短介绍） — **字节未变** ✅
- 行 5-37：`## 当前状态(阶段 02b-5-shape-library)` 段（含 4 capability 列表 + 7 SHA + 三种形态分类 + 插件进度 + 临时引用模式说明） — **本次 J3 改动**
- 行 39-45：`## 设计原则` 段（4 条 § 引用） — **字节未变** ✅
- 行 47-51：`## 不在本目录的实现` 段（3 条引用） — **字节未变** ✅

## C. 范围越界自检

- ✅ 仅改 task-card 列出的 3 个文件（2 新建 + 1 修改）
- ✅ 没动 `src/plugins/graph/` 任何文件（capability 仅引用 ShapeRegistry / SubstanceRegistry，不修改 plugin —— task-card 严禁顺手做第 1 条）
- ✅ 没动 `plugins/graph/library/` 任何文件（registry / types / index / renderers / __smoke__）
- ✅ 没动 `plugins/graph/canvas/CanvasView.tsx` 等 graph 视图入口
- ✅ 没动 02b-text-editing / 02b-pdf-rendering / 02b-epub-rendering 已落 capability 文件（仅更新 capabilities/README.md）
- ✅ 没创建 `shape-library/` 下其他文件（renderer.ts 等留波次 3）
- ✅ 没创建任何 `src/capabilities/<其他>/` 子目录
- ✅ 没实现 createInstance / converters / commands 字段（资源访问型仅 schema 实质，task-card R7 硬约束）
- ✅ 没拆为两个 capability（B1 聚合方案，task-card R6 硬约束）
- ✅ 没动业务代码 / 阶段 01/02a/02b-* 已落核心文件除 capabilities/README.md 外
- ✅ 没动 ESLint / tsconfig.json / package.json / schema-* / memory
- ✅ J1 字节级照抄（含中文注释字符 + 3 行 import + 模块级 const + 5 字段顺序），无 `eslint-disable-...` 注释
- ✅ J1 shapeLibrarySchema 不写 as 断言（task-card 提醒 5 落实）
- ✅ J2 字节级照抄（7 段全部对齐，含资源访问型 vs 实例工厂型设计差异表）
- ✅ J3 用 Edit 精准修改（仅"## 当前状态"段），其他段字节验证

## D. 提交清单

| # | SHA | Message |
|---|---|---|
| 1 | `0f2b115a` | `feat(refactor/shape-library): shapeLibraryCapability 资源访问型 capability 首次落地` |
| 2 | `654ae88a` | `docs(refactor/shape-library): shape-library/README.md` |
| 3 | `ea39bf1c` | `docs(refactor/shape-library): capabilities/README.md 同步状态(资源访问型首次落地)` |

总 diff（仅 Builder 改动，相对派活基线 `9e9c7a9a`，去除 4 个 docs）：+154 / -10（3 文件，2 新建 + 1 修改）

## E. 待 Commander 安排的事

1. 调度 Auditor 审计本分支
2. Auditor 完成后用户拍板 merge：
   ```bash
   git checkout main
   git merge refactor/shape-library --no-ff -m "Merge refactor/shape-library — 阶段 02b-5 shape-library 资源访问型 capability 首次落地"
   ```
3. **02b-6+ 起草**：下一个 capability（按形态分类样板：canvas-interaction 复合型 / web-rendering 复合型 / elk-layout 实例工厂型 等）
4. KRIG capability **三种形态样板齐备**——后续起草可直接套对应形态模板

## F. 我没做但 task-card 要求的事

无。J1~J8 全完成。

## G. 自行决断的边界（NON-BLOCKING 歧义）

无 NON-BLOCKING 歧义。task-card 6 条预期歧义（Q1~Q6）全已答；R1~R8 全已答；模板 R3 已吸收 02a G1 + 02b-1/2a/2b/2c/3/4 R5 教训。本阶段简单（3 文件改动），无字面 vs 实质分歧。**连续第七次零 NON-BLOCKING**（02b-1 / 02b-2a / 02b-2b / 02b-2c / 02b-3 / 02b-4 / 02b-5）。

### 实施观察 1：lint 严格 765e + 15w（连续第七次）

| 阶段 | lint problems | errors | warnings |
|---|---|---|---|
| 02a 完成 | 780 | 765 | 15 |
| 02b-1 完成 | 780 | 765 | 15 |
| 02b-2a~2c 完成 | 780 | 765 | 15 |
| 02b-3 完成 | 780 | 765 | 15 |
| 02b-4 完成 | 780 | 765 | 15 |
| **02b-5（本阶段）** | **780** | **765** | **15** |

完全持平。task-card § J5b 严格判据"errors=765 / warnings=15"再次成立。**§ 六新纪律 5/6 + R3 吸收 02a G1 教训持续稳定生效**。

### 实施观察 2：7 SHA 嵌入 J3 README

按 task-card § J3 字面要求 + BUILDER-INSTRUCTION § 四 提醒 7：
- text-editing 4 SHA: `256ec984` / `16ca2454` / `a315e7e0` / `237c6cd0`
- pdf-rendering 1 SHA: `add19d46`
- epub-rendering 1 SHA: `7f8a9a2b`
- shape-library 1 SHA: `0f2b115a`（本次）

Auditor 可通过：
```bash
for sha in 256ec984 16ca2454 a315e7e0 237c6cd0 add19d46 7f8a9a2b 0f2b115a; do
  grep -q "$sha" src/capabilities/README.md && echo "✓ $sha" || echo "❌ $sha"
done
# 预期 7 ✓
```

### 实施观察 3：KRIG capability 三种形态样板齐备

本阶段是 capability **第三种形态**首次落地，至此三种形态样板齐备：

| 形态 | 字段填充 | 已落地 | 阶段 | 适用场景 |
|------|---------|--------|------|---------|
| **复合型** | schema + converters + commands | text-editing | 02b-1~2c（4 阶段） | 富功能能力（含数据转换 + 命令） |
| **实例工厂型** | 仅 createInstance（每次 new） | pdf-rendering / epub-rendering | 02b-3 / 02b-4（各 1 阶段） | 实例隔离的纯 class（每视图独立实例） |
| **资源访问型** | 仅 schema（聚合单例引用） | **shape-library** | **02b-5（本阶段）** | 全局共享资源仓库（所有视图同一份） |

**关键认知验证**:

1. **schema 字段是宽松载体**:`SchemaContribution = unknown` 接受任何对象——
   - 复合型用作 PM Schema 实例（text-editing.blockRegistry）
   - 资源访问型用作聚合单例引用（shape-library.{shapes, substances}）
   - 这是阶段 01 故意留宽的设计意图

2. **形态由"是否每视图实例化"决定**:
   - 实例化（视图私有） → 实例工厂型 createInstance
   - 全局共享（系统单一）→ 资源访问型 schema
   - 数据转换 + 命令组合 → 复合型 schema + converters + commands

3. **资源访问型禁有 createInstance**(task-card R7 硬约束):
   - createInstance 工厂语义假设每次 new 实例化
   - 与全局共享语义冲突——若实现等于违反"全系统访问同一份"
   - Builder 严格遵循 task-card R7 + 严禁顺手做禁令

### 实施观察 4：B1 聚合方案落实

按 task-card R6 + Q5 答案"shape + substance 不拆为两个 capability,B1 聚合方案"：

```ts
const shapeLibrarySchema = {
  shapes: ShapeRegistry,
  substances: SubstanceRegistry,
};
```

理由（task-card § J2 README + § R6）：
1. **业界惯例**:library 资源仓库通常聚合（shape + substance 都属于"图谱资源"）
2. **紧耦合**:CanvasView 两个一起 `bootstrap()`,语义同步
3. **维护简便**:一个 capability 管两个相关单例,优于 B2 方案（拆为两个独立 capability,复杂度翻倍）

未来扩展（README § 聚合对象设计）:如需添加 theme / palette,加入 `shapeLibrarySchema` 同对象。

### 实施观察 5：graph 插件首个 capability 落地

完成本阶段后，graph 插件首个 capability 落地：

| 插件 | capability | 阶段 |
|---|---|---|
| ebook | pdf-rendering / epub-rendering | 02b-3 / 02b-4（全部 capability 化）|
| **graph** | **shape-library** | **02b-5（首次落地）** |
| note | text-editing（4/5 字段） | 02b-1~2c |

graph 插件第二个 capability（canvas-interaction 复合型，Three.js 8 文件）将在 02b-6+ 起草（task-card R8）。

### 实施观察 6：shapeLibrarySchema 不需要 as 断言

按 task-card 提醒 5 + Q2 答案：

```ts
// 直接赋值,无 as 断言
schema: shapeLibrarySchema,
```

`SchemaContribution = unknown` 接受任何对象（阶段 01 故意留宽），实测 typecheck 通过。这与 02b-2b text-editing `schema: blockRegistry` 同模式（无断言）。**对比 createInstance 工厂返回值需 `as CapabilityInstance` 断言**——因 CapabilityInstance 是 `unknown` 但 PDFRenderer 实例不是 unknown，需断言。schema 直接是 `unknown`，对象字面量赋值不需要断言。

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
src/capabilities/shape-library
src/capabilities/pdf-rendering
src/capabilities/epub-rendering
src/capabilities/text-editing                (J7 ✅ 5 dirs)

$ find src/capabilities -type f
src/capabilities/README.md
src/capabilities/shape-library/README.md
src/capabilities/shape-library/index.ts
src/capabilities/pdf-rendering/README.md
src/capabilities/pdf-rendering/index.ts
src/capabilities/epub-rendering/README.md
src/capabilities/epub-rendering/index.ts
src/capabilities/text-editing/README.md
src/capabilities/text-editing/index.ts        (J8 ✅ 9 files)
```

---

## Commander merge 命令清单（Builder 不擅自执行）

```bash
git checkout main
git status                  # 应当干净
git merge refactor/shape-library --no-ff -m "Merge refactor/shape-library — 阶段 02b-5 shape-library 资源访问型 capability 首次落地"

# 验证 merge 后
npm run typecheck    # 预期 EXIT=0
npm run lint         # 预期 EXIT=1, 780 problems (765e/15w 持平 02b-4 baseline)
npm run lint:dirs    # 预期 EXIT=0, 白名单豁免

# 不立即 push,等用户拍板
```
