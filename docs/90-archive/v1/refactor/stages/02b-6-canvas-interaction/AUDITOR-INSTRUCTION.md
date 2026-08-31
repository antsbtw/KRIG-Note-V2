# Auditor 审计指令 — 阶段 02b-6：canvas-interaction Capability 一阶段完成（混合型首次落地）

> 你（Claude）现在是 Auditor。**Plan Mode 启动**，不写代码、不读 memory。读完本目录 + 全局规则 + Builder 报告后，按 AUDITOR-PROMPT § 四格式输出审计报告到 `tmp/auditor-report.md`。

---

## 一、必读输入

1. **本目录**：
   - [README.md](README.md)
   - [task-card.md](task-card.md) — 完成判据 J1~J8（共 19 子项）
   - [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) — 本文件
   - **不读 BUILDER-INSTRUCTION.md**

2. **角色总规则**：[../../AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.9 + § 2
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出**：
   - `tmp/builder-report.md`
   - `git diff 48f649c8..refactor/canvas-interaction --stat`（**双点 diff + 显式基线 SHA**）
   - `git log 48f649c8..refactor/canvas-interaction --oneline`

## 二、本次审计要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/canvas-interaction` |
| 派活基线 SHA | `48f649c8` |
| 审计阶段 | 基础设施类阶段（混合型 capability 首次落地）|
| 功能契约 | **N/A** |
| 关键审计点 | A 段总纲合规 + 19 子项判据 + J1 字节级（含 5 行 import + 5 字段 + 2 字段 undefined + schema 聚合 const + createInstance 工厂 const + 参数前缀差异 host/无前缀 + _options/有前缀 + as 双向断言 + 无冗余 SchemaContribution as 断言）+ J3 8 SHA 嵌入 + 混合型 schema 类构造函数硬约束 + 4 类暴露范围严格 + lint warnings 严格=15 |
| 基线状态 | typecheck=0 / lint=1 (780, 765e + 15w) / lint:dirs=0 |

## 三、特别关注

### 关注点 1：J1 字节级对账（含 5 行 import + 5 字段 + schema 聚合 const + createInstance 工厂 const + 参数前缀差异）

Read `src/capabilities/canvas-interaction/index.ts` + Read task-card § J1 代码块**逐字符对照**：

- ✅ **5 行 import 顺序严格**：
  1. `import type { Capability, CapabilityInstance, CapabilityOptions, HostElement } from '@shared/ui-primitives'`
  2. `import { SceneManager } from '@plugins/graph/canvas/scene/SceneManager'`
  3. `import { InteractionController } from '@plugins/graph/canvas/interaction/InteractionController'`
  4. `import { NodeRenderer } from '@plugins/graph/canvas/scene/NodeRenderer'`
  5. `import { HandlesOverlay } from '@plugins/graph/canvas/scene/HandlesOverlay'`

- ✅ `canvasInteractionSchema` 模块级 const(不内联)，聚合对象：
  ```ts
  const canvasInteractionSchema = {
    SceneManager,
    InteractionController,
    NodeRenderer,
    HandlesOverlay,
  };
  ```

- ✅ `canvasInteractionCreateInstance` 模块级 const(不内联)，工厂函数：
  ```ts
  const canvasInteractionCreateInstance = (
    host: HostElement,
    _options: CapabilityOptions,
  ): CapabilityInstance => {
    return new SceneManager(host as HTMLElement) as CapabilityInstance;
  };
  ```

- ✅ **参数前缀差异严格**：
  - 第一参数 `host`（**无下划线**——实际使用，传给 `new SceneManager(host as HTMLElement)`）
  - 第二参数 `_options`（**有下划线**——未使用）
  - 这与 02b-3/4 (host/options 都带 `_`) 不同——是符合 task-card R6 字面要求的精确差异

- ✅ canvasInteractionCapability 5 字段顺序：id → schema → converters → createInstance → commands

- ✅ schema = `canvasInteractionSchema`(模块级 const 引用,**无 as 断言**)

- ✅ createInstance = `canvasInteractionCreateInstance`(模块级 const 引用)

- ✅ converters/commands **两个字段值严格 `undefined`**(不是删除字段，不是 null)

- ✅ id = `'capability.canvas-interaction'`(命名空间合规)

- ✅ **不含任何 `// eslint-disable-...` 注释**

- ✅ `as HTMLElement` + `as CapabilityInstance` 双向断言保留（HostElement = unknown / CapabilityInstance = unknown 兜底类型必需）

- ✅ 中文注释字符与 task-card 字面一致（含"形态:混合型 capability" / "schema 形态差异(与 shape-library 对比)" / "不暴露的辅助类" 等）

**任意字符不一致 = ❌**
**参数前缀错误（如 `_host` 或 `options` 不带下划线）= ❌**
**schema 含 as 断言（如 `as SchemaContribution`）= ❌**（冗余）
**移除任意 as 断言（HTMLElement 或 CapabilityInstance）= ❌**（必需）

### 关注点 2：J2 字节级对账（8 段齐全）

Read `src/capabilities/canvas-interaction/README.md` + Read task-card § J2 代码块**逐字符对照**：

- ✅ 段落顺序：
  1. `# capability.canvas-interaction` 标题段
  2. `## 当前状态(阶段 02b-6-canvas-interaction)`
  3. `## 形态分类:混合型(首次落地)`
  4. `## schema 内容差异(与 shape-library 对比)`
  5. `## 4 个类协作架构(为什么 schema + createInstance 都需要)`
  6. `## 不暴露的辅助类(在 SceneManager 内部封装)`
  7. `## 设计原则(总纲引用)`
  8. `## 主要消费视图(预期)`
  9. `## 临时引用模式说明(总纲 § 2"新旧 API 共存")`

  注：实际为 9 段（含标题 + 8 内容段），README 头部应严格 9 个 `^# / ^##` 起首行。

- ✅ 当前状态段含 5 字段状态（id ✅ / schema ✅ / converters ⏸️ / createInstance ✅ / commands ⏸️）

- ✅ 形态分类段含**四种形态对比表**（复合型 / 实例工厂型 / 资源访问型 / **混合型(首次落地)**）

- ✅ schema 内容差异表（资源访问型 vs 混合型 schema 内容性质对比）

- ✅ 4 个类协作架构示意图（new SceneManager → new NodeRenderer → new HandlesOverlay → new InteractionController）

- ✅ 不暴露的辅助类列表（DotGrid / TextRenderer / LineRenderer 三个 + 各自不暴露理由）

- ✅ 设计原则段含 4 条 § 引用（§ 1.3 / § 5.4 / § 5.5 / § 5.8）

**任何段落缺失 / 内容偏离 = ❌**

### 关注点 3：J3 精准修改 capabilities/README.md + 8 SHA 嵌入

```bash
# J3 验证 diff 仅触及当前状态段
git diff 48f649c8..refactor/canvas-interaction -- src/capabilities/README.md
# 预期：diff 仅触及"## 当前状态"段
# 其他段(`# Capabilities` / `## 设计原则` / `## 不在本目录的实现`)字节不变

# 8 SHA 嵌入验证
git checkout refactor/canvas-interaction
J1_SHA=$(git log --oneline 48f649c8..HEAD | grep "canvasInteractionCapability" | awk '{print $1}')
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
# shape-library 1 SHA
grep "0f2b115a" src/capabilities/README.md
# canvas-interaction 1 SHA(本次)
grep "$J1_SHA" src/capabilities/README.md
```

**任意 SHA 缺失 = ❌**
**diff 触及其他段 = ❌**

### 关注点 4：lint warnings 严格 = 15（吸收 02a G1 教训）

**Auditor 独立重跑**：

```bash
git checkout refactor/canvas-interaction
npm run lint > /tmp/audit-lint.log 2>&1; echo "exit: $?"
grep "✖" /tmp/audit-lint.log | tail -1
```

**预期**：`✖ 780 problems (765 errors, 15 warnings)` —— **errors 765 + warnings 15 与 02b-5 baseline 完全等于**

**如果 warnings != 15** = ❌

### 关注点 5：plugin/graph 必须未触

```bash
git diff 48f649c8..refactor/canvas-interaction -- 'src/plugins/graph/**'
# 预期: 输出空(zero diff,临时引用模式硬约束)
```

如果 plugin/graph 任何文件被改 = ❌（包括 SceneManager / InteractionController / NodeRenderer / HandlesOverlay / DotGrid / TextRenderer / LineRenderer / CanvasView / library 任何文件）

### 关注点 6：02b-text-editing + pdf + epub + shape 已落 capability 必须未触

```bash
git diff 48f649c8..refactor/canvas-interaction -- src/capabilities/text-editing/
git diff 48f649c8..refactor/canvas-interaction -- src/capabilities/pdf-rendering/
git diff 48f649c8..refactor/canvas-interaction -- src/capabilities/epub-rendering/
git diff 48f649c8..refactor/canvas-interaction -- src/capabilities/shape-library/
# 预期: 4 个均输出空(本阶段只动 capabilities/README.md + 新建 canvas-interaction/)
```

任何 text-editing/ 或 pdf-rendering/ 或 epub-rendering/ 或 shape-library/ 文件被改 = ❌

### 关注点 7：混合型 schema 严格类构造函数（task-card R8 硬约束）

```bash
grep -E "SceneManager|NodeRenderer|HandlesOverlay|InteractionController" src/capabilities/canvas-interaction/index.ts
# schema 内容必须是 class 本身,不能是 new XxxImpl() 实例
# 正确: { SceneManager, NodeRenderer, ... }
# 错误: { sceneManager: new SceneManager(...), ... }(资源访问型语义)
```

任何"在 schema 中提前 new 实例"= ❌（违反混合型设计原则——schema 应承载类构造函数）

### 关注点 8：暴露范围严格 4 个类（task-card R7 硬约束）

```bash
grep -E "import.*\{.*\}.*from '@plugins/graph/canvas" src/capabilities/canvas-interaction/index.ts
# 预期: 4 行(SceneManager / InteractionController / NodeRenderer / HandlesOverlay 各 1 行)
# 不应出现: DotGrid / TextRenderer / LineRenderer 任何 import
```

任何 DotGrid / TextRenderer / LineRenderer 出现在 import 或 schema = ❌（违反"暴露实际使用 API"原则,task-card R7 + Q4 已答严禁）

### 关注点 9：参数前缀差异严格（task-card R6 + Q3 硬约束）

```bash
grep -E "\(host" src/capabilities/canvas-interaction/index.ts
# 预期: 至少 1 行,host 不带下划线前缀

grep -E "_options" src/capabilities/canvas-interaction/index.ts
# 预期: 至少 1 行,options 带下划线前缀
```

如果 `_host` 出现 = ❌（host 实际使用,不应带前缀）
如果 `options` 不带下划线 = ❌（未使用,必须带前缀）

### 关注点 10：范围越界（仅 3 文件）

**Builder 引入的 diff 必须严格仅含以下 3 文件**：
- `src/capabilities/canvas-interaction/index.ts`（新建）
- `src/capabilities/canvas-interaction/README.md`（新建）
- `src/capabilities/README.md`（修改）

**任意其他文件出现 = ❌**

### 关注点 11：J7/J8 capabilities 目录结构（02b-5 → 02b-6 增量）

```bash
find src/capabilities -type d   # 预期 6 行: src/capabilities + 5 个 capability
find src/capabilities -type f   # 预期 11 行: 根 README + 5 个 capability 各 2 文件
```

任何额外目录 / 文件 = ❌

### 关注点 12：J5 三件命令独立重跑

```bash
git checkout refactor/canvas-interaction
npm run typecheck > /dev/null 2>&1; echo "tc: $?"      # 预期 0
npm run lint > /dev/null 2>&1; echo "lint: $?"          # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1                  # 预期 "780 problems (765 errors, 15 warnings)"
npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"     # 预期 0
```

任意不符 = ❌

### 关注点 13：J4 双点 diff + 显式基线 SHA（§ 六纪律 1）

强制使用 `git diff 48f649c8..refactor/canvas-interaction --stat`。**不允许**用 `main...HEAD` 三点 diff。

### 关注点 14：Builder G 段自决检查

读 builder-report.md G 段。本阶段 task-card 已答 6 条预期歧义，Builder 自决空间极小。任何 G 段标注的自决都需 Auditor 独立验证。

特别警惕：
- Builder 是否给 schema 加 DotGrid / TextRenderer / LineRenderer？（task-card R7 + Q4 已答严禁）
- Builder 是否拆为 canvas-scene + canvas-interaction 两个 capability？（task-card "严禁顺手做"已答严禁）
- Builder 是否给 canvasInteractionSchema 加冗余 as 断言？（task-card Q2 已答不需要）
- Builder 是否把 canvasInteractionSchema / canvasInteractionCreateInstance 内联到 capability 字面量？（task-card Q1 已答必须模块级 const）
- Builder 是否删除 undefined 字段？（task-card Q5 已答必须显式 undefined）
- Builder 是否把 host 加上下划线（误以为统一前缀）？（task-card Q3 已答 host 无前缀）
- Builder 是否在 schema 中提前 new 实例？（task-card R8 已答严禁——schema 是 class 本身）

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
- ✅ 字节级对账 J1（含 5 行 import + 5 字段 + 2 字段 undefined + schema 聚合 const + createInstance 工厂 const + 参数前缀差异 host vs _options + as 双向断言 + 无冗余 as 断言 + 中文注释）
- ✅ 字节级对账 J2（9 段齐全）
- ✅ 精准修改对账 J3
- ✅ J3 8 SHA 全嵌入验证
- ✅ J5 自己跑命令——**重点 lint warnings 数 = 15**（连续第八次验证 § 六纪律 5/6）
- ✅ J7/J8 find 命令自己跑（02b-5 → 02b-6 增量）
- ✅ plugin/graph 零改动验证（关注点 5）
- ✅ text-editing + pdf + epub + shape 已落零改动验证（关注点 6）
- ✅ **混合型 schema 类构造函数严格** 验证（关注点 7,新审计点）
- ✅ **暴露范围严格 4 个类** 验证（关注点 8,新审计点）
- ✅ **参数前缀差异严格 host vs _options** 验证（关注点 9,新审计点）

---

**记住**：本阶段是 **KRIG capability 第四种形态首次落地**——决定 capability 形态分类样板的完整性（四种形态全部落地）。质量验证决定后续 02b-7+ 起草信心 + 波次 3 真搬迁信心。审计完成立即结束会话。
