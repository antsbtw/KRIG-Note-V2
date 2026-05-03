# Auditor 审计指令 — 阶段 02b-5：shape-library Capability 一阶段完成（资源访问型首次落地）

> 你（Claude）现在是 Auditor。**Plan Mode 启动**，不写代码、不读 memory。读完本目录 + 全局规则 + Builder 报告后，按 AUDITOR-PROMPT § 四格式输出审计报告到 `tmp/auditor-report.md`。

---

## 一、必读输入

1. **本目录**：
   - [README.md](README.md)
   - [task-card.md](task-card.md) — 完成判据 J1~J8（共 18 子项）
   - [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) — 本文件
   - **不读 BUILDER-INSTRUCTION.md**

2. **角色总规则**：[../../AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.9 + § 2
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出**：
   - `tmp/builder-report.md`
   - `git diff 9e9c7a9a..refactor/shape-library --stat`（**双点 diff + 显式基线 SHA**）
   - `git log 9e9c7a9a..refactor/shape-library --oneline`

## 二、本次审计要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/shape-library` |
| 派活基线 SHA | `9e9c7a9a` |
| 审计阶段 | 基础设施类阶段（资源访问型 capability 首次落地）|
| 功能契约 | **N/A** |
| 关键审计点 | A 段总纲合规 + 18 子项判据 + J1 字节级（含 3 行 import + 5 字段 + 3 字段 undefined + schema 聚合 const + 无 as 断言）+ J3 7 SHA 嵌入 + 资源访问型严禁 createInstance + lint warnings 严格=15 |
| 基线状态 | typecheck=0 / lint=1 (780, 765e + 15w) / lint:dirs=0 |

## 三、特别关注

### 关注点 1：J1 字节级对账（含 3 行 import + 5 字段 + 聚合 schema）

Read `src/capabilities/shape-library/index.ts` + Read task-card § J1 代码块**逐字符对照**：

- ✅ **3 行 import 顺序严格**：
  1. `import type { Capability } from '@shared/ui-primitives'`
  2. `import { ShapeRegistry } from '@plugins/graph/library/shapes'`
  3. `import { SubstanceRegistry } from '@plugins/graph/library/substances'`

- ✅ `shapeLibrarySchema` 模块级 const(不内联)，聚合对象：
  ```ts
  const shapeLibrarySchema = {
    shapes: ShapeRegistry,
    substances: SubstanceRegistry,
  };
  ```

- ✅ shapeLibraryCapability 5 字段顺序：id → schema → converters → createInstance → commands

- ✅ schema = `shapeLibrarySchema`(模块级 const 引用,**无 as 断言**)

- ✅ converters/createInstance/commands **三个字段值严格 `undefined`**(不是删除字段，不是 null)

- ✅ id = `'capability.shape-library'`(命名空间合规)

- ✅ **不含任何 `// eslint-disable-...` 注释**

- ✅ **不含 createInstance 实质实现**（资源访问型严禁——task-card R7 硬约束）

- ✅ 中文注释字符与 task-card 字面一致（含"形态:资源访问型 capability" / "资源访问型 capability 设计原理" / "聚合对象设计(B1 方案)" 等）

**任意字符不一致 = ❌**
**任何 createInstance 实质实现 = ❌**（违反资源访问型设计原则）
**shapeLibrarySchema 含 as 断言（如 `as SchemaContribution`）= ❌**（冗余）

### 关注点 2：J2 字节级对账

Read `src/capabilities/shape-library/README.md` + Read task-card § J2 代码块**逐字符对照**：

- ✅ 7 个段落顺序：
  1. `# capability.shape-library` 标题段
  2. `## 当前状态(阶段 02b-5-shape-library)`
  3. `## 形态分类:资源访问型(首次落地)`
  4. `## 资源访问型 vs 实例工厂型的设计差异`
  5. `## 设计原则(总纲引用)`
  6. `## 主要消费视图(预期)`
  7. `## 临时引用模式说明(总纲 § 2"新旧 API 共存")`
  8. `## 聚合对象设计(B1 方案)`

  注：实际为 8 段（含标题 + 7 内容段），README 头部应严格 8 个 `^# / ^##` 起首行。

- ✅ 当前状态段含 5 字段状态（id ✅ / schema ✅ / converters ⏸️ / createInstance ⏸️ / commands ⏸️）

- ✅ 形态分类段含三种形态对比表（复合型 / 实例工厂型 / **资源访问型**）

- ✅ 资源访问型 vs 实例工厂型设计差异表（5 维度对比）

- ✅ 聚合对象设计段含 B1 方案理由

- ✅ 设计原则段含 4 条 § 引用（§ 1.3 / § 5.4 / § 5.5 / § 5.8）

**任何段落缺失 / 内容偏离 = ❌**

### 关注点 3：J3 精准修改 capabilities/README.md + 7 SHA 嵌入

```bash
# J3 验证 diff 仅触及当前状态段
git diff 9e9c7a9a..refactor/shape-library -- src/capabilities/README.md
# 预期：diff 仅触及"## 当前状态"段
# 其他段(`# Capabilities` / `## 设计原则` / `## 不在本目录的实现`)字节不变

# 7 SHA 嵌入验证
git checkout refactor/shape-library
J1_SHA=$(git log --oneline 9e9c7a9a..HEAD | grep "shapeLibraryCapability" | awk '{print $1}')
echo "J1 SHA: $J1_SHA"

# text-editing 4 SHA
grep "256ec984" src/capabilities/README.md
grep "16ca2454" src/capabilities/README.md
grep "a315e7e0" src/capabilities/README.md
grep "237c6cd0" src/capabilities/README.md
# pdf-rendering 1 SHA
grep "add19d46" src/capabilities/README.md
# epub-rendering 1 SHA
grep "7f8a9a2b" src/capabilities/README.md
# shape-library 1 SHA(本次)
grep "$J1_SHA" src/capabilities/README.md
```

**任意 SHA 缺失 = ❌**
**diff 触及其他段 = ❌**

### 关注点 4：lint warnings 严格 = 15（吸收 02a G1 教训）

**Auditor 独立重跑**：

```bash
git checkout refactor/shape-library
npm run lint > /tmp/audit-lint.log 2>&1; echo "exit: $?"
grep "✖" /tmp/audit-lint.log | tail -1
```

**预期**：`✖ 780 problems (765 errors, 15 warnings)` —— **errors 765 + warnings 15 与 02b-4 baseline 完全等于**

**如果 warnings != 15** = ❌

### 关注点 5：plugin/graph 必须未触

```bash
git diff 9e9c7a9a..refactor/shape-library -- 'src/plugins/graph/**'
# 预期: 输出空(zero diff,临时引用模式硬约束)
```

如果 plugin/graph 任何文件被改 = ❌（包括 ShapeRegistry / SubstanceRegistry / CanvasView / library 子目录任何文件）

### 关注点 6：02b-text-editing + 02b-pdf-rendering + 02b-epub-rendering 已落 capability 必须未触

```bash
git diff 9e9c7a9a..refactor/shape-library -- src/capabilities/text-editing/
git diff 9e9c7a9a..refactor/shape-library -- src/capabilities/pdf-rendering/
git diff 9e9c7a9a..refactor/shape-library -- src/capabilities/epub-rendering/
# 预期: 三个均输出空(本阶段只动 capabilities/README.md + 新建 shape-library/)
```

任何 text-editing/ 或 pdf-rendering/ 或 epub-rendering/ 文件被改 = ❌

### 关注点 7：资源访问型严禁 createInstance（task-card R7 硬约束）

```bash
grep "createInstance" src/capabilities/shape-library/index.ts
# 预期: 仅 createInstance: undefined 一处出现(注释中可能多处提及)
# 严禁出现: createInstance: () => ... 或 createInstance: shapeLibraryFactory 等实质实现
```

任何 createInstance 实质实现 = ❌（违反资源访问型设计原则——shape-library 是全局共享语义,不应工厂化）

### 关注点 8：B1 聚合方案严守（task-card R6 硬约束）

shape-library 必须**单一 capability**包含两个单例（B1 方案）。审计验证：

```bash
# 整个 capabilities/ 应只新建 shape-library 一个目录
find src/capabilities -type d
# 预期: 5 行(根 + 4 个 capability,**不应有 substance-library 等额外目录**)

# shape-library/index.ts 应同时含 ShapeRegistry + SubstanceRegistry
grep "ShapeRegistry\|SubstanceRegistry" src/capabilities/shape-library/index.ts
# 预期: 至少 4 行(2 import + 2 schema 内引用)
```

任何拆为 substance-library 独立 capability = ❌

### 关注点 9：范围越界（仅 3 文件）

**Builder 引入的 diff 必须严格仅含以下 3 文件**：
- `src/capabilities/shape-library/index.ts`（新建）
- `src/capabilities/shape-library/README.md`（新建）
- `src/capabilities/README.md`（修改）

**任意其他文件出现 = ❌**

### 关注点 10：J7/J8 capabilities 目录结构（02b-4 → 02b-5 增量）

```bash
find src/capabilities -type d   # 预期 5 行: src/capabilities + 4 个 capability
find src/capabilities -type f   # 预期 9 行: 根 README + 4 个 capability 各 2 文件
```

任何额外目录 / 文件 = ❌

### 关注点 11：J5 三件命令独立重跑

```bash
git checkout refactor/shape-library
npm run typecheck > /dev/null 2>&1; echo "tc: $?"      # 预期 0
npm run lint > /dev/null 2>&1; echo "lint: $?"          # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1                  # 预期 "780 problems (765 errors, 15 warnings)"
npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"     # 预期 0
```

任意不符 = ❌

### 关注点 12：J4 双点 diff + 显式基线 SHA（§ 六纪律 1）

强制使用 `git diff 9e9c7a9a..refactor/shape-library --stat`。**不允许**用 `main...HEAD` 三点 diff。

### 关注点 13：Builder G 段自决检查

读 builder-report.md G 段。本阶段 task-card 已答 6 条预期歧义，Builder 自决空间极小。任何 G 段标注的自决都需 Auditor 独立验证。

特别警惕：
- Builder 是否给资源访问型加 `createInstance` 实质实现？（task-card R7 + Q4 已答严禁）
- Builder 是否拆为两个 capability（substance-library 独立）？（task-card R6 + Q5 已答严禁）
- Builder 是否给 shapeLibrarySchema 加冗余 as 断言？（task-card Q2 已答不需要）
- Builder 是否把 shapeLibrarySchema 内联到 capability 字面量？（task-card Q1 已答必须模块级 const）
- Builder 是否删除 undefined 字段？（task-card Q3 已答必须显式 undefined）

任何"超越 task-card 字面"的决断标 ⚠️ 待证明。

## 四、审计输出

按 AUDITOR-PROMPT § 四格式。要点：
- B 段填 "N/A 基础设施类阶段"
- D 段跳过
- 总评：通过 / 不通过 / 待 Builder 证明

## 五、审计纪律强提醒

- ❌ 不读 memory
- ❌ 不被 Builder 解释说服——只看代码 + task-card
- ❌ 不写代码、不修复
- ✅ 字节级对账 J1（含 3 行 import + 5 字段 + 3 字段 undefined + 聚合 schema const + 无 as 断言 + 中文注释）
- ✅ 字节级对账 J2（8 段齐全）
- ✅ 精准修改对账 J3
- ✅ J3 7 SHA 全嵌入验证
- ✅ J5 自己跑命令——**重点 lint warnings 数 = 15**（连续第七次验证 § 六纪律 5/6）
- ✅ J7/J8 find 命令自己跑（02b-4 → 02b-5 增量）
- ✅ plugin/graph 零改动验证（关注点 5）
- ✅ text-editing + pdf + epub 已落零改动验证（关注点 6）
- ✅ **资源访问型严禁 createInstance** 验证（关注点 7,新审计点）
- ✅ **B1 聚合方案严守** 验证（关注点 8,新审计点）

---

**记住**：本阶段是 **KRIG capability 第三种形态首次落地**——决定 capability 形态分类样板的完整性。质量验证决定后续 02b-6+ 起草信心。审计完成立即结束会话。
