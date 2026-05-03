# 任务卡：refactor/graph-view-definition-skeleton(阶段 03-1-1)

> **状态**:草稿 v1
> **创建**:2026-05-03 by Commander
> **执行 Builder 会话**:(待填)
> **派活基线 SHA**:`7070566e`(main HEAD,含 02b-6 存档)

## 引用
- 总纲:[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.8 + § 2.2
- 数据契约:[src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) ViewDefinition 接口
- 现有 graph 视图入口(本阶段**不修改**):
  - [src/plugins/graph/canvas/CanvasView.tsx](../../../../src/plugins/graph/canvas/CanvasView.tsx)
  - [src/plugins/graph/renderer.tsx](../../../../src/plugins/graph/renderer.tsx)
- install 引用 capability:
  - [src/capabilities/canvas-interaction/index.ts](../../../../src/capabilities/canvas-interaction/index.ts) (02b-6 已落)
  - [src/capabilities/shape-library/index.ts](../../../../src/capabilities/shape-library/index.ts) (02b-5 已落)
- COMMANDER-PROMPT § 六纪律 1~6

## 本次范围

**波次 3.1 子阶段 1:graph.canvas ViewDefinition 骨架(首次落地 ViewDefinition)**

新建 `src/plugins/graph/views/canvas/index.ts` 声明 graphCanvasView。**首次落地 ViewDefinition 文件**——KRIG 视图层契约首次写入 plugin。

**核心命题**:graph.canvas 视图首次以 ViewDefinition 形式声明 install 列表(`capability.canvas-interaction` + `capability.shape-library`),为后续 3.1.2 (CanvasView 移动) + 3.1.3 (Step B 真搬迁) 奠定基础。

**非目标**:
- ❌ 不动 `plugins/graph/canvas/CanvasView.tsx`(1147 行,留 3.1.2)
- ❌ 不动 `plugins/graph/canvas/scene/` `interaction/` `ui/` `edit/` `persist/` 任何文件
- ❌ 不动 `plugins/graph/renderer.tsx`(暂不改 import 路径)
- ❌ 不动任何 capability 文件
- ❌ 不声明 contextMenu / toolbar(现状是动态 React 组件注入,与 § 5.4 静态声明不匹配,留 Step B)
- ❌ 不引入 ViewDefinitionRegistry runtime(等 02b-7+ 平台基建)
- ❌ 不修改 02b-* 已落 capability 任何文件

## 本分支只做

按以下顺序:

### J1:新建 `src/plugins/graph/views/canvas/index.ts`

**字节级照抄**——不允许 Builder 自行扩展:

```ts
import type { ViewDefinition } from '@shared/ui-primitives';

/**
 * graph.canvas — 图谱画板视图声明
 *
 * **波次 3.1 子阶段 1:ViewDefinition 骨架首次落地**(KRIG 视图层契约首次写入 plugin)。
 *
 * 当前阶段仅声明 viewId + install 两字段——按 § 2.2 Step A "看到 X 不动 X"
 * 原则,不声明 contextMenu / toolbar(现状是动态 React 组件注入,与 § 5.4
 * 静态声明 + `command: string` 不匹配,留 Step B 命令分离重构时处理)。
 *
 * install 列表(本阶段仅 2 个 capability,均已 capability 化):
 * - `capability.canvas-interaction` (02b-6 已落,Three.js 渲染 + 4 类协作架构)
 * - `capability.shape-library` (02b-5 已落,Shape + Substance 资源)
 *
 * 暂不 install 的 capability:
 * - `capability.text-editing` (02b-1~2c 已落,但 graph 节点 label 编辑现由
 *   `plugins/graph/canvas/edit/GraphEditor.ts` 直接 import prosemirror-*——
 *   是 § 1.3 规则 A 违规,留 03-1-3 子阶段做 Step B 真搬迁)
 * - `capability.elk-layout` (02b-7 探查证伪——graph v1 无自动布局消费视图)
 *
 * runtime 状态:本声明当前是"孤岛"(无 ViewDefinitionRegistry consumer),
 * 等 02b-7+ 平台基建落地才"通电"。这符合 § 5.3 注册时机分两段。
 *
 * 详见总纲 § 5.4 数据契约 + § 5.8 视图是声明 + § 2.2 Step A。
 *
 * 后续子阶段:
 * - 03-1-2:CanvasView + ui/ 移动到 views/canvas/
 * - 03-1-3:edit/GraphEditor.ts 违规处理
 * - 03-1-4:scene/interaction/persist 真搬迁(Step B)
 */
export const graphCanvasView: ViewDefinition = {
  viewId: 'graph.canvas',
  install: [
    'capability.canvas-interaction',
    'capability.shape-library',
  ],
};
```

**关键约束**:
- **字节级照抄上述代码**(含中文注释字符)
- import 严格 1 行(`import type { ViewDefinition } from '@shared/ui-primitives'`)
- `graphCanvasView` 顶层 const 导出(§ 5.5 强约束 1:必须是顶层 const,不能是函数返回的对象)
- `viewId` = `'graph.canvas'`(命名空间合规,§ 5.5 强约束 3 `<plugin>.<view>`)
- `install` 数组严格 2 项,顺序:`capability.canvas-interaction` → `capability.shape-library`(按"视图入口依赖优先"逻辑)
- **不声明** contextMenu / toolbar / slash / handle / floatingToolbar(本阶段范围严格限定)
- **不允许添加任何 `// eslint-disable-...` 注释**(吸收 02a G1 教训)
- **不允许** `as ViewDefinition` 等冗余断言(已实测 typecheck 通过)

### J2:新建 `src/plugins/graph/views/canvas/README.md`

**字节级照抄**:

````markdown
# graph.canvas — 图谱画板视图声明

graph 插件 canvas 视图的 ViewDefinition 声明。详见总纲 § 5.4 + § 5.8 + § 2.2。

## 当前状态(阶段 03-1-1-graph-view-definition-skeleton)

**ViewDefinition 骨架,首次落地**(KRIG 视图层契约首次写入 plugin):
- ✅ `viewId` = `'graph.canvas'`
- ✅ `install` = `['capability.canvas-interaction', 'capability.shape-library']`
- ⏸️ `contextMenu` = 未声明(留 Step B 命令分离重构)
- ⏸️ `toolbar` = 未声明(留 Step B 命令分离重构)
- ⏸️ `slash` = 未声明(graph 视图无 slash 交互需求)
- ⏸️ `handle` = 未声明(留 Step B)
- ⏸️ `floatingToolbar` = 未声明(留 Step B)

## 范围限定:不动现有视图代码

按 § 2.2 Step A "看到 X 不动 X" 原则:
- 不动 `plugins/graph/canvas/CanvasView.tsx`(1147 行)
- 不动 `plugins/graph/canvas/scene/` `interaction/` `ui/` `edit/` `persist/`
- 不动 `plugins/graph/renderer.tsx`

本阶段仅新建 ViewDefinition 声明文件——为 03-1-2 (CanvasView 移动) + 03-1-3 (Step B 真搬迁) 奠定基础。

## install 列表说明

| Capability | 来源 | 状态 |
|---|---|---|
| `capability.canvas-interaction` | 02b-6 已落 | ✅ install |
| `capability.shape-library` | 02b-5 已落 | ✅ install |
| `capability.text-editing` | 02b-1~2c 已落 | ❌ 暂不 install(graph 节点 label 编辑由 edit/GraphEditor.ts 直接 import prosemirror,留 03-1-3 处理) |
| `capability.elk-layout` | 未落地 | ❌ 不 install(02b-7 探查证伪) |

## 为什么暂不声明 contextMenu / toolbar

现状是**动态生成 + render 注入 React 组件**(CanvasView.tsx:680-880 `buildSelectionContextMenu` 等):

```ts
// 现状(动态)
function buildSelectionContextMenu(
  ids: string[],
  onCombine: () => void,
  // ... 5 个回调
): ContextMenuItem[] {
  items.push({
    id: 'shape-fill',
    label: 'Fill',
    render: (close) => <ShapeFillMenuItem ... />,  // ← React 组件注入
  });
}
```

§ 5.4 ViewDefinition 要求**静态数组 + `command: string`** 引用 CommandRegistry:

```ts
// 目标态(静态)
contextMenu: [
  { id: 'shape-fill', label: 'Fill', command: 'graph.canvas.shape-fill' },
]
```

不匹配点:
- 动态依赖运行时回调 → 静态声明不可能直接照搬
- React 组件注入 → 必须拆为 command + 渲染元数据
- 命令实现需注册到 CommandRegistry(目前 graph 0 处注册)

按 § 2.2 Step A 字面"代码内部行为零改动",**这是 Step B "边界重画"的工作**——留 03-1-3+ 处理。

## runtime 状态

本声明当前是"孤岛"——无 ViewDefinitionRegistry consumer。

按 § 5.3 注册时机分两段:
1. **声明阶段(本阶段)**:写 ViewDefinition 文件,纯类型声明
2. **运行时阶段(待 02b-7+ 平台基建)**:ViewDefinitionRegistry 读 install 列表,实例化 capability,装配交互项

03-1-1 完成本声明;运行时通电延后处理。

## 设计原则(总纲引用)

- § 2.2 Step A 行为保持迁移:只允许移动文件、加包装层、改 import 路径、新建 ViewDefinition 文件
- § 5.4 数据契约:ViewDefinition 含 viewId / install / 五大交互项(全 optional)
- § 5.5 强约束:必须顶层 const、命名空间化、capability 不互相 install
- § 5.8 视图是声明,实现都在 Capability 里——graph.canvas 通过 install canvas-interaction 引用 Three.js 渲染

## 后续子阶段路径图

| 子阶段 | 任务 | 影响目录 |
|---|---|---|
| **03-1-1(本阶段)** | **ViewDefinition 骨架** | **新建 `views/canvas/`** |
| 03-1-2 | CanvasView + ui/ 移动 | `canvas/CanvasView.tsx` + `canvas/ui/` → `views/canvas/` |
| 03-1-3 | edit/GraphEditor.ts 违规处理 | `canvas/edit/` → 决策合并 capability.text-editing 或独立子 capability |
| 03-1-4 | scene/interaction/persist 真搬迁 | `canvas/scene/` `canvas/interaction/` → `src/capabilities/canvas-interaction/` 内 |
````

**关键约束**:
- **字节级照抄**
- 路径 `src/plugins/graph/views/canvas/README.md` 严格匹配
- 不创建任何 `views/canvas/` 子目录或其他文件

### J3:新建 `src/plugins/graph/views/README.md`

**字节级照抄**:

```markdown
# plugins/graph/views/ — graph 插件视图声明

按总纲 § 5.8 目标态,L5 plugin 内**视图声明**统一放 `plugins/<X>/views/<view>/index.ts`。

## 当前状态(阶段 03-1-1-graph-view-definition-skeleton)

| 视图 | 路径 | 状态 |
|---|---|---|
| `graph.canvas` | [`canvas/index.ts`](./canvas/index.ts) | ✅ ViewDefinition 骨架(03-1-1 落地) |
| `graph.family-tree` | (未来 family-tree 子阶段) | ⏸️ 未实现(graph variant) |
| `graph.knowledge` | (未来 knowledge 子阶段) | ⏸️ 未实现(graph variant) |
| `graph.mindmap` | (未来 mindmap 子阶段) | ⏸️ 未实现(graph variant) |

## 与 plugins/graph/canvas/ 的关系

**当前阶段(03-1-1)**:`views/canvas/` 仅含 ViewDefinition 声明,**实际视图代码仍在 `canvas/CanvasView.tsx`**(1147 行)。

**后续子阶段(03-1-2)**:CanvasView + ui/ 等纯视图代码搬入 `views/canvas/`,届时 `canvas/` 目录仅保留待 Step B 真搬迁的子目录(scene/ interaction/ persist/ edit/)。

**最终态(完成 03-1-3 + 03-1-4 后)**:
- `views/canvas/` = 视图声明 + 视图主体(CanvasView.tsx + ui/)
- `canvas/` 目录消失(scene/ interaction/ → capability.canvas-interaction;edit/ → capability.text-editing 或独立子 capability;persist/ → ?)

## 设计原则(总纲引用)

- § 2.2 Step A 行为保持迁移:只允许移动文件、加包装层、改 import 路径、新建 ViewDefinition 文件
- § 4.1 目录结构:`plugins/<X>/views/<view>/index.ts` 是视图声明目标位置
- § 5.4 数据契约:ViewDefinition 含 viewId / install / 五大交互项(全 optional)
- § 5.8 视图是声明,实现都在 Capability 里——视图层不直接 import 外部 npm 包

## 临时引用模式说明(总纲 § 2"新旧 API 共存")

本阶段及前序阶段所有 capability 字段引用 `plugins/<X>/` 内现有导出,不搬业务代码。真搬迁推到波次 3 子阶段 4(03-1-4) graph 整体迁移时做。
```

**关键约束**:
- **字节级照抄**
- 路径 `src/plugins/graph/views/README.md` 严格匹配
- 不创建任何 `views/` 下其他文件(本阶段范围严格 3 文件)

## 严禁顺手做

- ❌ **不修改** `src/plugins/graph/canvas/` 任何文件(包括 CanvasView.tsx / scene/ / interaction/ / ui/ / edit/ / persist/)
- ❌ **不修改** `src/plugins/graph/renderer.tsx`(暂不改 import 路径,留 03-1-2)
- ❌ **不修改** `src/plugins/graph/library/` 任何文件(02b-5 引用对象)
- ❌ **不修改** `src/plugins/graph/main/` `navside/` 任何文件
- ❌ **不修改** 任何 `src/capabilities/<x>/` 文件(02b-1~02b-6 已落)
- ❌ **不声明** ViewDefinition 的 contextMenu / toolbar / slash / handle / floatingToolbar(留 Step B)
- ❌ **不创建** 任何 `views/canvas/` 下除 index.ts + README.md 外的文件
- ❌ **不创建** 任何 `views/` 下除 README.md + canvas/ 外的目录或文件
- ❌ **不创建** 任何 `plugins/<其他插件>/views/` 目录(本阶段仅 graph 插件)
- ❌ **不修改** ESLint / tsconfig.json / package.json / schema-* / memory
- ❌ **不引入** ViewDefinitionRegistry runtime(等 02b-7+ 平台基建)
- ❌ **不擅自做** merge / push

## 完成判据

- [ ] **J1**:`src/plugins/graph/views/canvas/index.ts` 字节级匹配 task-card § J1
- [ ] **J1 子项**:1 行 import(`import type { ViewDefinition } from '@shared/ui-primitives'`)
- [ ] **J1 子项**:`graphCanvasView` 顶层 const 导出(§ 5.5 强约束 1)
- [ ] **J1 子项**:`viewId` = `'graph.canvas'`(命名空间合规)
- [ ] **J1 子项**:`install` 数组严格 2 项,顺序 canvas-interaction → shape-library
- [ ] **J1 子项**:不含 contextMenu / toolbar / slash / handle / floatingToolbar 字段
- [ ] **J1 子项**:不含任何 `// eslint-disable-...` 注释
- [ ] **J1 子项**:不含任何 `as ViewDefinition` 等冗余断言
- [ ] **J2**:`src/plugins/graph/views/canvas/README.md` 字节级匹配 task-card § J2
- [ ] **J2 子项**:含 7 段(标题 + 当前状态 + 范围限定 + install 列表 + 为什么暂不声明 contextMenu/toolbar + runtime 状态 + 设计原则 + 后续子阶段路径图)
- [ ] **J3**:`src/plugins/graph/views/README.md` 字节级匹配 task-card § J3
- [ ] **J3 子项**:含 4 段(标题 + 当前状态 + 与 plugins/graph/canvas/ 关系 + 设计原则 + 临时引用模式)
- [ ] **J4**:`git diff 7070566e..HEAD --stat`(**强制双点 diff + 显式基线 SHA `7070566e`**)含且仅含以下 3 个文件:
      - `src/plugins/graph/views/canvas/index.ts`(新建)
      - `src/plugins/graph/views/canvas/README.md`(新建)
      - `src/plugins/graph/views/README.md`(新建)
- [ ] **J5a**:`npm run typecheck` exit 0
- [ ] **J5b**:`npm run lint` exit 1,**errors=766 / warnings=15** 与 main baseline 完全一致
- [ ] **J5c**:`npm run lint:dirs` exit 0(白名单豁免有效)
- [ ] **J6**:所有 commit message 符合 CLAUDE.md `feat/docs(refactor/graph-view-definition-skeleton): ...` 格式
- [ ] **J7**:`find src/plugins/graph/views -type d` 输出 2 行(`views` + `views/canvas`)
- [ ] **J8**:`find src/plugins/graph/views -type f` 输出 3 行(`views/README.md` + `views/canvas/index.ts` + `views/canvas/README.md`)

## 已知风险

- **R1(已实测)**:Commander 已模拟 J1 字节级 + 跑 typecheck=0 / lint:dirs=0 / lint errors+warnings 数严格不变(766e+15w)✅
- **R2(首次落地新文件类型)**:本阶段是 **ViewDefinition 文件首次落地**——README 必须清楚说明设计理由(为什么暂不声明 contextMenu/toolbar + runtime 是孤岛)
- **R3(吸收 02a G1 教训)**:task-card § J1/J2/J3 字节级模板**不含**任何 `eslint-disable-...` 注释。J5b warnings=15 严格成立
- **R4**:`views/canvas/` 目录下不允许除 index.ts + README.md 外任何文件;`views/` 下不允许除 README.md + canvas/ 外任何文件
- **R5(基线锁定)**:派活基线 `7070566e` = main 当前 HEAD(02b-6 存档后)
- **R6(lint baseline 修正)**:实测 main lint errors=**766**(不是审计报告记录的 765)。差异是历史漂移,不是 02b-6 引入。本阶段 baseline 严格按 766 验证
- **R7(范围严格限定)**:本阶段只新建 3 文件,不动任何现有视图/capability/平台代码。Builder 严守"看到 X 不动 X"
- **R8(install 列表严格 2 项)**:不允许 Builder 自行加入 capability.text-editing 等(graph 节点 label 编辑违规留 Step B)

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认(已答)

1. **`graphCanvasView` 是否需要在某处 import 注册?** —— **Commander 答**:**不需要**(本阶段是声明孤岛,等 02b-7+ ViewDefinitionRegistry runtime 落地才 import 注册)
2. **是否需要 `as ViewDefinition` 类型断言?** —— **Commander 答**:**不需要**(直接赋值即可,已实测 typecheck 通过)
3. **install 列表是否需要包含 `capability.text-editing`?** —— **Commander 答**:**不**(graph 节点 label 编辑现由 edit/GraphEditor.ts 直接 import prosemirror,留 03-1-3 子阶段处理)
4. **是否需要声明 contextMenu / toolbar?** —— **Commander 答**:**不**(现状动态 React 组件注入,与 § 5.4 静态声明不匹配,留 Step B)
5. **是否需要修改 renderer.tsx 引用新 ViewDefinition?** —— **Commander 答**:**不**(本阶段范围严格限定 3 文件,renderer.tsx 修改留 03-1-2)
6. **3 个 commit 还是 1 个?** —— **Commander 答**:Builder 自决,建议 3 个(J1/J2/J3)

## Builder 完成后

- 写报告到 `tmp/builder-report.md`(按 BUILDER-PROMPT § 五格式)
- 输出"builder-report 就绪:tmp/builder-report.md"
- **不做** merge / push

## 备注:本次为基础设施类阶段(波次 3 首次启动 + ViewDefinition 文件首次落地)

本次为波次 3 子波次 3.1 第一子阶段(graph ViewDefinition 骨架),**采用纯新建模式**——不动现有视图/capability 代码。BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动自检"契约 § B 防御代码 grep 验证"跳过。

本阶段简单(预期仅 3 文件改动)——**ViewDefinition 文件首次落地,KRIG 视图层契约首次写入 plugin**。
