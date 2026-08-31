# Builder 派活指令 — 阶段 02b-5：shape-library Capability 一阶段完成（资源访问型首次落地）

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

5. **02b-3/02b-4 样板参考（实例工厂型对比）**：
   - [src/capabilities/pdf-rendering/index.ts](../../../../src/capabilities/pdf-rendering/index.ts)
   - [src/capabilities/epub-rendering/index.ts](../../../../src/capabilities/epub-rendering/index.ts)

6. **修改对象（02b-4 已落，本阶段更新一段）**：
   - [src/capabilities/README.md](../../../../src/capabilities/README.md) (J3)

7. **新建对象（本阶段创建）**：
   - `src/capabilities/shape-library/index.ts` (J1)
   - `src/capabilities/shape-library/README.md` (J2)

8. **引用对象（plugin 内现有单例，本阶段不修改）**：
   - [src/plugins/graph/library/shapes/registry.ts](../../../../src/plugins/graph/library/shapes/registry.ts) ShapeRegistry 单例
   - [src/plugins/graph/library/substances/registry.ts](../../../../src/plugins/graph/library/substances/registry.ts) SubstanceRegistry 单例

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 02b-5-shape-library（资源访问型 capability 首次落地）|
| 目标分支 | `refactor/shape-library`（**已切出**，HEAD 来自 main `9e9c7a9a`）|
| 派活基线 SHA | `9e9c7a9a`（task-card § J4 强制使用此 SHA）|
| 功能契约 | **N/A** |
| 完成判据 | task-card.md J1~J8（共 18 子项）|
| 模式 | **capability 临时引用 plugin**（不搬业务代码）|
| 形态 | **资源访问型 capability**（仅 schema 实质，承载聚合单例引用）|
| 与前阶段差异 | **新形态首次落地**——与 02b-3/02b-4 实例工厂型不同（用 schema 而非 createInstance）|

## 三、执行流程（严格按序）

### 步骤 0：分支已切，无需 checkout

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git status
git branch --show-current      # 应当 refactor/shape-library
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
  ls src/capabilities/shape-library 2>&1 | head -1            # 预期 No such file(本阶段创建)
  grep "ShapeRegistry" src/plugins/graph/library/shapes/registry.ts | head -2   # 预期含 export const ShapeRegistry
  grep "SubstanceRegistry" src/plugins/graph/library/substances/registry.ts | head -2   # 预期含 export const SubstanceRegistry
  ```
- 识别歧义/冲突分级 BLOCKING / NON-BLOCKING

### 步骤 2：决定走向

- **无 BLOCKING** → 进入步骤 3
- **有 BLOCKING** → 写 `tmp/builder-blockers.md`，会话结束

### 步骤 3：执行 J1~J3

按 task-card 顺序 + 建议 3 个 commit：

```
J1: feat(refactor/shape-library): shapeLibraryCapability 资源访问型 capability 首次落地
J2: docs(refactor/shape-library): shape-library/README.md
J3: docs(refactor/shape-library): capabilities/README.md 同步状态(资源访问型首次落地)
```

每个 J 完成后立即跑 `npm run typecheck` 确认 exit 0。

**关键约束**：
- J1 字节级照抄 task-card § J1 代码块（含 3 行 import + shapeLibrarySchema 聚合 const + shapeLibraryCapability 5 字段）
- J2 字节级照抄 task-card § J2 代码块（含 7 段：标题 + 当前状态 + 形态分类 + 资源访问型 vs 实例工厂型对比 + 设计原则 + 主要消费视图 + 临时引用模式 + 聚合对象设计）
- J3 用 **Edit** 工具精准替换"## 当前状态"段——**不许 Write 整文件**
- J3 嵌入 J1 commit SHA 前 8 位（7 SHA 全部存在）

### 步骤 4：J4~J8 验证

```bash
# J4 范围(强制双点 diff + 显式基线 SHA)
git diff 9e9c7a9a..HEAD --stat

# J5 三件
npm run typecheck     # 预期 exit 0
npm run lint > /dev/null 2>&1; echo $?    # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1    # 预期 "780 problems (765 errors, 15 warnings)" 严格 = 02b-4 baseline
npm run lint:dirs     # 预期 exit 0

# J6 commit message
git log 9e9c7a9a..HEAD --oneline

# J7/J8 capabilities 目录(应当增 1 dir + 2 files vs 02b-4)
find src/capabilities -type d   # 预期 5 dirs(根 + text-editing + pdf-rendering + epub-rendering + shape-library)
find src/capabilities -type f   # 预期 9 files(根 README + 4 个 capability 各 2 文件)
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

### 提醒 1：J1 字节级照抄含中文注释字符 + 3 行 import

task-card § J1 代码块含中文注释（"形态:资源访问型 capability" / "资源访问型 capability 设计原理" / "聚合对象设计" 等）。Builder 字节级照抄时**不允许**：
- 把中文标点改为英文
- 删除/调整注释中的"波次 3" / "B1 方案" 等引用
- 调整字段顺序
- **调整 3 行 import 顺序**（必须按：Capability / ShapeRegistry / SubstanceRegistry）

### 提醒 2：禁止顺手添加 ESLint disable 注释（吸收 02a G1）

task-card § J1/J2 模板**不含**任何 `eslint-disable-...` 注释。Builder 字节级照抄即可。J5b warnings 严格 = 15 是验证此提醒落实的关键判据。

### 提醒 3：资源访问型 capability 严禁有 createInstance（task-card R7 硬约束）

资源访问型 capability **不应有 createInstance**——这是设计原则。schema 字段承载聚合单例引用，createInstance 留 undefined。

如 Builder 觉得"加一个工厂返回单例也无妨"——**禁止**（违反全局共享语义）。

### 提醒 4：3 字段显式 undefined（不是删除字段）

converters / createInstance / commands 三个字段值严格 `undefined`。与 02b-2a/2b/3/4 一致。

### 提醒 5：shapeLibrarySchema 不需要 as 断言

SchemaContribution = unknown 接受任何对象——直接 `schema: shapeLibrarySchema` 赋值即可。**不要**写 `as SchemaContribution` 等冗余断言。

实测验证（task-card R1）：直接赋值 typecheck 通过。

### 提醒 6：J5b warnings 严格 = 15

阶段 02b-4 baseline 是 errors=765 + warnings=15。本阶段**warnings 必须 = 15**:
- 如 lint 输出 warnings > 15 → BLOCKING
- 如 lint 输出 warnings < 15 → BLOCKING（可能误改其他文件）

### 提醒 7：J3 用 Edit 精准修改 + 7 SHA 嵌入

`src/capabilities/README.md` 含 4 个段。**仅修改"## 当前状态"段**——用 Edit 工具精准替换。

修改后段必须含 7 SHA 引用：
- text-editing 4 SHA: `256ec984` + `16ca2454` + `a315e7e0` + `237c6cd0`
- pdf-rendering 1 SHA: `add19d46`
- epub-rendering 1 SHA: `7f8a9a2b`
- shape-library 1 SHA: `<J1 commit SHA>`(本次)

### 提醒 8：临时引用模式不动 plugin/graph

本阶段 capability 通过 `import { ShapeRegistry } from '@plugins/graph/library/shapes'` + `import { SubstanceRegistry } from '@plugins/graph/library/substances'` **引用** plugin 内现有单例。**不允许**:
- 修改 `plugins/graph/library/` 任何文件（registry / types / index / renderers / __smoke__）
- 修改 `plugins/graph/canvas/CanvasView.tsx` 等 graph 视图入口
- 修改 `plugins/graph/canvas/` 其他文件

### 提醒 9：B1 聚合方案不允许拆为两个 capability（task-card R6）

shape-library 同时管理 ShapeRegistry + SubstanceRegistry。**不允许**Builder 拆为两个 capability（如 shape-library + substance-library）——B1 聚合方案是 Commander 决策（task-card R6 硬约束）。

## 五、最简起步命令

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git branch --show-current      # 应当 refactor/shape-library
git log --oneline -3
mkdir -p tmp

# 基线确认
npm run typecheck > /dev/null 2>&1; echo "tc baseline: $?"   # 预期 0
npm run lint 2>&1 | grep "✖" | tail -1                       # 预期 780 (765e+15w)
ls src/capabilities/shape-library 2>&1 | head -1            # 预期 No such file
grep "export const ShapeRegistry" src/plugins/graph/library/shapes/registry.ts   # 预期含输出
grep "export const SubstanceRegistry" src/plugins/graph/library/substances/registry.ts   # 预期含输出

# 02b-3/02b-4 样板参考(对比第三种形态差异)
cat src/capabilities/pdf-rendering/index.ts | head -10
```

之后按步骤 1 写 `tmp/builder-startup.md`,按步骤 2~6 推进。

---

**记住**：本阶段是**资源访问型 capability 首次落地**——KRIG capability 三种形态样板齐备。质量必须严格——尤其字节级 J1 + warnings 严格=15 + 7 SHA 嵌入 + 资源访问型设计原理硬约束（无 createInstance）。完成或停止后立即结束会话。
