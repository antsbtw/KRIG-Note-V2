# Builder 派活指令 — 阶段 03-1-1:graph.canvas ViewDefinition 骨架(波次 3 首次启动 + ViewDefinition 首次落地)

> 你(Claude)现在是 Builder。读完本目录全部文件 + 顶层引用后**直接进入执行**,无 BLOCKING 时无需向 Commander 请示。

---

## 一、必读输入(按顺序读全文)

1. **本目录所有文件**:
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — **核心任务卡**(J1~J8 + 预期歧义 6 条已答)
   - [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) — 本文件
   - 不读 AUDITOR-INSTRUCTION.md

2. **角色总规则**:[../../BUILDER-PROMPT.md](../../BUILDER-PROMPT.md)

3. **顶层宪法**:
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.8 + § 2.2
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **数据契约(阶段 01 已落,引用,不修改)**:
   - [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) ViewDefinition 接口

5. **02b-5 / 02b-6 已落 capability 参考(install 引用对象,不修改)**:
   - [src/capabilities/canvas-interaction/index.ts](../../../../src/capabilities/canvas-interaction/index.ts)
   - [src/capabilities/shape-library/index.ts](../../../../src/capabilities/shape-library/index.ts)

6. **新建对象(本阶段创建)**:
   - `src/plugins/graph/views/canvas/index.ts` (J1)
   - `src/plugins/graph/views/canvas/README.md` (J2)
   - `src/plugins/graph/views/README.md` (J3)

7. **不修改对象**:
   - `src/plugins/graph/canvas/CanvasView.tsx` (1147 行,留 03-1-2)
   - `src/plugins/graph/canvas/scene/` `interaction/` `ui/` `edit/` `persist/`(留后续子阶段)
   - `src/plugins/graph/renderer.tsx`(暂不改 import 路径)
   - 任何 `src/capabilities/<x>/` 文件
   - 任何 `src/main/` `src/renderer/` 文件

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 03-1-1-graph-view-definition-skeleton(波次 3.1 第一子阶段)|
| 目标分支 | `refactor/graph-view-definition-skeleton`(**已切出**,HEAD 来自 main `7070566e`)|
| 派活基线 SHA | `7070566e`(task-card § J4 强制使用此 SHA)|
| 功能契约 | **N/A** |
| 完成判据 | task-card.md J1~J8(共 18 子项)|
| 模式 | **纯新建 ViewDefinition 文件**(不动现有视图/capability) |
| 形态 | **ViewDefinition 骨架首次落地**(KRIG 视图层契约首次写入 plugin) |
| 与前阶段差异 | **新文件类型首次落地**——与 02b-1~02b-6(capability)不同,本阶段是 view 声明 |

## 三、执行流程(严格按序)

### 步骤 0:分支已切,无需 checkout

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git status
git branch --show-current      # 应当 refactor/graph-view-definition-skeleton
git log --oneline -3
mkdir -p tmp
```

### 步骤 1:启动自检(写入 `tmp/builder-startup.md`)

按 BUILDER-PROMPT § 四格式:
- 已读文件清单
- J1~J8 完成判据复述
- 契约 § B 防御代码 grep 验证:填"基础设施类阶段,无功能契约"
- **基线确认**:
  ```bash
  npm run typecheck > /dev/null 2>&1; echo "tc: $?"           # 预期 0
  npm run lint > /dev/null 2>&1; echo "lint: $?"              # 预期 1
  npm run lint 2>&1 | grep "✖" | tail -1                      # 预期 781 (766e+15w)
  npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"         # 预期 0
  ls src/plugins/graph/views 2>&1 | head -1                   # 预期 No such file(本阶段创建)
  grep "ViewDefinition" src/shared/ui-primitives.ts | head -3  # 预期含 export interface ViewDefinition
  ls src/capabilities/canvas-interaction/index.ts             # 预期文件存在
  ls src/capabilities/shape-library/index.ts                  # 预期文件存在
  ```
- 识别歧义/冲突分级 BLOCKING / NON-BLOCKING

### 步骤 2:决定走向

- **无 BLOCKING** → 进入步骤 3
- **有 BLOCKING** → 写 `tmp/builder-blockers.md`,会话结束

### 步骤 3:执行 J1~J3

按 task-card 顺序 + 建议 3 个 commit:

```
J1: feat(refactor/graph-view-definition-skeleton): graphCanvasView ViewDefinition 骨架首次落地
J2: docs(refactor/graph-view-definition-skeleton): views/canvas/README.md
J3: docs(refactor/graph-view-definition-skeleton): views/README.md
```

每个 J 完成后立即跑 `npm run typecheck` 确认 exit 0。

**关键约束**:
- J1 字节级照抄 task-card § J1 代码块(含 1 行 import + JSDoc 注释 + graphCanvasView 顶层 const + 2 字段 viewId/install)
- J2 字节级照抄 task-card § J2 代码块(含 7 段)
- J3 字节级照抄 task-card § J3 代码块(含 4 段)
- 所有文件**不含** `// eslint-disable-...` 注释

### 步骤 4:J4~J8 验证

```bash
# J4 范围(强制双点 diff + 显式基线 SHA)
git diff 7070566e..HEAD --stat

# J5 三件
npm run typecheck     # 预期 exit 0
npm run lint > /dev/null 2>&1; echo $?    # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1    # 预期 "781 problems (766 errors, 15 warnings)" 严格 = main baseline
npm run lint:dirs     # 预期 exit 0

# J6 commit message
git log 7070566e..HEAD --oneline

# J7/J8 views 目录(本阶段首次创建)
find src/plugins/graph/views -type d   # 预期 2 行(views + views/canvas)
find src/plugins/graph/views -type f   # 预期 3 行(views/README.md + views/canvas/index.ts + views/canvas/README.md)
```

### 步骤 5:写 `tmp/builder-report.md`

按 BUILDER-PROMPT § 五格式 A~G 段。

特别提醒:
- A 段 J5b 必须列出 lint 输出 `✖ N problems (X errors, Y warnings)` —— **必须严格 766e + 15w**
- D 段 commit SHA 完整列出
- G 段如有 NON-BLOCKING 歧义记录处理

### 步骤 6:结束

```
builder-report 就绪:tmp/builder-report.md
```

不做 merge / push / reset。

## 四、特别提醒

### 提醒 1:J1 字节级照抄含中文注释字符 + 1 行 import

task-card § J1 代码块含中文 JSDoc 注释("波次 3.1 子阶段 1" / "ViewDefinition 骨架首次落地" / "为什么暂不 install" 等)。Builder 字节级照抄时**不允许**:
- 把中文标点改为英文
- 删除/调整注释中的"波次 3.1" / "Step B" 等引用
- 调整字段顺序(viewId → install)
- **调整 install 数组顺序**(必须按:canvas-interaction → shape-library)
- 增加 install 项(严格 2 项)

### 提醒 2:禁止顺手添加 ESLint disable 注释(吸收 02a G1)

task-card § J1/J2/J3 模板**不含**任何 `eslint-disable-...` 注释。Builder 字节级照抄即可。J5b warnings 严格 = 15 是验证此提醒落实的关键判据。

### 提醒 3:不声明 contextMenu / toolbar 等五大交互项(task-card R7 硬约束)

ViewDefinition 接口含 viewId / install / contextMenu / toolbar / slash / handle / floatingToolbar 共 7 个字段(后 5 个是五大交互)。本阶段**仅声明 viewId + install 两字段**——后 5 个**不声明**。

如 Builder 觉得"先把现有 ContextMenu 项搬过来作为占位也无妨"——**禁止**(违反 § 2.2 Step A "代码内部行为零改动"——现状 contextMenu 是动态 React 组件注入,搬入静态数组 = 行为改动)。

### 提醒 4:install 列表严格 2 项

`install` 数组严格:
1. `'capability.canvas-interaction'`(02b-6 已落)
2. `'capability.shape-library'`(02b-5 已落)

**不允许**Builder 自行加入:
- `'capability.text-editing'`(graph 节点 label 编辑违规留 03-1-3 处理)
- `'capability.elk-layout'`(02b-7 探查证伪)
- 任何其他 capability

### 提醒 5:graphCanvasView 不需要 as 断言

ViewDefinition 接口接受简单对象——直接 `export const graphCanvasView: ViewDefinition = {...}` 赋值即可。**不要**写 `as ViewDefinition` 等冗余断言。

实测验证(task-card R1):直接赋值 typecheck 通过。

### 提醒 6:J5b errors 严格 = 766 / warnings 严格 = 15

main baseline 是 errors=766 + warnings=15(实测,与历史审计报告记录的 765 差 1,是 baseline 漂移不是本阶段问题)。本阶段:
- 如 lint 输出 errors > 766 → BLOCKING(本阶段引入新 error)
- 如 lint 输出 errors < 766 → BLOCKING(可能误改其他文件)
- 如 lint 输出 warnings > 15 → BLOCKING(吸收 02a G1)
- 如 lint 输出 warnings < 15 → BLOCKING

### 提醒 7:不动现有 graph plugin 任何文件(task-card R7 硬约束)

本阶段 ViewDefinition 通过 `import type { ViewDefinition } from '@shared/ui-primitives'` 引用接口。**不允许**:
- 修改 `src/plugins/graph/canvas/` 任何文件(CanvasView / scene / interaction / ui / edit / persist)
- 修改 `src/plugins/graph/renderer.tsx`(暂不改 import 路径)
- 修改 `src/plugins/graph/library/` 任何文件
- 修改 `src/plugins/graph/main/` `navside/` 任何文件
- 修改任何 `src/capabilities/<x>/` 文件
- 修改 02b-1~02b-6 已落 capability 文件

### 提醒 8:views/ 目录结构严格(R4 硬约束)

```
src/plugins/graph/views/                ← 本阶段创建
├─ README.md                            ← J3
└─ canvas/
   ├─ index.ts                          ← J1
   └─ README.md                         ← J2
```

**不允许**:
- `views/` 下创建除 README.md 和 canvas/ 外任何文件或目录
- `views/canvas/` 下创建除 index.ts 和 README.md 外任何文件
- 创建 `views/family-tree/` `views/knowledge/` 等其他视图目录(本阶段仅 graph.canvas)

### 提醒 9:不创建任何 plugins/<其他插件>/views/ 目录

本阶段范围严格限定 graph 插件。**不允许**:
- 创建 `src/plugins/note/views/` 目录
- 创建 `src/plugins/ebook/views/` 目录
- 创建 `src/plugins/web/views/` 目录

其他插件 ViewDefinition 由后续子波次(3.2 / 3.4 / 3.5)处理。

## 五、最简起步命令

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git branch --show-current      # 应当 refactor/graph-view-definition-skeleton
git log --oneline -3
mkdir -p tmp

# 基线确认
npm run typecheck > /dev/null 2>&1; echo "tc baseline: $?"   # 预期 0
npm run lint 2>&1 | grep "✖" | tail -1                       # 预期 781 (766e+15w)
ls src/plugins/graph/views 2>&1 | head -1                    # 预期 No such file
grep "export interface ViewDefinition" src/shared/ui-primitives.ts   # 预期含输出
ls src/capabilities/canvas-interaction/index.ts              # 预期文件存在
ls src/capabilities/shape-library/index.ts                   # 预期文件存在

# 02b-5 / 02b-6 样板参考
cat src/capabilities/canvas-interaction/index.ts | head -10
cat src/capabilities/shape-library/index.ts | head -10
```

之后按步骤 1 写 `tmp/builder-startup.md`,按步骤 2~6 推进。

---

**记住**:本阶段是 **ViewDefinition 文件首次落地 + 波次 3 首次启动**——KRIG 视图层契约首次写入 plugin。质量必须严格——尤其字节级 J1(含 1 行 import + JSDoc 注释 + 顶层 const + 2 字段)+ install 列表严格 2 项 + 不声明五大交互 + lint baseline 严格(766e+15w)+ 范围严格 3 文件。完成或停止后立即结束会话。
