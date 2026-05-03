# 任务卡:refactor/graph-views-relocation(阶段 03-1-2)

> **状态**:草稿 v1
> **创建**:2026-05-03 by Commander
> **执行 Builder 会话**:(待填)
> **派活基线 SHA**:`e22e8517`(main HEAD,含 03-1-1 存档)

## 引用
- 总纲:[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 2.2 + § 5.8
- 03-1-1 ViewDefinition 文件(本阶段不动):
  - [src/plugins/graph/views/canvas/index.ts](../../../../src/plugins/graph/views/canvas/index.ts)
- 搬移源文件(本阶段处理):
  - [src/plugins/graph/canvas/CanvasView.tsx](../../../../src/plugins/graph/canvas/CanvasView.tsx) (1147 行)
  - [src/plugins/graph/canvas/ui/](../../../../src/plugins/graph/canvas/ui/) (6 文件)
- import 修改对象:
  - [src/plugins/graph/renderer.tsx](../../../../src/plugins/graph/renderer.tsx)
- 不动对象(其他子阶段处理):
  - `canvas/scene/` `canvas/interaction/`(03-1-4)
  - `canvas/edit/`(03-1-3)
  - `canvas/persist/` `canvas/combine.ts`(03-1-4)
- COMMANDER-PROMPT § 六纪律 1~6

## 本次范围

**波次 3.1 子阶段 2:graph 纯视图代码搬移到目标态目录**

用 `git mv` 把 `plugins/graph/canvas/CanvasView.tsx` + `plugins/graph/canvas/ui/` 全套搬入 `plugins/graph/views/canvas/`,然后纯调整 import 路径,**代码内部行为零改动**(§ 2.2 Step A 字面要求)。

**核心命题**:用 `git mv` 保留 history blame 链;import 路径调整严格按 task-card § J3 规则表执行;不允许"顺手"修改任何代码逻辑。

**非目标**:
- ❌ 不修改 CanvasView.tsx 任何业务逻辑(useEffect / hook / 事件监听器 / setState / 内部函数等全部不动)
- ❌ 不修改 ui/ 任何组件业务逻辑
- ❌ 不动 `canvas/scene/` `canvas/interaction/`(留 03-1-4)
- ❌ 不动 `canvas/edit/`(留 03-1-3)
- ❌ 不动 `canvas/persist/` `canvas/combine.ts`(留 03-1-4)
- ❌ 不动 03-1-1 已落 `views/canvas/index.ts` + `views/canvas/README.md` + `views/README.md`
- ❌ 不动任何 capability 文件(02b-1~02b-6 已落)
- ❌ 不动 main / shared / renderer 进程任何文件
- ❌ 不引入任何新文件(不创建 wrapper / barrel / re-export 等)

## 本分支只做

按以下顺序:

### J1:`git mv` 搬移 CanvasView.tsx

```bash
git mv src/plugins/graph/canvas/CanvasView.tsx src/plugins/graph/views/canvas/CanvasView.tsx
```

**关键约束**:
- 必须用 `git mv`(保留 history rename 检测)
- 不允许 `cp` + `rm` 模式(会破坏 git rename 追踪)
- 不允许"`git rm` + 新建文件并粘贴内容"模式
- 不修改文件内容(本步骤仅移动,内容修改在 J3)

### J2:`git mv` 搬移 ui/ 全套

```bash
git mv src/plugins/graph/canvas/ui src/plugins/graph/views/canvas/ui
```

**关键约束**:
- 一次 `git mv` 整个 ui/ 目录(6 文件全套)
- 不允许逐文件 mv(虽然结果等价,但一次性 mv 更清晰)
- 不修改任何 ui/ 文件内容(内容修改在 J3)

### J3:调整 5 个文件的 import 路径

按以下**字节级精确**调整规则表执行:

#### J3.1: `src/plugins/graph/renderer.tsx` (1 处调整)

```diff
- import { CanvasView } from './canvas/CanvasView';
+ import { CanvasView } from './views/canvas/CanvasView';
```

#### J3.2: `src/plugins/graph/views/canvas/CanvasView.tsx` (13 处调整)

| 原 import | 新 import |
|---|---|
| `from './scene/SceneManager'` | `from '../../canvas/scene/SceneManager'` |
| `from './scene/NodeRenderer'` | `from '../../canvas/scene/NodeRenderer'` |
| `from './scene/HandlesOverlay'` | `from '../../canvas/scene/HandlesOverlay'` |
| `from './interaction/InteractionController'` | `from '../../canvas/interaction/InteractionController'` |
| `from './ui/Toolbar/Toolbar'` | (**不变** - ui/ 一起搬,相对路径不变) |
| `from './ui/LibraryPicker/LibraryPicker'` | (**不变**) |
| `from './ui/Inspector/FloatingInspector'` | (**不变**) |
| `from './ui/ContextMenu/ContextMenu'` | (**不变**) |
| `from './ui/dialogs/CreateSubstanceDialog'` | (**不变**) |
| `from './edit/EditOverlay'` | `from '../../canvas/edit/EditOverlay'` |
| `from './edit/atom-bridge'` | `from '../../canvas/edit/atom-bridge'` |
| `from './combine'` | `from '../../canvas/combine'` |
| `from './persist/serialize'` | `from '../../canvas/persist/serialize'` |
| `from '../library/shapes'` | `from '../../library/shapes'` |
| `from '../library/substances'` | `from '../../library/substances'` |
| `from '../library/types'` | `from '../../library/types'` |
| `from '../../../shared/types/atom-types'` | `from '../../../../shared/types/atom-types'` |
| `from '../../../shared/types/graph-types'` | `from '../../../../shared/types/graph-types'` |

#### J3.3: `src/plugins/graph/views/canvas/ui/Inspector/FloatingInspector.tsx` (1 处调整)

```diff
- import type { Instance } from '../../../library/types';
+ import type { Instance } from '../../../../library/types';
```

#### J3.4: `src/plugins/graph/views/canvas/ui/LibraryPicker/LibraryPicker.tsx` (4 处调整)

```diff
- import { ShapeRegistry } from '../../../library/shapes';
- import { SubstanceRegistry } from '../../../library/substances';
- import type { AddModeSpec } from '../../interaction/InteractionController';
- import type { ShapeCategory } from '../../../library/types';
+ import { ShapeRegistry } from '../../../../library/shapes';
+ import { SubstanceRegistry } from '../../../../library/substances';
+ import type { AddModeSpec } from '../../../../canvas/interaction/InteractionController';
+ import type { ShapeCategory } from '../../../../library/types';
```

#### J3.5: `src/plugins/graph/views/canvas/ui/LibraryPicker/preview-svg.ts` (3 处调整)

```diff
- import { ShapeRegistry, ... } from '../../../library/shapes';
- import { SubstanceRegistry } from '../../../library/substances';
- import type { ... } from '../../../library/types';
+ import { ShapeRegistry, ... } from '../../../../library/shapes';
+ import { SubstanceRegistry } from '../../../../library/substances';
+ import type { ... } from '../../../../library/types';
```

#### J3.6: 不调整的文件(0 处变更)

以下 ui/ 子文件**内部 import 不需要调整**(自验证用):
- `views/canvas/ui/ContextMenu/ContextMenu.tsx`(只 import react)
- `views/canvas/ui/Toolbar/Toolbar.tsx`(只 import react)
- `views/canvas/ui/dialogs/CreateSubstanceDialog.tsx`(只 import react + 内部相对)

**关键约束**:
- 严格按上述 22 处调整(0 顺手新增 / 删除 import)
- 不修改任何 import 之外的代码(useEffect / hook / 事件监听器 / 函数体一律不动)
- **不允许**改动注释(包括清理"过时"注释)
- **不允许**重排 import 顺序(只调整路径)
- **不允许**新增 / 删除 import 语句(只调整路径文本)

## 严禁顺手做

- ❌ **不修改** 任何业务代码(useEffect / hook / setState / 函数体 / JSX 等一律不动)
- ❌ **不修改** 注释 / 空行 / 缩进(纯路径调整)
- ❌ **不重排** import 顺序(只调整路径文本)
- ❌ **不新增** / 删除 import 语句
- ❌ **不动** `canvas/scene/` `canvas/interaction/` `canvas/edit/` `canvas/persist/` `canvas/combine.ts`
- ❌ **不动** 03-1-1 已落 `views/canvas/index.ts` + `views/canvas/README.md` + `views/README.md`
- ❌ **不动** 任何 `src/capabilities/<x>/` 文件
- ❌ **不动** 任何 `src/main/` `src/renderer/` `src/shared/` 文件
- ❌ **不动** ESLint / tsconfig.json / package.json
- ❌ **不创建** wrapper / barrel / re-export 文件
- ❌ **不擅自做** merge / push

## 完成判据

- [ ] **J1**:`git mv src/plugins/graph/canvas/CanvasView.tsx src/plugins/graph/views/canvas/CanvasView.tsx` 执行成功
- [ ] **J1 子项**:`src/plugins/graph/canvas/CanvasView.tsx` 不存在(已搬走)
- [ ] **J1 子项**:`src/plugins/graph/views/canvas/CanvasView.tsx` 存在(目标位置)
- [ ] **J1 子项**:git status 显示 `R` (rename) 或 `RM` (rename + modify)
- [ ] **J2**:`git mv src/plugins/graph/canvas/ui src/plugins/graph/views/canvas/ui` 执行成功
- [ ] **J2 子项**:`src/plugins/graph/canvas/ui/` 目录不存在(已搬走)
- [ ] **J2 子项**:`src/plugins/graph/views/canvas/ui/` 含 6 文件(Inspector/FloatingInspector.tsx + LibraryPicker/LibraryPicker.tsx + LibraryPicker/preview-svg.ts + Toolbar/Toolbar.tsx + ContextMenu/ContextMenu.tsx + dialogs/CreateSubstanceDialog.tsx)
- [ ] **J3**:5 个文件的 import 路径调整严格符合 task-card § J3 规则表
- [ ] **J3.1**:`renderer.tsx` 1 处调整(`./canvas/CanvasView` → `./views/canvas/CanvasView`)
- [ ] **J3.2**:`views/canvas/CanvasView.tsx` 13 处调整(详见 § J3.2 表)
- [ ] **J3.3**:`views/canvas/ui/Inspector/FloatingInspector.tsx` 1 处调整
- [ ] **J3.4**:`views/canvas/ui/LibraryPicker/LibraryPicker.tsx` 4 处调整
- [ ] **J3.5**:`views/canvas/ui/LibraryPicker/preview-svg.ts` 3 处调整
- [ ] **J3.6**:`views/canvas/ui/{ContextMenu,Toolbar,dialogs}` 0 处调整(自验证)
- [ ] **J4**:`git diff e22e8517..HEAD --stat` 严格 8 文件改动:
      - `src/plugins/graph/renderer.tsx`(M,+1/-1)
      - `src/plugins/graph/canvas/CanvasView.tsx → views/canvas/CanvasView.tsx`(RM,+13/-13)
      - `src/plugins/graph/canvas/ui/Inspector/FloatingInspector.tsx → views/canvas/ui/...`(RM,+1/-1)
      - `src/plugins/graph/canvas/ui/LibraryPicker/LibraryPicker.tsx → views/canvas/ui/...`(RM,+4/-4)
      - `src/plugins/graph/canvas/ui/LibraryPicker/preview-svg.ts → views/canvas/ui/...`(RM,+3/-3)
      - `src/plugins/graph/canvas/ui/Toolbar/Toolbar.tsx → views/canvas/ui/...`(R,0/0)
      - `src/plugins/graph/canvas/ui/ContextMenu/ContextMenu.tsx → views/canvas/ui/...`(R,0/0)
      - `src/plugins/graph/canvas/ui/dialogs/CreateSubstanceDialog.tsx → views/canvas/ui/...`(R,0/0)
      - 总改动 +23/-22 行(实测值)
      - 注:本阶段 J4 口径同步沿用 03-1-1 修订经验——以"task-card 立卡 commit SHA..HEAD"为实质改动 diff 起点,而不是"派活基线..HEAD"
- [ ] **J5a**:`npm run typecheck` exit 0
- [ ] **J5b**:`npm run lint` exit 1,**warnings=15** 严格不变(errors 数受 ESLint cache 影响,验证 warnings=15 + 数值变化幅度 < 5 即可)
- [ ] **J5c**:`npm run lint:dirs` exit 0
- [ ] **J6**:所有 commit message 符合 CLAUDE.md `feat/refactor(refactor/graph-views-relocation): ...` 格式
- [ ] **J7**:`find src/plugins/graph/canvas -type f` 不再含 CanvasView.tsx 或 ui/ 任何文件
- [ ] **J8**:`find src/plugins/graph/views/canvas -type f` 含 9 文件(03-1-1 已有 2 + 本阶段新增 7)

## 已知风险

- **R1(已实测)**:Commander 已在 git worktree 内完整模拟 J1+J2+J3+J5 三件 → typecheck=0 / lint warnings=15 严格不变 / lint:dirs=0 / 8 文件改动 +23/-22 行 ✅
- **R2(import 路径深度计算复杂)**:CanvasView.tsx 在 `views/canvas/` 是 4 层深度(`src/plugins/graph/views/canvas/`),从这里 import `library/` 需穿出 2 层(`../../library/...`);ui/ 子文件在 `views/canvas/ui/<X>/` 是 5 层,需穿出 4 层(`../../../../library/...`)。task-card § J3 规则表已字节级给出,Builder 严格照抄即可
- **R3(吸收 02a G1 教训)**:本阶段不引入新代码,**只调整 import 路径**——0 处可能添加 eslint-disable 注释。J5b warnings=15 严格成立
- **R4(git rename 检测)**:必须用 `git mv` 不允许 `cp+rm`——否则 git rename 检测失败,history blame 链断裂(R4 硬约束)
- **R5(基线锁定)**:派活基线 `e22e8517` = main 当前 HEAD(03-1-1 存档后)
- **R6(lint baseline 修正)**:实测 main lint errors=766(详见 03-1-1 task-card R6)。本阶段验证以 warnings=15 严格不变为主,errors 数变化 < 5 视为可接受(ESLint cache 不一致是已知问题)
- **R7(范围严格限定)**:本阶段只动 8 文件,不动 03-1-1 已落 views/ 下的 ViewDefinition + 2 README 文件
- **R8(代码内部行为零改动)**:除 import 路径外,**任何业务代码、注释、空行、缩进、import 顺序都不允许变动**——这是 § 2.2 Step A 字面硬约束

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认(已答)

1. **`git mv` 后 import 路径不修改是否可以一次性 commit?** —— **Commander 答**:**不可以**(typecheck 必报错)。建议:J1+J2+J3 一次性完成后再 commit;或拆 commit:`git mv` 阶段(不 commit) + import 调整阶段(commit)。Builder 自决,推荐 3 commit:J1(git mv CanvasView)+ J2(git mv ui)+ J3(import 路径调整),每个 commit 间不跑 typecheck(都会失败),最后 J3 完成后跑
2. **commit 顺序与 git rename 检测**:`git mv` 后立即 commit,git 会标 R(rename);先 mv 再修改文件再 commit,git 仍然能检测 R(只要相似度 > 50%)。两种都 OK
3. **import 路径调整是否需要用 sed/AST 工具?** —— **Commander 答**:Builder 自决。推荐 sed(实测有效)或手工 Edit 工具,关键是字节级符合 § J3 规则表
4. **如果 typecheck 报错与预期不一致怎么办?** —— **Commander 答**:对照 § J3 规则表逐条检查。如确实有路径错误未列出,标 BLOCKING 写 `tmp/builder-blockers.md`
5. **3 个 commit 还是 1 个?** —— **Commander 答**:Builder 自决,推荐 3 个(J1 git mv CanvasView / J2 git mv ui / J3 import 路径调整)
6. **要不要在 ViewDefinition (03-1-1 已落)中加 import CanvasView?** —— **Commander 答**:**不要**(本阶段范围严格限定,03-1-1 ViewDefinition 文件不动)

## Builder 完成后

- 写报告到 `tmp/builder-report.md`(按 BUILDER-PROMPT § 五格式)
- 输出"builder-report 就绪:tmp/builder-report.md"
- **不做** merge / push

## 备注:本次为 Step A 行为保持迁移(首次落地)

本次为波次 3 子波次 3.1 第二子阶段(graph 纯视图代码搬移),**采用 git mv + import 路径调整模式**——按 § 2.2 Step A "代码内部行为零改动" 字面硬约束。BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**(基础设施类阶段)。Builder 启动自检"契约 § B 防御代码 grep 验证"跳过。

本阶段是 **Step A 行为保持迁移首次落地**——决定后续 03-1-3 / 03-1-4 + 全部插件 Step A 起草信心。Builder 严守"看到 X 不动 X" + 按 § J3 字节级规则表执行。
