# Builder 派活指令 — 阶段 03-1-2:graph CanvasView + ui/ 搬移到 views/canvas/(Step A 行为保持迁移首次落地)

> 你(Claude)现在是 Builder。读完本目录全部文件 + 顶层引用后**直接进入执行**,无 BLOCKING 时无需向 Commander 请示。

---

## 一、必读输入(按顺序读全文)

1. **本目录所有文件**:
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — **核心任务卡**(J1~J8 + 路径调整规则表 + 预期歧义 6 条已答)
   - [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) — 本文件
   - 不读 AUDITOR-INSTRUCTION.md

2. **角色总规则**:[../../BUILDER-PROMPT.md](../../BUILDER-PROMPT.md)

3. **顶层宪法**:
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 2.2 + § 5.8
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **03-1-1 已落 ViewDefinition(本阶段不动)**:
   - [src/plugins/graph/views/canvas/index.ts](../../../../src/plugins/graph/views/canvas/index.ts)
   - [src/plugins/graph/views/canvas/README.md](../../../../src/plugins/graph/views/canvas/README.md)
   - [src/plugins/graph/views/README.md](../../../../src/plugins/graph/views/README.md)

5. **搬移源 + 修改目标**:
   - [src/plugins/graph/canvas/CanvasView.tsx](../../../../src/plugins/graph/canvas/CanvasView.tsx) (1147 行) — J1 搬入
   - [src/plugins/graph/canvas/ui/](../../../../src/plugins/graph/canvas/ui/) (6 文件) — J2 搬入
   - [src/plugins/graph/renderer.tsx](../../../../src/plugins/graph/renderer.tsx) — J3.1 修改 import

6. **不动对象**:
   - `src/plugins/graph/canvas/scene/` `interaction/` `edit/` `persist/` `combine.ts`(后续子阶段处理)
   - `src/plugins/graph/library/`(02b-5 引用对象)
   - 任何 `src/capabilities/<x>/` 文件(02b-1~02b-6 已落)
   - 任何 `src/main/` `src/renderer/` `src/shared/` 文件

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 03-1-2-graph-views-relocation(波次 3.1 第二子阶段)|
| 目标分支 | `refactor/graph-views-relocation`(**已切出**,HEAD 来自 main `e22e8517`)|
| 派活基线 SHA | `e22e8517`(task-card § J4 起点)|
| 功能契约 | **N/A** |
| 完成判据 | task-card.md J1~J8(共 17 子项)|
| 模式 | **Step A 行为保持迁移**:`git mv` + 纯调整 import 路径 |
| 改动文件数 | **8 文件**(1 修改 + 7 重命名) |
| 与前阶段差异 | **首次执行实质文件搬移**——03-1-1 是纯新建 3 文件,本阶段是 git mv 8 文件 + 22 处 import 路径调整 |

## 三、执行流程(严格按序)

### 步骤 0:分支已切,无需 checkout

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git status
git branch --show-current      # 应当 refactor/graph-views-relocation
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
  ls src/plugins/graph/canvas/CanvasView.tsx                  # 预期文件存在
  ls src/plugins/graph/canvas/ui                              # 预期 5 子目录
  ls src/plugins/graph/views/canvas/index.ts                  # 预期文件存在(03-1-1)
  ls src/plugins/graph/views/canvas/CanvasView.tsx 2>&1       # 预期 No such file(本阶段创建)
  ```
- 识别歧义/冲突分级 BLOCKING / NON-BLOCKING

### 步骤 2:决定走向

- **无 BLOCKING** → 进入步骤 3
- **有 BLOCKING** → 写 `tmp/builder-blockers.md`,会话结束

### 步骤 3:执行 J1+J2+J3

按 task-card 顺序 + 建议 3 个 commit:

```
J1: refactor(refactor/graph-views-relocation): git mv CanvasView.tsx → views/canvas/
J2: refactor(refactor/graph-views-relocation): git mv ui/ → views/canvas/ui/
J3: refactor(refactor/graph-views-relocation): 调整 5 个文件 import 路径(22 处)
```

**关键策略**:
- J1 + J2 之间**不跑 typecheck**(此时 import 全坏,必报错)
- J3 完成后第一次跑 typecheck → 必须 exit 0
- 实测验证(Commander 已做):上述顺序 + sed 路径调整 → 一次性 typecheck=0

**关键约束**:
- J1 / J2 必须用 `git mv`(R5 + R4 硬约束)——不允许 `cp+rm` 或 `git rm + 新文件`
- J3 严格按 task-card § J3 规则表(22 处调整,字节级精确)
- **不修改任何业务代码**(useEffect / hook / setState / 函数体 / JSX 全部不动)
- **不修改注释 / 空行 / 缩进 / import 顺序**(纯路径文本调整)
- **不新增 / 删除 import 语句**

### 步骤 4:J4~J8 验证

```bash
# J4 范围(以 task-card 立卡 SHA 为起点,反映 Builder 实质改动)
TASK_CARD_SHA=$(git log --oneline e22e8517..HEAD | grep "立阶段 03-1-2" | awk '{print $1}')
echo "立卡 SHA: $TASK_CARD_SHA"
git diff $TASK_CARD_SHA..HEAD --stat   # 预期 8 文件改动

# J5 三件
npm run typecheck     # 预期 exit 0(关键)
npm run lint > /dev/null 2>&1; echo $?    # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1    # 预期 warnings=15 严格不变(errors 数允许小幅变化,< 5)
npm run lint:dirs     # 预期 exit 0

# J6 commit message
git log e22e8517..HEAD --oneline

# J7 旧位置不存在
ls src/plugins/graph/canvas/CanvasView.tsx 2>&1   # 预期 No such file
ls src/plugins/graph/canvas/ui 2>&1               # 预期 No such file

# J8 新位置含 7 文件 + 03-1-1 已有 2 文件
find src/plugins/graph/views/canvas -type f       # 预期 9 行
```

### 步骤 5:写 `tmp/builder-report.md`

按 BUILDER-PROMPT § 五格式 A~G 段。

特别提醒:
- A 段 J5b 必须列出 lint 输出 `✖ N problems (X errors, Y warnings)` —— **必须严格 warnings=15**
- D 段 commit SHA 完整列出
- G 段如有 NON-BLOCKING 歧义记录处理(本阶段空间极小,task-card 字节级模板覆盖)

### 步骤 6:结束

```
builder-report 就绪:tmp/builder-report.md
```

不做 merge / push / reset。

## 四、特别提醒

### 提醒 1:必须用 `git mv`(history rename 检测)

```bash
# 正确(保留 git rename 追踪 + history blame 链)
git mv src/plugins/graph/canvas/CanvasView.tsx src/plugins/graph/views/canvas/CanvasView.tsx
git mv src/plugins/graph/canvas/ui src/plugins/graph/views/canvas/ui

# 错误(history 断裂)
mv old new + git rm old + git add new   # ❌
git rm old + 新建文件粘贴内容            # ❌
```

git rename 检测要求源/目标文件相似度 > 50%——本阶段相似度 100%(仅 import 路径调整),git 必能识别 R(rename)。

### 提醒 2:禁止顺手添加 ESLint disable 注释(吸收 02a G1)

本阶段不引入新代码,**只调整 import 路径**——0 处可能添加 eslint-disable 注释。

### 提醒 3:J3 路径调整字节级严格(task-card § J3 规则表)

22 处调整,**字节级精确**:

| 文件 | 调整数 | 关键 |
|---|---|---|
| `renderer.tsx` | 1 | `./canvas/CanvasView` → `./views/canvas/CanvasView` |
| `views/canvas/CanvasView.tsx` | 13 | 详见 task-card § J3.2 表 |
| `views/canvas/ui/Inspector/FloatingInspector.tsx` | 1 | `../../../library/types` → `../../../../library/types` |
| `views/canvas/ui/LibraryPicker/LibraryPicker.tsx` | 4 | 详见 task-card § J3.4 |
| `views/canvas/ui/LibraryPicker/preview-svg.ts` | 3 | 详见 task-card § J3.5 |
| `views/canvas/ui/{ContextMenu,Toolbar,dialogs}` | 0 | 内部无 import 路径需调整 |

任何"超规则"调整 = ❌

### 提醒 4:不修改注释 / 空行 / 缩进 / import 顺序(R8 硬约束)

**典型陷阱**:
- 看到注释里有"应该改成 xxx"的 TODO → ❌ 不改
- 看到注释里有"过时"标记 → ❌ 不删
- 看到 import 顺序"不规范" → ❌ 不重排
- 看到 import 块没用空行分组 → ❌ 不加空行

**只允许**:把 import 路径文本从旧值替换为新值,其他全部不动。

### 提醒 5:不动 03-1-1 已落 views/ 下的 3 文件(R7 硬约束)

03-1-1 已落:
- `src/plugins/graph/views/canvas/index.ts`(ViewDefinition)
- `src/plugins/graph/views/canvas/README.md`
- `src/plugins/graph/views/README.md`

本阶段**不动**这 3 文件(虽然 CanvasView.tsx 搬到同目录但只是邻居关系,不引用 ViewDefinition)。

### 提醒 6:不动 canvas/scene/ 等(R7 硬约束)

`canvas/scene/` `interaction/` `edit/` `persist/` `combine.ts` 留后续子阶段处理。本阶段:
- ✅ CanvasView.tsx 内 `from './scene/SceneManager'` → `from '../../canvas/scene/SceneManager'`(改路径,不动 scene/ 内容)
- ❌ 不允许:打开 `canvas/scene/SceneManager.ts` 修改任何代码

### 提醒 7:capability.canvas-interaction 引用路径不变(R7 硬约束)

```bash
$ grep "@plugins/graph/canvas" src/capabilities/canvas-interaction/index.ts
import { SceneManager } from '@plugins/graph/canvas/scene/SceneManager';
import { InteractionController } from '@plugins/graph/canvas/interaction/InteractionController';
import { NodeRenderer } from '@plugins/graph/canvas/scene/NodeRenderer';
import { HandlesOverlay } from '@plugins/graph/canvas/scene/HandlesOverlay';
```

→ capability 用 path alias `@plugins/graph/canvas/scene/...` 引用——**这些 path 本阶段不动**(scene/ + interaction/ 都留 03-1-4)。

→ Builder 不需要修改 capability/canvas-interaction 任何文件。

### 提醒 8:J5b warnings 严格 = 15(吸收 02a G1)

main baseline warnings=15。本阶段:
- 如 lint 输出 warnings > 15 → BLOCKING(本阶段引入新 warning)
- 如 lint 输出 warnings < 15 → BLOCKING(可能误改其他文件)

errors 数本阶段允许小幅变化(< 5),因为 ESLint cache 在不同环境结果可能不同——但 **warnings 必须严格 = 15**。

### 提醒 9:J4 口径(task-card 立卡 SHA..HEAD,沿用 03-1-1 修订经验)

03-1-1 后阶段约定:J4 双点 diff 起点为"task-card 立卡 commit SHA"(不是"派活基线 SHA"),反映 Builder 实质改动范围。

```bash
TASK_CARD_SHA=$(git log --oneline e22e8517..HEAD | grep "立阶段 03-1-2" | awk '{print $1}')
git diff $TASK_CARD_SHA..HEAD --stat   # 预期 8 文件
```

派活基线 `e22e8517` 用于 git history 起点;立卡 SHA 用于 J4 范围对账。

## 五、最简起步命令

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git branch --show-current      # 应当 refactor/graph-views-relocation
git log --oneline -3
mkdir -p tmp

# 基线确认
npm run typecheck > /dev/null 2>&1; echo "tc baseline: $?"   # 预期 0
npm run lint 2>&1 | grep "✖" | tail -1                       # 预期 781 (766e+15w)
ls src/plugins/graph/canvas/CanvasView.tsx                  # 预期文件存在
ls src/plugins/graph/canvas/ui                              # 预期 5 子目录(Inspector/LibraryPicker/Toolbar/ContextMenu/dialogs)
ls src/plugins/graph/views/canvas/index.ts                  # 预期文件存在(03-1-1)
ls src/plugins/graph/views/canvas/CanvasView.tsx 2>&1 | head -1   # 预期 No such file

# 03-1-1 已落 ViewDefinition 内容(参考)
cat src/plugins/graph/views/canvas/index.ts
```

之后按步骤 1 写 `tmp/builder-startup.md`,按步骤 2~6 推进。

---

**记住**:本阶段是 **Step A 行为保持迁移首次落地** + 8 文件 git mv + 22 处 import 路径调整。质量必须严格——尤其用 git mv(不是 cp+rm)+ J3 字节级 22 处规则 + 不动业务代码 / 注释 / import 顺序 + warnings=15 严格 + 范围严格 8 文件。完成或停止后立即结束会话。
