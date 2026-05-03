# Auditor 审计指令 — 阶段 03-1-2:graph CanvasView + ui/ 搬移到 views/canvas/(Step A 行为保持迁移首次落地)

> 你(Claude)现在是 Auditor。**Plan Mode 启动**,不写代码、不读 memory。读完本目录 + 全局规则 + Builder 报告后,按 AUDITOR-PROMPT § 四格式输出审计报告到 `tmp/auditor-report.md`。

---

## 一、必读输入

1. **本目录**:
   - [README.md](README.md)
   - [task-card.md](task-card.md) — 完成判据 J1~J8(共 17 子项)
   - [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) — 本文件
   - **不读 BUILDER-INSTRUCTION.md**

2. **角色总规则**:[../../AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md)

3. **顶层宪法**:
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 2.2 + § 5.8
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出**:
   - `tmp/builder-report.md`
   - `git log e22e8517..refactor/graph-views-relocation --oneline`(整体提交链)
   - `git diff e22e8517..refactor/graph-views-relocation --stat`(字面派活基线 diff)
   - `git diff <task-card 立卡 SHA>..refactor/graph-views-relocation --stat`(实质改动 diff)

## 二、本次审计要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/graph-views-relocation` |
| 派活基线 SHA | `e22e8517`(main HEAD,git history 起点)|
| task-card 立卡 SHA | (Auditor 自查 `git log --oneline e22e8517..HEAD \| grep "立阶段 03-1-2"`)|
| 审计阶段 | 基础设施类阶段(Step A 行为保持迁移首次落地)|
| 功能契约 | **N/A** |
| 关键审计点 | A 段总纲合规 + 17 子项判据 + git mv 用法严格(R 标记)+ J3 22 处 import 路径调整字节级 + 业务代码零改动(注释/空行/缩进/import 顺序)+ canvas/scene 等留存目录零改动 + capability 文件零改动 + lint warnings 严格=15 |
| 基线状态 | typecheck=0 / lint=1 (warnings=15 严格)/ lint:dirs=0 |

## 三、特别关注

### 关注点 1:git mv 用法(R 或 RM 标记)

```bash
git diff <立卡 SHA>..refactor/graph-views-relocation --name-status | grep -E "^R|^M"
# 预期:
# M  src/plugins/graph/renderer.tsx
# RM src/plugins/graph/canvas/CanvasView.tsx -> src/plugins/graph/views/canvas/CanvasView.tsx
# RM src/plugins/graph/canvas/ui/Inspector/FloatingInspector.tsx -> src/plugins/graph/views/canvas/ui/Inspector/FloatingInspector.tsx
# RM src/plugins/graph/canvas/ui/LibraryPicker/LibraryPicker.tsx -> src/plugins/graph/views/canvas/ui/LibraryPicker/LibraryPicker.tsx
# RM src/plugins/graph/canvas/ui/LibraryPicker/preview-svg.ts -> src/plugins/graph/views/canvas/ui/LibraryPicker/preview-svg.ts
# R  src/plugins/graph/canvas/ui/Toolbar/Toolbar.tsx -> src/plugins/graph/views/canvas/ui/Toolbar/Toolbar.tsx
# R  src/plugins/graph/canvas/ui/ContextMenu/ContextMenu.tsx -> src/plugins/graph/views/canvas/ui/ContextMenu/ContextMenu.tsx
# R  src/plugins/graph/canvas/ui/dialogs/CreateSubstanceDialog.tsx -> src/plugins/graph/views/canvas/ui/dialogs/CreateSubstanceDialog.tsx
```

**预期**:1 M(modify)+ 4 RM(rename + modify)+ 3 R(纯 rename)= 8 行

如果出现 `D + A`(删除 + 新增)而不是 `R`/`RM` = ❌(git rename 检测失败,history blame 链断裂)

### 关注点 2:J3.1 renderer.tsx import 路径(1 处调整)

Read `src/plugins/graph/renderer.tsx`:

- ✅ `import { CanvasView } from './views/canvas/CanvasView';`(新路径)
- ❌ 不应出现:`from './canvas/CanvasView';`(旧路径)
- ❌ 其他代码字面零改动(包括 createRoot import / JSDoc 注释 / root.render)

### 关注点 3:J3.2 CanvasView.tsx import 路径(13 处调整)

Read `src/plugins/graph/views/canvas/CanvasView.tsx`:

逐项对照 task-card § J3.2 规则表:
- `from '../../canvas/scene/SceneManager'`(替代 `./scene/SceneManager`)
- `from '../../canvas/scene/NodeRenderer'`
- `from '../../canvas/scene/HandlesOverlay'`
- `from '../../canvas/interaction/InteractionController'`
- `from '../../canvas/edit/EditOverlay'`
- `from '../../canvas/edit/atom-bridge'`
- `from '../../canvas/combine'`
- `from '../../canvas/persist/serialize'`
- `from '../../library/shapes'`
- `from '../../library/substances'`
- `from '../../library/types'`
- `from '../../../../shared/types/atom-types'`
- `from '../../../../shared/types/graph-types'`

ui/ 子目录 import**保持不变**(自验证):
- `from './ui/Toolbar/Toolbar'`(不变)
- `from './ui/LibraryPicker/LibraryPicker'`(不变)
- `from './ui/Inspector/FloatingInspector'`(不变)
- `from './ui/ContextMenu/ContextMenu'`(不变)
- `from './ui/dialogs/CreateSubstanceDialog'`(不变)

任何路径与规则表不匹配 = ❌

### 关注点 4:J3.3 / J3.4 / J3.5 ui/ 子目录 import 路径

**FloatingInspector.tsx**(1 处):
- `from '../../../../library/types'`(替代 `../../../library/types`)

**LibraryPicker.tsx**(4 处):
- `from '../../../../library/shapes'`
- `from '../../../../library/substances'`
- `from '../../../../canvas/interaction/InteractionController'`
- `from '../../../../library/types'`

**preview-svg.ts**(3 处):
- `from '../../../../library/shapes'`
- `from '../../../../library/substances'`
- `from '../../../../library/types'`

任何路径深度计算错误 = ❌

### 关注点 5:J3.6 不调整文件零变更

```bash
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/views/canvas/ui/ContextMenu/ContextMenu.tsx'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/views/canvas/ui/Toolbar/Toolbar.tsx'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/views/canvas/ui/dialogs/CreateSubstanceDialog.tsx'
# 预期:全 0 行 diff(R 标记纯 rename,无内容变更)
```

任何零调整文件出现内容变更 = ❌

### 关注点 6:业务代码零改动验证

逐文件检查 import 块外的代码字面零变更:

```bash
# 用 git diff 看 8 个文件的所有 hunk
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/renderer.tsx' 'src/plugins/graph/views/**'

# 检查:
# 1. 所有 hunk 应仅在 import 路径行(`from '...';` 行)
# 2. 不应出现 useEffect / useState / useRef / useCallback / function / const / class 等代码行变更
# 3. 不应出现 JSX 元素变更
# 4. 不应出现注释 / 空行 / 缩进变更
# 5. 不应出现 import 顺序变更(只是路径文本变,顺序不变)
```

任何业务代码 / JSX / 注释 / 空行 / 缩进 / import 顺序变更 = ❌

### 关注点 7:lint warnings 严格 = 15(吸收 02a G1 教训)

**Auditor 独立重跑**:

```bash
git checkout refactor/graph-views-relocation
npm run lint > /tmp/audit-lint.log 2>&1; echo "exit: $?"
grep "✖" /tmp/audit-lint.log | tail -1
```

**预期**:`✖ N problems (X errors, 15 warnings)` —— **warnings 严格 = 15**

errors 数本阶段允许小幅变化(< 5),因为 ESLint cache 在不同环境结果不同(03-1-1 task-card R6 已记录此漂移)——但 **warnings 必须严格 = 15**。

如果 warnings != 15 = ❌

### 关注点 8:canvas/ 留存目录零改动验证

```bash
# 留存目录(本阶段不搬)
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/canvas/scene/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/canvas/interaction/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/canvas/edit/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/canvas/persist/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/canvas/combine.ts'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/library/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/main/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/navside/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/graph.css'
# 预期:全部输出空(zero diff)
```

如果任何留存目录文件被改 = ❌

### 关注点 9:6 个已落 capability + 03-1-1 已落 ViewDefinition 必须未触

```bash
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/capabilities/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/views/canvas/index.ts'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/views/canvas/README.md'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/graph/views/README.md'
# 预期:全部输出空
```

任何 capability 文件 / 03-1-1 ViewDefinition 文件被改 = ❌

### 关注点 10:其他插件 + main / shared / renderer 零改动

```bash
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/note/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/ebook/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/plugins/web/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/main/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/shared/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'src/renderer/**'
git diff <立卡 SHA>..refactor/graph-views-relocation -- 'package.json' 'tsconfig.json' 'eslint.config.js'
# 预期:全部输出空
```

### 关注点 11:范围严格 8 文件

```bash
git diff <立卡 SHA>..refactor/graph-views-relocation --stat
# 预期:8 文件改动:
# - src/plugins/graph/renderer.tsx (M)
# - src/plugins/graph/canvas/CanvasView.tsx → views/canvas/CanvasView.tsx (RM)
# - src/plugins/graph/canvas/ui/Inspector/FloatingInspector.tsx → ... (RM)
# - src/plugins/graph/canvas/ui/LibraryPicker/LibraryPicker.tsx → ... (RM)
# - src/plugins/graph/canvas/ui/LibraryPicker/preview-svg.ts → ... (RM)
# - src/plugins/graph/canvas/ui/Toolbar/Toolbar.tsx → ... (R)
# - src/plugins/graph/canvas/ui/ContextMenu/ContextMenu.tsx → ... (R)
# - src/plugins/graph/canvas/ui/dialogs/CreateSubstanceDialog.tsx → ... (R)
# 总改动 +23/-22 行(实测值)
```

任何额外文件 = ❌

### 关注点 12:J7/J8 目录结构(canvas → views/canvas 迁移完成)

```bash
# J7 旧位置不存在
ls src/plugins/graph/canvas/CanvasView.tsx 2>&1   # 预期 No such file
ls src/plugins/graph/canvas/ui 2>&1               # 预期 No such file
find src/plugins/graph/canvas -type f -name 'CanvasView.tsx'   # 预期 0 行
find src/plugins/graph/canvas/ui -type f 2>/dev/null           # 预期 0 行

# J8 新位置 9 文件(03-1-1 已有 2 + 本阶段 7)
find src/plugins/graph/views/canvas -type f
# 预期 9 行:
# - views/canvas/index.ts (03-1-1)
# - views/canvas/README.md (03-1-1)
# - views/canvas/CanvasView.tsx (本阶段)
# - views/canvas/ui/Inspector/FloatingInspector.tsx
# - views/canvas/ui/LibraryPicker/LibraryPicker.tsx
# - views/canvas/ui/LibraryPicker/preview-svg.ts
# - views/canvas/ui/Toolbar/Toolbar.tsx
# - views/canvas/ui/ContextMenu/ContextMenu.tsx
# - views/canvas/ui/dialogs/CreateSubstanceDialog.tsx
```

### 关注点 13:J5 三件命令独立重跑

```bash
git checkout refactor/graph-views-relocation
npm run typecheck > /dev/null 2>&1; echo "tc: $?"      # 预期 0
npm run lint > /dev/null 2>&1; echo "lint: $?"          # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1                  # warnings 严格 = 15
npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"     # 预期 0
```

### 关注点 14:J4 双口径(立卡 SHA + 派活基线)

按 03-1-1 修订经验,本阶段 J4 同时核验两个口径:

```bash
# 字面派活基线口径(7+1=8 文件,含立卡 4 文档)
git diff e22e8517..refactor/graph-views-relocation --stat   # 预期 8 实质 + 4 task-card = 12 文件

# 立卡 SHA 口径(实质改动 8 文件)
TASK_CARD_SHA=$(git log --oneline e22e8517..HEAD | grep "立阶段 03-1-2" | awk '{print $1}')
git diff $TASK_CARD_SHA..refactor/graph-views-relocation --stat   # 预期 8 文件
```

立卡 SHA 口径 = 8 文件 通过 ✅;字面派活基线为辅助参考。

## 四、审计输出

按 AUDITOR-PROMPT § 四格式。要点:
- B 段填 "N/A 基础设施类阶段"
- D 段跳过
- 总评:通过 / 不通过 / 待 Builder 证明

## 五、审计纪律强提醒

- ❌ 不读 memory
- ❌ 不被 Builder 解释说服——只看代码 + task-card
- ❌ 不写代码、不修复
- ✅ 字节级对账 J3 22 处 import 路径(每处对照 task-card § J3 规则表)
- ✅ git mv 标记验证(R / RM 出现 + 0 处 D+A 对)
- ✅ 业务代码零改动验证(import 行外所有 hunk 应为空)
- ✅ J5 自己跑命令——**重点 lint warnings 数 = 15**(连续第十次验证 § 六纪律 5/6)
- ✅ J7/J8 目录结构验证(canvas/ 旧位置清空 + views/canvas/ 新位置 9 文件)
- ✅ canvas/scene 等留存目录零改动验证(关注点 8)
- ✅ 6 个已落 capability + 03-1-1 ViewDefinition 文件零改动验证(关注点 9)
- ✅ 其他插件 + main / shared / renderer 零改动验证(关注点 10)
- ✅ J4 双口径验证(关注点 14)

---

**记住**:本阶段是 **Step A 行为保持迁移首次落地**——决定后续 03-1-3 / 03-1-4 + 全部插件 Step A 起草信心。质量验证决定波次 3 真搬迁推进信心。审计完成立即结束会话。
