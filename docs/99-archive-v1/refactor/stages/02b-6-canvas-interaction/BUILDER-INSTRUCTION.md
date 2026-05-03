# Builder 派活指令 — 阶段 02b-6：canvas-interaction Capability 一阶段完成（混合型首次落地）

> 你（Claude）现在是 Builder。读完本目录全部文件 + 顶层引用后**直接进入执行**，无 BLOCKING 时无需向 Commander 请示。

---

## 一、必读输入（按顺序读全文）

1. **本目录所有文件**：
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — **核心任务卡**（J1~J8 + 预期歧义 6 条已答）
   - [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) — 本文件
   - 不读 AUDITOR-INSTRUCTION.md

2. **角色总规则**：[../../BUILDER-PROMPT.md](../../BUILDER-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.9 + § 2
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **数据契约（阶段 01 已落，引用，不修改）**：
   - [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口

5. **02b-3/02b-4/02b-5 样板参考（其他三种形态对比）**：
   - [src/capabilities/pdf-rendering/index.ts](../../../../src/capabilities/pdf-rendering/index.ts)（实例工厂型）
   - [src/capabilities/epub-rendering/index.ts](../../../../src/capabilities/epub-rendering/index.ts)（实例工厂型）
   - [src/capabilities/shape-library/index.ts](../../../../src/capabilities/shape-library/index.ts)（资源访问型）

6. **修改对象（02b-5 已落，本阶段更新一段）**：
   - [src/capabilities/README.md](../../../../src/capabilities/README.md) (J3)

7. **新建对象（本阶段创建）**：
   - `src/capabilities/canvas-interaction/index.ts` (J1)
   - `src/capabilities/canvas-interaction/README.md` (J2)

8. **引用对象（plugin 内现有 4 个核心类，本阶段不修改）**：
   - [src/plugins/graph/canvas/scene/SceneManager.ts](../../../../src/plugins/graph/canvas/scene/SceneManager.ts)
   - [src/plugins/graph/canvas/interaction/InteractionController.ts](../../../../src/plugins/graph/canvas/interaction/InteractionController.ts)
   - [src/plugins/graph/canvas/scene/NodeRenderer.ts](../../../../src/plugins/graph/canvas/scene/NodeRenderer.ts)
   - [src/plugins/graph/canvas/scene/HandlesOverlay.ts](../../../../src/plugins/graph/canvas/scene/HandlesOverlay.ts)

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 02b-6-canvas-interaction（混合型 capability 首次落地）|
| 目标分支 | `refactor/canvas-interaction`（**已切出**，HEAD 来自 main `48f649c8`）|
| 派活基线 SHA | `48f649c8`（task-card § J4 强制使用此 SHA）|
| 功能契约 | **N/A** |
| 完成判据 | task-card.md J1~J8（共 19 子项）|
| 模式 | **capability 临时引用 plugin**（不搬业务代码）|
| 形态 | **混合型 capability**（schema 类构造函数引用 + createInstance 入口工厂）|
| 与前阶段差异 | **新形态（第四种）首次落地**——schema 内容是 class 而非单例;同时配 createInstance 入口工厂 |

## 三、执行流程（严格按序）

### 步骤 0：分支已切，无需 checkout

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git status
git branch --show-current      # 应当 refactor/canvas-interaction
git log --oneline -3
mkdir -p tmp
```

### 步骤 1：启动自检（写入 `tmp/builder-startup.md`）

按 BUILDER-PROMPT § 四格式：
- 已读文件清单
- J1~J8 完成判据复述
- 契约 § B 防御代码 grep 验证：填"基础设施类阶段，无功能契约"
- **基线确认**：
  ```bash
  npm run typecheck > /dev/null 2>&1; echo "tc: $?"           # 预期 0
  npm run lint > /dev/null 2>&1; echo "lint: $?"              # 预期 1
  npm run lint 2>&1 | grep "✖" | tail -1                      # 预期 780 (765e+15w)
  npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"         # 预期 0
  ls src/capabilities/canvas-interaction 2>&1 | head -1       # 预期 No such file(本阶段创建)
  grep "export class SceneManager" src/plugins/graph/canvas/scene/SceneManager.ts | head -1
  grep "export class InteractionController" src/plugins/graph/canvas/interaction/InteractionController.ts | head -1
  grep "export class NodeRenderer" src/plugins/graph/canvas/scene/NodeRenderer.ts | head -1
  grep "export class HandlesOverlay" src/plugins/graph/canvas/scene/HandlesOverlay.ts | head -1
  ```
- 识别歧义/冲突分级 BLOCKING / NON-BLOCKING

### 步骤 2：决定走向

- **无 BLOCKING** → 进入步骤 3
- **有 BLOCKING** → 写 `tmp/builder-blockers.md`，会话结束

### 步骤 3：执行 J1~J3

按 task-card 顺序 + 建议 3 个 commit：

```
J1: feat(refactor/canvas-interaction): canvasInteractionCapability 混合型 capability 首次落地
J2: docs(refactor/canvas-interaction): canvas-interaction/README.md
J3: docs(refactor/canvas-interaction): capabilities/README.md 同步状态(混合型首次落地+四种形态齐备)
```

每个 J 完成后立即跑 `npm run typecheck` 确认 exit 0。

**关键约束**：
- J1 字节级照抄 task-card § J1 代码块（含 5 行 import + canvasInteractionSchema 聚合 const + canvasInteractionCreateInstance 工厂 const + canvasInteractionCapability 5 字段）
- J2 字节级照抄 task-card § J2 代码块（含 8 段：标题 + 当前状态 + 形态分类 + schema 内容差异 + 4 类协作架构 + 不暴露的辅助类 + 设计原则 + 主要消费视图 + 临时引用模式）
- J3 用 **Edit** 工具精准替换"## 当前状态"段——**不许 Write 整文件**
- J3 嵌入 8 SHA（text-editing 4 + pdf 1 + epub 1 + shape 1 + canvas-interaction J1 commit SHA 8 位）

### 步骤 4：J4~J8 验证

```bash
# J4 范围(强制双点 diff + 显式基线 SHA)
git diff 48f649c8..HEAD --stat

# J5 三件
npm run typecheck     # 预期 exit 0
npm run lint > /dev/null 2>&1; echo $?    # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1    # 预期 "780 problems (765 errors, 15 warnings)" 严格 = 02b-5 baseline
npm run lint:dirs     # 预期 exit 0

# J6 commit message
git log 48f649c8..HEAD --oneline

# J7/J8 capabilities 目录(应当增 1 dir + 2 files vs 02b-5)
find src/capabilities -type d   # 预期 6 行(根 + text-editing + pdf-rendering + epub-rendering + shape-library + canvas-interaction)
find src/capabilities -type f   # 预期 11 行(根 README + 5 个 capability 各 2 文件)
```

### 步骤 5：写 `tmp/builder-report.md`

按 BUILDER-PROMPT § 五格式 A~G 段。

特别提醒：
- A 段 J5b 必须列出 lint 输出 `✖ N problems (X errors, Y warnings)` —— **必须严格 765e + 15w**
- D 段 commit SHA 完整列出
- G 段如有 NON-BLOCKING 歧义记录处理

### 步骤 6：结束

```
builder-report 就绪：tmp/builder-report.md
```

不做 merge / push / reset。

## 四、特别提醒

### 提醒 1：J1 字节级照抄含中文注释字符 + 5 行 import + 参数前缀差异

task-card § J1 代码块含中文注释（"形态:混合型 capability" / "schema 形态差异(与 shape-library 对比)" / "不暴露的辅助类" 等）。Builder 字节级照抄时**不允许**：
- 把中文标点改为英文
- 删除/调整注释中的"波次 3" / "混合型" 等引用
- 调整字段顺序
- **调整 5 行 import 顺序**（必须按：Capability+CapabilityInstance+CapabilityOptions+HostElement / SceneManager / InteractionController / NodeRenderer / HandlesOverlay）
- **改动参数前缀**：第一参数 `host` 无下划线（实际使用），第二参数 `_options` 有下划线（未使用）。这是符合 task-card 字面要求的精确差异（与 02b-3/4 的 host/options 都带 `_` 不同）

### 提醒 2：禁止顺手添加 ESLint disable 注释（吸收 02a G1）

task-card § J1/J2 模板**不含**任何 `eslint-disable-...` 注释。Builder 字节级照抄即可。J5b warnings 严格 = 15 是验证此提醒落实的关键判据。

### 提醒 3：混合型 schema 内容是类构造函数（task-card R8 硬约束）

混合型 capability 的 schema 内容是 **class 本身**（构造函数），不是已 new 出的实例。
- 正确：`{ SceneManager, NodeRenderer, ... }` ← class 本身
- 错误：`{ sceneManager: new SceneManager(...) }` ← 已 new 后的实例（这是资源访问型语义）

调用方使用形如 `const nr = new schema.NodeRenderer(sm)` —— 与 shape-library 的 `schema.shapes.get(id)` 形成对比。

### 提醒 4：暴露范围严格 4 个类（task-card R7 硬约束）

schema **仅暴露**4 个类：SceneManager / InteractionController / NodeRenderer / HandlesOverlay。

**不暴露**：
- DotGrid（点阵网格，被 SceneManager 内部封装，CanvasView 0 引用）
- TextRenderer（文字渲染，被 SceneManager 内部封装，CanvasView 0 引用）
- LineRenderer（纯函数模块，不是 class，不适合暴露）

如 Builder 觉得"也加上吧防止以后用到"——**禁止**（违反"暴露实际使用 API"原则）。

### 提醒 5：3 字段顺序严格 + 2 字段显式 undefined（不是删除字段）

5 字段顺序：id → schema → converters → createInstance → commands

converters / commands 两个字段值严格 `undefined`。schema + createInstance 都填实质内容。

### 提醒 6：canvasInteractionSchema 不需要 as 断言

SchemaContribution = unknown 接受任何对象——直接 `schema: canvasInteractionSchema` 赋值即可。**不要**写 `as SchemaContribution` 等冗余断言。

实测验证（task-card R1）：直接赋值 typecheck 通过。

### 提醒 7：as HTMLElement + as CapabilityInstance 双向断言保留

createInstance 工厂内 `new SceneManager(host as HTMLElement) as CapabilityInstance`：
- `host as HTMLElement`：HostElement = unknown 兜底，需要断言为 HTMLElement 才能传给 SceneManager 构造函数
- `as CapabilityInstance`：CapabilityInstance = unknown，SceneManager 实例需断言才能作为返回值

两个断言**都必须保留**，不允许 Builder"清理冗余"。

### 提醒 8：J5b warnings 严格 = 15

阶段 02b-5 baseline 是 errors=765 + warnings=15。本阶段**warnings 必须 = 15**:
- 如 lint 输出 warnings > 15 → BLOCKING
- 如 lint 输出 warnings < 15 → BLOCKING（可能误改其他文件）

### 提醒 9：J3 用 Edit 精准修改 + 8 SHA 嵌入

`src/capabilities/README.md` 含 4 个段。**仅修改"## 当前状态"段**——用 Edit 工具精准替换。

修改后段必须含 8 SHA 引用：
- text-editing 4 SHA: `256ec984` + `16ca2454` + `a315e7e0` + `237c6cd0`
- pdf-rendering 1 SHA: `add19d46`
- epub-rendering 1 SHA: `7f8a9a2b`
- shape-library 1 SHA: `0f2b115a`
- canvas-interaction 1 SHA: `<J1 commit SHA>`(本次)

### 提醒 10：临时引用模式不动 plugin/graph

本阶段 capability 通过 `import { SceneManager } from '@plugins/graph/canvas/scene/SceneManager'` 等 4 个 import **引用** plugin 内现有类。**不允许**:
- 修改 `plugins/graph/canvas/` 任何文件（scene / interaction / CanvasView 等）
- 修改 `plugins/graph/library/` 任何文件（02b-5 引用对象）
- 修改 02b-text-editing / pdf-rendering / epub-rendering / shape-library 已落 capability 文件

### 提醒 11：不创建 substance-library / canvas-scene 等额外目录

本阶段只新建一个 `canvas-interaction/` 目录。**不允许**：
- 拆分为 canvas-scene + canvas-interaction 两个 capability
- 新建 substance-library 等无关目录
- 在 canvas-interaction/ 下新建 src/ tests/ 等子目录

## 五、最简起步命令

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git branch --show-current      # 应当 refactor/canvas-interaction
git log --oneline -3
mkdir -p tmp

# 基线确认
npm run typecheck > /dev/null 2>&1; echo "tc baseline: $?"   # 预期 0
npm run lint 2>&1 | grep "✖" | tail -1                       # 预期 780 (765e+15w)
ls src/capabilities/canvas-interaction 2>&1 | head -1        # 预期 No such file
grep "export class SceneManager" src/plugins/graph/canvas/scene/SceneManager.ts
grep "export class InteractionController" src/plugins/graph/canvas/interaction/InteractionController.ts
grep "export class NodeRenderer" src/plugins/graph/canvas/scene/NodeRenderer.ts
grep "export class HandlesOverlay" src/plugins/graph/canvas/scene/HandlesOverlay.ts

# 02b-3/4/5 样板参考(对比第四种形态差异)
cat src/capabilities/pdf-rendering/index.ts | head -10
cat src/capabilities/shape-library/index.ts | head -10
```

之后按步骤 1 写 `tmp/builder-startup.md`,按步骤 2~6 推进。

---

**记住**：本阶段是**混合型 capability 首次落地**——KRIG capability 四种形态全部样板齐备。质量必须严格——尤其字节级 J1（含参数前缀差异 host vs _options）+ warnings 严格=15 + 8 SHA 嵌入 + 混合型 schema 含类构造函数硬约束 + 4 类暴露范围严格。完成或停止后立即结束会话。
