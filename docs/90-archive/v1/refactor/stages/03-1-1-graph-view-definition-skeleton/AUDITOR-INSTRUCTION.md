# Auditor 审计指令 — 阶段 03-1-1:graph.canvas ViewDefinition 骨架(波次 3 首次启动 + ViewDefinition 首次落地)

> 你(Claude)现在是 Auditor。**Plan Mode 启动**,不写代码、不读 memory。读完本目录 + 全局规则 + Builder 报告后,按 AUDITOR-PROMPT § 四格式输出审计报告到 `tmp/auditor-report.md`。

---

## 一、必读输入

1. **本目录**:
   - [README.md](README.md)
   - [task-card.md](task-card.md) — 完成判据 J1~J8(共 18 子项)
   - [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) — 本文件
   - **不读 BUILDER-INSTRUCTION.md**

2. **角色总规则**:[../../AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md)

3. **顶层宪法**:
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.8 + § 2.2
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出**:
   - `tmp/builder-report.md`
   - `git diff 7070566e..refactor/graph-view-definition-skeleton --stat`(**双点 diff + 显式基线 SHA**)
   - `git log 7070566e..refactor/graph-view-definition-skeleton --oneline`

## 二、本次审计要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/graph-view-definition-skeleton` |
| 派活基线 SHA | `7070566e` |
| 审计阶段 | 基础设施类阶段(波次 3 首次启动 + ViewDefinition 首次落地)|
| 功能契约 | **N/A** |
| 关键审计点 | A 段总纲合规 + 18 子项判据 + J1 字节级(1 行 import + 顶层 const + 2 字段 viewId/install + install 数组严格 2 项顺序 canvas-interaction → shape-library + 不含五大交互字段 + 无 eslint-disable + 无 as 断言 + JSDoc 中文注释)+ J2/J3 字节级 + lint baseline 严格 766e+15w + 范围严格 3 文件 + graph plugin / capabilities 零改动 |
| 基线状态 | typecheck=0 / lint=1 (781, 766e + 15w) / lint:dirs=0 |

## 三、特别关注

### 关注点 1:J1 字节级对账(含 1 行 import + 顶层 const + 2 字段 + install 严格 2 项 + JSDoc 中文注释)

Read `src/plugins/graph/views/canvas/index.ts` + Read task-card § J1 代码块**逐字符对照**:

- ✅ **1 行 import**:`import type { ViewDefinition } from '@shared/ui-primitives'`(严格,不允许加其他 import)

- ✅ JSDoc 注释含以下关键句:
  - "波次 3.1 子阶段 1:ViewDefinition 骨架首次落地"
  - "(KRIG 视图层契约首次写入 plugin)"
  - "按 § 2.2 Step A "看到 X 不动 X" 原则"
  - "install 列表(本阶段仅 2 个 capability,均已 capability 化)"
  - "暂不 install 的 capability"
  - "runtime 状态:本声明当前是"孤岛""

- ✅ `export const graphCanvasView: ViewDefinition = {...}` 顶层 const 导出

- ✅ 2 字段顺序严格:`viewId` → `install`

- ✅ `viewId` = `'graph.canvas'`(命名空间合规,§ 5.5 强约束 3)

- ✅ `install` 数组严格 2 项,顺序:
  ```ts
  install: [
    'capability.canvas-interaction',
    'capability.shape-library',
  ],
  ```

- ✅ **不含** contextMenu / toolbar / slash / handle / floatingToolbar 字段

- ✅ **不含任何 `// eslint-disable-...` 注释**

- ✅ **不含 `as ViewDefinition` 等冗余断言**

- ✅ 中文注释字符与 task-card 字面一致

**任意字符不一致 = ❌**
**install 数组项数 ≠ 2 或顺序错 = ❌**
**含 contextMenu / toolbar / slash / handle / floatingToolbar 任一字段 = ❌**(违反范围)
**含 `as` 断言或 eslint-disable = ❌**

### 关注点 2:J2 字节级对账(views/canvas/README.md 7 段齐全)

Read `src/plugins/graph/views/canvas/README.md` + Read task-card § J2 代码块**逐字符对照**:

- ✅ 段落顺序:
  1. `# graph.canvas — 图谱画板视图声明` 标题段
  2. `## 当前状态(阶段 03-1-1-graph-view-definition-skeleton)`
  3. `## 范围限定:不动现有视图代码`
  4. `## install 列表说明`
  5. `## 为什么暂不声明 contextMenu / toolbar`
  6. `## runtime 状态`
  7. `## 设计原则(总纲引用)`
  8. `## 后续子阶段路径图`

  注:实际为 8 段(含标题 + 7 内容段),README 头部应严格 8 个 `^# / ^##` 起首行。

- ✅ 当前状态段含 7 字段状态(viewId ✅ / install ✅ / contextMenu ⏸️ / toolbar ⏸️ / slash ⏸️ / handle ⏸️ / floatingToolbar ⏸️)

- ✅ install 列表说明段含 4 个 capability 状态表(canvas-interaction ✅ / shape-library ✅ / text-editing ❌ / elk-layout ❌)

- ✅ "为什么暂不声明 contextMenu / toolbar" 段含现状 vs 目标态对比代码块

- ✅ runtime 状态段含 § 5.3 注册时机分两段说明

- ✅ 设计原则段含 4 条 § 引用(§ 2.2 / § 5.4 / § 5.5 / § 5.8)

- ✅ 后续子阶段路径图含 4 个子阶段表(03-1-1 / 03-1-2 / 03-1-3 / 03-1-4)

**任何段落缺失 / 内容偏离 = ❌**

### 关注点 3:J3 字节级对账(views/README.md 4 段齐全)

Read `src/plugins/graph/views/README.md` + Read task-card § J3 代码块**逐字符对照**:

- ✅ 段落顺序:
  1. `# plugins/graph/views/ — graph 插件视图声明` 标题段
  2. `## 当前状态(阶段 03-1-1-graph-view-definition-skeleton)`
  3. `## 与 plugins/graph/canvas/ 的关系`
  4. `## 设计原则(总纲引用)`
  5. `## 临时引用模式说明(总纲 § 2"新旧 API 共存")`

  注:实际为 5 段(含标题 + 4 内容段),README 头部应严格 5 个 `^# / ^##` 起首行。

- ✅ 当前状态段含 4 个 graph view 状态表(canvas ✅ / family-tree ⏸️ / knowledge ⏸️ / mindmap ⏸️)

- ✅ "与 plugins/graph/canvas/ 的关系" 段含 3 阶段说明(当前/03-1-2/最终态)

- ✅ 设计原则段含 4 条 § 引用(§ 2.2 / § 4.1 / § 5.4 / § 5.8)

- ✅ 临时引用模式段含 § 2 "新旧 API 共存" 引用

**任何段落缺失 / 内容偏离 = ❌**

### 关注点 4:lint baseline 严格 errors=766 / warnings=15

**Auditor 独立重跑**:

```bash
git checkout refactor/graph-view-definition-skeleton
npm run lint > /tmp/audit-lint.log 2>&1; echo "exit: $?"
grep "✖" /tmp/audit-lint.log | tail -1
```

**预期**:`✖ 781 problems (766 errors, 15 warnings)` —— **errors 766 + warnings 15 与 main baseline 完全等于**

**如果 errors != 766 或 warnings != 15** = ❌

注:历史审计记录 765 是 baseline 漂移问题(02b-5 / 02b-6 审计时刻可能有缓存差异),实测 main HEAD 是 766。本阶段严格按 766 验证。

### 关注点 5:plugin/graph 现有视图必须未触

```bash
git diff 7070566e..refactor/graph-view-definition-skeleton -- 'src/plugins/graph/canvas/**'
git diff 7070566e..refactor/graph-view-definition-skeleton -- 'src/plugins/graph/renderer.tsx'
git diff 7070566e..refactor/graph-view-definition-skeleton -- 'src/plugins/graph/library/**'
git diff 7070566e..refactor/graph-view-definition-skeleton -- 'src/plugins/graph/main/**'
git diff 7070566e..refactor/graph-view-definition-skeleton -- 'src/plugins/graph/navside/**'
# 预期: 全部输出空(zero diff)
```

如果任何现有 graph 文件被改 = ❌

### 关注点 6:6 个已落 capability 必须未触

```bash
git diff 7070566e..refactor/graph-view-definition-skeleton -- src/capabilities/text-editing/
git diff 7070566e..refactor/graph-view-definition-skeleton -- src/capabilities/pdf-rendering/
git diff 7070566e..refactor/graph-view-definition-skeleton -- src/capabilities/epub-rendering/
git diff 7070566e..refactor/graph-view-definition-skeleton -- src/capabilities/shape-library/
git diff 7070566e..refactor/graph-view-definition-skeleton -- src/capabilities/canvas-interaction/
git diff 7070566e..refactor/graph-view-definition-skeleton -- src/capabilities/README.md
# 预期: 全部输出空(本阶段不动 capability)
```

任何 capability 文件被改 = ❌

### 关注点 7:范围越界(仅 3 文件)

**Builder 引入的 diff 必须严格仅含以下 3 文件**:
- `src/plugins/graph/views/canvas/index.ts`(新建)
- `src/plugins/graph/views/canvas/README.md`(新建)
- `src/plugins/graph/views/README.md`(新建)

**任意其他文件出现 = ❌**

### 关注点 8:install 列表严格 2 项(task-card R8 硬约束)

```bash
grep -E "capability\." src/plugins/graph/views/canvas/index.ts
# 预期: 仅 2 行(canvas-interaction + shape-library),顺序严格
# 严禁出现: capability.text-editing / capability.elk-layout / 其他 capability
```

任何额外 capability 出现 = ❌

### 关注点 9:不声明五大交互项(task-card R7 + 严禁顺手做)

```bash
grep -E "contextMenu|toolbar|slash|handle|floatingToolbar" src/plugins/graph/views/canvas/index.ts
# 预期: 0 命中(本阶段仅声明 viewId + install 两字段)
# 注释中可能提及"暂不声明",但代码中应 0 出现
```

注:JSDoc 注释中提及"暂不 install" / "留 Step B" 等是允许的;代码字段层面 0 出现五大交互。

### 关注点 10:views/ 目录结构严格

```bash
find src/plugins/graph/views -type d   # 预期 2 行(views + views/canvas)
find src/plugins/graph/views -type f   # 预期 3 行(views/README.md + views/canvas/index.ts + views/canvas/README.md)
```

任何额外目录 / 文件 = ❌

特别检查:
```bash
find src/plugins -type d -name views   # 预期 1 行(仅 graph/views,不含 note/views ebook/views web/views)
```

任何 plugins/<其他插件>/views/ 目录出现 = ❌

### 关注点 11:J5 三件命令独立重跑

```bash
git checkout refactor/graph-view-definition-skeleton
npm run typecheck > /dev/null 2>&1; echo "tc: $?"      # 预期 0
npm run lint > /dev/null 2>&1; echo "lint: $?"          # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1                  # 预期 "781 problems (766 errors, 15 warnings)"
npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"     # 预期 0
```

任意不符 = ❌

### 关注点 12:J4 双点 diff + 显式基线 SHA(§ 六纪律 1)

强制使用 `git diff 7070566e..refactor/graph-view-definition-skeleton --stat`。**不允许**用 `main...HEAD` 三点 diff。

### 关注点 13:Builder G 段自决检查

读 builder-report.md G 段。本阶段 task-card 已答 6 条预期歧义,Builder 自决空间极小。任何 G 段标注的自决都需 Auditor 独立验证。

特别警惕:
- Builder 是否 install 加入 capability.text-editing?(task-card R8 + Q3 已答严禁)
- Builder 是否声明 contextMenu / toolbar 等五大交互?(task-card R7 + Q4 已答严禁)
- Builder 是否给 graphCanvasView 加冗余 as 断言?(task-card Q2 已答不需要)
- Builder 是否修改 renderer.tsx 引用新 ViewDefinition?(task-card Q5 已答不动)
- Builder 是否在 ViewDefinition 中提前注册 ViewDefinitionRegistry?(task-card Q1 已答 runtime 留 02b-7+)

任何"超越 task-card 字面"的决断标 ⚠️ 待证明。

## 四、审计输出

按 AUDITOR-PROMPT § 四格式。要点:
- B 段填 "N/A 基础设施类阶段"
- D 段跳过
- 总评:通过 / 不通过 / 待 Builder 证明

## 五、审计纪律强提醒

- ❌ 不读 memory
- ❌ 不被 Builder 解释说服——只看代码 + task-card
- ❌ 不写代码、不修复
- ✅ 字节级对账 J1(含 1 行 import + 顶层 const + 2 字段 + install 严格 2 项 + 不含五大交互 + 无 as 断言 + 无 eslint-disable + JSDoc 中文注释)
- ✅ 字节级对账 J2(8 段齐全,7 内容段)
- ✅ 字节级对账 J3(5 段齐全,4 内容段)
- ✅ J5 自己跑命令——**重点 lint errors=766 / warnings=15**(连续第九次验证 § 六纪律 5/6,本阶段 baseline 修正为 766)
- ✅ J7/J8 find 命令自己跑(views/ 目录首次创建)
- ✅ plugin/graph 现有视图零改动验证(关注点 5)
- ✅ 6 个已落 capability 零改动验证(关注点 6)
- ✅ **install 列表严格 2 项** 验证(关注点 8,新审计点)
- ✅ **不声明五大交互项** 验证(关注点 9,新审计点)
- ✅ **views/ 目录结构严格** 验证(关注点 10,新审计点)

---

**记住**:本阶段是 **波次 3 首次启动 + ViewDefinition 文件首次落地**——决定后续 03-1-2/3/4 + 全部插件 ViewDefinition 起草信心。质量验证决定波次 3 真搬迁推进信心。审计完成立即结束会话。
