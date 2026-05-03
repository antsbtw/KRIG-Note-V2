# 任务卡：refactor/canvas-interaction（阶段 02b-6-canvas-interaction）

> **状态**：草稿 v1
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）
> **派活基线 SHA**：`48f649c8`(main HEAD)

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.9 + § 2
- 数据契约：[src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口
- 现有 4 个核心类(capability 引用对象，**不修改**)：
  - [src/plugins/graph/canvas/scene/SceneManager.ts](../../../../src/plugins/graph/canvas/scene/SceneManager.ts)
  - [src/plugins/graph/canvas/interaction/InteractionController.ts](../../../../src/plugins/graph/canvas/interaction/InteractionController.ts)
  - [src/plugins/graph/canvas/scene/NodeRenderer.ts](../../../../src/plugins/graph/canvas/scene/NodeRenderer.ts)
  - [src/plugins/graph/canvas/scene/HandlesOverlay.ts](../../../../src/plugins/graph/canvas/scene/HandlesOverlay.ts)
- 02b-3/4/5 样板参考：pdf-rendering / epub-rendering（实例工厂型）/ shape-library（资源访问型）
- COMMANDER-PROMPT § 六纪律 1~6

## 本次范围

**波次 2 第二阶段第八步：新建 capability.canvas-interaction(混合型,首次,一阶段完成)**

新建第五个 capability `capability.canvas-interaction`，临时引用 `plugins/graph/canvas/` 内 4 个核心类。**首次落地混合型 capability**——KRIG capability 第四种形态。

**核心命题**：发现并验证 capability 第四种形态——混合型。canvas-interaction 既需要 createInstance 工厂（每画板一个 SceneManager 实例），又需要 schema 暴露多个类构造函数（视图按需 new 辅助类）。

**非目标**:
- ❌ 不搬迁 SceneManager / InteractionController / NodeRenderer / HandlesOverlay 任何类
- ❌ 不动 plugins/graph/canvas/ 任何文件
- ❌ 不动 CanvasView.tsx 视图入口
- ❌ 不暴露 DotGrid / TextRenderer / LineRenderer（被 SceneManager 内部封装,视图不直接用）
- ❌ 不动 02b-text-editing / pdf-rendering / epub-rendering / shape-library 已完成的 capability（仅引用现有 capability/ 目录的 README.md）

## 本分支只做

按以下顺序：

### J1：新建 `src/capabilities/canvas-interaction/index.ts`

**字节级照抄**——不允许 Builder 自行扩展：

```ts
import type { Capability, CapabilityInstance, CapabilityOptions, HostElement } from '@shared/ui-primitives';
import { SceneManager } from '@plugins/graph/canvas/scene/SceneManager';
import { InteractionController } from '@plugins/graph/canvas/interaction/InteractionController';
import { NodeRenderer } from '@plugins/graph/canvas/scene/NodeRenderer';
import { HandlesOverlay } from '@plugins/graph/canvas/scene/HandlesOverlay';

/**
 * capability.canvas-interaction — 图谱画板交互能力
 *
 * **形态:混合型 capability**(KRIG capability 第四种形态首次落地)。
 * 既是实例工厂型(createInstance 实例化 SceneManager 入口),又是资源访问型
 * (schema 暴露 4 个类构造函数引用)——这是已有三种形态都不能单独覆盖的
 * 多类协作架构。
 *
 * 临时引用模式(总纲 § 2 推进策略"新旧 API 共存"):
 * createInstance 工厂直接 new SceneManager(入口);schema 字段承载 4 个类
 * 构造函数引用(SceneManager / InteractionController / NodeRenderer /
 * HandlesOverlay),调用方通过 schema 拿到 class 后按需 new 辅助类。
 * 真搬迁推到波次 3 graph 整体迁移时做(届时 4 个类整体搬入 capability)。
 *
 * **4 个类完全无 React 依赖**(都是纯 Three.js class)。
 *
 * **schema 形态差异(与 shape-library 对比)**:
 * - shape-library schema = 单例引用(`{ shapes, substances }` 都是 new XxxImpl() 后的实例)
 * - canvas-interaction schema = **类构造函数引用**(`{ SceneManager, NodeRenderer, ... }` 都是 class 本身)
 * - 调用方使用:`const nr = new schema.NodeRenderer(sm)` 而非 `schema.shapes.get(id)`
 *
 * **不暴露的辅助类**(在 SceneManager 内部封装):
 * - DotGrid:点阵网格,被 SceneManager 内部使用(视图不需直接 new)
 * - TextRenderer:文字渲染,同上
 * - LineRenderer:纯函数模块(不是 class),不适合暴露
 *
 * 字段说明:
 * - schema:✅ canvasInteractionSchema(4 个类构造函数聚合,本阶段填)
 * - converters:undefined(canvas-interaction 不涉及 atom 转换)
 * - createInstance:✅ canvasInteractionCreateInstance 工厂(临时引用 SceneManager 入口,本阶段填)
 * - commands:undefined(当前阶段不引入命令——调用方直接调 SceneManager / InteractionController 方法)
 *
 * 详见总纲 § 5.4 数据契约 + § 5.9 能力清单。
 *
 * 主要消费视图(详见总纲 § 5.9):
 * - graph.canvas(当前主消费方,CanvasView.tsx 1147 行入口)
 * - graph.family-tree 及未来所有 graph 变种视图
 */

const canvasInteractionSchema = {
  SceneManager,
  InteractionController,
  NodeRenderer,
  HandlesOverlay,
};

const canvasInteractionCreateInstance = (
  host: HostElement,
  _options: CapabilityOptions,
): CapabilityInstance => {
  // 临时引用 plugin/graph/canvas 内 SceneManager 入口类(波次 3 真搬迁)
  return new SceneManager(host as HTMLElement) as CapabilityInstance;
};

export const canvasInteractionCapability: Capability = {
  id: 'capability.canvas-interaction',

  // schema:✅ 4 个类构造函数聚合(本阶段填,混合型)
  schema: canvasInteractionSchema,

  // converters:undefined(canvas-interaction 不涉及 atom 转换)
  converters: undefined,

  // createInstance:✅ SceneManager 入口工厂(本阶段填,混合型)
  createInstance: canvasInteractionCreateInstance,

  // commands:undefined(当前阶段不引入命令)
  commands: undefined,
};
```

**关键约束**：
- **字节级照抄上述代码**(含中文注释字符)
- import 严格 5 行(按上述顺序：Capability+CapabilityInstance+CapabilityOptions+HostElement / SceneManager / InteractionController / NodeRenderer / HandlesOverlay)
- `canvasInteractionSchema` 是模块级 const,聚合 4 个类构造函数(便于将来扩展)
- `canvasInteractionCreateInstance` 是模块级 const(便于将来扩展);第一参数 `host` 不带下划线前缀(本阶段实际使用),第二参数 `_options` 带前缀(未使用)
- canvasInteractionCapability 5 字段顺序严格：id → schema → converters → createInstance → commands
- 2 个字段（converters/commands）值严格为 `undefined`(不允许 null / 删除字段)
- schema = `canvasInteractionSchema`(模块级 const,不内联)
- createInstance = `canvasInteractionCreateInstance`(模块级 const,不内联)
- **不允许添加任何 `// eslint-disable-...` 注释**(吸收 02a G1 教训)
- `as HTMLElement` + `as CapabilityInstance` 双向断言保留(HostElement = unknown / CapabilityInstance = unknown 兜底类型必需)

### J2：新建 `src/capabilities/canvas-interaction/README.md`

**字节级照抄**：

```markdown
# capability.canvas-interaction

图谱画板交互能力(基于 Three.js,4 个核心类协作架构)。详见总纲 § 5.9 能力清单 + § 5.4 数据契约。

## 当前状态(阶段 02b-6-canvas-interaction)

**混合型 capability,一阶段完成**:`canvasInteractionCapability` 5 字段:
- ✅ `id` = `'capability.canvas-interaction'`
- ✅ `schema` = `canvasInteractionSchema`(4 个类构造函数聚合 { SceneManager, InteractionController, NodeRenderer, HandlesOverlay })
- ⏸️ `converters` = `undefined`(canvas-interaction 不涉及 atom 转换)
- ✅ `createInstance` = `canvasInteractionCreateInstance` 工厂(临时引用 SceneManager 入口)
- ⏸️ `commands` = `undefined`(当前阶段不引入命令)

## 形态分类:混合型(首次落地)

本 capability 是 KRIG capability **第四种形态**——混合型 capability。

| 形态 | schema | createInstance | 已落地 capability |
|------|--------|---------------|-----------------|
| 复合型 | ✅(blockRegistry)| ❌ | text-editing(02b-1~2c)|
| 实例工厂型 | ❌ | ✅(单类工厂)| pdf-rendering(02b-3) / epub-rendering(02b-4)|
| 资源访问型 | ✅(单例引用)| ❌ | shape-library(02b-5)|
| **混合型** | **✅(类构造函数引用)** | **✅(入口工厂)** | **canvas-interaction(02b-6,本阶段)** |

至此 KRIG capability 四种形态全部落地。

## schema 内容差异(与 shape-library 对比)

混合型与资源访问型都用 schema 字段,但内容性质不同:

| 形态 | schema 内容 | 调用方使用 |
|------|------------|----------|
| 资源访问型(shape-library)| 单例引用 `{ shapes, substances }`(已 new 后的实例)| `schema.shapes.get('arrow-block')` |
| **混合型(canvas-interaction)** | **类构造函数 `{ SceneManager, NodeRenderer, ... }`(class 本身)** | `const nr = new schema.NodeRenderer(sm)` |

## 4 个类协作架构(为什么 schema + createInstance 都需要)

```
new SceneManager(host)              ← createInstance 入口工厂
  ↓
new NodeRenderer(sm)                ← schema 暴露的类,视图按需 new
new HandlesOverlay(sm)              ← 同上
  ↓
new InteractionController({...})    ← 接收前 3 者实例
```

调用方先 new 入口(SceneManager,通过 createInstance),然后用 schema 中的类构造函数 new 辅助类(NodeRenderer / HandlesOverlay),最后 new 控制器(InteractionController,接收所有引用)。

## 不暴露的辅助类(在 SceneManager 内部封装)

- **DotGrid**:点阵网格,被 SceneManager 内部使用(视图不需直接 new)
- **TextRenderer**:文字渲染,同上
- **LineRenderer**:纯函数模块(不是 class),不适合通过 schema 暴露

## 设计原则(总纲引用)

- § 1.3 规则 A:外部依赖必须经 Capability 封装,视图禁止直接 import
- § 5.4 数据契约:Capability 接口含 schema / converters / createInstance / commands 等字段(全 optional,混合型 schema + createInstance 都填)
- § 5.5 强约束:命名空间 `capability.canvas-interaction`、禁套娃、颗粒度按"未来可扩展"
- § 5.8 视图是声明,实现都在 Capability 里——Three.js 是外部依赖,封装在 SceneManager 等类内(plugin 已实现)

## 主要消费视图(预期)

- `graph.canvas`(当前主消费方,CanvasView.tsx 1147 行入口)
- `graph.family-tree` 及未来所有 graph 变种视图

## 临时引用模式说明(总纲 § 2"新旧 API 共存")

本阶段 capability 通过 import `@plugins/graph/canvas/scene/...` + `@plugins/graph/canvas/interaction/...` 内 4 个核心类**声明意图**,实际代码留在 plugin 内运行。**真搬迁推到波次 3 graph 整体迁移时做**——届时 4 个类整体搬入 `src/capabilities/canvas-interaction/`,本目录形成自包含 capability。
```

**关键约束**:
- **字节级照抄**
- 路径 `src/capabilities/canvas-interaction/README.md` 严格匹配
- 不创建任何 `canvas-interaction/` 子目录或其他文件

### J3：更新 `src/capabilities/README.md`

02b-5 落的"## 当前状态"段含 4 个 capability。**修改为 5 个 capability**：

```markdown
## 当前状态(阶段 02b-6-canvas-interaction)

**已有 5 个 capability**(KRIG capability 四种形态全部落地):

1. **`text-editing/`**(复合型,02b 系列收尾)
   - 02b-1 `256ec984` + 02b-2a `16ca2454` + 02b-2b `a315e7e0` + 02b-2c `237c6cd0`
   - `textEditingCapability` 4/5 字段已填(id/schema/converters/commands);createInstance 留波次 3(NoteEditor PM 创建与 React 深度耦合)

2. **`pdf-rendering/`**(实例工厂型,02b-3 一阶段完成)
   - 02b-3 commit `add19d46`
   - `pdfRenderingCapability` 仅 createInstance 实质(临时引用 PDFRenderer 类)

3. **`epub-rendering/`**(实例工厂型,02b-4 一阶段完成)
   - 02b-4 commit `7f8a9a2b`
   - `epubRenderingCapability` 仅 createInstance 实质(临时引用 EPUBRenderer 类,基于 foliate-js)

4. **`shape-library/`**(资源访问型,02b-5 一阶段完成)
   - 02b-5 commit `0f2b115a`
   - `shapeLibraryCapability` 仅 schema 实质(聚合对象 { shapes, substances },临时引用 ShapeRegistry + SubstanceRegistry 全局单例)

5. **`canvas-interaction/`**(混合型,02b-6 一阶段完成,**首次落地**)
   - 02b-6 commit `<填 J1 commit SHA>`
   - `canvasInteractionCapability` schema + createInstance 都实质(混合型):schema 聚合 4 个类构造函数 { SceneManager, InteractionController, NodeRenderer, HandlesOverlay };createInstance 入口工厂 new SceneManager;converters/commands 对 canvas-interaction 不适用

**KRIG capability 四种形态全部落地**:
- **复合型**(schema + converters + commands):text-editing ✅ / 未来 web-rendering 等
- **实例工厂型**(仅 createInstance,每次 new):pdf-rendering ✅ / epub-rendering ✅ / 未来 elk-layout 等
- **资源访问型**(仅 schema,聚合单例引用):shape-library ✅ / 未来 theme / palette 等
- **混合型**(schema 类构造函数引用 + createInstance 入口工厂)**首次落地**:**canvas-interaction ✅** / 未来其他多类协作架构 capability

**插件 capability 化进度**:
- ebook 插件:✅ 全 capability 化(pdf + epub)
- **graph 插件:✅ 全 capability 化**(shape-library + canvas-interaction)
- note 插件:✅ 1 capability(text-editing,createInstance 留波次 3)
- web 插件:❌ 0 capability

**临时引用模式说明**:本阶段及前序阶段所有 capability 字段引用 `plugins/<X>/`
内现有导出,不搬业务代码。真搬迁推到波次 3 各插件整体迁移时做。

其他 capability(web-rendering / elk-layout / 等)将在 02b-7+ 按需进入此目录。
```

**关键约束**：
- **仅修改"## 当前状态"段**
- 其他段(`# Capabilities` 标题段 / `## 设计原则` / `## 不在本目录的实现`)字节不变
- `<填 J1 commit SHA>` Builder 在 J3 时填具体 J1 commit SHA(8 位即可)
- 8 SHA(text-editing 4 + pdf 1 + epub 1 + shape 1 + canvas 1)全部嵌入

## 严禁顺手做

- ❌ **不修改** `src/plugins/graph/canvas/` 任何文件(capability 仅引用)
- ❌ **不动** SceneManager / InteractionController / NodeRenderer / HandlesOverlay 4 个核心类
- ❌ **不动** `plugins/graph/canvas/CanvasView.tsx` 视图入口(1147 行)
- ❌ **不动** `plugins/graph/canvas/scene/DotGrid.ts` / `TextRenderer.ts` / `LineRenderer.ts`(本阶段不暴露)
- ❌ **不暴露** DotGrid / TextRenderer / LineRenderer 给 schema(task-card R7 硬约束)
- ❌ **不修改** 02b-text-editing / pdf-rendering / epub-rendering / shape-library 已落 capability 文件(只更新 capabilities/README.md)
- ❌ **不创建** `canvas-interaction/` 下除 index.ts + README.md 外任何文件
- ❌ **不创建** 任何 `src/capabilities/<其他 capability>` 子目录
- ❌ **不修改** 任何业务代码(src/main / src/renderer / src/plugins/<其他>)
- ❌ **不动** 阶段 01/02a/02b-* 已落核心文件除 capabilities/README.md 外
- ❌ **不动** ESLint / tsconfig.json / package.json / schema-* / memory
- ❌ **不擅自做** merge / push

## 完成判据

- [ ] **J1**: `src/capabilities/canvas-interaction/index.ts` 字节级匹配 task-card § J1
- [ ] **J1 子项**: 5 行 import(Capability+CapabilityInstance+CapabilityOptions+HostElement / 4 个核心类)
- [ ] **J1 子项**: `canvasInteractionSchema` 模块级 const,聚合对象 { SceneManager, InteractionController, NodeRenderer, HandlesOverlay }
- [ ] **J1 子项**: `canvasInteractionCreateInstance` 模块级 const,参数 `host`(无下划线前缀,实际使用)+ `_options`(带前缀,未使用)
- [ ] **J1 子项**: 5 字段顺序 id → schema → converters → createInstance → commands
- [ ] **J1 子项**: schema = canvasInteractionSchema / createInstance = canvasInteractionCreateInstance(都模块级 const)
- [ ] **J1 子项**: 2 字段值严格 `undefined`(converters/commands)
- [ ] **J1 子项**: `as HTMLElement` + `as CapabilityInstance` 双向断言保留
- [ ] **J1 子项**: 文件无任何 `// eslint-disable-...` 注释
- [ ] **J2**: `canvas-interaction/README.md` 字节级匹配 task-card § J2
- [ ] **J2 子项**: 含混合型 vs 资源访问型 schema 内容差异表
- [ ] **J2 子项**: 含 4 个类协作架构示意图
- [ ] **J3**: `src/capabilities/README.md` 仅"## 当前状态"段被修改;其他段字节不变
- [ ] **J3 子项**: 标题 = "## 当前状态(阶段 02b-6-canvas-interaction)"
- [ ] **J3 子项**: 8 SHA 全嵌入(text-editing 4 + pdf 1 + epub 1 + shape 1 + canvas 1)
- [ ] **J3 子项**: 含四种 capability 形态分类说明(**混合型(首次落地)**)
- [ ] **J3 子项**: 含插件 capability 化进度更新(graph 插件全 capability 化)
- [ ] **J4**: `git diff 48f649c8..HEAD --stat`(**强制双点 diff + 显式基线 SHA `48f649c8`**)含且仅含以下 3 个文件:
      - `src/capabilities/canvas-interaction/index.ts`(新建)
      - `src/capabilities/canvas-interaction/README.md`(新建)
      - `src/capabilities/README.md`(修改)
- [ ] **J5a**: `npm run typecheck` exit 0
- [ ] **J5b**: `npm run lint` exit 1，**errors=765 / warnings=15** 与 02b-5 baseline 完全一致(吸收 § 六纪律 5+6)
- [ ] **J5c**: `npm run lint:dirs` exit 0(白名单豁免有效)
- [ ] **J6**: 所有 commit message 符合 CLAUDE.md `feat/docs(refactor/canvas-interaction): ...` 格式
- [ ] **J7**: `find src/capabilities -type d` 输出 6 行(`src/capabilities` + 5 个 capability)
- [ ] **J8**: `find src/capabilities -type f` 输出 11 行(根 README + 5 个 capability 各 2 文件)

## 已知风险

- **R1(已实测)**: Commander 已模拟 J1 字节级 + 跑 typecheck=0 / lint 全仓 780 (765e+15w) 严格不变 / 单文件 lint 干净 ✅
- **R2(混合型新形态)**: 本阶段是 capability 第四种形态首次落地——README 必须清楚说明设计理由(混合型 vs 资源访问型 schema 内容差异表)
- **R3(吸收 02a G1 教训)**: task-card § J1/J2 字节级模板**不含**任何 `eslint-disable-...` 注释。J5b warnings=15 严格成立
- **R4**: canvas-interaction/ 目录下不允许除 index.ts + README.md 外任何文件
- **R5(基线锁定)**: 派活基线 `48f649c8` = main 当前 HEAD(含阶段 02b-5 merge `e4a8507b` + 02b-5 存档 `48f649c8`)
- **R6(参数前缀差异化)**: createInstance 工厂第一参数 `host`(实际使用,无下划线)+ 第二参数 `_options`(未使用,带前缀)。这与 02b-3/4 (host/options 都带 _) 不同——因为 canvas-interaction 实际使用 host 参数(传给 SceneManager 构造函数)。这是符合 task-card 字面要求的精确差异
- **R7(暴露范围严格 4 个类)**: schema **仅暴露**4 个类 SceneManager / InteractionController / NodeRenderer / HandlesOverlay。**不暴露** DotGrid / TextRenderer / LineRenderer——它们被 SceneManager 内部封装,视图不直接 new
- **R8(混合型设计原理硬约束)**: schema = 类构造函数引用(class 本身),不是单例引用。调用方使用形如 `new schema.NodeRenderer(sm)`(与 shape-library 的 `schema.shapes.get(id)` 形成对比)

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认(已答)

1. **`canvasInteractionSchema` 是否需要导出?** —— **Commander 答**:**不导出**(只是模块级 const,通过 capability 字段暴露,与 shape-library 的 shapeLibrarySchema 同模式)
2. **schema 是否需要 as 断言?** —— **Commander 答**:**不需要**(SchemaContribution = unknown 接受任何对象,直接赋值即可——已实测)
3. **createInstance 第一参数 `host` 是否需要下划线前缀?** —— **Commander 答**:**不带前缀**(实际使用,传给 `new SceneManager(host as HTMLElement)`)。这与 02b-3/4 (host/options 都带 _) 不同
4. **是否需要在 schema 中暴露 DotGrid/TextRenderer/LineRenderer?** —— **Commander 答**:**不需要**(R7 硬约束)。理由:CanvasView 实测 0 引用,这些被 SceneManager 内部封装
5. **converters/commands 不写字段还是显式 undefined?** —— **Commander 答**:显式 `undefined`(与已落 4 个 capability 一致)
6. **3 个 commit 还是 1 个?** —— **Commander 答**:Builder 自决,建议 3 个(J1/J2/J3)

## Builder 完成后

- 写报告到 `tmp/builder-report.md`(按 BUILDER-PROMPT § 五格式)
- 输出"builder-report 就绪：tmp/builder-report.md"
- **不做** merge / push

## 备注:本次为基础设施类阶段(混合型 capability 首次落地)

本次为波次 2 第二阶段第八步(canvas-interaction capability 一阶段完成),**采用临时引用 plugin 模式**——不搬业务代码。BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动自检"契约 § B 防御代码 grep 验证"跳过。

本阶段简单(预期仅 3 文件改动,与 02b-3/4/5 同节奏)——**混合型形态首次落地,KRIG capability 四种形态全部样板齐备**。
